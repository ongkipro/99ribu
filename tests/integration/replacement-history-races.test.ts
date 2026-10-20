import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';
import type {Sql,TransactionSql} from 'postgres';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {readOrderHistory} from '../../src/modules/finance/history.ts';
import {createReturn,decideReturn} from '../../src/modules/returns/cases.ts';
import {ingestParcelReceiptSource,simulateParcelReceipt} from '../../src/modules/returns/receipt-source.ts';
import {createReplacement} from '../../src/modules/returns/replacements.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor} from './fulfillment-fixture.ts';
import {returnFixture} from './return-fixture.ts';

function nested(sql:Sql,tx:TransactionSql){
 return new Proxy(sql,{get(target,property,receiver){
  if(property==='begin')return (run:(inner:TransactionSql)=>Promise<unknown>)=>tx.savepoint(run);
  return Reflect.get(target,property,receiver);
 }}) as Sql;
}

// Requires reviewed/applied0022. This exercises actual writers and observes the
// exact PostgreSQL blocker; elapsed time is never evidence of the interleaving.
test('history rechecks every physical origin after an unchanged order lock waits for replacement creation',async()=>{
 const f=await returnFixture('cod'),sql=f.identity.sql;
 let release=()=>{},entered=()=>{},failed=(_error:unknown)=>{},writerPid=0,readerPid=0;
 const released=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>((resolve,reject)=>{entered=resolve;failed=reject;});
 let reader:Awaited<ReturnType<typeof actor>>|undefined,writer:Promise<unknown>|undefined,reading:Promise<unknown>|undefined;
 try{
  const unit=f.units[0],parcel=f.parcels.find(row=>row.shipment_id===unit.shipment_id),booking=f.bookings.find(row=>row.fulfillment_id===parcel?.id);assert.ok(booking);
  await f.run(await ingestParcelReceiptSource(sql,await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:[unit.id]})));
  const claimBody={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'defective',details:'SYNTHETIC original quantity awaiting replacement'}],requested_resolution:'replacement'};
  const claimRequest=f.client.request(`/api/v1/orders/${f.order.id}/returns`,claimBody);claimRequest.headers.set('idempotency-key',randomUUID());
  const buyer=await commerceActor(f.client.request('/api/v1/carts'),f.identity);assert.ok(buyer);
  const claim=await createReturn(claimRequest,f.identity,buyer,f.order.id,claimBody) as {id:string};
  const decision={decision:'approve_replacement',expected_version:1,requires_goods:false,reason:'SYNTHETIC explicit company-fault goods waiver'};
  const decisionRequest=f.owner.browser.request(`/api/v1/admin/returns/${claim.id}/decisions`,decision);decisionRequest.headers.set('idempotency-key',randomUUID());
  await decideReturn(decisionRequest,f.identity,f.principal,claim.id,decision);
  const [returnItem]=await sql`select id from app.return_item where case_id=${claim.id}`;
  const warehouseId=randomUUID();
  await sql`insert into app.warehouse (id,name,city,timezone,active) values (${warehouseId},'SYNTHETIC replacement scope origin','Jakarta','Asia/Jakarta',true)`;
  await sql`insert into app.local_fixture_warehouse (namespace,fixture_id,warehouse_id) values (${f.namespace},'replacement-scope',${warehouseId})`;
  const originalOrigins=[...new Set(f.parcels.map(row=>String(row.warehouse_id)))];
  reader=await actor(f.identity,'customer_service',originalOrigins);await enroll(reader.browser,reader.password);
  await sql`update app.role_grant set permissions=${['orders.history.read']},revision=revision+1 where user_id=${reader.id}`;
  const principal=await getPrincipal(reader.browser.request('/api/v1/me'),f.identity),name=`s32-history-${randomUUID()}`;
  const replacementBody={return_item_ids:[returnItem.id],warehouse_id:warehouseId,expected_version:2,reason:'SYNTHETIC actual stock-wait replacement from a new origin'};
  const replacementRequest=f.owner.browser.request(`/api/v1/admin/returns/${claim.id}/replacements`,replacementBody);replacementRequest.headers.set('idempotency-key',randomUUID());
  writer=sql.begin(async tx=>{
   writerPid=Number((await tx`select pg_backend_pid() pid`)[0].pid);
   const result=await createReplacement(replacementRequest,{...f.identity,sql:nested(sql,tx)},f.principal,claim.id,replacementBody);
   entered();await released;return result;
  });void writer.catch(failed);await ready;
  const named=new Proxy(sql,{get(target,property,receiver){
   if(property==='begin')return (run:(tx:TransactionSql)=>Promise<unknown>)=>target.begin(async tx=>{
    await tx`select set_config('application_name',${name},true)`;readerPid=Number((await tx`select pg_backend_pid() pid`)[0].pid);return run(tx);
   });return Reflect.get(target,property,receiver);
  }}) as Sql;
  reading=readOrderHistory({...f.identity,sql:named},principal,f.order.id,new URL(`http://127.0.0.1:3099/api/v1/admin/orders/${f.order.id}`));
  const denied=assert.rejects(reading,{status:404,code:'NOT_FOUND'});void denied.catch(()=>{});
  const deadline=Date.now()+5000;let observed=false;
  while(Date.now()<deadline){
   if(readerPid){const [activity]=await sql`select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=${readerPid} and application_name=${name}`;
    if(activity?.wait_event_type==='Lock'&&activity.blockers.includes(writerPid)){observed=true;break;}}
   await setImmediate();
  }
  assert.equal(observed,true,'The history reader must wait on this exact replacement writer');
  release();const replacement=await writer as {id:string;status:string};await denied;
  assert.equal(replacement.status,'awaiting_stock');
  assert.equal((await sql`select warehouse_id from app.replacement_shipment where id=${replacement.id}`)[0].warehouse_id,warehouseId);
  assert.equal((await sql`select count(*)::int n from app.audit_event where actor_id=${reader.id} and action='orders.history.read' and subject_id=${f.order.id} and outcome='allowed'`)[0].n,0);
 }finally{
  release();await Promise.allSettled([...(writer?[writer]:[]),...(reading?[reading]:[])]);
  try{if(reader)await closeFulfillmentActor(f.identity,reader);}finally{await f.close();}
 }
});
