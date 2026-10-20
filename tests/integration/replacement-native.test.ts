import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {simulateReplacementWaybill,ingestReplacementWaybillEvent} from '../../src/modules/returns/replacement-shipping.ts';
import {simulateReplacementReceipt,ingestReplacementReceiptSource,processReplacementReceipt} from '../../src/modules/returns/replacement-receipts.ts';
import {replacementFixture} from './replacement-fixture.ts';

test('application SQL preserves replacement history and rejects a receipt effect without its atomic callback completion',async()=>{
 const f=await replacementFixture(),sql=f.sql;
 try{
  assert.equal((await sql`select current_user actor`)[0].actor,'99ribu_test_app');
  await f.act('prepare');await f.act('book');const shipmentId=f.head.id,bookingId=f.head.booking_id;assert.ok(bookingId);
  const [booking]=await sql`select creation_job_id from app.replacement_booking where id=${bookingId}`;
  const [component]=await sql`select a.* from app.replacement_component_allocation a join app.replacement_link l on l.id=a.replacement_link_id where l.shipment_id=${shipmentId} order by a.replacement_link_id,a.balance_id limit 1`;
  const [operation]=await sql`select id from app.replacement_operation where subject_id=${shipmentId} order by occurred_at limit 1`;
  const snapshot=async()=>JSON.stringify({head:await sql`select to_jsonb(s) row from app.replacement_shipment s where id=${shipmentId}`,
   links:await sql`select to_jsonb(l) row from app.replacement_link l where shipment_id=${shipmentId} order by id`,
   components:await sql`select to_jsonb(a) row from app.replacement_component_allocation a join app.replacement_link l on l.id=a.replacement_link_id where l.shipment_id=${shipmentId} order by a.replacement_link_id,a.balance_id`,
   job:await sql`select to_jsonb(j) row from app.outbox_job j where id=${booking.creation_job_id}`});
  const before=await snapshot();
  const attempts=[
   (tx:TransactionSql)=>tx`update app.replacement_link set generation=generation+1 where id=${f.head.items[0].id}`,
   (tx:TransactionSql)=>tx`update app.replacement_component_allocation set quantity=quantity+1 where replacement_link_id=${component.replacement_link_id} and balance_id=${component.balance_id}`,
   (tx:TransactionSql)=>tx`delete from app.replacement_operation where id=${operation.id}`,
   (tx:TransactionSql)=>tx`update app.replacement_shipment set buyer_shipping=99000 where id=${shipmentId}`,
   (tx:TransactionSql)=>tx`update app.replacement_shipment set status='handed_over',handover_at=clock_timestamp(),handover_reference='SYNTHETIC forged physical transition' where id=${shipmentId}`,
   (tx:TransactionSql)=>tx`update app.replacement_booking set attempt=attempt+1 where id=${bookingId}`,
   (tx:TransactionSql)=>tx`update app.outbox_job set attempts=max_attempts+1 where id=${booking.creation_job_id}`,
   (tx:TransactionSql)=>tx`update app.outbox_job set status='completed',completed_at=clock_timestamp(),result='{}'::jsonb where id=${booking.creation_job_id}`,
   (tx:TransactionSql)=>tx`delete from app.outbox_job where id=${booking.creation_job_id}`,
  ];
  for(const [index,attempt] of attempts.entries()){
   await assert.rejects(sql.begin(tx=>attempt(tx)),{code:'23514'});
   assert.equal(await snapshot(),before,`Rejected native mutation ${index} must leave no partial effect`);
  }
  assert.equal((await sql`select count(*)::int n from app.local_replacement_operation where booking_id=${bookingId}`)[0].n,0);
  await f.run(booking.creation_job_id);
  await f.run(await ingestReplacementWaybillEvent(sql,await simulateReplacementWaybill(sql,'test',bookingId)));
  await f.act('handover');
  const source=await simulateReplacementReceipt(sql,'test',{reference:randomUUID(),booking_id:bookingId,unit_ids:[f.head.items[0].id]}),callback=await ingestReplacementReceiptSource(sql,source);
  await assert.rejects(sql.begin(async tx=>{await processReplacementReceipt(tx,{id:callback,payload:{eventId:source.id}});await tx`set constraints all immediate`;}),{code:'23514'});
  assert.equal((await sql`select count(*)::int n from app.replacement_buyer_receipt where source_id=${source.id}`)[0].n,0);
  assert.equal((await sql`select count(*)::int n from app.replacement_receipt_result where event_id=${source.id}`)[0].n,0);
  assert.equal((await sql`select status from app.replacement_shipment where id=${shipmentId}`)[0].status,'handed_over');
  assert.equal((await sql`select count(*)::int n from app.return_item where case_id=${f.claim.id} and claim_state='replacing'`)[0].n,2);
  assert.equal((await sql`select status from app.outbox_job where id=${callback}`)[0].status,'pending');
  await f.run(callback);
  assert.equal((await sql`select receipt_count from app.replacement_receipt_result where event_id=${source.id}`)[0].receipt_count,1);
  assert.equal((await sql`select status from app.outbox_job where id=${callback}`)[0].status,'completed');
  assert.equal(await f.economic(),f.originalEconomics);
 }finally{await f.close();}
});
