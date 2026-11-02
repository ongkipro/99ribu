import assert from "node:assert/strict";
import test from "node:test";
import type { CatalogVariant } from "../src/components/admin/catalog-model.ts";
import {
	buildPatch,
	createOperationKey,
	describeDrift,
	diffOffers,
	isVersionConflict,
	type OfferRow,
	offerErrorMessage,
	parsePrice,
	parseWeight,
	rebaseEdits,
	rowsFrom,
	validateFresh,
	validateRows,
} from "../src/components/admin/offer-editor-model.ts";

const variant = (id: string, over: Partial<CatalogVariant> = {}): CatalogVariant => ({
	id,
	catalog_id: `v_${id}`,
	sku: `SKU-${id}`.toUpperCase(),
	label: `Paket ${id}`,
	attributes: [],
	price: 49000,
	image: null,
	offer_kind: "unit",
	contents: [{ stock_item_id: "s1", name: "Barang", quantity: 1 }],
	weight_grams: 250,
	length_mm: 100,
	width_mm: 80,
	height_mm: 60,
	default_warehouse_id: "w1",
	...over,
});
const product = { version: 3, category_id: "c1", images: [{ url: "/cover.jpg", alt: "a", width: 1, height: 1 }], variants: [variant("a"), variant("b")] };
const rows = () => rowsFrom(product.variants);
const edit = (list: OfferRow[], key: string, patch: Partial<OfferRow>) => list.map((r) => (r.key === key ? { ...r, ...patch } : r));

test("price accepts only whole rupiah 1..99000 as digits", () => {
	assert.equal(parsePrice("0"), null);
	assert.equal(parsePrice("1"), 1);
	assert.equal(parsePrice("99000"), 99000);
	assert.equal(parsePrice("99001"), null);
	assert.equal(parsePrice("12.5"), null);
	assert.equal(parsePrice("1e3"), null);
	assert.equal(parsePrice("-5"), null);
	assert.equal(parsePrice(""), null);
	assert.equal(parsePrice(" 500 "), 500);
});

test("weight is a positive whole number of grams within the API limit", () => {
	assert.equal(parseWeight("0"), null);
	assert.equal(parseWeight("1"), 1);
	assert.equal(parseWeight("1000000"), 1_000_000);
	assert.equal(parseWeight("1000001"), null);
	assert.equal(parseWeight("2.5"), null);
});

test("validateRows names the offer and field, and refuses an empty or oversized list", () => {
	assert.deepEqual(validateRows(rows()), []);
	const bad = validateRows(edit(edit(edit(rows(), "a", { price: "99001" }), "b", { label: "  " }), "b", { weight: "0" }));
	assert.deepEqual(bad.map((i) => [i.key, i.field]), [["a", "price"], ["b", "label"], ["b", "weight"]]);
	assert.match(bad[0].message, /Paket a/);
	assert.equal(validateRows([])[0].field, "count");
	assert.equal(validateRows(edit(rows(), "a", { label: "x".repeat(201) }))[0].field, "label");
});

test("no change yields no diff and no request", () => {
	assert.deepEqual(diffOffers(product.variants, rows(), [], "/cover.jpg"), []);
	assert.equal(buildPatch({ product, rows: rows(), retiredIds: [], categoryId: "c1", reason: "x" }), null);
	// A label with only surrounding spaces is the same label.
	assert.equal(buildPatch({ product, rows: edit(rows(), "a", { label: " Paket a " }), retiredIds: [], categoryId: "c1", reason: "x" }), null);
});

test("an update sends the whole offer with the new price, weight and label, and only for changed offers", () => {
	const changes = diffOffers(product.variants, edit(rows(), "a", { price: "39000", weight: "300", label: "Paket baru" }), [], "/cover.jpg");
	assert.equal(changes.length, 1);
	const [c] = changes;
	assert.equal(c.operation, "update");
	assert.deepEqual(c.operation === "update" && c.update, {
		label: "Paket baru",
		attributes: [],
		price: 39000,
		weight_grams: 300,
		length_mm: 100,
		width_mm: 80,
		height_mm: 60,
		default_warehouse_id: "w1",
		offer_kind: "unit",
		contents: [{ stock_item_id: "s1", name: "Barang", quantity: 1 }],
	});
	assert.equal(c.operation === "update" && c.variant_id, "a");
	assert.equal("sku" in (c.operation === "update" ? c.update : {}), false, "SKU is never renamed");
});

