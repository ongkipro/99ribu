import {createHash,randomUUID} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {readLocalConfig} from '../../../config/local.ts';
import type {Claim,JobAdapter} from '../../../jobs/leases.ts';
import {AccessError} from '../../access/policy.ts';
import {id,integer,invalid,object} from '../../catalog/validation.ts';
import {fulfillmentClock} from '../../fulfillment/core.ts';
import {lockRecoveryCollectionBasis} from './collection.ts';
import {lockException} from './core.ts';
import {advanceRecoveryRefund,type RecoveryRefundHead} from './refunds.ts';
import {ingestRecoverySourceEvent,readRecoveryDestinationSource,readRecoverySourceEvent,registerRecoverySourceEvent,simulateRecoveryOutcome,verifyRecoveryDestinationSource,verifyRecoverySourceEvent} from './refund-source.ts';

// Leased 'recovery.refund.create' preparation, registered in scripts/worker.ts;
// its signed bank outcome is applied by the 'recovery.refund.callback' owner.
export async function prepareRecoveryRefundOperation(sql:Sql,target:'local'|'test',claim:Claim,reconciliation=false,beforeCommit=false){
 readLocalConfig(process.env);const input=object(claim.payload,['refundId','attempt']),refundId=id(input.refundId),attempt=integer(input.attempt,1);
 if(claim.kind!=='recovery.refund.create')throw invalid();
 return sql.begin(async tx=>{
  const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`||!['local','test'].includes(target))throw invalid();
  const [before]=await tx`select exception_id from app.recovery_refund where id=${refundId}`;if(!before)throw new AccessError(400,'INVALID_RECOVERY_REFUND_JOB');
  const {head:caseHead,order}=await lockException(tx,before.exception_id),[head]=await tx<RecoveryRefundHead[]>`select * from app.recovery_refund where id=${refundId} and exception_id=${caseHead.id} for update`;
  if(!head||head.order_id!==order.id)throw new AccessError(400,'INVALID_RECOVERY_REFUND_JOB');
  // Qualify the exact lease only after all original parent/case/refund waits.
  // Absence never lets an old process create another bank instruction later.
  const [lease]=await tx`select id from app.outbox_job where id=${claim.id} and kind='recovery.refund.create' and status='processing'
   and lease_token=${claim.token} and lease_until>clock_timestamp() and dispatched_at is not null
   and dedup_key=${`recovery-refund-create:${head.id}:${attempt}`} and payload=${JSON.stringify({refundId,attempt})}::jsonb for share`;
  if(!lease||head.current_job_id!==claim.id)throw new AccessError(409,'STALE_RECOVERY_REFUND_CLAIM');
  let [operation]=await tx`select * from app.local_recovery_operation where creation_job_id=${claim.id}`;
  if(!operation&&reconciliation)return null;
  if(operation&&head.current_operation_id!==operation.id)throw new AccessError(409,'RECOVERY_PROVIDER_CONTEXT_MISMATCH');
  const rail=order.payment_method==='prepaid'?'prepaid_original':'cod_verified_destination';
  if(!operation){
   if(!['refunding','unknown'].includes(caseHead.status)||head.status!=='queued'||head.current_operation_id!==null)throw new AccessError(409,'RECOVERY_PREPARATION_NOT_CURRENT');
   const allocations=await tx`select * from app.recovery_refund_allocation where refund_id=${head.id} order by fulfillment_item_id nulls last,id`;
   if(!allocations.length||allocations.length>100)throw new AccessError(409,'RECOVERY_ORIGINAL_ALLOCATION_MISMATCH');
   const basis=await lockRecoveryCollectionBasis(tx,order.id,head.basis_kind==='unallocated'
    ?{kind:'unallocated_collection',source_transaction_id:head.source_transaction_id}
    :{kind:'purchased_units',fulfillment_item_ids:allocations.map(row=>String(row.fulfillment_item_id))});
   const source=basis.sources[0];
   if(basis.environment!==target||basis.sources.length!==1||source.source_transaction_id!==head.source_transaction_id||source.source_event_id!==head.source_id||source.receipt_id!==head.receipt_id
    ||source.amount!==Number(head.amount)||source.source_amount!==Number(head.source_amount))throw new AccessError(409,'RECOVERY_ORIGINAL_ALLOCATION_MISMATCH');
   if(head.basis_kind==='purchased_units'){
    if(allocations.length!==source.units.length||allocations.some(allocation=>{
     const unit=source.units.find(unit=>unit.fulfillment_item_id===allocation.fulfillment_item_id);
     return !unit||allocation.receipt_id!==unit.receipt_id||allocation.purchase_event_id!==unit.purchase_event_id||Number(allocation.merchandise_amount)!==unit.merchandise_amount||Number(allocation.buyer_shipping)!==unit.buyer_shipping||Number(allocation.payment_charge)!==unit.payment_charge||Number(allocation.amount)!==unit.amount;
    }))throw new AccessError(409,'RECOVERY_ORIGINAL_ALLOCATION_MISMATCH');
   }else if(allocations.length!==1||allocations[0].fulfillment_item_id!==null||allocations[0].exception_unit_id!==null||allocations[0].receipt_id!==null||allocations[0].purchase_event_id!==null
    ||Number(allocations[0].merchandise_amount)!==0||Number(allocations[0].buyer_shipping)!==0||Number(allocations[0].amount)!==source.amount)throw new AccessError(409,'RECOVERY_ORIGINAL_ALLOCATION_MISMATCH');
   const original=rail==='prepaid_original'?source.original_payment_operation_id:null,now=await fulfillmentClock(tx,order.clock_namespace);
   if(rail==='prepaid_original'&&original===null)throw new AccessError(409,'RECOVERY_ORIGINAL_PAYER_MISMATCH');
   if(rail==='cod_verified_destination'){
    if(!head.destination_source_id)throw new AccessError(409,'RECOVERY_DESTINATION_UNVERIFIED');const stored=await readRecoveryDestinationSource(tx,head.destination_source_id);if(!stored)throw new AccessError(409,'RECOVERY_DESTINATION_UNVERIFIED');const recipient=verifyRecoveryDestinationSource(stored);
    if(recipient.refund_id!==head.id||recipient.environment!==target||recipient.buyer_scope!==(order.owner_user_id?`user:${order.owner_user_id}`:`guest:${order.owner_guest_id}`)
     ||Date.parse(recipient.occurred_at)<new Date(head.created_at).getTime()||Date.parse(recipient.occurred_at)>Date.parse(now))throw new AccessError(409,'RECOVERY_DESTINATION_UNVERIFIED');
   }
   const operationId=randomUUID(),hash=createHash('sha256').update(JSON.stringify(['99ribu-recovery-refund-request-v1',target,head.id,claim.id,attempt,rail,original,head.destination_source_id,head.source_transaction_id,Number(head.amount),order.clock_namespace])).digest('hex');
   const [current]=await tx`select id from app.outbox_job where id=${claim.id} and lease_token=${claim.token} and lease_until>clock_timestamp()`;if(!current)throw new AccessError(409,'STALE_RECOVERY_REFUND_CLAIM');
   [operation]=await tx`insert into app.local_recovery_operation (id,refund_id,creation_job_id,attempt,environment,rail,original_payment_operation_id,destination_source_id,source_transaction_id,amount,clock_namespace,request_hash,created_at)
    values (${operationId},${head.id},${claim.id},${attempt},${target},${rail},${original},${head.destination_source_id},${head.source_transaction_id},${Number(head.amount)},${order.clock_namespace},${hash},${now}) returning *`;
   await advanceRecoveryRefund(tx,head,{...head,status:'processing',current_operation_id:operationId},{kind:'prepare',source_kind:'job',source_id:claim.id,reason:'Original fenced recovery bank request prepared; no outgoing money is confirmed',occurred_at:now});
  }
  const expectedHash=createHash('sha256').update(JSON.stringify(['99ribu-recovery-refund-request-v1',target,head.id,claim.id,attempt,rail,operation.original_payment_operation_id,head.destination_source_id,head.source_transaction_id,Number(head.amount),order.clock_namespace])).digest('hex');
  if(operation.refund_id!==head.id||operation.environment!==target||operation.attempt!==attempt||operation.creation_job_id!==claim.id||operation.rail!==rail||operation.destination_source_id!==head.destination_source_id
   ||operation.source_transaction_id!==head.source_transaction_id||operation.clock_namespace!==order.clock_namespace||Number(operation.amount)!==Number(head.amount)||operation.request_hash!==expectedHash)throw new AccessError(409,'RECOVERY_PROVIDER_CONTEXT_MISMATCH');
  if(beforeCommit)throw new Error('Simulated recovery request rollback before commit');
  const events=await tx`select id from app.local_recovery_event where operation_id=${operation.id} order by recorded_at,id`,sources=[];
  for(const event of events){const source=await readRecoverySourceEvent(tx,event.id);if(!source)throw new AccessError(409,'RECOVERY_SOURCE_MISSING');sources.push(verifyRecoverySourceEvent(source));}
  return {operation_id:String(operation.id),events:sources};
 });
}

export function recoveryRefundAdapter(sql:Sql,target:'local'|'test',faults:ReadonlyMap<string,'before-commit'|'creation-commit-lost-ack'|'paid-commit-lost-ack'>=new Map()):JobAdapter{
 const resolve=async(claim:Claim,reconciliation:boolean)=>{
  const created=await prepareRecoveryRefundOperation(sql,target,claim,reconciliation,!reconciliation&&faults.get(String(claim.payload.refundId))==='before-commit');
  if(!created)return {status:'retryable' as const,code:'TEMPORARY_UNAVAILABLE' as const};
  if(!reconciliation&&faults.get(String(claim.payload.refundId))==='creation-commit-lost-ack')throw new Error('Simulated recovery request acknowledgement loss after commit');
  if(!reconciliation&&faults.get(String(claim.payload.refundId))==='paid-commit-lost-ack'){await simulateRecoveryOutcome(sql,target,String(claim.payload.refundId),'succeeded');throw new Error('Simulated recovery bank acknowledgement loss after commit');}
  for(const source of created.events)await ingestRecoverySourceEvent(sql,source);
  return {status:'succeeded' as const,receipt:{operation_id:created.operation_id}};
 };
 return {dispatch:claim=>resolve(claim,false),reconcile:claim=>resolve(claim,true)};
}

// Shared callback recovery for the host and finance reconcile owners, mirroring
// returns recoverRefundCallbacks. It re-registers committed bank events, pulls
// pending callbacks forward and re-arms a terminally failed callback that has
// no applied result; 0026 accepts that failed->pending only with this exact
// same-transaction audit row (bound to the failure's attempts and completion).
export async function recoverRecoveryCallbacks(tx:TransactionSql,refundId:string,actorId:string|null,operationId:string|null){
 const events=await tx`select e.id from app.local_recovery_event e join app.local_recovery_operation p on p.id=e.operation_id where p.refund_id=${refundId} order by e.occurred_at,e.id`,jobs:string[]=[];
 for(const event of events){
  const stored=await readRecoverySourceEvent(tx,event.id);if(!stored)throw new AccessError(409,'RECOVERY_SOURCE_MISSING');
  const callback=await registerRecoverySourceEvent(tx,verifyRecoverySourceEvent(stored));jobs.push(callback);
  const [job]=await tx`select id,status,attempts,last_error,completed_at::text previous_completed_at from app.outbox_job where id=${callback} and kind='recovery.refund.callback' for update`;
  if(!job||!['pending','failed'].includes(job.status)||(await tx`select event_id from app.recovery_event_result where event_id=${event.id}`).length)continue;
  const rearm=job.status==='failed';
  if(rearm||job.last_error)await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${actorId},'local.recovery_refund.reconcile',${refundId},'allowed','Recover original authenticated recovery callback; never send new money',${JSON.stringify({operation_id:operationId,source_id:event.id,job_id:job.id,previous_status:job.status,previous_attempts:job.attempts,previous_error:job.last_error,...(rearm?{previous_completed_at:job.previous_completed_at}:{})})}::jsonb)`;
  await tx`update app.outbox_job set status='pending',attempts=${rearm?0:job.attempts},run_at=clock_timestamp(),completed_at=null,last_error=null where id=${job.id}`;
 }
 return jobs;
}

// Host-only source recovery, mirroring reconcileRefundNow. Creation jobs keep
// their attempts and unknown->pending stays refused; a known failed bank
// outcome needs the finance retryRecoveryRefund action for a new attempt.
export async function reconcileRecoveryRefundNow(sql:Sql,refundId:string){
 readLocalConfig(process.env);const selected=id(refundId);
 return sql.begin(async tx=>{
  const [before]=await tx`select exception_id from app.recovery_refund where id=${selected}`;if(!before)throw new AccessError(404,'NOT_FOUND');
  const {head:caseHead}=await lockException(tx,before.exception_id),[head]=await tx<RecoveryRefundHead[]>`select * from app.recovery_refund where id=${selected} and exception_id=${caseHead.id} for update`;
  if(!head)throw new AccessError(404,'NOT_FOUND');
  const jobs=await recoverRecoveryCallbacks(tx,head.id,null,null);
  if(head.current_job_id){
   const [job]=await tx`select id,status from app.outbox_job where id=${head.current_job_id} and kind='recovery.refund.create' for update`;
   if(job&&['pending','unknown'].includes(job.status)){
    await tx`insert into app.audit_event (action,subject_id,outcome,reason,details) values ('local.recovery_refund.reconcile',${head.id},'allowed','Recover the same fenced recovery request without resetting its attempts',${JSON.stringify({job_id:job.id,previous_status:job.status})}::jsonb)`;
    await tx`update app.outbox_job set run_at=clock_timestamp() where id=${job.id}`;jobs.unshift(String(job.id));
   }
  }
  await tx`set constraints all immediate`;return jobs;
 });
}
