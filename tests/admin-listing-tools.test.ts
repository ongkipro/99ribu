import assert from "node:assert/strict";
import test from "node:test";
import { ABORTED_TEXT, buildCsv, collectPages, csvCell, csvFileName, EXPORT_MAX_ROWS, jakartaDate, truncationNotice } from "../src/components/admin/csv-export.ts";
import { limitingHint, offerAvailability } from "../src/components/admin/limiting-component.ts";
import { copyName, copySku, duplicateBody, newCopyTag } from "../src/components/admin/product-duplicate.ts";

const W1 = "w1";
const W2 = "w2";
const pos = (warehouse_id: string, stock_item_id: string, available: number) => ({ warehouse_id, stock_item_id, available });

test("limiting component: the component with the lowest available/quantity names the offer", () => {
	const contents = [
		{ stock_item_id: "a", name: "Kopi", quantity: 1 },
		{ stock_item_id: "b", name: "Gula", quantity: 1 },
	];
	const r = offerAvailability(contents, [pos(W1, "a", 10), pos(W1, "b", 3)], W1);
	assert.equal(r.units, 3);
	assert.equal(r.limiting?.name, "Gula");
	assert.equal(r.limiting?.available, 3);
	assert.equal(limitingHint(r.limiting as NonNullable<typeof r.limiting>), "Terbatas oleh: Gula (3)");
	// Flip the stock: the other component is now named.
	const flipped = offerAvailability(contents, [pos(W1, "a", 2), pos(W1, "b", 30)], W1);
	assert.equal(flipped.units, 2);
	assert.equal(flipped.limiting?.name, "Kopi");
});

test("limiting component: quantity per offer divides and rounds down", () => {
	const contents = [
		{ stock_item_id: "a", name: "Kopi", quantity: 2 },
		{ stock_item_id: "b", name: "Gula", quantity: 1 },
	];
	// Kopi 7/2 = 3.5 -> 3 offers; Gula 4/1 = 4.
	const r = offerAvailability(contents, [pos(W1, "a", 7), pos(W1, "b", 4)], W1);
	assert.equal(r.units, 3);
	assert.equal(r.limiting?.name, "Kopi");
	assert.equal(limitingHint(r.limiting as NonNullable<typeof r.limiting>), "Terbatas oleh: Kopi (7 ÷ 2)");
});

test("limiting component: zero or missing stock gives zero units and names that component", () => {
	const contents = [
		{ stock_item_id: "a", name: "Kopi", quantity: 1 },
		{ stock_item_id: "b", name: "Gula", quantity: 1 },
	];
	const none = offerAvailability(contents, [pos(W1, "a", 5)], W1);
	assert.equal(none.units, 0);
	assert.equal(none.limiting?.name, "Gula");
	const zero = offerAvailability(contents, [pos(W1, "a", 0), pos(W1, "b", 9)], W1);
	assert.equal(zero.units, 0);
	assert.equal(zero.limiting?.name, "Kopi");
	assert.deepEqual(offerAvailability([], [], W1), { units: 0, limiting: null });
});

test("limiting component: only the chosen warehouse counts, and lots add up", () => {
	const contents = [{ stock_item_id: "a", name: "Kopi", quantity: 1 }];
	const positions = [pos(W1, "a", 2), pos(W1, "a", 3), pos(W2, "a", 100)];
	assert.equal(offerAvailability(contents, positions, W1).units, 5);
	assert.equal(offerAvailability(contents, positions, W2).units, 100);
	assert.equal(offerAvailability(contents, positions, "w3").units, 0);
});

test("csv cell: formula characters get one quote, quoting follows RFC 4180", () => {
	for (const lead of ["=", "+", "-", "@", "\t", "\r"]) assert.equal(csvCell(`${lead}1+1`).replace(/^"|"$/g, "").startsWith(`'${lead}`), true, JSON.stringify(lead));
	assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
	assert.equal(csvCell("a,b"), '"a,b"');
	assert.equal(csvCell('say "hi"'), '"say ""hi"""');
	assert.equal(csvCell("two\nlines"), '"two\nlines"');
	assert.equal(csvCell("-5"), "'-5");
	assert.equal(csvCell(null), "");
	assert.equal(csvCell(undefined), "");
	assert.equal(csvCell(0), "0");
	assert.equal(csvCell("plain"), "plain");
});

