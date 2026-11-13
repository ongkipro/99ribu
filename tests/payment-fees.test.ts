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

test("DEC-032 formula B: the smallest bill that leaves the store the order total after the channel fee and the turnover cut", () => {
	const cut = (x: number, bps: number) => Math.ceil((x * bps) / 10000);
	const shapes = [[{ kind: "fixed", amount: 3000 }, 100], [{ kind: "fixed", amount: 6500 }, 100], [{ kind: "bps", bps: 70 }, 100], [{ kind: "bps", bps: 70 }, 0],
		[{ kind: "fixed", amount: 6500 }, 0], [{ kind: "bps", bps: 2000 }, 0], [{ kind: "fixed", amount: 0 }, 2000]] as const;
	for (const [rule, turnover] of shapes) {
		const channel = rule.kind === "bps" ? "QRIS" : "VABNI";
		for (let due = 1; due <= 3000; due++) {
			const fee = autolarisBuyerFee({ payment_fee_bearer: "buyer", autolaris_fees: { [channel]: rule }, autolaris_turnover_bps: turnover }, channel, due) as number;
			const kept = (x: number) => x - (rule.kind === "fixed" ? rule.amount : cut(x, rule.bps)) - cut(x, turnover);
			assert.ok(fee >= 0 && kept(due + fee) >= due, `the store keeps the order total (due ${due}, ${JSON.stringify(rule)}, ${turnover})`);
			assert.ok(kept(due + fee - 1) < due, `no smaller bill would do (due ${due}, ${JSON.stringify(rule)}, ${turnover})`);
		}
	}
	// Owner's figures (2026-11-11): order total Rp107.000 incl. shipping; VA Rp3.000, VA BCA Rp6.500, QRIS 0,7%, each plus 1%.
	const owner = { payment_fee_bearer: "buyer" as const, autolaris_fees: table, autolaris_turnover_bps: 100 };
	assert.equal(autolarisBuyerFee(owner, "VABNI", 107000), 4112, "VA Rp3.000 + 1%: bill Rp111.112, AutoLaris keeps 3.000 + 1.112");
	assert.equal(autolarisBuyerFee(owner, "VABCA", 107000), 7647);
	assert.equal(autolarisBuyerFee(owner, "QRIS", 107000), 1851, "QRIS 0,7% + 1%");
	// No turnover (older versions) keeps the DEC-029 values exactly.
	assert.equal(autolarisBuyerFee(buyer, "VABCA", 109500), 6500);
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
	// DEC-032: the account-wide turnover cut is optional, an integer 0–2000 basis points.
	assert.equal((valuesFor("payment", { cod_fee_bps: 0, autolaris_turnover_bps: 100 }) as { autolaris_turnover_bps?: number }).autolaris_turnover_bps, 100);
	assert.equal("autolaris_turnover_bps" in valuesFor("payment", { cod_fee_bps: 0 }), false);
	for (const bad of [-1, 2001, 1.5, "100", null]) assert.throws(() => valuesFor("payment", { cod_fee_bps: 0, autolaris_turnover_bps: bad }), { code: "INVALID_INPUT" }, String(bad));
	assert.throws(() => valuesFor("payment", { cod_fee_bps: 0, autolaris_fees: { VABNI: { kind: "fixed_bps", amount: 3000, bps: 100 } } }), { code: "INVALID_INPUT" }, "no combined rule kind");
});

test("DEC-032 provider check: the buyer fee may exceed the channel fee only by the rule's percentage of the bill", async () => {
	const { buyerFeeCovered } = await import("../src/modules/payments/autolaris.ts");
	// VA Rp3.000 with a 1% turnover cut on a Rp111.112 bill: AutoLaris reports 3.000; 1% of the bill is 1.112, so 4.112 is covered, 4.113 is not.
	assert.equal(buyerFeeCovered(4112, 3000, 100, 111112), true);
	assert.equal(buyerFeeCovered(4113, 3000, 100, 111112), false);
	// No turnover cut keeps the DEC-029 rule exactly: the fee may not exceed what the provider reports.
	assert.equal(buyerFeeCovered(6500, 6500, 0, 116000), true);
	assert.equal(buyerFeeCovered(6501, 6500, 0, 116000), false);
	// A provider that charges more than the table (fee table too low) is fine for the buyer: the store bears the difference.
	assert.equal(buyerFeeCovered(3000, 4000, 0, 110000), true);
});
