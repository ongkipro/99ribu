import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect } from "@playwright/test";
import { RENDERS } from "../render-root.ts";

// Phone dock (owner 2026-10-28): five icon-only tabs, Beranda, Kategori, Cari (raised, the primary action),
// Keranjang, Akun. Cari opens a full-screen search sheet (a native modal dialog) and is a real /cari link without
// JavaScript. Read-only against the built storefront on 127.0.0.1:3099; no data is written.
const origin = "http://127.0.0.1:3099";
const renders = join(RENDERS, "dock");
let browser: Browser;

before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	mkdirSync(renders, { recursive: true });
});
after(async () => {
	await browser?.close();
});

async function phone(width = 390, height = 844, javaScriptEnabled = true) {
	const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, javaScriptEnabled, reducedMotion: "reduce" });
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("request", (request) => assert.equal(new URL(request.url()).origin, origin, "No external browser request"));
	return { page, errors, close: () => context.close() };
}

test("five labelled tabs in order, Cari raised and prominent, current page marked", async () => {
	const { page, errors, close } = await phone();
	try {
		await page.goto(`${origin}/`);
		const dock = page.getByRole("navigation", { name: "Navigasi belanja" });
		await expect(dock).toBeVisible();
		assert.deepEqual(await dock.getByRole("link").evaluateAll((links) => links.map((a) => a.textContent?.trim())), ["Beranda", "Kategori", "Cari", "Keranjang", "Akun"], "accessible names, in order");
		// Icon-only: no label is visible (each one is clipped to a 1px box), and the active tab is a rounded pill.
		assert.ok(await dock.locator(".tab-label").evaluateAll((labels) => labels.every((l) => l.getBoundingClientRect().width <= 1)), "labels are visually hidden");
		const pill = dock.getByRole("link", { name: "Beranda", exact: true }).locator(".tab-icon");
		assert.equal(await pill.evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(237, 231, 253)");
		assert.ok(parseFloat(await pill.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)) >= 22, "the active pill is fully rounded");
		assert.equal(await dock.getByRole("link", { name: "Kategori", exact: true }).locator(".tab-icon").evaluate((el) => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)", "inactive tabs have no pill");
		await expect(dock.getByRole("link", { name: "Beranda", exact: true })).toHaveAttribute("aria-current", "page");
		const bar = await dock.boundingBox();
		assert.ok(bar);
		// The bar sits on the bottom edge, 64px plus the safe area, and every tab is a 44px target inside it.
		assert.ok(Math.abs(bar.y + bar.height - 844) <= 1 && bar.height >= 64, `dock geometry ${JSON.stringify(bar)}`);
		for (const link of await dock.getByRole("link").all()) {
			const box = await link.boundingBox();
			assert.ok(box && box.width >= 44 && box.height >= 44 && box.y >= bar.y - 1 && box.y + box.height <= bar.y + bar.height + 1);
		}
		// Cari is the one filled, raised disc: it rises above the bar and is purple with a white icon.
		const fab = dock.locator(".tab-fab");
		const disc = await fab.boundingBox();
		assert.ok(disc);
		assert.ok(disc.y < bar.y - 6, "the Cari disc rises above the bar");
		assert.ok(disc.width >= 48 && Math.abs(disc.width - disc.height) <= 1, "the Cari disc is a circle of at least 48px");
		assert.equal(await fab.evaluate((el) => getComputedStyle(el).backgroundColor), "rgb(91, 53, 213)");
		// Active tabs show the filled icon; inactive ones the outline.
		assert.equal(await dock.getByRole("link", { name: "Beranda", exact: true }).locator(".tab-filled").evaluate((el) => getComputedStyle(el).display), "grid");
		assert.equal(await dock.getByRole("link", { name: "Kategori", exact: true }).locator(".tab-filled").evaluate((el) => getComputedStyle(el).display), "none");
		await page.goto(`${origin}/kategori`);
		await expect(dock.getByRole("link", { name: "Kategori", exact: true })).toHaveAttribute("aria-current", "page");
		await page.goto(`${origin}/cari?q=a`);
		await expect(dock.getByRole("link", { name: "Cari", exact: true })).toHaveAttribute("aria-current", "page");
		await page.screenshot({ path: join(renders, "dock-cari-active-390.png"), clip: { x: 0, y: 844 - 150, width: 390, height: 150 } });
		// A category listing on /cari (?category_id=) marks Kategori, never Cari as well.
		await page.goto(`${origin}/cari`);
		const listing = await page.locator('a[href*="category_id="]').first().getAttribute("href");
		assert.ok(listing, "the search page offers a category filter link");
		await page.goto(`${origin}${listing}`);
		await expect(page).toHaveURL(/category_id=/);
		await expect(dock.getByRole("link", { name: "Kategori", exact: true })).toHaveAttribute("aria-current", "page");
		await expect(dock.getByRole("link", { name: "Cari", exact: true })).not.toHaveAttribute("aria-current", "page");
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("Cari opens the search sheet: focus, suggestions, departments, Esc and Batal return to the page", async () => {
	const { page, errors, close } = await phone();
	try {
		await page.goto(`${origin}/`);
		const trigger = page.getByRole("navigation", { name: "Navigasi belanja" }).getByRole("link", { name: "Cari", exact: true });
		await trigger.tap();
		const sheet = page.getByRole("dialog", { name: "Cari produk" });
		await expect(sheet).toBeVisible();
		const field = sheet.getByRole("searchbox", { name: "Cari produk" });
		await expect(field).toBeFocused();
		assert.ok(new URL(page.url()).pathname === "/", "opening the sheet does not navigate");
		// Suggestions come from the catalog and every row is a real link; departments are links too.
		const firstSuggestion = sheet.getByRole("region", { name: "Saran pencarian" }).getByRole("link").first();
		await expect(firstSuggestion).toHaveAttribute("href", /^\/cari\?q=/);
		const departments = sheet.getByRole("region", { name: "Kategori" }).getByRole("link");
		await expect(departments.first()).toHaveText("Semua kategori");
		await expect(departments.first()).toHaveAttribute("href", "/kategori");
		await expect(departments.nth(1)).toHaveAttribute("href", /^\/kategori\//);
		await page.screenshot({ path: join(renders, "sheet-390.png") });
		// Typing adds an exact-search row and a clear button; the clear button empties the field and keeps focus.
		await field.fill("pa");
		await expect(sheet.getByRole("link", { name: "Cari “pa”" })).toHaveAttribute("href", "/cari?q=pa");
		await sheet.getByRole("button", { name: "Hapus pencarian" }).tap();
		await expect(field).toHaveValue("");
		await expect(field).toBeFocused();
		// Esc closes it and hands focus back to the trigger; Batal does the same.
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();
		await expect(trigger).toBeFocused();
		await trigger.tap();
		await expect(sheet).toBeVisible();
		await sheet.getByRole("button", { name: "Batal" }).tap();
		await expect(sheet).toBeHidden();
		// Submitting a query goes to the real search page and leaves no sheet behind.
		await trigger.tap();
		await sheet.getByRole("searchbox", { name: "Cari produk" }).fill("kaos");
		await sheet.getByRole("searchbox", { name: "Cari produk" }).press("Enter");
		await expect(page).toHaveURL(`${origin}/cari?q=kaos`);
		await expect(page.getByRole("dialog")).toHaveCount(0);
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("without JavaScript Cari is the /cari link", async () => {
	const { page, close } = await phone(390, 844, false);
	try {
		await page.goto(`${origin}/kategori`);
		const trigger = page.getByRole("navigation", { name: "Navigasi belanja" }).getByRole("link", { name: "Cari", exact: true });
		await expect(trigger).toHaveAttribute("href", "/cari");
		await trigger.click();
		await expect(page).toHaveURL(`${origin}/cari`);
		await expect(page.getByRole("combobox", { name: "Cari produk" })).toBeVisible();
	} finally {
		await close();
	}
});

test("small phones and enlarged text: no horizontal overflow, targets stay 44px, names survive", async () => {
	for (const [width, height, scale] of [[320, 640, "200%"], [360, 740, "100%"], [412, 915, "130%"]] as const) {
		const { page, close } = await phone(width, height);
		try {
			await page.goto(`${origin}/`);
			await page.evaluate((size) => {
				document.documentElement.style.fontSize = size;
			}, scale);
			const dock = page.getByRole("navigation", { name: "Navigasi belanja" });
			// A 640px-high screen at 200% text is a short screen: the dock turns static there (existing rule), so scroll to it.
			await dock.scrollIntoViewIfNeeded();
			await expect(dock).toBeVisible();
			assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1, `overflow at ${width}`);
			for (const name of ["Beranda", "Kategori", "Cari", "Keranjang", "Akun"]) {
				const link = dock.getByRole("link", { name, exact: true });
				await expect(link).toHaveCount(1);
				const box = await link.boundingBox();
				assert.ok(box && box.width >= 44 && box.height >= 44, `${name} target at ${width}`);
			}
			// No visible text at any size, and the five columns stay inside the bar.
			assert.ok(await dock.locator(".tab-label").evaluateAll((labels) => labels.every((l) => l.getBoundingClientRect().width <= 1)), `labels visible at ${width}`);
		} finally {
			await close();
		}
	}
});

test("desktop keeps its header: no dock, and the 99rb wordmark still grows into Serba 99ribu on hover", async () => {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const page = await context.newPage();
	try {
		await page.goto(`${origin}/`);
		await expect(page.locator(".shopping-tabs")).toBeHidden();
		const brand = page.locator("a.brand-reveal").first();
		const before = (await brand.boundingBox())?.width ?? 0;
		await brand.hover();
		await expect.poll(async () => (await brand.boundingBox())?.width ?? 0, { timeout: 5000 }).toBeGreaterThan(before + 80);
		assert.equal(await brand.evaluate((el) => el.textContent?.replace(/\u00a0/g, " ")), "Serba 99ribu.");
		await page.mouse.move(700, 700);
		await expect.poll(async () => Math.round((await brand.boundingBox())?.width ?? 0), { timeout: 5000 }).toBe(Math.round(before));
	} finally {
		await context.close();
	}
});

test("on the product page the dock hides while the sticky Tambah ke keranjang bar is up, and returns without it", async () => {
	const { page, errors, close } = await phone();
	try {
		await page.goto(`${origin}/`);
		const product = await page.evaluate(() => document.querySelector('a[href^="/produk/"]')?.getAttribute("href"));
		assert.ok(product, "the storefront has a published product");
		await page.goto(`${origin}${product}`);
		const dock = page.getByRole("navigation", { name: "Navigasi belanja" });
		const bar = page.locator("main.product-detail .buy-bar:not([hidden])");
		// At the top the in-page buy button is on screen: no sticky bar, the dock shows.
		await expect(bar).toHaveCount(0);
		await expect(dock).toBeVisible();
		// Scrolled past the buy button the bar appears on the bottom edge and the dock steps aside.
		await page.evaluate(() => window.scrollTo(0, 900));
		await expect(bar).toBeVisible();
		await expect(dock).toBeHidden();
		const box = await bar.boundingBox();
		assert.ok(box && Math.abs(box.y + box.height - 844) <= 1, `the bar sits on the bottom edge ${JSON.stringify(box)}`);
		// The bar is a pointer shortcut (aria-hidden), so it is read by class. Order: chat icon, add-to-cart icon (name only for assistive tech), Beli sekarang as the one text action.
		await expect(bar.locator(".bar-chat")).toHaveAttribute("href", "/bantuan#percakapan");
		const actions = bar.locator("button");
		assert.deepEqual(await actions.allTextContents(), ["Tambah ke keranjang", "Beli sekarang"]);
		for (const el of await bar.locator(".bar-chat, button").all()) {
			const b = await el.boundingBox();
			assert.ok(b && b.height >= 44 && b.width >= 44 && b.x >= 0 && b.x + b.width <= 390, `bar control ${JSON.stringify(b)}`);
		}
		assert.ok(await actions.evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1)), "bar labels stay on one line inside their buttons");
		const [add, buy] = await Promise.all([actions.nth(0).boundingBox(), actions.nth(1).boundingBox()]);
		assert.ok(add && buy && add.width <= 52 && buy.width > 140, `the add-to-cart button is an icon and Beli sekarang the wide text action ${JSON.stringify({ add, buy })}`);
		await page.screenshot({ path: join(renders, "pdp-buy-bar-390.png"), clip: { x: 0, y: 844 - 160, width: 390, height: 160 } });
		// Back at the top the bar hides and the dock returns.
		await page.evaluate(() => window.scrollTo(0, 0));
		await expect(bar).toHaveCount(0);
		await expect(dock).toBeVisible();
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("phone product page: the search header gives way to a back / share / cart / menu bar over the photo", async () => {
	const { page, errors, close } = await phone();
	try {
		await page.goto(`${origin}/`);
		const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="/produk/"]')].map((a) => a.getAttribute("href") ?? ""))].slice(0, 12));
		await expect(page.locator(".store-header")).toBeVisible();
		// The photo assertions need a product with real photos (sample products show a photo slot instead).
		let product = "";
		for (const href of hrefs) {
			await page.goto(`${origin}${href}`);
			if (await page.locator(".gallery-row").count()) {
				product = href;
				break;
			}
		}
		assert.ok(product, "a product with a photo gallery exists");
		await expect(page.locator(".store-header")).toBeHidden();
		await expect(page.getByRole("searchbox")).toHaveCount(0);
		const bar = page.locator(".pdp-bar");
		await expect(bar).toBeVisible();
		for (const name of ["Kembali", "Bagikan produk", /^Keranjang/, "Menu lainnya"]) await expect(bar.getByRole(name === "Kembali" ? "link" : name === "Bagikan produk" || name === "Menu lainnya" ? "button" : "link", { name })).toBeVisible();
		// Order: back on the left, then share, cart, menu on the right.
		const xs = await Promise.all(["Kembali", "Bagikan produk", "Keranjang", "Menu lainnya"].map(async (n) => (await bar.getByRole(n === "Kembali" || n === "Keranjang" ? "link" : "button", { name: n }).boundingBox())?.x ?? -1));
		assert.deepEqual([...xs].sort((a, b) => a - b), xs, `bar order ${xs}`);
		// The photo is the first thing on the page: it starts at the top edge and spans the full width.
		const photo = await page.locator(".gallery-row .product-image").first().boundingBox();
		assert.ok(photo && photo.y <= 1 && photo.x <= 1 && Math.abs(photo.width - 390) <= 1, `photo ${JSON.stringify(photo)}`);
		await page.screenshot({ path: join(renders, "pdp-top-390.png"), clip: { x: 0, y: 0, width: 390, height: 460 } });
		// The menu is a native popover with real links.
		await bar.getByRole("button", { name: "Menu lainnya" }).click();
		const menu = page.locator("#pdp-more");
		await expect(menu).toBeVisible();
		assert.deepEqual(await menu.getByRole("link").allTextContents(), ["Beranda", "Kategori", "Cari produk", "Chat bantuan", "Akun"]);
		await page.screenshot({ path: join(renders, "pdp-menu-390.png"), clip: { x: 0, y: 0, width: 390, height: 460 } });
		await page.keyboard.press("Escape");
		await expect(menu).toBeHidden();
		// After a scroll the bar turns solid white and shows the product name.
		await page.evaluate(() => window.scrollTo(0, 700));
		await expect(bar).toHaveAttribute("data-solid", "true");
		await expect.poll(() => bar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
		await page.screenshot({ path: join(renders, "pdp-top-solid-390.png"), clip: { x: 0, y: 0, width: 390, height: 120 } });
		// A focused element is scrolled clear of the fixed bar (scroll-padding), never left under it.
		await page.evaluate(() => window.scrollTo(0, 3000));
		await page.locator(".breadcrumb a").first().focus();
		const crumb = await page.locator(".breadcrumb a").first().boundingBox();
		const barBox = await bar.boundingBox();
		assert.ok(crumb && barBox && crumb.y >= barBox.y + barBox.height - 1, `focused breadcrumb sits under the bar ${JSON.stringify({ crumb, barBox })}`);
		// Back is the category by default and the listing the buyer came from when the URL carries ?from=.
		assert.match((await bar.getByRole("link", { name: "Kembali" }).getAttribute("href")) ?? "", /^\/kategori\/[a-z0-9-]+$|^\/(#product-[0-9a-f-]+)?$/);
		const withFrom = new URL(`${origin}${product}`);
		withFrom.searchParams.set("from", "/cari?q=kaos");
		await page.goto(withFrom.toString());
		await expect(page.locator(".pdp-bar").getByRole("link", { name: "Kembali" })).toHaveAttribute("href", "/cari?q=kaos");
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
	// Tablets and desktop keep the regular header and never show the bar.
	const wide = await phone(820, 1100);
	try {
		await wide.page.goto(`${origin}/`);
		const product = await wide.page.evaluate(() => document.querySelector('a[href^="/produk/"]')?.getAttribute("href"));
		await wide.page.goto(`${origin}${product}`);
		await expect(wide.page.locator(".store-header")).toBeVisible();
		await expect(wide.page.locator(".pdp-bar")).toBeHidden();
	} finally {
		await wide.close();
	}
});
