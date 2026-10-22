import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import {simulateCodCollection,ingestCodEvent} from '../../src/modules/payments/cod-local.ts';
import {processDatabaseJob,runOneJob,type DatabaseJob} from '../../src/jobs/worker.ts';
import {advertisingAdapter} from '../../src/modules/advertising/worker.ts';
import {listOrderHistory} from '../../src/modules/finance/history.ts';
import {deniedChoices} from './advertising-fixture.ts';
import {codFixture} from './cod-fixture.ts';
import {checkoutFixture,ownShippingCampaign} from './checkout-fixture.ts';
import {capability,commerceActor,prefix} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';

const host=(mode:string,shipmentId:string)=>promisify(execFile)(process.execPath,['--env-file=.env.example','scripts/worker.ts','test',mode,shipmentId],{timeout:15000,maxBuffer:4096});
test('confirmed COD survives all three concurrent checkout expiry jobs with original stock and positive subsidy holds and no money',async()=>{
 const f=await checkoutFixture();let campaign:Awaited<ReturnType<typeof ownShippingCampaign>>|undefined;
 try{
  campaign=await ownShippingCampaign(f,['cod']);assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);
  const request=f.client.request('/api/v1/carts',{}),actor=await commerceActor(request,f.identity);assert.ok(actor?.kind==='guest');
  const created=await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,actor,{lines:[f.line('fixture-offer-shirt',2)]},{clock_namespace:f.namespace}));
  const p=await prefix(f.identity),token=await capability(f.identity,'cart',created.cart.id,actor.id,created.cart.cap_issued_at as string);f.client.cookies.set(`${p}.cart_access:/`,{name:`${p}.cart_access`,value:`${created.cart.id}.${token}`,path:'/'});
  const quote=await f.client.call('/api/v1/checkout/quotes',{cart_id:created.cart.id,address:f.address,contact:f.contact(),payment_method:'cod'},{version:1});assert.equal(quote.response.status,201);assert.equal(quote.payload.subsidy_total,3000);
  const submitted=await f.client.call('/api/v1/orders',{quote_id:quote.payload.id},{version:1});assert.equal(submitted.response.status,201);const orderId=submitted.payload.order.id;
  const [order]=await f.identity.sql`select stock_reservation_id,promotion_reservation_id from app.commerce_order where id=${orderId}`;assert.ok(order.promotion_reservation_id);
  const jobs=await f.identity.sql<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where (kind='checkout.order.expire' and payload->>'orderId'=${orderId}) or (kind='inventory.reservation.expire' and payload->>'reservationId'=${order.stock_reservation_id}) or (kind='promotion.reservation.expire' and payload->>'reservationId'=${order.promotion_reservation_id}) order by kind`;assert.equal(jobs.length,3);
  const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
  await Promise.all(jobs.map(job=>f.identity.sql.begin(async tx=>{await tx`select id from app.outbox_job where id=${job.id} for update`;await processDatabaseJob(tx,job);}))); 
  const [retained]=await f.identity.sql`select o.status,o.payment_status,o.revision,o.actionable_at=o.created_at original_acceptance,s.status stock,p.status promotion from app.commerce_order o join app.stock_reservation s on s.id=o.stock_reservation_id join app.promotion_reservation p on p.id=o.promotion_reservation_id where o.id=${orderId}`;assert.deepEqual(retained,{status:'pending',payment_status:'cod_due',revision:2,original_acceptance:true,stock:'active',promotion:'active'});
  assert.equal((await f.identity.sql`select reserved_amount::text amount from app.promotion where id=${campaign.id}`)[0].amount,'3000');
  const completed=await f.identity.sql`select status,attempts from app.outbox_job where id in ${f.identity.sql(jobs.map(j=>j.id))}`;assert.ok(completed.every(j=>j.status==='completed'&&j.attempts===1));
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${orderId}`)[0].n,0);assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${orderId} and name='Purchase'`)[0].n,0);
  assert.equal((await f.client.call(`/api/v1/orders/${orderId}`)).payload.payment_status,'cod_due');
 }finally{if(campaign)await campaign.close();await f.close();}
});

test('real separate COD source commits and fresh host recovery preserve two original parcel Purchases, admin filters and immutable actionability',async()=>{
 const f=await codFixture();
 try{
  await f.consent(f.client);const order=await f.order(f.client),path=new URL(`http://127.0.0.1:3099/api/v1/admin/orders?payment_status=cod_due&reference=${order.number}`);assert.equal(order.shipments.length,2);
  assert.equal((await listOrderHistory(f.identity,f.principal,path)).data[0].id,order.id);
  const initial=await f.collections(f.client,order.id);assert.equal(initial.response.status,200);assert.equal(initial.payload.collected_total,0);
  const [first,second]=initial.payload.parcels;
  await assert.rejects(simulateCodCollection(f.identity.sql,'test',first.id,{},'before-commit'),/rollback before commit/);assert.equal((await f.identity.sql`select count(*)::int n from app.local_cod_operation where shipment_id=${first.id}`)[0].n,0);
  await assert.rejects(simulateCodCollection(f.identity.sql,'test',first.id,{},'after-commit-lost-ack'),/acknowledgement loss/);
  assert.equal((await f.collections(f.client,order.id)).payload.parcels.find((p:{id:string})=>p.id===first.id).status,'reconciliation');assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);
  await host('--reconcile-cod',first.id);const partial=await f.collections(f.client,order.id);assert.equal(partial.payload.collected_total,first.amount_due);assert.equal(partial.payload.version,3);
  path.searchParams.set('payment_status','partially_collected');assert.equal((await listOrderHistory(f.identity,f.principal,path)).data[0].id,order.id);
  const [original]=await f.identity.sql`select id,operation_id,occurred_at from app.local_cod_event where operation_id=(select id from app.local_cod_operation where shipment_id=${first.id} and reference=${first.id})`;
  await host('--reconcile-cod',first.id);assert.equal((await f.identity.sql`select count(*)::int n from app.local_cod_event where operation_id=${original.operation_id}`)[0].n,1);
  await host('--collect-cod',second.id);const complete=await f.collections(f.client,order.id);assert.equal(complete.payload.version,4);assert.equal(complete.payload.collected_total,order.amount_due);assert.equal(complete.payload.merchandise_collected,396000);assert.equal(complete.payload.confirmed_at,order.created_at);
  await host('--collect-cod',first.id);assert.equal((await f.collections(f.client,order.id)).payload.version,4);
  const events=await f.identity.sql`select e.id,e.occurred_at,e.merchandise_amount,r.shipment_id from app.commerce_event e join app.economic_receipt r on r.id=e.receipt_id where e.order_id=${order.id} and e.name='Purchase'`;assert.equal(events.length,2);assert.equal(events.reduce((n,e)=>n+Number(e.merchandise_amount),0),396000);assert.equal(new Date(events.find(e=>e.shipment_id===first.id)?.occurred_at).toISOString(),new Date(original.occurred_at).toISOString());
  assert.equal((await f.identity.sql`select count(*)::int n from app.ad_event_outbox where event_id in ${f.identity.sql(events.map(e=>e.id))} and status='queued'`)[0].n,6);
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,2);assert.equal((await f.identity.sql`select count(*)::int n from app.finance_posting p join app.finance_transaction j on j.id=p.transaction_id where j.order_id=${order.id} and p.account='company_cash'`)[0].n,0);
  const [outbox]=await f.identity.sql`select id,job_id from app.ad_event_outbox where event_id=${events[0].id} and platform='meta'`;
  assert.equal(await runOneJob(f.identity.sql,{'advertising.dispatch':advertisingAdapter(f.identity.sql,'test')},outbox.job_id),true);
  const [sink]=await f.identity.sql`select payload from app.local_ad_sink where outbox_id=${outbox.id}`;assert.equal(sink.payload.event_name,'Purchase');assert.equal(sink.payload.event_id,events[0].id);assert.equal(sink.payload.value,Number(events[0].merchandise_amount));assert.equal(sink.payload.occurred_at,new Date(events[0].occurred_at).toISOString());
  await f.consent(f.client,deniedChoices,1);assert.equal((await f.identity.sql`select count(*)::int n from app.ad_event_outbox where event_id in ${f.identity.sql(events.map(e=>e.id))} and status='cancelled'`)[0].n,5);

 }finally{await f.close();}
});

