import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {enqueueJob} from '../../src/jobs/outbox.ts';
import {financeFixture} from './finance-ledger-fixture.ts';
import {postEconomicReceipt} from '../../src/modules/finance/receipts.ts';
import {advanceAttempt,type AttemptRow} from '../../src/modules/payments/attempts.ts';
import {recordPurchase} from '../../src/modules/advertising/events.ts';
import {initializeFulfillments} from '../../src/modules/fulfillment/core.ts';

test('unapplied payment candidate parses and rejects a null confirmed collection without changing existing history',async()=>{
 const f=await financeFixture(),connection=connectDatabase('test','owner'),rollback=new Error('Expected payment candidate rollback');
 try{const order=await f.order();await assert.rejects(connection.sql.begin(async tx=>{
  const [installed]=await tx`select to_regclass('app.payment_attempt') is not null installed`;
  if(!installed.installed) for(const statement of readFileSync('migrations/0016_prepaid_payments.sql','utf8').split('--> statement-breakpoint')) if(statement.trim()) await tx.unsafe(statement);
  const [tables]=await tx`select count(*)::int n from pg_tables where schemaname='app' and tablename in ('payment_attempt','payment_attempt_event','local_payment_operation','local_payment_event','payment_provider_event','payment_event_result')`;assert.equal(tables.n,6);
  const attemptId=randomUUID(),job=await enqueueJob(tx,'payment.create',`payment-create:${attemptId}`,{attemptId});
  const [attempt]=await tx`insert into app.payment_attempt (id,order_id,method_id,key,request_hash,creation_job_id,expected_amount,created_at,expires_at)
   select ${attemptId},id,'local-prepaid',${randomUUID()},repeat('a',64),${job},buyer_total,app.reservation_clock(clock_namespace),expires_at from app.commerce_order where id=${order.id} returning *`;
  await tx`insert into app.payment_attempt_event (attempt_id,revision,status,source_type,source_id,occurred_at) values (${attempt.id},1,'pending','request',${job},${attempt.created_at})`;
  await tx`update app.payment_attempt set revision=1,status='pending' where id=${attempt.id}`;
  const [operation]=await tx`insert into app.local_payment_operation (attempt_id,environment,status,requested_amount) values (${attempt.id},'test','pending',${attempt.expected_amount}) returning id`;
  // Deliberately unverified simulator signature; no application event/receipt.
  await tx`insert into app.local_payment_event (operation_id,status,amount,occurred_at,signature) values (${operation.id},'pending',${attempt.expected_amount},${attempt.created_at},repeat('a',64))`;
  await assert.rejects(tx.savepoint(t=>t`update app.local_payment_operation set status='confirmed',collected_amount=null,paid_at=${attempt.created_at} where id=${operation.id}`),{code:'23514'});
  await assert.rejects(tx.savepoint(t=>t`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) values (${order.id},2,'pending','confirmed','Invalid missing payment evidence',${randomUUID()},${attempt.created_at})`),{code:'23514'});
  assert.equal((await tx`select actionable_at from app.commerce_order where id=${order.id}`)[0].actionable_at,null);
  // Exercise relational funding consistency only. An arbitrary signature is not
  // authentication evidence; the actual application verifier is tested separately.
  await tx`update app.local_payment_operation set status='confirmed',collected_amount=${attempt.expected_amount},paid_at=${attempt.created_at} where id=${operation.id}`;
  const eventId=randomUUID();await tx`insert into app.local_payment_event (id,operation_id,status,amount,occurred_at,signature) values (${eventId},${operation.id},'confirmed',${attempt.expected_amount},${attempt.created_at},repeat('b',64))`;
  const callback=await enqueueJob(tx,'payment.callback',`payment-callback:${eventId}`,{eventId});
  await tx`insert into app.payment_provider_event (id,attempt_id,payload_hash,callback_job_id) values (${eventId},${attempt.id},repeat('b',64),${callback})`;
  const receipt=await postEconomicReceipt(tx,{order_id:order.id,shipment_id:null,source:'local.payment',environment:'test',event_id:eventId,effect_reference:operation.id,amount:Number(attempt.expected_amount),occurred_at:new Date(attempt.created_at).toISOString()});
  await tx`insert into app.payment_event_result (event_id,outcome,reason,receipt_id,transaction_id) values (${eventId},'confirmed','verified_collection',${receipt.id},${receipt.transaction_id})`;
  const [head]=await tx<AttemptRow[]>`select * from app.payment_attempt where id=${attempt.id}`;
  await advanceAttempt(tx,head,{status:'confirmed',source_type:'provider_event',source_id:eventId,provider_operation_id:operation.id,receipt_id:receipt.id,occurred_at:new Date(attempt.created_at).toISOString()});
  await tx`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) values (${order.id},2,'pending','confirmed','Candidate relational funding proof',${eventId},${attempt.created_at})`;
  await tx`update app.commerce_order set revision=2,payment_status='confirmed',actionable_at=${attempt.created_at} where id=${order.id}`;
  await initializeFulfillments(tx,order.id);
  const [signals]=await tx`select to_regclass('app.commerce_event') is not null installed`;
  if(signals.installed) await recordPurchase(tx,receipt.id);
  await assert.rejects(tx.savepoint(async t=>{await t`set constraints all immediate`;}),{code:'23514'});
  await tx`update app.outbox_job set status='completed',completed_at=clock_timestamp(),result=${JSON.stringify({event_id:eventId})}::jsonb where id=${callback}`;
  await tx`set constraints all immediate`;
  await assert.rejects(tx.savepoint(t=>t`update app.local_payment_event set amount=amount+1 where id=${eventId}`),{code:'23514'});
  await assert.rejects(tx.savepoint(t=>t`update app.commerce_order set revision=3,payment_status='expired',actionable_at=null where id=${order.id}`),{code:'23514'});
  throw rollback;
 }),error=>error===rollback);}finally{await connection.sql.end();await f.close();}
});
