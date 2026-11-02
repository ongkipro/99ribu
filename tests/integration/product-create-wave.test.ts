import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";
import type { LocalAuth } from "../../src/modules/access/auth.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { handleFinance } from "../../src/modules/finance/routes.ts";
import { handleInventory } from "../../src/modules/inventory/routes.ts";
import {
	assumptionBody,
	componentKey,
	costVersionBody,
	countNewLines,
	factsPatch,
	type Line,
	newComponentName,
	newComponentSku,
	newLine,
	type Offer,
	offerHasHpp,
	parseHpp,
	parseQuantity,
	positionVersion,
	productBody,
	Refused,
	receiveBody,
	receivePairs,
	runIndependent,
	validate,
} from "../../src/components/admin/product-create-model.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";

// S152 (R3: stock receive, cost): the create sequence of "Tambah produk" at the HTTP handler boundary the console calls.
// The React component only orders these calls, so `createDraft` below repeats its order with the same pure model builders:
// new stock items, product, attributes, HPP (finance.costs.write only), then ONE receive per component and warehouse.
type User = Awaited<ReturnType<typeof actor>>;
type Handler = (request: Request, identity: LocalAuth) => Promise<Response>;
const identity = createLocalAuth("test");
const users: User[] = [];
const run = randomUUID().slice(0, 8).toUpperCase();
const root = "/api/v1/admin";
let owner: User;
let admin: User;
let warehouse = "";
let otherWarehouse = "";
let category = "";

async function staff(role: Parameters<typeof actor>[1], warehouseIds: string[] = []) {
	const user = await actor(identity, role, warehouseIds);
	users.push(user);
	await enroll(user.browser, user.password);
	return user;
}
async function call(user: User, handler: Handler, method: string, path: string, body?: unknown, key: string | null = method === "GET" ? null : randomUUID()) {
	const request = user.browser.request(`${root}${path}`, body as Record<string, unknown> | undefined);
	const sent = new Request(request, { method });
	if (key) sent.headers.set("idempotency-key", key);
	const response = await handler(sent, identity);
	const text = await response.text();
	// biome-ignore lint/suspicious/noExplicitAny: the assertions read differently shaped response bodies
	return { status: response.status, text, json: (text ? JSON.parse(text) : {}) as Record<string, any> };
}
const catalog = (u: User, m: string, p: string, b?: unknown, k?: string | null) => call(u, handleCatalog, m, p, b, k);
const finance = (u: User, m: string, p: string, b?: unknown, k?: string | null) => call(u, handleFinance, m, p, b, k);
const inventory = (u: User, m: string, p: string, b?: unknown, k?: string | null) => call(u, handleInventory, m, p, b, k);

const count = async (query: Promise<{ n: number }[]>) => (await query)[0].n;
const receives = (stockIds: string[]) =>
	count(identity.sql`select count(*)::int n from app.stock_movement m join app.inventory_balance b on b.id=m.balance_id where m.kind='receive' and b.stock_item_id in ${identity.sql(stockIds)}`);

type Draft = { title: string; offers: Offer[]; stock?: Record<string, string>; hpp?: Record<string, string>; costsWrite: boolean; facts?: Record<string, string> };
/** The client's step state: keys and what succeeded survive a re-run, exactly like the refs of the form. */
const newState = () => ({ keys: new Map<string, string>(), frozen: new Map<string, string>(), stock: {} as Record<string, { id: string; name: string }>, product: undefined as undefined | { id: string; variants: { id: string; sku: string }[] }, done: new Set<string>(), calls: 0, log: [] as string[], pending: [] as { id: string; label: string; text: string }[] });
type State = ReturnType<typeof newState>;
const line = (key: string, over: Partial<Line> = {}): Line => ({ ...newLine(Number(over.n ?? 1), key), ...over });
const offerOf = (label: string, price: string, lines: Line[], over: Partial<Offer> = {}): Offer => ({ key: randomUUID(), n: 1, label, price, weight: "400", warehouse, lines, ...over });

