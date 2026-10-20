import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {enqueueJob} from '../../jobs/outbox.ts';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {id} from '../catalog/validation.ts';
import {intentHash,mutationKey} from '../checkout/carts.ts';
import {openReplacementStockException,reconcileReplacementStockException} from '../checkout/exceptions/replacement-cases.ts';
import {packingDeadline} from '../fulfillment/calendar.ts';
import {fulfillmentClock} from '../fulfillment/core.ts';
import {activateReservation} from '../inventory/reservations.ts';
import {lockInventoryClock,postMovement} from '../inventory/state.ts';
import {assertReturnInspection,assertReturnReview,canReadReturnWarehouse,returnAuthority} from './authority.ts';
import {advanceReturn,lockStaffReturn,returnUnits} from './cases.ts';
import {advanceReplacement,lockReplacement,projectReplacement,type ReplacementHead} from './replacement-core.ts';
import {replacementActionRequest,replacementRequest} from './replacement-policy.ts';
import {lockReplacementStock,reserveReplacementStock} from './replacement-stock.ts';

async function beginOperation(tx:TransactionSql,principal:Principal,input:{case_id:string;shipment_id:string;key:string;action:string;hash:string}){
 const [row]=await tx`insert into app.replacement_operation (case_id,subject_id,actor_id,session_id,key,action,request_hash,response,occurred_at)
  values (${input.case_id},${input.shipment_id},${principal.id},${principal.sessionId},${input.key},${input.action},${input.hash},'{}'::jsonb,clock_timestamp()) returning id`;
 return String(row.id);
}
async function previousOperation(tx:TransactionSql,principal:Principal,key:string,hash:string,action:string){
 const [previous]=await tx`select request_hash,action,response from app.replacement_operation where actor_id=${principal.id} and key=${key}`;
 if(previous&&(previous.action!==action||previous.request_hash!==hash))throw new AccessError(409,'IDEMPOTENCY_CONFLICT');
 return previous;
}
async function finishOperation(tx:TransactionSql,principal:Principal,head:ReplacementHead,operationId:string,action:string,reason:string){
 const access=await returnAuthority(tx,principal);
 if(['create','reserve'].includes(action))assertReturnReview(access,[...(await returnUnits(tx,head.case_id)).map(item=>item.warehouse_id),head.warehouse_id]);
 else assertReturnInspection(access,[head.warehouse_id]);
 const response=await projectReplacement(tx,head.id);
 await tx`update app.replacement_operation set response=${JSON.stringify(response)}::jsonb where id=${operationId}`;
 await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details,created_at)
  values (${principal.id},${`replacement.${action}`},${head.id},'allowed',${reason},${JSON.stringify({operation_id:operationId,case_id:head.case_id,version:response.version})}::jsonb,clock_timestamp())`;
 await tx`set constraints all immediate`;return response;
}

async function attemptStock(tx:TransactionSql,head:ReplacementHead,namespace:string|null,principal:Principal,operationId:string,reason:string){
 try{return await tx.savepoint(async inner=>{
  const reservation=await reserveReplacementStock(inner,{shipment_id:head.id,warehouse_id:head.warehouse_id,clock_namespace:namespace,actor_id:principal.id});
  const now=await fulfillmentClock(inner,namespace),calendar=await packingDeadline(inner,head.warehouse_id,now);
  const changed=await advanceReplacement(inner,head,{kind:'reserve',status:'ready',source_kind:'operation',source_id:operationId,actor_id:principal.id,reason,occurred_at:now,
   patch:{stock_reservation_id:reservation,packing_due_at:calendar.packing_due_at,calendar_snapshot:{anchor:now,...calendar}}});
  await activateReservation(inner,reservation);await reconcileReplacementStockException(inner,head.id);return changed.head;
 });}catch(error){
  if(!(error instanceof AccessError)||error.code!=='INSUFFICIENT_STOCK')throw error;
  // A savepoint rolls back the complete reserve attempt. The outer operation,
  // shipment and unit identities survive for one explicit stock recovery.
  const changed=await advanceReplacement(tx,head,{kind:'stock_wait',status:'awaiting_stock',source_kind:'operation',source_id:operationId,actor_id:principal.id,reason,occurred_at:await fulfillmentClock(tx,namespace)});
  await openReplacementStockException(tx,head.id,changed.eventId);return changed.head;
 }
}

export async function createReplacement(request:Request,identity:LocalAuth,principal:Principal,caseId:string,value:unknown){
 const selected=id(caseId),input=replacementRequest(value),key=mutationKey(request),hash=await intentHash(identity,'replacement.create',{case_id:selected,...input});
 return identity.sql.begin(async tx=>{
  const {head:returnCase,order,access,items}=await lockStaffReturn(tx,principal,selected);
  assertReturnReview(access,[...items.map(item=>item.warehouse_id),input.warehouse_id]);
  const previous=await previousOperation(tx,principal,key,hash,'create');if(previous)return previous.response;
  if(returnCase.revision!==input.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  if(returnCase.status!=='replacing'||returnCase.resolution!=='replacement')throw new AccessError(409,'RETURN_REPLACEMENT_NOT_APPROVED');
  const chosen=items.filter(item=>input.return_item_ids.includes(item.id));
  if(chosen.length!==input.return_item_ids.length)throw new AccessError(404,'NOT_FOUND');
  if(chosen.some(item=>item.claim_state!=='held'||!['accepted','waived'].includes(item.inspection_status)))throw new AccessError(409,'REPLACEMENT_QUANTITY_NOT_READY');
  if((await tx`select id from app.replacement_link where return_item_id in ${tx(input.return_item_ids)} limit 1`).length)throw new AccessError(409,'REPLACEMENT_QUANTITY_NOT_READY');
  if(!(await tx`select id from app.warehouse where id=${input.warehouse_id} and active for share`).length)throw new AccessError(404,'NOT_FOUND');
  await lockInventoryClock(tx,order.clock_namespace,[input.warehouse_id]);
  if((await tx`select a.return_item_id from app.refund_allocation a join app.return_item r on r.id=a.return_item_id where r.fulfillment_item_id in ${tx(chosen.map(item=>item.fulfillment_item_id))}`).length)throw new AccessError(409,'ORIGINAL_QUANTITY_REFUND_OBLIGATED');
  const roots=await tx`select r.id,r.fulfillment_item_id,r.replacement_link_id,link.generation predecessor_generation from app.return_item r
   left join app.replacement_link link on link.id=r.replacement_link_id where r.id in ${tx(input.return_item_ids)} order by r.id`;
  const shipmentId=randomUUID(),operationId=await beginOperation(tx,principal,{case_id:selected,shipment_id:shipmentId,key,action:'create',hash}),now=await fulfillmentClock(tx,order.clock_namespace);
  const [head]=await tx<ReplacementHead[]>`insert into app.replacement_shipment (id,case_id,operation_id,warehouse_id,revision,status,created_at)
   values (${shipmentId},${selected},${operationId},${input.warehouse_id},1,'awaiting_stock',${now}) returning *`;
  for(const root of roots){
   const generation=Number(root.predecessor_generation??0)+1;if(generation>2147483647)throw new AccessError(409,'REPLACEMENT_GENERATION_EXHAUSTED');
   await tx`insert into app.replacement_link (shipment_id,return_item_id,original_fulfillment_item_id,predecessor_id,generation,created_at)
    values (${shipmentId},${root.id},${root.fulfillment_item_id},${root.replacement_link_id},${generation},${now})`;
  }
  const created=await advanceReplacement(tx,head,{kind:'create',status:'awaiting_stock',source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:input.reason,occurred_at:now});
  await advanceReturn(tx,returnCase,{kind:'replacement_started',status:'replacing',resolution:'replacement',requires_goods:returnCase.requires_goods,
   cause:{source_kind:'replacement',source_id:created.eventId,actor_id:principal.id,reason:input.reason,occurred_at:now},states:chosen.map(item=>({id:item.id,claim_state:'replacing',inspection_status:item.inspection_status}))});
  const current=await attemptStock(tx,head,order.clock_namespace,principal,operationId,input.reason);
  return finishOperation(tx,principal,current,operationId,'create',input.reason);
 });
}

export async function actOnReplacement(request:Request,identity:LocalAuth,principal:Principal,shipmentId:string,value:unknown,action:'reserve'|'prepare'|'book'|'handover'){
 const selected=id(shipmentId),input=replacementActionRequest(value,action),key=mutationKey(request),hash=await intentHash(identity,`replacement.${action}`,{shipment_id:selected,...input});
 return identity.sql.begin(async tx=>{
  await returnAuthority(tx,principal);
  const {head,order}=await lockReplacement(tx,selected),access=await returnAuthority(tx,principal);
  if(action==='reserve')assertReturnReview(access,[...(await returnUnits(tx,head.case_id)).map(item=>item.warehouse_id),head.warehouse_id]);
  else assertReturnInspection(access,[head.warehouse_id]);
  const previous=await previousOperation(tx,principal,key,hash,action);if(previous)return previous.response;
  if(head.revision!==input.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  const operationId=await beginOperation(tx,principal,{case_id:head.case_id,shipment_id:head.id,key,action,hash});
  if(action==='reserve'){
   if(head.status!=='awaiting_stock'||head.stock_reservation_id!==null)throw new AccessError(409,'REPLACEMENT_STOCK_NOT_WAITING');
   const current=await attemptStock(tx,head,order.clock_namespace,principal,operationId,input.reason);
   return finishOperation(tx,principal,current,operationId,action,input.reason);
  }
  if(!(await tx`select id from app.warehouse where id=${head.warehouse_id} and active for share`).length)throw new AccessError(409,'REPLACEMENT_ORIGIN_INACTIVE');
  await reconcileReplacementStockException(tx,head.id);
  const stock=await lockReplacementStock(tx,head.id,order.clock_namespace,action==='handover'?head.booking_id:null),now=await fulfillmentClock(tx,order.clock_namespace);let current:ReplacementHead;
  if(action==='prepare'){
   if(head.status!=='ready'||!head.packing_due_at||!head.calendar_snapshot)throw new AccessError(409,'REPLACEMENT_NOT_READY');
   current=(await advanceReplacement(tx,head,{kind:'prepare',status:'picking',source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:input.reason,occurred_at:now,patch:{prepared_at:now}})).head;
  }else if(action==='book'){
   if(!head.prepared_at||!['picking','booking_failed'].includes(head.status))throw new AccessError(409,'REPLACEMENT_NOT_PREPARED');
   if(head.booking_id){
    const [terminal]=await tx`select b.id from app.replacement_booking b join app.local_replacement_operation op on op.id=b.provider_operation_id
     join app.local_replacement_event e on e.operation_id=op.id join app.replacement_event_result result on result.event_id=e.id
     where b.id=${head.booking_id} and b.status='failed' and op.status='failed' and e.status='failed' and result.outcome='failed'`;
    if(!terminal)throw new AccessError(409,'REPLACEMENT_BOOKING_ACTIVE');
   }
   const [latest]=await tx`select coalesce(max(attempt),0)::int n from app.replacement_booking where shipment_id=${head.id}`;
   if(latest.n===2147483647)throw new AccessError(409,'REPLACEMENT_BOOKING_EXHAUSTED');
   const bookingId=randomUUID(),job=await enqueueJob(tx,'replacement.shipping.create',`replacement-shipping-create:${bookingId}`,{bookingId});
   await tx`insert into app.replacement_booking (id,shipment_id,attempt,operation_id,creation_job_id,status,created_at)
    values (${bookingId},${head.id},${latest.n+1},${operationId},${job},'queued',${now})`;
   current=(await advanceReplacement(tx,head,{kind:'book',status:'booking_pending',source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:input.reason,occurred_at:now,patch:{booking_id:bookingId}})).head;
  }else{
   if(head.status!=='packed'||!head.prepared_at||!head.waybill_issued_at||!head.tracking_number||!head.booking_id)throw new AccessError(409,'REPLACEMENT_NOT_PACKED');
   const changed=await advanceReplacement(tx,head,{kind:'handover',status:'handed_over',source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:input.reason,occurred_at:now,patch:{handover_at:now,handover_reference:input.handover_reference}});
   for(const component of stock.components)await postMovement(tx,{balanceId:component.balance_id,kind:'consume',quantity:Number(component.quantity),onHand:-Number(component.quantity),reserved:-Number(component.quantity),quarantined:0,sourceRef:`replacement-handover:${changed.eventId}`,actorId:principal.id,reason:input.reason});
   await tx`update app.stock_reservation set status='consumed',resolved_at=${now},resolution_reason=${input.reason} where id=${stock.reservation_id}`;
   current=changed.head;
  }
  return finishOperation(tx,principal,current,operationId,action,input.reason);
 });
}

export async function readAdminReplacement(identity:LocalAuth,principal:Principal,shipmentId:string){
 return identity.sql.begin(async tx=>{
  const access=await returnAuthority(tx,principal),selected=id(shipmentId),[before]=await tx`select case_id from app.replacement_shipment where id=${selected}`;
  if(!before)throw new AccessError(404,'NOT_FOUND');
  await tx`select id from app.return_case where id=${before.case_id} for share`;
  const [head]=await tx<ReplacementHead[]>`select * from app.replacement_shipment where id=${selected} for share`;
  if(!head||!canReadReturnWarehouse(access,head.warehouse_id))throw new AccessError(404,'NOT_FOUND');
  const response=await projectReplacement(tx,head.id);await returnAuthority(tx,principal);
  await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason) values (${principal.id},'replacement.read',${head.id},'allowed','Read current authorized contact-free replacement projection')`;
  return response;
 });
}
