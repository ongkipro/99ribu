import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../../access/auth.ts';
import {AccessError,type Principal} from '../../access/policy.ts';
import {id,integer,invalid} from '../../catalog/validation.ts';
import {effectReference} from '../ledger.ts';
import {financeAuthority} from '../costs.ts';

const nullableNumber=(value:unknown)=>value===null?null:Number(value);
const nullableId=(value:unknown)=>value===null?null:String(value);
const iso=(value:unknown)=>new Date(value as string).toISOString();
function statement(row:Record<string,unknown>){return {id:String(row.id),version:Number(row.revision),totals:{gross_amount:nullableNumber(row.gross_amount),carrier_fee:nullableNumber(row.carrier_fee),provider_fee:nullableNumber(row.provider_fee)},allocation_claims:row.allocation_claims,reverses_reference:nullableId(row.reverses_reference),reported_at:iso(row.source_reported_at),recorded_at:iso(row.recorded_at)};}
function item(row:Record<string,unknown>){
 return {id:String(row.id),provider:String(row.provider),environment:String(row.environment),reference:String(row.reference),direction:String(row.direction),amount:Number(row.net_amount),currency:'IDR' as const,version:Number(row.revision),status:String(row.status),problem_code:nullableId(row.problem_code),explanation:String(row.reason),source_id:String(row.operation_id),source_reference:String(row.current_statement_id),source_version:Number(row.source_revision),latest_source_reference:String(row.latest_source_id),latest_source_version:Number(row.latest_source_revision),source_processing_pending:row.latest_source_id!==row.current_statement_id,current_match_id:nullableId(row.current_match_id),last_match_id:nullableId(row.last_match_id),cash_transaction_id:nullableId(row.cash_transaction_id),fee_transaction_id:nullableId(row.fee_transaction_id),statement_totals:{gross_amount:nullableNumber(row.gross_amount),carrier_fee:nullableNumber(row.carrier_fee),provider_fee:nullableNumber(row.provider_fee)},recorded_fees:row.applied_fee_statement_id===null?null:{source_reference:String(row.applied_fee_statement_id),carrier_fee:Number(row.applied_carrier_fee),provider_fee:Number(row.applied_provider_fee)},occurred_at:iso(row.occurred_at),recorded_at:iso(row.recorded_at)};
}
function itemQuery(tx:TransactionSql){return tx`select p.*,o.provider,o.environment,o.reference,o.direction,o.net_amount,o.occurred_at,s.revision source_revision,s.gross_amount,s.carrier_fee,s.provider_fee,e.reason,
 applied.carrier_fee applied_carrier_fee,applied.provider_fee applied_provider_fee,latest.id latest_source_id,latest.revision latest_source_revision
 from app.provider_settlement p join app.local_settlement_operation o on o.id=p.operation_id join app.local_settlement_statement s on s.id=p.current_statement_id
 join app.settlement_event e on e.settlement_id=p.id and e.revision=p.revision left join app.local_settlement_statement applied on applied.id=p.applied_fee_statement_id
 join lateral (select id,revision from app.local_settlement_statement where operation_id=o.id order by revision desc limit 1) latest on true`;}
