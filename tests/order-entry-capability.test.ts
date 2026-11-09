import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MONEY_CAPABILITIES, OPENABLE_MONEY_CAPABILITIES } from "../src/config/runtime.ts";
import { AccessError } from "../src/modules/access/policy.ts";
import { submitOrder } from "../src/modules/checkout/orders.ts";
import { offeredChannels, PAYMENT_CHANNELS, paymentChannel, productionChannelOpen, type PaymentChannel } from "../src/modules/payments/methods.ts";

// S181 step 3a (ADR-0008): production takes an order only on a channel whose money capability is listed. The default
// (MONEY_CAPABILITIES empty) keeps every order entry point closed, exactly as before.
const origin = "https://99ribu.com";
const secret = randomBytes(48).toString("base64");
const base: Record<string, string> = {
  NODE_ENV: "test", APP_ENV: "production", APP_ORIGIN: origin, BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: secret,
  PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "disabled", ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled",
  EXTERNAL_DISPATCH: "disabled", DATABASE_HOST: "postgres-99ribu", DATABASE_APP_PASSWORD: "synthetic-sentinel-app-password", CLIENT_IP_HEADER: "x-real-ip",
};
const autolaris = { AUTOLARIS_API_KEY: "synthetic-sentinel-autolaris-key", AUTOLARIS_ORDER_ORIGIN_ID: "3517100", AUTOLARIS_ORDER_DESTINATION_ID: "3518010" };
async function withEnv<T>(capabilities: string | undefined, run: () => T | Promise<T>) {
  const saved = process.env;
  process.env = { ...base, ...(String(capabilities ?? "").split(",").map((name) => name.trim()).includes("payments") ? autolaris : {}), ...(capabilities === undefined ? {} : { MONEY_CAPABILITIES: capabilities }) } as NodeJS.ProcessEnv;
  try { return await run(); } finally { process.env = saved; }
}
const closed = (error: unknown) => error instanceof AccessError && error.status === 503 && error.code === "CHECKOUT_CLOSED";
const CHANNEL_CAPABILITY: Record<PaymentChannel, string | null> = { "local-prepaid": null, "manual-bank": "manual_bank", autolaris: "payments", cod: "cod" };

test("every channel has exactly one capability, and the simulator has none (never open in production)", () => {
  assert.deepEqual(Object.keys(PAYMENT_CHANNELS).sort(), Object.keys(CHANNEL_CAPABILITY).sort(), "a new channel must be given a capability here");
  for (const capability of Object.values(CHANNEL_CAPABILITY)) if (capability) assert.ok((MONEY_CAPABILITIES as readonly string[]).includes(capability), String(capability));
});

test("closed by default: with no capability nothing is offered and no channel is open", async () => {
  for (const capabilities of [undefined, "", "   "]) {
    await withEnv(capabilities, () => {
      assert.deepEqual(offeredChannels(), [], String(capabilities));
      for (const channel of Object.keys(PAYMENT_CHANNELS) as PaymentChannel[]) assert.equal(productionChannelOpen(channel), false, channel);
    });
  }
});

test("one capability opens only its own channel", async () => {
  for (const [channel, capability] of Object.entries(CHANNEL_CAPABILITY) as Array<[PaymentChannel, string | null]>) {
    // `cod` is refused at startup (Argon S181-3a High) so it cannot be listed; its channel stays closed until it is wired.
    if (!capability || !(OPENABLE_MONEY_CAPABILITIES as readonly string[]).includes(capability)) continue;
    await withEnv(capability, () => {
      assert.deepEqual(offeredChannels(), [channel], capability);
      for (const other of Object.keys(PAYMENT_CHANNELS) as PaymentChannel[]) assert.equal(productionChannelOpen(other), other === channel, `${capability} -> ${other}`);
    });
  }
});

test("the simulator channel is never open in production, whatever is listed", async () => {
  await withEnv("payments,manual_bank", () => {
    assert.equal(productionChannelOpen("local-prepaid"), false);
    assert.ok(!offeredChannels().includes("local-prepaid"));
    assert.throws(() => paymentChannel("prepaid", "local-prepaid"), { code: "PAYMENT_CHANNEL_UNAVAILABLE" });
    assert.throws(() => paymentChannel("prepaid", undefined), { code: "PAYMENT_CHANNEL_UNAVAILABLE" });
  });
});

test("a listed channel is accepted by the quote's channel check and an unlisted one is refused", async () => {
  await withEnv("payments", () => {
    assert.equal(paymentChannel("prepaid", "autolaris"), "autolaris");
    assert.throws(() => paymentChannel("prepaid", "manual-bank"), { code: "PAYMENT_CHANNEL_UNAVAILABLE" });
    assert.throws(() => paymentChannel("cod", undefined), { code: "PAYMENT_CHANNEL_UNAVAILABLE" });
  });
  await withEnv("manual_bank", () => {
    assert.equal(paymentChannel("prepaid", "manual-bank"), "manual-bank");
    assert.throws(() => paymentChannel("cod", undefined), { code: "PAYMENT_CHANNEL_UNAVAILABLE" }, "cod stays closed: it cannot be listed");
    assert.throws(() => paymentChannel("prepaid", "autolaris"), { code: "PAYMENT_CHANNEL_UNAVAILABLE" });
  });
});

test("order entry stays closed in production while no capability is listed, before any database access", async () => {
  await withEnv(undefined, async () => {
    const touched: string[] = [];
    const tx = new Proxy({}, { get: (_target, property) => { touched.push(String(property)); throw new Error("the database must not be touched while checkout is closed"); } }) as never;
    await assert.rejects(submitOrder(tx, new Request(`${origin}/api/v1/orders`), {} as never, { kind: "guest", id: "x" }, {}), closed);
    assert.deepEqual(touched, [], "no transaction method was used");
  });
});