test("an own offer photo is sent only when it is not the cover", () => {
	const own = { url: "/own.jpg", alt: "o", width: 1, height: 1 };
	const withOwn = [variant("a", { image: own }), variant("b", { image: { ...own, url: "/cover.jpg" } })];
	const list = rowsFrom(withOwn).map((r) => ({ ...r, price: "1000" }));
	const [a, b] = diffOffers(withOwn, list, [], "/cover.jpg");
	assert.deepEqual(a.operation === "update" && a.update.image, own);
	assert.equal(b.operation === "update" && "image" in b.update, false);
});

test("create carries the fields the API requires and the kind follows the quantity", () => {
	const fresh = (quantity: number): OfferRow => ({
		key: "new-1",
		id: null,
		label: " Isi 3 ",
		price: "99000",
		weight: "750",
		fresh: { sku: "NEW-3", length_mm: 10, width_mm: 20, height_mm: 30, default_warehouse_id: "w1", stock_item_id: "s9", stock_name: "Barang 9", quantity },
	});
	const [unit] = diffOffers(product.variants, [...rows(), fresh(1)], [], null);
	assert.equal(unit.operation, "create");
	assert.deepEqual(unit.operation === "create" && unit.create, {
		sku: "NEW-3",
		label: "Isi 3",
		attributes: [],
		price: 99000,
		weight_grams: 750,
		length_mm: 10,
		width_mm: 20,
		height_mm: 30,
		default_warehouse_id: "w1",
		offer_kind: "unit",
		contents: [{ stock_item_id: "s9", name: "Barang 9", quantity: 1 }],
	});
	const [pack] = diffOffers(product.variants, [...rows(), fresh(3)], [], null);
	assert.equal(pack.operation === "create" && pack.create.offer_kind, "multipack");
});

test("retire emits one retire per id, and an unknown id is ignored", () => {
	const left = rows().filter((r) => r.key !== "b");
	assert.deepEqual(diffOffers(product.variants, left, ["b", "zzz"], null), [{ operation: "retire", variant_id: "b" }]);
});

test("a category change alone is a request; the reason is carried trimmed with the expected version", () => {
	const body = buildPatch({ product, rows: rows(), retiredIds: [], categoryId: "c2", reason: "  ganti kategori " });
	assert.deepEqual(body, { expected_version: 3, reason: "ganti kategori", category_id: "c2" });
});

test("validateFresh refuses each missing or out-of-range create field, first one wins", () => {
	const ok = { sku: "ABC-1", label: "Isi 2", price: "1000", weight: "100", length: "10", width: "10", height: "10", warehouseId: "w1", stockItemId: "s1", quantity: "2" };
	assert.equal(validateFresh(ok), null);
	assert.equal(validateFresh({ ...ok, sku: "abc" })?.field, "sku");
	assert.equal(validateFresh({ ...ok, label: " " })?.field, "label");
	assert.equal(validateFresh({ ...ok, price: "0" })?.field, "price");
	assert.equal(validateFresh({ ...ok, price: "99001" })?.field, "price");
	assert.equal(validateFresh({ ...ok, weight: "x" })?.field, "weight");
	assert.equal(validateFresh({ ...ok, height: "10001" })?.field, "height");
	assert.equal(validateFresh({ ...ok, warehouseId: "" })?.field, "warehouseId");
	assert.equal(validateFresh({ ...ok, stockItemId: "" })?.field, "stockItemId");
	assert.equal(validateFresh({ ...ok, quantity: "0" })?.field, "quantity");
});

test("409 drift lists changed prices, weights, new and retired offers", () => {
	const latest = {
		version: 4,
		category_id: "c1",
		variants: [variant("a", { price: 30000, weight_grams: 500 }), variant("c")],
	};
	const lines = describeDrift(product, latest);
	assert.ok(lines.some((l) => /Harga Paket a berubah dari Rp49\.000 ke Rp30\.000/.test(l)), lines.join("|"));
	assert.ok(lines.some((l) => /Berat Paket a berubah dari 250 g ke 500 g/.test(l)));
	assert.ok(lines.some((l) => l === "Penawaran baru: Paket c."));
	assert.ok(lines.some((l) => l === "Paket b sudah dihentikan."));
	assert.deepEqual(describeDrift(product, { ...latest, version: 3 }), []);
});

