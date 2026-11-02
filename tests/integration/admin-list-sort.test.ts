import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { handleOrderHistory } from "../../src/modules/finance/history-routes.ts";
import { handleInventory } from "../../src/modules/inventory/routes.ts";
import { financeFixture } from "./finance-ledger-fixture.ts";

// S150: every sortable column of the four admin lists, both directions, three consecutive pages
// (limit 2 over five rows) with deliberate ties. A page boundary must never repeat or skip a row,
// the descending sequence is the exact reverse of the ascending one (the id tie-breaker follows the
// direction), and a cursor made for another sort is 400.
type Reply = { status: number; payload: { data: Record<string, unknown>[]; pagination: { next_cursor: string | null } } };
type Get = (query: string) => Promise<Reply>;

const ROWS = 5;
const PAGE = 2;

async function walk(get: Get, base: string, sort: string, dir: string) {
	const ids: string[] = [];
	const rows: Record<string, unknown>[] = [];
	let cursor: string | null = null;
	let pages = 0;
	do {
		const reply: Reply = await get(`${base}&limit=${PAGE}&sort=${sort}&dir=${dir}${cursor ? `&cursor=${cursor}` : ""}`);
		assert.equal(reply.status, 200, `${sort} ${dir} page ${pages + 1}: ${JSON.stringify(reply.payload)}`);
		assert.ok(reply.payload.data.length <= PAGE);
		for (const row of reply.payload.data) {
			ids.push(row.id as string);
			rows.push(row);
		}
		cursor = reply.payload.pagination.next_cursor;
		pages += 1;
		assert.ok(pages <= 50, "the walk must end");
	} while (cursor);
	return { ids, rows, pages };
}

async function checkList(get: Get, base: string, sorts: Record<string, "number" | "text">, expected: Set<string>, label: string) {
	for (const [sort, kind] of Object.entries(sorts)) {
		const up = await walk(get, base, sort, "asc");
		const down = await walk(get, base, sort, "desc");
		for (const run of [up, down]) {
			assert.equal(run.ids.length, expected.size, `${label} ${sort}: row count`);
			assert.equal(new Set(run.ids).size, expected.size, `${label} ${sort}: no duplicate row across pages`);
			assert.deepEqual(new Set(run.ids), expected, `${label} ${sort}: no missing row`);
			assert.equal(run.pages, Math.ceil(expected.size / PAGE), `${label} ${sort}: page count`);
		}
		assert.deepEqual([...up.ids].reverse(), down.ids, `${label} ${sort}: desc is the reverse of asc, ties included`);
		if (kind === "number") {
			const values = up.rows.map((row) => Number(row[sort]));
			assert.deepEqual(values, [...values].sort((a, b) => a - b), `${label} ${sort}: ascending values`);
		}
	}
	// Cursor of one sort never opens another sort, direction or the default order.
	const first = await get(`${base}&limit=${PAGE}&sort=${Object.keys(sorts)[0]}&dir=asc`);
	const cursor = first.payload.pagination.next_cursor;
	assert.ok(cursor, `${label}: first page has a next cursor`);
	const refuse = async (query: string) => assert.equal((await get(`${base}&limit=${PAGE}&${query}&cursor=${cursor}`)).status, 400, `${label}: ${query}`);
	await refuse(`sort=${Object.keys(sorts)[0]}&dir=desc`);
	await refuse("");
	if (Object.keys(sorts).length > 1) await refuse(`sort=${Object.keys(sorts)[1]}&dir=asc`);
	for (const bad of ["sort=price", "sort=id", "dir=asc", "sort=&dir=asc", `sort=${Object.keys(sorts)[0]}&dir=up`])
		assert.equal((await get(`${base}&limit=${PAGE}&${bad}`)).status, 400, `${label}: ${bad}`);
	assert.equal((await get(`${base}&limit=${PAGE}&sort=${Object.keys(sorts)[0]}&cursor=${randomUUID()}`)).status, 400, `${label}: plain id cursor with a sort`);
}

