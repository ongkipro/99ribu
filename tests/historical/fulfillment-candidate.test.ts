import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import type {Sql,TransactionSql} from 'postgres';
import {connectDatabase} from '../../src/db/client.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {capability,commerceActor,prefix} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {createQuote} from '../../src/modules/checkout/quotes.ts';
import {submitOrder,projectOrder} from '../../src/modules/checkout/orders.ts';
import {prepareFulfillment,bookShipment,completePacking,handoverFulfillment,rescheduleFulfillment} from '../../src/modules/fulfillment/commands.ts';
import {shippingAdapter} from '../../src/modules/fulfillment/worker.ts';
import {simulateWaybillIssue,ingestWaybillEvent,registerWaybillEvent} from '../../src/modules/fulfillment/local.ts';
import {simulateCodCollection,ingestCodEvent} from '../../src/modules/payments/cod-local.ts';
import {createAttempt} from '../../src/modules/payments/attempts.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {simulateCollection,ingestProviderEvent} from '../../src/modules/payments/local.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {checkoutFixture,ownShippingCampaign} from '../integration/checkout-fixture.ts';

// This routes real service transactions into PostgreSQL savepoints solely so
// the unapplied schema and entire business proof can be rolled back together.
// Independent provider commits and fresh-process recovery remain runtime proof.
function candidateConnection(tx:TransactionSql){return new Proxy(tx,{get(target,property,receiver){if(property==='begin')return (run:(inner:TransactionSql)=>Promise<unknown>)=>target.savepoint(async inner=>{await inner`set constraints all deferred`;return run(inner);});return Reflect.get(target,property,receiver);}}) as unknown as Sql;}

