import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {processDatabaseJob,runOneJob,type DatabaseJob} from '../../src/jobs/worker.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {createLocalOperation,ingestProviderEvent,simulateCollection} from '../../src/modules/payments/local.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {paymentFixture} from './payment-fixture.ts';

test('local host reconciliation recovers a failed original callback and audits the previous retry count',async()=>{
 const f=await paymentFixture();try{
  const {order,client}=await f.order(),attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
  const [stored]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`;
  await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},stored.creation_job_id);
  const paid=await simulateCollection(f.identity.sql,'test',attempt.id),callback=await ingestProviderEvent(f.identity.sql,paid);
  // Inject a corrupted delivery into the real handler; the persisted canonical
  // payload stays intact and can be recovered by the host after the defect.
  await f.identity.sql.begin(async tx=>{
   const [job]=await tx<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where id=${callback} for update`;
   await processDatabaseJob(tx,{...job,payload:{eventId:randomUUID()}});
  });
  assert.equal((await f.identity.sql`select status from app.outbox_job where id=${callback}`)[0].status,'failed');
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);
  await promisify(execFile)(process.execPath,['--env-file=.env.example','scripts/worker.ts','test','--reconcile-payment',attempt.id],{timeout:15000,maxBuffer:4096});
  assert.equal((await f.identity.sql`select status from app.outbox_job where id=${callback}`)[0].status,'completed');
  const [audit]=await f.identity.sql`select details from app.audit_event where action='local.payment.reconcile' and subject_id=${attempt.id} and details->>'job_id'=${callback}`;
  assert.equal(audit.details.previous_status,'failed');assert.equal(audit.details.previous_attempts,1);
  assert.equal((await f.identity.sql`select count(*)::int n from app.local_payment_operation where attempt_id=${attempt.id}`)[0].n,1);
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,1);
 }finally{await f.close();}
});

test('an undispatched attempt after its deadline receives a definitive no-effect fence',async()=>{
 const f=await paymentFixture();try{
  const {order,client}=await f.order(),attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
  const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
  const [expiry]=await f.identity.sql`select id from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;await runOneJob(f.identity.sql,{},expiry.id);
  const original=await createLocalOperation(f.identity.sql,'test',attempt.id);assert.equal(original.events[0].status,'failed');
  await assert.rejects(simulateCollection(f.identity.sql,'test',attempt.id));
  assert.equal((await f.identity.sql`select count(*)::int n from app.finance_transaction where order_id=${order.id}`)[0].n,0);
 }finally{await f.close();}
});

test('concurrent callback deliveries for one collection create one immutable balanced receipt',async()=>{
 const f=await paymentFixture();try{
  const {order,client}=await f.order(),attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
  await createLocalOperation(f.identity.sql,'test',attempt.id);const paid=await simulateCollection(f.identity.sql,'test',attempt.id),repeat=await simulateCollection(f.identity.sql,'test',attempt.id);
  const callbacks=await Promise.all([ingestProviderEvent(f.identity.sql,paid),ingestProviderEvent(f.identity.sql,repeat)]);
  assert.deepEqual(await Promise.all(callbacks.map(job=>runOneJob(f.identity.sql,{},job))),[true,true]);
  const outcomes=await f.identity.sql`select outcome from app.payment_event_result where event_id in ${f.identity.sql([paid.id,repeat.id])}`;assert.deepEqual(outcomes.map(r=>r.outcome).sort(),['confirmed','duplicate']);
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,1);
 }finally{await f.close();}
});
