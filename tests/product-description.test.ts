import assert from "node:assert/strict";
import test from "node:test";
import { describeBlocks, descriptionLines } from "../src/modules/storefront/description.ts";

// S143: catalog descriptions are plain text; list lines render as real lists so wrapped lines hang under their text.

test("dash lines become one list, other lines stay text, and a blank line adds a gap", () => {
	const blocks = describeBlocks("Isi paket:\n- 1 pcs Alat Cukur\n- 1 pcs Alat Anti Mendengkur\nHarga Rp99.000 untuk satu paket lengkap.\n\nKondisi: Baru");
	assert.deepEqual(blocks, [
		{ kind: "text", id: 0, text: "Isi paket:", gap: false },
		{ kind: "bullets", id: 1, items: [{ id: 1, text: "1 pcs Alat Cukur" }, { id: 2, text: "1 pcs Alat Anti Mendengkur" }], gap: false },
		{ kind: "text", id: 3, text: "Harga Rp99.000 untuk satu paket lengkap.", gap: false },
		{ kind: "text", id: 5, text: "Kondisi: Baru", gap: true },
	]);
});

test("numbered lines keep their own numbers, also without a space, but a size like 1.5MM is text", () => {
	assert.deepEqual(describeBlocks("1.Kekuatan kuat\n2. Efisiensi tinggi\n\n3.Sisir batas\n1.5MM sisir"), [
		{ kind: "numbers", id: 0, items: [{ id: 0, value: 1, text: "Kekuatan kuat" }, { id: 1, value: 2, text: "Efisiensi tinggi" }], gap: false },
		{ kind: "numbers", id: 3, items: [{ id: 3, value: 3, text: "Sisir batas" }], gap: true },
		{ kind: "text", id: 4, text: "1.5MM sisir", gap: false },
	]);
});

test("leading and repeated blank lines and CRLF produce no empty blocks", () => {
	assert.deepEqual(describeBlocks("\n\r\nSatu\r\n\r\n\r\n- dua\r\n"), [
		{ kind: "text", id: 2, text: "Satu", gap: false },
		{ kind: "bullets", id: 5, items: [{ id: 5, text: "dua" }], gap: true },
	]);
	assert.deepEqual(describeBlocks("  \n "), []);
});

test("the line estimate counts wrapped lines and gaps, so the clamp only shows for text that really passes it", () => {
	assert.equal(descriptionLines(describeBlocks("Isi paket:\n- satu\n- dua\nHarga lengkap.")), 4);
	assert.equal(descriptionLines(describeBlocks(`${"a".repeat(150)}\n\n- ${"b".repeat(71)}`)), 3 + 1 + 2);
});
