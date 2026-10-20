import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {readLocalConfig} from '../../config/local.ts';
import {enqueueJob} from '../../jobs/outbox.ts';
import {localSigningKey} from '../access/local-key.ts';
import {AccessError} from '../access/policy.ts';
import {array,id,invalid,object,text} from '../catalog/validation.ts';
import {effectReference,financeInstant} from '../finance/ledger.ts';
import {fulfillmentClock} from '../fulfillment/core.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';

export type ParcelReceiptSource={id:string;reference:string;environment:'local'|'test';booking_id:string;shipment_id:string;clock_namespace:string|null;unit_ids:string[];occurred_at:string;signature:string};
function units(value:unknown){
 const result=array(value,id,1,100).sort();
 if(new Set(result).size!==result.length)throw invalid();
 return result;
}
function namespace(value:unknown){
 if(value===null)return null;
 const result=text(value,24);if(!/^[a-z][a-z0-9-]{0,23}$/.test(result)||result!==value)throw invalid();return result;
}
function canonical(event:Omit<ParcelReceiptSource,'signature'>){return JSON.stringify(['99ribu-parcel-receipt-simulator-v1',event.environment,event.id,event.reference,event.booking_id,event.shipment_id,event.clock_namespace,event.unit_ids,event.occurred_at]);}
function sign(event:Omit<ParcelReceiptSource,'signature'>){return createHmac('sha256',localSigningKey(event.environment)).update(canonical(event)).digest('hex');}

