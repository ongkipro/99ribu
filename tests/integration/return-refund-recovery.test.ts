import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {reconcileRefundNow,recoverRefund} from '../../src/modules/returns/refund-recovery.ts';
import {projectBuyerRefund} from '../../src/modules/returns/refunds.ts';
import {refundAdapter} from '../../src/modules/returns/worker.ts';
import {approvedRefundFixture} from './return-refund-fixture.ts';

const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const host=(mode:string,refundId:string)=>execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','test',mode,refundId],{timeout:15000,stdio:'pipe'});

for(const fault of ['creation-commit-lost-ack','paid-commit-lost-ack'] as const)test(`fresh host reconciles ${fault} without a second original request, cash effect or Purchase`,async()=>{
 const f=await approvedRefundFixture(),sql=f.identity.sql;
 try{
  const purchases=async()=>fingerprint(await sql`select id,receipt_id,occurred_at,merchandise_amount,payload from app.commerce_event where order_id=${f.order.id} and name='Purchase' order by id`),before=await purchases();
  assert.equal(await runOneJob(sql,{'refund.create':refundAdapter(sql,'test',new Map([[f.refund.id,fault]]))},f.jobId),true);
  const [unknown]=await sql`select status,attempts,payload from app.outbox_job where id=${f.jobId}`;assert.equal(unknown.status,'unknown');assert.equal(unknown.payload.attempt,1);
  const original=await sql`select id,creation_job_id,attempt,created_at from app.local_refund_operation where refund_id=${f.refund.id}`;assert.equal(original.length,1);assert.equal(original[0].creation_job_id,f.jobId);
  const source=await sql`select id,occurred_at,status,amount from app.local_refund_event where operation_id=${original[0].id}`;assert.equal(source.length,fault==='paid-commit-lost-ack'?1:0);
  const refund=await sql.begin(tx=>projectBuyerRefund(tx,f.refund.id));assert.equal(refund.status,'unknown');
  const proof=await f.proof(f.refund.id),retry={action:'retry',expected_version:refund.version,reason:'SYNTHETIC unsafe retry must remain denied',reauthentication_proof:proof};
  await assert.rejects(recoverRefund(f.financeRequest(`/api/v1/admin/refunds/${f.refund.id}/reconciliations`,retry),f.identity,f.financePrincipal,f.refund.id,retry),{code:'REFUND_OUTCOME_STILL_AMBIGUOUS'});
  assert.equal((await sql`select consumed_at from app.access_proof where digest=${createHash('sha256').update(proof).digest('hex')}`)[0].consumed_at,null);
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,0);
  host('--reconcile-refund',f.refund.id);assert.equal((await sql`select status from app.outbox_job where id=${f.jobId}`)[0].status,'completed');
  assert.equal(fingerprint(await sql`select id,creation_job_id,attempt,created_at from app.local_refund_operation where refund_id=${f.refund.id}`),fingerprint(original));
  if(source.length)assert.equal(fingerprint(await sql`select id,occurred_at,status,amount from app.local_refund_event where operation_id=${original[0].id}`),fingerprint(source));
  else{assert.equal((await sql.begin(tx=>projectBuyerRefund(tx,f.refund.id))).status,'processing');host('--confirm-refund',f.refund.id);}
  host('--reconcile-refund',f.refund.id);
  assert.equal((await sql.begin(tx=>projectBuyerRefund(tx,f.refund.id))).status,'succeeded');assert.equal((await sql`select count(*)::int n from app.local_refund_operation where refund_id=${f.refund.id}`)[0].n,1);assert.equal((await sql`select count(*)::int n from app.local_refund_event where operation_id=${original[0].id}`)[0].n,1);
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,1);assert.equal((await sql`select count(*)::int n from app.refund_adjustment_intent where refund_id=${f.refund.id}`)[0].n,1);assert.equal(await purchases(),before);
  assert.equal((await sql`select current_job_id from app.refund where id=${f.refund.id}`)[0].current_job_id,f.jobId);assert.ok((await sql`select attempts from app.outbox_job where id=${f.jobId}`)[0].attempts>=unknown.attempts);
 }finally{await f.close();}
});

