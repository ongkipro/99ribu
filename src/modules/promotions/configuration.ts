import {createHash,randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {array,id,integer,invalid,object,pageInput,text} from '../catalog/validation.ts';

export const MAX_MONEY=Number.MAX_SAFE_INTEGER;
export function instant(value:unknown){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value) throw invalid();
  return value;
}
export function identifier(value:unknown){const result=text(value,100);if(result!==value||!/^[A-Za-z0-9_-]+$/.test(result)) throw invalid();return result;}
const choices=(value:unknown,allowed:readonly string[])=>{if(typeof value!=='string'||!allowed.includes(value)) throw invalid();return value;};
const unique=(value:unknown,maximum=100)=>{const result=array(value,identifier,0,maximum);if(new Set(result).size!==result.length) throw invalid();return result.sort();};
// S177: voucher codes are stored upper-case; NFKC folds full-width input. Null means an automatic promotion.
export function voucherCode(value:unknown){
  if(value===undefined||value===null) return null;
  if(typeof value!=='string') throw invalid();
  const code=value.normalize('NFKC').trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(code)) throw invalid();return code;
}
// S177 roles: owner and ecommerce_admin decide (full access); marketing proposes. Same session/MFA/grant lock as the
// catalog authority, so a revoked grant or a stale MFA session cannot write.
export async function promotionAuthority(tx:TransactionSql,principal:Principal){
  await tx`select id from app.auth_user where id=${principal.id} for update`;
  const [grant]=await tx`select g.roles from app.role_grant g join app.auth_user u on u.id=g.user_id
    join app.auth_session s on s.user_id=u.id join app.mfa_session m on m.session_id=s.id
    where u.id=${principal.id} and s.id=${principal.sessionId} and s.expires_at>clock_timestamp() and u.two_factor_enabled for share of g,s,m`;
  const roles:string[]=grant?.roles??[];const approver=roles.includes('owner')||roles.includes('ecommerce_admin');
  if(!approver&&!roles.includes('marketing')) throw new AccessError(403,'FORBIDDEN');
  return {approver};
}
export function configurationInput(value:unknown){
  const body=object(value,['expected_version','name','active','starts_at','ends_at','kind','value','maximum_per_order','minimum_merchandise','budget','per_buyer_limit','payment_methods','region_ids','service_ids','stacking','priority','reason','code','target']);
  const kind=choices(body.kind,['fixed','percentage']);const methods=unique(body.payment_methods,2);
  if(typeof body.active!=='boolean'||!methods.length||methods.some((m)=>!['prepaid','cod'].includes(m))) throw invalid();
  const input={expected_version:integer(body.expected_version,0),name:text(body.name,200),active:body.active,starts_at:instant(body.starts_at),ends_at:instant(body.ends_at),kind,
    value:integer(body.value,0,kind==='percentage'?10000:MAX_MONEY),maximum_per_order:integer(body.maximum_per_order,0,MAX_MONEY),minimum_merchandise:integer(body.minimum_merchandise,0,MAX_MONEY),
    budget:integer(body.budget,0,MAX_MONEY),per_buyer_limit:integer(body.per_buyer_limit,1,1000000),payment_methods:methods,region_ids:unique(body.region_ids),service_ids:unique(body.service_ids),
    stacking:choices(body.stacking,['exclusive','allowed']),priority:integer(body.priority,0,10000),reason:text(body.reason,500),code:voucherCode(body.code),target:body.target===undefined?'shipping':choices(body.target,['shipping','merchandise'])};
  if(input.starts_at>=input.ends_at||(input.active&&(!input.value||!input.maximum_per_order||!input.budget))) throw invalid();
  // S177 stage 2B: a store voucher always has a code, and a percentage one a cap that covers the minimum purchase (decision 1).
  if(input.target==='merchandise'&&(input.code===null||(input.kind==='percentage'&&input.value>0&&(!input.maximum_per_order
    ||BigInt(input.maximum_per_order)*10000n<BigInt(input.value)*BigInt(input.minimum_merchandise))))) throw invalid();
  return input;
}
// Terms a running voucher keeps (S177 decision 8): only the end, the budget, the name and the active flag move.
const LOCKED=['target','kind','value','maximum_per_order','minimum_merchandise','per_buyer_limit','payment_methods','region_ids','service_ids','stacking','priority','starts_at'] as const;
export async function insertVersion(tx:TransactionSql,promotionId:string,input:ReturnType<typeof configurationInput>,actorId:string,proposed=false){
  const [head]=await tx`select * from app.promotion where id=${promotionId} for update`;
  if(!head) throw new AccessError(404,'NOT_FOUND');
  if(head.configuration_revision!==input.expected_version) throw new AccessError(409,'VERSION_CONFLICT');
  if(input.code!==null&&input.code!==head.code) throw new AccessError(409,'VOUCHER_CODE_IMMUTABLE');
  // A voucher that has ever run keeps the terms it ran with, also after being stopped (no stop, edit, restart), so the
  // same code never returns with different terms while its per-buyer counters carry on.
  if(head.code!==null&&head.configuration_revision>0){
    const [ran]=await tx`select * from app.promotion_version where promotion_id=${promotionId} and active and starts_at<=clock_timestamp() order by revision desc limit 1`;
    if(ran){const terms=project({...ran,reserved_amount:0,committed_amount:0,budget_revision:0,code:head.code,used_count:0,has_run:true});
      if(LOCKED.some((k)=>JSON.stringify(terms[k])!==JSON.stringify(k==='starts_at'?new Date(input.starts_at).toISOString():input[k]))
        ||Date.parse(input.ends_at)<Date.parse(terms.ends_at)&&input.active||input.budget<terms.budget) throw new AccessError(409,'VOUCHER_TERMS_LOCKED');}
  }
  if(BigInt(input.budget)<BigInt(head.reserved_amount)+BigInt(head.committed_amount)) throw new AccessError(409,'BUDGET_ENCUMBERED');
  if(input.active&&Date.parse(input.ends_at)<=Date.now()) throw new AccessError(400,'PROMOTION_ALREADY_ENDED');
  await tx`insert into app.promotion_version (promotion_id,revision,name,active,starts_at,ends_at,kind,value,maximum_per_order,minimum_merchandise,budget,per_buyer_limit,payment_methods,region_ids,service_ids,stacking,priority,actor_id,reason,proposed,target)
    values (${promotionId},${input.expected_version+1},${input.name},${input.active},${input.starts_at},${input.ends_at},${input.kind},${input.value},${input.maximum_per_order},${input.minimum_merchandise},${input.budget},${input.per_buyer_limit},${input.payment_methods},${input.region_ids},${input.service_ids},${input.stacking},${input.priority},${actorId},${input.reason},${proposed},${input.target})`;
  await tx`update app.promotion set configuration_revision=configuration_revision+1 where id=${promotionId}`;
}
export async function readConfiguration(tx:TransactionSql,promotionId:string){
  const [row]=await tx`select v.*,${columns(tx)} from app.promotion p join app.promotion_version v
    on v.promotion_id=p.id and v.revision=p.configuration_revision where p.id=${promotionId}`;
  if(!row) throw new AccessError(404,'NOT_FOUND');return project(row);
}
// Head columns every projection reads: code and lifetime committed uses (orders that used the promotion).
const columns=(tx:TransactionSql)=>tx`p.reserved_amount,p.committed_amount,p.budget_revision,p.code,(select coalesce(sum(b.committed_uses),0)::int from app.promotion_buyer_usage b where b.promotion_id=p.id) used_count,
  exists(select 1 from app.promotion_version r where r.promotion_id=p.id and r.active and r.starts_at<=clock_timestamp()) has_run`;
