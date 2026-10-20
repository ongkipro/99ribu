import {createHash,randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {authority} from '../catalog/catalog.ts';
import {array,id,integer,invalid,object,pageInput,text} from '../catalog/validation.ts';

export const MAX_MONEY=Number.MAX_SAFE_INTEGER;
export function instant(value:unknown){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value) throw invalid();
  return value;
}
export function identifier(value:unknown){const result=text(value,100);if(result!==value||!/^[A-Za-z0-9_-]+$/.test(result)) throw invalid();return result;}
const choices=(value:unknown,allowed:readonly string[])=>{if(typeof value!=='string'||!allowed.includes(value)) throw invalid();return value;};
const unique=(value:unknown,maximum=100)=>{const result=array(value,identifier,0,maximum);if(new Set(result).size!==result.length) throw invalid();return result.sort();};
export function configurationInput(value:unknown){
  const body=object(value,['expected_version','name','active','starts_at','ends_at','kind','value','maximum_per_order','minimum_merchandise','budget','per_buyer_limit','payment_methods','region_ids','service_ids','stacking','priority','reason']);
  const kind=choices(body.kind,['fixed','percentage']);const methods=unique(body.payment_methods,2);
  if(typeof body.active!=='boolean'||!methods.length||methods.some((m)=>!['prepaid','cod'].includes(m))) throw invalid();
  const input={expected_version:integer(body.expected_version,0),name:text(body.name,200),active:body.active,starts_at:instant(body.starts_at),ends_at:instant(body.ends_at),kind,
    value:integer(body.value,0,kind==='percentage'?10000:MAX_MONEY),maximum_per_order:integer(body.maximum_per_order,0,MAX_MONEY),minimum_merchandise:integer(body.minimum_merchandise,0,MAX_MONEY),
    budget:integer(body.budget,0,MAX_MONEY),per_buyer_limit:integer(body.per_buyer_limit,1,1000000),payment_methods:methods,region_ids:unique(body.region_ids),service_ids:unique(body.service_ids),
    stacking:choices(body.stacking,['exclusive','allowed']),priority:integer(body.priority,0,10000),reason:text(body.reason,500)};
  if(input.starts_at>=input.ends_at||(input.active&&(!input.value||!input.maximum_per_order||!input.budget))) throw invalid();return input;
}
export async function insertVersion(tx:TransactionSql,promotionId:string,input:ReturnType<typeof configurationInput>,actorId:string){
  const [head]=await tx`select * from app.promotion where id=${promotionId} for update`;
  if(!head) throw new AccessError(404,'NOT_FOUND');
  if(head.configuration_revision!==input.expected_version) throw new AccessError(409,'VERSION_CONFLICT');
  if(BigInt(input.budget)<BigInt(head.reserved_amount)+BigInt(head.committed_amount)) throw new AccessError(409,'BUDGET_ENCUMBERED');
  if(input.active&&Date.parse(input.ends_at)<=Date.now()) throw new AccessError(400,'PROMOTION_ALREADY_ENDED');
  await tx`insert into app.promotion_version (promotion_id,revision,name,active,starts_at,ends_at,kind,value,maximum_per_order,minimum_merchandise,budget,per_buyer_limit,payment_methods,region_ids,service_ids,stacking,priority,actor_id,reason)
    values (${promotionId},${input.expected_version+1},${input.name},${input.active},${input.starts_at},${input.ends_at},${input.kind},${input.value},${input.maximum_per_order},${input.minimum_merchandise},${input.budget},${input.per_buyer_limit},${input.payment_methods},${input.region_ids},${input.service_ids},${input.stacking},${input.priority},${actorId},${input.reason})`;
  await tx`update app.promotion set configuration_revision=configuration_revision+1 where id=${promotionId}`;
}
export async function readConfiguration(tx:TransactionSql,promotionId:string){
  const [row]=await tx`select v.*,p.reserved_amount,p.committed_amount,p.budget_revision from app.promotion p join app.promotion_version v
    on v.promotion_id=p.id and v.revision=p.configuration_revision where p.id=${promotionId}`;
  if(!row) throw new AccessError(404,'NOT_FOUND');return project(row);
}
// Monetary JSON is bounded by SQL to exact safe integers. Counters are lifetime,
// not per version, and committed budget is not an accounting expense.
function project(row:Record<string,unknown>){
  return {id:String(row.promotion_id),version_id:String(row.id),version:Number(row.revision),name:String(row.name),active:Boolean(row.active),
    starts_at:new Date(String(row.starts_at)).toISOString(),ends_at:new Date(String(row.ends_at)).toISOString(),kind:String(row.kind),value:Number(row.value),maximum_per_order:Number(row.maximum_per_order),
    minimum_merchandise:Number(row.minimum_merchandise),budget:Number(row.budget),per_buyer_limit:Number(row.per_buyer_limit),payment_methods:row.payment_methods as string[],region_ids:row.region_ids as string[],service_ids:row.service_ids as string[],
    stacking:String(row.stacking),priority:Number(row.priority),recorded_by:String(row.actor_id),reason:String(row.reason),recorded_at:new Date(String(row.created_at)).toISOString(),currency:'IDR',
    budget_state:{version:Number(row.budget_revision),reserved:Number(row.reserved_amount),committed:Number(row.committed_amount)}};
}
export async function writeConfiguration(request:Request,identity:LocalAuth,principal:Principal,scope:string|null,value:unknown){
  const input=configurationInput(value);const promotionId=scope===null?null:id(scope);
  if(promotionId===null&&input.expected_version!==0) throw invalid();
  const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
  const hash=createHash('sha256').update(JSON.stringify({promotionId,input})).digest('hex');
  return identity.sql.begin(async(tx)=>{
    await authority(tx,principal);
    const [prior]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='promotion.configure' and key=${key}`;
    if(prior){if(prior.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return prior.response;}
    const selected=promotionId??randomUUID();
    if(promotionId===null) await tx`insert into app.promotion (id) values (${selected})`;
    await insertVersion(tx,selected,input,principal.id);const response=await readConfiguration(tx,selected);
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
    await authority(tx,principal);
    if(selected&&!history){if(url.search) throw invalid();return readConfiguration(tx,selected);}
    if(selected){if(!(await tx`select id from app.promotion where id=${selected} for share`).length) throw new AccessError(404,'NOT_FOUND');}
    const rows=history?await tx`select v.*,p.reserved_amount,p.committed_amount,p.budget_revision from app.promotion_version v join app.promotion p on p.id=v.promotion_id
      where p.id=${selected} and (${cursor}::int is null or v.revision<${cursor}::int) order by v.revision desc limit ${limit+1}`
      :await tx`select v.*,p.reserved_amount,p.committed_amount,p.budget_revision from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision
        where (${page?.cursor??null}::uuid is null or p.id>${page?.cursor??null}::uuid) order by p.id limit ${(page?.limit??20)+1}`;
    const size=history?limit:page?.limit??20;const data=rows.slice(0,size).map(project);
    return {data,pagination:{next_cursor:rows.length>size?(history?String(data.at(-1)?.version):data.at(-1)?.id):null}};
  });
}
