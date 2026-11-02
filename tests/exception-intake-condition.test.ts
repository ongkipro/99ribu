import assert from "node:assert/strict";
import test from "node:test";
import { exceptionIntakeRequest, intakeMovementReason } from "../src/modules/checkout/exceptions/policy.ts";

const U = "00000000-0000-4000-8000-0000000000a1";
const SKU = "00000000-0000-4000-8000-0000000000b1";
const BAL = "00000000-0000-4000-8000-0000000000c1";
const body = (line: Record<string, unknown>) => ({
	expected_version: 1,
	physical_outcome_id: "00000000-0000-4000-8000-0000000000d1",
	reason: "Barang tiba",
	lines: [{ exception_unit_id: U, quantity: 1, ...line }],
});
const confirmed = { stock_item_id: SKU, expected_balance_id: BAL, identity_confirmed: true };
const unidentified = { stock_item_id: null, expected_balance_id: null, identity_confirmed: false };

test("a confirmed intake line needs one of the three conditions and keeps it", () => {
	for (const condition of ["baik", "rusak", "tidak_lengkap"]) {
		assert.equal(exceptionIntakeRequest(body({ ...confirmed, condition })).lines[0].condition, condition);
	}
	assert.throws(() => exceptionIntakeRequest(body(confirmed)));
	assert.throws(() => exceptionIntakeRequest(body({ ...confirmed, condition: null })));
	assert.throws(() => exceptionIntakeRequest(body({ ...confirmed, condition: "hilang" })));
});

test("an unidentified line carries no condition", () => {
	assert.equal(exceptionIntakeRequest(body(unidentified)).lines[0].condition, null);
	assert.equal(exceptionIntakeRequest(body({ ...unidentified, condition: null })).lines[0].condition, null);
	assert.throws(() => exceptionIntakeRequest(body({ ...unidentified, condition: "baik" })));
});

test("the movement reason leads with the condition and is cut by code point, never inside an emoji", () => {
	assert.equal(intakeMovementReason("tidak_lengkap", "Tutup hilang"), "Kondisi tidak lengkap: Tutup hilang");
	const reason = intakeMovementReason("rusak", "😀".repeat(500));
	assert.equal(Array.from(reason).length, 500);
	assert.ok(reason.isWellFormed());
	assert.ok(reason.startsWith("Kondisi rusak: "));
});
