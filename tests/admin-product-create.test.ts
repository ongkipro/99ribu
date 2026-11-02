import assert from "node:assert/strict";
import test from "node:test";
import {
	assumptionBody,
	componentKey,
	controlId,
	costVersionBody,
	errorLabel,
	factProblem,
	factRules,
	factsPatch,
	hppWarnings,
	type Inputs,
	isDefinitive,
	type Line,
	newComponentName,
	newComponentSku,
	newLine,
	type Offer,
	offerHasHpp,
	offerKind,
	parseHpp,
	parseQuantity,
	parseSaved,
	positionVersion,
	productBody,
	Refused,
	receiveBody,
	receivePairs,
	runIndependent,
	type Saved,
	stockKey,
	validate,
} from "../src/components/admin/product-create-model.ts";

const WH = "11111111-1111-4111-8111-111111111111";
const WH2 = "22222222-2222-4222-8222-222222222222";
const line = (key: string, over: Partial<Line> = {}): Line => ({ ...newLine(1, key), ...over });
const existing = (key: string, id: string): Partial<Line> => ({ mode: "existing", picked: { id, sku: `SKU-${key}`, name: `Barang ${key}` } });
const offer = (over: Partial<Offer> = {}, lines: Line[] = [line("a")]): Offer => ({ key: "o1", n: 1, label: "Paket", price: "29000", weight: "500", warehouse: WH, lines, ...over });
const base = (offers: Offer[], over: Partial<Inputs> = {}): Inputs => ({
	name: "Set Wadah", category: "c1", photos: 1, offers, hpp: {}, costsWrite: false, stock: {}, receivable: new Set([WH]), ...over,
});

test("a valid two-component offer has no refusal and is a bundle", () => {
	const o = offer({}, [line("a", { newName: "Wadah A" }), line("b", { newName: "Wadah B", quantity: "2" })]);
	assert.deepEqual(validate(base([o])), {});
	assert.equal(offerKind([{ quantity: 1 }, { quantity: 2 }]), "bundle");
	assert.equal(offerKind([{ quantity: 1 }]), "unit");
	assert.equal(offerKind([{ quantity: 3 }]), "multipack");
});

test("price bounds: 0 and 99001 are refused, 1 and 99000 pass; it is never derived from the parts", () => {
	const at = (price: string) => validate(base([offer({ price })]))["price-0"];
	assert.ok(at("0"));
	assert.ok(at("99001"));
	assert.ok(at(""));
	assert.ok(at("12.5"));
	assert.equal(at("1"), undefined);
	assert.equal(at("99000"), undefined);
	// Two parts that are cheap on their own do not force the price either way (PR-1).
	assert.equal(validate(base([offer({ price: "99000" }, [line("a", { newName: "A" }), line("b", { newName: "B" })])]))["price-0"], undefined);
});

test("one SKU twice in one offer is refused, the same SKU in two offers is not", () => {
	const dup = offer({}, [line("a", existing("x", "id-x")), line("b", existing("x", "id-x"))]);
	assert.match(validate(base([dup]))["component-0-1"], /tidak boleh dua kali/);
	const two = [offer({ key: "o1" }, [line("a", existing("x", "id-x"))]), offer({ key: "o2", n: 2, label: "Lain" }, [line("b", existing("x", "id-x"))])];
	assert.deepEqual(validate(base(two)), {});
	// Two NEW lines are different SKUs even when they carry the same typed name.
	assert.deepEqual(validate(base([offer({}, [line("a", { newName: "Sama" }), line("b", { newName: "Sama" })])])), {});
});

test("quantity bounds 0, 1, 1000000, 1000001 and text", () => {
	assert.equal(parseQuantity("0"), null);
	assert.equal(parseQuantity("1"), 1);
	assert.equal(parseQuantity("1000000"), 1_000_000);
	assert.equal(parseQuantity("1000001"), null);
	assert.equal(parseQuantity("1.5"), null);
	assert.ok(validate(base([offer({}, [line("a", { quantity: "0" })])]))["quantity-0-0"]);
});

