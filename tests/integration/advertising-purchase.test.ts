import assert from 'node:assert/strict';
import test from 'node:test';
import {runOneJob,processDatabaseJob,type DatabaseJob} from '../../src/jobs/worker.ts';
import {ingestProviderEvent,simulateCollection} from '../../src/modules/payments/local.ts';
import {advertisingFixture,deniedChoices} from './advertising-fixture.ts';

test('prepaid-success-duplicate commits one original merchandise Purchase and all decisions with money; callback rollback commits neither',async()=>{
 const f=await advertisingFixture();
 try{
  await f.consent(f.client);const order=await f.order(f.client),payment=await f.pay(f.client,order.id),rollback=new Error('Expected funded callback rollback');
  const [job]=await f.identity.sql<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where id=${payment.job}`;
  await assert.rejects(f.identity.sql.begin(async tx=>{await processDatabaseJob(tx,job);const [state]=await tx`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`;assert.equal(state.n,1);throw rollback;}),error=>error===rollback);
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,0);
  assert.equal(await payment.complete(),true);assert.equal((await f.identity.sql`select status from app.outbox_job where id=${payment.job}`)[0].status,'completed');
  const [event]=await f.identity.sql`select e.* from app.commerce_event e join app.economic_receipt r on r.id=e.receipt_id where e.order_id=${order.id} and e.name='Purchase'`;
  assert.ok(event.visitor_id&&event.consent_receipt_id);assert.equal(event.source_reference,event.receipt_id);assert.equal(Number(event.merchandise_amount),99000);assert.equal(new Date(event.occurred_at).toISOString(),payment.event.occurred_at);
  const [offer]=await f.identity.sql`select catalog_id from app.offer where id=${f.seeded.offers['fixture-offer-shirt']}`;assert.deepEqual(event.payload.contents,[{id:offer.catalog_id,quantity:1,merchandise_amount:99000}]);
  assert.equal((await f.identity.sql`select count(*)::int n,sum(merchandise_amount)::text amount from app.purchase_allocation where event_id=${event.id}`)[0].amount,'99000');
  const decisions=await f.identity.sql`select platform,status from app.ad_event_outbox where event_id=${event.id} order by platform`;assert.deepEqual(decisions.map(r=>r.status),['queued','queued','queued']);
  const duplicate=await simulateCollection(f.identity.sql,'test',payment.attempt.id),duplicateJob=await ingestProviderEvent(f.identity.sql,duplicate);assert.equal(await runOneJob(f.identity.sql,{},duplicateJob),true);assert.equal(await payment.complete(),false);
  await f.client.call(`/api/v1/orders/${order.id}`);await f.client.call(`/api/v1/orders/${order.id}`);
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,1);assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,1);
  assert.equal((await f.identity.sql`select sum(case when side='debit' then amount else -amount end)::text balance from app.finance_posting where transaction_id in (select transaction_id from app.economic_receipt where order_id=${order.id})`)[0].balance,'0');
 }finally{await f.close();}
});

test('ads-consent-denied and later grant cannot backfill; genuine confirmed money and one suppressed Purchase remain',async()=>{
 const f=await advertisingFixture();
 try{
  await f.consent(f.client,deniedChoices);const order=await f.order(f.client),payment=await f.pay(f.client,order.id);assert.equal(await payment.complete(),true);
  const [event]=await f.identity.sql`select * from app.commerce_event where order_id=${order.id} and name='Purchase'`;assert.ok(event);assert.equal(event.visitor_id,null);assert.equal(event.consent_receipt_id,null);
  const [money]=await f.identity.sql`select payment_status from app.commerce_order where id=${order.id}`;assert.equal(money.payment_status,'confirmed');
  const rows=await f.identity.sql`select status,job_id from app.ad_event_outbox where event_id=${event.id}`;assert.equal(rows.length,3);assert.ok(rows.every(r=>r.status==='suppressed'&&r.job_id===null));
  await f.consent(f.client,undefined,1);const duplicate=await simulateCollection(f.identity.sql,'test',payment.attempt.id);assert.equal(await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,duplicate)),true);
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where receipt_id=${event.receipt_id}`)[0].n,1);assert.equal((await f.identity.sql`select count(*)::int n from app.ad_event_outbox where event_id=${event.id} and status='suppressed'`)[0].n,3);assert.equal((await f.identity.sql`select count(*)::int n from app.local_ad_sink where event_id=${event.id}`)[0].n,0);
 }finally{await f.close();}
});
