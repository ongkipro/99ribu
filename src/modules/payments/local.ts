import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {enqueueJob} from '../../jobs/outbox.ts';
import {readRuntimeConfig} from '../../config/runtime.ts';
import {localSigningKey} from '../access/local-key.ts';
import {AccessError} from '../access/policy.ts';
import {id,integer,invalid,object} from '../catalog/validation.ts';
import {financeInstant,moneyEnvironment} from '../finance/ledger.ts';
import {lockPaymentOrder} from './attempts.ts';

export type PaymentEnvironment='local'|'test'|'production';
export type ProviderEvent={id:string;operation_id:string;attempt_id:string;environment:PaymentEnvironment;status:'pending'|'confirmed'|'failed'|'expired';amount:number;currency:'IDR';occurred_at:string;signature:string};
function canonical(e:Omit<ProviderEvent,'signature'>){return JSON.stringify(['99ribu-payment-simulator-v1',e.environment,e.id,e.operation_id,e.attempt_id,e.status,e.amount,e.currency,e.occurred_at]);}
// S181 step 2a (ADR-0008): in production the evidence signature is an HMAC under a key derived from the server's own
// BETTER_AUTH_SECRET with a payment-specific label, so it never equals the secret itself and never leaves the server.
// The event is built and verified by this process only; no externally supplied event is accepted anywhere in production.
// Signing and verifying are separate on purpose (Argon S181-1b2a finding 3). Opening or settling a production operation
// needs the channel's capability (assertChannelCapability below, called from openLocalOperation and settleLocalOperation).
// VERIFYING an event this server already signed needs only the production profile, so clearing MONEY_CAPABILITIES for a
// rollback never strands `checkout.order.expire` or an in-flight `payment.callback` on a stored production event.
function signingKey(environment:PaymentEnvironment){
 if(environment!=='production')return localSigningKey(environment);
 if(process.env.APP_ENV!=='production')throw new AccessError(503,'PRODUCTION_MONEY_PATH_GATED');
 if(readRuntimeConfig(process.env).profile!=='production')throw new AccessError(503,'PRODUCTION_MONEY_PATH_GATED');
 return createHmac('sha256',process.env.BETTER_AUTH_SECRET as string).update('99ribu-payment-evidence-v1').digest('base64url');
}
// Finding 2: a production payment operation needs the capability of ITS channel, never another channel's.
const CHANNEL_CAPABILITY:Record<string,'payments'|'manual_bank'>={autolaris:'payments','manual-bank':'manual_bank'};
export async function assertChannelCapability(tx:TransactionSql,target:PaymentEnvironment,attempt:{method_id?:unknown}|undefined){
 if(target!=='production')return;
 const capability=CHANNEL_CAPABILITY[String(attempt?.method_id)];
 if(!capability)throw new AccessError(503,'PRODUCTION_MONEY_PATH_GATED');
 await moneyEnvironment(tx,capability);
}
function signature(e:Omit<ProviderEvent,'signature'>){return createHmac('sha256',signingKey(e.environment)).update(canonical(e)).digest('hex');}
// The connected database must be exactly the one the target names. `production` additionally requires the `payments`
// money capability (through signingKey/moneyEnvironment at the call sites); an unknown target is invalid.
async function profile(tx:TransactionSql,target:PaymentEnvironment){
 if(!['local','test','production'].includes(target)) throw invalid();const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`) throw invalid();
}
export function verifyProviderEvent(value:unknown):ProviderEvent{
 const e=object(value,['id','operation_id','attempt_id','environment','status','amount','currency','occurred_at','signature']);
 if(!['local','test','production'].includes(String(e.environment))||!['pending','confirmed','failed','expired'].includes(String(e.status))||e.currency!=='IDR'||typeof e.signature!=='string'||!/^[0-9a-f]{64}$/.test(e.signature)) throw invalid();
 const event={id:id(e.id),operation_id:id(e.operation_id),attempt_id:id(e.attempt_id),environment:e.environment as ProviderEvent['environment'],status:e.status as ProviderEvent['status'],amount:integer(e.amount,1,Number.MAX_SAFE_INTEGER),currency:'IDR' as const,occurred_at:financeInstant(e.occurred_at),signature:e.signature};
 if(!timingSafeEqual(Buffer.from(event.signature,'hex'),Buffer.from(signature(event),'hex'))) throw new AccessError(401,'INVALID_PAYMENT_SIGNATURE');return event;
}
export async function readProviderEvents(tx:TransactionSql,attemptId:string):Promise<ProviderEvent[]>{
 const rows=await tx`select e.*,o.attempt_id,o.environment from app.local_payment_event e join app.local_payment_operation o on o.id=e.operation_id where o.attempt_id=${id(attemptId)} order by e.recorded_at,e.id`;
 return rows.map(e=>({id:e.id,operation_id:e.operation_id,attempt_id:e.attempt_id,environment:e.environment,status:e.status,amount:Number(e.amount),currency:'IDR',occurred_at:new Date(e.occurred_at).toISOString(),signature:e.signature}));
}
async function appendProviderEvent(tx:TransactionSql,operation:Record<string,unknown>,occurred:string){
 const event:ProviderEvent={id:randomUUID(),operation_id:String(operation.id),attempt_id:String(operation.attempt_id),environment:operation.environment as ProviderEvent['environment'],status:operation.status as ProviderEvent['status'],amount:Number(operation.collected_amount??operation.requested_amount),currency:'IDR',occurred_at:occurred,signature:''};event.signature=signature(event);
 await tx`insert into app.local_payment_event (id,operation_id,status,amount,occurred_at,signature) values (${event.id},${event.operation_id},${event.status},${event.amount},${event.occurred_at},${event.signature})`;return event;
}
// Simulator entry points are host-controlled functions, never public HTTP input.
// The per-attempt mutex fences an old creator after a no-effect reconciliation.
export async function createLocalOperation(sql:Sql,target:PaymentEnvironment,attemptId:string,noEffect=false,crashBeforeCommit=false){
 return sql.begin(async tx=>{
  const opened=await openLocalOperation(tx,target,attemptId,noEffect);
  if(crashBeforeCommit) throw new Error('Simulated provider transaction failure before commit');
  return {operation_id:opened.operation_id,events:await readProviderEvents(tx,id(attemptId))};
 });
}
// Caller-transaction form (S93 binds the AutoLaris identity in the same transaction).
export async function openLocalOperation(tx:TransactionSql,target:PaymentEnvironment,attemptId:string,noEffect=false){
 await profile(tx,target);const selected=id(attemptId);await tx`select pg_advisory_xact_lock(hashtextextended(${`payment:${selected}`},0))`;
 const [attempt]=await tx`select a.*,o.status order_status,o.payment_status,app.reservation_clock(o.clock_namespace) as now from app.payment_attempt a join app.commerce_order o on o.id=a.order_id where a.id=${selected}`;if(!attempt) throw new AccessError(404,'NOT_FOUND');
 await assertChannelCapability(tx,target,attempt);
 let [operation]=await tx`select * from app.local_payment_operation where attempt_id=${selected}`;
 const rejected=noEffect||attempt.order_status!=='pending'||attempt.payment_status!=='pending'||new Date(attempt.now)>=new Date(attempt.expires_at);
 if(!operation){[operation]=await tx`insert into app.local_payment_operation (attempt_id,environment,status,requested_amount) values (${selected},${target},${rejected?'failed':'pending'},${attempt.expected_amount}) returning *`;await appendProviderEvent(tx,operation,new Date(attempt.now).toISOString());}
 return {operation_id:String(operation.id),status:String(operation.status)};
}
export async function simulateCollection(sql:Sql,target:'local'|'test',attemptId:string,options:{amount?:number;status?:'confirmed'|'failed'|'expired';occurred_at?:string}={}){
 return sql.begin(tx=>settleLocalOperation(tx,target,attemptId,options));
}
// Caller-transaction form: finance manual-bank confirmation (S92) settles the
// attempt's own operation with the actually received amount and bank time.
export async function settleLocalOperation(tx:TransactionSql,target:PaymentEnvironment,attemptId:string,options:{amount?:number;status?:'confirmed'|'failed'|'expired';occurred_at?:string}={}){
 {
  await profile(tx,target);const selected=id(attemptId);const [attempt]=await tx`select order_id,method_id from app.payment_attempt where id=${selected}`;if(!attempt) throw new AccessError(404,'NOT_FOUND');
  await assertChannelCapability(tx,target,attempt);
  await lockPaymentOrder(tx,attempt.order_id);await tx`select pg_advisory_xact_lock(hashtextextended(${`payment:${selected}`},0))`;
  const [operation]=await tx`select p.*,app.reservation_clock(o.clock_namespace) as now from app.local_payment_operation p join app.payment_attempt a on a.id=p.attempt_id join app.commerce_order o on o.id=a.order_id where p.attempt_id=${selected} for update of p`;
  if(!operation) throw new AccessError(404,'NOT_FOUND');
  const status=options.status??'confirmed',amount=integer(options.amount??Number(operation.requested_amount),1,Number.MAX_SAFE_INTEGER),now=options.occurred_at??new Date(operation.now).toISOString();
  if(!['confirmed','failed','expired'].includes(status)) throw invalid();
  if(operation.status==='pending'){
   const [updated]=await tx`update app.local_payment_operation set status=${status},collected_amount=${status==='confirmed'?amount:null},paid_at=${status==='confirmed'?now:null} where id=${operation.id} returning *`;
   return appendProviderEvent(tx,updated,now);
  }
  if(operation.status!==status||(status==='confirmed'&&Number(operation.collected_amount)!==amount)) throw new AccessError(409,'PROVIDER_EFFECT_FINAL');
  return appendProviderEvent(tx,operation,operation.paid_at?new Date(operation.paid_at).toISOString():now);
 }
}
export async function ingestProviderEvent(sql:Sql,value:unknown){return sql.begin(tx=>registerProviderEvent(tx,value));}
export async function registerProviderEvent(tx:TransactionSql,value:unknown){
 const e=verifyProviderEvent(value),hash=createHash('sha256').update(canonical(e)).digest('hex');
 {
  await profile(tx,e.environment);const rows=await readProviderEvents(tx,e.attempt_id),stored=rows.find(row=>row.id===e.id);
  if(!stored||canonical(stored)!==canonical(e)||stored.signature!==e.signature) throw new AccessError(401,'INVALID_PAYMENT_EVIDENCE');
  await tx`select pg_advisory_xact_lock(hashtextextended(${`payment-event:${e.id}`},0))`;
  const [previous]=await tx`select payload_hash,callback_job_id from app.payment_provider_event where id=${e.id}`;
  if(previous){if(previous.payload_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return String(previous.callback_job_id);}
  const job=await enqueueJob(tx,'payment.callback',`payment-callback:${e.id}`,{eventId:e.id});
  await tx`insert into app.payment_provider_event (id,attempt_id,payload_hash,callback_job_id) values (${e.id},${e.attempt_id},${hash},${job})`;return job;
 }
}
