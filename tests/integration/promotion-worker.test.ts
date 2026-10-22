import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {promisify} from 'node:util';
import test from 'node:test';
import {enqueueJob} from '../../src/jobs/outbox.ts';
import {processDatabaseJob,runOneJob,type DatabaseJob} from '../../src/jobs/worker.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {resolvePromotionReservation} from '../../src/modules/promotions/reservations.ts';
import {promotionFixture,denied} from './promotion-fixture.ts';
const exec=promisify(execFile);const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
const driver=['--env-file=.env.example','tests/integration/promotion-worker-fixture.ts'];
async function dueFixture(){
 const namespace=`pw-${randomUUID().slice(0,8)}`;const f=await promotionFixture(namespace);const p=await f.campaign();const hold=await f.reserve(await f.input([p.id]));
 const [job]=await f.identity.sql`select id,status,run_at>clock_timestamp() as future from app.outbox_job where kind='promotion.reservation.expire' and payload->>'reservationId'=${hold.id}`;
 assert.equal(job.status,'pending');assert.equal(job.future,true);
 // `--once` workers claim the oldest due job globally: drain every job already due (any kind) before this
 // fixture's clock advance makes its own job due, so the subprocesses claim it deterministically.
 for(let i=0;i<1000;i++) if(!await runOneJob(f.identity.sql)) break;
 assert.equal((await f.identity.sql`select status from app.outbox_job where id=${job.id}`)[0].status,'pending');
 const clock=await readFixtureClock('test',namespace);await advanceFixtureClock('test',namespace,121,clock.version);
 return {...f,namespace,p,hold,jobId:job.id as string};
}

test('two actual worker processes expire one scenario-due promotion before its wall schedule exactly once',async()=>{
 const f=await dueFixture();try{
  const later=await f.reserve(await f.input([f.p.id],'b'.repeat(64)));
  await assert.rejects(f.identity.sql.begin((tx)=>resolvePromotionReservation(tx,f.hold.id,'consumed','Cannot consume expired hold')),denied('RESERVATION_EXPIRED'));
  await Promise.all([1,2].map(()=>exec(process.execPath,['--env-file=.env.example','scripts/worker.ts','test','--once'],{env:environment,timeout:10000})));
  const [job]=await f.identity.sql`select status,attempts from app.outbox_job where id=${f.jobId}`;assert.deepEqual(job,{status:'completed',attempts:1});
  const [head]=await f.identity.sql`select reserved_amount::text,committed_amount::text from app.promotion where id=${f.p.id}`;assert.deepEqual(head,{reserved_amount:'10001',committed_amount:'0'});
  const [stillHeld]=await f.identity.sql`select status from app.promotion_reservation where id=${later.id}`;assert.equal(stillHeld.status,'active');
  const [usage]=await f.identity.sql`select reserved_uses,committed_uses from app.promotion_buyer_usage where promotion_id=${f.p.id} and customer_key=${'a'.repeat(64)}`;assert.deepEqual(usage,{reserved_uses:0,committed_uses:0});
  const [effects]=await f.identity.sql`select count(*)::int as n from app.promotion_movement where reservation_id=${f.hold.id} and kind='release'`;assert.equal(effects.n,1);
 }finally{await f.close();}
});

test('killing a worker after uncommitted release/completion rolls back both; restart converges',async()=>{
 const f=await dueFixture();let child:ReturnType<typeof spawn>|undefined;
 try{
  child=spawn(process.execPath,[...driver,f.jobId,'pause'],{env:environment,stdio:['ignore','pipe','pipe']});
  const ready=new Promise<void>((resolve,reject)=>{let output='';const timer=globalThis.setTimeout(()=>reject(new Error('Worker effect barrier unavailable')),10000);
    child?.stdout?.on('data',(chunk)=>{output+=String(chunk);if(output.includes('effect_ready')){clearTimeout(timer);resolve();}});child?.once('exit',()=>{clearTimeout(timer);reject(new Error('Worker exited before effect barrier'));});});
  await ready;const [before]=await f.identity.sql`select status from app.promotion_reservation where id=${f.hold.id}`;assert.equal(before.status,'active');
  child.kill('SIGKILL');await once(child,'exit');child=undefined;
  const [rolled]=await f.identity.sql`select status,attempts from app.outbox_job where id=${f.jobId}`;assert.deepEqual(rolled,{status:'pending',attempts:0});
  await exec(process.execPath,['--env-file=.env.example','scripts/worker.ts','test','--once'],{env:environment,timeout:10000});
  const [after]=await f.identity.sql`select status from app.promotion_reservation where id=${f.hold.id}`;assert.equal(after.status,'expired');
 }finally{if(child){child.kill('SIGKILL');await once(child,'exit');}await f.close();}
});

