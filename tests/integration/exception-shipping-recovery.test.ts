import assert from 'node:assert/strict';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {shippingCreationRecovery} from '../../src/modules/fulfillment/core.ts';
import {reconcileShippingNow,shippingAdapter} from '../../src/modules/fulfillment/worker.ts';
import {fulfillmentFixture} from './fulfillment-fixture.ts';

test('explicit original waybill absence recovery preserves attempts and audits one additional bounded attempt',async()=>{
 const f=await fulfillmentFixture();try{
  const booking=await f.book(),sql=f.identity.sql;
  await sql`update app.outbox_job set max_attempts=1 where id=${booking.creation_job_id}`;
  assert.equal(await runOneJob(sql,{'shipping.create':shippingAdapter(sql,'test',new Map([[booking.id,'before-commit']]))},booking.creation_job_id),true);
  await reconcileShippingNow(sql,String(booking.id));
  await runOneJob(sql,{'shipping.create':shippingAdapter(sql,'test')},booking.creation_job_id);
  const [failed]=await sql`select * from app.outbox_job where id=${booking.creation_job_id}`;
  assert.equal(failed.status,'failed');assert.equal(failed.attempts,1);assert.equal(failed.last_error,'ATTEMPTS_EXHAUSTED');
  assert.equal((await sql`select count(*)::int n from app.local_waybill_operation where booking_id=${booking.id}`)[0].n,0);
  await reconcileShippingNow(sql,String(booking.id));
  const [rearmed]=await sql`select * from app.outbox_job where id=${booking.creation_job_id}`;
  assert.equal(rearmed.attempts,failed.attempts,'A recovered job must retain every actual original dispatch attempt');
  assert.equal(rearmed.max_attempts,failed.max_attempts+1);assert.equal(rearmed.status,'pending');
  assert.equal(new Date(rearmed.created_at).getTime(),new Date(failed.created_at).getTime());assert.deepEqual(rearmed.payload,failed.payload);
  assert.equal(await runOneJob(sql,{'shipping.create':shippingAdapter(sql,'test')},booking.creation_job_id),true);
  const [complete]=await sql`select * from app.outbox_job where id=${booking.creation_job_id}`;
  assert.equal(complete.status,'completed');assert.equal(complete.attempts,2);
  const [source]=await sql`select id from app.local_waybill_operation where booking_id=${booking.id}`;
  assert.equal(complete.result.operation_id,source.id);
  const [audit]=await sql`select details from app.audit_event where action='local.shipping.reconcile' and subject_id=${booking.id}
   and details->>'previous_status'='failed' order by created_at desc limit 1`;
  assert.equal(audit.details.source_absence_verified,true);assert.equal(audit.details.budget_rearmed,true);
  assert.equal(audit.details.previous_attempts,1);assert.equal(audit.details.previous_max_attempts,1);assert.equal(audit.details.next_max_attempts,2);
 }finally{await f.close();}
});

test('original creation recovery distinguishes ambiguity, known absence and the ten-attempt ceiling',()=>{
 assert.deepEqual(shippingCreationRecovery({status:'unknown',attempts:1,max_attempts:3},false),{status:'pending',max_attempts:3});
 assert.deepEqual(shippingCreationRecovery({status:'unknown',attempts:3,max_attempts:3},false),{status:'failed',max_attempts:3});
 assert.deepEqual(shippingCreationRecovery({status:'failed',attempts:3,max_attempts:3},false),{status:'pending',max_attempts:4});
 assert.deepEqual(shippingCreationRecovery({status:'failed',attempts:10,max_attempts:10},false),{status:'failed',max_attempts:10});
 assert.deepEqual(shippingCreationRecovery({status:'failed',attempts:3,max_attempts:3},true),{status:'unknown',max_attempts:3});
 assert.deepEqual(shippingCreationRecovery({status:'unknown',attempts:10,max_attempts:10},true),{status:'unknown',max_attempts:10});
 for(const job of [{status:'pending',attempts:0,max_attempts:1},{status:'failed',attempts:-1,max_attempts:1},{status:'failed',attempts:1.5,max_attempts:2},{status:'failed',attempts:1,max_attempts:0},{status:'failed',attempts:1,max_attempts:11}])assert.throws(()=>shippingCreationRecovery(job,false),{code:'INVALID_INPUT'});
});

