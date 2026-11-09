import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readMoneyDrain, readProductionConfig } from "../src/config/runtime.ts";
import { AccessError } from "../src/modules/access/policy.ts";
import { moneyEnvironment } from "../src/modules/finance/ledger.ts";
import { autolarisClientFor } from "../src/modules/payments/autolaris.ts";
import { assertChannelCapability } from "../src/modules/payments/local.ts";
import { offeredChannels, productionChannelOpen } from "../src/modules/payments/methods.ts";

// S181 step 3b (ADR-0008, Argon S181-3a finding 4): closing a channel must not strand orders already placed on it.
// MONEY_DRAIN = "take no new order, keep serving the ones that exist". Leaving a capability out of BOTH lists is the
// emergency stop. These tests prove both behaviours and that drain never re-opens order entry.
const origin = "https://99ribu.com";
const base: Record<string, string> = {
  NODE_ENV: "test", APP_ENV: "production", APP_ORIGIN: origin, BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
  PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "disabled", ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled",
  EXTERNAL_DISPATCH: "disabled", DATABASE_HOST: "postgres-99ribu", DATABASE_APP_PASSWORD: "synthetic-sentinel-app-password", CLIENT_IP_HEADER: "x-real-ip",
};
const autolaris = { AUTOLARIS_API_KEY: "synthetic-sentinel-autolaris-key", AUTOLARIS_ORDER_ORIGIN_ID: "3517100", AUTOLARIS_ORDER_DESTINATION_ID: "3518010" };
const needsAutolaris = (open: string | undefined, drain: string | undefined) => `${open ?? ""},${drain ?? ""}`.split(",").map((n) => n.trim()).includes("payments");
async function withEnv<T>(open: string | undefined, drain: string | undefined, run: () => T | Promise<T>) {
  const saved = process.env;
  process.env = { ...base, ...(needsAutolaris(open, drain) ? autolaris : {}), ...(open === undefined ? {} : { MONEY_CAPABILITIES: open }), ...(drain === undefined ? {} : { MONEY_DRAIN: drain }) } as NodeJS.ProcessEnv;
  try { return await run(); } finally { process.env = saved; }
}
const tx = (name: string) => (() => Promise.resolve([{ name }])) as never;
const gated = (error: unknown) => error instanceof AccessError && error.status === 503 && error.code === "PRODUCTION_MONEY_PATH_GATED";

test("MONEY_DRAIN parses like MONEY_CAPABILITIES, empty by default, and refuses cod and overlaps", () => {
  assert.deepEqual(readMoneyDrain({}, []), []);
  assert.deepEqual(readMoneyDrain({ MONEY_DRAIN: " payments " }, []), ["payments"]);
  assert.deepEqual(readMoneyDrain({ MONEY_DRAIN: "payments,manual_bank" }, []), ["payments", "manual_bank"]);
  for (const bad of ["cod", "payment", "payments,payments", "*", "PAYMENTS"]) assert.throws(() => readMoneyDrain({ MONEY_DRAIN: bad }, []), /MONEY_CAPABILITIES/, bad);
  assert.throws(() => readMoneyDrain({ MONEY_DRAIN: "payments" }, ["payments"]), /must not repeat/, "open and draining at once is a typo, not a state");
  assert.throws(() => readProductionConfig({ ...base, ...autolaris, MONEY_CAPABILITIES: "payments", MONEY_DRAIN: "payments" }), /must not repeat/);
});

test("a draining channel takes NO new order: it is not offered and order entry treats it as closed", async () => {
  for (const drain of ["payments", "manual_bank", "payments,manual_bank"]) {
    await withEnv(undefined, drain, () => {
      assert.deepEqual(offeredChannels(), [], drain);
      for (const channel of ["autolaris", "manual-bank", "cod", "local-prepaid"] as const) assert.equal(productionChannelOpen(channel), false, `${drain} -> ${channel}`);
    });
  }
  await withEnv("manual_bank", "payments", () => {
    assert.deepEqual(offeredChannels(), ["manual-bank"], "only the open channel is offered");
    assert.equal(productionChannelOpen("autolaris"), false);
  });
});

