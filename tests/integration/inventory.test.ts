import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { createLocalAuth, type LocalAuth } from "../../src/modules/access/auth.ts";
import { roles } from "../../src/modules/access/policy.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { handleInventory } from "../../src/modules/inventory/routes.ts";
import { actor, BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";

type Actor = Awaited<ReturnType<typeof actor>>;
const root = "/api/v1/admin/inventory";
function request(user: { browser: BrowserSession }, path: string, body?: Record<string, unknown>, key: string = randomUUID()) {
  const req = user.browser.request(`${root}${path}`, body); req.headers.set("idempotency-key", key); return req;
}
async function send(identity: LocalAuth, user: Actor, path: string, body?: Record<string, unknown>, expected = 201, key?: string) {
  const response = await handleInventory(request(user, path, body, key), identity); assert.equal(response.status, expected); return response.json();
}
async function warehouse(identity: LocalAuth) {
  const [row] = await identity.sql`insert into app.warehouse (name,city) values ('Synthetic Inventory','Malang') returning id`; return row.id as string;
}
async function stock(identity: LocalAuth, owner: Actor) {
  const req = owner.browser.request("/api/v1/admin/stock-items", { sku: `I-${randomUUID()}`.toUpperCase(), name: "Synthetic inventory component" });
  req.headers.set("idempotency-key", randomUUID()); const response = await handleCatalog(req, identity); assert.equal(response.status, 201); return response.json();
}

test("inventory stageA six operations use real cookie/MFA, scoped DTOs, strict inputs and committed retry", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = []; const warehouses: string[] = []; const samples: Exchange[] = [];
  async function observe(req: Request, expected: number, requestValid?: boolean) {
    const body = req.body ? await req.clone().text() : undefined; const response = await handleInventory(req, identity);
    assert.equal(response.status, expected); const payload = await response.json();
    samples.push({ url: req.url, method: req.method, request_headers: Object.fromEntries([...req.headers].filter(([k]) => ["content-type", "idempotency-key"].includes(k))),
      request_body: body, body_bytes: body ? Buffer.byteLength(body) : undefined, request_valid: requestValid,
      status: expected, headers: Object.fromEntries(response.headers), payload });
    return payload;
  }
  try {
    const guest = { browser: new BrowserSession(identity) }; const dummy = randomUUID();
    for (const path of ["", "/lots", `/movements?position_id=${dummy}`]) await observe(request(guest, path), 401);
    for (const path of ["/lots", "/positions", "/movements"]) await observe(request(guest, path, {}), 401);
    for (const role of roles.filter((r) => !["owner", "ecommerce_admin", "warehouse"].includes(r))) {
      const user = await actor(identity, role, []); users.push(user);
      if (!["buyer", "affiliate"].includes(role)) await enroll(user.browser, user.password);
      await observe(request(user, ""), 403); await observe(request(user, "/movements", {}), 403);
    }
    const owner = await actor(identity, "owner", []); users.push(owner); await observe(request(owner, ""), 403); await enroll(owner.browser, owner.password);
    const wh = await warehouse(identity); warehouses.push(wh); const sku = await stock(identity, owner);
    const lotBody = { warehouse_id: wh, stock_item_id: sku.id, code: `SYNTHETIC-${randomUUID()}`, expires_on: "2030-12-31", reason: "Synthetic batch source" };
    await observe(request(owner, "/lots", { ...lotBody, expires_on: "2026-02-30" }), 400, false);
    const lot = await observe(request(owner, "/lots", lotBody), 201, true); assert.equal(lot.expires_on, "2030-12-31");
    const position = await observe(request(owner, "/positions", { warehouse_id: wh, stock_item_id: sku.id, lot_id: lot.id }), 201, true);
    assert.equal(position.version, 0); assert.equal(position.on_hand, 0);
    const body = { warehouse_id: wh, stock_item_id: sku.id, lot_id: lot.id, kind: "receive", quantity: 5, reason: "Synthetic receipt", expected_version: 0 };
    for (const value of [{ ...body, on_hand: 999 }, { ...body, quantity: 0 }, { ...body, kind: { toString: "bad" } }, { ...body, clock_namespace: "forged" }]) {
      await observe(request(owner, "/movements", value), 400, false);
    }
    await observe(request(owner, "/movements", { ...body, reason: "x".repeat(17000) }), 413, false);
    const media = request(owner, "/movements", body); media.headers.set("content-type", "text/plain"); await observe(media, 415, false);
    const missingKey = request(owner, "/movements", body); missingKey.headers.delete("idempotency-key"); await observe(missingKey, 400, false);
    const key = randomUUID(); const saved = await observe(request(owner, "/movements", body, key), 201, true);
    assert.equal(saved.balance.on_hand, 5); assert.equal(saved.balance.available, 5); assert.equal(saved.balance.version, 1);
    assert.deepEqual(await observe(request(owner, "/movements", body, key), 201, true), saved);
    await observe(request(owner, "/movements", { ...body, quantity: 6 }, key), 409, true);
    await observe(request(owner, "/movements", body), 409, true);
    await observe(request(owner, `?warehouse_id=${wh}&position_id=${position.id}`), 200, true);
    await observe(request(owner, `/lots?warehouse_id=${wh}`), 200, true);
    const history = await observe(request(owner, `/movements?position_id=${position.id}`), 200, true); assert.equal(history.data.length, 1);
    await observe(request(owner, "?limit=1&limit=2"), 400, false); await observe(request(owner, "?clock_namespace=forged"), 400, false);
    const mixed = request(owner, ""); mixed.headers.set("x-cart-token", "synthetic-unsupported"); await observe(mixed, 401);
    validateExchanges(samples, "inventory");
    const [events] = await identity.sql`select count(*)::int as n from app.stock_movement where balance_id=${position.id}`; assert.equal(events.n, 1);
  } finally { await cleanup(identity, users); for (const wh of warehouses) await identity.sql`update app.warehouse set active=false where id=${wh}`; await identity.sql.end(); }
});

