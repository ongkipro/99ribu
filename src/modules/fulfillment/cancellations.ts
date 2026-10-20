import {randomUUID} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import type {Claim,JobAdapter} from '../../jobs/leases.ts';
import {enqueueJob} from '../../jobs/outbox.ts';
import {AccessError} from '../access/policy.ts';
import {id,object} from '../catalog/validation.ts';
import {advanceFulfillment,fulfillmentClock,lockFulfillment,shippingCreationRecovery} from './core.ts';
import {createWaybillCancellationOperation,ingestWaybillCancellationEvent,lockWaybillCancellation,readWaybillCancellationEvent,readWaybillCancellationEvents,verifyWaybillCancellationEvent} from './cancellation-source.ts';
import {ingestWaybillEvent,readWaybillEvents,registerWaybillEvent,verifyWaybillEvent} from './local.ts';

// Called only inside an explicit, current CS application. Proposals and buyer
// acceptance never enqueue this intent. Another accepted case may reuse the same
// original-booking effect; its own immutable application records that identity.
export async function requestWaybillCancellation(tx:TransactionSql,operationId:string,bookingId:string){
 const [operation]=await tx`select op.*,c.order_id,c.proposal_event_id from app.exception_operation op join app.commerce_exception c on c.id=op.exception_id
  where op.id=${id(operationId)} and op.action='apply' and op.response='{}'::jsonb and op.created_xid=pg_current_xact_id()::text
   and c.status in ('awaiting_source','escalated') and c.proposal_event_id::text=op.input->>'proposal_id'
   and exists(select 1 from app.exception_event choice where choice.exception_id=c.id and choice.kind='buyer_accept' and choice.cause_event_id=c.proposal_event_id)`;
 if(!operation)throw new AccessError(409,'EXCEPTION_OPERATION_NOT_CURRENT');
 const [booking]=await tx`select b.*,s.order_id from app.shipment_booking b join app.fulfillment f on f.id=b.fulfillment_id join app.order_shipment s on s.id=f.shipment_id
  where b.id=${id(bookingId)} and s.order_id=${operation.order_id} and exists(select 1 from app.exception_unit u join app.fulfillment_item item on item.id=u.fulfillment_item_id where u.exception_id=${operation.exception_id} and u.active and u.replacement_link_id is null and item.shipment_id=s.id)`;
 if(!booking)throw new AccessError(409,'EXCEPTION_PHYSICAL_SCOPE_NOT_ELIGIBLE');
 const {head,order}=await lockFulfillment(tx,booking.fulfillment_id);
 if(head.handover_at||head.booking_id!==booking.id)throw new AccessError(409,'WAYBILL_CANCELLATION_NOT_ELIGIBLE');
 const [active]=await tx`select id,status from app.shipment_cancellation where booking_id=${booking.id} and status not in ('failed','not_created')`;
 if(active)return {id:String(active.id),status:String(active.status)};
 const [previous]=await tx`select c.id,c.attempt,c.status,exists(select 1 from app.local_waybill_cancellation source join app.local_waybill_cancellation_event e on e.operation_id=source.id join app.waybill_cancellation_result result on result.event_id=e.id join app.waybill_cancellation_provider_event registered on registered.id=e.id join app.outbox_job job on job.id=registered.callback_job_id where source.cancellation_id=c.id and source.status='failed' and result.outcome='failed' and job.status='completed') known_failed from app.shipment_cancellation c where c.booking_id=${booking.id} order by c.attempt desc limit 1`;
 if(previous){
  if(previous.status==='not_created')await tx`select app.assert_shipment_cancellation(${previous.id}::uuid)`;
  else if(!previous.known_failed)throw new AccessError(409,'WAYBILL_CANCELLATION_OUTCOME_UNKNOWN');
 }
 if(previous?.attempt===2147483647)throw new AccessError(409,'WAYBILL_CANCELLATION_ATTEMPTS_EXHAUSTED');
 const cancellationId=randomUUID(),job=await enqueueJob(tx,'shipping.cancel.create',`shipping-cancel:${cancellationId}`,{cancellationId});
 await tx`insert into app.shipment_cancellation (id,booking_id,operation_id,attempt,creation_job_id,created_at) values (${cancellationId},${booking.id},${operation.id},${(previous?.attempt??0)+1},${job},${await fulfillmentClock(tx,order.clock_namespace)})`;
 return {id:cancellationId,status:'queued'};
}
export function shippingCancellationAdapter(sql:Sql,target:'local'|'test',faults:ReadonlyMap<string,'before-commit'|'creation-commit-lost-ack'>=new Map()):JobAdapter{
 const resolve=async(claim:Claim,reconciliation:boolean)=>{
  const input=object(claim.payload,['cancellationId']),cancellationId=id(input.cancellationId);
  const source=await createWaybillCancellationOperation(sql,target,cancellationId,claim,reconciliation,!reconciliation&&faults.get(cancellationId)==='before-commit');
  if(!source)return {status:'retryable' as const,code:'TEMPORARY_UNAVAILABLE' as const};
  if(!reconciliation&&faults.get(cancellationId)==='creation-commit-lost-ack')throw new Error('Simulated acknowledgement loss after original cancellation request commit');
  for(const event of source.events)await ingestWaybillCancellationEvent(sql,event);
  return {status:'succeeded' as const,receipt:{operation_id:source.operation_id}};
 };
 return {dispatch:claim=>resolve(claim,false),reconcile:claim=>resolve(claim,true)};
}
export async function processWaybillCancellationEvent(tx:TransactionSql,job:{id:string;payload:unknown}){
 const body=object(job.payload,['eventId']),eventId=id(body.eventId),[registered]=await tx`select * from app.waybill_cancellation_provider_event where id=${eventId} and callback_job_id=${id(job.id)}`;
 if(!registered)throw new AccessError(400,'INVALID_SHIPPING_CANCELLATION_JOB');
 const {head,cancellation}=await lockWaybillCancellation(tx,registered.cancellation_id),source=await readWaybillCancellationEvent(tx,eventId);
 if(!source)throw new AccessError(400,'INVALID_SHIPPING_CANCELLATION_JOB');const event=verifyWaybillCancellationEvent(source);
 const [prior]=await tx`select outcome from app.waybill_cancellation_result where event_id=${event.id}`;if(prior)return {event_id:event.id,outcome:String(prior.outcome)};
 const [operation]=await tx`select * from app.local_waybill_cancellation where id=${event.operation_id} and cancellation_id=${cancellation.id}`;
 if(!operation||event.booking_id!==cancellation.booking_id)throw new AccessError(400,'INVALID_SHIPPING_CANCELLATION_JOB');
 let outcome='duplicate',fulfillmentEventId:string|null=null;
 if(event.status==='acknowledged'){
  if(cancellation.status==='queued'){
   await tx`update app.shipment_cancellation set status='acknowledged',provider_operation_id=${operation.id} where id=${cancellation.id}`;outcome='acknowledged';
  }
 }else if(cancellation.status!==event.status){
  if(!['queued','acknowledged'].includes(cancellation.status)||head.booking_id!==cancellation.booking_id||head.handover_at||operation.status!==event.status)throw new AccessError(409,'WAYBILL_CANCELLATION_NOT_ELIGIBLE');
  if(event.status==='cancelled'&&event.source_status==='issued'&&!head.waybill_issued_at){
   // The original source may have issued before either callback was processed.
   // Complete that exact owned callback first, preserving the first SLA anchor;
   // never invent a milestone or complete somebody else's job inside this one.
   const original=(await readWaybillEvents(tx,String(cancellation.booking_id))).find(source=>source.operation_id===event.source_operation_id&&source.status==='issued'&&source.tracking_number===event.tracking_number);
   if(!original)throw new AccessError(409,'ORIGINAL_WAYBILL_EVIDENCE_MISSING');
   await registerWaybillEvent(tx,verifyWaybillEvent(original));
   return {event_id:event.id,outcome:'awaiting_original_issuance',deferMs:100};
  }
  await tx`update app.shipment_cancellation set status=${event.status},provider_operation_id=${operation.id} where id=${cancellation.id}`;
  if(event.status==='cancelled'){
   await tx`update app.shipment_booking set status='cancelled' where id=${cancellation.booking_id}`;
   const changed=await advanceFulfillment(tx,head,{kind:'booking_cancelled',status:'exception',source_kind:'cancellation',source_id:event.id,reason:'Original signed source confirms carrier cancellation; goods and money remain separately guarded',occurred_at:event.occurred_at});fulfillmentEventId=changed.eventId;
  }
  outcome=event.status;
 }
 await tx`insert into app.waybill_cancellation_result (event_id,outcome,fulfillment_event_id) values (${event.id},${outcome},${fulfillmentEventId})`;return {event_id:event.id,outcome};
}
// Host reconciliation and an explicit CS application share this exact fenced
// recovery. A caller holding the parent must already own this creation-job lock.
export async function reconcileCancellationCreation(tx:TransactionSql,cancellationId:string){
 const selected=id(cancellationId),[cancellation]=await tx`select id,status,creation_job_id from app.shipment_cancellation where id=${selected}`;
 if(!cancellation)throw new AccessError(404,'NOT_FOUND');
 const [job]=await tx<{id:string;status:string;attempts:number;max_attempts:number;last_error:string|null;dispatched_at:string|null}[]>`select id,status,attempts,max_attempts,last_error,dispatched_at from app.outbox_job where id=${cancellation.creation_job_id} for update`;
 if(!job)throw new AccessError(409,'INVALID_SHIPPING_CANCELLATION_JOB');
 const [source]=await tx`select id from app.local_waybill_cancellation where cancellation_id=${selected}`;
 if(cancellation.status==='not_created'||!['failed','unknown'].includes(job.status))return {...job,source_present:Boolean(source)};
 const next=shippingCreationRecovery({status:job.status,attempts:job.attempts,max_attempts:job.max_attempts},Boolean(source));
 await tx`insert into app.audit_event (action,subject_id,outcome,reason,details) values ('local.shipping.cancel.reconcile',${selected},'allowed','Explicit reconciliation of the original cancellation creation',${JSON.stringify({job_id:job.id,previous_status:job.status,previous_attempts:job.attempts,previous_max_attempts:job.max_attempts,next_max_attempts:next.max_attempts,budget_rearmed:next.max_attempts!==job.max_attempts,previous_error:job.last_error,previous_dispatched_at:job.dispatched_at,source_absence_verified:!source})}::jsonb)`;
 await tx`update app.outbox_job set status=${next.status},max_attempts=${next.max_attempts},dispatched_at=${source?job.dispatched_at:null},lease_token=null,lease_until=null,
  run_at=case when ${next.status!=='failed'} then clock_timestamp() else run_at end,completed_at=case when ${next.status==='failed'} then coalesce(completed_at,clock_timestamp()) else null end,
  last_error=case when ${next.status==='failed'} then 'ATTEMPTS_EXHAUSTED' else null end where id=${job.id}`;
 return {...job,...next,source_present:Boolean(source)};
}

