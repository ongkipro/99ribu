import type {Sql} from 'postgres';
import {readLocalConfig} from '../../config/local.ts';
import {AccessError} from '../access/policy.ts';
import {id} from '../catalog/validation.ts';
import {ingestParcelReceiptSource,readParcelReceiptSource} from './receipt-source.ts';

// Host-only retry of the original signed observation, never a new receipt time.
export async function reconcileParcelReceiptNow(sql:Sql,sourceId:string){
 readLocalConfig(process.env);const selected=id(sourceId),source=await sql.begin(tx=>readParcelReceiptSource(tx,selected));
 if(!source)throw new AccessError(404,'NOT_FOUND');
 const callback=await ingestParcelReceiptSource(sql,source);
 return sql.begin(async tx=>{
  const [job]=await tx`select id,status,attempts,last_error from app.outbox_job where id=${callback} and kind='parcel.receipt.callback' for update`;
  if(!job)throw new AccessError(409,'PARCEL_RECEIPT_JOB_MISSING');
  if(['pending','unknown','failed'].includes(job.status)&&!(await tx`select event_id from app.parcel_receipt_result where event_id=${selected}`).length){
   const reset=job.status==='failed'||job.status==='unknown';
   if(reset||job.last_error)await tx`insert into app.audit_event (action,subject_id,outcome,reason,details) values ('local.parcel_receipt.reconcile',${selected},'allowed','Local host requested original signed parcel receipt callback recovery',${JSON.stringify({job_id:job.id,previous_status:job.status,previous_attempts:job.attempts,previous_error:job.last_error})}::jsonb)`;
   await tx`update app.outbox_job set status='pending',attempts=${reset?0:job.attempts},run_at=clock_timestamp(),completed_at=null,last_error=null where id=${job.id}`;
  }
  await tx`set constraints all immediate`;return [String(job.id)];
 });
}
