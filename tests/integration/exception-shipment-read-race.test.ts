import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';
import type {Sql,TransactionSql} from 'postgres';
import {processDatabaseJob,type DatabaseJob} from '../../src/jobs/worker.ts';
import {ingestWaybillEvent,simulateWaybillIssue} from '../../src/modules/fulfillment/local.ts';
import {handleFulfillment} from '../../src/modules/fulfillment/routes.ts';
import {lockPaymentOrder} from '../../src/modules/payments/attempts.ts';
import {fulfillmentFixture} from './fulfillment-fixture.ts';

test('shipment detail waits for the exact issuer and returns one coherent booking, tracking and version',async()=>{
 const f=await fulfillmentFixture(),sql=f.identity.sql;
 let release=()=>{},entered=()=>{},failed=(_error:unknown)=>{},writerPid=0,readerPid=0;
 const released=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>((resolve,reject)=>{entered=resolve;failed=reject;});
 let writing:Promise<unknown>|undefined,reading:Promise<Response>|undefined;
 try{
  const booking=await f.book();await f.run(booking.creation_job_id);
  for(const event of await sql`select callback_job_id from app.waybill_provider_event where booking_id=${booking.id}`)await f.run(event.callback_job_id);
  const callbackId=await ingestWaybillEvent(sql,await simulateWaybillIssue(sql,'test',booking.id));
  writing=sql.begin(async tx=>{
   const [job]=await tx<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where id=${callbackId} and status='pending' for update`;
   assert.ok(job);await lockPaymentOrder(tx,f.order.id);writerPid=Number((await tx`select pg_backend_pid() pid`)[0].pid);
   entered();await released;await processDatabaseJob(tx,job);
  });void writing.catch(failed);await ready;
  const name=`s33-shipment-read-${randomUUID()}`;
  // Name the real reader transaction solely to observe PostgreSQL's blocker.
  // The handler, worker, transactions and source effects remain production code.
  const named=new Proxy(sql,{get(target,property,receiver){
   if(property==='begin')return (run:(tx:TransactionSql)=>Promise<unknown>)=>target.begin(async tx=>{
    await tx`select set_config('application_name',${name},true)`;readerPid=Number((await tx`select pg_backend_pid() pid`)[0].pid);return run(tx);
   });return Reflect.get(target,property,receiver);
  }}) as Sql;
  reading=handleFulfillment(f.owner.browser.request(`/api/v1/admin/shipments/${f.parcels[0].shipment_id}`),{...f.identity,sql:named});
  const deadline=Date.now()+5000;let observed=false;
  while(Date.now()<deadline){
   if(readerPid){const [activity]=await sql`select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=${readerPid} and application_name=${name}`;
    if(activity?.wait_event_type==='Lock'&&activity.blockers.includes(writerPid)){observed=true;break;}}
   await setImmediate();
  }
  assert.equal(observed,true,'The shipment reader must wait for this exact original issuance writer');
  release();await writing;const response=await reading,payload=await response.json();assert.equal(response.status,200);
  const [current]=await sql`select f.revision,f.tracking_number,b.status booking_status from app.fulfillment f join app.shipment_booking b on b.id=f.booking_id where f.id=${f.parcels[0].id}`;
  assert.equal(payload.status,'packed');assert.equal(payload.tracking_number,current.tracking_number);
  assert.equal(payload.booking_status,current.booking_status,'Shipment status/tracking and booking metadata must describe the same committed issuance');
  assert.equal(payload.version,current.revision);assert.equal(payload.booking_id,booking.id);
  assert.equal((await sql`select status from app.outbox_job where id=${callbackId}`)[0].status,'completed');
 }finally{
  release();await Promise.allSettled([...(writing?[writing]:[]),...(reading?[reading]:[])]);await f.close();
 }
});
