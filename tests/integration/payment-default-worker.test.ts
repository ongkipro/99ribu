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
  const [queue]=await f.identity.sql`select count(*)::int n from app.outbox_job where status in ('pending','unknown')`;
  let funded=false;
  for(let n=0;n<queue.n*3+20;n++){
   const processed=await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')});
   funded=(await f.identity.sql`select payment_status from app.commerce_order where id=${order.id}`)[0].payment_status==='confirmed';
   if(funded||!processed) break;
  }
  assert.equal(funded,true);
  const [deferred]=await f.identity.sql`select count(*)::int n from app.outbox_job where last_error='PAYMENT_RECONCILIATION_PENDING' and ((kind='checkout.order.expire' and payload->>'orderId'=${order.id}) or (kind='inventory.reservation.expire' and payload->>'reservationId'=(select stock_reservation_id::text from app.commerce_order where id=${order.id})))`;
  assert.ok(deferred.n>0);
  assert.equal((await f.identity.sql`select status from app.outbox_job where id=${stored.creation_job_id}`)[0].status,'completed');
 }finally{await f.close();}
});
