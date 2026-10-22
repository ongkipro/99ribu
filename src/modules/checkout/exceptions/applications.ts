import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../../access/auth.ts';
import {AccessError,type Principal} from '../../access/policy.ts';
import {id,integer} from '../../catalog/validation.ts';
import {reconcileCancellationCreation,requestWaybillCancellation} from '../../fulfillment/cancellations.ts';
import {postMovement} from '../../inventory/state.ts';
import {releaseCancelledPromotionUnits} from '../../promotions/reservations.ts';
import {returnAuthority} from '../../returns/authority.ts';
import {advanceReplacement,lockReplacement,type ReplacementHead} from '../../returns/replacement-core.ts';
import {intentHash,mutationKey} from '../carts.ts';
import {authorizeExceptionReview} from './authority.ts';
import {advanceException,exceptionProposal,exceptionUnits,finishExceptionOperation,insertExceptionOperation,lockException,type ExceptionHead,type ExceptionUnit} from './core.ts';
import {exceptionApplicationConsent,exceptionApplicationRequest} from './policy.ts';
import {projectException} from './projection.ts';
import {qualifyRefundProposal} from './proposals.ts';
import {recordReplacementClaimCancellation} from './replacement-claims.ts';
import {enqueueCommissionVoid} from '../../commissions/jobs.ts';

type Retirement={unit:ExceptionUnit;disposition:'released'|'consumed'|'not_reserved';reservation_id:string|null;physical_source_id:string|null;stock_report_operation_id:string|null};
type Component={balance_id:string;stock_item_id:string;quantity:number};

async function retirementBasis(tx:TransactionSql,head:ExceptionHead,units:ExceptionUnit[],reservationId:string){
 const rows:Retirement[]=[];
 for(const unit of units){
  if(unit.replacement_link_id){
   const [link]=await tx`select shipment_id from app.replacement_link where id=${unit.replacement_link_id}`;
   if(!link)throw new AccessError(409,'REPLACEMENT_RETIREMENT_NOT_ELIGIBLE');
   const {head:replacement}=await lockReplacement(tx,link.shipment_id);
   if(!replacement||replacement.booking_id||replacement.handover_at||!['awaiting_stock','ready','picking'].includes(replacement.status))throw new AccessError(409,'REPLACEMENT_RETIREMENT_NOT_ELIGIBLE');
   rows.push({unit,disposition:replacement.stock_reservation_id?'released':'not_reserved',reservation_id:replacement.stock_reservation_id,physical_source_id:null,stock_report_operation_id:null});
  }else{
   const [fulfillment]=await tx`select id,handover_at from app.fulfillment where shipment_id=${unit.shipment_id} for update`;
   if(!fulfillment)throw new AccessError(409,'EXCEPTION_PHYSICAL_SCOPE_NOT_ELIGIBLE');
   if((await tx`select id from app.buyer_receipt where fulfillment_item_id=${unit.fulfillment_item_id}`).length)throw new AccessError(409,'EXCEPTION_PHYSICAL_SCOPE_NOT_ELIGIBLE');
   if(fulfillment.handover_at){
    const [physical]=await tx`select source.id from app.local_parcel_outcome source join app.parcel_outcome_result result on result.event_id=source.id
     where source.shipment_id=${unit.shipment_id} and source.status in ('failed','refused','returned_to_sender')
      and source.unit_ids ? ${unit.fulfillment_item_id} and result.outcome='observed' and result.exception_ids ? ${head.id}
     order by source.occurred_at,source.id limit 1`;
    if(!physical)return null;
    rows.push({unit,disposition:'consumed',reservation_id:null,physical_source_id:String(physical.id),stock_report_operation_id:null});
   }else{
    if(head.kind!=='stock_discrepancy')throw new AccessError(409,'EXCEPTION_PHYSICAL_SCOPE_NOT_ELIGIBLE');
    const [report]=await tx`select operation.id from app.exception_event event join app.exception_operation operation on operation.id=event.source_id
     where event.exception_id=${head.id} and event.kind='stock_report' and operation.action='report' order by event.revision desc limit 1`;
    if(!report)throw new AccessError(409,'EXCEPTION_STOCK_REINSPECTION_REQUIRED');
    rows.push({unit,disposition:'released',reservation_id:reservationId,physical_source_id:null,stock_report_operation_id:String(report.id)});
   }
  }
 }
 return rows;
}

