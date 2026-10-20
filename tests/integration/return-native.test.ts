import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import test from 'node:test';
import type {TransactionSql} from 'postgres';
import {runOneJob} from '../../src/jobs/worker.ts';
import {appendFinanceTransaction} from '../../src/modules/finance/ledger.ts';
import {postMovement} from '../../src/modules/inventory/state.ts';
import {lockRefundCollectionBasis} from '../../src/modules/returns/financial-basis.ts';
import {ingestRefundSourceEvent,simulateRefundOutcome} from '../../src/modules/returns/refund-source.ts';
import {processRefundEvent,refundAdapter} from '../../src/modules/returns/worker.ts';
import {approvedRefundFixture} from './return-refund-fixture.ts';

test('native app-role seals reject rewritten receipt/claim/job history, unleased requests, orphan stock/cash and partial callback completion',async()=>{
 const f=await approvedRefundFixture(),sql=f.identity.sql;
 try{
  assert.equal((await sql`select current_user actor`)[0].actor,'99ribu_test_app');
  const denied=async(run:(tx:TransactionSql)=>Promise<unknown>)=>assert.rejects(sql.begin(async tx=>{await run(tx);await tx`set constraints all immediate`;throw new Error('Native return seal unexpectedly allowed an invalid commit');}),{code:'23514'});
  const [item]=await sql`select id from app.return_item where case_id=${f.caseId}`,[component]=await sql`select balance_id,quantity from app.fulfillment_component_allocation where fulfillment_item_id=${f.unit.id} order by balance_id limit 1`,[balance]=await sql`select on_hand,reserved,quarantined,revision from app.inventory_balance where id=${component.balance_id}`;
  await denied(tx=>tx`update app.buyer_receipt set received_at=received_at-interval '1 day' where fulfillment_item_id=${f.unit.id}`);
  await denied(tx=>tx`delete from app.buyer_receipt where fulfillment_item_id=${f.unit.id}`);
  await denied(tx=>tx`update app.return_item set deadline_at=deadline_at+interval '1 day' where id=${item.id}`);
  await denied(tx=>tx`update app.return_case set status='resolved',revision=revision+1 where id=${f.caseId}`);
  await denied(tx=>tx`update app.refund_allocation set amount=amount+1 where refund_id=${f.refund.id}`);
  await denied(tx=>tx`update app.return_operation set response=response||'{"amount":1}'::jsonb where id=(select operation_id from app.refund where id=${f.refund.id})`);
  await denied(tx=>tx`update app.outbox_job set payload=jsonb_build_object('refundId',${f.refund.id}::uuid,'attempt',2) where id=${f.jobId}`);
  await denied(tx=>tx`update app.outbox_job set status='completed',completed_at=clock_timestamp(),result=jsonb_build_object('operation_id',${randomUUID()}::uuid) where id=${f.jobId}`);
  await denied(tx=>postMovement(tx,{balanceId:component.balance_id,kind:'receive',quantity:component.quantity,onHand:component.quantity,reserved:0,quarantined:component.quantity,sourceRef:`return-goods:${randomUUID()}`,actorId:f.owner.id,reason:'SYNTHETIC orphan physical return cannot mint stock'}));
  assert.deepEqual((await sql`select on_hand,reserved,quarantined,revision from app.inventory_balance where id=${component.balance_id}`)[0],balance);
  await denied(async tx=>{
   const [clock]=await tx`select app.reservation_clock(${f.namespace}) now`;
   await appendFinanceTransaction(tx,{kind:'refund_cash',source:'local.refund.bank',environment:'test',effect_reference:randomUUID(),order_id:f.order.id,reason:'SYNTHETIC orphan outgoing cash must not commit',occurred_at:new Date(clock.now).toISOString(),postings:[{account:'refund_payable',side:'debit',amount:f.refund.amount},{account:'company_cash',side:'credit',amount:f.refund.amount}]});
  });
  await denied(async tx=>{
   const basis=await lockRefundCollectionBasis(tx,f.order.id,[f.unit.id]),original=basis.units[0].original_payment_operation_id,requestHash=createHash('sha256').update(JSON.stringify(['99ribu-refund-request-v1','test',f.refund.id,f.jobId,1,'prepaid_original',original,null,f.refund.amount,f.namespace])).digest('hex');assert.ok(original);
   await tx`insert into app.local_refund_operation (id,refund_id,creation_job_id,attempt,environment,rail,original_payment_operation_id,destination_source_id,amount,clock_namespace,request_hash,created_at) values (${randomUUID()},${f.refund.id},${f.jobId},1,'test','prepaid_original',${original},null,${f.refund.amount},${f.namespace},${requestHash},app.reservation_clock(${f.namespace}))`;
  });
  assert.equal((await sql`select count(*)::int n from app.local_refund_operation where refund_id=${f.refund.id}`)[0].n,0);assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,0);
  assert.equal(await runOneJob(sql,{'refund.create':refundAdapter(sql,'test')},f.jobId),true);
  const source=await simulateRefundOutcome(sql,'test',f.refund.id,'succeeded'),callback=await ingestRefundSourceEvent(sql,source);
  await denied(tx=>processRefundEvent(tx,{id:callback,payload:{eventId:source.id}}));
  assert.equal((await sql`select status from app.refund where id=${f.refund.id}`)[0].status,'processing');assert.equal((await sql`select count(*)::int n from app.refund_event_result where event_id=${source.id}`)[0].n,0);assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,0);
  assert.equal(await runOneJob(sql,{},callback),true);assert.equal(await runOneJob(sql,{},callback),false);assert.equal((await sql`select status from app.refund where id=${f.refund.id}`)[0].status,'succeeded');assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,1);
 }finally{await f.close();}
});
