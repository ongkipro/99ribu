import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {enqueueJob} from '../../src/jobs/outbox.ts';
import {advanceAttempt,createAttempt,type AttemptRow} from '../../src/modules/payments/attempts.ts';
import {postEconomicReceipt} from '../../src/modules/finance/receipts.ts';
import {recordPurchase} from '../../src/modules/advertising/events.ts';
import {initializeFulfillments} from '../../src/modules/fulfillment/core.ts';
import {financeFixture} from './finance-ledger-fixture.ts';

test('canonical Purchase candidate seals original merchandise, funding and three eligibility decisions; missing or cross-order parts roll back',async()=>{
 const f=await financeFixture(),owner=connectDatabase('test','owner'),rollback=new Error('Expected canonical Purchase candidate rollback');let stage='ddl';
 try{
  const order=await f.order(),other=await f.order();
  await assert.rejects(owner.sql.begin(async tx=>{
   const [installed]=await tx`select to_regclass('app.commerce_event') is not null installed`;
   if(!installed.installed) for(const statement of readFileSync('migrations/0017_canonical_signals.sql','utf8').split('--> statement-breakpoint')) if(statement.trim())await tx.unsafe(statement);
   stage='relational funding';const attempt=await createAttempt(tx,order.id,randomUUID(),{method_id:'local-prepaid'});
   const [head]=await tx<AttemptRow[]>`select * from app.payment_attempt where id=${attempt.id}`;
   const [operation]=await tx`insert into app.local_payment_operation (attempt_id,environment,status,requested_amount) values (${attempt.id},'test','pending',${head.expected_amount}) returning id`;
   // SQL consistency only: this deliberately unverified signature is never
   // accepted as application authenticity proof or ingested by a public route.
   const at=new Date(head.created_at).toISOString();
   await tx`insert into app.local_payment_event (operation_id,status,amount,occurred_at,signature) values (${operation.id},'pending',${head.expected_amount},${at},repeat('a',64))`;
   await tx`update app.local_payment_operation set status='confirmed',collected_amount=${head.expected_amount},paid_at=${at} where id=${operation.id}`;
   const eventId=randomUUID();await tx`insert into app.local_payment_event (id,operation_id,status,amount,occurred_at,signature) values (${eventId},${operation.id},'confirmed',${head.expected_amount},${at},repeat('a',64))`;
   const callback=await enqueueJob(tx,'payment.callback',`payment-callback:${eventId}`,{eventId});
   await tx`insert into app.payment_provider_event (id,attempt_id,payload_hash,callback_job_id) values (${eventId},${attempt.id},repeat('a',64),${callback})`;
   const receipt=await postEconomicReceipt(tx,{order_id:order.id,shipment_id:null,source:'local.payment',environment:'test',event_id:eventId,effect_reference:operation.id,amount:Number(head.expected_amount),occurred_at:at});
   await tx`insert into app.payment_event_result (event_id,outcome,reason,receipt_id,transaction_id) values (${eventId},'confirmed','verified_collection',${receipt.id},${receipt.transaction_id})`;
   await advanceAttempt(tx,head,{status:'confirmed',source_type:'provider_event',source_id:eventId,provider_operation_id:operation.id,receipt_id:receipt.id,occurred_at:at});
   await tx`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) values (${order.id},2,'pending','confirmed','Candidate canonical Purchase consistency',${eventId},${at})`;
   await tx`update app.commerce_order set revision=2,payment_status='confirmed',actionable_at=${at} where id=${order.id}`;
   await initializeFulfillments(tx,order.id);
   await tx`update app.outbox_job set status='completed',completed_at=clock_timestamp(),result=${JSON.stringify({event_id:eventId})}::jsonb where id=${callback}`;
   stage='missing Purchase seal';await assert.rejects(tx.savepoint(t=>t`set constraints all immediate`),{code:'23514'});
   stage='canonical Purchase';const purchase=await recordPurchase(tx,receipt.id);assert.equal(await recordPurchase(tx,receipt.id),purchase);
   const [signal]=await tx`select name,merchandise_amount::text merchandise_amount,payload from app.commerce_event where id=${purchase}`;
   assert.equal(signal.name,'Purchase');assert.equal(signal.merchandise_amount,'99000');assert.equal(signal.payload.currency,'IDR');assert.equal(signal.payload.contents[0].quantity,1);
   const rows=await tx`select platform,status,reason,job_id from app.ad_event_outbox where event_id=${purchase} order by platform`;
   assert.deepEqual(rows.map(r=>({platform:r.platform,status:r.status,reason:r.reason,job_id:r.job_id})),['google','meta','tiktok'].map(platform=>({platform,status:'suppressed',reason:'no_consent',job_id:null})));
   assert.equal((await tx`select count(*)::int n from app.purchase_allocation where event_id=${purchase}`)[0].n,1);
   stage='complete canonical seal';await tx`set constraints all immediate`;
   await assert.rejects(tx.savepoint(t=>t`update app.commerce_event set merchandise_amount=1 where id=${purchase}`),{code:'23514'});
   const [foreign]=await tx`select id from app.order_item where order_id=${other.id}`;
   await assert.rejects(tx.savepoint(t=>t`insert into app.purchase_allocation (event_id,order_item_id,quantity,merchandise_amount) values (${purchase},${foreign.id},1,99000)`),{code:'23514'});
   throw rollback;
  }),error=>{if(error===rollback)return true;const safe=error as {code?:unknown;constraint_name?:unknown};assert.fail(`Canonical candidate failed at ${stage} (${String(safe.code??'domain')}/${String(safe.constraint_name??'constraint')})`);});
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);
 }finally{await owner.sql.end();await f.close();}
});
