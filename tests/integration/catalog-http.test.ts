import {resetBrowserAuthLimits} from './storefront-http-fixture.ts';
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { chromium } from "@playwright/test";
import { connectDatabase } from "../../src/db/client.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";
import { totp } from "./totp-fixture.ts";
import { activateOverHttp } from "./http-activation.ts";

test("built catalog API uses real MFA cookies, dynamic product paths, durable retry and immutable draft composition", async () => {
 await resetBrowserAuthLimits();
  const { sql } = connectDatabase("local"); const email = `catalog-browser-${randomUUID()}@example.invalid`;
  const password = randomBytes(24).toString("base64url"); let userId = ""; let warehouseId = ""; const samples: Exchange[] = [];
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    const context = await browser.newContext(); const page = await context.newPage();
    assert.equal((await page.goto("http://127.0.0.1:3099"))?.status(), 200);
    const call = async (path: string, method = "GET", body?: Record<string, unknown>, headers: Record<string, string> = {}) => {
      const result = await page.evaluate(async ({ path, method, body, headers }) => {
        const response = await fetch(path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, payload: await response.json(), headers: Object.fromEntries(response.headers) };
      }, { path, method, body, headers });
      if (path.startsWith("/api/v1/admin/")) samples.push({ url: `http://127.0.0.1:3099${path}`, method,
        request_headers: { "content-type": "application/json", ...headers }, request_body: body ? JSON.stringify(body) : undefined,
        body_bytes: body ? Buffer.byteLength(JSON.stringify(body)) : undefined, ...result });
      return result;
    };
    const base = "/api/v1/admin"; const dummy = randomUUID();
    for (const [method, path] of [["GET", "/categories"], ["POST", "/categories"], ["GET", "/stock-items"], ["POST", "/stock-items"],
      ["GET", "/products"], ["POST", "/products"], ["GET", `/products/${dummy}`], ["PATCH", `/products/${dummy}`]]) {
      assert.equal((await call(base + path, method, method === "GET" ? undefined : {})).status, 401);
    }
    assert.equal((await call("/api/auth/sign-up/email", "POST", { name: "Synthetic Catalog Owner", email })).status, 200);
    const [user] = await sql`select id from app.auth_user where email=${email}`; userId = user.id;
    await activateOverHttp(sql, context.request, email, password);
    await sql`insert into app.role_grant (user_id,roles) values (${userId},ARRAY['owner']::text[])`;
    assert.equal((await call("/api/auth/sign-in/email", "POST", { email, password })).status, 200);
    assert.equal((await call(`${base}/products`)).status, 403);
    const setup = await call("/api/auth/two-factor/enable", "POST", { password }); assert.equal(setup.status, 200);
    assert.equal((await call("/api/auth/two-factor/verify-totp", "POST", { code: totp(setup.payload.totpURI) })).status, 200);
    const [warehouse] = await sql`insert into app.warehouse (name,city) values ('Synthetic Catalog Browser','Malang') returning id`; warehouseId = warehouse.id;
    const key = () => ({ "idempotency-key": randomUUID() });
    const category = await call(`${base}/categories`, "POST", { name: "Synthetic browser category", slug: `synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [] }, key()); assert.equal(category.status, 201);
    const stock = await call(`${base}/stock-items`, "POST", { name: "Synthetic browser component", sku: `B-${randomUUID()}`.toUpperCase() }, key()); assert.equal(stock.status, 201);
    const offer = { sku: `O-${randomUUID()}`.toUpperCase(), label: "Synthetic browser multipack", attributes: [], weight_grams: 100, length_mm: 100, width_mm: 100, height_mm: 100,
      default_warehouse_id: warehouseId, offer_kind: "multipack", contents: [{ stock_item_id: stock.payload.id, name: stock.payload.name, quantity: 2 }] };
    const input = { name: "Synthetic browser listing", category_id: category.payload.id, description: "Synthetic only", images: [], variants: [offer] };
    const createKey = key(); const saved = await call(`${base}/products`, "POST", input, createKey); assert.equal(saved.status, 201);
    assert.deepEqual((await call(`${base}/products`, "POST", input, createKey)).payload, saved.payload);
    assert.equal(saved.payload.variants[0].price, 99000); assert.equal(saved.payload.variants[0].availability, "unavailable");
    for (const path of ["/categories", "/stock-items", "/products", `/products/${saved.payload.id}`]) assert.equal((await call(base + path)).status, 200);
    const edit = { expected_version: 1, reason: "Synthetic browser change", name: "Synthetic browser revised listing" }; const editKey = key();
    const revised = await call(`${base}/products/${saved.payload.id}`, "PATCH", edit, editKey); assert.equal(revised.status, 200);
    assert.equal(revised.payload.version, 2); assert.deepEqual(revised.payload.variants, saved.payload.variants);
    assert.deepEqual((await call(`${base}/products/${saved.payload.id}`, "PATCH", edit, editKey)).payload, revised.payload);
    assert.equal((await call(`${base}/products/${saved.payload.id}`, "PATCH", { ...edit, name: "Different intent" }, editKey)).status, 409);
    assert.equal((await call(`${base}/products`, "POST", { ...input, price: 198000 }, key())).status, 400);
    assert.equal((await call(`${base}/products?limit=1&limit=2`)).status, 400);
    assert.equal((await call(`${base}/products`, "GET", undefined, { authorization: "Bearer synthetic" })).status, 401);
    assert.ok(!(await page.evaluate(() => document.cookie)).includes("session_token"));
    const [old] = await sql`select name from app.product_revision where product_id=${saved.payload.id} and revision=1`; assert.equal(old.name, input.name);
    assert.equal((await call("/api/auth/sign-out", "POST", {})).status, 200); assert.equal((await call(`${base}/products`)).status, 401);
    validateExchanges(samples, "catalog");
  } finally {
    await browser.close();
    await sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await sql`delete from app.local_delivery where recipient=${email}`;
    if (userId) {
      await sql`delete from app.auth_verification where value=${userId}`; await sql`delete from app.access_operation where actor_id=${userId}`;
      await sql`delete from app.auth_user where id=${userId}`;
    }
    if (warehouseId) await sql`update app.warehouse set active=false where id=${warehouseId}`;
    await sql.end();
  }
});
