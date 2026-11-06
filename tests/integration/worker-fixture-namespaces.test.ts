import assert from 'node:assert/strict';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {randomUUID} from 'node:crypto';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {createAttempt} from '../../src/modules/payments/attempts.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {paymentFixture} from './payment-fixture.ts';

// S121: the long-running LOCAL worker (skipFixtureNamespaces) must not expire a fixture namespace's order or its stock
// reservation on the fixture's business clock; the suite that owns the namespace runs that job itself.
test('a worker that skips fixture namespaces leaves a due fixture order expiry to its owner; the owner run still expires it',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql;
 try{
  const placed=await f.order(1);
  const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
  const [expiry]=await sql`select id from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${placed.order.id} and status='pending'`;
  assert.ok(expiry,'the fixture order has a pending expiry job that is due on its business clock');
  assert.equal(await runOneJob(sql,{},String(expiry.id),{skipFixtureNamespaces:true}),false,'the LOCAL worker loop skips it');
  const [still]=await sql`select o.status,j.status job from app.commerce_order o, app.outbox_job j where o.id=${placed.order.id} and j.id=${expiry.id}`;
  assert.deepEqual([still.status,still.job],['pending','pending']);
  assert.equal(await runOneJob(sql,{},String(expiry.id)),true,'the owning suite runs it explicitly');
  const [after]=await sql`select status,payment_status from app.commerce_order where id=${placed.order.id}`;
  assert.deepEqual([after.status,after.payment_status],['cancelled','expired']);
 }finally{await f.close();}
});

test('a worker that skips fixture namespaces leaves a fixture order\'s leased payment.create job to its owner',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql;
 try{
  const placed=await f.order(1);
  const shown=await sql.begin(tx=>createAttempt(tx,placed.order.id,randomUUID(),{method_id:'local-prepaid'}));
  const [attempt]=await sql`select creation_job_id from app.payment_attempt where id=${shown.id}`;
  const adapters={'payment.create':paymentAdapter(sql,'test')};
  assert.equal(await runOneJob(sql,adapters,String(attempt.creation_job_id),{skipFixtureNamespaces:true}),false,'the LOCAL worker loop does not claim it');
  const [job]=await sql`select status,attempts from app.outbox_job where id=${attempt.creation_job_id}`;
  assert.deepEqual([job.status,job.attempts],['pending',0]);
  assert.equal(await runOneJob(sql,adapters,String(attempt.creation_job_id)),true,'the owning suite runs it explicitly');
 }finally{await f.close();}
});
