import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect, type Page } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S128 + S-V1 console navigation (redesign plan §4.1, tokophi seller-admin shell) on the built web: the
// sidebar rows per role lens, the role chip of a multi-role user, exactly one active row, the topbar
// account menu and the settings index. Read-only: only the synthetic staff users are written and removed.
// The production sign-in redirect is a pure rule (tests/admin-wib.test.ts); this suite proves the local
// preview stays.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
const sql = identity.sql;
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
let browser: Browser;
const renders = join(RENDERS, "s-v1");

async function staff(roles: Role[], permissions: string[] = []) {
	const user = await actor(identity, roles[0], []);
	users.push(user);
	await enroll(user.browser, user.password);
	await sql`update app.role_grant set roles=${roles}, permissions=${permissions} where user_id=${user.id}`;
	return user;
}
async function open(user: User | null, viewport = { width: 1440, height: 1000 }, touch = false) {
	const context = await browser.newContext({ viewport, reducedMotion: "reduce", hasTouch: touch, isMobile: touch, timezoneId: "Asia/Jakarta" });
	if (user) await context.addCookies([...user.browser.cookies].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	page.on("request", (request) => assert.equal(new URL(request.url()).origin, origin, "No external browser request"));
	return { page, errors, close: () => context.close() };
}
/** [row label, child labels][] as rendered in the operator navigation, every group opened. */
async function navRows(page: Page) {
	const nav = page.getByRole("navigation", { name: "Navigasi Operator" }).first();
	await expect(nav).toBeVisible();
	for (const toggle of await nav.getByRole("button", { name: /^Buka / }).all()) await toggle.click();
	return nav.locator("li[data-nav-row]").evaluateAll((rows) =>
		rows.map((row) => [
			row.getAttribute("data-nav-row") ?? "",
			[...row.querySelectorAll("ul a")].map((a) => a.textContent?.trim() ?? ""),
		]),
	);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// Plan §4.1 per lens; the same rules as the page guards hide what a grant does not open (unit-tested
// in tests/admin-nav-model.test.ts). Unbuilt pages (Persetujuan, Analitik, Tambah Produk, ...) never show.
const SETTINGS = ["Staf & Peran", "Kebijakan Komersial", "Pembayaran & COD", "Tarif Afiliasi", "Gudang", "Integrasi Iklan", "Log Audit", "Kesehatan Sistem"];
const EXPECTED: [string, Role[], string[], [string, string[]][]][] = [
	["owner", ["owner"], [], [
		["Beranda", []],
		["Pantauan", ["Pesanan", "Produk", "Stok", "Kendala Pengiriman", "Retur"]],
		["Keuangan", ["Laporan Keuangan", "Rekonsiliasi", "Komisi Afiliasi"]],
		["Pengaturan", SETTINGS],
	]],
	["ecommerce_admin", ["ecommerce_admin"], ["orders.history.read"], [
		["Beranda", []],
		["Pesanan", ["Semua Pesanan", "Input Resi", "Cetak Label"]],
		["Produk", ["Kategori", "Inventori", "Transfer Stok"]],
		["Promo", ["Banner", "Segmen Pembeli"]],
		["Pengaturan", []],
	]],
	["warehouse", ["warehouse"], [], [
		["Beranda", []],
		["Pesanan", ["Input Resi", "Cetak Label", "Kendala Pengiriman", "Retur"]],
		["Produk", ["Transfer Stok"]],
		["Pengaturan", []],
	]],
	["customer_service", ["customer_service"], ["orders.history.read"], [
		["Beranda", []],
		["Obrolan", []],
		["Pesanan", ["Kendala Pengiriman", "Retur"]],
		["Pelanggan", []],
		["Pengaturan", []],
	]],
	["finance", ["finance"], ["orders.history.read", "finance.reconciliation.read", "finance.refunds.read", "finance.costs.read"], [
		["Beranda", []],
		["Keuangan", ["Pembayaran Masuk", "Setoran COD", "Rekonsiliasi", "Pengembalian Dana", "Komisi Afiliasi", "Tarif Afiliasi"]],
		["Pesanan", []],
		["Pengaturan", []],
	]],
];

before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	mkdirSync(renders, { recursive: true });
});
after(async () => {
	try {
		await browser?.close();
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("S-V1 sidebar shows each lens's plan §4.1 rows that the role's grants open; no Ruang Kerja group", async () => {
	for (const [name, roles, permissions, expected] of EXPECTED) {
		const user = await staff(roles, permissions);
		const { page, close } = await open(user);
		try {
			await page.goto(`${origin}/admin/antrian`);
			assert.deepEqual(await navRows(page), expected, name);
			await expect(page.getByText("Ruang Kerja", { exact: true })).toHaveCount(0);
			// A single-role account has no role chip.
			await expect(page.getByRole("button", { name: /^Ruang kerja:/ })).toHaveCount(0);
		} finally {
			await close();
		}
	}
});

test("S-V1 multi-role account: the role chip switches the lens and the nav follows it", async () => {
	const user = await staff(["warehouse", "customer_service"], ["orders.history.read"]);
	const { page, close } = await open(user);
	try {
		await page.goto(`${origin}/admin?workspace=customer_service`);
		const chip = page.getByRole("button", { name: /^Ruang kerja: Layanan Pelanggan/ });
		await expect(chip).toBeVisible();
		assert.deepEqual((await navRows(page)).map(([row]) => row), ["Beranda", "Obrolan", "Pesanan", "Pelanggan", "Pengaturan"]);
		await chip.click();
		await expect(page.getByTestId("workspace-tab-warehouse")).toHaveAttribute("href", "/admin?workspace=warehouse");
		await page.getByTestId("workspace-tab-warehouse").click();
		await expect(page.getByRole("button", { name: /^Ruang kerja: Gudang/ })).toBeVisible();
		assert.deepEqual((await navRows(page)).map(([row]) => row), ["Beranda", "Pesanan", "Produk", "Pengaturan"]);
		// The lens holds on other pages (remembered for the session's next documents too).
		await page.goto(`${origin}/admin/pesanan/kirim`);
		await expect(page.getByRole("button", { name: /^Ruang kerja: Gudang/ })).toBeVisible();
		// Beranda keeps the lens instead of jumping back to the first role.
		const nav = page.getByRole("navigation", { name: "Navigasi Operator" }).first();
		await expect(nav.getByRole("link", { name: "Beranda" })).toHaveAttribute("href", "/admin?workspace=warehouse");
	} finally {
		await close();
	}
});

test("S-V1 exactly one active row and the account menu (Profil, Keamanan, Lihat Toko, Keluar)", async () => {
	const owner = await staff(["owner"]);
	const { page, errors, close } = await open(owner);
	try {
		await page.goto(`${origin}/admin/pesanan/retur`);
		const nav = page.getByRole("navigation", { name: "Navigasi Operator" });
		await expect(nav.locator('[data-slot="nav-link"][data-active]')).toHaveText(["Retur"]);
		await expect(nav.getByRole("link", { name: "Retur" })).toHaveAttribute("aria-current", "page");
		// The Pantauan group is open because its active child is inside; the other groups stay closed.
		await expect(nav.getByRole("button", { name: "Tutup Pantauan" })).toHaveAttribute("aria-expanded", "true");
		await expect(nav.getByRole("button", { name: "Buka Pengaturan" })).toHaveAttribute("aria-expanded", "false");
		await expect(page.getByTestId("admin-session-bar")).toHaveCount(0);

		const account = page.getByTestId("admin-account");
		await account.getByRole("button", { name: /^Menu akun/ }).click();
		const menu = page.getByRole("menu");
		await expect(menu.getByText(owner.email)).toBeVisible();
		await expect(menu.getByRole("menuitem")).toHaveText(["Profil", "Keamanan", "Lihat Toko", "Keluar"]);
		await expect(menu.getByRole("menuitem", { name: "Lihat Toko" })).toHaveAttribute("href", "/");
		await page.screenshot({ path: join(renders, "account-menu-owner-1440.png") });
		assert.equal(await overflow(page), 0);
		// Sign-out failure keeps the menu and reports it; nothing is signed out.
		await page.route(`${origin}/api/auth/sign-out`, (route) => route.abort("internetdisconnected"));
		await menu.getByRole("menuitem", { name: "Keluar" }).click();
		await expect(page.getByRole("alert").filter({ hasText: "Gagal keluar" })).toBeVisible();
		await expect(menu).toBeVisible();
		assert.deepEqual(errors.filter((e) => !e.includes("ERR_INTERNET_DISCONNECTED")), []);
	} finally {
		await close();
	}
});

test("S-V1 settings index lists only the cards the role opens", async () => {
	const owner = await staff(["owner"]);
	const cs = await staff(["customer_service"], ["orders.history.read"]);
	for (const [user, cards] of [
		[owner, ["Staf & Peran", "Kebijakan Komersial", "Pembayaran & COD", "Gudang", "Template Label", "Balasan CS", "Integrasi Iklan", "Log Audit", "Kesehatan Sistem"]],
		[cs, ["Balasan CS"]],
	] as const) {
		const { page, close } = await open(user);
		try {
			await page.goto(`${origin}/admin/pengaturan`);
			await expect(page.getByRole("list", { name: "Daftar pengaturan" }).locator("li .font-semibold")).toHaveText([...cards]);
		} finally {
			await close();
		}
	}
});

test("S128 signed-out local preview keeps the shell with a sign-in entry (no redirect outside production)", async () => {
	const { page, close } = await open(null);
	try {
		const response = await page.goto(`${origin}/admin/pesanan`);
		assert.equal(response?.status(), 200);
		assert.equal(new URL(page.url()).pathname, "/admin/pesanan");
		const account = page.getByTestId("admin-account");
		await expect(account.getByText("Pratinjau tanpa sesi staf.")).toBeVisible();
		await expect(account.getByRole("link", { name: "Masuk sebagai staf" })).toHaveAttribute("href", "/masuk?next=%2Fadmin");
		await expect(account.getByRole("link", { name: "Lihat Toko" })).toHaveAttribute("href", "/");
	} finally {
		await close();
	}
});

test("S-V1 renders at 390 touch, 768 and 1440 with no overflow, final sidebar width on first paint, no console errors", async () => {
	const owner = await staff(["owner"]);
	const finance = await staff(["finance"], ["orders.history.read", "finance.reconciliation.read", "finance.refunds.read", "finance.costs.read"]);
	const warehouse = await staff(["warehouse"]);
	const shots: [string, User, { width: number; height: number }, boolean, "sheet" | "account" | null][] = [
		["nav-owner-1440", owner, { width: 1440, height: 1000 }, false, null],
		["nav-owner-768", owner, { width: 768, height: 1024 }, false, null],
		["nav-owner-390-sheet", owner, { width: 390, height: 844 }, true, "sheet"],
		["account-menu-owner-390", owner, { width: 390, height: 844 }, true, "account"],
		["nav-finance-1440", finance, { width: 1440, height: 1000 }, false, null],
		["nav-warehouse-390-sheet", warehouse, { width: 390, height: 844 }, true, "sheet"],
	];
	for (const [file, user, viewport, touch, state] of shots) {
		const { page, errors, close } = await open(user, viewport, touch);
		try {
			// Width before any script runs: the server's first paint is already final (2026-10-28 P2).
			await page.route(/\/_next\/static\/.*\.js/, (route) => route.abort());
			await page.goto(`${origin}/admin/antrian`);
			const sidebar = page.locator('[data-slot="admin-sidebar"]');
			const width = viewport.width < 768 ? 0 : viewport.width < 1024 ? 64 : 256;
			assert.equal(Math.round((await sidebar.boundingBox())?.width ?? 0), width, `${file} first paint`);
			await page.unroute(/\/_next\/static\/.*\.js/);
			await page.goto(`${origin}/admin/antrian`);
			await expect(page.locator("main")).toBeVisible();
			assert.equal(Math.round((await sidebar.boundingBox())?.width ?? 0), width, `${file} hydrated`);
			if (state) {
				await page.getByRole("button", { name: "Buka menu navigasi" }).click();
				await expect(page.getByRole("dialog")).toBeVisible();
				if (state === "account") {
					await page.keyboard.press("Escape");
					await page.getByRole("button", { name: /^Menu akun/ }).click();
					await expect(page.getByRole("menuitem", { name: "Keluar" })).toBeVisible();
				}
			}
			if (viewport.width === 768) {
				// Tablet: icon rail with tooltips; the toggle widens it for the session.
				await expect(sidebar).toHaveAttribute("data-rail", "auto");
				await page.getByRole("button", { name: "Lebarkan navigasi" }).click();
				assert.equal(Math.round((await sidebar.boundingBox())?.width ?? 0), 256, file);
				await page.getByRole("button", { name: "Ciutkan navigasi" }).click();
			}
			await page.waitForLoadState("networkidle");
			await page.screenshot({ path: join(renders, `${file}.png`) });
			assert.equal(await overflow(page), 0, file);
			assert.deepEqual(errors.filter((e) => !e.includes("ERR_FAILED")), [], file);
		} finally {
			await close();
		}
	}
});
