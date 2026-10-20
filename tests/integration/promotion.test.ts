import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import test from 'node:test';
import {reservePromotions,resolvePromotionReservation} from '../../src/modules/promotions/reservations.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {promotionFixture,denied} from './promotion-fixture.ts';

test('actual MFA configuration handlers preserve history, strict money validation and authorized idempotent recovery',async()=>{
 const f=await promotionFixture();try{
  const body=f.config();const key=randomUUID();const response=await f.call('',body,key);assert.equal(response.status,201);const first=await response.json();
  assert.deepEqual(await (await f.call('',body,key)).json(),first);assert.equal((await f.call('',{...body,value:1},key)).status,409);
  for(const patch of [{kind:['fixed']},{value:-1},{value:1.5},{value:Number.MAX_SAFE_INTEGER+1},{kind:'percentage',value:10001},{payment_methods:['prepaid','prepaid']},{region_ids:['bad / id']},{budget:undefined},{starts_at:'2026-02-30T00:00:00.000Z'},{clock_namespace:'ignored'}]) assert.equal((await f.call('',f.config(patch))).status,400);
  assert.equal((await f.call(`/${first.id}/versions`,f.config({expected_version:1,value:5000}))).status,201);
  assert.equal((await f.call(`/${first.id}/versions`,f.config({expected_version:1}))).status,409);
  const history=await (await f.call(`/${first.id}/versions?limit=1`)).json();assert.equal(history.data[0].version,2);assert.equal(history.pagination.next_cursor,'2');
  const old=await (await f.call(`/${first.id}/versions?cursor=2`)).json();assert.equal(old.data[0].value,10001);
  assert.equal((await f.call(`/${first.id}?as_of=2030`)).status,400);
  const buyer=await actor(f.identity,'buyer',[]);f.users.push(buyer);assert.equal((await f.call('',undefined,undefined,buyer)).status,403);
  const ecom=await actor(f.identity,'ecommerce_admin',[]);f.users.push(ecom);await enroll(ecom.browser,ecom.password);assert.equal((await f.call('',f.config(),undefined,ecom)).status,201);
  await f.identity.sql`update app.role_grant set roles=ARRAY['warehouse']::text[] where user_id=${f.owner.id}`;
  assert.equal((await f.call('',body,key)).status,403);
 }finally{await f.close();}
});

test('caps, percent rounding, eligible remaining-fee stacking and immutable parent/shipment snapshots conserve every rupiah',async()=>{
 const f=await promotionFixture();try{
  const a=await f.campaign({kind:'percentage',value:5000,maximum_per_order:20000,priority:20,service_ids:['regular']});
  const b=await f.campaign({value:10001,priority:10});const input=await f.input([b.id,a.id]);input.shipments[1].shipping_fee=10001;
  const held=await f.reserve(input);assert.equal(held.merchandise_amount,99000);assert.equal(held.shipping_amount,20001);assert.equal(held.subsidy_amount,20001);
  const first=held.allocations.find((v)=>v.promotion_id===a.id);assert.equal(first?.amount,10001);assert.deepEqual(first?.shipments,[{shipment_id:'a',amount:5000},{shipment_id:'b',amount:5001}]);
  assert.deepEqual(await f.reserve(input),held);
  await assert.rejects(f.reserve({...input,shipments:[{...input.shipments[0],shipping_fee:10001},input.shipments[1]]}),denied('IDEMPOTENCY_CONFLICT'));
  assert.equal((await f.call(`/${a.id}/versions`,f.config({expected_version:1,active:false,budget:100010}))).status,201);
  assert.equal((await f.call(`/${a.id}/versions`,f.config({expected_version:2,active:false,budget:1}))).status,409);
  const frozen=await f.identity.sql`select version_id from app.promotion_allocation where reservation_id=${held.id} and promotion_id=${a.id}`;assert.equal(frozen[0].version_id,a.version_id);
  const consumed=await f.identity.sql.begin((tx)=>resolvePromotionReservation(tx,held.id,'consumed','Synthetic shipment booking'));assert.equal(consumed.status,'consumed');
  assert.equal((await f.identity.sql.begin((tx)=>resolvePromotionReservation(tx,held.id,'released','No automatic credit'))).status,'consumed');
  const [counter]=await f.identity.sql`select reserved_amount::text,committed_amount::text from app.promotion where id=${a.id}`;assert.deepEqual(counter,{reserved_amount:'0',committed_amount:'10001'});
  const exclusive=await f.campaign({stacking:'exclusive'});await assert.rejects(f.reserve(await f.input([b.id,exclusive.id])),denied('PROMOTION_STACKING_CONFLICT'));
  const filtered=await f.campaign({region_ids:['other']});await assert.rejects(f.reserve(await f.input([filtered.id])),denied('NO_PROMOTION_BENEFIT'));
  const scoped=await f.campaign({region_ids:['malang'],service_ids:['regular'],payment_methods:['cod'],minimum_merchandise:198000});
  await assert.rejects(f.reserve(await f.input([scoped.id])),denied('PROMOTION_INELIGIBLE'));
  const cod=await f.input([scoped.id]);cod.payment_method='cod';cod.lines[0].quantity=2;assert.equal((await f.reserve(cod)).merchandise_amount,198000);
 }finally{await f.close();}
});

