import type {TransactionSql} from 'postgres';
import {AccessError} from '../../access/policy.ts';
import {id} from '../../catalog/validation.ts';
import {advanceReturn,returnUnits,type ReturnHead,type ReturnUnit} from '../../returns/cases.ts';

// Retirement stops a physical replacement. The original active claim stays
// held until its independently authorized money/remedy outcome is known.
export function replacementCancellationStates(items:readonly Pick<ReturnUnit,'id'|'claim_state'|'inspection_status'>[],selectedIds:readonly string[]){
 const selected=selectedIds.map(id);
 if(!selected.length||new Set(selected).size!==selected.length)throw new AccessError(409,'REPLACEMENT_CLAIM_NOT_CURRENT');
 return selected.map(selectedId=>{
  const item=items.find(item=>item.id===selectedId);
  if(item?.claim_state!=='replacing'||!['accepted','waived'].includes(item.inspection_status))throw new AccessError(409,'REPLACEMENT_CLAIM_NOT_CURRENT');
  return {id:item.id,claim_state:'held',inspection_status:item.inspection_status};
 });
}

// Caller owns current CS authority and parent -> return-case -> replacement
// locks. The native source must belong to this unfinished accepted apply.
export async function recordReplacementClaimCancellation(tx:TransactionSql,eventId:string){
 const [source]=await tx`select event.id,event.shipment_id,event.source_id,event.occurred_at,shipment.case_id from app.replacement_event event
  join app.replacement_shipment shipment on shipment.id=event.shipment_id where event.id=${id(eventId)} and event.kind='cancel' and event.source_kind='exception'`;
 if(!source)throw new AccessError(409,'REPLACEMENT_CLAIM_NOT_CURRENT');
 const [previous]=await tx`select id from app.return_event where source_kind='replacement' and source_id=${source.id} and kind='replacement_cancelled'`;
 if(previous)return String(previous.id);
 const [head]=await tx<ReturnHead[]>`select * from app.return_case where id=${source.case_id} for update`;
 if(head?.status!=='replacing'||head.resolution!=='replacement')throw new AccessError(409,'REPLACEMENT_CASE_NOT_CURRENT');
 const selected=await tx`select link.return_item_id from app.exception_cancellation cancellation join app.replacement_link link on link.id=cancellation.replacement_link_id
  where link.shipment_id=${source.shipment_id} and cancellation.operation_id=(select operation_id from app.exception_cancellation where exception_unit_id=${source.source_id})
  order by link.return_item_id`;
 const states=replacementCancellationStates(await returnUnits(tx,head.id),selected.map(row=>String(row.return_item_id)));
 return (await advanceReturn(tx,head,{kind:'replacement_cancelled',status:'replacing',resolution:'replacement',requires_goods:head.requires_goods,
  cause:{source_kind:'replacement',source_id:String(source.id),actor_id:null,reason:'Accepted physical replacement retirement retains the original claim for its separate remedy',occurred_at:new Date(source.occurred_at).toISOString()},states})).eventId;
}
