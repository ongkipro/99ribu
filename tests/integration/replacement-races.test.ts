import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';
import type {Sql,TransactionSql} from 'postgres';
import {runOneJob} from '../../src/jobs/worker.ts';
import {actOnReplacement} from '../../src/modules/returns/replacements.ts';
import {simulateReplacementReceipt,ingestReplacementReceiptSource} from '../../src/modules/returns/replacement-receipts.ts';
import {replacementFixture} from './replacement-fixture.ts';

function named(sql:Sql,name:string){return new Proxy(sql,{get(target,property,receiver){
 if(property==='begin')return (run:(tx:TransactionSql)=>Promise<unknown>)=>target.begin(async tx=>{
  await tx`select set_config('application_name',${name},true)`;return run(tx);
 });return Reflect.get(target,property,receiver);
}}) as Sql;}

test('two current replacement preparations wait on the observed order lock and commit one CAS winner',async()=>{
 const f=await replacementFixture(),sql=f.sql,names=[`s32-prepare-a-${randomUUID()}`,`s32-prepare-b-${randomUUID()}`];
 let release=()=>{},entered=()=>{},failed=(_error:unknown)=>{},blockerPid=0;
 const held=new Promise<void>(r=>{release=r;}),ready=new Promise<void>((r,j)=>{entered=r;failed=j;});
 let blocker:Promise<unknown>|undefined,pending:Promise<{ok:true;result:unknown}|{ok:false;error:unknown}>[]=[];
 try{
  const revision=f.head.version,body={expected_version:revision,reason:'SYNTHETIC concurrent complete replacement preparation'};
  blocker=sql.begin(async tx=>{blockerPid=Number((await tx`select pg_backend_pid() pid`)[0].pid);await tx`select id from app.commerce_order where id=${f.order.id} for update`;entered();await held;});
  void blocker.catch(failed);await ready;
  pending=names.map(name=>actOnReplacement(f.command(`/api/v1/admin/replacements/${f.head.id}/preparations`,body),{...f.identity,sql:named(sql,name)},f.principal,f.head.id,body,'prepare').then(result=>({ok:true as const,result}),error=>({ok:false as const,error})));
  const deadline=Date.now()+5000;let observed=false;
  while(Date.now()<deadline){
   const rows=await sql`select pid,pg_blocking_pids(pid) blockers,wait_event_type from pg_stat_activity where application_name=any(${names}::text[])`;
   const blockers=new Map<number,number[]>(rows.map(row=>[Number(row.pid),row.blockers]));
   const reaches=(pid:number,seen=new Set<number>()):boolean=>{if(seen.has(pid))return false;seen.add(pid);return (blockers.get(pid)??[]).some(next=>next===blockerPid||reaches(next,seen));};
   if(rows.length===2&&rows.every(row=>row.wait_event_type==='Lock'&&reaches(Number(row.pid)))){observed=true;break;}
   await setImmediate();
  }
  assert.equal(observed,true,'Both actual requests must wait through this exact order lock');
  release();await blocker;const results=await Promise.all(pending);
  assert.equal(results.filter(result=>result.ok).length,1);
  const rejected=results.find(result=>!result.ok);assert.ok(rejected&&!rejected.ok);
  assert.ok(rejected.error&&typeof rejected.error==='object'&&'code'in rejected.error);assert.equal(rejected.error.code,'VERSION_CONFLICT');
  const [head]=await sql`select status,revision from app.replacement_shipment where id=${f.head.id}`;
  assert.equal(head.status,'picking');assert.equal(head.revision,revision+1);
  assert.equal((await sql`select count(*)::int n from app.replacement_event where shipment_id=${f.head.id} and kind='prepare'`)[0].n,1);
  assert.equal((await sql`select count(*)::int n from app.replacement_operation where subject_id=${f.head.id} and action='prepare'`)[0].n,1);
  assert.equal(await f.economic(),f.originalEconomics);
 }finally{release();await Promise.allSettled([...(blocker?[blocker]:[]),...pending]);await f.close();}
});

test('concurrent registration and an observed locked receipt worker retain one callback and one first receipt',async()=>{
 const f=await replacementFixture(),sql=f.sql,name=`s32-receipt-worker-${randomUUID()}`;
 let release=()=>{},entered=()=>{},failed=(_error:unknown)=>{},blockerPid=0;
 const held=new Promise<void>(r=>{release=r;}),ready=new Promise<void>((r,j)=>{entered=r;failed=j;});
 let blocker:Promise<unknown>|undefined,processing:Promise<unknown>|undefined;
 try{
  await f.act('prepare');await f.act('book');assert.ok(f.head.booking_id);
  execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','test','--issue-replacement-waybill',f.head.booking_id],{timeout:15000,stdio:'pipe'});
  await f.act('handover');
  const unit=f.head.items[0].id,source=await simulateReplacementReceipt(sql,'test',{reference:randomUUID(),booking_id:f.head.booking_id,unit_ids:[unit]});
  const callbacks=await Promise.all([ingestReplacementReceiptSource(sql,source),ingestReplacementReceiptSource(sql,source)]);assert.equal(callbacks[0],callbacks[1]);
  blocker=sql.begin(async tx=>{blockerPid=Number((await tx`select pg_backend_pid() pid`)[0].pid);await tx`select id from app.replacement_shipment where id=${f.head.id} for update`;entered();await held;});
  void blocker.catch(failed);await ready;
  processing=runOneJob(named(sql,name),{},callbacks[0]);void processing.catch(()=>{});
  const deadline=Date.now()+5000;let observed=false;
  while(Date.now()<deadline){const [row]=await sql`select wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where application_name=${name}`;
   if(row?.wait_event_type==='Lock'&&row.blockers.includes(blockerPid)){observed=true;break;}await setImmediate();}
  assert.equal(observed,true,'The real callback worker must wait on this physical shipment lock');
  assert.equal(await runOneJob(sql,{},callbacks[0]),false,'Another worker cannot select the already locked callback');
  release();await blocker;assert.equal(await processing,true);
  const [result]=await sql`select receipt_count from app.replacement_receipt_result where event_id=${source.id}`;assert.equal(result.receipt_count,1);
  const receipts=await sql`select source_id,received_at from app.replacement_buyer_receipt where replacement_link_id=${unit}`;
  assert.equal(receipts.length,1);assert.equal(receipts[0].source_id,source.id);assert.equal(new Date(receipts[0].received_at).toISOString(),source.occurred_at);
  assert.equal((await sql`select attempts,status from app.outbox_job where id=${callbacks[0]}`)[0].attempts,1);
  assert.equal(await f.economic(),f.originalEconomics);
 }finally{release();await Promise.allSettled([...(blocker?[blocker]:[]),...(processing?[processing]:[])]);await f.close();}
});
