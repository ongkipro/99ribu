import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {readLocalConfig} from '../../config/local.ts';
import {enqueueJob} from '../../jobs/outbox.ts';
import {localSigningKey} from '../access/local-key.ts';
import {AccessError} from '../access/policy.ts';
import {array,id,invalid,object} from '../catalog/validation.ts';
import {effectReference,financeInstant} from '../finance/ledger.ts';
import {fulfillmentClock} from '../fulfillment/core.ts';
import {advanceReturn,returnUnits,type ReturnHead} from './cases.ts';
import {advanceReplacement,lockReplacement,replacementCaseComplete} from './replacement-core.ts';
import {replacementReceiptRequest} from './replacement-policy.ts';

export type ReplacementReceiptSource={id:string;reference:string;environment:'local'|'test';booking_id:string;shipment_id:string;clock_namespace:string|null;unit_ids:string[];occurred_at:string;signature:string};
function unitIds(value:unknown){const ids=array(value,id,1,100).sort();if(new Set(ids).size!==ids.length)throw invalid();return ids;}
function canonical(event:Omit<ReplacementReceiptSource,'signature'>){return JSON.stringify(['99ribu-replacement-receipt-simulator-v1',event.environment,event.id,event.reference,event.booking_id,event.shipment_id,event.clock_namespace,event.unit_ids,event.occurred_at]);}
function sign(event:Omit<ReplacementReceiptSource,'signature'>){return createHmac('sha256',localSigningKey(event.environment)).update(canonical(event)).digest('hex');}

