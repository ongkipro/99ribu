import { actor, BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";
import { totp } from "./totp-fixture.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { canExport, canReadOrderHistory, canReadOwn, canReadWarehouse, getPrincipal, hasPermission, projectOrderSummary, roles } from "../../src/modules/access/policy.ts";

test("seven real roles and guest: public handler scopes, MFA gate and safe field projections", async () => {
  const identity = createLocalAuth("test"); const users: { id: string; email: string }[] = [];
  const malang = randomUUID(); const pontianak = randomUUID();
  try {
    await identity.sql`insert into app.warehouse (id,name,city) values (${malang},'Synthetic Malang','Malang'),(${pontianak},'Synthetic Pontianak','Pontianak')`;
    const guest = new BrowserSession(identity);
    assert.equal((await guest.access("/me")).status, 401);
    assert.equal((await guest.access("/admin/warehouses")).status, 401);
    for (const role of roles) {
      const user = await actor(identity, role, [malang]); users.push(user);
      const staff = !["buyer", "affiliate"].includes(role);
      if (staff) {
        const denied = await user.browser.access("/me"); assert.equal(denied.status, 403);
        assert.equal((await denied.json()).code, "MFA_REQUIRED");
        await enroll(user.browser, user.password);
      }
      const me = await user.browser.access("/me"); assert.equal(me.status, 200, role);
      const mixedTransport = user.browser.request("/api/v1/me");
      mixedTransport.headers.set("authorization", "Bearer synthetic-unsupported");
      const mixed = await handleAccess(mixedTransport, identity);
      assert.equal(mixed.status, 401); assert.equal((await mixed.json()).code, "UNSUPPORTED_AUTH_TRANSPORT");
      assert.deepEqual(Object.keys(await me.json()).sort(), ["id", "roles", "warehouse_ids"]);
      assert.equal(me.headers.get("cache-control"), "no-store");
      const response = await user.browser.access("/admin/warehouses");
      if (["owner", "ecommerce_admin", "warehouse"].includes(role)) {
        assert.equal(response.status, 200, role);
        let page = await response.json(); const data = [...page.data]; const seenCursors = new Set<string>();
        while (page.pagination.next_cursor) {
          const cursor = page.pagination.next_cursor as string; assert.ok(!seenCursors.has(cursor)); seenCursors.add(cursor);
          const next = await user.browser.access(`/admin/warehouses?cursor=${cursor}&limit=100`); assert.equal(next.status,200);
          page = await next.json(); data.push(...page.data);
        }
        assert.equal(new Set(data.map((row: {id: string})=>row.id)).size,data.length);
        assert.ok(data.some((row: {id: string}) => row.id === malang));
        assert.equal(data.some((row: {id: string}) => row.id === pontianak), role === "owner");
        assert.deepEqual(Object.keys(data[0]).sort(), ["active", "city", "id", "name", "timezone"]);
        assert.equal((await user.browser.access("/admin/warehouses?limit=1&limit=2")).status, 400);
      } else assert.equal(response.status, 403, role);
      const principal = await getPrincipal(user.browser.request("/api/v1/me"), identity);
      assert.equal(canReadWarehouse(principal, pontianak), role === "owner");
      assert.equal(canReadOwn(principal, "buyer", users[0].id === user.id ? "another-actor" : users[0].id), false);
      assert.equal(canReadOwn(principal, "affiliate", "another-actor"), false);
      assert.equal(hasPermission(principal, "finance.costs.read"), role === "owner");
      assert.equal(canExport(principal, "warehouse", [malang]), role === "owner");
      const forged = user.browser.request("/api/v1/admin/warehouses");
      forged.headers.set("x-role", "owner"); forged.headers.set("x-user-id", users[0].id);
      const forgedResponse = await handleAccess(forged, identity);
      assert.equal(forgedResponse.status, response.status);
      if (role === "warehouse") {
        const rows = (await forgedResponse.json()).data;
        assert.ok(rows.every((row: {id: string}) => row.id === malang));
        assert.equal(canReadOrderHistory({ ...principal, permissions: ["orders.history.read"] }, [malang]), false);
      }
      const row = { id: "order-example", number: "EXAMPLE", status: "pending", payment_status: "pending", payment_method: "cod", buyer_total: 99000, currency: "IDR" as const,
        created_at: new Date().toISOString(), version: 1, buyer_phone: "SYNTHETIC_PRIVATE", cost: 30000, bank_proof: "SYNTHETIC_PRIVATE" };
      if (role === "owner") {
        const visible = projectOrderSummary(principal, [malang, pontianak], row);
        assert.ok(!JSON.stringify(visible).includes("SYNTHETIC_PRIVATE")); assert.ok(!("cost" in visible));
      } else assert.throws(() => projectOrderSummary(principal, [pontianak], row));
      if (role === "finance") {
        await identity.sql`update app.role_grant set permissions=ARRAY['finance.summary.read','finance.costs.read','orders.history.read','exports.read','exports.download']::text[] where user_id=${user.id}`;
        const granted = await getPrincipal(user.browser.request("/api/v1/me"), identity);
        assert.equal(hasPermission(granted, "finance.costs.read"), true);
        assert.equal(hasPermission(granted, "finance.costs.write"), false);
        assert.equal(canExport(granted, "finance", [], true), true);
        assert.equal(canReadOrderHistory(granted, [malang]), true);
        assert.equal(canReadOrderHistory(granted, [malang, pontianak]), false);
        assert.ok(!("cost" in projectOrderSummary(granted, [malang], row)));
      }
      if (role === "warehouse") {
        await assert.rejects(identity.sql`update app.role_grant set permissions=ARRAY['finance.costs.write']::text[] where user_id=${user.id}`, { code: "23514" });
        const granted = { ...principal, permissions: ["exports.read", "exports.download"] as const };
        assert.equal(canExport({ ...granted, permissions: [...granted.permissions] }, "warehouse", [malang], true), true);
        assert.equal(canExport({ ...granted, permissions: [...granted.permissions] }, "warehouse", [malang, pontianak], true), false);
        assert.equal(canExport({ ...granted, permissions: [...granted.permissions] }, "orders", [malang]), false);
      }
    }
  } finally {
    await cleanup(identity, users);
    await identity.sql`delete from app.warehouse where id in (${malang},${pontianak})`;
    await identity.sql.end();
  }
});

test("reauthentication expiry, fresh factor and persistent attempt limit fail without role mutation", async () => {
  const identity = createLocalAuth("test"); const users: { id: string; email: string }[] = [];
  try {
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    const buyer = await actor(identity, "buyer", []); users.push(buyer);
    const post = (path: string, body: Record<string, unknown>) => {
      const request = owner.browser.request(`/api/v1${path}`, body); request.headers.set("idempotency-key", randomUUID());
      return handleAccess(request, identity);
    };
    const body = { password: owner.password, action: "staff_roles.replace", subject_id: buyer.id };
    const response = await post("/me/reauthentication-proofs", body); assert.equal(response.status, 201);
    const proof = (await response.json()).proof;
    await identity.sql`update app.access_proof set expires_at=now()-interval '1 second' where subject_id=${buyer.id}`;
    const rejected = await post("/admin/role-grants", { user_id: buyer.id, roles: ["finance"], permissions: [], warehouse_ids: [], expected_version: 1, reason: "Synthetic expired proof", reauthentication_proof: proof });
    assert.equal(rejected.status, 403);
    const [grant] = await identity.sql`select roles,revision from app.role_grant where user_id=${buyer.id}`;
    assert.deepEqual(grant.roles, ["buyer"]); assert.equal(grant.revision, 1);
    await identity.sql`update app.mfa_session set verified_at=now()-interval '6 minutes' where session_id in (select id from app.auth_session where user_id=${owner.id})`;
    const stale = await post("/me/reauthentication-proofs", body); assert.equal(stale.status, 403);
    assert.equal((await stale.json()).code, "FRESH_MFA_REQUIRED");
    await identity.sql`update app.mfa_session set verified_at=now() where session_id in (select id from app.auth_session where user_id=${owner.id})`;
    const statuses = await Promise.all(Array.from({ length: 6 }, async () => (await post("/me/reauthentication-proofs", { ...body, password: "incorrect-synthetic-password" })).status));
    assert.equal(statuses.filter((status) => status === 403).length, 3);
    assert.equal(statuses.filter((status) => status === 429).length, 3);
    const limited = await post("/me/reauthentication-proofs", body);
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0 && Number(limited.headers.get("retry-after")) <= 60);
  } finally { await cleanup(identity, users); await identity.sql.end(); }
});

