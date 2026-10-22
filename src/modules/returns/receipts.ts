import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {id,integer,object} from '../catalog/validation.ts';
import {fulfillmentClock} from '../fulfillment/core.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';
import {returnDeadline} from './policy.ts';
import {readParcelReceiptSource,verifyParcelReceiptSource} from './receipt-source.ts';
import {readReturnOccurrences} from './occurrences.ts';
import {enqueueCommissionReceipt} from '../commissions/jobs.ts';

export async function processParcelReceipt(tx:TransactionSql,job:{id:string;payload:unknown}){
 const input=object(job.payload,['eventId']),eventId=id(input.eventId);
 const [registered]=await tx`select p.id,s.order_id from app.parcel_receipt_provider_event p join app.local_parcel_receipt e on e.id=p.id join app.order_shipment s on s.id=e.shipment_id where p.id=${eventId} and p.callback_job_id=${job.id}`;
 if(!registered)throw new AccessError(400,'INVALID_PARCEL_RECEIPT_JOB');
 const order=await lockPaymentOrder(tx,registered.order_id),[prior]=await tx`select outcome,receipt_count from app.parcel_receipt_result where event_id=${eventId}`;
 if(prior)return {event_id:eventId,outcome:String(prior.outcome),receipt_count:Number(prior.receipt_count)};
 const original=await readParcelReceiptSource(tx,eventId);if(!original)throw new AccessError(400,'INVALID_PARCEL_RECEIPT_JOB');const event=verifyParcelReceiptSource(original);
 const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${event.environment}`||event.clock_namespace!==order.clock_namespace)throw new AccessError(409,'PARCEL_RECEIPT_CONTEXT_MISMATCH');
 const [head]=await tx`select f.id,f.handover_at,f.booking_id,b.status booking_status,exists(select 1 from app.fulfillment_event e where e.fulfillment_id=f.id and e.kind='manual_issued') manual from app.fulfillment f left join app.shipment_booking b on b.id=f.booking_id where f.shipment_id=${event.shipment_id} for share of f`;
 const now=await fulfillmentClock(tx,order.clock_namespace);
 if(!head?.handover_at||head.booking_id!==event.booking_id||(event.booking_id===null?!head.manual:head.booking_status!=='issued')||Date.parse(event.occurred_at)<new Date(head.handover_at).getTime()||Date.parse(event.occurred_at)>Date.parse(now))throw new AccessError(409,'PARCEL_RECEIPT_SOURCE_NOT_ELIGIBLE');
 const units=await tx`select f.id from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where f.id in ${tx(event.unit_ids)} and f.shipment_id=${event.shipment_id} and i.order_id=${order.id} order by f.id for update of f`;
 if(units.length!==event.unit_ids.length)throw new AccessError(409,'PARCEL_RECEIPT_QUANTITY_MISMATCH');
 const [custody]=await tx`select to_regclass('app.local_parcel_outcome') is not null installed`;
 if(custody.installed){
  const membership=await tx`select membership.id from app.fulfillment_dispatch_unit_ids(${head.id}::uuid) membership where membership.id in ${tx(event.unit_ids)}`;
  if(membership.length!==event.unit_ids.length)throw new AccessError(409,'PARCEL_RECEIPT_QUANTITY_MISMATCH');
  const conflicts=await tx`select e.id,r.event_id processed from app.local_parcel_outcome e
   left join app.parcel_outcome_result r on r.event_id=e.id
   where e.shipment_id=${event.shipment_id} and e.booking_id is not distinct from ${event.booking_id}::uuid and e.environment=${event.environment}
    and e.clock_namespace is not distinct from ${order.clock_namespace} and e.status='returned_to_sender' and e.occurred_at<=${event.occurred_at}
    and exists(select 1 from app.fulfillment_item f where f.id in ${tx(event.unit_ids)} and e.unit_ids ? f.id::text
     and not exists(select 1 from app.buyer_receipt b where b.fulfillment_item_id=f.id))`;
  // A separately committed source may precede its callback. Reconcile it before
  // creating a new receipt anchor; an operational status is not custody proof.
  if(conflicts.some(row=>row.processed===null))throw new AccessError(409,'PARCEL_CUSTODY_RECONCILIATION_PENDING');
  if(conflicts.length){
   await tx`insert into app.parcel_receipt_result (event_id,outcome,reason,receipt_count) values (${event.id},'exception','Receipt evidence conflicts with prior physical return custody; reconcile original sources',0)`;
   return {event_id:event.id,outcome:'exception',receipt_count:0};
  }
 }
 let count=0;
 for(const unit of units){
  const [existing]=await tx`select id from app.buyer_receipt where fulfillment_item_id=${unit.id}`;if(existing)continue;
  await tx`insert into app.buyer_receipt (fulfillment_item_id,source_id,received_at) values (${unit.id},${event.id},${event.occurred_at})`;count++;
  await enqueueCommissionReceipt(tx,order.id,unit.id);
 }
 const outcome=count?'received':'duplicate',reason=count?'Original signed parcel evidence confirms actual buyer receipt':'Original per-unit receipt remains unchanged';
 await tx`insert into app.parcel_receipt_result (event_id,outcome,reason,receipt_count) values (${event.id},${outcome},${reason},${count})`;
 if(custody.installed&&count){
  const [progress]=await tx`select app.original_order_status(${order.id}::uuid) status`;
  if(progress.status==='partially_completed'&&order.status!==progress.status){
   await tx`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at)
    values (${order.id},${order.revision+1},'partially_completed',${order.payment_status},'All surviving original units have actual buyer receipts',${event.id},${event.occurred_at})`;
   await tx`update app.commerce_order set revision=revision+1,status='partially_completed' where id=${order.id}`;
  }
 }
 return {event_id:event.id,outcome,receipt_count:count};
}

// Internal projection: the caller must first authorize this exact original order.
// Receipt and active-claim identities are stable; money receipts are not used as
// a substitute for delivery or as a condition for submitting a faulty-item claim.
export async function projectReturnEligibility(tx:TransactionSql,orderId:string,limit=20,cursor:string|null=null){
 const selected=id(orderId),take=integer(limit,1,100),after=cursor===null?null:id(cursor);
 const [order]=await tx`select clock_namespace from app.commerce_order where id=${selected}`;if(!order)throw new AccessError(404,'NOT_FOUND');
 const now=await fulfillmentClock(tx,order.clock_namespace),rows=await readReturnOccurrences(tx,selected,{limit:take+1,after});
 const [installed]=await tx`select to_regclass('app.replacement_link') is not null installed`;
 const claims=rows.length?(installed.installed
  ?await tx`select coalesce(replacement_link_id,fulfillment_item_id) occurrence_id,case_id,claim_state from app.return_item where coalesce(replacement_link_id,fulfillment_item_id) in ${tx(rows.map(row=>row.id))} and claim_state<>'released'`
  :await tx`select fulfillment_item_id occurrence_id,case_id,claim_state from app.return_item where fulfillment_item_id in ${tx(rows.map(row=>row.id))} and claim_state<>'released'`):[];
 const chosen=rows.slice(0,take),data=chosen.map(row=>{
  const received=row.received_at===null?null:new Date(row.received_at).toISOString(),deadline=received===null?null:returnDeadline(received);
  if(received!==null&&Date.parse(received)>Date.parse(now))throw new AccessError(409,'PARCEL_RECEIPT_CONTEXT_MISMATCH');
  const claim=claims.find(item=>item.occurrence_id===row.id),state=claim?'already_claimed':received===null?'not_received':Date.parse(now)>Date.parse(deadline as string)?'window_expired':'eligible';
  return {fulfillment_item_id:String(row.id),order_item_id:String(row.order_item_id),shipment_id:String(row.shipment_id),unit_index:Number(row.unit_index),quantity:1,receipt_id:row.receipt_id,received_at:received,deadline_at:deadline,state,case_id:claim?String(claim.case_id):null,claim_state:claim?String(claim.claim_state):null,merchandise_amount:99000,buyer_shipping:Number(row.buyer_shipping)};
 });
 return {data,pagination:{next_cursor:rows.length>take?String(chosen.at(-1)?.id):null},as_of:now};
}
