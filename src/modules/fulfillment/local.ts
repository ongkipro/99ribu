import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import type {Claim} from '../../jobs/leases.ts';
import {enqueueJob} from '../../jobs/outbox.ts';
import {readLocalConfig} from '../../config/local.ts';
import {localSigningKey} from '../access/local-key.ts';
import {AccessError} from '../access/policy.ts';
import {id,invalid,object} from '../catalog/validation.ts';
import {instant} from '../promotions/configuration.ts';
import {fulfillmentClock,lockFulfillment} from './core.ts';
import {collectionUnitTotals} from '../finance/receipt-units.ts';
import {isWaybillSourceCancelled} from './cancellation-source.ts';

// cod_due includes each unit's frozen buyer-paid COD fee share (DEC-009), as app.waybill_current_request_basis does.
export function waybillRequestBasis(units:readonly {id:string;unit_price:number;buyer_shipping:number;payment_charge?:number}[],paymentMethod:'cod'|'prepaid'){
 if(!['cod','prepaid'].includes(paymentMethod))throw invalid();
 const basis=collectionUnitTotals(units);if(!basis.unit_ids.length)throw new AccessError(409,'SHIPPING_SOURCE_NOT_ELIGIBLE');
 return {unit_ids:basis.unit_ids,cod_due:paymentMethod==='cod'?basis.amount:0};
}

