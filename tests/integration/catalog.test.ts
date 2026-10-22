import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { createLocalAuth, type LocalAuth } from "../../src/modules/access/auth.ts";
import { roles } from "../../src/modules/access/policy.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { totp } from "./totp-fixture.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { handleFinance } from "../../src/modules/finance/routes.ts";
import { handleInventory } from "../../src/modules/inventory/routes.ts";
import { readCatalogRevision } from "../../src/modules/catalog/catalog.ts";
import { actor, BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";

type Actor = Awaited<ReturnType<typeof actor>>;
const root = "/api/v1/admin";
function request(user: Actor | { browser: BrowserSession }, method: string, path: string, body?: Record<string, unknown>, key: string = randomUUID()) {
  const base = user.browser.request(`${root}${path}`, body); base.headers.set("idempotency-key", key);
  return new Request(base, { method });
}
async function send(identity: LocalAuth, user: Actor, method: string, path: string, body?: Record<string, unknown>, expected = 201, key?: string) {
  const response = await handleCatalog(request(user, method, path, body, key), identity);
  assert.equal(response.status, expected); return response.json();
}
async function warehouse(identity: LocalAuth) {
  const [row] = await identity.sql`insert into app.warehouse (name,city) values ('Synthetic Catalog','Malang') returning id`; return row.id as string;
}
function definition(warehouseId: string, stock: { id: string; name: string }, suffix = "UNIT") {
  return { sku: `S-${randomUUID()}-${suffix}`.toUpperCase(), label: "Synthetic offer", attributes: [], weight_grams: 100, length_mm: 100,
    width_mm: 100, height_mm: 100, default_warehouse_id: warehouseId, offer_kind: "unit", contents: [{ stock_item_id: stock.id, name: stock.name, quantity: 1 }] };
}
async function catalog(identity: LocalAuth, owner: Actor, warehouseId: string) {
  const category = await send(identity, owner, "POST", "/categories", { name: "Synthetic category", slug: `synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [] });
  const stock = await send(identity, owner, "POST", "/stock-items", { sku: `C-${randomUUID()}`.toUpperCase(), name: "Synthetic component" });
  const other = await send(identity, owner, "POST", "/stock-items", { sku: `C-${randomUUID()}`.toUpperCase(), name: "Synthetic second component" });
  return { category, stock, other, body: { name: "Synthetic listing", category_id: category.id, description: "Synthetic only", images: [], variants: [definition(warehouseId, stock)] } };
}

test("catalog cookie/MFA roles, eight wire operations, fixed-price composition and strict request boundaries", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = []; const warehouses: string[] = []; const samples: Exchange[] = [];
  async function observe(req: Request, status: number, requestValid?: boolean) {
    const body = req.body ? await req.clone().text() : undefined; const response = await handleCatalog(req, identity);
    assert.equal(response.status, status); const payload = await response.json();
    samples.push({ url: req.url, method: req.method, request_headers: Object.fromEntries([...req.headers].filter(([key]) => ["content-type", "idempotency-key"].includes(key))),
      request_body: body, body_bytes: body ? Buffer.byteLength(body) : undefined, request_valid: requestValid, status, headers: Object.fromEntries(response.headers), payload });
    return payload;
  }
  try {
    const dummy = randomUUID(); const endpoints = [["GET", "/categories"], ["POST", "/categories"], ["GET", "/stock-items"], ["POST", "/stock-items"],
      ["GET", "/products"], ["POST", "/products"], ["GET", `/products/${dummy}`], ["PATCH", `/products/${dummy}`]];
    const guest = { browser: new BrowserSession(identity) };
    for (const [method, path] of endpoints) await observe(request(guest, method, path, method === "GET" ? undefined : {}), 401);
    for (const role of roles.filter((r) => r !== "owner" && r !== "ecommerce_admin")) {
      const user = await actor(identity, role, []); users.push(user);
      if (!["buyer", "affiliate"].includes(role)) await enroll(user.browser, user.password);
      // Warehouse staff read their scoped catalog; finance needs finance.costs.read (covered below).
      await observe(request(user, "GET", "/products"), role === "warehouse" ? 200 : 403); await observe(request(user, "POST", "/products", {}), 403);
    }
    const owner = await actor(identity, "owner", []); users.push(owner);
    await observe(request(owner, "GET", "/products"), 403); await enroll(owner.browser, owner.password);
    const wh = await warehouse(identity); warehouses.push(wh);
    for (const data of [
      { name: "Synthetic padded slug", slug: ` synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [] },
      { name: "Synthetic padded key", slug: `synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [{ key: " padded", label: "Synthetic", value_type: "text", required: false, allowed_values: [] }] },
      ...[{toString:"invalid"},["text"]].map((value_type)=>({name:"Synthetic malformed enum",slug:`synthetic-${randomUUID()}`,parent_id:null,
        attribute_definitions:[{key:"type",label:"Synthetic",value_type,required:false,allowed_values:[]}]})),
    ]) await observe(request(owner, "POST", "/categories", data), 400, false);
    const cat = await observe(request(owner, "POST", "/categories", { name: "Synthetic taxonomy", slug: `synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [] }), 201, true);
    const component = await observe(request(owner, "POST", "/stock-items", { name: "Synthetic component", sku: `C-${randomUUID()}`.toUpperCase() }), 201, true);
    const extra = await send(identity, owner, "POST", "/stock-items", { name: "Synthetic other", sku: `C-${randomUUID()}`.toUpperCase() });
    const unit = definition(wh, component); const multipack = { ...definition(wh, component, "PACK"), offer_kind: "multipack", contents: [{ stock_item_id: component.id, name: component.name, quantity: 2 }] };
    const bundle = { ...definition(wh, component, "BUNDLE"), offer_kind: "bundle", contents: [...unit.contents, { stock_item_id: extra.id, name: extra.name, quantity: 3 }] };
    const body = { name: "Synthetic fixed-price options", category_id: cat.id, description: "Synthetic only", images: [], variants: [unit, multipack, bundle] };
    await observe(request(owner, "POST", "/products", { ...body, variants: [{ ...unit, attributes: [{ key: " padded", label: "Synthetic", values: ["value"] }] }] }), 400, false);
    for(const offer_kind of [{toString:"invalid"},["unit"]]) await observe(request(owner,"POST","/products",{...body,variants:[{...unit,offer_kind}]}),400,false);
    for (const input of [{ ...body, price: 1 }, { ...body, variants: [{ ...unit, price: 198000 }] }, { ...body, variants: [{ ...unit, weight_grams: 0 }] },
      { ...body, variants: [{ ...multipack, contents: unit.contents }] }, { ...body, variants: [{ ...bundle, contents: unit.contents }] }]) await observe(request(owner, "POST", "/products", input), 400, false);
    await observe(request(owner, "POST", "/products", { ...body, variants: [{ ...bundle, contents: [...unit.contents, ...unit.contents] }] }), 422, true);
    await observe(request(owner, "POST", "/products", { ...body, variants: [{ ...unit, contents: [{ ...unit.contents[0], name: "False component name" }] }] }), 422, true);
    const huge = { ...body, description: "x".repeat(17000) }; await observe(request(owner, "POST", "/products", huge), 413, false);
    const media = request(owner, "POST", "/products", body); media.headers.set("content-type", "text/plain"); await observe(media, 415, false);
    const missingKey = request(owner, "POST", "/products", body); missingKey.headers.delete("idempotency-key"); await observe(missingKey, 400, false);
    const key = randomUUID(); const saved = await observe(request(owner, "POST", "/products", body, key), 201, true);
    assert.equal(saved.status, "draft"); assert.equal(saved.variants.length, 3);
    for (const v of saved.variants) { assert.equal(v.price, 99000); assert.equal(v.currency, "IDR"); assert.equal(v.availability, "unavailable"); assert.equal(v.image, null); }
    assert.deepEqual(await observe(request(owner, "POST", "/products", body, key), 201, true), saved);
    await observe(request(owner, "POST", "/products", { ...body, name: "Changed request" }, key), 409, true);
    for (const path of ["/categories", "/stock-items", "/products", `/products/${saved.id}`]) await observe(request(owner, "GET", path), 200, true);
    await observe(request(owner, "GET", "/products?limit=1&limit=2"), 400, false);
    await observe(request(owner, "GET", "/products?unknown=1"), 400, false);
    const mixed = request(owner, "GET", "/products"); mixed.headers.set("authorization", "Bearer synthetic"); await observe(mixed, 401);
    const patch = { expected_version: 1, reason: "Synthetic rename", name: "Synthetic revised listing" };
    const updated = await observe(request(owner, "PATCH", `/products/${saved.id}`, patch), 200, true);
    assert.equal(updated.version, 2); assert.equal(updated.catalog_id, saved.catalog_id); assert.equal(updated.slug, saved.slug);
    assert.deepEqual(updated.variants, saved.variants);
    await observe(request(owner, "PATCH", `/products/${saved.id}`, patch), 409, true);
    validateExchanges(samples, "catalog");
  } finally { await cleanup(identity, users); for (const wh of warehouses) await identity.sql`update app.warehouse set active=false where id=${wh}`; await identity.sql.end(); }
});

