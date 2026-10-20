import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {processDatabaseJob,runOneJob,type DatabaseJob} from '../../src/jobs/worker.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {createLocalOperation,ingestProviderEvent,simulateCollection} from '../../src/modules/payments/local.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {reconcilePaymentNow} from '../../src/modules/payments/recovery.ts';
import {paymentFixture} from './payment-fixture.ts';

test('definitive no-effect reconciliation fences an old creator and permits a new attempt without money',async()=>{
 const f=await paymentFixture();try{
  const {order,client}=await f.order(),path=`/api/v1/orders/${order.id}/payment-attempts`,first=await f.call(client,path,{method_id:'local-prepaid'});assert.equal(first.response.status,201);
  const attempt=first.payload,[stored]=await f.identity.sql`select * from app.payment_attempt where id=${attempt.id}`;
  await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test',new Map([[attempt.id,'before-commit']]))},stored.creation_job_id);
  assert.equal((await f.identity.sql`select count(*)::int n from app.local_payment_operation where attempt_id=${attempt.id}`)[0].n,0);
  await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${stored.creation_job_id} and status='unknown'`;
  await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},stored.creation_job_id);
  const original=await createLocalOperation(f.identity.sql,'test',attempt.id);assert.equal(original.events.length,1);assert.equal(original.events[0].status,'failed');
  await assert.rejects(simulateCollection(f.identity.sql,'test',attempt.id),error=>error instanceof Error&&'code' in error&&error.code==='PROVIDER_EFFECT_FINAL');
  const callback=await ingestProviderEvent(f.identity.sql,original.events[0]);await runOneJob(f.identity.sql,{},callback);
  assert.equal((await f.call(client,`${path}/${attempt.id}`)).payload.status,'failed');
  const second=await f.call(client,path,{method_id:'local-prepaid'});assert.equal(second.response.status,201);assert.notEqual(second.payload.id,attempt.id);
  const [next]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${second.payload.id}`;
  await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},next.creation_job_id);
  assert.equal((await f.identity.sql`select count(*)::int n from app.finance_transaction where order_id=${order.id}`)[0].n,0);
 }finally{await f.close();}
});

test('late money remains a recovery receipt and never reacquires stock already reserved by another buyer',async()=>{
 const f=await paymentFixture();try{
  const old=await f.order(5),path=`/api/v1/orders/${old.order.id}/payment-attempts`,attempt=(await f.call(old.client,path,{method_id:'local-prepaid'})).payload;
  await createLocalOperation(f.identity.sql,'test',attempt.id);
  const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
  const [expiry]=await f.identity.sql`select id from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${old.order.id}`;
  assert.equal(await runOneJob(f.identity.sql,{},expiry.id),true);
  const newer=await f.order(5),[before]=await f.identity.sql`select r.id,r.status,sum(c.quantity)::text quantity from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id join app.stock_reservation_component c on c.reservation_id=r.id where o.id=${newer.order.id} group by r.id`;
  const paid=await simulateCollection(f.identity.sql,'test',attempt.id),callback=await ingestProviderEvent(f.identity.sql,paid);await runOneJob(f.identity.sql,{},callback);
  const [result]=await f.identity.sql`select * from app.payment_event_result where event_id=${paid.id}`;assert.equal(result.outcome,'recovery');assert.equal(result.reason,'late_payment');assert.ok(result.receipt_id);
  const [oldState]=await f.identity.sql`select o.status,o.payment_status,o.actionable_at,r.status hold_status from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id=${old.order.id}`;
  assert.deepEqual(oldState,{status:'cancelled',payment_status:'expired',actionable_at:null,hold_status:'expired'});
  const [after]=await f.identity.sql`select r.id,r.status,sum(c.quantity)::text quantity from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id join app.stock_reservation_component c on c.reservation_id=r.id where o.id=${newer.order.id} group by r.id`;assert.deepEqual(after,before);
  assert.equal((await f.call(old.client,`${path}/${attempt.id}`)).payload.status,'unknown');
  const duplicate=await simulateCollection(f.identity.sql,'test',attempt.id);await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,duplicate));
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${old.order.id}`)[0].n,1);
 }finally{await f.close();}
});

test('signed collection survives callback rollback; tampering fails and replay after commit creates no second journal',async()=>{
 const f=await paymentFixture();try{
  const {order,client}=await f.order(),attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
  await createLocalOperation(f.identity.sql,'test',attempt.id);
  await assert.rejects(simulateCollection(f.identity.sql,'test',attempt.id,{amount:0}));
  const paid=await simulateCollection(f.identity.sql,'test',attempt.id);
  await assert.rejects(ingestProviderEvent(f.identity.sql,{...paid,amount:paid.amount+1}));
  await assert.rejects(ingestProviderEvent(f.identity.sql,{...paid,currency:'USD'}));
  await assert.rejects(ingestProviderEvent(f.identity.sql,{...paid,signature:`${paid.signature[0]==='a'?'b':'a'}${paid.signature.slice(1)}`}));
  const callback=await ingestProviderEvent(f.identity.sql,paid),crash=new Error('Synthetic callback crash before transaction commit');
  await assert.rejects(f.identity.sql.begin(async tx=>{
   const [job]=await tx<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where id=${callback} for update`;
   await processDatabaseJob(tx,job);assert.equal((await tx`select status from app.outbox_job where id=${callback}`)[0].status,'completed');throw crash;
  }),error=>error===crash);
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);
  assert.equal((await f.identity.sql`select count(*)::int n from app.payment_event_result where event_id=${paid.id}`)[0].n,0);
  assert.equal((await f.identity.sql`select status from app.outbox_job where id=${callback}`)[0].status,'pending');
  assert.equal(await runOneJob(f.identity.sql,{},callback),true);assert.equal(await runOneJob(f.identity.sql,{},callback),false);assert.equal(await ingestProviderEvent(f.identity.sql,paid),callback);
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,1);
  assert.equal((await f.identity.sql`select count(*)::int n from app.finance_transaction where order_id=${order.id}`)[0].n,1);
 }finally{await f.close();}
});

