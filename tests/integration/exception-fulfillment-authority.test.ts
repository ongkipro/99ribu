import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';
import type {Sql,TransactionSql} from 'postgres';
import {handleFulfillment} from '../../src/modules/fulfillment/routes.ts';
import {lockPaymentOrder} from '../../src/modules/payments/attempts.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor,fulfillmentFixture} from './fulfillment-fixture.ts';

test('original preparation rechecks current warehouse assignment after waiting on the exact parent',async()=>{
 const f=await fulfillmentFixture(),sql=f.identity.sql;
 let staff:Awaited<ReturnType<typeof actor>>|undefined,release=()=>{},entered=()=>{},failed=(_error:unknown)=>{},holderPid=0,writerPid=0;
 const released=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>((resolve,reject)=>{entered=resolve;failed=reject;});
 let holding:Promise<unknown>|undefined,writing:Promise<Response>|undefined;
 try{
  const parcel=f.parcels[0],key=randomUUID();staff=await actor(f.identity,'warehouse',[parcel.warehouse_id]);await enroll(staff.browser,staff.password);
  const before=await sql`select revision,status,prepared_at from app.fulfillment where id=${parcel.id}`;
  holding=sql.begin(async tx=>{await lockPaymentOrder(tx,f.order.id);holderPid=Number((await tx`select pg_backend_pid() pid`)[0].pid);entered();await released;});
  void holding.catch(failed);await ready;
  const name=`s33-prepare-scope-${randomUUID()}`,named=new Proxy(sql,{get(target,property,receiver){
   if(property==='begin')return (run:(tx:TransactionSql)=>Promise<unknown>)=>target.begin(async tx=>{
    await tx`select set_config('application_name',${name},true)`;writerPid=Number((await tx`select pg_backend_pid() pid`)[0].pid);return run(tx);
   });return Reflect.get(target,property,receiver);
  }}) as Sql;
  const request=staff.browser.request(`/api/v1/admin/fulfillments/${parcel.id}/preparations`,{expected_version:1});request.headers.set('idempotency-key',key);
  writing=handleFulfillment(request,{...f.identity,sql:named});
  const deadline=Date.now()+5000;let blocked=false;
  while(Date.now()<deadline){
   if(writerPid){const [activity]=await sql`select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=${writerPid} and application_name=${name}`;
    if(activity?.wait_event_type==='Lock'&&activity.blockers.includes(holderPid)){blocked=true;break;}}
   await setImmediate();
  }
  assert.equal(blocked,true,'The real preparation must first pass initial scope and wait on this exact parent');
  await sql`delete from app.warehouse_membership where user_id=${staff.id} and warehouse_id=${parcel.warehouse_id}`;
  release();await holding;const response=await writing,payload=await response.json();assert.equal(response.status,404);assert.equal(payload.code,'NOT_FOUND');
  assert.deepEqual(await sql`select revision,status,prepared_at from app.fulfillment where id=${parcel.id}`,before);
  assert.equal((await sql`select count(*)::int count from app.access_operation where actor_id=${staff.id} and action='fulfillment.mutate' and key=${key}`)[0].count,0);
  assert.equal((await sql`select count(*)::int count from app.order_event where order_id=${f.order.id} and status='processing'`)[0].count,0);
 }finally{
  release();await Promise.allSettled([...(holding?[holding]:[]),...(writing?[writing]:[])]);
  try{if(staff)await closeFulfillmentActor(f.identity,staff);}finally{await f.close();}
 }
});
