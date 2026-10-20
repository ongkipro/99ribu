import assert from 'node:assert/strict';
import test from 'node:test';
import {processDatabaseJob,runOneJob,type DatabaseJob} from '../../src/jobs/worker.ts';
import {lockRecoveryCollectionBasis} from '../../src/modules/checkout/exceptions/collection.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {processCodEvent} from '../../src/modules/payments/cod.ts';
import {ingestCodEvent,simulateCodCollection} from '../../src/modules/payments/cod-local.ts';
import {processPaymentEvent} from '../../src/modules/payments/events.ts';
import {createLocalOperation,ingestProviderEvent,simulateCollection} from '../../src/modules/payments/local.ts';
import {paymentFixture} from './payment-fixture.ts';

test('late original prepaid money qualifies inside its own callback before exact job completion',async()=>{
 const f=await paymentFixture();try{
  const {order,client}=await f.order(),sql=f.identity.sql;
  const attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
  await createLocalOperation(sql,'test',attempt.id);
  const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
  const [expiry]=await sql`select id from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;
  assert.equal(await runOneJob(sql,{},expiry.id),true);
  const event=await simulateCollection(sql,'test',attempt.id),jobId=await ingestProviderEvent(sql,event);
  await sql.begin(async tx=>{
   const [job]=await tx<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where id=${jobId} for update`;
   assert.deepEqual(await processPaymentEvent(tx,job),{event_id:event.id,outcome:'recovery'});
   assert.equal((await tx`select status from app.outbox_job where id=${jobId}`)[0].status,'pending');
   const units=await tx`select f.id from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${order.id}`;
   const basis=await lockRecoveryCollectionBasis(tx,order.id,{kind:'purchased_units',fulfillment_item_ids:units.map(unit=>unit.id)});
   assert.equal(basis.basis_kind,'purchased_units');assert.equal(basis.sources.length,1);
   assert.equal(basis.sources[0].source_event_id,event.id);assert.equal(basis.sources[0].original_payment_operation_id,event.operation_id);
   assert.equal(basis.sources[0].amount,order.buyer_total);assert.ok(basis.sources[0].units.every(unit=>unit.purchase_event_id===null));
   await processDatabaseJob(tx,job);
  });
  assert.deepEqual((await sql`select status,attempts,result from app.outbox_job where id=${jobId}`)[0],{status:'completed',attempts:1,result:{event_id:event.id,outcome:'recovery'}});
  const [retained]=await sql`select o.status,o.payment_status,r.status hold from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id=${order.id}`;
  assert.deepEqual(retained,{status:'cancelled',payment_status:'expired',hold:'expired'});
  assert.equal((await sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,1);
  assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,0);
 }finally{await f.close();}
});

test('qualifying unallocated prepaid money cannot commit without its exact callback; normal owned retry preserves the source',async()=>{
 const f=await paymentFixture();try{
  const {order,client}=await f.order(),sql=f.identity.sql;
  const attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
  await createLocalOperation(sql,'test',attempt.id);
  const event=await simulateCollection(sql,'test',attempt.id,{amount:order.buyer_total+1}),jobId=await ingestProviderEvent(sql,event);
  const sources=await sql`select id,status,occurred_at from app.local_payment_event where operation_id=${event.operation_id} order by id`;
  assert.deepEqual(sources.map(source=>source.status).sort(),['confirmed','pending']);
  await assert.rejects(sql.begin(async tx=>{
   const [job]=await tx<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where id=${jobId} for update`;
   assert.deepEqual(await processPaymentEvent(tx,job),{event_id:event.id,outcome:'recovery'});
   const [result]=await tx`select transaction_id,receipt_id from app.payment_event_result where event_id=${event.id}`;
   assert.equal(result.receipt_id,null);
   const basis=await lockRecoveryCollectionBasis(tx,order.id,{kind:'unallocated_collection',source_transaction_id:result.transaction_id});
   assert.equal(basis.basis_kind,'unallocated');assert.equal(basis.sources[0].source_event_id,event.id);
   assert.equal(basis.sources[0].amount,event.amount);assert.deepEqual(basis.sources[0].units,[]);
   await tx`set constraints all immediate`;
  }),{code:'23514'});
  assert.equal((await sql`select count(*)::int n from app.payment_event_result where event_id=${event.id}`)[0].n,0);
  assert.equal((await sql`select count(*)::int n from app.finance_transaction where order_id=${order.id}`)[0].n,0);
  assert.deepEqual((await sql`select status,attempts from app.outbox_job where id=${jobId}`)[0],{status:'pending',attempts:0});
  assert.equal(await runOneJob(sql,{},jobId),true);
  assert.deepEqual((await sql`select status,attempts,result from app.outbox_job where id=${jobId}`)[0],{status:'completed',attempts:1,result:{event_id:event.id,outcome:'recovery'}});
  assert.deepEqual(await sql`select id,status,occurred_at from app.local_payment_event where operation_id=${event.operation_id} order by id`,sources);
  assert.equal((await sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);
  assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,0);
 }finally{await f.close();}
});

test('mismatched COD money qualifies inside its exact callback without allocating goods or changing parcel funding',async()=>{
 const f=await paymentFixture();try{
  const {order}=await f.order(1,'cod'),sql=f.identity.sql,shipmentId=order.shipments[0].id;
  const [shipment]=await sql`select cod_due from app.order_shipment where id=${shipmentId}`;
  const event=await simulateCodCollection(sql,'test',shipmentId,{amount:Number(shipment.cod_due)+1}),jobId=await ingestCodEvent(sql,event);
  await sql.begin(async tx=>{
   const [job]=await tx<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where id=${jobId} for update`;
   assert.deepEqual(await processCodEvent(tx,job),{event_id:event.id,outcome:'recovery'});
   assert.equal((await tx`select status from app.outbox_job where id=${jobId}`)[0].status,'pending');
   const [result]=await tx`select transaction_id,receipt_id from app.cod_event_result where event_id=${event.id}`;assert.equal(result.receipt_id,null);
   const basis=await lockRecoveryCollectionBasis(tx,order.id,{kind:'unallocated_collection',source_transaction_id:result.transaction_id});
   assert.equal(basis.basis_kind,'unallocated');assert.equal(basis.sources[0].source_event_id,event.id);
   assert.equal(basis.sources[0].original_payment_operation_id,null);assert.equal(basis.sources[0].amount,event.amount);assert.deepEqual(basis.sources[0].units,[]);
   await processDatabaseJob(tx,job);
  });
  assert.deepEqual((await sql`select status,attempts,result from app.outbox_job where id=${jobId}`)[0],{status:'completed',attempts:1,result:{event_id:event.id,outcome:'recovery'}});
  assert.deepEqual((await sql`select status,payment_status,revision from app.commerce_order where id=${order.id}`)[0],{status:'pending',payment_status:'cod_due',revision:2});
  assert.equal((await sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);
  assert.equal((await sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,0);
 }finally{await f.close();}
});