test("owner grant replacement is scoped, single-use, versioned, atomic and replay-safe", async () => {
  const identity = createLocalAuth("test"); const users: { id: string; email: string }[] = [];
  const warehouseId = randomUUID();
  try {
    await identity.sql`insert into app.warehouse (id,name,city) values (${warehouseId},'Synthetic Grant Warehouse','Malang')`;
    const owner = await actor(identity, "owner", []); users.push(owner);
    await enroll(owner.browser, owner.password);
    const target = await actor(identity, "affiliate", []); users.push(target);
    const second = await actor(identity, "buyer", []); users.push(second);
    const post = (path: string, body: Record<string, unknown>, key: string = randomUUID()) => {
      const request = owner.browser.request(`/api/v1${path}`, body); request.headers.set("idempotency-key", key);
      return handleAccess(request, identity);
    };
    const proofBody = { password: owner.password, action: "staff_roles.replace", subject_id: target.id };
    assert.equal((await post("/me/reauthentication-proofs", { ...proofBody, password: "incorrect-synthetic-password" })).status, 403);
    for (const key of ["k".repeat(15), "k".repeat(201)]) {
      assert.equal((await post("/me/reauthentication-proofs", proofBody, key)).status, 400);
    }
    const proofKey = "k".repeat(200);
    const issued = await post("/me/reauthentication-proofs", proofBody, proofKey);
    assert.equal(issued.status, 201); const proof = await issued.json();
    const recovered = await post("/me/reauthentication-proofs", proofBody, proofKey);
    assert.equal(recovered.status, 201);
    assert.ok(JSON.stringify(await recovered.json()) === JSON.stringify(proof), "Lost proof response must recover without extending expiry");
    assert.equal((await post("/me/reauthentication-proofs", { ...proofBody, subject_id: second.id }, proofKey)).status, 409);
    const body = { user_id: target.id, roles: ["warehouse"], permissions: [], warehouse_ids: [warehouseId], expected_version: 1,
      reason: "Synthetic access test", reauthentication_proof: proof.proof };
    assert.equal((await post("/admin/role-grants", { ...body, user_id: owner.id, roles: ["owner"] })).status, 400);
    assert.equal((await post("/admin/role-grants", { ...body, permissions: ["finance.costs.write"] })).status, 403);
    assert.equal((await post("/admin/role-grants", { ...body, user_id: second.id })).status, 403);
    const firstKey = randomUUID(); const secondKey = randomUUID();
    const results = await Promise.all([post("/admin/role-grants", body, firstKey), post("/admin/role-grants", body, secondKey)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    const winningIndex = results.findIndex((result) => result.status === 201);
    const saved = await results[winningIndex].json();
    assert.deepEqual(saved.roles, ["affiliate", "warehouse"]); assert.equal(saved.version, 2);
    const retry = await post("/admin/role-grants", body, winningIndex === 0 ? firstKey : secondKey);
    assert.equal(retry.status, 201); assert.deepEqual(await retry.json(), saved);
    assert.equal((await post("/admin/role-grants", { ...body, reason: "Changed retry" }, winningIndex === 0 ? firstKey : secondKey)).status, 409);
    assert.equal((await post("/admin/role-grants", { ...body, expected_version: 2, roles: [] })).status, 403);
    assert.equal((await target.browser.access("/me")).status, 401, "Role change must revoke every subject session");
    const [audit] = await identity.sql`select count(*)::int as n from app.audit_event where actor_id=${owner.id} and subject_id=${target.id} and outcome='allowed'`;
    assert.equal(audit.n, 1);
    const [event] = await identity.sql`select id,details from app.audit_event where actor_id=${owner.id} and subject_id=${target.id} and outcome='allowed'`;
    assert.ok(!JSON.stringify(event).includes(proof.proof));
    assert.ok(!JSON.stringify(event).includes(owner.password));
    await assert.rejects(identity.sql`update app.audit_event set reason='changed' where id=${event.id}`, { code: "23514" });
    await assert.rejects(identity.sql`delete from app.audit_event where id=${event.id}`, { code: "23514" });
    const request = owner.browser.request("/api/v1/admin/role-grants", body); request.headers.set("origin", "https://evil.invalid");
    assert.equal((await handleAccess(request, identity)).status, 403);
    const buyerRequest = second.browser.request("/api/v1/admin/role-grants", body); buyerRequest.headers.set("idempotency-key", randomUUID());
    assert.equal((await handleAccess(buyerRequest, identity)).status, 403);
    const [buyerAudit] = await identity.sql`select count(*)::int as n from app.audit_event where actor_id=${second.id}`;
    assert.equal(buyerAudit.n, 0, "Unauthorized buyer traffic cannot fill immutable audit storage");
    const [count] = await identity.sql`select count(*)::int as n from app.access_proof where session_id in (select id from app.auth_session where user_id=${owner.id})`;
    assert.equal(count.n, 1);
  } finally {
    await cleanup(identity, users);
    await identity.sql`delete from app.warehouse where id=${warehouseId}`;
    await identity.sql.end();
  }
});

test("staff MFA belongs to the exact session; invalid factor and recovery replay never grant authority", async () => {
  const identity = createLocalAuth("test"); const users: { id: string; email: string }[] = [];
  try {
    const user = await actor(identity, "owner", []); users.push(user);
    const old = new BrowserSession(identity);
    assert.equal((await old.auth("/sign-in/email", { email: user.email, password: user.password })).status, 200);
    const setup = await enroll(user.browser, user.password);
    assert.equal((await user.browser.access("/me")).status, 200);
    assert.equal((await old.access("/me")).status, 403);
    assert.equal((await old.auth("/two-factor/enable", { password: user.password })).status, 409);
    assert.equal((await user.browser.auth("/two-factor/disable", { password: user.password })).status, 404);
    const next = new BrowserSession(identity);
    const login = await next.auth("/sign-in/email", { email: user.email, password: user.password });
    assert.equal(login.status, 200); assert.equal((await login.json()).twoFactorRedirect, true);
    assert.equal((await next.access("/me")).status, 401);
    assert.equal((await next.auth("/two-factor/verify-totp", { code: "not-a-code" })).status, 401);
    assert.equal((await next.access("/me")).status, 401);
    assert.equal((await next.auth("/two-factor/verify-totp", { code: totp(setup.totpURI), trustDevice: true })).status, 400);
    const recovered = await next.auth("/two-factor/verify-backup-code", { code: setup.backupCodes[0] });
    assert.equal(recovered.status, 200); assert.ok(!("token" in await recovered.json()));
    assert.equal((await next.access("/me")).status, 200);
    const replay = await next.auth("/two-factor/verify-backup-code", { code: setup.backupCodes[0] });
    assert.equal(replay.status, 401);
    await identity.sql`update app.role_grant set roles=ARRAY['buyer']::text[] where user_id=${user.id}`;
    assert.equal((await next.access("/admin/warehouses")).status, 403);
    assert.equal((await next.auth("/sign-out", {})).status, 200);
    assert.equal((await next.access("/me")).status, 401);
    const [proof] = await identity.sql`select count(*)::int as n from app.mfa_session m join app.auth_session s on s.id=m.session_id where s.user_id=${user.id}`;
    assert.equal(proof.n, 1); // Only the separate enrolled session remains.
  } finally { await cleanup(identity, users); await identity.sql.end(); }
});

test("grant commit serializes against independent owner demotion and session deletion", async () => {
  const identity = createLocalAuth("test"); const users: { id: string; email: string }[] = [];
  async function waitForLock(name?: string) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const [row] = await identity.sql`select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid()
        and wait_event_type='Lock' and (${name ?? null}::text is null and query like '%update app.access_proof set consumed_at%'
          or application_name=${name ?? null})) as waiting`;
      if (row.waiting) return;
      await setTimeout(20);
    }
    assert.fail("Expected competing access transaction to wait on the database lock");
  }
  try {
    for (const revoke of ["role", "session"]) {
      const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
      const buyer = await actor(identity, "buyer", []); users.push(buyer);
      const principal = await getPrincipal(owner.browser.request("/api/v1/me"), identity);
      const request = owner.browser.request("/api/v1/me/reauthentication-proofs", { password: owner.password, action: "staff_roles.replace", subject_id: buyer.id });
      request.headers.set("idempotency-key", randomUUID());
      const issued = await handleAccess(request, identity); assert.equal(issued.status, 201);
      const proof = (await issued.json()).proof;
      const locked = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
      const hold = identity.sql.begin(async (tx) => {
        await tx`select digest from app.access_proof where subject_id=${buyer.id} for update`;
        locked.resolve(); await release.promise;
      });
      await locked.promise;
      let mutation: Promise<Response> | undefined; let revocation: Promise<unknown> | undefined;
      try {
        const grantRequest = owner.browser.request("/api/v1/admin/role-grants", { user_id: buyer.id, roles: ["finance"], permissions: [], warehouse_ids: [], expected_version: 1, reason: "Synthetic revocation race", reauthentication_proof: proof });
        grantRequest.headers.set("idempotency-key", randomUUID());
        mutation = handleAccess(grantRequest, identity);
        await waitForLock(); // Mutation has passed authorization and is waiting to consume its proof.
        const marker = `s09-revoke-${randomUUID()}`;
        let revoked = false;
        revocation = identity.sql.begin(async (tx) => {
          await tx`select set_config('application_name',${marker},true)`;
          if (revoke === "role") await tx`update app.role_grant set roles=ARRAY['buyer']::text[] where user_id=${owner.id}`;
          else await tx`delete from app.auth_session where id=${principal.sessionId}`;
          revoked = true;
        });
        await waitForLock(marker);
        assert.equal(revoked, false, "Revocation cannot commit between authorization and the privileged write");
        release.resolve(); await hold;
        assert.equal((await mutation).status, 201);
        await revocation;
        const denied = await owner.browser.access("/admin/warehouses");
        assert.equal(denied.status, revoke === "role" ? 403 : 401);
      } finally {
        release.resolve(); await hold;
        await Promise.allSettled([mutation, revocation].filter((value) => value !== undefined));
      }
    }
  } finally { await cleanup(identity, users); await identity.sql.end(); }
});

