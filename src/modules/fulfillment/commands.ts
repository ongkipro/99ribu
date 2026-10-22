import {createHash,randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError,type Principal} from '../access/policy.ts';
import {id,integer,object,text} from '../catalog/validation.ts';
import {assertInventoryWarehouse,inventoryAuthority,postMovement,readPosition} from '../inventory/state.ts';
import {resolvePromotionReservation} from '../promotions/reservations.ts';
import {resolvePolicy} from '../settings/policies.ts';
import {enqueueJob} from '../../jobs/outbox.ts';
import {advanceFulfillment,appendDeadline,appendNotice,fulfillmentClock,lockFulfillment,projectFulfillment} from './core.ts';
import {coveredOperationalDeadline,packingDeadline} from './calendar.ts';
import {assertOriginalStockInvestigationClear} from '../checkout/exceptions/stock.ts';
import {assertWaybillCancellationClear} from './cancellation-source.ts';

export async function mutate(request:Request,identity:LocalAuth,principal:Principal,fulfillmentId:string,action:string,input:Record<string,unknown>,write:(tx:TransactionSql,state:Awaited<ReturnType<typeof lockFulfillment>>,operationId:string)=>Promise<unknown>){
 const selected=id(fulfillmentId),key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key))throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
 const hash=createHash('sha256').update(JSON.stringify({fulfillment_id:selected,action,input})).digest('hex');
 return identity.sql.begin(async tx=>{
  const access=await inventoryAuthority(tx,principal),[scope]=await tx`select s.warehouse_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where f.id=${selected}`;if(!scope)throw new AccessError(404,'NOT_FOUND');
  await assertInventoryWarehouse(tx,scope.warehouse_id,access,false);
  const [previous]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='fulfillment.mutate' and key=${key}`;
  if(previous){if(previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');await assertInventoryWarehouse(tx,scope.warehouse_id,await inventoryAuthority(tx,principal),false);return previous.response;}
  await assertInventoryWarehouse(tx,scope.warehouse_id,access);
  const state=await lockFulfillment(tx,selected);await assertInventoryWarehouse(tx,scope.warehouse_id,await inventoryAuthority(tx,principal));if(state.head.revision!==input.expected_version)throw new AccessError(409,'VERSION_CONFLICT');
  if(action!=='fulfillment.reschedule'){
   await assertOriginalStockInvestigationClear(tx,state.head.shipment_id);
   await assertWaybillCancellationClear(tx,state.head.booking_id,action==='fulfillment.book');
  }
  const operationId=randomUUID(),response=await write(tx,state,operationId);
  await assertInventoryWarehouse(tx,scope.warehouse_id,await inventoryAuthority(tx,principal));
  await tx`insert into app.access_operation (id,actor_id,action,key,request_hash,response) values (${operationId},${principal.id},'fulfillment.mutate',${key},${hash},${JSON.stringify(response)}::jsonb)`;
  await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${principal.id},${action},${selected},'allowed',${String(input.reason??'Scoped original parcel operation')},${JSON.stringify({operation_id:operationId,warehouse_id:scope.warehouse_id})}::jsonb)`;
  return response;
 });
}
function inputFor(value:unknown,fields:string[]=[]){const body=object(value,['expected_version','reason',...fields]);return {body,input:{expected_version:integer(body.expected_version,1),reason:body.reason===undefined?'Scoped original parcel operation':text(body.reason,200)}};}
export async function originalPositions(tx:TransactionSql,shipmentId:string,namespace:string|null,bookingId:string|null=null){
 await tx`select r.id from app.stock_reservation r join app.commerce_order o on o.stock_reservation_id=r.id join app.order_shipment s on s.order_id=o.id where s.id=${shipmentId} for update of r`;
 const [schema]=await tx`select to_regclass('app.commerce_exception') is not null installed`;
 const remaining=schema.installed?(bookingId?tx`f.id in (select id from app.waybill_request_unit_ids(${bookingId}::uuid))`:tx`not exists(select 1 from app.exception_cancellation cancelled where cancelled.fulfillment_item_id=f.id and cancelled.replacement_link_id is null)`):tx`true`;
 const components=await tx`select a.balance_id,sum(a.quantity)::int quantity from app.fulfillment_component_allocation a join app.fulfillment_item f on f.id=a.fulfillment_item_id where f.shipment_id=${shipmentId} and ${remaining} group by a.balance_id order by a.balance_id`;
 if(!components.length)throw new AccessError(409,'FULFILLMENT_NO_ACTIVE_UNITS');
 await tx`select id from app.inventory_balance where id in ${tx(components.map(c=>c.balance_id))} order by id for update`;
 for(const component of components){const position=await readPosition(tx,component.balance_id,namespace);if(position.expired)throw new AccessError(409,'LOT_EXPIRED');if(position.reserved<component.quantity)throw new AccessError(409,'FULFILLMENT_STOCK_INVALID');}
 return components;
}
export async function prepareFulfillment(request:Request,identity:LocalAuth,principal:Principal,fulfillmentId:string,value:unknown){
 const {input}=inputFor(value);
 return mutate(request,identity,principal,fulfillmentId,'fulfillment.prepare',input,async(tx,{head,order},operationId)=>{
  if(head.status!=='ready'||!head.deadline_id||head.calendar_error)throw new AccessError(409,'FULFILLMENT_NOT_READY');
  await commitPreparation(tx,{head,order},operationId,principal.id,input.reason);
  return projectFulfillment(tx,head.id);
 });
}
// Shared by staff preparation and the S91 manual resi path (same transaction).
export async function commitPreparation(tx:TransactionSql,{head,order}:Awaited<ReturnType<typeof lockFulfillment>>,operationId:string,actorId:string,reason:string){
 await originalPositions(tx,head.shipment_id,order.clock_namespace);const now=await fulfillmentClock(tx,order.clock_namespace);
 const changed=await advanceFulfillment(tx,head,{kind:'prepare',status:'picking',source_kind:'operation',source_id:operationId,actor_id:actorId,reason,occurred_at:now,prepared_at:now});
 if(order.status==='pending'){
  await tx`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) values (${order.id},${order.revision+1},'processing',${order.payment_status},'Original parcel physically prepared',${changed.eventId},${now})`;
  await tx`update app.commerce_order set revision=revision+1,status='processing' where id=${order.id}`;
 }
 return changed;
}
export async function bookShipment(request:Request,identity:LocalAuth,principal:Principal,value:unknown){
 const {input,body}=inputFor(value,['fulfillment_id']);const fulfillmentId=id(body.fulfillment_id);
 return mutate(request,identity,principal,fulfillmentId,'fulfillment.book',input,async(tx,{head,order},operationId)=>{
  if(!head.prepared_at||!['picking','exception'].includes(head.status)||!head.deadline_id||head.calendar_error)throw new AccessError(409,'FULFILLMENT_NOT_PREPARED');
  if(head.booking_id){
   const [previous]=await tx`select status from app.shipment_booking where id=${head.booking_id} for update`;
   if(!['failed','cancelled'].includes(previous?.status)||head.status!=='exception')throw new AccessError(409,'SHIPMENT_BOOKING_ACTIVE');
   if(input.reason==='Scoped original parcel operation')throw new AccessError(400,'REBOOK_REASON_REQUIRED');
  }
  const now=await fulfillmentClock(tx,order.clock_namespace),bookingId=randomUUID(),job=await enqueueJob(tx,'shipping.create',`shipping-create:${bookingId}`,{bookingId});
  await tx`insert into app.shipment_booking (id,fulfillment_id,creation_job_id,operation_id,created_at) values (${bookingId},${head.id},${job},${operationId},${now})`;
  await advanceFulfillment(tx,head,{kind:'booking',status:'picking',source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:input.reason,occurred_at:now,booking_id:bookingId});
  return {operation_id:bookingId,status:'queued',status_url:`/api/v1/admin/shipments/${head.shipment_id}`};
 });
}
export async function completePacking(request:Request,identity:LocalAuth,principal:Principal,fulfillmentId:string,value:unknown){
 const {input}=inputFor(value);return mutate(request,identity,principal,fulfillmentId,'fulfillment.packing',input,async(tx,{head,order},operationId)=>{
  if(head.status!=='packed'||!head.prepared_at||!head.waybill_issued_at||!head.tracking_number)throw new AccessError(409,'WAYBILL_NOT_ISSUED');
  await advanceFulfillment(tx,head,{kind:'packed',status:'handover_pending',source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:input.reason,occurred_at:await fulfillmentClock(tx,order.clock_namespace)});
  return projectFulfillment(tx,head.id);
 });
}
export async function handoverFulfillment(request:Request,identity:LocalAuth,principal:Principal,fulfillmentId:string,value:unknown){
 const {body,input}=inputFor(value,['shipment_id','handover_reference']);const intent={...input,shipment_id:id(body.shipment_id),handover_reference:text(body.handover_reference,200)};
 return mutate(request,identity,principal,fulfillmentId,'fulfillment.handover',intent,async(tx,{head,order},operationId)=>{
  if(intent.shipment_id!==head.shipment_id)throw new AccessError(404,'NOT_FOUND');
  if(!['packed','handover_pending'].includes(head.status)||!head.prepared_at||!head.waybill_issued_at||!head.tracking_number)throw new AccessError(409,'FULFILLMENT_NOT_PACKED');
  await commitHandover(tx,{head,order},operationId,principal.id,input.reason,intent.handover_reference);
  return projectFulfillment(tx,head.id);
 });
}
// Shared by staff handover and the S91 manual resi path (same transaction).
export async function commitHandover(tx:TransactionSql,{head,order}:Awaited<ReturnType<typeof lockFulfillment>>,operationId:string,actorId:string,reason:string,handoverReference:string){
  // Match checkout's clock -> order -> promotions -> stock lock order across
  // different orders that share both a promotion and a physical position.
  if(order.promotion_reservation_id){
   await tx`select p.id from app.promotion p join app.promotion_allocation a on a.promotion_id=p.id where a.reservation_id=${order.promotion_reservation_id} order by p.id for update of p`;
   await tx`select b.promotion_id from app.promotion_buyer_usage b join app.promotion_reservation r on r.customer_key=b.customer_key join app.promotion_allocation a on a.reservation_id=r.id and a.promotion_id=b.promotion_id where r.id=${order.promotion_reservation_id} order by b.promotion_id for update of b`;
   await tx`select id from app.promotion_reservation where id=${order.promotion_reservation_id} for update`;
  }
  const components=await originalPositions(tx,head.shipment_id,order.clock_namespace,head.booking_id),now=await fulfillmentClock(tx,order.clock_namespace);
  const changed=await advanceFulfillment(tx,head,{kind:'handover',status:'handed_over',source_kind:'operation',source_id:operationId,actor_id:actorId,reason,occurred_at:now,handover_at:now,handover_reference:handoverReference});
  for(const component of components)await postMovement(tx,{balanceId:component.balance_id,kind:'consume',quantity:component.quantity,onHand:-component.quantity,reserved:-component.quantity,quarantined:0,sourceRef:`handover:${changed.eventId}`,actorId,reason});
  if(order.promotion_reservation_id)await resolvePromotionReservation(tx,order.promotion_reservation_id,'consumed','Parent shipping benefit committed at first physical handover',actorId);
  const [schema]=await tx`select to_regclass('app.exception_cancellation') is not null installed`;
  const active=schema.installed?tx`and not exists(select 1 from app.exception_cancellation cancelled where cancelled.fulfillment_item_id=unit.id and cancelled.replacement_link_id is null)`:tx``;
  const [remaining]=await tx`select count(*)::int n from app.fulfillment_item unit join app.order_item item on item.id=unit.order_item_id
   left join app.fulfillment physical on physical.shipment_id=unit.shipment_id where item.order_id=${order.id} and physical.handover_at is null ${active}`;
  if(remaining.n===0)await tx`update app.stock_reservation set status='consumed',resolved_at=${now},resolution_reason='All original parcels physically handed over' where id=${order.stock_reservation_id} and status='active'`;
  return changed;
}
export async function rescheduleFulfillment(request:Request,identity:LocalAuth,principal:Principal,fulfillmentId:string,value:unknown){
 const {input,body}=inputFor(value,['buyer_explanation']);if(input.reason==='Scoped original parcel operation')throw new AccessError(400,'RESCHEDULE_REASON_REQUIRED');const intent={...input,buyer_explanation:text(body.buyer_explanation,200)};
 return mutate(request,identity,principal,fulfillmentId,'fulfillment.reschedule',intent,async(tx,{head,order},operationId)=>{
  if(head.handover_at)throw new AccessError(409,'FULFILLMENT_ALREADY_HANDED_OVER');const now=await fulfillmentClock(tx,order.clock_namespace),anchor=new Date(order.actionable_at as string).toISOString();
  const policy=await resolvePolicy(tx,'warehouse_calendar',head.warehouse_id,new Date(now));if(policy.values.timezone===undefined)throw new AccessError(503,'POLICY_INVALID');
  const [local]=await tx`select extract(year from (${anchor}::timestamptz at time zone ${policy.values.timezone}))::int calendar_year`;
  const packing=await packingDeadline(tx,head.warehouse_id,anchor,policy.values.year===local.calendar_year?policy:undefined),eventId=randomUUID();
  let handover:Awaited<ReturnType<typeof coveredOperationalDeadline>>|null=null;
  if(head.waybill_issued_at){const issued=new Date(head.waybill_issued_at).toISOString(),[year]=await tx`select extract(year from (${issued}::timestamptz at time zone ${policy.values.timezone}))::int calendar_year`;const basis=policy.values.year===year.calendar_year?policy:await resolvePolicy(tx,'warehouse_calendar',head.warehouse_id,new Date(issued));handover=await coveredOperationalDeadline(tx,head.warehouse_id,basis,issued,1);}
  const deadline=await appendDeadline(tx,{...packing,fulfillment_id:head.id,source_id:eventId,handover_due_at:handover?.due_at,handover_calendar_coverage:handover?.coverage},order.clock_namespace);
  await advanceFulfillment(tx,head,{kind:'reschedule',status:head.status==='exception'&&head.booking_id?'exception':head.waybill_issued_at?head.status:head.prepared_at?'picking':'ready',source_kind:'operation',source_id:operationId,actor_id:principal.id,reason:input.reason,public_explanation:intent.buyer_explanation,occurred_at:now,deadline_id:deadline.id,calendar_error:null},eventId);
  await appendNotice(tx,head.id,eventId,'rescheduled',now,intent.buyer_explanation);return projectFulfillment(tx,head.id);
 });
}
