import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {enqueueJob} from '../../jobs/outbox.ts';
import {AccessError} from '../access/policy.ts';
import {id,integer,invalid} from '../catalog/validation.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';
import {packingDeadline,coveredOperationalDeadline,type ShippingCalendar} from './calendar.ts';
import {resolvePolicy} from '../settings/policies.ts';

export function shippingCreationRecovery(job:{status:string;attempts:number;max_attempts:number},sourcePresent:boolean){
 if(!['failed','unknown'].includes(job.status)||typeof sourcePresent!=='boolean')throw invalid();
 const attempts=integer(job.attempts,0),previousMax=integer(job.max_attempts,1,10);
 // Only an explicit recovery of a known failed, absent original effect grants
 // one more dispatch. Reconciliation never erases attempts or extends ambiguity.
 const max_attempts=job.status==='failed'&&!sourcePresent&&attempts>=previousMax&&attempts<10?attempts+1:previousMax;
 const status:'unknown'|'pending'|'failed'=sourcePresent?'unknown':attempts<max_attempts?'pending':'failed';
 return {status,max_attempts};
}

export function originalWaybillProgress(parcel?:{booking_id?:unknown;booking_status?:unknown;creation_status?:unknown;tracking_number?:unknown;cancellation_pending?:unknown}){
 const tracking=parcel?.booking_status==='issued'&&!parcel.cancellation_pending&&typeof parcel.tracking_number==='string'?parcel.tracking_number:null;
 const status=parcel?.cancellation_pending?'booking_cancellation_pending':parcel?.booking_status==='cancelled'?'booking_cancelled':tracking?'packed':
  parcel?.booking_status==='failed'||parcel?.creation_status==='failed'?'booking_failed':parcel?.creation_status==='unknown'?'booking_unknown':
  parcel?.booking_status==='acknowledged'?'booked':parcel?.booking_id?'booking_pending':'unbooked';
 return {status,tracking_number:tracking};
}

// Keep actual receipt history while deriving delivery from surviving original
// purchased units. Retiring every unit never manufactures a delivery timestamp.
export function originalParcelReceiptProgress(units:readonly {received_at:string|null;cancelled?:boolean}[]){
 const active=units.filter(unit=>!unit.cancelled),received=active.filter(unit=>unit.received_at!==null);
 return {received_quantity:units.filter(unit=>unit.received_at!==null).length,active_quantity:active.length,active_received_quantity:received.length,
  delivered_at:active.length>0&&received.length===active.length?new Date(Math.max(...received.map(unit=>new Date(unit.received_at as string).getTime()))).toISOString():null};
}

