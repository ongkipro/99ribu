import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";
import { enqueueJob } from "../../src/jobs/outbox.ts";
import { runOneJob } from "../../src/jobs/worker.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { getPrincipal } from "../../src/modules/access/policy.ts";
import { handleCatalog } from "../../src/modules/catalog/routes.ts";
import { handleInventory } from "../../src/modules/inventory/routes.ts";
import { offerAvailability, releaseReservation, reserveOffers } from "../../src/modules/inventory/reservations.ts";
import { advanceFixtureClock, readFixtureClock, seedLocal } from "../../src/modules/local/fixtures.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";

const exec = promisify(execFile);
const childEnvironment = { ...process.env };
delete childEnvironment.NODE_TEST_CONTEXT;
const driver = ["--env-file=.env.example", "tests/integration/inventory-worker-fixture.ts"];
const worker = ["--env-file=.env.example", "scripts/worker.ts", "test", "--once"];

async function setup(a: number, b: number, namespace: string | null = null) {
  const identity = createLocalAuth("test"); let warehouseIds: string[];
  if (namespace) {
    warehouseIds = Object.values((await seedLocal("test", namespace)).warehouses);
    let state = await readFixtureClock("test",namespace);
    while (Date.parse(state.now)<Date.now()) {
      const seconds = Math.min(31622400,Math.ceil((Date.now()-Date.parse(state.now))/1000));
      state = await advanceFixtureClock("test",namespace,seconds,state.version);
    }
  }
  else {
    const [wh] = await identity.sql`insert into app.warehouse (name,city) values ('Synthetic Reservation','Malang') returning id`; warehouseIds = [wh.id];
  }
  const wh = warehouseIds[0]; const owner = await actor(identity, "owner", []); await enroll(owner.browser, owner.password);
  const call = async (domain: "catalog" | "inventory", path: string, body: Record<string, unknown>) => {
    const request = owner.browser.request(`/api/v1/admin${path}`, body); request.headers.set("idempotency-key", randomUUID());
    const response = await (domain === "catalog" ? handleCatalog : handleInventory)(request, identity); assert.equal(response.status, 201); return response.json();
  };
  const stockA = await call("catalog", "/stock-items", { sku: `R-${randomUUID()}`.toUpperCase(), name: "Synthetic reservation A" });
  const stockB = await call("catalog", "/stock-items", { sku: `R-${randomUUID()}`.toUpperCase(), name: "Synthetic reservation B" });
  const category = await call("catalog", "/categories", { name: "Synthetic reservation category", slug: `synthetic-${randomUUID()}`, parent_id: null, attribute_definitions: [] });
  const base = { attributes: [],weight_grams: 100,length_mm: 100,width_mm: 100,height_mm: 100,default_warehouse_id: wh };
  const componentA = { stock_item_id: stockA.id,name: stockA.name,quantity: 1 }; const componentB = { stock_item_id: stockB.id,name: stockB.name,quantity: 1 };
  const product = await call("catalog", "/products", { name: "Synthetic reservation offers", category_id: category.id, description: "Synthetic only", images: [], variants: [
    { ...base,sku: `U-${randomUUID()}`.toUpperCase(),label: "Unit",offer_kind: "unit",contents: [componentA] },
    { ...base,sku: `P-${randomUUID()}`.toUpperCase(),label: "Multipack",offer_kind: "multipack",contents: [{ ...componentA,quantity: 2 }] },
    { ...base,sku: `B-${randomUUID()}`.toUpperCase(),label: "Bundle",offer_kind: "bundle",contents: [componentA,componentB] },
  ] });
  const unit = product.variants.find((v: { offer_kind: string }) => v.offer_kind === "unit");
  const pack = product.variants.find((v: { offer_kind: string }) => v.offer_kind === "multipack");
  const bundle = product.variants.find((v: { offer_kind: string }) => v.offer_kind === "bundle");
  const positionA = await call("inventory", "/inventory/positions", { warehouse_id: wh,stock_item_id: stockA.id,lot_id: null });
  const positionB = await call("inventory", "/inventory/positions", { warehouse_id: wh,stock_item_id: stockB.id,lot_id: null });
  for (const [stock,quantity] of [[stockA,a],[stockB,b]] as const) if (quantity) await call("inventory", "/inventory/movements", {
    warehouse_id: wh,stock_item_id: stock.id,kind: "receive",quantity,expected_version: 0,reason: "Synthetic reservation supply" });
  const reservations: string[] = [];
  const line = (offerId: string, quantity = 1) => ({ line_id: randomUUID(),product_id: product.id,product_revision: 1,offer_id: offerId,warehouse_id: wh,quantity });
  const available = (offerId: string, clockNamespace: string | null = null) => identity.sql.begin((tx) => offerAvailability(tx, {
    product_id: product.id,product_revision: 1,offer_id: offerId,warehouse_id: wh,clock_namespace: clockNamespace }));
  const close = async () => {
    for (const reservationId of reservations) {
      await identity.sql.begin((tx) => releaseReservation(tx, reservationId, "Synthetic fixture completed"));
      await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${reservationId}`;
    }
    await cleanup(identity, [owner]); for (const warehouseId of warehouseIds) await identity.sql`update app.warehouse set active=false where id=${warehouseId}`;
    await identity.sql.end();
  };
  return { identity,owner,wh,stockA,stockB,product,unit,pack,bundle,positionA,positionB,call,line,available,reservations,close };
}

test("two actual offers compete for one shared physical component under real PostgreSQL locks", async () => {
  const f = await setup(1,1);
  try {
    const expires = new Date(Date.now()+60000).toISOString();
    let release: () => void = () => {}; let ready: () => void = () => {};
    const held = new Promise<void>((r) => { release=r; }); const locked = new Promise<void>((r) => { ready=r; });
    const blocker = f.identity.sql.begin(async (tx) => { await tx`select id from app.inventory_balance where id=${f.positionA.id} for update`; ready(); await held; });
    let pending: Promise<PromiseSettledResult<Awaited<ReturnType<typeof reserveOffers>>>[]> | undefined;
    try {
      await locked;
      pending = Promise.allSettled([f.unit.id,f.bundle.id].map((offerId) => f.identity.sql.begin((tx) => reserveOffers(tx, {
        key: `race:${randomUUID()}`,lines: [f.line(offerId)],expires_at: expires,actor_id: f.owner.id }))));
      let waiting=0;
      for (let i=0;i<100;i++) {
        const [row] = await f.identity.sql`select count(*)::int as n from pg_stat_activity where datname='99ribu_test' and usename='99ribu_test_app'
          and wait_event_type='Lock' and query like '%app.inventory_balance b join jsonb_to_recordset%'`; waiting=row.n;
        if (waiting===2) break; await setTimeout(20);
      }
      assert.equal(waiting,2); release(); await blocker;
      const results = await pending; const won = results.filter((r) => r.status === "fulfilled"); assert.equal(won.length,1);
      for (const result of results) if (result.status === "fulfilled") f.reservations.push(result.value.header.id);
      else { assert.equal(result.reason.status,409); assert.equal(result.reason.code,"INSUFFICIENT_STOCK"); }
      const [balance] = await f.identity.sql`select on_hand,reserved,quarantined from app.inventory_balance where id=${f.positionA.id}`;
      assert.deepEqual(balance,{ on_hand:1,reserved:1,quarantined:0 }); assert.equal(await f.available(f.unit.id),0);
    } finally { release(); await Promise.allSettled([blocker,pending].filter((p) => p!==undefined)); }
  } finally { await f.close(); }
});

test("cart requirements aggregate shared components, failed batches roll back, retry and release never duplicate stock effects", async () => {
  const f = await setup(1,2);
  try {
    assert.equal(await f.available(f.unit.id),1); assert.equal(await f.available(f.pack.id),0); assert.equal(await f.available(f.bundle.id),1);
    const input = { key:`aggregate:${randomUUID()}`,lines:[f.line(f.unit.id),f.line(f.bundle.id)],expires_at:new Date(Date.now()+60000).toISOString(),actor_id:f.owner.id };
    await assert.rejects(f.identity.sql.begin((tx) => reserveOffers(tx,input)), (error: unknown) => error instanceof Error && "code" in error && error.code === "INSUFFICIENT_STOCK");
    const [absent] = await f.identity.sql`select count(*)::int as n from app.stock_reservation where key=${input.key}`; assert.equal(absent.n,0);
    const [unchanged] = await f.identity.sql`select sum(reserved)::int as n from app.inventory_balance where warehouse_id=${f.wh}`; assert.equal(unchanged.n,0);
    await f.call("inventory","/inventory/movements",{ warehouse_id:f.wh,stock_item_id:f.stockA.id,kind:"receive",quantity:4,expected_version:1,reason:"Synthetic extra components" });
    const reserved = await f.identity.sql.begin((tx) => reserveOffers(tx,input)); f.reservations.push(reserved.header.id);
    assert.equal(await f.available(f.unit.id),3); assert.equal(await f.available(f.pack.id),1); assert.equal(await f.available(f.bundle.id),1);
    assert.deepEqual(await f.identity.sql.begin((tx) => reserveOffers(tx,input)),reserved);
    await assert.rejects(f.identity.sql.begin((tx) => reserveOffers(tx,{ ...input,lines:[{ ...input.lines[0],quantity:2 },input.lines[1]] })), (error: unknown) => error instanceof Error && "code" in error && error.code === "IDEMPOTENCY_CONFLICT");
    const released = await f.identity.sql.begin((tx) => releaseReservation(tx,reserved.header.id,"Synthetic cancellation")); assert.equal(released.header.status,"released");
    await f.identity.sql.begin((tx) => releaseReservation(tx,reserved.header.id,"Repeated cancellation"));
    const [movement] = await f.identity.sql`select count(*)::int as n from app.stock_movement where source_ref=${reserved.header.id} and kind='release'`;
    assert.equal(movement.n,reserved.components.length); assert.equal(await f.available(f.unit.id),5);
    const rollback = new Error("ROLLBACK_OWN_RESERVATION");
    await assert.rejects(f.identity.sql.begin(async (tx) => { await reserveOffers(tx,{ ...input,key:`rollback:${randomUUID()}` }); throw rollback; }), (error: unknown) => error === rollback);
    assert.equal(await f.available(f.unit.id),5);
  } finally { await f.close(); }
});

test("FIFO batch allocations, explicit fixture expiry and real MFA clocks remain separate", async () => {
  const namespace = `inv-${randomUUID().slice(0,8)}`; const f = await setup(0,1,namespace);
  try {
    const [date] = await f.identity.sql`select (clock_timestamp() at time zone timezone)::date::text as today,((clock_timestamp() at time zone timezone)::date+30)::text as later from app.warehouse where id=${f.wh}`;
    const early = await f.call("inventory","/inventory/lots",{ warehouse_id:f.wh,stock_item_id:f.stockA.id,code:`EARLY-${randomUUID()}`,expires_on:date.today,reason:"Synthetic early batch" });
    const later = await f.call("inventory","/inventory/lots",{ warehouse_id:f.wh,stock_item_id:f.stockA.id,code:`LATER-${randomUUID()}`,expires_on:date.later,reason:"Synthetic late batch" });
    for (const lotId of [early.id,later.id,null]) await f.call("inventory","/inventory/movements",{ warehouse_id:f.wh,stock_item_id:f.stockA.id,lot_id:lotId,kind:"receive",quantity:2,expected_version:0,reason:"Synthetic batch supply" });
    const clock = await readFixtureClock("test",namespace);
    const reserved = await f.identity.sql.begin((tx) => reserveOffers(tx,{ key:`clock:${randomUUID()}`,lines:[f.line(f.unit.id,3)],
      expires_at:new Date(Date.parse(clock.now)+120000).toISOString(),clock_namespace:namespace })); f.reservations.push(reserved.header.id);
    assert.equal(reserved.components.find((c) => c.lot_id===early.id)?.quantity,2);
    assert.equal(reserved.components.find((c) => c.lot_id===later.id)?.quantity,1);
    assert.ok(!reserved.components.some((c) => c.lot_id===null));
    await advanceFixtureClock("test",namespace,172800,clock.version);
    const expired = await f.identity.sql.begin((tx) => releaseReservation(tx,reserved.header.id,"Synthetic scenario expiry",null,true)); assert.equal(expired.header.status,"expired");
    assert.equal(await f.available(f.unit.id,namespace),4); assert.equal(await f.available(f.unit.id),6);
    const principal = await getPrincipal(f.owner.browser.request("/api/v1/me"),f.identity); assert.ok(principal.roles.includes("owner") && principal.mfaAt);
  } finally { await f.close(); }
});

async function scheduledHold(f: Awaited<ReturnType<typeof setup>>, namespace: string) {
  const clock = await readFixtureClock("test", namespace);
  const reserved = await f.identity.sql.begin((tx) => reserveOffers(tx, { key:`worker:${randomUUID()}`,lines:[f.line(f.unit.id)],
    expires_at:new Date(Date.parse(clock.now)+120000).toISOString(),clock_namespace:namespace }));
  f.reservations.push(reserved.header.id);
  const [job] = await f.identity.sql`select id,status,attempts,run_at>clock_timestamp() as future from app.outbox_job where payload->>'reservationId'=${reserved.header.id}`;
  assert.equal(job.status,"pending"); assert.equal(job.future,true);
  return { reservationId:reserved.header.id,jobId:job.id as string,clock };
}

test("two real expiry workers release a scenario-due hold before its wall-clock schedule exactly once", async () => {
  const namespace=`iw-${randomUUID().slice(0,8)}`; const f=await setup(2,0,namespace);
  let release=()=>{};let blocker:Promise<unknown>|undefined;let pending:Promise<unknown>[]=[];
  try {
    const unrelated=await scheduledHold(f,namespace);
    const h=await scheduledHold(f,namespace);
    await advanceFixtureClock("test",namespace,121,h.clock.version);
    let ready=()=>{},blockerPid=0,finished=0;
    const locked=new Promise<void>(r=>{ready=r;}),held=new Promise<void>(r=>{release=r;});
    blocker=f.identity.sql.begin(async tx=>{
      const [backend]=await tx`select pg_backend_pid()::int pid`;blockerPid=backend.pid;
      await tx`select id from app.inventory_balance where id=${f.positionA.id} for update`;ready();await held;
    });
    await locked;
    const competing=[0,1].map(()=>exec(process.execPath,[...worker,h.jobId],{env:childEnvironment,timeout:10000}).then(result=>{finished++;return result;}));
    pending=competing;
    let waiting=0;
    for(let i=0;i<150;i++){
      const [observed]=await f.identity.sql`select count(*)::int n from pg_stat_activity where datname='99ribu_test'
        and usename='99ribu_test_app' and ${blockerPid}=any(pg_blocking_pids(pid)) and wait_event_type='Lock'`;
      waiting=observed.n;if(waiting===1&&finished===1)break;await setTimeout(20);
    }
    assert.equal(waiting,1);assert.equal(finished,1);release();await blocker;
    const runs=await Promise.all(competing);
    assert.ok(runs.every((r)=>r.stdout.includes("worker_ready")));
    const [job]=await f.identity.sql`select status,attempts,result from app.outbox_job where id=${h.jobId}`;
    assert.equal(job.status,"completed"); assert.equal(job.attempts,1); assert.equal(job.result.status,"expired");
    const [moves]=await f.identity.sql`select count(*)::int as n from app.stock_movement where source_ref=${h.reservationId} and kind='release'`;
    assert.equal(moves.n,1); assert.equal(await f.available(f.unit.id),1);
    await exec(process.execPath,[...worker,h.jobId],{ env:childEnvironment,timeout:10000 });
    const [again]=await f.identity.sql`select attempts from app.outbox_job where id=${h.jobId}`; assert.equal(again.attempts,1);
    const [untouched]=await f.identity.sql`select j.status,j.attempts,r.status as reservation_status from app.outbox_job j
      join app.stock_reservation r on r.id=${unrelated.reservationId} where j.id=${unrelated.jobId}`;
    assert.deepEqual(untouched,{status:'pending',attempts:0,reservation_status:'active'});
  } finally {release();await Promise.allSettled([blocker,...pending].filter(p=>p!==undefined));await f.close();}
});

test("worker death after the stock effect but before commit rolls back effect and completion together", async () => {
  const namespace=`ic-${randomUUID().slice(0,8)}`; const f=await setup(1,0,namespace);
  let child: ReturnType<typeof spawn> | undefined; let exited: Promise<unknown> | undefined;
  try {
    const h=await scheduledHold(f,namespace); await advanceFixtureClock("test",namespace,121,h.clock.version);
    child=spawn(process.execPath,[...driver,h.jobId,"pause"],{ env:childEnvironment,stdio:["ignore","pipe","ignore"] });
    exited=once(child,"exit"); const running=child;
    await new Promise<void>((resolve,reject)=>{
      let output=""; const timer=globalThis.setTimeout(()=>reject(new Error("Inventory worker missed its uncommitted barrier.")),5000);
      assert.ok(running.stdout);
      running.stdout.on("data",(chunk:Buffer)=>{ output+=chunk.toString(); if(output.includes("effect_ready")){ globalThis.clearTimeout(timer); resolve(); } });
      running.once("exit",()=>{ globalThis.clearTimeout(timer); reject(new Error("Inventory worker exited before its barrier.")); });
    });
    const [before]=await f.identity.sql`select r.status,b.reserved,o.attempts,o.status as job_status from app.stock_reservation r
      join app.stock_reservation_component c on c.reservation_id=r.id join app.inventory_balance b on b.id=c.balance_id
      join app.outbox_job o on o.id=${h.jobId} where r.id=${h.reservationId}`;
    assert.deepEqual(before,{ status:"active",reserved:1,attempts:0,job_status:"pending" });
    assert.equal(child.kill("SIGKILL"),true); await exited;
    await exec(process.execPath,[...worker,h.jobId],{ env:childEnvironment,timeout:10000 });
    const [after]=await f.identity.sql`select r.status,o.attempts from app.stock_reservation r join app.outbox_job o on o.id=${h.jobId} where r.id=${h.reservationId}`;
    assert.deepEqual(after,{ status:"expired",attempts:1 });
    const [moves]=await f.identity.sql`select count(*)::int as n from app.stock_movement where source_ref=${h.reservationId} and kind='release'`;
    assert.equal(moves.n,1); assert.equal(await f.available(f.unit.id),1);
  } finally {
    if(child && child.exitCode===null && child.signalCode===null){ child.kill("SIGKILL"); await exited; }
    await f.close();
  }
});

test("expiry waits without consuming attempts, rejects malformed jobs and respects finite database retry backoff", async () => {
  const namespace=`ib-${randomUUID().slice(0,8)}`; const f=await setup(1,0,namespace);
  let release=()=>{}; let blocker: Promise<unknown> | undefined; let invalidId: string | undefined;
  try {
    const h=await scheduledHold(f,namespace);
    await f.identity.sql`update app.outbox_job set run_at=clock_timestamp()-interval '1 second',max_attempts=2 where id=${h.jobId}`;
    assert.equal(await runOneJob(f.identity.sql,{},h.jobId),true);
    const [waiting]=await f.identity.sql`select attempts,status,run_at>clock_timestamp() as delayed from app.outbox_job where id=${h.jobId}`;
    assert.deepEqual(waiting,{ attempts:0,status:"pending",delayed:true });
    invalidId=await f.identity.sql.begin((tx)=>enqueueJob(tx,"inventory.reservation.expire",`invalid:${randomUUID()}`,{ reservationId:"invalid" }));
    assert.equal(await runOneJob(f.identity.sql,{},invalidId),true);
    const [invalid]=await f.identity.sql`select status,last_error from app.outbox_job where id=${invalidId}`;
    assert.deepEqual(invalid,{ status:"failed",last_error:"INVALID_PAYLOAD" }); assert.equal(await f.available(f.unit.id),0);
    await advanceFixtureClock("test",namespace,121,h.clock.version);
    let ready=()=>{}; const locked=new Promise<void>((r)=>{ready=r;}); const held=new Promise<void>((r)=>{release=r;});
    blocker=f.identity.sql.begin(async(tx)=>{ await tx`select id from app.inventory_balance where id=${f.positionA.id} for update`; ready(); await held; });
    await locked;
    await exec(process.execPath,[...driver,h.jobId,"timeout"],{ env:childEnvironment,timeout:5000 });
    const [retry]=await f.identity.sql`select status,attempts,last_error,run_at>clock_timestamp() as delayed from app.outbox_job where id=${h.jobId}`;
    assert.deepEqual(retry,{ status:"pending",attempts:1,last_error:"TEMPORARY_DATABASE_FAILURE",delayed:true });
    await f.identity.sql`update app.outbox_job set run_at=clock_timestamp()+interval '1 minute' where id=${h.jobId}`;
    // A scenario-due deadline must not bypass a real retry delay.
    assert.equal(await runOneJob(f.identity.sql,{},h.jobId),false);
    await f.identity.sql`update app.outbox_job set run_at=clock_timestamp()-interval '1 second' where id=${h.jobId}`;
    await exec(process.execPath,[...driver,h.jobId,"timeout"],{ env:childEnvironment,timeout:5000 });
    const [failed]=await f.identity.sql`select status,attempts,last_error from app.outbox_job where id=${h.jobId}`;
    assert.deepEqual(failed,{ status:"failed",attempts:2,last_error:"TEMPORARY_DATABASE_FAILURE" });
    release(); await blocker;
    const [hold]=await f.identity.sql`select status from app.stock_reservation where id=${h.reservationId}`;
    assert.equal(hold.status,"active"); assert.equal(await f.available(f.unit.id),0);
  } finally {
    release(); await blocker;
    if(invalidId) await f.identity.sql`delete from app.outbox_job where id=${invalidId}`;
    await f.close();
  }
});
