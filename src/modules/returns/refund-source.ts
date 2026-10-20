import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {readLocalConfig} from '../../config/local.ts';
import {enqueueJob} from '../../jobs/outbox.ts';
import {localSigningKey} from '../access/local-key.ts';
import {AccessError} from '../access/policy.ts';
import {id,integer,invalid,object} from '../catalog/validation.ts';
import {financeInstant} from '../finance/ledger.ts';
import {fulfillmentClock} from '../fulfillment/core.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';

export type RefundDestinationSource={id:string;refund_id:string;environment:'local'|'test';buyer_scope:string;destination_reference:string;occurred_at:string;signature:string};
export type RefundSourceEvent={id:string;operation_id:string;refund_id:string;environment:'local'|'test';rail:'prepaid_original'|'cod_verified_destination';original_payment_operation_id:string|null;destination_source_id:string|null;expected_amount:number;status:'succeeded'|'failed';amount:number;currency:'IDR';clock_namespace:string|null;bank_reference:string;occurred_at:string;signature:string};

const destinationTuple=(event:Omit<RefundDestinationSource,'signature'>)=>JSON.stringify(['99ribu-refund-destination-simulator-v1',event.environment,event.id,event.refund_id,event.buyer_scope,event.destination_reference,event.occurred_at]);
// This owned protocol attests a company-bank instruction result. Its failed
// trace identifies a rejection with zero money, never a completed transfer.
const refundTuple=(event:Omit<RefundSourceEvent,'signature'>)=>JSON.stringify(['99ribu-refund-simulator-v1','company_bank_debit',event.environment,event.id,event.operation_id,event.refund_id,event.rail,event.original_payment_operation_id,event.destination_source_id,event.expected_amount,event.status,event.amount,event.currency,event.clock_namespace,event.bank_reference,event.occurred_at]);
function signature(target:'local'|'test',value:string){return createHmac('sha256',localSigningKey(target)).update(value).digest('hex');}
function assertSignature(target:'local'|'test',value:string,actual:unknown){
 if(typeof actual!=='string'||!/^[a-f0-9]{64}$/.test(actual)||!timingSafeEqual(Buffer.from(signature(target,value),'hex'),Buffer.from(actual,'hex')))throw new AccessError(401,'INVALID_REFUND_EVIDENCE');
}
async function profile(tx:TransactionSql,target:'local'|'test'){
 readLocalConfig(process.env);if(!['local','test'].includes(target))throw invalid();const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`)throw invalid();
}

export function verifyRefundDestinationSource(value:unknown):RefundDestinationSource{
 const input=object(value,['id','refund_id','environment','buyer_scope','destination_reference','occurred_at','signature']);
 if(!['local','test'].includes(String(input.environment))||typeof input.buyer_scope!=='string'||!/^(user|guest):[A-Za-z0-9_-]{1,100}$/.test(input.buyer_scope)||typeof input.destination_reference!=='string'||!/^synthetic:[0-9a-f-]{36}$/.test(input.destination_reference))throw invalid();
 const event:RefundDestinationSource={id:id(input.id),refund_id:id(input.refund_id),environment:input.environment as 'local'|'test',buyer_scope:input.buyer_scope,destination_reference:input.destination_reference,occurred_at:financeInstant(input.occurred_at),signature:String(input.signature)};
 id(event.destination_reference.slice(10));assertSignature(event.environment,destinationTuple(event),input.signature);return event;
}
export function verifyRefundSourceEvent(value:unknown):RefundSourceEvent{
 const input=object(value,['id','operation_id','refund_id','environment','rail','original_payment_operation_id','destination_source_id','expected_amount','status','amount','currency','clock_namespace','bank_reference','occurred_at','signature']);
 if(!['local','test'].includes(String(input.environment))||!['prepaid_original','cod_verified_destination'].includes(String(input.rail))||!['succeeded','failed'].includes(String(input.status))||input.currency!=='IDR'||typeof input.bank_reference!=='string'||!/^LOCAL-REFUND-[A-F0-9]{32}$/.test(input.bank_reference))throw invalid();
 if(input.clock_namespace!==null&&(typeof input.clock_namespace!=='string'||!/^[a-z][a-z0-9-]{0,23}$/.test(input.clock_namespace)))throw invalid();
 const event:RefundSourceEvent={id:id(input.id),operation_id:id(input.operation_id),refund_id:id(input.refund_id),environment:input.environment as 'local'|'test',rail:input.rail as RefundSourceEvent['rail'],original_payment_operation_id:input.original_payment_operation_id===null?null:id(input.original_payment_operation_id),destination_source_id:input.destination_source_id===null?null:id(input.destination_source_id),expected_amount:integer(input.expected_amount,1,Number.MAX_SAFE_INTEGER),status:input.status as RefundSourceEvent['status'],amount:integer(input.amount,0,Number.MAX_SAFE_INTEGER),currency:'IDR',clock_namespace:input.clock_namespace as string|null,bank_reference:input.bank_reference,occurred_at:financeInstant(input.occurred_at),signature:String(input.signature)};
 if(event.rail==='prepaid_original'?(event.original_payment_operation_id===null||event.destination_source_id!==null):(event.original_payment_operation_id!==null||event.destination_source_id===null))throw invalid();
 assertSignature(event.environment,refundTuple(event),input.signature);
 if(event.status==='succeeded'?event.amount!==event.expected_amount:event.amount!==0)throw new AccessError(409,'REFUND_SOURCE_AMOUNT_MISMATCH');
 return event;
}

function destination(row:Record<string,unknown>):RefundDestinationSource{return {id:String(row.id),refund_id:String(row.refund_id),environment:row.environment as 'local'|'test',buyer_scope:String(row.buyer_scope),destination_reference:String(row.destination_reference),occurred_at:new Date(row.occurred_at as string).toISOString(),signature:String(row.signature)};}
function refundEvent(row:Record<string,unknown>):RefundSourceEvent{return {id:String(row.id),operation_id:String(row.operation_id),refund_id:String(row.refund_id),environment:row.environment as 'local'|'test',rail:row.rail as RefundSourceEvent['rail'],original_payment_operation_id:row.original_payment_operation_id as string|null,destination_source_id:row.destination_source_id as string|null,expected_amount:Number(row.expected_amount),status:row.status as RefundSourceEvent['status'],amount:Number(row.amount),currency:'IDR',clock_namespace:row.clock_namespace as string|null,bank_reference:String(row.bank_reference),occurred_at:new Date(row.occurred_at as string).toISOString(),signature:String(row.signature)};}
export async function readRefundDestinationSource(tx:TransactionSql,sourceId:string){const [row]=await tx`select * from app.local_refund_destination where id=${id(sourceId)}`;return row?destination(row):null;}
export async function readRefundSourceEvent(tx:TransactionSql,eventId:string){const [row]=await tx`select e.*,o.refund_id,o.environment,o.rail,o.original_payment_operation_id,o.destination_source_id,o.amount expected_amount,o.clock_namespace from app.local_refund_event e join app.local_refund_operation o on o.id=e.operation_id where e.id=${id(eventId)}`;return row?refundEvent(row):null;}

// Host simulates verification of one synthetic recipient for this exact refund.
// No real account number, screenshot or typed destination becomes verified here.
export async function createRefundDestinationSource(sql:Sql,target:'local'|'test',refundId:string,fault?:'before-commit'|'after-commit-lost-ack'){
 const event=await sql.begin(async tx=>{
  await profile(tx,target);const selected=id(refundId),[before]=await tx`select order_id from app.refund where id=${selected}`;if(!before)throw new AccessError(404,'NOT_FOUND');
  const order=await lockPaymentOrder(tx,before.order_id),[refund]=await tx`select * from app.refund where id=${selected} for update`;
  if(order.payment_method!=='cod')throw new AccessError(409,'REFUND_DESTINATION_NOT_REQUIRED');
  await tx`select pg_advisory_xact_lock(hashtextextended(${`refund-destination:${selected}`},0))`;
  const [previous]=await tx`select * from app.local_refund_destination where refund_id=${selected} order by recorded_at,id limit 1`;
  if(previous)return verifyRefundDestinationSource(destination(previous));
  if(refund.status!=='awaiting_destination')throw new AccessError(409,'REFUND_DESTINATION_NOT_CURRENT');
  const buyerScope=order.owner_user_id?`user:${order.owner_user_id}`:order.owner_guest_id?`guest:${order.owner_guest_id}`:null;if(!buyerScope)throw new AccessError(409,'REFUND_BUYER_MISSING');
  const event:RefundDestinationSource={id:randomUUID(),refund_id:selected,environment:target,buyer_scope:buyerScope,destination_reference:`synthetic:${randomUUID()}`,occurred_at:await fulfillmentClock(tx,order.clock_namespace),signature:''};event.signature=signature(target,destinationTuple(event));
  await tx`insert into app.local_refund_destination (id,refund_id,environment,buyer_scope,destination_reference,signature,occurred_at) values (${event.id},${selected},${target},${buyerScope},${event.destination_reference},${event.signature},${event.occurred_at})`;
  if(fault==='before-commit')throw new Error('Simulated refund destination verification rollback before commit');return event;
 });
 if(fault==='after-commit-lost-ack')throw new Error('Simulated refund destination verification acknowledgement loss after commit');return event;
}

// A local bank result is a separate committed source effect. Source retries
// cannot switch status, amount, recipient or bank instruction identity/time.
export async function simulateRefundOutcome(sql:Sql,target:'local'|'test',refundId:string,status:'succeeded'|'failed'='succeeded',fault?:'before-commit'|'after-commit-lost-ack'){
 if(!['succeeded','failed'].includes(status))throw invalid();
 const event=await sql.begin(async tx=>{
  await profile(tx,target);const selected=id(refundId),[before]=await tx`select order_id from app.refund where id=${selected}`;if(!before)throw new AccessError(404,'NOT_FOUND');
  const order=await lockPaymentOrder(tx,before.order_id),[refund]=await tx`select * from app.refund where id=${selected} for update`;
  if(!refund.current_operation_id)throw new AccessError(409,'REFUND_REQUEST_NOT_ACKNOWLEDGED');
  const [operation]=await tx`select * from app.local_refund_operation where id=${refund.current_operation_id} for update`;
  if(!operation||operation.environment!==target||operation.refund_id!==selected||operation.clock_namespace!==order.clock_namespace||operation.creation_job_id!==refund.current_job_id||Number(operation.amount)!==Number(refund.amount)||operation.rail!==(order.payment_method==='prepaid'?'prepaid_original':'cod_verified_destination'))throw new AccessError(409,'REFUND_SOURCE_CONTEXT_MISMATCH');
  const [previous]=await tx`select id,status from app.local_refund_event where operation_id=${operation.id}`;
  if(previous){if(previous.status!==status)throw new AccessError(409,'REFUND_EFFECT_FINAL');const stored=await readRefundSourceEvent(tx,previous.id);if(!stored)throw new AccessError(409,'REFUND_SOURCE_MISSING');return verifyRefundSourceEvent(stored);}
  if(!['processing','unknown'].includes(refund.status))throw new AccessError(409,'REFUND_REQUEST_NOT_CURRENT');
  if(operation.rail==='cod_verified_destination'){
   const source=await readRefundDestinationSource(tx,operation.destination_source_id);if(!source)throw new AccessError(409,'REFUND_DESTINATION_UNVERIFIED');verifyRefundDestinationSource(source);
   const expectedBuyer=order.owner_user_id?`user:${order.owner_user_id}`:`guest:${order.owner_guest_id}`;
   if(source.refund_id!==selected||source.environment!==target||source.buyer_scope!==expectedBuyer)throw new AccessError(409,'REFUND_DESTINATION_UNVERIFIED');
  }
  const event:RefundSourceEvent={id:randomUUID(),operation_id:String(operation.id),refund_id:selected,environment:target,rail:operation.rail,original_payment_operation_id:operation.original_payment_operation_id,destination_source_id:operation.destination_source_id,expected_amount:Number(operation.amount),status,amount:status==='succeeded'?Number(operation.amount):0,currency:'IDR',clock_namespace:operation.clock_namespace,bank_reference:`LOCAL-REFUND-${randomUUID().replaceAll('-','').toUpperCase()}`,occurred_at:await fulfillmentClock(tx,order.clock_namespace),signature:''};event.signature=signature(target,refundTuple(event));
  await tx`insert into app.local_refund_event (id,operation_id,status,amount,bank_reference,occurred_at,signature) values (${event.id},${event.operation_id},${event.status},${event.amount},${event.bank_reference},${event.occurred_at},${event.signature})`;
  if(fault==='before-commit')throw new Error('Simulated refund bank effect rollback before commit');return event;
 });
 if(fault==='after-commit-lost-ack')throw new Error('Simulated refund bank acknowledgement loss after commit');return event;
}
export async function registerRefundSourceEvent(tx:TransactionSql,value:unknown){
 const event=verifyRefundSourceEvent(value);await profile(tx,event.environment);const original=await readRefundSourceEvent(tx,event.id);
 if(!original||refundTuple(original)!==refundTuple(event)||original.signature!==event.signature)throw new AccessError(401,'INVALID_REFUND_EVIDENCE');
 await tx`select pg_advisory_xact_lock(hashtextextended(${`refund-event:${event.id}`},0))`;
 const payloadHash=createHash('sha256').update(refundTuple(event)).digest('hex'),[previous]=await tx`select callback_job_id,payload_hash from app.refund_provider_event where id=${event.id}`;
 if(previous){if(previous.payload_hash!==payloadHash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return String(previous.callback_job_id);}
 const job=await enqueueJob(tx,'refund.callback',`refund-callback:${event.id}`,{eventId:event.id});
 await tx`insert into app.refund_provider_event (id,refund_id,callback_job_id,payload_hash) values (${event.id},${event.refund_id},${job},${payloadHash})`;return job;
}
export async function ingestRefundSourceEvent(sql:Sql,value:unknown){return sql.begin(tx=>registerRefundSourceEvent(tx,value));}
