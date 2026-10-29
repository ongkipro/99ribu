import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect } from "@playwright/test";
import type { LocalAuth } from "../../src/modules/access/auth.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { handleFinance } from "../../src/modules/finance/routes.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S134 catalog master data against the built web on the canonical origin: SKUs and HPP/assumption versions (write only with
// finance.costs.write, read-only with finance.costs.read, absent for other roles), categories, and the warehouse list/detail with
// the pickup profile and the calendar view. Run with: npm run test:browser -- --case=catalog-master
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
type User = Awaited<ReturnType<typeof actor>>;
type Handler = (request: Request, identity: LocalAuth) => Promise<Response>;
const users: User[] = [];
const warehouses: string[] = [];
let browser: Browser;
const renders = join(RENDERS, "s134");
const run = randomUUID().slice(0, 8).toUpperCase();
const root = "/api/v1/admin";

let owner: User;
let financeRead: User;
let financeWrite: User;
let ecommerce: User;
let warehouseStaff: User;
let support: User;
let warehouseA = "";
let warehouseAName = "";
let warehouseB = "";
// Console URLs carry the entity's admin number, never its UUID.
async function adminNo(table: "commerce_order" | "product" | "warehouse", id: string) {
	const [row] = await identity.sql.unsafe(`select admin_no::int as admin_no from app.${table} where id = '${id}'`);
	return Number(row.admin_no);
}

let productId = "";
let productStockId = "";
let productStockName = "";
let year = 0;

async function staff(role: Role, warehouseIds: string[] = [], permissions: string[] = []) {
	const user = await actor(identity, role, warehouseIds);
	users.push(user);
	await enroll(user.browser, user.password);
	if (permissions.length) await identity.sql`update app.role_grant set permissions=${permissions} where user_id=${user.id}`;
	return user;
}
async function api(user: User, handler: Handler, path: string, body?: Record<string, unknown>) {
	const request = user.browser.request(path, body);
	if (body) request.headers.set("idempotency-key", randomUUID());
	const response = await handler(request, identity);
	// biome-ignore lint/suspicious/noExplicitAny: setup code reads differently shaped response bodies
	const json = (await response.json()) as Record<string, any>;
	return { status: response.status, json };
}
async function open(user: User, viewport = { width: 1440, height: 1000 }, touch = false) {
	const context = await browser.newContext({ viewport, reducedMotion: "reduce", hasTouch: touch, isMobile: touch });
	await context.addCookies([...user.browser.cookies].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("request", (request) => assert.equal(new URL(request.url()).origin, origin, "No external browser request"));
	return { page, errors, close: () => context.close() };
}
const noOverflow = async (page: Awaited<ReturnType<typeof open>>["page"]) => {
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
};

before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	mkdirSync(renders, { recursive: true });
	const insertWarehouse = async (label: string) => {
		const name = `Gudang S134 ${label} ${run}`;
		const [row] = await identity.sql`insert into app.warehouse (name,city) values (${name},'Malang') returning id,timezone`;
		warehouses.push(row.id);
		return { id: row.id as string, name, timezone: row.timezone as string };
	};
	const a = await insertWarehouse("A");
	const b = await insertWarehouse("B");
	warehouseA = a.id;
	warehouseAName = a.name;
	warehouseB = b.id;
	year = Number(new Intl.DateTimeFormat("en-US", { timeZone: a.timezone, year: "numeric" }).format(new Date()));

	owner = await staff("owner");
	financeRead = await staff("finance", [], ["finance.costs.read"]);
	financeWrite = await staff("finance", [], ["finance.costs.read", "finance.costs.write"]);
	ecommerce = await staff("ecommerce_admin", [warehouseA]);
	warehouseStaff = await staff("warehouse", [warehouseA]);
	support = await staff("customer_service");

	// A product whose only component has no cost yet, for the product-page cost sections.
	const category = await api(owner, handleCatalog, `${root}/categories`, { name: `Kategori S134 ${run}`, slug: `s134-fixture-${run.toLowerCase()}`, parent_id: null, attribute_definitions: [] });
	assert.equal(category.status, 201);
	const stock = await api(owner, handleCatalog, `${root}/stock-items`, { sku: `S134-FX-${run}`, name: `Barang S134 ${run}` });
	assert.equal(stock.status, 201);
	productStockId = stock.json.id;
	productStockName = stock.json.name;
	const product = await api(owner, handleCatalog, `${root}/products`, {
		name: `Produk S134 ${run}`,
		description: "Fixture S134",
		images: [],
		category_id: category.json.id,
		variants: [
			{
				sku: `S134-OF-${run}`,
				label: "Satuan S134",
				attributes: [],
				offer_kind: "unit",
				weight_grams: 100,
				length_mm: 100,
				width_mm: 100,
				height_mm: 100,
				default_warehouse_id: warehouseA,
				contents: [{ stock_item_id: productStockId, name: productStockName, quantity: 1 }],
			},
		],
	});
	assert.equal(product.status, 201);
	productId = product.json.id;
	// The contribution review needs an owner-configured commercial policy; keep an existing one.
	const history = await api(owner, handleAccess, `${root}/policy-versions?kind=commercial`);
	if (history.json.latest_version === 0) {
		const proof = await api(owner, handleAccess, "/api/v1/me/reauthentication-proofs", { password: owner.password, action: "company_policy.version", subject_id: "company-commercial" });
		assert.equal(proof.status, 201);
		const policy = await api(owner, handleAccess, `${root}/policy-versions`, {
			kind: "commercial",
			warehouse_id: null,
			expected_version: 0,
			effective_at: null,
			values: { default_commission_bps: 1000, minimum_payout_idr: 99000 },
			reason: "Fixture S134 baseline",
			reauthentication_proof: proof.json.proof,
		});
		assert.equal(policy.status, 201);
	}
	// A current calendar for warehouse A so the owner's calendar view has values to show.
	const proof = await api(owner, handleAccess, "/api/v1/me/reauthentication-proofs", { password: owner.password, action: "warehouse_calendar.version", subject_id: warehouseA });
	assert.equal(proof.status, 201);
	const calendar = await api(owner, handleAccess, `${root}/policy-versions`, {
		kind: "warehouse_calendar",
		warehouse_id: warehouseA,
		expected_version: 0,
		effective_at: null,
		values: { timezone: a.timezone, year, working_weekdays: [1, 2, 3, 4, 5], cutoff_local: "14:30", closed_dates: [`${year}-12-25`], source: "TEST-ONLY", approval: "test_only" },
		reason: "Fixture S134 calendar",
		reauthentication_proof: proof.json.proof,
	});
	assert.equal(calendar.status, 201);
});
after(async () => {
	try {
		await browser?.close();
	} finally {
		await cleanup(identity, users);
		if (warehouses.length) await identity.sql`update app.warehouse set active=false where id in ${identity.sql(warehouses)}`;
		await identity.sql.end();
	}
});

