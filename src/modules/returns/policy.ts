import {AccessError} from '../access/policy.ts';
import {array,id,integer,invalid,object,text} from '../catalog/validation.ts';
import {financeInstant} from '../finance/ledger.ts';

export const returnReasons=['wrong_item','damaged','defective','not_as_described','incomplete','expired','broken_mandatory_seal'] as const;
export type ReturnReason=typeof returnReasons[number];

export function returnText(value:unknown,maximum=2000,empty=false){
 const result=text(value,maximum,empty);
 if(/[\p{Cc}\p{Cf}]/u.test(result.replace(/[\n\r\t]/g,'')))throw invalid();
 return result;
}

export function returnRequest(value:unknown){
 const input=object(value,['items','requested_resolution','evidence_ids']);
 if(!['refund','replacement'].includes(String(input.requested_resolution)))throw invalid();
 const items=array(input.items,value=>{
  const line=object(value,['order_item_id','quantity','reason','details','delivered_fulfillment_item_id']);
  if(!returnReasons.includes(line.reason as ReturnReason))throw new AccessError(422,'RETURN_REASON_NOT_ELIGIBLE');
  return {order_item_id:id(line.order_item_id),quantity:integer(line.quantity,1,1),reason:line.reason as ReturnReason,
   details:returnText(line.details??'',2000,true),delivered_fulfillment_item_id:id(line.delivered_fulfillment_item_id)};
 },1,100).sort((a,b)=>a.delivered_fulfillment_item_id<b.delivered_fulfillment_item_id?-1:a.delivered_fulfillment_item_id>b.delivered_fulfillment_item_id?1:0);
 if(new Set(items.map(item=>item.delivered_fulfillment_item_id)).size!==items.length)throw new AccessError(422,'DUPLICATE_RETURN_QUANTITY');
 // S47 owns the private evidence upload/validation flow. An arbitrary file ID
 // cannot become trusted evidence before that flow exists.
 const evidence=array(input.evidence_ids??[],id,0,10);
 if(evidence.length)throw new AccessError(422,'RETURN_EVIDENCE_NOT_VALIDATED');
 return {items,requested_resolution:input.requested_resolution as 'refund'|'replacement',evidence_ids:evidence};
}

export function returnDeadline(receivedAt:string){
 const received=Date.parse(financeInstant(receivedAt));
 return financeInstant(new Date(received+7*24*60*60*1000).toISOString());
}

export function assertReturnWindow(receivedAt:string,submittedAt:string){
 const deadline=returnDeadline(receivedAt),submitted=Date.parse(financeInstant(submittedAt));
 if(submitted<Date.parse(receivedAt))throw new AccessError(422,'RETURN_NOT_RECEIVED');
 if(submitted>Date.parse(deadline))throw new AccessError(422,'RETURN_WINDOW_EXPIRED');
 return deadline;
}

export function returnEntitlement(unitPrice:unknown,buyerShipping:unknown){
 const merchandise=integer(unitPrice,99000,99000),shipping=integer(buyerShipping,0,Number.MAX_SAFE_INTEGER),total=BigInt(merchandise)+BigInt(shipping);
 if(total>BigInt(Number.MAX_SAFE_INTEGER))throw new AccessError(422,'REFUND_AMOUNT_LIMIT_EXCEEDED');
 return {merchandise_amount:merchandise,buyer_shipping:shipping,amount:Number(total)};
}

export function returnInspectionRequest(value:unknown){
 const input=object(value,['expected_version','result','reason','items']);
 if(!['accepted','rejected','needs_review','record_goods'].includes(String(input.result)))throw invalid();
 const items=array(input.items,value=>{
  const item=object(value,['return_item_id','goods']),goods=array(item.goods,value=>{
   const row=object(value,['expected_balance_id','quantity','identity_confirmed']);
   if(typeof row.identity_confirmed!=='boolean')throw invalid();
   return {expected_balance_id:id(row.expected_balance_id),quantity:integer(row.quantity,1,1000000),identity_confirmed:row.identity_confirmed};
  },0,100).sort((a,b)=>a.expected_balance_id<b.expected_balance_id?-1:a.expected_balance_id>b.expected_balance_id?1:0);
  if(new Set(goods.map(row=>row.expected_balance_id)).size!==goods.length)throw new AccessError(422,'DUPLICATE_RETURN_GOODS');
  return {return_item_id:id(item.return_item_id),goods};
 },1,100).sort((a,b)=>a.return_item_id<b.return_item_id?-1:a.return_item_id>b.return_item_id?1:0);
 if(new Set(items.map(item=>item.return_item_id)).size!==items.length)throw new AccessError(422,'DUPLICATE_RETURN_QUANTITY');
 if(items.reduce((total,item)=>total+item.goods.length,0)>100)throw invalid();
 if(input.result==='record_goods'&&items.some(item=>item.goods.length===0))throw new AccessError(422,'RETURN_GOODS_REQUIRED');
 return {expected_version:integer(input.expected_version,1),result:input.result as 'accepted'|'rejected'|'needs_review'|'record_goods',reason:returnText(input.reason),items};
}