export async function reconcileWaybillCancellationNow(sql:Sql,cancellationId:string){
 const selected=id(cancellationId),[cancellation]=await sql`select id,booking_id,creation_job_id from app.shipment_cancellation where id=${selected}`;if(!cancellation)throw new AccessError(404,'NOT_FOUND');
 const events=await sql.begin(tx=>readWaybillCancellationEvents(tx,selected)),callbacks:string[]=[];
 for(const event of events)callbacks.push(await ingestWaybillCancellationEvent(sql,event));
 const originalEvents=await sql.begin(tx=>readWaybillEvents(tx,String(cancellation.booking_id))),originalCallbacks:string[]=[];
 for(const event of originalEvents)originalCallbacks.push(await ingestWaybillEvent(sql,event));
 return sql.begin(async tx=>{
  const jobs=await tx`select id,kind,status,attempts,max_attempts,last_error,dispatched_at from app.outbox_job where id in ${tx([cancellation.creation_job_id,...callbacks,...originalCallbacks])} order by id for update`;
  for(const job of jobs){
   const callback=['shipping.cancel.callback','shipping.callback'].includes(job.kind)&&['failed','unknown'].includes(job.status),creation=job.kind==='shipping.cancel.create'&&['failed','unknown'].includes(job.status);
   if(!callback&&!creation)continue;
   if(creation){await reconcileCancellationCreation(tx,selected);continue;}
   const processed=job.kind==='shipping.callback'?await tx`select result.event_id from app.waybill_event_result result join app.waybill_provider_event e on e.id=result.event_id where e.callback_job_id=${job.id}`
    :callback?await tx`select result.event_id from app.waybill_cancellation_result result join app.waybill_cancellation_provider_event e on e.id=result.event_id where e.callback_job_id=${job.id}`:[];
   if(processed.length)continue;
   await tx`insert into app.audit_event (action,subject_id,outcome,reason,details) values ('local.shipping.cancel.reconcile',${selected},'allowed','Local host requested original cancellation callback reconciliation',${JSON.stringify({job_id:job.id,previous_status:job.status,previous_attempts:job.attempts,previous_max_attempts:job.max_attempts,next_max_attempts:job.max_attempts,budget_rearmed:false,previous_error:job.last_error,previous_dispatched_at:job.dispatched_at,source_absence_verified:false})}::jsonb)`;
   await tx`update app.outbox_job set status='pending',lease_token=null,lease_until=null,run_at=clock_timestamp(),completed_at=null,last_error=null where id=${job.id}`;
  }
  // Original issuance precedes cancellation consumption even when its authentic
  // delivery arrived late. Every returned ID belongs to these exact sources.
  return [...originalCallbacks,...jobs.filter(job=>job.kind!=='shipping.callback').map(job=>String(job.id))];
 });
}
