import type {Sql} from 'postgres';
import {id} from '../catalog/validation.ts';
import {readProviderEvents,ingestProviderEvent} from './local.ts';

// Local host command only. Retry the exact durable identity, never resend a
// charge or fabricate a provider result. Audit preserves each prior retry batch.
export async function reconcilePaymentNow(sql:Sql,attemptId:string){
 const selected=id(attemptId),events=await sql.begin(tx=>readProviderEvents(tx,selected));
 const callbacks:string[]=[];for(const event of events) callbacks.push(await ingestProviderEvent(sql,event));
 return sql.begin(async tx=>{
  const [attempt]=await tx`select creation_job_id from app.payment_attempt where id=${selected}`;
  if(!attempt) throw new Error('Unknown local payment attempt.');
  const jobs=await tx`select id,kind,status,attempts,last_error from app.outbox_job where id in ${tx([attempt.creation_job_id,...callbacks])} order by id for update`;
  for(const job of jobs){
   const failedCallback=job.kind==='payment.callback'&&job.status==='failed';
   if(job.status!=='unknown'&&!failedCallback) continue;
   if(failedCallback&&(await tx`select event_id from app.payment_event_result where event_id=(select id from app.payment_provider_event where callback_job_id=${job.id})`).length) continue;
   await tx`insert into app.audit_event (action,subject_id,outcome,reason,details) values ('local.payment.reconcile',${selected},'allowed','Local host requested original-operation reconciliation',${JSON.stringify({job_id:job.id,previous_status:job.status,previous_attempts:job.attempts,previous_error:job.last_error})}::jsonb)`;
   await tx`update app.outbox_job set status=${failedCallback?'pending':'unknown'},attempts=${failedCallback?0:job.attempts},run_at=clock_timestamp(),completed_at=null,last_error=null where id=${job.id}`;
  }
  return jobs.map(j=>String(j.id));
 });
}
