import type {TransactionSql} from 'postgres';
import {AccessError} from '../../access/policy.ts';
import {id,invalid,object} from '../../catalog/validation.ts';
import {appendFinanceTransaction} from '../../finance/ledger.ts';
import {fulfillmentClock} from '../../fulfillment/core.ts';
import {lockRefundAdjustmentBasis} from '../../returns/financial-basis.ts';
import {lockRecoveryCollectionBasis} from './collection.ts';
import {advanceException,lockException} from './core.ts';
import {recordRecoveryReplacementClaims} from './refund-claims.ts';
import {readRecoveryDestinationSource,readRecoverySourceEvent,verifyRecoveryDestinationSource,verifyRecoverySourceEvent} from './refund-source.ts';
import {advanceRecoveryRefund,type RecoveryRefundHead} from './refunds.ts';

// Registered 'recovery.refund.callback' owner. processDatabaseJob completes the
// exact callback job and checks the native effect seals in this savepoint.
// A terminally failed callback without a result is re-armed only by
// recoverRecoveryCallbacks under its audited owner action (0026).
export async function processRecoveryRefundEvent(tx:TransactionSql,job:{id:string;payload:unknown}){
 const input=object(job.payload,['eventId']),eventId=id(input.eventId),[registered]=await tx`select provider.*,refund.exception_id from app.recovery_provider_event provider
  join app.recovery_refund refund on refund.id=provider.refund_id where provider.id=${eventId} and provider.callback_job_id=${job.id}`;
 if(!registered)throw new AccessError(400,'INVALID_RECOVERY_REFUND_JOB');
 const {head:caseHead,order}=await lockException(tx,registered.exception_id),[head]=await tx<RecoveryRefundHead[]>`select * from app.recovery_refund where id=${registered.refund_id} and exception_id=${caseHead.id} for update`;
 if(!head||head.order_id!==order.id)throw new AccessError(400,'INVALID_RECOVERY_REFUND_JOB');
 const stored=await readRecoverySourceEvent(tx,eventId);if(!stored)throw new AccessError(400,'INVALID_RECOVERY_REFUND_JOB');const source=verifyRecoverySourceEvent(stored);
 const [prior]=await tx`select outcome,revision from app.recovery_event_result where event_id=${eventId}`;
 if(prior)return {event_id:eventId,refund_id:head.id,outcome:String(prior.outcome),version:Number(prior.revision)};
 const [database]=await tx`select current_database() name`,[operation]=await tx`select * from app.local_recovery_operation where id=${source.operation_id}`,now=await fulfillmentClock(tx,order.clock_namespace);
 if(!operation||database.name!==`99ribu_${source.environment}`||source.refund_id!==head.id||source.operation_id!==head.current_operation_id||operation.refund_id!==head.id||operation.creation_job_id!==head.current_job_id
  ||operation.environment!==source.environment||operation.source_transaction_id!==head.source_transaction_id||source.source_transaction_id!==head.source_transaction_id
  ||operation.clock_namespace!==order.clock_namespace||source.clock_namespace!==order.clock_namespace||operation.rail!==source.rail||source.rail!==(order.payment_method==='prepaid'?'prepaid_original':'cod_verified_destination')
  ||operation.original_payment_operation_id!==source.original_payment_operation_id||operation.destination_source_id!==head.destination_source_id||source.destination_source_id!==head.destination_source_id
  ||Number(operation.amount)!==Number(head.amount)||source.expected_amount!==Number(head.amount)||!['processing','unknown'].includes(head.status)||!['refunding','unknown'].includes(caseHead.status)
  ||head.cash_transaction_id!==null||Date.parse(source.occurred_at)<new Date(operation.created_at).getTime()||Date.parse(source.occurred_at)>Date.parse(now))throw new AccessError(409,'RECOVERY_SOURCE_NOT_CURRENT');
 const allocations=await tx`select * from app.recovery_refund_allocation where refund_id=${head.id} order by fulfillment_item_id nulls last,id`;
 if(!allocations.length||allocations.length>100)throw new AccessError(409,'RECOVERY_ORIGINAL_ALLOCATION_MISMATCH');
 const basis=await lockRecoveryCollectionBasis(tx,order.id,head.basis_kind==='unallocated'
  ?{kind:'unallocated_collection',source_transaction_id:head.source_transaction_id}
  :{kind:'purchased_units',fulfillment_item_ids:allocations.map(row=>String(row.fulfillment_item_id))});
 const original=basis.sources[0];
 if(basis.sources.length!==1||basis.environment!==source.environment||original.source_transaction_id!==head.source_transaction_id||original.source_event_id!==head.source_id||original.receipt_id!==head.receipt_id
  ||original.source_amount!==Number(head.source_amount)||original.amount!==Number(head.amount)||(source.rail==='prepaid_original'&&original.original_payment_operation_id!==source.original_payment_operation_id))throw new AccessError(409,'RECOVERY_ORIGINAL_ALLOCATION_MISMATCH');
 if(head.basis_kind==='purchased_units'){
  if(allocations.length!==original.units.length||allocations.some(allocation=>{
   const unit=original.units.find(unit=>unit.fulfillment_item_id===allocation.fulfillment_item_id);
   return !unit||allocation.receipt_id!==unit.receipt_id||allocation.purchase_event_id!==unit.purchase_event_id||Number(allocation.merchandise_amount)!==unit.merchandise_amount||Number(allocation.buyer_shipping)!==unit.buyer_shipping||Number(allocation.payment_charge)!==unit.payment_charge||Number(allocation.amount)!==unit.amount;
  }))throw new AccessError(409,'RECOVERY_ORIGINAL_ALLOCATION_MISMATCH');
 }else if(allocations.length!==1||allocations[0].exception_unit_id!==null||allocations[0].fulfillment_item_id!==null||allocations[0].receipt_id!==null||allocations[0].purchase_event_id!==null
  ||Number(allocations[0].merchandise_amount)!==0||Number(allocations[0].buyer_shipping)!==0||Number(allocations[0].amount)!==original.amount)throw new AccessError(409,'RECOVERY_ORIGINAL_ALLOCATION_MISMATCH');
 if(source.rail==='cod_verified_destination'){
  if(!head.destination_source_id)throw new AccessError(409,'RECOVERY_DESTINATION_UNVERIFIED');const stored=await readRecoveryDestinationSource(tx,head.destination_source_id);if(!stored)throw new AccessError(409,'RECOVERY_DESTINATION_UNVERIFIED');const recipient=verifyRecoveryDestinationSource(stored);
  if(recipient.refund_id!==head.id||recipient.environment!==source.environment||recipient.buyer_scope!==(order.owner_user_id?`user:${order.owner_user_id}`:`guest:${order.owner_guest_id}`)
   ||Date.parse(recipient.occurred_at)<new Date(head.created_at).getTime()||Date.parse(recipient.occurred_at)>Date.parse(source.occurred_at))throw new AccessError(409,'RECOVERY_DESTINATION_UNVERIFIED');
 }
 let cashId:string|null=null;
 if(source.status==='succeeded')cashId=(await appendFinanceTransaction(tx,{kind:'recovery_cash',source:'local.recovery.bank',environment:source.environment,effect_reference:source.id,order_id:order.id,
  reason:'Original authenticated company-bank debit confirms original-source recovery',occurred_at:source.occurred_at,
  postings:[{account:'refund_payable',side:'debit',amount:source.amount},{account:'company_cash',side:'credit',amount:source.amount}]})).id;
 // Aggregate history records when the result is applied. Its immutable source,
 // cash and adjustment retain the actual bank time, including late callbacks.
 const outcome=source.status==='succeeded'?'confirmed':'failed',changed=await advanceRecoveryRefund(tx,head,{...head,status:source.status,cash_transaction_id:cashId},
  {kind:source.status==='succeeded'?'confirm':'fail',source_kind:'provider',source_id:source.id,
   reason:source.status==='succeeded'?'Original signed bank debit confirms recovery refund':'Original signed recovery instruction was rejected without sending money',occurred_at:now});
 if(source.status==='succeeded'){
  await recordRecoveryReplacementClaims(tx,head.id,changed.eventId,now);
  if(head.receipt_id!==null){
   const adjustment=await lockRefundAdjustmentBasis(tx,head.receipt_id),purchaseId=allocations[0].purchase_event_id;
   const allocation=allocations.map(row=>{
    const unit=original.units.find(unit=>unit.fulfillment_item_id===row.fulfillment_item_id);if(!unit)throw invalid();
    return {fulfillment_item_id:unit.fulfillment_item_id,order_item_id:unit.order_item_id,quantity:1,merchandise_amount:Number(row.merchandise_amount)};
   }).sort((a,b)=>a.fulfillment_item_id.localeCompare(b.fulfillment_item_id));
   await tx`insert into app.recovery_adjustment_intent (refund_id,receipt_id,purchase_event_id,dispatch_reason,sequence,merchandise_refunded,retained_merchandise,allocation,original_occurred_at,confirmed_at)
    values (${head.id},${head.receipt_id},${purchaseId},${purchaseId===null?'original_purchase_missing':'pending_adapter'},${adjustment.next_sequence},${allocations.reduce((sum,row)=>sum+Number(row.merchandise_amount),0)},${adjustment.retained_merchandise},${JSON.stringify(allocation)}::jsonb,${adjustment.original_occurred_at},${source.occurred_at})`;
  }
 }
 const [batch]=await tx`select count(*)::int n,bool_and(status='succeeded') complete from app.recovery_refund where exception_id=${caseHead.id}`;
 if(!batch?.n)throw new AccessError(409,'RECOVERY_REFUND_NOT_CURRENT');
 const caseChanged=await advanceException(tx,caseHead,{kind:source.status==='succeeded'?'refund_confirmed':'refund_failed',status:batch.complete?'resolved':'refunding',source_kind:'refund',source_id:changed.eventId,actor_id:null,
  reason:source.status==='succeeded'?'Original outgoing bank effect confirmed for its exact recovery source':'No outgoing money; original recovery obligation retained for explicit finance follow-up',occurred_at:now,proposal_event_id:caseHead.proposal_event_id});
 await tx`insert into app.recovery_event_result (event_id,refund_id,revision,outcome,refund_event_id,exception_event_id,cash_transaction_id)
  values (${source.id},${head.id},${changed.head.revision},${outcome},${changed.eventId},${caseChanged.eventId},${cashId})`;
 return {event_id:eventId,refund_id:head.id,outcome,version:changed.head.revision};
}
