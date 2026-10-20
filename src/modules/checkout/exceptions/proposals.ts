import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../../access/auth.ts';
import {AccessError,type Principal} from '../../access/policy.ts';
import {id,invalid} from '../../catalog/validation.ts';
import {returnAuthority} from '../../returns/authority.ts';
import {actorScope,type CommerceActor} from '../access.ts';
import {intentHash,mutationKey} from '../carts.ts';
import {authorizeOrder} from '../orders.ts';
import {authorizeExceptionReview} from './authority.ts';
import {lockRecoveryCollectionBasis} from './collection.ts';
import {advanceException,exceptionProposal,exceptionUnits,finishExceptionOperation,insertExceptionOperation,lockException,type ExceptionHead} from './core.ts';
import {buyerRecoveryRequest,exceptionChoicePlan,exceptionDecisionRequest,exceptionProposalPlan} from './policy.ts';
import {projectException} from './projection.ts';

// A refund proposal has actual original money available now. It reserves no
// capacity: the later finance writer must qualify and reserve it again.
export async function qualifyRefundProposal(tx:TransactionSql,head:ExceptionHead,selectedUnitIds?:readonly string[]){
 let units=[...await exceptionUnits(tx,head.id)];
 if(selectedUnitIds!==undefined){
  const selected=selectedUnitIds.map(id);
  if(head.kind==='unallocated_collection'||!selected.length||new Set(selected).size!==selected.length)throw invalid();
  units=units.filter(unit=>unit.active&&selected.includes(unit.fulfillment_item_id));
  if(units.length!==selected.length)throw new AccessError(409,'EXCEPTION_COMPONENT_SCOPE_MISMATCH');
 }
 const [source]=head.kind!=='unallocated_collection'?[]:head.source_kind==='payment_event'
  ?await tx`select transaction_id from app.payment_event_result where event_id=${head.source_id} and outcome='recovery' and receipt_id is null`
  :await tx`select transaction_id from app.cod_event_result where event_id=${head.source_id} and outcome='recovery' and receipt_id is null`;
 if(head.kind==='unallocated_collection'&&!source?.transaction_id)throw new AccessError(409,'RECOVERY_COLLECTION_NOT_QUALIFIED');
 const basis=await lockRecoveryCollectionBasis(tx,head.order_id,head.kind==='unallocated_collection'
  ?{kind:'unallocated_collection',source_transaction_id:String(source.transaction_id)}
  :{kind:'purchased_units',fulfillment_item_ids:units.filter(unit=>unit.active).map(unit=>unit.fulfillment_item_id)});
 for(const original of basis.sources){
  const [used]=await tx`select coalesce(sum(amount),0)::text amount from (
   select a.amount from app.refund_allocation a join app.economic_receipt receipt on receipt.id=a.receipt_id where receipt.transaction_id=${original.source_transaction_id}
   union all select amount from app.recovery_refund where source_transaction_id=${original.source_transaction_id}
  ) obligations`;
  if(BigInt(used.amount)+BigInt(original.amount)>BigInt(original.source_amount))throw new AccessError(409,'RECOVERY_COLLECTION_CAPACITY_EXCEEDED');
 }
 const ids=units.map(unit=>unit.fulfillment_item_id);
 if(ids.length&&(await tx`select 1 from app.refund_allocation a join app.return_item item on item.id=a.return_item_id where item.fulfillment_item_id in ${tx(ids)}
   union all select 1 from app.recovery_refund_allocation where fulfillment_item_id in ${tx(ids)} limit 1`).length)throw new AccessError(409,'RECOVERY_QUANTITY_ALREADY_ALLOCATED');
 return basis;
}