test("a picked-less existing line, a nameless bundle line and a missing warehouse are refused", () => {
	assert.ok(validate(base([offer({}, [line("a", { mode: "existing" })])]))["component-0-0"]);
	assert.ok(validate(base([offer({}, [line("a"), line("b", { newName: "B" })])]))["component-0-0"]);
	assert.ok(validate(base([offer({ warehouse: "" })]))["warehouse-0"]);
	assert.ok(validate(base([offer({}, [])]))["lines-0"]);
	assert.ok(validate(base([offer({ weight: "0" })]))["weight-0"]);
});

test("offer labels must be unique ignoring case", () => {
	const errors = validate(base([offer({ key: "o1", label: "Hitam" }), offer({ key: "o2", n: 2, label: "hitam" })]));
	assert.ok(errors["label-1"]);
	assert.equal(errors["label-0"], undefined);
});

test("HPP is read only with the cost grant; at or above the price it is a warning, never a refusal", () => {
	const l = line("a", { quantity: "2" });
	const ck = componentKey(l);
	const o = offer({ price: "10000", label: "Isi 2" }, [l]);
	// Without finance.costs.write a typed value is ignored: no HPP error, no warning, none is ever built.
	assert.deepEqual(validate(base([o], { hpp: { [ck]: "999999" } })), {});
	assert.deepEqual(hppWarnings([o], { [ck]: "999999" }, false), {});
	// 2 x 5000 is not below 10000: the draft may still be saved, the screen says it cannot publish.
	assert.equal(validate(base([o], { costsWrite: true, hpp: { [ck]: "5000" } }))[`hpp-${ck}`], undefined);
	assert.match(hppWarnings([o], { [ck]: "5000" }, true)[`hpp-${ck}`], /tidak akan bisa terbit/);
	assert.deepEqual(hppWarnings([o], { [ck]: "4999" }, true), {});
	assert.ok(validate(base([offer({}, [l])], { costsWrite: true, hpp: { [ck]: "abc" } }))[`hpp-${ck}`]);
	assert.equal(parseHpp("0"), null);
	assert.equal(parseHpp("1000000"), null);
	assert.equal(parseHpp("999999"), 999_999);
});

test("default assumptions follow an HPP typed in this form, and say they are defaults", () => {
	const fresh = line("a"), picked = line("b", existing("x", "id-x"));
	const hpp = { [componentKey(fresh)]: "3000", [componentKey(picked)]: "9000" };
	assert.equal(offerHasHpp(offer({}, [fresh]), hpp), true);
	assert.equal(offerHasHpp(offer({}, [fresh]), {}), false, "no HPP typed: no assumptions");
	assert.equal(offerHasHpp(offer({}, [picked]), hpp), false, "an existing SKU's HPP is not this form's");
	assert.equal(offerHasHpp(offer({}, [fresh]), { [componentKey(fresh)]: "abc" }), false);
	assert.match(assumptionBody().reason, /default/);
	assert.equal(assumptionBody().expected_version, 0);
});

test("initial stock is validated only where it can be recorded", () => {
	const l = line("a");
	const key = stockKey(componentKey(l), WH);
	assert.ok(validate(base([offer({}, [l])], { stock: { [key]: "0" } }))[`stock-${key}`]);
	assert.equal(validate(base([offer({}, [l])], { stock: { [key]: "12" } }))[`stock-${key}`], undefined);
	assert.equal(validate(base([offer({}, [l])], { stock: { [key]: "0" }, receivable: new Set() }))[`stock-${key}`], undefined);
});

test("stock text for a pair that is no longer shown never blocks the form", () => {
	const l = line("a");
	const shown = stockKey(componentKey(l), WH);
	// Typed 0, then the warehouse was changed to WH2 (and receivable now holds both): the WH pair is stale.
	const moved = base([offer({ warehouse: WH2 }, [l])], { stock: { [shown]: "0" }, receivable: new Set([WH, WH2]) });
	assert.deepEqual(validate(moved), {});
	// Typed 0, then the line was removed: its key is stale too.
	assert.deepEqual(validate(base([offer({}, [line("b")])], { stock: { [shown]: "0" } })), {});
	// The visible pair still reports.
	assert.ok(validate(base([offer({ warehouse: WH2 }, [l])], { stock: { [stockKey(componentKey(l), WH2)]: "0" }, receivable: new Set([WH2]) }))[`stock-${stockKey(componentKey(l), WH2)}`]);
});

