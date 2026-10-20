import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {readLocalConfig} from '../../config/local.ts';
import type {Claim,JobAdapter} from '../../jobs/leases.ts';
import {enqueueJob} from '../../jobs/outbox.ts';
import {localSigningKey} from '../access/local-key.ts';
import {AccessError} from '../access/policy.ts';
import {id,invalid,object} from '../catalog/validation.ts';
import {financeInstant} from '../finance/ledger.ts';
import {fulfillmentClock} from '../fulfillment/core.ts';
import {advanceReplacement,lockReplacement} from './replacement-core.ts';
import {lockReplacementStock} from './replacement-stock.ts';

type ShippingFault='before-commit'|'creation-commit-lost-ack'|'issuance-commit-lost-ack'|'rejected';
export type ReplacementWaybillEvent={id:string;operation_id:string;booking_id:string;environment:'local'|'test';status:'issued'|'failed';tracking_number:string|null;occurred_at:string;signature:string};
function canonical(event:Omit<ReplacementWaybillEvent,'signature'>){return JSON.stringify(['99ribu-replacement-waybill-simulator-v1',event.environment,event.id,event.operation_id,event.booking_id,event.status,event.tracking_number,event.occurred_at]);}
function sign(event:Omit<ReplacementWaybillEvent,'signature'>){return createHmac('sha256',localSigningKey(event.environment)).update(canonical(event)).digest('hex');}
export function verifyReplacementWaybillEvent(value:unknown):ReplacementWaybillEvent{
 const input=object(value,['id','operation_id','booking_id','environment','status','tracking_number','occurred_at','signature']);
 if(!['local','test'].includes(String(input.environment))||!['issued','failed'].includes(String(input.status))||typeof input.signature!=='string'||!/^[a-f0-9]{64}$/.test(input.signature)||(input.status==='issued'?typeof input.tracking_number!=='string'||!/^LOCAL-REPLACEMENT-[A-F0-9]{32}$/.test(input.tracking_number):input.tracking_number!==null))throw invalid();
 const event:ReplacementWaybillEvent={id:id(input.id),operation_id:id(input.operation_id),booking_id:id(input.booking_id),environment:input.environment as 'local'|'test',status:input.status as 'issued'|'failed',tracking_number:input.tracking_number as string|null,occurred_at:financeInstant(input.occurred_at),signature:input.signature};
 if(!timingSafeEqual(Buffer.from(sign(event),'hex'),Buffer.from(event.signature,'hex')))throw new AccessError(401,'INVALID_REPLACEMENT_WAYBILL_EVIDENCE');return event;
}
async function profile(tx:TransactionSql,target:'local'|'test'){
 readLocalConfig(process.env);if(!['local','test'].includes(target))throw invalid();const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`)throw invalid();
}
function project(row:Record<string,unknown>):ReplacementWaybillEvent{return {id:String(row.id),operation_id:String(row.operation_id),booking_id:String(row.booking_id),environment:row.environment as 'local'|'test',status:row.status as 'issued'|'failed',tracking_number:row.tracking_number===null?null:String(row.tracking_number),occurred_at:new Date(row.occurred_at as string).toISOString(),signature:String(row.signature)};}
export async function readReplacementWaybillEvent(tx:TransactionSql,eventId:string){const [row]=await tx`select e.*,op.booking_id,op.environment from app.local_replacement_event e join app.local_replacement_operation op on op.id=e.operation_id where e.id=${id(eventId)}`;return row?project(row):null;}
async function readEvents(tx:TransactionSql,bookingId:string){const rows=await tx`select e.*,op.booking_id,op.environment from app.local_replacement_event e join app.local_replacement_operation op on op.id=e.operation_id where op.booking_id=${id(bookingId)}`;return rows.map(project);}

export async function prepareReplacementShipping(sql:Sql,target:'local'|'test',claim:Claim,reconciliation=false,fault?:ShippingFault){
 const input=object(claim.payload,['bookingId']),bookingId=id(input.bookingId);if(claim.kind!=='replacement.shipping.create')throw invalid();
 return sql.begin(async tx=>{
  await profile(tx,target);const [before]=await tx`select shipment_id from app.replacement_booking where id=${bookingId} and creation_job_id=${claim.id}`;
  if(!before)throw new AccessError(400,'INVALID_REPLACEMENT_SHIPPING_JOB');
  const {head,order}=await lockReplacement(tx,before.shipment_id),[booking]=await tx`select * from app.replacement_booking where id=${bookingId} for update`;
  const [lease]=await tx`select id from app.outbox_job where id=${claim.id} and kind='replacement.shipping.create' and status='processing'
   and lease_token=${claim.token} and lease_until>clock_timestamp() and dispatched_at is not null
   and dedup_key=${`replacement-shipping-create:${bookingId}`} and payload=${JSON.stringify({bookingId})}::jsonb for share`;
  if(!lease)throw new AccessError(409,'STALE_REPLACEMENT_SHIPPING_CLAIM');
  let [operation]=await tx`select * from app.local_replacement_operation where booking_id=${bookingId}`;
  if(!operation&&reconciliation)return null;
  if(!operation){
   if(booking.status!=='queued'||head.booking_id!==bookingId||head.status!=='booking_pending'||!head.prepared_at||head.handover_at)throw new AccessError(409,'REPLACEMENT_BOOKING_NOT_CURRENT');
   await lockReplacementStock(tx,head.id,order.clock_namespace);
   const [destination]=await tx`select q.document->'address' address from app.commerce_order o join app.checkout_quote q on q.id=o.quote_id where o.id=${order.id}`;
   const [schema]=await tx`select to_regclass('app.exception_cancellation') is not null installed`;
   const active=schema.installed?tx`and link.id in (select id from app.replacement_request_unit_ids(${bookingId}::uuid))`:tx``;
   const links=await tx`select link.id,link.original_fulfillment_item_id from app.replacement_link link where link.shipment_id=${head.id} ${active} order by link.id`;
   if(!links.length)throw new AccessError(409,'REPLACEMENT_NO_ACTIVE_UNITS');
   const hash=createHash('sha256').update(JSON.stringify(['99ribu-replacement-shipping-request-v1',target,head.id,bookingId,head.warehouse_id,links,destination.address,0,order.clock_namespace])).digest('hex');
   const simulationProfile=fault==='creation-commit-lost-ack'?'creation_ack_lost':fault==='issuance-commit-lost-ack'?'issuance_ack_lost':fault==='rejected'?'rejected':'normal';
   [operation]=await tx`insert into app.local_replacement_operation (booking_id,environment,clock_namespace,profile,request_hash,status,created_at)
    values (${bookingId},${target},${order.clock_namespace},${simulationProfile},${hash},'created',${await fulfillmentClock(tx,order.clock_namespace)}) returning *`;
   await tx`update app.replacement_booking set status='processing',provider_operation_id=${operation.id} where id=${bookingId}`;
  }
  if(operation.environment!==target||operation.clock_namespace!==order.clock_namespace||booking.creation_job_id!==claim.id)throw new AccessError(409,'REPLACEMENT_PROVIDER_CONTEXT_MISMATCH');
  if(!reconciliation&&fault==='before-commit')throw new Error('Simulated replacement shipping source rollback before commit');
  return {operation_id:String(operation.id),events:await readEvents(tx,bookingId)};
 });
}

export async function simulateReplacementWaybill(sql:Sql,target:'local'|'test',bookingId:string,status:'issued'|'failed'='issued',fault?:'before-commit'|'after-commit-lost-ack'){
 const event=await sql.begin(async tx=>{
  await profile(tx,target);if(!['issued','failed'].includes(status))throw invalid();
  const [before]=await tx`select shipment_id from app.replacement_booking where id=${id(bookingId)}`;if(!before)throw new AccessError(404,'NOT_FOUND');
  const {head,order}=await lockReplacement(tx,before.shipment_id),[booking]=await tx`select * from app.replacement_booking where id=${bookingId} for update`;
  const [operation]=await tx`select * from app.local_replacement_operation where booking_id=${bookingId} for update`;
  if(!operation)throw new AccessError(409,'REPLACEMENT_SHIPPING_NOT_ACKNOWLEDGED');
  if(operation.status!==status&&operation.status!=='created')throw new AccessError(409,'REPLACEMENT_WAYBILL_EFFECT_FINAL');
  const [previous]=await tx`select id from app.local_replacement_event where operation_id=${operation.id}`;
  if(previous){const stored=await readReplacementWaybillEvent(tx,previous.id);if(!stored)throw new AccessError(409,'REPLACEMENT_WAYBILL_SOURCE_MISSING');return verifyReplacementWaybillEvent(stored);}
  if(head.booking_id!==bookingId||head.handover_at||!['processing','unknown'].includes(booking.status)||operation.status!=='created')throw new AccessError(409,'REPLACEMENT_BOOKING_NOT_CURRENT');
  const now=await fulfillmentClock(tx,order.clock_namespace),tracking=status==='issued'?`LOCAL-REPLACEMENT-${String(operation.id).replaceAll('-','').toUpperCase()}`:null;
  await tx`update app.local_replacement_operation set status=${status},tracking_number=${tracking},terminal_at=${now} where id=${operation.id}`;
  const result:ReplacementWaybillEvent={id:randomUUID(),operation_id:String(operation.id),booking_id:bookingId,environment:target,status,tracking_number:tracking,occurred_at:now,signature:''};result.signature=sign(result);
  await tx`insert into app.local_replacement_event (id,operation_id,status,tracking_number,occurred_at,signature) values (${result.id},${result.operation_id},${status},${tracking},${now},${result.signature})`;
  if(fault==='before-commit')throw new Error('Simulated replacement waybill source rollback before commit');return result;
 });
 if(fault==='after-commit-lost-ack')throw new Error('Simulated replacement waybill acknowledgement loss after commit');return event;
}

export async function registerReplacementWaybillEvent(tx:TransactionSql,value:unknown){
 const event=verifyReplacementWaybillEvent(value);await profile(tx,event.environment);const source=await readReplacementWaybillEvent(tx,event.id);
 if(!source||canonical(source)!==canonical(event)||source.signature!==event.signature)throw new AccessError(401,'INVALID_REPLACEMENT_WAYBILL_EVIDENCE');
 await tx`select pg_advisory_xact_lock(hashtextextended(${`replacement-waybill-event:${event.id}`},0))`;
 const hash=createHash('sha256').update(canonical(event)).digest('hex'),[prior]=await tx`select payload_hash,callback_job_id from app.replacement_provider_event where id=${event.id}`;
 if(prior){if(prior.payload_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return String(prior.callback_job_id);}
 const job=await enqueueJob(tx,'replacement.shipping.callback',`replacement-shipping-callback:${event.id}`,{eventId:event.id});
 await tx`insert into app.replacement_provider_event (id,callback_job_id,payload_hash) values (${event.id},${job},${hash})`;return job;
}
export async function ingestReplacementWaybillEvent(sql:Sql,value:unknown){return sql.begin(tx=>registerReplacementWaybillEvent(tx,value));}

async function markUnknown(sql:Sql,claim:Claim,bookingId:string){
 await sql.begin(async tx=>{
  const [before]=await tx`select shipment_id from app.replacement_booking where id=${bookingId} and creation_job_id=${claim.id}`;if(!before)throw invalid();
  const {head,order}=await lockReplacement(tx,before.shipment_id),[lease]=await tx`select id from app.outbox_job where id=${claim.id} and lease_token=${claim.token} and status='processing' and lease_until>clock_timestamp() for share`;
  if(!lease)throw new AccessError(409,'STALE_REPLACEMENT_SHIPPING_CLAIM');
  if(head.booking_id!==bookingId||head.status!=='booking_pending')return;
  await tx`update app.replacement_booking set status='unknown' where id=${bookingId} and status='processing'`;
  await advanceReplacement(tx,head,{kind:'unknown',status:'booking_unknown',source_kind:'job',source_id:claim.id,reason:'The original replacement shipping acknowledgement is unknown; its identity is retained',occurred_at:await fulfillmentClock(tx,order.clock_namespace)});
 });
}
export function replacementShippingAdapter(sql:Sql,target:'local'|'test',faults:ReadonlyMap<string,ShippingFault>=new Map()):JobAdapter{
 const resolve=async(claim:Claim,reconciliation:boolean)=>{
  const bookingId=id(claim.payload.bookingId),fault=faults.get(bookingId),created=await prepareReplacementShipping(sql,target,claim,reconciliation,fault);
  if(!created)return {status:'retryable' as const,code:'TEMPORARY_UNAVAILABLE' as const};
  if(!reconciliation&&(fault==='creation-commit-lost-ack'||fault==='issuance-commit-lost-ack')){
   if(fault==='issuance-commit-lost-ack')await simulateReplacementWaybill(sql,target,bookingId);
   await markUnknown(sql,claim,bookingId);throw new Error('Simulated original replacement shipping acknowledgement loss after commit');
  }
  if(!reconciliation&&fault==='rejected')await ingestReplacementWaybillEvent(sql,await simulateReplacementWaybill(sql,target,bookingId,'failed'));
  for(const event of created.events)await ingestReplacementWaybillEvent(sql,event);
  return {status:'succeeded' as const,receipt:{operation_id:created.operation_id}};
 };
 return {dispatch:claim=>resolve(claim,false),reconcile:claim=>resolve(claim,true)};
}

export async function processReplacementWaybill(tx:TransactionSql,job:{id:string;payload:unknown}){
 const input=object(job.payload,['eventId']),eventId=id(input.eventId),[registered]=await tx`select op.booking_id,b.shipment_id from app.replacement_provider_event p
  join app.local_replacement_event e on e.id=p.id join app.local_replacement_operation op on op.id=e.operation_id join app.replacement_booking b on b.id=op.booking_id
  where p.id=${eventId} and p.callback_job_id=${job.id}`;
 if(!registered)throw new AccessError(400,'INVALID_REPLACEMENT_SHIPPING_JOB');
 const {head,order}=await lockReplacement(tx,registered.shipment_id),[prior]=await tx`select outcome,revision from app.replacement_event_result where event_id=${eventId}`;
 if(prior)return {event_id:eventId,outcome:String(prior.outcome),version:Number(prior.revision)};
 const stored=await readReplacementWaybillEvent(tx,eventId);if(!stored)throw new AccessError(400,'INVALID_REPLACEMENT_SHIPPING_JOB');const event=verifyReplacementWaybillEvent(stored);
 const [booking]=await tx`select * from app.replacement_booking where id=${event.booking_id} for update`,[operation]=await tx`select * from app.local_replacement_operation where id=${event.operation_id}`;
 const [database]=await tx`select current_database() name`,now=await fulfillmentClock(tx,order.clock_namespace);
 if(database.name!==`99ribu_${event.environment}`||head.booking_id!==event.booking_id||booking.provider_operation_id!==event.operation_id||operation.clock_namespace!==order.clock_namespace||operation.status!==event.status||new Date(operation.terminal_at).toISOString()!==event.occurred_at||!['booking_pending','booking_unknown'].includes(head.status)||!['processing','unknown'].includes(booking.status)||!head.prepared_at||head.handover_at||Date.parse(event.occurred_at)<new Date(head.prepared_at).getTime()||Date.parse(event.occurred_at)>Date.parse(now))throw new AccessError(409,'REPLACEMENT_WAYBILL_NOT_CURRENT');
 await tx`update app.replacement_booking set status=${event.status} where id=${booking.id}`;
 const changed=await advanceReplacement(tx,head,{kind:event.status==='issued'?'waybill_issued':'waybill_failed',status:event.status==='issued'?'packed':'booking_failed',source_kind:'provider',source_id:event.id,reason:event.status==='issued'?'Original signed source confirms a usable zero-COD replacement waybill':'Original signed source confirms terminal replacement booking failure',occurred_at:event.occurred_at,
  ...(event.status==='issued'?{patch:{waybill_issued_at:event.occurred_at,tracking_number:event.tracking_number}}:{})});
 await tx`insert into app.replacement_event_result (event_id,shipment_id,revision,replacement_event_id,outcome) values (${event.id},${head.id},${changed.head.revision},${changed.eventId},${event.status})`;
 return {event_id:event.id,outcome:event.status,version:changed.head.revision};
}
