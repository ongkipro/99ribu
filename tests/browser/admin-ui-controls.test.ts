import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
	type Browser,
	chromium,
	expect,
	type Page,
	type Route,
} from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";

// UI-controls audit (2026-10-24) fixes against the built web on the canonical origin: permission-aware
// finance/export/KPI controls, no actions in the signed-out preview, one request per double click,
// visible errors on network failure, the CS inbox inside the console shell, and a keyboard-reachable
// chat upload. Every mutation is intercepted (fulfilled with a refusal or aborted) so no business
// state changes; only the synthetic staff users are written and removed again.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
const sql = identity.sql;
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
let browser: Browser;

async function staff(role: Role, permissions: string[] = []) {
	const user = await actor(identity, role, []);
	users.push(user);
	await enroll(user.browser, user.password);
	await sql`update app.role_grant set permissions=${permissions} where user_id=${user.id}`;
	return user;
}

async function open(user: User | null, viewport = { width: 1280, height: 900 }) {
	const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
	if (user)
		await context.addCookies(
			[...user.browser.cookies].map(([name, value]) => ({
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
		assert.equal(new URL(request.url()).origin, origin, "No external browser request"),
	);
	return { page, errors, close: () => context.close() };
}

/** Counts matching requests and answers them after a delay, so a second click lands while the first is pending. */
async function intercept(
	page: Page,
	match: (url: URL, method: string) => boolean,
	answer: (route: Route) => Promise<void>,
) {
	const seen: string[] = [];
	await page.route(
		(url) => url.origin === origin,
		async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			if (!match(url, request.method())) return route.fallback();
			seen.push(`${request.method()} ${url.pathname}`);
			await new Promise((resolve) => setTimeout(resolve, 400));
			await answer(route);
		},
	);
	return seen;
}
const json = (route: Route, body: unknown, status = 200) =>
	route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const problem = (route: Route, status: number, code: string) =>
	json(route, { type: "about:blank", title: code, status, code }, status);

test.before(async () => {
	browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
	});
});
test.after(async () => {
	await browser?.close();
	await cleanup(identity, users);
	await sql.end({ timeout: 5 });
});

test("finance read-only: confirm and record controls are disabled with a visible reason; KPI and export follow the grants", async () => {
	const reader = await staff("finance", ["finance.reconciliation.read", "finance.summary.read"]);
	const { page, errors, close } = await open(reader);
	try {
		await page.goto(`${origin}/admin/payments`);
		await expect(page.getByTestId("payments-read-only")).toBeVisible();
		for (const name of ["Konfirmasi transfer", "Konfirmasi manual"]) {
			const buttons = page.getByRole("button", { name });
			for (let i = 0; i < (await buttons.count()); i++) await expect(buttons.nth(i)).toBeDisabled();
		}

		await page.goto(`${origin}/admin/cod-settlements`);
		await expect(page.getByTestId("cod-record-open")).toBeDisabled();
		await expect(page.getByTestId("cod-read-only")).toBeVisible();
		await expect(page.getByRole("dialog")).toHaveCount(0);

		// No exports.download: the export is offered disabled with its reason, never as a dead-end dialog.
		await page.goto(`${origin}/admin?workspace=finance`);
		await expect(page.getByTestId("workspace-heading")).toBeVisible();
		await page.getByTestId("queue-tab-reconciliation").click();
		await expect(page.getByTestId("export-denied-reason")).toBeVisible();
		await expect(page.getByTestId("freeze-export-selection-btn")).toBeDisabled();
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}

	// Without reconciliation.read the KPI shortcuts to Pembayaran / Setoran COD are not offered.
	const noRead = await staff("finance", ["finance.summary.read"]);
	const second = await open(noRead);
	try {
		await second.page.goto(`${origin}/admin?workspace=finance`);
		await expect(second.page.getByTestId("workspace-heading")).toBeVisible();
		await expect(
			second.page.locator('a[href="/admin/payments"], a[href="/admin/cod-settlements"]'),
		).toHaveCount(0);
	} finally {
		await second.close();
	}
});

