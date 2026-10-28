import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { actor, BrowserSession, cleanup, enroll } from "./access-fixture.ts";
import { type Exchange, validateExchanges } from "./openapi-probe.ts";

test("implemented API exchanges conform to OAS for success, request boundaries, denial and recovery", async () => {
  const identity = createLocalAuth("test"); const users: { id: string; email: string }[] = [];
  const warehouses = Array.from({ length: 21 }, () => randomUUID()).sort();
  const samples: Exchange[] = [];
  const observe = async (request: Request, status: number, requestValid?: boolean) => {
    const raw = request.body ? await request.clone().text() : undefined;
    const response = await handleAccess(request, identity);
    assert.equal(response.status, status, `${request.method} ${new URL(request.url).pathname}`);
    const payload = await response.json();
    samples.push({ url: request.url, method: request.method,
      request_headers: Object.fromEntries([...request.headers].filter(([key]) => ["content-type", "idempotency-key"].includes(key))),
      request_body: raw, body_bytes: raw === undefined ? undefined : Buffer.byteLength(raw), request_valid: requestValid,
      status: response.status, headers: Object.fromEntries(response.headers), payload });
    return payload;
  };
  try {
    for (const id of warehouses) await identity.sql`insert into app.warehouse (id,name,city) values (${id},'Synthetic Contract Warehouse','Malang')`;
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    const buyer = await actor(identity, "buyer", []); users.push(buyer);
    const guest = new BrowserSession(identity);
    const post = (path: string, body: Record<string, unknown>, key: string = randomUUID()) => {
      const request = owner.browser.request(`/api/v1${path}`, body); request.headers.set("idempotency-key", key); return request;
    };
    const proofBody = { password: owner.password, action: "staff_roles.replace", subject_id: buyer.id };
    await observe(owner.browser.request("/api/v1/me"), 200, true);
    for (const path of ["/me", "/admin/warehouses", "/me/reauthentication-proofs", "/admin/role-grants"]) {
      await observe(guest.request(`/api/v1${path}`, path.includes("proofs") || path.includes("grants") ? {} : undefined), 401);
      for (const name of ["authorization", "x-cart-token", "x-order-token"]) {
        const request = owner.browser.request(`/api/v1${path}`, path.includes("proofs") || path.includes("grants") ? {} : undefined);
        request.headers.set(name, "synthetic-unsupported");
        assert.equal((await observe(request, 401)).code, "UNSUPPORTED_AUTH_TRANSPORT");
      }
    }
    const first = await observe(owner.browser.request("/api/v1/admin/warehouses"), 200, true);
    assert.equal(first.data.length, 20); assert.equal(typeof first.pagination.next_cursor, "string");
    const data = [...first.data]; let cursor = first.pagination.next_cursor; const seenCursors = new Set<string>();
    while (cursor) {
      assert.ok(!seenCursors.has(cursor)); seenCursors.add(cursor);
      const next = await observe(owner.browser.request(`/api/v1/admin/warehouses?cursor=${cursor}&limit=100`), 200, true);
      data.push(...next.data); cursor = next.pagination.next_cursor;
    }
    const ids = data.map((row: { id: string }) => row.id);
    assert.ok(warehouses.every((id) => ids.includes(id))); assert.equal(new Set(ids).size, ids.length);
    for (const query of ["limit=0", "limit=101", "limit=1&limit=2", "sort=secret", "cursor=bad", "cursor="]) {
      await observe(owner.browser.request(`/api/v1/admin/warehouses?${query}`), 400, false);
    }
    await observe(owner.browser.request("/api/v1/me?unused=1"), 400, false);
    await observe(buyer.browser.request("/api/v1/admin/warehouses"), 403);
    const one = `/api/v1/admin/warehouses/${warehouses[0]}`;
    assert.equal((await observe(owner.browser.request(one), 200, true)).id, warehouses[0]);
    await observe(guest.request(one), 401);
    await observe(buyer.browser.request(one), 403);
    await observe(owner.browser.request(`${one}?unused=1`), 400, false);
    await observe(owner.browser.request("/api/v1/admin/warehouses/not-a-uuid"), 400);
    await observe(owner.browser.request(`/api/v1/admin/warehouses/${randomUUID()}`), 404);
    for (const key of ["k".repeat(15), "k".repeat(201), "invalid.period.key"]) {
      await observe(post("/me/reauthentication-proofs", proofBody, key), 400, false);
    }
    await observe(post("/me/reauthentication-proofs?unused=1", proofBody), 400, false);
    for (const body of [{ ...proofBody, extra: true }, { ...proofBody, subject_id: "space forbidden" }]) {
      await observe(post("/me/reauthentication-proofs", body), 400, false);
    }
    for (const media of ["text/plain", "application/jsonp"]) {
      const request = post("/me/reauthentication-proofs", proofBody); request.headers.set("content-type", media);
      await observe(request, 415, false);
    }
    const oversized = post("/me/reauthentication-proofs", { ...proofBody, password: "x".repeat(16385) });
    await observe(oversized, 413, false);
    const forgedOrigin = post("/me/reauthentication-proofs", proofBody); forgedOrigin.headers.set("origin", "https://evil.invalid");
    await observe(forgedOrigin, 403);
    const proofKey = "a".repeat(16);
    const validProofRequest = post("/me/reauthentication-proofs", proofBody, proofKey);
    validProofRequest.headers.set("content-type", "Application/JSON; charset=utf-8");
    const proof = await observe(validProofRequest, 201, true);
    const recovered = await observe(post("/me/reauthentication-proofs", proofBody, proofKey), 201, true);
    assert.ok(JSON.stringify(proof) === JSON.stringify(recovered), "Proof retry preserves value and expiry");
    const body = { user_id: buyer.id, roles: ["warehouse"], warehouse_ids: [warehouses[0]], permissions: [], expected_version: 1, reason: "Synthetic contract grant", reauthentication_proof: proof.proof };
    for (const invalid of [{ ...body, reason: " " }, { ...body, reason: "x".repeat(501) }, { ...body, reauthentication_proof: "" }, { ...body, roles: ["warehouse", "warehouse"] }, { ...body, warehouse_ids: ["bad"] }, { ...body, expected_version: 9007199254740992 }]) {
      await observe(post("/admin/role-grants", invalid), 400, false);
    }
    const key = "z".repeat(200);
    const granted = await observe(post("/admin/role-grants", body, key), 201, true);
    const replay = await observe(post("/admin/role-grants", body, key), 201, true); assert.deepEqual(replay, granted);
    await observe(post("/admin/role-grants", { ...body, reason: "Different request" }, key), 409, true);
    await observe(post("/admin/role-grants", { ...body, expected_version: 2 }), 403, true);
    for (let i = 0; i < 3; i++) await observe(post("/me/reauthentication-proofs", { ...proofBody, password: "synthetic-wrong-password" }), 403, true);
    await observe(post("/me/reauthentication-proofs", proofBody), 429, true);
    // Scope is evaluated anew even when an owner cursor is supplied by another role.
    await identity.sql`insert into app.role_grant (user_id,roles) values (${owner.id},ARRAY['warehouse']::text[]) on conflict (user_id) do update set roles=excluded.roles`;
    const scoped = await observe(owner.browser.request(`/api/v1/admin/warehouses?cursor=${first.pagination.next_cursor}`), 200, true);
    assert.deepEqual(scoped.data, []);
    // The by-id read applies the same live scope: a warehouse role without membership gets a 404, not the row.
    await observe(owner.browser.request(`/api/v1/admin/warehouses/${warehouses[0]}`), 404);
    await identity.sql.end();
    const unavailable = await observe(owner.browser.request("/api/v1/me"), 503);
    assert.equal(unavailable.code, "SERVICE_UNAVAILABLE");
    validateExchanges(samples);
  } finally {
    await identity.sql.end();
    const cleanupIdentity = createLocalAuth("test");
    try {
      await cleanup(cleanupIdentity, users);
      await cleanupIdentity.sql`delete from app.warehouse where id in ${cleanupIdentity.sql(warehouses)}`;
    } finally { await cleanupIdentity.sql.end(); }
  }
});
