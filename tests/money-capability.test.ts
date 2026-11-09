import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import test from "node:test";
import { GATED_MONEY_CAPABILITIES, MONEY_CAPABILITIES, OPENABLE_MONEY_CAPABILITIES, readMoneyCapabilities, readProductionConfig } from "../src/config/runtime.ts";
import { AccessError } from "../src/modules/access/policy.ts";
import { financeEnvironment, moneyEnvironment } from "../src/modules/finance/ledger.ts";

// S181 / ADR-0008 step 1a: the production money environment opens one capability at a time and is closed by default.
// No caller uses moneyEnvironment yet, so this change cannot alter any behaviour; these tests prove the gate itself.
const local = parseEnv(readFileSync(new URL("../.env.example", import.meta.url), "utf8"));
const productionOrigin = "https://99ribu.com";
const base: Record<string, string> = {
  APP_ENV: "production", APP_ORIGIN: productionOrigin, BETTER_AUTH_URL: productionOrigin,
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
  PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "disabled", ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled",
  EXTERNAL_DISPATCH: "disabled", DATABASE_HOST: "postgres-99ribu", DATABASE_APP_PASSWORD: "synthetic-sentinel-app-password",
  CLIENT_IP_HEADER: "x-real-ip",
};
const tx = (name: string) => (() => Promise.resolve([{ name }])) as never;
// While `payments` is listed the production profile also requires the AutoLaris configuration (S181 step 2b).
const liveAutolaris: Record<string, string> = { AUTOLARIS_API_KEY: "synthetic-sentinel-autolaris-key", AUTOLARIS_ORDER_ORIGIN_ID: "3517100", AUTOLARIS_ORDER_DESTINATION_ID: "3518010" };
async function withEnv<T>(change: Record<string, string | undefined>, run: () => Promise<T>) {
  const saved = process.env;
  process.env = { ...base, ...(String(change.MONEY_CAPABILITIES ?? "").split(",").map((name) => name.trim()).includes("payments") ? liveAutolaris : {}), ...change } as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(change)) if (value === undefined) delete process.env[key];
  try { return await run(); } finally { process.env = saved; }
}
const refused = (error: unknown) => error instanceof AccessError && error.status === 503 && error.code === "PRODUCTION_MONEY_PATH_GATED";

test("MONEY_CAPABILITIES is empty by default and only lists the capabilities that have live evidence", () => {
  assert.deepEqual(readMoneyCapabilities({}), []);
  assert.deepEqual(readMoneyCapabilities({ MONEY_CAPABILITIES: "" }), []);
  assert.deepEqual(readMoneyCapabilities({ MONEY_CAPABILITIES: "   " }), []);
  assert.deepEqual(readMoneyCapabilities({ MONEY_CAPABILITIES: " payments , manual_bank " }), ["payments", "manual_bank"]);
  assert.deepEqual([...MONEY_CAPABILITIES], ["payments", "cod", "manual_bank"]);
  assert.deepEqual([...GATED_MONEY_CAPABILITIES], ["cod"], "cod is a known name that startup refuses until its path is wired");
  assert.deepEqual([...OPENABLE_MONEY_CAPABILITIES], ["payments", "manual_bank"]);
  for (const closed of ["refunds", "payouts", "commissions", "tracking"]) {
    assert.ok(!(MONEY_CAPABILITIES as readonly string[]).includes(closed), `${closed} has no live evidence and cannot be opened`);
  }
});

test("a typo, an unknown capability or a repeat fails startup instead of opening or skipping a path", () => {
  for (const bad of ["payment", "refunds", "payments,,cod", "payments,payments", "payments, payments", "payments,", ",payments", "all", "*", "payments;cod", "PAYMENTS", "__proto__", "constructor", "toString", "payments,__proto__", "payments\u200b", "payments ; cod"]) {
    assert.throws(() => readMoneyCapabilities({ MONEY_CAPABILITIES: bad }), /MONEY_CAPABILITIES/, bad);
    assert.throws(() => readProductionConfig({ ...base, MONEY_CAPABILITIES: bad }), /MONEY_CAPABILITIES/, bad);
  }
});

test("the production profile carries the parsed capabilities and the default is closed", () => {
  assert.deepEqual(readProductionConfig(base).moneyCapabilities, []);
  assert.deepEqual(readProductionConfig({ ...base, ...liveAutolaris, MONEY_CAPABILITIES: "payments" }).moneyCapabilities, ["payments"]);
  assert.ok(Object.isFrozen(readProductionConfig(base).moneyCapabilities), "the list cannot be edited after startup");
});