test('rolled-back request stays unknown until a fenced absence check and resumes only the same original creation job',async()=>{
 const f=await approvedRefundFixture(),sql=f.identity.sql;
 try{
  const fault=refundAdapter(sql,'test',new Map([[f.refund.id,'before-commit' as const]]));assert.equal(await runOneJob(sql,{'refund.create':fault},f.jobId),true);
  const [job]=await sql`select status,attempts from app.outbox_job where id=${f.jobId}`;assert.equal(job.status,'unknown');assert.equal((await sql`select count(*)::int n from app.local_refund_operation where refund_id=${f.refund.id}`)[0].n,0);
  const unknown=await sql.begin(tx=>projectBuyerRefund(tx,f.refund.id));assert.equal(unknown.status,'unknown');
  const retry={action:'retry',expected_version:unknown.version,reason:'SYNTHETIC no root alone is not a new-attempt authorization',reauthentication_proof:await f.proof(f.refund.id)};
  await assert.rejects(recoverRefund(f.financeRequest(`/api/v1/admin/refunds/${f.refund.id}/reconciliations`,retry),f.identity,f.financePrincipal,f.refund.id,retry),{code:'REFUND_OUTCOME_STILL_AMBIGUOUS'});
  await reconcileRefundNow(sql,f.refund.id);assert.equal(await runOneJob(sql,{'refund.create':refundAdapter(sql,'test')},f.jobId),true);
  assert.equal((await sql`select status from app.outbox_job where id=${f.jobId}`)[0].status,'pending');assert.equal((await sql`select count(*)::int n from app.local_refund_operation where refund_id=${f.refund.id}`)[0].n,0);
  host('--confirm-refund',f.refund.id);const [root]=await sql`select creation_job_id,attempt from app.local_refund_operation where refund_id=${f.refund.id}`;assert.equal(root.creation_job_id,f.jobId);assert.equal(root.attempt,1);
  assert.equal((await sql.begin(tx=>projectBuyerRefund(tx,f.refund.id))).status,'succeeded');assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_obligation'`)[0].n,1);assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,1);
 }finally{await f.close();}
});

test('terminal no-request exhaustion keeps its original attempts and obligation until explicit finance authorizes one new attempt',async()=>{
 const f=await approvedRefundFixture(),sql=f.identity.sql;
 try{
  const fault=refundAdapter(sql,'test',new Map([[f.refund.id,'before-commit' as const]])),[initial]=await sql`select max_attempts from app.outbox_job where id=${f.jobId}`;
  let terminal=false;
  for(let step=0;step<initial.max_attempts*2+1;step++){
   await reconcileRefundNow(sql,f.refund.id);assert.equal(await runOneJob(sql,{'refund.create':fault},f.jobId),true);
   const [job]=await sql`select status,payload,attempts,max_attempts from app.outbox_job where id=${f.jobId}`;assert.equal(job.payload.attempt,1);
   if(job.status==='failed'){assert.equal(job.attempts,job.max_attempts);terminal=true;break;}
   assert.ok(['pending','unknown'].includes(job.status));
  }
  assert.equal(terminal,true);assert.equal((await sql`select count(*)::int n from app.local_refund_operation where refund_id=${f.refund.id}`)[0].n,0);
  const exhausted=await sql.begin(tx=>projectBuyerRefund(tx,f.refund.id));assert.equal(exhausted.status,'failed');
  const originalJob=fingerprint(await sql`select id,status,payload,attempts,max_attempts from app.outbox_job where id=${f.jobId}`),input={action:'retry',expected_version:exhausted.version,reason:'SYNTHETIC new attempt after fenced terminal proof of no original request',reauthentication_proof:await f.proof(f.refund.id)};
  await recoverRefund(f.financeRequest(`/api/v1/admin/refunds/${f.refund.id}/reconciliations`,input),f.identity,f.financePrincipal,f.refund.id,input);
  const [head]=await sql`select current_job_id from app.refund where id=${f.refund.id}`;assert.notEqual(head.current_job_id,f.jobId);assert.equal((await sql`select payload from app.outbox_job where id=${head.current_job_id}`)[0].payload.attempt,2);
  host('--confirm-refund',f.refund.id);const [root]=await sql`select creation_job_id,attempt from app.local_refund_operation where refund_id=${f.refund.id}`;assert.equal(root.creation_job_id,head.current_job_id);assert.equal(root.attempt,2);
  assert.equal(fingerprint(await sql`select id,status,payload,attempts,max_attempts from app.outbox_job where id=${f.jobId}`),originalJob);assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_obligation'`)[0].n,1);assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${f.order.id} and kind='refund_cash'`)[0].n,1);
  assert.equal((await sql.begin(tx=>projectBuyerRefund(tx,f.refund.id))).status,'succeeded');
 }finally{await f.close();}
});