test("signed-out preview offers no export, print or KPI actions", async () => {
	const { page, errors, close } = await open(null);
	try {
		for (const ws of ["owner", "warehouse", "finance"]) {
			await page.goto(`${origin}/admin?workspace=${ws}`);
			await expect(page.getByText("Mode pratinjau: contoh data, bukan data nyata")).toBeVisible();
			await expect(page.getByTestId("freeze-export-selection-btn")).toHaveCount(0);
			await expect(page.locator('[data-testid^="kpi-action-"]')).toHaveCount(0);
			await expect(page.getByRole("link", { name: "Pusat Cetak Label" })).toHaveCount(0);
		}
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("payment terms: a double click sends one proof request and a network failure is shown", async () => {
	const owner = await staff("owner");
	const { page, errors, close } = await open(owner);
	try {
		const proofs = await intercept(
			page,
			(url, method) => method === "POST" && url.pathname === "/api/v1/me/reauthentication-proofs",
			(route) => route.abort("internetdisconnected"),
		);
		const writes = await intercept(
			page,
			(url, method) => method === "POST" && url.pathname === "/api/v1/admin/policy-versions",
			(route) => problem(route, 409, "VERSION_CONFLICT"),
		);
		await page.goto(`${origin}/admin/payments`);
		await page.getByLabel("Alasan perubahan").fill("Uji kontrol UI");
		await page.getByLabel("Konfirmasi kata sandi").fill("bukan-kata-sandi");
		const save = page.getByRole("button", { name: "Simpan ketentuan" });
		await save.dblclick();
		await expect(page.getByRole("button", { name: "Menyimpan…" })).toBeDisabled();
		// Filter by text: Next's route announcer is also role=alert.
		await expect(page.getByRole("alert").filter({ hasText: "Tidak dapat terhubung" })).toBeVisible();
		assert.equal(proofs.length, 1, `one proof request, saw ${proofs.join(", ")}`);
		assert.equal(writes.length, 0, "no policy write without a proof");
		await expect(save).toBeEnabled();
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("staff inbox: console shell, noindex, claim once per double click, visible network error, status and claim gating", async () => {
	const agent = await staff("customer_service");
	const { page, errors, close } = await open(agent);
	const conversation = {
		id: randomUUID(),
		status: "open",
		version: 3,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		last_message_sequence: 0,
		buyer_last_read_sequence: 0,
		staff_last_read_sequence: 0,
	};
	const item = {
		conversation,
		order_number: "99-S113CONTOH",
		assignee_user_id: null,
		assignment_version: 3,
		current_agent_last_read_sequence: 0,
		current_agent_unread_messages: 0,
	};
	try {
		// Synthetic inbox: reads answered in the browser, every write aborted (network failure).
		const claims = await intercept(
			page,
			(url) => url.pathname.startsWith("/api/v1/admin/support/"),
			async (route) => {
				const request = route.request();
				const path = new URL(request.url()).pathname;
				if (request.method() !== "GET") return route.abort("internetdisconnected");
				if (path === "/api/v1/admin/support/conversations") return json(route, { data: [item] });
				if (path.endsWith("/classification"))
					return json(route, { conversation_id: conversation.id, version: 3, tag_ids: [], priority: "normal", updated_at: conversation.updated_at });
				return json(route, { data: [] });
			},
		);
		const response = await page.goto(`${origin}/admin/support`);
		assert.equal(response?.status(), 200);
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
		await expect(page.getByRole("navigation", { name: "Navigasi Operator" })).toBeVisible();
		await expect(page.getByRole("link", { name: "Kotak Masuk Pelanggan" })).toHaveAttribute("aria-current", "page");
		await expect(page.getByRole("link", { name: "Ke Konsol Operasional" })).toHaveAttribute("href", "/admin");
		await expect(page.locator("main")).toHaveCount(1);

		// S113: the inbox lists the printed order number, never the raw order id.
		await expect(page.getByTestId("support-inbox").getByText("Pesanan 99-S113CONTOH")).toBeVisible();
		await page.getByRole("button", { name: "Buka Detail" }).click();
		// Unclaimed: status/assignment are disabled with the reason; the current status has no button.
		await expect(page.getByText("Klaim percakapan terlebih dahulu untuk mengubah status atau penugasan.")).toBeVisible();
		await expect(page.getByRole("button", { name: "Buka Kembali" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "Set Menunggu Pelanggan" })).toBeDisabled();
		await expect(page.getByRole("button", { name: "Lepas ke Antrean" })).toHaveCount(0);

		const before = claims.filter((c) => c.startsWith("POST")).length;
		await page.getByRole("button", { name: "Klaim Percakapan" }).dblclick();
		await expect(page.getByRole("alert").filter({ hasText: "Koneksi terputus" })).toBeVisible();
		const posts = claims.filter((c) => c.startsWith("POST")).slice(before);
		assert.deepEqual(posts, [`POST /api/v1/admin/support/conversations/${conversation.id}/claims`]);
		await expect(page.getByRole("button", { name: "Klaim Percakapan" })).toBeEnabled();
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}

	// Signed out: the console shell stays (sidebar, session bar) with an access notice.
	const anon = await open(null);
	try {
		await anon.page.goto(`${origin}/admin/support`);
		await expect(anon.page.locator("#access-denied-heading")).toBeVisible();
		await expect(anon.page.getByTestId("admin-session-bar")).toBeVisible();
	} finally {
		await anon.close();
	}
});

test("sidebar: ecommerce_admin and warehouse see Pusat Cetak Label, finance does not", async () => {
	for (const [role, shown] of [["ecommerce_admin", true], ["warehouse", true], ["finance", false]] as const) {
		const user = await staff(role, role === "finance" ? ["finance.reconciliation.read"] : []);
		const { page, close } = await open(user);
		try {
			await page.goto(`${origin}/admin`);
			const nav = page.getByRole("navigation", { name: "Navigasi Operator" });
			await expect(nav.getByRole("link", { name: "Pusat Cetak Label" })).toHaveCount(shown ? 1 : 0);
		} finally {
			await close();
		}
	}
});

test("customer chat: one start request per double click, keyboard-reachable upload, visible read-marker failure", async () => {
	const { page, errors, close } = await open(null, { width: 390, height: 900 });
	const conv = {
		id: randomUUID(),
		status: "open",
		version: 1,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		last_message_sequence: 0,
		buyer_last_read_sequence: 0,
		staff_last_read_sequence: 0,
	};
	try {
		const calls = await intercept(
			page,
			(url) => url.pathname.startsWith("/api/v1/support/") || url.pathname === "/api/v1/guest-support-sessions",
			async (route) => {
				const request = route.request();
				const path = new URL(request.url()).pathname;
				if (path === "/api/v1/guest-support-sessions") return json(route, { ok: true }, 201);
				if (path === "/api/v1/support/conversations" && request.method() === "POST") return json(route, conv, 201);
				if (path.endsWith("/read-markers")) return route.abort("internetdisconnected");
				if (path === `/api/v1/support/conversations/${conv.id}`) return json(route, conv);
				if (path.endsWith("/preferences"))
					return json(route, { conversation_id: conv.id, version: 1, archived: false, muted: false, updated_at: conv.updated_at });
				return json(route, { data: [] });
			},
		);
		await page.goto(`${origin}/bantuan`);
		await page.getByRole("button", { name: "Mulai chat bantuan" }).dblclick();
		await expect(page.getByRole("button", { name: "Kirim pesan" })).toBeVisible();
		assert.equal(calls.filter((c) => c === "POST /api/v1/support/conversations").length, 1);

		// Keyboard: Tab from the composer reaches the upload button, and Enter opens the picker.
		await page.getByLabel(/^Tulis pesan/).focus();
		let reached = false;
		for (let i = 0; i < 6 && !reached; i++) {
			await page.keyboard.press("Tab");
			reached = (await page.evaluate(() => document.activeElement?.textContent?.trim())) === "Unggah gambar";
		}
		assert.ok(reached, "Unggah gambar is reachable with Tab");
		const chooser = page.waitForEvent("filechooser");
		await page.keyboard.press("Enter");
		await chooser;

		await page.getByRole("button", { name: "Tandai dibaca" }).click();
		await expect(page.getByRole("alert").filter({ hasText: "Koneksi terputus" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Tandai dibaca" })).toBeEnabled();
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});
