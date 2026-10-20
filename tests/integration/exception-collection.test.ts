import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {lockRecoveryCollectionBasis} from '../../src/modules/checkout/exceptions/collection.ts';
import {appendFinanceTransaction,reverseFinanceTransaction} from '../../src/modules/finance/ledger.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {ingestCodEvent,simulateCodCollection} from '../../src/modules/payments/cod-local.ts';
import {createLocalOperation,ingestProviderEvent,simulateCollection} from '../../src/modules/payments/local.ts';
import {fulfillmentFixture} from './fulfillment-fixture.ts';
import {paymentFixture} from './payment-fixture.ts';

test('late exact prepaid funds retain original unit entitlement without reviving expired or reallocated stock',async()=>{
 const f=await paymentFixture();try{
  const old=await f.order(5),attempt=(await f.call(old.client,`/api/v1/orders/${old.order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
  await createLocalOperation(f.identity.sql,'test',attempt.id);
  const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
  const [expiry]=await f.identity.sql`select id from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${old.order.id}`;
  assert.equal(await runOneJob(f.identity.sql,{},expiry.id),true);
  const newer=await f.order(5),event=await simulateCollection(f.identity.sql,'test',attempt.id);
  assert.equal(await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,event)),true);
  const sql=f.identity.sql,units=await sql`select f.id,f.buyer_shipping from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${old.order.id} order by f.id`;
  const before=await sql`select o.id,o.status,o.payment_status,o.actionable_at,r.id reservation_id,r.status hold_status,r.resolved_at,r.resolution_reason from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id in ${sql([old.order.id,newer.order.id])} order by o.id`;
  const basis=await sql.begin(tx=>lockRecoveryCollectionBasis(tx,old.order.id,{kind:'purchased_units',fulfillment_item_ids:units.map(u=>u.id)}));
  assert.equal(basis.basis_kind,'purchased_units');assert.equal(basis.sources.length,1);const source=basis.sources[0];
  assert.equal(source.source_event_id,event.id);assert.equal(source.original_payment_operation_id,event.operation_id);assert.equal(source.source_amount,old.order.buyer_total);
  assert.equal(source.amount,units.reduce((sum,u)=>sum+99000+Number(u.buyer_shipping),0));assert.equal(source.units.length,5);assert.ok(source.receipt_id);
  assert.ok(source.units.every(u=>u.purchase_event_id===null));
  assert.deepEqual(await sql`select o.id,o.status,o.payment_status,o.actionable_at,r.id reservation_id,r.status hold_status,r.resolved_at,r.resolution_reason from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id in ${sql([old.order.id,newer.order.id])} order by o.id`,before);
  assert.equal(before.find(o=>o.id===old.order.id)?.hold_status,'expired');assert.equal(before.find(o=>o.id===old.order.id)?.status,'cancelled');assert.equal(before.find(o=>o.id===newer.order.id)?.hold_status,'active');
  assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id=${old.order.id} and name='Purchase'`)[0].n,0);
  await assert.rejects(sql.begin(tx=>lockRecoveryCollectionBasis(tx,old.order.id,{kind:'unallocated_collection',source_transaction_id:source.source_transaction_id})),{code:'RECOVERY_COLLECTION_NOT_QUALIFIED'});
 }finally{await f.close();}
});

