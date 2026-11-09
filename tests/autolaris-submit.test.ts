import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import test from "node:test";
import { productionAutolaris, readProductionConfig } from "../src/config/runtime.ts";
import { AccessError } from "../src/modules/access/policy.ts";
import { autolarisCallbackUrl, autolarisClientFor, mayReplayProviderRequest, shouldHoldUnrecorded } from "../src/modules/payments/autolaris.ts";
import { liveAutolarisSubmit } from "../src/modules/payments/autolaris-live.ts";
import { buildSubmitPayload, parseSubmitExpiry, parseSubmitResponse, submitReference } from "../src/modules/payments/autolaris-submit.ts";

// S181 step 2b (ADR-0008): AutoLaris `submit` as a payment-only order. Fixtures follow the contract the production
// AdsBookCMS client on the same account verified (response: data.transaction_id, biaya_admin, total, payment_info).
const origin = "https://99ribu.com";
const base: Record<string, string> = {
  APP_ENV: "production", APP_ORIGIN: origin, BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
  PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "disabled", ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled",
  EXTERNAL_DISPATCH: "disabled", DATABASE_HOST: "postgres-99ribu", DATABASE_APP_PASSWORD: "synthetic-sentinel-app-password", CLIENT_IP_HEADER: "x-real-ip",
};
const live = { MONEY_CAPABILITIES: "payments", AUTOLARIS_API_KEY: "synthetic-sentinel-autolaris-key", AUTOLARIS_ORDER_ORIGIN_ID: "3517100", AUTOLARIS_ORDER_DESTINATION_ID: "3518010" };
async function withEnv<T>(change: Record<string, string | undefined>, run: () => T | Promise<T>) {
  const saved = process.env;
  process.env = { ...base, ...change } as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(change)) if (value === undefined) delete process.env[key];
  try { return await run(); } finally { process.env = saved; }
}
const gated = (error: unknown) => error instanceof AccessError && error.status === 503 && error.code === "AUTOLARIS_LIVE_GATED";
const area = { originId: 3517100, destinationId: 3518010 };
const attempt = "0b8e7c5a-1d3f-4a62-9c1e-5f2a7d9b3e44";