test("closed by default: every capability refuses the production database", async () => withEnv({}, async () => {
  for (const capability of MONEY_CAPABILITIES) await assert.rejects(moneyEnvironment(tx("99ribu_production"), capability), refused, capability);
}));

test("one capability opens only itself", async () => {
  for (const open of OPENABLE_MONEY_CAPABILITIES) {
    await withEnv({ MONEY_CAPABILITIES: open }, async () => {
      for (const capability of MONEY_CAPABILITIES) {
        if (capability === open) assert.equal(await moneyEnvironment(tx("99ribu_production"), capability), "production");
        else await assert.rejects(moneyEnvironment(tx("99ribu_production"), capability), refused, `${open} must not open ${capability}`);
      }
    });
  }
});

test("listing capabilities never opens the legacy finance environment used by refunds, payouts, commissions and tracking", async () => {
  await withEnv({ MONEY_CAPABILITIES: OPENABLE_MONEY_CAPABILITIES.join(",") }, async () => {
    await assert.rejects(financeEnvironment(tx("99ribu_production")), refused);
  });
});

test("the local and test databases are unaffected by capabilities", async () => {
  await withEnv({ MONEY_CAPABILITIES: undefined }, async () => {
    assert.equal(await moneyEnvironment(tx("99ribu_test"), "payments"), "test");
    assert.equal(await moneyEnvironment(tx("99ribu_local"), "cod"), "local");
    assert.equal(await moneyEnvironment(tx("99ribu_local"), "manual_bank"), "local");
  });
});

test("a database named like production never opens under a non-production profile", async () => {
  const saved = process.env;
  process.env = { ...local, MONEY_CAPABILITIES: "payments,manual_bank" } as unknown as NodeJS.ProcessEnv;
  try {
    await assert.rejects(moneyEnvironment(tx("99ribu_production"), "payments"), refused);
  } finally { process.env = saved; }
});

test("a database this code does not know by exact name is refused, never treated as local", async () => {
  await withEnv({ MONEY_CAPABILITIES: OPENABLE_MONEY_CAPABILITIES.join(",") }, async () => {
    for (const name of ["99ribu_production_restore", "99ribu_prod", "99ribu_production2", "99ribu", "postgres", "99RIBU_PRODUCTION", ""]) {
      for (const capability of MONEY_CAPABILITIES) await assert.rejects(moneyEnvironment(tx(name), capability), refused, `${name}/${capability}`);
    }
  });
});

test("a process without a production profile gets the gate error, not a configuration exception", async () => {
  const saved = process.env;
  try {
    for (const env of [{}, { APP_ENV: "local" }, { APP_ENV: "staging" }, { APP_ENV: "production", APP_ORIGIN: "http://insecure" }]) {
      process.env = env as unknown as NodeJS.ProcessEnv;
      await assert.rejects(moneyEnvironment(tx("99ribu_production"), "payments"), env.APP_ENV === "production" ? /APP_ORIGIN/ : refused);
    }
  } finally { process.env = saved; }
});

test("compose forwards MONEY_CAPABILITIES with an empty default so Coolify can set it and a stray value is still validated", () => {
  const compose = readFileSync(new URL("../compose.production.yaml", import.meta.url), "utf8");
  assert.match(compose, /^\s+MONEY_CAPABILITIES: \$\{MONEY_CAPABILITIES:-\}\s*$/m);
  assert.doesNotMatch(compose, /MONEY_CAPABILITIES: ["']?(payments|cod|manual_bank)/, "no capability is hard-wired open");
  assert.equal(compose.split("\n").filter((line) => /^\s+MONEY_CAPABILITIES:/.test(line)).length, 1, "one shared environment anchor, not per-service overrides");
});

test("cod is refused at startup, alone or listed with others, and the refusal never echoes the profile", () => {
  for (const value of ["cod", "payments,cod", "cod,manual_bank", " cod "]) {
    assert.throws(() => readMoneyCapabilities({ MONEY_CAPABILITIES: value }), /cod is gated/, value);
    assert.throws(() => readProductionConfig({ ...base, ...liveAutolaris, MONEY_CAPABILITIES: value }), /cod is gated/, value);
  }
});
