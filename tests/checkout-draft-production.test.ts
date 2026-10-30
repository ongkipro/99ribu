import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

// Production keeps no server-side checkout drafts (buyer PII at rest); the checkout must still load (2026-10-31: the
// local-only draft namespace made every production checkout read fail as "Checkout belum dapat dimuat").
test("production: checkout drafts are off; read is empty, write and clear touch nothing", async () => {
	const draft = await import("../src/modules/storefront/checkout-draft.ts");
	const saved = process.env;
	process.env = { NODE_ENV: "test", APP_ENV: "production", APP_ORIGIN: "https://99ribu.com", BETTER_AUTH_URL: "https://99ribu.com", BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
		PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "disabled", ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled", EXTERNAL_DISPATCH: "disabled",
		DATABASE_HOST: "synthetic-host", DATABASE_APP_PASSWORD: "synthetic-app-password-0123456789", CLIENT_IP_HEADER: "x-real-ip" };
	try {
		const untouched = new Proxy({}, { get: () => { throw new Error("identity must not be used"); } }) as never;
		const request = new Request("https://99ribu.com/checkout", { method: "POST" });
		assert.equal(draft.checkoutDraftsEnabled(), false);
		assert.deepEqual(await draft.readCheckoutDraft(request, untouched, "00000000-0000-4000-8000-000000000001"), { kind: "empty", progress: null });
		assert.deepEqual(await draft.writeCheckoutDraft(request, untouched, { draft_revision: "3" } as never), { kind: "stale", revision: 3 });
		assert.equal(await draft.clearCheckoutDraft(request, untouched, "00000000-0000-4000-8000-000000000001"), undefined);
	} finally { process.env = saved; }
});