test('actual mismatched collection becomes a balanced unallocated liability with no funded order',async()=>{
 const f=await paymentFixture();try{
  const {order,client}=await f.order(),attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'},{key:randomUUID()})).payload;
  await createLocalOperation(f.identity.sql,'test',attempt.id);const paid=await simulateCollection(f.identity.sql,'test',attempt.id,{amount:order.buyer_total-100});
  await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,paid));
  const [result]=await f.identity.sql`select * from app.payment_event_result where event_id=${paid.id}`;assert.equal(result.outcome,'recovery');assert.equal(result.reason,'amount_mismatch');assert.equal(result.receipt_id,null);
  assert.equal((await f.identity.sql`select payment_status from app.commerce_order where id=${order.id}`)[0].payment_status,'pending');
  const postings=await f.identity.sql`select side,amount::text amount from app.finance_posting where transaction_id=${result.transaction_id}`;assert.equal(postings.length,2);assert.ok(postings.every(p=>p.amount===String(paid.amount)));
  const repeat=await simulateCollection(f.identity.sql,'test',attempt.id,{amount:paid.amount});await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,repeat));
  assert.equal((await f.identity.sql`select count(*)::int n from app.finance_transaction where order_id=${order.id}`)[0].n,1);
 }finally{await f.close();}
});

test('expiry waits for timely collection through lost acknowledgement or delayed ingestion, then retains funded stock',async()=>{
 const f=await paymentFixture();try{
  for(const lostAck of [true,false]){
   const {order,client}=await f.order(),path=`/api/v1/orders/${order.id}/payment-attempts`,attempt=(await f.call(client,path,{method_id:'local-prepaid'})).payload;
   const [stored]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`;
   await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test',lostAck?new Map([[attempt.id,'paid-commit-lost-ack']]):new Map())},stored.creation_job_id);
   if(!lostAck) await simulateCollection(f.identity.sql,'test',attempt.id); // Signed source commits before ingestion.
   const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
   const [expiry]=await f.identity.sql`select id from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;
   assert.equal(await runOneJob(f.identity.sql,{},expiry.id),true);
   assert.equal((await f.identity.sql`select status from app.outbox_job where id=${expiry.id}`)[0].status,'pending');
   const [waiting]=await f.identity.sql`select o.status,o.payment_status,r.status hold_status from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id=${order.id}`;
   assert.deepEqual(waiting,{status:'pending',payment_status:'pending',hold_status:'active'});
   await assert.rejects(f.identity.sql.begin(tx=>tx`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) select id,2,'cancelled','expired','Invalid expiry during reconciliation',${expiry.id},app.reservation_clock(clock_namespace) from app.commerce_order where id=${order.id}`),{code:'23514'});
   const jobs=await reconcilePaymentNow(f.identity.sql,attempt.id);for(const job of jobs) await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},job);
   assert.equal((await f.call(client,`${path}/${attempt.id}`)).payload.status,'confirmed');
   // The genuine wall-time job metadata remains deferred. Process its domain
   // handler directly to prove funded retention without forging the deadline.
   const [job]=await f.identity.sql<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where id=${expiry.id}`;
   await f.identity.sql.begin(tx=>processDatabaseJob(tx,job));
   assert.equal((await f.identity.sql`select r.status from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id=${order.id}`)[0].status,'active');
  }
 }finally{await f.close();}
});
