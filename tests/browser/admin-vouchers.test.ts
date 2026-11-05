import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import test from "node:test";
import { type Browser, chromium, expect, type Page } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";

// S177 stage 2A admin screens against the built web on the canonical origin: Voucher (/admin/pemasaran/voucher)
// and the marketing lens. Sessions, page guards and navigation are real. The shipping-promotions API is answered
// here by an in-test store that follows the backend rules the screen depends on (marketing proposes inactive
// versions only, approve/reject only by owner/ecommerce_admin), because promotion rows are permanent
// (app.guard_promotion_head refuses DELETE) and would outlive the run; the API rules themselves are proven in
// tests/integration/voucher.test.ts. Screenshots: ADMIN_VOUCHER_SHOTS=<dir> (390 and 1440, owner with a proposal).
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
const sql = identity.sql;
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
let browser: Browser;
const API = `${origin}/api/v1/admin/shipping-promotions`;

async function staff(role: Role) {
	const user = await actor(identity, role, []);
	users.push(user);
	await enroll(user.browser, user.password);
	return user;
}
async function open(user: User, viewport = { width: 1440, height: 900 }) {
	const context = await browser.newContext({ viewport, reducedMotion: "reduce", timezoneId: "Asia/Jakarta" });
	await context.addCookies([...user.browser.cookies].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()));
	return { page, errors, close: () => context.close() };
}
const noOverflow = async (page: Page) =>
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, "no horizontal page scroll");

type Version = Record<string, unknown> & { id: string; version: number; active: boolean; proposed: boolean; code: string | null; reason: string };
/** Versions per promotion, newest last; shared by every page so one user's write shows on another's list. */
const store = new Map<string, Version[]>();
let nextId = 1;
const problem = (status: number, code: string) => ({ status, body: { type: "about:blank", title: code, status, code } });

