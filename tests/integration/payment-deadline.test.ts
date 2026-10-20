import assert from 'node:assert/strict';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {ingestProviderEvent,simulateCollection} from '../../src/modules/payments/local.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {paymentFixture} from './payment-fixture.ts';

test('the exact deadline is expired for both job orderings and preserves collection only as recovery',async()=>{
 const f=await paymentFixture();try{
  for(const expireFirst of [true,false]){
   const {order,client}=await f.order(),attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
   const [stored]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`;
   await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},stored.creation_job_id);
   const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1800,clock.version);
   const [expiry]=await f.identity.sql`select id from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;
   if(expireFirst) await runOneJob(f.identity.sql,{},expiry.id);
   const paid=await simulateCollection(f.identity.sql,'test',attempt.id);assert.equal(paid.occurred_at,order.expires_at);
   await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,paid));
   if(!expireFirst) await runOneJob(f.identity.sql,{},expiry.id);
   const [result]=await f.identity.sql`select outcome,reason from app.payment_event_result where event_id=${paid.id}`;assert.deepEqual(result,{outcome:'recovery',reason:'late_payment'});
   const [state]=await f.identity.sql`select o.status,o.payment_status,o.actionable_at,r.status hold_status from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id=${order.id}`;
   assert.deepEqual(state,{status:'cancelled',payment_status:'expired',actionable_at:null,hold_status:'expired'});
  }
 }finally{await f.close();}
});

test('late terminal collection resolves expiry even while original creation acknowledgement remains unknown',async()=>{
 const f=await paymentFixture();try{
  const {order,client}=await f.order(),attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
  const [stored]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`;
  await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test',new Map([[attempt.id,'creation-commit-lost-ack']]))},stored.creation_job_id);
  assert.equal((await f.identity.sql`select status from app.outbox_job where id=${stored.creation_job_id}`)[0].status,'unknown');
  const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
  const paid=await simulateCollection(f.identity.sql,'test',attempt.id);await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,paid));
  assert.equal((await f.identity.sql`select outcome from app.payment_event_result where event_id=${paid.id}`)[0].outcome,'recovery');
  assert.equal((await f.identity.sql`select status from app.commerce_order where id=${order.id}`)[0].status,'cancelled');
 }finally{await f.close();}
});