export async function projectSettlementItem(tx:TransactionSql,settlementId:string){const [row]=await tx`${itemQuery(tx)} where p.id=${id(settlementId)}`;if(!row)throw new AccessError(404,'NOT_FOUND');return item(row);}
async function readLock(tx:TransactionSql,principal:Principal,settlementId:string){
 await financeAuthority(tx,principal,'finance.reconciliation.read');const selected=id(settlementId),[before]=await tx`select operation_id from app.provider_settlement where id=${selected}`;if(!before)throw new AccessError(404,'NOT_FOUND');
 await tx`select id from app.local_settlement_operation where id=${before.operation_id} for share`;await tx`select id from app.provider_settlement where id=${selected} for share`;
 await financeAuthority(tx,principal,'finance.reconciliation.read');return selected;
}
export async function projectSettlementMatch(tx:TransactionSql,settlementId:string,matchId:string){
 const [m]=await tx`select m.*,s.gross_amount,s.carrier_fee,s.provider_fee,o.net_amount from app.settlement_match m join app.provider_settlement p on p.id=m.settlement_id
  join app.local_settlement_operation o on o.id=p.operation_id join app.local_settlement_statement s on s.id=m.statement_id where m.id=${id(matchId)} and m.settlement_id=${id(settlementId)}`;
 if(!m)throw new AccessError(404,'NOT_FOUND');
 const rows=await tx`select * from app.settlement_allocation where match_id=${m.id} order by ordinal`;
 const totals={gross_amount:Number(m.gross_amount),net_amount:Number(m.net_amount),carrier_fee:Number(m.carrier_fee),provider_fee:Number(m.provider_fee)},remaining={...totals};
 for(const key of ['gross_amount','net_amount','carrier_fee','provider_fee'] as const)remaining[key]=Number(BigInt(totals[key])-rows.reduce((sum,row)=>sum+BigInt(row[key]),0n));
 return {id:String(m.id),statement_id:String(m.statement_id),transaction_id:String(m.transaction_id),active:m.reversal_transaction_id===null,correction_of:nullableId(m.correction_of),reversal_transaction_id:nullableId(m.reversal_transaction_id),reason:String(m.reason),occurred_at:iso(m.occurred_at),recorded_at:iso(m.recorded_at),totals,remaining,allocations:rows.map(a=>({id:String(a.id),receivable_transaction_id:String(a.receivable_transaction_id),order_id:String(a.order_id),receipt_id:nullableId(a.receipt_id),source_basis:String(a.source_basis),gross_amount:Number(a.gross_amount),net_amount:Number(a.net_amount),carrier_fee:Number(a.carrier_fee),provider_fee:Number(a.provider_fee),reopens_allocation_id:nullableId(a.reopens_allocation_id)}))};
}
function page(url:URL,cursorName:string,fields:readonly string[]){
 for(const key of url.searchParams.keys())if(!fields.includes(key)||url.searchParams.getAll(key).length!==1)throw invalid();
 const raw=url.searchParams.get('limit')??'20';if(!/^\d{1,3}$/.test(raw))throw invalid();const limit=integer(Number(raw),1,100),cursor=url.searchParams.get(cursorName);
 if(cursor!==null&&!/^[1-9]\d{0,9}$/.test(cursor))throw invalid();return {limit,before:cursor===null?null:integer(Number(cursor),1)};
}
export async function listReconciliations(identity:LocalAuth,principal:Principal,url:URL){
 const allowed=['limit','cursor','status','provider','reference'];for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)throw invalid();
 const raw=url.searchParams.get('limit')??'20';if(!/^\d{1,3}$/.test(raw))throw invalid();const limit=integer(Number(raw),1,100),cursor=url.searchParams.has('cursor')?id(url.searchParams.get('cursor')):null,status=url.searchParams.get('status'),provider=url.searchParams.get('provider'),reference=url.searchParams.has('reference')?effectReference(url.searchParams.get('reference')):null;
 if(status!==null&&!['pending','partial','matched','mismatched','exception'].includes(status)||provider!==null&&!['local.payment','local.cod'].includes(provider))throw invalid();
 return identity.sql.begin(async tx=>{
  await financeAuthority(tx,principal,'finance.reconciliation.read');const [position]=cursor?await tx`select recorded_at::text recorded_at,id from app.provider_settlement where id=${cursor}`:[];if(cursor&&!position)throw invalid();
  const rows=await tx`${itemQuery(tx)} where (${status}::text is null or p.status=${status}) and (${provider}::text is null or o.provider=${provider}) and (${reference}::text is null or o.reference=${reference})
   and (${cursor}::uuid is null or (p.recorded_at,p.id)<(${position?.recorded_at??null}::timestamptz,${cursor}::uuid)) order by p.recorded_at desc,p.id desc limit ${limit+1}`;
  const chosen=rows.slice(0,limit);return {data:chosen.map(item),pagination:{next_cursor:rows.length>limit?String(chosen.at(-1)?.id):null}};
 });
}
export async function readReconciliation(identity:LocalAuth,principal:Principal,settlementId:string,url:URL){
 const paging=page(url,'history_before',['limit','history_before']);return identity.sql.begin(async tx=>{
  const selected=await readLock(tx,principal,settlementId),summary=await projectSettlementItem(tx,selected),[current]=await tx`select * from app.local_settlement_statement where id=${summary.source_reference}`;
  const history=await tx`select * from app.settlement_event where settlement_id=${selected} and (${paging.before}::int is null or revision<${paging.before}) order by revision desc limit ${paging.limit+1}`;
  const chosen=history.slice(0,paging.limit);
  return {item:summary,statement:statement(current),match:summary.current_match_id?await projectSettlementMatch(tx,selected,summary.current_match_id):null,history:chosen.map(e=>({id:String(e.id),version:Number(e.revision),kind:String(e.kind),status:String(e.status),source_kind:String(e.source_kind),source_id:String(e.source_id),actor_id:nullableId(e.actor_id),source_reference:String(e.statement_id),match_id:nullableId(e.match_id),fee_transaction_id:nullableId(e.fee_transaction_id),applied_fee_source_reference:nullableId(e.applied_fee_statement_id),problem_code:nullableId(e.problem_code),reason:String(e.reason),occurred_at:iso(e.occurred_at),recorded_at:iso(e.recorded_at)})),pagination:{next_cursor:history.length>paging.limit?String(chosen.at(-1)?.revision):null}};
 });
}
export async function readReconciliationMatch(identity:LocalAuth,principal:Principal,settlementId:string,matchId:string){return identity.sql.begin(async tx=>{const selected=await readLock(tx,principal,settlementId);return projectSettlementMatch(tx,selected,matchId);});}
export async function readSettlementSource(identity:LocalAuth,principal:Principal,operationId:string,url:URL){
 const selected=id(operationId),paging=page(url,'before',['limit','before']);return identity.sql.begin(async tx=>{
  await financeAuthority(tx,principal,'finance.reconciliation.read');const [o]=await tx`select * from app.local_settlement_operation where id=${selected} for share`;if(!o)throw new AccessError(404,'NOT_FOUND');await financeAuthority(tx,principal,'finance.reconciliation.read');
  const [head]=await tx`select id from app.provider_settlement where operation_id=${selected}`,rows=await tx`select * from app.local_settlement_statement where operation_id=${selected} and (${paging.before}::int is null or revision<${paging.before}) order by revision desc limit ${paging.limit+1}`,chosen=rows.slice(0,paging.limit);
  const [unregistered]=await tx`select count(*)::int n from app.local_settlement_event e join app.local_settlement_statement s on s.id=e.statement_id left join app.settlement_provider_event registered on registered.id=e.id where s.operation_id=${selected} and registered.id is null`;
  return {source:{id:String(o.id),provider:String(o.provider),environment:String(o.environment),reference:String(o.reference),direction:String(o.direction),amount:Number(o.net_amount),currency:'IDR' as const,occurred_at:iso(o.occurred_at),recorded_at:iso(o.recorded_at)},item:head?await projectSettlementItem(tx,head.id):null,statements:chosen.map(statement),pagination:{next_cursor:rows.length>paging.limit?String(chosen.at(-1)?.revision):null},unregistered_deliveries:Number(unregistered.n)};
 });
}