test("catalog ecommerce warehouse scope, explicit create/update/retire, stable identities and historical revision isolation", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = []; const warehouses: string[] = [];
  try {
    const wh = await warehouse(identity); const otherWh = await warehouse(identity); warehouses.push(wh, otherWh);
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    const staff = await actor(identity, "ecommerce_admin", [wh]); users.push(staff); const staffFactor = await enroll(staff.browser, staff.password);
    const fixture = await catalog(identity, owner, wh);
    for (const outside of [otherWh, randomUUID()]) await send(identity, staff, "POST", "/products", { ...fixture.body, variants: [definition(outside, fixture.stock)] }, 403);
    const createKey = randomUUID(); const first = await send(identity, staff, "POST", "/products", fixture.body, 201, createKey);
    const hidden = await send(identity, owner, "POST", "/products", { ...fixture.body, variants: [definition(otherWh, fixture.stock)] });
    await send(identity, staff, "GET", `/products/${hidden.id}`, undefined, 404);
    const listed = await send(identity, staff, "GET", "/products", undefined, 200); assert.ok(!listed.data.some((v: { id: string }) => v.id === hidden.id));
    const edit = { label: "Revised unit", attributes: [], weight_grams: 110, length_mm: 120, width_mm: 110, height_mm: 100, default_warehouse_id: wh,
      offer_kind: "multipack", contents: [{ stock_item_id: fixture.stock.id, name: fixture.stock.name, quantity: 3 }] };
    const patch = { expected_version: 1, reason: "Synthetic composition", variant_changes: [{ operation: "update", variant_id: first.variants[0].id, update: edit },
      { operation: "create", create: definition(wh, fixture.other) }] };
    await send(identity, staff, "PATCH", `/products/${first.id}`, { ...patch, variant_changes: [{ operation: "update", variant_id: first.variants[0].id, update: { ...edit, default_warehouse_id: otherWh } }] }, 403);
    await send(identity, staff, "PATCH", `/products/${first.id}`, { ...patch, variant_changes: [{ operation: "retire", variant_id: hidden.variants[0].id }] }, 404);
    const snapshot = await readCatalogRevision(identity.sql, first.id, 1);
    const updated = await send(identity, staff, "PATCH", `/products/${first.id}`, patch, 200);
    assert.equal(updated.variants.find((v: { id: string }) => v.id === first.variants[0].id).sku, first.variants[0].sku);
    assert.equal(updated.variants.find((v: { id: string }) => v.id === first.variants[0].id).catalog_id, first.variants[0].catalog_id);
    assert.deepEqual(await readCatalogRevision(identity.sql, first.id, 1), snapshot);
    const retired = await send(identity, staff, "PATCH", `/products/${first.id}`, { expected_version: 2, reason: "Synthetic retirement", variant_changes: [{ operation: "retire", variant_id: first.variants[0].id }] }, 200);
    assert.equal(retired.variants.length, 1);
    await send(identity, staff, "PATCH", `/products/${first.id}`, { expected_version: 3, reason: "Cannot recycle SKU", variant_changes: [{ operation: "create", create: { ...definition(wh, fixture.stock), sku: first.variants[0].sku } }] }, 409);
    await send(identity, staff, "PATCH", `/products/${first.id}`, { expected_version: 3, reason: "Cannot retire every offer", variant_changes: [{ operation: "retire", variant_id: retired.variants[0].id }] }, 422);
    assert.equal((await send(identity, staff, "GET", `/products/${first.id}`, undefined, 200)).version, 3);
    const [audit] = await identity.sql`select count(*)::int as n from app.audit_event where actor_id=${staff.id} and action like 'catalog.product.%'`; assert.equal(audit.n, 3);
    // Recovery must authorize the saved response as well as the current product.
    const replacement = { ...edit, default_warehouse_id: otherWh, offer_kind: "unit", contents: [{ stock_item_id: fixture.other.id, name: fixture.other.name, quantity: 1 }] };
    await send(identity, owner, "PATCH", `/products/${first.id}`, { expected_version: 3, reason: "Synthetic warehouse migration", variant_changes: [{ operation: "update", variant_id: retired.variants[0].id, update: replacement }] }, 200);
    const proofRequest = owner.browser.request("/api/v1/me/reauthentication-proofs", { password: owner.password, action: "staff_roles.replace", subject_id: staff.id });
    proofRequest.headers.set("idempotency-key", randomUUID());
    const issued = await handleAccess(proofRequest, identity); assert.equal(issued.status, 201);
    const grantRequest = owner.browser.request("/api/v1/admin/role-grants", { user_id: staff.id, roles: ["ecommerce_admin"], warehouse_ids: [otherWh], permissions: [],
      expected_version: 1, reason: "Synthetic current-scope recovery", reauthentication_proof: (await issued.json()).proof });
    grantRequest.headers.set("idempotency-key", randomUUID()); assert.equal((await handleAccess(grantRequest, identity)).status, 201);
    assert.equal((await staff.browser.auth("/sign-in/email", { email: staff.email, password: staff.password })).status, 200);
    assert.equal((await staff.browser.auth("/two-factor/verify-totp", { code: totp(staffFactor.totpURI) })).status, 200);
    await send(identity, staff, "GET", `/products/${first.id}`, undefined, 200);
    await send(identity, staff, "POST", "/products", fixture.body, 404, createKey);

  } finally { await cleanup(identity, users); for (const wh of warehouses) await identity.sql`update app.warehouse set active=false where id=${wh}`; await identity.sql.end(); }
});

