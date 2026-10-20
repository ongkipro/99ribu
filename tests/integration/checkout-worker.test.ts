import assert from 'node:assert/strict';
import test from 'node:test';
import {processDatabaseJob,type DatabaseJob} from '../../src/jobs/worker.ts';
import {capability,commerceActor,prefix} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {checkoutFixture,ownShippingCampaign} from './checkout-fixture.ts';

test('real unpaid prepaid expiry worker rolls back a crash, then racing legacy/order jobs release both holds and append one event',async()=>{
 const f=await checkoutFixture();let campaign:Awaited<ReturnType<typeof ownShippingCampaign>>|undefined;try{
  campaign=await ownShippingCampaign(f,['prepaid']);
  assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);
  const request=f.client.request('/api/v1/carts',{lines:[f.line('fixture-offer-shirt',2)]});const actor=await commerceActor(request,f.identity);assert.ok(actor?.kind==='guest');
  const created=await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,actor,{lines:[f.line('fixture-offer-shirt',2)]},{clock_namespace:f.namespace}));
  const p=await prefix(f.identity),token=await capability(f.identity,'cart',created.cart.id,actor.id,created.cart.cap_issued_at as string);
  f.client.cookies.set(`${p}.cart_access:/`,{name:`${p}.cart_access`,value:`${created.cart.id}.${token}`,path:'/'});
  const quote=await f.client.call('/api/v1/checkout/quotes',{cart_id:created.cart.id,address:f.address,contact:f.contact(),payment_method:'prepaid'},{version:1});assert.equal(quote.response.status,201);assert.equal(quote.payload.subsidy_total,3000);
  const submitted=await f.client.call('/api/v1/orders',{quote_id:quote.payload.id},{version:1});assert.equal(submitted.response.status,201);const orderId=submitted.payload.order.id;
  const [order]=await f.identity.sql`select stock_reservation_id,promotion_reservation_id from app.commerce_order where id=${orderId}`;
  const jobs=await f.identity.sql<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where (kind='checkout.order.expire' and payload->>'orderId'=${orderId}) or (kind='inventory.reservation.expire' and payload->>'reservationId'=${order.stock_reservation_id}) or (kind='promotion.reservation.expire' and payload->>'reservationId'=${order.promotion_reservation_id}) order by kind`;
  assert.ok(order.promotion_reservation_id);assert.equal(jobs.length,3);
  let clock=await readFixtureClock('test',f.namespace);clock=await advanceFixtureClock('test',f.namespace,1860,clock.version);assert.ok(clock.version>1);
  const direct=jobs.find(j=>j.kind==='checkout.order.expire');assert.ok(direct);const crash=new Error('Synthetic crash after real expiry effect');
  await assert.rejects(f.identity.sql.begin(async tx=>{await tx`select id from app.outbox_job where id=${direct.id} for update`;await processDatabaseJob(tx,direct);throw crash;}),error=>error===crash);
  const [pending]=await f.identity.sql`select o.status,r.status hold,j.status job from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id join app.outbox_job j on j.id=${direct.id} where o.id=${orderId}`;assert.deepEqual(pending,{status:'pending',hold:'active',job:'pending'});
  await Promise.all(jobs.map(job=>f.identity.sql.begin(async tx=>{await tx`select id from app.outbox_job where id=${job.id} for update`;await processDatabaseJob(tx,job);}))); 
  const [expired]=await f.identity.sql`select status,payment_status,revision from app.commerce_order where id=${orderId}`;assert.deepEqual(expired,{status:'cancelled',payment_status:'expired',revision:2});
  const [stock]=await f.identity.sql`select status from app.stock_reservation where id=${order.stock_reservation_id}`;assert.equal(stock.status,'expired');
  const [promotion]=await f.identity.sql`select status from app.promotion_reservation where id=${order.promotion_reservation_id}`;assert.equal(promotion.status,'expired');
  const [budget]=await f.identity.sql`select reserved_amount::text amount from app.promotion where id=${campaign.id}`;assert.equal(budget.amount,'0');
  const completed=await f.identity.sql`select status,attempts from app.outbox_job where id in ${f.identity.sql(jobs.map(j=>j.id))}`;assert.ok(completed.every(j=>j.status==='completed'&&j.attempts===1));
  const [events]=await f.identity.sql`select count(*)::int n from app.order_event where order_id=${orderId}`;assert.equal(events.n,2);
  assert.equal((await f.client.call(`/api/v1/orders/${orderId}`)).payload.payment_status,'expired');
 }finally{if(campaign) await campaign.close();await f.close();}
});

test('expired immutable quotes cannot submit or reserve anything through the real HTTP boundary',async()=>{
 const f=await checkoutFixture();try{
  assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);const req=f.client.request('/api/v1/carts',{});const actor=await commerceActor(req,f.identity);assert.ok(actor);
  const created=await f.identity.sql.begin(tx=>createCart(tx,req,f.identity,actor,{lines:[f.line()]},{clock_namespace:f.namespace}));
  const p=await prefix(f.identity),token=await capability(f.identity,'cart',created.cart.id,actor.id,created.cart.cap_issued_at as string);f.client.cookies.set(`${p}.cart_access:/`,{name:`${p}.cart_access`,value:`${created.cart.id}.${token}`,path:'/'});
  const q=await f.client.call('/api/v1/checkout/quotes',{cart_id:created.cart.id,address:f.address,contact:f.contact(),payment_method:'prepaid'},{version:1});assert.equal(q.response.status,201);
  const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,660,clock.version);
  const result=await f.client.call('/api/v1/orders',{quote_id:q.payload.id},{version:1});assert.equal(result.response.status,409);assert.equal(result.payload.code,'QUOTE_EXPIRED');
  const [count]=await f.identity.sql`select count(*)::int n from app.commerce_order where cart_id=${created.cart.id}`;assert.equal(count.n,0);
 }finally{await f.close();}
});
