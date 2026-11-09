import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { AccessError } from "../src/modules/access/policy.ts";
import { assertChannelCapability, openLocalOperation, settleLocalOperation, verifyProviderEvent } from "../src/modules/payments/local.ts";

// S181 step 1b/2a (ADR-0008): payment evidence in production is signed by this server only, under a key derived from
// BETTER_AUTH_SECRET, and only when a payment capability is listed. These tests prove the signature and its gates; the
// database path is covered by the autolaris-payments, payment-fees and manual-bank integration cases.
const origin = "https://99ribu.com";
const secret = randomBytes(48).toString("base64");
const base: Record<string, string> = {
  APP_ENV: "production", APP_ORIGIN: origin, BETTER_AUTH_URL: origin, BETTER_AUTH_SECRET: secret,
  PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "disabled", ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled",
  EXTERNAL_DISPATCH: "disabled", DATABASE_HOST: "postgres-99ribu", DATABASE_APP_PASSWORD: "synthetic-sentinel-app-password", CLIENT_IP_HEADER: "x-real-ip",
};
// While `payments` is listed the production profile also requires the AutoLaris configuration (S181 step 2b).
const liveAutolaris: Record<string, string> = { AUTOLARIS_API_KEY: "synthetic-sentinel-autolaris-key", AUTOLARIS_ORDER_ORIGIN_ID: "3517100", AUTOLARIS_ORDER_DESTINATION_ID: "3518010" };
async function withEnv<T>(change: Record<string, string | undefined>, run: () => T | Promise<T>) {
  const saved = process.env;
  process.env = { ...base, ...(String(change.MONEY_CAPABILITIES ?? "").split(",").map((name) => name.trim()).includes("payments") ? liveAutolaris : {}), ...change } as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(change)) if (value === undefined) delete process.env[key];
  try { return await run(); } finally { process.env = saved; }
}
const uuid = () => crypto.randomUUID();
const body = (environment: string) => ({
  id: uuid(), operation_id: uuid(), attempt_id: uuid(), environment, status: "confirmed", amount: 9970, currency: "IDR", occurred_at: "2026-11-09T10:00:00.000Z",
});
// The canonical string and key derivation below mirror payments/local.ts on purpose: the test pins the wire format.
const canonical = (e: ReturnType<typeof body>) => JSON.stringify(["99ribu-payment-simulator-v1", e.environment, e.id, e.operation_id, e.attempt_id, e.status, e.amount, e.currency, e.occurred_at]);
const key = () => createHmac("sha256", secret).update("99ribu-payment-evidence-v1").digest("base64url");
const sign = (e: ReturnType<typeof body>, k = key()) => createHmac("sha256", k).update(canonical(e)).digest("hex");
const gate = (error: unknown) => error instanceof AccessError && error.status === 503 && error.code === "PRODUCTION_MONEY_PATH_GATED";

test("a production payment event verifies under the production profile whatever MONEY_CAPABILITIES says", async () => {
  // Argon S181-1b2a finding 3: clearing the capabilities to roll back must not strand an event this server already signed
  // (checkout.order.expire and an in-flight payment.callback re-verify it). Creating and settling is what the capability gates.
  const e = body("production"), event = { ...e, signature: sign(e) };
  for (const capabilities of [undefined, "", "cod", "payments", "manual_bank", "payments,cod"]) {
    await withEnv({ MONEY_CAPABILITIES: capabilities }, () => assert.deepEqual(verifyProviderEvent(event), event, String(capabilities)));
  }
});

test("the production key is derived from the server secret and is not the secret itself", async () => {
  const e = body("production");
  await withEnv({ MONEY_CAPABILITIES: "payments" }, () => {
    assert.notEqual(key(), secret);
    assert.throws(() => verifyProviderEvent({ ...e, signature: sign(e, secret) }), /signature|INVALID/i, "signing with the raw secret is rejected");
    assert.throws(() => verifyProviderEvent({ ...e, signature: sign(e, "another-key") }), /signature|INVALID/i);
  });
});

test("a tampered production event is rejected: every signed field is bound", async () => {
  const e = body("production"), good = { ...e, signature: sign(e) };
  await withEnv({ MONEY_CAPABILITIES: "payments" }, () => {
    const mutations: Array<Partial<ReturnType<typeof body>>> = [
      { amount: 1 }, { status: "failed" }, { id: uuid() }, { operation_id: uuid() }, { attempt_id: uuid() }, { occurred_at: "2026-11-09T11:00:00.000Z" },
    ];
    for (const change of mutations) assert.throws(() => verifyProviderEvent({ ...good, ...change }), /signature|INVALID/i, JSON.stringify(Object.keys(change)));
  });
});

