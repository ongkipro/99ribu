import assert from "node:assert/strict";
import test from "node:test";
import { readTurnstileConfig } from "../src/config/runtime.ts";
import { backoffSeconds, COOL_OFF_MAX_S, coolOffSeconds, decide, SIGN_IN_FAILURE_CEILING, verifyTurnstile, type BudgetState } from "../src/modules/access/signin-budget.ts";
import { failureKind, failureMessage } from "../src/components/storefront/sign-in-copy.ts";

const now = 1_000_000_000;
const state = (over: Partial<BudgetState>): BudgetState => ({ windowCount: 0, windowStart: 0, run: 0, lastFail: 0, ...over });

test("four failures in a minute still sign in without a token; the fifth makes the next attempt need one", () => {
  assert.deepEqual(decide(state({ windowCount: 4, windowStart: now - 5000, run: 4, lastFail: now - 1000 }), now, false), { kind: "allow" });
  const challenged = decide(state({ windowCount: 5, windowStart: now - 5000, run: 5, lastFail: now - 1000 }), now, false);
  assert.equal(challenged.kind, "challenge");
  assert.equal((challenged as { retryAfter: number }).retryAfter, 59, "the longer of the window left (55 s) and the backoff left (59 s)");
});

test("a verified token lets the attempt through; the delay alone ends by itself", () => {
  const burst = state({ windowCount: 5, windowStart: now - 5000, run: 5, lastFail: now - 1000 });
  assert.deepEqual(decide(burst, now, true), { kind: "allow" });
  assert.deepEqual(decide(burst, now + 60_000, false), { kind: "allow" }, "window and backoff both over");
});

test("old failures never taint a fresh attempt, and the delay grows with consecutive failures", () => {
  assert.deepEqual(decide(state({ windowCount: 1, windowStart: now - 5000, run: 40, lastFail: now - 5000 }), now, false), { kind: "allow" });
  assert.deepEqual([0, 4, 5, 10, 15, 95].map(backoffSeconds), [0, 0, 60, 120, 240, 3600]);
  const later = decide(state({ windowCount: 5, windowStart: now - 59_000, run: 20, lastFail: now - 1000 }), now, false);
  assert.equal((later as { retryAfter: number }).retryAfter, 479, "run 20 waits 8 minutes after the last failure");
});

test("the ceiling opens a 15 minute cool-off that a verified token cannot bypass; a lower ceiling is honoured", () => {
  assert.equal(SIGN_IN_FAILURE_CEILING, 100);
  assert.deepEqual(decide(state({ run: 99, lastFail: now - 1000 }), now, false), { kind: "allow" });
  assert.deepEqual(decide(state({ run: 100, lastFail: now - 1000 }), now, true), { kind: "locked", retryAfter: 900, start: { level: 0 } });
  assert.deepEqual(decide(state({ run: 3, lastFail: now - 1000 }), now, true, true, 3), { kind: "locked", retryAfter: 900, start: { level: 0 } });
});

test("H1: without Turnstile keys only the 60 s window applies: never above 60 s, no growth, no ceiling, no cool-off", () => {
  // Same states that would back off for an hour / lock for 15 minutes with keys.
  const burst = state({ windowCount: 5, windowStart: now - 5000, run: 95, lastFail: now - 1000 });
  assert.deepEqual(decide(burst, now, false, true), { kind: "challenge", retryAfter: 3599 }, "control: with keys the delay grows");
  assert.deepEqual(decide(burst, now, false, false), { kind: "challenge", retryAfter: 55 }, "keyless: the remaining window only");
  assert.deepEqual(decide(burst, now + 55_000, false, false), { kind: "allow" }, "window over: allowed, not a growing wait");
  assert.deepEqual(decide(state({ run: 100, lastFail: now - 1000 }), now, false, true), { kind: "locked", retryAfter: 900, start: { level: 0 } }, "control: ceiling with keys");
  assert.deepEqual(decide(state({ run: 100, lastFail: now - 1000 }), now, false, false), { kind: "allow" }, "keyless: the ceiling does not engage");
  assert.deepEqual(decide(state({ run: 7, lastFail: now - 1000, coolLevel: 3, coolUntil: now + 600_000 }), now, false, false), { kind: "allow" }, "keyless: an old cool-off is ignored");
  for (const run of [5, 50, 500]) {
    const d = decide(state({ windowCount: 5, windowStart: now, run, lastFail: now }), now, false, false) as { kind: string; retryAfter: number };
    assert.equal(d.retryAfter, 60);
  }
  assert.equal(readTurnstileConfig({ APP_ENV: "production" }), null, "production without keys is valid configuration, not a boot failure");
});

test("an open cool-off refuses (token or not) with the remaining time, then expires by itself", () => {
  const cooling = state({ run: 0, coolLevel: 1, coolUntil: now + 600_000 });
  assert.deepEqual(decide(cooling, now, true), { kind: "locked", retryAfter: 600, start: null });
  assert.deepEqual(decide(cooling, now + 599_001, false), { kind: "locked", retryAfter: 1, start: null });
  assert.deepEqual(decide(cooling, now + 600_000, false), { kind: "allow" }, "the row locks nothing once its time has passed");
});

