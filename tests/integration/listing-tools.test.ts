import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildCsv, collectPages, productExportColumns, stockItemExportColumns } from "../../src/components/admin/csv-export.ts";
import { offerAvailability } from "../../src/components/admin/limiting-component.ts";
import { duplicateBody, newCopyTag } from "../../src/components/admin/product-duplicate.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { getPrincipal } from "../../src/modules/access/policy.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { appendCostVersion } from "../../src/modules/finance/costs.ts";
import { handleFinance } from "../../src/modules/finance/routes.ts";
import { handleInventory } from "../../src/modules/inventory/routes.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";

type Actor = Awaited<ReturnType<typeof actor>>;
// biome-ignore lint/suspicious/noExplicitAny: synthetic API payloads
type Json = Record<string, any>;

// S160: duplicate (draft, no stock, no HPP), the limiting-component hint on real balances, and the CSV export of a filtered list.
test("listing tools: duplicate makes an untouched-original draft; export equals the filtered rows and never carries a cost", async () => {
	const identity = createLocalAuth("test");
	const users: Actor[] = [];
	const [wh] = await identity.sql`insert into app.warehouse (name,city) values ('Synthetic Listing','Malang') returning id`;
	try {
		const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
		const admin = await actor(identity, "ecommerce_admin", [wh.id]); users.push(admin); await enroll(admin.browser, admin.password);
		const call = async (user: Actor, method: string, path: string, body?: Json, handler = handleCatalog) => {
			const req = user.browser.request(`/api/v1/admin${path}`, body); req.headers.set("idempotency-key", randomUUID());
			const response = await handler(new Request(req, { method }), identity);
			return { status: response.status, payload: (await response.json()) as Json };
		};
		const ok = async (user: Actor, method: string, path: string, body?: Json, expected = 201, handler = handleCatalog) => {
			const r = await call(user, method, path, body, handler); assert.equal(r.status, expected, JSON.stringify(r.payload)); return r.payload;
		};
		const tag = randomUUID().slice(0, 8);
		const category = await ok(owner, "POST", "/categories", { name: `Synthetic listing ${tag}`, slug: `synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [] });
		const kopi = await ok(owner, "POST", "/stock-items", { sku: `LST-K-${randomUUID()}`.toUpperCase(), name: `Synthetic kopi ${tag}` });
		const gula = await ok(owner, "POST", "/stock-items", { sku: `LST-G-${randomUUID()}`.toUpperCase(), name: `Synthetic gula ${tag}` });
		const name = `Synthetic listing ${tag}`;
		const original = await ok(owner, "POST", "/products", { name, category_id: category.id, description: "Deskripsi sintetis", images: [{ url: "https://example.invalid/l.webp", alt: "Sintetis", width: 100, height: 100 }], variants: [
			{ sku: `LST-U-${randomUUID()}`.toUpperCase(), label: "Kopi satuan", attributes: [], offer_kind: "unit", price: 25000, weight_grams: 100, length_mm: 100, width_mm: 100, height_mm: 100, default_warehouse_id: wh.id, contents: [{ stock_item_id: kopi.id, name: kopi.name, quantity: 1 }] },
			{ sku: `LST-B-${randomUUID()}`.toUpperCase(), label: "Paket kopi gula", attributes: [], offer_kind: "bundle", price: 40000, weight_grams: 300, length_mm: 100, width_mm: 100, height_mm: 100, default_warehouse_id: wh.id,
				contents: [{ stock_item_id: kopi.id, name: kopi.name, quantity: 2 }, { stock_item_id: gula.id, name: gula.name, quantity: 1 }] }] });

		// Balances: kopi 5 (-> 2 bundles), gula 2 (-> 2 bundles): gula/kopi tie broken below by changing gula to 1.
		for (const [item, quantity] of [[kopi.id, 5], [gula.id, 1]] as const)
			await ok(owner, "POST", "/inventory/movements", { warehouse_id: wh.id, stock_item_id: item, kind: "receive", quantity, expected_version: 0, reason: "Synthetic listing stock" }, 201, handleInventory);
		const principal = await getPrincipal(owner.browser.request("/api/v1/me"), identity);
		const HPP = 43217;
		const req = owner.browser.request("/api/v1/admin/x", {}); req.headers.set("idempotency-key", randomUUID());
		await appendCostVersion(req, identity, principal, "component", kopi.id, { unit_cost: HPP, expected_version: 0, effective_from: null, source: "Synthetic supplier", reason: "Synthetic HPP" });

		// The hint reads the real positions: bundle = min(5/2 -> 2, 1/1 -> 1) = 1, limited by gula.
		const positions = (await ok(owner, "GET", `/inventory?stock_item_id=${kopi.id}`, undefined, 200, handleInventory)).data.concat((await ok(owner, "GET", `/inventory?stock_item_id=${gula.id}`, undefined, 200, handleInventory)).data);
		const full = (await ok(owner, "GET", `/products/${original.id}`, undefined, 200)) as Json;
		const bundle = full.variants.find((v: Json) => v.offer_kind === "bundle");
		const availability = offerAvailability(bundle.contents, positions, wh.id);
		assert.equal(availability.units, 1);
		assert.equal(availability.limiting?.name, gula.name);

		const counts = async () => {
			const ids = [kopi.id, gula.id];
			const [m] = await identity.sql`select count(*)::int as n from app.stock_movement m join app.inventory_balance b on b.id=m.balance_id where b.stock_item_id in ${identity.sql(ids)}`;
			const [c] = await identity.sql`select count(*)::int as n from app.component_cost_version where stock_item_id in ${identity.sql(ids)}`;
			const [a] = await identity.sql`select count(*)::int as n from app.offer_cost_assumption_version where offer_id in ${identity.sql(original.variants.map((v: Json) => v.id))}`;
			const [s] = await identity.sql`select count(*)::int as n from app.stock_item`;
			return { movements: m.n, costs: c.n, assumptions: a.n, skus: s.n };
		};
		const before = await counts();
		assert.equal(before.costs, 1);

		// Duplicate through the ordinary create API with the body the Duplikat button builds.
		const copy = await ok(admin, "POST", "/products", duplicateBody(full as never, newCopyTag()));
		assert.notEqual(copy.id, original.id);
		assert.notEqual(copy.catalog_id, original.catalog_id);
		assert.equal(copy.name, `${name} (salinan)`);
		assert.equal(copy.category_id, category.id);
		assert.equal(copy.description, "Deskripsi sintetis");
		assert.deepEqual(copy.images, full.images);
		assert.equal(copy.variants.length, 2);
		const byLabel = (rows: Json[]) => Object.fromEntries(rows.map((v) => [v.label, v]));
		const was = byLabel(full.variants); const now = byLabel(copy.variants);
		for (const label of Object.keys(was)) {
			assert.notEqual(now[label].id, was[label].id); assert.notEqual(now[label].sku, was[label].sku); assert.notEqual(now[label].catalog_id, was[label].catalog_id);
			assert.equal(now[label].price, was[label].price);
			assert.deepEqual(now[label].contents, was[label].contents);
			assert.equal(now[label].default_warehouse_id, wh.id);
		}
		const after = await counts();
		assert.deepEqual({ ...after, assumptions: before.assumptions }, { ...before, assumptions: before.assumptions }, "no new stock movement, cost version or SKU");
		const [copied] = await identity.sql`select count(*)::int as n from app.offer_cost_assumption_version where offer_id in ${identity.sql(copy.variants.map((v: Json) => v.id))}`;
		assert.equal(copied.n, 0, "the copy starts with no cost assumption");
		const summary = (await ok(owner, "GET", `/products?q=${encodeURIComponent(name)}`, undefined, 200)).data as Json[];
		assert.equal(summary.length, 2);
		const copySummary = summary.find((r) => r.id === copy.id);
		assert.ok(copySummary);
		assert.equal(copySummary.latest_publication_version, 0); assert.equal(copySummary.published_revision, null); assert.notEqual(copySummary.state, "published");
		// The original did not change.
		const reread = (await ok(owner, "GET", `/products/${original.id}`, undefined, 200)) as Json;
		assert.deepEqual(reread, full);
		// Owner and ecommerce_admin may both duplicate; a warehouse-only caller may not create.
		const wo = await actor(identity, "warehouse", [wh.id]); users.push(wo); await enroll(wo.browser, wo.password);
		assert.equal((await call(wo, "POST", "/products", duplicateBody(full as never, newCopyTag()))).status, 403);

		// Export: the filtered, sorted, paginated list equals the exported rows; limit 1 forces the cursor walk.
		const fetchProducts = (user: Actor, query: string) => collectPages<Json>(async (cursor) => {
			const r = await call(user, "GET", `/products?${query}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
			return r.status === 200 ? { ok: true, rows: r.payload.data, next: r.payload.pagination.next_cursor } : { ok: false, text: String(r.status) };
		}, (r) => r.id);
		const exported = await fetchProducts(owner, `q=${encodeURIComponent(name)}&sort=name&dir=desc`);
		assert.ok(exported.ok);
		assert.deepEqual(exported.rows.map((r) => r.id), [...summary].sort((a, b) => b.name.localeCompare(a.name)).map((r) => r.id), "same rows in the same sorted order");
		assert.equal(exported.rows.length, 2);
		const none = await fetchProducts(owner, `q=${encodeURIComponent(`${name} nope`)}`);
		assert.ok(none.ok); assert.equal(none.rows.length, 0);
		const csv = buildCsv(productExportColumns(true), exported.rows as never);
		assert.equal(csv.split("\r\n").length, 4, "header, two rows and the empty tail after the last CRLF");
		assert.ok(csv.includes(name) && csv.includes(`${name} (salinan)`));

		// No cost anywhere in the export, for the owner and for ecommerce_admin (who has no finance.costs.read).
		for (const user of [owner, admin]) {
			const rows = await fetchProducts(user, `q=${encodeURIComponent(name)}`); assert.ok(rows.ok);
			const text = buildCsv(productExportColumns(true), rows.rows as never);
			assert.ok(!/hpp|biaya|cost|margin|kontribusi/i.test(text.split("\r\n")[0]), "no cost header");
			assert.ok(!text.includes(String(HPP)), "no HPP amount");
			assert.ok(rows.rows.every((r) => !("estimated_hpp" in r) && !("unit_cost" in r)));
		}
		assert.equal((await call(admin, "GET", `/stock-items/${kopi.id}/cost-versions`, undefined, handleFinance)).status === 200, false, "ecommerce_admin cannot read the HPP history either");

		// SKU list export: matches the filtered rows, codes and names only.
		const skus = await collectPages<Json>(async (cursor) => {
			const r = await call(admin, "GET", `/stock-items?q=${encodeURIComponent(tag)}&sort=sku&dir=asc&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
			return r.status === 200 ? { ok: true, rows: r.payload.data, next: r.payload.pagination.next_cursor } : { ok: false, text: String(r.status) };
		}, (r) => r.id);
		assert.ok(skus.ok); assert.deepEqual(skus.rows.map((r) => r.sku).sort(), [kopi.sku, gula.sku].sort());
		const skuCsv = buildCsv(stockItemExportColumns, skus.rows as never);
		assert.equal(skuCsv.split("\r\n")[0], "﻿SKU,Nama"); assert.ok(!skuCsv.includes(String(HPP)));
	} finally {
		await cleanup(identity, users);
		await identity.sql`update app.warehouse set active=false where id=${wh.id}`;
		await identity.sql.end();
	}
});
