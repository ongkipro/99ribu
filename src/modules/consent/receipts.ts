import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {integer,invalid,object,text} from '../catalog/validation.ts';
import {digest} from '../checkout/access.ts';
import type {Visitor} from './context.ts';
import {LOCAL_PRIVACY_POLICY_VERSION,measurementAllowed,parseChoices,type Choices,type Platform} from './choices.ts';

export type Consent={id:string;visitor_id:string;revision:number;policy_version:string;choices:Choices;effective_at:string;expires_at:string};
export function projectConsent(row:Consent){return {id:row.id,version:row.revision,policy_version:row.policy_version,choices:parseChoices(row.choices),effective_at:new Date(row.effective_at).toISOString(),expires_at:new Date(row.expires_at).toISOString()};}
export async function currentConsent(tx:TransactionSql,visitor:Visitor,required=false):Promise<Consent|null>{
 if(visitor.current_consent_id){const [row]=await tx<Consent[]>`select * from app.consent_receipt where id=${visitor.current_consent_id} and visitor_id=${visitor.id} and effective_at<=clock_timestamp() and expires_at>clock_timestamp()`;if(row)return row;}
 if(required) throw new AccessError(404,'CONSENT_NOT_RECORDED');return null;
}
export async function recordConsent(tx:TransactionSql,visitor:Visitor,key:string,value:unknown){
 const body=object(value,['expected_version','policy_version','choices']),version=integer(body.expected_version,0),choices=parseChoices(body.choices),policy=text(body.policy_version,100);
 if(policy!==body.policy_version) throw invalid();if(policy!==LOCAL_PRIVACY_POLICY_VERSION) throw new AccessError(409,'CONSENT_POLICY_CHANGED');
 const hash=digest(JSON.stringify({expected_version:version,policy_version:body.policy_version,choices}));
 const [prior]=await tx<Consent[]>`select * from app.consent_receipt where visitor_id=${visitor.id} and key=${key}`;
 if(prior){if((prior as Consent&{request_hash:string}).request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return projectConsent(await currentConsent(tx,visitor,true) as Consent);}
 if(visitor.consent_revision!==version) throw new AccessError(409,'CONSENT_VERSION_CONFLICT');
 const [clock]=await tx`select clock_timestamp() as now`;const now=new Date(clock.now).toISOString(),expires=new Date(Math.min(new Date(visitor.expires_at).getTime(),Date.parse(now)+86400000)).toISOString();
 const [saved]=await tx<Consent[]>`insert into app.consent_receipt (visitor_id,revision,key,request_hash,policy_version,choices,effective_at,expires_at)
  values (${visitor.id},${version+1},${key},${hash},${LOCAL_PRIVACY_POLICY_VERSION},${JSON.stringify(choices)}::jsonb,${now},${expires}) returning *`;
 await tx`update app.visitor_session set consent_revision=${version+1},current_consent_id=${saved.id} where id=${visitor.id}`;
 const denied=(['meta','google','tiktok'] as Platform[]).filter(p=>!measurementAllowed(choices,p));
 if(denied.length){
  const changed=await tx`update app.ad_event_outbox o set status='cancelled',reason='withdrawn' from app.commerce_event e where o.event_id=e.id and e.visitor_id=${visitor.id} and o.platform in ${tx(denied)} and o.status='queued' returning o.job_id`;
  const jobs=changed.map(r=>r.job_id).filter(Boolean);if(jobs.length) await tx`update app.outbox_job set status='completed',last_error=null,completed_at=clock_timestamp(),result=${JSON.stringify({status:'suppressed',reason:'withdrawn'})}::jsonb where id in ${tx(jobs)} and status in ('pending','unknown','failed')`;
 }
 return projectConsent(saved);
}
