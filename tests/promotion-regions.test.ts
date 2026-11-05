import assert from "node:assert/strict";
import test from "node:test";
import { districtRegion, promotionShipments, provinceRegion } from "../src/modules/checkout/quotes.ts";
import { COURIERS } from "../src/modules/shipping/mengantar.ts";
import { allocate, type Rule } from "../src/modules/promotions/allocation.ts";
import type { ShippingPlan } from "../src/modules/shipping/quotes.ts";

// S176: with the real area catalogue, a shipping promotion targets provinces; the fixture keeps destination ids.
const plan = {
	destination_id: "5f0c2b1a9d3e4f5a6b7c8d9e",
	packages: [{ id: "parcel_1", warehouse_id: "w1", shipping_amount: 12000, selected_option_id: "r1", options: [{ id: "r1", service_id: "JNE" }] }],
} as unknown as ShippingPlan;
const rule = (region_ids: string[], service_ids: string[] = []): Rule => ({
	promotion_id: "p1", id: "v1", priority: 1, kind: "fixed", value: 5000, maximum_per_order: 5000, service_ids, region_ids, stacking: "exclusive",
});

test("province region ids are stable slugs accepted by the promotion id rule", () => {
	assert.equal(provinceRegion("DKI Jakarta"), "prov-dki-jakarta");
	assert.equal(provinceRegion("Dki Jakarta"), "prov-dki-jakarta");
	assert.equal(provinceRegion("DKI JAKARTA"), "prov-dki-jakarta", "the catalogue's capitals and the title-cased label match");
	assert.equal(provinceRegion("Daerah Istimewa Yogyakarta"), "prov-daerah-istimewa-yogyakarta");
	assert.match(provinceRegion("Kepulauan Bangka Belitung"), /^[A-Za-z0-9_-]{1,100}$/);
});

test("a Mengantar destination carries its province; a fixture destination does not", () => {
	assert.deepEqual(promotionShipments(plan, { province: "Dki Jakarta", source: "mengantar" })[0].region_ids, ["5f0c2b1a9d3e4f5a6b7c8d9e", "prov-dki-jakarta"]);
	assert.deepEqual(promotionShipments(plan, { province: "Jawa Timur", source: "TEST-ONLY" })[0].region_ids, ["5f0c2b1a9d3e4f5a6b7c8d9e"]);
	assert.deepEqual(promotionShipments(plan)[0].region_ids, ["5f0c2b1a9d3e4f5a6b7c8d9e"]);
});

test("a province-scoped, courier-scoped promotion applies only inside that province and courier", () => {
	const jakarta = promotionShipments(plan, { province: "Dki Jakarta", source: "mengantar" });
	const bandung = promotionShipments(plan, { province: "Jawa Barat", source: "mengantar" });
	assert.equal(allocate([rule(["prov-dki-jakarta"])], jakarta)[0]?.amount, 5000);
	assert.equal(allocate([rule(["prov-dki-jakarta"])], bandung)[0]?.amount ?? 0, 0);
	assert.equal(allocate([rule(["prov-dki-jakarta"], ["SiCepat"])], jakarta)[0]?.amount ?? 0, 0, "other courier");
	assert.equal(allocate([rule(["prov-dki-jakarta"], ["JNE"])], jakarta)[0]?.amount, 5000);
});

// S177 x Mengantar: a voucher's courier and area filters must use the same keys checkout shipments carry.
const planFor = (service: string) => ({ destination_id: "mgt-area-1", packages: [{ id: "p1", warehouse_id: "w1", shipping_amount: 9000, selected_option_id: "o1", options: [{ id: "o1", service_id: service }] }] }) as unknown as ShippingPlan;
const address = { source: "mengantar", province: "DKI JAKARTA", city: "JAKARTA SELATAN", district: "TEBET" };

test("a Mengantar shipment carries its area, province and kecamatan region ids", () => {
	const [shipment] = promotionShipments(planFor("JNE"), address);
	assert.deepEqual(shipment.region_ids, ["mgt-area-1", "prov-dki-jakarta", "dist-dki-jakarta--jakarta-selatan--tebet"]);
	assert.equal(provinceRegion("DKI JAKARTA"), "prov-dki-jakarta");
	assert.equal(districtRegion("DKI JAKARTA", "JAKARTA SELATAN", "TEBET"), shipment.region_ids[2]);
	for (const id of shipment.region_ids) assert.match(id, /^[A-Za-z0-9_-]{1,100}$/, "valid promotion region id");
});

test("the shipment service id is the Mengantar courier key the admin courier filter offers", () => {
	for (const courier of Object.keys(COURIERS)) assert.equal(promotionShipments(planFor(courier), address)[0].service_id, courier);
});

test("the test fixture keeps only its destination id (no province or kecamatan ids)", () => {
	assert.deepEqual(promotionShipments(planFor("regular"), { source: "TEST-ONLY", province: "X", city: "Y", district: "Z" })[0].region_ids, ["mgt-area-1"]);
});
