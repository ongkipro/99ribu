import {randomUUID,timingSafeEqual} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError} from '../access/policy.ts';
import {invalid,object} from '../catalog/validation.ts';
import {cookie,digest,lockActor,mac,prefix,type CommerceActor} from '../checkout/access.ts';

export type Visitor={id:string;digest:string;principal_scope:string;status:'preparing'|'active'|'revoked';activation_key:string|null;activation_hash:string|null;consent_revision:number;current_consent_id:string|null;created_at:string;expires_at:string};
export const visitorScope=(actor:CommerceActor|null)=>actor?.kind==='user'?`user:${actor.id}:${actor.principal.sessionId}`:'browser';
export async function visitorToken(identity:LocalAuth,visitor:Pick<Visitor,'id'|'principal_scope'|'created_at'>){return mac(identity,'visitor-session',[visitor.id,visitor.principal_scope,new Date(visitor.created_at).toISOString()]);}
export async function visitorCookieName(identity:LocalAuth){return `${await prefix(identity)}.visitor`;}
export async function readVisitor(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor|null,required=true,preparing=false):Promise<Visitor|null>{
 let raw:string|null;try{raw=cookie(request,await visitorCookieName(identity));}catch(error){if(required) throw error;return null;}
 const match=raw&&/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/.exec(raw);
 if(match){
  const [visitor]=await tx<Visitor[]>`select * from app.visitor_session where id=${match[1]} for update`;
  const [clock]=await tx`select clock_timestamp() as now`;
  if(visitor&&visitor.principal_scope===visitorScope(actor)&&visitor.status!=='revoked'&&(preparing||visitor.status==='active')&&new Date(visitor.expires_at)>new Date(clock.now)&&timingSafeEqual(Buffer.from(visitor.digest,'hex'),Buffer.from(digest(match[2]),'hex'))&&match[2]===await visitorToken(identity,visitor)) return visitor;
 }
 if(required) throw new AccessError(401,'VISITOR_CONTEXT_REQUIRED');return null;
}
export async function visitorRate(tx:TransactionSql,key:string,maximum=60){
 const [clock]=await tx`select floor(extract(epoch from clock_timestamp())*1000)::text now`;const now=Number(clock.now);
 const [rate]=await tx`insert into app.auth_rate_limit (id,key,count,last_request) values (${randomUUID()},${key},1,${now}) on conflict (key) do update set
   count=case when app.auth_rate_limit.last_request<=${now-60000} then 1 else app.auth_rate_limit.count+1 end,last_request=case when app.auth_rate_limit.last_request<=${now-60000} then ${now} else app.auth_rate_limit.last_request end returning count,last_request`;
 if(rate.count>maximum) throw new AccessError(429,'RATE_LIMITED',Math.max(1,Math.ceil((Number(rate.last_request)+60000-now)/1000)));
}
export async function bootstrapVisitor(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor|null,key:string,value:unknown){
 const body=object(value,['client_request_id']);if(typeof body.client_request_id!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(body.client_request_id)) throw invalid();
 // lazy: guarded loopback clients share one bootstrap budget; use trusted per-client keys before remote activation.
 if(actor) await lockActor(tx,actor);await visitorRate(tx,'visitor-bootstrap:127.0.0.1',120);
 const scope=visitorScope(actor),hash=digest(JSON.stringify({client_request_id:body.client_request_id}));
 let visitor=await readVisitor(tx,request,identity,actor,false,true);
 if(scope!=='browser'){
  await tx`select pg_advisory_xact_lock(hashtextextended(${`visitor:${scope}:${key}`},0))`;
  const [prior]=await tx<Visitor[]>`select v.* from app.visitor_session v join app.visitor_bootstrap_request r on r.visitor_id=v.id where r.principal_scope=${scope} and r.key=${key} for update of v`;
  if(prior){const [receipt]=await tx`select request_hash from app.visitor_bootstrap_request where visitor_id=${prior.id} and key=${key}`;if(receipt.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');const [clock]=await tx`select clock_timestamp() as now`;if(prior.status!=='active'||new Date(prior.expires_at)<=new Date(clock.now)) throw new AccessError(409,'VISITOR_SESSION_EXPIRED');visitor=prior;}
 }
 if(visitor?.status==='active'){
  await recordBootstrap(tx,visitor,key,hash);
  return {visitor,bootstrap:false};
 }
 const [clock]=await tx`select clock_timestamp() as now`;const now=new Date(clock.now).toISOString();
 if(visitor){
  [visitor]=await tx<Visitor[]>`update app.visitor_session set status='active',activation_key=${key},activation_hash=${hash},activated_at=${now},expires_at=${new Date(Date.parse(now)+86400000).toISOString()} where id=${visitor.id} returning *`;
  await recordBootstrap(tx,visitor,key,hash);
  return {visitor,bootstrap:false};
 }
 const id=randomUUID(),trusted=actor!==null,created={id,principal_scope:scope,created_at:now},token=await visitorToken(identity,created);
 [visitor]=await tx<Visitor[]>`insert into app.visitor_session (id,digest,principal_scope,status,activation_key,activation_hash,created_at,expires_at,activated_at)
  values (${id},${digest(token)},${scope},${trusted?'active':'preparing'},${trusted?key:null},${trusted?hash:null},${now},${new Date(Date.parse(now)+(trusted?86400000:600000)).toISOString()},${trusted?now:null}) returning *`;
 if(trusted)await recordBootstrap(tx,visitor,key,hash);
 return {visitor,bootstrap:!trusted};
}
async function recordBootstrap(tx:TransactionSql,visitor:Visitor,key:string,hash:string){
 const [prior]=await tx`select request_hash from app.visitor_bootstrap_request where visitor_id=${visitor.id} and key=${key}`;
 if(prior){if(prior.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return;}
 await tx`insert into app.visitor_bootstrap_request (visitor_id,key,request_hash,principal_scope) values (${visitor.id},${key},${hash},${visitor.principal_scope})`;
}