// Monetary JSON is bounded by SQL to exact safe integers. Counters are lifetime,
// not per version, and committed budget is not an accounting expense.
function project(row:Record<string,unknown>){
  return {id:String(row.promotion_id),version_id:String(row.id),version:Number(row.revision),name:String(row.name),active:Boolean(row.active),
    starts_at:new Date(String(row.starts_at)).toISOString(),ends_at:new Date(String(row.ends_at)).toISOString(),kind:String(row.kind),value:Number(row.value),maximum_per_order:Number(row.maximum_per_order),
    minimum_merchandise:Number(row.minimum_merchandise),budget:Number(row.budget),per_buyer_limit:Number(row.per_buyer_limit),payment_methods:row.payment_methods as string[],region_ids:row.region_ids as string[],service_ids:row.service_ids as string[],
    stacking:String(row.stacking),priority:Number(row.priority),recorded_by:String(row.actor_id),reason:String(row.reason),recorded_at:new Date(String(row.created_at)).toISOString(),currency:'IDR',
    budget_state:{version:Number(row.budget_revision),reserved:Number(row.reserved_amount),committed:Number(row.committed_amount)},
    code:row.code===null?null:String(row.code),proposed:Boolean(row.proposed),target:String(row.target??'shipping'),used_count:Number(row.used_count),has_run:Boolean(row.has_run)};
}
export async function writeConfiguration(request:Request,identity:LocalAuth,principal:Principal,scope:string|null,value:unknown){
  const input=configurationInput(value);const promotionId=scope===null?null:id(scope);
  if(promotionId===null&&input.expected_version!==0) throw invalid();
  const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
  const hash=createHash('sha256').update(JSON.stringify({promotionId,input})).digest('hex');
  return identity.sql.begin(async(tx)=>{
    const {approver}=await promotionAuthority(tx,principal);
    // Marketing only proposes: its versions are inactive and wait for an owner/admin decision.
    if(!approver&&input.active) throw new AccessError(403,'PROMOTION_APPROVAL_REQUIRED');
    const [prior]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='promotion.configure' and key=${key}`;
    if(prior){if(prior.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return prior.response;}
    const selected=promotionId??randomUUID();
    if(promotionId===null){
      if(input.code&&(await tx`select 1 from app.promotion where code=${input.code}`).length) throw new AccessError(409,'VOUCHER_CODE_TAKEN');
      try{await tx.savepoint((sp)=>sp`insert into app.promotion (id,code) values (${selected},${input.code})`);}
      catch(error){if((error as {code?:string}).code==='23505') throw new AccessError(409,'VOUCHER_CODE_TAKEN');throw error;}
    }
    // A proposal on a running promotion would switch it off; marketing proposes only on new or stopped ones.
    if(!approver&&promotionId!==null&&(await readConfiguration(tx,promotionId)).active) throw new AccessError(403,'PROMOTION_APPROVAL_REQUIRED');
    await insertVersion(tx,selected,input,principal.id,!approver);const response=await readConfiguration(tx,selected);
    await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},'promotion.configure',${selected},'allowed',${input.reason},${JSON.stringify({version_id:response.version_id,version:response.version})}::jsonb)`;
    await tx`insert into app.access_operation (actor_id,action,key,request_hash,response) values (${principal.id},'promotion.configure',${key},${hash},${JSON.stringify(response)}::jsonb)`;
    return response;
  });
}
export async function listConfigurations(identity:LocalAuth,principal:Principal,url:URL,scope:string|null=null,history=false){
  const selected=scope===null?null:id(scope);
  const page=history?null:pageInput(url);
  let cursor:number|null=null;let limit=20;
  if(history){
    for(const key of url.searchParams.keys()) if(!['cursor','limit'].includes(key)||url.searchParams.getAll(key).length!==1) throw invalid();
    const raw=url.searchParams.get('cursor');const size=url.searchParams.get('limit')??'20';
    if(!/^\d{1,3}$/.test(size)||(raw!==null&&!/^\d{1,10}$/.test(raw))) throw invalid();
    limit=integer(Number(size),1,100);cursor=raw===null?null:integer(Number(raw),1);
  }
  return identity.sql.begin(async(tx)=>{
    await promotionAuthority(tx,principal);
    if(selected&&!history){if(url.search) throw invalid();return readConfiguration(tx,selected);}
    if(selected){if(!(await tx`select id from app.promotion where id=${selected} for share`).length) throw new AccessError(404,'NOT_FOUND');}
    const rows=history?await tx`select v.*,${columns(tx)} from app.promotion_version v join app.promotion p on p.id=v.promotion_id
      where p.id=${selected} and (${cursor}::int is null or v.revision<${cursor}::int) order by v.revision desc limit ${limit+1}`
      :await tx`select v.*,${columns(tx)} from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision
        where (${page?.cursor??null}::uuid is null or p.id>${page?.cursor??null}::uuid) order by p.id limit ${(page?.limit??20)+1}`;
    const size=history?limit:page?.limit??20;const data=rows.slice(0,size).map(project);
    return {data,pagination:{next_cursor:rows.length>size?(history?String(data.at(-1)?.version):data.at(-1)?.id):null}};
  });
}

