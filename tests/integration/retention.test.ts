import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Sql, TransactionSql } from "postgres";
import { connectDatabase } from "../../src/db/client.ts";
import { RETENTION_BATCH, RETENTION_JOBS } from "../../src/jobs/retention.ts";
import { funnelInput, recordFunnel } from "../../src/modules/advertising/funnel.ts";
import { capability, commerceActor, prefix } from "../../src/modules/checkout/access.ts";
import { createCart } from "../../src/modules/checkout/carts.ts";
import { submitOrder } from "../../src/modules/checkout/orders.ts";
import { createQuote } from "../../src/modules/checkout/quotes.ts";
import { bootstrapVisitor, visitorCookieName, visitorToken } from "../../src/modules/consent/context.ts";
import { recordConsent } from "../../src/modules/consent/receipts.ts";
import { checkoutFixture } from "./checkout-fixture.ts";

// S105: every retention job runs here inside one owner transaction that is rolled back, so the shared test
// database keeps no residue. A transaction is a valid `Sql` for the jobs: each job is one statement.
const rollback = new Error("rollback");
const days = (n: number) => `${n} days`;
async function drain(tx: Sql, name: string) {
  const runs: number[] = [];
  for (let n = 0; n < 50; n++) { const count = await RETENTION_JOBS[name].run(tx); runs.push(count); if (count === 0) return runs; }
  assert.fail(`${name} did not drain`);
}

test("S105 outbox and access-operation retention: bounded batches, idempotent reruns, allowlists, windows and references honoured", async () => {
  const { sql } = connectDatabase("test", "owner");
  try {
    await assert.rejects(sql.begin(async (tx) => {
      const run = randomUUID();
      // A referencing table created inside the transaction: the job reads references from the catalog.
      await tx`create table app.retention_probe_ref (job_id uuid references app.outbox_job(id), operation_id uuid references app.access_operation(id))`;
      await tx`insert into app.outbox_job (kind,dedup_key,payload,status,attempts,completed_at)
        select 'local.notification', ${`retention:${run}:old:`}||g, '{}'::jsonb, 'completed', 1, clock_timestamp()-interval '31 days' from generate_series(1, ${RETENTION_BATCH + 20}) g`;
      const keep = async (kind: string, status: string, age: string) => (await tx`insert into app.outbox_job (kind,dedup_key,payload,status,attempts,completed_at)
        values (${kind}, ${`retention:${run}:${randomUUID()}`}, '{}'::jsonb, ${status}, 1, case when ${status} in ('completed','failed') then clock_timestamp()-${age}::interval end) returning id`)[0].id as string;
      const recent = await keep("local.notification", "completed", days(29));
      const money = await keep("payment.callback", "completed", days(400));
      const failed = await keep("local.notification", "failed", days(400));
      const pending = await keep("local.notification", "pending", days(400));
      const referenced = await keep("inventory.reservation.expire", "completed", days(400));
      await tx`insert into app.retention_probe_ref (job_id) values (${referenced})`;

      const first = await RETENTION_JOBS["outbox.completed"].run(tx as unknown as Sql);
      assert.equal(first, RETENTION_BATCH, "one run deletes at most one batch");
      const runs = await drain(tx as unknown as Sql, "outbox.completed");
      assert.equal(runs.at(-1), 0, "a rerun after the backlog deletes nothing");
      assert.equal((await tx`select count(*)::int n from app.outbox_job where dedup_key like ${`retention:${run}:old:%`}`)[0].n, 0);
      const left = new Set((await tx`select id from app.outbox_job where id in ${tx([recent, money, failed, pending, referenced])}`).map((r) => r.id));
      for (const [label, id] of Object.entries({ recent, money, failed, pending, referenced })) assert.ok(left.has(id), `${label} job is kept`);

      const op = async (action: string, age: string) => (await tx`insert into app.access_operation (actor_id,action,key,request_hash,response,created_at)
        values (${`retention-${run}`}, ${action}, ${randomUUID()}, 'x', '{}'::jsonb, clock_timestamp()-${age}::interval) returning id`)[0].id as string;
      const replay = await op("buyer.profile.update", days(91));
      const young = await op("buyer.profile.update", days(89));
      const finance = await op("finance.costs.append", days(400));
      const linked = await op("support.conversation.create", days(400));
      await tx`insert into app.retention_probe_ref (operation_id) values (${linked})`;
      await drain(tx as unknown as Sql, "access_operation.replay");
      const ops = new Set((await tx`select id from app.access_operation where actor_id=${`retention-${run}`}`).map((r) => r.id));
      assert.ok(!ops.has(replay), "an old replay record of an allowlisted action is deleted");
      for (const [label, id] of Object.entries({ young, finance, linked })) assert.ok(ops.has(id), `${label} operation is kept`);
      throw rollback;
    }), (error) => error === rollback);
  } finally { await sql.end(); }
});

