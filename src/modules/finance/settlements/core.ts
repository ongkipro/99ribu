import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {AccessError} from '../../access/policy.ts';
import {id,object} from '../../catalog/validation.ts';
import {appendFinanceTransaction,reverseFinanceTransaction,type Posting} from '../ledger.ts';
import {allocateSettlement,settlementClaims} from './allocation.ts';
import {readSettlementSourceEvent,verifySettlementEvent,type SettlementSourceEvent} from './local.ts';
import {lockVerifiedReceivables} from './receivables.ts';

export type SettlementHead={id:string;operation_id:string;cash_transaction_id:string|null;fee_transaction_id:string|null;applied_fee_statement_id:string|null;current_statement_id:string;current_match_id:string|null;last_match_id:string|null;revision:number;status:string;problem_code:string|null};
export type SettlementCause={source_kind:'provider'|'operation';source_id:string;actor_id:string|null;reason:string;occurred_at:string};
type Fees={fee_transaction_id:string|null;applied_fee_statement_id:string|null;problem:string|null};

export async function settlementClock(tx:TransactionSql,clockNamespace:string|null){const [clock]=await tx`select app.reservation_clock(${clockNamespace}) now`;return new Date(clock.now).toISOString();}
async function lockSettlementParents(tx:TransactionSql,head:SettlementHead,source:SettlementSourceEvent){
 if(source.direction!=='debit')return;
 // Lock every relevant credited bank root before original receivable journals.
 // A child unmatch still retains fees whose final seal needs its parent root.
 await tx`select parent.id from app.local_settlement_operation parent where parent.provider=${source.provider} and parent.environment=${source.environment} and parent.direction='credit'
  and parent.reference in (select s.reverses_reference from app.local_settlement_statement s where s.operation_id=${source.operation_id}
   and (s.id=${source.statement_id} or s.id=${head.current_statement_id} or s.id=${head.applied_fee_statement_id}
    or s.id=(select statement_id from app.settlement_match where id=${head.current_match_id})
    or s.revision=(select max(revision) from app.local_settlement_statement where operation_id=${source.operation_id})))
  order by parent.id for update`;
}
export async function lockSettlement(tx:TransactionSql,settlementId:string){
 const [before]=await tx`select operation_id from app.provider_settlement where id=${id(settlementId)}`;if(!before)throw new AccessError(404,'NOT_FOUND');
 await tx`select id from app.local_settlement_operation where id=${before.operation_id} for update`;
 const [head]=await tx<SettlementHead[]>`select * from app.provider_settlement where id=${settlementId} for update`;
 const [delivery]=await tx`select id from app.local_settlement_event where statement_id=${head.current_statement_id} order by recorded_at,id limit 1`;
 const source=delivery?await readSettlementSourceEvent(tx,delivery.id):null;if(!source)throw new AccessError(409,'SETTLEMENT_SOURCE_INCOMPLETE');
 const verified=verifySettlementEvent(source);await lockSettlementParents(tx,head,verified);return {head,source:verified};
}
export async function applySettlementFees(tx:TransactionSql,head:SettlementHead,source:SettlementSourceEvent,cause:SettlementCause,correcting=false):Promise<Fees>{
 const preserve={fee_transaction_id:head.fee_transaction_id,applied_fee_statement_id:head.applied_fee_statement_id};
 const s=source.statement;
 if(s.gross_amount===null||s.carrier_fee===null||s.provider_fee===null)return {...preserve,problem:'SETTLEMENT_STATEMENT_INCOMPLETE'};
 if(BigInt(s.gross_amount)!==BigInt(source.net_amount)+BigInt(s.carrier_fee)+BigInt(s.provider_fee))return {...preserve,problem:'SETTLEMENT_TOTAL_MISMATCH'};
 const [old]=head.applied_fee_statement_id?await tx`select carrier_fee,provider_fee from app.local_settlement_statement where id=${head.applied_fee_statement_id}`:[];
 const changed=old&&(Number(old.carrier_fee)!==s.carrier_fee||Number(old.provider_fee)!==s.provider_fee);
 if(changed&&head.current_match_id&&!correcting)return {...preserve,problem:'SETTLEMENT_FEE_CORRECTION_REQUIRED'};
 if(changed&&source.direction==='credit'){
  const [dependent]=await tx`select child.id from app.provider_settlement child join app.local_settlement_operation o on o.id=child.operation_id join app.local_settlement_statement statement on statement.id=child.applied_fee_statement_id
   where o.provider=${source.provider} and o.environment=${source.environment} and o.direction='debit' and statement.reverses_reference=${source.reference} limit 1`;
  if(dependent)return {...preserve,problem:'SETTLEMENT_DEPENDENT_REVERSAL'};
 }
 const [basis]=await tx`select app.settlement_fee_basis_problem(${source.statement_id}) problem`;if(basis.problem)return {...preserve,problem:String(basis.problem)};
 if(old&&!changed)return {...preserve,applied_fee_statement_id:source.statement_id,problem:null};
 if(head.fee_transaction_id)await reverseFinanceTransaction(tx,head.fee_transaction_id,{source:'local.settlement',environment:source.environment,effect_reference:`fee-reversal:${cause.source_id}:${head.fee_transaction_id}`,reason:cause.reason,occurred_at:cause.occurred_at});
 let journalId:string|null=null;
 if(s.carrier_fee+s.provider_fee>0){
  const side:Posting['side']=source.direction==='credit'?'debit':'credit',postings:Posting[]=[];
  if(s.carrier_fee)postings.push({account:'carrier_expense',side,amount:s.carrier_fee});if(s.provider_fee)postings.push({account:'provider_fee_expense',side,amount:s.provider_fee});
  postings.push({account:'settlement_clearing',side:side==='debit'?'credit':'debit',amount:s.carrier_fee+s.provider_fee});
  journalId=(await appendFinanceTransaction(tx,{kind:'settlement_fee',source:'local.settlement',environment:source.environment,effect_reference:`fee:${source.statement_id}:${cause.source_id}`,order_id:null,reason:cause.reason,occurred_at:source.occurred_at,postings})).id;
 }
 return {fee_transaction_id:journalId,applied_fee_statement_id:source.statement_id,problem:null};
}
export async function createSettlementMatch(tx:TransactionSql,head:SettlementHead,source:SettlementSourceEvent,lines:unknown,cause:SettlementCause){
 const {gross_amount,carrier_fee,provider_fee}=source.statement;
 const plan=allocateSettlement(source.net_amount,{gross_amount,carrier_fee,provider_fee},lines),verified=await lockVerifiedReceivables(tx,source,[...new Set(plan.allocations.map(a=>a.receivable_transaction_id))]);
 for(const a of plan.allocations){
  const original=verified.get(a.receivable_transaction_id);if(!original)throw new AccessError(409,'SETTLEMENT_RECEIVABLE_UNVERIFIED');
  const [used]=await tx`select coalesce(sum(case o.direction when 'credit' then a.gross_amount::numeric else -a.gross_amount::numeric end),0)::text gross
   from app.settlement_allocation a join app.settlement_match m on m.id=a.match_id join app.provider_settlement p on p.id=m.settlement_id join app.local_settlement_operation o on o.id=p.operation_id
   where a.receivable_transaction_id=${original.transaction_id} and m.reversal_transaction_id is null`;
  if(source.direction==='credit'){
   if(a.reopens_allocation_id!==null||source.statement.reverses_reference!==null)throw new AccessError(409,'SETTLEMENT_REVERSAL_BASIS_INVALID');
   if(BigInt(used.gross)+BigInt(a.gross_amount)>BigInt(original.gross_amount))throw new AccessError(409,'SETTLEMENT_RECEIVABLE_EXCEEDED');
  }else{
   if(a.reopens_allocation_id===null)throw new AccessError(409,'SETTLEMENT_REVERSAL_BASIS_UNKNOWN');
   const [parent]=await tx`select a.*,m.reversal_transaction_id,o.reference,o.provider,o.environment,o.direction,o.occurred_at bank_time from app.settlement_allocation a
    join app.settlement_match m on m.id=a.match_id join app.provider_settlement p on p.id=m.settlement_id join app.local_settlement_operation o on o.id=p.operation_id where a.id=${a.reopens_allocation_id}`;
   if(!parent||parent.reopens_allocation_id!==null||parent.reversal_transaction_id!==null||parent.receivable_transaction_id!==original.transaction_id||parent.direction!=='credit'
    ||parent.provider!==source.provider||parent.environment!==source.environment||parent.reference!==source.statement.reverses_reference||new Date(parent.bank_time).getTime()>Date.parse(source.occurred_at))throw new AccessError(409,'SETTLEMENT_REVERSAL_BASIS_INVALID');
   const [reopened]=await tx`select coalesce(sum(a.gross_amount),0)::text gross_amount,coalesce(sum(a.net_amount),0)::text net_amount,coalesce(sum(a.carrier_fee),0)::text carrier_fee,coalesce(sum(a.provider_fee),0)::text provider_fee
    from app.settlement_allocation a join app.settlement_match m on m.id=a.match_id where a.reopens_allocation_id=${parent.id} and m.reversal_transaction_id is null`;
   for(const key of ['gross_amount','net_amount','carrier_fee','provider_fee'] as const)if(BigInt(reopened[key])+BigInt(a[key])>BigInt(parent[key]))throw new AccessError(409,'SETTLEMENT_REVERSAL_EXCEEDED');
   if(BigInt(used.gross)-BigInt(a.gross_amount)<0n)throw new AccessError(409,'SETTLEMENT_REVERSAL_EXCEEDED');
  }
 }
 const matchId=randomUUID(),gross=plan.allocations.reduce((sum,a)=>sum+a.gross_amount,0),clearingSide=source.direction==='credit'?'debit':'credit';
 const journal=await appendFinanceTransaction(tx,{kind:'settlement_match',source:'local.settlement',environment:source.environment,effect_reference:`match:${matchId}`,order_id:null,reason:cause.reason,occurred_at:cause.occurred_at,postings:[{account:'settlement_clearing',side:clearingSide,amount:gross},{account:'provider_receivable',side:clearingSide==='debit'?'credit':'debit',amount:gross}]});
 await tx`insert into app.settlement_match (id,settlement_id,statement_id,transaction_id,source_kind,source_id,actor_id,correction_of,reason,occurred_at)
  values (${matchId},${head.id},${source.statement_id},${journal.id},${cause.source_kind},${cause.source_id},${cause.actor_id},${head.last_match_id},${cause.reason},${cause.occurred_at})`;
 for(const [index,a] of plan.allocations.entries()){
  const original=verified.get(a.receivable_transaction_id);if(!original)throw new AccessError(409,'SETTLEMENT_RECEIVABLE_UNVERIFIED');
  await tx`insert into app.settlement_allocation (match_id,ordinal,receivable_transaction_id,order_id,receipt_id,source_basis,gross_amount,net_amount,carrier_fee,provider_fee,reopens_allocation_id)
   values (${matchId},${index+1},${original.transaction_id},${original.order_id},${original.receipt_id},${original.source_basis},${a.gross_amount},${a.net_amount},${a.carrier_fee},${a.provider_fee},${a.reopens_allocation_id})`;
 }
 for(const original of verified.values())await tx`select app.assert_settlement_receivable(${original.transaction_id})`;
 return {match_id:matchId,transaction_id:journal.id,status:plan.remaining.gross_amount===0?'matched':'partial',remaining:plan.remaining};
}
export async function reverseSettlementMatch(tx:TransactionSql,head:SettlementHead,source:SettlementSourceEvent,cause:SettlementCause){
 if(!head.current_match_id)throw new AccessError(409,'SETTLEMENT_MATCH_NOT_ACTIVE');
 const [match]=await tx`select * from app.settlement_match where id=${head.current_match_id}`;if(!match||match.reversal_transaction_id)throw new AccessError(409,'SETTLEMENT_MATCH_NOT_ACTIVE');
 const [dependent]=await tx`select child.id from app.settlement_allocation original join app.settlement_allocation child on child.reopens_allocation_id=original.id join app.settlement_match m on m.id=child.match_id
  where original.match_id=${match.id} and m.reversal_transaction_id is null limit 1`;if(dependent)throw new AccessError(409,'SETTLEMENT_DEPENDENT_REVERSAL');
 const journal=await reverseFinanceTransaction(tx,match.transaction_id,{source:'local.settlement',environment:source.environment,effect_reference:`match-reversal:${cause.source_id}:${match.id}`,reason:cause.reason,occurred_at:cause.occurred_at});
 await tx`update app.settlement_match set reversal_transaction_id=${journal.id},reversed_by_operation_id=${cause.source_id} where id=${match.id}`;
}
export async function advanceSettlement(tx:TransactionSql,head:SettlementHead,source:SettlementSourceEvent,cause:SettlementCause,change:{kind:'observe'|'statement'|'match'|'unmatch'|'escalate';cash_transaction_id?:string|null;fee_transaction_id:string|null;applied_fee_statement_id:string|null;match_id:string|null;status:string;problem:string|null}){
 const revision=head.revision+1,eventId=randomUUID(),last=change.match_id??head.current_match_id??head.last_match_id;
 await tx`insert into app.settlement_event (id,settlement_id,revision,status,kind,source_kind,source_id,actor_id,statement_id,match_id,fee_transaction_id,applied_fee_statement_id,problem_code,reason,occurred_at)
  values (${eventId},${head.id},${revision},${change.status},${change.kind},${cause.source_kind},${cause.source_id},${cause.actor_id},${source.statement_id},${change.match_id},${change.fee_transaction_id},${change.applied_fee_statement_id},${change.problem},${cause.reason},${cause.occurred_at})`;
 await tx`update app.provider_settlement set revision=${revision},status=${change.status},current_statement_id=${source.statement_id},current_match_id=${change.match_id},last_match_id=${last},cash_transaction_id=${change.cash_transaction_id??head.cash_transaction_id},fee_transaction_id=${change.fee_transaction_id},applied_fee_statement_id=${change.applied_fee_statement_id},problem_code=${change.problem} where id=${head.id}`;
 return {event_id:eventId,id:head.id,version:revision,status:change.status};
}
export async function processSettlementEvent(tx:TransactionSql,job:{id:string;payload:unknown}){
 const input=object(job.payload,['eventId']),eventId=id(input.eventId),[registered]=await tx`select * from app.settlement_provider_event where id=${eventId} and callback_job_id=${job.id}`;
 if(!registered)throw new AccessError(400,'INVALID_SETTLEMENT_JOB');
 await tx`select id from app.local_settlement_operation where id=${registered.operation_id} for update`;
 const raw=await readSettlementSourceEvent(tx,eventId);if(!raw)throw new AccessError(400,'INVALID_SETTLEMENT_JOB');const source=verifySettlementEvent(raw);
 const [prior]=await tx`select outcome,settlement_id,head_revision from app.settlement_event_result where event_id=${eventId}`;if(prior)return {event_id:eventId,outcome:String(prior.outcome),settlement_id:String(prior.settlement_id),version:Number(prior.head_revision)};
 let [head]=await tx<SettlementHead[]>`select * from app.provider_settlement where operation_id=${source.operation_id} for update`;
 let eventReference:string|null=null,outcome='unmatched',observedRevision=head?.revision??0;
 if(head){
  const [current]=await tx`select revision from app.local_settlement_statement where id=${head.current_statement_id}`;
  if(Number(current.revision)>=source.statement_revision){outcome=Number(current.revision)>source.statement_revision?'older':'duplicate';}
 }
 if(!head||!['older','duplicate'].includes(outcome)){
  if(!head)[head]=await tx<SettlementHead[]>`insert into app.provider_settlement (operation_id,current_statement_id,created_at) values (${source.operation_id},${source.statement_id},${source.occurred_at}) returning *`;
  await lockSettlementParents(tx,head,source);
  const cause:SettlementCause={source_kind:'provider',source_id:eventId,actor_id:null,reason:'Authenticated local provider remittance statement',occurred_at:source.source_reported_at};
  let cash=head.cash_transaction_id;
  if(head.revision===0&&source.net_amount>0){const side:Posting['side']=source.direction==='credit'?'debit':'credit';cash=(await appendFinanceTransaction(tx,{kind:'settlement_cash',source:'local.settlement',environment:source.environment,effect_reference:`cash:${source.operation_id}`,order_id:null,reason:cause.reason,occurred_at:source.occurred_at,postings:[{account:'company_cash',side,amount:source.net_amount},{account:'settlement_clearing',side:side==='debit'?'credit':'debit',amount:source.net_amount}]})).id;}
  const fees=await applySettlementFees(tx,head,source,cause);let problem=fees.problem,status=head.current_match_id?'exception':'pending',matchId=head.current_match_id;
  let advanced:Awaited<ReturnType<typeof advanceSettlement>>|null=null;
  if(!problem&&head.current_match_id)problem='SETTLEMENT_STATEMENT_CHANGED';
  if(!problem&&head.last_match_id)problem='SETTLEMENT_MANUAL_REVIEW_REQUIRED';
  if(!problem){
   if(source.statement.allocation_claims===null||source.statement.allocation_claims.length===0)problem='SETTLEMENT_REFERENCES_UNKNOWN';
   else{
    try{
     const matched=await tx.savepoint(async inner=>{
      const match=await createSettlementMatch(inner,head,source,settlementClaims(source.statement.allocation_claims),cause);
      const transition=await advanceSettlement(inner,head,source,cause,{kind:head.revision===0?'observe':'statement',cash_transaction_id:cash,fee_transaction_id:fees.fee_transaction_id,applied_fee_statement_id:fees.applied_fee_statement_id,match_id:match.match_id,status:match.status,problem:null});
      // Validate native matching inside its recoverable savepoint. Authentic
      // cash/fees outside it survive a classification invariant rejection.
      await inner`select app.assert_settlement_journal(${match.transaction_id})`;
      return {...match,transition};
     });matchId=matched.match_id;status=matched.status;advanced=matched.transition;
    }catch(error){
     if(error instanceof AccessError){problem=error.code;status=error.status===401?'exception':'mismatched';}
     else if(error&&typeof error==='object'&&'code' in error&&error.code==='23514'){problem='SETTLEMENT_NATIVE_MATCH_REVIEW_REQUIRED';status='exception';}
     else throw error;
    }
   }
  }
  if(problem&&status!=='mismatched'&&status!=='exception'&&!['SETTLEMENT_STATEMENT_INCOMPLETE','SETTLEMENT_REFERENCES_UNKNOWN'].includes(problem))status='exception';
  advanced??=await advanceSettlement(tx,head,source,cause,{kind:head.revision===0?'observe':'statement',cash_transaction_id:cash,fee_transaction_id:fees.fee_transaction_id,applied_fee_statement_id:fees.applied_fee_statement_id,match_id:matchId,status,problem});
  eventReference=advanced.event_id;observedRevision=advanced.version;outcome=status==='matched'?'matched':status==='partial'?'partial':status==='pending'?'unmatched':'exception';
 }
 await tx`insert into app.settlement_event_result (event_id,settlement_id,head_revision,outcome,settlement_event_id) values (${eventId},${head.id},${observedRevision},${outcome},${eventReference})`;
 return {event_id:eventId,outcome,settlement_id:head.id,version:observedRevision};
}
