import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
	type BrowserContext,
	chromium,
	expect,
	type Page,
} from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleSupport } from "../../src/modules/support/routes.ts";
import {
	actor,
	type BrowserSession,
	cleanup,
	enroll,
} from "../contract/access-fixture.ts";

// S74 against the built web on the canonical origin: the real CustomerChatView and
// StaffInboxView open on the newest messages, page older ones, and a buyer reply
// during staff work costs at most one VERSION_CONFLICT before the view recovers.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
const SEEDED = 45;
const label = (n: number) => `Pesan uji ${String(n).padStart(3, "0")}`;

async function buyerPost(
	session: BrowserSession,
	path: string,
	body: Record<string, unknown>,
) {
	const request = session.request(path, body);
	request.headers.set("idempotency-key", randomUUID());
	const response = await handleSupport(request, identity);
	assert.ok(response.ok, `${path} -> ${response.status}`);
	return (await response.json()) as { id: string };
}

const say = (session: BrowserSession, conversationId: string, text: string) =>
	buyerPost(
		session,
		`/api/v1/support/conversations/${conversationId}/messages`,
		{
			client_message_id: randomUUID(),
			text,
			attachment_ids: [],
		},
	);

async function signedIn(context: BrowserContext, session: BrowserSession) {
	await context.addCookies(
		[...session.cookies].map(([name, value]) => ({
			name,
			value,
			domain: "127.0.0.1",
			path: "/",
		})),
	);
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("request", (request) =>
		assert.equal(
			new URL(request.url()).origin,
			origin,
			"No external browser request",
		),
	);
	return { page, errors };
}

async function expectNewestThenOlder(page: Page, log: string) {
	const history = page.getByRole("log", { name: log });
	await expect(history).toContainText(label(SEEDED));
	await expect(history).not.toContainText(label(1));
	await page.getByRole("button", { name: "Muat pesan sebelumnya" }).click();
	await expect(history).toContainText(label(1));
	await expect(history).toContainText(label(SEEDED));
}

test("S74 built browser: customer and staff open on the newest messages, page older ones, and recover from a buyer reply with at most one conflict", async () => {
	const buyer = await actor(identity, "buyer", []);
	const staff = await actor(identity, "customer_service", []);
	let conversationId: string | undefined;
	const browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
	});
	try {
		await enroll(staff.browser, staff.password);
		({ id: conversationId } = await buyerPost(
			buyer.browser,
			"/api/v1/support/conversations",
			{
				client_conversation_id: `s74-${randomUUID()}`,
			},
		));
		for (let n = 1; n <= SEEDED; n++)
			await say(buyer.browser, conversationId, label(n));
		const short = conversationId.slice(0, 8);

		const customer = await signedIn(
			await browser.newContext({ reducedMotion: "reduce" }),
			buyer.browser,
		);
		await customer.page.goto(`${origin}/bantuan`);
		await customer.page
			.getByRole("button", { name: "Muat Percakapan Saya" })
			.click();
		await customer.page
			.getByRole("listitem")
			.filter({ hasText: `Percakapan #${short}` })
			.getByRole("button", { name: "Buka Percakapan" })
			.click();
		await expectNewestThenOlder(customer.page, "Riwayat pesan percakapan");
		assert.deepEqual(customer.errors, []);

		const desk = await signedIn(
			await browser.newContext({ reducedMotion: "reduce" }),
			staff.browser,
		);
		let conflicts = 0;
		desk.page.on("response", (response) => {
			if (
				response.status() === 409 &&
				response.url().includes("/api/v1/admin/support/")
			)
				conflicts++;
		});
		await desk.page.goto(`${origin}/admin/support`);
		// S113: the staff queue is the shared DataTable (rows from md, cards below). The row label is
		// the order number (none here), never a short id, so the row is found by its test id.
		await desk.page
			.getByTestId(`support-inbox-row-${conversationId}`)
			.getByRole("button", { name: "Buka Detail" })
			.click();
		await expectNewestThenOlder(
			desk.page,
			"Riwayat pesan publik pelanggan dan CS",
		);
		await desk.page.getByRole("button", { name: "Klaim Percakapan" }).click();
		await expect(
			desk.page.getByText("Percakapan berhasil diklaim secara eksklusif."),
		).toBeVisible();

		// The buyer writes while staff holds a now-stale revision.
		await say(buyer.browser, conversationId, "Pembeli menulis lagi 1");
		const waiting = desk.page.getByRole("button", {
			name: "Set Menunggu Pelanggan",
		});
		const changed = desk.page.getByText(
			"Status diubah menjadi Menunggu pelanggan.",
		);
		await waiting.click();
		await expect(
			changed.or(desk.page.getByText("Percakapan diperbarui. Coba lagi.")),
		).toBeVisible();
		if (!(await changed.isVisible())) await waiting.click();
		await expect(changed).toBeVisible();
		const history = desk.page.getByRole("log", {
			name: "Riwayat pesan publik pelanggan dan CS",
		});
		await expect(history).toContainText("Pembeli menulis lagi 1");
		assert.ok(conflicts <= 1, `one buyer reply caused ${conflicts} conflicts`);

		// A reply that skips a buyer message refreshes the revision, so the next action needs no retry.
		const before = conflicts;
		await say(buyer.browser, conversationId, "Pembeli menulis lagi 2");
		await desk.page
			.getByLabel("Balasan Publik ke Pelanggan")
			.fill("Baik, kami cek dulu.");
		await desk.page
			.getByRole("button", { name: "Kirim Balasan Publik" })
			.click();
		await expect(
			desk.page.getByText("Balasan publik terkirim ke pelanggan."),
		).toBeVisible();
		await expect(history).toContainText("Pembeli menulis lagi 2");
		await desk.page
			.getByRole("button", { name: "Tandai Selesai" })
			.click();
		await expect(
			desk.page.getByText("Status diubah menjadi Selesai."),
		).toBeVisible();
		assert.equal(
			conflicts,
			before,
			"no conflict after the reply refreshed the revision",
		);
		assert.deepEqual(desk.errors, []);
	} finally {
		await browser.close();
		if (conversationId) {
			const ids = [conversationId];
			const sql = identity.sql;
			await sql`delete from app.support_in_app_notification where conversation_id in ${sql(ids)}`;
			await sql`delete from app.support_participant_preference where conversation_id in ${sql(ids)}`;
			await sql`delete from app.support_assignment_event where conversation_id in ${sql(ids)}`;
			await sql`delete from app.support_read_position where conversation_id in ${sql(ids)}`;
			await sql`delete from app.support_message where conversation_id in ${sql(ids)}`;
			await sql`delete from app.support_conversation where id in ${sql(ids)}`;
		}
		await cleanup(identity, [buyer, staff]);
		await identity.sql.end();
	}
});