test("S105 auth retention: expired sessions (with their MFA rows), verifications and idle rate buckets after their windows", async () => {
  const { sql } = connectDatabase("test", "owner");
  try {
    await assert.rejects(sql.begin(async (tx) => {
      const user = `retention-${randomUUID()}`;
      await tx`insert into app.auth_user (id,name,email,email_verified) values (${user},'Synthetic retention',${`${user}@example.invalid`},true)`;
      const session = async (age: string) => (await tx`insert into app.auth_session (id,expires_at,token,user_id) values (${randomUUID()}, clock_timestamp()-${age}::interval, ${randomUUID()}, ${user}) returning id`)[0].id as string;
      const old = await session(days(31)); const young = await session(days(29));
      await tx`insert into app.mfa_session (session_id) values (${old}), (${young})`;
      const verification = async (age: string) => (await tx`insert into app.auth_verification (id,identifier,value,expires_at) values (${randomUUID()}, ${user}, 'x', clock_timestamp()-${age}::interval) returning id`)[0].id as string;
      const staleCode = await verification(days(8)); const freshCode = await verification(days(6));
      const bucket = async (ageMs: number) => (await tx`insert into app.auth_rate_limit (id,key,count,last_request) values (${randomUUID()}, ${`retention:${randomUUID()}`}, 1, floor(extract(epoch from clock_timestamp())*1000)-${ageMs}) returning id`)[0].id as string;
      const idle = await bucket(2 * 86400000); const live = await bucket(1000);
      for (const name of ["auth.session", "auth.verification", "auth.rate_limit"]) await drain(tx as unknown as Sql, name);
      const sessions = new Set((await tx`select id from app.auth_session where user_id=${user}`).map((r) => r.id));
      assert.deepEqual([sessions.has(old), sessions.has(young)], [false, true]);
      assert.deepEqual((await tx`select session_id from app.mfa_session where session_id in ${tx([old, young])}`).map((r) => r.session_id), [young], "MFA goes with its session");
      const codes = new Set((await tx`select id from app.auth_verification where identifier=${user}`).map((r) => r.id));
      assert.deepEqual([codes.has(staleCode), codes.has(freshCode)], [false, true]);
      const buckets = new Set((await tx`select id from app.auth_rate_limit where id in ${tx([idle, live])}`).map((r) => r.id));
      assert.deepEqual([buckets.has(idle), buckets.has(live)], [false, true]);
      throw rollback;
    }), (error) => error === rollback);
  } finally { await sql.end(); }
});

