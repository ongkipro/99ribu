import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { id, integer, invalid, object, text } from "../catalog/validation.ts";

type Kind='component'|'assumption';
type CostRow={id:string;stock_item_id?:string;offer_id?:string;revision:number;unit_cost?:number|null;
  packaging_idr?:number|null;provider_fee_idr?:number|null;subsidy_idr?:number|null;returns_reserve_idr?:number|null;
  effective_at:string;source:string;reason:string;actor_id:string;created_at:string};

export async function financeAuthority(tx:TransactionSql,principal:Principal,permission:'finance.costs.read'|'finance.costs.write'|'finance.reconciliation.read'|'finance.reconciliation.write'|'finance.refunds.read'|'finance.refunds.write',freshMfa=false){
  await tx`select id from app.auth_user where id=${principal.id} for update`;
  const [grant]=await tx`select g.roles,g.permissions from app.role_grant g join app.auth_user u on u.id=g.user_id
    join app.auth_session s on s.user_id=u.id join app.mfa_session m on m.session_id=s.id
    where u.id=${principal.id} and s.id=${principal.sessionId} and s.expires_at>clock_timestamp() and u.two_factor_enabled
    and (not ${freshMfa} or m.verified_at>clock_timestamp()-interval '5 minutes') for share of g,s,m`;
  if(!grant||!(grant.roles.includes('owner')||(grant.roles.includes('finance')&&grant.permissions.includes(permission)))) throw new AccessError(403,'FORBIDDEN');
  if(permission.startsWith('finance.reconciliation.')||permission.startsWith('finance.refunds.')){
    // Check wall time again after session/MFA row-lock waits. Reconciliation
    // must not replay protected data using authority that expired while waiting.
    const [current]=await tx`select s.id from app.auth_session s join app.mfa_session m on m.session_id=s.id
      where s.id=${principal.sessionId} and s.user_id=${principal.id} and s.expires_at>clock_timestamp()
      and (not ${freshMfa} or m.verified_at>clock_timestamp()-interval '5 minutes')`;
    if(!current)throw new AccessError(403,'FORBIDDEN');
  }
  return {owner:grant.roles.includes('owner') as boolean};
}
function effectiveInput(value:unknown){
  if(value===null) return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value) throw invalid();
  return value;
}
const nullableCost=(value:unknown)=>value===null?null:integer(value,0);
function project(row:CostRow,kind:Kind){
  return {id:row.id,...(kind==='component'?{stock_item_id:row.stock_item_id,unit_cost:row.unit_cost}:{offer_id:row.offer_id,
    packaging_idr:row.packaging_idr,provider_fee_idr:row.provider_fee_idr,subsidy_idr:row.subsidy_idr,returns_reserve_idr:row.returns_reserve_idr}),
    version:row.revision,effective_from:new Date(row.effective_at).toISOString(),source:row.source,reason:row.reason,
    recorded_by:row.actor_id,recorded_at:new Date(row.created_at).toISOString(),currency:'IDR'};
}
async function lockIdentity(tx:TransactionSql,kind:Kind,scopeId:string,write:boolean){
  const rows=kind==='component'
    ?await tx`select id from app.stock_item where id=${scopeId} ${write?tx`for update`:tx`for share`}`
    :await tx`select id from app.offer where id=${scopeId} ${write?tx`for update`:tx`for share`}`;
  if(!rows.length) throw new AccessError(404,'NOT_FOUND');
}
// Trusted historical/quote consumers select explicit server time. HTTP callers
// cannot choose an as-of instant to escape current costing/publication guards.
export async function effectiveComponentCost(sql:Sql|TransactionSql,stockItemId:string,at:string){
  const [row]=await sql<CostRow[]>`select * from app.component_cost_version where stock_item_id=${stockItemId} and effective_at<=${at}::timestamptz order by effective_at desc,revision desc limit 1`;
  return row??null;
}
export async function effectiveOfferAssumptions(sql:Sql|TransactionSql,offerId:string,at:string){
  const [row]=await sql<CostRow[]>`select * from app.offer_cost_assumption_version where offer_id=${offerId} and effective_at<=${at}::timestamptz order by effective_at desc,revision desc limit 1`;
  return row??null;
}

