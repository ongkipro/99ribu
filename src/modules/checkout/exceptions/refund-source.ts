import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {readLocalConfig} from '../../../config/local.ts';
import {enqueueJob} from '../../../jobs/outbox.ts';
import {localSigningKey} from '../../access/local-key.ts';
import {AccessError} from '../../access/policy.ts';
import {id,integer,invalid,object} from '../../catalog/validation.ts';
import {financeInstant} from '../../finance/ledger.ts';
import {fulfillmentClock} from '../../fulfillment/core.ts';
import {lockPaymentOrder} from '../../payments/attempts.ts';

export type RecoveryDestinationSource={id:string;refund_id:string;environment:'local'|'test';buyer_scope:string;destination_reference:string;occurred_at:string;signature:string};
export type RecoverySourceEvent={id:string;operation_id:string;refund_id:string;environment:'local'|'test';rail:'prepaid_original'|'cod_verified_destination';original_payment_operation_id:string|null;destination_source_id:string|null;source_transaction_id:string;expected_amount:number;status:'succeeded'|'failed';amount:number;currency:'IDR';clock_namespace:string|null;bank_reference:string;occurred_at:string;signature:string};

const destinationTuple=(source:Omit<RecoveryDestinationSource,'signature'>)=>JSON.stringify(['99ribu-recovery-destination-simulator-v1',source.environment,source.id,source.refund_id,source.buyer_scope,source.destination_reference,source.occurred_at]);
// This owned local protocol binds the original collection journal as well as
// its bank instruction. A signed rejection attests zero money sent.
const bankTuple=(source:Omit<RecoverySourceEvent,'signature'>)=>JSON.stringify(['99ribu-recovery-refund-simulator-v1','company_bank_debit',source.environment,source.id,source.operation_id,source.refund_id,source.rail,source.original_payment_operation_id,source.destination_source_id,source.source_transaction_id,source.expected_amount,source.status,source.amount,source.currency,source.clock_namespace,source.bank_reference,source.occurred_at]);
function sign(target:'local'|'test',tuple:string){return createHmac('sha256',localSigningKey(target)).update(tuple).digest('hex');}
function assertSignature(target:'local'|'test',tuple:string,signature:unknown){
 if(typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(sign(target,tuple),'hex'),Buffer.from(signature,'hex')))throw new AccessError(401,'INVALID_RECOVERY_REFUND_EVIDENCE');
}
async function profile(tx:TransactionSql,target:'local'|'test'){
 readLocalConfig(process.env);if(!['local','test'].includes(target))throw invalid();
 const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`)throw invalid();
}

export function verifyRecoveryDestinationSource(value:unknown):RecoveryDestinationSource{
 const input=object(value,['id','refund_id','environment','buyer_scope','destination_reference','occurred_at','signature']);
 if((input.environment!=='local'&&input.environment!=='test')||typeof input.buyer_scope!=='string'||!/^(user:[A-Za-z0-9_-]{1,100}|guest:[a-f0-9-]{36})$/.test(input.buyer_scope)
  ||typeof input.destination_reference!=='string'||!/^LOCAL-RECOVERY-DEST-[A-F0-9]{32}$/.test(input.destination_reference))throw invalid();
 if(input.buyer_scope.startsWith('guest:'))id(input.buyer_scope.slice(6));
 const source:RecoveryDestinationSource={id:id(input.id),refund_id:id(input.refund_id),environment:input.environment,buyer_scope:input.buyer_scope,destination_reference:input.destination_reference,occurred_at:financeInstant(input.occurred_at),signature:String(input.signature)};
 assertSignature(source.environment,destinationTuple(source),input.signature);return source;
}
export function verifyRecoverySourceEvent(value:unknown):RecoverySourceEvent{
 const input=object(value,['id','operation_id','refund_id','environment','rail','original_payment_operation_id','destination_source_id','source_transaction_id','expected_amount','status','amount','currency','clock_namespace','bank_reference','occurred_at','signature']);
 if((input.environment!=='local'&&input.environment!=='test')||(input.rail!=='prepaid_original'&&input.rail!=='cod_verified_destination')||(input.status!=='succeeded'&&input.status!=='failed')||input.currency!=='IDR'
  ||typeof input.bank_reference!=='string'||!/^LOCAL-RECOVERY-[A-F0-9]{32}$/.test(input.bank_reference)
  ||(input.clock_namespace!==null&&(typeof input.clock_namespace!=='string'||!/^[a-z][a-z0-9-]{0,23}$/.test(input.clock_namespace))))throw invalid();
 const source:RecoverySourceEvent={id:id(input.id),operation_id:id(input.operation_id),refund_id:id(input.refund_id),environment:input.environment,rail:input.rail,original_payment_operation_id:input.original_payment_operation_id===null?null:id(input.original_payment_operation_id),destination_source_id:input.destination_source_id===null?null:id(input.destination_source_id),source_transaction_id:id(input.source_transaction_id),expected_amount:integer(input.expected_amount,1,Number.MAX_SAFE_INTEGER),status:input.status,amount:integer(input.amount,0,Number.MAX_SAFE_INTEGER),currency:'IDR',clock_namespace:input.clock_namespace as string|null,bank_reference:input.bank_reference,occurred_at:financeInstant(input.occurred_at),signature:String(input.signature)};
 if(source.rail==='prepaid_original'?(source.original_payment_operation_id===null||source.destination_source_id!==null):(source.original_payment_operation_id!==null||source.destination_source_id===null))throw invalid();
 assertSignature(source.environment,bankTuple(source),input.signature);
 if(source.status==='succeeded'?source.amount!==source.expected_amount:source.amount!==0)throw new AccessError(409,'RECOVERY_REFUND_SOURCE_AMOUNT_MISMATCH');
 return source;
}

function destination(row:Record<string,unknown>):RecoveryDestinationSource{return {id:String(row.id),refund_id:String(row.refund_id),environment:row.environment as 'local'|'test',buyer_scope:String(row.buyer_scope),destination_reference:String(row.destination_reference),occurred_at:new Date(row.occurred_at as string).toISOString(),signature:String(row.signature)};}
function bankEvent(row:Record<string,unknown>):RecoverySourceEvent{return {id:String(row.id),operation_id:String(row.operation_id),refund_id:String(row.refund_id),environment:row.environment as 'local'|'test',rail:row.rail as RecoverySourceEvent['rail'],original_payment_operation_id:row.original_payment_operation_id as string|null,destination_source_id:row.destination_source_id as string|null,source_transaction_id:String(row.source_transaction_id),expected_amount:Number(row.expected_amount),status:row.status as RecoverySourceEvent['status'],amount:Number(row.amount),currency:'IDR',clock_namespace:row.clock_namespace as string|null,bank_reference:String(row.bank_reference),occurred_at:new Date(row.occurred_at as string).toISOString(),signature:String(row.signature)};}
export async function readRecoveryDestinationSource(tx:TransactionSql,sourceId:string){const [row]=await tx`select * from app.local_recovery_destination where id=${id(sourceId)}`;return row?destination(row):null;}
export async function readRecoverySourceEvent(tx:TransactionSql,eventId:string){
 const [row]=await tx`select event.*,operation.refund_id,operation.environment,operation.rail,operation.original_payment_operation_id,operation.destination_source_id,operation.source_transaction_id,operation.amount expected_amount,operation.clock_namespace
  from app.local_recovery_event event join app.local_recovery_operation operation on operation.id=event.operation_id where event.id=${id(eventId)}`;
 return row?bankEvent(row):null;
}

// Source effects commit separately from buyer acceptance and callbacks. These
// functions are local adapters, never authority to mutate a buyer's order.
export async function simulateRecoveryDestination(sql:Sql,target:'local'|'test',refundId:string,fault?:'before-commit'|'after-commit-lost-ack'){
 const source=await sql.begin(async tx=>{
  await profile(tx,target);const selected=id(refundId),[before]=await tx`select order_id from app.recovery_refund where id=${selected}`;if(!before)throw new AccessError(404,'NOT_FOUND');
  const order=await lockPaymentOrder(tx,before.order_id),[refund]=await tx`select * from app.recovery_refund where id=${selected} for update`;
  if(order.payment_method!=='cod')throw new AccessError(409,'RECOVERY_DESTINATION_NOT_REQUIRED');
  const [previous]=await tx`select * from app.local_recovery_destination where refund_id=${selected} order by recorded_at,id limit 1`;
  if(previous)return verifyRecoveryDestinationSource(destination(previous));
  if(refund.status!=='awaiting_destination')throw new AccessError(409,'RECOVERY_DESTINATION_NOT_CURRENT');
  const buyerScope=order.owner_user_id?`user:${order.owner_user_id}`:order.owner_guest_id?`guest:${order.owner_guest_id}`:null;if(!buyerScope)throw new AccessError(409,'RECOVERY_BUYER_MISSING');
  const source:RecoveryDestinationSource={id:randomUUID(),refund_id:selected,environment:target,buyer_scope:buyerScope,destination_reference:`LOCAL-RECOVERY-DEST-${randomUUID().replaceAll('-','').toUpperCase()}`,occurred_at:await fulfillmentClock(tx,order.clock_namespace),signature:''};source.signature=sign(target,destinationTuple(source));
  await tx`insert into app.local_recovery_destination (id,refund_id,environment,buyer_scope,destination_reference,signature,occurred_at) values (${source.id},${selected},${target},${source.buyer_scope},${source.destination_reference},${source.signature},${source.occurred_at})`;
  if(fault==='before-commit')throw new Error('Simulated recovery destination rollback before commit');return source;
 });
 if(fault==='after-commit-lost-ack')throw new Error('Simulated recovery destination acknowledgement loss after commit');return source;
}
export async function simulateRecoveryOutcome(sql:Sql,target:'local'|'test',refundId:string,status:'succeeded'|'failed'='succeeded',fault?:'before-commit'|'after-commit-lost-ack'){
 if(status!=='succeeded'&&status!=='failed')throw invalid();
 const source=await sql.begin(async tx=>{
  await profile(tx,target);const selected=id(refundId),[before]=await tx`select order_id from app.recovery_refund where id=${selected}`;if(!before)throw new AccessError(404,'NOT_FOUND');
  const order=await lockPaymentOrder(tx,before.order_id),[refund]=await tx`select * from app.recovery_refund where id=${selected} for update`;
  if(!refund.current_operation_id)throw new AccessError(409,'RECOVERY_REQUEST_NOT_ACKNOWLEDGED');
  const [operation]=await tx`select * from app.local_recovery_operation where id=${refund.current_operation_id} for update`;
  if(!operation||operation.environment!==target||operation.refund_id!==selected||operation.clock_namespace!==order.clock_namespace||operation.creation_job_id!==refund.current_job_id||operation.source_transaction_id!==refund.source_transaction_id
   ||Number(operation.amount)!==Number(refund.amount)||operation.destination_source_id!==refund.destination_source_id||operation.rail!==(order.payment_method==='prepaid'?'prepaid_original':'cod_verified_destination'))throw new AccessError(409,'RECOVERY_SOURCE_CONTEXT_MISMATCH');
  const [previous]=await tx`select id,status from app.local_recovery_event where operation_id=${operation.id}`;
  if(previous){if(previous.status!==status)throw new AccessError(409,'RECOVERY_EFFECT_FINAL');const stored=await readRecoverySourceEvent(tx,previous.id);if(!stored)throw new AccessError(409,'RECOVERY_SOURCE_MISSING');return verifyRecoverySourceEvent(stored);}
  if(!['processing','unknown'].includes(refund.status))throw new AccessError(409,'RECOVERY_REQUEST_NOT_CURRENT');
  if(operation.rail==='cod_verified_destination'){
   const stored=await readRecoveryDestinationSource(tx,operation.destination_source_id);if(!stored)throw new AccessError(409,'RECOVERY_DESTINATION_UNVERIFIED');const destination=verifyRecoveryDestinationSource(stored);
   if(destination.refund_id!==selected||destination.environment!==target||destination.buyer_scope!==(order.owner_user_id?`user:${order.owner_user_id}`:`guest:${order.owner_guest_id}`))throw new AccessError(409,'RECOVERY_DESTINATION_UNVERIFIED');
  }else{
   const [original]=await tx`select event.operation_id from app.local_payment_event event where event.id=${refund.source_id} and event.status='confirmed'`;
   if(original?.operation_id!==operation.original_payment_operation_id)throw new AccessError(409,'RECOVERY_SOURCE_CONTEXT_MISMATCH');
  }
  const source:RecoverySourceEvent={id:randomUUID(),operation_id:String(operation.id),refund_id:selected,environment:target,rail:operation.rail,original_payment_operation_id:operation.original_payment_operation_id,destination_source_id:operation.destination_source_id,source_transaction_id:operation.source_transaction_id,expected_amount:Number(operation.amount),status,amount:status==='succeeded'?Number(operation.amount):0,currency:'IDR',clock_namespace:operation.clock_namespace,bank_reference:`LOCAL-RECOVERY-${randomUUID().replaceAll('-','').toUpperCase()}`,occurred_at:await fulfillmentClock(tx,order.clock_namespace),signature:''};source.signature=sign(target,bankTuple(source));
  await tx`insert into app.local_recovery_event (id,operation_id,status,amount,bank_reference,occurred_at,signature) values (${source.id},${source.operation_id},${source.status},${source.amount},${source.bank_reference},${source.occurred_at},${source.signature})`;
  if(fault==='before-commit')throw new Error('Simulated recovery bank rollback before commit');return source;
 });
 if(fault==='after-commit-lost-ack')throw new Error('Simulated recovery bank acknowledgement loss after commit');return source;
}
export async function registerRecoverySourceEvent(tx:TransactionSql,value:unknown){
 const source=verifyRecoverySourceEvent(value);await profile(tx,source.environment);const stored=await readRecoverySourceEvent(tx,source.id);
 if(!stored||bankTuple(stored)!==bankTuple(source)||stored.signature!==source.signature)throw new AccessError(401,'INVALID_RECOVERY_REFUND_EVIDENCE');
 await tx`select pg_advisory_xact_lock(hashtextextended(${`recovery-refund-event:${source.id}`},0))`;
 const hash=createHash('sha256').update(bankTuple(source)).digest('hex'),[previous]=await tx`select callback_job_id,payload_hash from app.recovery_provider_event where id=${source.id}`;
 if(previous){if(previous.payload_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return String(previous.callback_job_id);}
 const job=await enqueueJob(tx,'recovery.refund.callback',`recovery-refund-callback:${source.id}`,{eventId:source.id});
 await tx`insert into app.recovery_provider_event (id,refund_id,callback_job_id,payload_hash) values (${source.id},${source.refund_id},${job},${hash})`;return job;
}
export async function ingestRecoverySourceEvent(sql:Sql,value:unknown){return sql.begin(tx=>registerRecoverySourceEvent(tx,value));}