test('actual refused and mismatched/extra COD funds never fabricate merchandise, backfill consent or double the original recovery',async()=>{
 const f=await codFixture();
 try{
  await f.consent(f.client,deniedChoices);const order=await f.order(f.client),initial=(await f.collections(f.client,order.id)).payload,[first,second]=initial.parcels;
  await f.collect(first.id,{status:'refused'});assert.equal((await f.collections(f.client,order.id)).payload.parcels.find((p:{id:string})=>p.id===first.id).status,'refused');assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);
  await assert.rejects(simulateCodCollection(f.identity.sql,'test',first.id),{code:'COD_EFFECT_FINAL'});
  const mismatch=await f.collect(first.id,{reference:randomUUID(),amount:first.amount_due+1});assert.equal((await f.identity.sql`select outcome from app.cod_event_result where event_id=${mismatch.event.id}`)[0].outcome,'recovery');assert.equal((await f.collections(f.client,order.id)).payload.collected_total,0);
  await f.collect(first.id,{reference:randomUUID()});const extraReference=randomUUID(),extra=await f.collect(first.id,{reference:extraReference}),duplicate=await f.collect(first.id,{reference:extraReference});assert.equal((await f.identity.sql`select outcome from app.cod_event_result where event_id=${extra.event.id}`)[0].outcome,'recovery');assert.equal((await f.identity.sql`select outcome from app.cod_event_result where event_id=${duplicate.event.id}`)[0].outcome,'duplicate');
  await f.consent(f.client,undefined,1);await f.collect(second.id);const complete=(await f.collections(f.client,order.id)).payload;assert.equal(complete.collected_total,order.amount_due);assert.equal(complete.version,4);
  const events=await f.identity.sql`select id from app.commerce_event where order_id=${order.id} and name='Purchase'`;assert.equal(events.length,2);assert.equal((await f.identity.sql`select count(*)::int n from app.ad_event_outbox where event_id in ${f.identity.sql(events.map(e=>e.id))} and status='suppressed'`)[0].n,6);
  assert.equal((await f.identity.sql`select count(*)::int n from app.finance_transaction where order_id=${order.id} and source='local.cod.recovery'`)[0].n,2);
 }finally{await f.close();}
});