test("the four admin lists sort server-side with a stable keyset cursor", async () => {
	const f = await financeFixture();
	try {
		const owner = f.owner.browser;
		const tag = randomUUID().slice(0, 8);
		const send = async (handler: typeof handleCatalog, method: string, path: string, body?: Record<string, unknown>) => {
			const request = owner.request(`/api/v1/admin${path}`, body);
			request.headers.set("idempotency-key", randomUUID());
			const response = await handler(new Request(request, { method }), f.identity);
			return { status: response.status, payload: await response.json() };
		};
		const post = async (handler: typeof handleCatalog, path: string, body: Record<string, unknown>) => {
			const reply = await send(handler, "POST", path, body);
			assert.equal(reply.status, 201, JSON.stringify(reply.payload));
			return reply.payload;
		};
		const reader = (handler: typeof handleCatalog, root: string): Get => async (query) => {
			const request = owner.request(`/api/v1/admin${root}?${query}`);
			const response = await handler(request, f.identity);
			return { status: response.status, payload: await response.json() };
		};
		const [wh] = await f.identity.sql`insert into app.warehouse (name,city) values (${`Synthetic sort ${tag}`},'Malang') returning id`;

		// Physical SKUs: five rows, names tie in pairs (sku is unique). q searches the whole dictionary.
		const names = ["Alfa", "Bravo", "Bravo", "Charlie", "Alfa"];
		const stock: { id: string; sku: string; name: string }[] = [];
		for (const [i, name] of names.entries()) stock.push(await post(handleCatalog, "/stock-items", { sku: `SORT-${tag}-${i}`.toUpperCase(), name: `${name} ${tag}` }));
		const skuExpected = new Set(stock.map((s) => s.id));
		await checkList(reader(handleCatalog, "/stock-items"), `q=${tag}`, { sku: "text", name: "text" }, skuExpected, "stock-items");
		assert.equal((await reader(handleCatalog, "/stock-items")(`q=${tag}&limit=100`)).payload.data.length, ROWS, "q covers the full dictionary");
		assert.equal((await reader(handleCatalog, "/stock-items")(`q=${tag}%25`)).payload.data.length, 0, "% is literal");
		assert.equal((await reader(handleCatalog, "/stock-items")("q=")).status, 400);

		// Inventory positions: on_hand ties (3,3,5,5,1), reserved and quarantined are all 0 (full ties).
		const received = [3, 3, 5, 5, 1];
		const positions: string[] = [];
		for (const [i, item] of stock.entries()) {
			const lot = await post(handleInventory, "/inventory/lots", { warehouse_id: wh.id, stock_item_id: item.id, code: `SORT-${tag}-${i}`, expires_on: "2030-12-31", reason: "Synthetic sort lot" });
			const position = await post(handleInventory, "/inventory/positions", { warehouse_id: wh.id, stock_item_id: item.id, lot_id: lot.id });
			await post(handleInventory, "/inventory/movements", { warehouse_id: wh.id, stock_item_id: item.id, lot_id: lot.id, kind: "receive", quantity: received[i], expected_version: 0, reason: "Synthetic sort receipt" });
			positions.push(position.id);
		}
		await checkList(reader(handleInventory, "/inventory"), `warehouse_id=${wh.id}`, { sku: "text", name: "text", on_hand: "number", reserved: "number", quarantined: "number" }, new Set(positions), "inventory");

		// Products: names tie in pairs; price is not sortable.
		const category = await post(handleCatalog, "/categories", { name: `Synthetic sort ${tag}`, slug: `synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [] });
		const products: string[] = [];
		for (const [i, name] of ["Mangkuk", "Piring", "Piring", "Sendok", "Mangkuk"].entries()) {
			const item = stock[i];
			const product = await post(handleCatalog, "/products", { name: `${name} ${tag}`, category_id: category.id, description: " ", images: [], variants: [{
				sku: `SORT-V-${tag}-${i}`.toUpperCase(), label: "Synthetic unit", attributes: [], offer_kind: "unit", weight_grams: 100, length_mm: 100,
				width_mm: 100, height_mm: 100, default_warehouse_id: wh.id, contents: [{ stock_item_id: item.id, name: item.name, quantity: 1 }] }] });
			products.push(product.id);
		}
		const productsGet = reader(handleCatalog, "/products");
		await checkList(productsGet, `q=${tag}`, { name: "text", catalog_id: "text" }, new Set(products), "products");
		assert.equal((await productsGet(`q=${tag}&sort=price_min_idr`)).status, 400, "price is not sortable");

		// Orders: two payment methods and two totals give ties in status, payment_status and buyer_total.
		const orders: string[] = [];
		for (const [method, quantity] of [["prepaid", 1], ["cod", 1], ["prepaid", 1], ["cod", 1], ["prepaid", 1]] as const) orders.push((await f.order(method, quantity)).id);
		const [home] = await f.identity.sql`select warehouse_id from app.order_shipment where order_id=${orders[0]} limit 1`;
		const ordersGet: Get = async (query) => {
			const response = await handleOrderHistory(owner.request(`/api/v1/admin/orders?${query}`), f.identity);
			return { status: response.status, payload: await response.json() };
		};
		const scoped = `warehouse_id=${home.warehouse_id}`;
		const inScope = (await ordersGet(`${scoped}&limit=100`)).payload.data.map((row) => row.id as string);
		// The fixture stock (3 + 2 shirts in two warehouses) splits the five orders between the warehouses, so the
		// scoped list holds the orders shipped from this one; at least three rows keep two pages and a tie.
		const homeOrders = (await f.identity.sql`select distinct order_id from app.order_shipment where order_id in ${f.identity.sql(orders)} and warehouse_id=${home.warehouse_id}`).map((row) => row.order_id as string);
		assert.ok(homeOrders.length >= 3, "the home warehouse holds at least three of this test's orders");
		assert.deepEqual(new Set(inScope), new Set(homeOrders), "the scoped list holds exactly the orders shipped from this warehouse");
		await checkList(ordersGet, scoped, { created_at: "text", number: "text", buyer_total: "number", status: "text", payment_status: "text" }, new Set(homeOrders), "orders");
		// The default order is unchanged: newest first, plain keyset cursor.
		const fallback = await ordersGet(`${scoped}&limit=2`);
		assert.equal(fallback.status, 200);
		assert.ok(fallback.payload.pagination.next_cursor);
		assert.equal((await ordersGet(`${scoped}&limit=2&sort=number&cursor=${fallback.payload.pagination.next_cursor}`)).status, 400, "a default-order cursor does not open a sorted page");
		const sortedCursor = (await ordersGet(`${scoped}&limit=2&sort=number`)).payload.pagination.next_cursor;
		assert.equal((await ordersGet(`${scoped}&limit=2&cursor=${sortedCursor}`)).status, 400, "a sorted cursor does not open the default order");
		assert.equal((await ordersGet(`${scoped}&status=cancelled&limit=2&sort=number&cursor=${sortedCursor}`)).status, 400, "a sorted cursor stays bound to its filters");
	} finally {
		await f.close();
	}
});