test("the reference is digits only, at most 30, deterministic per attempt and different across attempts", () => {
  const reference = submitReference(attempt);
  assert.match(reference, /^\d{30}$/);
  assert.equal(submitReference(attempt), reference, "the same attempt always replays the same reference");
  assert.notEqual(submitReference("0b8e7c5a-1d3f-4a62-9c1e-5f2a7d9b3e45"), reference);
  for (const bad of ["", "99R0b8e7c5a", "not-a-uuid", "0b8e7c5a-1d3f-4a62-9c1e-5f2a7d9b3e4", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"]) assert.throws(() => submitReference(bad), AccessError, bad);
});

test("the payload is a payment-only order with no buyer data and the amount as the bill", () => {
  const payload = buildSubmitPayload({ reff_id: submitReference(attempt), channel_code: "QRIS", amount: 9900, expires_at: new Date(), description: "Pesanan 99-ABCDEF0123456789" }, area);
  assert.equal(payload.courir_id, 1);
  assert.equal(payload.cod_value, "0");
  assert.equal(payload.grand_total, "9900");
  assert.deepEqual(payload.order_details, [{ name: "Pesanan 99-ABCDEF0123456789", qty: "1", unit_price: "9900" }]);
  assert.equal(payload.origin, 3517100);
  assert.equal(payload.destination, 3518010);
  assert.equal(payload.callback_url, "", "no callback: callbacks never settle");
  const text = JSON.stringify(payload);
  assert.ok(!text.includes("@"), "no email address is sent");
  for (const personal of ["Jalan Contoh", "Penerima Contoh"]) assert.ok(!text.includes(personal), personal);
  assert.equal(payload.receiver_email, "");
  assert.equal(payload.shipper_email, "");
});

test("the payload refuses a bad reference, channel or amount instead of sending it", () => {
  const ok = { reff_id: submitReference(attempt), channel_code: "QRIS", amount: 9900, expires_at: new Date(), description: "x" };
  for (const bad of [{ reff_id: "99R123" }, { reff_id: "1".repeat(31) }, { reff_id: "" }, { channel_code: "qris" }, { channel_code: "QRIS;DROP" }, { amount: 0 }, { amount: -1 }, { amount: 99.5 }, { amount: Number.NaN }, { amount: 2 ** 60 }]) {
    assert.throws(() => buildSubmitPayload({ ...ok, ...bad } as never, area), AccessError, JSON.stringify(bad));
  }
  assert.equal(buildSubmitPayload({ ...ok, description: "a\nb\r\nc".padEnd(300, "z") }, area).order_details[0].name.length, 100);
});

test("the area ids have no default: both or neither, positive integers only (validated once, by the production profile)", () => {
  const key = "synthetic-sentinel-autolaris-key";
  assert.deepEqual(productionAutolaris({ AUTOLARIS_API_KEY: key, AUTOLARIS_ORDER_ORIGIN_ID: "1", AUTOLARIS_ORDER_DESTINATION_ID: "2" }), { originId: 1, destinationId: 2 });
  for (const bad of [{}, { AUTOLARIS_ORDER_ORIGIN_ID: "1" }, { AUTOLARIS_ORDER_DESTINATION_ID: "2" }, { AUTOLARIS_ORDER_ORIGIN_ID: "0", AUTOLARIS_ORDER_DESTINATION_ID: "2" }, { AUTOLARIS_ORDER_ORIGIN_ID: "-1", AUTOLARIS_ORDER_DESTINATION_ID: "2" }, { AUTOLARIS_ORDER_ORIGIN_ID: "1.5", AUTOLARIS_ORDER_DESTINATION_ID: "2" }, { AUTOLARIS_ORDER_ORIGIN_ID: "abc", AUTOLARIS_ORDER_DESTINATION_ID: "2" }, { AUTOLARIS_ORDER_ORIGIN_ID: "9".repeat(25), AUTOLARIS_ORDER_DESTINATION_ID: "2" }, { AUTOLARIS_ORDER_ORIGIN_ID: " ", AUTOLARIS_ORDER_DESTINATION_ID: "2" }]) {
    assert.throws(() => productionAutolaris({ AUTOLARIS_API_KEY: key, ...bad }), /area ids/, JSON.stringify(bad));
  }
});

const ok = (extra: Record<string, unknown> = {}, info: Record<string, unknown> = {}) => ({ rc: "00", ket: "Sukses", data: { transaction_id: "1121999", biaya_admin: 70, total: 9970, payment_info: { qr: "00020101021226...", expired: "2026-11-09 22:15:00", ...info }, ...extra } });

test("the response is read exactly: one instruction field, the provider ids and the bill", () => {
  const parsed = parseSubmitResponse(ok());
  assert.equal(parsed.rejected, false);
  if (parsed.rejected) return;
  assert.deepEqual([parsed.transaction_id, parsed.instruction_kind, parsed.admin, parsed.total, parsed.amount], ["1121999", "qr", 70, 9970, 9970]);
  assert.equal(parsed.expires_at, "2026-11-09T15:15:00.000Z", "no offset is read as Jakarta time (+07:00)");
  const va = parseSubmitResponse(ok({}, { qr: "", va: "8779611150001393" }));
  assert.ok(!va.rejected && va.instruction_kind === "virtual_account" && va.instruction_value === "8779611150001393");
  const url = parseSubmitResponse(ok({}, { qr: "", url: "https://pay.example/x" }));
  assert.ok(!url.rejected && url.instruction_kind === "url");
});

test("anything unexpected is refused: no instruction, two instructions, bad ids, bad money, rc other than 00", () => {
  const malformed = /malformed/;
  assert.throws(() => parseSubmitResponse(ok({}, { qr: "" })), malformed, "no instruction field");
  assert.throws(() => parseSubmitResponse(ok({}, { va: "8779611150001393" })), malformed, "two instruction fields");
  assert.throws(() => parseSubmitResponse(ok({ transaction_id: "" })), malformed);
  assert.throws(() => parseSubmitResponse(ok({ transaction_id: "a b" })), malformed);
  assert.throws(() => parseSubmitResponse(ok({ transaction_id: "x".repeat(65) })), malformed);
  assert.throws(() => parseSubmitResponse(ok({ total: -1 })), malformed);
  assert.throws(() => parseSubmitResponse(ok({ total: 1.5 })), malformed);
  assert.throws(() => parseSubmitResponse(ok({ total: "9970x" })), malformed);
  assert.throws(() => parseSubmitResponse(ok({ biaya_admin: Number.NaN })), malformed);
  assert.throws(() => parseSubmitResponse({ rc: "00", ket: "", data: null }), malformed);
  assert.throws(() => parseSubmitResponse({ rc: "00", ket: "", data: [] }), malformed);
  assert.throws(() => parseSubmitResponse(ok({}, { qr: "x".repeat(2049) })), malformed);
  for (const rc of ["01", "07", "99", "xx"]) assert.deepEqual(parseSubmitResponse({ rc, ket: "no", data: null }), { rejected: true, rc });
  assert.equal(parseSubmitExpiry("not a date"), null);
  assert.equal(parseSubmitExpiry(undefined), null);
  assert.equal(parseSubmitExpiry("2026-13-45 99:99:99"), null);
});

test("the live submit client sends one POST to the pinned origin and hands DEC-029 its create-payment shape", async () => {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown>; auth: string }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>).authorization) });
    return new Response(JSON.stringify(ok({ total: 9900, biaya_admin: 70 })), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const client = liveAutolarisSubmit({ baseUrl: "https://api-h2h.autolaris.com", apiKey: "synthetic-sentinel-autolaris-key" }, area, fetchImpl);
  const envelope = await client.createPayment({ reff_id: submitReference(attempt), channel_code: "QRIS", customer_id: "99-X", customer_name: "Nama Rahasia", customer_phone: "087700011122", customer_email: "rahasia@example.com", expired: "20261109221500", amount: "9900", callback_url: "https://99ribu.com/x" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api-h2h.autolaris.com/api/h2h/submit");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].auth, "Bearer synthetic-sentinel-autolaris-key");
  assert.ok(!JSON.stringify(calls[0].body).includes("Nama Rahasia") && !JSON.stringify(calls[0].body).includes("rahasia@example.com") && !JSON.stringify(calls[0].body).includes("087700011122"), "no buyer data leaves the server");
  assert.deepEqual(envelope.data, { trx_id: "1121999", virtual_account: "", qr: "00020101021226...", payment_code: "", url: "", amount: 9900, admin: 70, total: 9900 });
});

test("a rejected submit becomes a non-00 envelope, a transport failure throws without echoing the key", async () => {
  const reject = (async () => new Response(JSON.stringify({ rc: "07", ket: "Channel tidak aktif", data: null }), { status: 200 })) as unknown as typeof fetch;
  const client = liveAutolarisSubmit({ baseUrl: "https://api-h2h.autolaris.com", apiKey: "synthetic-sentinel-autolaris-key" }, area, reject);
  const refused = await client.createPayment({ reff_id: submitReference(attempt), channel_code: "QRIS", customer_id: "x", customer_name: "x", customer_phone: "0", customer_email: "x@y.z", expired: "x", amount: "9900", callback_url: "" });
  assert.deepEqual([refused.rc, refused.data], ["07", null]);
  for (const response of [new Response("<html>", { status: 502 }), new Response("not json", { status: 200 }), new Response(JSON.stringify({ ket: "no rc" }), { status: 200 })]) {
    const failing = liveAutolarisSubmit({ baseUrl: "https://api-h2h.autolaris.com", apiKey: "synthetic-sentinel-autolaris-key" }, area, (async () => response) as unknown as typeof fetch);
    await assert.rejects(failing.createPayment({ reff_id: submitReference(attempt), channel_code: "QRIS", customer_id: "x", customer_name: "x", customer_phone: "0", customer_email: "x@y.z", expired: "x", amount: "9900", callback_url: "" }), (error: unknown) => error instanceof Error && !error.message.includes("synthetic-sentinel"));
  }
});

test("production accepts AutoLaris configuration only while `payments` is listed, and validates all of it", () => {
  const profile = readProductionConfig({ ...base, ...live } as Record<string, string>);
  assert.deepEqual(profile.autolaris, { originId: 3517100, destinationId: 3518010 });
  assert.ok(!JSON.stringify(profile).includes("synthetic-sentinel-autolaris-key"), "the key never becomes part of the config object");
  // closed by default and refused while payments is not listed: a stray key cannot sit unvalidated in the environment
  assert.equal(readProductionConfig(base).autolaris, null);
  for (const caps of [undefined, "", "cod", "manual_bank"]) {
    assert.throws(() => readProductionConfig({ ...base, ...live, MONEY_CAPABILITIES: caps } as Record<string, string>), /gated in production/, String(caps));
  }
  // every part is required together
  for (const missing of ["AUTOLARIS_API_KEY", "AUTOLARIS_ORDER_ORIGIN_ID", "AUTOLARIS_ORDER_DESTINATION_ID"]) {
    const env = { ...base, ...live } as Record<string, string | undefined>;
    delete env[missing];
    assert.throws(() => readProductionConfig(env), /AUTOLARIS|area ids/, missing);
  }
  assert.throws(() => productionAutolaris({ AUTOLARIS_API_KEY: "short", AUTOLARIS_ORDER_ORIGIN_ID: "1", AUTOLARIS_ORDER_DESTINATION_ID: "2" }), /AUTOLARIS_API_KEY/);
  // anything else AutoLaris-shaped stays refused, including the base URL (pinned in code) and the webhook secret
  for (const extra of [{ AUTOLARIS_BASE_URL: "https://evil.example" }, { AUTOLARIS_WEBHOOK_SECRET: "synthetic-sentinel-webhook" }, { NEXT_PUBLIC_AUTOLARIS_KEY: "public" }] as Array<Record<string, string>>) {
    assert.throws(() => readProductionConfig({ ...base, ...live, ...extra } as Record<string, string>), /gated in production/, JSON.stringify(Object.keys(extra)));
  }
});

test("the production client exists only with the payments capability and a valid AutoLaris configuration", async () => {
  await withEnv({ MONEY_CAPABILITIES: undefined }, () => assert.throws(() => autolarisClientFor("production"), gated));
  await withEnv({ MONEY_CAPABILITIES: "manual_bank" }, () => assert.throws(() => autolarisClientFor("production"), gated));
  await withEnv({ MONEY_CAPABILITIES: "cod" }, () => assert.throws(() => autolarisClientFor("production"), gated));
  await withEnv(live, () => assert.equal(typeof autolarisClientFor("production").createPayment, "function"));
  // a local-profile process never gets the production client
  const saved = process.env;
  process.env = { APP_ENV: "local", ...live } as unknown as NodeJS.ProcessEnv;
  try { assert.throws(() => autolarisClientFor("production"), gated); } finally { process.env = saved; }
  for (const target of ["live", "staging", ""]) await withEnv(live, () => assert.throws(() => autolarisClientFor(target), gated, target));
});

test("the client factory is a second gate: even a profile that somehow carried the AutoLaris values refuses without `payments`", async () => {
  // readRuntimeConfig already refuses AUTOLARIS_* without the capability; this proves the factory does not depend on it.
  const runtime = await import("../src/config/runtime.ts");
  const config = runtime.readRuntimeConfig({ ...base, ...live } as Record<string, string>);
  assert.ok(config.profile === "production" && config.autolaris, "the profile with payments carries the configuration");
  const saved = process.env;
  try {
    // A process whose environment has the values but whose capabilities no longer list payments (a rollback that cleared
    // MONEY_CAPABILITIES while the key is still set): the profile refuses to start, so no client can be built from it.
    process.env = { ...base, ...live, MONEY_CAPABILITIES: "" } as unknown as NodeJS.ProcessEnv;
    assert.throws(() => autolarisClientFor("production"), (error: unknown) => error instanceof Error, "no client without the capability");
  } finally { process.env = saved; }
});

test("the replay rule: only a production RECONCILIATION pass is forbidden from sending the provider request again", () => {
  // AutoLaris publishes no duplicate-reff_id rule for `submit`; a second request could create a second live bill.
  assert.equal(mayReplayProviderRequest("production", false), true, "the first dispatch calls the provider");
  assert.equal(mayReplayProviderRequest("production", true), false, "a reconciliation pass never replays in production");
  for (const target of ["local", "test"] as const) {
    assert.equal(mayReplayProviderRequest(target, false), true);
    assert.equal(mayReplayProviderRequest(target, true), true, "local and test keep the reviewed replay (the simulator dedupes by reff_id)");
  }
});

test("the dispatch builds its request under APP_ENV=production (Argon finding 1: the local-only reader threw there)", async () => {
  await withEnv(live, () => assert.equal(autolarisCallbackUrl(), "https://99ribu.com/api/v1/payments/autolaris/callbacks"));
  await withEnv({ MONEY_CAPABILITIES: undefined }, () => assert.equal(autolarisCallbackUrl(), "https://99ribu.com/api/v1/payments/autolaris/callbacks"));
  const local = parseEnvFile();
  const saved = process.env;
  process.env = local as unknown as NodeJS.ProcessEnv;
  try { assert.equal(autolarisCallbackUrl(), "http://127.0.0.1:3099/api/v1/payments/autolaris/callbacks", "local keeps its loopback origin"); } finally { process.env = saved; }
});

function parseEnvFile() {
  return parseEnv(readFileSync(new URL("../.env.example", import.meta.url), "utf8")) as Record<string, string>;
}

test("no local-only reader sits on the production payment path (dispatch, evidence, ledger, receipts, worker adapters)", () => {
  // These files run in production once `payments` is open. readLocalConfig / localSigningKey / createLocalAuth throw (or read
  // local files) outside the local profile, so each may appear only behind an explicit non-production branch.
  const allowed: Record<string, RegExp[]> = {
    "src/modules/payments/local.ts": [/if\(environment!=='production'\)return localSigningKey\(environment\)/],
    "src/modules/payments/autolaris-live.ts": [/readLocalConfig\(env\)\.providerOrigin/],
  };
  for (const file of ["src/modules/payments/autolaris.ts", "src/modules/payments/local.ts", "src/modules/payments/worker.ts", "src/modules/payments/attempts.ts", "src/modules/payments/events.ts", "src/modules/payments/autolaris-live.ts", "src/modules/payments/autolaris-submit.ts", "src/modules/finance/ledger.ts", "src/modules/finance/receipts.ts", "src/modules/finance/manual-bank.ts", "src/modules/finance/autolaris-payments.ts", "src/modules/checkout/expiry.ts", "src/modules/checkout/exceptions/collection-cases.ts", "src/modules/checkout/exceptions/collection.ts", "src/modules/returns/financial-basis.ts", "src/modules/finance/settlements/receivables.ts", "scripts/worker.ts"]) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const uses = text.split("\n").filter((line) => /readLocalConfig\(|localSigningKey\(|createLocalAuth\(/.test(line) && !/^\s*(import|\/\/)/.test(line));
    for (const line of uses) {
      assert.ok((allowed[file] ?? []).some((pattern) => pattern.test(line)), `${file} reads a local-only source outside an allowed non-production branch: ${line.trim().slice(0, 120)}`);
    }
  }
});

test("the hold rule covers every combination: only production reconciliation, pending, with no recorded reference", () => {
  const targets = ["local", "test", "production"] as const;
  for (const target of targets) for (const reconciliation of [false, true]) for (const status of ["pending", "confirmed", "failed", "expired"]) for (const responded of [null, undefined, new Date()]) {
    const expected = target === "production" && reconciliation && status === "pending" && !responded;
    assert.equal(shouldHoldUnrecorded(target, reconciliation, status, responded), expected, `${target}/${reconciliation}/${status}/${String(responded)}`);
  }
  // The only combination that holds, stated explicitly.
  assert.equal(shouldHoldUnrecorded("production", true, "pending", null), true);
  // A recorded provider reference never holds: the dispatch continues to link and ingest it.
  assert.equal(shouldHoldUnrecorded("production", true, "pending", new Date()), false);
  // The first dispatch in production always reaches the provider.
  assert.equal(shouldHoldUnrecorded("production", false, "pending", null), false);
});
