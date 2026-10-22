import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {Sql,TransactionSql} from 'postgres';
import {connectDatabase} from '../../src/db/client.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {reverseFinanceTransaction} from '../../src/modules/finance/ledger.ts';
import {createReturn,decideReturn} from '../../src/modules/returns/cases.ts';
import {inspectReturn} from '../../src/modules/returns/inspection.ts';
import {simulateParcelReceipt,ingestParcelReceiptSource} from '../../src/modules/returns/receipt-source.ts';
import {acceptRefundDestination,projectBuyerRefund,queueRefund} from '../../src/modules/returns/refunds.ts';
import {recoverRefund} from '../../src/modules/returns/refund-recovery.ts';
import {createRefundDestinationSource,simulateRefundOutcome,ingestRefundSourceEvent} from '../../src/modules/returns/refund-source.ts';
import {refundAdapter} from '../../src/modules/returns/worker.ts';
import {returnFixture} from '../integration/return-fixture.ts';

function candidateConnection(tx:TransactionSql){return new Proxy(tx,{get(target,property,receiver){if(property==='begin')return (run:(inner:TransactionSql)=>Promise<unknown>)=>target.savepoint(async inner=>{await inner`set constraints all deferred`;return run(inner);});return Reflect.get(target,property,receiver);}}) as unknown as Sql;}
type CaseResult={id:string;version:number;status:string;items:{delivered_fulfillment_item_id:string}[]};
type ActionResult={case_id:string;version:number;status:string};
type RefundResult={id:string;version:number;status:string;amount:number};