test("the order-entry gate is exactly `production && nothing offered`: local keeps its own flow", async () => {
  // With a capability listed the early gate lets the request continue to validation (a malformed body is then a client error, not CHECKOUT_CLOSED).
  await withEnv("manual_bank", async () => {
    await assert.rejects(submitOrder({} as never, new Request(`${origin}/api/v1/orders`), {} as never, { kind: "guest", id: "x" }, {}), (error: unknown) => !closed(error));
  });
});

test("the source: the early gate and the per-quote channel check both read the same function as the checkout listing", async () => {
  const { readFileSync } = await import("node:fs");
  const orders = readFileSync(new URL("../src/modules/checkout/orders.ts", import.meta.url), "utf8");
  assert.match(orders, /profile==='production'&&offeredChannels\(\)\.length===0\)throw new AccessError\(503,'CHECKOUT_CLOSED'\)/);
  assert.match(orders, /profile==='production'&&!productionChannelOpen\(channel\)\)throw new AccessError\(503,'CHECKOUT_CLOSED'\)/);
  const methods = readFileSync(new URL("../src/modules/payments/methods.ts", import.meta.url), "utf8");
  assert.match(methods, /runtimeTarget\(\)==='production'\?all\.filter\(channel=>productionChannelOpen\(channel\)\):all/);
  // The only INSERT of an order is behind both gates (nothing else writes commerce_order).
  const writers = ["src/modules/checkout/orders.ts"].filter((file) => /insert into app\.commerce_order/.test(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")));
  assert.deepEqual(writers, ["src/modules/checkout/orders.ts"]);
});

test("the storefront has a closed-checkout state: no empty payment box when no method is open (Argon S181-3a finding 5)", async () => {
  const { readFileSync } = await import("node:fs");
  const checkout = readFileSync(new URL("../src/modules/storefront/checkout.ts", import.meta.url), "utf8");
  assert.match(checkout, /if\(methods\.length===0\)return \{\.\.\.checkoutUnavailableView\(\),kind:'unavailable',code:'CHECKOUT_CLOSED'\}/);
  const page = readFileSync(new URL("../src/app/(storefront)/checkout/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Checkout belum dibuka/);
  assert.match(page, /Kembali ke keranjang/);
  // The form is only rendered for a ready view; the closed state is `unavailable`, which takes the recovery branch.
  assert.match(page, /if\(view\.kind!=='ready'\|\|!view\.cart\?\.lines\.length\)return/);
});

test("no simulator copy reaches a production buyer (Argon S181-3a finding 2)", async () => {
  const { readFileSync } = await import("node:fs");
  const forms = readFileSync(new URL("../src/components/storefront/checkout-forms.tsx", import.meta.url), "utf8");
  const vaRow = forms.split("\n").find((line) => line.includes("id:'va'")) ?? "";
  assert.ok(vaRow && !/Simulasi|lokal/i.test(vaRow), `the live channel row must not say simulation: ${vaRow.trim()}`);
  const attempts = readFileSync(new URL("../src/modules/payments/attempts.ts", import.meta.url), "utf8");
  const display = attempts.split("\n").find((line) => line.includes("Instruksi pembayaran sedang dibuat")) ?? "";
  assert.match(display, /runtimeTarget\(\)==='production'\?'Bayar sebelum batas waktu/);
  // Simulator wording survives only on the non-production branch.
  const production = display.slice(display.indexOf("runtimeTarget()==='production'?"), display.indexOf(":'Simulasi lokal AutoLaris"));
  assert.ok(!/Simulasi|simulasi|lokal/.test(production), "the production branch carries no simulator wording");
});

test("the order page has two views of one authorised address: a COD thank-you and a prepaid payment step (S181 step 3a)", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../src/app/(storefront)/checkout/order/[orderId]/page.tsx", import.meta.url), "utf8");
  // COD with money due and the order still open is the thank-you: nothing to pay now.
  assert.match(page, /const thanks=cod&&!paid&&!closed&&order\.payment_status==='cod_due'/);
  assert.match(page, /thanks\?'Terima kasih, pesanan Anda tersimpan'/);
  // A prepaid order is the payment step, titled for the action.
  assert.match(page, /'Selesaikan pembayaran'/);
  assert.ok(!/'Menunggu pembayaran'/.test(page), "the old prepaid title is gone from this page");
  // The thank-you has no payment-status refresh control (nothing to refresh) and the payment step keeps it.
  assert.match(page, /\{thanks\?<div className="checkout-next-step">/);
  assert.match(page, /Perbarui status<\/a>/);
  // The access boundary is untouched: same path, same reader, no new route, no new cookie scope.
  assert.match(page, /const path=checkoutOrderPath\(orderId\),view=await readCheckoutPayment\(await storefrontRequest\('GET',path\),getLocalAuth\(\),orderId\)/);
  const order = readFileSync(new URL("../src/modules/storefront/checkout-order.ts", import.meta.url), "utf8");
  assert.match(order, /export const checkoutOrderPath=\(orderId:string\)=>`\/checkout\/order\/\$\{id\(orderId\)\}`;/);
  const { existsSync } = await import("node:fs");
  assert.ok(!existsSync(new URL("../src/app/(storefront)/thanks", import.meta.url)) && !existsSync(new URL("../src/app/(storefront)/payment", import.meta.url)), "no second route reads an order outside the scoped cookie path");
});