test("two independent catalog actors really wait for one product lock; one version wins and history rejects late writes", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = []; const warehouses: string[] = [];
  try {
    const wh = await warehouse(identity); warehouses.push(wh);
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    const peer = await actor(identity, "owner", []); users.push(peer); await enroll(peer.browser, peer.password);
    const fixture = await catalog(identity, owner, wh); const saved = await send(identity, owner, "POST", "/products", fixture.body);
    let release: () => void = () => {}; let ready: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; }); const locked = new Promise<void>((r) => { ready = r; });
    const blocker = identity.sql.begin(async (tx) => { await tx`select id from app.product where id=${saved.id} for update`; ready(); await gate; });
    let pending: Promise<Response[]> | undefined;
    try {
      await locked;
      pending = Promise.all([owner, peer].map((u, i) => handleCatalog(request(u, "PATCH", `/products/${saved.id}`, { expected_version: 1, reason: "Synthetic competing editor", name: `Synthetic winner${i}` }), identity)));
      let waiting = 0;
      for (let i = 0; i < 100; i++) {
        const [row] = await identity.sql`select count(*)::int as n from pg_stat_activity where datname='99ribu_test' and usename='99ribu_test_app'
          and wait_event_type='Lock' and query like '%select id from app.product where id=%for update%'`; waiting = row.n;
        if (waiting === 2) break; await setTimeout(20);
      }
      assert.equal(waiting, 2); release(); await blocker; assert.deepEqual((await pending).map((v) => v.status).sort(), [200, 409]);
    } finally { release(); await Promise.allSettled([blocker, pending].filter((v) => v !== undefined)); }
    const after = await readCatalogRevision(identity.sql, saved.id); assert.equal(after.version, 2);
    await assert.rejects(identity.sql`update app.product_revision set name='rewrite' where product_id=${saved.id}`, { code: "23514" });
    await assert.rejects(identity.sql`delete from app.offer_component where product_id=${saved.id}`, { code: "23514" });
    await assert.rejects(identity.sql`update app.offer set sku='REASSIGNED' where product_id=${saved.id}`, { code: "23514" });
    await assert.rejects(identity.sql`update app.product set slug='rewrite' where id=${saved.id}`, { code: "23514" });
    await assert.rejects(identity.sql`insert into app.offer_component (product_id,revision,offer_id,stock_item_id,name,quantity)
      values (${saved.id},1,${saved.variants[0].id},${fixture.other.id},${fixture.other.name},1)`, { code: "23514" });
    for (const badPrice of [0, 198000]) await assert.rejects(identity.sql.begin(async (tx) => {
      await tx`insert into app.product_revision (product_id,revision,name,description,category_id,images,facts,actor_id,reason)
        select product_id,3,name,description,category_id,images,facts,actor_id,reason from app.product_revision where product_id=${saved.id} and revision=2`;
      await tx`insert into app.offer_revision (product_id,revision,offer_id,label,attributes,kind,price,weight_grams,length_mm,width_mm,height_mm,default_warehouse_id)
        select product_id,3,offer_id,label,attributes,kind,${badPrice},weight_grams,length_mm,width_mm,height_mm,default_warehouse_id from app.offer_revision where product_id=${saved.id} and revision=2`;
    }), { code: "23514" });
    assert.equal((await readCatalogRevision(identity.sql, saved.id)).version, 2);
  } finally { await cleanup(identity, users); for (const wh of warehouses) await identity.sql`update app.warehouse set active=false where id=${wh}`; await identity.sql.end(); }
});

