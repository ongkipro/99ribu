import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {actOnReplacement,readAdminReplacement} from '../../src/modules/returns/replacements.ts';
import {replacementShippingAdapter} from '../../src/modules/returns/replacement-shipping.ts';
import {simulateReplacementReceipt} from '../../src/modules/returns/replacement-receipts.ts';
import {replacementFixture} from './replacement-fixture.ts';

const host=(mode:string,id:string)=>execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','test',mode,id],{timeout:15000,stdio:'pipe'});

for(const fault of ['before-commit','creation-commit-lost-ack','issuance-commit-lost-ack'] as const){
 test(`fresh replacement host recovers ${fault} using the original booking and stock hold`,async()=>{
  const f=await replacementFixture(),sql=f.sql;
  try{
   await f.act('prepare');await f.act('book');const bookingId=f.head.booking_id;assert.ok(bookingId);
   const [booking]=await sql`select creation_job_id from app.replacement_booking where id=${bookingId}`;
   const held=await sql`select stock_reservation_id from app.replacement_shipment where id=${f.head.id}`;
   assert.equal(await runOneJob(sql,{'replacement.shipping.create':replacementShippingAdapter(sql,'test',new Map([[bookingId,fault]]))},booking.creation_job_id),true);
   assert.equal((await sql`select status from app.outbox_job where id=${booking.creation_job_id}`)[0].status,'unknown');
   const roots=await sql`select id,booking_id,profile,request_hash,created_at from app.local_replacement_operation where booking_id=${bookingId}`;
   assert.equal(roots.length,fault==='before-commit'?0:1);
   const sources=await sql`select e.id,e.occurred_at,e.status,e.tracking_number from app.local_replacement_event e join app.local_replacement_operation op on op.id=e.operation_id where op.booking_id=${bookingId}`;
   assert.equal(sources.length,fault==='issuance-commit-lost-ack'?1:0);
   const current=await readAdminReplacement(f.identity,f.principal,f.head.id),body={expected_version:current.version,reason:'SYNTHETIC unknown replacement must not create another booking'};
   await assert.rejects(actOnReplacement(f.command(`/api/v1/admin/replacements/${current.id}/bookings`,body),f.identity,f.principal,current.id,body,'book'),{code:'REPLACEMENT_NOT_PREPARED'});
   host('--reconcile-replacement-shipping',bookingId);
   host('--issue-replacement-waybill',bookingId);
   host('--reconcile-replacement-shipping',bookingId);
   const [head]=await sql`select status,booking_id,waybill_issued_at,handover_at,stock_reservation_id from app.replacement_shipment where id=${current.id}`;
   assert.equal(head.status,'packed');assert.equal(head.booking_id,bookingId);assert.equal(head.handover_at,null);
   assert.equal(head.stock_reservation_id,held[0].stock_reservation_id);
   assert.equal((await sql`select status from app.stock_reservation where id=${head.stock_reservation_id}`)[0].status,'active');
   assert.equal((await sql`select count(*)::int n from app.replacement_booking where shipment_id=${current.id}`)[0].n,1);
   const recovered=await sql`select id,booking_id,profile,request_hash,created_at from app.local_replacement_operation where booking_id=${bookingId}`;
   assert.equal(recovered.length,1);if(roots.length)assert.deepEqual(recovered,roots);
   const events=await sql`select e.id,e.occurred_at,e.status,e.tracking_number from app.local_replacement_event e join app.local_replacement_operation op on op.id=e.operation_id where op.booking_id=${bookingId}`;
   assert.equal(events.length,1);if(sources.length)assert.deepEqual(events,sources);
   assert.equal(new Date(head.waybill_issued_at).toISOString(),new Date(events[0].occurred_at).toISOString());
   assert.equal((await sql`select creation_job_id from app.replacement_booking where id=${bookingId}`)[0].creation_job_id,booking.creation_job_id);
   assert.equal((await sql`select status from app.outbox_job where id=${booking.creation_job_id}`)[0].status,'completed');
   if(fault==='before-commit')assert.equal((await sql`select details from app.audit_event where action='local.replacement_shipping.reconcile' and subject_id=${bookingId} and details->>'source_absence_verified'='true'`)[0].details.source_absence_verified,true);
   assert.equal(await f.economic(),f.originalEconomics);
  }finally{await f.close();}
 });
}

test('fresh receipt host recovers committed signed source acknowledgement loss without extending the first unit anchor',async()=>{
 const f=await replacementFixture(),sql=f.sql;
 try{
  await f.act('prepare');await f.act('book');const bookingId=f.head.booking_id;assert.ok(bookingId);
  host('--issue-replacement-waybill',bookingId);await f.act('handover');
  const input={reference:randomUUID(),booking_id:bookingId,unit_ids:[f.head.items[0].id]};
  await assert.rejects(simulateReplacementReceipt(sql,'test',input,'after-commit-lost-ack'),/acknowledgement loss/);
  const [source]=await sql`select id,occurred_at from app.local_replacement_receipt where reference=${input.reference}`;
  assert.ok(source);assert.equal((await sql`select count(*)::int n from app.replacement_buyer_receipt where replacement_link_id=${input.unit_ids[0]}`)[0].n,0);
  host('--reconcile-replacement-receipt',source.id);
  const [first]=await sql`select id,source_id,received_at from app.replacement_buyer_receipt where replacement_link_id=${input.unit_ids[0]}`;
  assert.equal(first.source_id,source.id);assert.equal(new Date(first.received_at).toISOString(),new Date(source.occurred_at).toISOString());
  host('--reconcile-replacement-receipt',source.id);
  assert.deepEqual((await sql`select id,source_id,received_at from app.replacement_buyer_receipt where replacement_link_id=${input.unit_ids[0]}`)[0],first);
  assert.equal((await sql`select status from app.replacement_shipment where id=${f.head.id}`)[0].status,'partially_delivered');
  assert.equal((await sql`select count(*)::int n from app.replacement_buyer_receipt where replacement_link_id=${f.head.items[1].id}`)[0].n,0);
  assert.equal(await f.economic(),f.originalEconomics);
 }finally{await f.close();}
});