/** `tolerate`: step ids that may stay pending (a refused step must not stop the others); any other pending step fails the test. */
async function createDraft(user: User, draft: Draft, state: State, base: string, receivable = new Set([warehouse]), tolerate: (id: string) => boolean = () => false) {
	const key = (step: string) => {
		const value = state.keys.get(step) ?? randomUUID();
		state.keys.set(step, value);
		return value;
	};
	const send = async (handler: Handler, method: string, path: string, body: unknown, step: string) => {
		state.calls++;
		state.log.push(`${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id")}`);
		const res = await call(user, handler, method, path, body, key(step));
		if (res.status >= 400 && res.status < 500) state.keys.delete(step);
		return res;
	};
	/** The component's `post`: a non-2xx answer is a refusal of that one step. */
	const must = async (handler: Handler, method: string, path: string, body: unknown, step: string, ok: number) => {
		const res = await send(handler, method, path, body, step);
		if (res.status !== ok) throw new Refused(res.status, res.json.code ?? null, res.text);
		return res;
	};
	const { offers } = draft;
	const errors = validate({ name: draft.title, category, photos: 1, offers, hpp: draft.hpp ?? {}, costsWrite: draft.costsWrite, stock: draft.stock ?? {}, receivable });
	assert.deepEqual(errors, {}, "the form would refuse this draft");
	const newCount = countNewLines(offers);
	const nameOf = (l: Line, o: Offer) => (l.mode === "existing" && l.picked ? l.picked.name : newComponentName(l, draft.title, o, offers.length));
	const skuOf = (l: Line) => newComponentSku(base, l, newCount);
	const stockIdOf = (l: Line) => (l.mode === "existing" ? (l.picked as { id: string }).id : state.stock[l.key].id);
	const offerSkuOf = (o: Offer) => (o.lines[0].mode === "new" ? `${skuOf(o.lines[0])}_OFFER` : `${base}-O${o.n}_OFFER`);
	for (const o of offers)
		for (const l of o.lines) {
			if (l.mode !== "new" || state.stock[l.key]) continue;
			const body = { sku: skuOf(l), name: nameOf(l, o) };
			const res = await send(handleCatalog, "POST", "/stock-items", body, `stock:${l.key}`);
			assert.equal(res.status, 201, res.text);
			state.stock[l.key] = { id: res.json.id, name: body.name };
		}
	if (!state.product) {
		const body = productBody({ title: draft.title, description: "Synthetic only", category, photos: [{ url: "https://example.invalid/media/catalog/x.webp", width: 800, height: 800 }], offers, stockIdOf, componentNameOf: nameOf, offerSkuOf });
		const res = await send(handleCatalog, "POST", "/products", body, "product");
		assert.equal(res.status, 201, res.text);
		state.product = res.json as State["product"];
	}
	const product = state.product as NonNullable<State["product"]>;
	// Every step after the product is independent, as in the component (runIndependent).
	const steps: { id: string; label: string; run: () => Promise<void> }[] = [];
	const patchRules = [{ key: "bahan", label: "Bahan", value_type: "text" as const, required: false, allowed_values: [] }];
	if (draft.facts && factsPatch(patchRules, draft.facts) && !state.done.has("facts"))
		steps.push({ id: "facts", label: "Atribut", run: async () => {
			let body = state.frozen.get("facts");
			if (!body) {
				// The draft may have been edited since it was created: patch against the version it has now.
				const read = await catalog(user, "GET", `/products/${product.id}`);
				assert.equal(read.status, 200, read.text);
				body = JSON.stringify(factsPatch(patchRules, draft.facts as Record<string, string>, read.json.version));
				state.frozen.set("facts", body);
			}
			await must(handleCatalog, "PATCH", `/products/${product.id}`, JSON.parse(body), "facts", 200);
			state.done.add("facts");
		} });
	if (draft.costsWrite)
		for (const o of offers) {
			for (const l of o.lines) {
				const ck = componentKey(l), value = l.mode === "new" ? parseHpp(draft.hpp?.[ck] ?? "") : null;
				if (value === null || state.done.has(`hpp:${ck}`)) continue;
				steps.push({ id: `hpp:${ck}`, label: "HPP", run: async () => {
					await must(handleFinance, "POST", `/stock-items/${stockIdOf(l)}/cost-versions`, costVersionBody(value), `hpp:${ck}`, 201);
					state.done.add(`hpp:${ck}`);
				} });
			}
			const row = product.variants.find((v) => v.sku === offerSkuOf(o));
			if (row && offerHasHpp(o, draft.hpp ?? {}) && !state.done.has(`assumption:${o.key}`))
				steps.push({ id: `assumption:${o.key}`, label: "Asumsi", run: async () => {
					await must(handleFinance, "POST", `/offers/${row.id}/cost-assumption-versions`, assumptionBody(), `assumption:${o.key}`, 201);
					state.done.add(`assumption:${o.key}`);
				} });
		}
	for (const pair of receivePairs(offers)) {
		const quantity = parseQuantity(draft.stock?.[pair.key] ?? ""), id = `receive:${pair.key}`;
		if (quantity === null || !receivable.has(pair.warehouse) || state.done.has(id)) continue;
		steps.push({ id, label: "Stok", run: async () => {
			for (let attempt = 0; ; attempt++) {
				let body = state.frozen.get(id);
				if (!body) {
					let version = 0;
					// A new SKU starts at version 0; an existing one, or a retry after a 409, reads the position first.
					if (pair.line.mode === "existing" || attempt > 0) {
						const read = await inventory(user, "GET", `/inventory?warehouse_id=${pair.warehouse}&stock_item_id=${stockIdOf(pair.line)}&limit=100`);
						assert.equal(read.status, 200);
						version = positionVersion(read.json.data);
					}
					body = JSON.stringify(receiveBody(pair.warehouse, stockIdOf(pair.line), quantity, version));
					state.frozen.set(id, body);
				}
				try {
					await must(handleInventory, "POST", "/inventory/movements", JSON.parse(body), id, 201);
					state.done.add(id);
					return;
				} catch (error) {
					if (attempt > 0 || !(error instanceof Refused) || error.status !== 409) throw error;
					state.keys.delete(id);
					state.frozen.delete(id);
				}
			}
		} });
	}
	state.pending = await runIndependent(steps, (id) => {
		state.keys.delete(id);
		state.frozen.delete(id);
	});
	const unexpected = state.pending.filter((p) => !tolerate(p.id));
	assert.deepEqual(unexpected, [], "a step stayed pending");
	return product;
}
const blockers = async (productId: string) => {
	const res = await catalog(owner, "GET", `/products/${productId}/publications`);
	assert.equal(res.status, 200, res.text);
	return (res.json.blockers as { code: string }[]).map((b) => b.code);
};
const twoParts = () => [line("a", { n: 1, newName: `Wadah ${run} A` }), line("b", { n: 2, newName: `Wadah ${run} B`, quantity: "2" })];