test("S134 owner creates a SKU, appends HPP versions, sees the domain refuse a backdated and a stale version", async () => {
	const sku = `S134-UI-${run}`;
	const view = await open(owner);
	const { page } = view;
	try {
		await page.goto(`${origin}/admin/catalog/stock-items`);
		await expect(page.getByRole("heading", { name: "SKU Fisik", level: 1 })).toBeVisible();
		await page.getByTestId("stock-item-new").click();
		const create = page.getByRole("dialog", { name: "Tambah SKU fisik" });
		await create.getByTestId("stock-item-sku").fill(sku.toLowerCase());
		await expect(create.getByTestId("stock-item-sku")).toHaveValue(sku, { timeout: 2000 });
		await create.getByTestId("stock-item-name").fill(`Barang UI ${run}`);
		await create.getByRole("button", { name: "Tambah SKU" }).click();
		await expect(page.getByTestId("stock-item-notice")).toContainText(`SKU ${sku} dibuat`);
		await expect(page.getByTestId(`stock-item-row-${sku}`)).toBeVisible();
		// The same SKU again is refused in the dialog.
		await page.getByTestId("stock-item-new").click();
		const again = page.getByRole("dialog", { name: "Tambah SKU fisik" });
		await again.getByTestId("stock-item-sku").fill(sku);
		await again.getByTestId("stock-item-name").fill("Duplikat");
		await again.getByRole("button", { name: "Tambah SKU" }).click();
		await expect(again.getByRole("alert")).toContainText("sudah dipakai");
		await again.getByRole("button", { name: "Batal" }).click();
		await page.getByRole("alertdialog", { name: "Buang perubahan?" }).getByRole("button", { name: "Buang" }).click();

		// First HPP version.
		await page.getByTestId(`stock-item-hpp-${sku}`).click();
		const panel = page.getByTestId("stock-item-hpp-dialog");
		await expect(panel.getByTestId("hpp-current")).toContainText("Belum ada versi biaya");
		await panel.getByTestId("hpp-new").click();
		const form = page.getByRole("dialog", { name: /Versi biaya baru/ });
		await form.getByTestId("hpp-unit_cost").fill("12.500");
		await form.getByTestId("hpp-source").fill("Faktur pemasok FX-1");
		await form.getByTestId("hpp-reason").fill("HPP awal");
		await form.getByRole("button", { name: "Simpan versi" }).click();
		await expect(panel.getByTestId("hpp-notice")).toContainText("Versi biaya 1");
		await expect(panel.getByTestId("hpp-row-1")).toContainText("Rp12.500");
		await expect(panel.getByTestId("hpp-current")).toContainText("Rp12.500");

		// A past effective time is refused with the domain's code and adds no version.
		await panel.getByTestId("hpp-new").click();
		const past = page.getByRole("dialog", { name: /Versi biaya baru/ });
		await past.getByTestId("hpp-unit_cost").fill("13000");
		await past.getByTestId("hpp-later").check();
		await past.getByTestId("hpp-at").fill("2020-01-01T10:00");
		await past.getByTestId("hpp-source").fill("Faktur mundur");
		await past.getByTestId("hpp-reason").fill("Uji versi mundur");
		await past.getByRole("button", { name: "Simpan versi" }).click();
		await expect(past.getByRole("alert")).toContainText("RETROACTIVE_COST_FORBIDDEN");
		await expect(past.getByRole("alert")).toContainText("tidak boleh di masa lalu");
		await past.getByRole("button", { name: "Batal" }).click();
		await page.getByRole("alertdialog", { name: "Buang perubahan?" }).getByRole("button", { name: "Buang" }).click();
		await expect(panel.getByTestId("hpp-row-2")).toHaveCount(0);

		// A version written elsewhere after this dialog opened makes the submit a conflict, not an overwrite.
		await panel.getByTestId("hpp-new").click();
		const stale = page.getByRole("dialog", { name: /Versi biaya baru/ });
		await stale.getByTestId("hpp-unit_cost").fill("14000");
		await stale.getByTestId("hpp-source").fill("Faktur lain");
		await stale.getByTestId("hpp-reason").fill("Uji versi basi");
		const [row] = await identity.sql`select id from app.stock_item where sku=${sku}`;
		const elsewhere = await api(owner, handleFinance, `${root}/stock-items/${row.id}/cost-versions`, {
			unit_cost: 12800,
			expected_version: 1,
			effective_from: null,
			source: "Penulis lain",
			reason: "Versi tersela",
		});
		assert.equal(elsewhere.status, 201);
		await stale.getByRole("button", { name: "Simpan versi" }).click();
		await expect(stale.getByRole("alert")).toContainText("VERSION_CONFLICT");
		await stale.getByRole("button", { name: "Batal" }).click();
		await page.getByRole("alertdialog", { name: "Buang perubahan?" }).getByRole("button", { name: "Buang" }).click();
		await expect(panel.getByTestId("hpp-row-2")).toContainText("Rp12.800");
		await expect(panel.getByTestId("hpp-row-3")).toHaveCount(0);
		await page.screenshot({ path: join(renders, "stock-items-owner-1440.png"), fullPage: false });
		assert.deepEqual(view.errors, []);
	} finally {
		await view.close();
	}
});

