import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import test, { after } from "node:test";
import { createLocalAuth, type LocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { roles } from "../../src/modules/access/policy.ts";
import { resolvePolicy } from "../../src/modules/settings/policies.ts";
import { actor, BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";

const path = "/api/v1/admin/policy-versions";
const commercial = { default_commission_bps: 1000, minimum_payout_idr: 99000 };
type Actor = Awaited<ReturnType<typeof actor>>;
async function proof(identity: LocalAuth, user: Actor, action = "company_policy.version", subjectId = "company-commercial", key: string = randomUUID()) {
  const request = user.browser.request("/api/v1/me/reauthentication-proofs", { password: user.password, action, subject_id: subjectId });
  request.headers.set("idempotency-key", key);
  const response = await handleAccess(request, identity); assert.equal(response.status, 201);
  return (await response.json()).proof as string;
}
function post(user: Actor, body: Record<string, unknown>, key: string = randomUUID()) {
  const request = user.browser.request(path, body); request.headers.set("idempotency-key", key); return request;
}
async function history(user: Actor, query = "kind=commercial") {
  const response = await user.browser.access(`/admin/policy-versions?${query}`); assert.equal(response.status, 200); return response.json();
}
function later(current: { data: { effective_at: string }[] }, extra = 1000) {
  return new Date(Math.max(Date.now() + extra, Date.parse(current.data[0]?.effective_at ?? "1970-01-01T00:00:00.000Z") + extra)).toISOString();
}

// Commercial versions are immutable and cannot be withdrawn, and every activation invalidates
// publications made under the previous version. Hold the file open until each scheduled company
// version is current so no later suite sees a mid-run policy switch (PUBLICATION_REVIEW_REQUIRED).
after(async () => {
  const identity = createLocalAuth("test");
  try {
    for (;;) {
      const [pending] = await identity.sql`select extract(epoch from max(v.effective_at)-clock_timestamp())*1000 as ms
        from app.policy_version v join app.policy_head h on h.id=v.head_id where h.kind='commercial' and h.warehouse_id is null`;
      const ms = Number(pending?.ms ?? 0); if (!(ms > 0)) break;
      assert.ok(ms <= 30000, `Commercial policy scheduled ${Math.round(ms)}ms ahead would leak into later suites`);
      await setTimeout(Math.ceil(ms) + 50);
    }
  } finally { await identity.sql.end(); }
});

test("policy API owner/MFA, request/response contract, strict transport and field boundaries", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = []; const samples: Exchange[] = [];
  const observe = async (request: Request, expected: number, requestValid?: boolean) => {
    const body = request.body ? await request.clone().text() : undefined;
    const response = await handleAccess(request, identity); assert.equal(response.status, expected);
    const payload = await response.json();
    samples.push({ url: request.url, method: request.method, request_headers: Object.fromEntries([...request.headers].filter(([key]) => ["idempotency-key", "content-type"].includes(key))),
      request_body: body, body_bytes: body ? Buffer.byteLength(body) : undefined, request_valid: requestValid,
      status: response.status, headers: Object.fromEntries(response.headers), payload });
    return payload;
  };
  try {
    const guest = new BrowserSession(identity);
    await observe(guest.request(`${path}?kind=commercial`), 401);
    await observe(guest.request(path, {}), 401);
    const owner = await actor(identity, "owner", []); users.push(owner);
    await observe(owner.browser.request(`${path}?kind=commercial`), 403);
    await enroll(owner.browser, owner.password);
    for (const role of roles.filter((r) => r !== "owner")) {
      const user = await actor(identity, role, []); users.push(user);
      if (!["buyer", "affiliate"].includes(role)) await enroll(user.browser, user.password);
      await observe(user.browser.request(`${path}?kind=commercial`), 403);
      await observe(user.browser.request(path, {}), 403);
    }
    let state = await observe(owner.browser.request(`${path}?kind=commercial`), 200, true);
    if(state.latest_version===0){
      await observe(post(owner,{kind:'commercial',warehouse_id:null,effective_at:null,values:commercial,expected_version:0,reason:'Synthetic explicit current baseline',reauthentication_proof:await proof(identity,owner)}),201,true);
      state=await observe(owner.browser.request(`${path}?kind=commercial`),200,true);
    }
    const reauthenticationProof = await proof(identity, owner);
    const body = { kind: "commercial", warehouse_id: null, effective_at: later(state), values: commercial,
      expected_version: state.latest_version, reason: "Synthetic policy contract", reauthentication_proof: reauthenticationProof };
    for (const value of [{ ...body, values: { ...commercial, price_idr: 1 } }, { ...body, values: { ...commercial, default_commission_bps: 10001 } },
      ...[-1,99001,1.5].map((minimum_contribution_idr)=>({...body,values:{...commercial,minimum_contribution_idr}})),
      { ...body, reason: "\uFEFF" }, { ...body, reason: "x".repeat(501) }, { ...body, warehouse_id: randomUUID() }, { ...body, effective_at: "2026-02-30T00:00:00.000Z" }]) await observe(post(owner, value), 400, false);
    for (const query of ["kind=commercial&limit=1&limit=2", "kind=commercial&unknown=1", "kind=commercial&limit=0", "kind=commercial&cursor=2147483648"]) await observe(owner.browser.request(`${path}?${query}`), 400, false);
    for (const header of ["authorization", "x-cart-token", "x-order-token"]) {
      const request = owner.browser.request(`${path}?kind=commercial`); request.headers.set(header, "synthetic-unsupported");
      assert.equal((await observe(request, 401)).code, "UNSUPPORTED_AUTH_TRANSPORT");
    }
    const oversized = post(owner, { ...body, reason: "x".repeat(16385) }); await observe(oversized, 413, false);
    const media = post(owner, body); media.headers.set("content-type", "text/plain"); await observe(media, 415, false);
    const key = randomUUID(); const saved = await observe(post(owner, body, key), 201, true);
    const retried = await observe(post(owner, body, key), 201, true); assert.deepEqual(retried, saved);
    await observe(post(owner, { ...body, reason: "Different intent" }, key), 409, true);
    await observe(post(owner, { ...body, expected_version: saved.version }), 403, true);
    const page = await observe(owner.browser.request(`${path}?kind=commercial&limit=1`), 200, true);
    if (page.pagination.next_cursor) await observe(owner.browser.request(`${path}?kind=commercial&cursor=${page.pagination.next_cursor}`), 200, true);
    validateExchanges(samples, "settings");
  } finally { await cleanup(identity, users); await identity.sql.end(); }
});

test("concurrent policy append has one winner; prior immutable version resolves before future activation", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = [];
  try {
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    const peer = await actor(identity, "owner", []); users.push(peer); await enroll(peer.browser, peer.password);
    const state = await history(owner);
    const firstBody = { kind: "commercial", warehouse_id: null, effective_at: later(state, 10000), values: commercial,
      expected_version: state.latest_version, reason: "Synthetic baseline policy", reauthentication_proof: await proof(identity, owner) };
    const tooDistant = await handleAccess(post(owner, { ...firstBody, effective_at: "2062-01-01T00:00:00.000Z" }), identity);
    assert.equal(tooDistant.status, 400); assert.equal((await tooDistant.json()).code, "POLICY_SCHEDULE_TOO_DISTANT");
    const [unused] = await identity.sql`select consumed_at from app.access_proof where digest=${createHash("sha256").update(firstBody.reauthentication_proof).digest("hex")}`;
    assert.equal(unused.consumed_at, null); assert.equal((await history(owner)).latest_version, state.latest_version);
    const firstResponse = await handleAccess(post(owner, firstBody), identity); assert.equal(firstResponse.status, 201); const first = await firstResponse.json();
    const leftProof = await proof(identity, owner); const rightProof = await proof(identity, peer);
    const reversed = await handleAccess(post(owner, { ...firstBody, effective_at: null, expected_version: first.version, reauthentication_proof: leftProof }), identity);
    assert.equal(reversed.status, 409); assert.equal((await reversed.json()).code, "SCHEDULE_CONFLICT");
    const [unconsumed] = await identity.sql`select consumed_at from app.access_proof where digest=${createHash("sha256").update(leftProof).digest("hex")}`;
    assert.equal(unconsumed.consumed_at, null);
    const scheduled = await history(owner); assert.equal(scheduled.latest_version, first.version);
    assert.notEqual(scheduled.current?.id, first.id);

    const nextAt = new Date(Date.parse(first.effective_at) + 1000).toISOString();
    const body = { ...firstBody, effective_at: nextAt, expected_version: first.version, values: { ...commercial, default_commission_bps: 700, minimum_contribution_idr:12345 } };
    const results = await Promise.all([handleAccess(post(owner, { ...body, reauthentication_proof: leftProof }), identity), handleAccess(post(peer, { ...body, reauthentication_proof: rightProof }), identity)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const second = await results.find((r) => r.status === 201)?.json(); assert.equal(second.version, first.version + 1);
    const oldSnapshot = await resolvePolicy(identity.sql, "commercial", null, new Date(Date.parse(first.effective_at) + 1));
    const newSnapshot = await resolvePolicy(identity.sql, "commercial", null, new Date(nextAt));
    assert.ok('default_commission_bps' in oldSnapshot.values&&'default_commission_bps' in newSnapshot.values);
    assert.equal(oldSnapshot.id, first.id); assert.equal(oldSnapshot.values.default_commission_bps, 1000);
    assert.equal(newSnapshot.id, second.id); assert.equal(newSnapshot.values.default_commission_bps, 700);
    assert.equal(oldSnapshot.values.minimum_contribution_idr,undefined);assert.equal(newSnapshot.values.minimum_contribution_idr,12345);
    const [stored] = await identity.sql`select "values",head_id from app.policy_version where id=${first.id}`;
    assert.equal(stored.values.default_commission_bps, 1000);
    await assert.rejects(identity.sql`update app.policy_version set reason='rewrite' where id=${first.id}`, { code: "23514" });
    await assert.rejects(identity.sql`delete from app.policy_version where id=${first.id}`, { code: "23514" });
    await assert.rejects(identity.sql`update app.policy_head set kind='warehouse_calendar' where id=${stored.head_id}`, { code: "23514" });
    const [audit] = await identity.sql`select count(*)::int as n from app.audit_event where actor_id in (${owner.id},${peer.id}) and action='company_policy.version' and outcome='allowed'`;
    assert.equal(audit.n, 2);
  } finally { await cleanup(identity, users); await identity.sql.end(); }
});

test("calendar snapshots remain TEST-ONLY, warehouse/purpose-bound and resistant to retroactive activation", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = []; const warehouseId = randomUUID();
  try {
    await identity.sql`insert into app.warehouse (id,name,city) values (${warehouseId},'Synthetic Policy Calendar','Malang')`;
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    const year = new Date().getUTCFullYear();
    const values = { timezone: "Asia/Jakarta", year, working_weekdays: [1, 2, 3, 4, 5, 6], cutoff_local: "15:00", closed_dates: [`${year}-01-01`], source: "TEST-ONLY", approval: "test_only" };
    const companyKey = randomUUID();
    const companyProof = await proof(identity, owner, "company_policy.version", "company-commercial", companyKey);
    const changedPurpose = owner.browser.request("/api/v1/me/reauthentication-proofs", { password: owner.password, action: "warehouse_calendar.version", subject_id: warehouseId });
    changedPurpose.headers.set("idempotency-key", companyKey);
    assert.equal((await handleAccess(changedPurpose, identity)).status, 409);
    const body = { kind: "warehouse_calendar", warehouse_id: warehouseId, effective_at: null, values, expected_version: 0,
      reason: "Synthetic calendar only", reauthentication_proof: companyProof };
    assert.equal((await handleAccess(post(owner, body), identity)).status, 403);
    const calendarProof = await proof(identity, owner, "warehouse_calendar.version", warehouseId.toUpperCase());
    assert.equal((await handleAccess(post(owner, { ...body, values: { ...values, approval: "approved" }, reauthentication_proof: calendarProof }), identity)).status, 400);
    assert.equal((await handleAccess(post(owner, { ...body, values: { ...values, closed_dates: [`${year}-02-30`] }, reauthentication_proof: calendarProof }), identity)).status, 400);
    assert.equal((await handleAccess(post(owner, { ...body, values: { ...values, timezone: "Asia/Makassar" }, reauthentication_proof: calendarProof }), identity)).status, 400);
    const savedResponse = await handleAccess(post(owner, { ...body, reauthentication_proof: calendarProof }), identity); assert.equal(savedResponse.status, 201); const saved = await savedResponse.json();
    const snapshot = await resolvePolicy(identity.sql, "warehouse_calendar", warehouseId, new Date()); assert.equal(snapshot.id, saved.id);
    assert.equal(snapshot.values.approval, "test_only"); assert.deepEqual(snapshot.values.closed_dates, [`${year}-01-01`]);
    const nextProof = await proof(identity, owner, "warehouse_calendar.version", warehouseId);
    const historical = { ...body, expected_version: saved.version, effective_at: "2020-01-01T00:00:00.000Z", reauthentication_proof: nextProof };
    assert.equal((await handleAccess(post(owner, historical), identity)).status, 400);
    const [unused] = await identity.sql`select consumed_at from app.access_proof where digest=${createHash('sha256').update(nextProof).digest('hex')}`;
    assert.equal(unused.consumed_at, null);
    const future = new Date(Date.now() + 1000).toISOString();
    const next = await handleAccess(post(owner, { ...historical, effective_at: future, values: { ...values, cutoff_local: "14:00" } }), identity);
    assert.equal(next.status, 201);
    const old = await resolvePolicy(identity.sql, "warehouse_calendar", warehouseId, new Date(saved.effective_at)); assert.equal(old.values.cutoff_local, "15:00");
    await identity.sql`update app.warehouse set active=false where id=${warehouseId}`;
    const archived = await history(owner, `kind=warehouse_calendar&warehouse_id=${warehouseId}`);
    assert.equal(archived.latest_version, saved.version + 1); assert.equal(archived.data.length, 2);
    const archivedProof = await proof(identity, owner, "warehouse_calendar.version", warehouseId);
    const blocked = await handleAccess(post(owner, { ...body, expected_version: archived.latest_version, reauthentication_proof: archivedProof }), identity);
    assert.equal(blocked.status, 400); assert.equal((await blocked.json()).code, "INVALID_WAREHOUSE_SCOPE");

  } finally {
    await cleanup(identity, users);
    // Retain the immutable calendar's warehouse reference; archive only this synthetic fixture.
    await identity.sql`update app.warehouse set active=false where id=${warehouseId}`;
    await identity.sql.end();
  }
});

test("proof expiring during a database lock wait rolls back consumption and policy mutation", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = [];
  try {
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    const state = await history(owner); const token = await proof(identity, owner); const digest = createHash("sha256").update(token).digest("hex");
    let release: () => void = () => {}; const held = new Promise<void>((resolve) => { release = resolve; });
    let ready: () => void = () => {}; const locked = new Promise<void>((resolve) => { ready = resolve; });
    let pid = 0; let mutation: Promise<Response> | undefined;
    const blocker = identity.sql.begin(async (tx) => {
      await tx`select digest from app.access_proof where digest=${digest} for update`; ready(); await held;
      await tx`update app.access_proof set expires_at=(select xact_start+interval '1 microsecond' from pg_stat_activity where pid=${pid}) where digest=${digest}`;
    });
    try {
      await locked;
      mutation = handleAccess(post(owner, { kind: "commercial", warehouse_id: null, effective_at: later(state), values: commercial,
        expected_version: state.latest_version, reason: "Synthetic expired lock proof", reauthentication_proof: token }), identity);
      for (let i = 0; i < 100; i++) {
        const [waiting] = await identity.sql`select pid,clock_timestamp()>xact_start+interval '1 microsecond' as elapsed from pg_stat_activity
          where datname='99ribu_test' and usename='99ribu_test_app' and wait_event_type='Lock' and query like '%update app.access_proof set consumed_at%' limit 1`;
        if (waiting) { pid = waiting.pid; assert.equal(waiting.elapsed, true); break; }
        await setTimeout(20);
      }
      assert.ok(pid, "Mutation must actually wait to consume the proof"); release(); await blocker;
      assert.equal((await mutation).status, 403);
      const after = await history(owner); assert.equal(after.latest_version, state.latest_version);
      const [stored] = await identity.sql`select consumed_at from app.access_proof where digest=${digest}`; assert.equal(stored.consumed_at, null);
    } finally { release(); await Promise.allSettled([blocker, mutation].filter((value) => value !== undefined)); }
  } finally { await cleanup(identity, users); await identity.sql.end(); }
});
