import type {TransactionSql} from 'postgres';
import {AccessError} from '../../access/policy.ts';
import {id,invalid} from '../../catalog/validation.ts';
import {fulfillmentClock} from '../../fulfillment/core.ts';
import {lockVerifiedReceivables} from '../../finance/settlements/receivables.ts';
import {lockPaymentOrder} from '../../payments/attempts.ts';
import {lockRefundCollectionBasis,type RefundCollectionUnit} from '../../returns/financial-basis.ts';

type Selection={kind:'purchased_units';fulfillment_item_ids:string[]}|{kind:'unallocated_collection';source_transaction_id:string};
export type RecoveryCollectionSource={source_transaction_id:string;source_event_id:string;receipt_id:string|null;original_payment_operation_id:string|null;source_amount:number;amount:number;units:RefundCollectionUnit[]};

// Internal source basis only. The writer must separately authorize the actor,
// seal the current case/consent and reserve capacity across both refund paths.
// Resolving money never authorizes stock, a transfer or a new Purchase event.
export async function lockRecoveryCollectionBasis(tx:TransactionSql,orderId:string,selection:Selection){
 if(selection.kind==='purchased_units'){
  const basis=await lockRefundCollectionBasis(tx,orderId,selection.fulfillment_item_ids);
  const receiptIds=[...new Set(basis.units.map(unit=>unit.receipt_id))];
  const receipts=await tx`select id,event_id,transaction_id,amount from app.economic_receipt where id in ${tx(receiptIds)} order by transaction_id`;
  if(receipts.length!==receiptIds.length)throw new AccessError(409,'RECOVERY_COLLECTION_NOT_QUALIFIED');
  const sources:RecoveryCollectionSource[]=receipts.map(receipt=>{
   const units=basis.units.filter(unit=>unit.receipt_id===receipt.id);
   return {source_transaction_id:String(receipt.transaction_id),source_event_id:String(receipt.event_id),receipt_id:String(receipt.id),original_payment_operation_id:units[0].original_payment_operation_id,source_amount:Number(receipt.amount),amount:units.reduce((sum,unit)=>sum+unit.amount,0),units};
  });
  return {order:basis.order,environment:basis.environment,occurred_at:basis.occurred_at,basis_kind:selection.kind,sources};
 }
 if(selection.kind!=='unallocated_collection')throw invalid();
 const transactionId=id(selection.source_transaction_id),order=await lockPaymentOrder(tx,id(orderId));
 const [database]=await tx`select current_database() name`;
 const environment:'local'|'test'|null=database.name==='99ribu_test'?'test':database.name==='99ribu_local'?'local':null;
 if(!environment)throw invalid();
 const occurredAt=await fulfillmentClock(tx,order.clock_namespace),provider=order.payment_method==='cod'?'local.cod':'local.payment';
 const verified=(await lockVerifiedReceivables(tx,{provider,environment,occurred_at:occurredAt,clock_namespace:order.clock_namespace},[transactionId])).get(transactionId);
 if(verified?.source_basis!=='recovery'||verified.receipt_id!==null||verified.order_id!==order.id||verified.clock_namespace!==order.clock_namespace)throw new AccessError(409,'RECOVERY_COLLECTION_NOT_QUALIFIED');
 const evidence=order.payment_method==='prepaid'
  ?await tx`select r.event_id,e.operation_id from app.payment_event_result r join app.local_payment_event e on e.id=r.event_id where r.transaction_id=${transactionId} and r.outcome='recovery' and r.receipt_id is null`
  :await tx`select r.event_id,e.operation_id from app.cod_event_result r join app.local_cod_event e on e.id=r.event_id where r.transaction_id=${transactionId} and r.outcome='recovery' and r.receipt_id is null`;
 if(evidence.length!==1)throw new AccessError(409,'RECOVERY_COLLECTION_NOT_QUALIFIED');
 const sources:RecoveryCollectionSource[]=[{source_transaction_id:transactionId,source_event_id:String(evidence[0].event_id),receipt_id:null,original_payment_operation_id:order.payment_method==='prepaid'?String(evidence[0].operation_id):null,source_amount:verified.gross_amount,amount:verified.gross_amount,units:[]}];
 return {order,environment,occurred_at:occurredAt,basis_kind:'unallocated' as const,sources};
}
