import {resetBrowserAuthLimits} from './storefront-http-fixture.ts';
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { chromium } from "@playwright/test";
import { connectDatabase } from "../../src/db/client.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";
import { totp } from "./totp-fixture.ts";
import { activateOverHttp } from "./http-activation.ts";

test("built inventory and transfer APIs use real MFA cookies, physical ledger, scoped batch DTOs and durable retry", async () => {
 await resetBrowserAuthLimits();
  const { sql } = connectDatabase("local"); const email = `inventory-browser-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url"); let userId = ""; let warehouseId = ""; let destinationId = ""; const samples: Exchange[] = [];
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    const context = await browser.newContext(); const page = await context.newPage();
    assert.equal((await page.goto("http://127.0.0.1:3099"))?.status(), 200);
    const call = async (path: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) => {
      const result = await page.evaluate(async ({ path, body, headers }) => {
        const response = await fetch(path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, payload: await response.json(), headers: Object.fromEntries(response.headers) };
      }, { path, body, headers });
      if (path.startsWith("/api/v1/admin/inventory")) samples.push({ url: `http://127.0.0.1:3099${path}`, method: body ? "POST" : "GET",
        request_headers: { "content-type": "application/json", ...headers }, request_body: body ? JSON.stringify(body) : undefined,
        body_bytes: body ? Buffer.byteLength(JSON.stringify(body)) : undefined, ...result });
      return result;
    };
    const root = "/api/v1/admin/inventory"; const dummy = randomUUID();
    for (const path of [root, `${root}/lots`, `${root}/movements?position_id=${dummy}`]) assert.equal((await call(path)).status, 401);
    for (const path of [`${root}/lots`, `${root}/positions`, `${root}/movements`]) assert.equal((await call(path, {})).status, 401);
    for (const path of [`${root}/transfers`,`${root}/transfers/${dummy}`]) assert.equal((await call(path)).status,401);
    for (const path of [`${root}/transfers`,...['dispatches','receipts','cancellations'].map((action)=>`${root}/transfers/${dummy}/${action}`)]) assert.equal((await call(path,{})).status,401);
    assert.equal((await call("/api/auth/sign-up/email", { name: "Synthetic Inventory Owner", email, phone: "081234567890" })).status, 200);
    const [user] = await sql`select id from app.auth_user where email=${email}`; userId = user.id;
    await activateOverHttp(sql, context.request, email, password);
    await sql`insert into app.role_grant (user_id,roles) values (${userId},ARRAY['owner']::text[])`;
    assert.equal((await call("/api/auth/sign-in/email", { email,password })).status, 200);
    assert.equal((await call(root)).status, 403);
    const setup = await call("/api/auth/two-factor/enable", { password }); assert.equal(setup.status, 200);
    assert.equal((await call("/api/auth/two-factor/verify-totp", { code: totp(setup.payload.totpURI) })).status, 200);
    const [wh] = await sql`insert into app.warehouse (name,city) values ('Synthetic Inventory Browser','Malang') returning id`; warehouseId = wh.id;
    const key = () => ({ "idempotency-key": randomUUID() });
    const stock = await call("/api/v1/admin/stock-items", { name: "Synthetic browser inventory component", sku: `I-${randomUUID()}`.toUpperCase() }, key()); assert.equal(stock.status, 201);
    const lot = await call(`${root}/lots`, { warehouse_id: warehouseId, stock_item_id: stock.payload.id, code: `SYNTHETIC-${randomUUID()}`, expires_on: "2030-12-31", reason: "Synthetic browser batch" }, key()); assert.equal(lot.status, 201);
    const position = await call(`${root}/positions`, { warehouse_id: warehouseId, stock_item_id: stock.payload.id, lot_id: lot.payload.id }, key()); assert.equal(position.status, 201);
    const body = { warehouse_id: warehouseId, stock_item_id: stock.payload.id, lot_id: lot.payload.id, kind: "receive", quantity: 4, expected_version: 0, reason: "Synthetic browser receipt" };
    const movementKey = key(); const saved = await call(`${root}/movements`, body, movementKey); assert.equal(saved.status, 201);
    assert.equal(saved.payload.balance.on_hand, 4); assert.equal(saved.payload.balance.available, 4);
    assert.deepEqual((await call(`${root}/movements`, body, movementKey)).payload, saved.payload);
    assert.equal((await call(`${root}/movements`, { ...body,quantity: 5 }, movementKey)).status, 409);
    assert.equal((await call(`${root}/lots?warehouse_id=${warehouseId}`)).status, 200);
    const balance = await call(`${root}?warehouse_id=${warehouseId}&position_id=${position.payload.id}`); assert.equal(balance.status, 200); assert.equal(balance.payload.data[0].on_hand, 4);
    const history = await call(`${root}/movements?position_id=${position.payload.id}`); assert.equal(history.status, 200); assert.equal(history.payload.data.length, 1);
    const [destination] = await sql`insert into app.warehouse (name,city) values ('Synthetic Transfer Browser','Surabaya') returning id`; destinationId=destination.id;
    const transferBody={from_warehouse_id:warehouseId,to_warehouse_id:destinationId,stock_item_id:stock.payload.id,quantity:2,reason:'Synthetic browser transfer'};
    const transfer=await call(`${root}/transfers`,transferBody,key()); assert.equal(transfer.status,201);
    const other=await call(`${root}/transfers`,{...transferBody,quantity:1},key()); assert.equal(other.status,201);
    const cancelled=await call(`${root}/transfers/${other.payload.id}/cancellations`,{expected_version:1,reason:'Synthetic browser cancellation'},key()); assert.equal(cancelled.status,201); assert.equal(cancelled.payload.status,'cancelled');
    const sent=await call(`${root}/transfers/${transfer.payload.id}/dispatches`,{expected_version:1,reason:'Synthetic browser source dispatch'},key()); assert.equal(sent.status,201); assert.equal(sent.payload.outstanding_quantity,2);
    const allocation={source_balance_id:transfer.payload.allocations[0].source_balance_id,received_quantity:1,quarantined_quantity:1};
    const receiptBody={expected_version:2,reason:'Synthetic browser partial receipt',allocations:[allocation]}; const receiptKey=key();
    const partial=await call(`${root}/transfers/${transfer.payload.id}/receipts`,receiptBody,receiptKey); assert.equal(partial.status,201); assert.equal(partial.payload.status,'exception');
    assert.deepEqual((await call(`${root}/transfers/${transfer.payload.id}/receipts`,receiptBody,receiptKey)).payload,partial.payload);
    const complete=await call(`${root}/transfers/${transfer.payload.id}/receipts`,{...receiptBody,expected_version:3,allocations:[{...allocation,quarantined_quantity:0}]},key()); assert.equal(complete.status,201); assert.equal(complete.payload.status,'received');
    assert.deepEqual((await call(`${root}/transfers/${transfer.payload.id}`)).payload,complete.payload);
    assert.equal((await call(`${root}/transfers?warehouse_id=${destinationId}&status=received`)).status,200);
    const sourceAfterTransfer=await call(`${root}?warehouse_id=${warehouseId}&position_id=${position.payload.id}`);
    assert.equal((await call(`${root}/movements`, { ...body,expected_version: sourceAfterTransfer.payload.data[0].version,kind: "quarantine",quantity: 2 }, key())).status, 201);
    assert.equal((await call(`${root}?limit=1&limit=2`)).status, 400);
    assert.equal((await call(root, undefined, { authorization: "Bearer synthetic-unsupported" })).status, 401);
    assert.ok(!(await page.evaluate(() => document.cookie)).includes("session_token"));
    assert.equal((await call("/api/auth/sign-out", {})).status, 200); assert.equal((await call(root)).status, 401);
    validateExchanges(samples.filter((s)=>!s.url.includes('/transfers')), "inventory");
    validateExchanges(samples.filter((s)=>s.url.includes('/transfers')), "inventory-transfers");
  } finally {
    await browser.close();
    await sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await sql`delete from app.local_delivery where recipient=${email}`;
    if (userId) { await sql`delete from app.auth_verification where value=${userId}`; await sql`delete from app.access_operation where actor_id=${userId}`; await sql`delete from app.buyer_profile where user_id=${userId}`; await sql`delete from app.auth_user where id=${userId}`; }
    if (warehouseId) await sql`update app.warehouse set active=false where id=${warehouseId}`;
    if (destinationId) await sql`update app.warehouse set active=false where id=${destinationId}`;
    await sql.end();
  }
});
