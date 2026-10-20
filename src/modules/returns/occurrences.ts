import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {id,integer} from '../catalog/validation.ts';
import {readParcelReceiptSource,verifyParcelReceiptSource} from './receipt-source.ts';
import {readReplacementReceiptSource,verifyReplacementReceiptSource} from './replacement-receipts.ts';

export type ReturnOccurrence={id:string;fulfillment_item_id:string;replacement_link_id:string|null;order_id:string;order_item_id:string;shipment_id:string;warehouse_id:string;unit_index:number;buyer_shipping:string;unit_price:number;buyer_receipt_id:string|null;receipt_id:string|null;source_id:string|null;received_at:string|null};

// The original quantity remains the economic root. A replacement adds a
// physical occurrence with its own delivery receipt, origin and claim window.
// The predecessor schema remains readable before independently gated0022.
export async function readReturnOccurrences(tx:TransactionSql,orderId:string,input:{ids?:readonly string[];limit?:number;after?:string|null}={}){
 const selected=id(orderId),take=integer(input.limit??100,1,101),after=input.after===undefined||input.after===null?null:id(input.after),ids=input.ids?.map(id);
 const [installed]=await tx`select to_regclass('app.replacement_link') is not null installed`;
 const originals=tx`select f.id,f.id fulfillment_item_id,null::uuid replacement_link_id,i.order_id,f.order_item_id,f.shipment_id,s.warehouse_id,
  f.unit_index,f.buyer_shipping,i.unit_price,receipt.id buyer_receipt_id,receipt.id receipt_id,receipt.source_id,receipt.received_at
  from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id join app.order_shipment s on s.id=f.shipment_id left join app.buyer_receipt receipt on receipt.fulfillment_item_id=f.id`;
 const replacements=installed.installed?tx`union all select link.id,f.id fulfillment_item_id,link.id replacement_link_id,i.order_id,f.order_item_id,parcel.id shipment_id,parcel.warehouse_id,
  f.unit_index,f.buyer_shipping,i.unit_price,original.id buyer_receipt_id,receipt.id receipt_id,receipt.source_id,receipt.received_at
  from app.replacement_link link join app.replacement_shipment parcel on parcel.id=link.shipment_id
  join app.fulfillment_item f on f.id=link.original_fulfillment_item_id join app.order_item i on i.id=f.order_item_id
  join app.buyer_receipt original on original.fulfillment_item_id=f.id left join app.replacement_buyer_receipt receipt on receipt.replacement_link_id=link.id`:tx``;
 return tx<ReturnOccurrence[]>`select * from (${originals} ${replacements}) occurrence where order_id=${selected}
  and (${after}::uuid is null or id>${after}::uuid) ${ids?tx`and id in ${tx(ids)}`:tx``} order by id limit ${take}`;
}

export async function verifyOccurrenceReceipt(tx:TransactionSql,occurrence:ReturnOccurrence,namespace:string|null){
 if(!occurrence.receipt_id||!occurrence.source_id||!occurrence.received_at||!occurrence.buyer_receipt_id)throw new AccessError(422,'RETURN_NOT_RECEIVED');
 const received=new Date(occurrence.received_at).toISOString();
 if(occurrence.replacement_link_id===null){
  const stored=await readParcelReceiptSource(tx,occurrence.source_id);if(!stored)throw new AccessError(409,'PARCEL_RECEIPT_SOURCE_MISSING');
  const source=verifyParcelReceiptSource(stored);
  if(source.clock_namespace!==namespace||source.shipment_id!==occurrence.shipment_id||source.occurred_at!==received||!source.unit_ids.includes(occurrence.id))throw new AccessError(409,'PARCEL_RECEIPT_CONTEXT_MISMATCH');
 }else{
  const stored=await readReplacementReceiptSource(tx,occurrence.source_id);if(!stored)throw new AccessError(409,'REPLACEMENT_RECEIPT_SOURCE_MISSING');
  const source=verifyReplacementReceiptSource(stored);
  if(source.clock_namespace!==namespace||source.shipment_id!==occurrence.shipment_id||source.occurred_at!==received||!source.unit_ids.includes(occurrence.id))throw new AccessError(409,'REPLACEMENT_RECEIPT_CONTEXT_MISMATCH');
 }
 return received;
}
