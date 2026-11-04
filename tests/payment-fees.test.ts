import assert from "node:assert/strict";
import test from "node:test";
import { AUTOLARIS_CHANNELS } from "../src/modules/payments/autolaris.ts";
import { autolarisBuyerFee } from "../src/modules/payments/methods.ts";
import { AUTOLARIS_FEE_CHANNELS, assertUsablePaymentChannels, valuesFor } from "../src/modules/settings/policies.ts";

// DEC-029 / S172: who bears payment fees, and the buyer-borne AutoLaris fee rule.
// Owner 2026-11-04 rates: QRIS 0,7%, VA BCA Rp6.500, every other VA Rp3.000.
const table = { VABNI: { kind: "fixed", amount: 3000 }, VAPERMATA: { kind: "fixed", amount: 3000 }, VABCA: { kind: "fixed", amount: 6500 },
	VAMANDIRI: { kind: "fixed", amount: 3000 }, VABRI: { kind: "fixed", amount: 3000 }, QRIS: { kind: "bps", bps: 70 } } as const;
const buyer = { payment_fee_bearer: "buyer" as const, autolaris_fees: table };

test("the fee table names exactly the AutoLaris channels", () => {
	assert.deepEqual([...AUTOLARIS_FEE_CHANNELS].sort(), [...AUTOLARIS_CHANNELS].sort());
});

test("store-borne fee is zero; a buyer-borne fixed fee is the table amount; an unpriced channel is null", () => {
	assert.equal(autolarisBuyerFee({ payment_fee_bearer: "store", autolaris_fees: table }, "VABCA", 109500), 0);
	assert.equal(autolarisBuyerFee(buyer, "VABCA", 109500), 6500);
	assert.equal(autolarisBuyerFee({ payment_fee_bearer: "buyer", autolaris_fees: {} }, "VABCA", 109500), null);
	assert.equal(autolarisBuyerFee(buyer, "toString", 1000), null, "no prototype keys");
});

test("a percentage fee is grossed up so the buyer never pays more than the provider deducts", () => {
	const deducted = (x: number, bps: number) => x - Math.ceil((x * bps) / 10000);
	for (const bps of [70, 1, 150, 2000]) {
		for (let due = 1; due <= 3000; due++) {
			const fee = autolarisBuyerFee({ payment_fee_bearer: "buyer", autolaris_fees: { QRIS: { kind: "bps", bps } } }, "QRIS", due) as number;
			const bill = due + fee, providerFee = Math.ceil((bill * bps) / 10000);
			assert.ok(fee >= 0 && fee <= providerFee, `buyer fee ${fee} within the provider fee ${providerFee} (due ${due}, ${bps} bps)`);
			assert.ok(deducted(bill, bps) <= due && deducted(bill + 1, bps) > due, `largest bill (due ${due}, ${bps} bps)`);
			assert.ok(providerFee - fee <= 1, "the store absorbs at most the rounding rupiah");
		}
	}
	// The provider deducts its fee from the bill (AdsBookCMS live evidence): a Rp10.071 QRIS bill loses ceil(70,497) = Rp71
	// and leaves exactly Rp10.000, so the buyer fee is Rp71 (the guide's "on top" sample would have been Rp70).
	assert.equal(autolarisBuyerFee(buyer, "QRIS", 10000), 71);
});

test("payment policy accepts the bearers and the fee table and refuses anything else", () => {
	const v = valuesFor("payment", { cod_fee_bps: 333, payment_fee_bearer: "buyer", cod_fee_bearer: "store", autolaris_fees: table }) as { payment_fee_bearer?: string; cod_fee_bearer?: string; autolaris_fees?: object };
	assert.deepEqual([v.payment_fee_bearer, v.cod_fee_bearer, Object.keys(v.autolaris_fees ?? {}).length], ["buyer", "store", 6]);
	assert.equal("payment_fee_bearer" in valuesFor("payment", { cod_fee_bps: 0 }), false, "older versions stay without the fields");
	for (const bad of [{ payment_fee_bearer: "seller" }, { cod_fee_bearer: "" }, { autolaris_fees: { OVO: { kind: "fixed", amount: 1 } } },
		{ autolaris_fees: { QRIS: { kind: "bps", bps: 2001 } } }, { autolaris_fees: { VABCA: { kind: "fixed", amount: -1 } } },
		{ autolaris_fees: { VABCA: { kind: "fixed", amount: 1, extra: 1 } } }, { autolaris_fees: [] },
		{ autolaris_fees: { QRIS: { kind: "fixed", amount: 700 } } }, { autolaris_fees: { VABCA: { kind: "bps", bps: 70 } } }]) {
		assert.throws(() => valuesFor("payment", { cod_fee_bps: 0, ...bad }), { code: "INVALID_INPUT" }, JSON.stringify(bad));
	}
	assert.throws(() => assertUsablePaymentChannels({ manual_bank_accounts: [], payment_fee_bearer: "buyer", autolaris_fees: { VABCA: table.VABCA } }), { code: "PAYMENT_FEE_TABLE_INCOMPLETE" });
	assert.doesNotThrow(() => assertUsablePaymentChannels({ manual_bank_accounts: [], payment_fee_bearer: "buyer", autolaris_fees: table }));
});