before(async () => {
	warehouse = (await identity.sql`insert into app.warehouse (name,city) values (${`Synthetic S152 ${run}`},'Malang') returning id`)[0].id as string;
	otherWarehouse = (await identity.sql`insert into app.warehouse (name,city) values (${`Synthetic S152 other ${run}`},'Kediri') returning id`)[0].id as string;
	owner = await staff("owner");
	admin = await staff("ecommerce_admin", [warehouse]);
	const made = await catalog(owner, "POST", "/categories", { name: `Synthetic S152 ${run}`, slug: `s152-${run.toLowerCase()}`, parent_id: null, attribute_definitions: [] });
	assert.equal(made.status, 201, made.text);
	category = made.json.id;
});
after(async () => {
	await cleanup(identity, users);
	await identity.sql`update app.warehouse set active=false where id in (${warehouse},${otherWarehouse})`;
	await identity.sql.end();
});

test("S152 a two-component offer is created as a draft at its own price, and publication stays blocked until stock and HPP exist", async () => {
	const base = `S152A${run}`;
	const state = newState();
	// The ecommerce admin has no cost grant: no HPP is built, no stock is typed.
	const offer = offerOf("Paket Wadah", "49000", twoParts());
	const product = await createDraft(admin, { title: `Set Wadah ${run}`, offers: [offer], costsWrite: false }, state, base);
	const read = await catalog(owner, "GET", `/products/${product.id}`);
	assert.equal(read.status, 200);
	assert.equal(read.json.state ?? "draft", "draft");
	const [variant] = read.json.variants;
	assert.equal(variant.offer_kind, "bundle");
	assert.equal(variant.price, 49000, "the price stands alone and is not the sum of the parts");
	assert.deepEqual(variant.contents.map((c: { quantity: number }) => c.quantity).sort(), [1, 2]);
	assert.equal(variant.default_warehouse_id, warehouse);
	const live = await identity.sql`select count(*)::int n from app.publication_head h where h.product_id=${product.id} and h.revision>0`;
	assert.equal(live[0].n, 0, "never published by the create sequence");

	const stockIds = Object.values(state.stock).map((s) => s.id);
	assert.equal(stockIds.length, 2);
	assert.equal(await receives(stockIds), 0, "no free stock number, no movement unless typed");
	assert.equal(await count(identity.sql`select count(*)::int n from app.component_cost_version where stock_item_id in ${identity.sql(stockIds)}`), 0, "HPP stays unknown");

	const first = await blockers(product.id);
	assert.ok(first.includes("COMPLETE_STOCK_REQUIRED"), `stock blocker expected in ${first}`);
	const costBlockers = first.filter((code) => code !== "COMPLETE_STOCK_REQUIRED");
	assert.ok(costBlockers.length > 0, `a cost blocker expected in ${first}`);

	// Stock by the admin (inventory write for this warehouse): the stock blocker goes, the cost blocker stays.
	for (const [i, id] of stockIds.entries()) assert.equal((await inventory(admin, "POST", "/inventory/movements", receiveBody(warehouse, id, 10 + i, 0))).status, 201);
	const afterStock = await blockers(product.id);
	assert.ok(!afterStock.includes("COMPLETE_STOCK_REQUIRED"));
	assert.ok(afterStock.length > 0, `still blocked without HPP: ${afterStock}`);

	// HPP and the offer's cost assumptions by the owner clear the cost blockers.
	for (const id of stockIds) assert.equal((await finance(owner, "POST", `/stock-items/${id}/cost-versions`, costVersionBody(5000))).status, 201);
	const assumptions = { expected_version: 0, effective_from: null, packaging_idr: 1000, provider_fee_idr: 1000, subsidy_idr: 5000, returns_reserve_idr: 1000, source: "Synthetic", reason: "Synthetic" };
	assert.equal((await finance(owner, "POST", `/offers/${product.variants[0].id}/cost-assumption-versions`, assumptions)).status, 201);
	const afterCost = await blockers(product.id);
	assert.ok(afterCost.every((c) => !costBlockers.includes(c)), `cost blockers remain: ${afterCost}`);
});

