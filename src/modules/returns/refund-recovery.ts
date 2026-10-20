import {createHash} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {readLocalConfig} from '../../config/local.ts';
import {enqueueJob} from '../../jobs/outbox.ts';
import type {LocalAuth} from '../access/auth.ts';
import {consumeAccessProof} from '../access/grants.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {id,integer,invalid,object} from '../catalog/validation.ts';
import {actorScope,type CommerceActor} from '../checkout/access.ts';
import {intentHash,mutationKey} from '../checkout/carts.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';
import {finishReturnOperation,insertReturnOperation} from './cases.ts';
import {returnText} from './policy.ts';
import {advanceRefund,projectBuyerRefund,refundFinanceAuthority,type RefundHead} from './refunds.ts';
import {readRefundSourceEvent,registerRefundSourceEvent,verifyRefundSourceEvent} from './refund-source.ts';

async function recoverRefundCallbacks(tx:TransactionSql,refundId:string,actorId:string|null,operationId:string|null){
 const deliveries=await tx`select e.id from app.local_refund_event e join app.local_refund_operation o on o.id=e.operation_id where o.refund_id=${refundId} order by o.attempt,e.id`,callbacks:string[]=[];
 for(const delivery of deliveries){
  const source=await readRefundSourceEvent(tx,delivery.id);if(!source)throw new AccessError(409,'REFUND_SOURCE_MISSING');verifyRefundSourceEvent(source);
  const callback=await registerRefundSourceEvent(tx,source);callbacks.push(callback);
  const [job]=await tx`select id,status,attempts,last_error from app.outbox_job where id=${callback} for update`;
  if(['pending','unknown','failed'].includes(job.status)&&!(await tx`select event_id from app.refund_event_result where event_id=${delivery.id}`).length){
   const reset=job.status==='failed'||job.status==='unknown';
   if(reset||job.last_error)await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${actorId},'local.refund.reconcile',${refundId},'allowed','Recover original authenticated refund callback; never send new money',${JSON.stringify({operation_id:operationId,source_id:delivery.id,job_id:job.id,previous_status:job.status,previous_attempts:job.attempts,previous_error:job.last_error})}::jsonb)`;
   await tx`update app.outbox_job set status='pending',attempts=${reset?0:job.attempts},run_at=clock_timestamp(),completed_at=null,last_error=null where id=${job.id}`;
  }
 }
 return callbacks;
}

// Host-only source recovery. Unknown creation jobs retain the original identity
// and attempt counter. Failed creation jobs require explicit finance retry.
export async function reconcileRefundNow(sql:Sql,refundId:string){
 readLocalConfig(process.env);const selected=id(refundId);
 return sql.begin(async tx=>{
  const [before]=await tx`select order_id from app.refund where id=${selected}`;if(!before)throw new AccessError(404,'NOT_FOUND');
  await lockPaymentOrder(tx,before.order_id);const [head]=await tx<RefundHead[]>`select * from app.refund where id=${selected} for update`;
  const callbacks=await recoverRefundCallbacks(tx,selected,null,null),jobs=[...callbacks];
  if(head.current_job_id){
   const [job]=await tx`select id,status from app.outbox_job where id=${head.current_job_id} and kind='refund.create' for update`;
   if(job&&['pending','unknown'].includes(job.status)){
    await tx`insert into app.audit_event (action,subject_id,outcome,reason,details) values ('local.refund.reconcile',${head.id},'allowed','Recover the same fenced refund request without resetting its attempts',${JSON.stringify({job_id:job.id,previous_status:job.status})}::jsonb)`;
    await tx`update app.outbox_job set run_at=clock_timestamp() where id=${job.id}`;jobs.unshift(String(job.id));
   }
  }
  await tx`set constraints all immediate`;return jobs;
 });
}

export async function recoverRefund(request:Request,identity:LocalAuth,principal:Principal,refundId:string,value:unknown){
 const input=object(value,['action','expected_version','reason','reauthentication_proof']);
 if(!['reconcile','retry'].includes(String(input.action))||typeof input.reauthentication_proof!=='string'||input.reauthentication_proof.length<1||input.reauthentication_proof.length>100)throw invalid();
 const normalized={refund_id:id(refundId),action:String(input.action),expected_version:integer(input.expected_version,1),reason:returnText(input.reason)},key=mutationKey(request),action=`refund.${normalized.action}`,hash=await intentHash(identity,action,normalized),proof=input.reauthentication_proof;
 return identity.sql.begin(async tx=>{
  await refundFinanceAuthority(tx,principal,true);const [before]=await tx`select order_id from app.refund where id=${normalized.refund_id}`;if(!before)throw new AccessError(404,'NOT_FOUND');
  const order=await lockPaymentOrder(tx,before.order_id),[head]=await tx<RefundHead[]>`select * from app.refund where id=${normalized.refund_id} for update`;
  await refundFinanceAuthority(tx,principal,true);
  const actor:CommerceActor={kind:'user',id:principal.id,principal},[previous]=await tx`select action,request_hash,response from app.return_operation where actor_scope=${actorScope(actor)} and key=${key}`;
  if(previous){if(previous.action!==action||previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response;}
  if(head.revision!==normalized.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  const [currentJob]=head.current_job_id?await tx`select * from app.outbox_job where id=${head.current_job_id} for share`:[];
  let nextAttempt:number|null=null;
  if(normalized.action==='retry'){
   if(!currentJob||!['completed','failed'].includes(currentJob.status)||!['queued','failed'].includes(head.status))throw new AccessError(409,'REFUND_OUTCOME_STILL_AMBIGUOUS');
   if(head.current_operation_id){
    const events=await tx`select e.id,r.outcome from app.local_refund_event e left join app.refund_event_result r on r.event_id=e.id where e.operation_id=${head.current_operation_id}`;
    if(events.length!==1||events[0].outcome!=='failed')throw new AccessError(409,'REFUND_OUTCOME_STILL_AMBIGUOUS');
    const stored=await readRefundSourceEvent(tx,events[0].id);if(!stored||verifyRefundSourceEvent(stored).status!=='failed')throw new AccessError(409,'REFUND_OUTCOME_STILL_AMBIGUOUS');
   }else if(currentJob.status!=='failed'||(await tx`select id from app.local_refund_operation where creation_job_id=${currentJob.id}`).length)throw new AccessError(409,'REFUND_OUTCOME_STILL_AMBIGUOUS');
   nextAttempt=integer(currentJob.payload.attempt,1)+1;if(nextAttempt>2147483647)throw new AccessError(409,'REFUND_ATTEMPTS_EXHAUSTED');
  }
  await refundFinanceAuthority(tx,principal,true);
  const {id:operationId,occurred_at:occurredAt}=await insertReturnOperation(tx,actor,key,action,head.id,order.id,hash,createHash('sha256').update(proof).digest('hex'));await consumeAccessProof(tx,principal,'finance.refund',head.id,proof);
  let state=head;
  if(normalized.action==='retry'&&nextAttempt!==null){const jobId=await enqueueJob(tx,'refund.create',`refund-create:${head.id}:${nextAttempt}`,{refundId:head.id,attempt:nextAttempt});state={...head,status:'queued',current_job_id:jobId,current_operation_id:null};}
  else{
   await recoverRefundCallbacks(tx,head.id,principal.id,operationId);
   if(currentJob&&['pending','unknown'].includes(currentJob.status))await tx`update app.outbox_job set run_at=clock_timestamp() where id=${currentJob.id}`;
  }
  const changed=await advanceRefund(tx,head,state,{kind:normalized.action,source_kind:'operation',source_id:operationId,reason:normalized.reason,occurred_at:occurredAt});
  return finishReturnOperation(tx,operationId,await projectBuyerRefund(tx,head.id),principal.id,action,head.id,{version:changed.head.revision});
 });
}
