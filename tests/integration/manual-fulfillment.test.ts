import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {promisify} from 'node:util';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleFulfillment} from '../../src/modules/fulfillment/routes.ts';
import {handleManualFulfillment} from '../../src/modules/fulfillment/manual-routes.ts';
import {fulfillmentMode,pickupReadiness,processTrackingPoll,quotedCourierCode,simulateTrackingObservation,simulatedTrackingAdapter,tracking,trackingNumber} from '../../src/modules/fulfillment/manual.ts';
import {rateSeam} from '../../src/modules/shipping/quotes.ts';
import {localRateAdapter} from '../../src/modules/shipping/rates.ts';
import {projectReturnEligibility} from '../../src/modules/returns/receipts.ts';
import {advanceFulfillment,fulfillmentClock,lockFulfillment} from '../../src/modules/fulfillment/core.ts';
import {projectOrder} from '../../src/modules/checkout/orders.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor,fulfillmentFixture,installFulfillmentCalendars} from './fulfillment-fixture.ts';

type User={browser:{request:(path:string,body?:Record<string,unknown>)=>Request}};
async function call(user:User,identity:Parameters<typeof handleManualFulfillment>[1],path:string,body?:Record<string,unknown>,key=randomUUID()){
 const request=user.browser.request(path,body);if(body!==undefined)request.headers.set('idempotency-key',key);
 const response=await handleManualFulfillment(request,identity);return {status:response.status,payload:await response.json()};
}
// Capture every console line a request path emits, to prove personal data never reaches logs.
async function captureLogs<T>(run:()=>Promise<T>){
 const lines:string[]=[],saved={log:console.log,error:console.error,warn:console.warn,info:console.info};
 for(const name of ['log','error','warn','info'] as const)console[name]=(...args:unknown[])=>{lines.push(args.map(String).join(' '));};
 try{return {result:await run(),lines};}finally{Object.assign(console,saved);}
}

test('mode is manual unless the pickup profile is complete and the Mengantar flag is on; resi input is normalized',()=>{
 assert.equal(pickupReadiness(null),'incomplete');
 assert.equal(pickupReadiness({street_address:'Jl. Contoh 1 RT 2',pic_name:'Budi',pic_phone:null}),'incomplete');
 assert.equal(pickupReadiness({street_address:'Jl. Contoh 1 RT 2',pic_name:'Budi',pic_phone:'6281234567890'}),'complete');
 assert.equal(fulfillmentMode('complete'),'manual_dashboard','complete profile + flag off stays manual');
 assert.equal(fulfillmentMode('complete',true),'mengantar_api');assert.equal(fulfillmentMode('incomplete',true),'manual_dashboard');
 assert.equal(trackingNumber(' jp 1234 5678 90 '),'JP1234567890');
 for(const bad of ['short','JP12345678!','A'.repeat(41)])assert.throws(()=>trackingNumber(bad),{code:'INVALID_TRACKING_NUMBER'});
});