test("S152 initial stock is exactly one receive movement per component and warehouse, with HPP and attributes saved by the owner", async () => {
	const base = `S152B${run}`;
	const state = newState();
	const shared = await catalog(owner, "POST", "/stock-items", { sku: `${base}-SHARED`, name: `Barang bersama ${run}` });
	assert.equal(shared.status, 201);
	const picked = { id: shared.json.id as string, sku: shared.json.sku as string, name: shared.json.name as string };
	const parts = twoParts();
	// The shared SKU sits in both offers and the same warehouse, so it is ONE pair and ONE movement.
	const offers = [
		offerOf("Paket A", "39000", [...parts, line("x1", { n: 3, mode: "existing", picked })]),
		offerOf("Paket B", "29000", [line("x2", { n: 4, mode: "existing", picked })], { n: 2 }),
	];
	const hpp = { [componentKey(parts[0])]: "4000", [componentKey(parts[1])]: "3000" };
	const stock = { [`${componentKey(parts[0])}|${warehouse}`]: "12", [`${componentKey(parts[1])}|${warehouse}`]: "7", [`id:${picked.id}|${warehouse}`]: "5" };
	const product = await createDraft(owner, { title: `Dua Paket ${run}`, offers, costsWrite: true, hpp, stock, facts: { bahan: "Kaca" } }, state, base);
	const ids = [...Object.values(state.stock).map((s) => s.id), picked.id];
	assert.equal(ids.length, 3);
	assert.equal(await receives(ids), 3, "one receive per component and warehouse");
	const rows = await identity.sql`select b.stock_item_id, m.on_hand_delta, m.actor_id from app.stock_movement m join app.inventory_balance b on b.id=m.balance_id where m.kind='receive' and b.stock_item_id in ${identity.sql(ids)}`;
	assert.deepEqual(rows.map((r) => r.on_hand_delta).sort((a, b) => a - b), [5, 7, 12]);
	assert.ok(rows.every((r) => r.actor_id === owner.id));
	const costed = ids.slice(0, 2);
	assert.equal(await count(identity.sql`select count(*)::int n from app.component_cost_version where stock_item_id in ${identity.sql(costed)} and unit_cost in (4000,3000)`), 2);
	assert.equal(await count(identity.sql`select count(*)::int n from app.component_cost_version where stock_item_id=${picked.id}`), 0, "an existing SKU's HPP is not touched from this form");
	const offerIds = product.variants.map((v) => v.id);
	// Default assumptions only for the offer whose HPP was typed here: Paket B holds only an existing SKU.
	assert.equal(await count(identity.sql`select count(*)::int n from app.offer_cost_assumption_version where offer_id in ${identity.sql(offerIds)}`), 1);
	assert.equal(await count(identity.sql`select count(*)::int n from app.offer_cost_assumption_version where offer_id=${(product.variants.find((v) => v.sku === `${base}-O2_OFFER`) as { id: string }).id}`), 0, "no HPP typed for Paket B, so no assumptions");
	const [written] = await identity.sql`select reason from app.offer_cost_assumption_version where offer_id in ${identity.sql(offerIds)}`;
	assert.match(written.reason, /default/);
	const read = await catalog(owner, "GET", `/products/${product.id}`);
	assert.deepEqual(read.json.facts.map((f: { key: string; values: string[] }) => [f.key, f.values]), [["bahan", ["Kaca"]]]);
	assert.ok(!(await blockers(product.id)).includes("COMPLETE_STOCK_REQUIRED"), "stock now exists");
});