test("S134 finance writes HPP and assumptions from the product page only with the write grant", async () => {
	const writer = await open(financeWrite);
	const reader = await open(financeRead);
	try {
		await writer.page.goto(`${origin}/admin/catalog/${await adminNo("product", productId)}`);
		const costs = writer.page.locator('section[aria-labelledby="costs-heading"]');
		await expect(costs).toBeVisible();
		await writer.page.getByTestId(`hpp-${productStockId}-toggle`).click();
		await expect(writer.page.getByTestId(`hpp-${productStockId}-current`)).toContainText("Belum ada versi biaya");
		await writer.page.getByTestId(`hpp-${productStockId}-new`).click();
		const form = writer.page.getByRole("dialog", { name: /Versi biaya baru/ });
		await form.getByTestId(`hpp-${productStockId}-unit_cost`).fill("20000");
		await form.getByTestId(`hpp-${productStockId}-source`).fill("Faktur FX-2");
		await form.getByTestId(`hpp-${productStockId}-reason`).fill("HPP dari halaman produk");
		await form.getByRole("button", { name: "Simpan versi" }).click();
		await expect(writer.page.getByTestId(`hpp-${productStockId}-notice`)).toContainText("Versi biaya 1");
		// The estimate above the history refreshed in place.
		await expect(costs).toContainText("Rp20.000");

		// Assumptions: leave one field empty (unknown, not Rp0).
		const offer = await identity.sql`select o.id from app.offer o where o.product_id=${productId}`;
		const assumption = `assumption-${offer[0].id}`;
		await writer.page.getByTestId(`${assumption}-toggle`).click();
		await writer.page.getByTestId(`${assumption}-new`).click();
		const profile = writer.page.getByRole("dialog", { name: /Versi biaya baru/ });
		await profile.getByTestId(`${assumption}-packaging_idr`).fill("2000");
		await profile.getByTestId(`${assumption}-provider_fee_idr`).fill("1000");
		await profile.getByTestId(`${assumption}-subsidy_idr`).fill("5000");
		await profile.getByTestId(`${assumption}-source`).fill("Estimasi konservatif");
		await profile.getByTestId(`${assumption}-reason`).fill("Cadangan retur belum ditetapkan");
		await profile.getByRole("button", { name: "Simpan versi" }).click();
		await expect(writer.page.getByTestId(`${assumption}-notice`)).toContainText("Versi biaya 1");
		await expect(writer.page.getByTestId(`${assumption}-row-1`)).toContainText("Belum diisi");
		await expect(costs).toContainText("Data biaya belum lengkap");

		// Read-only finance sees the history and no control to add one; the API refuses a write anyway.
		await reader.page.goto(`${origin}/admin/catalog/${await adminNo("product", productId)}`);
		await expect(reader.page.locator('section[aria-labelledby="costs-heading"]')).toContainText("Rp20.000");
		await reader.page.getByTestId(`hpp-${productStockId}-toggle`).click();
		await expect(reader.page.getByTestId(`hpp-${productStockId}-row-1`)).toContainText("Rp20.000");
		await expect(reader.page.getByTestId(`hpp-${productStockId}-readonly`)).toBeVisible();
		await expect(reader.page.getByTestId(`hpp-${productStockId}-new`)).toHaveCount(0);
		const refused = await api(financeRead, handleFinance, `${root}/stock-items/${productStockId}/cost-versions`, {
			unit_cost: 1,
			expected_version: 1,
			effective_from: null,
			source: "Tanpa izin",
			reason: "Uji tulis tanpa izin",
		});
		assert.equal(refused.status, 403);
		await reader.page.screenshot({ path: join(renders, "product-costs-finance-read-1440.png"), fullPage: true });
		assert.deepEqual([...writer.errors, ...reader.errors], []);
	} finally {
		await writer.close();
		await reader.close();
	}
});