test("physical receipt/quarantine/release/write-off conserve quantities and expired batches never become available", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = []; const warehouses: string[] = [];
  try {
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    const wh = await warehouse(identity); warehouses.push(wh); const sku = await stock(identity, owner);
    const position = await send(identity, owner, "/positions", { warehouse_id: wh, stock_item_id: sku.id, lot_id: null });
    const base = { warehouse_id: wh, stock_item_id: sku.id, lot_id: null, reason: "Synthetic quantity check" };
    let result = await send(identity, owner, "/movements", { ...base, expected_version: 0, kind: "receive", quantity: 10 });
    result = await send(identity, owner, "/movements", { ...base, expected_version: 1, kind: "quarantine", quantity: 4 });
    assert.equal(result.balance.available, 6); assert.equal(result.balance.quarantined, 4);
    result = await send(identity, owner, "/movements", { ...base, expected_version: 2, kind: "write_off", quantity: 3 });
    assert.equal(result.balance.on_hand, 7); assert.equal(result.balance.quarantined, 1); assert.equal(result.balance.available, 6);
    await send(identity, owner, "/movements", { ...base, expected_version: 3, kind: "adjust_down", quantity: 7 }, 409);
    result = await send(identity, owner, "/movements", { ...base, expected_version: 3, kind: "release_quarantine", quantity: 1 });
    assert.equal(result.balance.available, 7);
    const history = await send(identity, owner, `/movements?position_id=${position.id}&limit=1`, undefined, 200);
    assert.equal(history.data[0].balance_version, 4); assert.equal(history.pagination.next_cursor, "4");
    const next = await send(identity, owner, `/movements?position_id=${position.id}&cursor=4`, undefined, 200); assert.equal(next.data[0].kind, "write_off");
    const lot = await send(identity, owner, "/lots", { warehouse_id: wh, stock_item_id: sku.id, code: `SYNTHETIC-EXPIRED-${randomUUID()}`, expires_on: "2020-01-01", reason: "Synthetic expired receipt" });
    result = await send(identity, owner, "/movements", { ...base, lot_id: lot.id, expected_version: 0, kind: "receive", quantity: 2 });
    assert.equal(result.balance.expired, true); assert.equal(result.balance.quarantined, 2); assert.equal(result.balance.available, 0);
    await send(identity, owner, "/movements", { ...base, lot_id: lot.id, expected_version: 1, kind: "write_off", quantity: 2 });
    await assert.rejects(identity.sql`update app.stock_movement set quantity=999 where balance_id=${position.id}`, { code: "23514" });
  } finally { await cleanup(identity, users); for (const wh of warehouses) await identity.sql`update app.warehouse set active=false where id=${wh}`; await identity.sql.end(); }
});