test("S152 a role without the cost grant sends no HPP, and the API refuses a forged one", async () => {
	const base = `S152C${run}`;
	const state = newState();
	const parts = [line("a", { n: 1 })];
	const hpp = { [componentKey(parts[0])]: "4000" };
	// costsWrite=false: the typed value is ignored by the form (validate and sequence both skip it).
	await createDraft(admin, { title: `Tanpa HPP ${run}`, offers: [offerOf("Satuan", "19000", parts)], costsWrite: false, hpp }, state, base);
	const id = state.stock[parts[0].key].id;
	assert.equal(await count(identity.sql`select count(*)::int n from app.component_cost_version where stock_item_id=${id}`), 0);
	const forged = await finance(admin, "POST", `/stock-items/${id}/cost-versions`, costVersionBody(4000));
	assert.equal(forged.status, 403);
	assert.equal(await count(identity.sql`select count(*)::int n from app.component_cost_version where stock_item_id=${id}`), 0, "nothing written by the refused request");
	// An admin outside the warehouse cannot receive stock there either.
	const outsider = await staff("ecommerce_admin", []);
	const refused = await inventory(outsider, "POST", "/inventory/movements", receiveBody(warehouse, id, 5, 0));
	assert.ok([403, 404].includes(refused.status), `outside the warehouse scope, got ${refused.status}`);
	assert.equal(await receives([id]), 0);
});