test("S134 roles without cost access see no amount and no cost control", async () => {
	const admin = await open(ecommerce);
	const denied = await open(support);
	const financeOnly = await open(financeRead);
	try {
		// Ecommerce admin: SKU list without HPP buttons, product page without the cost section.
		await admin.page.goto(`${origin}/admin/catalog/stock-items`);
		await expect(admin.page.getByTestId("stock-items-no-costs")).toBeVisible();
		await expect(admin.page.getByTestId("stock-items")).toBeVisible();
		await expect(admin.page.locator('[data-testid^="stock-item-hpp-"]')).toHaveCount(0);
		await admin.page.goto(`${origin}/admin/catalog/${await adminNo("product", productId)}`);
		await expect(admin.page.getByRole("heading", { name: `Produk S134 ${run}`, level: 1 })).toBeVisible();
		await expect(admin.page.locator('section[aria-labelledby="costs-heading"]')).toHaveCount(0);
		await expect(admin.page.getByText(/Rp20\.000|Rp12\.500/)).toHaveCount(0);
		// Customer service and finance (no SKU dictionary grant) get the denied screen.
		// A valid product number (and the old UUID link) is denied exactly like the list: no lookup, no redirect, no row.
		for (const target of [await adminNo("product", productId), productId]) {
			await denied.page.goto(`${origin}/admin/catalog/${target}`);
			await expect(denied.page.getByRole("heading", { name: "Akses katalog diperlukan" })).toBeVisible();
			await expect(denied.page.getByText(`Produk S134 ${run}`)).toHaveCount(0);
		}
		// Anyone allowed: the old UUID link redirects once to the numeric URL.
		await admin.page.goto(`${origin}/admin/catalog/${productId}`);
		await expect(admin.page).toHaveURL(`${origin}/admin/catalog/${await adminNo("product", productId)}`);
		await denied.page.goto(`${origin}/admin/catalog/stock-items`);
		await expect(denied.page.getByRole("heading", { name: "Akses katalog diperlukan" })).toBeVisible();
		await expect(denied.page.getByTestId("stock-items-page")).toHaveCount(0);
		await financeOnly.page.goto(`${origin}/admin/catalog/stock-items`);
		await expect(financeOnly.page.getByRole("heading", { name: "Akses katalog diperlukan" })).toBeVisible();
		await denied.page.goto(`${origin}/admin/catalog/categories`);
		await expect(denied.page.getByRole("heading", { name: "Akses katalog diperlukan" })).toBeVisible();
		assert.deepEqual([...admin.errors, ...denied.errors, ...financeOnly.errors], []);
	} finally {
		await admin.close();
		await denied.close();
		await financeOnly.close();
	}
});