test("every error key maps to the control that carries it, with a readable label", () => {
	const l = line("a");
	const ck = componentKey(l);
	assert.deepEqual(
		["name", "category", "photos", "offers", "label-1", "price-0", "weight-2", "warehouse-0", "lines-1", "component-0-1", "quantity-0-0", `hpp-${ck}`, "fact-bahan"].map(controlId),
		["product-name", "product-category", "product-photo-file", "product-variant-add", "variant-label-1", "variant-price-0", "variant-weight-2", "variant-warehouse-0", "offer-contents-1", "component-0-1", "quantity-0-0", `hpp-${ck}`, "fact-bahan"],
	);
	assert.equal(errorLabel("label-1"), "Nama penawaran 2");
	assert.equal(errorLabel("quantity-1-2"), "Jumlah barang 3 di penawaran 2");
	assert.equal(errorLabel(`stock-${ck}|${WH}`), "Stok awal");
});

test("only the failed steps are pending; a facts 409 then an HPP 403 do not stop the receives", async () => {
	const sent: string[] = [];
	const freed: string[] = [];
	const step = (id: string, outcome?: Refused) => ({ id, label: `Langkah ${id}`, run: async () => { sent.push(id); if (outcome) throw outcome; } });
	const steps = [
		step("facts", new Refused(409, "VERSION_CONFLICT", "Data sudah berubah.")),
		step("hpp:a", new Refused(403, "FORBIDDEN", "Peran tidak boleh.")),
		step("assumption:o1"),
		step("receive:a", new Refused(0, null, "Koneksi terputus.")),
		step("receive:b"),
	];
	const pending = await runIndependent(steps, (id) => freed.push(id));
	assert.deepEqual(sent, ["facts", "hpp:a", "assumption:o1", "receive:a", "receive:b"], "every step ran");
	assert.deepEqual(pending.map((p) => p.id), ["facts", "hpp:a", "receive:a"]);
	assert.deepEqual(freed, ["facts", "hpp:a"], "a definitive refusal frees its key; a lost connection keeps it");
	assert.equal(pending[0].text, "Data sudah berubah.");
	// The retry plans only what is still pending.
	sent.length = 0;
	assert.deepEqual(await runIndependent(steps.filter((x) => pending.some((p) => p.id === x.id)).map((x) => ({ ...x, run: async () => { sent.push(x.id); } })), () => {}), []);
	assert.deepEqual(sent, ["facts", "hpp:a", "receive:a"]);
});

test("definitive means a 4xx that is not an idempotency conflict", () => {
	assert.equal(isDefinitive(new Refused(409, "VERSION_CONFLICT", "x")), true);
	assert.equal(isDefinitive(new Refused(403, "FORBIDDEN", "x")), true);
	assert.equal(isDefinitive(new Refused(409, "IDEMPOTENCY_CONFLICT", "x")), false);
	assert.equal(isDefinitive(new Refused(503, null, "x")), false);
	assert.equal(isDefinitive(new Refused(0, null, "x")), false);
	assert.equal(isDefinitive(new Error("x")), false);
});

test("a position version: the lot-less row, else 0; the attribute patch carries the version read", () => {
	assert.equal(positionVersion([]), 0);
	assert.equal(positionVersion([{ lot_id: "l1", version: 9 }, { lot_id: null, version: 4 }]), 4);
	assert.equal(factsPatch([{ key: "k", label: "K", value_type: "text", required: false, allowed_values: [] }], { k: "v" }, 7)?.expected_version, 7);
});

test("the session snapshot round-trips and anything malformed is ignored", () => {
	const l = line("a", { newName: "Gelas" });
	const saved: Saved = {
		v: 1, sku: "P261102ABC123", keys: [["stock:a", "k1"]], frozen: [["receive:x", "{}"]], stock: { a: { id: "s1", sku: "P261102ABC123", name: "Gelas" } },
		product: { id: "p1", variants: [{ id: "o1", sku: "P261102ABC123_OFFER" }] }, done: ["facts"],
		form: { name: "Gelas", category: "c1", description: "", photos: [{ url: "https://x/y.webp", width: 800, height: 800 }], offers: [offer({}, [l])], hpp: {}, qty: {}, facts: {}, counters: { offer: 2, line: 2 } },
	};
	assert.deepEqual(parseSaved(JSON.stringify(saved)), saved);
	assert.equal(parseSaved(null), null);
	assert.equal(parseSaved("{"), null);
	assert.equal(parseSaved(JSON.stringify({ ...saved, v: 2 })), null);
	assert.equal(parseSaved(JSON.stringify({ ...saved, keys: [["a"]] })), null);
	assert.equal(parseSaved(JSON.stringify({ ...saved, form: { ...saved.form, offers: [] } })), null);
	assert.equal(parseSaved(JSON.stringify({ ...saved, form: { ...saved.form, offers: [{ ...saved.form.offers[0], lines: [{ key: "x" }] }] } })), null);
});