test("S152 re-running a half-finished create does not duplicate, and a lost response replays on the same key", async () => {
	const base = `S152D${run}`;
	const parts = twoParts();
	const offers = [offerOf("Paket Ulang", "35000", parts)];
	const hpp = { [componentKey(parts[0])]: "2000", [componentKey(parts[1])]: "2500" };
	const stock = { [`${componentKey(parts[0])}|${warehouse}`]: "3", [`${componentKey(parts[1])}|${warehouse}`]: "4" };
	const draft: Draft = { title: `Ulang ${run}`, offers, costsWrite: true, hpp, stock };
	// Half-finished: the SKUs and the product exist, nothing after.
	const half = newState();
	const probe = { ...draft, costsWrite: false, stock: {} };
	await createDraft(owner, probe, half, base);
	const callsBefore = half.calls;
	// Continue from the same state: the finished steps are not sent again, the rest are.
	const product = await createDraft(owner, draft, half, base);
	const ids = Object.values(half.stock).map((s) => s.id);
	assert.equal(half.calls - callsBefore, 2 + 1 + 2, "only the HPP, assumption and receive steps ran");
	assert.deepEqual(half.pending, []);
	// Running the whole thing again sends nothing and changes nothing.
	const again = half.calls;
	await createDraft(owner, draft, half, base);
	assert.equal(half.calls, again);
	assert.equal(await count(identity.sql`select count(*)::int n from app.stock_item where sku like ${`${base}%`}`), 2);
	assert.equal(await count(identity.sql`select count(*)::int n from app.product_revision where product_id=${product.id}`), 1);
	assert.equal(await receives(ids), 2);
	assert.equal(await count(identity.sql`select count(*)::int n from app.component_cost_version where stock_item_id in ${identity.sql(ids)}`), 2);
	// Lost response: the same key and body replays the saved result; the same key with another body is a conflict.
	const key = half.keys.get("product") as string;
	const body = productBody({ title: draft.title, description: "Synthetic only", category, photos: [{ url: "https://example.invalid/media/catalog/x.webp", width: 800, height: 800 }], offers,
		stockIdOf: (l) => half.stock[l.key].id, componentNameOf: (l, o) => newComponentName(l, draft.title, o, 1), offerSkuOf: (o) => `${newComponentSku(base, o.lines[0], 2)}_OFFER` });
	const replay = await catalog(owner, "POST", "/products", body, key);
	assert.equal(replay.status, 201);
	assert.equal(replay.json.id, product.id);
	const conflict = await catalog(owner, "POST", "/products", { ...body, name: `${body.name} x` }, key);
	assert.equal(conflict.json.code, "IDEMPOTENCY_CONFLICT");
	const receiveKey = half.keys.get(`receive:${receivePairs(offers)[0].key}`) as string;
	const receiveReplay = await inventory(owner, "POST", "/inventory/movements", JSON.parse(half.frozen.get(`receive:${receivePairs(offers)[0].key}`) as string), receiveKey);
	assert.equal(receiveReplay.status, 201);
	assert.equal(await receives(ids), 2, "a replayed receive adds no movement");
});

