import type {Sql} from 'postgres';
import {readLocalConfig} from '../../config/local.ts';
import {AccessError} from '../access/policy.ts';
import {id,invalid} from '../catalog/validation.ts';
import {ingestReplacementReceiptSource,readReplacementReceiptSource} from './replacement-receipts.ts';
import {ingestReplacementWaybillEvent,readReplacementWaybillEvent} from './replacement-shipping.ts';

// Recover original identities only. A failed creation without a provider root
// can retry only after UPDATE on its exact job fences every old SHARE creator.
export async function reconcileReplacementShippingNow(sql:Sql,bookingId:string){
 readLocalConfig(process.env);const selected=id(bookingId),[database]=await sql`select current_database() name`;
 if(!['99ribu_local','99ribu_test'].includes(database.name))throw invalid();
 const [booking]=await sql`select creation_job_id from app.replacement_booking where id=${selected}`;if(!booking)throw new AccessError(404,'NOT_FOUND');
 const events=await sql`select e.id from app.local_replacement_event e join app.local_replacement_operation op on op.id=e.operation_id where op.booking_id=${selected}`,callbacks:string[]=[];
 for(const event of events){const source=await sql.begin(tx=>readReplacementWaybillEvent(tx,event.id));if(!source)throw new AccessError(409,'REPLACEMENT_WAYBILL_SOURCE_MISSING');callbacks.push(await ingestReplacementWaybillEvent(sql,source));}
 return sql.begin(async tx=>{
  const jobs=await tx`select id,kind,status,attempts,last_error,dispatched_at from app.outbox_job where id in ${tx([String(booking.creation_job_id),...callbacks])} order by id for update`;
  for(const job of jobs){
   const callback=job.kind==='replacement.shipping.callback';
   if(!['unknown','failed'].includes(job.status)&&!(callback&&job.status==='pending'&&job.last_error))continue;
   if(callback&&(await tx`select event_id from app.replacement_event_result where event_id=(select id from app.replacement_provider_event where callback_job_id=${job.id})`).length)continue;
   const [source]=callback?[]:await tx`select id from app.local_replacement_operation where booking_id=${selected}`;
   const absent=!callback&&!source,reset=callback||absent;
   await tx`insert into app.audit_event (action,subject_id,outcome,reason,details)
    values ('local.replacement_shipping.reconcile',${selected},'allowed','Local host requested reconciliation of the original zero-charge replacement booking',${JSON.stringify({job_id:job.id,previous_status:job.status,previous_attempts:job.attempts,previous_error:job.last_error,previous_dispatched_at:job.dispatched_at,source_absence_verified:absent})}::jsonb)`;
   await tx`update app.outbox_job set status=${reset?'pending':'unknown'},attempts=${reset?0:job.attempts},dispatched_at=${absent?null:job.dispatched_at},lease_token=null,lease_until=null,run_at=clock_timestamp(),completed_at=null,last_error=null where id=${job.id}`;
  }
  await tx`set constraints all immediate`;return jobs.map(job=>String(job.id));
 });
}

export async function reconcileReplacementReceiptNow(sql:Sql,sourceId:string){
 readLocalConfig(process.env);const selected=id(sourceId),source=await sql.begin(tx=>readReplacementReceiptSource(tx,selected));
 if(!source)throw new AccessError(404,'NOT_FOUND');const callback=await ingestReplacementReceiptSource(sql,source);
 return sql.begin(async tx=>{
  const [job]=await tx`select id,status,attempts,last_error from app.outbox_job where id=${callback} and kind='replacement.receipt.callback' for update`;
  if(!job)throw new AccessError(409,'REPLACEMENT_RECEIPT_JOB_MISSING');
  if((['unknown','failed'].includes(job.status)||(job.status==='pending'&&job.last_error!==null))&&!(await tx`select event_id from app.replacement_receipt_result where event_id=${selected}`).length){
   const reset=['failed','unknown'].includes(job.status);
   if(reset||job.last_error)await tx`insert into app.audit_event (action,subject_id,outcome,reason,details)
    values ('local.replacement_receipt.reconcile',${selected},'allowed','Local host requested recovery of the original signed replacement receipt',${JSON.stringify({job_id:job.id,previous_status:job.status,previous_attempts:job.attempts,previous_error:job.last_error})}::jsonb)`;
   await tx`update app.outbox_job set status='pending',attempts=${reset?0:job.attempts},run_at=clock_timestamp(),completed_at=null,last_error=null where id=${job.id}`;
  }
  await tx`set constraints all immediate`;return [String(job.id)];
 });
}