test("one receive pair per component and warehouse, even when two offers share them", () => {
	const x = existing("x", "id-x");
	const offers = [
		offer({ key: "o1", warehouse: WH }, [line("a", x)]),
		offer({ key: "o2", n: 2, label: "B", warehouse: WH }, [line("b", x), line("c", { newName: "C" })]),
		offer({ key: "o3", n: 3, label: "C", warehouse: WH2 }, [line("d", x)]),
	];
	const pairs = receivePairs(offers);
	assert.deepEqual(pairs.map((p) => p.key), [`id:id-x|${WH}`, `new:c|${WH}`, `id:id-x|${WH2}`]);
});

test("request bodies: product with a bundle, receive and cost version", () => {
	const o = offer({}, [line("a", { newName: "Wadah A" }), line("b", { newName: "Wadah B", quantity: "2" })]);
	const body = productBody({
		title: "Set Wadah", description: " Isi ", category: "c1", photos: [{ url: "https://x/y.webp", width: 800, height: 800 }], offers: [o],
		stockIdOf: (l) => `id-${l.key}`, componentNameOf: (l) => `Nama ${l.key}`, offerSkuOf: () => "SKU_OFFER",
	});
	assert.equal(body.description, "Isi");
	assert.equal(body.images[0].alt, "Set Wadah");
	const v = body.variants[0];
	assert.equal(v.offer_kind, "bundle");
	assert.equal(v.price, 29000);
	assert.deepEqual(v.contents, [{ stock_item_id: "id-a", name: "Nama a", quantity: 1 }, { stock_item_id: "id-b", name: "Nama b", quantity: 2 }]);
	assert.equal(v.default_warehouse_id, WH);
	assert.deepEqual(receiveBody(WH, "s1", 5, 3), { warehouse_id: WH, stock_item_id: "s1", lot_id: null, kind: "receive", quantity: 5, reason: "Stok awal produk baru", expected_version: 3 });
	assert.equal(costVersionBody(1200).unit_cost, 1200);
});

test("component names and SKUs: typed name wins, one offer uses the product name, several add the label", () => {
	const o = offer({ label: "Hitam" });
	assert.equal(newComponentName(line("a"), "Gelas", o, 1), "Gelas");
	assert.equal(newComponentName(line("a"), "Gelas", o, 2), "Gelas - Hitam");
	assert.equal(newComponentName(line("a", { newName: " Tutup " }), "Gelas", o, 2), "Tutup");
	assert.equal(newComponentSku("P1", line("a"), 1), "P1");
	assert.equal(newComponentSku("P1", { ...line("a"), n: 3 }, 2), "P1-3");
});

test("category fact rules inherit from ancestors and build the attribute patch", () => {
	const categories = [
		{ id: "root", parent_id: null, attribute_definitions: [{ key: "bahan", label: "Bahan", value_type: "text" as const, required: true, allowed_values: [] }] },
		{ id: "kid", parent_id: "root", attribute_definitions: [{ key: "warna", label: "Warna", value_type: "enum" as const, required: false, allowed_values: ["merah", "biru"] }] },
	];
	const rules = factRules(categories, "kid");
	assert.deepEqual(rules.map((r) => r.key), ["warna", "bahan"]);
	assert.equal(factsPatch(rules, {}), null);
	assert.deepEqual(factsPatch(rules, { bahan: " Kaca ", warna: "" }), { expected_version: 1, reason: "Atribut awal produk baru", facts: [{ key: "bahan", label: "Bahan", values: ["Kaca"] }] });
	assert.ok(factProblem(rules[0], "hijau"));
	assert.equal(factProblem(rules[0], "biru"), null);
	assert.equal(factProblem(rules[1], ""), null);
});
