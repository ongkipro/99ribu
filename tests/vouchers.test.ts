import assert from "node:assert/strict";
import test from "node:test";
import { VOUCHERS_ENABLED, VOUCHER_REASONS, voucherMessage, type VoucherReason } from "../src/modules/storefront/vouchers.ts";
import type { VoucherReason as QuoteReason } from "../src/modules/checkout/quotes.ts";

// S177: every reason the quote answers (VoucherReason in checkout/quotes.ts) has one buyer sentence, and no other.
const REASONS = ["NOT_FOUND", "EXHAUSTED", "MIN_SUBTOTAL", "METHOD_NOT_ELIGIBLE", "DESTINATION_NOT_ELIGIBLE", "SHIPPING_METHOD_NOT_ELIGIBLE", "EXPIRED", "PER_BUYER_LIMIT", "NOT_STARTED", "STACKING_CONFLICT"] as const satisfies readonly (VoucherReason & QuoteReason)[];

test("every voucher reason code has one short Indonesian sentence and no extra codes exist", () => {
	assert.deepEqual(Object.keys(VOUCHER_REASONS).sort(), [...REASONS].sort());
	for (const reason of REASONS) {
		const copy = voucherMessage(reason);
		assert.match(copy, /^[A-Z][^\n]{5,80}\.$/, `${reason} copy is one sentence`);
		assert.doesNotMatch(copy, /[A-Z_]{4,}/, `${reason} copy shows no code`);
	}
});

test("reasons with a value name it (shortfall like Indonesian marketplaces), the rest ignore details", () => {
	assert.equal(voucherMessage("MIN_SUBTOTAL", { shortfall: "Rp12.000" }), "Tambah belanja Rp12.000 lagi untuk memakai voucher ini.");
	assert.equal(voucherMessage("METHOD_NOT_ELIGIBLE", { method: "COD" }), "Voucher tidak berlaku untuk COD.");
	assert.equal(voucherMessage("EXPIRED", { method: "COD" }), "Voucher sudah berakhir.");
});

test("vouchers are switched on with the S177 backend", () => {
	assert.equal(VOUCHERS_ENABLED, true);
});
