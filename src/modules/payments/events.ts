import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {id,object} from '../catalog/validation.ts';
import {expireOwnedOrderJob} from '../checkout/expiry.ts';
import {appendFinanceTransaction} from '../finance/ledger.ts';
import {postEconomicReceipt} from '../finance/receipts.ts';
import {advanceAttempt,lockPaymentOrder,type AttemptRow} from './attempts.ts';
import {readProviderEvents,verifyProviderEvent} from './local.ts';
import {recordPurchase} from '../advertising/events.ts';
import {initializeFulfillments} from '../fulfillment/core.ts';
import {openCollectionException} from '../checkout/exceptions/collection-cases.ts';
import {enqueueCommissionAccrual} from '../commissions/jobs.ts';

// The worker owns the surrounding transaction and completes only this callback
// before checking deferred constraints. Any error rolls back money and funding.
export async function processPaymentEvent(tx:TransactionSql,job:{id:string;payload:unknown}){
 const input=object(job.payload,['eventId']),eventId=id(input.eventId);
 const [registered]=await tx`select * from app.payment_provider_event where id=${eventId} and callback_job_id=${job.id}`;
 if(!registered) throw new AccessError(400,'INVALID_PAYMENT_JOB');
 const [before]=await tx<AttemptRow[]>`select * from app.payment_attempt where id=${registered.attempt_id}`;
 if(!before) throw new AccessError(400,'INVALID_PAYMENT_JOB');
 let order=await lockPaymentOrder(tx,before.order_id);
 const [attempt]=await tx<AttemptRow[]>`select * from app.payment_attempt where id=${before.id} for update`;
 const events=await readProviderEvents(tx,attempt.id),source=events.find(e=>e.id===eventId);if(!source) throw new AccessError(400,'INVALID_PAYMENT_JOB');
 const event=verifyProviderEvent(source);
 const [previous]=await tx`select outcome,reason,receipt_id,transaction_id from app.payment_event_result where event_id=${event.id}`;
 if(previous) return {event_id:event.id,outcome:previous.outcome as string};
 let outcome='ignored',reason='pending_notification',receiptId:string|null=null,transactionId:string|null=null;
 if(event.status==='confirmed'){
  const [existing]=await tx`select id from app.economic_receipt where source='local.payment' and environment=${event.environment} and effect_reference=${event.operation_id}`;
  const [recovery]=await tx`select id from app.finance_transaction where source='local.payment.recovery' and environment=${event.environment} and effect_reference=${event.operation_id}`;
  if(existing||recovery){
   outcome='duplicate';reason='duplicate_callback';receiptId=existing?.id??null;
   transactionId=existing?(await tx`select transaction_id from app.economic_receipt where id=${existing.id}`)[0].transaction_id:recovery.id;
  }else{
   const timely=Date.parse(event.occurred_at)<new Date(attempt.expires_at).getTime();
   if(!timely&&order.status==='pending'&&order.payment_status==='pending'){
    const [expiry]=await tx`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;
    if(!expiry) throw new AccessError(503,'PAYMENT_RECOVERY_INVALID');
    const expired=await expireOwnedOrderJob(tx,{id:expiry.id,kind:expiry.kind,payload:expiry.payload});
    if(expired?.deferMs!==null) throw new AccessError(409,'PAYMENT_RECONCILIATION_PENDING');
    order=await lockPaymentOrder(tx,order.id);
   }
   const [allocated]=await tx`select id from app.economic_receipt where order_id=${order.id} and kind='prepaid'`;
   const exact=event.amount===Number(attempt.expected_amount);
   if(exact&&!allocated){
    const receipt=await postEconomicReceipt(tx,{order_id:order.id,shipment_id:null,source:'local.payment',environment:event.environment,event_id:event.id,effect_reference:event.operation_id,amount:event.amount,occurred_at:event.occurred_at});receiptId=receipt.id;transactionId=receipt.transaction_id;
   }else{
    const journal=await appendFinanceTransaction(tx,{kind:'adjustment',source:'local.payment.recovery',environment:event.environment,effect_reference:event.operation_id,order_id:order.id,reason:'Verified funds await allocation and recovery; no fulfillment authorized',occurred_at:event.occurred_at,postings:[{account:'provider_receivable',side:'debit',amount:event.amount},{account:'buyer_funds_liability',side:'credit',amount:event.amount}]});transactionId=journal.id;
   }
   const funded=exact&&!allocated&&timely&&order.status==='pending'&&order.payment_status==='pending';
   outcome=funded?'confirmed':'recovery';reason=funded?'verified_collection':!exact?'amount_mismatch':allocated?'conflicting_allocation':'late_payment';
  }
 }else if(['failed','expired'].includes(event.status)){
  if(['confirmed','unknown','failed','expired'].includes(attempt.status)){reason='out_of_order';}
  else{outcome=event.status;reason=event.status==='failed'?'provider_rejected':'provider_expired';}
 }
 await tx`insert into app.payment_event_result (event_id,outcome,reason,receipt_id,transaction_id) values (${event.id},${outcome},${reason},${receiptId},${transactionId})`;
 if(['confirmed','recovery','failed','expired'].includes(outcome)){
  await advanceAttempt(tx,attempt,{status:outcome==='recovery'?'unknown':outcome,source_type:'provider_event',source_id:event.id,provider_operation_id:event.operation_id,receipt_id:receiptId,occurred_at:event.occurred_at});
  if(outcome==='confirmed'){
   await tx`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) values (${order.id},${order.revision+1},'pending','confirmed','Verified prepaid collection',${event.id},${event.occurred_at})`;
   await tx`update app.commerce_order set revision=revision+1,payment_status='confirmed',actionable_at=${event.occurred_at} where id=${order.id}`;
   await initializeFulfillments(tx,order.id);
   await enqueueCommissionAccrual(tx,order.id);
   // Source may precede the additive signal migration during local upgrade.
   // Once installed, its funded-result seal forbids a receipt-only commit.
   const [signals]=await tx`select to_regclass('app.commerce_event') is not null installed`;
   if(signals.installed)await recordPurchase(tx,receiptId as string);
  }
 }
 if(outcome==='recovery'){
  const [exceptions]=await tx`select to_regclass('app.commerce_exception') is not null installed`;
  if(exceptions.installed)await openCollectionException(tx,'local.payment',event.id);
 }
 return {event_id:event.id,outcome};
}
