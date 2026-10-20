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

export type WaybillCancellationEvent={id:string;operation_id:string;cancellation_id:string;booking_id:string;environment:'local'|'test';status:'acknowledged'|'cancelled'|'failed';source_operation_id:string|null;source_status:'absent'|'acknowledged'|'issued'|'failed'|null;tracking_number:string|null;failure_code:'CANCELLATION_REJECTED'|'TEMPORARY_UNAVAILABLE'|null;occurred_at:string;signature:string};
function canonical(e:Omit<WaybillCancellationEvent,'signature'>){return JSON.stringify(['99ribu-waybill-cancel-simulator-v1',e.environment,e.id,e.operation_id,e.cancellation_id,e.booking_id,e.status,e.source_operation_id,e.source_status,e.tracking_number,e.failure_code,e.occurred_at]);}
function signature(e:Omit<WaybillCancellationEvent,'signature'>){return createHmac('sha256',localSigningKey(e.environment)).update(canonical(e)).digest('hex');}
async function profile(tx:TransactionSql,target:'local'|'test'){
 readLocalConfig(process.env);if(!['local','test'].includes(target))throw invalid();
 const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`)throw invalid();
}
function project(row:Record<string,unknown>):WaybillCancellationEvent{
 return {id:String(row.id),operation_id:String(row.operation_id),cancellation_id:String(row.cancellation_id),booking_id:String(row.booking_id),environment:row.environment as WaybillCancellationEvent['environment'],status:row.status as WaybillCancellationEvent['status'],source_operation_id:row.source_operation_id?String(row.source_operation_id):null,source_status:row.source_status as WaybillCancellationEvent['source_status'],tracking_number:row.tracking_number?String(row.tracking_number):null,failure_code:row.failure_code as WaybillCancellationEvent['failure_code'],occurred_at:new Date(row.occurred_at as string).toISOString(),signature:String(row.signature)};
}
export function verifyWaybillCancellationEvent(value:unknown):WaybillCancellationEvent{
 const b=object(value,['id','operation_id','cancellation_id','booking_id','environment','status','source_operation_id','source_status','tracking_number','failure_code','occurred_at','signature']);
 if(typeof b.environment!=='string'||!['local','test'].includes(b.environment)||typeof b.status!=='string'||!['acknowledged','cancelled','failed'].includes(b.status)||typeof b.signature!=='string'||!/^[a-f0-9]{64}$/.test(b.signature))throw invalid();
 if(b.status==='acknowledged'){
  if(b.source_operation_id!==null||b.source_status!==null||b.tracking_number!==null||b.failure_code!==null)throw invalid();
 }else{
  if(typeof b.source_status!=='string'||!['absent','acknowledged','issued','failed'].includes(b.source_status)||(b.source_status==='absent'?b.source_operation_id!==null:b.source_operation_id===null)
    ||(b.source_status==='issued'?typeof b.tracking_number!=='string'||!/^LOCAL-[A-F0-9]{32}$/.test(b.tracking_number):b.tracking_number!==null)
    ||(b.status==='cancelled'?b.failure_code!==null:typeof b.failure_code!=='string'||!['CANCELLATION_REJECTED','TEMPORARY_UNAVAILABLE'].includes(b.failure_code)))throw invalid();
 }
 const event:WaybillCancellationEvent={id:id(b.id),operation_id:id(b.operation_id),cancellation_id:id(b.cancellation_id),booking_id:id(b.booking_id),environment:b.environment as WaybillCancellationEvent['environment'],status:b.status as WaybillCancellationEvent['status'],source_operation_id:b.source_operation_id===null?null:id(b.source_operation_id),source_status:b.source_status as WaybillCancellationEvent['source_status'],tracking_number:b.tracking_number as string|null,failure_code:b.failure_code as WaybillCancellationEvent['failure_code'],occurred_at:instant(b.occurred_at),signature:b.signature};
 if(!timingSafeEqual(Buffer.from(event.signature,'hex'),Buffer.from(signature(event),'hex')))throw new AccessError(401,'INVALID_WAYBILL_CANCELLATION_SIGNATURE');return event;
}
export async function readWaybillCancellationEvent(tx:TransactionSql,eventId:string){
 const [row]=await tx`select e.*,o.cancellation_id,o.environment,c.booking_id from app.local_waybill_cancellation_event e join app.local_waybill_cancellation o on o.id=e.operation_id join app.shipment_cancellation c on c.id=o.cancellation_id where e.id=${id(eventId)}`;
 return row?project(row):null;
}
export async function readWaybillCancellationEvents(tx:TransactionSql,cancellationId:string){
 const rows=await tx`select e.*,o.cancellation_id,o.environment,c.booking_id from app.local_waybill_cancellation_event e join app.local_waybill_cancellation o on o.id=e.operation_id join app.shipment_cancellation c on c.id=o.cancellation_id where c.id=${id(cancellationId)} order by e.recorded_at,e.id limit 1001`;
 if(rows.length>1000)throw new AccessError(503,'WAYBILL_CANCELLATION_RECOVERY_LIMIT');return rows.map(project);
}
async function emit(tx:TransactionSql,operation:Record<string,unknown>,bookingId:string){
 const event:WaybillCancellationEvent={id:randomUUID(),operation_id:String(operation.id),cancellation_id:String(operation.cancellation_id),booking_id:bookingId,environment:operation.environment as WaybillCancellationEvent['environment'],status:operation.status as WaybillCancellationEvent['status'],source_operation_id:operation.source_operation_id?String(operation.source_operation_id):null,source_status:operation.source_status as WaybillCancellationEvent['source_status'],tracking_number:operation.tracking_number?String(operation.tracking_number):null,failure_code:operation.failure_code as WaybillCancellationEvent['failure_code'],occurred_at:new Date((operation.terminal_at??operation.created_at) as string).toISOString(),signature:''};event.signature=signature(event);
 await tx`insert into app.local_waybill_cancellation_event (id,operation_id,status,source_operation_id,source_status,tracking_number,failure_code,occurred_at,signature) values (${event.id},${event.operation_id},${event.status},${event.source_operation_id},${event.source_status},${event.tracking_number},${event.failure_code},${event.occurred_at},${event.signature})`;return event;
}
// Fence the original source creator BEFORE taking its parent order. An absent
// source observed under this lock cannot race a still-running original creator.
export async function lockWaybillCancellation(tx:TransactionSql,cancellationId:string){
 const [selected]=await tx`select c.*,b.fulfillment_id,b.creation_job_id original_creation_job_id from app.shipment_cancellation c join app.shipment_booking b on b.id=c.booking_id where c.id=${id(cancellationId)}`;
 if(!selected)throw new AccessError(404,'NOT_FOUND');
 await tx`select id from app.outbox_job where id=${selected.original_creation_job_id} for update`;
 const state=await lockFulfillment(tx,selected.fulfillment_id);
 const [cancellation]=await tx`select * from app.shipment_cancellation where id=${selected.id} for update`;
 return {...state,cancellation};
}
export async function createWaybillCancellationOperation(sql:Sql,target:'local'|'test',cancellationId:string,claim:Claim,reconciliation=false,beforeCommit=false){
 return sql.begin(async tx=>{
  await profile(tx,target);const selected=id(cancellationId);
  const [lease]=await tx`select id from app.outbox_job where id=${claim.id} and kind='shipping.cancel.create' and dedup_key=${`shipping-cancel:${selected}`} and payload=${JSON.stringify({cancellationId:selected})}::jsonb and status='processing' and lease_token=${claim.token} and lease_until>clock_timestamp() and dispatched_at is not null for share`;
  if(!lease)throw new AccessError(409,'STALE_SHIPPING_CANCELLATION_CLAIM');
  const {head,order,cancellation}=await lockWaybillCancellation(tx,selected);
  if(cancellation.creation_job_id!==claim.id)throw new AccessError(400,'INVALID_SHIPPING_CANCELLATION_JOB');
  let [operation]=await tx`select * from app.local_waybill_cancellation where cancellation_id=${selected}`;
  if(!operation&&reconciliation)return null;
  if(!operation){
   if(head.handover_at||head.booking_id!==cancellation.booking_id||cancellation.status!=='queued')throw new AccessError(409,'WAYBILL_CANCELLATION_NOT_ELIGIBLE');
   const [current]=await tx`select id from app.outbox_job where id=${claim.id} and lease_token=${claim.token} and lease_until>clock_timestamp()`;if(!current)throw new AccessError(409,'STALE_SHIPPING_CANCELLATION_CLAIM');
   const hash=createHash('sha256').update(JSON.stringify({cancellation_id:selected,booking_id:cancellation.booking_id})).digest('hex');
   [operation]=await tx`insert into app.local_waybill_cancellation (cancellation_id,environment,request_hash,created_at) values (${selected},${target},${hash},${await fulfillmentClock(tx,order.clock_namespace)}) returning *`;
   await emit(tx,operation,String(cancellation.booking_id));
  }
  if(operation.environment!==target)throw invalid();if(beforeCommit)throw new Error('Simulated waybill cancellation source rollback before commit');
  return {operation_id:String(operation.id),events:await readWaybillCancellationEvents(tx,selected)};
 });
}
export async function simulateWaybillCancellation(sql:Sql,target:'local'|'test',cancellationId:string,status:'cancelled'|'failed'='cancelled',failureCode:'CANCELLATION_REJECTED'|'TEMPORARY_UNAVAILABLE'='CANCELLATION_REJECTED',fault?:'before-commit'|'after-commit-lost-ack'){
 const event=await sql.begin(async tx=>{
  await profile(tx,target);if(!['cancelled','failed'].includes(status)||!['CANCELLATION_REJECTED','TEMPORARY_UNAVAILABLE'].includes(failureCode))throw invalid();
  const {head,order,cancellation}=await lockWaybillCancellation(tx,cancellationId);
  const [operation]=await tx`select * from app.local_waybill_cancellation where cancellation_id=${cancellation.id} for update`;if(!operation)throw new AccessError(409,'WAYBILL_CANCELLATION_NOT_ACKNOWLEDGED');
  if(operation.environment!==target)throw invalid();
  if(operation.status!=='acknowledged'&&(operation.status!==status||(status==='failed'&&operation.failure_code!==failureCode)))throw new AccessError(409,'WAYBILL_CANCELLATION_EFFECT_FINAL');
  let current=operation;
  if(operation.status==='acknowledged'){
   if(head.handover_at||head.booking_id!==cancellation.booking_id)throw new AccessError(409,'WAYBILL_CANCELLATION_NOT_ELIGIBLE');
   const [source]=await tx`select id,status,tracking_number from app.local_waybill_operation where booking_id=${cancellation.booking_id} for update`;
   [current]=await tx`update app.local_waybill_cancellation set status=${status},source_operation_id=${source?.id??null},source_status=${source?.status??'absent'},tracking_number=${source?.tracking_number??null},failure_code=${status==='failed'?failureCode:null},terminal_at=${await fulfillmentClock(tx,order.clock_namespace)} where id=${operation.id} returning *`;
  }
  const event=await emit(tx,current,String(cancellation.booking_id));if(fault==='before-commit')throw new Error('Simulated waybill cancellation rollback before commit');return event;
 });
 if(fault==='after-commit-lost-ack')throw new Error('Simulated waybill cancellation acknowledgement loss after commit');return event;
}
export async function registerWaybillCancellationEvent(tx:TransactionSql,value:unknown){
 const event=verifyWaybillCancellationEvent(value);await profile(tx,event.environment);
 const source=await readWaybillCancellationEvent(tx,event.id);if(!source||canonical(source)!==canonical(event)||source.signature!==event.signature)throw new AccessError(401,'INVALID_WAYBILL_CANCELLATION_EVIDENCE');
 await tx`select pg_advisory_xact_lock(hashtextextended(${`waybill-cancel-event:${event.id}`},0))`;
 const hash=createHash('sha256').update(canonical(event)).digest('hex'),[prior]=await tx`select payload_hash,callback_job_id from app.waybill_cancellation_provider_event where id=${event.id}`;
 if(prior){if(prior.payload_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return String(prior.callback_job_id);}
 const job=await enqueueJob(tx,'shipping.cancel.callback',`shipping-cancel-callback:${event.id}`,{eventId:event.id});
 await tx`insert into app.waybill_cancellation_provider_event (id,cancellation_id,payload_hash,callback_job_id) values (${event.id},${event.cancellation_id},${hash},${job})`;return job;
}
export async function ingestWaybillCancellationEvent(sql:Sql,value:unknown){return sql.begin(tx=>registerWaybillCancellationEvent(tx,value));}
// Existing authentic observations remain readable; only a NEW original source
// or new issuance is forbidden once the provider itself confirms cancellation.
export async function isWaybillSourceCancelled(tx:TransactionSql,bookingId:string){
 const [schema]=await tx`select to_regclass('app.local_waybill_cancellation') is not null installed`;
 return Boolean(schema.installed&&(await tx`select o.id from app.local_waybill_cancellation o join app.shipment_cancellation c on c.id=o.cancellation_id where c.booking_id=${id(bookingId)} and o.status='cancelled' limit 1`).length);
}
export async function assertWaybillCancellationClear(tx:TransactionSql,bookingId:string|null,allowConfirmed=false){
 if(!bookingId)return;
 const [schema]=await tx`select to_regclass('app.shipment_cancellation') is not null installed`;
 if(schema.installed&&(await tx`select id from app.shipment_cancellation where booking_id=${id(bookingId)} and (status in ('queued','acknowledged') or (not ${allowConfirmed} and status='cancelled')) limit 1`).length)throw new AccessError(409,'WAYBILL_CANCELLATION_IN_PROGRESS');
}
