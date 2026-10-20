import type {TransactionSql} from 'postgres';
import {AccessError} from '../../access/policy.ts';
import {array,id,invalid} from '../../catalog/validation.ts';
import {verifyProviderEvent} from '../../payments/local.ts';
import {verifyCodEvent} from '../../payments/cod-local.ts';
import {financeInstant} from '../ledger.ts';
import type {SettlementSourceEvent} from './local.ts';

type Context=Pick<SettlementSourceEvent,'provider'|'environment'|'occurred_at'|'clock_namespace'>;
export type VerifiedReceivable={transaction_id:string;order_id:string;receipt_id:string|null;source_basis:'qualified'|'recovery';gross_amount:number;occurred_at:string;clock_namespace:string|null};

// Lock original journals in stable order before reading reversal/capacity facts.
// A balanced internal primitive alone is not authenticated collection evidence.
export async function lockVerifiedReceivables(tx:TransactionSql,context:Context,transactionIds:unknown){
 const ids=array(transactionIds,id,1,100).sort();if(new Set(ids).size!==ids.length)throw invalid();
 if(!['local.payment','local.cod'].includes(context.provider)||!['local','test'].includes(context.environment))throw invalid();financeInstant(context.occurred_at);
 const headers=await tx`select h.*,o.clock_namespace from app.finance_transaction h join app.commerce_order o on o.id=h.order_id where h.id in ${tx(ids)} order by h.id for update of h`;
 if(headers.length!==ids.length)throw new AccessError(409,'SETTLEMENT_RECEIVABLE_UNVERIFIED');
 const reversals=await tx`select reverses_id from app.finance_transaction where reverses_id in ${tx(ids)}`;
 if(reversals.length)throw new AccessError(409,'SETTLEMENT_RECEIVABLE_REVERSED');
 const postings=await tx`select transaction_id,account,side,amount from app.finance_posting where transaction_id in ${tx(ids)} order by transaction_id,ordinal`;
 const evidence=await tx`select r.transaction_id,r.receipt_id,r.outcome,e.id event_id,e.operation_id,e.status,e.amount,e.occurred_at,e.signature,p.environment,p.attempt_id,a.order_id,null::uuid shipment_id,'local.payment' provider
  from app.payment_event_result r join app.local_payment_event e on e.id=r.event_id join app.local_payment_operation p on p.id=e.operation_id join app.payment_attempt a on a.id=p.attempt_id
  where r.transaction_id in ${tx(ids)} and r.outcome in ('confirmed','recovery')
  union all
  select r.transaction_id,r.receipt_id,r.outcome,e.id,e.operation_id,e.status,e.amount,e.occurred_at,e.signature,p.environment,null::uuid,s.order_id,p.shipment_id,'local.cod'
  from app.cod_event_result r join app.local_cod_event e on e.id=r.event_id join app.local_cod_operation p on p.id=e.operation_id join app.order_shipment s on s.id=p.shipment_id
  where r.transaction_id in ${tx(ids)} and r.outcome in ('collected','recovery')`;
 const receipts=await tx`select * from app.economic_receipt where transaction_id in ${tx(ids)}`;
 const result=new Map<string,VerifiedReceivable>();
 for(const h of headers){
  const candidates=evidence.filter(e=>e.transaction_id===h.id),lines=postings.filter(p=>p.transaction_id===h.id),receipt=receipts.find(r=>r.transaction_id===h.id);
  if(candidates.length!==1||lines.length!==2)throw new AccessError(409,'SETTLEMENT_RECEIVABLE_UNVERIFIED');
  const e=candidates[0],qualified=receipt!==undefined;
  if(e.provider!==context.provider||e.environment!==context.environment||h.environment!==context.environment||h.order_id!==e.order_id||
   h.source!==(qualified?context.provider:`${context.provider}.recovery`)||h.kind!==(qualified?'economic_receipt':'adjustment')||
   h.effect_reference!==e.operation_id||new Date(h.occurred_at).toISOString()!==new Date(e.occurred_at).toISOString()||
   (qualified?(e.receipt_id!==receipt.id||receipt.event_id!==e.event_id||Number(receipt.amount)!==Number(e.amount)):(e.receipt_id!==null||e.outcome!=='recovery'))||
   !lines.some(p=>p.account==='provider_receivable'&&p.side==='debit'&&Number(p.amount)===Number(e.amount))||
   !lines.some(p=>p.account==='buyer_funds_liability'&&p.side==='credit'&&Number(p.amount)===Number(e.amount)))throw new AccessError(409,'SETTLEMENT_RECEIVABLE_UNVERIFIED');
  const occurred=new Date(e.occurred_at).toISOString();
  if(Date.parse(occurred)>Date.parse(context.occurred_at))throw new AccessError(409,'SETTLEMENT_PRECEDES_COLLECTION');
  if(context.clock_namespace!==null&&h.clock_namespace!==context.clock_namespace)throw new AccessError(409,'SETTLEMENT_CLOCK_CONTEXT_MISMATCH');
  // Recheck the actual collection signature, including recovery funds; database
  // relational consistency cannot authenticate a forged local source signature.
  if(context.provider==='local.payment')verifyProviderEvent({id:e.event_id,operation_id:e.operation_id,attempt_id:e.attempt_id,environment:e.environment,status:e.status,amount:Number(e.amount),currency:'IDR',occurred_at:occurred,signature:e.signature});
  else verifyCodEvent({id:e.event_id,operation_id:e.operation_id,shipment_id:e.shipment_id,environment:e.environment,status:e.status,amount:Number(e.amount),currency:'IDR',occurred_at:occurred,signature:e.signature});
  result.set(String(h.id),{transaction_id:String(h.id),order_id:String(h.order_id),receipt_id:qualified?String(receipt.id):null,source_basis:qualified?'qualified':'recovery',gross_amount:Number(e.amount),occurred_at:occurred,clock_namespace:h.clock_namespace===null?null:String(h.clock_namespace)});
 }
 return result;
}
