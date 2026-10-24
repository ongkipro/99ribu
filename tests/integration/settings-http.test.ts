import {resetBrowserAuthLimits} from './storefront-http-fixture.ts';
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { chromium } from "@playwright/test";
import { connectDatabase } from "../../src/db/client.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";
import { totp } from "./totp-fixture.ts";
import { activateOverHttp } from "./http-activation.ts";

test("built policy API uses real owner MFA/proof cookies, scoped history and immutable committed retry", async () => {
 await resetBrowserAuthLimits();
  const { sql } = connectDatabase("local"); const email = `policy-browser-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url"); let userId = ""; let warehouseId = ""; const samples: Exchange[] = [];
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    const context = await browser.newContext(); const page = await context.newPage();
    assert.equal((await page.goto("http://127.0.0.1:3099"))?.status(), 200);
    const call = async (path: string, body?: Record<string, unknown>, extraHeaders: Record<string, string> = {}) => {
      const result = await page.evaluate(async ({ path, body, extraHeaders }) => {
        const response = await fetch(path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, payload: await response.json(), headers: Object.fromEntries(response.headers) };
      }, { path, body, extraHeaders });
      if (path.startsWith("/api/v1/admin/policy-versions")) samples.push({ url: `http://127.0.0.1:3099${path}`, method: body ? "POST" : "GET",
        request_headers: { "content-type": "application/json", ...extraHeaders }, request_body: body ? JSON.stringify(body) : undefined,
        body_bytes: body ? Buffer.byteLength(JSON.stringify(body)) : undefined, ...result });
      return result;
    };
    const endpoint = "/api/v1/admin/policy-versions";
    assert.equal((await call(`${endpoint}?kind=commercial`)).status, 401);
    assert.equal((await call(endpoint, {})).status, 401);
    assert.equal((await call("/api/auth/sign-up/email", { name: "Synthetic Policy Owner", email, phone: "081234567890" })).status, 200);
    const [user] = await sql`select id from app.auth_user where email=${email}`; userId = user.id;
    await activateOverHttp(sql, context.request, email, password);
    await sql`insert into app.role_grant (user_id,roles) values (${userId},ARRAY['owner']::text[])`;
    assert.equal((await call("/api/auth/sign-in/email", { email, password })).status, 200);
    assert.equal((await call(`${endpoint}?kind=commercial`)).status, 403);
    const setup = await call("/api/auth/two-factor/enable", { password }); assert.equal(setup.status, 200);
    assert.equal((await call("/api/auth/two-factor/verify-totp", { code: totp(setup.payload.totpURI) })).status, 200);
    assert.equal((await call(`${endpoint}?kind=commercial`)).status,200);
    const [warehouse]=await sql`insert into app.warehouse (name,city) values ('Synthetic isolated browser calendar','Malang') returning id`;warehouseId=warehouse.id;
    const state = await call(`${endpoint}?kind=warehouse_calendar&warehouse_id=${warehouseId}`); assert.equal(state.status, 200);
    const issued = await call("/api/v1/me/reauthentication-proofs", { password, action: "warehouse_calendar.version", subject_id: warehouseId }, { "idempotency-key": randomUUID() });
    assert.equal(issued.status, 201);
    // Own a warehouse calendar so acceptance never invalidates shared catalog
    // publications or blocks future changes to the company commercial policy.
    const scheduled = new Date(Date.now()+60000).toISOString();
    const body = { kind: "warehouse_calendar", warehouse_id: warehouseId, effective_at: scheduled,
      values: {timezone:'Asia/Jakarta',year:new Date().getUTCFullYear(),working_weekdays:[1,2,3,4,5,6],cutoff_local:'15:00',closed_dates:[],source:'TEST-ONLY',approval:'test_only'},
      expected_version: state.payload.latest_version, reason: "Synthetic built policy test", reauthentication_proof: issued.payload.proof };
    const key = randomUUID();
    const saved = await call(endpoint, body, { "idempotency-key": key }); assert.equal(saved.status, 201);
    const replay = await call(endpoint, body, { "idempotency-key": key }); assert.equal(replay.status, 201); assert.deepEqual(replay.payload, saved.payload);
    assert.equal((await call(endpoint, { ...body, reason: "Changed intent" }, { "idempotency-key": key })).status, 409);
    assert.equal((await call(endpoint, { ...body, expected_version: saved.payload.version }, { "idempotency-key": randomUUID() })).status, 403);
    assert.equal((await call(`${endpoint}?kind=commercial&limit=1&limit=2`)).status, 400);
    assert.equal((await call(`${endpoint}?kind=commercial`, undefined, { authorization: "Bearer synthetic-unsupported" })).status, 401);
    assert.ok(!(await page.evaluate(() => document.cookie)).includes("session_token"));
    assert.equal((await call("/api/auth/sign-out", {})).status, 200);
    assert.equal((await call(`${endpoint}?kind=commercial`)).status, 401);
    validateExchanges(samples, "settings");
  } finally {
    await browser.close();
    await sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await sql`delete from app.local_delivery where recipient=${email}`;
    if (userId) {
      await sql`delete from app.auth_verification where value=${userId}`;
      await sql`delete from app.access_operation where actor_id=${userId}`;
      await sql`delete from app.auth_rate_limit where key=${`access-proof:${userId}`}`;
      await sql`delete from app.buyer_profile where user_id=${userId}`;
      await sql`delete from app.auth_user where id=${userId}`;
    }
    if(warehouseId) await sql`update app.warehouse set active=false where id=${warehouseId}`;
    await sql.end();
  }
});