test("csv build: BOM, CRLF after every row, header first, only the given columns", () => {
	const csv = buildCsv(
		[
			{ header: "SKU", value: (r: { sku: string; name: string }) => r.sku },
			{ header: "Nama", value: (r) => r.name },
		],
		[
			{ sku: "A-1", name: "Kopi, sachet" },
			{ sku: "=B", name: "Gula" },
		],
	);
	assert.equal(csv, '﻿SKU,Nama\r\nA-1,"Kopi, sachet"\r\n\'=B,Gula\r\n');
	assert.equal(csv.charCodeAt(0), 0xfeff);
	assert.ok(!/(?<!\r)\n/.test(csv.replace(/"[^"]*"/g, "")), "bare LF outside quotes");
	assert.equal(buildCsv([{ header: "X", value: () => 1 }], []), "﻿X\r\n");
});

test("csv file name uses the Jakarta date, not the device date", () => {
	// 2026-11-02 18:00 UTC is already 03 Nov 01:00 in Jakarta.
	assert.equal(jakartaDate(new Date("2026-11-02T18:00:00Z")), "2026-11-03");
	assert.equal(jakartaDate(new Date("2026-11-02T16:59:00Z")), "2026-11-02");
	assert.equal(csvFileName("produk", new Date("2026-11-02T18:00:00Z")), "produk-2026-11-03.csv");
});

test("collectPages walks every cursor page, skips repeats, and reports truncation", async () => {
	const pages = new Map<string | null, { rows: { id: string }[]; next: string | null }>([
		[null, { rows: [{ id: "1" }, { id: "2" }], next: "c2" }],
		["c2", { rows: [{ id: "2" }, { id: "3" }], next: "c3" }],
		["c3", { rows: [{ id: "4" }], next: null }],
	]);
	const get = async (cursor: string | null) => ({ ok: true as const, ...(pages.get(cursor) as { rows: { id: string }[]; next: string | null }) });
	const all = await collectPages(get, (r) => r.id);
	assert.deepEqual(all.ok && all.rows.map((r) => r.id), ["1", "2", "3", "4"]);
	assert.equal(all.ok && all.truncated, false);
	const cut = await collectPages(get, (r) => r.id, 3);
	assert.deepEqual(cut.ok && cut.rows.map((r) => r.id), ["1", "2", "3"]);
	assert.equal(cut.ok && cut.truncated, true);
	// Exactly max rows and nothing more is not truncated.
	const exact = await collectPages(get, (r) => r.id, 4);
	assert.equal(exact.ok && exact.truncated, false);
	assert.equal(EXPORT_MAX_ROWS, 5000);
	assert.equal(truncationNotice(5000), "Dipotong di 5.000 baris. Persempit filter agar semua baris ikut.");
});

test("collectPages turns a failed page and a looping cursor into an error, never a short file", async () => {
	const failing = await collectPages<{ id: string }>(
		async (cursor) => (cursor ? { ok: false, text: "Layanan tidak tersedia" } : { ok: true, rows: [{ id: "1" }], next: "c2" }),
		(r) => r.id,
	);
	assert.deepEqual(failing, { ok: false, text: "Layanan tidak tersedia" });
	const loop = await collectPages<{ id: string }>(async () => ({ ok: true, rows: [{ id: "1" }], next: "same" }), (r) => r.id);
	assert.equal(loop.ok, false);
});

test("duplicate body: same components and prices, new SKUs, no cost or state fields", () => {
	const product = {
		id: "p1", catalog_id: "p_x", slug: "s", version: 4, name: "Kopi Susu", category_id: "cat", description: "Enak",
		images: [{ url: "https://example.invalid/a.webp", alt: "Kopi", width: 100, height: 100 }],
		facts: [{ key: "k", label: "K", values: ["v"] }],
		variants: [
			{
				id: "o1", catalog_id: "v_x", sku: "KOPI_OFFER", label: "Isi 2", attributes: [], price: 45000, image: null, offer_kind: "multipack" as const,
				contents: [{ stock_item_id: "s1", name: "Kopi", quantity: 2 }], weight_grams: 500, length_mm: 100, width_mm: 100, height_mm: 100, default_warehouse_id: "w1",
			},
		],
	};
	const body = duplicateBody(product, "ABC123");
	assert.equal(body.name, "Kopi Susu (salinan)");
	assert.equal(body.category_id, "cat");
	assert.equal(body.description, "Enak");
	assert.deepEqual(body.images, product.images);
	assert.equal(body.variants[0].sku, "KOPI_OFFER-CABC123");
	assert.notEqual(body.variants[0].sku, product.variants[0].sku);
	assert.equal(body.variants[0].price, 45000);
	assert.deepEqual(body.variants[0].contents, product.variants[0].contents);
	assert.deepEqual(Object.keys(body).sort(), ["category_id", "description", "images", "name", "variants"]);
	assert.ok(!JSON.stringify(body).match(/cost|hpp|stock_movement|published|"id"/i));
	assert.equal(copyName("x".repeat(200)).length, 200);
	assert.equal(copySku("S".repeat(100), "ABC123").length, 100);
	assert.match(newCopyTag(), /^[A-Z2-9]{6}$/);
	assert.notEqual(newCopyTag(() => 0), newCopyTag(() => 0.99));
});

test("copy name: no stacked suffix, no split surrogate pair, 200 characters at most", () => {
	assert.equal(copyName("Kopi"), "Kopi (salinan)");
	assert.equal(copyName("Kopi (salinan)"), "Kopi (salinan 2)");
	assert.equal(copyName("Kopi (salinan 2)"), "Kopi (salinan 3)");
	assert.equal(copyName("Kopi (salinan 9)"), "Kopi (salinan 10)");
	const emoji = "\u{1F600}".repeat(250);
	for (const input of [emoji, `${"a".repeat(199)}\u{1F600}`, `${emoji} (salinan)`]) {
		const out = copyName(input);
		assert.ok(Array.from(out).length <= 200, "within the name limit");
		assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out), "no lone surrogate");
	}
	assert.ok(copyName(emoji).endsWith(" (salinan)"));
});

