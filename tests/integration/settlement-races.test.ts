import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import type {Sql,TransactionSql} from 'postgres';
import {connectDatabase} from '../../src/db/client.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {handleSettlements} from '../../src/modules/finance/settlements/routes.ts';
import {simulateSettlement,ingestSettlementEvent} from '../../src/modules/finance/settlements/local.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor} from './fulfillment-fixture.ts';
import {settlementFixture} from './settlement-fixture.ts';

function named(sql:Sql,name:string){return new Proxy(sql,{get(target,property,receiver){if(property==='begin')return (run:(tx:TransactionSql)=>Promise<unknown>)=>target.begin(async tx=>{await tx`select set_config('application_name',${name},true)`;return run(tx);});return Reflect.get(target,property,receiver);}}) as unknown as Sql;}
async function hold(sql:Sql,lock:(tx:TransactionSql)=>Promise<unknown>){
 let release=()=>{},entered=()=>{},failed=(_error:unknown)=>{};const released=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>((resolve,reject)=>{entered=resolve;failed=reject;});
 const done=sql.begin(async tx=>{await lock(tx);entered();await released;});void done.catch(failed);await ready;return {release,done};
}
async function blocked(sql:Sql,names:string[]){
 const deadline=Date.now()+5000;while(Date.now()<deadline){const [row]=await sql`select count(*)::int n from pg_stat_activity where datname=current_database() and usename=current_user and application_name=any(${names}::text[]) and wait_event_type='Lock'`;if(row.n===names.length)return;await setImmediate();}assert.fail('Every named transaction must reach the real database lock barrier');
}
async function proof(identity:Parameters<typeof handleAccess>[1],user:Awaited<ReturnType<typeof actor>>,subject:string){
 const request=user.browser.request('/api/v1/me/reauthentication-proofs',{password:user.password,action:'finance.reconcile',subject_id:subject});request.headers.set('idempotency-key',randomUUID());const response=await handleAccess(request,identity);assert.equal(response.status,201);return (await response.json()).proof as string;
}
function request(user:Awaited<ReturnType<typeof actor>>,root:string,input:Record<string,unknown>){const request=user.browser.request(`${root}/decisions`,input);request.headers.set('idempotency-key',randomUUID());return request;}