test("cool-off doubles at each further ceiling hit and is capped at 24 hours", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 50].map(coolOffSeconds), [900, 1800, 3600, 7200, 14400, 28800, 57600, 86400].map((s) => Math.min(s, COOL_OFF_MAX_S)));
  assert.equal(coolOffSeconds(7), COOL_OFF_MAX_S, "115200 s is capped to 86400 s");
  // The next ceiling hit after a cool-off at level 2 starts the level-2 delay (1 h), and level 5 asks for 8 h.
  const hit = (level: number) => decide(state({ run: 100, lastFail: now - 1000, coolLevel: level, coolUntil: now - 1000 }), now, true, true);
  assert.deepEqual(hit(2), { kind: "locked", retryAfter: 3600, start: { level: 2 } });
  assert.deepEqual(hit(5), { kind: "locked", retryAfter: 28800, start: { level: 5 } });
});

test("the consecutive count decays after 24 hours without a failure, and so does the ceiling level", () => {
  const day = 24 * 3600 * 1000;
  assert.deepEqual(decide(state({ run: 100, lastFail: now - day + 1 }), now, false).kind, "locked", "23h59 after the last failure: still counted");
  assert.deepEqual(decide(state({ run: 100, lastFail: now - day }), now, false), { kind: "allow" }, "24 h quiet: the count is forgotten");
  assert.deepEqual(decide(state({ run: 100, lastFail: now - 1000, coolLevel: 4, coolUntil: now - day }), now, false), { kind: "locked", retryAfter: 900, start: { level: 0 } }, "an old cool-off level is forgotten too");
});

test("verifyTurnstile treats timeout, network error, non-JSON, non-2xx and failure as not verified", async () => {
  const saved = { fetch: globalThis.fetch, site: process.env.TURNSTILE_SITE_KEY, secret: process.env.TURNSTILE_SECRET_KEY };
  process.env.TURNSTILE_SITE_KEY = "test-site-key-0001";
  process.env.TURNSTILE_SECRET_KEY = "test-secret-key-0001";
  const answer = (fn: typeof fetch) => { globalThis.fetch = fn; return verifyTurnstile("token", "203.0.113.9"); };
  try {
    const seen: { sent?: { url: string; init: RequestInit } } = {};
    assert.equal(await answer(async (url, init) => { seen.sent = { url: String(url), init: init as RequestInit }; return Response.json({ success: true }); }), true);
    const sent = seen.sent;
    assert.equal(sent?.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.deepEqual(JSON.parse(String(sent?.init.body)), { secret: "test-secret-key-0001", response: "token", remoteip: "203.0.113.9" });
    assert.ok(sent?.init.signal, "an AbortSignal timeout is attached");
    assert.equal(await answer(async () => Response.json({ success: false, "error-codes": ["invalid-input-response"] })), false);
    assert.equal(await answer(async () => Response.json({ success: "true" })), false, "only boolean true counts");
    assert.equal(await answer(async () => Response.json({ success: true, action: "signin" })), true);
    assert.equal(await answer(async () => Response.json({ success: true, action: "login" })), false, "another form's widget");
    assert.equal(await answer(async () => Response.json({ success: true, action: null })), false, "a present but unusable action is not a missing one");
    assert.equal(await answer(async () => new Response("<html>", { status: 200 })), false);
    assert.equal(await answer(async () => Response.json({ success: true }, { status: 500 })), false);
    assert.equal(await answer(async () => { throw new Error("network"); }), false);
    assert.equal(await answer(async () => { throw new DOMException("timed out", "TimeoutError"); }), false);
    assert.equal(await verifyTurnstile("", null), false);
    assert.equal(await verifyTurnstile("x".repeat(2049), null), false);
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_SITE_KEY;
    let called = false;
    assert.equal(await answer(async () => { called = true; return Response.json({ success: true }); }), false, "no secret: never a silent allow");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [name, value] of [["TURNSTILE_SITE_KEY", saved.site], ["TURNSTILE_SECRET_KEY", saved.secret]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("Turnstile config: both or neither; documented test keys are refused in production", () => {
  assert.equal(readTurnstileConfig({}), null);
  assert.equal(readTurnstileConfig({ TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "" }), null);
  assert.throws(() => readTurnstileConfig({ TURNSTILE_SITE_KEY: "1x00000000000000000000AA" }), /together/);
  assert.throws(() => readTurnstileConfig({ TURNSTILE_SITE_KEY: "bad key!", TURNSTILE_SECRET_KEY: "real-secret-0123" }), /malformed/);
  const dummy = { TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" };
  assert.deepEqual(readTurnstileConfig(dummy), { siteKey: dummy.TURNSTILE_SITE_KEY, secret: dummy.TURNSTILE_SECRET_KEY });
  assert.throws(() => readTurnstileConfig({ ...dummy, APP_ENV: "production" }), /refused in production/);
  assert.throws(() => readTurnstileConfig({ ...dummy, TURNSTILE_SITE_KEY: "0x4AAAAAAAreal0123456789", APP_ENV: "production" }), /refused in production/);
  assert.ok(readTurnstileConfig({ TURNSTILE_SITE_KEY: "0x4AAAAAAAreal0123456789", TURNSTILE_SECRET_KEY: "0x4AAAAAAAsecret0123456789", APP_ENV: "production" }));
});

test("sign-in copy: challenge and lock are told apart from a plain limit, and a wait is always named", () => {
  assert.equal(failureKind(429, "CHALLENGE_REQUIRED"), "challenge");
  assert.equal(failureKind(423, "SIGN_IN_LOCKED"), "locked");
  assert.equal(failureKind(429, "RATE_LIMITED"), "limit");
  assert.match(failureMessage("challenge", "password", 120), /2 menit/);
  assert.match(failureMessage("challenge", "password", 120, true), /verifikasi/);
  assert.match(failureMessage("locked", "password", 900), /dikunci sementara.*15 menit/);
  assert.match(failureMessage("locked", "password", 7200), /2 jam/);
});
