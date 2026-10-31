import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect, type Route } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S-P1 Tambah Produk against the built web. Every catalog write is answered from fixtures (route interception), so
// nothing is stored. Proves the retry contract: a refused product step keeps the created stock items (not sent again),
// locks the product name and variant labels so offer contents keep matching the stored SKU name, and retries the
// product with a fresh idempotency key; a 300 px minimum is checked before upload.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
let browser: Browser;
const renders = join(RENDERS, "s-p1");
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	mkdirSync(renders, { recursive: true });
	const owner = await actor(identity, "ecommerce_admin", []);
	users.push(owner);
	await enroll(owner.browser, owner.password);
});
after(async () => {
	try {
		await browser?.close();
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

// A real PNG of the given size, made in the page (so the browser's own canvas encodes the WebP).
async function png(page: import("@playwright/test").Page, size: number) {
	const data = await page.evaluate(async (edge) => {
		const canvas = document.createElement("canvas");
		canvas.width = edge;
		canvas.height = edge;
		const context = canvas.getContext("2d") as CanvasRenderingContext2D;
		context.fillStyle = "#6b3fa0";
		context.fillRect(0, 0, edge, edge);
		return canvas.toDataURL("image/png").split(",")[1];
	}, size);
	return { name: `foto-${size}.png`, mimeType: "image/png", buffer: Buffer.from(data, "base64") };
}

test("S-P1 a refused product step keeps the stock items, locks name and labels, and retries with a fresh key", async () => {
	for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
		const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
		await context.addCookies([...users[0].browser.cookies].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
		const page = await context.newPage();
		page.setDefaultTimeout(15000);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(String(error)));
		const writes: { path: string; key: string; body: unknown }[] = [];
		let productAttempts = 0;
		await page.route(`${origin}/api/v1/admin/**`, async (route) => {
			const request = route.request();
			const path = new URL(request.url()).pathname;
			if (request.method() === "GET" && path.endsWith("/categories")) return json(route, { data: [{ id: "c1", name: "Dapur", depth: 0 }], pagination: { next_cursor: null } });
			if (request.method() === "GET" && path.endsWith("/warehouses")) return json(route, { data: [{ id: "w1", name: "Gudang Kediri", city: "Kediri", district: null }], pagination: { next_cursor: null } });
			if (request.method() !== "POST") return route.continue();
			const key = request.headers()["idempotency-key"] ?? "";
			if (path.endsWith("/product-photos")) return json(route, { sha256: "a".repeat(64), width: 800, height: 800, byte_size: 1000, url: `${origin}/media/catalog/aaaaaaaaaaaa.webp` }, 201);
			const body = request.postDataJSON();
			writes.push({ path, key, body });
			if (path.endsWith("/stock-items")) return json(route, { id: `s-${writes.length}` }, 201);
			if (path.endsWith("/products")) {
				productAttempts++;
				if (productAttempts === 1) return json(route, { type: "about:blank", title: "Forbidden", status: 403, code: "INVALID_WAREHOUSE_SCOPE" }, 403);
				return json(route, { id: "p1", variants: body.variants.map((v: { sku: string }, i: number) => ({ id: `o${i}`, sku: v.sku })) }, 201);
			}
			return json(route, {}, 201);
		});
		await page.route(`${origin}/admin/produk/p1`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Produk</h1>" }));
		await page.goto(`${origin}/admin/produk/baru`);
		await expect(page.getByRole("heading", { name: "Tambah Produk", level: 1 })).toBeVisible();

		// The 300 px minimum is checked in the browser, before any upload.
		await page.getByTestId("product-photo-input").setInputFiles(await png(page, 200));
		await expect(page.getByText("Foto terlalu kecil; sisi terpendek minimal 300 px.")).toBeVisible();
		await page.getByTestId("product-photo-input").setInputFiles(await png(page, 800));
		await expect(page.getByTestId("product-photos").locator("li")).toHaveCount(1);
		await page.getByTestId("product-photo-input").setInputFiles(await png(page, 800));
		await expect(page.getByTestId("product-photos").locator("li")).toHaveCount(1);

		await page.getByTestId("product-name").fill("Set Wadah Bumbu");
		await page.getByTestId("product-category").selectOption("c1");
		await page.getByTestId("product-variant-add").click();
		await page.locator("#variant-label-0").fill("Hitam");
		await page.locator("#variant-label-1").fill("Putih");
		for (const i of [0, 1]) {
			await page.locator(`#variant-weight-${i}`).fill("700");
			await page.locator(`#variant-warehouse-${i}`).selectOption("w1");
		}
		await page.screenshot({ path: join(renders, `tambah-produk-${viewport.width}.png`), fullPage: true });
		await page.getByTestId("product-create-submit").click();
		await expect(page.getByTestId("product-create-error")).toContainText("Gudang tidak aktif");
		await expect(page.getByTestId("product-create-error")).toBeFocused();
		await expect(page.getByTestId("product-name")).toBeDisabled();
		await expect(page.locator("#variant-label-0")).toBeDisabled();
		await expect(page.getByTestId("product-variant-add")).toBeDisabled();
		await expect(page.locator("#variant-weight-0")).toBeEnabled();
		await page.screenshot({ path: join(renders, `tambah-produk-refused-${viewport.width}.png`), fullPage: true });

		await page.getByTestId("product-create-submit").click();
		await page.waitForURL(`${origin}/admin/produk/p1`);
		const stock = writes.filter((w) => w.path.endsWith("/stock-items"));
		const products = writes.filter((w) => w.path.endsWith("/products"));
		assert.equal(stock.length, 2, "stock items are created once");
		assert.equal(products.length, 2);
		assert.notEqual(products[0].key, products[1].key, "a refused product step gets a fresh key");
		const skus = stock.map((w) => (w.body as { sku: string }).sku);
		assert.match(skus[0], /^[A-Z0-9_-]+-1$/);
		assert.match(skus[1], /^[A-Z0-9_-]+-2$/);
		const variants = (products[1].body as { variants: { sku: string; contents: { stock_item_id: string; name: string }[] }[] }).variants;
		assert.deepEqual(variants.map((v) => v.sku), skus.map((s) => `${s}_OFFER`));
		assert.deepEqual(variants.map((v) => v.contents[0].name), ["Set Wadah Bumbu - Hitam", "Set Wadah Bumbu - Putih"]);
		assert.deepEqual(errors, []);
		await context.close();
	}
});

test("S-P1 a lost product response locks the product fields and retries with the same key", async () => {
	const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
	await context.addCookies([...users[0].browser.cookies].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const productKeys: string[] = [];
	await page.route(`${origin}/api/v1/admin/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (request.method() === "GET" && path.endsWith("/categories")) return json(route, { data: [{ id: "c1", name: "Dapur", depth: 0 }], pagination: { next_cursor: null } });
		if (request.method() === "GET" && path.endsWith("/warehouses")) return json(route, { data: [{ id: "w1", name: "Gudang Kediri", city: "Kediri", district: null }], pagination: { next_cursor: null } });
		if (path.endsWith("/product-photos")) return json(route, { sha256: "b".repeat(64), width: 800, height: 800, byte_size: 1000, url: `${origin}/media/catalog/bbbbbbbbbbbb.webp` }, 201);
		if (path.endsWith("/stock-items")) return json(route, { id: "s1" }, 201);
		if (path.endsWith("/products")) {
			productKeys.push(request.headers()["idempotency-key"] ?? "");
			if (productKeys.length === 1) return route.abort("connectionreset");
			return json(route, { id: "p2", variants: request.postDataJSON().variants.map((v: { sku: string }, i: number) => ({ id: `o${i}`, sku: v.sku })) }, 201);
		}
		return json(route, {}, 201);
	});
	await page.route(`${origin}/admin/produk/p2`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Produk</h1>" }));
	try {
		await page.goto(`${origin}/admin/produk/baru`);
		await page.getByTestId("product-photo-input").setInputFiles(await png(page, 800));
		await expect(page.getByTestId("product-photos").locator("li")).toHaveCount(1);
		await page.getByTestId("product-name").fill("Gelas Kaca");
		await page.getByTestId("product-category").selectOption("c1");
		await page.locator("#variant-weight-0").fill("500");
		await page.locator("#variant-warehouse-0").selectOption("w1");
		await page.getByTestId("product-create-submit").click();
		await expect(page.getByTestId("product-create-error")).toContainText("Koneksi terputus");
		for (const id of ["product-name", "product-category", "product-description"]) await expect(page.getByTestId(id)).toBeDisabled();
		await expect(page.locator("#variant-weight-0")).toBeDisabled();
		await page.getByTestId("product-create-submit").click();
		await page.waitForURL(`${origin}/admin/produk/p2`);
		assert.equal(productKeys.length, 2);
		assert.equal(productKeys[0], productKeys[1], "a lost response keeps the key, so the server replays");
	} finally {
		await context.close();
	}
});

test("S-P1 a refused HPP after the product exists links to the draft and can be cleared to finish", async () => {
	const owner = await actor(identity, "owner", []);
	users.push(owner);
	await enroll(owner.browser, owner.password);
	const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
	await context.addCookies([...owner.browser.cookies].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const costs: string[] = [];
	await page.route(`${origin}/api/v1/admin/**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (request.method() === "GET" && path.endsWith("/categories")) return json(route, { data: [{ id: "c1", name: "Dapur", depth: 0 }], pagination: { next_cursor: null } });
		if (request.method() === "GET" && path.endsWith("/warehouses")) return json(route, { data: [{ id: "w1", name: "Gudang Kediri", city: "Kediri", district: null }], pagination: { next_cursor: null } });
		if (path.endsWith("/product-photos")) return json(route, { sha256: "c".repeat(64), width: 800, height: 800, byte_size: 1000, url: `${origin}/media/catalog/cccccccccccc.webp` }, 201);
		if (path.endsWith("/stock-items")) return json(route, { id: "s1" }, 201);
		if (path.endsWith("/products")) return json(route, { id: "p3", variants: request.postDataJSON().variants.map((v: { sku: string }, i: number) => ({ id: `o${i}`, sku: v.sku })) }, 201);
		if (path.endsWith("/cost-versions")) {
			costs.push("hpp");
			return json(route, { type: "about:blank", title: "Forbidden", status: 403, code: "FORBIDDEN" }, 403);
		}
		if (path.endsWith("/cost-assumption-versions")) {
			costs.push("assumption");
			return json(route, {}, 201);
		}
		return json(route, {}, 201);
	});
	await page.route(`${origin}/admin/produk/p3`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Produk</h1>" }));
	try {
		await page.goto(`${origin}/admin/produk/baru`);
		await page.getByTestId("product-photo-input").setInputFiles(await png(page, 800));
		await expect(page.getByTestId("product-photos").locator("li")).toHaveCount(1);
		await page.getByTestId("product-name").fill("Talenan Kayu");
		await page.getByTestId("product-category").selectOption("c1");
		await page.locator("#variant-weight-0").fill("600");
		await page.locator("#variant-warehouse-0").selectOption("w1");
		await page.locator("#variant-hpp-0").fill("45000");
		await page.getByTestId("product-create-submit").click();
		const error = page.getByTestId("product-create-error");
		await expect(error).toBeVisible();
		await expect(error.getByRole("link", { name: "Buka draf produk" })).toHaveAttribute("href", "/admin/produk/p3");
		await expect(page.locator("#variant-hpp-0")).toBeEnabled();
		await expect(page.getByTestId("product-name")).toBeDisabled();
		await page.screenshot({ path: join(renders, "tambah-produk-cost-refused-390.png"), fullPage: true });
		await page.locator("#variant-hpp-0").fill("");
		await page.getByTestId("product-create-submit").click();
		await page.waitForURL(`${origin}/admin/produk/p3`);
		assert.deepEqual(costs, ["hpp", "assumption"]);
	} finally {
		await context.close();
	}
});