async function lockRetirementStock(tx:TransactionSql,rows:Retirement[]){
 const reservations=[...new Set(rows.filter(row=>row.reservation_id).map(row=>row.reservation_id as string))].sort();
 for(const reservation of reservations){
  const [held]=await tx`select status from app.stock_reservation where id=${reservation} for update`;
  if(held?.status!=='active')throw new AccessError(409,'FULFILLMENT_STOCK_INVALID');
 }
 const components:Component[]=[],byReservation=new Map<string,Component[]>();
 for(const reservation of reservations){
  const selected=rows.filter(row=>row.reservation_id===reservation),original=selected.filter(row=>!row.unit.replacement_link_id),replacement=selected.filter(row=>row.unit.replacement_link_id);
  const allocated=original.length?await tx<Component[]>`select balance_id,stock_item_id,sum(quantity)::int quantity from app.fulfillment_component_allocation where fulfillment_item_id in ${tx(original.map(row=>row.unit.fulfillment_item_id))} group by balance_id,stock_item_id order by balance_id`
   :await tx<Component[]>`select balance_id,stock_item_id,sum(quantity)::int quantity from app.replacement_component_allocation where replacement_link_id in ${tx(replacement.map(row=>row.unit.replacement_link_id as string))} group by balance_id,stock_item_id order by balance_id`;
  if(!allocated.length)throw new AccessError(409,'FULFILLMENT_STOCK_INVALID');
  byReservation.set(reservation,allocated);components.push(...allocated);
 }
 if(components.length)await tx`select id from app.inventory_balance where id in ${tx([...new Set(components.map(row=>row.balance_id))].sort())} order by id for update`;
 const reports=[...new Set(rows.filter(row=>row.stock_report_operation_id).map(row=>row.stock_report_operation_id as string))];
 const missing=new Map<string,number>();
 for(const report of reports){
  const observed=await tx`select observation.*,balance.revision current_revision,balance.on_hand current_on_hand,balance.reserved current_reserved,balance.quarantined current_quarantined
   from app.exception_stock_observation observation join app.inventory_balance balance on balance.id=observation.balance_id where observation.operation_id=${report} order by observation.balance_id`;
  const wanted=byReservation.get(rows.find(row=>row.stock_report_operation_id===report)?.reservation_id as string)??[];
  if(observed.length!==wanted.length||observed.some(row=>!wanted.some(component=>component.balance_id===row.balance_id&&component.stock_item_id===row.stock_item_id)
    ||row.balance_revision!==row.current_revision||row.on_hand!==row.current_on_hand||row.reserved!==row.current_reserved||row.quarantined!==row.current_quarantined))throw new AccessError(409,'EXCEPTION_STOCK_REINSPECTION_REQUIRED');
  for(const row of observed){const expected=wanted.find(component=>component.balance_id===row.balance_id) as Component;
   if(row.missing_quantity>expected.quantity)throw new AccessError(409,'EXCEPTION_COMPONENT_SCOPE_MISMATCH');
   missing.set(String(row.balance_id),integer((missing.get(String(row.balance_id))??0)+Number(row.missing_quantity),0));
  }
 }
 return {reservations,byReservation,missing};
}