test('manual COD parcel: queue by path, resi entry ships once, buyer sees courier and resi, correction is audited, tracking delivers once',async()=>{
 const f=await fulfillmentFixture('cod'),sql=f.identity.sql,identity=f.identity,stamp=String(Date.now()).slice(-8),resiA=`JP${stamp}01`,resiB=`004${stamp}901`;
 const staff:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  const [manual,booked]=f.parcels,queue=async(name:string,warehouse:string,user:User=f.owner)=>call(user,identity,`/api/v1/admin/manual-shipments?queue=${name}&warehouse_id=${warehouse}&limit=100`);
  let listed=await queue('to_book',manual.warehouse_id);assert.equal(listed.status,200);assert.ok(listed.payload.data.some((p:{id:string})=>p.id===manual.id));
  const bookedListed=await queue('to_book',booked.warehouse_id);assert.ok(bookedListed.payload.data.some((p:{id:string})=>p.id===booked.id));
  await f.book(booked);
  assert.ok(!(await queue('to_book',booked.warehouse_id)).payload.data.some((p:{id:string})=>p.id===booked.id),'a simulator-booked parcel leaves the manual queue');
  const refusedBooked=await call(f.owner,identity,`/api/v1/admin/fulfillments/${booked.id}/manual-shipment`,{expected_version:3,courier:'jne',tracking_number:'JP0000000001'});
  assert.equal(refusedBooked.status,409);assert.equal(refusedBooked.payload.code,'FULFILLMENT_PATH_BOOKED');

  const path=`/api/v1/admin/fulfillments/${manual.id}/manual-shipment`;
  assert.equal((await call(f.owner,identity,path,{expected_version:1,courier:'dhl',tracking_number:resiA})).payload.code,'INVALID_COURIER');
  assert.equal((await call(f.owner,identity,path,{expected_version:1,courier:'jne',tracking_number:'JP-12'})).payload.code,'INVALID_TRACKING_NUMBER');
  assert.equal((await call(f.owner,identity,path,{expected_version:2,courier:'jne',tracking_number:resiA})).payload.code,'VERSION_CONFLICT');

  // Warehouse staff assigned to the other warehouse cannot see or ship this parcel; finance cannot ship at all.
  const other=await actor(identity,'warehouse',[booked.warehouse_id]);staff.push(other);await enroll(other.browser,other.password);
  assert.equal((await queue('to_book',manual.warehouse_id,other)).status,404);
  assert.equal((await call(other,identity,path,{expected_version:1,courier:'jne',tracking_number:resiA})).status,404);
  assert.equal((await call(other,identity,`/api/v1/admin/warehouses/${manual.warehouse_id}/pickup-profile`)).status,403);
  const finance=await actor(identity,'finance',[]);staff.push(finance);await enroll(finance.browser,finance.password);
  assert.equal((await call(finance,identity,path,{expected_version:1,courier:'jne',tracking_number:resiA})).status,403);

  const key=randomUUID(),body={expected_version:1,courier:'jne',tracking_number:resiA.toLowerCase().replace(/(.{4})/g,'$1 '),purchase_reference:'BL-INV/2026/001'};
  const shipped=await call(f.owner,identity,path,body,key);assert.equal(shipped.status,201,JSON.stringify(shipped.payload));
  assert.equal(shipped.payload.status,'handed_over');assert.equal(shipped.payload.manual.tracking_number,resiA);assert.equal(shipped.payload.manual.purchase_reference.reference,'BL-INV/2026/001');
  assert.deepEqual((await call(f.owner,identity,path,body,key)).payload,shipped.payload,'same key replays the original response');
  assert.equal((await call(f.owner,identity,path,{...body,tracking_number:'JP9999999999'},key)).payload.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await call(f.owner,identity,path,{...body,expected_version:shipped.payload.version})).payload.code,'FULFILLMENT_ALREADY_SHIPPED');

  const [components]=await sql`select sum(a.quantity)::int expected from app.fulfillment_component_allocation a join app.fulfillment_item i on i.id=a.fulfillment_item_id where i.shipment_id=${manual.shipment_id}`;
  const [consumed]=await sql`select sum(m.quantity)::int actual,count(distinct e.id)::int events from app.stock_movement m join app.fulfillment_event e on m.source_ref='handover:'||e.id::text where e.fulfillment_id=${manual.id} and m.kind='consume'`;
  assert.equal(consumed.actual,components.expected);assert.equal(consumed.events,1);
  const booking=await f.fulfillmentCall('/api/v1/admin/shipments',{fulfillment_id:manual.id,expected_version:shipped.payload.version});assert.equal(booking.response.status,409,'no carrier booking after a manual resi');

  let order=await sql.begin(tx=>projectOrder(tx,f.order.id)),parcel=order.shipments.find(s=>s.id===manual.shipment_id) as Record<string,unknown>;
  assert.equal(parcel.tracking_number,resiA);assert.equal(parcel.courier_name,'JNE');assert.equal(parcel.status,'handed_over');
  listed=await queue('shipped',manual.warehouse_id);assert.ok(listed.payload.data.some((p:{id:string})=>p.id===manual.id));
  assert.ok(!(await queue('to_book',manual.warehouse_id)).payload.data.some((p:{id:string})=>p.id===manual.id));

  // Resi correction: reason required, every version kept and audited.
  const correction=`/api/v1/admin/fulfillments/${manual.id}/tracking-corrections`;
  assert.equal((await call(f.owner,identity,correction,{expected_version:shipped.payload.version,courier:'jne',tracking_number:`${resiA}9`})).payload.code,'CORRECTION_REASON_REQUIRED');
  assert.equal((await call(f.owner,identity,correction,{expected_version:shipped.payload.version,courier:'jne',tracking_number:resiA,reason:'Salah ketik resi'})).payload.code,'TRACKING_UNCHANGED');
  const corrected=await call(f.owner,identity,correction,{expected_version:shipped.payload.version,courier:'sicepat',tracking_number:resiB,reason:'Salah ketik resi'});
  assert.equal(corrected.status,201,JSON.stringify(corrected.payload));assert.equal(corrected.payload.manual.tracking_versions.length,2);assert.equal(corrected.payload.status,'handed_over');
  assert.equal((await sql`select count(*)::int n from app.audit_event where subject_id=${manual.id} and action='fulfillment.tracking_correct' and reason='Salah ketik resi'`)[0].n,1);
  order=await sql.begin(tx=>projectOrder(tx,f.order.id));parcel=order.shipments.find(s=>s.id===manual.shipment_id) as Record<string,unknown>;
  assert.equal(parcel.tracking_number,resiB);assert.equal(parcel.courier_name,'SiCepat');

  // Tracking seam: simulated adapter; superseded resi poll stops; monotonic statuses.
  const [first,second]=await sql`select mt.id,j.id job_id from app.manual_tracking mt join app.outbox_job j on j.dedup_key='fulfillment-tracking:'||mt.id::text where mt.fulfillment_id=${manual.id} order by mt.version`;
  const runPoll=async(jobId:string)=>{await sql`update app.outbox_job set run_at=clock_timestamp() where id=${jobId} and status='pending'`;assert.equal(await runOneJob(sql,{},jobId),true);return (await sql`select status,result,last_error from app.outbox_job where id=${jobId}`)[0];};
  assert.deepEqual((await runPoll(first.job_id)).result,{status:'superseded'});
  await simulateTrackingObservation(sql,'test',{courier:'sicepat',tracking_number:resiB,provider_status:'IN_TRANSIT'});
  await simulateTrackingObservation(sql,'test',{courier:'sicepat',tracking_number:resiB,provider_status:'WEIRD_STATUS'});
  let polled=await runPoll(second.job_id);assert.equal(polled.status,'pending');
  assert.deepEqual((await sql`select status,source_kind,adapter from app.shipment_tracking_event where fulfillment_id=${manual.id}`).map(r=>({...r})),[{status:'in_transit',source_kind:'adapter',adapter:'simulated'}]);
  order=await sql.begin(tx=>projectOrder(tx,f.order.id));parcel=order.shipments.find(s=>s.id===manual.shipment_id) as Record<string,unknown>;
  assert.equal(parcel.tracking_status,'in_transit');assert.equal(parcel.status,'handed_over');
  assert.equal((await sql`select count(*)::int n from app.buyer_receipt b join app.fulfillment_item i on i.id=b.fulfillment_item_id where i.shipment_id=${manual.shipment_id}`)[0].n,0);
  await simulateTrackingObservation(sql,'test',{courier:'sicepat',tracking_number:resiB,provider_status:'PICKED_UP'});
  await simulateTrackingObservation(sql,'test',{courier:'sicepat',tracking_number:resiB,provider_status:'DELIVERED'});
  polled=await runPoll(second.job_id);assert.equal(polled.status,'completed');assert.deepEqual(polled.result,{status:'delivered'});
  const statuses=(await sql`select status from app.shipment_tracking_event where fulfillment_id=${manual.id} order by occurred_at,recorded_at`).map(r=>r.status);
  assert.deepEqual(statuses,['in_transit','delivered'],'a lower-rank observation after in_transit is ignored');
  const [receipt]=await sql`select j.id from app.shipment_tracking_event t join app.parcel_receipt_provider_event p on p.id=t.receipt_source_id join app.outbox_job j on j.id=p.callback_job_id where t.fulfillment_id=${manual.id}`;
  await f.run(receipt.id);
  const [units]=await sql`select count(*)::int n from app.fulfillment_item where shipment_id=${manual.shipment_id}`;
  assert.equal((await sql`select count(*)::int n from app.buyer_receipt b join app.fulfillment_item i on i.id=b.fulfillment_item_id where i.shipment_id=${manual.shipment_id}`)[0].n,units.n);
  order=await sql.begin(tx=>projectOrder(tx,f.order.id));parcel=order.shipments.find(s=>s.id===manual.shipment_id) as Record<string,unknown>;assert.equal(parcel.status,'delivered');
  // The fixture business clock, not wall time: a wall-clock instant ahead of it is refused as future (422).
  const lateAt=new Date((await sql`select clock from app.local_fixture_namespace where name=${f.namespace}`)[0].clock).toISOString();
  const late=await call(f.owner,identity,`/api/v1/admin/fulfillments/${manual.id}/tracking-statuses`,{status:'delivered',occurred_at:lateAt,reason:'Cek dashboard Mengantar',evidence:'Status terkirim di dashboard'});
  assert.equal(late.status,409);

  // Private pickup profile: versioned, readiness computed, never in buyer data, audit details or logs.
  const profilePath=`/api/v1/admin/warehouses/${manual.warehouse_id}/pickup-profile`,secret=`Jl. Rahasia ${randomUUID().slice(0,8)} No. 7`,picName=`PIC ${randomUUID().slice(0,6)}`;
  const empty=await call(f.owner,identity,profilePath);assert.equal(empty.status,200);
  const savedKey=randomUUID();let savedBody:Record<string,unknown>={};
  const {result:saved,lines}=await captureLogs(async()=>{
   const partial=await call(f.owner,identity,profilePath,{expected_version:empty.payload.version,street_address:secret,pic_name:picName,pic_phone:null,pinpoint:null,reason:'Data pickup awal'});
   assert.equal(partial.status,201,JSON.stringify(partial.payload));assert.equal(partial.payload.readiness,'incomplete');
   assert.equal((await call(f.owner,identity,profilePath,{expected_version:empty.payload.version,street_address:secret,pic_name:picName,pic_phone:'0812 3456 7890',pinpoint:null,reason:'Lengkap'})).payload.code,'VERSION_CONFLICT');
   assert.equal((await call(f.owner,identity,profilePath,{expected_version:partial.payload.version,street_address:secret,pic_name:picName,pic_phone:'12345',pinpoint:null,reason:'Lengkap'})).payload.code,'INVALID_PIC_PHONE');
   savedBody={expected_version:partial.payload.version,street_address:secret,pic_name:picName,pic_phone:'0812 3456 7890',pinpoint:{latitude:-6.2,longitude:106.8},reason:'Lengkap'};
   return call(f.owner,identity,profilePath,savedBody,savedKey);
  });
  assert.equal(saved.status,201);assert.equal(saved.payload.readiness,'complete');assert.equal(saved.payload.mode,'manual_dashboard');assert.equal(saved.payload.pic_phone,'6281234567890');
  assert.deepEqual((await call(f.owner,identity,profilePath,savedBody,savedKey)).payload,saved.payload,'a replay returns the same full profile shape');
  // An ecommerce_admin of another warehouse can neither read nor write this private profile.
  const outsider=await actor(identity,'ecommerce_admin',[booked.warehouse_id]);staff.push(outsider);await enroll(outsider.browser,outsider.password);
  assert.equal((await call(outsider,identity,`/api/v1/admin/warehouses/${booked.warehouse_id}/pickup-profile`)).status,200,'own warehouse stays readable');
  for(const denied of [await call(outsider,identity,profilePath),await call(outsider,identity,profilePath,{...savedBody,expected_version:saved.payload.version,reason:'Bukan gudang saya'})]){
   assert.equal(denied.status,404);assert.ok(!JSON.stringify(denied.payload).includes(picName));
  }
  assert.ok(!lines.some(line=>line.includes(secret)||line.includes(picName)||line.includes('6281234567890')));
  const audits=JSON.stringify(await sql`select reason,details from app.audit_event where subject_id=${manual.warehouse_id} and action='warehouse.pickup_profile'`);
  assert.ok(audits.includes('changed_fields'));assert.ok(!audits.includes(secret)&&!audits.includes(picName)&&!audits.includes('6281234567890'));
  const buyer=JSON.stringify(await sql.begin(tx=>projectOrder(tx,f.order.id)));assert.ok(!buyer.includes(secret)&&!buyer.includes(picName));
  assert.ok((await queue('shipped',manual.warehouse_id)).status===200,'a complete profile with the flag off keeps the warehouse in the manual queues');
  assert.equal((await sql`update app.warehouse_pickup_profile set pic_name='x' where warehouse_id=${manual.warehouse_id} returning id`.catch((error:{code?:string})=>error.code)),'23514');
 }finally{for(const user of staff)await closeFulfillmentActor(f.identity,user).catch(()=>{});await f.close();}
});

