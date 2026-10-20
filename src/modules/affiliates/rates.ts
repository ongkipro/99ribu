import {createHash,randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {assertCurrentOwner,consumeAccessProof} from '../access/grants.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {id,integer,invalid,object,text} from '../catalog/validation.ts';
import {lockActor,type CommerceActor} from '../checkout/access.ts';
import {financeInstant} from '../finance/ledger.ts';
import {returnText} from '../returns/policy.ts';
import {resolvePolicy} from '../settings/policies.ts';

export function rateVersionInput(value:unknown){
 const input=object(value,['basis_points','effective_at','expected_version','reason','reauthentication_proof']);
 if(input.effective_at!==null&&typeof input.effective_at!=='string')throw invalid();
 const proof=text(input.reauthentication_proof,100);
 if(proof!==input.reauthentication_proof||/[\p{Cc}\p{Cf}]/u.test(proof))throw invalid();
 return {basis_points:integer(input.basis_points,0,10000),
  effective_at:input.effective_at===null?null:financeInstant(input.effective_at),
  expected_version:integer(input.expected_version,0),reason:returnText(input.reason,500),
  reauthentication_proof:proof};
}

// A complete purchased offer remains IDR99,000. Round half up per original
// quantity; shipping, subsidy and a replacement never create another basis.
export function offerCommissionIdr(basisPoints:number){
 return Number((99000n*BigInt(integer(basisPoints,0,10000))+5000n)/10000n);
}

type RateAccount={id:string;user_id:string;status:string;rate_revision:number;email_verified:boolean};
type RateVersion={id:string;affiliate_id:string;revision:number;basis_points:number;effective_at:string};
const projectRate=(row:RateVersion)=>({id:row.id,affiliate_id:row.affiliate_id,basis_points:row.basis_points,
 effective_at:new Date(row.effective_at).toISOString(),version:row.revision});

async function currentAffiliate(tx:TransactionSql,affiliateId:string,write=false){
 const rows=write
  ?await tx<RateAccount[]>`select a.*,u.email_verified from app.affiliate_account a join app.auth_user u on u.id=a.user_id
   where a.id=${affiliateId} for update of a`
  :await tx<RateAccount[]>`select a.*,u.email_verified from app.affiliate_account a join app.auth_user u on u.id=a.user_id
   where a.id=${affiliateId} for share of a`;
 const [account]=rows;
 if(!account)throw new AccessError(404,'NOT_FOUND');
 const [grant]=await tx`select roles from app.role_grant where user_id=${account.user_id} for share`;
 if(!account.email_verified||account.status!=='active'||!grant?.roles.includes('affiliate'))throw new AccessError(409,'AFFILIATE_RATE_UNAVAILABLE');
 // Subject user is locked before this stream by the caller. Grant writers take
 // that same user first, so eligibility cannot change while the stream is held.
 return account;
}

// Trusted quote/order consumer only; S35 must supply actual first-touch context.
// Lock both users in stable order before the cart, rate stream and catalog.
export async function lockRateActor(tx:TransactionSql,actor:CommerceActor,affiliateId:string|null=null){
 const selected=affiliateId===null?null:id(affiliateId);
 if(selected===null){await lockActor(tx,actor);return null;}
 const [subject]=await tx`select user_id from app.affiliate_account where id=${selected}`;
 if(actor.kind==='user'){
  const users=[...new Set([actor.id,...(subject?[String(subject.user_id)]:[])])].sort();
  await tx`select id from app.auth_user where id in ${tx(users)} order by id for update`;
  await lockActor(tx,actor);
 }else{
  await lockActor(tx,actor);
  if(subject)await tx`select id from app.auth_user where id=${String(subject.user_id)} for share`;
 }
 const [account]=await tx`select id,user_id from app.affiliate_account where id=${selected} for share`;
 // Eligibility belongs after immutable operation replay. A suspended affiliate
 // cannot invalidate recovery of an already committed buyer order.
 return account??null;
}

// Caller holds lockRateActor's stream before catalog/policy locks, then reads
// its database timestamp. The result is a private financial snapshot, not DTO.
export async function readEffectiveAffiliateRate(tx:TransactionSql,affiliateId:string|null,at:string,buyerUserId:string|null=null){
 const instant=financeInstant(at),policy=await resolvePolicy(tx,'commercial',null,new Date(instant));
 if(!('default_commission_bps'in policy.values))throw new AccessError(503,'POLICY_INVALID');
 const selected=affiliateId===null?null:id(affiliateId);
 if(selected!==null){
  const account=await currentAffiliate(tx,selected);
  if(buyerUserId!==null&&account.user_id===buyerUserId)throw new AccessError(422,'AFFILIATE_SELF_PURCHASE');
 }
 const [override]=selected===null?[]:await tx<RateVersion[]>`select id,affiliate_id,revision,basis_points,effective_at from app.affiliate_rate_version
  where affiliate_id=${selected} and effective_at<=${instant}::timestamptz order by effective_at desc,revision desc limit 1`;
 const basisPoints=override?.basis_points??policy.values.default_commission_bps;
 return {affiliate_id:selected,rate_version_id:override?.id??null,basis_points:basisPoints,commission_idr:offerCommissionIdr(basisPoints),policy};
}

// Source only until exact0022 native/application gates pass. Version creation
// precedes proof consumption so deferred seals can bind its real acceptance time.
export async function appendAffiliateRate(request:Request,identity:LocalAuth,principal:Principal,affiliateId:string,value:unknown){
 const selected=id(affiliateId),input=rateVersionInput(value),key=request.headers.get('idempotency-key');
 if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key))throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
 const intent={affiliate_id:selected,basis_points:input.basis_points,effective_at:input.effective_at,expected_version:input.expected_version,reason:input.reason};
 const hash=createHash('sha256').update(JSON.stringify(intent)).digest('hex'),proofDigest=createHash('sha256').update(input.reauthentication_proof).digest('hex');
 return identity.sql.begin(async tx=>{
  const [subject]=await tx`select user_id from app.affiliate_account where id=${selected}`;
  const users=[...new Set([principal.id,...(subject?[String(subject.user_id)]:[])])].sort();
  const locked=await tx`select id,email_verified from app.auth_user where id in ${tx(users)} order by id for update`;
  if(!locked.some(row=>row.id===principal.id&&row.email_verified))throw new AccessError(403,'FORBIDDEN');
  await assertCurrentOwner(tx,principal,true);
  if(!subject)throw new AccessError(404,'NOT_FOUND');
  const [previous]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='affiliate_rate.append' and key=${key}`;
  if(previous){if(previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return previous.response;}
  const account=await currentAffiliate(tx,selected,true);
  if(account.rate_revision!==input.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  if(account.rate_revision===2147483647)throw new AccessError(409,'RATE_VERSION_EXHAUSTED');
  const [clock]=await tx`select date_trunc('milliseconds',clock_timestamp()) as now`;
  const now=new Date(clock.now).getTime(),effective=input.effective_at===null?now:Date.parse(input.effective_at);
  if(effective<now)throw new AccessError(400,'RETROACTIVE_RATE_FORBIDDEN');
  if(effective>now+366*86400000)throw new AccessError(400,'RATE_SCHEDULE_TOO_DISTANT');
  const [last]=await tx`select effective_at from app.affiliate_rate_version where affiliate_id=${selected} order by revision desc limit 1`;
  if(last&&effective<new Date(last.effective_at).getTime())throw new AccessError(409,'SCHEDULE_CONFLICT');
  const operationId=randomUUID(),[version]=await tx<RateVersion[]>`insert into app.affiliate_rate_version
   (affiliate_id,revision,operation_id,basis_points,effective_at,actor_id,session_id,proof_digest,reason)
   values (${selected},${account.rate_revision+1},${operationId},${input.basis_points},${input.effective_at},${principal.id},${principal.sessionId},${proofDigest},${input.reason}) returning *`;
  await consumeAccessProof(tx,principal,'affiliate_rate.version',selected,input.reauthentication_proof);
  await assertCurrentOwner(tx,principal,true);
  await tx`update app.affiliate_account set rate_revision=${version.revision} where id=${selected}`;
  const response=projectRate(version);
  await tx`insert into app.access_operation (id,actor_id,action,key,request_hash,response)
   values (${operationId},${principal.id},'affiliate_rate.append',${key},${hash},${JSON.stringify(response)}::jsonb)`;
  await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details,created_at)
   values (${principal.id},'affiliate_rate.version',${selected},'allowed',${input.reason},${JSON.stringify({operation_id:operationId,version_id:version.id,version:version.revision,basis_points:version.basis_points,effective_at:response.effective_at})}::jsonb,clock_timestamp())`;
  await tx`set constraints all immediate`;return response;
 });
}