test("an event cannot cross environments: a production-environment event signed with a local key is rejected on the signature", async () => {
  const e = body("production");
  await withEnv({ MONEY_CAPABILITIES: "payments" }, () => {
    // Signed as a local/test key would be (a different key), claiming environment production: the HMAC comparison fails.
    assert.throws(() => verifyProviderEvent({ ...e, signature: sign(e, randomBytes(48).toString("base64url")) }), (error: unknown) => error instanceof AccessError && error.status === 401 && error.code === "INVALID_PAYMENT_SIGNATURE");
    assert.throws(() => verifyProviderEvent({ ...e, environment: "staging", signature: sign(e) }), /INVALID|invalid/i);
    // A local event under a production process is refused before any local key is read.
    assert.throws(() => verifyProviderEvent({ ...e, environment: "local", signature: sign(e) }), /APP_ENV|local/i);
  });
});

test("the profile must be production: a local process refuses a production event before any signing", async () => {
  const e = body("production"), event = { ...e, signature: sign(e) };
  for (const env of [{ APP_ENV: "local" }, { APP_ENV: undefined }, { APP_ENV: "staging" }]) {
    await withEnv({ ...env, MONEY_CAPABILITIES: "payments" }, () => assert.throws(() => verifyProviderEvent(event), gate, String(env.APP_ENV)));
  }
});

// A fake transaction answering only `select current_database()`; any other query is a failure of the code under test.
const fakeTx = (name: string, seen: string[] = []) => ((strings: TemplateStringsArray) => {
  const text = strings.join("?");
  seen.push(text);
  if (/current_database\(\)/.test(text)) return Promise.resolve([{ name }]);
  throw new Error(`unexpected query: ${text.slice(0, 80)}`);
}) as never;

test("a production operation needs the capability of ITS channel, never another channel's (finding 2)", async () => {
  const cases: Array<[string, string, boolean]> = [
    ["autolaris", "payments", true], ["autolaris", "manual_bank", false], ["autolaris", "cod", false], ["autolaris", "payments,manual_bank", true],
    ["manual-bank", "manual_bank", true], ["manual-bank", "payments", false], ["manual-bank", "cod", false], ["manual-bank", "payments,manual_bank", true],
    ["local-prepaid", "payments,manual_bank,cod", false], ["cod", "payments,manual_bank,cod", false], ["unknown", "payments,manual_bank,cod", false],
  ];
  for (const [method, capabilities, allowed] of cases) {
    await withEnv({ MONEY_CAPABILITIES: capabilities }, async () => {
      const run = assertChannelCapability(fakeTx("99ribu_production"), "production", { method_id: method });
      if (allowed) await run; else await assert.rejects(run, gate, `${method} with ${capabilities}`);
    });
  }
  await assert.rejects(assertChannelCapability(fakeTx("99ribu_production"), "production", undefined), gate);
  await withEnv({ MONEY_CAPABILITIES: "payments,manual_bank" }, async () => {
    await assertChannelCapability(fakeTx("postgres"), "local", { method_id: "local-prepaid" });
    await assertChannelCapability(fakeTx("postgres"), "test", { method_id: "autolaris" });
  });
});

test("opening or settling an operation refuses a database that is not exactly the target's (profile guard)", async () => {
  await withEnv({ MONEY_CAPABILITIES: "payments,manual_bank" }, async () => {
    for (const name of ["postgres", "99ribu_local", "99ribu_test", "99ribu_production_restore", "99ribu_prod"]) {
      await assert.rejects(openLocalOperation(fakeTx(name), "production", uuid()), /invalid|INVALID/i, `open on ${name}`);
      await assert.rejects(settleLocalOperation(fakeTx(name), "production", uuid()), /invalid|INVALID/i, `settle on ${name}`);
    }
    for (const target of ["staging", "prod", ""]) {
      await assert.rejects(openLocalOperation(fakeTx("99ribu_production"), target as never, uuid()), /invalid|INVALID/i, target);
    }
  });
});

test("the collection intake may see production, and only when it asks: every refund path stays closed (S181 2a-ii)", async () => {
  const { collectionEnvironment } = await import("../src/modules/returns/financial-basis.ts");
  assert.equal(collectionEnvironment("99ribu_test"), "test");
  assert.equal(collectionEnvironment("99ribu_local"), "local");
  assert.equal(collectionEnvironment("99ribu_production", { intakeOnly: true }), "production");
  // A refund or recovery-refund caller never passes the option, so production is null (the caller throws invalid()).
  assert.equal(collectionEnvironment("99ribu_production"), null);
  assert.equal(collectionEnvironment("99ribu_production", {}), null);
  assert.equal(collectionEnvironment("99ribu_production", { intakeOnly: false } as never), null);
  assert.equal(collectionEnvironment("99ribu_production", { intakeOnly: "true" } as never), null, "only the literal true opens it");
  for (const name of ["postgres", "99ribu_production_restore", "99ribu_prod", "99RIBU_PRODUCTION", ""]) {
    assert.equal(collectionEnvironment(name, { intakeOnly: true }), null, name);
  }
});

test("only the collection-case intake opts in; no refund or recovery-refund source passes intakeOnly", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => { const p = join(dir, name); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
  const opted = walk(new URL("../src", import.meta.url).pathname).filter((file) => /intakeOnly\s*:\s*true/.test(readFileSync(file, "utf8")));
  assert.deepEqual(opted.map((file) => file.split("/src/")[1]), ["modules/checkout/exceptions/collection-cases.ts"]);
});
