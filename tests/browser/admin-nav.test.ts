import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect, type Page } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S128 console navigation (spec 17 "Admin console — information architecture") on the built web: the
// sidebar item set per role and for a multi-role user, the longest-match active item, and the account
// menu that replaced the session bar. Read-only: only the synthetic staff users are written and removed.
// The production sign-in redirect is a pure rule (tests/admin-wib.test.ts); this suite proves the local
// preview stays.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
const sql = identity.sql;
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
let browser: Browser;
const renders = join(RENDERS, "s128");

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
/** [group label, item labels][] as rendered in the operator navigation. */
async function navGroups(page: Page) {
	const nav = page.getByRole("navigation", { name: "Navigasi Operator" });
	await expect(nav.getByTestId("role-workspace-switcher")).toBeVisible();
	return nav.locator('[data-slot="sidebar-group"]').evaluateAll((groups) =>
		groups.map((g) => [
			g.querySelector('[data-slot="sidebar-group-label"]')?.textContent?.trim() ?? "",
			[...g.querySelectorAll('[data-slot="sidebar-menu-button"]')].map((b) => b.textContent?.trim() ?? ""),
		]),
	);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const LENSES = ["Super Admin", "Admin E-Commerce", "Gudang", "Layanan Pelanggan", "Keuangan"];
const EXPECTED: [string, Role[], string[], (string | string[])[][]][] = [
	["owner", ["owner"], [], [
		["Ruang Kerja", LENSES],
		["Operasional", ["Pesanan", "Pengiriman Manual", "Pusat Cetak Label", "Masalah Pengiriman", "Retur & Penggantian", "Kotak Masuk Pelanggan", "Akun Pembeli"]],
		["Katalog & Stok", ["Produk", "SKU Fisik", "Kategori", "Stok Gudang", "Transfer Stok", "Daftar Gudang"]],
		["Pemasaran", ["Promo Ongkir", "Banner Beranda", "Segmen Pembeli", "Afiliasi"]],
		["Keuangan", ["Pembayaran Masuk", "Setoran COD", "Rekonsiliasi", "Pembayaran Komisi", "Pengembalian Dana", "Laporan Keuangan"]],
		["Pengaturan", ["Log Audit", "Kesehatan Sistem", "Staf & Peran", "Pembayaran & Biaya COD", "Kebijakan Komersial", "Template Label", "Integrasi Iklan", "Balasan & Tag CS"]],
	]],
	// One-item groups join their neighbour (visibleGroups): Template Label (read for ecommerce_admin, warehouse) has no group of its own.
	["ecommerce_admin", ["ecommerce_admin"], ["orders.history.read"], [
		["Ruang Kerja", ["Admin E-Commerce"]],
		["Operasional", ["Pesanan", "Pengiriman Manual", "Pusat Cetak Label"]],
		["Katalog & Stok", ["Produk", "SKU Fisik", "Kategori", "Stok Gudang", "Transfer Stok", "Daftar Gudang"]],
		["Pemasaran", ["Promo Ongkir", "Banner Beranda", "Segmen Pembeli", "Template Label"]],
	]],
	["warehouse", ["warehouse"], [], [
		["Ruang Kerja", ["Gudang"]],
		["Operasional", ["Pengiriman Manual", "Pusat Cetak Label", "Masalah Pengiriman", "Retur & Penggantian"]],
		["Katalog & Stok", ["Produk", "Stok Gudang", "Transfer Stok", "Daftar Gudang", "Template Label"]],
	]],
	["customer_service", ["customer_service"], ["orders.history.read"], [
		["Ruang Kerja", ["Layanan Pelanggan"]],
		["Operasional", ["Pesanan", "Masalah Pengiriman", "Retur & Penggantian", "Kotak Masuk Pelanggan", "Akun Pembeli", "Balasan & Tag CS"]],
	]],
	// Finance without finance.summary.read has no Laporan Keuangan; Produk, Afiliasi and Log Audit join their neighbours.
	["finance", ["finance"], ["orders.history.read", "finance.reconciliation.read", "finance.refunds.read", "finance.costs.read"], [
		["Ruang Kerja", ["Keuangan"]],
		["Operasional", ["Pesanan", "Masalah Pengiriman", "Retur & Penggantian", "Produk", "Afiliasi"]],
		["Keuangan", ["Pembayaran Masuk", "Setoran COD", "Rekonsiliasi", "Pembayaran Komisi", "Pengembalian Dana"]],
		["Pengaturan", ["Log Audit", "Pembayaran & Biaya COD", "Kebijakan Komersial", "Template Label"]],
	]],
	// A multi-role user sees the union; the order grant comes in through customer_service.
	["warehouse+customer_service", ["warehouse", "customer_service"], ["orders.history.read"], [
		["Ruang Kerja", ["Gudang", "Layanan Pelanggan"]],
		["Operasional", ["Pesanan", "Pengiriman Manual", "Pusat Cetak Label", "Masalah Pengiriman", "Retur & Penggantian", "Kotak Masuk Pelanggan", "Akun Pembeli"]],
		["Katalog & Stok", ["Produk", "Stok Gudang", "Transfer Stok", "Daftar Gudang"]],
		["Pengaturan", ["Template Label", "Balasan & Tag CS"]],
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

test("S128 sidebar shows exactly the items each role's grants open, grouped per spec 17", async () => {
	for (const [name, roles, permissions, expected] of EXPECTED) {
		const user = await staff(roles, permissions);
		const { page, close } = await open(user);
		try {
			await page.goto(`${origin}/admin/queue`);
			assert.deepEqual(await navGroups(page), expected, name);
			// A settings link appears only with its built page (S135/S136/S137).
			const nav = page.getByRole("navigation", { name: "Navigasi Operator" });
			const settingsLabels = ["Log Audit", "Kesehatan Sistem", "Staf & Peran", "Pembayaran & Biaya COD", "Kebijakan Komersial", "Template Label", "Integrasi Iklan", "Balasan & Tag CS"];
			const settings = expected.flatMap(([, items]) => items).filter((label) => settingsLabels.includes(label)).length;
			await expect(nav.locator('a[href^="/admin/settings"]')).toHaveCount(settings);
		} finally {
			await close();
		}
	}
});

test("S128 longest-match active item and the account menu (Lihat Toko, Keluar; account pages hidden until S129)", async () => {
	const owner = await staff(["owner"]);
	const { page, errors, close } = await open(owner);
	try {
		await page.goto(`${origin}/admin/inventory/transfers`);
		const nav = page.getByRole("navigation", { name: "Navigasi Operator" });
		await expect(nav.getByRole("link", { name: "Transfer Stok" })).toHaveAttribute("aria-current", "page");
		await expect(nav.locator('[data-slot="sidebar-menu-button"][data-active="true"]')).toHaveText(["Transfer Stok"]);
		await expect(page.getByTestId("admin-session-bar")).toHaveCount(0);

		const account = page.getByTestId("admin-account");
		await expect(account.getByText(owner.email)).toBeVisible();
		await account.getByRole("button", { name: /^Menu akun/ }).click();
		const menu = page.getByRole("menu");
		await expect(menu.getByRole("menuitem")).toHaveText(["Profil", "Keamanan akun", "Lihat Toko", "Keluar"]);
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

test("S128 signed-out local preview keeps the shell with a sign-in entry (no redirect outside production)", async () => {
	const { page, close } = await open(null);
	try {
		const response = await page.goto(`${origin}/admin/orders`);
		assert.equal(response?.status(), 200);
		assert.equal(new URL(page.url()).pathname, "/admin/orders");
		const account = page.getByTestId("admin-account");
		await expect(account.getByText("Pratinjau tanpa sesi staf.")).toBeVisible();
		await expect(account.getByRole("link", { name: "Masuk sebagai staf" })).toHaveAttribute("href", "/masuk?next=%2Fadmin");
		await expect(account.getByRole("link", { name: "Lihat Toko" })).toHaveAttribute("href", "/");
	} finally {
		await close();
	}
});

test("S128 renders at 390 touch, 768 and 1440 with no overflow and no console errors", async () => {
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
			await page.goto(`${origin}/admin/queue`);
			await expect(page.locator("main, #main").first()).toBeVisible();
			if (state) {
				await page.getByRole("button", { name: "Buka atau tutup navigasi" }).first().click();
				await expect(page.getByRole("dialog")).toBeVisible();
				await expect(page.getByTestId("admin-account")).toBeVisible();
				if (state === "account") {
					await page.getByRole("button", { name: /^Menu akun/ }).click();
					await expect(page.getByRole("menuitem", { name: "Keluar" })).toBeVisible();
				}
			}
			if (viewport.width === 768) {
				// Tablet: icon rail; the account trigger stays reachable as an icon.
				await expect(page.locator('[data-slot="sidebar"][data-collapsible="icon"]')).toHaveCount(1);
				await expect(page.getByRole("button", { name: /^Menu akun/ })).toBeVisible();
			}
			await page.waitForLoadState("networkidle");
			await page.screenshot({ path: join(renders, `${file}.png`) });
			assert.equal(await overflow(page), 0, file);
			assert.deepEqual(errors, [], file);
		} finally {
			await close();
		}
	}
});