test("three-level typed taxonomy rejects a fourth level, duplicate keys and reused identities atomically", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = [];
  try {
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    const input = { name: "Synthetic department", slug: `synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [{ key: "size", label: "Size", value_type: "enum", required: true, allowed_values: ["S", "M"] }] };
    const key = randomUUID(); const first = await send(identity, owner, "POST", "/categories", input, 201, key);
    assert.deepEqual(await send(identity, owner, "POST", "/categories", input, 201, key), first);
    await send(identity, owner, "POST", "/categories", { ...input, name: "Other intent" }, 409, key);
    await send(identity, owner, "POST", "/categories", { ...input, slug: `synthetic-${randomUUID()}`, parent_id: first.id }, 422);
    const second = await send(identity, owner, "POST", "/categories", { ...input, slug: `synthetic-${randomUUID()}`, parent_id: first.id, attribute_definitions: [] });
    const third = await send(identity, owner, "POST", "/categories", { ...input, slug: `synthetic-${randomUUID()}`, parent_id: second.id, attribute_definitions: [] });
    await send(identity, owner, "POST", "/categories", { ...input, slug: `synthetic-${randomUUID()}`, parent_id: third.id, attribute_definitions: [] }, 422);
    await assert.rejects(identity.sql`update app.category set parent_id=${third.id} where id=${first.id}`, { code: "23514" });
    await assert.rejects(identity.sql`insert into app.category (name,slug,parent_id,depth) values ('Synthetic invalid',${`synthetic-${randomUUID()}`},${first.id},3)`, { code: "23514" });
    const page = await send(identity, owner, "GET", "/categories?limit=1", undefined, 200); assert.equal(page.data.length, 1); assert.ok(page.pagination.next_cursor);
    const next = await send(identity, owner, "GET", `/categories?limit=1&cursor=${page.pagination.next_cursor}`, undefined, 200); assert.notEqual(next.data[0].id, page.data[0].id);
  } finally { await cleanup(identity, users); await identity.sql.end(); }
});

test("catalog read roles: scoped warehouse and finance.costs.read readers, financial blockers redacted, writes stay with catalog editors", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = []; const warehouses: string[] = [];
  const call = async (handler: typeof handleCatalog, user: { browser: BrowserSession }, method: string, path: string, body?: Record<string, unknown>) => {
    const response = await handler(request(user, method, path, body), identity); return { status: response.status, payload: await response.json() };
  };
  try {
    const wh = await warehouse(identity); const otherWh = await warehouse(identity); warehouses.push(wh, otherWh);
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    // Cost blocker codes are only evaluated under a current commercial policy (same baseline as catalog-summary).
    if ((await (await owner.browser.access("/admin/policy-versions?kind=commercial")).json()).latest_version === 0) {
      const proofReq = owner.browser.request("/api/v1/me/reauthentication-proofs", { password: owner.password, action: "company_policy.version", subject_id: "company-commercial" });
      proofReq.headers.set("idempotency-key", randomUUID()); const proof = (await (await handleAccess(proofReq, identity)).json()).proof;
      const req = owner.browser.request("/api/v1/admin/policy-versions", { kind: "commercial", warehouse_id: null, expected_version: 0, effective_at: null,
        values: { default_commission_bps: 1000, minimum_payout_idr: 99000 }, reason: "Synthetic read-role baseline", reauthentication_proof: proof });
      req.headers.set("idempotency-key", randomUUID()); assert.equal((await handleAccess(req, identity)).status, 201);
    }
    const fixture = await catalog(identity, owner, wh);
    fixture.body.name = `Synthetic read role ${randomUUID().slice(0, 8)}`;
    const q = `q=${encodeURIComponent(fixture.body.name)}&limit=100`;
    const inside = await send(identity, owner, "POST", "/products", fixture.body);
    const outside = await send(identity, owner, "POST", "/products", { ...fixture.body, variants: [definition(otherWh, fixture.stock)] });
    for (const target of [wh, otherWh]) {
      const receive = owner.browser.request("/api/v1/admin/inventory/movements", { warehouse_id: target, stock_item_id: fixture.stock.id, kind: "receive", quantity: 1, expected_version: 0, reason: "Synthetic read-role stock" });
      receive.headers.set("idempotency-key", randomUUID()); assert.equal((await handleInventory(receive, identity)).status, 201);
    }
    const staff = async (role: "warehouse" | "finance" | "customer_service", scope: string[], permissions: string[] = []) => {
      const user = await actor(identity, role, scope); users.push(user); await enroll(user.browser, user.password);
      await identity.sql`update app.role_grant set permissions=${permissions} where user_id=${user.id}`; return user;
    };
    const keeper = await staff("warehouse", [wh]);
    const costReader = await staff("finance", [], ["finance.costs.read"]);
    const financeOnly = await staff("finance", [], ["finance.summary.read"]);
    const service = await staff("customer_service", [wh]);
    const ids = (page: { data: { id: string }[] }) => page.data.map((v) => v.id);
    const writes: [string, string, Record<string, unknown>][] = [["POST", "/categories", {}], ["POST", "/stock-items", {}], ["POST", "/products", {}],
      ["PATCH", `/products/${inside.id}`, {}], ["POST", `/products/${inside.id}/publications`, {}], ["POST", `/products/${inside.id}/publication-retractions`, {}]];

    // Warehouse staff: their warehouse only, no SKU dictionary, financial blockers collapsed to one code.
    assert.equal((await call(handleCatalog, keeper, "GET", "/categories")).status, 200);
    assert.equal((await call(handleCatalog, keeper, "GET", "/stock-items")).status, 403);
    const keeperList = await call(handleCatalog, keeper, "GET", `/products?${q}`); assert.equal(keeperList.status, 200);
    assert.deepEqual(ids(keeperList.payload), [inside.id]);
    const keeperRow = keeperList.payload.data[0];
    assert.ok(keeperRow.blocker_codes.includes("FINANCIAL_REVIEW_REQUIRED"));
    assert.ok(!keeperRow.blocker_codes.some((code: string) => code.startsWith("UNKNOWN_") || code === "BELOW_MARGIN_FLOOR"));
    assert.equal((await call(handleCatalog, keeper, "GET", `/products/${inside.id}`)).status, 200);
    assert.equal((await call(handleCatalog, keeper, "GET", `/products/${outside.id}`)).status, 404);
    const keeperState = await call(handleCatalog, keeper, "GET", `/products/${inside.id}/publications`); assert.equal(keeperState.status, 200);
    assert.ok(keeperState.payload.blockers.every((b: { code: string }) => !b.code.startsWith("UNKNOWN_")));
    assert.ok(keeperState.payload.blockers.some((b: { code: string }) => b.code === "FINANCIAL_REVIEW_REQUIRED"));
    assert.equal((await call(handleCatalog, keeper, "GET", `/products/${outside.id}/publications`)).status, 404);
    const balances = await call(handleInventory, keeper, "GET", `/inventory?stock_item_id=${fixture.stock.id}`); assert.equal(balances.status, 200);
    assert.deepEqual([...new Set(balances.payload.data.map((v: { warehouse_id: string }) => v.warehouse_id))], [wh]);
    assert.equal((await call(handleFinance, keeper, "GET", `/products/${inside.id}/contribution-reviews`)).status, 403);

    // Finance with finance.costs.read: company catalog and cost codes, no stock balances.
    assert.equal((await call(handleCatalog, costReader, "GET", "/categories")).status, 200);
    assert.equal((await call(handleCatalog, costReader, "GET", "/stock-items")).status, 403);
    const financeList = await call(handleCatalog, costReader, "GET", `/products?${q}`); assert.equal(financeList.status, 200);
    assert.deepEqual(ids(financeList.payload).sort(), [inside.id, outside.id].sort());
    assert.ok(financeList.payload.data.every((v: { blocker_codes: string[] }) => v.blocker_codes.includes("UNKNOWN_HPP")));
    assert.equal((await call(handleCatalog, costReader, "GET", `/products/${outside.id}`)).status, 200);
    const financeState = await call(handleCatalog, costReader, "GET", `/products/${outside.id}/publications`); assert.equal(financeState.status, 200);
    assert.ok(financeState.payload.blockers.some((b: { code: string }) => b.code === "UNKNOWN_HPP"));
    assert.equal((await call(handleInventory, costReader, "GET", `/inventory?stock_item_id=${fixture.stock.id}`)).status, 403);
    assert.equal((await call(handleFinance, costReader, "GET", `/products/${inside.id}/contribution-reviews`)).status, 200);

    // Finance without the cost grant and customer service: no private catalog surface at all.
    for (const user of [financeOnly, service])
      for (const path of ["/categories", "/stock-items", "/products", `/products/${inside.id}`, `/products/${inside.id}/publications`])
        assert.equal((await call(handleCatalog, user, "GET", path)).status, 403, path);
    // Mutations remain owner/ecommerce_admin only, refused before any body validation.
    for (const user of [keeper, costReader, financeOnly, service])
      for (const [method, path, body] of writes) assert.equal((await call(handleCatalog, user, method, path, body)).status, 403, `${method} ${path}`);

    // Revoking the cost grant takes effect on the next read.
    await identity.sql`update app.role_grant set permissions='{}' where user_id=${costReader.id}`;
    assert.equal((await call(handleCatalog, costReader, "GET", "/products")).status, 403);
  } finally { await cleanup(identity, users); for (const wh of warehouses) await identity.sql`update app.warehouse set active=false where id=${wh}`; await identity.sql.end(); }
});