test("S152 an existing SKU is found by the server search and reused: one SKU row, a receive with its own position version", async () => {
	const base = `S152E${run}`;
	const stock = await catalog(owner, "POST", "/stock-items", { sku: `${base}-SHARED`, name: `Gelas lintas ${run}` });
	assert.equal(stock.status, 201);
	// First receive moves the position version, so the second must carry version 1, not 0.
	assert.equal((await inventory(owner, "POST", "/inventory/movements", receiveBody(warehouse, stock.json.id, 5, 0))).status, 201);
	const found = await catalog(admin, "GET", `/stock-items?q=${encodeURIComponent(`lintas ${run}`)}&limit=8`);
	assert.equal(found.status, 200);
	assert.deepEqual(found.json.data.map((r: { id: string }) => r.id), [stock.json.id]);
	const picked = found.json.data[0] as { id: string; sku: string; name: string };
	const lines = [line("a", { n: 1, mode: "existing", picked }), line("b", { n: 2, newName: `Tutup ${run}`, quantity: "3" })];
	const offers = [offerOf("Gelas dan tutup", "25000", lines)];
	const state = newState();
	const product = await createDraft(owner, { title: `Gelas ${run}`, offers, costsWrite: false, stock: { [`id:${picked.id}|${warehouse}`]: "6", [`${componentKey(lines[1])}|${warehouse}`]: "9" } }, state, base);
	assert.equal(Object.keys(state.stock).length, 1, "only the new line created a SKU");
	assert.equal(await count(identity.sql`select count(*)::int n from app.stock_item where id=${picked.id}`), 1);
	const total = await identity.sql`select sum(on_hand)::int n from app.inventory_balance where stock_item_id=${picked.id} and warehouse_id=${warehouse}`;
	assert.equal(total[0].n, 11);
	assert.equal(await receives([picked.id]), 2);
	const read = await catalog(owner, "GET", `/products/${product.id}`);
	assert.ok(read.json.variants[0].contents.some((c: { stock_item_id: string }) => c.stock_item_id === picked.id));
	// The API also refuses the same SKU twice in one offer.
	const dup = productBody({ title: `Dup ${run}`, description: "x", category, photos: [], offers: [offerOf("Dup", "1000", [line("a", { mode: "existing", picked }), line("b", { n: 2, mode: "existing", picked })])],
		stockIdOf: () => picked.id, componentNameOf: () => picked.name, offerSkuOf: () => `${base}-DUP_OFFER` });
	const refused = await catalog(owner, "POST", "/products", dup);
	assert.equal(refused.json.code, "DUPLICATE_COMPONENT");
});

test("S152 a refused step does not stop the others, and the retry repeats only the failed steps", async () => {
	const base = `S152F${run}`;
	const state = newState();
	const parts = twoParts();
	const offers = [offerOf("Paket Sebagian", "40000", parts)];
	const hpp = { [componentKey(parts[0])]: "2000", [componentKey(parts[1])]: "2500" };
	const stock = { [`${componentKey(parts[0])}|${warehouse}`]: "3", [`${componentKey(parts[1])}|${warehouse}`]: "4" };
	// The admin has no finance.costs.write: the form was shown the HPP column (a stale grant), the API answers 403 to every cost step.
	const draft: Draft = { title: `Sebagian ${run}`, offers, costsWrite: true, hpp, stock, facts: { bahan: "Kaca" } };
	// Someone edits the new draft between the product POST and the attribute PATCH: expected_version 1 would be a 409.
	const probe = await createDraft(admin, { ...draft, costsWrite: false, stock: {}, facts: undefined }, state, base);
	assert.equal((await catalog(owner, "PATCH", `/products/${probe.id}`, { expected_version: 1, reason: "Edit bersamaan", facts: [{ key: "lain", label: "Lain", values: ["x"] }] })).status, 200);
	state.log.length = 0;
	await createDraft(admin, draft, state, base, new Set([warehouse]), (id) => id.startsWith("hpp:") || id.startsWith("assumption:"));
	assert.deepEqual(state.pending.map((p) => p.id.split(":")[0]).sort(), ["assumption", "hpp", "hpp"], "only the cost steps are pending");
	assert.ok(state.pending.every((p) => /izin|akses|Peran|FORBIDDEN/i.test(p.text)), JSON.stringify(state.pending));
	assert.ok(state.done.has("facts"), "the attribute PATCH read the fresh version and went through");
	const ids = Object.values(state.stock).map((x) => x.id);
	assert.equal(await receives(ids), 2, "the receives ran after the refused steps");
	assert.ok(!state.log.some((entry) => entry === "POST /products" || entry === "POST /stock-items"), `nothing was created twice: ${state.log}`);
	// Retry: only the three refused steps are sent again.
	state.log.length = 0;
	await createDraft(admin, draft, state, base, new Set([warehouse]), () => true);
	assert.equal(state.log.length, 3, state.log.join(", "));
	assert.ok(state.log.every((entry) => entry.includes("cost")), state.log.join(", "));
	assert.equal(await receives(ids), 2);
	assert.equal(await count(identity.sql`select count(*)::int n from app.stock_item where sku like ${`${base}%`}`), 2);
});

