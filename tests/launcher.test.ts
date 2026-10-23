import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import test from "node:test";

test("startup refuses an inherited live mode before listening", () => {
  const result = spawnSync(process.execPath, ["--env-file=.env.example", "scripts/run-local.ts", "start"], {
    env: { ...process.env, APP_ENV: "production" }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APP_ORIGIN must be an exact https:\/\/ origin/, "the production profile refuses the local loopback settings");
});

test("startup refuses a CLI hostname override", () => {
  const result = spawnSync(process.execPath, ["--env-file=.env.example", "scripts/run-local.ts", "start", "--hostname", "0.0.0.0"], {
    encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /extra arguments are refused/);
});

for (const entry of ["node_modules/next/dist/bin/next", "node_modules/.bin/next"]) {
test(`direct Next startup through ${entry} refuses a different loopback listener`, () => {
  const result = spawnSync(process.execPath, [
    "--env-file=.env.example", entry, "start",
    "--hostname", "127.0.0.2", "--port", "0",
  ], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /fixed local listener/);
});
}

test("startup refuses a malformed tailnet origin before listening, without echoing it", () => {
  const result = spawnSync(process.execPath, ["--env-file=.env.example", "scripts/run-local.ts", "start"], {
    env: { ...process.env, LOCAL_TAILNET_ORIGIN: "http://0.0.0.0:3099" }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /LOCAL_TAILNET_ORIGIN must be/);
  assert.doesNotMatch(result.stderr, /0\.0\.0\.0/);
});

// S82: synthetic production profile (generated secret, never printed); the process env wins over --env-file values.
const production = {
  APP_ENV: "production", APP_ORIGIN: "https://99ribu.com", BETTER_AUTH_URL: "https://99ribu.com", BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
  PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "disabled", ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled",
  EXTERNAL_DISPATCH: "disabled", DATABASE_HOST: "postgres-99ribu", DATABASE_APP_PASSWORD: "synthetic-app-password-0001", CLIENT_IP_HEADER: "x-real-ip",
};
function run(script: string, args: string[], env: Record<string, string> = production) {
  return spawnSync(process.execPath, ["--env-file=.env.example", script, ...args], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 10000 });
}

test("the production profile has no dev server", () => {
  const result = run("scripts/run-local.ts", ["dev"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no dev server/);
  assert.ok(!result.stderr.includes(production.BETTER_AUTH_SECRET));
});

test("fixture, login and dummy-account commands refuse the production target and the production profile", () => {
  for (const args of [["seed", "production", "prod-refusal"], ["commerce", "production", "prod-refusal"], ["login", "production"]]) {
    assert.notEqual(run("scripts/seed.ts", args).status, 0, args.join(" "));
  }
  for (const args of [["seed", "local", "prod-refusal"], ["login", "local"], ["login-codes", "local"]]) {
    const result = run("scripts/seed.ts", args);
    assert.notEqual(result.status, 0, args.join(" "));
    assert.match(result.stderr, /refused or failed/);
  }
});

test("the production worker runs the job loop only; simulator commands are refused before any connection", () => {
  for (const mode of ["--confirm-payment", "--collect-cod", "--issue-waybill", "--track-parcel", "--observe-settlement"]) {
    const result = run("scripts/worker.ts", ["production", mode, "00000000-0000-4000-8000-000000000000"]);
    assert.equal(result.status, 1, mode);
    assert.match(result.stderr, /job loop only/);
  }
});

test("migrations and workers refuse a database target that does not match the profile", () => {
  const migrate = run("scripts/migrate.ts", ["production"], {});
  assert.equal(migrate.status, 1);
  assert.match(migrate.stderr, /must match APP_ENV/);
  const worker = run("scripts/worker.ts", ["local"]);
  assert.equal(worker.status, 1);
  assert.match(worker.stderr, /must match APP_ENV/);
});