test('manual prepaid parcels: calendar missing, one live resi per courier, courier-only correction, failed is not terminal, scoped operator fallback, bounded adapter failure',async()=>{
 const f=await fulfillmentFixture('prepaid',{calendars:false}),sql=f.identity.sql,identity=f.identity,stamp=String(Date.now()).slice(-8),resi=`JX${stamp}90`,resiB=`JX${stamp}91`;
 const staff:Awaited<ReturnType<typeof actor>>[]=[];
 try{
  const [parcel,other]=f.parcels;assert.equal(parcel.status,'exception');assert.equal(parcel.calendar_error,'POLICY_UNCONFIGURED');
  const listed=await call(f.owner,identity,`/api/v1/admin/manual-shipments?queue=to_book&warehouse_id=${parcel.warehouse_id}&limit=100`);
  assert.ok(listed.payload.data.some((p:{id:string})=>p.id===parcel.id),'calendar-missing parcels still wait in the manual queue');
  // Only paid prepaid or confirmed COD parcels are ever queued.
  for(const row of listed.payload.data as {order_id:string}[]){const [o]=await sql`select payment_method,payment_status from app.commerce_order where id=${row.order_id}`;assert.ok(o.payment_method==='prepaid'?o.payment_status==='confirmed':['cod_due','partially_collected','confirmed'].includes(o.payment_status));}
  const cs=await actor(identity,'customer_service',[]);staff.push(cs);await enroll(cs.browser,cs.password);
  assert.equal((await call(cs,identity,`/api/v1/admin/manual-shipments?queue=to_book`)).status,403);
  const shipped=await call(f.owner,identity,`/api/v1/admin/fulfillments/${parcel.id}/manual-shipment`,{expected_version:parcel.revision,courier:'jnt',tracking_number:resi});
  assert.equal(shipped.status,201,JSON.stringify(shipped.payload));assert.equal(shipped.payload.status,'handed_over');
  assert.equal((await sql`select status from app.commerce_order where id=${f.order.id}`)[0].status,'processing');
  // One live resi per courier: the second parcel cannot reuse it, by entry or by correction.
  assert.equal((await call(f.owner,identity,`/api/v1/admin/fulfillments/${other.id}/manual-shipment`,{expected_version:other.revision,courier:'jnt',tracking_number:resi})).payload.code,'TRACKING_NUMBER_IN_USE');
  const second=await call(f.owner,identity,`/api/v1/admin/fulfillments/${other.id}/manual-shipment`,{expected_version:other.revision,courier:'jnt',tracking_number:resiB});assert.equal(second.status,201);
  const correctOther=`/api/v1/admin/fulfillments/${other.id}/tracking-corrections`;
  assert.equal((await call(f.owner,identity,correctOther,{expected_version:second.payload.version,courier:'jnt',tracking_number:resi,reason:'Uji'})).payload.code,'TRACKING_NUMBER_IN_USE');
  const courierOnly=await call(f.owner,identity,correctOther,{expected_version:second.payload.version,courier:'jne',tracking_number:resiB,reason:'Salah pilih kurir'});
  assert.equal(courierOnly.status,201,JSON.stringify(courierOnly.payload));assert.equal(courierOnly.payload.manual.courier,'jne');assert.equal(courierOnly.payload.manual.tracking_versions.length,2);
  // Database backstop (no application check): a correction cannot take another parcel's live resi.
  await assert.rejects(sql.begin(async tx=>{
   const state=await lockFulfillment(tx,other.id),changed=await advanceFulfillment(tx,state.head,{kind:'tracking_corrected',status:state.head.status,source_kind:'operation',source_id:randomUUID(),actor_id:f.owner.id,reason:'SYNTHETIC bypass',occurred_at:await fulfillmentClock(tx,state.order.clock_namespace),tracking_number:resi});
   const [latest]=await tx`select unit_ids from app.manual_tracking where fulfillment_id=${other.id} order by version desc limit 1`;
   await tx`insert into app.manual_tracking (fulfillment_id,version,courier,tracking_number,unit_ids,fulfillment_event_id,actor_id,reason) values (${other.id},3,'jnt',${resi},${JSON.stringify(latest.unit_ids)}::jsonb,${changed.eventId},${f.owner.id},'SYNTHETIC bypass')`;
  }),(error:Error)=>error.message.includes('one live manual parcel per courier'));

  const [job]=await sql`select j.id from app.manual_tracking mt join app.outbox_job j on j.dedup_key='fulfillment-tracking:'||mt.id::text where mt.fulfillment_id=${parcel.id}`;
  tracking.adapter={name:'simulated',track:async()=>{throw new Error('SYNTHETIC adapter outage');}};
  try{assert.equal(await runOneJob(sql,{},job.id),true);}finally{tracking.adapter=simulatedTrackingAdapter;}
  const [failedJob]=await sql`select status,attempts,last_error from app.outbox_job where id=${job.id}`;
  assert.deepEqual({...failedJob},{status:'pending',attempts:1,last_error:'TRACKING_ADAPTER_UNAVAILABLE'});
  assert.equal((await sql`select count(*)::int n from app.shipment_tracking_event where fulfillment_id=${parcel.id}`)[0].n,0);
  // failed = delivery attempt failed: shown to the buyer, parcel stays in the shipped queue, polling continues.
  await simulateTrackingObservation(sql,'test',{courier:'jnt',tracking_number:resi,provider_status:'FAILED'});
  await sql`update app.outbox_job set run_at=clock_timestamp() where id=${job.id}`;assert.equal(await runOneJob(sql,{},job.id),true);
  assert.equal((await sql`select status from app.outbox_job where id=${job.id}`)[0].status,'pending');
  let order=await sql.begin(tx=>projectOrder(tx,f.order.id)),buyerParcel=order.shipments.find(x=>x.id===parcel.shipment_id) as Record<string,unknown>;assert.equal(buyerParcel.tracking_status,'failed');
  assert.ok((await call(f.owner,identity,`/api/v1/admin/manual-shipments?queue=shipped&warehouse_id=${parcel.warehouse_id}&limit=100`)).payload.data.some((p:{id:string})=>p.id===parcel.id));

  // Operator fallback: warehouse staff may record transit/failed, not delivery; reason and evidence required.
  const statusPath=`/api/v1/admin/fulfillments/${parcel.id}/tracking-statuses`,clock=(await sql`select clock from app.local_fixture_namespace where name=${f.namespace}`)[0].clock,occurred=new Date(clock).toISOString();
  const keeper=await actor(identity,'warehouse',[parcel.warehouse_id]);staff.push(keeper);await enroll(keeper.browser,keeper.password);
  assert.equal((await call(keeper,identity,statusPath,{status:'delivered',occurred_at:occurred,reason:'Cek dashboard',evidence:'Terkirim'})).status,403);
  assert.equal((await call(f.owner,identity,statusPath,{status:'delivered',occurred_at:occurred,reason:'Cek dashboard'})).status,400);
  assert.equal((await call(keeper,identity,statusPath,{status:'in_transit',occurred_at:occurred,reason:'Cek dashboard',evidence:'Dalam perjalanan'})).payload.code,'TRACKING_STATUS_NOT_ADVANCING','in transit after failed is not an advance');
  const delivered=await call(f.owner,identity,statusPath,{status:'delivered',occurred_at:occurred,reason:'Dashboard Mengantar: terkirim',evidence:'Status DELIVERED di dashboard, penerima: Ibu'});
  assert.equal(delivered.status,201,JSON.stringify(delivered.payload));assert.equal(delivered.payload.manual.tracking_status,'delivered','delivered is accepted after a failed attempt');
  assert.equal((await sql`select count(*)::int n from app.audit_event where subject_id=${parcel.id} and action='fulfillment.tracking_status'`)[0].n,1);
  const [receipt]=await sql`select j.id from app.shipment_tracking_event t join app.parcel_receipt_provider_event p on p.id=t.receipt_source_id join app.outbox_job j on j.id=p.callback_job_id where t.fulfillment_id=${parcel.id}`;
  await f.run(receipt.id);
  const [units]=await sql`select count(*)::int n from app.fulfillment_item where shipment_id=${parcel.shipment_id}`;
  assert.equal((await sql`select count(*)::int n from app.buyer_receipt b join app.fulfillment_item i on i.id=b.fulfillment_item_id where i.shipment_id=${parcel.shipment_id}`)[0].n,units.n);
  // The buyer receipt anchors the return window (and commission maturity, which reads the same receipt).
  const eligibility=await sql.begin(tx=>projectReturnEligibility(tx,f.order.id));
  const delivered_units=eligibility.data.filter(u=>u.shipment_id===parcel.shipment_id);assert.equal(delivered_units.length,units.n);
  for(const unit of delivered_units){assert.equal(unit.state,'eligible');assert.equal(unit.received_at,occurred);assert.ok(unit.deadline_at);}
  // Correction is refused after delivery, by the application and the database.
  assert.equal((await call(f.owner,identity,`/api/v1/admin/fulfillments/${parcel.id}/tracking-corrections`,{expected_version:delivered.payload.version,courier:'jne',tracking_number:`JX${stamp}99`,reason:'Uji'})).payload.code,'TRACKING_ALREADY_DELIVERED');
  // Later automated observations and a replayed poll write nothing.
  await simulateTrackingObservation(sql,'test',{courier:'jnt',tracking_number:resi,provider_status:'DELIVERED'});
  await sql`update app.outbox_job set run_at=clock_timestamp() where id=${job.id}`;assert.equal(await runOneJob(sql,{},job.id),true);
  assert.equal((await sql`select status from app.outbox_job where id=${job.id}`)[0].status,'completed');
  const before=(await sql`select count(*)::int n from app.shipment_tracking_event where fulfillment_id=${parcel.id}`)[0].n;
  const [firstVersion]=await sql`select id from app.manual_tracking where fulfillment_id=${parcel.id} and version=1`;
  assert.deepEqual(await sql.begin(tx=>processTrackingPoll(tx,{id:randomUUID(),payload:{fulfillmentId:parcel.id,trackingId:String(firstVersion.id)}})),{status:'terminal'});
  assert.equal((await sql`select count(*)::int n from app.shipment_tracking_event where fulfillment_id=${parcel.id}`)[0].n,before);
  assert.equal((await sql`select count(*)::int n from app.shipment_tracking_event where fulfillment_id=${parcel.id} and status='delivered'`)[0].n,1);
  order=await sql.begin(tx=>projectOrder(tx,f.order.id));buyerParcel=order.shipments.find(x=>x.id===parcel.shipment_id) as Record<string,unknown>;assert.equal(buyerParcel.status,'delivered');
  const legacy=await handleFulfillment(f.owner.browser.request(`/api/v1/admin/fulfillments/${parcel.id}`),identity);assert.equal(legacy.status,200);
  // Host-only operator command advances the other parcel's current resi through the simulated feed and its due poll.
  const host=(...args:string[])=>promisify(execFile)(process.execPath,['--env-file=.env.example','scripts/worker.ts','test','--track-parcel',...args],{timeout:15000,maxBuffer:4096});
  await assert.rejects(host(other.id,'in transit'));
  const advanced=await host(other.id,'IN_TRANSIT');assert.match(advanced.stdout,/tracking_status=in_transit/);
  assert.deepEqual((await sql`select status,source_kind from app.shipment_tracking_event where fulfillment_id=${other.id}`).map(r=>({...r})),[{status:'in_transit',source_kind:'adapter'}]);
 }finally{tracking.adapter=simulatedTrackingAdapter;for(const user of staff)await closeFulfillmentActor(f.identity,user).catch(()=>{});await f.close();}
});

