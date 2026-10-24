import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createLocalAuth } from "../src/modules/access/auth.ts";
import { handleAuth, requireIdentity, requireStaff } from "../src/modules/access/handler.ts";
import { mac } from "../src/modules/checkout/access.ts";
import { runOneJob } from "../src/jobs/worker.ts";
import { enqueueJob } from "../src/jobs/outbox.ts";
import type { Sql } from "postgres";

const origin = "http://127.0.0.1:3099";

async function deliverOwnNotifications(sql: Sql, recipient: string, kind: string) {
  const jobs = await sql`select j.id from app.outbox_job j join app.local_delivery d on d.id::text=j.payload->>'deliveryId'
    where j.kind='local.notification' and j.status='pending' and d.recipient=${recipient} and d.kind=${kind} order by j.created_at,j.id`;
  for (const job of jobs) assert.equal(await runOneJob(sql, {}, job.id), true);
}

test("real auth: verification, session lifecycle, reset, deny-default and persistent concurrent rate limits", async (t) => {
  let identity = createLocalAuth("test");
  const email = `auth-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const newPassword = randomBytes(24).toString("base64url");
  let cookie = "";
  let userId = "";
  const call = (path: string, body?: Record<string, unknown>, extra?: HeadersInit) => handleAuth(new Request(`${origin}/api/auth${path}`, {
    method: body ? "POST" : "GET", headers: { origin, "content-type": "application/json", cookie, ...extra },
    body: body ? JSON.stringify(body) : undefined,
  }), identity);
  const protectedRequest = () => new Request(`${origin}/private`, { headers: { cookie } });
  const delivery = async (kind: string) => {
    await deliverOwnNotifications(identity.sql, email, kind);
    assert.deepEqual((await identity.sql`select status,attempts,dispatched_at,completed_at from app.outbox_job where id=${sentinel}`)[0],
      { status: "pending", attempts: 0, dispatched_at: null, completed_at: null }, "Owned auth delivery must preserve older unrelated work");
    const rows = await identity.sql`select url from app.local_delivery where recipient=${email} and kind=${kind} and expires_at>now() and delivered_at is not null order by created_at desc`;
    assert.ok(rows.length > 0, "Expected a private synthetic delivery");
    return new URL(rows[0].url);
  };
  // This is the exclusively owned test DB's fixed loopback bucket. Preserve users and other fixtures.
  const paths = ["/sign-up/email", "/sign-in/email", "/get-session", "/verify-email", "/sign-out", "/request-password-reset", "/reset-password"];
  const keys = paths.map((path) => `127.0.0.1|${path}`);
  await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(keys)}`;
  const sentinel = await identity.sql.begin(tx => enqueueJob(tx, "local.notification", `auth-unrelated:${randomUUID()}`, { deliveryId: randomUUID() }));
  try {
    await t.test("unauthenticated and forged-origin requests are rejected", async () => {
      assert.equal((await requireStaff(protectedRequest(), identity)).status, 401);
      assert.equal((await call("/sign-up/email", { name: "Synthetic Buyer", email, password }, { origin: "https://evil.invalid" })).status, 403);
      assert.equal((await call("/sign-up/email", { name: "Synthetic Buyer", email, password }, { origin: "" })).status, 403);
      assert.equal((await call("/sign-up/email", { name: "Synthetic Buyer", email: "real@example.com", password })).status, 400);
      assert.equal((await call("/sign-up/email", { name: "x".repeat(17000), email, password })).status, 413);
      const nextRequest = new NextRequest(`${origin}/api/auth/get-session`, { headers: { host: "127.0.0.1:3099" } });
      assert.equal(new URL(nextRequest.url).hostname, "localhost");
      assert.equal((await handleAuth(nextRequest, identity)).status, 200);
      assert.equal((await handleAuth(new Request("http://localhost:3099/api/auth/get-session", { headers: { host: "localhost:3099" } }), identity)).status, 403);
    });
    await t.test("sign-up is enumeration-safe and grants no session before verification", async () => {
      // S123: fields beyond name/email/password/callbackURL are refused before any effect (no mass assignment).
      for (const extra of [{ role: "owner" }, { emailVerified: true }, { image: "https://evil.invalid/x.png" }]) {
        assert.equal((await call("/sign-up/email", { name: "Synthetic Buyer", email, password, ...extra })).status, 400);
      }
      const signup = await call("/sign-up/email", { name: "Synthetic Buyer", email, password });
      assert.equal(signup.status, 200);
      assert.ok(!signup.headers.get("set-cookie"));
      const duplicate = await call("/sign-up/email", { name: "Synthetic Buyer", email, password });
      assert.equal(duplicate.status, 200);
      assert.deepEqual(await signup.json(), await duplicate.json());
      // S123: the verification link may only return to the landing page with a validated next; a name is required.
      for (const callbackURL of ["https://evil.invalid/", "/admin", "/masuk/verifikasi?next=%2F%2Fevil.invalid"]) {
        assert.equal((await call("/sign-up/email", { name: "Synthetic Buyer", email, password, callbackURL })).status, 400, callbackURL);
        assert.equal((await call("/send-verification-email", { email, callbackURL })).status, 400, callbackURL);
      }
      assert.equal((await call("/sign-up/email", { name: " ", email, password })).status, 400);
      // These 400s answer before the per-email budget, so the counts below are unchanged.
      // EMAIL_NOT_VERIFIED is named only after the password matched (a wrong one stays 401 INVALID_CREDENTIALS below).
      const unverified = await call("/sign-in/email", { email, password });
      assert.equal(unverified.status, 403);
      assert.deepEqual(await unverified.json(), { code: "EMAIL_NOT_VERIFIED" });
      const rows = await identity.sql`select id, email_verified from app.auth_user where email=${email}`;
      assert.equal(rows.length, 1); assert.equal(rows[0].email_verified, false); userId = rows[0].id;
      const accounts = await identity.sql`select password from app.auth_account where user_id=${userId}`;
      assert.ok(accounts[0].password !== password, "Stored password must be hashed");
    });
    await t.test("verification rejects tampered links, permits cookie-only login, persists and denies staff", async () => {
      const link = await delivery("verification");
      const tampered = new URL(link);
      tampered.searchParams.set("token", `${link.searchParams.get("token")}.tampered`);
      const rejected = await handleAuth(new Request(tampered), identity);
      assert.ok((rejected.headers.get("location") ?? "").includes("error="));
      const verified = await handleAuth(new Request(link), identity);
      assert.ok([200, 302].includes(verified.status));
      const login = await call("/sign-in/email", { email, password });
      assert.equal(login.status, 200);
      const setCookie = login.headers.get("set-cookie") ?? "";
      assert.ok(setCookie.includes("HttpOnly") && setCookie.includes("SameSite=Lax") && !setCookie.includes("Domain="));
      cookie = setCookie.split(";")[0];
      assert.ok(cookie.length > 20, "Expected local session cookie");
      assert.ok(!Object.hasOwn(await login.json(), "token"), "Token must not be returned as JSON");
      await identity.sql.end(); identity = createLocalAuth("test");
      assert.ok((await requireIdentity(protectedRequest(), identity))?.id === userId);
      assert.equal((await call("/sign-out", {}, { origin: "https://evil.invalid" })).status, 403);
      assert.ok(await requireIdentity(protectedRequest(), identity));
      assert.equal((await requireStaff(protectedRequest(), identity)).status, 403);
      assert.equal((await call("/list-sessions")).status, 404);
      assert.equal((await call("/revoke-session", { token: "synthetic-not-a-session" })).status, 404);
      assert.equal((await call("/update-user", { name: "Unreviewed mutation" })).status, 404);
      const current = await call("/get-session");
      assert.equal(current.status, 200);
      const payload = await current.json();
      assert.ok(payload?.session && !Object.hasOwn(payload.session, "token"));
    });
    await t.test("logout revokes immediately; reset hides account existence and invalidates sessions", async () => {
      assert.equal((await call("/sign-out", {})).status, 200);
      assert.equal(await requireIdentity(protectedRequest(), identity), null);
      const login = await call("/sign-in/email", { email, password });
      assert.equal(login.status, 200); cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      const known = await call("/request-password-reset", { email, redirectTo: `${origin}/reset-password` });
      const unknown = await call("/request-password-reset", { email: `missing-${randomUUID()}@example.invalid`, redirectTo: `${origin}/reset-password` });
      assert.equal(known.status, 200); assert.equal(unknown.status, 200);
      assert.deepEqual(await known.json(), await unknown.json());
      assert.equal((await call("/request-password-reset", { email, redirectTo: "https://evil.invalid/reset" })).status, 403);
      const link = await delivery("password_reset");
      const token = link.pathname.split("/").at(-1);
      assert.equal((await call("/reset-password", { token: "invalid-synthetic-token", newPassword })).status, 400);
      assert.equal((await call("/reset-password", { token, newPassword })).status, 200);
      assert.equal(await requireIdentity(protectedRequest(), identity), null);
      assert.equal((await call("/reset-password", { token, newPassword })).status, 400);
      assert.equal((await call("/sign-in/email", { email, password })).status, 401);
      const next = await call("/sign-in/email", { email, password: newPassword });
      assert.equal(next.status, 200); cookie = (next.headers.get("set-cookie") ?? "").split(";")[0];
      assert.ok(await requireIdentity(protectedRequest(), identity));
    });
    await t.test("expired session is rejected and spoofed proxy headers cannot evade the limiter", async () => {
      await identity.sql`update app.auth_session set expires_at=now()-interval '1 minute' where user_id=${userId}`;
      assert.equal(await requireIdentity(protectedRequest(), identity), null);
      const response = await call("/sign-in/email", { email, password: newPassword }, { "x-forwarded-for": "198.51.100.1", "x-99ribu-local-ip": "198.51.100.2" });
      assert.equal(response.status, 429);
      assert.ok(Number(response.headers.get("x-retry-after")) > 0);
      await identity.sql.end(); identity = createLocalAuth("test");
      assert.equal((await call("/sign-in/email", { email, password: newPassword })).status, 429);
      const statuses = await Promise.all(Array.from({ length: 8 }, async () => (await call("/sign-up/email", { name: "Synthetic Buyer", email, password: newPassword })).status));
      assert.equal(statuses.filter((s) => s === 200).length, 1);
      assert.equal(statuses.filter((s) => s === 429).length, 7);
    });
    await t.test("expired verification link grants no session", async (step) => {
      const link = await delivery("verification");
      step.mock.timers.enable({ apis: ["Date"], now: Date.now() + 31 * 60 * 1000 });
      try {
        const expired = await handleAuth(new Request(link), identity);
        assert.ok((expired.headers.get("location") ?? "").includes("error="));
        assert.ok(!expired.headers.has("set-cookie"));
      } finally { step.mock.timers.reset(); }
    });
  } finally {
    await identity.sql`delete from app.outbox_job where id=${sentinel}`;
    // Exact synthetic actor only; foreign-key cascades remove its own credentials/sessions.
    await identity.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await identity.sql`delete from app.local_delivery where recipient=${email}`;
    if (userId) {
      await identity.sql`delete from app.auth_verification where value=${userId}`;
      await identity.sql`delete from app.auth_user where id=${userId}`;
    }
    await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(keys)}`;
    await identity.sql.end();
  }
});

// S123 review M1: someone signs up with another person's email and their own password. The email owner's
// later sign-up and resend must never send a plain verification link for that account: they get a
// set-password link, the account is verified only by setting a new password, and the first password dies.
test("account pre-hijacking: an unverified account is activated only by its email owner setting a new password", async () => {
  const identity = createLocalAuth("test");
  const email = `prehijack-${randomUUID()}@example.invalid`;
  const attacker = randomBytes(24).toString("base64url"), owner = randomBytes(24).toString("base64url");
  const call = (path: string, body: Record<string, unknown>) => handleAuth(new Request(`${origin}/api/auth${path}`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  }), identity);
  const kinds = async () => (await identity.sql`select kind from app.local_delivery where recipient=${email} order by created_at, id`).map((row) => row.kind);
  const paths = ["/sign-up/email", "/sign-in/email", "/send-verification-email", "/reset-password"];
  await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(paths.map((path) => `127.0.0.1|${path}`))}`;
  let userId = "";
  try {
    const first = await call("/sign-up/email", { name: "Penyerobot", email, password: attacker });
    assert.equal(first.status, 200);
    [{ id: userId }] = await identity.sql`select id from app.auth_user where email=${email}`;
    assert.deepEqual(await kinds(), ["verification"]);
    // The email owner signs up and asks for a resend: same replies as for any address, but only set-password links go out.
    const again = await call("/sign-up/email", { name: "Pemilik Email", email, password: owner });
    assert.equal(again.status, 200);
    assert.deepEqual(await again.json(), await first.json());
    const resend = await call("/send-verification-email", { email, callbackURL: "/masuk/verifikasi" });
    assert.equal(resend.status, 200);
    assert.deepEqual(await resend.json(), { status: true });
    assert.deepEqual(await kinds(), ["verification", "password_reset", "password_reset"], "No new verification link for an account the owner did not set");
    assert.equal((await identity.sql`select email_verified from app.auth_user where id=${userId}`)[0].email_verified, false);
    // Following the newest link lands on the set-password page with the token; setting the password activates the account.
    const [latest] = await identity.sql`select url from app.local_delivery where recipient=${email} and kind='password_reset' order by created_at desc, id desc limit 1`;
    const landing = await handleAuth(new Request(latest.url), identity);
    assert.equal(landing.status, 302);
    const target = new URL(landing.headers.get("location") ?? "", origin);
    assert.equal(target.pathname, "/masuk/atur-sandi");
    assert.equal(target.searchParams.get("aktivasi"), "1");
    const token = target.searchParams.get("token");
    assert.ok(token);
    assert.equal(landing.headers.get("referrer-policy"), "no-referrer");
    assert.equal((await call("/reset-password", { token, newPassword: owner })).status, 200);
    assert.equal((await identity.sql`select email_verified from app.auth_user where id=${userId}`)[0].email_verified, true);
    assert.equal((await call("/sign-in/email", { email, password: attacker })).status, 401, "The first password no longer works");
    assert.equal((await call("/sign-in/email", { email, password: owner })).status, 200);
    // A verified account's sign-up still only mails the existing-account notice.
    assert.equal((await call("/sign-up/email", { name: "Lagi", email, password: attacker })).status, 200);
    assert.deepEqual((await kinds()).slice(-1), ["existing_account"]);
    assert.equal((await kinds()).filter((kind) => kind === "password_reset").length, 2);
  } finally {
    await identity.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await identity.sql`delete from app.local_delivery where recipient=${email}`;
    if (userId) {
      await identity.sql`delete from app.auth_verification where value=${userId}`;
      await identity.sql`delete from app.auth_user where id=${userId}`;
    }
    await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(paths.map((path) => `127.0.0.1|${path}`))}`;
    await identity.sql.end();
  }
});

test("expired password recovery cannot change credentials", async () => {
  const identity = createLocalAuth("test");
  const email = `expired-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const call = (path: string, body: Record<string, unknown>) => handleAuth(new Request(`${origin}/api/auth${path}`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
  }), identity);
  let userId = "";
  try {
    assert.equal((await call("/sign-up/email", { name: "Expired Synthetic", email, password })).status, 200);
    const [user] = await identity.sql`select id from app.auth_user where email=${email}`;
    userId = user.id;
    assert.equal((await call("/request-password-reset", { email, redirectTo: `${origin}/reset-password` })).status, 200);
    await deliverOwnNotifications(identity.sql, email, "password_reset");
    const [message] = await identity.sql`select url from app.local_delivery where recipient=${email} and kind='password_reset' and delivered_at is not null`;
    const token = new URL(message.url).pathname.split("/").at(-1);
    await identity.sql`update app.auth_verification set expires_at=now()-interval '1 minute' where value=${userId}`;
    assert.equal((await call("/reset-password", { token, newPassword: randomBytes(24).toString("base64url") })).status, 400);
    const [stored] = await identity.sql`select password from app.auth_account where user_id=${userId}`;
    assert.ok(await (await identity.auth.$context).password.verify({ password, hash: stored.password }));
  } finally {
    await identity.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await identity.sql`delete from app.local_delivery where recipient=${email}`;
    if (userId) {
      await identity.sql`delete from app.auth_verification where value=${userId}`;
      await identity.sql`delete from app.auth_user where id=${userId}`;
    }
    const keys = ["/sign-up/email", "/request-password-reset", "/reset-password"].map((path) => `127.0.0.1|${path}`);
    await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(keys)}`;
    await identity.sql.end();
  }
});

test("two real principals cannot select another identity or gain staff rights through headers/query/body", async () => {
  const identity = createLocalAuth("test");
  const users: { id: string; email: string; cookie: string }[] = [];
  const paths = ["/sign-up/email", "/sign-in/email", "/verify-email", "/get-session"];
  const keys = paths.map((path) => `127.0.0.1|${path}`);
  try {
    for (let i = 0; i < 2; i++) {
      const email = `principal-${randomUUID()}@example.test`;
      const password = randomBytes(24).toString("base64url");
      const post = (path: string, body: Record<string, unknown>) => handleAuth(new Request(`${origin}/api/auth${path}`, {
        method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
      }), identity);
      assert.equal((await post("/sign-up/email", { name: "Scoped Synthetic", email, password })).status, 200);
      const [user] = await identity.sql`select id from app.auth_user where email=${email}`;
      const actor = { id: user.id as string, email, cookie: "" }; users.push(actor);
      await deliverOwnNotifications(identity.sql, email, "verification");
      const [message] = await identity.sql`select url from app.local_delivery where recipient=${email} and kind='verification' and delivered_at is not null`;
      assert.ok([200, 302].includes((await handleAuth(new Request(message.url), identity)).status));
      const login = await post("/sign-in/email", { email, password });
      assert.equal(login.status, 200); actor.cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    }
    const request = new Request(`${origin}/api/auth/get-session?userId=${users[1].id}`, { headers: {
      cookie: users[0].cookie, "x-user-id": users[1].id, "x-role": "owner", authorization: "Bearer synthetic-forged-identity",
    } });
    const response = await handleAuth(request, identity);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.ok(payload.user.id === users[0].id && payload.user.id !== users[1].id);
    assert.equal((await requireStaff(request, identity)).status, 403);
    const forged = new Request(`${origin}/api/auth/get-session`, { headers: { authorization: "Bearer synthetic-forged-identity", "x-user-id": users[1].id } });
    assert.ok(await (await handleAuth(forged, identity)).json() === null);
  } finally {
    for (const user of users) {
      await identity.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${user.email})`;
      await identity.sql`delete from app.local_delivery where recipient=${user.email}`;
      await identity.sql`delete from app.auth_verification where value=${user.id}`;
      await identity.sql`delete from app.auth_user where id=${user.id}`;
    }
    await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(keys)}`;
    await identity.sql.end();
  }
});

test("failed logins for one email do not lock out another email", async () => {
  const identity = createLocalAuth("test");
  const [a, b] = [`rl-a-${randomUUID()}@example.invalid`, `rl-b-${randomUUID()}@example.invalid`];
  const signIn = (email: string) => handleAuth(new Request(`${origin}/api/auth/sign-in/email`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password: "wrong-password-123" }),
  }), identity);
  const keys = ["127.0.0.1|/sign-in/email"];
  for (const email of [a, b]) keys.push(`rl:auth-account:/api/auth/sign-in/email:${await mac(identity, "auth-account", [email])}`);
  await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(keys)}`;
  try {
    for (let i = 0; i < 5; i++) assert.equal((await signIn(a)).status, 401);
    const blocked = await signIn(a);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal((await signIn(b)).status, 401, "another account must not share the lockout");
  } finally {
    await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(keys)}`;
    await identity.sql.end();
  }
});

test("2FA limiter refuses ambiguous duplicate Better Auth cookies before any budget is spent", async () => {
  const identity = createLocalAuth("test");
  const p = (await identity.auth.$context).options.advanced?.cookiePrefix as string;
  try {
    const response = await handleAuth(new Request(`${origin}/api/auth/two-factor/verify-totp`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", cookie: `${p}.two_factor =REAL; ${p}.two_factor=junk-${randomUUID()}` },
      body: JSON.stringify({ code: "000000" }),
    }), identity);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "UNAUTHENTICATED");
  } finally {
    await identity.sql.end();
  }
});

test("2FA verify budget follows the account across separate sign-ins, not the per-sign-in cookie", async () => {
  const identity = createLocalAuth("test");
  const p = (await identity.auth.$context).options.advanced?.cookiePrefix as string;
  const email = `mfa-budget-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const post = (path: string, body: Record<string, unknown>, cookie = "") => handleAuth(new Request(`${origin}/api/auth${path}`, {
    method: "POST", headers: { origin, "content-type": "application/json", cookie }, body: JSON.stringify(body),
  }), identity);
  let userId = "";
  const keys = [`rl:auth-account:/api/auth/sign-in/email:${await mac(identity, "auth-account", [email])}`];
  try {
    assert.equal((await post("/sign-up/email", { name: "MFA Budget", email, password })).status, 200);
    [{ id: userId }] = await identity.sql`update app.auth_user set email_verified=true, two_factor_enabled=true where email=${email} returning id`;
    keys.push(`rl:auth-account:/api/auth/two-factor/verify-totp:${await mac(identity, "auth-account", [userId])}`);
    await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(keys)}`;
    const challenge = async () => {
      const login = await post("/sign-in/email", { email, password });
      assert.equal(login.status, 200);
      const pending = login.headers.getSetCookie().find((c) => c.startsWith(`${p}.two_factor=`));
      assert.ok(pending, "sign-in must issue a pending two-factor cookie");
      return pending.split(";")[0];
    };
    const [first, second] = [await challenge(), await challenge()];
    assert.notEqual(first, second, "Better Auth issues a fresh challenge cookie per sign-in");
    for (let i = 0; i < 5; i++) assert.notEqual((await post("/two-factor/verify-totp", { code: "000000" }, first)).status, 429);
    const blocked = await post("/two-factor/verify-totp", { code: "000000" }, second);
    assert.equal(blocked.status, 429, "a second sign-in must not reset the account's 2FA budget");
  } finally {
    await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(keys)}`;
    await identity.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await identity.sql`delete from app.local_delivery where recipient=${email}`;
    if (userId) await identity.sql`delete from app.auth_verification where value=${userId}`;
    await identity.sql`delete from app.auth_user where email=${email}`;
    await identity.sql.end();
  }
});
