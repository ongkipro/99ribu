import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {ingestProviderEvent,readProviderEvents,simulateCollection} from '../../src/modules/payments/local.ts';
import {paymentFixture} from './payment-fixture.ts';

test('payment-timeout-after-commit reconciles the original operation; duplicate and old pending events preserve one funded receipt',async()=>{
 const f=await paymentFixture();
 try{
  const {order,client}=await f.order(),path=`/api/v1/orders/${order.id}/payment-attempts`,key=randomUUID();
  const requests=await Promise.all([f.call(client,path,{method_id:'local-prepaid'},{key}),f.call(client,path,{method_id:'local-prepaid'},{key})]);
  assert.deepEqual(requests.map(r=>r.response.status),[201,201]);const attempt=requests[0].payload;assert.equal(requests[1].payload.id,attempt.id);
  const [stored]=await f.identity.sql`select * from app.payment_attempt where id=${attempt.id}`;
  const adapters={'payment.create':paymentAdapter(f.identity.sql,'test',new Map([[attempt.id,'paid-commit-lost-ack']]))};
  assert.equal(await runOneJob(f.identity.sql,adapters,stored.creation_job_id),true);
  assert.equal((await f.identity.sql`select status from app.outbox_job where id=${stored.creation_job_id}`)[0].status,'unknown');
  assert.equal((await f.call(client,`${path}/${attempt.id}`)).payload.status,'unknown');
  assert.equal((await f.call(client,path,{method_id:'local-prepaid'})).response.status,409);
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);
  // Wake only the known unknown job. Financial state and original identity stay intact.
  await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${stored.creation_job_id} and status='unknown'`;
  assert.equal(await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},stored.creation_job_id),true);
  const events=await f.identity.sql.begin(tx=>readProviderEvents(tx,attempt.id)),paid=events.find(e=>e.status==='confirmed'),pending=events.find(e=>e.status==='pending');assert.ok(paid&&pending);
  const paidJob=await ingestProviderEvent(f.identity.sql,paid),pendingJob=await ingestProviderEvent(f.identity.sql,pending);
  assert.equal(await runOneJob(f.identity.sql,{},paidJob),true);
  assert.equal((await f.identity.sql`select status,last_error from app.outbox_job where id=${paidJob}`)[0].status,'completed');
  assert.equal(await runOneJob(f.identity.sql,{},pendingJob),true);
  const repeat=await simulateCollection(f.identity.sql,'test',attempt.id),repeatJob=await ingestProviderEvent(f.identity.sql,repeat);
  assert.equal(await ingestProviderEvent(f.identity.sql,paid),paidJob);assert.equal(await runOneJob(f.identity.sql,{},paidJob),false);
  assert.equal(await runOneJob(f.identity.sql,{},repeatJob),true);
  assert.equal((await f.call(client,`${path}/${attempt.id}`)).payload.status,'confirmed');
  const [state]=await f.identity.sql`select o.payment_status,o.expires_at,o.actionable_at,r.status hold_status from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id=${order.id}`;
  assert.equal(state.payment_status,'confirmed');assert.equal(new Date(state.expires_at).toISOString(),order.expires_at);assert.equal(new Date(state.actionable_at).toISOString(),paid.occurred_at);assert.equal(state.hold_status,'active');
  const receipts=await f.identity.sql`select * from app.economic_receipt where order_id=${order.id}`;assert.equal(receipts.length,1);assert.equal(receipts[0].effect_reference,paid.operation_id);
  const [money]=await f.identity.sql`select count(*)::int n,sum(case when side='debit' then amount else -amount end)::text balance from app.finance_posting where transaction_id=${receipts[0].transaction_id}`;assert.equal(money.n,2);assert.equal(money.balance,'0');
  const results=await f.identity.sql`select r.outcome from app.payment_event_result r join app.payment_provider_event e on e.id=r.event_id where e.attempt_id=${attempt.id}`;
  assert.deepEqual(results.map(r=>r.outcome).sort(),['confirmed','duplicate','ignored']);
 }finally{await f.close();}
});