test('lost acknowledgement recovery reconciles the one committed original without another dispatch attempt',async()=>{
 const f=await fulfillmentFixture();try{
  const booking=await f.book(),sql=f.identity.sql;
  await sql`update app.outbox_job set max_attempts=1 where id=${booking.creation_job_id}`;
  await runOneJob(sql,{'shipping.create':shippingAdapter(sql,'test',new Map([[booking.id,'creation-commit-lost-ack']]))},booking.creation_job_id);
  const [original]=await sql`select * from app.local_waybill_operation where booking_id=${booking.id}`;
  await reconcileShippingNow(sql,String(booking.id));
  const [recovering]=await sql`select * from app.outbox_job where id=${booking.creation_job_id}`;
  assert.equal(recovering.status,'unknown');assert.equal(recovering.attempts,1);assert.equal(recovering.max_attempts,1);
  await runOneJob(sql,{'shipping.create':shippingAdapter(sql,'test')},booking.creation_job_id);
  const [complete]=await sql`select * from app.outbox_job where id=${booking.creation_job_id}`;
  assert.equal(complete.status,'completed');assert.equal(complete.attempts,1);assert.equal(complete.result.operation_id,original.id);
  const sources=await sql`select * from app.local_waybill_operation where booking_id=${booking.id}`;
  assert.equal(sources.length,1);assert.equal(new Date(sources[0].created_at).getTime(),new Date(original.created_at).getTime());
  const [audit]=await sql`select details from app.audit_event where action='local.shipping.reconcile' and subject_id=${booking.id} order by created_at desc limit 1`;
  assert.equal(audit.details.source_absence_verified,false);assert.equal(audit.details.budget_rearmed,false);
 }finally{await f.close();}
});

test('repeated real dispatch failures stop at ten attempts while preserving the original job and deadline',async()=>{
 const f=await fulfillmentFixture();try{
  const booking=await f.book(),sql=f.identity.sql,[initial]=await sql`select deadline_id from app.fulfillment where id=${f.parcels[0].id}`;
  await sql`update app.outbox_job set max_attempts=1 where id=${booking.creation_job_id}`;
  const adapter={'shipping.create':shippingAdapter(sql,'test',new Map([[booking.id,'before-commit']]))};
  for(let attempt=1;attempt<=10;attempt++){
   assert.equal(await runOneJob(sql,adapter,booking.creation_job_id),true);
   await reconcileShippingNow(sql,String(booking.id));
   const [failed]=await sql`select status,attempts,max_attempts,completed_at,last_error from app.outbox_job where id=${booking.creation_job_id}`;
   assert.equal(failed.status,'failed');assert.equal(failed.attempts,attempt);assert.equal(failed.max_attempts,attempt);assert.equal(failed.last_error,'ATTEMPTS_EXHAUSTED');assert.ok(failed.completed_at);
   await reconcileShippingNow(sql,String(booking.id));
  }
  const [capped]=await sql`select status,attempts,max_attempts from app.outbox_job where id=${booking.creation_job_id}`;
  assert.deepEqual({...capped},{status:'failed',attempts:10,max_attempts:10});
  assert.equal(await runOneJob(sql,adapter,booking.creation_job_id),false);
  assert.equal((await sql`select count(*)::int n from app.local_waybill_operation where booking_id=${booking.id}`)[0].n,0);
  assert.equal((await sql`select deadline_id from app.fulfillment where id=${f.parcels[0].id}`)[0].deadline_id,initial.deadline_id);
  assert.equal((await sql`select count(*)::int n from app.shipment_booking where fulfillment_id=${f.parcels[0].id}`)[0].n,1);
  const [audit]=await sql`select details from app.audit_event where action='local.shipping.reconcile' and subject_id=${booking.id} and details->>'previous_status'='failed' and details->>'previous_attempts'='10' order by created_at desc limit 1`;
  assert.equal(audit.details.budget_rearmed,false);assert.equal(audit.details.next_max_attempts,10);
 }finally{await f.close();}
});