test('real COD callback rollback commits no money; controlled owned-job exhaustion is audited and recovered by original evidence in a fresh process',async()=>{
 const f=await codFixture();
 try{
  const order=await f.order(f.client,1),event=await simulateCodCollection(f.identity.sql,'test',order.shipments[0].id),jobId=await ingestCodEvent(f.identity.sql,event),[job]=await f.identity.sql<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where id=${jobId}`,rollback=new Error('Expected actual COD callback rollback');
  await assert.rejects(f.identity.sql.begin(async tx=>{await processDatabaseJob(tx,job);assert.equal((await tx`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,1);throw rollback;}),error=>error===rollback);
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,0);
  // Only the owned job retry boundary is fault-controlled; all source/financial
  // records and state remain actual services. This does not claim a real outage.
  await f.identity.sql`update app.outbox_job set status='failed',attempts=max_attempts,last_error='DATABASE_ERROR',completed_at=clock_timestamp() where id=${jobId}`;
  await host('--reconcile-cod',event.shipment_id);assert.equal((await f.identity.sql`select status from app.outbox_job where id=${jobId}`)[0].status,'completed');assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,1);
  const [audit]=await f.identity.sql`select details from app.audit_event where action='local.cod.reconcile' and subject_id=${event.shipment_id} order by created_at desc limit 1`;assert.equal(audit.details.previous_status,'failed');assert.equal(audit.details.previous_attempts,5);assert.equal(audit.details.previous_error,'DATABASE_ERROR');assert.equal(audit.details.job_id,jobId);
  assert.equal((await f.identity.sql`select count(*)::int n from app.local_cod_operation where shipment_id=${event.shipment_id}`)[0].n,1);assert.equal((await f.identity.sql`select count(*)::int n from app.local_cod_event where operation_id=${event.operation_id}`)[0].n,1);
 }finally{await f.close();}
});

test('independent concurrent host processes collect two original COD parcels and a duplicate once per economic effect',async()=>{
 const f=await codFixture();
 try{
  const order=await f.order(f.client),initial=(await f.collections(f.client,order.id)).payload,[first,second]=initial.parcels;
  await Promise.all([host('--collect-cod',first.id),host('--collect-cod',second.id),host('--collect-cod',first.id)]);
  const complete=(await f.collections(f.client,order.id)).payload;assert.equal(complete.version,4);assert.equal(complete.collected_total,order.amount_due);assert.equal(complete.merchandise_collected,396000);
  const receipts=await f.identity.sql`select id,shipment_id,transaction_id from app.economic_receipt where order_id=${order.id}`;assert.equal(receipts.length,2);assert.equal(new Set(receipts.map(r=>r.shipment_id)).size,2);
  const [money]=await f.identity.sql`select count(*)::int n,sum(case when side='debit' then amount else -amount end)::text balance from app.finance_posting where transaction_id in ${f.identity.sql(receipts.map(r=>r.transaction_id))}`;assert.equal(money.n,4);assert.equal(money.balance,'0');
  assert.equal((await f.identity.sql`select count(*)::int n,sum(merchandise_amount)::text amount from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].amount,'396000');
  const outcomes=await f.identity.sql`select r.outcome from app.cod_event_result r join app.cod_provider_event p on p.id=r.event_id join app.order_shipment s on s.id=p.shipment_id where s.order_id=${order.id} order by r.outcome`;assert.deepEqual(outcomes.map(r=>r.outcome),['collected','collected','duplicate']);
 }finally{await f.close();}
});
