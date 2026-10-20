import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {id} from '../catalog/validation.ts';
import {financeInstant} from '../finance/ledger.ts';
import {originalParcelReceiptProgress} from '../fulfillment/core.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';
import {returnText} from './policy.ts';

export type ReplacementHead={id:string;case_id:string;operation_id:string;warehouse_id:string;stock_reservation_id:string|null;revision:number;status:string;booking_id:string|null;buyer_shipping:string;cod_due:string;prepared_at:string|null;waybill_issued_at:string|null;tracking_number:string|null;handover_at:string|null;handover_reference:string|null;packing_due_at:string|null;calendar_snapshot:Record<string,unknown>|null;created_at:string;recorded_at:string};
type ReplacementPatch=Partial<Pick<ReplacementHead,'stock_reservation_id'|'booking_id'|'prepared_at'|'waybill_issued_at'|'tracking_number'|'handover_at'|'handover_reference'|'packing_due_at'|'calendar_snapshot'>>;
type ReplacementChange={kind:string;status:string;source_kind:'operation'|'job'|'provider'|'receipt'|'exception';source_id:string;actor_id?:string|null;reason:string;occurred_at:string;patch?:ReplacementPatch};

// Callers validate the changed quantities and their actual receipt/refund first.
export function replacementCaseComplete(items:readonly {id:string;claim_state:string}[],changedIds:readonly string[]){
 const changed=new Set(changedIds);
 return items.length>0&&items.every(item=>changed.has(item.id)||['replaced','refunded'].includes(item.claim_state));
}

// Order -> case -> replacement is shared by staff, workers and receipt intake.
// Actor locks, when needed, precede this function. No lookup grants authority.
export async function lockReplacement(tx:TransactionSql,shipmentId:string){
 const [before]=await tx`select s.case_id,c.order_id from app.replacement_shipment s join app.return_case c on c.id=s.case_id where s.id=${id(shipmentId)}`;
 if(!before)throw new AccessError(404,'NOT_FOUND');
 const order=await lockPaymentOrder(tx,before.order_id);
 const [returnCase]=await tx`select * from app.return_case where id=${before.case_id} for update`;
 const [head]=await tx<ReplacementHead[]>`select * from app.replacement_shipment where id=${shipmentId} for update`;
 return {order,returnCase,head};
}

export async function advanceReplacement(tx:TransactionSql,head:ReplacementHead,change:ReplacementChange){
 if(change.kind!=='create'&&head.revision===2147483647)throw new AccessError(409,'REPLACEMENT_VERSION_EXHAUSTED');
 const eventId=randomUUID(),revision=change.kind==='create'?1:head.revision+1;
 const next={...change.patch,revision,status:change.status};
 // PostgreSQL's own record conversion canonicalizes every typed timestamp in
 // the frozen head image. The event and head must seal to that same record.
 const [event]=await tx`insert into app.replacement_event (id,shipment_id,revision,kind,status,source_kind,source_id,actor_id,reason,snapshot,occurred_at)
  select ${eventId},s.id,${revision},${change.kind},${change.status},${change.source_kind},${change.source_id},${change.actor_id??null},${returnText(change.reason,500)},
   to_jsonb(jsonb_populate_record(null::app.replacement_shipment,to_jsonb(s)||${JSON.stringify(next)}::jsonb)),${financeInstant(change.occurred_at)}
  from app.replacement_shipment s where s.id=${head.id} returning snapshot`;
 if(change.kind==='create')return {head,eventId};
 // Use the native event's accepted clock/milestone image, including a real
 // boundary crossed while locks were acquired. Never write a pre-wait time.
 const value=event.snapshot as ReplacementHead;
 const [current]=await tx<ReplacementHead[]>`update app.replacement_shipment set revision=${revision},status=${value.status},stock_reservation_id=${value.stock_reservation_id},
  booking_id=${value.booking_id},prepared_at=${value.prepared_at},waybill_issued_at=${value.waybill_issued_at},tracking_number=${value.tracking_number},
  handover_at=${value.handover_at},handover_reference=${value.handover_reference},packing_due_at=${value.packing_due_at},calendar_snapshot=${value.calendar_snapshot===null?null:JSON.stringify(value.calendar_snapshot)}::jsonb
  where id=${head.id} returning *`;
 return {head:current,eventId};
}

