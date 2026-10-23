import assert from "node:assert/strict";
import test from "node:test";
import { searchQuery } from "../src/components/admin/order-model.ts";
import { wibInputToIso } from "../src/modules/admin/wib.ts";

test("datetime-local values are read as WIB regardless of the device timezone", () => {
	assert.equal(wibInputToIso("2026-10-24T00:30"), "2026-10-23T17:30:00.000Z");
	assert.equal(wibInputToIso("2026-10-24T07:00:15"), "2026-10-24T00:00:15.000Z");
	assert.equal(wibInputToIso("2026-01-01T03:00"), "2025-12-31T20:00:00.000Z");
	for (const bad of ["", "2026-10-24", "2026-02-30T10:00", "2026-10-24T24:00", "2026-10-24T10:60", "24-10-2026 10:00", "2026-10-24T10:00Z"])
		assert.equal(wibInputToIso(bad), null, bad);
});

test("S100: a phone suffix never enters a page URL or the detail page's back link", () => {
	assert.equal(searchQuery("hp", "12345678").toString(), "jenis=hp");
	assert.equal(searchQuery("resi", "JP1234567890").toString(), "jenis=resi&cari=JP1234567890");
	assert.equal(searchQuery("nomor", "").toString(), "");
});