test('two independently authorized finance actors wait on one bank root and only one expected-version decision commits',async()=>{
 const f=await settlementFixture(),blocker=connectDatabase('test'),staff:Awaited<ReturnType<typeof actor>>[]=[],pending:Promise<Response>[]=[];let barrier:Awaited<ReturnType<typeof hold>>|undefined;
 try{
  for(let i=0;i<2;i++){const user=await actor(f.identity,'finance',[]);staff.push(user);await enroll(user.browser,user.password);await f.identity.sql`update app.role_grant set permissions=${['finance.reconciliation.read','finance.reconciliation.write']} where user_id=${user.id}`;}
  const inputs=[];for(const user of staff)inputs.push({action:'match',expected_version:1,expected_match_id:null,source_reference:f.source.statement_id,reason:'SYNTHETIC simultaneous classification',allocations:[{receivable_transaction_id:f.receipts[0].transaction_id,gross_amount:11}],reauthentication_proof:await proof(f.identity,user,f.head.id)});
  const names=staff.map(()=>`s30-${randomUUID()}`);barrier=await hold(blocker.sql,tx=>tx`select id from app.local_settlement_operation where id=${f.source.operation_id} for update`);
  for(let i=0;i<2;i++)pending.push(handleSettlements(request(staff[i],f.root,inputs[i]),{...f.identity,sql:named(f.identity.sql,names[i])}));
  try{await blocked(f.identity.sql,names);}finally{barrier.release();await barrier.done;}
  const responses=await Promise.all(pending);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);for(const response of responses)if(response.status===409)assert.equal((await response.json()).code,'VERSION_CONFLICT');
  assert.equal((await f.identity.sql`select revision from app.provider_settlement where id=${f.head.id}`)[0].revision,2);
  assert.equal((await f.identity.sql`select count(*)::int n from app.settlement_match where settlement_id=${f.head.id} and reversal_transaction_id is null`)[0].n,1);
  const consumed=await f.identity.sql`select count(*)::int n from app.access_proof p join app.auth_session s on s.id=p.session_id where s.user_id in ${f.identity.sql(staff.map(user=>user.id))} and p.action='finance.reconcile' and p.consumed_at is not null`;assert.equal(consumed[0].n,1);
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='Purchase'`)[0].n,2);
 }finally{barrier?.release();if(barrier)await barrier.done;await Promise.allSettled(pending);await blocker.sql.end();for(const user of staff)await closeFulfillmentActor(f.identity,user);await f.close();}
});

test('mutually referenced debit sources retain authentic cash without taking each other as credit-parent locks',async()=>{
 const connection=connectDatabase('test'),blocker=connectDatabase('test'),pending:Promise<boolean>[]=[];let barrier:Awaited<ReturnType<typeof hold>>|undefined;
 try{
  const sql=connection.sql,refs=[randomUUID(),randomUUID()],sources=[];assert.equal((await sql`select current_user name`)[0].name,'99ribu_test_app');
  for(let i=0;i<2;i++)sources.push(await simulateSettlement(sql,'test',{provider:'local.cod',reference:refs[i],direction:'debit',net_amount:9,statement:{gross_amount:11,carrier_fee:1,provider_fee:1,allocation_claims:[],reverses_reference:refs[1-i]}}));
  const jobs=[];for(const source of sources)jobs.push(await ingestSettlementEvent(sql,source));const names=sources.map(()=>`s30-${randomUUID()}`);
  barrier=await hold(blocker.sql,tx=>tx`lock table app.provider_settlement in share mode`);
  for(let i=0;i<2;i++)pending.push(runOneJob(named(sql,names[i]),{},jobs[i]));
  try{await blocked(sql,names);}finally{barrier.release();await barrier.done;}
  assert.deepEqual(await Promise.all(pending),[true,true]);
  const heads=await sql`select * from app.provider_settlement where operation_id in ${sql(sources.map(s=>s.operation_id))}`;assert.equal(heads.length,2);
  for(const head of heads){assert.equal(head.problem_code,'SETTLEMENT_REVERSAL_BASIS_UNKNOWN');assert.ok(head.cash_transaction_id);assert.equal(head.fee_transaction_id,null);assert.equal(head.current_match_id,null);}
  const completed=await sql`select status,attempts from app.outbox_job where id in ${sql(jobs)}`;assert.ok(completed.every(j=>j.status==='completed'&&j.attempts===1));
  const [cash]=await sql`select sum(p.amount)::text amount from app.finance_posting p where p.transaction_id in ${sql(heads.map(h=>h.cash_transaction_id))} and account='company_cash' and side='credit'`;assert.equal(cash.amount,'18');
 }finally{barrier?.release();if(barrier)await barrier.done;await Promise.allSettled(pending);await blocker.sql.end();await connection.sql.end();}
});

test('child unmatch locks its retained-fee parent before shared receivables so the waiting parent unmatch follows without deadlock',async()=>{
 const f=await settlementFixture(),finance=await actor(f.identity,'finance',[]),blocker=connectDatabase('test'),pending:Promise<Response>[]=[];let barrier:Awaited<ReturnType<typeof hold>>|undefined;
 try{
  await enroll(finance.browser,finance.password);await f.identity.sql`update app.role_grant set permissions=${['finance.reconciliation.read','finance.reconciliation.write']} where user_id=${finance.id}`;
  const matchInput={action:'match',expected_version:1,expected_match_id:null,source_reference:f.source.statement_id,reason:'SYNTHETIC original matching',allocations:[{receivable_transaction_id:f.receipts[0].transaction_id,gross_amount:11}],reauthentication_proof:await proof(f.identity,f.owner,f.head.id)};
  const response=await handleSettlements(request(f.owner,f.root,matchInput),f.identity);assert.equal(response.status,201);const parent=await response.json(),[allocation]=await f.identity.sql`select id from app.settlement_allocation where match_id=${parent.current_match_id}`;
  const source=await simulateSettlement(f.identity.sql,'test',{provider:'local.cod',reference:randomUUID(),direction:'debit',net_amount:9,clock_namespace:f.namespace,statement:{gross_amount:11,carrier_fee:1,provider_fee:1,allocation_claims:[{receivable_transaction_id:f.receipts[0].transaction_id,gross_amount:11,reopens_allocation_id:allocation.id}],reverses_reference:f.source.reference}}),job=await ingestSettlementEvent(f.identity.sql,source);
  assert.equal(await runOneJob(f.identity.sql,{},job),true);const [child]=await f.identity.sql`select * from app.provider_settlement where operation_id=${source.operation_id}`;assert.equal(child.status,'matched');
  const childInput={action:'unmatch',expected_version:child.revision,expected_match_id:child.current_match_id,source_reference:source.statement_id,reason:'SYNTHETIC reverse dependent matching first',allocations:[],reauthentication_proof:await proof(f.identity,finance,child.id)},parentInput={...childInput,expected_version:parent.version,expected_match_id:parent.current_match_id,source_reference:f.source.statement_id,reauthentication_proof:await proof(f.identity,f.owner,f.head.id)},names=[`s30-${randomUUID()}`,`s30-${randomUUID()}`];
  barrier=await hold(blocker.sql,tx=>tx`select id from app.finance_transaction where id=${f.receipts[0].transaction_id} for update`);
  pending.push(handleSettlements(request(finance,`/api/v1/admin/reconciliation/${child.id}`,childInput),{...f.identity,sql:named(f.identity.sql,names[0])}));await blocked(f.identity.sql,[names[0]]);
  pending.push(handleSettlements(request(f.owner,f.root,parentInput),{...f.identity,sql:named(f.identity.sql,names[1])}));
  try{await blocked(f.identity.sql,names);}finally{barrier.release();await barrier.done;}
  const results=await Promise.all(pending);for(const result of results){const payload=await result.json();assert.equal(result.status,201,`Both ordered corrections commit; safe result ${payload.code??'success'}`);assert.equal(payload.current_match_id,null);}
  const heads=await f.identity.sql`select current_match_id,fee_transaction_id from app.provider_settlement where id in ${f.identity.sql([f.head.id,child.id])}`;assert.ok(heads.every(h=>h.current_match_id===null&&h.fee_transaction_id!==null));
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='Purchase'`)[0].n,2);
 }finally{barrier?.release();if(barrier)await barrier.done;await Promise.allSettled(pending);await blocker.sql.end();await closeFulfillmentActor(f.identity,finance);await f.close();}
});