test('unallocated signed prepaid money has no invented receipt, merchandise or authority over another order',async()=>{
 const f=await paymentFixture();try{
  const {order,client}=await f.order(),attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
  await createLocalOperation(f.identity.sql,'test',attempt.id);
  const event=await simulateCollection(f.identity.sql,'test',attempt.id,{amount:order.buyer_total+1});
  assert.equal(await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,event)),true);
  const sql=f.identity.sql,[result]=await sql`select transaction_id,receipt_id,outcome from app.payment_event_result where event_id=${event.id}`;
  assert.equal(result.outcome,'recovery');assert.equal(result.receipt_id,null);
  const basis=await sql.begin(tx=>lockRecoveryCollectionBasis(tx,order.id,{kind:'unallocated_collection',source_transaction_id:result.transaction_id}));
  assert.equal(basis.basis_kind,'unallocated');
  assert.deepEqual(basis.sources,[{source_transaction_id:result.transaction_id,source_event_id:event.id,receipt_id:null,original_payment_operation_id:event.operation_id,source_amount:event.amount,amount:event.amount,units:[]}]);
  const units=await sql`select f.id from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${order.id}`;
  await assert.rejects(sql.begin(tx=>lockRecoveryCollectionBasis(tx,order.id,{kind:'purchased_units',fulfillment_item_ids:units.map(u=>u.id)})),{code:'REFUND_COLLECTION_NOT_QUALIFIED'});
  const other=await f.order();
  await assert.rejects(sql.begin(tx=>lockRecoveryCollectionBasis(tx,other.order.id,{kind:'unallocated_collection',source_transaction_id:result.transaction_id})),{code:'RECOVERY_COLLECTION_NOT_QUALIFIED'});
  for(const table of ['economic_receipt','commerce_event','fulfillment']){
   const rows=table==='fulfillment'?await sql`select count(*)::int n from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${order.id}`:await sql`select count(*)::int n from app.${sql(table)} where order_id=${order.id}`;
   assert.equal(rows[0].n,0);
  }
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${order.id}`)[0].n,1);
 }finally{await f.close();}
});

test('mixed COD parcels keep distinct original collection sources and no receipt from refusal',async()=>{
 const f=await fulfillmentFixture('cod');try{
  const sql=f.identity.sql,first=await simulateCodCollection(sql,'test',f.parcels[0].shipment_id);
  await f.run(await ingestCodEvent(sql,first));
  const refusal=await simulateCodCollection(sql,'test',f.parcels[1].shipment_id,{status:'refused'});await f.run(await ingestCodEvent(sql,refusal));
  const unpaid=await sql`select id from app.fulfillment_item where shipment_id=${f.parcels[1].shipment_id}`;
  await assert.rejects(sql.begin(tx=>lockRecoveryCollectionBasis(tx,f.order.id,{kind:'purchased_units',fulfillment_item_ids:unpaid.map(u=>u.id)})),{code:'REFUND_COLLECTION_NOT_QUALIFIED'});
  // A terminal refusal cannot be rewritten as a collection. A distinct
  // authenticated source may later report actual additional money.
  await assert.rejects(simulateCodCollection(sql,'test',f.parcels[1].shipment_id),{code:'COD_EFFECT_FINAL'});
  const second=await simulateCodCollection(sql,'test',f.parcels[1].shipment_id,{reference:randomUUID()});await f.run(await ingestCodEvent(sql,second));
  const units=await sql`select id from app.fulfillment_item where shipment_id in ${sql(f.parcels.map(p=>p.shipment_id))}`;
  const basis=await sql.begin(tx=>lockRecoveryCollectionBasis(tx,f.order.id,{kind:'purchased_units',fulfillment_item_ids:units.map(u=>u.id)}));
  assert.equal(basis.basis_kind,'purchased_units');assert.equal(basis.sources.length,2);assert.deepEqual(basis.sources.map(s=>s.source_event_id).sort(),[first.id,second.id].sort());
  assert.ok(basis.sources.every(s=>s.amount===s.source_amount&&s.original_payment_operation_id===null));assert.equal(basis.sources.reduce((sum,s)=>sum+s.amount,0),f.order.buyer_total);
  const extra=await simulateCodCollection(sql,'test',f.parcels[0].shipment_id,{reference:randomUUID()});await f.run(await ingestCodEvent(sql,extra));
  const [result]=await sql`select transaction_id from app.cod_event_result where event_id=${extra.id}`;
  const unallocated=await sql.begin(tx=>lockRecoveryCollectionBasis(tx,f.order.id,{kind:'unallocated_collection',source_transaction_id:result.transaction_id}));
  assert.equal(unallocated.basis_kind,'unallocated');
  assert.equal(unallocated.sources[0].source_event_id,extra.id);assert.equal(unallocated.sources[0].amount,extra.amount);assert.equal(unallocated.sources[0].receipt_id,null);assert.deepEqual(unallocated.sources[0].units,[]);
  assert.equal((await sql`select transaction_id from app.cod_event_result where event_id=${refusal.id}`)[0].transaction_id,null);
 }finally{await f.close();}
});

test('unverified balanced or reversed recovery funds cannot authorize a compensation basis',async()=>{
 const f=await paymentFixture(),rollback=new Error('Expected recovery source rollback');try{
  const {order,client}=await f.order(),attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
  await createLocalOperation(f.identity.sql,'test',attempt.id);
  const event=await simulateCollection(f.identity.sql,'test',attempt.id,{amount:order.buyer_total+1});assert.equal(await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,event)),true);
  const sql=f.identity.sql,[result]=await sql`select transaction_id from app.payment_event_result where event_id=${event.id}`;
  await assert.rejects(sql.begin(async tx=>{
   const unverified=await appendFinanceTransaction(tx,{kind:'adjustment',source:'local.payment.recovery',environment:'test',effect_reference:randomUUID(),order_id:order.id,reason:'SYNTHETIC unverified compensation basis',occurred_at:event.occurred_at,postings:[{account:'provider_receivable',side:'debit',amount:1},{account:'buyer_funds_liability',side:'credit',amount:1}]});
   await assert.rejects(lockRecoveryCollectionBasis(tx,order.id,{kind:'unallocated_collection',source_transaction_id:unverified.id}),{code:'SETTLEMENT_RECEIVABLE_UNVERIFIED'});
   await reverseFinanceTransaction(tx,result.transaction_id,{source:'local.exception.test',environment:'test',effect_reference:randomUUID(),reason:'SYNTHETIC rolled-back recovery reversal',occurred_at:event.occurred_at});
   await assert.rejects(lockRecoveryCollectionBasis(tx,order.id,{kind:'unallocated_collection',source_transaction_id:result.transaction_id}),{code:'SETTLEMENT_RECEIVABLE_REVERSED'});throw rollback;
  }),error=>error===rollback);
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where reverses_id=${result.transaction_id}`)[0].n,0);
 }finally{await f.close();}
});