export async function decideException(request:Request,identity:LocalAuth,principal:Principal,exceptionId:string,value:unknown){
 const selected=id(exceptionId),input=exceptionDecisionRequest(value),key=mutationKey(request),hash=await intentHash(identity,'commerce_exception.decide',{exception_id:selected,...input});
 return identity.sql.begin(async tx=>{
  await returnAuthority(tx,principal);
  const {head}=await lockException(tx,selected);let access=await authorizeExceptionReview(tx,principal,head);
  const [prior]=await tx`select exception_id,request_hash,response from app.exception_operation where actor_scope=${`user:${principal.id}`} and action='decide' and key=${key}`;
  if(prior){
   if(prior.exception_id!==head.id||prior.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');
   await authorizeExceptionReview(tx,principal,head);return prior.response;
  }
  if(head.revision!==input.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  if((await tx`select exception_unit_id from app.exception_cancellation where exception_id=${head.id} limit 1`).length)throw new AccessError(409,'EXCEPTION_APPLICATION_IN_PROGRESS');
  if((await tx`select 1 from app.exception_event event cross join lateral jsonb_array_elements_text(event.snapshot->'application'->'cancellation_ids') ref(id)
    join app.shipment_cancellation cancellation on cancellation.id::text=ref.id
    where event.exception_id=${head.id} and event.snapshot->'application'->>'proposal_id'=${head.proposal_event_id}
     and cancellation.status in ('queued','acknowledged') limit 1`).length)throw new AccessError(409,'EXCEPTION_APPLICATION_IN_PROGRESS');
  if((await tx`select id from app.recovery_refund where exception_id=${head.id} limit 1`).length)throw new AccessError(409,'EXCEPTION_FINANCE_IN_PROGRESS');
  const plan=exceptionProposalPlan(head,input.decision);
  if(input.decision==='propose_refund')await qualifyRefundProposal(tx,head);
  access=await authorizeExceptionReview(tx,principal,head);
  const actor:CommerceActor={kind:'user',id:principal.id,principal:access.principal};
  const operation=await insertExceptionOperation(tx,head,actor,key,'decide',head.id,hash,input);
  await advanceException(tx,head,{...plan,source_kind:'operation',source_id:operation.id,actor_id:principal.id,reason:input.reason,occurred_at:operation.occurred_at});
  return finishExceptionOperation(tx,operation.id,await projectException(tx,head.id));
 });
}

export async function chooseExceptionProposal(request:Request,identity:LocalAuth,actor:CommerceActor|null,orderId:string,value:unknown){
 const selected=id(orderId),input=buyerRecoveryRequest(value);
 if(input.action==='accept_destination')throw invalid();
 const key=mutationKey(request),action=input.action==='accept_proposal'?'buyer_accept':'buyer_decline';
 const hash=await intentHash(identity,`commerce_exception.${action}`,{order_id:selected,...input});
 return identity.sql.begin(async tx=>{
  await authorizeOrder(tx,request,identity,actor,selected);
  if(!(await tx`select id from app.commerce_exception where id=${input.exception_id} and order_id=${selected}`).length)throw new AccessError(404,'NOT_FOUND');
  const {head,order}=await lockException(tx,input.exception_id);
  if(order.id!==selected)throw new AccessError(404,'NOT_FOUND');
  await authorizeOrder(tx,request,identity,actor,selected);
  if(!actor&&!order.owner_guest_id)throw new AccessError(401,'UNAUTHENTICATED');
  const currentActor:CommerceActor=actor??{kind:'guest',id:order.owner_guest_id as string};
  const [prior]=await tx`select exception_id,request_hash,response from app.exception_operation where actor_scope=${actorScope(currentActor)} and action=${action} and key=${key}`;
  if(prior){
   if(prior.exception_id!==head.id||prior.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');
   await authorizeOrder(tx,request,identity,actor,selected);return prior.response;
  }
  const proposal=await exceptionProposal(tx,head);
  if(!proposal||input.proposal_id!==proposal.id)throw new AccessError(409,'RECOVERY_PROPOSAL_NOT_CURRENT');
  const units=await exceptionUnits(tx,head.id);
  const plan=exceptionChoicePlan(head,input.expected_version,proposal,units.filter(unit=>unit.active).map(unit=>unit.id),action==='buyer_accept');
  if((await tx`select id from app.recovery_refund where exception_id=${head.id} limit 1`).length)throw new AccessError(409,'EXCEPTION_FINANCE_IN_PROGRESS');
  if(action==='buyer_accept'&&proposal.action==='refund_original_entitlement')await qualifyRefundProposal(tx,head);
  await authorizeOrder(tx,request,identity,actor,selected);
  const operation=await insertExceptionOperation(tx,head,currentActor,key,action,head.id,hash,input);
  await advanceException(tx,head,{...plan,source_kind:'operation',source_id:operation.id,actor_id:currentActor.kind==='user'?currentActor.id:null,
   reason:action==='buyer_accept'?'Buyer accepted the exact scoped proposal; execution remains separately guarded':'Buyer declined the exact scoped proposal; staff follow-up is required',occurred_at:operation.occurred_at});
  return finishExceptionOperation(tx,operation.id,await projectException(tx,head.id,true));
 });
}
