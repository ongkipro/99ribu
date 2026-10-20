import {randomUUID} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import type {Claim,JobAdapter} from '../../jobs/leases.ts';
import {AccessError} from '../access/policy.ts';
import {id,invalid,object} from '../catalog/validation.ts';
import {advanceFulfillment,appendNotice,deadlineForIssuance,fulfillmentClock,lockFulfillment,shippingCreationRecovery} from './core.ts';
import {createWaybillOperation,ingestWaybillEvent,readWaybillEvent,readWaybillEvents,verifyWaybillEvent} from './local.ts';
import {isWaybillSourceCancelled} from './cancellation-source.ts';

export function shippingAdapter(sql:Sql,target:'local'|'test',faults:ReadonlyMap<string,'before-commit'|'creation-commit-lost-ack'>=new Map()):JobAdapter{
 const resolve=async(claim:Claim,reconciliation:boolean)=>{
  const input=object(claim.payload,['bookingId']),bookingId=id(input.bookingId);
  let created:Awaited<ReturnType<typeof createWaybillOperation>>;
  try{created=await createWaybillOperation(sql,target,bookingId,claim,reconciliation,!reconciliation&&faults.get(bookingId)==='before-commit');}
  catch(error){if(error instanceof AccessError&&error.code==='WAYBILL_SOURCE_CANCELLED')return {status:'failed' as const,code:'PERMANENT_REJECTION' as const};throw error;}
  if(!created)return {status:'retryable' as const,code:'TEMPORARY_UNAVAILABLE' as const};
  if(!reconciliation&&faults.get(bookingId)==='creation-commit-lost-ack')throw new Error('Simulated acknowledgement loss after original waybill request commit');
  for(const event of created.events)await ingestWaybillEvent(sql,event);
  return {status:'succeeded' as const,receipt:{operation_id:created.operation_id}};
 };
 return {dispatch:claim=>resolve(claim,false),reconcile:claim=>resolve(claim,true)};
}
export async function processWaybillEvent(tx:TransactionSql,job:{id:string;payload:unknown}){
 const body=object(job.payload,['eventId']),eventId=id(body.eventId),[registered]=await tx`select p.*,b.fulfillment_id from app.waybill_provider_event p join app.shipment_booking b on b.id=p.booking_id where p.id=${eventId} and p.callback_job_id=${job.id}`;
 if(!registered)throw new AccessError(400,'INVALID_SHIPPING_JOB');const {head,order}=await lockFulfillment(tx,registered.fulfillment_id),source=await readWaybillEvent(tx,eventId);if(!source)throw new AccessError(400,'INVALID_SHIPPING_JOB');const event=verifyWaybillEvent(source);
 const [prior]=await tx`select outcome from app.waybill_event_result where event_id=${event.id}`;if(prior)return {event_id:event.id,outcome:String(prior.outcome)};
 const [booking]=await tx`select * from app.shipment_booking where id=${registered.booking_id} for update`;let outcome='ignored',fulfillmentEventId:string|null=null;
 if(booking.status==='cancelled'){
  // A late authentic original observation remains a fact. It cannot revive a
  // cancelled label. Pending cancellation separately fences staff dispatch;
  // first issuance still records its real original SLA anchor before retirement.
  outcome='ignored';
 }else if(event.status==='acknowledged'){
  if(booking.status==='queued'){await tx`update app.shipment_booking set status='acknowledged',provider_operation_id=${event.operation_id} where id=${booking.id}`;outcome='acknowledged';}
  else if(booking.status==='acknowledged')outcome='duplicate';
 }else if(booking.status===event.status){outcome='duplicate';}
 else{
  if(!['queued','acknowledged'].includes(booking.status)||head.booking_id!==booking.id||!head.prepared_at||head.handover_at)throw new AccessError(409,'WAYBILL_SOURCE_NOT_ELIGIBLE');
  await tx`update app.shipment_booking set status=${event.status},provider_operation_id=${event.operation_id} where id=${booking.id}`;
  if(event.status==='issued'){
   const proposedEventId=randomUUID(),reissue=Boolean(head.waybill_issued_at),timing=reissue?null:await deadlineForIssuance(tx,head,proposedEventId,event.occurred_at,order.clock_namespace);
   const errorCode=timing?.errorCode??null;
   const changed=await advanceFulfillment(tx,head,{kind:reissue?'reissued':'issued',status:'packed',source_kind:'provider',source_id:event.id,reason:'Original signed local source confirms usable waybill',occurred_at:event.occurred_at,...(timing?{deadline_id:timing.deadline.id,waybill_issued_at:event.occurred_at,calendar_error:errorCode}:{}),tracking_number:event.tracking_number},proposedEventId);fulfillmentEventId=changed.eventId;
   if(errorCode)await appendNotice(tx,head.id,changed.eventId,'calendar_missing',event.occurred_at);
  }else{
   const changed=await advanceFulfillment(tx,head,{kind:'exception',status:'exception',source_kind:'provider',source_id:event.id,reason:'Original signed local source rejected waybill issuance',occurred_at:event.occurred_at});fulfillmentEventId=changed.eventId;
   await appendNotice(tx,head.id,changed.eventId,'booking_failed',event.occurred_at);
  }
  outcome=event.status;
 }
 await tx`insert into app.waybill_event_result (event_id,outcome,fulfillment_event_id) values (${event.id},${outcome},${fulfillmentEventId})`;return {event_id:event.id,outcome};
}
export async function processFulfillmentDeadline(tx:TransactionSql,job:{id:string;payload:unknown}){
 const b=object(job.payload,['deadlineId','kind']),deadlineId=id(b.deadlineId);if(!['packing','handover'].includes(String(b.kind)))throw invalid();
 const [deadline]=await tx`select * from app.fulfillment_deadline where id=${deadlineId}`;if(!deadline)throw new AccessError(400,'INVALID_FULFILLMENT_JOB');
 const {head,order}=await lockFulfillment(tx,deadline.fulfillment_id),due=b.kind==='packing'?deadline.packing_due_at:deadline.handover_due_at;if(!due)throw new AccessError(400,'INVALID_FULFILLMENT_JOB');
 const now=await fulfillmentClock(tx,order.clock_namespace),remaining=new Date(due).getTime()-Date.parse(now);if(remaining>0)return {deadline_id:deadlineId,status:'waiting',deferMs:Math.min(3600000,Math.max(50,remaining))};
 const milestone=b.kind==='packing'?head.waybill_issued_at:head.handover_at;
 if(milestone&&new Date(milestone).getTime()<=new Date(due).getTime())return {deadline_id:deadlineId,status:'met',deferMs:null};
 if(b.kind==='packing'&&head.booking_id){
  const [timely]=await tx`select e.id from app.local_waybill_event e join app.local_waybill_operation o on o.id=e.operation_id where o.booking_id=${head.booking_id} and e.status='issued' and e.occurred_at<=${due} order by e.recorded_at,e.id limit 1`;
  if(timely){const source=await readWaybillEvent(tx,timely.id);if(source&&verifyWaybillEvent(source).status==='issued')return {deadline_id:deadlineId,status:'source_issued',deferMs:null};}
 }
 const [superseded]=await tx`select app.fulfillment_deadline_superseded(${deadlineId},${due}) value`;
 if(superseded.value)return {deadline_id:deadlineId,status:'rescheduled',deferMs:null};
 const kind=b.kind==='packing'?'packing_overdue':'handover_overdue';
 const [original]=b.kind==='packing'?await tx`select id from app.fulfillment_deadline where fulfillment_id=${head.id} and packing_due_at=${due} and not app.fulfillment_deadline_superseded(id,${due}) order by created_at,id limit 1`:await tx`select id from app.fulfillment_deadline where fulfillment_id=${head.id} and handover_due_at=${due} and not app.fulfillment_deadline_superseded(id,${due}) order by created_at,id limit 1`;
 await appendNotice(tx,head.id,original.id,kind,new Date(due).toISOString());return {deadline_id:deadlineId,status:'overdue',deferMs:null};
}
export async function processFulfillmentNotice(tx:TransactionSql,job:{id:string;payload:unknown}){
 const b=object(job.payload,['noticeId']),noticeId=id(b.noticeId),[notice]=await tx`select id from app.fulfillment_notice where id=${noticeId} and job_id=${job.id} for update`;if(!notice)throw new AccessError(400,'INVALID_FULFILLMENT_JOB');
 await tx`update app.fulfillment_notice set available_at=coalesce(available_at,clock_timestamp()) where id=${noticeId}`;return {notice_id:noticeId,status:'available'};
}
export async function reconcileShippingNow(sql:Sql,bookingId:string){
 const selected=id(bookingId),[booking]=await sql`select id,creation_job_id from app.shipment_booking where id=${selected}`;if(!booking)throw new AccessError(404,'NOT_FOUND');
 const events=await sql.begin(tx=>readWaybillEvents(tx,selected)),callbacks:string[]=[];for(const event of events)callbacks.push(await ingestWaybillEvent(sql,event));
 return sql.begin(async tx=>{
  const jobs=await tx`select id,kind,status,attempts,max_attempts,last_error,dispatched_at from app.outbox_job where id in ${tx([booking.creation_job_id,...callbacks])} order by id for update`;
  for(const job of jobs){
   const failedCallback=job.kind==='shipping.callback'&&['failed','unknown'].includes(job.status);
   const creation=job.kind==='shipping.create'&&['failed','unknown'].includes(job.status);
   if(!failedCallback&&!creation)continue;
   if(failedCallback&&(await tx`select event_id from app.waybill_event_result where event_id=(select id from app.waybill_provider_event where callback_job_id=${job.id})`).length)continue;
   // Every source creator first takes SHARE on this exact job. Holding UPDATE
   // fences an old creator before authoritative absence permits an original retry.
   const [source]=creation?await tx`select id from app.local_waybill_operation where booking_id=${selected}`:[];
   const absent=creation&&!source,cancelled=absent&&await isWaybillSourceCancelled(tx,selected);
   const next=creation&&!cancelled?shippingCreationRecovery({status:job.status,attempts:job.attempts,max_attempts:job.max_attempts},Boolean(source)):{status:cancelled?'failed':'pending',max_attempts:job.max_attempts};
   await tx`insert into app.audit_event (action,subject_id,outcome,reason,details) values ('local.shipping.reconcile',${selected},'allowed','Local host requested original waybill reconciliation',${JSON.stringify({job_id:job.id,previous_status:job.status,previous_attempts:job.attempts,previous_max_attempts:job.max_attempts,next_max_attempts:next.max_attempts,budget_rearmed:next.max_attempts!==job.max_attempts,previous_error:job.last_error,previous_dispatched_at:job.dispatched_at,source_absence_verified:absent,original_source_cancelled:cancelled})}::jsonb)`;
   await tx`update app.outbox_job set status=${next.status},max_attempts=${next.max_attempts},dispatched_at=${absent?null:job.dispatched_at},lease_token=null,lease_until=null,
    run_at=case when ${next.status!=='failed'} then clock_timestamp() else run_at end,completed_at=case when ${next.status==='failed'} then coalesce(completed_at,clock_timestamp()) else null end,
    last_error=case when ${cancelled} then 'PERMANENT_REJECTION' when ${next.status==='failed'} then 'ATTEMPTS_EXHAUSTED' else null end where id=${job.id}`;
  }
  return jobs.map(j=>String(j.id));
 });
}