test("a draining channel keeps SERVING existing money: poll, settle, confirm and the client stay available", async () => {
  await withEnv(undefined, "payments", async () => {
    assert.equal(await moneyEnvironment(tx("99ribu_production"), "payments"), "production", "serving work on a draining channel");
    await assertChannelCapability(tx("99ribu_production"), "production", { method_id: "autolaris" });
    assert.equal(typeof autolarisClientFor("production").advice, "function", "advice polling keeps its client");
    // ...but a draining capability never serves another channel.
    await assert.rejects(moneyEnvironment(tx("99ribu_production"), "manual_bank"), gated);
    await assert.rejects(assertChannelCapability(tx("99ribu_production"), "production", { method_id: "manual-bank" }), gated);
  });
  await withEnv(undefined, "manual_bank", async () => {
    assert.equal(await moneyEnvironment(tx("99ribu_production"), "manual_bank"), "production");
    await assertChannelCapability(tx("99ribu_production"), "production", { method_id: "manual-bank" });
    assert.throws(() => autolarisClientFor("production"), (error: unknown) => error instanceof AccessError && error.code === "AUTOLARIS_LIVE_GATED");
  });
});

test("new-order work never sees drain: only productionChannelOpen gates order entry, and it ignores MONEY_DRAIN", async () => {
  // moneyEnvironment serves money tied to existing orders, so it accepts a draining capability by design (no `serving` flag:
  // an unused permissive default was removed after review). Order entry and the listing are the only new-order gates.
  await withEnv(undefined, "payments", async () => {
    assert.equal(await moneyEnvironment(tx("99ribu_production"), "payments"), "production");
    assert.equal(productionChannelOpen("autolaris"), false, "a draining channel takes no new order");
  });
});

test("the emergency stop is out of both lists: nothing is served, not even existing money", async () => {
  await withEnv(undefined, undefined, async () => {
    for (const capability of ["payments", "manual_bank"] as const) await assert.rejects(moneyEnvironment(tx("99ribu_production"), capability), gated, capability);
    await assert.rejects(assertChannelCapability(tx("99ribu_production"), "production", { method_id: "autolaris" }), gated);
    assert.throws(() => autolarisClientFor("production"), (error: unknown) => error instanceof AccessError && error.code === "AUTOLARIS_LIVE_GATED");
  });
});

test("draining payments still needs (and validates) the AutoLaris configuration, and accepts it", () => {
  assert.throws(() => readProductionConfig({ ...base, MONEY_DRAIN: "payments" }), /AUTOLARIS_API_KEY/);
  assert.deepEqual(readProductionConfig({ ...base, ...autolaris, MONEY_DRAIN: "payments" }).autolaris, { originId: 3517100, destinationId: 3518010 });
  assert.throws(() => readProductionConfig({ ...base, ...autolaris, MONEY_DRAIN: "manual_bank" }), /gated in production/, "a key without payments open or draining is still refused");
});

test("the worker registers adapters for open AND draining channels; compose forwards MONEY_DRAIN once", () => {
  const worker = readFileSync(new URL("../scripts/worker.ts", import.meta.url), "utf8");
  assert.match(worker, /const serves=\(name:'payments'\|'manual_bank'\)=>config\.moneyCapabilities\.includes\(name\)\|\|config\.moneyDrain\.includes\(name\);/);
  const compose = readFileSync(new URL("../compose.production.yaml", import.meta.url), "utf8");
  assert.equal(compose.split("\n").filter((line) => /^\s+MONEY_DRAIN: \$\{MONEY_DRAIN:-\}\s*$/.test(line)).length, 1);
  // The three NEW-order checks never read the drain list.
  for (const file of ["src/modules/payments/methods.ts", "src/modules/settings/policies.ts", "src/modules/checkout/orders.ts"]) {
    assert.ok(!/moneyDrain|MONEY_DRAIN/.test(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")), `${file} must not read the drain list`);
  }
});

test("a mid-session CHECKOUT_CLOSED is a definite refusal for the buyer, not 'result unknown' (Argon 3a round 2 Low)", () => {
  const checkout = readFileSync(new URL("../src/modules/storefront/checkout.ts", import.meta.url), "utf8");
  assert.match(checkout, /const KNOWN_PROVIDER_FAILURES=new Set\(\[[^\]]*'CHECKOUT_CLOSED'[^\]]*\]\)/);
  assert.match(checkout, /CHECKOUT_CLOSED:'Pemesanan dengan metode ini sedang ditutup\. Pesanan belum dibuat; keranjang Anda tetap tersimpan\.'/);
});