test('real SQL timeout rolls back release, honors scenario retry backoff and stops at its attempt cap; malformed jobs deadletter',async()=>{
 const f=await dueFixture();let unlock=()=>{};
 try{
  await f.identity.sql`update app.outbox_job set max_attempts=2 where id=${f.jobId}`;
  let ready=()=>{};const locked=new Promise<void>((r)=>{ready=r;});const held=new Promise<void>((r)=>{unlock=r;});
  const blocker=f.identity.sql.begin(async(tx)=>{await tx`select id from app.promotion where id=${f.p.id} for update`;ready();await held;});
  try{
   await locked;await exec(process.execPath,[...driver,f.jobId,'timeout'],{env:environment,timeout:10000});
   const [retry]=await f.identity.sql`select status,attempts,last_error,run_at>clock_timestamp() as future from app.outbox_job where id=${f.jobId}`;
   assert.deepEqual(retry,{status:'pending',attempts:1,last_error:'TEMPORARY_DATABASE_FAILURE',future:true});
   const [reservation]=await f.identity.sql`select status from app.promotion_reservation where id=${f.hold.id}`;assert.equal(reservation.status,'active');
   assert.equal(await runOneJob(f.identity.sql),false,'Scenario due must not bypass retry backoff');
   await f.identity.sql`update app.outbox_job set run_at=clock_timestamp()-interval '1 second' where id=${f.jobId}`;
   await exec(process.execPath,[...driver,f.jobId,'timeout'],{env:environment,timeout:10000});
   const [failed]=await f.identity.sql`select status,attempts,last_error from app.outbox_job where id=${f.jobId}`;assert.deepEqual(failed,{status:'failed',attempts:2,last_error:'TEMPORARY_DATABASE_FAILURE'});
  }finally{unlock();await blocker;}
  const jobId=await f.identity.sql.begin((tx)=>enqueueJob(tx,'promotion.reservation.expire',`promotion-invalid:${randomUUID()}`,{reservationId:'bad'}));
  await f.identity.sql.begin(async(tx)=>{const [job]=await tx<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where id=${jobId} for update`;await processDatabaseJob(tx,job);});
  const [invalid]=await f.identity.sql`select status,attempts,last_error from app.outbox_job where id=${jobId}`;assert.deepEqual(invalid,{status:'failed',attempts:1,last_error:'INVALID_PAYLOAD'});
  await f.identity.sql`delete from app.outbox_job where id=${jobId}`;
  // Explicit operator cleanup only; no endless silent expiry retry.
 }finally{unlock();await f.close();}
});

test('an early expiry job defers without spending an attempt or releasing any budget',async()=>{
 const f=await promotionFixture();try{
  const p=await f.campaign();const hold=await f.reserve(await f.input([p.id]));
  const [job]=await f.identity.sql<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where kind='promotion.reservation.expire' and payload->>'reservationId'=${hold.id}`;
  await f.identity.sql.begin((tx)=>processDatabaseJob(tx,job));const [state]=await f.identity.sql`select status,attempts,run_at>clock_timestamp() as future from app.outbox_job where id=${job.id}`;
  assert.deepEqual(state,{status:'pending',attempts:0,future:true});
  const [budget]=await f.identity.sql`select reserved_amount::text from app.promotion where id=${p.id}`;assert.equal(budget.reserved_amount,'10001');
 }finally{await f.close();}
});
