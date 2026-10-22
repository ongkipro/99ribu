import {createHash,randomUUID} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {readLocalConfig} from '../../config/local.ts';
import type {Claim,JobAdapter} from '../../jobs/leases.ts';
import {AccessError} from '../access/policy.ts';
import {id,integer,invalid,object} from '../catalog/validation.ts';
import {appendFinanceTransaction} from '../finance/ledger.ts';
import {fulfillmentClock} from '../fulfillment/core.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';
import {advanceReturn,returnUnits,type ReturnHead} from './cases.ts';
import {lockRefundAdjustmentBasis,lockRefundCollectionBasis} from './financial-basis.ts';
import {advanceRefund,type RefundHead} from './refunds.ts';
import {ingestRefundSourceEvent,readRefundDestinationSource,readRefundSourceEvent,simulateRefundOutcome,verifyRefundDestinationSource,verifyRefundSourceEvent} from './refund-source.ts';

export async function prepareRefundOperation(sql:Sql,target:'local'|'test',claim:Claim,reconciliation=false,beforeCommit=false){
 readLocalConfig(process.env);const input=object(claim.payload,['refundId','attempt']),refundId=id(input.refundId),attempt=integer(input.attempt,1);
 if(claim.kind!=='refund.create')throw invalid();
 return sql.begin(async tx=>{
  const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`||!['local','test'].includes(target))throw invalid();
  const [before]=await tx`select order_id from app.refund where id=${refundId}`;if(!before)throw new AccessError(400,'INVALID_REFUND_JOB');
  const order=await lockPaymentOrder(tx,before.order_id),[head]=await tx<RefundHead[]>`select * from app.refund where id=${refundId} for update`;
  // The current lease is checked after order/refund lock waits, including an
  // absence lookup. An old process cannot later create the supposedly absent
  // bank request after another process has fenced that exact claim.
  const [lease]=await tx`select id from app.outbox_job where id=${claim.id} and kind='refund.create' and status='processing' and lease_token=${claim.token} and lease_until>clock_timestamp() and dispatched_at is not null and dedup_key=${`refund-create:${head.id}:${attempt}`} and payload=${JSON.stringify({refundId,attempt})}::jsonb for share`;
  if(!lease||head.current_job_id!==claim.id)throw new AccessError(409,'STALE_REFUND_CLAIM');
  let [operation]=await tx`select * from app.local_refund_operation where creation_job_id=${claim.id}`;
  if(!operation&&reconciliation)return null;
  if(!operation){
   if(head.status!=='queued'||head.current_operation_id!==null)throw new AccessError(409,'REFUND_PREPARATION_NOT_CURRENT');
   const allocations=await tx`select r.fulfillment_item_id from app.refund_allocation a join app.return_item r on r.id=a.return_item_id where a.refund_id=${head.id} order by r.fulfillment_item_id`,basis=await lockRefundCollectionBasis(tx,order.id,allocations.map(a=>a.fulfillment_item_id));
   if(basis.amount!==Number(head.amount)||basis.environment!==target)throw new AccessError(409,'REFUND_ORIGINAL_ALLOCATION_MISMATCH');
   const rail=order.payment_method==='prepaid'?'prepaid_original':'cod_verified_destination',original=rail==='prepaid_original'?basis.units[0].original_payment_operation_id:null;
   if(rail==='prepaid_original'&&basis.units.some(unit=>unit.original_payment_operation_id!==original))throw new AccessError(409,'REFUND_ORIGINAL_PAYER_MISMATCH');
   if(rail==='cod_verified_destination'){
    if(!head.destination_source_id)throw new AccessError(409,'REFUND_DESTINATION_UNVERIFIED');const stored=await readRefundDestinationSource(tx,head.destination_source_id);if(!stored)throw new AccessError(409,'REFUND_DESTINATION_UNVERIFIED');const source=verifyRefundDestinationSource(stored);
    if(source.refund_id!==head.id||source.environment!==target||source.buyer_scope!==(order.owner_user_id?`user:${order.owner_user_id}`:`guest:${order.owner_guest_id}`))throw new AccessError(409,'REFUND_DESTINATION_UNVERIFIED');
   }
   const now=await fulfillmentClock(tx,order.clock_namespace),operationId=randomUUID(),hash=createHash('sha256').update(JSON.stringify(['99ribu-refund-request-v1',target,head.id,claim.id,attempt,rail,original,head.destination_source_id,Number(head.amount),order.clock_namespace])).digest('hex');
   const [current]=await tx`select id from app.outbox_job where id=${claim.id} and lease_token=${claim.token} and lease_until>clock_timestamp()`;if(!current)throw new AccessError(409,'STALE_REFUND_CLAIM');
   [operation]=await tx`insert into app.local_refund_operation (id,refund_id,creation_job_id,attempt,environment,rail,original_payment_operation_id,destination_source_id,amount,clock_namespace,request_hash,created_at) values (${operationId},${head.id},${claim.id},${attempt},${target},${rail},${original},${head.destination_source_id},${Number(head.amount)},${order.clock_namespace},${hash},${now}) returning *`;
   await advanceRefund(tx,head,{...head,status:'processing',current_operation_id:operationId},{kind:'prepare',source_kind:'job',source_id:claim.id,reason:'Original fenced refund request prepared; no outgoing money is confirmed',occurred_at:now});
  }
  if(operation.refund_id!==head.id||operation.environment!==target||operation.attempt!==attempt||Number(operation.amount)!==Number(head.amount))throw new AccessError(409,'REFUND_PROVIDER_CONTEXT_MISMATCH');
  if(beforeCommit)throw new Error('Simulated refund request rollback before commit');
  const events=await tx`select id from app.local_refund_event where operation_id=${operation.id} order by recorded_at,id`,sources=[];
  for(const event of events){const source=await readRefundSourceEvent(tx,event.id);if(!source)throw new AccessError(409,'REFUND_SOURCE_MISSING');sources.push(verifyRefundSourceEvent(source));}
  return {operation_id:String(operation.id),events:sources};
 });
}

export function refundAdapter(sql:Sql,target:'local'|'test',faults:ReadonlyMap<string,'before-commit'|'creation-commit-lost-ack'|'paid-commit-lost-ack'>=new Map()):JobAdapter{
 const resolve=async(claim:Claim,reconciliation:boolean)=>{
  const created=await prepareRefundOperation(sql,target,claim,reconciliation,!reconciliation&&faults.get(String(claim.payload.refundId))==='before-commit');
  if(!created)return {status:'retryable' as const,code:'TEMPORARY_UNAVAILABLE' as const};
  if(!reconciliation&&faults.get(String(claim.payload.refundId))==='creation-commit-lost-ack')throw new Error('Simulated refund request acknowledgement loss after commit');
  if(!reconciliation&&faults.get(String(claim.payload.refundId))==='paid-commit-lost-ack'){await simulateRefundOutcome(sql,target,String(claim.payload.refundId),'succeeded');throw new Error('Simulated refund bank acknowledgement loss after commit');}
  for(const event of created.events)await ingestRefundSourceEvent(sql,event);
  return {status:'succeeded' as const,receipt:{operation_id:created.operation_id}};
 };
 return {dispatch:claim=>resolve(claim,false),reconcile:claim=>resolve(claim,true)};
}

export async function processRefundEvent(tx:TransactionSql,job:{id:string;payload:unknown}){
 const input=object(job.payload,['eventId']),eventId=id(input.eventId),[registered]=await tx`select p.*,r.order_id from app.refund_provider_event p join app.refund r on r.id=p.refund_id where p.id=${eventId} and p.callback_job_id=${job.id}`;
 if(!registered)throw new AccessError(400,'INVALID_REFUND_JOB');
 const order=await lockPaymentOrder(tx,registered.order_id),[head]=await tx<RefundHead[]>`select * from app.refund where id=${registered.refund_id} for update`,stored=await readRefundSourceEvent(tx,eventId);
 if(!stored)throw new AccessError(400,'INVALID_REFUND_JOB');const source=verifyRefundSourceEvent(stored);
 const [prior]=await tx`select outcome,revision from app.refund_event_result where event_id=${eventId}`;if(prior)return {event_id:eventId,refund_id:head.id,outcome:String(prior.outcome),version:Number(prior.revision)};
 const [database]=await tx`select current_database() name`,[operation]=await tx`select * from app.local_refund_operation where id=${source.operation_id}`;
 const now=await fulfillmentClock(tx,order.clock_namespace);
 if(database.name!==`99ribu_${source.environment}`||source.refund_id!==head.id||source.operation_id!==head.current_operation_id||operation.creation_job_id!==head.current_job_id||source.clock_namespace!==order.clock_namespace||source.expected_amount!==Number(head.amount)||!['processing','unknown'].includes(head.status)||Date.parse(source.occurred_at)<new Date(operation.created_at).getTime()||Date.parse(source.occurred_at)>Date.parse(now))throw new AccessError(409,'REFUND_SOURCE_NOT_CURRENT');
 const [returnCase]=await tx<ReturnHead[]>`select * from app.return_case where id=${head.case_id} for update`,items=await returnUnits(tx,head.case_id),allocations=await tx`select * from app.refund_allocation where refund_id=${head.id} order by return_item_id`;
 if(returnCase.status!=='refunding'||returnCase.resolution!=='refund'||allocations.length!==items.length||items.some(item=>item.claim_state!=='held'||!['accepted','waived'].includes(item.inspection_status)))throw new AccessError(409,'REFUND_ALLOCATION_NOT_CURRENT');
 const basis=await lockRefundCollectionBasis(tx,order.id,items.map(item=>item.fulfillment_item_id));
 if(basis.amount!==Number(head.amount))throw new AccessError(409,'REFUND_ORIGINAL_ALLOCATION_MISMATCH');
 for(const item of items){const allocation=allocations.find(a=>a.return_item_id===item.id),unit=basis.units.find(u=>u.fulfillment_item_id===item.fulfillment_item_id);if(!allocation||!unit||allocation.receipt_id!==unit.receipt_id||allocation.purchase_event_id!==unit.purchase_event_id||Number(allocation.merchandise_amount)!==unit.merchandise_amount||Number(allocation.buyer_shipping)!==unit.buyer_shipping||Number(allocation.payment_charge)!==unit.payment_charge||Number(allocation.amount)!==unit.amount)throw new AccessError(409,'REFUND_ORIGINAL_ALLOCATION_MISMATCH');}
 let cashId:string|null=null;
 if(source.status==='succeeded')cashId=(await appendFinanceTransaction(tx,{kind:'refund_cash',source:'local.refund.bank',environment:source.environment,effect_reference:source.id,order_id:order.id,reason:'Original authenticated company-bank debit confirms allocated refund',occurred_at:source.occurred_at,postings:[{account:'refund_payable',side:'debit',amount:source.amount},{account:'company_cash',side:'credit',amount:source.amount}]})).id;
 const outcome=source.status==='succeeded'?'confirmed':'failed',changed=await advanceRefund(tx,head,{...head,status:source.status,cash_transaction_id:cashId},{kind:source.status==='succeeded'?'confirm':'fail',source_kind:'provider',source_id:source.id,reason:source.status==='succeeded'?'Original signed bank debit confirms refund':'Original signed bank instruction was rejected without sending money',occurred_at:source.occurred_at});
 await advanceReturn(tx,returnCase,{kind:source.status==='succeeded'?'refund_confirmed':'refund_failed',status:source.status==='succeeded'?'resolved':'refunding',resolution:'refund',requires_goods:returnCase.requires_goods,cause:{source_kind:'refund',source_id:changed.eventId,actor_id:null,reason:source.status==='succeeded'?'Original outgoing bank effect confirmed':'No outgoing money; obligation retained for explicit finance recovery',occurred_at:source.occurred_at},states:source.status==='succeeded'?items.map(item=>({id:item.id,claim_state:'refunded',inspection_status:item.inspection_status})):[]});
 if(source.status==='succeeded')for(const receiptId of [...new Set(allocations.map(a=>String(a.receipt_id)))].sort()){
  const selected=allocations.filter(a=>a.receipt_id===receiptId),adjustment=await lockRefundAdjustmentBasis(tx,receiptId),purchaseId=selected[0].purchase_event_id;
  const allocation=selected.map(a=>{const item=items.find(i=>i.id===a.return_item_id);if(!item)throw invalid();return {fulfillment_item_id:item.fulfillment_item_id,order_item_id:item.order_item_id,quantity:1,merchandise_amount:Number(a.merchandise_amount)};}).sort((a,b)=>a.fulfillment_item_id.localeCompare(b.fulfillment_item_id));
  await tx`insert into app.refund_adjustment_intent (refund_id,receipt_id,purchase_event_id,dispatch_reason,sequence,merchandise_refunded,retained_merchandise,allocation,original_occurred_at,confirmed_at) values (${head.id},${receiptId},${purchaseId},${purchaseId===null?'original_purchase_missing':'pending_adapter'},${adjustment.next_sequence},${selected.reduce((sum,a)=>sum+Number(a.merchandise_amount),0)},${adjustment.retained_merchandise},${JSON.stringify(allocation)}::jsonb,${adjustment.original_occurred_at},${source.occurred_at})`;
 }
 await tx`insert into app.refund_event_result (event_id,refund_id,revision,outcome,refund_event_id,cash_transaction_id) values (${source.id},${head.id},${changed.head.revision},${outcome},${changed.eventId},${cashId})`;
 return {event_id:eventId,refund_id:head.id,outcome,version:changed.head.revision};
}
