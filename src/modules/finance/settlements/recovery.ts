import type {Sql} from 'postgres';
import {readLocalConfig} from '../../../config/local.ts';
import {AccessError} from '../../access/policy.ts';
import {id} from '../../catalog/validation.ts';
import {ingestSettlementEvent,readSettlementSourceEvent} from './local.ts';

// Host-only recovery of committed evidence. Never infer or repeat bank money.
export async function reconcileSettlementNow(sql:Sql,operationId:string){
 readLocalConfig(process.env);const selected=id(operationId);
 const [operation]=await sql`select id from app.local_settlement_operation where id=${selected}`;
 if(!operation)throw new AccessError(404,'NOT_FOUND');
 const deliveries=await sql`select e.id from app.local_settlement_event e join app.local_settlement_statement s on s.id=e.statement_id where s.operation_id=${selected} order by s.revision,e.recorded_at,e.id`,callbacks:string[]=[];
 for(const delivery of deliveries){
  const event=await sql.begin(tx=>readSettlementSourceEvent(tx,delivery.id));if(!event)throw new AccessError(409,'SETTLEMENT_SOURCE_INCOMPLETE');
  callbacks.push(await ingestSettlementEvent(sql,event));
 }
 if(!callbacks.length)return [];
 return sql.begin(async tx=>{
  const jobs=await tx`select id,status,attempts,last_error from app.outbox_job where kind='settlement.callback' and id in ${tx(callbacks)} order by id for update`;
  for(const job of jobs){
   if(!['pending','unknown','failed'].includes(job.status)||(await tx`select event_id from app.settlement_event_result where event_id=(select id from app.settlement_provider_event where callback_job_id=${job.id})`).length)continue;
   const reset=job.status==='failed'||job.status==='unknown';
   if(reset||job.last_error)await tx`insert into app.audit_event (action,subject_id,outcome,reason,details) values ('local.settlement.reconcile',${selected},'allowed','Local host requested original signed settlement callback recovery',${JSON.stringify({job_id:job.id,previous_status:job.status,previous_attempts:job.attempts,previous_error:job.last_error})}::jsonb)`;
   await tx`update app.outbox_job set status='pending',attempts=${reset?0:job.attempts},run_at=clock_timestamp(),completed_at=null,last_error=null where id=${job.id}`;
  }
  await tx`set constraints all immediate`;return jobs.map(job=>String(job.id));
 });
}