test("collectPages stops when aborted, before the next page is requested, and hands the signal to the getter", async () => {
	const controller = new AbortController();
	const seen: (AbortSignal | undefined)[] = [];
	let calls = 0;
	const result = await collectPages<{ id: string }>(
		async (_cursor, signal) => {
			seen.push(signal);
			calls++;
			controller.abort();
			return { ok: true, rows: [{ id: String(calls) }], next: `c${calls}` };
		},
		(r) => r.id,
		undefined,
		controller.signal,
	);
	assert.deepEqual(result, { ok: false, text: ABORTED_TEXT });
	assert.equal(calls, 1);
	assert.equal(seen[0], controller.signal);
	const before = new AbortController();
	before.abort();
	assert.equal((await collectPages<{ id: string }>(async () => ({ ok: true, rows: [], next: null }), (r) => r.id, undefined, before.signal)).ok, false);
});

test("collectPages flags truncation when the cap is reached with more rows behind it, not when it ends there", async () => {
	const rows = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => ({ id: String(from + i) }));
	const get = (next: string | null) => async (cursor: string | null) => ({ ok: true as const, rows: rows(cursor ? 3 : 0, cursor ? 6 : 3), next: cursor ? next : "c2" });
	const atCap = await collectPages(get("c3"), (r) => r.id, 6);
	assert.equal(atCap.ok && atCap.rows.length, 6);
	assert.equal(atCap.ok && atCap.truncated, true, "exactly the cap, a next page exists");
	const ends = await collectPages(get(null), (r) => r.id, 6);
	assert.equal(ends.ok && ends.truncated, false, "exactly the cap, nothing behind it");
});