// Caller owns exact case/shipment scope and keeps the parent row locked. This
// projection has neither financial sources nor customer contact information.
export async function projectReplacement(tx:TransactionSql,shipmentId:string){
 const [head]=await tx<ReplacementHead[]>`select * from app.replacement_shipment where id=${id(shipmentId)}`;
 if(!head)throw new AccessError(404,'NOT_FOUND');
 const [parent]=await tx`select revision from app.return_case where id=${head.case_id}`;
 const [schema]=await tx`select to_regclass('app.exception_cancellation') is not null installed`;
 const cancelled=schema.installed?tx`exists(select 1 from app.exception_cancellation cancellation where cancellation.replacement_link_id=link.id)`:tx`false`;
 const units=await tx`select link.id,link.return_item_id,link.original_fulfillment_item_id,link.predecessor_id,link.generation,f.order_item_id
  ,${cancelled} cancelled
  from app.replacement_link link join app.fulfillment_item f on f.id=link.original_fulfillment_item_id where link.shipment_id=${head.id} order by link.id`;
 const stamp=(value:string|null)=>value===null?null:new Date(value).toISOString();
 return {id:head.id,case_id:head.case_id,version:head.revision,case_version:Number(parent.revision),warehouse_id:head.warehouse_id,status:head.status,buyer_shipping:0,cod_due:0,
  booking_id:head.booking_id,prepared_at:stamp(head.prepared_at),waybill_issued_at:stamp(head.waybill_issued_at),tracking_number:head.tracking_number,
  handover_at:stamp(head.handover_at),packing_due_at:stamp(head.packing_due_at),created_at:stamp(head.created_at),
  items:units.map(unit=>({id:String(unit.id),return_item_id:String(unit.return_item_id),order_item_id:String(unit.order_item_id),quantity:1,
   original_fulfillment_item_id:String(unit.original_fulfillment_item_id),replacement_of:String(unit.predecessor_id??unit.original_fulfillment_item_id),generation:Number(unit.generation),...(schema.installed?{cancelled:Boolean(unit.cancelled)}:{})}))};
}

// The authorized buyer order can append physical replacement parcels without
// adding them to original COD collection or financial quantity calculations.
export async function buyerReplacementProgress(tx:TransactionSql,orderId:string){
 const [installed]=await tx`select to_regclass('app.replacement_shipment') is not null installed,to_regclass('app.exception_cancellation') is not null exceptions_installed`;if(!installed.installed)return [];
 const heads=await tx`select s.*,w.city,job.status creation_status from app.replacement_shipment s join app.return_case c on c.id=s.case_id
  join app.warehouse w on w.id=s.warehouse_id left join app.replacement_booking b on b.id=s.booking_id left join app.outbox_job job on job.id=b.creation_job_id
  where c.order_id=${id(orderId)} order by s.created_at,s.id`;
 if(!heads.length)return [];
 const cancelled=installed.exceptions_installed?tx`exists(select 1 from app.exception_cancellation cancellation where cancellation.replacement_link_id=link.id)`:tx`false`;
 const links=await tx<{id:string;shipment_id:string;predecessor_id:string|null;original_fulfillment_item_id:string;order_item_id:string;received_at:string|null;cancelled:boolean}[]>`select link.id,link.shipment_id,link.predecessor_id,link.original_fulfillment_item_id,f.order_item_id,receipt.received_at,${cancelled} cancelled
  from app.replacement_link link join app.fulfillment_item f on f.id=link.original_fulfillment_item_id
  left join app.replacement_buyer_receipt receipt on receipt.replacement_link_id=link.id where link.shipment_id in ${tx(heads.map(head=>head.id))} order by link.id`;
 return heads.map(head=>{
  const items=links.filter(link=>link.shipment_id===head.id),progress=originalParcelReceiptProgress(items);
  return {id:String(head.id),kind:'replacement',origin_city:String(head.city),status:items.length>0&&progress.active_quantity===0?'cancelled':head.status==='booking_pending'&&head.creation_status==='unknown'?'booking_unknown':head.status,
   received_quantity:progress.received_quantity,courier_name:'Simulasi pengiriman lokal',service_name:'Penggantian barang',buyer_shipping_amount:0,cod_collect_amount:0,
   ...(progress.delivered_at?{delivered_at:progress.delivered_at}:{}),
   ...(head.waybill_issued_at?{tracking_number:String(head.tracking_number),waybill_issued_at:new Date(head.waybill_issued_at).toISOString()}:{}),
   items:items.map(item=>({order_item_id:String(item.order_item_id),fulfillment_item_id:String(item.id),quantity:1,cancelled:Boolean(item.cancelled),replacement_of_fulfillment_item_id:String(item.predecessor_id??item.original_fulfillment_item_id)}))};
 });
}