export type WaybillEvent={id:string;operation_id:string;booking_id:string;environment:'local'|'test';status:'acknowledged'|'issued'|'failed';tracking_number:string|null;occurred_at:string;signature:string};
function canonical(e:Omit<WaybillEvent,'signature'>){return JSON.stringify(['99ribu-waybill-simulator-v1',e.environment,e.id,e.operation_id,e.booking_id,e.status,e.tracking_number,e.occurred_at]);}
function signature(e:Omit<WaybillEvent,'signature'>){return createHmac('sha256',localSigningKey(e.environment)).update(canonical(e)).digest('hex');}
async function profile(tx:TransactionSql,target:'local'|'test'){readLocalConfig(process.env);if(!['local','test'].includes(target))throw invalid();const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`)throw invalid();}
function project(row:Record<string,unknown>):WaybillEvent{return {id:String(row.id),operation_id:String(row.operation_id),booking_id:String(row.booking_id),environment:row.environment as WaybillEvent['environment'],status:row.status as WaybillEvent['status'],tracking_number:row.tracking_number?String(row.tracking_number):null,occurred_at:new Date(row.occurred_at as string).toISOString(),signature:String(row.signature)};}
export function verifyWaybillEvent(value:unknown):WaybillEvent{
 const b=object(value,['id','operation_id','booking_id','environment','status','tracking_number','occurred_at','signature']);
 if(!['local','test'].includes(String(b.environment))||!['acknowledged','issued','failed'].includes(String(b.status))||typeof b.signature!=='string'||!/^[a-f0-9]{64}$/.test(b.signature)||(b.status==='issued'?typeof b.tracking_number!=='string'||!/^LOCAL-[A-F0-9]{32}$/.test(b.tracking_number):b.tracking_number!==null))throw invalid();
 const event:WaybillEvent={id:id(b.id),operation_id:id(b.operation_id),booking_id:id(b.booking_id),environment:b.environment as WaybillEvent['environment'],status:b.status as WaybillEvent['status'],tracking_number:b.tracking_number as string|null,occurred_at:instant(b.occurred_at),signature:b.signature};
 if(!timingSafeEqual(Buffer.from(event.signature,'hex'),Buffer.from(signature(event),'hex')))throw new AccessError(401,'INVALID_WAYBILL_SIGNATURE');return event;
}
export async function readWaybillEvents(tx:TransactionSql,bookingId:string){const rows=await tx`select e.*,o.booking_id,o.environment from app.local_waybill_event e join app.local_waybill_operation o on o.id=e.operation_id where o.booking_id=${id(bookingId)} order by e.recorded_at,e.id limit 1001`;if(rows.length>1000)throw new AccessError(503,'WAYBILL_RECOVERY_LIMIT');return rows.map(project);}
export async function readWaybillEvent(tx:TransactionSql,eventId:string){const [row]=await tx`select e.*,o.booking_id,o.environment from app.local_waybill_event e join app.local_waybill_operation o on o.id=e.operation_id where e.id=${id(eventId)}`;return row?project(row):null;}
async function emit(tx:TransactionSql,operation:Record<string,unknown>){
 const event:WaybillEvent={id:randomUUID(),operation_id:String(operation.id),booking_id:String(operation.booking_id),environment:operation.environment as WaybillEvent['environment'],status:operation.status as WaybillEvent['status'],tracking_number:operation.tracking_number?String(operation.tracking_number):null,occurred_at:new Date((operation.terminal_at??operation.created_at) as string).toISOString(),signature:''};event.signature=signature(event);
 await tx`insert into app.local_waybill_event (id,operation_id,status,tracking_number,occurred_at,signature) values (${event.id},${event.operation_id},${event.status},${event.tracking_number},${event.occurred_at},${event.signature})`;return event;
}
export async function createWaybillOperation(sql:Sql,target:'local'|'test',bookingId:string,claim:Claim,reconciliation=false,beforeCommit=false){
 return sql.begin(async tx=>{
  await profile(tx,target);
  // The exact current lease gates creation as well as acknowledgement. A stale
  // process cannot create a source effect after a verified absence lookup.
  const [lease]=await tx`select id from app.outbox_job where id=${claim.id} and status='processing' and lease_token=${claim.token} and lease_until>clock_timestamp() and dispatched_at is not null for share`;if(!lease)throw new AccessError(409,'STALE_SHIPPING_CLAIM');
  const [booking]=await tx`select * from app.shipment_booking where id=${id(bookingId)} and creation_job_id=${claim.id}`;if(!booking)throw new AccessError(400,'INVALID_SHIPPING_JOB');
  const {head,order}=await lockFulfillment(tx,booking.fulfillment_id);await tx`select pg_advisory_xact_lock(hashtextextended(${`waybill-source:${booking.id}`},0))`;
  let [operation]=await tx`select * from app.local_waybill_operation where booking_id=${booking.id}`;
  if(!operation&&await isWaybillSourceCancelled(tx,booking.id))throw new AccessError(409,'WAYBILL_SOURCE_CANCELLED');
  if(!operation&&reconciliation)return null;
  if(!operation){
   const [currentClaim]=await tx`select id from app.outbox_job where id=${claim.id} and lease_token=${claim.token} and lease_until>clock_timestamp()`;if(!currentClaim)throw new AccessError(409,'STALE_SHIPPING_CLAIM');
   if(!head.prepared_at||head.booking_id!==booking.id||head.handover_at)throw new AccessError(409,'SHIPPING_SOURCE_NOT_ELIGIBLE');
   const [snapshot]=await tx`select s.snapshot,q.document->'address' address from app.order_shipment s join app.commerce_order o on o.id=s.order_id join app.checkout_quote q on q.id=o.quote_id where s.id=${head.shipment_id}`;
   const [schema]=await tx`select to_regclass('app.commerce_exception') is not null installed`;
   const units=schema.installed?await tx`select f.id,i.unit_price,f.buyer_shipping,f.payment_charge from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where f.shipment_id=${head.shipment_id} and not exists(select 1 from app.exception_cancellation cancelled where cancelled.fulfillment_item_id=f.id and cancelled.replacement_link_id is null) order by f.id`:[];
   const basis=schema.installed?waybillRequestBasis(units.map(unit=>({id:String(unit.id),unit_price:Number(unit.unit_price),buyer_shipping:Number(unit.buyer_shipping),payment_charge:Number(unit.payment_charge)})),order.payment_method):null;
   const hash=createHash('sha256').update(JSON.stringify({shipment_id:head.shipment_id,snapshot:snapshot.snapshot,address:snapshot.address,...(basis?{request_basis:basis}:{})})).digest('hex'),now=await fulfillmentClock(tx,order.clock_namespace);
   [operation]=basis?await tx`insert into app.local_waybill_operation (booking_id,environment,request_hash,request_basis,created_at) values (${booking.id},${target},${hash},${JSON.stringify(basis)}::jsonb,${now}) returning *`
    :await tx`insert into app.local_waybill_operation (booking_id,environment,request_hash,created_at) values (${booking.id},${target},${hash},${now}) returning *`;await emit(tx,operation);
  }
  if(operation.environment!==target)throw invalid();if(beforeCommit)throw new Error('Simulated waybill source rollback before commit');
  return {operation_id:String(operation.id),events:await readWaybillEvents(tx,booking.id)};
 });
}
export async function simulateWaybillIssue(sql:Sql,target:'local'|'test',bookingId:string,status:'issued'|'failed'='issued',fault?:'before-commit'|'after-commit-lost-ack'){
 const event=await sql.begin(async tx=>{
  await profile(tx,target);if(!['issued','failed'].includes(status))throw invalid();const [booking]=await tx`select * from app.shipment_booking where id=${id(bookingId)}`;if(!booking)throw new AccessError(404,'NOT_FOUND');
  const {order}=await lockFulfillment(tx,booking.fulfillment_id);const [operation]=await tx`select * from app.local_waybill_operation where booking_id=${booking.id} for update`;if(!operation)throw new AccessError(409,'WAYBILL_NOT_ACKNOWLEDGED');
  if(operation.status!=='acknowledged'&&operation.status!==status)throw new AccessError(409,'WAYBILL_EFFECT_FINAL');
  let current=operation;
  if(operation.status==='acknowledged'){
   if(await isWaybillSourceCancelled(tx,booking.id))throw new AccessError(409,'WAYBILL_SOURCE_CANCELLED');
   [current]=await tx`update app.local_waybill_operation set status=${status},tracking_number=${status==='issued'?`LOCAL-${operation.id.replaceAll('-','').toUpperCase()}`:null},terminal_at=${await fulfillmentClock(tx,order.clock_namespace)} where id=${operation.id} returning *`;
  }
  const event=await emit(tx,current);if(fault==='before-commit')throw new Error('Simulated waybill issuance rollback before commit');return event;
 });
 if(fault==='after-commit-lost-ack')throw new Error('Simulated waybill issuance acknowledgement loss after commit');return event;
}
export async function registerWaybillEvent(tx:TransactionSql,value:unknown){
 const event=verifyWaybillEvent(value);await profile(tx,event.environment);const source=await readWaybillEvent(tx,event.id);if(!source||canonical(source)!==canonical(event)||source.signature!==event.signature)throw new AccessError(401,'INVALID_WAYBILL_EVIDENCE');
 await tx`select pg_advisory_xact_lock(hashtextextended(${`waybill-event:${event.id}`},0))`;const hash=createHash('sha256').update(canonical(event)).digest('hex'),[prior]=await tx`select payload_hash,callback_job_id from app.waybill_provider_event where id=${event.id}`;
 if(prior){if(prior.payload_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return String(prior.callback_job_id);}
 const job=await enqueueJob(tx,'shipping.callback',`shipping-callback:${event.id}`,{eventId:event.id});await tx`insert into app.waybill_provider_event (id,booking_id,payload_hash,callback_job_id) values (${event.id},${event.booking_id},${hash},${job})`;return job;
}
export async function ingestWaybillEvent(sql:Sql,value:unknown){return sql.begin(tx=>registerWaybillEvent(tx,value));}