// S177: an owner/admin decision on a marketing proposal. Approve appends the proposed terms as the active version;
// reject appends them inactive and no longer proposed. Both are audited with the decider's reason.
export async function decideProposal(request:Request,identity:LocalAuth,principal:Principal,scope:string,value:unknown){
  const body=object(value,['expected_version','decision','reason']);const promotionId=id(scope);
  const expected=integer(body.expected_version,1),decision=choices(body.decision,['approve','reject']),reason=text(body.reason,500);
  const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
  const hash=createHash('sha256').update(JSON.stringify({promotionId,expected,decision,reason})).digest('hex');
  return identity.sql.begin(async(tx)=>{
    const {approver}=await promotionAuthority(tx,principal);if(!approver) throw new AccessError(403,'FORBIDDEN');
    const [prior]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='promotion.decide' and key=${key}`;
    if(prior){if(prior.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return prior.response;}
    await tx`select id from app.promotion where id=${promotionId} for update`;
    const current=await readConfiguration(tx,promotionId);
    if(current.version!==expected) throw new AccessError(409,'VERSION_CONFLICT');
    if(!current.proposed) throw new AccessError(409,'PROPOSAL_REQUIRED');
    if(decision==='approve'&&(!current.value||!current.maximum_per_order||!current.budget)) throw new AccessError(409,'PROPOSAL_INCOMPLETE');
    if(decision==='approve'&&Date.parse(current.ends_at)<=Date.now()) throw new AccessError(400,'PROMOTION_ALREADY_ENDED');
    const terms={expected_version:current.version,name:current.name,active:decision==='approve',starts_at:current.starts_at,ends_at:current.ends_at,kind:current.kind,value:current.value,
      maximum_per_order:current.maximum_per_order,minimum_merchandise:current.minimum_merchandise,budget:current.budget,per_buyer_limit:current.per_buyer_limit,payment_methods:current.payment_methods,
      region_ids:current.region_ids,service_ids:current.service_ids,stacking:current.stacking,priority:current.priority,reason:`${decision==='approve'?'Disetujui':'Ditolak'}: ${reason}`.slice(0,500),code:current.code,target:current.target};
    await insertVersion(tx,promotionId,terms,principal.id);const response=await readConfiguration(tx,promotionId);
    await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},${`promotion.${decision}`},${promotionId},'allowed',${reason},${JSON.stringify({version_id:response.version_id,version:response.version,proposal_version:current.version})}::jsonb)`;
    await tx`insert into app.access_operation (actor_id,action,key,request_hash,response) values (${principal.id},'promotion.decide',${key},${hash},${JSON.stringify(response)}::jsonb)`;
    return response;
  });
}
