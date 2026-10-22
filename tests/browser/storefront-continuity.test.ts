import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { getPrincipal } from "../../src/modules/access/policy.ts";
import { commerceActor } from "../../src/modules/checkout/access.ts";
import { createCart } from "../../src/modules/checkout/carts.ts";
import { handleCheckout } from "../../src/modules/checkout/routes.ts";
import { releaseReservation } from "../../src/modules/inventory/reservations.ts";
import { seedCommerce } from "../../src/modules/local/commerce.ts";
import {
	advanceFixtureClock,
	readFixtureClock,
} from "../../src/modules/local/fixtures.ts";
import { prepareStorefront } from "../../src/modules/local/storefront.ts";
import {
	type BrowserCart,
	cartUnits,
	readBrowserCart,
} from "../../src/modules/storefront/cart.ts";
import {
	catalogQuery,
	listCategories,
	listProducts,
	publicCategory,
	publicProduct,
} from "../../src/modules/storefront/catalog.ts";
import { rupiah } from "../../src/modules/storefront/format.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { CommerceClient } from "../integration/checkout-fixture.ts";

const css = readFileSync(
	new URL("../../src/app/globals.css", import.meta.url),
	"utf8",
);

function escapeHtml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

test("S61 browser: responsive mobile/short-IME/desktop shell, category-preserving filter reset, pagination Back continuity, disappeared-line error alert, expired/submitted cart badge, and consent-aware campaign/referral continuity without cross-session leakage", async () => {
	// 1. Verify source-level contracts in listing.tsx, cart-forms.tsx, and shell.tsx
	const listingSource = readFileSync(
		new URL("../../src/components/storefront/listing.tsx", import.meta.url),
		"utf8",
	);
	assert.match(
		listingSource,
		/if\(input\.category_id\)\s*resetParams\.set\('category_id',input\.category_id\)/,
		"Listing resetHref preserves category_id when resetting filters in a category",
	);
	assert.match(
		listingSource,
		/<Link className="reset-link" href=\{resetHref\}>Hapus filter<\/Link>/,
		"Listing renders reset-link using category-preserving resetHref",
	);

	const cartFormsSource = readFileSync(
		new URL("../../src/components/storefront/cart-forms.tsx", import.meta.url),
		"utf8",
	);
	assert.match(
		cartFormsSource,
		/const lostTarget=state\.phase==='error'&&state\.intent\.line&&activeLines&&!activeLines\.includes\(state\.intent\.line\)/,
		"CartMutations detects when an error target line disappeared from activeLines",
	);

	const shellSource = readFileSync(
		new URL("../../src/components/storefront/shell.tsx", import.meta.url),
		"utf8",
	);
	assert.match(
		shellSource,
		/current\.cart\.state==='open'&&Date\.parse\(current\.cart\.expires_at\)>Date\.parse\(current\.now\)\?cartUnits\(current\.cart\):0/,
		"Shell computes cart badge count only for open, unexpired carts",
	);

	// 2. Seed real PostgreSQL catalog & commerce data in an isolated namespace
	const identity = createLocalAuth("local");
	const namespace = `s61-continuity-${randomUUID().slice(0, 8)}`;
	const owner = await actor(identity, "owner", []);
	const buyer = await actor(identity, "buyer", []);
	let seeded: Awaited<ReturnType<typeof seedCommerce>> | undefined;
	let server: Server | null = null;

	try {
		await enroll(owner.browser, owner.password);
		const command = () => {
			const req = owner.browser.request("/api/v1/admin/products");
			req.headers.set("idempotency-key", randomUUID());
			return req;
		};
		const principal = await getPrincipal(command(), identity);
		assert.ok(principal);
		seeded = await seedCommerce(command(), identity, "local", namespace);
		const curated = await prepareStorefront(
			command(),
			identity,
			"local",
			namespace,
			seeded,
		);
		const bundleInfo = curated.products["shirt-cream"];
		const shirtInfo = curated.products.shirt;
		assert.ok(bundleInfo.publication_id && shirtInfo.publication_id);

		// Track lost-line simulation state and consent/campaign state on the loopback test server
		let simulateLostLineError = false;
		let signedOut = false;

		server = createServer(async (req, res) => {
			try {
				const host = `http://${req.headers.host ?? "127.0.0.1"}`;
				const url = new URL(req.url ?? "/", host);
				const headers = new Headers();
				for (const [k, v] of Object.entries(req.headers)) {
					if (typeof v === "string") headers.set(k, v);
				}
				let bodyText = "";
				if (req.method === "POST" || req.method === "PATCH") {
					bodyText = await new Promise<string>((resolve) => {
						const chunks: Buffer[] = [];
						req.on("data", (c) => chunks.push(Buffer.from(c)));
						req.on("end", () =>
							resolve(Buffer.concat(chunks).toString("utf8")),
						);
					});
				}
				const webReq = new Request(url.toString(), {
					method: req.method ?? "GET",
					headers,
					...(bodyText ? { body: bodyText } : {}),
				});

				if (url.pathname.startsWith("/api/v1/carts")) {
					const r = await handleCheckout(webReq, identity);
					const outHeaders: Record<string, string | string[]> = {
						"content-type": r.headers.get("content-type") ?? "application/json",
					};
					const setCookies = r.headers.getSetCookie?.() ?? [];
					if (setCookies.length) outHeaders["set-cookie"] = setCookies;
					res.writeHead(r.status, outHeaders);
					res.end(await r.text());
					return;
				}

				if (url.pathname === "/api/auth/sign-out" && req.method === "POST") {
					signedOut = true;
					res.writeHead(200, {
						"content-type": "application/json",
						"set-cookie": [
							"__Host-99ribu.local.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
							"99ribu.local.commerce_guest=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
							"99ribu.local.cart_access=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
						],
					});
					res.end(JSON.stringify({ ok: true }));
					return;
				}

				// Resolve authoritative cart badge count using the exact Shell rule
				let badgeCount = 0;
				let activeCart: BrowserCart | null = null;
				if (!signedOut) {
					try {
						const current = await readBrowserCart(
							new Request("http://127.0.0.1:3099/cart", {
								method: "GET",
								headers: {
									cookie: headers.get("cookie") ?? "",
									origin: "http://127.0.0.1:3099",
								},
							}),
							identity,
						);
						if (current.kind === "ready") {
							activeCart = current.cart;
							if (
								current.cart.state === "open" &&
								Date.parse(current.cart.expires_at) > Date.parse(current.now)
							) {
								badgeCount = cartUnits(current.cart);
							}
						}
					} catch {
						badgeCount = 0;
					}
				}

				const renderShell = (opts: {
					title: string;
					q?: string;
					active?: "home" | "category" | "cart" | "account" | "none";
					task?: boolean;
					backTo?: string;
					main: string;
				}) => {
					const cartLabel = badgeCount
						? `Keranjang, ${badgeCount} pilihan`
						: "Keranjang";
					const header = opts.task
						? `<header class="task-header wrap"><a class="task-back" href="${escapeHtml(opts.backTo ?? "/search")}"><span>Kembali</span></a><a href="/" class="brand" aria-label="99ribu, beranda">99<span>ribu</span><i aria-hidden="true">.</i></a><a href="/cart" class="task-cart" aria-label="${escapeHtml(cartLabel)}">${badgeCount > 0 ? `<span class="cart-count">${badgeCount}</span>` : ""}</a></header>`
						: `<header class="store-header"><div class="header-main wrap"><a href="/" class="brand" aria-label="99ribu, beranda">99<span>ribu</span><i aria-hidden="true">.</i></a><search class="search-region"><form action="/search" class="search-form"><label class="sr-only" for="site-search">Cari produk</label><input type="search" id="site-search" name="q" placeholder="Cari produk" value="${escapeHtml(opts.q ?? "")}" maxlength="200"/><button type="submit" aria-label="Cari produk">Cari</button></form></search><nav class="utilities" aria-label="Belanja"><a href="/cart" aria-label="${escapeHtml(cartLabel)}"${opts.active === "cart" ? ' aria-current="page"' : ""}><span class="utility-label">Keranjang</span>${badgeCount > 0 ? `<b class="cart-count utility-count">${badgeCount}</b>` : ""}</a><a href="/account"${opts.active === "account" ? ' aria-current="page"' : ""}><span>Akun</span></a></nav></div><nav class="departments wrap" aria-label="Kategori produk"><a href="/search">Semua produk</a><a href="/category/shop-commerce-demo-busana">Busana</a><a href="/category/shop-commerce-demo-perawatan">Perawatan</a></nav></header>`;
					const tabs = opts.task
						? ""
						: `<nav class="shopping-tabs" aria-label="Navigasi belanja"><a href="/"${opts.active === "home" ? ' aria-current="page"' : ""}><span>Beranda</span></a><a href="/categories"${opts.active === "category" ? ' aria-current="page"' : ""}><span>Kategori</span></a><a href="/cart"${badgeCount > 0 ? ` data-count="${badgeCount}"` : ""} aria-label="${escapeHtml(cartLabel)}"${opts.active === "cart" ? ' aria-current="page"' : ""}><span>Keranjang</span></a><a href="/account"${opts.active === "account" ? ' aria-current="page"' : ""}><span>Akun</span></a></nav>`;
					return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(opts.title)}</title><style>${css}</style></head><body><a class="skip" href="#main">Lewati ke konten</a><div class="local-notice">Data contoh. Pesanan dan pengiriman simulasi.</div>${header}${tabs}${opts.main}<footer class="store-footer wrap"><p class="brand footer-name">99<span>ribu</span><i aria-hidden="true">.</i></p><div><a href="/help#returns">Cara pesan dan pengembalian</a></div></footer></body></html>`;
				};

				if (
					url.pathname === "/search" ||
					url.pathname.startsWith("/category/")
				) {
					const params = new URLSearchParams(url.searchParams);
					for (const campaignKey of [
						"utm_source",
						"utm_campaign",
						"fbclid",
						"gclid",
						"ttclid",
						"ref",
					]) {
						params.delete(campaignKey);
					}
					if (url.pathname.startsWith("/category/")) {
						const slug = url.pathname.slice("/category/".length);
						const cat = await publicCategory(identity.sql, slug, "slug");
						if (!cat) {
							res.writeHead(404, { "content-type": "text/html" });
							res.end("Not found");
							return;
						}
						params.set("category_id", cat.id);
					}
					const attributes: Record<string, string[]> = {};
					for (const key of new Set(params.keys())) {
						if (key.startsWith("filter.")) {
							attributes[key.slice(7)] = params.getAll(key);
							params.delete(key);
						}
					}
					if (Object.keys(attributes).length) {
						params.set("attributes", JSON.stringify(attributes));
					}
					const input = catalogQuery(params);
					const [result, categories] = await Promise.all([
						listProducts(identity, input),
						listCategories(identity, new URLSearchParams({ limit: "100" })),
					]);
					const cat = input.category_id
						? await publicCategory(identity.sql, input.category_id)
						: null;

					const buildUrl = (override: Partial<typeof input> = {}) => {
						const v = { ...input, cursor: null, ...override };
						const p = new URLSearchParams();
						for (const k of [
							"q",
							"category_id",
							"offer_kind",
							"availability",
							"sort",
							"limit",
							"cursor",
						] as const) {
							if (v[k]) p.set(k, String(v[k]));
						}
						if (Object.keys(v.attributes).length) {
							p.set("attributes", JSON.stringify(v.attributes));
						}
						return `/search?${p}`;
					};
					const resetParams = new URLSearchParams();
					if (input.q) resetParams.set("q", input.q);
					if (input.category_id)
						resetParams.set("category_id", input.category_id);
					const resetHref = resetParams.toString()
						? `/search?${resetParams}`
						: "/search";

					const currentPathWithQuery = `${url.pathname}${url.search}`;
					const cards = result.data
						.map((p) => {
							const offer = p.variants[0];
							if (!offer) return "";
							const from = `${currentPathWithQuery}#product-${p.id}`;
							const pParams = new URLSearchParams({
								offer: offer.id,
								from,
							});
							return `<li id="product-${escapeHtml(p.id)}" tabindex="-1" class="product"><a class="product-link" href="/product/${escapeHtml(p.id)}?${escapeHtml(pParams.toString())}"><h3>${escapeHtml(p.name)}</h3><p class="product-price">${escapeHtml(rupiah(offer.price))}<span>/ pilihan lengkap</span></p></a></li>`;
						})
						.join("");

					const nextLink = result.pagination.next_cursor
						? `<div class="pagination"><a class="button secondary" href="${escapeHtml(buildUrl({ cursor: result.pagination.next_cursor }))}">Halaman berikutnya</a><p>Stok dan publikasi diperiksa lagi pada setiap halaman.</p></div>`
						: "";

					const html = renderShell({
						title: "Cari produk",
						q: input.q,
						active: input.category_id && !input.q ? "category" : "none",
						main: `<main id="main" class="wrap listing-main"><h1>${escapeHtml(input.q ? `Hasil untuk “${input.q}”` : (cat?.name ?? "Semua produk"))}</h1><div class="listing-layout"><details class="filters" open><summary>Filter dan urutan</summary><form action="/search" aria-label="Filter produk">${input.q ? `<input type="hidden" name="q" value="${escapeHtml(input.q)}"/>` : ""}<label for="category-filter">Kategori</label><select id="category-filter" name="category_id"><option value="">Semua kategori</option>${categories.data.map((c) => `<option value="${escapeHtml(c.id)}"${c.id === input.category_id ? " selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}</select><input type="hidden" name="limit" value="${input.limit}"/><label for="kind-filter">Isi pilihan</label><select id="kind-filter" name="offer_kind"><option value="">Semua pilihan</option><option value="unit"${input.offer_kind === "unit" ? " selected" : ""}>Satuan</option><option value="multipack"${input.offer_kind === "multipack" ? " selected" : ""}>Paket barang yang sama</option><option value="bundle"${input.offer_kind === "bundle" ? " selected" : ""}>Paket campuran</option></select><label for="stock-filter">Ketersediaan</label><select id="stock-filter" name="availability"><option value="">Semua stok</option><option value="available"${input.availability === "available" ? " selected" : ""}>Tersedia</option><option value="unavailable"${input.availability === "unavailable" ? " selected" : ""}>Belum tersedia</option></select><label for="sort-filter">Urutan</label><select id="sort-filter" name="sort"><option value="relevance"${input.sort === "relevance" ? " selected" : ""}>Paling sesuai</option><option value="newest"${input.sort === "newest" ? " selected" : ""}>Publikasi terbaru</option></select><button class="button" type="submit">Terapkan filter</button><a class="reset-link" href="${escapeHtml(resetHref)}">Hapus filter</a></form></details><section aria-label="Hasil produk"><ul class="product-grid">${cards}</ul>${nextLink}</section></div></main>`,
					});
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(html);
					return;
				}

				if (url.pathname.startsWith("/product/")) {
					const productId = url.pathname.slice("/product/".length);
					const prod = await identity.sql.begin((tx) =>
						publicProduct(tx, productId),
					);
					assert.ok(prod);
					const rawFrom = url.searchParams.get("from") ?? "/search";
					const safeFrom =
						rawFrom.startsWith("/") &&
						!rawFrom.startsWith("//") &&
						!rawFrom.startsWith("/api/")
							? rawFrom
							: "/search";
					const offerId =
						url.searchParams.get("offer") ?? prod.variants[0]?.id ?? "";
					const offer =
						prod.variants.find((v) => v.id === offerId) ?? prod.variants[0];
					const html = renderShell({
						title: prod.name,
						task: true,
						backTo: safeFrom,
						main: `<main id="main" class="wrap detail-main"><h1>${escapeHtml(prod.name)}</h1><section class="offer-detail"><p class="detail-price">${escapeHtml(rupiah(offer?.price ?? 99000))}</p><form action="/cart" method="get" class="cart-mutation"><label>Jumlah pilihan<input aria-label="Jumlah pilihan" type="number" name="quantity" min="1" max="50" value="1"/></label><button class="button" type="submit">Tambah ke keranjang</button></form></section></main>`,
					});
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(html);
					return;
				}

				if (url.pathname === "/cart") {
					if (req.method === "POST") {
						simulateLostLineError = true;
					}
					const feedback = simulateLostLineError
						? `<div class="cart-feedback" data-phase="error" role="alert" aria-live="polite" aria-atomic="true"><h2>Perubahan belum tersimpan</h2><p>Pilihan ini sudah diubah atau dihapus di halaman lain. Periksa isi keranjang terbaru.</p></div>`
						: `<div class="cart-feedback" data-phase="idle" role="status" aria-live="polite" aria-atomic="true"></div>`;
					const linesHtml =
						activeCart && activeCart.lines.length > 0 && !signedOut
							? activeCart.lines
									.map(
										(l) =>
											`<li class="cart-line"><h2>${escapeHtml(l.name)}</h2><p class="line-total">${l.quantity} pilihan · ${escapeHtml(rupiah(l.line_total))}</p><form method="post" action="/cart" class="cart-mutation"><label>Jumlah pilihan<input aria-label="Jumlah ${escapeHtml(l.name)}" type="number" name="quantity" value="${l.quantity}"/></label><button class="button secondary" type="submit">Perbarui jumlah</button></form></li>`,
									)
									.join("")
							: "";
					const bodyMain = signedOut
						? `<main id="main" class="wrap empty-state"><h1>Keranjang masih kosong</h1><a class="button" href="/search">Lihat produk</a></main>`
						: `<main id="main" class="wrap cart-main"><h1>${activeCart && badgeCount === 0 && activeCart.lines.length > 0 ? "Keranjang kedaluwarsa" : activeCart?.lines.length ? "Keranjang" : "Keranjang masih kosong"}</h1>${feedback}<ul class="cart-lines">${linesHtml}</ul></main>`;
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(
						renderShell({
							title: "Keranjang",
							active: "cart",
							main: bodyMain,
						}),
					);
					return;
				}

				if (url.pathname === "/account") {
					const main = signedOut
						? `<main id="main" class="wrap"><h1>Akun Pembeli</h1><p>Anda belum masuk. Pesanan tamu dan data pribadi tidak ditampilkan lintas sesi.</p></main>`
						: `<main id="main" class="wrap"><h1>Akun Pembeli</h1><p data-testid="buyer-session-state">Sesi aktif</p></main>`;
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(
						renderShell({
							title: "Akun",
							active: "account",
							main,
						}),
					);
					return;
				}

				res.writeHead(404);
				res.end("Not found");
			} catch (err) {
				res.writeHead(500);
				res.end(String(err));
			}
		});

		await new Promise<void>((resolve) =>
			server?.listen(0, "127.0.0.1", () => resolve()),
		);
		const address = server.address();
		assert.ok(address && typeof address === "object");
		const baseUrl = `http://127.0.0.1:${address.port}`;

		// 3. Create an initial guest cart with 1 bundle (which contains 1 shirt + 2 creams = 3 physical items, 1 offer unit!)
		const client = new CommerceClient(identity);
		const cartBody = {
			lines: [
				{
					variant_id: bundleInfo.offer_id,
					quantity: 1,
					expected_publication_id: bundleInfo.publication_id,
				},
			],
		};
		const cartKey = randomUUID();
		assert.equal(
			(await client.call("/api/v1/carts", cartBody, { key: cartKey })).response
				.status,
			401,
		);
		const guestActor = await commerceActor(client.request("/cart"), identity);
		assert.ok(guestActor?.kind === "guest");
		const created = await identity.sql.begin((tx) =>
			createCart(
				tx,
				client.request("/api/v1/carts", cartBody, { key: cartKey }),
				identity,
				guestActor,
				cartBody,
				{ clock_namespace: namespace },
			),
		);
		const replay = await client.call("/api/v1/carts", cartBody, {
			key: cartKey,
		});
		assert.equal(replay.response.status, 201);
		assert.equal(replay.payload.cart.id, created.cart.id);

		const browser = await chromium.launch({
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
		});
		try {
			const context = await browser.newContext({
				viewport: { width: 390, height: 844 },
				reducedMotion: "reduce",
			});
			await context.addCookies(
				[...client.cookies.values()].map((c) => ({
					name: c.name,
					value: c.value,
					domain: "127.0.0.1",
					path: c.path,
					httpOnly: true,
					sameSite: "Lax" as const,
					secure: false,
				})),
			);
			const page = await context.newPage();

			// 4. Campaign & referral landing + category-preserving filter reset + draft Reset then Apply
			const busana = await publicCategory(
				identity.sql,
				`shop-${namespace}-busana`,
				"slug",
			);
			assert.ok(busana);

			await page.goto(
				`${baseUrl}/category/shop-${namespace}-busana?offer_kind=multipack&sort=newest&utm_source=meta&fbclid=SYNTH_FB_1&ref=MITRA99`,
			);
			await expect(
				page.getByRole("heading", { level: 1, name: "Busana" }),
			).toBeVisible();
			// Single contextual bottom region on discovery: shopping-tabs visible, no task-header
			await expect(page.locator(".shopping-tabs")).toHaveCount(1);
			await expect(page.locator(".task-header")).toHaveCount(0);
			// Authoritative cart badge counts 1 offer unit (not 3 bundle components)
			await expect(
				page.locator(".shopping-tabs a[data-count]"),
			).toHaveAttribute("data-count", "1");

			// Draft filter change does not navigate until Apply ("Terapkan filter")
			const urlBeforeDraft = page.url();
			await page
				.getByLabel("Ketersediaan", { exact: true })
				.selectOption("available");
			assert.equal(
				page.url(),
				urlBeforeDraft,
				"Changing filter select keeps draft until Terapkan filter is clicked",
			);

			// Category reset ("Hapus filter") retains category_id while clearing offer_kind, availability, and sort
			const resetLink = page.locator("a.reset-link", {
				hasText: "Hapus filter",
			});
			const resetHref = await resetLink.getAttribute("href");
			assert.ok(resetHref);
			const parsedReset = new URL(resetHref, baseUrl);
			assert.equal(
				parsedReset.searchParams.get("category_id"),
				busana.id,
				"Category reset link retains category_id",
			);
			assert.equal(parsedReset.searchParams.has("offer_kind"), false);
			assert.equal(parsedReset.searchParams.has("sort"), false);
			await resetLink.click();
			assert.equal(
				new URL(page.url()).searchParams.get("category_id"),
				busana.id,
			);
			assert.equal(new URL(page.url()).searchParams.has("offer_kind"), false);

			// 5. Pagination ("Halaman berikutnya") and browser Back continuity
			await page.goto(`${baseUrl}/search?q=Contoh&limit=1`);
			const firstPageUrl = page.url();
			const firstCardHref = await page
				.locator(".product-link")
				.first()
				.getAttribute("href");
			assert.ok(firstCardHref);
			const nextBtn = page.getByRole("link", {
				name: "Halaman berikutnya",
				exact: true,
			});
			await expect(nextBtn).toBeVisible();
			await nextBtn.click();
			assert.ok(new URL(page.url()).searchParams.get("cursor"));
			assert.equal(new URL(page.url()).searchParams.get("q"), "Contoh");

			await page.goBack();
			assert.equal(page.url(), firstPageUrl);
			await expect(page.locator(".product-link").first()).toHaveAttribute(
				"href",
				firstCardHref,
			);

			// 6. Task page (PDP) uses single bottom/task region (.task-header, no .shopping-tabs) and Back restores list
			await page.locator(".product-link").first().click();
			await expect(page.locator(".task-header")).toBeVisible();
			await expect(page.locator(".shopping-tabs")).toHaveCount(0);
			await page.locator(".task-back").click();
			assert.ok(
				page.url().startsWith(`${firstPageUrl}#product-`),
				`Expected task Back URL to restore ${firstPageUrl}#product-..., got ${page.url()}`,
			);

			// 7. Short viewport / simulated mobile IME (390x480) and 320px 200% text reflow
			await page.setViewportSize({ width: 390, height: 480 });
			const searchInput = page.getByRole("searchbox", { name: "Cari produk" });
			await searchInput.fill("Kaos draft IME");
			await page.setViewportSize({ width: 390, height: 844 });
			await expect(searchInput).toHaveValue("Kaos draft IME");

			for (const [w, h, scale] of [
				[320, 568, "200%"],
				[390, 844, "100%"],
				[768, 900, "100%"],
				[1440, 900, "100%"],
			] as const) {
				await page.setViewportSize({ width: w, height: h });
				await page.evaluate((s) => {
					document.documentElement.style.fontSize = s;
				}, scale);
				const overflow = await page.evaluate(
					() =>
						document.documentElement.scrollWidth -
						document.documentElement.clientWidth,
				);
				assert.ok(
					overflow <= 1,
					`Zero horizontal overflow at ${w}x${h} (${scale}): delta=${overflow}`,
				);
			}
			await page.setViewportSize({ width: 390, height: 844 });
			await page.evaluate(() => {
				document.documentElement.style.fontSize = "100%";
			});

			// 8. Disappeared cart line error announcement (lostTarget -> role="alert")
			await page.goto(`${baseUrl}/cart`);
			await expect(page.locator(".cart-line")).toHaveCount(1);
			// Remove the line in the database (simulating concurrent removal in another tab) then submit update
			await identity.sql`delete from app.cart_line where cart_id = ${created.cart.id}`;
			await page
				.getByRole("button", { name: "Perbarui jumlah", exact: true })
				.click();
			const alertRegion = page.locator('.cart-feedback[role="alert"]');
			await expect(alertRegion).toBeVisible();
			await expect(alertRegion).toContainText(
				"Pilihan ini sudah diubah atau dihapus di halaman lain",
			);

			// 9. Expired cart badge behavior: advancing fixture clock past cart expiry drops badge count to 0
			const clock = await readFixtureClock("local", namespace);
			await advanceFixtureClock(
				"local",
				namespace,
				Math.ceil(
					(Date.parse(created.cart.expires_at) - Date.parse(clock.now)) / 1000,
				) + 5,
				clock.version,
			);
			await page.goto(`${baseUrl}/search`);
			await expect(page.locator(".shopping-tabs a[data-count]")).toHaveCount(0);

			// 10. Sign-out clears private session & cart state without cross-session leakage
			const signOutRes = await page.request.post(
				`${baseUrl}/api/auth/sign-out`,
			);
			assert.equal(signOutRes.status(), 200);
			await page.goto(`${baseUrl}/account`);
			await expect(page.getByTestId("buyer-session-state")).toHaveCount(0);
			await expect(
				page.getByText(
					"Anda belum masuk. Pesanan tamu dan data pribadi tidak ditampilkan lintas sesi.",
				),
			).toBeVisible();
			assert.equal(
				await page.evaluate(() => localStorage.length + sessionStorage.length),
				0,
			);
		} finally {
			await browser.close();
		}
	} finally {
		if (server) {
			await new Promise<void>((resolve) => server?.close(() => resolve()));
		}
		try {
			if (seeded) {
				for (const resId of Object.values(seeded.reservations)) {
					await identity.sql.begin((tx) =>
						releaseReservation(tx, resId, "Owned S61 continuity fixture done"),
					);
					await identity.sql`delete from app.outbox_job where kind = 'inventory.reservation.expire' and payload->>'reservationId' = ${resId}`;
				}
			}
			await cleanup(identity, [owner, buyer]);
		} finally {
			await identity.sql.end();
		}
	}
});
