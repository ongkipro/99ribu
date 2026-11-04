import assert from "node:assert/strict";
import test from "node:test";
import { VOUCHERS_ENABLED, VOUCHER_REASONS, voucherMessage, type VoucherReason } from "../src/modules/storefront/vouchers.ts";

// Stage 1 (owner 2026-11-05): every backend reason S177 may answer has buyer copy, and the control stays hidden.
const REASONS = ["NOT_FOUND", "EXHAUSTED", "MIN_SUBTOTAL", "METHOD_NOT_ELIGIBLE", "DESTINATION_NOT_ELIGIBLE", "SHIPPING_METHOD_NOT_ELIGIBLE", "EXPIRED", "PER_BUYER_LIMIT", "NOT_STARTED"] as const satisfies readonly VoucherReason[];

test("every voucher reason code has one short Indonesian sentence and no extra codes exist", () => {
	assert.deepEqual(Object.keys(VOUCHER_REASONS).sort(), [...REASONS].sort());
	for (const reason of REASONS) {
		const copy = voucherMessage(reason);
		assert.match(copy, /^[A-Z][^\n]{5,80}\.$/, `${reason} copy is one sentence`);
		assert.doesNotMatch(copy, /[A-Z_]{4,}/, `${reason} copy shows no code`);
	}
});

test("reasons with a backend value name it, the rest ignore details", () => {
	assert.equal(voucherMessage("MIN_SUBTOTAL", { min_subtotal: "Rp50.000" }), "Minimal belanja Rp50.000.");
	assert.equal(voucherMessage("METHOD_NOT_ELIGIBLE", { method: "COD" }), "Voucher tidak berlaku untuk COD.");
	assert.equal(voucherMessage("EXPIRED", { method: "COD" }), "Voucher sudah kedaluwarsa.");
});

test("vouchers stay switched off until S177 provides the backend", () => {
	assert.equal(VOUCHERS_ENABLED, false);
});
