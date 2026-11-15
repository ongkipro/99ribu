import assert from "node:assert/strict";
import test from "node:test";
import { paymentPromise } from "../src/modules/storefront/checkout.ts";

// The storefront names only the channels the runtime opens (production today: VA only), never "transfer bank atau COD".
test("payment promise names exactly the open channels, in a fixed order; nothing when none is open", () => {
	assert.equal(paymentPromise(["autolaris"]), "Bayar Virtual Account.");
	assert.equal(paymentPromise(["cod", "autolaris"]), "Bayar Virtual Account atau COD.");
	assert.equal(paymentPromise(["manual-bank", "cod", "autolaris"]), "Bayar Virtual Account, transfer bank atau COD.");
	assert.equal(paymentPromise(["local-prepaid"]), null);
	assert.equal(paymentPromise([]), null);
});
