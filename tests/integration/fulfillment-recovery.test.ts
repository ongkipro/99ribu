import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {simulateWaybillIssue} from '../../src/modules/fulfillment/local.ts';
import {shippingAdapter,reconcileShippingNow} from '../../src/modules/fulfillment/worker.ts';
import {fulfillmentFixture} from './fulfillment-fixture.ts';

function host(mode:string,bookingId:string){execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','test',mode,bookingId],{timeout:15000,stdio:'pipe'});}
test('fresh host recovery preserves independent original source commits and timestamps after request and issuance acknowledgement loss',async()=>{
 const f=await fulfillmentFixture();try{
  const booking=await f.book(),sql=f.identity.sql;
  await runOneJob(sql,{'shipping.create':shippingAdapter(sql,'test',new Map([[booking.id,'creation-commit-lost-ack']]))},booking.creation_job_id);
  assert.equal((await sql`select status from app.outbox_job where id=${booking.creation_job_id}`)[0].status,'unknown');
  const [original]=await sql`select * from app.local_waybill_operation where booking_id=${booking.id}`;assert.equal(original.status,'acknowledged');assert.equal(original.tracking_number,null);
  assert.equal((await f.fulfillmentCall('/api/v1/admin/shipments',{fulfillment_id:f.parcels[0].id,expected_version:3,reason:'Must not rebook unknown effect'})).response.status,409);
  host('--reconcile-shipping',booking.id);
  assert.equal((await sql`select status from app.shipment_booking where id=${booking.id}`)[0].status,'acknowledged');
  await assert.rejects(simulateWaybillIssue(sql,'test',booking.id,'issued','after-commit-lost-ack'),/acknowledgement loss/);
  const [issued]=await sql`select * from app.local_waybill_operation where booking_id=${booking.id}`;assert.equal(issued.id,original.id);
  assert.equal((await sql`select waybill_issued_at from app.fulfillment where id=${f.parcels[0].id}`)[0].waybill_issued_at,null);
  host('--reconcile-shipping',booking.id);host('--issue-waybill',booking.id);
  const [head]=await sql`select revision,waybill_issued_at,tracking_number from app.fulfillment where id=${f.parcels[0].id}`;assert.equal(head.revision,4);assert.equal(new Date(head.waybill_issued_at).toISOString(),new Date(issued.terminal_at).toISOString());assert.equal(head.tracking_number,issued.tracking_number);
  assert.equal((await sql`select count(*)::int n from app.local_waybill_operation where booking_id=${booking.id}`)[0].n,1);assert.equal((await sql`select count(*)::int n from app.economic_receipt where order_id=${f.order.id}`)[0].n,0);
 }finally{await f.close();}
});
test('exhausted creation with authoritative absence retries the same booking only after fencing, retaining the original deadline',async()=>{
 const f=await fulfillmentFixture();try{
  const booking=await f.book(),sql=f.identity.sql,[before]=await sql`select deadline_id from app.fulfillment where id=${f.parcels[0].id}`;
  await sql`update app.outbox_job set max_attempts=1 where id=${booking.creation_job_id}`;
  await runOneJob(sql,{'shipping.create':shippingAdapter(sql,'test',new Map([[booking.id,'before-commit']]))},booking.creation_job_id);
  assert.equal((await sql`select status from app.outbox_job where id=${booking.creation_job_id}`)[0].status,'unknown');
  await reconcileShippingNow(sql,booking.id);await runOneJob(sql,{'shipping.create':shippingAdapter(sql,'test')},booking.creation_job_id);
  assert.equal((await sql`select status from app.outbox_job where id=${booking.creation_job_id}`)[0].status,'failed');assert.equal((await sql`select count(*)::int n from app.local_waybill_operation where booking_id=${booking.id}`)[0].n,0);
  host('--reconcile-shipping',booking.id);
  assert.equal((await sql`select status from app.shipment_booking where id=${booking.id}`)[0].status,'acknowledged');assert.equal((await sql`select deadline_id from app.fulfillment where id=${f.parcels[0].id}`)[0].deadline_id,before.deadline_id);
  assert.equal((await sql`select count(*)::int n from app.shipment_booking where fulfillment_id=${f.parcels[0].id}`)[0].n,1);
  const [audit]=await sql`select details from app.audit_event where action='local.shipping.reconcile' and subject_id=${booking.id} and details->>'previous_status'='failed'`;assert.equal(audit.details.source_absence_verified,true);assert.equal(audit.details.previous_attempts,1);
 }finally{await f.close();}
});
