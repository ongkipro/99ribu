import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {id,integer,invalid,object} from '../catalog/validation.ts';
import {appendFinanceTransaction,effectReference,financeInstant} from './ledger.ts';
import {codCollectionBasis} from './receipt-units.ts';

export type ReceiptInput={order_id:string;shipment_id:string|null;source:'local.payment'|'local.cod';environment:'local'|'test';event_id:string;effect_reference:string;amount:number;occurred_at:string};
function project(row:Record<string,unknown>){return {id:String(row.id),transaction_id:String(row.transaction_id),order_id:String(row.order_id),shipment_id:row.shipment_id as string|null,kind:String(row.kind),currency:'IDR' as const,amount:Number(row.amount),merchandise_amount:Number(row.merchandise_amount),buyer_shipping:Number(row.buyer_shipping),payment_charge:Number(row.payment_charge??0),occurred_at:new Date(row.occurred_at as string).toISOString(),recorded_at:new Date(row.recorded_at as string).toISOString()};}

// S24/S28 must authenticate and durably reconcile the actual simulator/provider
// event before calling this trusted transaction primitive. Client flags are not
// proof. This function records collection, never paid/delivered/settled state.
export async function postEconomicReceipt(tx:TransactionSql,value:ReceiptInput){
 const input=object(value,['order_id','shipment_id','source','environment','event_id','effect_reference','amount','occurred_at']);
 if(!['local.payment','local.cod'].includes(String(input.source))||!['local','test'].includes(String(input.environment))) throw invalid();
 const orderId=id(input.order_id),shipmentId=input.shipment_id===null?null:id(input.shipment_id),amount=integer(input.amount,1,Number.MAX_SAFE_INTEGER),eventId=effectReference(input.event_id),effect=effectReference(input.effect_reference),occurred=financeInstant(input.occurred_at);
 const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${input.environment}`) throw invalid();
 const [order]=await tx`select * from app.commerce_order where id=${orderId} for update`;if(!order) throw new AccessError(404,'NOT_FOUND');
 const kind=order.payment_method as 'prepaid'|'cod';
 if((kind==='prepaid'&&(shipmentId!==null||input.source!=='local.payment'))||(kind==='cod'&&(shipmentId===null||input.source!=='local.cod'))) throw invalid();
 // DEC-008/009: the buyer-paid payment charge (transfer code or COD fee) is its own component.
 let merchandise=BigInt(order.merchandise_amount),shipping=BigInt(order.shipping_amount)-BigInt(order.subsidy_amount),charge=BigInt(order.payment_charge_amount??0),due=BigInt(order.buyer_total)+charge;
 if(kind==='cod'){const [shipment]=await tx`select * from app.order_shipment where id=${shipmentId} and order_id=${orderId}`;if(!shipment) throw new AccessError(404,'NOT_FOUND');merchandise=BigInt(shipment.merchandise_amount);shipping=BigInt(shipment.buyer_shipping);charge=BigInt(shipment.payment_charge??0);due=BigInt(shipment.cod_due);}
 if(kind==='cod'){
  const [schema]=await tx`select to_regclass('app.commerce_exception') is not null installed`;
  if(schema.installed){const basis=await codCollectionBasis(tx,shipmentId as string,effect);merchandise=BigInt(basis.merchandise_amount);shipping=BigInt(basis.buyer_shipping);charge=BigInt(basis.payment_charge);due=BigInt(basis.amount);}
 }
 if(BigInt(amount)!==due||merchandise+shipping+charge!==due) throw new AccessError(422,'RECEIPT_AMOUNT_MISMATCH');
 const previous=await tx`select * from app.economic_receipt where source=${String(input.source)} and environment=${String(input.environment)} and (effect_reference=${effect} or event_id=${eventId})`;
 if(previous.length){
  if(previous.length!==1||previous[0].effect_reference!==effect||previous[0].order_id!==orderId||previous[0].shipment_id!==shipmentId||BigInt(previous[0].amount)!==due) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');
  return project(previous[0]);
 }
 if((await tx`select id from app.economic_receipt where order_id=${orderId} and ((${kind}='prepaid' and kind='prepaid') or (${kind}='cod' and shipment_id=${shipmentId}))`).length) throw new AccessError(409,'RECEIPT_ALREADY_ALLOCATED');
 const journal=await appendFinanceTransaction(tx,{kind:'economic_receipt',source:String(input.source),environment:input.environment as ReceiptInput['environment'],effect_reference:effect,order_id:orderId,reason:'Verified local collection; provider settlement remains separate',occurred_at:occurred,postings:[{account:'provider_receivable',side:'debit',amount},{account:'buyer_funds_liability',side:'credit',amount}]});
 const [receipt]=await tx`insert into app.economic_receipt (transaction_id,order_id,shipment_id,kind,source,environment,event_id,effect_reference,amount,merchandise_amount,buyer_shipping,payment_charge,occurred_at)
  values (${journal.id},${orderId},${shipmentId},${kind},${String(input.source)},${String(input.environment)},${eventId},${effect},${amount},${merchandise.toString()},${shipping.toString()},${charge.toString()},${occurred}) returning *`;
 return project(receipt);
}
