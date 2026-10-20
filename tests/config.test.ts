import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertLocalNextCommand, readLocalConfig } from "../src/config/local.ts";

const local = parseEnv(readFileSync(new URL("../.env.example", import.meta.url), "utf8"));

test("the Next command boundary refuses default, remote and duplicate listener arguments", () => {
  for (const args of [[], ["start"], ["dev"], ["start", "--hostname", "0.0.0.0", "--port", "3099"], ["start", "--hostname", "127.0.0.1", "--port", "3099", "--port", "3000"]]) {
    assert.throws(() => assertLocalNextCommand(args), /fixed local listener/);
  }
  for (const mode of ["dev", "start"]) {
    assert.doesNotThrow(() => assertLocalNextCommand([mode, "--hostname", "127.0.0.1", "--port", "3099"]));
  }
});

test("local profile also supports a production-mode localhost build", () => {
  const config = readLocalConfig({ ...local, NODE_ENV: "production" });
  assert.equal(config.origin, "http://127.0.0.1:3099");
  assert.equal(config.hostname, "127.0.0.1");
});

const invalidProfiles = [
  ["missing environment", { APP_ENV: undefined }],
  ["live environment", { APP_ENV: "production" }],
  ["remote origin", { APP_ORIGIN: "https://99ribu.com" }],
  ["mixed localhost alias", { APP_ORIGIN: "http://localhost:3099" }],
  ["all-interface origin", { APP_ORIGIN: "http://0.0.0.0:3099" }],
  ["missing payment mode", { PAYMENT_ADAPTER: undefined }],
  ["live shipping", { SHIPPING_ADAPTER: "live" }],
  ["live advertising", { ADS_ADAPTER: "live" }],
  ["real notifications", { NOTIFICATION_ADAPTER: "smtp" }],
  ["real payout", { PAYOUT_ADAPTER: "live" }],
  ["external dispatch", { EXTERNAL_DISPATCH: "enabled" }],
  ["mismatched auth origin", { BETTER_AUTH_URL: "https://example.com" }],
  ["inherited auth material", { BETTER_AUTH_SECRET: "synthetic-sentinel-never-log" }],
  ["inherited auth allowlist", { BETTER_AUTH_TRUSTED_ORIGINS: "https://example.com" }],
  ["provider credentials", { VIRGO_API_KEY: "synthetic-sentinel-never-log" }],
  ["browser pixel", { NEXT_PUBLIC_META_PIXEL_ID: "synthetic-sentinel-never-log" }],
  ["remote database", { DATABASE_URL: "postgresql://127.0.0.1.evil.invalid:5499/99ribu_local" }],
  ["other local database", { DATABASE_URL: "postgresql://127.0.0.1:5499/other_project" }],
  ["default database port", { DATABASE_URL: "postgresql://127.0.0.1:5432/99ribu_local" }],
  ["database host override", { DATABASE_URL: "postgresql://127.0.0.1:5499/99ribu_local?host=example.com" }],
  ["malformed database URL", { DATABASE_URL: "synthetic-sentinel-never-log" }],
] as const;

for (const [label, change] of invalidProfiles) {
  test(`rejects ${label} without exposing configured values`, () => {
    assert.throws(() => readLocalConfig({ ...local, ...change }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("synthetic-sentinel"));
      return true;
    });
  });
}

test("database URL overrides are refused even for loopback databases", () => {
  for (const name of ["99ribu_local", "99ribu_test"]) {
    assert.throws(() => readLocalConfig({ ...local, DATABASE_URL: `postgresql://127.0.0.1:5499/${name}` }), /private local socket/);
  }
});