export async function listCostVersions(identity:LocalAuth,principal:Principal,kind:Kind,scope:string,url:URL){
  const scopeId=id(scope);
  for(const key of url.searchParams.keys()) if(!['cursor','limit'].includes(key)||url.searchParams.getAll(key).length!==1) throw invalid();
  const limit=url.searchParams.get('limit')??'20';const cursor=url.searchParams.get('cursor');
  if(!/^\d{1,3}$/.test(limit)||Number(limit)<1||Number(limit)>100||(cursor!==null&&(!/^\d{1,10}$/.test(cursor)||Number(cursor)<1||Number(cursor)>2147483647))) throw invalid();
  return identity.sql.begin(async(tx)=>{
    await financeAuthority(tx,principal,'finance.costs.read');await lockIdentity(tx,kind,scopeId,false);
    const [clock]=await tx`select clock_timestamp()::text as now`;
    const rows=kind==='component'
      ?await tx<CostRow[]>`select * from app.component_cost_version where stock_item_id=${scopeId} and (${cursor}::int is null or revision<${cursor}::int) order by revision desc limit ${Number(limit)+1}`
      :await tx<CostRow[]>`select * from app.offer_cost_assumption_version where offer_id=${scopeId} and (${cursor}::int is null or revision<${cursor}::int) order by revision desc limit ${Number(limit)+1}`;
    const [latest]=kind==='component'?await tx`select max(revision)::int as revision from app.component_cost_version where stock_item_id=${scopeId}`
      :await tx`select max(revision)::int as revision from app.offer_cost_assumption_version where offer_id=${scopeId}`;
    const current=kind==='component'?await effectiveComponentCost(tx,scopeId,clock.now):await effectiveOfferAssumptions(tx,scopeId,clock.now);
    const selected=rows.slice(0,Number(limit));
    await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},'finance.costs.read',${scopeId},'allowed','Read scoped cost version history',${JSON.stringify({kind})}::jsonb)`;
    return {data:selected.map((r)=>project(r,kind)),pagination:{next_cursor:rows.length>Number(limit)?String(selected.at(-1)?.revision):null},latest_version:latest.revision??0,current:current?project(current,kind):null};
  });
}

export async function appendCostVersion(request:Request,identity:LocalAuth,principal:Principal,kind:Kind,scope:string,value:unknown){
  const fields=kind==='component'?['unit_cost']:['packaging_idr','provider_fee_idr','subsidy_idr','returns_reserve_idr'];
  const body=object(value,[...fields,'expected_version','effective_from','source','reason']);
  const scopeId=id(scope);const input={kind,scope_id:scopeId,expected_version:integer(body.expected_version,0),effective_from:effectiveInput(body.effective_from),source:text(body.source,500),reason:text(body.reason,500),
    costs:Object.fromEntries(fields.map((name)=>[name,nullableCost(body[name])]))};
  const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
  const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return identity.sql.begin(async(tx)=>{
    await financeAuthority(tx,principal,'finance.costs.write');
    const [saved]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='finance.costs.append' and key=${key}`;
    if(saved){if(saved.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return saved.response;}
    await lockIdentity(tx,kind,scopeId,true);
    const [last]=kind==='component'?await tx<CostRow[]>`select * from app.component_cost_version where stock_item_id=${scopeId} order by revision desc limit 1`
      :await tx<CostRow[]>`select * from app.offer_cost_assumption_version where offer_id=${scopeId} order by revision desc limit 1`;
    if((last?.revision??0)!==input.expected_version) throw new AccessError(409,'VERSION_CONFLICT');
    const [clock]=await tx`select clock_timestamp()::text as now`;
    if(input.effective_from!==null){
      if(Date.parse(input.effective_from)<Date.parse(clock.now)) throw new AccessError(400,'RETROACTIVE_COST_FORBIDDEN');
      if(Date.parse(input.effective_from)>Date.parse(clock.now)+366*86400000) throw new AccessError(400,'COST_SCHEDULE_TOO_DISTANT');
    }
    const prospective=input.effective_from??clock.now;
    if(last&&Date.parse(prospective)<Date.parse(last.effective_at)) throw new AccessError(409,'SCHEDULE_CONFLICT');
    const [row]=kind==='component'
      ?await tx<CostRow[]>`insert into app.component_cost_version (stock_item_id,revision,unit_cost,effective_at,source,reason,actor_id)
        values (${scopeId},${input.expected_version+1},${input.costs.unit_cost},${input.effective_from},${input.source},${input.reason},${principal.id}) returning *`
      :await tx<CostRow[]>`insert into app.offer_cost_assumption_version (offer_id,revision,effective_at,packaging_idr,provider_fee_idr,subsidy_idr,returns_reserve_idr,source,reason,actor_id)
        values (${scopeId},${input.expected_version+1},${input.effective_from},${input.costs.packaging_idr},${input.costs.provider_fee_idr},${input.costs.subsidy_idr},${input.costs.returns_reserve_idr},${input.source},${input.reason},${principal.id}) returning *`;
    const response=project(row,kind);
    await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},'finance.costs.append',${scopeId},'allowed',${input.reason},${JSON.stringify({kind,version_id:row.id,version:row.revision})}::jsonb)`;
    await tx`insert into app.access_operation (actor_id,action,key,request_hash,response)
      values (${principal.id},'finance.costs.append',${key},${hash},${JSON.stringify(response)}::jsonb)`;
    return response;
  });
}