export async function lockFulfillment(tx:TransactionSql,fulfillmentId:string){
 const [prior]=await tx`select f.id,s.order_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where f.id=${id(fulfillmentId)}`;
 if(!prior)throw new AccessError(404,'NOT_FOUND');const order=await lockPaymentOrder(tx,prior.order_id);
 const [head]=await tx`select f.*,s.warehouse_id,s.order_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where f.id=${prior.id} for update of f`;
 return {order,head};
}
export async function fulfillmentClock(tx:TransactionSql,namespace:string|null){const [clock]=await tx`select app.reservation_clock(${namespace}) now`;return new Date(clock.now).toISOString();}
type Change={kind:string;status:string;source_kind:string;source_id:string;reason:string;occurred_at:string;actor_id?:string|null;public_explanation?:string|null;deadline_id?:string|null;calendar_error?:string|null;prepared_at?:string|null;waybill_issued_at?:string|null;tracking_number?:string|null;handover_at?:string|null;handover_reference?:string|null;booking_id?:string|null};
export async function advanceFulfillment(tx:TransactionSql,head:Record<string,unknown>,change:Change,eventId=randomUUID()){
 const pick=(field:keyof Change)=>change[field]===undefined?head[field]:change[field];
 await tx`insert into app.fulfillment_event (id,fulfillment_id,revision,status,kind,source_kind,source_id,actor_id,public_explanation,deadline_id,reason,occurred_at)
  values (${eventId},${head.id as string},${Number(head.revision)+1},${change.status},${change.kind},${change.source_kind},${change.source_id},${change.actor_id??null},${change.public_explanation??null},${pick('deadline_id') as string|null},${change.reason},${change.occurred_at})`;
 const [current]=await tx`update app.fulfillment set revision=revision+1,status=${change.status},deadline_id=${pick('deadline_id') as string|null},calendar_error=${pick('calendar_error') as string|null},
  prepared_at=${pick('prepared_at') as string|null},waybill_issued_at=${pick('waybill_issued_at') as string|null},tracking_number=${pick('tracking_number') as string|null},handover_at=${pick('handover_at') as string|null},handover_reference=${pick('handover_reference') as string|null},booking_id=${pick('booking_id') as string|null}
  where id=${head.id as string} returning *`;
 return {head:current,eventId};
}
export async function appendDeadline(tx:TransactionSql,input:{fulfillment_id:string;source_id:string;calendar_version_id:string;calendar:ShippingCalendar;calendar_coverage:{id:string;values:ShippingCalendar}[];actionable_at:string;packing_due_at:string;handover_due_at?:string|null;handover_calendar_coverage?:{id:string;values:ShippingCalendar}[]|null},namespace:string|null){
 const [deadline]=await tx`insert into app.fulfillment_deadline (fulfillment_id,source_id,calendar_version_id,calendar,calendar_coverage,handover_calendar_coverage,actionable_at,packing_due_at,handover_due_at)
  values (${input.fulfillment_id},${input.source_id},${input.calendar_version_id},${JSON.stringify(input.calendar)}::jsonb,${JSON.stringify(input.calendar_coverage)}::jsonb,${input.handover_calendar_coverage?JSON.stringify(input.handover_calendar_coverage):null}::jsonb,${input.actionable_at},${input.packing_due_at},${input.handover_due_at??null}) returning *`;
 const now=await fulfillmentClock(tx,namespace);
 for(const kind of ['packing','handover']){
  const due=kind==='packing'?input.packing_due_at:input.handover_due_at;if(!due)continue;
  const job=await enqueueJob(tx,'fulfillment.deadline',`fulfillment-deadline:${deadline.id}:${kind}`,{deadlineId:deadline.id,kind});
  const delay=Math.max(0,Date.parse(due)-Date.parse(now));await tx`update app.outbox_job set run_at=clock_timestamp()+${delay}*interval '1 millisecond' where id=${job}`;
 }
 return deadline;
}
export const noticeMessages={calendar_missing:'Jadwal pemrosesan sedang diperiksa. Pesanan tetap tersimpan.',packing_overdue:'Penerbitan resi melewati jadwal. Tim kami sedang menindaklanjuti.',handover_overdue:'Serah terima paket ke kurir melewati jadwal. Tim kami sedang menindaklanjuti.',booking_failed:'Penerbitan resi belum berhasil. Tim kami sedang menindaklanjuti.',rescheduled:'Jadwal pemrosesan diperbarui. Tenggat sebelumnya tetap tercatat.'};
export async function appendNotice(tx:TransactionSql,fulfillmentId:string,sourceId:string,kind:keyof typeof noticeMessages,occurredAt:string,explanation?:string){
 const [prior]=await tx`select id from app.fulfillment_notice where fulfillment_id=${fulfillmentId} and source_id=${sourceId} and kind=${kind}`;if(prior)return String(prior.id);
 const noticeId=randomUUID(),job=await enqueueJob(tx,'fulfillment.notice',`fulfillment-notice:${noticeId}`,{noticeId});
 const message=explanation?`${noticeMessages[kind]} ${explanation}`:noticeMessages[kind];
 await tx`insert into app.fulfillment_notice (id,fulfillment_id,source_id,kind,job_id,message,occurred_at) values (${noticeId},${fulfillmentId},${sourceId},${kind},${job},${message},${occurredAt})`;return noticeId;
}
export async function initializeFulfillments(tx:TransactionSql,orderId:string){
 const [installed]=await tx`select to_regclass('app.fulfillment') is not null installed`;if(!installed.installed)return;
 const order=await lockPaymentOrder(tx,orderId);if(!order.actionable_at)return;
 const shipments=await tx`select id,warehouse_id from app.order_shipment where order_id=${order.id} order by id`;
 const [source]=order.payment_method==='cod'?await tx`select id from app.cod_confirmation where order_id=${order.id}`:await tx`select source_id id from app.order_event where order_id=${order.id} and revision=2 and payment_status='confirmed'`;
 if(!source)throw new AccessError(503,'FULFILLMENT_ACTIVATION_INVALID');
 for(const shipment of shipments){
  if((await tx`select id from app.fulfillment where shipment_id=${shipment.id}`).length)continue;
  const anchor=new Date(order.actionable_at).toISOString(),eventId=randomUUID();
  const [head]=await tx`insert into app.fulfillment (shipment_id,created_at) values (${shipment.id},${anchor}) returning *`;
  let deadlineId:string|null=null,errorCode:string|null=null;
  try{const basis=await packingDeadline(tx,shipment.warehouse_id,anchor);const deadline=await appendDeadline(tx,{...basis,fulfillment_id:head.id,source_id:eventId},order.clock_namespace);deadlineId=deadline.id;}
  catch(error){if(!(error instanceof AccessError)||!['POLICY_UNCONFIGURED','CALENDAR_COVERAGE_MISSING','POLICY_INVALID'].includes(error.code))throw error;errorCode=error.code;}
  await advanceFulfillment(tx,head,{kind:'initialize',status:errorCode?'exception':'ready',source_kind:'activation',source_id:source.id,reason:errorCode?'Operational calendar needs configuration':'Original actionable parcel initialized',occurred_at:anchor,deadline_id:deadlineId,calendar_error:errorCode},eventId);
  if(errorCode)await appendNotice(tx,head.id,eventId,'calendar_missing',anchor);
 }
}
export async function deadlineForIssuance(tx:TransactionSql,head:Record<string,unknown>,eventId:string,issuedAt:string,namespace:string|null){
 const [basis]=await tx`select * from app.fulfillment_deadline where id=${head.deadline_id as string}`;if(!basis)throw new AccessError(409,'CALENDAR_UNCONFIGURED');
 let next:Awaited<ReturnType<typeof coveredOperationalDeadline>>|null=null,errorCode:string|null=null;
 try{const policy=await resolvePolicy(tx,'warehouse_calendar',head.warehouse_id as string,new Date(issuedAt));next=await coveredOperationalDeadline(tx,head.warehouse_id as string,policy,issuedAt,1);}
 catch(error){if(!(error instanceof AccessError)||!['POLICY_UNCONFIGURED','CALENDAR_COVERAGE_MISSING','POLICY_INVALID'].includes(error.code))throw error;errorCode=error.code;}
 const deadline=await appendDeadline(tx,{fulfillment_id:head.id as string,source_id:eventId,calendar_version_id:basis.calendar_version_id,calendar:basis.calendar as ShippingCalendar,calendar_coverage:basis.calendar_coverage,actionable_at:new Date(basis.actionable_at).toISOString(),packing_due_at:new Date(basis.packing_due_at).toISOString(),handover_due_at:next?.due_at,handover_calendar_coverage:next?.coverage},namespace);
 return {deadline,errorCode};
}
export async function projectFulfillment(tx:TransactionSql,fulfillmentId:string){
 const [schema]=await tx`select to_regclass('app.shipment_cancellation') is not null installed`;
 const pending=schema.installed?tx`exists(select 1 from app.shipment_cancellation c where c.booking_id=b.id and c.status in ('queued','acknowledged'))`:tx`false`;
 const [f]=await tx`select f.*,s.order_id,s.warehouse_id,q.document->'address' recipient,d.packing_due_at,d.handover_due_at,b.status booking_status,job.status creation_status,${pending} cancellation_pending from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id join app.commerce_order o on o.id=s.order_id join app.checkout_quote q on q.id=o.quote_id left join app.fulfillment_deadline d on d.id=f.deadline_id left join app.shipment_booking b on b.id=f.booking_id left join app.outbox_job job on job.id=b.creation_job_id where f.id=${id(fulfillmentId)}`;
 if(!f)throw new AccessError(404,'NOT_FOUND');
 const cancelled=schema.installed?tx`exists(select 1 from app.exception_cancellation cancelled where cancelled.fulfillment_item_id=unit.id and cancelled.replacement_link_id is null)`:tx`false`;
 const items=await tx`select unit.id fulfillment_item_id,unit.order_item_id,${cancelled} cancelled from app.fulfillment_item unit where unit.shipment_id=${f.shipment_id} order by unit.id`;
 const physical=schema.installed?(f.handover_at?tx`and fi.id in (select id from app.waybill_request_unit_ids(${f.booking_id}::uuid))`:tx`and not exists(select 1 from app.exception_cancellation cancelled where cancelled.fulfillment_item_id=fi.id and cancelled.replacement_link_id is null)`):tx``;
 const picks=await tx`select a.fulfillment_item_id,i.id order_item_id,i.offer_id variant_id,v.catalog_id,stock.sku,stock.name,a.quantity,a.stock_item_id,b.lot_id from app.fulfillment_component_allocation a join app.fulfillment_item fi on fi.id=a.fulfillment_item_id join app.order_item i on i.id=fi.order_item_id join app.offer v on v.id=i.offer_id join app.stock_item stock on stock.id=a.stock_item_id join app.inventory_balance b on b.id=a.balance_id where fi.shipment_id=${f.shipment_id} ${physical} order by a.fulfillment_item_id,a.balance_id`;
 const notices=await tx`select id,kind,message,occurred_at from app.fulfillment_notice where fulfillment_id=${f.id} order by occurred_at desc,id desc limit 500`;
 return {id:f.id,order_id:f.order_id,warehouse_id:f.warehouse_id,status:f.status,version:f.revision,shipment_id:f.shipment_id,booking_id:f.booking_id,booking_status:f.booking_status??null,operation_status:f.creation_status==='completed'?'succeeded':f.creation_status==='pending'?'queued':f.creation_status??null,calendar_error:f.calendar_error,
  packing_due_at:f.packing_due_at?new Date(f.packing_due_at).toISOString():null,handover_due_at:f.handover_due_at?new Date(f.handover_due_at).toISOString():null,prepared_at:f.prepared_at?new Date(f.prepared_at).toISOString():null,waybill_issued_at:f.waybill_issued_at?new Date(f.waybill_issued_at).toISOString():null,handover_at:f.handover_at?new Date(f.handover_at).toISOString():null,tracking_number:originalWaybillProgress(f).tracking_number,
  items:items.map(i=>({...i,quantity:1})),pick_items:picks.map(p=>({...p,...(!p.lot_id?{lot_id:undefined}:{})})),recipient:{recipient_name:f.recipient.recipient_name,phone:f.recipient.phone,address_line:f.recipient.address_line,destination_id:f.recipient.destination_id,postal_code:f.recipient.postal_code},notices:notices.map(e=>({...e,occurred_at:new Date(e.occurred_at).toISOString()}))};
}
export async function buyerFulfillmentProgress(tx:TransactionSql,orderId:string){
 const [installed]=await tx`select to_regclass('app.fulfillment') is not null installed,to_regclass('app.shipment_cancellation') is not null cancellation_installed`;if(!installed.installed)return {parcels:[],notices:[]};
 const pending=installed.cancellation_installed?tx`exists(select 1 from app.shipment_cancellation c where c.booking_id=b.id and c.status in ('queued','acknowledged'))`:tx`false`;
 const parcels=await tx`select f.shipment_id,f.prepared_at,f.waybill_issued_at,f.tracking_number,f.handover_at,f.booking_id,b.status booking_status,job.status creation_status,${pending} cancellation_pending from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id left join app.shipment_booking b on b.id=f.booking_id left join app.outbox_job job on job.id=b.creation_job_id where s.order_id=${orderId}`;
 const notices=await tx`select n.id,f.shipment_id,n.kind,n.message,n.occurred_at,n.available_at from app.fulfillment_notice n join app.fulfillment f on f.id=n.fulfillment_id join app.order_shipment s on s.id=f.shipment_id where s.order_id=${orderId} and n.available_at is not null order by n.occurred_at desc,n.id desc limit 500`;
 return {parcels,notices:notices.map(n=>({...n,occurred_at:new Date(n.occurred_at).toISOString(),available_at:new Date(n.available_at).toISOString()}))};
}
