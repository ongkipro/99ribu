import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {readLocalConfig} from '../../../config/local.ts';
import {enqueueJob} from '../../../jobs/outbox.ts';
import {localSigningKey} from '../../access/local-key.ts';
import {AccessError} from '../../access/policy.ts';
import {id,integer,invalid,object,text} from '../../catalog/validation.ts';
import {effectReference,financeInstant} from '../ledger.ts';
import {settlementClaims,settlementTotals} from './allocation.ts';

export function settlementStatement(value:unknown){
 const input=object(value,['gross_amount','carrier_fee','provider_fee','allocation_claims','reverses_reference']);
 return {...settlementTotals({gross_amount:input.gross_amount,carrier_fee:input.carrier_fee,provider_fee:input.provider_fee}),allocation_claims:input.allocation_claims===null?null:settlementClaims(input.allocation_claims),reverses_reference:input.reverses_reference===null?null:effectReference(input.reverses_reference)};
}
export type SettlementSourceEvent={id:string;operation_id:string;statement_id:string;statement_revision:number;provider:'local.payment'|'local.cod';environment:'local'|'test';reference:string;direction:'credit'|'debit';net_amount:number;clock_namespace:string|null;occurred_at:string;source_reported_at:string;statement:ReturnType<typeof settlementStatement>;signature:string};
function canonical(e:Omit<SettlementSourceEvent,'signature'>){
 return JSON.stringify(['99ribu-settlement-simulator-v1',e.environment,e.id,e.operation_id,e.statement_id,e.statement_revision,e.provider,e.reference,e.direction,e.net_amount,e.clock_namespace,e.occurred_at,e.source_reported_at,e.statement]);
}
function signature(e:Omit<SettlementSourceEvent,'signature'>){return createHmac('sha256',localSigningKey(e.environment)).update(canonical(e)).digest('hex');}
function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
async function profile(tx:TransactionSql,target:'local'|'test'){
 readLocalConfig(process.env);if(!['local','test'].includes(target))throw invalid();const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`)throw invalid();
}
function namespace(value:unknown){if(value===null)return null;const result=text(value,24);if(result!==value||! /^[a-z][a-z0-9-]{0,23}$/.test(result))throw invalid();return result;}
export function verifySettlementEvent(value:unknown):SettlementSourceEvent{
 const b=object(value,['id','operation_id','statement_id','statement_revision','provider','environment','reference','direction','net_amount','clock_namespace','occurred_at','source_reported_at','statement','signature']);
 if(!['local','test'].includes(String(b.environment))||!['local.payment','local.cod'].includes(String(b.provider))||!['credit','debit'].includes(String(b.direction))||typeof b.signature!=='string'||!/^[0-9a-f]{64}$/.test(b.signature))throw invalid();
 const event:SettlementSourceEvent={id:id(b.id),operation_id:id(b.operation_id),statement_id:id(b.statement_id),statement_revision:integer(b.statement_revision,1),provider:b.provider as SettlementSourceEvent['provider'],environment:b.environment as SettlementSourceEvent['environment'],reference:effectReference(b.reference),direction:b.direction as SettlementSourceEvent['direction'],net_amount:integer(b.net_amount,0,Number.MAX_SAFE_INTEGER),clock_namespace:namespace(b.clock_namespace),occurred_at:financeInstant(b.occurred_at),source_reported_at:financeInstant(b.source_reported_at),statement:settlementStatement(b.statement),signature:b.signature};
 if(Date.parse(event.source_reported_at)<Date.parse(event.occurred_at))throw invalid();
 if(!timingSafeEqual(Buffer.from(event.signature,'hex'),Buffer.from(signature(event),'hex')))throw new AccessError(401,'INVALID_SETTLEMENT_SIGNATURE');return event;
}
function project(row:Record<string,unknown>):SettlementSourceEvent{
 return {id:String(row.id),operation_id:String(row.operation_id),statement_id:String(row.statement_id),statement_revision:Number(row.revision),provider:row.provider as SettlementSourceEvent['provider'],environment:row.environment as SettlementSourceEvent['environment'],reference:String(row.reference),direction:row.direction as SettlementSourceEvent['direction'],net_amount:Number(row.net_amount),clock_namespace:row.clock_namespace===null?null:String(row.clock_namespace),occurred_at:new Date(row.occurred_at as string).toISOString(),source_reported_at:new Date(row.source_reported_at as string).toISOString(),statement:settlementStatement({gross_amount:row.gross_amount===null?null:Number(row.gross_amount),carrier_fee:row.carrier_fee===null?null:Number(row.carrier_fee),provider_fee:row.provider_fee===null?null:Number(row.provider_fee),allocation_claims:row.allocation_claims,reverses_reference:row.reverses_reference}),signature:String(row.signature)};
}
export async function readSettlementSourceEvent(tx:TransactionSql,eventId:string){
 const [row]=await tx`select e.*,s.operation_id,s.revision,s.gross_amount,s.carrier_fee,s.provider_fee,s.allocation_claims,s.reverses_reference,s.source_reported_at,o.provider,o.environment,o.reference,o.direction,o.net_amount,o.clock_namespace,o.occurred_at from app.local_settlement_event e join app.local_settlement_statement s on s.id=e.statement_id join app.local_settlement_operation o on o.id=s.operation_id where e.id=${id(eventId)}`;
 return row?project(row):null;
}
async function emit(tx:TransactionSql,statementId:string){
 const eventId=randomUUID();
 const [row]=await tx`select ${eventId}::uuid id,s.id statement_id,s.operation_id,s.revision,s.gross_amount,s.carrier_fee,s.provider_fee,s.allocation_claims,s.reverses_reference,s.source_reported_at,o.provider,o.environment,o.reference,o.direction,o.net_amount,o.clock_namespace,o.occurred_at,'' signature from app.local_settlement_statement s join app.local_settlement_operation o on o.id=s.operation_id where s.id=${statementId}`;
 if(!row)throw new AccessError(404,'NOT_FOUND');const event=project(row);event.signature=signature(event);
 await tx`insert into app.local_settlement_event (id,statement_id,signature) values (${event.id},${statementId},${event.signature})`;return event;
}
// Host-only producer. Source commits independently of callback acceptance;
// repeated delivery preserves original money time and statement identity.
export async function settlementSourceEvent(tx:TransactionSql,target:'local'|'test',value:unknown){
 await profile(tx,target);const input=object(value,['provider','reference','direction','net_amount','clock_namespace','occurred_at','statement']);
 if(!['local.payment','local.cod'].includes(String(input.provider))||!['credit','debit'].includes(String(input.direction)))throw invalid();
 const provider=String(input.provider),reference=effectReference(input.reference),direction=String(input.direction),net=integer(input.net_amount,0,Number.MAX_SAFE_INTEGER),clock=namespace(input.clock_namespace??null),statement=settlementStatement(input.statement);
 if(clock!==null){const [fixture]=await tx`select name from app.local_fixture_namespace where name=${clock} for share`;if(!fixture)throw invalid();}
 await tx`select pg_advisory_xact_lock(hashtextextended(${`settlement-source:${target}:${provider}:${reference}`},0))`;
 let [operation]=await tx`select * from app.local_settlement_operation where provider=${provider} and environment=${target} and reference=${reference} for update`;
 const [time]=await tx`select app.reservation_clock(${clock}) now`,now=new Date(time.now).toISOString(),occurred=input.occurred_at===undefined?(operation?new Date(operation.occurred_at).toISOString():now):financeInstant(input.occurred_at);
 if(Date.parse(occurred)>Date.parse(now))throw invalid();
 const requestHash=hash({provider,environment:target,reference,direction,net_amount:net,clock_namespace:clock,occurred_at:occurred});
 if(operation&&operation.request_hash!==requestHash)throw new AccessError(409,'SETTLEMENT_EFFECT_FINAL');
 if(!operation)[operation]=await tx`insert into app.local_settlement_operation (provider,environment,reference,direction,net_amount,clock_namespace,occurred_at,request_hash) values (${provider},${target},${reference},${direction},${net},${clock},${occurred},${requestHash}) returning *`;
 const [original]=await tx`select * from app.local_settlement_statement where operation_id=${operation.id} and revision=1`;
 if(original){if(original.request_hash!==hash(statement))throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return emit(tx,original.id);}
 const [created]=await tx`insert into app.local_settlement_statement (operation_id,revision,gross_amount,carrier_fee,provider_fee,allocation_claims,reverses_reference,source_reported_at,request_hash) values (${operation.id},1,${statement.gross_amount},${statement.carrier_fee},${statement.provider_fee},${statement.allocation_claims===null?null:JSON.stringify(statement.allocation_claims)}::jsonb,${statement.reverses_reference},${now},${hash(statement)}) returning id`;
 return emit(tx,created.id);
}
export async function reviseSettlementStatement(tx:TransactionSql,target:'local'|'test',operationId:string,expectedRevision:number,value:unknown){
 await profile(tx,target);const selected=id(operationId),version=integer(expectedRevision,1),statement=settlementStatement(value);
 const [operation]=await tx`select * from app.local_settlement_operation where id=${selected} for update`;if(!operation)throw new AccessError(404,'NOT_FOUND');if(operation.environment!==target)throw invalid();
 const [current]=await tx`select * from app.local_settlement_statement where operation_id=${selected} order by revision desc limit 1`;
 if(!current)throw new AccessError(409,'SETTLEMENT_SOURCE_INCOMPLETE');
 const requestHash=hash(statement);
 if(Number(current.revision)===version+1&&current.request_hash===requestHash)return emit(tx,current.id);
 if(Number(current.revision)!==version)throw new AccessError(409,'VERSION_CONFLICT');
 if(current.request_hash===requestHash)return emit(tx,current.id);
 if(version===2147483647)throw new AccessError(409,'SETTLEMENT_SOURCE_VERSION_EXHAUSTED');
 const [clock]=await tx`select app.reservation_clock(${operation.clock_namespace}) now`,now=new Date(clock.now).toISOString();if(Date.parse(now)<Date.parse(new Date(current.source_reported_at).toISOString()))throw new AccessError(409,'SETTLEMENT_CLOCK_REGRESSED');
 const [created]=await tx`insert into app.local_settlement_statement (operation_id,revision,gross_amount,carrier_fee,provider_fee,allocation_claims,reverses_reference,source_reported_at,request_hash) values (${selected},${version+1},${statement.gross_amount},${statement.carrier_fee},${statement.provider_fee},${statement.allocation_claims===null?null:JSON.stringify(statement.allocation_claims)}::jsonb,${statement.reverses_reference},${now},${requestHash}) returning id`;
 return emit(tx,created.id);
}
export async function simulateSettlement(sql:Sql,target:'local'|'test',value:unknown,fault?:'before-commit'|'after-commit-lost-ack'){
 const event=await sql.begin(async tx=>{const event=await settlementSourceEvent(tx,target,value);if(fault==='before-commit')throw new Error('Simulated settlement source rollback before commit');return event;});
 if(fault==='after-commit-lost-ack')throw new Error('Simulated settlement source acknowledgement loss after commit');return event;
}
export async function registerSettlementEvent(tx:TransactionSql,value:unknown){
 const event=verifySettlementEvent(value);await profile(tx,event.environment);const source=await readSettlementSourceEvent(tx,event.id);
 if(!source||canonical(source)!==canonical(event)||source.signature!==event.signature)throw new AccessError(401,'INVALID_SETTLEMENT_EVIDENCE');
 await tx`select pg_advisory_xact_lock(hashtextextended(${`settlement-event:${event.id}`},0))`;const payloadHash=createHash('sha256').update(canonical(event)).digest('hex'),[prior]=await tx`select payload_hash,callback_job_id from app.settlement_provider_event where id=${event.id}`;
 if(prior){if(prior.payload_hash!==payloadHash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return String(prior.callback_job_id);}
 const job=await enqueueJob(tx,'settlement.callback',`settlement-callback:${event.id}`,{eventId:event.id});
 await tx`insert into app.settlement_provider_event (id,operation_id,payload_hash,callback_job_id) values (${event.id},${event.operation_id},${payloadHash},${job})`;return job;
}
export async function ingestSettlementEvent(sql:Sql,value:unknown){return sql.begin(tx=>registerSettlementEvent(tx,value));}