test("S134 owner creates a category with an attribute rule; a repeated slug is refused", async () => {
	const slug = `s134-ui-${run.toLowerCase()}`;
	const view = await open(owner);
	const { page } = view;
	try {
		await page.goto(`${origin}/admin/catalog/categories`);
		await expect(page.getByRole("heading", { name: "Kategori", level: 1 })).toBeVisible();
		await page.getByTestId("category-new").click();
		const dialog = page.getByRole("dialog", { name: "Tambah kategori" });
		await dialog.getByTestId("category-name").fill(`Kategori UI ${run}`);
		await dialog.getByTestId("category-slug").fill(slug);
		await dialog.getByRole("button", { name: "Tambah atribut" }).click();
		await dialog.getByLabel("Kunci").fill("ukuran");
		await dialog.getByLabel("Label").fill("Ukuran");
		await dialog.getByLabel("Jenis nilai").selectOption("enum");
		await dialog.getByLabel("Pilihan").fill("S, M, L");
		await dialog.getByLabel("Wajib diisi produk").check();
		await dialog.getByRole("button", { name: "Tambah kategori" }).click();
		await expect(page.getByTestId("category-notice")).toContainText(`Kategori UI ${run} dibuat`);
		const row = page.getByTestId(`category-row-${slug}`);
		await expect(row).toContainText("Belum dipakai produk");
		await expect(row).toContainText("Ukuran (wajib)");
		// The same slug again: the API's conflict is shown in the dialog.
		await page.getByTestId("category-new").click();
		const again = page.getByRole("dialog", { name: "Tambah kategori" });
		await again.getByTestId("category-name").fill(`Kategori UI kembar ${run}`);
		await again.getByTestId("category-slug").fill(slug);
		await again.getByRole("button", { name: "Tambah kategori" }).click();
		await expect(again.getByRole("alert")).toContainText("Slug ini sudah dipakai");
		// Closing a changed form asks first; "Lanjut mengedit" keeps the entered values and the refusal.
		await again.getByRole("button", { name: "Batal" }).click();
		const discard = page.getByRole("alertdialog", { name: "Buang perubahan?" });
		await expect(discard.getByRole("button", { name: "Lanjut mengedit" })).toBeFocused();
		await discard.getByRole("button", { name: "Lanjut mengedit" }).click();
		await expect(again.getByTestId("category-slug")).toHaveValue(slug);
		await expect(again.getByRole("alert")).toContainText("Slug ini sudah dipakai");
		await again.getByRole("button", { name: "Batal" }).click();
		await discard.getByRole("button", { name: "Buang" }).click();
		await expect(again).toHaveCount(0);
		await page.screenshot({ path: join(renders, "categories-owner-1440.png"), fullPage: false });
		assert.deepEqual(view.errors, []);
	} finally {
		await view.close();
	}
});

