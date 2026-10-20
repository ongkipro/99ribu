import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {array,id,invalid} from '../catalog/validation.ts';
import {fulfillmentClock} from '../fulfillment/core.ts';
import {lockVerifiedReceivables} from '../finance/settlements/receivables.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';
import {returnEntitlement} from './policy.ts';

export type RefundCollectionUnit={fulfillment_item_id:string;order_item_id:string;shipment_id:string;receipt_id:string;transaction_id:string;original_payment_operation_id:string|null;purchase_event_id:string|null;original_occurred_at:string;merchandise_amount:number;buyer_shipping:number;amount:number};

// Internal financial basis, not a refund authorization. The caller must also
// lock the current case, authorize finance and seal unrefunded physical units.
// A historical receipt can predate Purchase tracking; money does not depend on
// consent, advertising delivery, or inventing a replacement Purchase event.
export async function lockRefundCollectionBasis(tx:TransactionSql,orderId:string,unitIds:unknown){
 const selected=array(unitIds,id,1,100).sort();if(new Set(selected).size!==selected.length)throw invalid();
 const order=await lockPaymentOrder(tx,id(orderId)),[database]=await tx`select current_database() name`;
 const environment:'local'|'test'|null=database.name==='99ribu_test'?'test':database.name==='99ribu_local'?'local':null;
 if(!environment)throw invalid();
 const occurredAt=await fulfillmentClock(tx,order.clock_namespace),provider=order.payment_method==='cod'?'local.cod':'local.payment';
 const [exceptions]=await tx`select to_regclass('app.commerce_exception') is not null installed`;
 const funded=exceptions.installed?tx`and f.id in (select id from app.receipt_entitled_unit_ids(r.id) id)`:tx``;
 const rows=await tx`select f.id,f.order_item_id,f.shipment_id,f.buyer_shipping,i.unit_price,r.id receipt_id,r.transaction_id,r.effect_reference,r.merchandise_amount receipt_merchandise,r.amount receipt_amount,r.occurred_at,
  e.id purchase_id,e.order_id purchase_order_id,e.merchandise_amount purchase_merchandise,e.occurred_at purchase_occurred_at
  from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id
  left join app.economic_receipt r on r.order_id=i.order_id and r.environment=${environment} and r.source=${provider}
   and ((${order.payment_method}='cod' and r.kind='cod' and r.shipment_id=f.shipment_id) or (${order.payment_method}='prepaid' and r.kind='prepaid' and r.shipment_id is null)) ${funded}
  left join app.commerce_event e on e.receipt_id=r.id and e.name='Purchase'
  where f.id in ${tx(selected)} and i.order_id=${order.id} order by f.id for update of f`;
 if(rows.length!==selected.length)throw new AccessError(404,'NOT_FOUND');
 if(rows.some(row=>!row.receipt_id))throw new AccessError(409,'REFUND_COLLECTION_NOT_QUALIFIED');
 const transactionIds=[...new Set(rows.map(row=>String(row.transaction_id)))],verified=await lockVerifiedReceivables(tx,{provider,environment,occurred_at:occurredAt,clock_namespace:order.clock_namespace},transactionIds);
 const purchaseIds=[...new Set(rows.filter(row=>row.purchase_id).map(row=>String(row.purchase_id)))];
 const purchases=purchaseIds.length?await tx`select event_id,order_item_id,quantity,merchandise_amount from app.purchase_allocation where event_id in ${tx(purchaseIds)} order by event_id,order_item_id`:[];
 const units:RefundCollectionUnit[]=[];
 for(const row of rows){
  const original=verified.get(String(row.transaction_id)),occurred=new Date(row.occurred_at).toISOString();
  if(original?.source_basis!=='qualified'||original.order_id!==order.id||original.receipt_id!==row.receipt_id||original.clock_namespace!==order.clock_namespace||original.occurred_at!==occurred||original.gross_amount!==Number(row.receipt_amount))throw new AccessError(409,'REFUND_COLLECTION_NOT_QUALIFIED');
  if(row.purchase_id){
   const allocation=purchases.find(p=>p.event_id===row.purchase_id&&p.order_item_id===row.order_item_id),claimed=rows.filter(r=>r.purchase_id===row.purchase_id&&r.order_item_id===row.order_item_id).length;
   if(row.purchase_order_id!==order.id||Number(row.purchase_merchandise)!==Number(row.receipt_merchandise)||new Date(row.purchase_occurred_at).toISOString()!==occurred||!allocation||Number(allocation.quantity)<claimed||Number(allocation.merchandise_amount)!==Number(allocation.quantity)*99000)throw new AccessError(409,'REFUND_PURCHASE_CONTEXT_MISMATCH');
  }
  units.push({fulfillment_item_id:String(row.id),order_item_id:String(row.order_item_id),shipment_id:String(row.shipment_id),receipt_id:String(row.receipt_id),transaction_id:String(row.transaction_id),original_payment_operation_id:order.payment_method==='prepaid'?String(row.effect_reference):null,purchase_event_id:row.purchase_id===null?null:String(row.purchase_id),original_occurred_at:occurred,...returnEntitlement(Number(row.unit_price),Number(row.buyer_shipping))});
 }
 const total=units.reduce((sum,unit)=>sum+BigInt(unit.amount),0n);if(total>BigInt(Number.MAX_SAFE_INTEGER))throw new AccessError(422,'REFUND_AMOUNT_LIMIT_EXCEEDED');
 for(const receiptId of new Set(units.map(unit=>unit.receipt_id))){
  const row=rows.find(row=>row.receipt_id===receiptId),allocated=units.filter(unit=>unit.receipt_id===receiptId).reduce((sum,unit)=>sum+BigInt(unit.amount),0n);
  if(!row||allocated>BigInt(row.receipt_amount))throw new AccessError(409,'REFUND_COLLECTION_CAPACITY_EXCEEDED');
 }
 return {order,environment,occurred_at:occurredAt,units,amount:Number(total)};
}

