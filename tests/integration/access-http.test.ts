import {resetBrowserAuthLimits} from './storefront-http-fixture.ts';
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { chromium } from "@playwright/test";
import { connectDatabase } from "../../src/db/client.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";
import { totp } from "./totp-fixture.ts";
import { activateOverHttp } from "./http-activation.ts";

test("built access routes require actual browser MFA cookie and project assigned warehouses", async () => {
 await resetBrowserAuthLimits();
  const connection = connectDatabase("local");
  const email = `access-browser-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url");
  const warehouseId = randomUUID(); const subjectId = randomUUID(); let userId = "";
  const samples: Exchange[] = [];
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    const context = await browser.newContext(); const page = await context.newPage();
    const response = await page.goto("http://127.0.0.1:3099"); assert.equal(response?.status(), 200);
    const call = async (path: string, body?: Record<string, unknown>, extraHeaders: Record<string, string> = {}) => {
      const result = await page.evaluate(async ({ path, body, extraHeaders }) => {
        const response = await fetch(path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, payload: await response.json(), cache: response.headers.get("cache-control"), headers: Object.fromEntries(response.headers) };
      }, { path, body, extraHeaders });
      if (path.startsWith("/api/v1/")) samples.push({ url: `http://127.0.0.1:3099${path}`, method: body ? "POST" : "GET",
        request_headers: { "content-type": "application/json", ...extraHeaders }, request_body: body ? JSON.stringify(body) : undefined,
        body_bytes: body ? Buffer.byteLength(JSON.stringify(body)) : undefined, ...result });
      return result;
    };
    assert.equal((await call("/api/v1/me")).status, 401);
    assert.equal((await call("/api/auth/sign-up/email", { name: "Synthetic MFA", email })).status, 200);
    const [user] = await connection.sql`select id from app.auth_user where email=${email}`; userId = user.id;
    await activateOverHttp(connection.sql, context.request, email, password);
    await connection.sql`insert into app.warehouse (id,name,city) values (${warehouseId},'Synthetic Browser Warehouse','Malang')`;
    await connection.sql`insert into app.role_grant (user_id,roles) values (${userId},ARRAY['warehouse']::text[])`;
    await connection.sql`insert into app.warehouse_membership (user_id,warehouse_id) values (${userId},${warehouseId})`;
    assert.equal((await call("/api/auth/sign-in/email", { email, password })).status, 200);
    const denied = await call("/api/v1/admin/warehouses"); assert.equal(denied.status, 403); assert.equal(denied.payload.code, "MFA_REQUIRED");
    const setup = await call("/api/auth/two-factor/enable", { password }); assert.equal(setup.status, 200);
    const verified = await call("/api/auth/two-factor/verify-totp", { code: totp(setup.payload.totpURI) });
    assert.equal(verified.status, 200); assert.ok(!("token" in verified.payload));
    const me = await call("/api/v1/me"); assert.equal(me.status, 200); assert.equal(me.cache, "no-store");
    assert.deepEqual(me.payload.warehouse_ids, [warehouseId]);
    const list = await call("/api/v1/admin/warehouses"); assert.equal(list.status, 200);
    assert.deepEqual(list.payload.data.map((row: {id: string}) => row.id), [warehouseId]);
    assert.ok(!(await page.evaluate(() => document.cookie)).includes("session_token"));
    for (const header of ["authorization", "x-cart-token", "x-order-token"]) {
      assert.equal((await call("/api/v1/me", undefined, { [header]: "synthetic-unsupported" })).status, 401);
    }
    assert.equal((await call("/api/v1/admin/warehouses?limit=1&limit=2")).status, 400);
    assert.equal((await call("/api/v1/me/reauthentication-proofs", {})).status, 403);
    assert.equal((await call("/api/v1/admin/role-grants", {})).status, 403);
    await connection.sql`update app.role_grant set roles=ARRAY['owner']::text[] where user_id=${userId}`;
    await connection.sql`insert into app.auth_user (id,name,email,email_verified) values (${subjectId},'Synthetic Grant Subject',${`subject-${subjectId}@example.invalid`},true)`;
    const proofBody = { password, action: "staff_roles.replace", subject_id: subjectId };
    const proof = await call("/api/v1/me/reauthentication-proofs", proofBody, { "idempotency-key": randomUUID() });
    assert.equal(proof.status, 201);
    const grantBody = { user_id: subjectId, roles: ["warehouse"], permissions: [], warehouse_ids: [warehouseId], expected_version: 0,
      reason: "Synthetic browser contract grant", reauthentication_proof: proof.payload.proof };
    const grantKey = randomUUID();
    const grant = await call("/api/v1/admin/role-grants", grantBody, { "idempotency-key": grantKey });
    assert.equal(grant.status, 201);
    const replay = await call("/api/v1/admin/role-grants", grantBody, { "idempotency-key": grantKey });
    assert.deepEqual(replay.payload, grant.payload);
    assert.equal((await call("/api/v1/admin/role-grants", { ...grantBody, reason: "Different retry" }, { "idempotency-key": grantKey })).status, 409);

    const forged = await context.request.post("http://127.0.0.1:3099/api/v1/admin/role-grants", { headers: { origin: "https://evil.invalid" }, data: {} });
    assert.equal(forged.status(), 403);
    assert.equal((await call("/api/auth/sign-out", {})).status, 200);
    assert.equal((await call("/api/v1/admin/warehouses")).status, 401);
    validateExchanges(samples);
  } finally {
    await browser.close();
    await connection.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await connection.sql`delete from app.local_delivery where recipient=${email}`;
    if (userId) {
      await connection.sql`delete from app.auth_verification where value=${userId}`;
      await connection.sql`delete from app.access_operation where actor_id=${userId}`;
      await connection.sql`delete from app.auth_rate_limit where key=${`access-proof:${userId}`}`;
      await connection.sql`delete from app.auth_user where id=${userId}`;
    }
    await connection.sql`delete from app.auth_user where id=${subjectId}`;
    await connection.sql`delete from app.warehouse where id=${warehouseId}`;
    await connection.sql.end();
  }
});
