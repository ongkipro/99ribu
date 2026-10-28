import assert from "node:assert/strict";
import test from "node:test";
import { type Browser, chromium, expect, type Page, type Request as PwRequest } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";

// S102 ops screens against the built web on the canonical origin: Stok Gudang (movement dialog,
// conflict copy, phone bottom sheet), Transfer Stok, Promo Ongkir (create body in WIB), the DEC-013
// claim filter on the catalog and the product content edit (photo order by buttons, alt text).
// Reads are real; every mutation is intercepted and answered here, so no business state changes.
// Only the synthetic staff users are written and removed again.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
const sql = identity.sql;
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
let browser: Browser;

async function staff(role: Role, warehouses: string[] = []) {
	const user = await actor(identity, role, warehouses);
	users.push(user);
	await enroll(user.browser, user.password);
	return user;
}
async function open(user: User, viewport = { width: 1440, height: 900 }, touch = false) {
	const context = await browser.newContext({ viewport, reducedMotion: "reduce", hasTouch: touch, isMobile: touch, timezoneId: "Asia/Jakarta" });
	await context.addCookies([...user.browser.cookies].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errors.push(m.text()));
	return { page, errors, close: () => context.close() };
}
/** Answers every non-GET request with `answer` and records it. */
async function mockMutations(page: Page, answer: (request: PwRequest) => { status: number; body: unknown }) {
	const seen: PwRequest[] = [];
	await page.route(
		(url) => url.origin === origin,
		async (route) => {
			const request = route.request();
			if (request.method() === "GET") return route.fallback();
			seen.push(request);
			const { status, body } = answer(request);
			await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
		},
	);
	return seen;
}
const problem = (status: number, code: string) => ({ status, body: { type: "about:blank", title: code, status, code } });
const noOverflow = async (page: Page) =>
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, "no horizontal page scroll");

test.before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
});
test.after(async () => {
	await browser?.close();
	await cleanup(identity, users);
	await sql.end({ timeout: 5 });
});