test("reviewed proof purposes: recovery-refund and payout proofs are issuable only to their authority; self purposes bind the caller", async () => {
  const identity = createLocalAuth("test"); const users: { id: string; email: string }[] = [];
  try {
    const refunds = await actor(identity, "finance", []); users.push(refunds); await enroll(refunds.browser, refunds.password);
    const plainFinance = await actor(identity, "finance", []); users.push(plainFinance); await enroll(plainFinance.browser, plainFinance.password);
    const warehouse = await actor(identity, "warehouse", []); users.push(warehouse); await enroll(warehouse.browser, warehouse.password);
    const buyer = await actor(identity, "buyer", []); users.push(buyer);
    const other = await actor(identity, "buyer", []); users.push(other);
    await identity.sql`update app.role_grant set permissions=${["finance.refunds.read", "finance.refunds.write"]} where user_id=${refunds.id}`;
    const issue = async (who: typeof buyer, action: string, subjectId: string, password = who.password) => {
      const request = who.browser.request("/api/v1/me/reauthentication-proofs", { password, action, subject_id: subjectId });
      request.headers.set("idempotency-key", randomUUID());
      const response = await handleAccess(request, identity);
      return { status: response.status, code: (await response.json()).code as string | undefined };
    };
    const subject = randomUUID();
    assert.equal((await issue(refunds, "finance.recovery_refund", subject.toUpperCase())).status, 201, "recovery refund proof was previously unissuable");
    const [stored] = await identity.sql`select action,subject_id from app.access_proof where subject_id=${subject}`;
    assert.deepEqual({ ...stored }, { action: "finance.recovery_refund", subject_id: subject }, "UUID subject canonicalized");
    assert.equal((await issue(plainFinance, "finance.recovery_refund", subject)).status, 403, "refund grants required");
    assert.equal((await issue(plainFinance, "payout.claim", subject)).status, 201, "finance role may claim payouts");
    assert.equal((await issue(plainFinance, "payout.verify", "not-a-uuid")).status, 400);
    assert.equal((await issue(warehouse, "payout.claim", subject)).status, 403);
    assert.equal((await issue(buyer, "payout.claim", subject)).status, 403);
    assert.equal((await issue(buyer, "affiliate.beneficiary_change", subject)).status, 403, "affiliate role required");
    assert.equal((await issue(buyer, "support.contact_rebind", other.id)).status, 403, "only the caller's own identity");
    assert.deepEqual(await issue(buyer, "support.contact_rebind", buyer.id, "incorrect-synthetic-password"), { status: 403, code: "REAUTHENTICATION_REQUIRED" });
    assert.equal((await issue(buyer, "support.contact_rebind", buyer.id)).status, 201, "buyer reauthenticates by password without MFA");
  } finally { await cleanup(identity, users); await identity.sql.end(); }
});
