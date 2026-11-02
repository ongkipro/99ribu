import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAuth } from "../../src/modules/access/handler.ts";
import { clearSignInBudget, gateSignIn, SIGN_IN_FAILURE_CEILING, VERIFY_GLOBAL, VERIFY_PER_ADDRESS, verifyTurnstile, type VerifyTurnstile } from "../../src/modules/access/signin-budget.ts";
import { mac } from "../../src/modules/checkout/access.ts";

// S149 (database-backed; run by the coordinator): the sign-in budget counts FAILED sign-ins per account,
// asks for a Turnstile token after five in a minute, cools off (15 min, doubling) at the ceiling, and behaves
// the same for an unknown email.
const origin = "http://127.0.0.1:3099";
const accepted: VerifyTurnstile = async (token) => token === "good-token";

test("sign-in challenge: failures only, token or wait, success resets, timed cool-off at the ceiling, no enumeration", async () => {
  const identity = createLocalAuth("test");
  const email = `challenge-${randomUUID()}@example.invalid`, ghost = `ghost-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url"), newPassword = randomBytes(24).toString("base64url");
  const post = (path: string, body: Record<string, unknown>, verify: VerifyTurnstile = accepted) => handleAuth(new Request(`${origin}/api/auth${path}`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  }), identity, { verifyTurnstile: verify });
  const signIn = (who: string, secret: string, token?: string, verify?: VerifyTurnstile) => post("/sign-in/email", { email: who, password: secret, ...(token ? { turnstile_token: token } : {}) }, verify);
  const wrong = () => randomBytes(18).toString("base64url");
  const rows = async (who: string) => {
    const hash = await mac(identity, "auth-account", [who]);
    return identity.sql<{ key: string; count: number }[]>`select key,count from app.auth_rate_limit where key in (${`rl:signin-window:${hash}`},${`rl:signin-run:${hash}`}) order by key`;
  };
  const saved = { site: process.env.TURNSTILE_SITE_KEY, secret: process.env.TURNSTILE_SECRET_KEY, fetch: globalThis.fetch };
  let userId = "";
  const resetVerify = () => identity.sql`delete from app.auth_rate_limit where key like 'rl:signin-verify-%'`;
  try {
    process.env.TURNSTILE_SITE_KEY = "test-site-key-0001";
    process.env.TURNSTILE_SECRET_KEY = "test-secret-key-0001";
    assert.equal((await post("/sign-up/email", { name: "Challenge", email, password })).status, 200);
    [{ id: userId }] = await identity.sql`update app.auth_user set email_verified=true where email=${email} returning id`;

    // Failures only: three successes in a row never build a budget; four failures still sign in without a token.
    for (let i = 0; i < 3; i++) assert.equal((await signIn(email, password)).status, 200);
    assert.equal((await rows(email)).length, 0, "a success leaves no counters");
    for (let i = 0; i < 4; i++) assert.equal((await signIn(email, wrong())).status, 401);
    assert.equal((await signIn(email, password)).status, 200, "four failures are still below the challenge");
    assert.equal((await rows(email)).length, 0, "success resets the account's counters");

    // Five failures: the next attempt is refused with CHALLENGE_REQUIRED even though the password is right.
    for (let i = 0; i < 5; i++) assert.equal((await signIn(email, wrong())).status, 401);
    const refused = await signIn(email, password);
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.clone().json(), { code: "CHALLENGE_REQUIRED", siteKey: "test-site-key-0001" });
    const wait = Number(refused.headers.get("retry-after"));
    assert.ok(wait >= 1 && wait <= 60, `Retry-After ${wait}`);
    // A refused attempt is not charged and a bad or missing token never signs in.
    const before = await rows(email);
    assert.equal((await signIn(email, password, "bad-token")).status, 429);
    assert.deepEqual(await rows(email), before);
    assert.equal((await signIn(email, password, "good-token", async () => false)).status, 429, "verifier says no");

    // A timeout, a network error or garbage from Cloudflare is not success (the real verifier, fetch faked).
    const withFetch = async (fn: typeof fetch) => { globalThis.fetch = fn; return signIn(email, password, "any-token", verifyTurnstile); };
    const timedOut = await withFetch(async () => { throw new DOMException("timed out", "TimeoutError"); });
    assert.equal(timedOut.status, 429);
    assert.deepEqual(await timedOut.json(), { code: "CHALLENGE_REQUIRED", siteKey: "test-site-key-0001" }, "the widget's public key travels in the refusal");
    assert.equal((await withFetch(async () => new Response("<html>"))).status, 429);
    assert.equal((await withFetch(async () => Response.json({ success: false }))).status, 429);
    globalThis.fetch = saved.fetch;
    delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY;
    assert.equal((await signIn(email, password, "good-token", verifyTurnstile)).status, 429, "no secret configured: never a silent allow");
    process.env.TURNSTILE_SITE_KEY = "test-site-key-0001"; process.env.TURNSTILE_SECRET_KEY = "test-secret-key-0001";
    await resetVerify();

    // A valid token lets the correct password in, and the success resets the counters.
    assert.equal((await signIn(email, password, "good-token")).status, 200);
    assert.equal((await rows(email)).length, 0);
    assert.equal((await signIn(email, password)).status, 200, "no token needed after the reset");

    // A wrong password with a valid token is an ordinary failure that counts (the token checks are budgeted, 10 a minute).
    await resetVerify();
    for (let i = 0; i < 5; i++) await signIn(email, wrong());
    assert.equal((await signIn(email, wrong(), "good-token")).status, 401);
    assert.equal((await signIn(email, wrong())).status, 429, "still challenged");
    assert.equal(Number((await rows(email)).find((row) => row.key.startsWith("rl:signin-run:"))?.count), 6);

    // Unknown and known emails answer identically, failure by failure, and refuse on the same attempt.
    await clearSignInBudget(identity, email);
    for (let i = 0; i < 5; i++) {
      const [known, unknown] = [await signIn(email, wrong()), await signIn(ghost, wrong())];
      assert.equal(known.status, 401);
      assert.equal(unknown.status, 401);
      assert.deepEqual(await unknown.json(), await known.json());
    }
    const [knownRefused, ghostRefused] = [await signIn(email, password), await signIn(ghost, password)];
    assert.equal(knownRefused.status, 429);
    assert.equal(ghostRefused.status, 429);
    assert.deepEqual(await ghostRefused.json(), await knownRefused.json());
    assert.ok(Math.abs(Number(ghostRefused.headers.get("retry-after")) - Number(knownRefused.headers.get("retry-after"))) <= 1);
    await resetVerify();
    assert.equal((await signIn(ghost, wrong(), "good-token")).status, 401, "a valid token on an unknown email is an ordinary failure");

    // The ceiling: the 100th consecutive failure is still an ordinary 401, then sign-in is refused for a timed
    // cool-off (15 min, doubling at each further hit), token or not, without spending a token. It ends by itself.
    const key = async (who: string, kind: string) => `rl:signin-${kind}:${await mac(identity, "auth-account", [who])}`;
    const seedRun = async (who: string) => {
      await identity.sql`delete from app.auth_rate_limit where key in (${await key(who, "window")},${await key(who, "run")})`;
      await identity.sql`insert into app.auth_rate_limit (id,key,count,last_request) values (${randomUUID()},${await key(who, "run")},${SIGN_IN_FAILURE_CEILING - 1},${Date.now()})`;
    };
    const endCoolOff = async (who: string) => identity.sql`update app.auth_rate_limit set last_request=${Date.now() - 1000} where key=${await key(who, "cool")}`;
    const retryOf = (response: Response) => Number(response.headers.get("retry-after"));
    let spent = 0;
    const counting: VerifyTurnstile = async (given) => { spent++; return given === "good-token"; };
    await clearSignInBudget(identity, email);
    await seedRun(email);
    assert.equal((await signIn(email, wrong(), undefined, counting)).status, 401, "failure number 100 is still an ordinary 401");
    const locked = await signIn(email, password, "good-token", counting);
    assert.equal(locked.status, 423);
    assert.deepEqual(await locked.json(), { code: "SIGN_IN_LOCKED" });
    assert.ok(retryOf(locked) >= 880 && retryOf(locked) <= 900, `first cool-off ${retryOf(locked)} s`);
    assert.equal((await signIn(email, password, "good-token", counting)).status, 423, "a valid token does not bypass the cool-off");
    assert.equal((await signIn(email, password, undefined, counting)).status, 423);
    assert.equal(spent, 0, "a refused request never reaches siteverify");
    // An unknown email gets the same refusal.
    await seedRun(ghost);
    assert.equal((await signIn(ghost, wrong(), undefined, counting)).status, 401);
    const ghostLocked = await signIn(ghost, password, "good-token", counting);
    assert.equal(ghostLocked.status, 423);
    assert.deepEqual(await ghostLocked.json(), { code: "SIGN_IN_LOCKED" });
    assert.ok(Math.abs(retryOf(ghostLocked) - retryOf(locked)) <= 2);
    // The next ceiling hit doubles the cool-off.
    await endCoolOff(email);
    await seedRun(email);
    assert.equal((await signIn(email, wrong(), undefined, counting)).status, 401, "the count restarted after the first cool-off");
    const second = await signIn(email, password, undefined, counting);
    assert.equal(second.status, 423);
    assert.ok(retryOf(second) >= 1780 && retryOf(second) <= 1800, `second cool-off ${retryOf(second)} s`);
    // It expires by itself: afterwards the right password signs in and everything is forgotten.
    await endCoolOff(email);
    assert.equal((await signIn(email, password)).status, 200);
    assert.equal((await identity.sql`select key from app.auth_rate_limit where key like ${`rl:signin-%:${await mac(identity, "auth-account", [email])}`}`).length, 0);
    // A completed password reset also ends a cool-off at once.
    await seedRun(email);
    await signIn(email, wrong());
    assert.equal((await signIn(email, password)).status, 423);
    const context = await identity.auth.$context;
    const token = randomBytes(24).toString("base64url");
    await context.internalAdapter.createVerificationValue({ value: userId, identifier: `reset-password:${token}`, expiresAt: new Date(Date.now() + 600_000) });
    assert.equal((await post("/reset-password", { token, newPassword })).status, 200);
    assert.equal((await rows(email)).length, 0);
    assert.equal((await signIn(email, password)).status, 401, "the old password is gone");
    assert.equal((await signIn(email, newPassword)).status, 200);
  } finally {
    globalThis.fetch = saved.fetch;
    for (const [name, value] of [["TURNSTILE_SITE_KEY", saved.site], ["TURNSTILE_SECRET_KEY", saved.secret]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    for (const who of [email, ghost]) {
      const hash = await mac(identity, "auth-account", [who]);
      await identity.sql`delete from app.auth_rate_limit where key in (${`rl:signin-window:${hash}`},${`rl:signin-run:${hash}`},${`rl:signin-cool:${hash}`})`;
    }
    await resetVerify();
    await identity.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await identity.sql`delete from app.local_delivery where recipient=${email}`;
    if (userId) await identity.sql`delete from app.auth_verification where value=${userId}`;
    await identity.sql`delete from app.auth_user where email=${email}`;
    await identity.sql.end();
  }
});

// Helpers shared by the focused tests below.
const keysOn = () => { process.env.TURNSTILE_SITE_KEY = "test-site-key-0001"; process.env.TURNSTILE_SECRET_KEY = "test-secret-key-0001"; };
const keysOff = () => { delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY; };
async function scoped(run: (identity: ReturnType<typeof createLocalAuth>, emails: string[]) => Promise<void>) {
	const identity = createLocalAuth("test");
	const emails: string[] = [];
	const saved = { site: process.env.TURNSTILE_SITE_KEY, secret: process.env.TURNSTILE_SECRET_KEY };
	try { await run(identity, emails); } finally {
		for (const [name, value] of [["TURNSTILE_SITE_KEY", saved.site], ["TURNSTILE_SECRET_KEY", saved.secret]] as const) {
			if (value === undefined) delete process.env[name]; else process.env[name] = value;
		}
		for (const who of emails) await clearSignInBudget(identity, who);
		await identity.sql`delete from app.auth_rate_limit where key like 'rl:signin-verify-%'`;
		await identity.sql.end();
	}
}
const ghostEmail = () => `ghost-${randomUUID()}@example.invalid`;
const rowKey = async (identity: ReturnType<typeof createLocalAuth>, who: string, kind: string) => `rl:signin-${kind}:${await mac(identity, "auth-account", [who])}`;

test("H1: without Turnstile keys the account is limited by the 60 s window only: no growth, no ceiling, no cool-off", async () => {
	await scoped(async (identity, emails) => {
		keysOff();
		const who = ghostEmail(); emails.push(who);
		const client = { ip: null, bucket: "127.0.0.1" };
		const gate = (token: string | null = null) => gateSignIn(identity, who, token, client, async () => true);
		for (let i = 0; i < 5; i++) assert.deepEqual(await gate(), { ok: true });
		const refused = await gate("good-token");
		assert.deepEqual(refused.ok === false && [refused.status, refused.code, "siteKey" in refused ? refused.siteKey : undefined], [429, "CHALLENGE_REQUIRED", null], "no site key, and a token cannot help");
		assert.ok(refused.ok === false && refused.status === 429 && refused.retryAfter >= 1 && refused.retryAfter <= 60);
		// A deep consecutive run (far above the ceiling) with an old window: allowed again at once, never locked or backed off for an hour.
		await identity.sql`update app.auth_rate_limit set count=500, last_request=${Date.now()} where key=${await rowKey(identity, who, "run")}`;
		await identity.sql`update app.auth_rate_limit set last_request=${Date.now() - 61_000} where key=${await rowKey(identity, who, "window")}`;
		assert.deepEqual(await gate(), { ok: true }, "ceiling ignored, window over");
		assert.equal((await identity.sql`select 1 from app.auth_rate_limit where key=${await rowKey(identity, who, "cool")} and (count>0 or last_request>0)`).length, 0, "no cool-off was opened");
		// Same state with keys configured WOULD back off, so the assertion above can fail.
		keysOn();
		await identity.sql`update app.auth_rate_limit set count=5, last_request=${Date.now()} where key=${await rowKey(identity, who, "window")}`;
		const withKeys = await gate();
		assert.ok(withKeys.ok === false && withKeys.status === 423 && withKeys.retryAfter > 60, "control: with keys the same state hits the ceiling cool-off");
	});
});

test("H2: the token budget is per address and global, never per account; a refused budget does not reject more than the failure budget", async () => {
	await scoped(async (identity, emails) => {
		keysOn();
		const victim = ghostEmail(); emails.push(victim);
		const attacker = { ip: null, bucket: "198.51.100.7" }, owner = { ip: null, bucket: "203.0.113.5" };
		const calls: string[] = [];
		const verify: VerifyTurnstile = async (token) => { calls.push(token); return token === "good-token"; };
		for (let i = 0; i < 5; i++) assert.equal((await gateSignIn(identity, victim, null, owner, verify)).ok, true);
		assert.equal((await gateSignIn(identity, victim, null, owner, verify)).ok, false, "the victim is in challenge");
		// A stranger sends 11 junk tokens for the victim's account ...
		for (let i = 0; i < 11; i++) assert.equal((await gateSignIn(identity, victim, `junk-${i}`, attacker, verify)).ok, false);
		assert.equal(calls.length, VERIFY_PER_ADDRESS, "one address reaches siteverify at most 10 times a minute");
		// ... and the victim's own valid token still goes through from their own address.
		assert.deepEqual(await gateSignIn(identity, victim, "good-token", owner, verify), { ok: true });
		// The same address past its budget gets exactly what the failure budget gives (challenge), not a new error.
		const over = await gateSignIn(identity, victim, "good-token", attacker, verify);
		assert.ok(!over.ok && over.status === 429 && over.code === "CHALLENGE_REQUIRED" && over.retryAfter >= 1);
		assert.equal(calls.length, VERIFY_PER_ADDRESS + 1, "the refused budget skipped siteverify");
		// Global cap: when it is spent nobody verifies, and the request is still just a challenge.
		await identity.sql`insert into app.auth_rate_limit (id,key,count,last_request) values (${randomUUID()},'rl:signin-verify-all',${VERIFY_GLOBAL},${Date.now()}) on conflict (key) do update set count=${VERIFY_GLOBAL}, last_request=${Date.now()}`;
		const before = calls.length;
		for (let i = 0; i < 5; i++) await gateSignIn(identity, victim, null, owner, verify);
		const globalRefused = await gateSignIn(identity, victim, "good-token", { ip: null, bucket: "192.0.2.44" }, verify);
		assert.ok(!globalRefused.ok && globalRefused.code === "CHALLENGE_REQUIRED");
		assert.equal(calls.length, before, "global cap reached: no siteverify call");
		// A request that needs no token never touches the verify budget, whatever its state.
		const calm = ghostEmail(); emails.push(calm);
		assert.deepEqual(await gateSignIn(identity, calm, "good-token", attacker, verify), { ok: true });
		assert.equal(calls.length, before);
	});
});

test("a token accepted for one account's challenge does not lift another account's challenge", async () => {
	await scoped(async (identity, emails) => {
		keysOn();
		const [a, b] = [ghostEmail(), ghostEmail()]; emails.push(a, b);
		const client = { ip: null, bucket: "127.0.0.1" };
		const verify: VerifyTurnstile = async (token) => token === "good-token";
		for (const who of [a, b]) for (let i = 0; i < 5; i++) assert.equal((await gateSignIn(identity, who, null, client, verify)).ok, true);
		assert.deepEqual(await gateSignIn(identity, b, "good-token", client, verify), { ok: true }, "B passes its own challenge");
		const noToken = await gateSignIn(identity, a, null, client, verify);
		assert.ok(!noToken.ok && noToken.code === "CHALLENGE_REQUIRED", "A is still challenged afterwards");
		const wrongToken = await gateSignIn(identity, a, "someone-elses-token", client, verify);
		assert.ok(!wrongToken.ok && wrongToken.code === "CHALLENGE_REQUIRED");
		assert.deepEqual(await gateSignIn(identity, a, "good-token", client, verify), { ok: true }, "A passes with its own token");
	});
});

test("20 parallel wrong passwords for one account: exactly 5 reach Better Auth, the rest are challenged, counters stay consistent", async () => {
	await scoped(async (identity, emails) => {
		keysOn();
		const who = `race-${randomUUID()}@example.invalid`; emails.push(who);
		const attempt = () => handleAuth(new Request(`${origin}/api/auth/sign-in/email`, {
			method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: who, password: randomBytes(18).toString("base64url") }),
		}), identity, { verifyTurnstile: accepted });
		const statuses = (await Promise.all(Array.from({ length: 20 }, attempt))).map((response) => response.status);
		assert.equal(statuses.filter((status) => status === 401).length, 5, `statuses ${statuses.join(",")}`);
		assert.equal(statuses.filter((status) => status === 429).length, 15);
		const counts = await identity.sql<{ key: string; count: number }[]>`select key,count from app.auth_rate_limit where key in (${await rowKey(identity, who, "window")},${await rowKey(identity, who, "run")})`;
		assert.deepEqual(counts.map((row) => Number(row.count)), [5, 5], "refused attempts are not charged");
	});
});