test("S105 visitor history purge: an unreferenced expired visitor graph goes; order-linked history, money rows and the app role's direct deletes stay", async () => {
  const f = await checkoutFixture(); const owner = connectDatabase("test", "owner"); const app = connectDatabase("test");
  const choices = { analytics: "granted", advertising_measurement: "denied", marketing: "denied", meta: "denied", google: "denied", tiktok: "denied",
    google_signals: { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" } };
  try {
    // The first storefront call issues the guest context cookie (and is refused for lack of a cart).
    assert.equal((await f.client.call("/api/v1/carts", {})).response.status, 401);
    const base = f.client.request("/api/v1/visitor-sessions", { client_request_id: randomUUID() }); const actor = await commerceActor(base, f.identity);
    assert.ok(actor?.kind === "guest");
    // A visitor with its consent, bootstrap request and a browser funnel event; optionally tied to an order.
    const visitor = async (tx: TransactionSql, orderId: string | null) => {
      const active = await bootstrapVisitor(tx, base, f.identity, actor, randomUUID(), { client_request_id: randomUUID() });
      const name = await visitorCookieName(f.identity), token = await visitorToken(f.identity, active.visitor);
      f.client.cookies.set(`${name}:/`, { name, value: `${active.visitor.id}.${token}`, path: "/" });
      const consent = await recordConsent(tx, active.visitor, randomUUID(), { expected_version: 0, policy_version: "local-privacy-v1", choices });
      const [offer] = await tx`select id, product_id from app.offer where id=${f.line().variant_id}`;
      const input = { client_event_id: randomUUID(), name: orderId ? "receipt_viewed" : "offer_selected", occurred_at: new Date().toISOString(), consent_receipt_id: consent.id, ...(orderId ? { order_id: orderId } : { product_id: offer.product_id, variant_id: offer.id }) };
      const path = orderId ? `/api/v1/orders/${orderId}/funnel/events` : "/api/v1/funnel/events";
      await recordFunnel(tx, f.client.request(path, input, { key: input.client_event_id }), f.identity, actor, funnelInput(input, input.client_event_id, orderId ?? undefined));
      return active.visitor.id as string;
    };
    const graph = async (tx: TransactionSql, id: string) => (await tx`select
      (select count(*)::int from app.visitor_session where id=${id}) sessions, (select count(*)::int from app.consent_receipt where visitor_id=${id}) receipts,
      (select count(*)::int from app.visitor_bootstrap_request where visitor_id=${id}) bootstraps, (select count(*)::int from app.funnel_intake where visitor_id=${id}) intakes,
      (select count(*)::int from app.commerce_event where visitor_id=${id}) events`)[0];
    const money = async (tx: TransactionSql) => (await tx`select (select count(*)::int from app.order_ad_attribution) attributions,
      (select count(*)::int from app.purchase_allocation) purchases, (select count(*)::int from app.economic_receipt) receipts, (select count(*)::int from app.finance_posting) postings,
      (select count(*)::int from app.audit_event) audits, (select count(*)::int from app.commerce_event where order_id is not null or receipt_id is not null) order_events`)[0];

    await assert.rejects(owner.sql.begin(async (tx) => {
      const cart = await createCart(tx, f.client.request("/api/v1/carts", { lines: [f.line()] }), f.identity, actor, { lines: [f.line()] }, { clock_namespace: f.namespace });
      const cName = `${await prefix(f.identity)}.cart_access`, cToken = await capability(f.identity, "cart", cart.cart.id, actor.id, cart.cart.cap_issued_at as string);
      f.client.cookies.set(`${cName}:/`, { name: cName, value: `${cart.cart.id}.${cToken}`, path: "/" });
      const quoteBody = { cart_id: cart.cart.id, address: f.address, contact: f.contact(), payment_method: "prepaid" };
      const quote = await createQuote(tx, f.client.request("/api/v1/checkout/quotes", quoteBody, { version: 1 }), f.identity, actor, quoteBody);
      const order = (await submitOrder(tx, f.client.request("/api/v1/orders", { quote_id: quote.id }, { version: 1 }), f.identity, actor, { quote_id: quote.id })).order;
      const [access] = await tx`select issued_at from app.order_access where order_id=${order.id}`;
      const oName = `${await prefix(f.identity)}.order_access`, oToken = await capability(f.identity, "order", order.id, actor.id, access.issued_at);
      f.client.cookies.set(`${oName}:/api/v1/orders/${order.id}`, { name: oName, value: `${order.id}.${oToken}`, path: `/api/v1/orders/${order.id}` });
      // The order exists before any visitor cookie, so only the funnel events below name a visitor.
      const purgeable = await visitor(tx, null);
      const ordered = await visitor(tx, order.id);
      // Seal the inserts as a committed history would be before any purge sees it.
      await tx`set constraints all immediate`;
      assert.deepEqual({ ...(await graph(tx, purgeable)) }, { sessions: 1, receipts: 1, bootstraps: 1, intakes: 1, events: 1 });
      const before = await money(tx);
      // The scheduled job keeps the 90-day window: neither fresh visitor is a candidate.
      await RETENTION_JOBS["visitor.history"].run(tx as unknown as Sql);
      assert.equal((await graph(tx, purgeable)).sessions, 1, "a visitor inside the window is kept");
      // The owner-only override moves the window past now, so every visitor in this database is a candidate.
      for (let n = 0; n < 100; n++) if ((await tx`select app.purge_expired_visitor_history(1000, interval '-2 days') n`)[0].n === 0) break;
      assert.deepEqual({ ...(await graph(tx, purgeable)) }, { sessions: 0, receipts: 0, bootstraps: 0, intakes: 0, events: 0 }, "the whole unreferenced graph is gone");
      assert.equal((await graph(tx, ordered)).sessions, 1, "a visitor whose event names an order is kept");
      assert.equal((await graph(tx, ordered)).events, 1);
      assert.deepEqual({ ...(await money(tx)) }, { ...before }, "money, attribution, audit and order-linked event rows are untouched");
      assert.equal((await tx`select count(*)::int n from app.order_ad_attribution a left join app.visitor_session v on v.id=a.visitor_id where v.id is null`)[0].n, 0);
      throw rollback;
    }), (error) => error === rollback);

    // The app role: no window override, and the append-only triggers still refuse its direct deletes,
    // even with the purge setting on (it is not the table owner).
    await assert.rejects(app.sql`select app.purge_expired_visitor_history(10, interval '1 day')`, { code: "42501" });
    assert.equal(typeof (await app.sql`select app.purge_expired_visitor_history(10) n`)[0].n, "number");
    await assert.rejects(app.sql.begin(async (tx) => {
      const id = await visitor(tx, null);
      await tx`set constraints all immediate`;
      await tx`select set_config('app.retention_purge', 'on', true)`;
      for (const table of ["funnel_intake", "commerce_event", "consent_receipt", "visitor_bootstrap_request"]) {
        await assert.rejects(tx.savepoint((s) => s`delete from ${s(`app.${table}`)} where visitor_id=${id}`), { code: "23514" }, `${table} stays append-only`);
      }
      await assert.rejects(tx.savepoint((s) => s`delete from app.visitor_session where id=${id}`), { code: "23514" });
      throw rollback;
    }), (error) => error === rollback);
  } finally { await owner.sql.end(); await app.sql.end(); await f.close(); }
});