test("S152 the receivable warehouse list holds only the caller's own warehouses, and a receive elsewhere is refused", async () => {
	const member = await staff("ecommerce_admin", [warehouse]);
	const listed = await call(member, handleAccess, "GET", "/warehouses?limit=100");
	assert.equal(listed.status, 200, listed.text);
	const ids = (listed.json.data as { id: string }[]).map((w) => w.id);
	assert.ok(ids.includes(warehouse));
	assert.ok(!ids.includes(otherWarehouse), "a warehouse the caller is not a member of is not offered");
	assert.ok((await call(owner, handleAccess, "GET", "/warehouses?limit=100")).json.data.some((w: { id: string }) => w.id === otherWarehouse), "the owner sees every active warehouse");
	const item = await catalog(owner, "POST", "/stock-items", { sku: `S152G${run}`, name: `Luar gudang ${run}` });
	assert.equal(item.status, 201);
	const refused = await inventory(member, "POST", "/inventory/movements", receiveBody(otherWarehouse, item.json.id, 3, 0));
	assert.ok([403, 404].includes(refused.status), `outside the membership, got ${refused.status}`);
	assert.equal(await receives([item.json.id]), 0);
});

test("S152 a receive on a new SKU starts at version 0; a concurrent receive is a 409 and the fresh version succeeds once", async () => {
	const item = await catalog(admin, "POST", "/stock-items", { sku: `S152H${run}`, name: `Bersamaan ${run}` });
	assert.equal(item.status, 201);
	// A taken SKU code is a CATALOG_IDENTITY_CONFLICT: the form draws a new code instead of resending the same one.
	const taken = await catalog(admin, "POST", "/stock-items", { sku: `S152H${run}`, name: `Bersamaan lain ${run}` });
	assert.equal(taken.json.code, "CATALOG_IDENTITY_CONFLICT");
	const read = () => inventory(admin, "GET", `/inventory?warehouse_id=${warehouse}&stock_item_id=${item.json.id}&limit=100`);
	assert.equal(positionVersion((await read()).json.data), 0, "a new SKU has no position yet");
	// Someone else receives first.
	assert.equal((await inventory(owner, "POST", "/inventory/movements", receiveBody(warehouse, item.json.id, 5, 0))).status, 201);
	const stale = await inventory(admin, "POST", "/inventory/movements", receiveBody(warehouse, item.json.id, 7, 0));
	assert.equal(stale.status, 409);
	assert.equal(stale.json.code, "VERSION_CONFLICT");
	const fresh = positionVersion((await read()).json.data);
	assert.equal(fresh, 1);
	assert.equal((await inventory(admin, "POST", "/inventory/movements", receiveBody(warehouse, item.json.id, 7, fresh))).status, 201);
	const total = await identity.sql`select sum(on_hand)::int n from app.inventory_balance where stock_item_id=${item.json.id} and warehouse_id=${warehouse}`;
	assert.equal(total[0].n, 12);
});