async function race(kind:'budget'|'buyer'){
 const f=await promotionFixture();try{
  const p=await f.campaign(kind==='budget'?{budget:10001}:{per_buyer_limit:1});
  let ready=()=>{};let release=()=>{};const locked=new Promise<void>((r)=>{ready=r;});const held=new Promise<void>((r)=>{release=r;});
  const blocker=f.identity.sql.begin(async(tx)=>{await tx`select id from app.promotion where id=${p.id} for update`;ready();await held;});
  let pending:Promise<PromiseSettledResult<Awaited<ReturnType<typeof reservePromotions>>>[]>|undefined;
  try{
   await locked;const inputs=await Promise.all([f.input([p.id]),f.input([p.id],kind==='buyer'?'a'.repeat(64):'b'.repeat(64))]);
   pending=Promise.allSettled(inputs.map((input)=>f.identity.sql.begin((tx)=>reservePromotions(tx,input))));
   let waiting=0;for(let i=0;i<100;i++){const [row]=await f.identity.sql`select count(*)::int as n from pg_stat_activity where datname='99ribu_test' and usename='99ribu_test_app' and wait_event_type='Lock' and query like '%app.promotion where id in%'`;waiting=row.n;if(waiting===2) break;await setTimeout(20);}
   assert.equal(waiting,2);release();await blocker;const results=await pending;assert.equal(results.filter((r)=>r.status==='fulfilled').length,1);
   for(const result of results) if(result.status==='fulfilled') f.reservations.push(result.value.id);else assert.equal(result.reason.code,kind==='budget'?'PROMOTION_BUDGET_EXHAUSTED':'PROMOTION_BUYER_LIMIT');
   const reservationId=f.reservations[0];const [before]=await f.identity.sql`select reserved_amount::text,committed_amount::text from app.promotion where id=${p.id}`;assert.deepEqual(before,{reserved_amount:'10001',committed_amount:'0'});
   await f.identity.sql.begin((tx)=>resolvePromotionReservation(tx,reservationId,'released','Synthetic cancellation'));await f.identity.sql.begin((tx)=>resolvePromotionReservation(tx,reservationId,'released','Repeated cancellation'));
   const [effects]=await f.identity.sql`select count(*)::int as n from app.promotion_movement where reservation_id=${reservationId} and kind='release'`;assert.equal(effects.n,1);
   const retry=await f.reserve(await f.input([p.id]));assert.equal(retry.status,'active');
  }finally{release();await Promise.allSettled([blocker,pending].filter((p)=>p!==undefined));}
 }finally{await f.close();}
}
test('two PostgreSQL waiters cannot oversubscribe the last campaign budget',()=>race('budget'));
test('two PostgreSQL waiters cannot exceed a shared customer quota; release restores only its own use',()=>race('buyer'));

test('a failed multi-campaign claim rolls back every budget/quota snapshot and later quota changes are prospective',async()=>{
 const f=await promotionFixture();try{
  const a=await f.campaign({value:5000});const b=await f.campaign({value:5000,budget:5000});await f.reserve(await f.input([b.id],'b'.repeat(64)));
  const input=await f.input([a.id,b.id]);await assert.rejects(f.reserve(input),denied('PROMOTION_BUDGET_EXHAUSTED'));
  const [count]=await f.identity.sql`select count(*)::int as n from app.promotion_reservation where key=${input.key}`;assert.equal(count.n,0);
  const [head]=await f.identity.sql`select reserved_amount::text from app.promotion where id=${a.id}`;assert.equal(head.reserved_amount,'0');
  const held=await f.reserve(await f.input([a.id]));assert.equal((await f.call(`/${a.id}/versions`,f.config({expected_version:1,value:5000,per_buyer_limit:1}))).status,201);
  await assert.rejects(f.reserve(await f.input([a.id])),denied('PROMOTION_BUYER_LIMIT'));
  assert.equal((await f.identity.sql.begin((tx)=>resolvePromotionReservation(tx,held.id,'consumed','Honor frozen issued terms'))).status,'consumed');
 }finally{await f.close();}
});


test('large safe-integer shipping values retain exact BigInt percent math and reject an overflowing parent total',async()=>{
 const f=await promotionFixture();try{
  const p=await f.campaign({kind:'percentage',value:9999,maximum_per_order:Number.MAX_SAFE_INTEGER,budget:Number.MAX_SAFE_INTEGER});
  const input=await f.input([p.id]);input.shipments[0].shipping_fee=Number.MAX_SAFE_INTEGER-1;input.shipments[1].shipping_fee=1;
  const held=await f.reserve(input);const expected=Number((BigInt(Number.MAX_SAFE_INTEGER)*9999n+5000n)/10000n);assert.equal(held.subsidy_amount,expected);
  assert.equal(held.allocations[0].shipments.reduce((sum,s)=>sum+BigInt(s.amount),0n),BigInt(expected));
  const overflow=await f.input([p.id],'c'.repeat(64));overflow.shipments[0].shipping_fee=Number.MAX_SAFE_INTEGER;overflow.shipments[1].shipping_fee=1;
  await assert.rejects(f.reserve(overflow),denied('PROMOTION_AMOUNT_LIMIT'));
 }finally{await f.close();}
});