test("server codes map to concrete Indonesian text", () => {
	assert.match(offerErrorMessage(409, "VERSION_CONFLICT"), /sudah berubah/);
	assert.match(offerErrorMessage(400, "INVALID_INPUT"), /Rp1 sampai Rp99\.000/);
	assert.match(offerErrorMessage(422, "DUPLICATE_VARIANT_TARGET"), /dua kali/);
	assert.match(offerErrorMessage(409, "CATALOG_IDENTITY_CONFLICT"), /SKU/);
	assert.match(offerErrorMessage(403, "FORBIDDEN"), /Peran Anda/);
	assert.match(offerErrorMessage(403, null), /Peran Anda/);
	assert.match(offerErrorMessage(422, "BELOW_MARGIN_FLOOR"), /batas minimum/);
	assert.match(offerErrorMessage(0, null), /terhubung/);
	assert.match(offerErrorMessage(503, null), /Server sedang bermasalah/);
	assert.equal(isVersionConflict(409, "VERSION_CONFLICT"), true);
	assert.equal(isVersionConflict(409, "IDEMPOTENCY_CONFLICT"), false);
	assert.equal(isVersionConflict(400, "VERSION_CONFLICT"), false);
});

test("rebase carries only the fields the user changed onto the newest offers", () => {
	const mine = edit(edit(rows(), "a", { price: "30000" }), "b", { label: "Paket B baru" });
	const latest = {
		version: 4,
		category_id: "c1",
		variants: [variant("a", { price: 45000, weight_grams: 500 }), variant("b", { price: 40000 }), variant("c")],
	};
	const out = rebaseEdits({ start: product, latest, rows: mine, retired: [], categoryId: "c1" });
	const byKey = Object.fromEntries(out.rows.map((r) => [r.key, r]));
	assert.deepEqual([byKey.a.price, byKey.a.weight], ["30000", "500"], "my price, the server weight");
	assert.deepEqual([byKey.b.label, byKey.b.price], ["Paket B baru", "40000"], "my label, the server price");
	assert.ok(byKey.c, "an offer the server gained is kept");
	assert.deepEqual(out.notes, []);
});

test("rebase drops an edited offer the server retired, keeps my new rows, retirements and category", () => {
	const fresh: OfferRow = { key: "new-1", id: null, label: "Baru", price: "10000", weight: "100", fresh: { sku: "NEW", length_mm: 1, width_mm: 1, height_mm: 1, default_warehouse_id: "w1", stock_item_id: "s1", stock_name: "Barang", quantity: 1 } };
	const mine = [...edit(rows().filter((r) => r.key !== "b"), "a", { price: "30000" }), fresh];
	const latest = { version: 4, category_id: "c9", variants: [variant("a"), variant("b")] };
	const retiredB = rebaseEdits({ start: product, latest, rows: mine, retired: [{ id: "b", label: "Paket b" }], categoryId: "c2" });
	assert.deepEqual(retiredB.retired, [{ id: "b", label: "Paket b" }]);
	assert.deepEqual(retiredB.rows.map((r) => r.key), ["a", "new-1"]);
	assert.equal(retiredB.categoryId, "c2", "I changed the category");
	const gone = rebaseEdits({ start: product, latest: { ...latest, variants: [variant("b")] }, rows: mine, retired: [], categoryId: "c1" });
	assert.equal(gone.categoryId, "c9", "category not touched by me follows the server");
	assert.ok(gone.notes.some((n) => /Paket a sudah dihentikan/.test(n)), gone.notes.join("|"));
	assert.ok(gone.rows.some((r) => r.key === "new-1"));
});

test("idempotency key is kept only for a byte-identical retry", () => {
	let n = 0;
	const key = createOperationKey(() => `k${++n}`);
	assert.equal(key.get("body-1"), "k1");
	assert.equal(key.get("body-1"), "k1", "identical retry after a 5xx replays");
	assert.equal(key.get("body-2"), "k2", "edited body gets a fresh key");
	assert.equal(key.get("body-2"), "k2");
	assert.equal(key.get(), "k2", "callers without a fingerprint keep the old behaviour");
	key.rotate();
	assert.equal(key.get("body-2"), "k3", "a definitive answer rotates");
});