// Both confirmation writers serialize against the same original journal. This
// calculation follows source qualification; it grants no refund authority.
export async function lockRefundAdjustmentBasis(tx:TransactionSql,receiptId:string){
 const [receipt]=await tx`select id,transaction_id,merchandise_amount,occurred_at from app.economic_receipt where id=${id(receiptId)}`;
 if(!receipt)throw new AccessError(404,'NOT_FOUND');
 await tx`select id from app.finance_transaction where id=${receipt.transaction_id} for update`;
 const [recovery]=await tx`select to_regclass('app.recovery_refund_allocation') is not null installed`;
 // Before the additive exception migration, only ordinary refund rows exist.
 const [totals]=recovery.installed
  ?await tx`select coalesce(sum(amount),0)::text refunded from (
    select a.merchandise_amount amount from app.refund_allocation a join app.refund r on r.id=a.refund_id where a.receipt_id=${receipt.id} and r.status='succeeded'
    union all select a.merchandise_amount from app.recovery_refund_allocation a join app.recovery_refund r on r.id=a.refund_id where a.receipt_id=${receipt.id} and r.status='succeeded'
   ) portions`
  :await tx`select coalesce(sum(a.merchandise_amount),0)::text refunded from app.refund_allocation a join app.refund r on r.id=a.refund_id where a.receipt_id=${receipt.id} and r.status='succeeded'`;
 const [sequence]=recovery.installed
  ?await tx`select (coalesce(max(sequence),0)::bigint+1)::text next from (
    select sequence from app.refund_adjustment_intent where receipt_id=${receipt.id}
    union all select sequence from app.recovery_adjustment_intent where receipt_id=${receipt.id}
   ) history`
  :await tx`select (coalesce(max(sequence),0)::bigint+1)::text next from app.refund_adjustment_intent where receipt_id=${receipt.id}`;
 const retained=BigInt(receipt.merchandise_amount)-BigInt(totals.refunded),next=BigInt(sequence.next);
 if(retained<0n)throw new AccessError(409,'REFUND_COLLECTION_CAPACITY_EXCEEDED');
 if(next>2147483647n)throw new AccessError(422,'REFUND_ADJUSTMENT_LIMIT_EXCEEDED');
 return {receipt_id:String(receipt.id),original_occurred_at:new Date(receipt.occurred_at).toISOString(),retained_merchandise:Number(retained),next_sequence:Number(next)};
}