async function releaseComponents(tx:TransactionSql,plan:Awaited<ReturnType<typeof lockRetirementStock>>,operationId:string,actorId:string,reason:string,occurredAt:string){
 const {reservations,byReservation,missing}=plan;
 for(const [reservation,allocated] of byReservation){
  for(const component of allocated)await postMovement(tx,{balanceId:component.balance_id,kind:'release',quantity:component.quantity,onHand:0,reserved:-component.quantity,quarantined:0,
   sourceRef:`exception-release:${operationId}:${reservation}`,actorId,reason});
 }
 for(const [balance,quantity] of [...missing].sort(([a],[b])=>a.localeCompare(b))){
  if(quantity)await postMovement(tx,{balanceId:balance,kind:'adjust_down',quantity,onHand:-quantity,reserved:0,quarantined:0,sourceRef:`exception-loss:${operationId}`,actorId,reason});
 }
 for(const reservation of reservations){
  const [remaining]=await tx`select exists(select 1 from app.fulfillment_item unit join app.commerce_order purchase on purchase.stock_reservation_id=${reservation}
   join app.order_item item on item.id=unit.order_item_id and item.order_id=purchase.id join app.fulfillment physical on physical.shipment_id=unit.shipment_id
   where physical.handover_at is null and not exists(select 1 from app.exception_cancellation cancelled where cancelled.fulfillment_item_id=unit.id and cancelled.replacement_link_id is null))
   or exists(select 1 from app.replacement_link link join app.replacement_shipment shipment on shipment.id=link.shipment_id
    where shipment.stock_reservation_id=${reservation} and shipment.handover_at is null and not exists(select 1 from app.exception_cancellation cancelled where cancelled.replacement_link_id=link.id)) value`;
  if(!remaining.value){
   const [consumed]=await tx`select exists(select 1 from app.commerce_order purchase join app.order_shipment parcel on parcel.order_id=purchase.id
    join app.fulfillment physical on physical.shipment_id=parcel.id where purchase.stock_reservation_id=${reservation} and physical.handover_at is not null) value`;
   await tx`update app.stock_reservation set status=${consumed.value?'consumed':'released'},resolved_at=${occurredAt},resolution_reason=${reason} where id=${reservation}`;
  }
 }
}

