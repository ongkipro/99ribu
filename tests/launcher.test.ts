import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("startup refuses an inherited live mode before listening", () => {
  const result = spawnSync(process.execPath, ["--env-file=.env.example", "scripts/run-local.ts", "start"], {
    env: { ...process.env, APP_ENV: "production" }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APP_ENV must be local/);
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
