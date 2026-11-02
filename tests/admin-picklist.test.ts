import assert from "node:assert/strict";
import test from "node:test";
import {
	aggregatePicklist,
	type PicklistLine,
} from "../src/modules/fulfillment/picklist.ts";

const W1 = "00000000-0000-4000-8000-0000000000a1";
const W2 = "00000000-0000-4000-8000-0000000000a2";
const SKU_A = "00000000-0000-4000-8000-0000000000b1";
const SKU_B = "00000000-0000-4000-8000-0000000000b2";
const line = (
	shipment: string,
	order: string,
	warehouse: string,
	item: string,
	quantity: number,
): PicklistLine => ({
	shipment_id: shipment,
	order_number: order,
	warehouse_id: warehouse,
	warehouse_name: warehouse === W1 ? "Gudang Bekasi" : "Gudang Surabaya",
	stock_item_id: item,
	sku: item === SKU_A ? "SKU-A" : "SKU-B",
	name: item === SKU_A ? "Barang A" : "Barang B",
	quantity,
});

test("picklist sums shared components across three parcels and groups by warehouse", () => {
	const result = aggregatePicklist([
		line("p1", "ORD-1", W2, SKU_A, 2),
		line("p1", "ORD-1", W2, SKU_B, 1),
		line("p2", "ORD-2", W2, SKU_A, 3),
		line("p3", "ORD-3", W1, SKU_A, 5),
		line("p3", "ORD-3", W1, SKU_B, 4),
	]);
	assert.deepEqual(
		result.warehouses.map((w) => w.warehouse_name),
		["Gudang Bekasi", "Gudang Surabaya"],
	);
	const [bekasi, surabaya] = result.warehouses;
	assert.deepEqual(bekasi?.items.map((i) => [i.sku, i.quantity, i.parcels]), [
		["SKU-A", 5, 1],
		["SKU-B", 4, 1],
	]);
	assert.equal(surabaya?.parcel_count, 2);
	assert.deepEqual(surabaya?.orders, ["ORD-1", "ORD-2"]);
	// 2 + 3 of A across two parcels, 1 of B in one parcel: sums never cross warehouses.
	assert.deepEqual(surabaya?.items.map((i) => [i.sku, i.quantity, i.parcels]), [
		["SKU-A", 5, 2],
		["SKU-B", 1, 1],
	]);
});

test("picklist of nothing is empty", () => {
	assert.deepEqual(aggregatePicklist([]), { warehouses: [] });
});