export async function applyException(request:Request,identity:LocalAuth,principal:Principal,exceptionId:string,value:unknown){
 const selected=id(exceptionId),input=exceptionApplicationRequest(value),key=mutationKey(request),hash=await intentHash(identity,'commerce_exception.apply',{exception_id:selected,...input});
 return identity.sql.begin(async tx=>{
  await returnAuthority(tx,principal);
  const [before]=await tx<ExceptionHead[]>`select * from app.commerce_exception where id=${selected}`;if(!before)throw new AccessError(404,'NOT_FOUND');
  await authorizeExceptionReview(tx,principal,before);
  // Cancellation creators take their own job before the parent. Acquire these
  // fences first; never invert that order when proving a request was not created.
  const creationJobs=await tx`select distinct cancellation.creation_job_id id from app.exception_unit unit join app.fulfillment_item item on item.id=unit.fulfillment_item_id
   join app.fulfillment physical on physical.shipment_id=item.shipment_id join app.shipment_cancellation cancellation on cancellation.booking_id=physical.booking_id
   where unit.exception_id=${selected} and unit.replacement_link_id is null order by cancellation.creation_job_id limit 1001`;
  if(creationJobs.length>1000)throw new AccessError(409,'RECOVERY_SOURCE_LIMIT');
  const fenced=new Set(creationJobs.map(row=>String(row.id)));
  if(creationJobs.length)await tx`select id from app.outbox_job where id in ${tx([...fenced])} order by id for update`;
  const {head,order}=await lockException(tx,selected);await authorizeExceptionReview(tx,principal,head);
  const [previous]=await tx`select exception_id,request_hash,response from app.exception_operation where actor_scope=${`user:${principal.id}`} and action='apply' and key=${key}`;
  if(previous){if(previous.exception_id!==head.id||previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');await authorizeExceptionReview(tx,principal,head);return previous.response;}
  const units=(await exceptionUnits(tx,head.id)).filter(unit=>unit.active),proposal=await exceptionProposal(tx,head);
  const [saved]=await tx`select id,cause_event_id proposal_id,true accepted from app.exception_event where exception_id=${head.id} and kind='buyer_accept' and cause_event_id=${head.proposal_event_id} order by revision desc limit 1`;
  const consent=exceptionApplicationConsent(head,input,proposal,units.map(unit=>unit.id),saved?{id:String(saved.id),proposal_id:String(saved.proposal_id),accepted:true}:null);
  if((await tx`select id from app.recovery_refund where exception_id=${head.id} limit 1`).length
    ||(await tx`select exception_unit_id from app.exception_cancellation where exception_id=${head.id} limit 1`).length)throw new AccessError(409,'EXCEPTION_APPLICATION_IN_PROGRESS');
  if(proposal?.action==='refund_original_entitlement')await qualifyRefundProposal(tx,head);
  const access=await authorizeExceptionReview(tx,principal,head),operation=await insertExceptionOperation(tx,head,{kind:'user',id:principal.id,principal:access.principal},key,'apply',head.id,hash,input);
  const cancellationIds:string[]=[];let pending=false,escalated=false;
  if(!['late_collection','unallocated_collection'].includes(head.kind))for(const shipment of [...new Set(units.filter(unit=>!unit.replacement_link_id).map(unit=>unit.shipment_id))].sort()){
   const [physical]=await tx`select booking_id,handover_at from app.fulfillment where shipment_id=${shipment} for update`;
   if(!physical)throw new AccessError(409,'EXCEPTION_PHYSICAL_SCOPE_NOT_ELIGIBLE');
   if(physical.handover_at||!physical.booking_id)continue;
   const cancellation=await requestWaybillCancellation(tx,operation.id,String(physical.booking_id));cancellationIds.push(cancellation.id);
   if(cancellation.status!=='cancelled'){
    const [current]=await tx`select creation_job_id from app.shipment_cancellation where id=${cancellation.id}`;
    if(fenced.has(String(current.creation_job_id))){
     const recovery=await reconcileCancellationCreation(tx,cancellation.id);
     if(!recovery.source_present&&recovery.status==='failed'&&recovery.attempts===10&&recovery.max_attempts===10){
      await tx`update app.shipment_cancellation set status='not_created' where id=${cancellation.id}`;escalated=true;
     }
    }
    pending=true;
   }
  }
  const application={...consent,cancellation_ids:cancellationIds.sort()};
  const finish=async(kind:'source_reconciled'|'cancel',status:'awaiting_source'|'awaiting_return'|'ready_for_refund'|'resolved'|'escalated')=>{
   await authorizeExceptionReview(tx,principal,head);
   const changed=await advanceException(tx,head,{kind,status,source_kind:'operation',source_id:operation.id,actor_id:principal.id,reason:input.reason,occurred_at:operation.occurred_at,proposal_event_id:head.proposal_event_id,application});
   return changed;
  };
  if(pending){await finish('source_reconciled',escalated?'escalated':'awaiting_source');return finishExceptionOperation(tx,operation.id,await projectException(tx,head.id));}
  if(['late_collection','unallocated_collection'].includes(head.kind)){
   await qualifyRefundProposal(tx,head);await finish('source_reconciled','ready_for_refund');return finishExceptionOperation(tx,operation.id,await projectException(tx,head.id));
  }
  const retired=await retirementBasis(tx,head,units,order.stock_reservation_id);
  if(!retired){await finish('source_reconciled','awaiting_return');return finishExceptionOperation(tx,operation.id,await projectException(tx,head.id));}
  const funded=await tx`select distinct unit.fulfillment_item_id id from app.exception_unit unit join app.economic_receipt receipt on receipt.order_id=${order.id}
   where unit.exception_id=${head.id} and unit.active and (unit.replacement_link_id is null or ${proposal?.action==='refund_original_entitlement'})
    and unit.fulfillment_item_id in (select id from app.receipt_entitled_unit_ids(receipt.id)) order by unit.fulfillment_item_id`;
  if(funded.length)await qualifyRefundProposal(tx,head,funded.map(row=>String(row.id)));
  if(order.promotion_reservation_id){
   await tx`select promotion.id from app.promotion promotion join app.promotion_allocation allocation on allocation.promotion_id=promotion.id where allocation.reservation_id=${order.promotion_reservation_id} order by promotion.id for update of promotion`;
   await tx`select usage.promotion_id from app.promotion_buyer_usage usage join app.promotion_reservation reservation on reservation.customer_key=usage.customer_key join app.promotion_allocation allocation on allocation.reservation_id=reservation.id and allocation.promotion_id=usage.promotion_id where reservation.id=${order.promotion_reservation_id} order by usage.promotion_id for update of usage`;
   await tx`select id from app.promotion_reservation where id=${order.promotion_reservation_id} for update`;
  }
  let awaitingGoods=false;
  for(const row of retired.filter(row=>row.disposition==='consumed')){
   const [incomplete]=await tx`select exists(select 1 from app.fulfillment_component_allocation component where component.fulfillment_item_id=${row.unit.fulfillment_item_id}
    and (select known_quantity from app.physical_intake_basis(${row.unit.fulfillment_item_id}::uuid,null,component.balance_id))<component.quantity) value`;
   awaitingGoods||=Boolean(incomplete.value);
  }
  const stock=await lockRetirementStock(tx,retired);
  const changed=await finish('cancel',funded.length?'ready_for_refund':awaitingGoods?'awaiting_return':'resolved');
  for(const row of retired)await tx`insert into app.exception_cancellation (exception_unit_id,exception_id,fulfillment_item_id,replacement_link_id,stock_disposition,stock_report_operation_id,physical_source_id,event_id,consent_event_id,operation_id,occurred_at)
   values (${row.unit.id},${head.id},${row.unit.fulfillment_item_id},${row.unit.replacement_link_id},${row.disposition},${row.stock_report_operation_id},${row.physical_source_id},${changed.eventId},${consent.consent_event_id},${operation.id},${operation.occurred_at})`;
  for(const row of retired)if(row.unit.replacement_link_id===null)await enqueueCommissionVoid(tx,order.id,row.unit.fulfillment_item_id);
  await releaseCancelledPromotionUnits(tx,operation.id,input.reason,principal.id);
  await releaseComponents(tx,stock,operation.id,principal.id,input.reason,operation.occurred_at);
  const replacementScopes=await tx`select link.shipment_id,min(cancellation.exception_unit_id::text)::uuid source_id
   from app.exception_cancellation cancellation join app.replacement_link link on link.id=cancellation.replacement_link_id
   where cancellation.operation_id=${operation.id} group by link.shipment_id order by link.shipment_id`;
  for(const scope of replacementScopes){
   const [replacement]=await tx<ReplacementHead[]>`select * from app.replacement_shipment where id=${scope.shipment_id} for update`;
   const [remaining]=await tx`select count(*)::int n from app.replacement_link link where link.shipment_id=${scope.shipment_id}
    and not exists(select 1 from app.exception_cancellation cancellation where cancellation.replacement_link_id=link.id)`;
   const cancelled=await advanceReplacement(tx,replacement,{kind:'cancel',status:remaining.n?replacement.status:'cancelled',source_kind:'exception',source_id:scope.source_id,
    reason:input.reason,occurred_at:operation.occurred_at});
   await recordReplacementClaimCancellation(tx,cancelled.eventId);
  }
  if(retired.some(row=>row.unit.replacement_link_id===null)){
   const [progress]=await tx`select app.original_order_status(${order.id}::uuid) status`;
   const status=String(progress.status),paymentStatus=order.payment_method==='cod'?String((await tx`select app.cod_collection_payment_status(${order.id}::uuid) value`)[0].value):order.payment_status;
   await tx`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) values (${order.id},${order.revision+1},${status},${paymentStatus},'Applied the exact buyer-accepted original unit cancellation',${changed.eventId},${operation.occurred_at})`;
   await tx`update app.commerce_order set revision=revision+1,status=${status},payment_status=${paymentStatus} where id=${order.id}`;
  }
  await authorizeExceptionReview(tx,principal,head);
  return finishExceptionOperation(tx,operation.id,await projectException(tx,head.id));
 });
}
