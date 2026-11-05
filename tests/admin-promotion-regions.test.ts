import assert from "node:assert/strict";
import test from "node:test";
import { districtRegionId, MAX_REGION_IDS, regionLabel } from "../src/components/admin/promotion-regions.ts";
import { districtRegion, provinceRegion } from "../src/modules/checkout/quotes.ts";

// S177 leftovers: the admin kecamatan picker builds region ids client side; they must equal what checkout derives.
test("the picker's kecamatan id equals checkout's districtRegion", () => {
	const cases: [string, string, string][] = [
		["Jawa Barat", "Kota Bandung", "Coblong"],
		["DKI JAKARTA", "KOTA ADM. JAKARTA SELATAN", "KEBAYORAN BARU"],
		["Sulawesi Tenggara", "Kota Bau-Bau", "Wolio"],
		["Nusa Tenggara Timur", "Kabupaten Timor Tengah Selatan".repeat(3), "Kota Soe"],
	];
	for (const [p, c, d] of cases) assert.equal(districtRegionId(p, c, d), districtRegion(p, c, d));
	assert.equal(MAX_REGION_IDS, 100);
});

test("stored region ids read back as labels; unknown ids show raw", () => {
	const provinces = [{ id: provinceRegion("DKI Jakarta"), label: "DKI Jakarta" }];
	assert.equal(regionLabel("prov-dki-jakarta", provinces), "DKI Jakarta", "a known option keeps its label");
	assert.equal(regionLabel(districtRegion("DKI JAKARTA", "KOTA ADM. JAKARTA SELATAN", "KEBAYORAN BARU"), provinces), "Kebayoran Baru, Kota Adm Jakarta Selatan, DKI Jakarta");
	assert.equal(regionLabel(districtRegion("Jawa Barat", "Kota Bandung", "Coblong")), "Coblong, Kota Bandung, Jawa Barat", "an unloaded province is read from the slug");
	assert.equal(regionLabel("dist-di-yogyakarta--kota-yogyakarta--gondokusuman"), "Gondokusuman, Kota Yogyakarta, DI Yogyakarta");
	for (const raw of ["5f0c2b1a9d3e4f5a6b7c8d9e", "dist-only--two", "dist-a----b", "prov-unknown"]) assert.equal(regionLabel(raw, provinces), raw, `${raw} shows raw`);
});