async function fakeApi(page: Page, approver: boolean) {
	await page.route(
		(url) => url.href.startsWith(API),
		async (route) => {
			const request = route.request();
			const url = new URL(request.url());
			const [, id, sub] = url.pathname.replace("/api/v1/admin/shipping-promotions", "").split("/");
			const reply = ({ status, body }: { status: number; body: unknown }) =>
				route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
			const head = (pid: string) => store.get(pid)?.at(-1) as Version;
			if (request.method() === "GET") {
				if (!id) return reply({ status: 200, body: { data: [...store.keys()].map(head), pagination: { next_cursor: null } } });
				return reply({ status: 200, body: { data: [...(store.get(id) ?? [])].reverse(), pagination: { next_cursor: null } } });
			}
			const input = request.postDataJSON();
			const append = (pid: string, fields: Record<string, unknown>) => {
				const versions = store.get(pid) ?? [];
				const row = {
					budget_state: { version: 0, reserved: 0, committed: 0 },
					used_count: 0,
					recorded_at: new Date().toISOString(),
					...versions.at(-1),
					...fields,
					id: pid,
					version: versions.length + 1,
				} as Version;
				// Mirrors the API: a version that is active (and started; these windows start in the past) marks the promotion as run.
				row.has_run = Boolean(versions.at(-1)?.has_run) || row.active;
				store.set(pid, [...versions, row]);
				return { status: versions.length ? 200 : 201, body: row };
			};
			if (sub === "decisions") {
				if (!approver) return reply(problem(403, "FORBIDDEN"));
				const current = head(id);
				if (current.version !== input.expected_version) return reply(problem(409, "VERSION_CONFLICT"));
				if (!current.proposed) return reply(problem(409, "PROPOSAL_REQUIRED"));
				const approve = input.decision === "approve";
				return reply(append(id, { active: approve, proposed: false, reason: `${approve ? "Disetujui" : "Ditolak"}: ${input.reason}` }));
			}
			if (!approver && input.active) return reply(problem(403, "PROMOTION_APPROVAL_REQUIRED"));
			if (id && !approver && head(id).active) return reply(problem(403, "PROMOTION_APPROVAL_REQUIRED"));
			if (!id && input.code && [...store.values()].some((v) => v[0].code === input.code)) return reply(problem(409, "VOUCHER_CODE_TAKEN"));
			const { expected_version: _, ...terms } = input;
			const pid = id ?? `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
			return reply(append(pid, { ...terms, code: input.code ?? null, proposed: !approver }));
		},
	);
}

test.before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
});
test.after(async () => {
	await browser?.close();
	await cleanup(identity, users);
	await sql.end({ timeout: 5 });
});

async function fillVoucher(page: Page, code: string, name: string) {
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Kode voucher").fill(code);
	await dialog.getByLabel("Nama voucher").fill(name);
	await dialog.getByLabel("Mulai (WIB)").fill("2026-01-01T00:00");
	await dialog.getByLabel("Selesai (WIB)").fill("2030-12-31T23:59");
	await dialog.getByLabel("Potongan per pesanan (Rp)").fill("10000");
	await dialog.getByLabel("Minimum belanja (Rp)").fill("50000");
	await dialog.getByLabel("Anggaran total (Rp)").fill("1000000");
	await dialog.getByLabel("Alasan").fill("Kampanye uji");
	return dialog;
}

test("Voucher: owner creates a running voucher; marketing proposes; owner approves and rejects; 390/1440 without overflow", { timeout: 180000 }, async () => {
	const owner = await staff("owner");
	const marketing = await staff("marketing");

	// Owner: a new voucher runs at once and its terms lock (Perpanjang / Tambah anggaran / Akhiri voucher).
	const o = await open(owner);
	try {
		await fakeApi(o.page, true);
		await o.page.goto(`${origin}/admin/pemasaran/voucher`);
		await expect(o.page.getByRole("heading", { name: "Voucher", exact: true })).toBeVisible();
		await o.page.getByTestId("promotion-create").click();
		const dialog = await fillVoucher(o.page, "ongkir10", "Hemat ongkir");
		await dialog.getByRole("button", { name: "Buat voucher" }).click();
		await expect(o.page.getByRole("status").filter({ hasText: "Voucher ONGKIR10 dibuat." })).toBeVisible();
		const row = o.page.getByTestId("vouchers").getByRole("row").filter({ hasText: "ONGKIR10" });
		await expect(row.getByText("Berjalan")).toBeVisible();
		await expect(row.getByRole("button", { name: "Perpanjang" })).toBeVisible();
		await expect(row.getByRole("button", { name: "Tambah anggaran" })).toBeVisible();
		await expect(row.getByRole("button", { name: "Ubah" })).toHaveCount(0);
		await row.getByRole("button", { name: "Tindakan lain untuk ONGKIR10" }).click();
		await expect(o.page.getByRole("menuitem")).toHaveText(["Akhiri voucher", "Riwayat"]);
		await o.page.keyboard.press("Escape");
		const [created] = [...store.values()][0];
		assert.equal(created.code, "ONGKIR10", "the code is sent upper-case");
		assert.equal(created.active, true);
		await row.getByRole("button", { name: "Perpanjang" }).click();
		const locked = o.page.getByRole("dialog");
		await expect(locked.getByTestId("voucher-locked")).toBeVisible();
		await expect(locked.getByLabel("Potongan per pesanan (Rp)")).toBeDisabled();
		await expect(locked.getByLabel("Selesai (WIB)")).toBeFocused();
		await locked.getByLabel("Selesai (WIB)").fill("2029-12-31T23:59");
		await locked.getByLabel("Alasan").fill("Mundur");
		await locked.getByRole("button", { name: "Simpan versi baru" }).click();
		await expect(locked.getByRole("alert")).toContainText("hanya bisa diperpanjang");
		// Promo Ongkir lists only automatic promotions.
		await o.page.goto(`${origin}/admin/promo/ongkir`);
		await expect(o.page.getByRole("heading", { name: "Promo Ongkir" })).toBeVisible();
		await expect(o.page.getByText("ONGKIR10")).toHaveCount(0);
		assert.deepEqual(o.errors, []);
	} finally {
		await o.close();
	}

	// Marketing: lands on the hub, sees only Pemasaran, proposes two vouchers and never sees a decision button.
	const m = await open(marketing);
	try {
		await fakeApi(m.page, false);
		await m.page.goto(`${origin}/admin`);
		await expect(m.page).toHaveURL(`${origin}/admin/pemasaran`);
		const nav = m.page.getByRole("complementary", { name: "Sidebar konsol" });
		await expect(nav.getByRole("link", { name: "Beranda" })).toHaveCount(0);
		await expect(m.page.getByTestId("marketing-index").getByRole("link", { name: /Voucher/ })).toBeVisible();
		await m.page.goto(`${origin}/admin/pemasaran/voucher`);
		await expect(m.page.getByTestId("proposal-info")).toBeVisible();
		const running = m.page.getByTestId("vouchers").getByRole("row").filter({ hasText: "ONGKIR10" });
		await expect(running.getByRole("button", { name: "Riwayat" })).toBeVisible();
		await expect(running.getByRole("button", { name: /Ubah|Perpanjang|Akhiri/ })).toHaveCount(0);
		for (const [code, name] of [["COD5K", "Usulan COD"], ["TOLAKAKU", "Usulan ditolak"]]) {
			await m.page.getByTestId("promotion-create").click();
			const dialog = await fillVoucher(m.page, code, name);
			await expect(dialog.getByText("Aktif (berlaku")).toHaveCount(0);
			await dialog.getByRole("button", { name: "Kirim usulan" }).click();
			await expect(m.page.getByRole("status").filter({ hasText: `Usulan voucher ${code} dikirim.` })).toBeVisible();
		}
		await expect(m.page.getByText("Usulan menunggu persetujuan")).toHaveCount(2);
		await expect(m.page.getByRole("button", { name: /Setujui|Tolak|Tindakan lain/ })).toHaveCount(0);
		assert.ok([...store.values()].slice(1).every((v) => v[0].active === false && v[0].proposed === true), "proposals are inactive");
		// The marketing lens does not open other console pages.
		await expect(nav.getByRole("link", { name: "Promo Ongkir" })).toBeVisible();
		await expect(nav.getByRole("link")).toHaveText(["Pemasaran", "Voucher", "Promo Ongkir"]);
		await m.page.goto(`${origin}/admin/banner`);
		await expect(m.page.getByRole("heading", { name: "Akses konten toko diperlukan" })).toBeVisible();
		assert.deepEqual(m.errors, []);
	} finally {
		await m.close();
	}

	// Owner: approves one proposal, rejects the other; screenshots before deciding (one proposal waiting each).
	const shots = process.env.ADMIN_VOUCHER_SHOTS;
	if (shots) await mkdir(shots, { recursive: true });
	for (const width of [390, 1440]) {
		const v = await open(owner, { width, height: width === 390 ? 844 : 900 });
		try {
			await fakeApi(v.page, true);
			await v.page.goto(`${origin}/admin/pemasaran/voucher`);
			await expect(v.page.getByTestId("proposals-waiting")).toHaveText("2 usulan menunggu persetujuan Anda.");
			await noOverflow(v.page);
			if (shots) await v.page.screenshot({ path: `${shots}/voucher-owner-${width}.png`, fullPage: true });
			assert.deepEqual(v.errors, []);
		} finally {
			await v.close();
		}
	}
	const d = await open(owner);
	try {
		await fakeApi(d.page, true);
		await d.page.goto(`${origin}/admin/pemasaran/voucher`);
		const table = d.page.getByTestId("vouchers");
		await table.getByRole("row").filter({ hasText: "COD5K" }).getByRole("button", { name: "Setujui & jalankan" }).click();
		let dialog = d.page.getByRole("dialog");
		await expect(dialog.getByTestId("proposal-terms")).toContainText("COD5K");
		await dialog.getByRole("button", { name: "Setujui & jalankan" }).click();
		await expect(dialog.getByRole("alert")).toHaveText("Alasan wajib diisi.");
		await dialog.getByLabel("Alasan persetujuan").fill("Sesuai rencana");
		await dialog.getByRole("button", { name: "Setujui & jalankan" }).click();
		await expect(d.page.getByRole("status").filter({ hasText: "Usulan voucher COD5K disetujui dan dijalankan" })).toBeVisible();
		await expect(table.getByRole("row").filter({ hasText: "COD5K" }).getByText("Berjalan")).toBeVisible();
		await table.getByRole("row").filter({ hasText: "TOLAKAKU" }).getByRole("button", { name: "Tolak", exact: true }).click();
		dialog = d.page.getByRole("dialog");
		await dialog.getByLabel("Alasan penolakan").fill("Anggaran bulan ini habis");
		await dialog.getByRole("button", { name: "Tolak usulan" }).click();
		await expect(d.page.getByRole("status").filter({ hasText: "Usulan voucher TOLAKAKU ditolak." })).toBeVisible();
		await expect(table.getByRole("row").filter({ hasText: "TOLAKAKU" }).getByText("Ditolak", { exact: true })).toBeVisible();
		await expect(d.page.getByTestId("proposals-waiting")).toHaveCount(0);
		const decided = [...store.values()].map((v) => v.at(-1));
		assert.deepEqual(
			decided.slice(1).map((v) => [v?.code, v?.active, v?.proposed, v?.reason]),
			[
				["COD5K", true, false, "Disetujui: Sesuai rencana"],
				["TOLAKAKU", false, false, "Ditolak: Anggaran bulan ini habis"],
			],
		);
		await noOverflow(d.page);
		assert.deepEqual(d.errors, []);
	} finally {
		await d.close();
	}
});

test("Marketing lens beside another role: the role chip opens the Pemasaran hub and the nav follows it", { timeout: 120000 }, async () => {
	const user = await staff("finance");
	await sql`update app.role_grant set roles=${["finance", "marketing"]}, permissions=${["finance.reconciliation.read"]} where user_id=${user.id}`;
	const { page, errors, close } = await open(user);
	try {
		await page.goto(`${origin}/admin?workspace=finance`);
		await page.getByRole("button", { name: /^Ruang kerja: Keuangan/ }).click();
		await expect(page.getByTestId("workspace-tab-marketing")).toHaveAttribute("href", "/admin/pemasaran?workspace=marketing");
		await page.getByTestId("workspace-tab-marketing").click();
		await expect(page.getByRole("button", { name: /^Ruang kerja: Marketing/ })).toBeVisible();
		const nav = page.getByRole("complementary", { name: "Sidebar konsol" });
		await expect(nav.getByRole("link", { name: "Beranda" })).toHaveCount(0);
		await expect(nav.getByRole("link", { name: "Voucher" })).toBeVisible();
		// The finance dashboard still opens for this account.
		await page.goto(`${origin}/admin?workspace=finance`);
		await expect(page.getByRole("button", { name: /^Ruang kerja: Keuangan/ })).toBeVisible();
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});
