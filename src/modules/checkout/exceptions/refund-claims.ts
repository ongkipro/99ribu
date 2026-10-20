import type {TransactionSql} from 'postgres';
import {AccessError} from '../../access/policy.ts';
import {id} from '../../catalog/validation.ts';
import {advanceReturn,returnUnits,type ReturnHead,type ReturnUnit} from '../../returns/cases.ts';
import {replacementCaseComplete} from '../../returns/replacement-core.ts';

// Financial confirmation finishes only the selected original held claims.
// Other physical replacements keep their actual delivery outcome or remain open.
export function recoveryReplacementClaimPlan(items:readonly Pick<ReturnUnit,'id'|'claim_state'|'inspection_status'>[],selectedIds:readonly string[]){
 const selected=selectedIds.map(id);if(!selected.length||new Set(selected).size!==selected.length)throw new AccessError(409,'RECOVERY_CLAIM_NOT_CURRENT');
 const states=selected.map(selectedId=>{
  const item=items.find(item=>item.id===selectedId);
  if(item?.claim_state!=='held'||!['accepted','waived'].includes(item.inspection_status))throw new AccessError(409,'RECOVERY_CLAIM_NOT_CURRENT');
  return {id:item.id,claim_state:'refunded',inspection_status:item.inspection_status};
 });
 const resolved=replacementCaseComplete(items,selected);
 return {states,resolved};
}

// Caller owns the original parent -> exception -> refund locks and completes
// the exact signed callback/cash result atomically. Original return cases lock
// in sorted order; replay of the same recorded consequence creates no event.
export async function recordRecoveryReplacementClaims(tx:TransactionSql,refundId:string,refundEventId:string,occurredAt:string){
 const [source]=await tx`select refund.id from app.recovery_refund refund join app.recovery_refund_event event on event.refund_id=refund.id
  where refund.id=${id(refundId)} and event.id=${id(refundEventId)} and event.kind='confirm' and event.source_kind='provider'
   and event.status='succeeded' and refund.status='succeeded' and event.cash_transaction_id=refund.cash_transaction_id and refund.cash_transaction_id is not null`;
 if(!source)throw new AccessError(409,'RECOVERY_CLAIM_NOT_CURRENT');
 const selected=await tx`select original_claim.case_id,link.return_item_id from app.recovery_refund_allocation allocation
  join app.recovery_refund refund on refund.id=allocation.refund_id join app.exception_unit unit on unit.id=allocation.exception_unit_id and unit.exception_id=refund.exception_id
  join app.replacement_link link on link.id=unit.replacement_link_id and link.original_fulfillment_item_id=allocation.fulfillment_item_id
  join app.return_item original_claim on original_claim.id=link.return_item_id and original_claim.fulfillment_item_id=allocation.fulfillment_item_id
  join app.exception_cancellation cancellation on cancellation.exception_unit_id=unit.id and cancellation.replacement_link_id=link.id
  where allocation.refund_id=${refundId} order by original_claim.case_id,link.return_item_id`;
 for(const caseId of [...new Set(selected.map(row=>String(row.case_id)))].sort()){
  const [head]=await tx<ReturnHead[]>`select * from app.return_case where id=${caseId} for update`;
  const [previous]=await tx`select id from app.return_event where case_id=${caseId} and source_kind='recovery' and source_id=${refundEventId} and kind='refund_confirmed'`;
  if(previous)continue;
  if(head?.status!=='replacing'||head.resolution!=='replacement')throw new AccessError(409,'RECOVERY_CLAIM_NOT_CURRENT');
  const plan=recoveryReplacementClaimPlan(await returnUnits(tx,head.id),selected.filter(row=>row.case_id===head.id).map(row=>String(row.return_item_id)));
  await advanceReturn(tx,head,{kind:'refund_confirmed',status:plan.resolved?'resolved':'replacing',resolution:'replacement',requires_goods:head.requires_goods,
   cause:{source_kind:'recovery',source_id:refundEventId,actor_id:null,reason:'Original signed recovery cash refunds only the cancelled replacement claims',occurred_at:occurredAt},states:plan.states});
 }
}
