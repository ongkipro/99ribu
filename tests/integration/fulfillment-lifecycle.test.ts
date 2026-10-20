import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {shippingAdapter} from '../../src/modules/fulfillment/worker.ts';
import {simulateWaybillIssue,ingestWaybillEvent} from '../../src/modules/fulfillment/local.ts';
import {simulateCodCollection,ingestCodEvent} from '../../src/modules/payments/cod-local.ts';
import {projectOrder} from '../../src/modules/checkout/orders.ts';
import {handleOrderHistory} from '../../src/modules/finance/history-routes.ts';
import {fulfillmentFixture} from './fulfillment-fixture.ts';

test('applied runtime refuses historical candidate evidence before opening any87-table rollback case',()=>{
 const result=spawnSync(process.execPath,['--env-file=.env.example','scripts/check-tests.ts','integration','--case=S29-candidate'],{encoding:'utf8',timeout:10000,maxBuffer:4096});
 assert.equal(result.status,1);assert.ok(result.stderr.includes('S29-candidate requires unapplied0019'));assert.ok(!result.stdout.includes('"passed"'));
});

for(const method of ['cod','prepaid'] as const)test(`committed ${method} fulfillment conserves original components and one subsidy through late handovers, signed failure recovery and payment`,async()=>{
 const f=await fulfillmentFixture(method),sql=f.identity.sql;
 try{
  for(const [index,parcel] of f.parcels.entries()){
   const root=`/api/v1/admin/fulfillments/${parcel.id}`;let booking=await f.book(parcel),version=3;
   await f.run(booking.creation_job_id);for(const callback of await sql`select callback_job_id from app.waybill_provider_event where booking_id=${booking.id}`)await f.run(callback.callback_job_id);
   if(index===0){
    const failed=await simulateWaybillIssue(sql,'test',booking.id,'failed');await f.run(await ingestWaybillEvent(sql,failed));
    assert.equal((await f.fulfillmentCall('/api/v1/admin/shipments',{fulfillment_id:parcel.id,expected_version:4})).payload.code,'REBOOK_REASON_REQUIRED');
    const retry=await f.fulfillmentCall('/api/v1/admin/shipments',{fulfillment_id:parcel.id,expected_version:4,reason:'SYNTHETIC authenticated terminal failure recovery'});assert.equal(retry.response.status,202);
    [booking]=await sql`select * from app.shipment_booking where id=${retry.payload.operation_id}`;version=5;await f.run(booking.creation_job_id);
    for(const callback of await sql`select callback_job_id from app.waybill_provider_event where booking_id=${booking.id}`)await f.run(callback.callback_job_id);
   }
   const issued=await simulateWaybillIssue(sql,'test',booking.id);await f.run(await ingestWaybillEvent(sql,issued));
   const filterPath=`/api/v1/admin/orders?reference=${f.order.number}&fulfillment_status=packed`,matching=await handleOrderHistory(f.owner.browser.request(filterPath),f.identity);assert.equal(matching.status,200);assert.deepEqual((await matching.json()).data.map((o:{id:string})=>o.id),[f.order.id]);
   const packed=await f.fulfillmentCall(`${root}/packing`,{expected_version:version+1});assert.equal(packed.response.status,201);
   await sql`update app.local_fixture_namespace set clock=clock+interval '31 minutes',revision=revision+1 where name=${f.namespace}`;
   const handed=await f.fulfillmentCall(`${root}/handover`,{expected_version:version+2,shipment_id:parcel.shipment_id,handover_reference:`SYNTHETIC committed ${index}`});assert.equal(handed.response.status,201);assert.equal(handed.payload.status,'handed_over');
   const noLongerPacked=await handleOrderHistory(f.owner.browser.request(filterPath),f.identity);assert.equal(noLongerPacked.status,200);assert.equal((await noLongerPacked.json()).data.length,0);
   const [reservation]=await sql`select r.status from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id=${f.order.id}`;assert.equal(reservation.status,index===0?'active':'consumed');
   const [components]=await sql`select sum(a.quantity)::int expected from app.fulfillment_component_allocation a join app.fulfillment_item i on i.id=a.fulfillment_item_id where i.shipment_id=${parcel.shipment_id}`;
   const [consumed]=await sql`select sum(m.quantity)::int actual from app.stock_movement m join app.fulfillment_event e on m.source_ref='handover:'||e.id::text where e.fulfillment_id=${parcel.id} and m.kind='consume'`;assert.equal(consumed.actual,components.expected);
   await f.run(await ingestWaybillEvent(sql,await simulateWaybillIssue(sql,'test',booking.id)));assert.equal((await sql`select revision from app.fulfillment where id=${parcel.id}`)[0].revision,version+3);
  }
  const [benefit]=await sql`select p.reserved_amount::int reserved,p.committed_amount::int committed from app.promotion p join app.promotion_allocation a on a.promotion_id=p.id join app.commerce_order o on o.promotion_reservation_id=a.reservation_id where o.id=${f.order.id}`;assert.deepEqual(benefit,{reserved:0,committed:3000});
  if(method==='cod')for(const parcel of f.parcels)await f.run(await ingestCodEvent(sql,await simulateCodCollection(sql,'test',parcel.shipment_id)));
  const [money]=await sql`select count(*)::int receipts,sum(merchandise_amount)::int merchandise from app.economic_receipt where order_id=${f.order.id}`;assert.equal(money.receipts,method==='cod'?2:1);assert.equal(money.merchandise,396000);
  const [purchase]=await sql`select sum(merchandise_amount)::int value from app.commerce_event where order_id=${f.order.id} and name='Purchase'`;assert.equal(purchase.value,396000);
  const [order]=await sql`select status,payment_status,revision,actionable_at,created_at from app.commerce_order where id=${f.order.id}`;assert.equal(order.status,'processing');assert.equal(order.payment_status,'confirmed');assert.equal(order.revision,method==='cod'?5:3);if(method==='cod')assert.equal(new Date(order.actionable_at).toISOString(),new Date(order.created_at).toISOString());
 }finally{await f.close();}
});
test('rescheduling before both deadlines still produces one available notice per missed milestone without disclosing private audit reasons',async()=>{
 const f=await fulfillmentFixture(),sql=f.identity.sql;try{
  const parcel=f.parcels[0],root=`/api/v1/admin/fulfillments/${parcel.id}`,booking=await f.book();await f.run(booking.creation_job_id);
  for(const callback of await sql`select callback_job_id from app.waybill_provider_event where booking_id=${booking.id}`)await f.run(callback.callback_job_id);
  const miss=async(kind:'packing'|'handover',version:number)=>{
   const privateReason=`PRIVATE ${randomUUID()}`,rescheduled=await f.fulfillmentCall(`${root}/reschedules`,{expected_version:version,reason:privateReason,buyer_explanation:`SYNTHETIC ${kind} schedule changed`});assert.equal(rescheduled.response.status,201);
   const [deadline]=await sql`select d.* from app.fulfillment f join app.fulfillment_deadline d on d.id=f.deadline_id where f.id=${parcel.id}`,due=kind==='packing'?deadline.packing_due_at:deadline.handover_due_at;
   await sql`update app.local_fixture_namespace set clock=${new Date(new Date(due).getTime()+1).toISOString()},revision=revision+1 where name=${f.namespace}`;
   const jobs=await sql`select j.id from app.fulfillment_deadline d join app.outbox_job j on j.dedup_key='fulfillment-deadline:'||d.id::text||':'||${kind} where d.fulfillment_id=${parcel.id} and j.status<>'completed' order by d.created_at desc`;for(const job of jobs)await f.run(job.id);
   const notices=await sql`select * from app.fulfillment_notice where fulfillment_id=${parcel.id} and kind=${`${kind}_overdue`}`;assert.equal(notices.length,1);assert.equal(notices[0].available_at,null);
   assert.ok(!JSON.stringify(await sql.begin(tx=>projectOrder(tx,f.order.id))).includes(`${kind}_overdue`));await f.run(notices[0].job_id);
   const buyer=JSON.stringify(await sql.begin(tx=>projectOrder(tx,f.order.id)));assert.ok(buyer.includes(`${kind}_overdue`));assert.ok(!buyer.includes(privateReason));
  };
  await miss('packing',3);await f.run(await ingestWaybillEvent(sql,await simulateWaybillIssue(sql,'test',booking.id)));
  assert.equal((await f.fulfillmentCall(`${root}/packing`,{expected_version:5})).response.status,201);await miss('handover',6);
 }finally{await f.close();}
});
test('simultaneous staff retries and source claims create one preparation, booking and original source effect',async()=>{
 const f=await fulfillmentFixture();try{
  const parcel=f.parcels[0],root=`/api/v1/admin/fulfillments/${parcel.id}`,key=randomUUID();
  const prepared=await Promise.all([f.fulfillmentCall(`${root}/preparations`,{expected_version:1},key),f.fulfillmentCall(`${root}/preparations`,{expected_version:1},key)]);assert.deepEqual(prepared.map(r=>r.response.status),[201,201]);assert.equal(prepared[0].payload.version,2);assert.deepEqual(prepared[0].payload,prepared[1].payload);
  const bookingKey=randomUUID(),booked=await Promise.all([f.fulfillmentCall('/api/v1/admin/shipments',{fulfillment_id:parcel.id,expected_version:2},bookingKey),f.fulfillmentCall('/api/v1/admin/shipments',{fulfillment_id:parcel.id,expected_version:2},bookingKey)]);assert.deepEqual(booked.map(r=>r.response.status),[202,202]);assert.equal(booked[0].payload.operation_id,booked[1].payload.operation_id);
  const [booking]=await f.identity.sql`select * from app.shipment_booking where id=${booked[0].payload.operation_id}`,adapter={'shipping.create':shippingAdapter(f.identity.sql,'test')};
  const claimed=await Promise.all([runOneJob(f.identity.sql,adapter,booking.creation_job_id),runOneJob(f.identity.sql,adapter,booking.creation_job_id)]);assert.deepEqual(claimed.sort(),[false,true]);assert.equal((await f.identity.sql`select count(*)::int n from app.local_waybill_operation where booking_id=${booking.id}`)[0].n,1);
  assert.equal((await f.identity.sql`select count(*)::int n from app.order_event where order_id=${f.order.id} and status='processing'`)[0].n,1);
 }finally{await f.close();}
});
