import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {ingestProviderEvent,readProviderEvents,simulateCollection} from '../../src/modules/payments/local.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {checkoutIssuedCookies,checkoutOrderPath,prepareCheckoutPayment,readCheckoutPayment,recoverCheckoutOrder} from '../../src/modules/storefront/checkout-order.ts';
import {readCheckout} from '../../src/modules/storefront/checkout.ts';
import {paymentFixture} from './payment-fixture.ts';

test('private checkout payment keeps one attempt across duplicate/unknown recovery and reads confirmed money after its original deadline',async()=>{
 const f=await paymentFixture();let client:Awaited<ReturnType<typeof f.order>>['client']|undefined;
 try{
  const created=await f.order(2);client=created.client;const {order}=created,path=checkoutOrderPath(order.id);
  const recovered=await recoverCheckoutOrder(client.request(path,{}),f.identity,order.id);
  for(const entry of await checkoutIssuedCookies(f.identity,order.id,recovered.cookies))client.cookies.set(`${entry.name}:${entry.path}`,{name:entry.name,value:entry.value,path:entry.path});
  const before=await readCheckoutPayment(client.request(path),f.identity,order.id);assert.equal(before.kind,'ready');assert.equal(before.attempt,null);assert.equal(before.order.expires_at,order.expires_at,'displayed local deadline is the persisted order expiry');
  const key=randomUUID(),input={order:order.id,key};
  const duplicate=await Promise.all([prepareCheckoutPayment(client.request(path,{}),f.identity,input),prepareCheckoutPayment(client.request(path,{}),f.identity,input)]);
  assert.ok(duplicate.every(s=>s.phase==='success'));
  const attempts=await f.identity.sql`select id,creation_job_id from app.payment_attempt where order_id=${order.id}`;assert.equal(attempts.length,1);const attempt=attempts[0];const [storedDeadline]=await f.identity.sql`select o.expires_at order_expiry,a.expires_at attempt_expiry from app.commerce_order o join app.payment_attempt a on a.order_id=o.id where a.id=${attempt.id}`;assert.equal(new Date(storedDeadline.order_expiry).toISOString(),order.expires_at);assert.equal(new Date(storedDeadline.attempt_expiry).toISOString(),order.expires_at,'local payment attempt uses the same stored native deadline');
  const unavailableAuth=new Proxy(f.identity.auth,{get(target,name,receiver){if(name==='$context')return Promise.reject(new Error('Owned auth dependency outage before an exact retry'));return Reflect.get(target,name,receiver);}});
  const unavailableIdentity=new Proxy(f.identity,{get(target,name,receiver){return name==='auth'?unavailableAuth:Reflect.get(target,name,receiver);}});
  const prereadOutage=await prepareCheckoutPayment(client.request(path,{}),unavailableIdentity,input);assert.equal(prereadOutage.phase,'unknown');assert.equal(prereadOutage.key,key,'an unresolved payment key cannot rotate because the next retry fails before dispatch');assert.equal(prereadOutage.blocked,false);
  const dependencyFailure=await readCheckout(client.request('/checkout'),unavailableIdentity);assert.equal(dependencyFailure.kind,'unavailable');assert.equal(dependencyFailure.cart,null,'a dependency failure is distinct from a denied session and exposes no cached cart');
  const pending=await readCheckoutPayment(client.request(path),f.identity,order.id);assert.equal(pending.attempt?.status,'pending');assert.equal(pending.order?.payment_status,'pending');
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,0);
  assert.equal(await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test',new Map([[attempt.id,'paid-commit-lost-ack']]))},attempt.creation_job_id),true);
  assert.equal((await readCheckoutPayment(client.request(path),f.identity,order.id)).attempt?.status,'unknown');
  const newAttempt=await prepareCheckoutPayment(client.request(path,{}),f.identity,{order:order.id,key:randomUUID()});assert.equal(newAttempt.code,'PAYMENT_ATTEMPT_ACTIVE');
  const same=await prepareCheckoutPayment(client.request(path,{}),f.identity,input);assert.equal(same.phase,'success');assert.equal((await f.identity.sql`select count(*)::int n from app.payment_attempt where order_id=${order.id}`)[0].n,1);
  // Reconcile only this scenario's original unknown job; no global worker drain.
  await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${attempt.creation_job_id} and status='unknown'`;
  assert.equal(await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},attempt.creation_job_id),true);
  const events=await f.identity.sql.begin(tx=>readProviderEvents(tx,attempt.id)),paid=events.find(e=>e.status==='confirmed');assert.ok(paid);
  assert.equal(await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,paid)),true);
  const duplicateMoney=await simulateCollection(f.identity.sql,'test',attempt.id);assert.equal(await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,duplicateMoney)),true);
  const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
  for(let i=0;i<2;i++){const view=await readCheckoutPayment(client.request(path),f.identity,order.id);assert.equal(view.kind,'ready');assert.equal(view.order?.id,order.id);assert.equal(view.order?.payment_status,'confirmed');assert.equal(view.attempt?.status,'confirmed');assert.equal(view.order?.buyer_total,order.buyer_total);}
  const afterPaid=await prepareCheckoutPayment(client.request(path,{}),f.identity,{order:order.id,key:randomUUID()});assert.equal(afterPaid.code,'PAYMENT_NOT_AVAILABLE');
  assert.equal((await f.identity.sql`select count(*)::int n from app.payment_attempt where order_id=${order.id}`)[0].n,1);
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,1);
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,1);
  for(const name of ['authorization','x-order-token','x-cart-token']){const result=await prepareCheckoutPayment(client.request(path,{}, {headers:{[name]:'forged'}}),f.identity,input);assert.equal(result.code,'UNSUPPORTED_AUTH_TRANSPORT');assert.equal(result.blocked,true);}
  const noPost=await prepareCheckoutPayment(client.request(path),f.identity,input);assert.equal(noPost.code,'INVALID_INPUT');
  await client.auth('/sign-out',{});const denied=await readCheckoutPayment(client.request(path),f.identity,order.id);assert.equal(denied.kind,'denied');assert.equal(denied.order,null);assert.equal(denied.attempt,null);
 }finally{try{if(client)await client.auth('/sign-out',{});}finally{await f.close();}}
});

test('COD checkout payment exposes original parcel dues without creating a prepaid attempt or a Purchase on reads',async()=>{
 const f=await paymentFixture();let client:Awaited<ReturnType<typeof f.order>>['client']|undefined;
 try{
  const created=await f.order(1,'cod');client=created.client;const {order}=created,path=checkoutOrderPath(order.id);
  const recovered=await recoverCheckoutOrder(client.request(path,{}),f.identity,order.id);
  for(const entry of await checkoutIssuedCookies(f.identity,order.id,recovered.cookies))client.cookies.set(`${entry.name}:${entry.path}`,{name:entry.name,value:entry.value,path:entry.path});
  for(let i=0;i<2;i++){const view=await readCheckoutPayment(client.request(path),f.identity,order.id);assert.equal(view.kind,'ready');assert.equal(view.order?.payment_status,'cod_due');assert.equal(view.attempt,null);assert.equal(view.order?.shipments.filter(s=>s.kind==='original').reduce((sum,s)=>sum+(s.cod_collect_amount??0),0),order.buyer_total);}
  const rejected=await prepareCheckoutPayment(client.request(path,{}),f.identity,{order:order.id,key:randomUUID()});assert.equal(rejected.code,'PAYMENT_NOT_AVAILABLE');
  assert.equal((await f.identity.sql`select count(*)::int n from app.payment_attempt where order_id=${order.id}`)[0].n,0);
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,0);
 }finally{try{if(client)await client.auth('/sign-out',{});}finally{await f.close();}}
});