test("S134 warehouse list and detail follow scope: pickup profile, calendar view, restricted roles", async () => {
	const adminView = await open(ecommerce);
	const staffView = await open(warehouseStaff);
	const ownerView = await open(owner);
	try {
		// A scoped role lists only its own warehouse.
		await adminView.page.goto(`${origin}/admin/warehouses`);
		await expect(adminView.page.getByRole("heading", { name: "Gudang", level: 1 })).toBeVisible();
		await expect(adminView.page.getByTestId(`warehouse-row-${warehouseAName}`)).toBeVisible();
		await expect(adminView.page.getByTestId("warehouses").locator("tbody tr")).toHaveCount(1);
		await adminView.page.getByRole("link", { name: warehouseAName }).first().click();
		await expect(adminView.page.getByTestId("warehouse-title")).toHaveText(warehouseAName);

		// Pickup profile: incomplete, then a saved revision shows the new values and the phone in local format.
		await expect(adminView.page.getByTestId("pickup-profile")).toContainText("Belum lengkap");
		await adminView.page.getByTestId("pickup-edit").click();
		const form = adminView.page.getByRole("dialog", { name: /Revisi profil penjemputan/ });
		await form.getByTestId("pickup-street").fill("Jl. Contoh Uji No. 12, Malang");
		await form.getByTestId("pickup-pic").fill("Budi Uji");
		await form.getByTestId("pickup-phone").fill("081234567890");
		await form.getByTestId("pickup-reason").fill("Profil awal");
		await form.getByRole("button", { name: "Simpan profil" }).click();
		await expect(adminView.page.getByTestId("pickup-notice")).toContainText("versi 1");
		await expect(adminView.page.getByTestId("pickup-values")).toContainText("Jl. Contoh Uji No. 12, Malang");
		await expect(adminView.page.getByTestId("pickup-values")).toContainText("081234567890");
		await expect(adminView.page.getByTestId("pickup-profile")).toContainText("Lengkap");
		// The calendar is the owner's: other roles get a note and no values.
		await expect(adminView.page.getByTestId("calendar-restricted")).toBeVisible();
		await expect(adminView.page.getByTestId("warehouse-calendar")).toHaveCount(0);
		// A warehouse outside the scope is "not found", with no name or data.
		await adminView.page.goto(`${origin}/admin/warehouses/${await adminNo("warehouse", warehouseB)}`);
		await expect(adminView.page.getByTestId("warehouse-missing")).toBeVisible();
		await expect(adminView.page.getByText(`Gudang S134 B ${run}`)).toHaveCount(0);

		// Warehouse staff: list and detail, but no personal pickup data and no calendar.
		await staffView.page.goto(`${origin}/admin/warehouses/${await adminNo("warehouse", warehouseA)}`);
		await expect(staffView.page.getByTestId("warehouse-title")).toHaveText(warehouseAName);
		await expect(staffView.page.getByTestId("pickup-restricted")).toBeVisible();
		await expect(staffView.page.getByText("Budi Uji")).toHaveCount(0);
		await expect(staffView.page.getByText("081234567890")).toHaveCount(0);
		await expect(staffView.page.getByTestId("calendar-restricted")).toBeVisible();

		// Owner: the calendar view shows the current version's values.
		await ownerView.page.goto(`${origin}/admin/warehouses/${await adminNo("warehouse", warehouseA)}`);
		const calendar = ownerView.page.getByTestId("warehouse-calendar");
		await expect(calendar).toContainText(`Berlaku ${year}`);
		await expect(ownerView.page.getByTestId("calendar-values")).toContainText("Senin, Selasa, Rabu, Kamis, Jumat");
		await expect(ownerView.page.getByTestId("calendar-values")).toContainText("14:30");
		await expect(ownerView.page.getByTestId("calendar-values")).toContainText(`25 Des ${year}`);
		await expect(ownerView.page.getByTestId("pickup-values")).toContainText("Budi Uji");
		await ownerView.page.screenshot({ path: join(renders, "warehouse-detail-owner-1440.png"), fullPage: true });
		assert.deepEqual([...adminView.errors, ...staffView.errors, ...ownerView.errors], []);
	} finally {
		await adminView.close();
		await staffView.close();
		await ownerView.close();
	}
});