for(const method of ['cod','prepaid'] as const)test(`rollback-only ${method} receipt, inspection and failed/retried refund preserve whole original units and bank/Purchase history`,async()=>{
 const f=await returnFixture(method),owner=connectDatabase('test','owner'),rollback=new Error('Expected full return/refund candidate rollback');let stage='candidate precondition';
 try{
  assert.equal((await owner.sql`select to_regclass('app.refund') installed`)[0].installed,null);
  await assert.rejects(owner.sql.begin(async tx=>{
   for(const [index,statement] of readFileSync('migrations/0021_returns_refunds.sql','utf8').split('--> statement-breakpoint').entries())if(statement.trim()){
    stage=`unapplied0021 DDL statement ${index+1}`;await tx.unsafe(statement);
   }
   assert.equal((await tx`select count(*)::int n from pg_tables where schemaname='app'`)[0].n,124);
   const sql=candidateConnection(tx),identity={...f.identity,sql};
   const run=async(jobId:string)=>{assert.equal(await runOneJob(sql,{'refund.create':refundAdapter(sql,'test')},jobId),true);const [job]=await tx`select status,last_error from app.outbox_job where id=${jobId}`;assert.equal(job.status,'completed',`Stage ${stage}; safe worker code ${job.last_error??'none'}`);};
   const command=(path:string,body:Record<string,unknown>,key=randomUUID(),browser=f.owner.browser)=>{const request=browser.request(path,body);request.headers.set('idempotency-key',key);return request;};
   const proof=async(subject:string)=>{
    const request=command('/api/v1/me/reauthentication-proofs',{password:f.finance.password,action:'finance.refund',subject_id:subject},randomUUID(),f.finance.browser),response=await handleAccess(request,identity),body=await response.json();
    assert.equal(response.status,201,`Stage ${stage}; safe proof code ${body.code??'none'}`);return String(body.proof);
   };
   const cashCount=async()=>Number((await tx`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n);
   const purchaseSnapshot=async()=>JSON.stringify(await tx`select id,receipt_id,merchandise_amount,payload,occurred_at from app.commerce_event where order_id=${f.order.id} and name='Purchase' order by id`);
   const originalPurchases=await purchaseSnapshot();
   stage='signed actual original parcel receipt and immutable unit anchors';
   for(const booking of f.bookings){
    const parcel=f.parcels.find(parcel=>parcel.id===booking.fulfillment_id);assert.ok(parcel);
    const input={reference:randomUUID(),booking_id:booking.id,unit_ids:f.units.filter(unit=>unit.shipment_id===parcel.shipment_id).map(unit=>unit.id)},source=await simulateParcelReceipt(sql,'test',input);
    await run(await ingestParcelReceiptSource(sql,source));assert.equal((await simulateParcelReceipt(sql,'test',input)).occurred_at,source.occurred_at);
   }
   assert.equal((await tx`select count(*)::int n from app.buyer_receipt r join app.fulfillment_item f on f.id=r.fulfillment_item_id join app.order_item i on i.id=f.order_item_id where i.order_id=${f.order.id}`)[0].n,4);
   const buyer=await commerceActor(f.client.request('/api/v1/carts'),identity);assert.ok(buyer);
   const unit=f.units[0],input={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'damaged',details:'SYNTHETIC original received complete offer'}],requested_resolution:'refund'},key=randomUUID(),buyerRequest=f.client.request(`/api/v1/orders/${f.order.id}/returns`,input,{key});
   stage='current original buyer create, immutable replay and duplicate claim denial';
   const created=await createReturn(buyerRequest,identity,buyer,f.order.id,input) as CaseResult;assert.equal(created.status,'requested');assert.equal(created.version,1);
   assert.deepEqual(await createReturn(buyerRequest,identity,buyer,f.order.id,input),created);
   await assert.rejects(createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,input),identity,buyer,f.order.id,input),{code:'RETURN_QUANTITY_ALREADY_CLAIMED'});
   stage='timely claim remains reviewable after the unclaimed-unit window closes';
   await tx`update app.local_fixture_namespace set clock=clock+interval '168 hours 1 millisecond',revision=revision+1 where name=${f.namespace}`;
   const late={...input,items:[{...input.items[0],order_item_id:f.units[1].order_item_id,delivered_fulfillment_item_id:f.units[1].id}]};
   await assert.rejects(createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,late),identity,buyer,f.order.id,late),{code:'RETURN_WINDOW_EXPIRED'});
   const decision={decision:'approve_refund',expected_version:1,reason:'SYNTHETIC faulty complete offer approved after timely claim'},approved=await decideReturn(command(`/api/v1/admin/returns/${created.id}/decisions`,decision),identity,f.principal,created.id,decision) as ActionResult;
   assert.equal(approved.status,'awaiting_goods');assert.equal(approved.version,2);
   const [item]=await tx`select id from app.return_item where case_id=${created.id}`,[component]=await tx`select balance_id,quantity from app.fulfillment_component_allocation where fulfillment_item_id=${unit.id} order by balance_id limit 1`,[before]=await tx`select on_hand,quarantined,reserved from app.inventory_balance where id=${component.balance_id}`;
   stage='identified physical goods increase quarantine without increasing sellable stock';
   const inspection={expected_version:2,result:'accepted',reason:'SYNTHETIC actual original returned lot received',items:[{return_item_id:item.id,goods:[{expected_balance_id:component.balance_id,quantity:component.quantity,identity_confirmed:true}]}]},inspected=await inspectReturn(command(`/api/v1/admin/returns/${created.id}/inspections`,inspection),identity,f.principal,created.id,inspection) as ActionResult;
   assert.equal(inspected.status,'approved');assert.equal(inspected.version,3);
   const [after]=await tx`select on_hand,quarantined,reserved from app.inventory_balance where id=${component.balance_id}`;assert.equal(after.on_hand-before.on_hand,component.quantity);assert.equal(after.quarantined-before.quarantined,component.quantity);assert.equal(after.on_hand-after.reserved-after.quarantined,before.on_hand-before.reserved-before.quarantined);
   const duplicateGoods={...inspection,expected_version:3,result:'record_goods'};await assert.rejects(inspectReturn(command(`/api/v1/admin/returns/${created.id}/inspections`,duplicateGoods),identity,f.principal,created.id,duplicateGoods),{code:'RETURN_COMPONENT_ALREADY_RECEIVED'});
   stage='proof/CAS queue creates one obligation with no cash and current-authority replay';
   const queue={return_case_id:created.id,expected_version:3,reason:'SYNTHETIC approved original-unit obligation',reauthentication_proof:await proof(created.id)},queueKey=randomUUID(),queueRequest=command('/api/v1/admin/refunds',queue,queueKey,f.finance.browser);
   await assert.rejects(queueRefund(command('/api/v1/admin/refunds',{...queue,expected_version:999},randomUUID(),f.finance.browser),identity,f.financePrincipal,{...queue,expected_version:999}),{code:'VERSION_CONFLICT'});
   let refund=await queueRefund(queueRequest,identity,f.financePrincipal,queue) as RefundResult;
   assert.equal(refund.amount,99000+Number(unit.buyer_shipping));assert.equal(refund.status,method==='cod'?'awaiting_destination':'queued');assert.equal(await cashCount(),0);
   assert.deepEqual(await queueRefund(queueRequest,identity,f.financePrincipal,queue),refund);
   await tx`update app.auth_user set email_verified=false where id=${f.finance.id}`;
   await assert.rejects(queueRefund(queueRequest,identity,f.financePrincipal,queue),{code:'FORBIDDEN'});await tx`update app.auth_user set email_verified=true where id=${f.finance.id}`;
   assert.equal((await tx`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_obligation'`)[0].n,1);
   const [operation]=await tx`select op.occurred_at,j.occurred_at journal_time from app.refund r join app.return_operation op on op.id=r.operation_id join app.finance_transaction j on j.id=r.obligation_transaction_id where r.id=${refund.id}`;assert.equal(new Date(operation.occurred_at).toISOString(),new Date(operation.journal_time).toISOString());
   if(method==='cod'){
    stage='independent synthetic destination requires current original buyer acceptance';
    const destination=await createRefundDestinationSource(sql,'test',refund.id),body={destination_source_id:destination.id,expected_version:refund.version};
    refund=await acceptRefundDestination(f.client.request(`/api/v1/orders/${f.order.id}/refunds/${refund.id}/destinations`,body),identity,buyer,f.order.id,refund.id,body) as RefundResult;assert.equal(refund.status,'queued');
   }
   stage='fenced request and signed zero-money failure retain obligation and original failed result';
   let [head]=await tx`select * from app.refund where id=${refund.id}`;await run(head.current_job_id);
   const failed=await simulateRefundOutcome(sql,'test',refund.id,'failed');await run(await ingestRefundSourceEvent(sql,failed));assert.equal(await cashCount(),0);
   const [failedResult]=await tx`select revision,refund_event_id,cash_transaction_id from app.refund_event_result where event_id=${failed.id}`;assert.equal(failedResult.cash_transaction_id,null);
   refund=await sql.begin(inner=>projectBuyerRefund(inner,refund.id));assert.equal(refund.status,'failed');
   stage='explicit fresh finance retry retains failure history and creates a separate exact attempt';
   const retry={action:'retry',expected_version:refund.version,reason:'SYNTHETIC retry after authenticated bank rejection',reauthentication_proof:await proof(refund.id)};
   refund=await recoverRefund(command(`/api/v1/admin/refunds/${refund.id}/reconciliations`,retry,randomUUID(),f.finance.browser),identity,f.financePrincipal,refund.id,retry) as RefundResult;
   [head]=await tx`select * from app.refund where id=${refund.id}`;await run(head.current_job_id);
   stage='authenticated success atomically confirms cash, original unit, case, result/job and retained-value intent';
   const success=await simulateRefundOutcome(sql,'test',refund.id,'succeeded');await run(await ingestRefundSourceEvent(sql,success));
   assert.equal(await cashCount(),1);refund=await sql.begin(inner=>projectBuyerRefund(inner,refund.id));assert.equal(refund.status,'succeeded');
   assert.deepEqual((await tx`select revision,refund_event_id,cash_transaction_id from app.refund_event_result where event_id=${failed.id}`)[0],failedResult);
   assert.equal((await tx`select status from app.return_case where id=${created.id}`)[0].status,'resolved');
   assert.equal((await tx`select count(*)::int n from app.return_item where case_id=${created.id} and claim_state='refunded'`)[0].n,1);
   const [intent]=await tx`select merchandise_refunded,retained_merchandise,dispatch_reason,purchase_event_id from app.refund_adjustment_intent where refund_id=${refund.id}`;assert.equal(Number(intent.merchandise_refunded),99000);assert.ok(intent.purchase_event_id);assert.equal(intent.dispatch_reason,'pending_adapter');assert.ok(Number(intent.retained_merchandise)>=0);
   assert.equal(await purchaseSnapshot(),originalPurchases);
   stage='final immutable response and outgoing cash reject tampering';
   const [committedOperation]=await tx`select id from app.return_operation where actor_id=${f.finance.id} and key=${queueKey}`;
   await assert.rejects(sql.begin(inner=>inner`update app.return_operation set response=response||'{"amount":1}'::jsonb where id=${committedOperation.id}`),{code:'23514'});
   const [journals]=await tx`select r.obligation_transaction_id,r.cash_transaction_id,e.transaction_id collection_transaction_id from app.refund r join app.refund_allocation a on a.refund_id=r.id join app.economic_receipt e on e.id=a.receipt_id where r.id=${refund.id}`;
   for(const original of [journals.obligation_transaction_id,journals.cash_transaction_id,journals.collection_transaction_id])await assert.rejects(sql.begin(inner=>reverseFinanceTransaction(inner,original,{source:'local.return.test',environment:'test',effect_reference:randomUUID(),reason:'SYNTHETIC forbidden original refund reversal',occurred_at:success.occurred_at})),{code:'23514'});
   const proofDigest=createHash('sha256').update(queue.reauthentication_proof).digest('hex');assert.ok((await tx`select consumed_at from app.access_proof where digest=${proofDigest}`)[0].consumed_at);
   await tx`set constraints all immediate`;throw rollback;
  }),error=>{if(error!==rollback){const safe=error&&typeof error==='object'&&'code' in error?String(error.code):'ASSERTION';throw new Error(`Return candidate stage ${stage}; safe code ${safe}; ${error instanceof Error?error.message.slice(0,300):'unknown failure'}`);}return true;});
  assert.equal((await owner.sql`select to_regclass('app.refund') installed`)[0].installed,null);
  assert.equal((await owner.sql`select count(*)::int n from pg_tables where schemaname='app'`)[0].n,105);
  assert.equal((await owner.sql`select count(*)::int n from drizzle.__drizzle_migrations`)[0].n,21);
 }finally{await owner.sql.end();await f.close();}
});
