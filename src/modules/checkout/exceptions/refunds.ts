import {createHash,randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {enqueueJob} from '../../../jobs/outbox.ts';
import type {LocalAuth} from '../../access/auth.ts';
import {consumeAccessProof} from '../../access/grants.ts';
import {AccessError,type Principal} from '../../access/policy.ts';
import {id,integer,invalid,object} from '../../catalog/validation.ts';
import {actorScope,type CommerceActor} from '../access.ts';
import {authorizeOrder} from '../orders.ts';
import {appendFinanceTransaction} from '../../finance/ledger.ts';
import {fulfillmentClock} from '../../fulfillment/core.ts';
import {refundFinanceAuthority} from '../../returns/refunds.ts';
import {returnText} from '../../returns/policy.ts';
import {intentHash,mutationKey} from '../carts.ts';
import {advanceException,exceptionProposal,exceptionUnits,finishExceptionOperation,insertExceptionOperation,lockException} from './core.ts';
import {qualifyRefundProposal} from './proposals.ts';
import {buyerRecoveryRequest,recoveryFinanceRequest} from './policy.ts';
import {projectException} from './projection.ts';
import {readRecoveryDestinationSource,readRecoverySourceEvent,verifyRecoveryDestinationSource,verifyRecoverySourceEvent} from './refund-source.ts';

export type RecoveryRefundHead={id:string;exception_id:string;order_id:string;operation_id:string;revision:number;status:string;basis_kind:'purchased_units'|'unallocated';source_kind:'payment_event'|'cod_event';source_id:string;source_transaction_id:string;receipt_id:string|null;source_amount:string;amount:string;obligation_transaction_id:string;cash_transaction_id:string|null;current_job_id:string|null;current_operation_id:string|null;destination_source_id:string|null;created_at:string};
type RecoveryRefundState=Pick<RecoveryRefundHead,'status'|'current_job_id'|'current_operation_id'|'destination_source_id'|'cash_transaction_id'>;

export async function advanceRecoveryRefund(tx:TransactionSql,head:RecoveryRefundHead,state:RecoveryRefundState,cause:{kind:string;source_kind:'operation'|'job'|'provider';source_id:string;reason:string;occurred_at:string}){
 if(head.revision===2147483647)throw new AccessError(409,'RECOVERY_REFUND_VERSION_EXHAUSTED');
 const eventId=randomUUID(),revision=head.revision+1;
 await tx`insert into app.recovery_refund_event (id,refund_id,revision,kind,status,source_kind,source_id,provider_operation_id,job_id,destination_source_id,cash_transaction_id,reason,occurred_at)
  values (${eventId},${head.id},${revision},${cause.kind},${state.status},${cause.source_kind},${cause.source_id},${state.current_operation_id},${state.current_job_id},${state.destination_source_id},${state.cash_transaction_id},${returnText(cause.reason,500)},${cause.occurred_at})`;
 const [current]=await tx<RecoveryRefundHead[]>`update app.recovery_refund set revision=${revision},status=${state.status},current_job_id=${state.current_job_id},current_operation_id=${state.current_operation_id},destination_source_id=${state.destination_source_id},cash_transaction_id=${state.cash_transaction_id} where id=${head.id} and revision=${head.revision} returning *`;
 if(!current)throw new AccessError(409,'VERSION_CONFLICT');return {head:current,eventId};
}

// Finance-only projection: callers own current finance authority and the
// original parent/case locks. Buyer recovery uses its separate safe contract.
export async function projectRecoveryRefundBatch(tx:TransactionSql,exceptionId:string):Promise<Record<string,unknown>>{
 const [row]=await tx`select app.recovery_refund_batch_projection(${id(exceptionId)}::uuid) value`;
 if(!row?.value)throw new AccessError(404,'NOT_FOUND');return row.value;
}

export function recoveryRefundQueueRequest(value:unknown){
 const input=object(value,['expected_version','reason','reauthentication_proof']);
 if(typeof input.reauthentication_proof!=='string'||input.reauthentication_proof.length<1||input.reauthentication_proof.length>100)throw invalid();
 return {normalized:{expected_version:integer(input.expected_version,1),reason:returnText(input.reason,500)},proof:input.reauthentication_proof};
}

// This internal writer consumes a dedicated existing proof. Its issuer and
// HTTP adapter remain closed until complete native/source execution gates.
export async function queueRecoveryRefund(request:Request,identity:LocalAuth,principal:Principal,exceptionId:string,value:unknown){
 const selected=id(exceptionId),{normalized,proof}=recoveryRefundQueueRequest(value),key=mutationKey(request),hash=await intentHash(identity,'commerce_exception.refund_queue',{exception_id:selected,...normalized});
 return identity.sql.begin(async tx=>{
  await refundFinanceAuthority(tx,principal,true);
  const {head,order}=await lockException(tx,selected);await refundFinanceAuthority(tx,principal,true);
  const [previous]=await tx`select exception_id,request_hash,response from app.exception_operation where actor_scope=${`user:${principal.id}`} and action='refund_queue' and key=${key}`;
  if(previous){if(previous.exception_id!==head.id||previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');await refundFinanceAuthority(tx,principal,true);return previous.response;}
  if(head.revision!==normalized.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  const proposal=await exceptionProposal(tx,head),[applied]=await tx`select id,snapshot->'application' application from app.exception_event where exception_id=${head.id}
   and revision=${head.revision} and kind in ('cancel','source_reconciled') and status='ready_for_refund'`;
  if(head.status!=='ready_for_refund'||!proposal||!['cancel_affected_units','refund_original_entitlement'].includes(proposal.action)
    ||applied?.application?.proposal_id!==proposal.id||(await tx`select id from app.recovery_refund where exception_id=${head.id} limit 1`).length)throw new AccessError(409,'RECOVERY_REFUND_NOT_READY');
  const units=await exceptionUnits(tx,head.id);
  const funded=head.kind==='unallocated_collection'?[]:await tx`select distinct unit.fulfillment_item_id id from app.exception_unit unit
   join app.economic_receipt receipt on receipt.order_id=${order.id} where unit.exception_id=${head.id} and unit.active
    and unit.fulfillment_item_id in (select id from app.receipt_entitled_unit_ids(receipt.id))
    and (${head.kind==='late_collection'} or (exists(select 1 from app.exception_cancellation cancellation where cancellation.exception_unit_id=unit.id and cancellation.event_id=${applied.id})
     and (unit.replacement_link_id is null or ${proposal.action==='refund_original_entitlement'}))) order by unit.fulfillment_item_id`;
  if(head.kind!=='unallocated_collection'&&!funded.length)throw new AccessError(409,'RECOVERY_REFUND_NOT_READY');
  const basis=await qualifyRefundProposal(tx,head,head.kind==='unallocated_collection'?undefined:funded.map(row=>String(row.id)));
  await refundFinanceAuthority(tx,principal,true);
  const operation=await insertExceptionOperation(tx,head,{kind:'user',id:principal.id,principal},key,'refund_queue',head.id,hash,normalized,createHash('sha256').update(proof).digest('hex'));
  await consumeAccessProof(tx,principal,'finance.recovery_refund',head.id,proof);
  for(const source of basis.sources){
   const refundId=randomUUID(),obligation=await appendFinanceTransaction(tx,{kind:'recovery_obligation',source:'local.recovery.obligation',environment:basis.environment,effect_reference:refundId,
    order_id:order.id,reason:normalized.reason,occurred_at:operation.occurred_at,postings:[{account:'buyer_funds_liability',side:'debit',amount:source.amount},{account:'refund_payable',side:'credit',amount:source.amount}]});
   const job=order.payment_method==='prepaid'?await enqueueJob(tx,'recovery.refund.create',`recovery-refund-create:${refundId}:1`,{refundId,attempt:1}):null,status=job?'queued':'awaiting_destination';
   await tx`insert into app.recovery_refund (id,exception_id,order_id,operation_id,revision,status,basis_kind,source_kind,source_id,source_transaction_id,receipt_id,source_amount,amount,obligation_transaction_id,current_job_id,created_at)
    values (${refundId},${head.id},${order.id},${operation.id},1,${status},${basis.basis_kind},${order.payment_method==='prepaid'?'payment_event':'cod_event'},${source.source_event_id},${source.source_transaction_id},${source.receipt_id},${source.source_amount},${source.amount},${obligation.id},${job},${operation.occurred_at})`;
   for(const original of source.units){
    const unit=units.find(unit=>unit.active&&unit.fulfillment_item_id===original.fulfillment_item_id);if(!unit)throw new AccessError(409,'EXCEPTION_COMPONENT_SCOPE_MISMATCH');
    await tx`insert into app.recovery_refund_allocation (refund_id,exception_unit_id,fulfillment_item_id,receipt_id,purchase_event_id,merchandise_amount,buyer_shipping,amount)
     values (${refundId},${unit.id},${original.fulfillment_item_id},${original.receipt_id},${original.purchase_event_id},${original.merchandise_amount},${original.buyer_shipping},${original.amount})`;
   }
   if(basis.basis_kind==='unallocated')await tx`insert into app.recovery_refund_allocation (refund_id,merchandise_amount,buyer_shipping,amount) values (${refundId},0,0,${source.amount})`;
   await tx`insert into app.recovery_refund_event (refund_id,revision,kind,status,source_kind,source_id,job_id,reason,occurred_at)
    values (${refundId},1,'queue',${status},'operation',${operation.id},${job},${normalized.reason},${operation.occurred_at})`;
  }
  await advanceException(tx,head,{kind:'refund_queue',status:'refunding',source_kind:'operation',source_id:operation.id,actor_id:principal.id,reason:normalized.reason,occurred_at:operation.occurred_at,proposal_event_id:head.proposal_event_id});
  await refundFinanceAuthority(tx,principal,true);
  return finishExceptionOperation(tx,operation.id,await projectRecoveryRefundBatch(tx,head.id));
 });
}

// S71 finance retry, mirroring returns recoverRefund 'retry': only after the
// current attempt is a known zero-money outcome (signed failed bank result, or a
// creation job that failed before any bank request), start attempt+1 with a
// fresh creation job. The 0026 guards re-verify every condition.
// Mounted as POST /api/v1/admin/commerce-exceptions/{exceptionId}/refunds/{refundId}/retries.
export async function retryRecoveryRefund(request:Request,identity:LocalAuth,principal:Principal,exceptionId:string,refundId:string,value:unknown){
 const selectedException=id(exceptionId),selectedRefund=id(refundId),input=recoveryFinanceRequest(value),key=mutationKey(request);
 const normalized={expected_version:input.expected_version,reason:input.reason};
 const hash=await intentHash(identity,'commerce_exception.refund_retry',{exception_id:selectedException,refund_id:selectedRefund,...normalized});
 return identity.sql.begin(async tx=>{
  await refundFinanceAuthority(tx,principal,true);
  const {head:caseHead}=await lockException(tx,selectedException),[head]=await tx<RecoveryRefundHead[]>`select * from app.recovery_refund where id=${selectedRefund} and exception_id=${caseHead.id} for update`;
  if(!head)throw new AccessError(404,'NOT_FOUND');
  await refundFinanceAuthority(tx,principal,true);
  const [previous]=await tx`select subject_id,request_hash,response from app.exception_operation where actor_scope=${`user:${principal.id}`} and action='refund_retry' and key=${key}`;
  if(previous){if(previous.subject_id!==head.id||previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response as Record<string,unknown>;}
  if(head.revision!==normalized.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  const [currentJob]=head.current_job_id?await tx`select * from app.outbox_job where id=${head.current_job_id} and kind='recovery.refund.create' for share`:[];
  if(!currentJob||!['completed','failed'].includes(currentJob.status)||!['queued','failed'].includes(head.status)||head.cash_transaction_id!==null||!['refunding','unknown'].includes(caseHead.status))throw new AccessError(409,'RECOVERY_OUTCOME_STILL_AMBIGUOUS');
  if(head.current_operation_id){
   const events=await tx`select e.id,r.outcome from app.local_recovery_event e left join app.recovery_event_result r on r.event_id=e.id where e.operation_id=${head.current_operation_id}`;
   if(head.status!=='failed'||events.length!==1||events[0].outcome!=='failed')throw new AccessError(409,'RECOVERY_OUTCOME_STILL_AMBIGUOUS');
   const stored=await readRecoverySourceEvent(tx,events[0].id);if(!stored||verifyRecoverySourceEvent(stored).status!=='failed')throw new AccessError(409,'RECOVERY_OUTCOME_STILL_AMBIGUOUS');
  }else if(currentJob.status!=='failed'||(await tx`select id from app.local_recovery_operation where creation_job_id=${currentJob.id}`).length)throw new AccessError(409,'RECOVERY_OUTCOME_STILL_AMBIGUOUS');
  const nextAttempt=integer(currentJob.payload.attempt,1)+1;if(nextAttempt>2147483647)throw new AccessError(409,'RECOVERY_ATTEMPTS_EXHAUSTED');
  await refundFinanceAuthority(tx,principal,true);
  const operation=await insertExceptionOperation(tx,caseHead,{kind:'user',id:principal.id,principal},key,'refund_retry',head.id,hash,normalized,createHash('sha256').update(input.reauthentication_proof).digest('hex'));
  await consumeAccessProof(tx,principal,'finance.recovery_refund',head.id,input.reauthentication_proof);
  const job=await enqueueJob(tx,'recovery.refund.create',`recovery-refund-create:${head.id}:${nextAttempt}`,{refundId:head.id,attempt:nextAttempt});
  await advanceRecoveryRefund(tx,head,{...head,status:'queued',current_job_id:job,current_operation_id:null},{kind:'retry',source_kind:'operation',source_id:operation.id,reason:normalized.reason,occurred_at:operation.occurred_at});
  await refundFinanceAuthority(tx,principal,true);
  const [projected]=await tx`select app.recovery_refund_projection(${head.id}::uuid) value`;
  return finishExceptionOperation(tx,operation.id,projected.value as Record<string,unknown>);
 });
}

export async function acceptRecoveryDestination(request:Request,identity:LocalAuth,actor:CommerceActor|null,orderId:string,value:unknown){
 const selected=id(orderId),input=buyerRecoveryRequest(value);if(input.action!=='accept_destination')throw invalid();
 const refundId=id(input.refund_id),destinationId=id(input.destination_source_id);
 const key=mutationKey(request),hash=await intentHash(identity,'commerce_exception.destination',{order_id:selected,...input});
 return identity.sql.begin(async tx=>{
  await authorizeOrder(tx,request,identity,actor,selected);
  if(!(await tx`select id from app.commerce_exception where id=${input.exception_id} and order_id=${selected}`).length)throw new AccessError(404,'NOT_FOUND');
  const {head,order}=await lockException(tx,input.exception_id);await authorizeOrder(tx,request,identity,actor,selected);
  if(order.id!==selected)throw new AccessError(404,'NOT_FOUND');
  if(!actor&&!order.owner_guest_id)throw new AccessError(401,'UNAUTHENTICATED');const currentActor:CommerceActor=actor??{kind:'guest',id:order.owner_guest_id as string};
  const [previous]=await tx`select exception_id,request_hash,response from app.exception_operation where actor_scope=${actorScope(currentActor)} and action='destination' and key=${key}`;
  if(previous){if(previous.exception_id!==head.id||previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');await authorizeOrder(tx,request,identity,actor,selected);return previous.response;}
  if(head.revision!==input.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  const [refund]=await tx<RecoveryRefundHead[]>`select * from app.recovery_refund where id=${refundId} and exception_id=${head.id} and order_id=${selected} for update`;
  if(!refund)throw new AccessError(404,'NOT_FOUND');
  if(order.payment_method!=='cod'||head.status!=='refunding'||refund.status!=='awaiting_destination'||refund.destination_source_id!==null||refund.current_job_id!==null||refund.current_operation_id!==null||refund.cash_transaction_id!==null)throw new AccessError(409,'RECOVERY_DESTINATION_NOT_CURRENT');
  const stored=await readRecoveryDestinationSource(tx,destinationId);if(!stored)throw new AccessError(404,'NOT_FOUND');const source=verifyRecoveryDestinationSource(stored);
  const [database]=await tx`select current_database() name`,environment=database.name==='99ribu_test'?'test':database.name==='99ribu_local'?'local':null,now=await fulfillmentClock(tx,order.clock_namespace);
  if(source.refund_id!==refund.id||source.environment!==environment||source.buyer_scope!==(order.owner_user_id?`user:${order.owner_user_id}`:`guest:${order.owner_guest_id}`)||Date.parse(source.occurred_at)<new Date(refund.created_at).getTime()||Date.parse(source.occurred_at)>Date.parse(now))throw new AccessError(409,'RECOVERY_DESTINATION_UNVERIFIED');
  await authorizeOrder(tx,request,identity,actor,selected);
  const operation=await insertExceptionOperation(tx,head,currentActor,key,'destination',refund.id,hash,input),job=await enqueueJob(tx,'recovery.refund.create',`recovery-refund-create:${refund.id}:1`,{refundId:refund.id,attempt:1});
  const reason='Original buyer accepted the independently verified recovery recipient';
  await advanceRecoveryRefund(tx,refund,{...refund,status:'queued',destination_source_id:source.id,current_job_id:job},{kind:'destination',source_kind:'operation',source_id:operation.id,reason,occurred_at:operation.occurred_at});
  await advanceException(tx,head,{kind:'source_reconciled',status:'refunding',source_kind:'operation',source_id:operation.id,actor_id:currentActor.kind==='user'?currentActor.id:null,reason,occurred_at:operation.occurred_at,proposal_event_id:head.proposal_event_id});
  await authorizeOrder(tx,request,identity,actor,selected);
  return finishExceptionOperation(tx,operation.id,await projectException(tx,head.id,true));
 });
}