test("Stok Gudang: search, reasoned movement on the row version, conflict copy, history; phone dialog is a bottom sheet", { timeout: 120000 }, async () => {
	const [row] = await sql`select b.id,b.revision,s.sku,s.name from app.inventory_balance b join app.stock_item s on s.id=b.stock_item_id
		join app.warehouse w on w.id=b.warehouse_id where w.active and b.on_hand>0 and b.lot_id is null
		and (select count(*) from app.inventory_balance x where x.stock_item_id=b.stock_item_id)=1 order by b.id limit 1`;
	assert.ok(row, "the local catalog stock is loaded (npm run catalog:initial-stock -- local)");
	const owner = await staff("owner");
	const { page, errors, close } = await open(owner);
	try {
		let answer = { status: 201, body: { id: "00000000-0000-4000-8000-000000000001" } as unknown };
		const posts = await mockMutations(page, () => answer);
		await page.goto(`${origin}/admin/inventory`);
		await expect(page.getByRole("heading", { name: "Stok Gudang" })).toBeVisible();
		await page.getByLabel("Cari barang").fill(row.sku);
		const item = page.getByTestId(`inventory-row-${row.sku}`);
		await expect(item).toBeVisible();
		await expect(item).toContainText(row.name);
		await page.getByTestId(`inventory-move-${row.sku}`).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Jenis pergerakan").selectOption("adjust_down");
		await dialog.getByLabel("Jumlah (satuan)").fill("1");
		await expect(dialog.getByText(/Fisik \d+ → \d+/)).toBeVisible();
		await dialog.getByRole("button", { name: "Simpan pergerakan" }).click();
		await expect(dialog.getByRole("alert")).toHaveText("Alasan wajib diisi.");
		assert.equal(posts.length, 0, "client validation sends nothing");
		await dialog.getByLabel("Alasan").fill("Hitung ulang rak B");
		answer = problem(409, "VERSION_CONFLICT");
		await dialog.getByRole("button", { name: "Simpan pergerakan" }).click();
		await expect(dialog.getByRole("alert")).toContainText("Data sudah berubah");
		const conflictKey = posts[0].headers()["idempotency-key"];
		answer = { status: 201, body: { id: "00000000-0000-4000-8000-000000000001" } };
		await dialog.getByRole("button", { name: "Simpan pergerakan" }).click();
		await expect(page.getByRole("status").filter({ hasText: "Koreksi kurang 1" })).toBeVisible();
		const body = posts[1].postDataJSON();
		assert.equal(posts[1].url(), `${origin}/api/v1/admin/inventory/movements`);
		assert.deepEqual({ kind: body.kind, quantity: body.quantity, expected_version: body.expected_version, reason: body.reason, lot_id: body.lot_id },
			{ kind: "adjust_down", quantity: 1, expected_version: Number(row.revision), reason: "Hitung ulang rak B", lot_id: null });
		assert.notEqual(posts[1].headers()["idempotency-key"], conflictKey, "a refused attempt rotates the key");
		await page.getByTestId(`inventory-row-${row.sku}`).getByRole("button", { name: "Riwayat" }).click();
		await expect(page.getByRole("dialog").getByTestId("inventory-history")).toBeVisible();
		await noOverflow(page);
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
	const phone = await open(owner, { width: 390, height: 844 }, true);
	try {
		await phone.page.goto(`${origin}/admin/inventory?`);
		await phone.page.getByLabel("Cari barang").fill(row.sku);
		await phone.page.getByTestId(`inventory-move-${row.sku}`).click();
		const dialog = phone.page.getByRole("dialog");
		// Measure after the open animation (zoom/slide-in) settles, not mid-flight.
		await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
		const box = await dialog.boundingBox();
		assert.ok(box && Math.round(box.y + box.height) >= 843 && box.width >= 389, "bottom sheet on phones");
		await noOverflow(phone.page);
	} finally {
		await phone.close();
	}
});

test("Transfer Stok and Promo Ongkir: roles, filters and a WIB promotion body", { timeout: 120000 }, async () => {
	const [warehouse] = await sql`select id from app.warehouse where active order by id limit 1`;
	const keeper = await staff("warehouse", [warehouse.id]);
	const k = await open(keeper);
	try {
		await k.page.goto(`${origin}/admin/inventory`);
		await expect(k.page.getByRole("heading", { name: "Stok Gudang" })).toBeVisible();
		await expect(k.page.getByTestId("inventory-receive-new")).toHaveCount(0);
		await k.page.getByRole("link", { name: "Buka Transfer Stok" }).click();
		await expect(k.page.getByRole("heading", { name: "Transfer Stok" })).toBeVisible();
		await k.page.getByTestId("transfers-filter-all").click();
		await expect(k.page.getByTestId("transfers-filter-all")).toHaveAttribute("aria-pressed", "true");
		await k.page.goto(`${origin}/admin/promotions/shipping`);
		await expect(k.page.getByRole("heading", { name: "Akses promo diperlukan" })).toBeVisible();
		assert.deepEqual(k.errors, []);
	} finally {
		await k.close();
	}
	const admin = await staff("ecommerce_admin", [warehouse.id]);
	const a = await open(admin);
	try {
		const posts = await mockMutations(a.page, (request) => ({ status: 201, body: { ...request.postDataJSON(), id: "00000000-0000-4000-8000-000000000002", version: 1 } }));
		await a.page.goto(`${origin}/admin/promotions/shipping`);
		await a.page.getByTestId("promotion-create").click();
		const dialog = a.page.getByRole("dialog");
		await dialog.getByLabel("Nama promo").fill("Gratis ongkir uji");
		await dialog.getByLabel("Mulai (WIB)").fill("2030-01-01T08:00");
		await dialog.getByLabel("Selesai (WIB)").fill("2030-01-31T23:59");
		await dialog.getByLabel("Potongan per pesanan (Rp)").fill("10000");
		await dialog.getByLabel("Anggaran total (Rp)").fill("500000");
		await dialog.getByLabel("Alasan").fill("Promo awal tahun");
		await dialog.getByRole("button", { name: "Buat promo" }).click();
		await expect(a.page.getByRole("status").filter({ hasText: "Promo Gratis ongkir uji dibuat." })).toBeVisible();
		const body = posts[0].postDataJSON();
		assert.equal(posts[0].url(), `${origin}/api/v1/admin/shipping-promotions`);
		assert.deepEqual({ starts_at: body.starts_at, ends_at: body.ends_at, value: body.value, maximum_per_order: body.maximum_per_order, expected_version: body.expected_version, payment_methods: body.payment_methods },
			{ starts_at: "2030-01-01T01:00:00.000Z", ends_at: "2030-01-31T16:59:00.000Z", value: 10000, maximum_per_order: 10000, expected_version: 0, payment_methods: ["cod", "prepaid"] });
		await noOverflow(a.page);
		assert.deepEqual(a.errors, []);
	} finally {
		await a.close();
	}
});

test("Katalog: DEC-013 claim filter, read-only Google category and content edit with button photo reorder", { timeout: 120000 }, async () => {
	const [product] = await sql`select p.id,p.revision,r.images from app.product p join app.product_revision r on r.product_id=p.id and r.revision=p.revision
		where jsonb_array_length(r.images)>=2 order by p.id limit 1`;
	assert.ok(product, "a product with two photos exists in the local catalog");
	const owner = await staff("owner");
	const { page, errors, close } = await open(owner);
	try {
		const lists: string[] = [];
		page.on("request", (r) => r.url().includes("/api/v1/admin/products?") && lists.push(r.url()));
		await page.goto(`${origin}/admin/catalog?tinjauan=klaim`);
		await expect(page.getByLabel("Tinjauan konten")).toHaveValue("klaim");
		await expect.poll(() => lists.some((u) => new URL(u).searchParams.get("review") === "claim")).toBe(true);
		const badges = page.getByTestId("claim-review-badge");
		if (await page.getByText("Tidak ada produk yang cocok").count()) assert.equal(await badges.count(), 0);
		else await expect(badges.first()).toBeVisible();

		const patches = await mockMutations(page, () => ({ status: 200, body: { version: Number(product.revision) + 1 } }));
		await page.goto(`${origin}/admin/catalog/${(await sql`select admin_no::int as n from app.product where id = ${product.id}`)[0].n}`);
		await expect(page.getByTestId("google-category")).toBeVisible();
		await page.getByTestId("content-edit").click();
		const dialog = page.getByRole("dialog");
		await dialog.getByRole("button", { name: "Pindahkan foto 2 ke atas" }).click();
		// Focus follows the moved photo, so the keyboard can keep moving it.
		await expect(dialog.getByRole("button", { name: "Pindahkan foto 1 ke bawah" })).toBeFocused();
		await dialog.getByLabel("Foto 1 (sampul): teks alternatif").fill("Sampul baru");
		await dialog.getByLabel("Alasan").fill("Urutkan sampul");
		await dialog.getByRole("button", { name: "Simpan draf" }).click();
		await expect(page.getByRole("status").filter({ hasText: "Konten disimpan sebagai draf versi" })).toBeVisible();
		const body = patches[0].postDataJSON();
		assert.equal(patches[0].method(), "PATCH");
		const images = product.images as { url: string; alt: string }[];
		assert.deepEqual(body.images.map((i: { url: string }) => i.url), [images[1].url, images[0].url, ...images.slice(2).map((i) => i.url)]);
		assert.equal(body.images[0].alt, "Sampul baru");
		assert.deepEqual([body.expected_version, body.reason, "name" in body, "description" in body], [Number(product.revision), "Urutkan sampul", false, false], "only changed fields are sent");
		await noOverflow(page);
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});
