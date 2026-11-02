import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { handleFinance } from "../../src/modules/finance/routes.ts";
import { readCatalogRevision } from "../../src/modules/catalog/catalog.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { buildPatch, rowsFrom } from "../../src/components/admin/offer-editor-model.ts";
import { checkoutFixture } from "./checkout-fixture.ts";

// S151 / spec 17 W4-3: the offer editor's PATCH, through the real handler. The body is built by the editor's own
// model (buildPatch), so a drift between the screen and the wire contract fails here.
const SHIRT = "fixture-offer-shirt";
type Fixture = Awaited<ReturnType<typeof checkoutFixture>>;
type Who = { browser: { request(path: string, body?: Record<string, unknown>): Request } };

function patch(who: Who, productId: string, body: Record<string, unknown>, key: string = randomUUID()) {
	const base = who.browser.request(`/api/v1/admin/products/${productId}`, body);
	base.headers.set("idempotency-key", key);
	return new Request(base, { method: "PATCH" });
}
async function draft(f: Fixture) {
	const productId = f.seeded.products[SHIRT];
	const current = await readCatalogRevision(f.identity.sql, productId);
	const offer = current.variants.find((v) => v.id === f.seeded.offers[SHIRT]);
	assert.ok(offer);
	return { productId, offerId: offer.id, current };
}
// The editor works on the admin GET shape; the revision read has the same offer fields.
function editorProduct(current: Awaited<ReturnType<typeof readCatalogRevision>>) {
	return { version: current.version, category_id: current.category_id, images: current.images, variants: current.variants.filter((v) => !v.retired) };
}

test("a price edit makes a new revision; an open cart keeps its frozen price", async () => {
	const f = await checkoutFixture();
	try {
		const { productId, offerId, current } = await draft(f);
		const frozen = current.variants.find((v) => v.id === offerId)?.price as number;
		const key = randomUUID();
		const opened = await f.client.call("/api/v1/carts", { access_transport: "header", lines: [f.line(SHIRT, 1)] }, { key });
		const cartResponse = opened.response.status === 401 ? await f.client.call("/api/v1/carts", { access_transport: "header", lines: [f.line(SHIRT, 1)] }, { key }) : opened;
		assert.equal(cartResponse.response.status, 201, JSON.stringify(cartResponse.payload));
		const cart = cartResponse.payload.cart;
		const headers = { "x-cart-token": cartResponse.payload.cart_access_token } as Record<string, string>;

		const product = editorProduct(current);
		const next = frozen === 69000 ? 59000 : 69000;
		const rows = rowsFrom(product.variants as never).map((r) => (r.id === offerId ? { ...r, price: String(next) } : r));
		const body = buildPatch({ product: product as never, rows, retiredIds: [], categoryId: current.category_id, reason: "Synthetic offer editor reprice" });
		assert.ok(body);
		const response = await handleCatalog(patch(f.owner, productId, body), f.identity);
		const saved = await response.json();
		assert.equal(response.status, 200, JSON.stringify(saved));
		assert.equal(saved.version, current.version + 1, "a new draft revision");
		assert.equal(saved.variants.find((v: { id: string }) => v.id === offerId).price, next);
		assert.equal((await readCatalogRevision(f.identity.sql, productId, current.version)).variants.find((v) => v.id === offerId)?.price, frozen, "the earlier revision is unchanged");

		const viewed = await f.client.call(`/api/v1/carts/${cart.id}`, undefined, { headers });
		assert.equal(viewed.response.status, 200, JSON.stringify(viewed.payload));
		assert.equal((viewed.payload.cart ?? viewed.payload).lines[0].unit_price, frozen, "the cart line keeps the price it was frozen at");
	} finally {
		await f.close();
	}
});

test("a price above Rp99.000 or below Rp1 is refused and creates no revision", async () => {
	const f = await checkoutFixture();
	try {
		const { productId, offerId, current } = await draft(f);
		const offer = current.variants.find((v) => v.id === offerId);
		assert.ok(offer);
		for (const price of [99001, 0, 1000.5]) {
			const update = { label: offer.label, attributes: offer.attributes, price, weight_grams: offer.weight_grams, length_mm: offer.length_mm, width_mm: offer.width_mm,
				height_mm: offer.height_mm, default_warehouse_id: offer.default_warehouse_id, offer_kind: offer.offer_kind, contents: offer.contents };
			const response = await handleCatalog(patch(f.owner, productId, { expected_version: current.version, reason: "Synthetic invalid price",
				variant_changes: [{ operation: "update", variant_id: offerId, update }] }), f.identity);
			assert.equal(response.status, 400, `price ${price}`);
			assert.equal((await response.json()).code, "INVALID_INPUT");
		}
		assert.equal((await readCatalogRevision(f.identity.sql, productId)).version, current.version);
	} finally {
		await f.close();
	}
});

test("a stale expected version gives 409 VERSION_CONFLICT and keeps the winner's revision", async () => {
	const f = await checkoutFixture();
	try {
		const { productId, current } = await draft(f);
		const first = await handleCatalog(patch(f.owner, productId, { expected_version: current.version, reason: "Synthetic first editor", name: `Synthetic first ${randomUUID().slice(0, 8)}` }), f.identity);
		assert.equal(first.status, 200);
		const stale = await handleCatalog(patch(f.owner, productId, { expected_version: current.version, reason: "Synthetic stale editor", name: "Synthetic second" }), f.identity);
		assert.equal(stale.status, 409);
		assert.equal((await stale.json()).code, "VERSION_CONFLICT");
		assert.equal((await readCatalogRevision(f.identity.sql, productId)).version, current.version + 1);
	} finally {
		await f.close();
	}
});

test("an ecommerce_admin edits offers and no response carries HPP or cost", async () => {
	const f = await checkoutFixture();
	const admin = await (async () => {
		const { current } = await draft(f);
		const warehouses = [...new Set(current.variants.filter((v) => !v.retired).map((v) => v.default_warehouse_id))];
		const who = await actor(f.identity, "ecommerce_admin", warehouses);
		await enroll(who.browser, who.password);
		return who;
	})();
	try {
		const { productId, offerId, current } = await draft(f);
		const product = editorProduct(current);
		const rows = rowsFrom(product.variants as never).map((r) => (r.id === offerId ? { ...r, price: "45000" } : r));
		const body = buildPatch({ product: product as never, rows, retiredIds: [], categoryId: current.category_id, reason: "Synthetic ecommerce admin reprice" });
		assert.ok(body);
		const saved = await handleCatalog(patch(admin, productId, body), f.identity);
		const savedText = await saved.text();
		assert.equal(saved.status, 200, savedText);
		const read = await handleCatalog(admin.browser.request(`/api/v1/admin/products/${productId}`), f.identity);
		assert.equal(read.status, 200);
		const readText = await read.text();
		for (const text of [savedText, readText]) assert.doesNotMatch(text, /hpp|unit_cost|estimated_contribution|cost_version/i);
		const costs = await handleFinance(admin.browser.request(`/api/v1/admin/products/${productId}/contribution-reviews`), f.identity);
		assert.equal(costs.status, 403, "the contribution review stays behind finance.costs.read");
	} finally {
		await cleanup(f.identity, [admin]);
		await f.close();
	}
});
