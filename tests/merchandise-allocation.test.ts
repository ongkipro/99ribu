import assert from "node:assert/strict";
import test from "node:test";
import { allocateMerchandise, merchandiseBenefit, merchandiseCapacity, type MerchandiseLine } from "../src/modules/promotions/allocation.ts";

// S177 stage 2B design §3.3–3.4: the store-voucher discount is split per unit, sums exactly and leaves every unit ≥ Rp1.
test("merchandise allocation sums exactly, is deterministic and leaves every unit at least Rp1", () => {
	let seed = 177;
	const random = () => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed / 2147483648;
	};
	for (let run = 0; run < 20000; run++) {
		const lines: MerchandiseLine[] = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, i) => ({
			line_id: `line-${String.fromCharCode(101 - i)}`, unit_price: random() < 0.1 ? 1 : 1 + Math.floor(random() * 99000), quantity: 1 + Math.floor(random() * 6),
		}));
		const amount = Math.floor(random() * (Number(merchandiseCapacity(lines)) + 1));
		const result = allocateMerchandise(amount, lines);
		assert.deepEqual(allocateMerchandise(amount, [...lines].reverse()), result, "input order does not matter");
		assert.equal(result.reduce((sum, l) => sum + l.amount, 0), amount);
		for (const line of result) {
			const source = lines.find((l) => l.line_id === line.line_id);
			assert.ok(source);
			assert.equal(line.units.reduce((a, b) => a + b, 0), line.amount);
			assert.ok(line.units.every((u) => u >= 0 && u <= source.unit_price - 1), "unit keeps ≥ Rp1");
			assert.ok(line.units.every((u, i) => i === 0 || u <= line.units[i - 1]), "the extra rupiah goes to the first units");
		}
	}
});

test("merchandise allocation refuses more than the capacity; a Rp1 offer gets nothing", () => {
	const lines = [{ line_id: "a", unit_price: 1, quantity: 2 }, { line_id: "b", unit_price: 1000, quantity: 1 }];
	assert.equal(merchandiseCapacity(lines), 999n);
	assert.throws(() => allocateMerchandise(1000, lines), /PROMOTION_AMOUNT_LIMIT/);
	assert.deepEqual(allocateMerchandise(999, lines), [{ line_id: "a", amount: 0, units: [0, 0] }, { line_id: "b", amount: 999, units: [999] }]);
});

test("merchandise benefit: fixed or rounded percentage, capped by the maximum and by gross − units", () => {
	const lines = [{ line_id: "a", unit_price: 29000, quantity: 2 }];
	assert.equal(merchandiseBenefit({ kind: "fixed", value: 5000, maximum_per_order: 5000 }, lines), 5000);
	assert.equal(merchandiseBenefit({ kind: "percentage", value: 1000, maximum_per_order: 100000 }, lines), 5800);
	assert.equal(merchandiseBenefit({ kind: "percentage", value: 1000, maximum_per_order: 4000 }, lines), 4000);
	assert.equal(merchandiseBenefit({ kind: "fixed", value: 100000, maximum_per_order: 100000 }, lines), 57998);
});
