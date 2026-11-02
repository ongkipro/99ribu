import assert from "node:assert/strict";
import test from "node:test";
import { POSITION_SORT } from "../src/modules/inventory/positions.ts";
import { PRODUCT_SORT } from "../src/modules/catalog/summary.ts";
import { STOCK_ITEM_SORT } from "../src/modules/catalog/stock-items.ts";
import {
	encodeSortCursor,
	listCursor,
	nextSortCursor,
	readSortCursor,
	readSorting,
	type SortColumns,
} from "../src/modules/catalog/sort.ts";
import { ariaSort, nextSort, readSortState, sortEntries } from "../src/modules/catalog/sort-state.ts";

// S150: the sort-aware keyset cursor and the header cycle. Pure: no database, no browser.
const COLUMNS: SortColumns = {
	sku: { column: "s.sku", kind: "text" },
	on_hand: { column: "b.on_hand", kind: "int" },
	created_at: { column: "o.created_at", kind: "stamp" },
};
const ID = "0b8d1a52-5c0e-4f3a-9d6e-2b7f4c1a9e30";
const params = (query: string) => new URLSearchParams(query);
const sorting = (query: string) => {
	const found = readSorting(params(query), COLUMNS);
	assert.ok(found);
	return found;
};
const badRequest = (error: unknown) => (error as { status?: number }).status === 400;

test("sort and dir: absent means the default order, dir alone and unknown values are 400", () => {
	assert.equal(readSorting(params("limit=5"), COLUMNS), null);
	assert.deepEqual(sorting("sort=sku"), { key: "sku", dir: "asc", column: "s.sku", kind: "text" });
	assert.equal(sorting("sort=on_hand&dir=desc").dir, "desc");
	assert.throws(() => readSorting(params("dir=desc"), COLUMNS), badRequest);
	assert.throws(() => readSorting(params("sort=price"), COLUMNS), badRequest);
	assert.throws(() => readSorting(params("sort=constructor"), COLUMNS), badRequest);
	assert.throws(() => readSorting(params("sort=sku&dir=up"), COLUMNS), badRequest);
	assert.throws(() => readSorting(params("sort=sku;drop table"), COLUMNS), badRequest);
});

test("a sort cursor round-trips its value and id", () => {
	const asc = sorting("sort=sku&dir=asc");
	assert.deepEqual(readSortCursor(encodeSortCursor(asc, "KOPI-250", ID), asc), { value: "KOPI-250", id: ID });
	assert.equal(readSortCursor(null, asc), null);
	const numeric = sorting("sort=on_hand&dir=desc");
	assert.deepEqual(readSortCursor(encodeSortCursor(numeric, "-3", ID), numeric), { value: "-3", id: ID });
	const stamp = sorting("sort=created_at");
	const at = "2026-10-28T03:46:00.123456Z";
	assert.deepEqual(readSortCursor(encodeSortCursor(stamp, at, ID), stamp), { value: at, id: ID });
});

test("a cursor made for another sort, direction or filter set is rejected", () => {
	const made = encodeSortCursor(sorting("sort=sku&dir=asc"), "KOPI-250", ID, "filters-a");
	assert.ok(readSortCursor(made, sorting("sort=sku&dir=asc"), "filters-a"));
	assert.throws(() => readSortCursor(made, sorting("sort=sku&dir=desc"), "filters-a"), badRequest);
	assert.throws(() => readSortCursor(made, sorting("sort=on_hand&dir=asc"), "filters-a"), badRequest);
	assert.throws(() => readSortCursor(made, sorting("sort=sku&dir=asc"), "filters-b"), badRequest);
	assert.throws(() => readSortCursor(made, sorting("sort=sku&dir=asc")), badRequest);
});