test('S99 quoted courier names map to Mengantar codes only when unambiguous',()=>{
 for(const [name,code] of [['JNE','jne'],['J&T','jnt'],['J&T Express','jnt'],['SiCepat','sicepat'],['Ninja Xpress','ninja'],['ID Express','idexpress'],['Lion Parcel','lion'],['POS Indonesia','pos']] as const)assert.equal(quotedCourierCode(name),code,name);
 for(const name of ['Pengiriman simulasi','DHL','',null,42])assert.equal(quotedCourierCode(name),null,String(name));
});

test('S99 booking queue: >100 parcels page completely by packing deadline (nulls last), age, id; booking facts carry the buyer courier and the order_shipment COD due; membership scope and denials hold',{timeout:600000},async()=>{
 // The buyer quotes a named courier through the rate seam (the gated live estimate adapter's slot).
 rateSeam.adapter={estimate:async(request,signal)=>(await localRateAdapter.estimate(request,signal)).map(rate=>({...rate,courier_name:'J&T'}))};
 const staff:Awaited<ReturnType<typeof actor>>[]=[];
 let f:Awaited<ReturnType<typeof fulfillmentFixture>>|undefined;
 try{
  f=await fulfillmentFixture('cod',{calendars:false});const sql=f.identity.sql,identity=f.identity,fixture=f;
  const warehouses=[...new Set(f.parcels.map(p=>String(p.warehouse_id)))];assert.equal(warehouses.length,2);
  for(const position of ['fixture-malang:fixture-shirt','fixture-pontianak:fixture-shirt'])await f.move(position,'receive',120);
  // 40 parcels without a calendar (no resi deadline), then calendars, then 60 parcels with deadlines.
  const place=async(count:number)=>{for(let n=0;n<count;n++){const placed=await fixture.placeOrder(1,'cod');assert.equal(placed.status,201,JSON.stringify(placed));}};
  await place(40);await installFulfillmentCalendars(identity,f.owner,f.namespace);await place(60);

  const admin=await actor(identity,'ecommerce_admin',warehouses);staff.push(admin);await enroll(admin.browser,admin.password);
  const expected=(await sql`select f.id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id left join app.fulfillment_deadline d on d.id=f.deadline_id
   where s.warehouse_id=any(${warehouses}::uuid[]) and f.handover_at is null and f.booking_id is null
   order by d.packing_due_at asc nulls last,f.created_at asc,f.id asc`).map(r=>String(r.id));
  assert.ok(expected.length>100,`seeded ${expected.length} parcels`);
  type QueueRow={id:string;order_id:string;shipment_id:string;packing_due_at:string|null;payment_method:string;items:unknown[];booking:{cod_amount_due:number;cod_fee_amount:number;quoted_courier:{courier_name:string;service_name:string;code:string|null}|null;parcel:{weight_grams:number};destination_area:{city:string;postal_code:string};parcel_items:{quantity:number}[]}};
  const seen:QueueRow[]=[];let cursor:string|null=null,pages=0;
  do{
   const page=await call(admin,identity,`/api/v1/admin/manual-shipments?queue=to_book&limit=25${cursor?`&cursor=${cursor}`:''}`);
   assert.equal(page.status,200,JSON.stringify(page.payload));assert.ok(page.payload.data.length<=25);
   seen.push(...page.payload.data);cursor=page.payload.pagination.next_cursor;pages++;
  }while(cursor&&pages<20);
  assert.equal(cursor,null,'paging terminates');
  assert.deepEqual(seen.map(r=>r.id),expected,'every parcel exactly once, deadline order with nulls last, then age and id');
  const dated=seen.findIndex(r=>r.packing_due_at===null);assert.ok(dated>=60,'deadline parcels first');assert.ok(seen.slice(dated).every(r=>r.packing_due_at===null),'no deadline after the first null');

  // Booking facts: COD due is exactly order_shipment.cod_due (merchandise + buyer shipping + COD fee).
  const stored=new Map((await sql`select id,cod_due,payment_charge,merchandise_amount+buyer_shipping+payment_charge collectible from app.order_shipment where id=any(${seen.map(r=>r.shipment_id)}::uuid[])`).map(r=>[String(r.id),r]));
  for(const row of seen){
   const s=stored.get(row.shipment_id);assert.ok(s);
   assert.equal(row.booking.cod_amount_due,Number(s.cod_due));assert.equal(row.booking.cod_amount_due,Number(s.collectible));assert.equal(row.booking.cod_fee_amount,Number(s.payment_charge));
   assert.deepEqual(row.booking.quoted_courier&&{name:row.booking.quoted_courier.courier_name,code:row.booking.quoted_courier.code},{name:'J&T',code:'jnt'});
   assert.ok(row.booking.parcel.weight_grams>0);assert.equal(row.booking.destination_area.city,'Malang');assert.equal(row.booking.destination_area.postal_code,'00001');
   assert.equal(row.booking.parcel_items.reduce((n,i)=>n+i.quantity,0),row.items.length);
  }

  // Scope: ecommerce_admin is membership-scoped (not company-wide); others refused; cursors are validated.
  const outsider=await actor(identity,'ecommerce_admin',[]);staff.push(outsider);await enroll(outsider.browser,outsider.password);
  const none=await call(outsider,identity,'/api/v1/admin/manual-shipments?queue=to_book&limit=100');assert.equal(none.status,200);
  assert.ok(!none.payload.data.some((r:QueueRow)=>warehouses.includes(String((r as unknown as {warehouse_id:string}).warehouse_id))),'no membership, no rows of these warehouses');
  assert.equal((await call(outsider,identity,`/api/v1/admin/manual-shipments?queue=to_book&warehouse_id=${warehouses[0]}`)).status,404);
  const finance=await actor(identity,'finance',[]);staff.push(finance);await enroll(finance.browser,finance.password);
  assert.equal((await call(finance,identity,'/api/v1/admin/manual-shipments?queue=to_book')).status,403);
  for(const bad of ['not-a-cursor!',Buffer.from(JSON.stringify({d:null,c:'2026-01-01',id:randomUUID()})).toString('base64url'),Buffer.from(JSON.stringify({c:'2026-01-01T00:00:00.000000Z',id:randomUUID()})).toString('base64url')])
   assert.equal((await call(admin,identity,`/api/v1/admin/manual-shipments?queue=to_book&cursor=${encodeURIComponent(bad)}`)).status,400,bad);
 }finally{rateSeam.adapter=localRateAdapter;if(f){for(const user of staff)await closeFulfillmentActor(f.identity,user).catch(()=>{});await f.close();}}
});