export function verifyParcelReceiptSource(value:unknown):ParcelReceiptSource{
 const input=object(value,['id','reference','environment','booking_id','shipment_id','clock_namespace','unit_ids','occurred_at','signature']);
 if(!['local','test'].includes(String(input.environment)))throw invalid();
 const event:ParcelReceiptSource={id:id(input.id),reference:effectReference(input.reference),environment:input.environment as 'local'|'test',booking_id:id(input.booking_id),shipment_id:id(input.shipment_id),clock_namespace:namespace(input.clock_namespace),unit_ids:units(input.unit_ids),occurred_at:financeInstant(input.occurred_at),signature:String(input.signature)};
 if(!/^[a-f0-9]{64}$/.test(event.signature)||!timingSafeEqual(Buffer.from(sign(event),'hex'),Buffer.from(event.signature,'hex')))throw new AccessError(401,'INVALID_PARCEL_RECEIPT_EVIDENCE');
 return event;
}
function project(row:Record<string,unknown>):ParcelReceiptSource{return {id:String(row.id),reference:String(row.reference),environment:row.environment as 'local'|'test',booking_id:String(row.booking_id),shipment_id:String(row.shipment_id),clock_namespace:row.clock_namespace as string|null,unit_ids:units(row.unit_ids),occurred_at:new Date(row.occurred_at as string).toISOString(),signature:String(row.signature)};}
export async function readParcelReceiptSource(tx:TransactionSql,eventId:string){const [row]=await tx`select * from app.local_parcel_receipt where id=${id(eventId)}`;return row?project(row):null;}
async function profile(tx:TransactionSql,target:'local'|'test'){
 readLocalConfig(process.env);if(!['local','test'].includes(target))throw invalid();
 const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`)throw invalid();
}

// Host-only simulator. Neither money nor a label/handover is a buyer receipt.
// Original source commits independently; retries reuse its identity and time.
export async function createParcelReceiptSource(tx:TransactionSql,target:'local'|'test',value:unknown){
 await profile(tx,target);const input=object(value,['reference','booking_id','unit_ids','occurred_at']),reference=effectReference(input.reference),bookingId=id(input.booking_id),selected=units(input.unit_ids);
 const [before]=await tx`select b.fulfillment_id,s.order_id,s.id shipment_id from app.shipment_booking b join app.fulfillment f on f.id=b.fulfillment_id join app.order_shipment s on s.id=f.shipment_id where b.id=${bookingId}`;
 if(!before)throw new AccessError(404,'NOT_FOUND');
 const order=await lockPaymentOrder(tx,before.order_id);
 const [head]=await tx`select booking_id,handover_at from app.fulfillment where id=${before.fulfillment_id} for share`;
 const [booking]=await tx`select status from app.shipment_booking where id=${bookingId} for share`;
 if(head.booking_id!==bookingId||!head.handover_at||booking.status!=='issued')throw new AccessError(409,'PARCEL_RECEIPT_BEFORE_HANDOVER');
 const originals=await tx`select f.id from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where f.id in ${tx(selected)} and f.shipment_id=${before.shipment_id} and i.order_id=${order.id} order by f.id for share of f`;
 if(originals.length!==selected.length)throw new AccessError(404,'NOT_FOUND');
 await tx`select pg_advisory_xact_lock(hashtextextended(${`parcel-receipt-source:${target}:${reference}`},0))`;
 const [previous]=await tx`select * from app.local_parcel_receipt where environment=${target} and reference=${reference}`;
 const now=await fulfillmentClock(tx,order.clock_namespace),occurred=input.occurred_at===undefined?(previous?new Date(previous.occurred_at).toISOString():now):financeInstant(input.occurred_at);
 if(Date.parse(occurred)<new Date(head.handover_at).getTime()||Date.parse(occurred)>Date.parse(now))throw new AccessError(422,'INVALID_PARCEL_RECEIPT_TIME');
 const intent={reference,environment:target,booking_id:bookingId,shipment_id:String(before.shipment_id),clock_namespace:order.clock_namespace,unit_ids:selected,occurred_at:occurred},hash=createHash('sha256').update(JSON.stringify(intent)).digest('hex');
 if(previous){if(previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return verifyParcelReceiptSource(project(previous));}
 const event:ParcelReceiptSource={id:randomUUID(),...intent,signature:''};event.signature=sign(event);
 await tx`insert into app.local_parcel_receipt (id,reference,environment,booking_id,shipment_id,clock_namespace,unit_ids,occurred_at,request_hash,signature) values (${event.id},${reference},${target},${bookingId},${event.shipment_id},${event.clock_namespace},${JSON.stringify(selected)}::jsonb,${occurred},${hash},${event.signature})`;
 return event;
}
export async function simulateParcelReceipt(sql:Sql,target:'local'|'test',value:unknown,fault?:'before-commit'|'after-commit-lost-ack'){
 const event=await sql.begin(async tx=>{const event=await createParcelReceiptSource(tx,target,value);if(fault==='before-commit')throw new Error('Simulated parcel receipt source rollback before commit');return event;});
 if(fault==='after-commit-lost-ack')throw new Error('Simulated parcel receipt acknowledgement loss after commit');return event;
}
export async function registerParcelReceiptSource(tx:TransactionSql,value:unknown){
 const event=verifyParcelReceiptSource(value);await profile(tx,event.environment);const original=await readParcelReceiptSource(tx,event.id);
 if(!original||canonical(original)!==canonical(event)||original.signature!==event.signature)throw new AccessError(401,'INVALID_PARCEL_RECEIPT_EVIDENCE');
 await tx`select pg_advisory_xact_lock(hashtextextended(${`parcel-receipt-event:${event.id}`},0))`;
 const payloadHash=createHash('sha256').update(canonical(event)).digest('hex'),[previous]=await tx`select callback_job_id,payload_hash from app.parcel_receipt_provider_event where id=${event.id}`;
 if(previous){if(previous.payload_hash!==payloadHash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return String(previous.callback_job_id);}
 const job=await enqueueJob(tx,'parcel.receipt.callback',`parcel-receipt-callback:${event.id}`,{eventId:event.id});
 await tx`insert into app.parcel_receipt_provider_event (id,callback_job_id,payload_hash) values (${event.id},${job},${payloadHash})`;return job;
}
export async function ingestParcelReceiptSource(sql:Sql,value:unknown){return sql.begin(tx=>registerParcelReceiptSource(tx,value));}
