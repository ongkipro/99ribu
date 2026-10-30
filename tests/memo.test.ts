import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { memo } from "../src/modules/storefront/memo.ts";

test("storefront memo: reads through at TTL 0, serves stale while one refresh runs, drops failures", async () => {
  let calls = 0;
  const load = async () => ++calls;
  assert.equal(await memo("t0", 0, load), 1);
  assert.equal(await memo("t0", 0, load), 2, "TTL 0 never caches (local and test profiles)");
  calls = 0;
  const slow = async () => { const value = ++calls; await sleep(20); return value; };
  assert.equal(await memo("swr", 30, slow), 1);
  assert.equal(await memo("swr", 30, slow), 1, "fresh value is reused");
  await sleep(40);
  assert.equal(await memo("swr", 30, slow), 1, "expired: the stale value answers at once");
  assert.equal(await memo("swr", 30, slow), 1, "the refresh is still running: stale again");
  await sleep(30);
  assert.equal(calls, 2, "only one refresh ran");
  assert.equal(await memo("swr", 30, slow), 2, "the refreshed value replaces the stale one");
  let fail = true;
  await assert.rejects(memo("err", 1000, async () => { if (fail) throw new Error("db down"); return "ok"; }));
  fail = false;
  assert.equal(await memo("err", 1000, async () => { if (fail) throw new Error("db down"); return "ok"; }), "ok", "a failed load is not cached");
});