test("both warehouse staff roles operate only assigned stock positions and cannot expose another warehouse's history", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = []; const warehouses: string[] = [];
  try {
    const own = await warehouse(identity); const foreign = await warehouse(identity); warehouses.push(own, foreign);
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password); const sku = await stock(identity, owner);
    const outside = await send(identity, owner, "/positions", { warehouse_id: foreign, stock_item_id: sku.id, lot_id: null });
    for (const role of ["warehouse", "ecommerce_admin"] as const) {
      const user = await actor(identity, role, [own]); users.push(user); await enroll(user.browser, user.password);
      const position = await send(identity, user, "/positions", { warehouse_id: own, stock_item_id: sku.id, lot_id: null });
      await send(identity, user, "/movements", { warehouse_id: own, stock_item_id: sku.id, expected_version: position.version, kind: "receive", quantity: 1, reason: "Synthetic assigned receipt" });
      for (const wh of [foreign, randomUUID()]) await send(identity, user, "/positions", { warehouse_id: wh, stock_item_id: sku.id, lot_id: null }, 404);
      await send(identity, user, `/movements?position_id=${outside.id}`, undefined, 404);
      const list = await send(identity, user, "", undefined, 200); assert.ok(list.data.every((p: { warehouse_id: string }) => p.warehouse_id === own));
    }
    await identity.sql`update app.warehouse set active=false where id=${foreign}`;
    const archived = await send(identity, owner, `?warehouse_id=${foreign}`, undefined, 200); assert.ok(archived.data.some((p: { id: string }) => p.id === outside.id));
  } finally { await cleanup(identity, users); for (const wh of warehouses) await identity.sql`update app.warehouse set active=false where id=${wh}`; await identity.sql.end(); }
});

test("two independent stock editors wait on the same actual balance lock and exactly one expected version wins", async () => {
  const identity = createLocalAuth("test"); const users: Actor[] = []; const warehouses: string[] = [];
  try {
    const wh = await warehouse(identity); warehouses.push(wh);
    const owner = await actor(identity, "owner", []); users.push(owner); await enroll(owner.browser, owner.password);
    const peer = await actor(identity, "ecommerce_admin", [wh]); users.push(peer); await enroll(peer.browser, peer.password);
    const sku = await stock(identity, owner); const position = await send(identity, owner, "/positions", { warehouse_id: wh, stock_item_id: sku.id, lot_id: null });
    let release: () => void = () => {}; let ready: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; }); const locked = new Promise<void>((r) => { ready = r; });
    const blocker = identity.sql.begin(async (tx) => { await tx`select id from app.inventory_balance where id=${position.id} for update`; ready(); await held; });
    let pending: Promise<Response[]> | undefined;
    try {
      await locked;
      pending = Promise.all([owner, peer].map((user) => handleInventory(request(user, "/movements", { warehouse_id: wh, stock_item_id: sku.id, expected_version: 0, kind: "receive", quantity: 1, reason: "Synthetic concurrent receipt" }), identity)));
      let waiting = 0;
      for (let i = 0; i < 100; i++) {
        const [row] = await identity.sql`select count(*)::int as n from pg_stat_activity where datname='99ribu_test' and usename='99ribu_test_app'
          and wait_event_type='Lock' and query like '%select id from app.inventory_balance where id=%for update%'`; waiting = row.n;
        if (waiting === 2) break; await setTimeout(20);
      }
      assert.equal(waiting, 2); release(); await blocker; assert.deepEqual((await pending).map((v) => v.status).sort(), [201,409]);
    } finally { release(); await Promise.allSettled([blocker,pending].filter((v) => v !== undefined)); }
    const [balance] = await identity.sql`select on_hand,revision from app.inventory_balance where id=${position.id}`; assert.deepEqual(balance, { on_hand: 1, revision: 1 });
  } finally { await cleanup(identity, users); for (const wh of warehouses) await identity.sql`update app.warehouse set active=false where id=${wh}`; await identity.sql.end(); }
});
