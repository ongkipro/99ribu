import type {Sql} from 'postgres';
import {readLocalConfig} from '../../config/local.ts';
import {AccessError} from '../access/policy.ts';
import {id} from '../catalog/validation.ts';
import {readCodEvents,ingestCodEvent} from './cod-local.ts';

// Host-only original-evidence recovery. Never create or resend collection.
export async function reconcileCodNow(sql:Sql,shipmentId:string){
 readLocalConfig(process.env);const selected=id(shipmentId);
 const [shipment]=await sql`select s.id from app.order_shipment s join app.cod_confirmation c on c.order_id=s.order_id where s.id=${selected}`;if(!shipment)throw new AccessError(409,'COD_NOT_CONFIRMED');
 const events=await sql.begin(tx=>readCodEvents(tx,selected)),callbacks:string[]=[];for(const event of events)callbacks.push(await ingestCodEvent(sql,event));if(!callbacks.length)return [];
 return sql.begin(async tx=>{
  const jobs=await tx`select id,status,attempts,last_error from app.outbox_job where kind='cod.callback' and id in ${tx(callbacks)} order by id for update`;
  for(const job of jobs){
   if(!['pending','unknown','failed'].includes(job.status)||(await tx`select event_id from app.cod_event_result where event_id=(select id from app.cod_provider_event where callback_job_id=${job.id})`).length)continue;
   const reset=job.status==='failed'||job.status==='unknown';
   if(reset||job.last_error)await tx`insert into app.audit_event (action,subject_id,outcome,reason,details) values ('local.cod.reconcile',${selected},'allowed','Local host requested original signed COD callback recovery',${JSON.stringify({job_id:job.id,previous_status:job.status,previous_attempts:job.attempts,previous_error:job.last_error})}::jsonb)`;
   await tx`update app.outbox_job set status='pending',attempts=${reset?0:job.attempts},run_at=clock_timestamp(),completed_at=null,last_error=null where id=${job.id}`;
  }
  return jobs.map(job=>String(job.id));
 });
}