for (const [name, viewport, touch] of [
	["390", { width: 390, height: 844 }, true],
	["768", { width: 768, height: 1024 }, false],
] as const) {
	test(`S134 master-data screens at ${name}px: no horizontal overflow`, async () => {
		const view = await open(owner, viewport, touch);
		const { page } = view;
		try {
			await page.goto(`${origin}/admin/catalog/stock-items`);
			await expect(page.getByTestId("stock-items")).toBeVisible();
			await noOverflow(page);
			await page.locator('[data-testid^="stock-item-hpp-"]').first().click();
			await expect(page.getByTestId("stock-item-hpp-dialog").getByTestId("hpp-current")).toBeVisible();
			await noOverflow(page);
			await page.screenshot({ path: join(renders, `stock-items-hpp-${name}.png`), fullPage: false });
			await page.keyboard.press("Escape");
			await page.goto(`${origin}/admin/catalog/categories`);
			await expect(page.getByTestId("categories")).toBeVisible();
			await noOverflow(page);
			await page.screenshot({ path: join(renders, `categories-${name}.png`), fullPage: false });
			await page.goto(`${origin}/admin/warehouses/${await adminNo("warehouse", warehouseA)}`);
			await expect(page.getByTestId("warehouse-calendar")).toBeVisible();
			await noOverflow(page);
			await page.screenshot({ path: join(renders, `warehouse-detail-${name}.png`), fullPage: true });
			assert.deepEqual(view.errors, []);
		} finally {
			await view.close();
		}
	});
}
