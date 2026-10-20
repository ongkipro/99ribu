import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {appendFinanceTransaction,reverseFinanceTransaction} from '../../src/modules/finance/ledger.ts';
import {lockVerifiedReceivables} from '../../src/modules/finance/settlements/receivables.ts';
import {simulateCollection,ingestProviderEvent} from '../../src/modules/payments/local.ts';
import {handlePayments} from '../../src/modules/payments/routes.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {simulateCodCollection,ingestCodEvent} from '../../src/modules/payments/cod-local.ts';
import {readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {advertisingFixture} from './advertising-fixture.ts';
import {fulfillmentFixture} from './fulfillment-fixture.ts';

async function collect(f:Awaited<ReturnType<typeof fulfillmentFixture>>,shipmentId:string,input:Parameters<typeof simulateCodCollection>[3]={}){
 const event=await simulateCodCollection(f.identity.sql,'test',shipmentId,input);await f.run(await ingestCodEvent(f.identity.sql,event));return event;
}

test('settlement eligibility preserves signed original COD and extra recovery money, without a receipt from refusal or another Purchase',async()=>{
 const f=await fulfillmentFixture('cod');
 try{
  const order=f.order,parcels=f.parcels;
  const collection=await collect(f,parcels[0].shipment_id),extra=await collect(f,parcels[0].shipment_id,{reference:randomUUID()}),refusal=await collect(f,parcels[1].shipment_id,{status:'refused'});
  const rows=await f.identity.sql`select event_id,receipt_id,transaction_id from app.cod_event_result where event_id in ${f.identity.sql([collection.id,extra.id,refusal.id])}`;
  assert.equal(rows.find(r=>r.event_id===refusal.id)?.transaction_id,null);
  const original=rows.find(r=>r.event_id===collection.id),recovery=rows.find(r=>r.event_id===extra.id);assert.ok(original?.receipt_id);assert.equal(recovery?.receipt_id,null);
  const context={provider:'local.cod' as const,environment:'test' as const,occurred_at:(await readFixtureClock('test',f.namespace)).now,clock_namespace:f.namespace};
  const verified=await f.identity.sql.begin(tx=>lockVerifiedReceivables(tx,context,[recovery?.transaction_id,original.transaction_id]));
  assert.equal(verified.size,2);assert.equal(verified.get(original.transaction_id)?.source_basis,'qualified');assert.equal(verified.get(recovery?.transaction_id)?.source_basis,'recovery');assert.equal(verified.get(recovery?.transaction_id)?.gross_amount,collection.amount);
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,1);
  assert.equal((await f.identity.sql`select count(*)::int n from app.finance_posting p join app.finance_transaction h on h.id=p.transaction_id where h.order_id=${order.id} and p.account='company_cash'`)[0].n,0);
  for(const changed of [{provider:'local.payment' as const},{environment:'local' as const},{clock_namespace:'foreign-test'},{occurred_at:'2000-01-01T00:00:00.000Z'}])await assert.rejects(f.identity.sql.begin(tx=>lockVerifiedReceivables(tx,{...context,...changed},[original.transaction_id])),error=>error instanceof Error&&'code' in error&&['SETTLEMENT_RECEIVABLE_UNVERIFIED','SETTLEMENT_CLOCK_CONTEXT_MISMATCH','SETTLEMENT_PRECEDES_COLLECTION'].includes(String(error.code)));
 }finally{await f.close();}
});
test('settlement eligibility accepts actual prepaid receipt and mismatched authenticated recovery as separate original receivables',async()=>{
 const f=await advertisingFixture();
 try{
  const order=await f.order(f.client),paid=await f.pay(f.client,order.id);assert.equal(await paid.complete(),true);
  const second=await f.order(f.client),response=await handlePayments(f.client.request(`/api/v1/orders/${second.id}/payment-attempts`,{method_id:'local-prepaid'}),f.identity);assert.equal(response.status,201);const attempt=await response.json();
  const [stored]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`;assert.equal(await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},stored.creation_job_id),true);
  const event=await simulateCollection(f.identity.sql,'test',attempt.id,{amount:second.buyer_total+1}),job=await ingestProviderEvent(f.identity.sql,event);assert.equal(await runOneJob(f.identity.sql,{},job),true);
  const rows=await f.identity.sql`select event_id,receipt_id,transaction_id from app.payment_event_result where event_id in ${f.identity.sql([paid.event.id,event.id])}`;assert.equal(rows.length,2);
  const result=await f.identity.sql.begin(tx=>lockVerifiedReceivables(tx,{provider:'local.payment',environment:'test',occurred_at:new Date().toISOString(),clock_namespace:null},rows.map(r=>r.transaction_id)));
  assert.deepEqual([...result.values()].map(r=>r.source_basis).sort(),['qualified','recovery']);assert.equal([...result.values()].find(r=>r.order_id===second.id)?.gross_amount,second.buyer_total+1);
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id in ${f.identity.sql([order.id,second.id])} and name='Purchase'`)[0].n,1);
 }finally{await f.close();}
});
test('balanced unverified or fully reversed journals cannot be treated as settleable collection',async()=>{
 const f=await fulfillmentFixture('cod'),rollback=new Error('Expected settlement eligibility rollback');
 try{
  const order=f.order,collected=await collect(f,f.parcels[0].shipment_id),[original]=await f.identity.sql`select transaction_id from app.cod_event_result where event_id=${collected.id}`;
  const context={provider:'local.cod' as const,environment:'test' as const,occurred_at:(await readFixtureClock('test',f.namespace)).now,clock_namespace:f.namespace};
  await assert.rejects(f.identity.sql.begin(async tx=>{
   const unverified=await appendFinanceTransaction(tx,{kind:'adjustment',source:'local.cod.recovery',environment:'test',effect_reference:randomUUID(),order_id:order.id,reason:'SYNTHETIC unverified receivable boundary',occurred_at:context.occurred_at,postings:[{account:'provider_receivable',side:'debit',amount:1},{account:'buyer_funds_liability',side:'credit',amount:1}]});
   await assert.rejects(lockVerifiedReceivables(tx,context,[unverified.id]),{code:'SETTLEMENT_RECEIVABLE_UNVERIFIED'});
   await reverseFinanceTransaction(tx,original.transaction_id,{source:'local.settlement.test',environment:'test',effect_reference:randomUUID(),reason:'SYNTHETIC isolated reversal eligibility',occurred_at:context.occurred_at});
   await assert.rejects(lockVerifiedReceivables(tx,context,[original.transaction_id]),{code:'SETTLEMENT_RECEIVABLE_REVERSED'});throw rollback;
  }),error=>error===rollback);
  assert.equal((await f.identity.sql`select count(*)::int n from app.finance_transaction where reverses_id=${original.transaction_id}`)[0].n,0);
 }finally{await f.close();}
});
