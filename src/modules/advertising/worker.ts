import type {Sql} from 'postgres';
import type {Claim,JobAdapter,Outcome} from '../../jobs/leases.ts';
import {readLocalConfig} from '../../config/local.ts';
import {id,object} from '../catalog/validation.ts';
import {digest} from '../checkout/access.ts';
import {currentConsent,type Consent} from '../consent/receipts.ts';
import type {Visitor} from '../consent/context.ts';
import {measurementAllowed,type Platform} from '../consent/choices.ts';
import type {EventPayload} from './events.ts';

export function localSignalPayload(event:{id:string;name:string;occurred_at:string;merchandise_amount:string;payload:EventPayload}){
 return {event_id:event.id,event_name:event.name,occurred_at:new Date(event.occurred_at).toISOString(),currency:'IDR' as const,value:Number(event.merchandise_amount),contents:event.payload.contents.map(c=>({id:c.id,quantity:c.quantity,merchandise_amount:c.merchandise_amount})),content_ids:[...event.payload.content_ids]};
}
// This is a canonical database-local sink, not a Meta/Google/TikTok protocol.
// The original leased identity and consent are checked under real SQL locks.
export function advertisingAdapter(sql:Sql,target:'local'|'test',faults:ReadonlyMap<string,'before-commit'|'after-commit-lost-ack'>=new Map()):JobAdapter{
 const resolve=async(claim:Claim,reconciliation:boolean):Promise<Outcome>=>{
  readLocalConfig(process.env);if(!['local','test'].includes(target)) throw new Error('Invalid local signal target.');
  const body=object(claim.payload,['outboxId']),outboxId=id(body.outboxId);
  const outcome=await sql.begin(async tx=>{
   const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`)throw new Error('Invalid local signal database.');
   await tx`select pg_advisory_xact_lock(hashtextextended(${`ad-effect:${outboxId}`},0))`;
   const [initial]=await tx`select o.*,e.visitor_id from app.ad_event_outbox o join app.commerce_event e on e.id=o.event_id where o.id=${outboxId} and o.job_id=${claim.id}`;
   if(!initial)return {status:'failed' as const,code:'INVALID_PAYLOAD' as const};
   const [visitor]=initial.visitor_id?await tx<Visitor[]>`select * from app.visitor_session where id=${initial.visitor_id} for update`:[];
   const [outbox]=await tx`select * from app.ad_event_outbox where id=${outboxId} for update`;
   const [lease]=await tx`select id from app.outbox_job where id=${claim.id} and status='processing' and lease_token=${claim.token} and lease_until>clock_timestamp() and dispatched_at is not null for share`;
   if(!lease)return {status:'unknown' as const,code:'UNKNOWN_OUTCOME' as const};
   const [existing]=await tx`select * from app.local_ad_sink where outbox_id=${outboxId}`;
   const kind=reconciliation?'reconcile':'dispatch';
   if(existing){
    await tx`insert into app.ad_delivery_attempt (outbox_id,kind,outcome) values (${outboxId},${kind},'accepted')`;
    return {status:'succeeded' as const,receipt:{outbox_id:outboxId,event_id:String(existing.event_id),status:'accepted_local'}};
   }
   if(['suppressed','cancelled','quarantined'].includes(outbox.status)){
    await tx`insert into app.ad_delivery_attempt (outbox_id,kind,outcome) values (${outboxId},${kind},${outbox.status==='quarantined'?'definitive_no_effect':'suppressed'})`;
    return outbox.status==='quarantined'?{status:'failed' as const,code:'PERMANENT_REJECTION' as const}:{status:'succeeded' as const,receipt:{outbox_id:outboxId,status:'suppressed'}};
   }
   if(outbox.status!=='queued')throw new Error('Local signal effect evidence is inconsistent.');
   if(reconciliation){
    // Same mutex fences an old in-flight sender after authoritative no effect.
    await tx`update app.ad_event_outbox set status='quarantined',reason='definitive_no_effect' where id=${outboxId}`;
    await tx`insert into app.ad_delivery_attempt (outbox_id,kind,outcome) values (${outboxId},${kind},'definitive_no_effect')`;
    return {status:'failed' as const,code:'PERMANENT_REJECTION' as const};
   }
   const consent=visitor?await currentConsent(tx,visitor):null,[clock]=await tx`select clock_timestamp() as now`;
   const [event]=await tx`select * from app.commerce_event where id=${outbox.event_id}`;
   const [captured]=event.consent_receipt_id?await tx<Consent[]>`select * from app.consent_receipt where id=${event.consent_receipt_id}`:[];
   const platform=outbox.platform as Platform,expired=new Date(outbox.expires_at)<=new Date(clock.now)||!visitor||visitor.status!=='active'||new Date(visitor.expires_at)<=new Date(clock.now);
   if(expired||!consent||!captured||!measurementAllowed(consent.choices,platform)||!measurementAllowed(captured.choices,platform)){
    await tx`update app.ad_event_outbox set status='cancelled',reason=${expired?'expired':'withdrawn'} where id=${outboxId}`;
    await tx`insert into app.ad_delivery_attempt (outbox_id,kind,outcome) values (${outboxId},${kind},'suppressed')`;
    return {status:'succeeded' as const,receipt:{outbox_id:outboxId,status:'suppressed'}};
   }
   const payload=localSignalPayload(event as Parameters<typeof localSignalPayload>[0]),hash=digest(JSON.stringify(payload));
   await tx`insert into app.local_ad_sink (outbox_id,event_id,platform,payload_hash,payload) values (${outboxId},${event.id},${platform},${hash},${JSON.stringify(payload)}::jsonb)`;
   await tx`update app.ad_event_outbox set status='accepted',reason='accepted_local' where id=${outboxId}`;
   await tx`insert into app.ad_delivery_attempt (outbox_id,kind,outcome) values (${outboxId},${kind},'accepted')`;
   await tx`set constraints app.local_ad_sink_sealed immediate`;
   if(faults.get(outboxId)==='before-commit')throw new Error('Simulated local signal failure before commit.');
   return {status:'succeeded' as const,receipt:{outbox_id:outboxId,event_id:String(event.id),status:'accepted_local'}};
  });
  if(!reconciliation&&outcome.status==='succeeded'&&outcome.receipt.status==='accepted_local'&&faults.get(outboxId)==='after-commit-lost-ack')throw new Error('Simulated local signal acknowledgement loss after commit.');
  return outcome;
 };
 return {dispatch:claim=>resolve(claim,false),reconcile:claim=>resolve(claim,true)};
}
