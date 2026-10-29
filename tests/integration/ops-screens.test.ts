import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { handleInventory } from "../../src/modules/inventory/routes.ts";
import { handlePromotions } from "../../src/modules/promotions/routes.ts";
import { actor, type BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";

// S102 read facts the ops screens depend on: inventory rows carry the SKU code/name and search by
// them (literal, scoped), movement history names its actor, transfers carry SKU and warehouse
// labels, the DEC-013 claim filter lists exactly the claim products and the product detail adds
// the read-only claim flag and Google category; promotion revise/end append versions.
type Actor = Awaited<ReturnType<typeof actor>>;
type Handler = (request: Request, identity: ReturnType<typeof createLocalAuth>) => Promise<Response>;

test("S102 ops screens: inventory search and labels, movement actor, transfer labels, DEC-013 claim filter, product review facts, promotion versions", { timeout: 300000 }, async () => {
	const identity = createLocalAuth("test");
	const users: Actor[] = [];
	const tag = randomUUID().slice(0, 8).toUpperCase();
	const [a] = await identity.sql`insert into app.warehouse (name,city) values (${`Synthetic Ops A ${tag}`},'Malang') returning id`;
	const [b] = await identity.sql`insert into app.warehouse (name,city) values (${`Synthetic Ops B ${tag}`},'Surabaya') returning id`;
	try {
		const owner = await actor(identity, "owner", []);
		users.push(owner);
		await enroll(owner.browser, owner.password);
		const call = async (handler: Handler, user: { browser: BrowserSession }, method: string, path: string, body?: Record<string, unknown>) => {
			const base = user.browser.request(`/api/v1/admin${path}`, body);
			base.headers.set("idempotency-key", randomUUID());
			const response = await handler(new Request(base, { method }), identity);
			return { status: response.status, payload: await response.json() };
		};
		const ok = async (handler: Handler, method: string, path: string, body?: Record<string, unknown>, expected = 201) => {
			const r = await call(handler, owner, method, path, body);
			assert.equal(r.status, expected, `${method} ${path} ${JSON.stringify(r.payload)}`);
			return r.payload;
		};

		// Inventory: two SKUs in A, one received; the list searches code and name literally.
		const soap = await ok(handleCatalog, "POST", "/stock-items", { sku: `OPS-${tag}-SABUN`, name: `Sabun Cair Ops ${tag}` });
		const broom = await ok(handleCatalog, "POST", "/stock-items", { sku: `OPS-${tag}-SAPU`, name: `Sapu Lantai Ops ${tag}` });
		const received = await ok(handleInventory, "POST", "/inventory/movements", { warehouse_id: a.id, stock_item_id: soap.id, lot_id: null, kind: "receive", quantity: 7, expected_version: 0, reason: "Surat jalan sintetis" });
		await ok(handleInventory, "POST", "/inventory/movements", { warehouse_id: a.id, stock_item_id: broom.id, lot_id: null, kind: "receive", quantity: 2, expected_version: 0, reason: "Surat jalan sintetis" });
		const search = async (user: Actor, query: string) => {
			const r = await call(handleInventory, user, "GET", `/inventory?${query}`);
			assert.equal(r.status, 200, JSON.stringify(r.payload));
			return r.payload.data as { id: string; sku: string; stock_item_name: string; on_hand: number; warehouse_id: string }[];
		};
		const byName = await search(owner, `q=${encodeURIComponent(`sabun cair ops ${tag}`)}`);
		assert.deepEqual(byName.map((r) => [r.sku, r.stock_item_name, r.on_hand]), [[soap.sku, soap.name, 7]], "name match, case-insensitive");
		assert.deepEqual((await search(owner, `q=${encodeURIComponent(`ops-${tag}`)}&warehouse_id=${a.id}`)).map((r) => r.sku).sort(), [soap.sku, broom.sku].sort(), "SKU code match");
		assert.deepEqual(await search(owner, `q=${encodeURIComponent(`OPS-${tag}%`)}`), [], "a % is literal, not a wildcard");
		for (const bad of ["q=", "q=%20", `q=a&q=b`]) assert.equal((await call(handleInventory, owner, "GET", `/inventory?${bad}`)).status, 400, bad);
		assert.equal((await call(handleInventory, owner, "GET", `/inventory/lots?q=x`)).status, 400, "lots take no q");

		// Warehouse staff see only their warehouse rows, even when searching.
		const keeper = await actor(identity, "warehouse", [b.id]);
		users.push(keeper);
		await enroll(keeper.browser, keeper.password);
		assert.deepEqual(await search(keeper, `q=${encodeURIComponent(`OPS-${tag}`)}`), [], "no membership in A, no A rows");

		// Movement history names the actor (display name only).
		const history = await call(handleInventory, owner, "GET", `/inventory/movements?position_id=${received.position_id}`);
		assert.equal(history.status, 200);
		assert.equal(history.payload.data[0].actor_name, "Synthetic Access");
		assert.ok(!JSON.stringify(history.payload).includes(owner.email), "no actor email in history");

		// Transfers carry the SKU and both warehouse names (warehouse staff cannot read the SKU dictionary).
		const transfer = await ok(handleInventory, "POST", "/inventory/transfers", { from_warehouse_id: a.id, to_warehouse_id: b.id, stock_item_id: soap.id, quantity: 3, reason: "Pindah sintetis" });
		assert.deepEqual([transfer.sku, transfer.stock_item_name, transfer.from_warehouse_name, transfer.to_warehouse_name], [soap.sku, soap.name, `Synthetic Ops A ${tag}`, `Synthetic Ops B ${tag}`]);
		const seen = await call(handleInventory, keeper, "GET", `/inventory/transfers?status=requested&warehouse_id=${b.id}`);
		assert.equal(seen.status, 200);
		assert.ok(seen.payload.data.some((t: { id: string; stock_item_name: string }) => t.id === transfer.id && t.stock_item_name === soap.name), "destination staff read the labels");

		// DEC-013 claim filter: a claim term in the name flags the product; a clean one is not listed.
		const category = await ok(handleCatalog, "POST", "/categories", { name: `Synthetic ops ${tag}`, slug: `synthetic-ops-${randomUUID()}`, parent_id: null, attribute_definitions: [] });
		const draft = (name: string) => ok(handleCatalog, "POST", "/products", { name, category_id: category.id, description: "Sintetis", images: [], variants: [{
			sku: `OPS-${randomUUID()}`.toUpperCase(), label: "Satuan", attributes: [], offer_kind: "unit", weight_grams: 100, length_mm: 100, width_mm: 100, height_mm: 100,
			default_warehouse_id: a.id, contents: [{ stock_item_id: soap.id, name: soap.name, quantity: 1 }] }] });
		const claim = await draft(`Korset Pelangsing Ops ${tag}`);
		const clean = await draft(`Korset Biasa Ops ${tag}`);
		const products = async (query: string) => {
			const r = await call(handleCatalog, owner, "GET", `/products?${query}`);
			assert.equal(r.status, 200, JSON.stringify(r.payload));
			return r.payload.data as { id: string; claim_review: boolean }[];
		};
		const q = `q=${encodeURIComponent(`Ops ${tag}`)}`;
		assert.deepEqual((await products(`${q}&review=claim`)).map((r) => r.id), [claim.id]);
		const all = await products(q);
		assert.deepEqual(Object.fromEntries(all.map((r) => [r.id, r.claim_review])), { [claim.id]: true, [clean.id]: false });
		for (const bad of ["review=klaim", "review=claim&review=claim", "review="]) assert.equal((await call(handleCatalog, owner, "GET", `/products?${bad}`)).status, 400, bad);
		const detail = await ok(handleCatalog, "GET", `/products/${claim.id}`, undefined, 200);
		assert.equal(detail.claim_review, true);
		assert.equal(detail.google_product_category, null, "a category outside the dataset has no Google category");
		// Replacing the claim word clears the flag (the content screen's PATCH).
		const edited = await ok(handleCatalog, "PATCH", `/products/${claim.id}`, { expected_version: detail.version, reason: "Ganti klaim", name: `Korset Ops ${tag}` }, 200);
		assert.equal(edited.version, detail.version + 1);
		assert.equal((await ok(handleCatalog, "GET", `/products/${claim.id}`, undefined, 200)).claim_review, false);
		assert.deepEqual(await products(`${q}&review=claim`), []);

		// Promotion revise and end append versions; the end keeps the configuration and turns it off.
		const now = Date.now();
		const config = { name: `Promo Ops ${tag}`, active: true, starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 86_400_000).toISOString(),
			kind: "fixed", value: 5000, maximum_per_order: 5000, minimum_merchandise: 0, budget: 100000, per_buyer_limit: 1, payment_methods: ["cod", "prepaid"],
			region_ids: [], service_ids: [], stacking: "exclusive", priority: 0 };
		const created = await ok(handlePromotions, "POST", "/shipping-promotions", { ...config, expected_version: 0, reason: "Promo sintetis" });
		const revised = await ok(handlePromotions, "POST", `/shipping-promotions/${created.id}/versions`, { ...config, budget: 150000, expected_version: 1, reason: "Tambah anggaran" });
		assert.equal(revised.version, 2);
		assert.equal((await call(handlePromotions, owner, "POST", `/shipping-promotions/${created.id}/versions`, { ...config, expected_version: 1, reason: "Versi basi" })).status, 409);
		const ended = await ok(handlePromotions, "POST", `/shipping-promotions/${created.id}/versions`, { ...config, budget: 150000, active: false, expected_version: 2, reason: "Akhiri promo" });
		assert.deepEqual([ended.version, ended.active], [3, false]);
		const versions = await call(handlePromotions, owner, "GET", `/shipping-promotions/${created.id}/versions`);
		assert.deepEqual(versions.payload.data.map((v: { version: number }) => v.version), [3, 2, 1]);
		assert.equal((await call(handlePromotions, keeper, "GET", "/shipping-promotions")).status, 403, "warehouse staff do not configure promotions");
	} finally {
		await cleanup(identity, users);
		await identity.sql`update app.warehouse set active = false where id in (${a.id}, ${b.id})`;
		await identity.sql.end();
	}
});
