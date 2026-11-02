import assert from "node:assert/strict";
import test from "node:test";
import { channelEnabled, type PaymentChannel, type PaymentTerms } from "../src/modules/payments/methods.ts";
import { assertUsablePaymentChannels, valuesFor } from "../src/modules/settings/policies.ts";

const ACCOUNT = { bank_name: "BCA", account_number: "1234567890", account_holder: "PT Contoh" };
const terms = (over: Partial<PaymentTerms>): PaymentTerms => ({
	version_id: null, cod_fee_bps: 0, manual_bank_accounts: [ACCOUNT], enabled_channels: ["manual-bank", "autolaris", "cod"], ...over,
});

test("payment policy: enabled_channels is optional, a non-empty unique subset, stored in a fixed order", () => {
	assert.equal("enabled_channels" in valuesFor("payment", { cod_fee_bps: 0 }), false);
	assert.deepEqual((valuesFor("payment", { cod_fee_bps: 0, enabled_channels: ["cod", "manual-bank"] }) as { enabled_channels?: string[] }).enabled_channels, ["manual-bank", "cod"]);
	// A version must leave one channel that works: transfer without an account alone is refused (422).
	// Write-time only: reading a stored version never applies it.
	assert.doesNotThrow(() => valuesFor("payment", { cod_fee_bps: 0, enabled_channels: ["manual-bank"] }));
	assert.throws(() => assertUsablePaymentChannels({ manual_bank_accounts: [], enabled_channels: ["manual-bank"] }), { code: "PAYMENT_CHANNELS_UNUSABLE" });
	assert.doesNotThrow(() => assertUsablePaymentChannels({ manual_bank_accounts: [ACCOUNT], enabled_channels: ["manual-bank"] }));
	assert.doesNotThrow(() => assertUsablePaymentChannels({ manual_bank_accounts: [] }));
	// Local runtime: the AutoLaris simulator counts as usable (production refuses it until S97).
	assert.doesNotThrow(() => assertUsablePaymentChannels({ manual_bank_accounts: [], enabled_channels: ["autolaris"] }));
	for (const bad of [[], ["cod", "cod"], ["local-prepaid"], ["paypal"], "cod"]) {
		assert.throws(() => valuesFor("payment", { cod_fee_bps: 0, enabled_channels: bad }), String(bad));
	}
});

// The runtime's offering is passed in, so this test needs no environment (npm test runs without one).
const LOCAL: PaymentChannel[] = ["local-prepaid", "manual-bank", "autolaris", "cod"];
const PRODUCTION: PaymentChannel[] = ["manual-bank", "cod"];
const on = (t: PaymentTerms, c: PaymentChannel, offered = LOCAL) => channelEnabled(t, c, offered);

test("a channel is offered only when the runtime offers it and the owner switched it on; bank also needs an account", () => {
	assert.equal(on(terms({}), "autolaris", PRODUCTION), false, "production never offers the simulator, switched on or not");
	assert.equal(on(terms({}), "cod"), true);
	assert.equal(on(terms({ enabled_channels: ["manual-bank"] }), "cod"), false);
	assert.equal(on(terms({ enabled_channels: ["cod"] }), "manual-bank"), false);
	assert.equal(on(terms({ manual_bank_accounts: [] }), "manual-bank"), false);
	// Local runtime: the simulator is always there and AutoLaris (simulated) follows the switch.
	assert.equal(on(terms({ enabled_channels: ["cod"] }), "local-prepaid"), true);
	assert.equal(on(terms({ enabled_channels: ["cod"] }), "autolaris"), false);
	assert.equal(on(terms({}), "autolaris"), true);
});
