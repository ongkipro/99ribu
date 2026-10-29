import assert from "node:assert/strict";
import test from "node:test";
import type { AccountOrder, OrderStage } from "../src/modules/accounts/order-summary.ts";
import { accountOrderDate, countAccountOrders, filterAccountOrders } from "../src/components/storefront/account/order-filters.ts";

const order = (number: string, stage: OrderStage): AccountOrder => ({
	id: number,
	number,
	created_at: "2026-10-28T00:00:00.000Z",
	stage,
	stage_label: "Diproses",
	detail: null,
	buyer_total: 99000,
	units: 1,
	payment_label: "QRIS",
	items: [],
	can_reorder: false,
});
const orders = [
	order("99-AB12CD34", "unpaid"),
	order("99-EF56GH78", "processing"),
	order("99-IJ90KL12", "shipped"),
	order("99-MN34OP56", "delivered"),
	order("99-QR78ST90", "closed"),
	order("99-UV12WX34", "closed"),
];

test("account filters count complete loaded orders, including all closed outcomes", () => {
	assert.deepEqual(countAccountOrders(orders), { all: 6, unpaid: 1, processing: 1, shipped: 1, delivered: 1, closed: 2 });
	assert.deepEqual(countAccountOrders([]), { all: 0, unpaid: 0, processing: 0, shipped: 0, delivered: 0, closed: 0 });
});

test("account stage filters preserve the server's newest-first order without mutating it", () => {
	const before = [...orders];
	assert.deepEqual(filterAccountOrders(orders, "closed", "").map((item) => item.number), ["99-QR78ST90", "99-UV12WX34"]);
	assert.deepEqual(filterAccountOrders(orders, "all", ""), orders);
	for (const stage of ["unpaid", "processing", "shipped", "delivered"] as const) {
		assert.equal(filterAccountOrders(orders, stage, "").length, 1, stage);
	}
	assert.deepEqual(orders, before);
});

test("account order search tolerates prefix, surrounding whitespace and letter case", () => {
	for (const query of ["AB12CD34", " ab12cd34 ", "99-ab12cd34", " 99 - ab12CD34 ", "cd34"]) {
		assert.deepEqual(filterAccountOrders(orders, "all", query).map((item) => item.number), ["99-AB12CD34"], query);
	}
	assert.equal(filterAccountOrders(orders, "all", "99-").length, orders.length);
	assert.equal(filterAccountOrders(orders, "all", "  ").length, orders.length);
});

test("account search and status combine, and empty results can be cleared", () => {
	assert.deepEqual(filterAccountOrders(orders, "closed", "AB12CD34"), []);
	assert.deepEqual(filterAccountOrders(orders, "all", "does-not-exist"), []);
	assert.deepEqual(filterAccountOrders([], "all", ""), []);
	assert.equal(filterAccountOrders(orders, "all", "").length, 6);
});

test("account order dates use Indonesian dates and WIB, including UTC day rollover", () => {
	const value = accountOrderDate("2026-10-27T18:05:00.000Z");
	assert.match(value, /28 Okt 2026/);
	assert.match(value, /01[.:]05/);
	assert.ok(value.endsWith(" WIB"));
});