test("malformed, forged or mistyped cursors are 400, never a database error", () => {
	const numeric = sorting("sort=on_hand");
	const raw = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const good = { s: "on_hand", d: "asc", v: "4", id: ID, h: "" };
	assert.ok(readSortCursor(raw(good), numeric));
	for (const bad of [
		{ ...good, v: "four" },
		{ ...good, v: 4 },
		{ ...good, v: "1".repeat(19) },
		{ ...good, id: "not-a-uuid" },
		{ ...good, extra: 1 },
		{ s: "on_hand", d: "asc", v: "4", id: ID },
		"text",
		null,
		[],
	]) assert.throws(() => readSortCursor(raw(bad), numeric), badRequest);
	assert.throws(() => readSortCursor("!!not base64!!", numeric), badRequest);
	assert.throws(() => readSortCursor("A".repeat(2001), numeric), badRequest);
	const stamp = sorting("sort=created_at");
	assert.throws(() => readSortCursor(raw({ s: "created_at", d: "asc", v: "yesterday", id: ID, h: "" }), stamp), badRequest);
});

test("listCursor keeps the plain id cursor of the default order and refuses to mix the two modes", () => {
	assert.deepEqual(listCursor(ID, null), { id: ID, position: null });
	assert.deepEqual(listCursor(null, null), { id: null, position: null });
	const asc = sorting("sort=sku");
	assert.throws(() => listCursor(ID, asc), badRequest);
	assert.throws(() => listCursor(encodeSortCursor(asc, "A", ID), null), badRequest);
});

test("next_cursor comes from the last row of the page, and is null on the last page", () => {
	const asc = sorting("sort=sku");
	const rows = [
		{ id: "00000000-0000-4000-8000-000000000001", sort_key: "A" },
		{ id: "00000000-0000-4000-8000-000000000002", sort_key: "B" },
		{ id: "00000000-0000-4000-8000-000000000003", sort_key: "B" },
	];
	assert.equal(nextSortCursor(asc, rows, 3), null);
	const next = nextSortCursor(asc, rows, 2);
	assert.deepEqual(readSortCursor(next, asc), { value: "B", id: rows[1].id });
});

test("allow-lists: products have no price sort, every list names only its own columns", () => {
	assert.deepEqual(Object.keys(PRODUCT_SORT), ["name", "catalog_id"]);
	assert.deepEqual(Object.keys(STOCK_ITEM_SORT), ["sku", "name"]);
	assert.deepEqual(Object.keys(POSITION_SORT), ["sku", "name", "on_hand", "reserved", "quarantined"]);
	assert.throws(() => readSorting(params("sort=price"), PRODUCT_SORT), badRequest);
	assert.throws(() => readSorting(params("sort=price_min_idr"), PRODUCT_SORT), badRequest);
});

test("header cycle: ascending, descending, default; another column restarts at ascending", () => {
	const first = nextSort(null, "sku");
	assert.deepEqual(first, { key: "sku", dir: "asc" });
	const second = nextSort(first, "sku");
	assert.deepEqual(second, { key: "sku", dir: "desc" });
	assert.equal(nextSort(second, "sku"), null);
	assert.deepEqual(nextSort(second, "name"), { key: "name", dir: "asc" });
});

test("URL sort state: allow-listed key only, direction defaults to ascending, default order leaves no parameters", () => {
	const allowed = ["sku", "name"];
	const read = (query: string) => readSortState(params(query), allowed, "urut", "arah");
	assert.deepEqual(read("urut=sku&arah=desc"), { key: "sku", dir: "desc" });
	assert.deepEqual(read("urut=name"), { key: "name", dir: "asc" });
	assert.deepEqual(read("urut=name&arah=sideways"), { key: "name", dir: "asc" });
	assert.equal(read("urut=price"), null);
	assert.equal(read("arah=desc"), null);
	assert.deepEqual(sortEntries({ key: "sku", dir: "desc" }, "urut", "arah"), { urut: "sku", arah: "desc" });
	assert.deepEqual(sortEntries(null), {});
});

test("aria-sort of a header cell", () => {
	assert.equal(ariaSort(null, "sku"), "none");
	assert.equal(ariaSort({ key: "sku", dir: "asc" }, "sku"), "ascending");
	assert.equal(ariaSort({ key: "sku", dir: "desc" }, "sku"), "descending");
	assert.equal(ariaSort({ key: "sku", dir: "desc" }, "name"), "none");
});
