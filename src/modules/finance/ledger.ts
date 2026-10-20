import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {id,integer,invalid,object,text} from '../catalog/validation.ts';

export type Posting={account:'provider_receivable'|'buyer_funds_liability'|'company_cash'|'settlement_clearing'|'carrier_expense'|'provider_fee_expense'|'refund_payable';side:'debit'|'credit';amount:number};
export type JournalInput={kind:'economic_receipt'|'adjustment'|'reversal'|'settlement_cash'|'settlement_fee'|'settlement_match'|'refund_obligation'|'refund_cash'|'recovery_obligation'|'recovery_cash';source:string;environment:'local'|'test';effect_reference:string;order_id:string|null;reverses_id?:string|null;reason:string;occurred_at:string;postings:Posting[]};
export function financeInstant(value:unknown){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||value.startsWith('0000')||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value) throw invalid();
 return value;
}
export function effectReference(value:unknown){const result=text(value,200);if(!/^[A-Za-z0-9_.:-]{1,200}$/.test(result)) throw invalid();return result;}
export async function readFinanceTransaction(tx:TransactionSql,transactionId:string){
 const [h]=await tx`select id,kind,order_id,reverses_id,occurred_at,recorded_at from app.finance_transaction where id=${id(transactionId)}`;
 if(!h) throw new AccessError(404,'NOT_FOUND');
 const rows=await tx`select account,side,amount from app.finance_posting where transaction_id=${h.id} order by ordinal`;
 return {id:h.id as string,kind:h.kind as string,order_id:h.order_id as string|null,reverses_id:h.reverses_id as string|null,currency:'IDR' as const,
  occurred_at:new Date(h.occurred_at).toISOString(),recorded_at:new Date(h.recorded_at).toISOString(),postings:rows.map(p=>({account:p.account as Posting['account'],side:p.side as Posting['side'],amount:Number(p.amount)}))};
}

// Internal primitive only. The consuming domain owns verified authority and the
// surrounding transaction; no HTTP journal-write endpoint exposes this function.
export async function appendFinanceTransaction(tx:TransactionSql,value:JournalInput){
 const input=object(value,['kind','source','environment','effect_reference','order_id','reverses_id','reason','occurred_at','postings']);
 const source=text(input.source,100);if(!/^[a-z][a-z0-9_.-]{0,99}$/.test(source)||!['local','test'].includes(String(input.environment))||!['economic_receipt','adjustment','reversal','settlement_cash','settlement_fee','settlement_match','refund_obligation','refund_cash','recovery_obligation','recovery_cash'].includes(String(input.kind))) throw invalid();
 if(!Array.isArray(input.postings)||input.postings.length<2||input.postings.length>100) throw invalid();
 const postings=input.postings.map(p=>{const line=object(p,['account','side','amount']);if(!['provider_receivable','buyer_funds_liability','company_cash','settlement_clearing','carrier_expense','provider_fee_expense','refund_payable'].includes(String(line.account))||!['debit','credit'].includes(String(line.side))) throw invalid();return {account:line.account as Posting['account'],side:line.side as Posting['side'],amount:integer(line.amount,1,Number.MAX_SAFE_INTEGER)};});
 const debit=postings.filter(p=>p.side==='debit').reduce((n,p)=>n+BigInt(p.amount),0n),credit=postings.filter(p=>p.side==='credit').reduce((n,p)=>n+BigInt(p.amount),0n);
 if(debit!==credit||debit>BigInt(Number.MAX_SAFE_INTEGER)) throw new AccessError(422,'UNBALANCED_JOURNAL');
 const normalized={kind:String(input.kind),source,environment:String(input.environment),effect_reference:effectReference(input.effect_reference),order_id:input.order_id===null?null:id(input.order_id),reverses_id:input.reverses_id==null?null:id(input.reverses_id),reason:text(input.reason,500),occurred_at:financeInstant(input.occurred_at),postings};
 if((normalized.kind==='reversal')!==(normalized.reverses_id!==null)) throw invalid();
 const hash=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
 let inserted:{id:string;request_hash:string}|undefined;
 try{[inserted]=await tx<{id:string;request_hash:string}[]>`insert into app.finance_transaction (kind,source,environment,effect_reference,request_hash,order_id,reverses_id,reason,occurred_at)
  values (${normalized.kind},${source},${normalized.environment},${normalized.effect_reference},${hash},${normalized.order_id},${normalized.reverses_id},${normalized.reason},${normalized.occurred_at})
  on conflict (source,environment,effect_reference) do nothing returning id,request_hash`;
 }catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code==='23505') throw new AccessError(409,'JOURNAL_ALREADY_REVERSED');throw error;}
 const [stored]=inserted?[inserted]:await tx`select id,request_hash from app.finance_transaction where source=${source} and environment=${normalized.environment} and effect_reference=${normalized.effect_reference}`;
 if(!stored||stored.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');
 if(inserted) for(const [index,p] of postings.entries()) await tx`insert into app.finance_posting (transaction_id,ordinal,account,side,amount) values (${stored.id},${index+1},${p.account},${p.side},${p.amount})`;
 return readFinanceTransaction(tx,stored.id);
}

export async function reverseFinanceTransaction(tx:TransactionSql,originalId:string,input:Pick<JournalInput,'source'|'environment'|'effect_reference'|'reason'|'occurred_at'>){
 const original=await readFinanceTransaction(tx,originalId);if(original.kind==='reversal'||Date.parse(financeInstant(input.occurred_at))<Date.parse(original.occurred_at)) throw invalid();
 return appendFinanceTransaction(tx,{...input,kind:'reversal',order_id:original.order_id,reverses_id:original.id,postings:original.postings.map(p=>({...p,side:p.side==='debit'?'credit':'debit'}))});
}
