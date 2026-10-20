import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import type {Sql,TransactionSql} from 'postgres';
import {enqueueJob} from '../../jobs/outbox.ts';
import {readLocalConfig} from '../../config/local.ts';
import {localSigningKey} from '../access/local-key.ts';
import {AccessError} from '../access/policy.ts';
import {id,integer,invalid,object} from '../catalog/validation.ts';
import {effectReference,financeInstant} from '../finance/ledger.ts';
import {lockPaymentOrder} from './attempts.ts';
import {codCollectionBasis} from '../finance/receipt-units.ts';

export type CodEvent={id:string;operation_id:string;shipment_id:string;environment:'local'|'test';status:'collected'|'refused';amount:number;currency:'IDR';occurred_at:string;signature:string};
function canonical(e:Omit<CodEvent,'signature'>){return JSON.stringify(['99ribu-cod-simulator-v1',e.environment,e.id,e.operation_id,e.shipment_id,e.status,e.amount,e.currency,e.occurred_at]);}
function signature(e:Omit<CodEvent,'signature'>){return createHmac('sha256',localSigningKey(e.environment)).update(canonical(e)).digest('hex');}
async function profile(tx:TransactionSql,target:'local'|'test'){
 readLocalConfig(process.env);if(!['local','test'].includes(target))throw invalid();const [database]=await tx`select current_database() name`;if(database.name!==`99ribu_${target}`)throw invalid();
}
function project(row:Record<string,unknown>):CodEvent{return {id:String(row.id),operation_id:String(row.operation_id),shipment_id:String(row.shipment_id),environment:row.environment as CodEvent['environment'],status:row.status as CodEvent['status'],amount:Number(row.amount),currency:'IDR',occurred_at:new Date(row.occurred_at as string).toISOString(),signature:String(row.signature)};}
export function verifyCodEvent(value:unknown):CodEvent{
 const body=object(value,['id','operation_id','shipment_id','environment','status','amount','currency','occurred_at','signature']);
 if(!['local','test'].includes(String(body.environment))||!['collected','refused'].includes(String(body.status))||body.currency!=='IDR'||typeof body.signature!=='string'||!/^[0-9a-f]{64}$/.test(body.signature))throw invalid();
 const event:CodEvent={id:id(body.id),operation_id:id(body.operation_id),shipment_id:id(body.shipment_id),environment:body.environment as CodEvent['environment'],status:body.status as CodEvent['status'],amount:integer(body.amount,body.status==='collected'?1:0,body.status==='collected'?Number.MAX_SAFE_INTEGER:0),currency:'IDR',occurred_at:financeInstant(body.occurred_at),signature:body.signature};
 if(!timingSafeEqual(Buffer.from(event.signature,'hex'),Buffer.from(signature(event),'hex')))throw new AccessError(401,'INVALID_COD_SIGNATURE');return event;
}
export async function readCodEvents(tx:TransactionSql,shipmentId:string):Promise<CodEvent[]>{
 const rows=await tx`select e.*,o.shipment_id,o.environment from app.local_cod_event e join app.local_cod_operation o on o.id=e.operation_id where o.shipment_id=${id(shipmentId)} order by e.recorded_at,e.id limit 1001`;
 // lazy: host-only recovery is bounded at1000 events; add keyset pages before larger replays.
 if(rows.length>1000)throw new AccessError(503,'COD_RECOVERY_LIMIT');return rows.map(project);
}
export async function readCodEvent(tx:TransactionSql,eventId:string){const [row]=await tx`select e.*,o.shipment_id,o.environment from app.local_cod_event e join app.local_cod_operation o on o.id=e.operation_id where e.id=${id(eventId)}`;return row?project(row):null;}
// Trusted local source producer. Normal host entry uses its independent SQL
// commit below; candidate tests use the same producer inside a rolled-back TX.
export async function codSourceEvent(tx:TransactionSql,target:'local'|'test',shipmentId:string,value:{reference?:string;status?:'collected'|'refused';amount?:number}={}):Promise<CodEvent>{
 await profile(tx,target);const selected=id(shipmentId),input=object(value,['reference','status','amount']),reference=effectReference(input.reference??selected),status=input.status??'collected';if(status!=='collected'&&status!=='refused')throw invalid();
 const [shipment]=await tx`select s.*,o.clock_namespace from app.order_shipment s join app.commerce_order o on o.id=s.order_id where s.id=${selected}`;if(!shipment)throw new AccessError(404,'NOT_FOUND');
 await lockPaymentOrder(tx,shipment.order_id);await tx`select pg_advisory_xact_lock(hashtextextended(${`cod-source:${selected}:${reference}`},0))`;
 const [confirmed]=await tx`select accepted_at from app.cod_confirmation where order_id=${shipment.order_id}`;if(!confirmed)throw new AccessError(409,'COD_NOT_CONFIRMED');
 let [operation]=await tx`select * from app.local_cod_operation where shipment_id=${selected} and reference=${reference} for update`;
 if(operation&&(operation.environment!==target||operation.status!==status))throw new AccessError(409,'COD_EFFECT_FINAL');
 const requested=operation?Number(operation.requested_amount):(await codCollectionBasis(tx,selected)).amount;
 // A retry of the original source uses its frozen amount, even if a later
 // case changed what a new collection could request.
 const amount=integer(input.amount??(operation?Number(operation.amount):status==='collected'?requested:0),status==='collected'?1:0,status==='collected'?Number.MAX_SAFE_INTEGER:0);
 if(operation&&Number(operation.amount)!==amount)throw new AccessError(409,'COD_EFFECT_FINAL');
 if(!operation){const [clock]=await tx`select app.reservation_clock(${shipment.clock_namespace}) now`;[operation]=await tx`insert into app.local_cod_operation (shipment_id,reference,environment,status,requested_amount,amount,occurred_at) values (${selected},${reference},${target},${status},${requested},${amount},${new Date(clock.now).toISOString()}) returning *`;}
 const event:CodEvent={id:randomUUID(),operation_id:operation.id,shipment_id:selected,environment:target,status,amount,currency:'IDR',occurred_at:new Date(operation.occurred_at).toISOString(),signature:''};event.signature=signature(event);
 await tx`insert into app.local_cod_event (id,operation_id,status,amount,occurred_at,signature) values (${event.id},${event.operation_id},${event.status},${amount},${event.occurred_at},${event.signature})`;return event;
}
export async function simulateCodCollection(sql:Sql,target:'local'|'test',shipmentId:string,input:Parameters<typeof codSourceEvent>[3]={},fault?:'before-commit'|'after-commit-lost-ack'){
 const event=await sql.begin(async tx=>{const event=await codSourceEvent(tx,target,shipmentId,input);if(fault==='before-commit')throw new Error('Simulated COD source rollback before commit');return event;});
 if(fault==='after-commit-lost-ack')throw new Error('Simulated COD source acknowledgement loss after commit');return event;
}
export async function registerCodEvent(tx:TransactionSql,value:unknown){
 const event=verifyCodEvent(value);await profile(tx,event.environment);
 const row=await readCodEvent(tx,event.id);
 if(!row||canonical(row)!==canonical(event)||row.signature!==event.signature)throw new AccessError(401,'INVALID_COD_EVIDENCE');
 await tx`select pg_advisory_xact_lock(hashtextextended(${`cod-event:${event.id}`},0))`;
 const hash=createHash('sha256').update(canonical(event)).digest('hex'),[prior]=await tx`select payload_hash,callback_job_id from app.cod_provider_event where id=${event.id}`;
 if(prior){if(prior.payload_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return String(prior.callback_job_id);}
 const job=await enqueueJob(tx,'cod.callback',`cod-callback:${event.id}`,{eventId:event.id});
 await tx`insert into app.cod_provider_event (id,shipment_id,payload_hash,callback_job_id) values (${event.id},${event.shipment_id},${hash},${job})`;return job;
}
export async function ingestCodEvent(sql:Sql,value:unknown){return sql.begin(tx=>registerCodEvent(tx,value));}