for(const method of ['cod','prepaid'] as const)test(`rollback-only ${method} fulfillment uses signed issuance, exact parcel handovers and one subsidy commitment while preserving original money`,async()=>{
 const f=await checkoutFixture(),owner=connectDatabase('test','owner'),rollback=new Error('Expected full fulfillment candidate rollback');let stage='setup',campaign:Awaited<ReturnType<typeof ownShippingCampaign>>|undefined;
 try{
  campaign=await ownShippingCampaign(f,[method]);const campaignId=campaign.id;
  const warehouses=await f.identity.sql`select w.id,w.timezone from app.warehouse w join app.local_fixture_warehouse n on n.warehouse_id=w.id where n.namespace=${f.namespace} order by w.id`;
  const [clock]=await f.identity.sql`select extract(year from (clock at time zone 'Asia/Jakarta'))::int calendar_year from app.local_fixture_namespace where name=${f.namespace}`;
  for(const warehouse of warehouses){
   const proofRequest=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'warehouse_calendar.version',subject_id:warehouse.id});proofRequest.headers.set('idempotency-key',randomUUID());
   const proof=await handleAccess(proofRequest,f.identity);assert.equal(proof.status,201);
   const request=f.owner.browser.request('/api/v1/admin/policy-versions',{kind:'warehouse_calendar',warehouse_id:warehouse.id,effective_at:null,expected_version:0,values:{timezone:warehouse.timezone,year:clock.calendar_year,working_weekdays:[0,1,2,3,4,5,6],cutoff_local:'23:59',closed_dates:[],source:'TEST-ONLY',approval:'test_only'},reason:'SYNTHETIC owned full fulfillment calendar',reauthentication_proof:(await proof.json()).proof});request.headers.set('idempotency-key',randomUUID());assert.equal((await handleAccess(request,f.identity)).status,201);
  }
  await f.identity.sql`update app.local_fixture_namespace set clock=greatest(clock,clock_timestamp())+interval '2 seconds',revision=revision+1 where name=${f.namespace}`;
  assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);const actor=await commerceActor(f.client.request('/api/v1/carts',{}),f.identity);assert.ok(actor?.kind==='guest');
  await assert.rejects(owner.sql.begin(async tx=>{
   stage='candidate DDL';for(const part of readFileSync('migrations/0019_fulfillment_deadlines.sql','utf8').split('--> statement-breakpoint'))if(part.trim())await tx.unsafe(part);
   const sql=candidateConnection(tx),identity={...f.identity,sql};
   const run=async(jobId:string)=>{assert.equal(await runOneJob(sql,{'shipping.create':shippingAdapter(sql,'test'),'payment.create':paymentAdapter(sql,'test')},jobId),true);const [job]=await tx`select status,last_error from app.outbox_job where id=${jobId}`;assert.equal(job.status,'completed',`Expected completed job at ${stage}; safe error ${job.last_error??'none'}`);};
   stage=`real complete ${method} checkout`;const cart=await createCart(tx,f.client.request('/api/v1/carts',{}),identity,actor,{lines:[f.line('fixture-offer-shirt',4)]},{clock_namespace:f.namespace}),name=`${await prefix(identity)}.cart_access`,token=await capability(identity,'cart',cart.cart.id,actor.id,cart.cart.cap_issued_at as string);f.client.cookies.set(`${name}:/`,{name,value:`${cart.cart.id}.${token}`,path:'/'});
   const quoteInput={cart_id:cart.cart.id,address:f.address,contact:f.contact(),payment_method:method},quote=await createQuote(tx,f.client.request('/api/v1/checkout/quotes',quoteInput,{version:1}),identity,actor,quoteInput),body={quote_id:quote.id},saved=await submitOrder(tx,f.client.request('/api/v1/orders',body,{version:1}),identity,actor,body),order=saved.response.order;
   assert.equal(order.payment_status,method==='cod'?'cod_due':'pending');assert.equal(order.subsidy_total,3000);assert.equal(order.shipments.length,2);
   let prepaidAttemptId:string|undefined;
   if(method==='prepaid'){
    stage='real prepaid funding initializes original fulfillment';await tx`update app.local_fixture_namespace set clock=clock+interval '1 minute',revision=revision+1 where name=${f.namespace}`;
    const attempt=await createAttempt(tx,order.id,randomUUID(),{method_id:'local-prepaid'});prepaidAttemptId=attempt.id;const [stored]=await tx`select creation_job_id from app.payment_attempt where id=${attempt.id}`;await run(stored.creation_job_id);
    const event=await simulateCollection(sql,'test',attempt.id);await run(await ingestProviderEvent(sql,event));
   }
   await tx`set constraints all immediate`;
   const fulfillments=await tx`select f.* from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${order.id} order by s.id`;assert.equal(fulfillments.length,2);assert.ok(fulfillments.every(f=>f.status==='ready'&&f.revision===1));
   const command=(path:string,input:Record<string,unknown>,key=randomUUID())=>{const request=f.owner.browser.request(path,input);request.headers.set('idempotency-key',key);return request;};
   stage='deny unprepared booking';await assert.rejects(bookShipment(command('/api/v1/admin/shipments',{}),identity,f.principal,{fulfillment_id:fulfillments[0].id,expected_version:1}),{code:'FULFILLMENT_NOT_PREPARED'});
   const first=fulfillments[0];let packingRequest:Request|undefined,packingReplayVersion=0;
   const missRescheduledDeadline=async(fulfillmentId:string,kind:'packing'|'handover',version:number)=>{
    stage=`rescheduled ${kind} remains observable when missed`;
    const privateReason=`PRIVATE ${randomUUID()}`,explanation=`SYNTHETIC ${kind} schedule update`;
    await rescheduleFulfillment(command(`/api/v1/admin/fulfillments/${fulfillmentId}/reschedules`,{}),identity,f.principal,fulfillmentId,{expected_version:version,reason:privateReason,buyer_explanation:explanation});
    const [deadline]=await tx`select d.* from app.fulfillment f join app.fulfillment_deadline d on d.id=f.deadline_id where f.id=${fulfillmentId}`;
    const due=kind==='packing'?deadline.packing_due_at:deadline.handover_due_at;
    await tx`update app.local_fixture_namespace set clock=${new Date(new Date(due).getTime()+1).toISOString()},revision=revision+1 where name=${f.namespace}`;
    const [job]=await tx`select id from app.outbox_job where dedup_key=${`fulfillment-deadline:${deadline.id}:${kind}`}`;await run(job.id);
    const notices=await tx`select * from app.fulfillment_notice where fulfillment_id=${fulfillmentId} and kind=${`${kind}_overdue`}`;assert.equal(notices.length,1);await run(notices[0].job_id);
    for(const previous of await tx`select j.id from app.fulfillment_deadline d join app.outbox_job j on j.dedup_key='fulfillment-deadline:'||d.id::text||':'||${kind} where d.fulfillment_id=${fulfillmentId} and d.id<>${deadline.id} and j.status<>'completed'`)await run(previous.id);
    assert.equal((await tx`select count(*)::int n from app.fulfillment_notice where fulfillment_id=${fulfillmentId} and kind=${`${kind}_overdue`}`)[0].n,1);
    const buyer=JSON.stringify(await projectOrder(tx,order.id));assert.ok(!buyer.includes(privateReason));assert.ok(buyer.includes(`${kind}_overdue`));
    return version+1;
   };
   for(let index=0;index<fulfillments.length;index++){
    const current=fulfillments[index];stage=`parcel${index+1} physical preparation`;
    const prepared=await prepareFulfillment(command(`/api/v1/admin/fulfillments/${current.id}/preparations`,{}),identity,f.principal,current.id,{expected_version:1});assert.equal((prepared as {status:string}).status,'picking');
    stage=`parcel${index+1} acknowledged booking is not tracking`;
    let booked=await bookShipment(command('/api/v1/admin/shipments',{}),identity,f.principal,{fulfillment_id:current.id,expected_version:2}) as {operation_id:string};
    let version=3;
    assert.equal((await projectOrder(tx,order.id)).shipments.find(s=>s.id===current.shipment_id)?.status,'booking_pending');
    const [booking]=await tx`select creation_job_id from app.shipment_booking where id=${booked.operation_id}`;await run(booking.creation_job_id);
    const [acknowledgement]=await tx`select provider.callback_job_id from app.waybill_provider_event provider join app.local_waybill_event event on event.id=provider.id where provider.booking_id=${booked.operation_id} and event.status='acknowledged'`;await run(acknowledgement.callback_job_id);
    assert.equal((await projectOrder(tx,order.id)).shipments.find(s=>s.id===current.shipment_id)?.status,'booked');
    assert.equal((await tx`select waybill_issued_at,tracking_number from app.fulfillment where id=${current.id}`)[0].tracking_number,null);
    await assert.rejects(completePacking(command(`/api/v1/admin/fulfillments/${current.id}/packing`,{}),identity,f.principal,current.id,{expected_version:3}),{code:'WAYBILL_NOT_ISSUED'});
    if(index===0&&method==='cod'){
     stage='known failed issuance can recover without losing its original source';
     const failed=await simulateWaybillIssue(sql,'test',booked.operation_id,'failed');await run(await ingestWaybillEvent(sql,failed));
     const originalBooking=booked.operation_id;
     booked=await bookShipment(command('/api/v1/admin/shipments',{}),identity,f.principal,{fulfillment_id:current.id,expected_version:4,reason:'SYNTHETIC retry after authenticated terminal rejection'}) as {operation_id:string};version=5;
     assert.notEqual(booked.operation_id,originalBooking);const [retry]=await tx`select creation_job_id from app.shipment_booking where id=${booked.operation_id}`;await run(retry.creation_job_id);
     const callbacks=await tx`select callback_job_id from app.waybill_provider_event where booking_id=${booked.operation_id}`;for(const callback of callbacks)await run(callback.callback_job_id);
     const duplicateFailure=await simulateWaybillIssue(sql,'test',originalBooking,'failed');await run(await ingestWaybillEvent(sql,duplicateFailure));
     assert.equal((await tx`select revision from app.fulfillment where id=${current.id}`)[0].revision,5);
     assert.equal((await tx`select count(*)::int n from app.shipment_booking where fulfillment_id=${current.id}`)[0].n,2);
     await assert.rejects(bookShipment(command('/api/v1/admin/shipments',{}),identity,f.principal,{fulfillment_id:current.id,expected_version:5,reason:'SYNTHETIC must not duplicate an active booking'}),{code:'SHIPMENT_BOOKING_ACTIVE'});
    }
    if(index===0&&method==='prepaid')version=await missRescheduledDeadline(current.id,'packing',version);
    stage=`parcel${index+1} authenticated issued source`;
    const issued=await simulateWaybillIssue(sql,'test',booked.operation_id);
    await assert.rejects(tx.savepoint(t=>registerWaybillEvent(t,{...issued,signature:'0'.repeat(64)})),{code:'INVALID_WAYBILL_SIGNATURE'});
    await run(await ingestWaybillEvent(sql,issued));
    const [milestone]=await tx`select status,revision,waybill_issued_at,tracking_number from app.fulfillment where id=${current.id}`;assert.equal(milestone.status,'packed');assert.equal(milestone.revision,version+1);assert.equal(new Date(milestone.waybill_issued_at).toISOString(),issued.occurred_at);
    await assert.rejects(tx.savepoint(t=>t`update app.local_waybill_operation set tracking_number='LOCAL-00000000000000000000000000000000' where id=${issued.operation_id}`),{code:'23514'});
    const packingInput={expected_version:version+1},packing=command(`/api/v1/admin/fulfillments/${current.id}/packing`,packingInput);if(index===0){packingRequest=packing;packingReplayVersion=version+2;}
    await completePacking(packing,identity,f.principal,current.id,packingInput);
    version+=2;if(index===0&&method==='prepaid')version=await missRescheduledDeadline(current.id,'handover',version);
    if(index===0){await tx`update app.local_fixture_namespace set clock=clock+interval '31 minutes',revision=revision+1 where name=${f.namespace}`;}
    stage=`parcel${index+1} original expired hold remains consumable only through handover`;
    const handed=await handoverFulfillment(command(`/api/v1/admin/fulfillments/${current.id}/handover`,{}),identity,f.principal,current.id,{expected_version:version,shipment_id:current.shipment_id,handover_reference:`SYNTHETIC handover ${index+1}`}) as {status:string};assert.equal(handed.status,'handed_over');
    const [held]=await tx`select r.status from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id=${order.id}`;assert.equal(held.status,index===0?'active':'consumed');
    assert.equal((await tx`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,method==='cod'?0:1);
    const duplicate=await simulateWaybillIssue(sql,'test',booked.operation_id);await run(await ingestWaybillEvent(sql,duplicate));assert.equal((await tx`select revision from app.fulfillment where id=${current.id}`)[0].revision,version+1);
   }
   stage='same original packing command replay after handover';assert.ok(packingRequest);const replay=await completePacking(packingRequest,identity,f.principal,first.id,{expected_version:packingReplayVersion-1}) as {version:number};assert.equal(replay.version,packingReplayVersion);
   const [benefit]=await tx`select reserved_amount::text reserved,committed_amount::text committed from app.promotion where id=${campaignId}`;assert.deepEqual(benefit,{reserved:'0',committed:'3000'});assert.equal((await tx`select count(*)::int n from app.promotion_movement where promotion_id=${campaignId} and kind='consume'`)[0].n,1);
   stage=`original ${method} money after physical handovers`;
   if(method==='cod')for(const fulfillment of fulfillments){const event=await simulateCodCollection(sql,'test',fulfillment.shipment_id);await run(await ingestCodEvent(sql,event));}
   else{assert.ok(prepaidAttemptId);const duplicate=await simulateCollection(sql,'test',prepaidAttemptId);await run(await ingestProviderEvent(sql,duplicate));}
   const [final]=await tx`select status,payment_status,revision,case when payment_method='cod' then actionable_at=created_at else actionable_at=(select occurred_at from app.economic_receipt where order_id=${order.id} and kind='prepaid') end original_anchor from app.commerce_order where id=${order.id}`;assert.deepEqual(final,{status:'processing',payment_status:'confirmed',revision:method==='cod'?5:3,original_anchor:true});
   assert.equal((await tx`select count(*)::int n,sum(merchandise_amount)::text total from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].total,'396000');assert.equal((await tx`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,method==='cod'?2:1);
   stage='final all-domain deferred seals';await tx`set constraints all immediate`;throw rollback;
  }),error=>{if(error===rollback)return true;const safe=error as {code?:unknown;constraint_name?:unknown};assert.fail(`Fulfillment candidate failed at ${stage} (${String(safe.code??'domain')}/${String(safe.constraint_name??'constraint')})`);});
 }finally{await owner.sql.end();if(campaign)await campaign.close();await f.close();}
});
