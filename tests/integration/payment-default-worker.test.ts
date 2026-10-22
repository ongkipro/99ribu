import assert from 'node:assert/strict';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {paymentFixture} from './payment-fixture.ts';

test('default worker lets unknown original reconciliation run after fixture expiry defers, without spinning on the same job',async()=>{
 const f=await paymentFixture();try{
  const {order,client}=await f.order(),attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
  const [stored]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`;
  await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test',new Map([[attempt.id,'paid-commit-lost-ack']]))},stored.creation_job_id);
  const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
  // Wake the original unknown claim only. Do not ingest its collection here:
  // the actual default worker must reach its leased reconciliation lane.
  await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${stored.creation_job_id} and status='unknown'`;
  // Only this order's jobs, in the default worker's lane order (due database jobs, fixture-clock expiry
  // included, before the leased lane), each through runOneJob(sql, adapters, jobId): the result never
  // depends on the shared queue size. A deferred expiry has left the lane and is not offered again.
  const owned=()=>f.identity.sql`select id from app.outbox_job where status in ('pending','unknown') and last_error is distinct from 'PAYMENT_RECONCILIATION_PENDING' and (id=${stored.creation_job_id}
    or (kind='checkout.order.expire' and payload->>'orderId'=${order.id}) or (kind='inventory.reservation.expire' and payload->>'reservationId'=(select stock_reservation_id::text from app.commerce_order where id=${order.id}))
    or (kind='payment.callback' and run_at<=clock_timestamp() and id in (select callback_job_id from app.payment_provider_event where attempt_id=${attempt.id}))) order by kind='payment.create',run_at,created_at,id`;
  let funded=false;const ran:string[]=[];
  for(let n=0;n<20&&!funded;n++){
   const due=await owned();if(!due.length) break;
   const jobId=String(due[0].id),processed=await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},jobId);ran.push(jobId);
   // A deferred expiry must leave the lane: re-running it at once processes nothing (no spin).
   const [after]=await f.identity.sql`select kind,status,last_error from app.outbox_job where id=${jobId}`;
   if(after.last_error==='PAYMENT_RECONCILIATION_PENDING')assert.equal(await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},jobId),false,`${after.kind} deferred, not spinning`);
   else assert.equal(processed,true);
   funded=(await f.identity.sql`select payment_status from app.commerce_order where id=${order.id}`)[0].payment_status==='confirmed';
  }
  assert.ok(ran.includes(String(stored.creation_job_id)),'the leased reconciliation lane was reached');
  assert.equal(funded,true);
  const [deferred]=await f.identity.sql`select count(*)::int n from app.outbox_job where last_error='PAYMENT_RECONCILIATION_PENDING' and ((kind='checkout.order.expire' and payload->>'orderId'=${order.id}) or (kind='inventory.reservation.expire' and payload->>'reservationId'=(select stock_reservation_id::text from app.commerce_order where id=${order.id})))`;
  assert.ok(deferred.n>0);
  assert.equal((await f.identity.sql`select status from app.outbox_job where id=${stored.creation_job_id}`)[0].status,'completed');
 }finally{await f.close();}
});