export function verifyReplacementReceiptSource(value:unknown):ReplacementReceiptSource{
 const input=object(value,['id','reference','environment','booking_id','shipment_id','clock_namespace','unit_ids','occurred_at','signature']);
 if(!['local','test'].includes(String(input.environment))||(input.clock_namespace!==null&&(typeof input.clock_namespace!=='string'||!/^[a-z][a-z0-9-]{0,23}$/.test(input.clock_namespace)))||typeof input.signature!=='string'||!/^[a-f0-9]{64}$/.test(input.signature))throw invalid();
 const event:ReplacementReceiptSource={id:id(input.id),reference:effectReference(input.reference),environment:input.environment as 'local'|'test',booking_id:id(input.booking_id),shipment_id:id(input.shipment_id),clock_namespace:input.clock_namespace as string|null,unit_ids:unitIds(input.unit_ids),occurred_at:financeInstant(input.occurred_at),signature:input.signature};
 if(!timingSafeEqual(Buffer.from(sign(event),'hex'),Buffer.from(event.signature,'hex')))throw new AccessError(401,'INVALID_REPLACEMENT_RECEIPT_EVIDENCE');
 return event;
}
function project(row:Record<string,unknown>):ReplacementReceiptSource{return {id:String(row.id),reference:String(row.reference),environment:row.environment as 'local'|'test',booking_id:String(row.booking_id),shipment_id:String(row.shipment_id),clock_namespace:row.clock_namespace as string|null,unit_ids:unitIds(row.unit_ids),occurred_at:new Date(row.occurred_at as string).toISOString(),signature:String(row.signature)};}
export async function readReplacementReceiptSource(tx:TransactionSql,eventId:string){const [row]=await tx`select * from app.local_replacement_receipt where id=${id(eventId)}`;return row?project(row):null;}
async function profile(tx:TransactionSql,target:'local'|'test'){
 readLocalConfig(process.env);if(!['local','test'].includes(target))throw invalid();const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`)throw invalid();
}

// Host simulator only. Independently committed evidence precedes callback
// ingestion; a label, handover or buyer-supplied timestamp proves no receipt.
export async function createReplacementReceiptSource(tx:TransactionSql,target:'local'|'test',value:unknown){
 await profile(tx,target);const input=replacementReceiptRequest(value);
 const [booking]=await tx`select shipment_id,status from app.replacement_booking where id=${input.booking_id}`;if(!booking)throw new AccessError(404,'NOT_FOUND');
 const {head,order}=await lockReplacement(tx,booking.shipment_id);
 if(head.booking_id!==input.booking_id||!head.handover_at||booking.status!=='issued')throw new AccessError(409,'REPLACEMENT_RECEIPT_BEFORE_HANDOVER');
 const [schema]=await tx`select to_regclass('app.exception_cancellation') is not null installed`;
 const issued=schema.installed?tx`and id in (select id from app.replacement_request_unit_ids(${input.booking_id}::uuid))`:tx``;
 const links=await tx`select id from app.replacement_link where shipment_id=${head.id} and id in ${tx(input.unit_ids)} ${issued} order by id for share`;
 if(links.length!==input.unit_ids.length)throw new AccessError(404,'NOT_FOUND');
 await tx`select pg_advisory_xact_lock(hashtextextended(${`replacement-receipt-source:${target}:${input.reference}`},0))`;
 const [previous]=await tx`select * from app.local_replacement_receipt where environment=${target} and reference=${input.reference}`;
 const now=await fulfillmentClock(tx,order.clock_namespace),occurred=input.occurred_at??(previous?new Date(previous.occurred_at).toISOString():now);
 if(Date.parse(occurred)<new Date(head.handover_at).getTime()||Date.parse(occurred)>Date.parse(now))throw new AccessError(422,'INVALID_REPLACEMENT_RECEIPT_TIME');
 const intent={reference:input.reference,environment:target,booking_id:input.booking_id,shipment_id:head.id,clock_namespace:order.clock_namespace,unit_ids:input.unit_ids,occurred_at:occurred},hash=createHash('sha256').update(JSON.stringify(intent)).digest('hex');
 if(previous){if(previous.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return verifyReplacementReceiptSource(project(previous));}
 const event:ReplacementReceiptSource={id:randomUUID(),...intent,signature:''};event.signature=sign(event);
 await tx`insert into app.local_replacement_receipt (id,reference,environment,booking_id,shipment_id,clock_namespace,unit_ids,occurred_at,request_hash,signature)
  values (${event.id},${event.reference},${target},${event.booking_id},${event.shipment_id},${event.clock_namespace},${JSON.stringify(event.unit_ids)}::jsonb,${occurred},${hash},${event.signature})`;
 return event;
}
export async function simulateReplacementReceipt(sql:Sql,target:'local'|'test',value:unknown,fault?:'before-commit'|'after-commit-lost-ack'){
 const event=await sql.begin(async tx=>{const event=await createReplacementReceiptSource(tx,target,value);if(fault==='before-commit')throw new Error('Simulated replacement receipt source rollback before commit');return event;});
 if(fault==='after-commit-lost-ack')throw new Error('Simulated replacement receipt acknowledgement loss after commit');return event;
}
export async function registerReplacementReceiptSource(tx:TransactionSql,value:unknown){
 const event=verifyReplacementReceiptSource(value);await profile(tx,event.environment);const original=await readReplacementReceiptSource(tx,event.id);
 if(!original||canonical(original)!==canonical(event)||original.signature!==event.signature)throw new AccessError(401,'INVALID_REPLACEMENT_RECEIPT_EVIDENCE');
 await tx`select pg_advisory_xact_lock(hashtextextended(${`replacement-receipt-event:${event.id}`},0))`;
 const hash=createHash('sha256').update(canonical(event)).digest('hex'),[previous]=await tx`select callback_job_id,payload_hash from app.replacement_receipt_provider_event where id=${event.id}`;
 if(previous){if(previous.payload_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return String(previous.callback_job_id);}
 const job=await enqueueJob(tx,'replacement.receipt.callback',`replacement-receipt-callback:${event.id}`,{eventId:event.id});
 await tx`insert into app.replacement_receipt_provider_event (id,callback_job_id,payload_hash) values (${event.id},${job},${hash})`;return job;
}
export async function ingestReplacementReceiptSource(sql:Sql,value:unknown){return sql.begin(tx=>registerReplacementReceiptSource(tx,value));}

export async function processReplacementReceipt(tx:TransactionSql,job:{id:string;payload:unknown}){
 const input=object(job.payload,['eventId']),eventId=id(input.eventId),[registered]=await tx`select e.shipment_id from app.replacement_receipt_provider_event p
  join app.local_replacement_receipt e on e.id=p.id where p.id=${eventId} and p.callback_job_id=${job.id}`;
 if(!registered)throw new AccessError(400,'INVALID_REPLACEMENT_RECEIPT_JOB');
 const {head,order}=await lockReplacement(tx,registered.shipment_id),[prior]=await tx`select outcome,receipt_count,revision from app.replacement_receipt_result where event_id=${eventId}`;
 if(prior)return {event_id:eventId,outcome:String(prior.outcome),receipt_count:Number(prior.receipt_count),version:Number(prior.revision)};
 const stored=await readReplacementReceiptSource(tx,eventId);if(!stored)throw new AccessError(400,'INVALID_REPLACEMENT_RECEIPT_JOB');const event=verifyReplacementReceiptSource(stored);
 const [database]=await tx`select current_database() name`,[booking]=await tx`select status from app.replacement_booking where id=${event.booking_id} for share`;
 const now=await fulfillmentClock(tx,order.clock_namespace);
 if(database.name!==`99ribu_${event.environment}`||event.clock_namespace!==order.clock_namespace||event.shipment_id!==head.id||event.booking_id!==head.booking_id||booking?.status!=='issued'||!head.handover_at||Date.parse(event.occurred_at)<new Date(head.handover_at).getTime()||Date.parse(event.occurred_at)>Date.parse(now))throw new AccessError(409,'REPLACEMENT_RECEIPT_CONTEXT_MISMATCH');
 const [schema]=await tx`select to_regclass('app.exception_cancellation') is not null installed`;
 const issued=schema.installed?tx`and link.id in (select id from app.replacement_request_unit_ids(${event.booking_id}::uuid))`:tx``;
 const links=await tx`select link.id,link.return_item_id,r.inspection_status,r.claim_state,receipt.id receipt_id from app.replacement_link link
  join app.return_item r on r.id=link.return_item_id left join app.replacement_buyer_receipt receipt on receipt.replacement_link_id=link.id
  where link.shipment_id=${head.id} and link.id in ${tx(event.unit_ids)} ${issued} order by link.id`;
 if(links.length!==event.unit_ids.length)throw new AccessError(409,'REPLACEMENT_RECEIPT_QUANTITY_MISMATCH');
 const changed=links.filter(link=>link.receipt_id===null);let revision=head.revision,replacementEventId:string|null=null,returnEventId:string|null=null;
 if(changed.length){
  if(!['handed_over','partially_delivered'].includes(head.status)||changed.some(link=>link.claim_state!=='replacing'))throw new AccessError(409,'REPLACEMENT_RECEIPT_NOT_CURRENT');
  for(const link of changed)await tx`insert into app.replacement_buyer_receipt (replacement_link_id,source_id,received_at) values (${link.id},${event.id},${event.occurred_at})`;
  const [remaining]=await tx`select count(*)::int n from app.replacement_link link left join app.replacement_buyer_receipt receipt on receipt.replacement_link_id=link.id where link.shipment_id=${head.id} and receipt.id is null ${issued}`;
  const advanced=await advanceReplacement(tx,head,{kind:'receipt',status:remaining.n?'partially_delivered':'delivered',source_kind:'receipt',source_id:event.id,reason:'Original signed replacement evidence confirms these actual buyer receipts',occurred_at:event.occurred_at});
  replacementEventId=advanced.eventId;revision=advanced.head.revision;
  const [returnCase]=await tx<ReturnHead[]>`select * from app.return_case where id=${head.case_id} for update`,items=await returnUnits(tx,head.case_id),changedIds=new Set(changed.map(link=>String(link.return_item_id)));
  if(returnCase.status!=='replacing'||returnCase.resolution!=='replacement')throw new AccessError(409,'REPLACEMENT_CASE_NOT_CURRENT');
  const states=items.filter(item=>changedIds.has(item.id)).map(item=>({id:item.id,claim_state:'replaced',inspection_status:item.inspection_status}));
  const resolved=replacementCaseComplete(items,[...changedIds]);
  const result=await advanceReturn(tx,returnCase,{kind:'replacement_received',status:resolved?'resolved':'replacing',resolution:'replacement',requires_goods:returnCase.requires_goods,
   cause:{source_kind:'replacement',source_id:advanced.eventId,actor_id:null,reason:'Only the verified replacement quantities advance their original return case',occurred_at:items.some(item=>item.claim_state==='refunded')?now:event.occurred_at},states});
  returnEventId=result.eventId;
 }
 const outcome=changed.length?'received':'duplicate';
 await tx`insert into app.replacement_receipt_result (event_id,shipment_id,revision,outcome,receipt_count,replacement_event_id,return_event_id)
  values (${event.id},${head.id},${revision},${outcome},${changed.length},${replacementEventId},${returnEventId})`;
 return {event_id:event.id,outcome,receipt_count:changed.length,version:revision};
}
