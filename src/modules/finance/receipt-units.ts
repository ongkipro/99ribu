import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {id,integer} from '../catalog/validation.ts';

type Unit={id:string;unit_price:number;buyer_shipping:number;payment_charge?:number};
export type CollectionBasis={unit_ids:string[];merchandise_amount:number;buyer_shipping:number;payment_charge:number;amount:number};

// Original whole-unit prices and allocated buyer shipping are the only basis.
// Empty means no collectible goods, never a zero-valued economic receipt.
export function collectionUnitTotals(units:readonly Unit[]):CollectionBasis{
 if(units.length>100)throw new AccessError(422,'COLLECTION_UNIT_LIMIT_EXCEEDED');
 const normalized=units.map(unit=>({id:id(unit.id),unit_price:integer(unit.unit_price,99000,99000),buyer_shipping:integer(unit.buyer_shipping,0,Number.MAX_SAFE_INTEGER),payment_charge:integer(unit.payment_charge??0,0,Number.MAX_SAFE_INTEGER)}));
 if(new Set(normalized.map(unit=>unit.id)).size!==normalized.length)throw new AccessError(409,'COLLECTION_UNIT_SCOPE_INVALID');
 const merchandise=normalized.reduce((sum,unit)=>sum+BigInt(unit.unit_price),0n),shipping=normalized.reduce((sum,unit)=>sum+BigInt(unit.buyer_shipping),0n),charge=normalized.reduce((sum,unit)=>sum+BigInt(unit.payment_charge),0n);
 if(merchandise+shipping+charge>BigInt(Number.MAX_SAFE_INTEGER))throw new AccessError(422,'COLLECTION_AMOUNT_LIMIT_EXCEEDED');
 return {unit_ids:normalized.map(unit=>unit.id).sort(),merchandise_amount:Number(merchandise),buyer_shipping:Number(shipping),payment_charge:Number(charge),amount:Number(merchandise+shipping+charge)};
}

// Internal facts, not authorization. Caller holds the original order lock.
// A frozen operation retains its unit set even after later cancellation. Only
// the current basis excludes units that have already been explicitly retired.
export async function codCollectionBasis(tx:TransactionSql,shipmentId:string,operationId:string|null=null):Promise<CollectionBasis>{
 const selected=id(shipmentId),operation=operationId===null?null:id(operationId);
 const [parcel]=await tx`select s.*,o.payment_method from app.order_shipment s join app.commerce_order o on o.id=s.order_id where s.id=${selected}`;
 if(parcel?.payment_method!=='cod')throw new AccessError(404,'NOT_FOUND');
 if(operation&&!(await tx`select id from app.local_cod_operation where id=${operation} and shipment_id=${selected}`).length)throw new AccessError(404,'NOT_FOUND');
 const [schema]=await tx`select to_regclass('app.commerce_exception') is not null installed`;
 if(schema.installed){
  const [row]=operation?await tx<{basis:CollectionBasis}[]>`select app.cod_operation_collection_basis(${operation}::uuid) basis`
   :await tx<{basis:CollectionBasis}[]>`select app.cod_current_collection_basis(${selected}::uuid) basis`;
  return {...row.basis,payment_charge:Number(row.basis.payment_charge??0)};
 }
 const units=await tx<{id:string;unit_price:string;buyer_shipping:string;payment_charge:string}[]>`select f.id,i.unit_price,f.buyer_shipping,f.payment_charge from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where f.shipment_id=${selected} order by f.id`;
 const basis=collectionUnitTotals(units.map(unit=>({id:unit.id,unit_price:Number(unit.unit_price),buyer_shipping:Number(unit.buyer_shipping),payment_charge:Number(unit.payment_charge)})));
 if(!basis.unit_ids.length||BigInt(basis.amount)!==BigInt(parcel.cod_due))throw new AccessError(409,'COLLECTION_UNIT_SCOPE_INVALID');
 return basis;
}

// The receipt's original source decides which units were funded. Current
// remaining stock and another receipt cannot lend it monetary entitlement.
export async function receiptUnitIds(tx:TransactionSql,receiptId:string){
 const selected=id(receiptId),[schema]=await tx`select to_regclass('app.commerce_exception') is not null installed`;
 const units=schema.installed?await tx<{id:string}[]>`select id from app.receipt_entitled_unit_ids(${selected}::uuid) id order by id`
  :await tx<{id:string}[]>`select f.id from app.economic_receipt r join app.order_item i on i.order_id=r.order_id
    join app.fulfillment_item f on f.order_item_id=i.id where r.id=${selected} and (r.kind='prepaid' or (r.kind='cod' and r.shipment_id=f.shipment_id)) order by f.id`;
 return units.map(unit=>String(unit.id));
}
