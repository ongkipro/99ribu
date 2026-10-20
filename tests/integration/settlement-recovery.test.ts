import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import type {Sql,TransactionSql} from 'postgres';
import {connectDatabase} from '../../src/db/client.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {simulateSettlement,ingestSettlementEvent} from '../../src/modules/finance/settlements/local.ts';
import {simulateCodCollection,ingestCodEvent} from '../../src/modules/payments/cod-local.ts';
import {fulfillmentFixture} from './fulfillment-fixture.ts';

const host=(operationId:string)=>execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','test','--reconcile-settlement',operationId],{timeout:15000,stdio:'pipe'});
async function collected(){
 const f=await fulfillmentFixture('cod');
 for(const p of f.parcels)await f.run(await ingestCodEvent(f.identity.sql,await simulateCodCollection(f.identity.sql,'test',p.shipment_id)));
 const receipts=await f.identity.sql`select * from app.economic_receipt where order_id=${f.order.id} order by shipment_id`;
 return {...f,receipts};
}
const statement=(transactionId:string,gross=11,carrier=1,provider=1)=>({gross_amount:gross,carrier_fee:carrier,provider_fee:provider,allocation_claims:[{receivable_transaction_id:transactionId,gross_amount:gross}],reverses_reference:null});

test('fresh host restores original bank evidence and retries appended statements without changing money, original time or Purchase',async()=>{
 const f=await collected();try{
  const sql=f.identity.sql,input={provider:'local.cod',reference:randomUUID(),direction:'credit',net_amount:9,clock_namespace:f.namespace,statement:statement(f.receipts[0].transaction_id)};
  await assert.rejects(simulateSettlement(sql,'test',input,'before-commit'),/rollback before commit/);
  assert.equal((await sql`select count(*)::int n from app.local_settlement_operation where reference=${input.reference}`)[0].n,0);
  const sourceProgram=`import {connectDatabase} from './src/db/client.ts';import {simulateSettlement} from './src/modules/finance/settlements/local.ts';const {sql}=connectDatabase('test');try{await simulateSettlement(sql,'test',${JSON.stringify(input)},'after-commit-lost-ack');process.exitCode=1;}catch{process.exitCode=17;}finally{await sql.end();}`;
  const child=spawnSync(process.execPath,['--env-file=.env.example','--input-type=module','--eval',sourceProgram],{timeout:15000,stdio:'pipe'});assert.equal(child.status,17);
  const [original]=await sql`select * from app.local_settlement_operation where reference=${input.reference}`,[originalStatement]=await sql`select * from app.local_settlement_statement where operation_id=${original.id}`;
  assert.equal((await sql`select count(*)::int n from app.provider_settlement where operation_id=${original.id}`)[0].n,0);
  host(original.id);
  const [head]=await sql`select * from app.provider_settlement where operation_id=${original.id}`;assert.equal(head.status,'matched');assert.equal(head.revision,1);assert.equal(head.current_statement_id,originalStatement.id);
  const [cash]=await sql`select occurred_at from app.finance_transaction where id=${head.cash_transaction_id}`;assert.equal(new Date(cash.occurred_at).toISOString(),new Date(original.occurred_at).toISOString());
  const repeated=await simulateSettlement(sql,'test',input);assert.equal(repeated.operation_id,original.id);assert.equal(repeated.statement_id,originalStatement.id);assert.equal(repeated.occurred_at,new Date(original.occurred_at).toISOString());assert.equal(repeated.source_reported_at,new Date(originalStatement.source_reported_at).toISOString());
  host(original.id);host(original.id);
  assert.equal((await sql`select revision from app.provider_settlement where id=${head.id}`)[0].revision,1);
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where kind='settlement_cash' and effect_reference=${`cash:${original.id}`}`)[0].n,1);
  const changed={...input.statement,allocation_claims:null};
  const revise=()=>execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','test','--revise-settlement',original.id,'1'],{input:JSON.stringify(changed),timeout:15000,stdio:'pipe'});
  revise();const [revised]=await sql`select * from app.provider_settlement where id=${head.id}`;assert.equal(revised.revision,2);assert.equal(revised.status,'exception');assert.equal(revised.problem_code,'SETTLEMENT_STATEMENT_CHANGED');assert.equal(revised.current_match_id,head.current_match_id);assert.equal(revised.cash_transaction_id,head.cash_transaction_id);assert.equal(revised.fee_transaction_id,head.fee_transaction_id);
  const [latest]=await sql`select * from app.local_settlement_statement where operation_id=${original.id} order by revision desc limit 1`;assert.equal(latest.revision,2);assert.equal(latest.allocation_claims,null);assert.notEqual(latest.id,originalStatement.id);
  revise();assert.equal((await sql`select revision from app.provider_settlement where id=${head.id}`)[0].revision,2);assert.equal((await sql`select count(*)::int n from app.local_settlement_statement where operation_id=${original.id}`)[0].n,2);
  assert.equal(new Date((await sql`select occurred_at from app.local_settlement_operation where id=${original.id}`)[0].occurred_at).toISOString(),new Date(original.occurred_at).toISOString());
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where kind='settlement_cash' and effect_reference=${`cash:${original.id}`}`)[0].n,1);
  assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='Purchase'`)[0].n,2);
 }finally{await f.close();}
});

test('actual exhausted callback lock timeout recovers its original job through a fresh host with an audit of prior attempts',async()=>{
 const f=await collected(),blocker=connectDatabase('test');let release=()=>{};
 try{
  const sql=f.identity.sql,source=await simulateSettlement(sql,'test',{provider:'local.cod',reference:randomUUID(),direction:'credit',net_amount:9,clock_namespace:f.namespace,statement:statement(f.receipts[0].transaction_id)}),job=await ingestSettlementEvent(sql,source);
  await sql`update app.outbox_job set max_attempts=1 where id=${job}`;
  let locked=()=>{};const ready=new Promise<void>(resolve=>{locked=resolve;}),released=new Promise<void>(resolve=>{release=resolve;});
  const held=blocker.sql.begin(async tx=>{await tx`select id from app.local_settlement_operation where id=${source.operation_id} for update`;locked();await released;});await ready;
  const bounded=new Proxy(sql,{get(target,property,receiver){if(property==='begin')return (run:(tx:TransactionSql)=>Promise<unknown>)=>target.begin(async tx=>{await tx`set local lock_timeout='100ms'`;return run(tx);});return Reflect.get(target,property,receiver);}}) as unknown as Sql;
  try{assert.equal(await runOneJob(bounded,{},job),true);}finally{release();await held;}
  const [failed]=await sql`select status,attempts,last_error from app.outbox_job where id=${job}`;assert.equal(failed.status,'failed');assert.equal(failed.attempts,1);assert.equal(failed.last_error,'TEMPORARY_DATABASE_FAILURE');
  assert.equal((await sql`select count(*)::int n from app.provider_settlement where operation_id=${source.operation_id}`)[0].n,0);
  host(source.operation_id);
  const [stored]=await sql`select status,attempts from app.outbox_job where id=${job}`;assert.equal(stored.status,'completed');assert.equal(stored.attempts,1);
  const [audit]=await sql`select details from app.audit_event where action='local.settlement.reconcile' and subject_id=${source.operation_id} and details->>'job_id'=${job}`;assert.equal(audit.details.previous_status,'failed');assert.equal(audit.details.previous_attempts,1);
  assert.equal((await sql`select count(*)::int n from app.local_settlement_operation where id=${source.operation_id}`)[0].n,1);
  assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='Purchase'`)[0].n,2);
 }finally{release();await blocker.sql.end();await f.close();}
});