test('different authenticated bank roots serialize on original receivable capacity while retaining both observed cash credits',async()=>{
 const f=await settlementFixture(),blocker=connectDatabase('test'),pending:Promise<boolean>[]=[];let barrier:Awaited<ReturnType<typeof hold>>|undefined;
 try{
  const sql=f.identity.sql,gross=Number(f.receipts[0].amount),sources=[],jobs=[];
  for(let i=0;i<2;i++){const source=await simulateSettlement(sql,'test',{provider:'local.cod',reference:randomUUID(),direction:'credit',net_amount:gross,clock_namespace:f.namespace,statement:{gross_amount:gross,carrier_fee:0,provider_fee:0,allocation_claims:[{receivable_transaction_id:f.receipts[0].transaction_id,gross_amount:gross}],reverses_reference:null}});sources.push(source);jobs.push(await ingestSettlementEvent(sql,source));}
  const names=sources.map(()=>`s30-${randomUUID()}`);barrier=await hold(blocker.sql,tx=>tx`select id from app.finance_transaction where id=${f.receipts[0].transaction_id} for update`);
  for(let i=0;i<2;i++)pending.push(runOneJob(named(sql,names[i]),{},jobs[i]));
  try{await blocked(sql,names);}finally{barrier.release();await barrier.done;}
  assert.deepEqual(await Promise.all(pending),[true,true]);const heads=await sql`select * from app.provider_settlement where operation_id in ${sql(sources.map(s=>s.operation_id))}`;
  assert.equal(heads.filter(h=>h.status==='matched').length,1);assert.equal(heads.filter(h=>h.problem_code==='SETTLEMENT_RECEIVABLE_EXCEEDED'&&h.current_match_id===null).length,1);assert.ok(heads.every(h=>h.cash_transaction_id!==null));
  const [allocated]=await sql`select sum(a.gross_amount)::text amount from app.settlement_allocation a join app.settlement_match m on m.id=a.match_id where a.receivable_transaction_id=${f.receipts[0].transaction_id} and m.reversal_transaction_id is null`;assert.equal(allocated.amount,String(gross));
  assert.ok((await sql`select status from app.outbox_job where id in ${sql(jobs)}`).every(j=>j.status==='completed'));
  assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='Purchase'`)[0].n,2);
 }finally{barrier?.release();if(barrier)await barrier.done;await Promise.allSettled(pending);await blocker.sql.end();await f.close();}
});
