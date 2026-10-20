import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {handleFulfillment} from '../../src/modules/fulfillment/routes.ts';
import {simulateWaybillIssue,ingestWaybillEvent} from '../../src/modules/fulfillment/local.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {fulfillmentFixture} from './fulfillment-fixture.ts';

test('app-role fulfillment wire preserves assigned parcel scope, current MFA and all eight operation contracts',async()=>{
 const f=await fulfillmentFixture(),samples:Exchange[]=[],staff=await actor(f.identity,'warehouse',[]);
 const observe=async(path:string,body:Record<string,unknown>|undefined,expected:number,browser:{request(path:string,body?:Record<string,unknown>):Request}=f.owner.browser,options:{headers?:Record<string,string>;valid?:boolean}={})=>{
  const request=browser.request(path,body),key=randomUUID();if(body!==undefined)request.headers.set('idempotency-key',key);for(const [name,value] of Object.entries(options.headers??{}))request.headers.set(name,value);
  const response=await handleFulfillment(request,f.identity),payload=await response.json();assert.equal(response.status,expected,`Observed ${path}: ${payload.code??'success'}`);
  samples.push({url:request.url,method:request.method,request_headers:{'content-type':'application/json',...(body!==undefined?{'idempotency-key':key}:{})},...(body!==undefined?{request_body:JSON.stringify(body),body_bytes:Buffer.byteLength(JSON.stringify(body))}:{}),request_valid:options.valid??true,status:response.status,headers:Object.fromEntries(response.headers),payload});return payload;
 };
 try{
  assert.equal((await f.identity.sql`select current_user role`)[0].role,'99ribu_test_app');
  const parcel=f.parcels[0],root=`/api/v1/admin/fulfillments/${parcel.id}`,shipment=`/api/v1/admin/shipments/${parcel.shipment_id}`;
  const endpoints:[string,Record<string,unknown>|undefined][]=[['/api/v1/admin/fulfillments',undefined],[root,undefined],[shipment,undefined],[`${root}/preparations`,{expected_version:1}],['/api/v1/admin/shipments',{fulfillment_id:parcel.id,expected_version:2}],[`${root}/packing`,{expected_version:4}],[`${root}/handover`,{expected_version:5,shipment_id:parcel.shipment_id,handover_reference:'SYNTHETIC handover'}],[`${root}/reschedules`,{expected_version:3,reason:'Private operations detail',buyer_explanation:'Jadwal paket diperbarui.'}]];
  const anonymous={request:(path:string,body?:unknown)=>new Request(`http://127.0.0.1:3099${path}`,{method:body===undefined?'GET':'POST',headers:{origin:'http://127.0.0.1:3099','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})};
  for(const [path,body] of endpoints)await observe(path,body,401,anonymous);
  const listed=await observe(`/api/v1/admin/fulfillments?warehouse_id=${parcel.warehouse_id}&limit=1`,undefined,200);assert.ok(listed.data.every((p:{warehouse_id:string})=>p.warehouse_id===parcel.warehouse_id));
  await observe(root,undefined,200);await observe(shipment,undefined,200);
  await observe(`${root}/packing`,{expected_version:1},409);await observe(`${root}?paid=true`,undefined,400,f.owner.browser,{valid:false});await observe(root,undefined,401,f.owner.browser,{headers:{authorization:'Bearer unsupported'}});
  await observe(root,undefined,403,f.owner.browser,{headers:{host:'foreign.invalid'}});
  await observe(`${root}/preparations`,{expected_version:1,paid:true},400,f.owner.browser,{valid:false});
  let current=await observe(`${root}/preparations`,{expected_version:1},201);assert.equal(current.status,'picking');
  const booked=await observe('/api/v1/admin/shipments',{fulfillment_id:parcel.id,expected_version:2},202);assert.equal(booked.status_url,shipment);
  const [booking]=await f.identity.sql`select creation_job_id from app.shipment_booking where id=${booked.operation_id}`;await f.run(booking.creation_job_id);
  for(const callback of await f.identity.sql`select callback_job_id from app.waybill_provider_event where booking_id=${booked.operation_id}`)await f.run(callback.callback_job_id);
  assert.equal((await observe(shipment,undefined,200)).status,'booked');assert.equal((await observe(root,undefined,200)).tracking_number,null);
  const privateReason=`PRIVATE ${randomUUID()}`,explanation='Jadwal paket diperbarui.';
  current=await observe(`${root}/reschedules`,{expected_version:3,reason:privateReason,buyer_explanation:explanation},201);assert.equal(current.version,4);
  await f.run(await ingestWaybillEvent(f.identity.sql,await simulateWaybillIssue(f.identity.sql,'test',booked.operation_id)));
  current=await observe(`${root}/packing`,{expected_version:5},201);assert.equal(current.status,'handover_pending');
  const handed=await observe(`${root}/handover`,{expected_version:6,shipment_id:parcel.shipment_id,handover_reference:'SYNTHETIC handover'},201);assert.equal(handed.status,'handed_over');assert.ok(!JSON.stringify(handed).includes(privateReason));
  assert.equal((await observe(shipment,undefined,200)).status,'handed_over');
  await enroll(staff.browser,staff.password);await f.identity.sql`insert into app.warehouse_membership (user_id,warehouse_id) values (${staff.id},${parcel.warehouse_id})`;
  await observe(root,undefined,200,staff.browser);await observe(`/api/v1/admin/fulfillments/${f.parcels[1].id}`,undefined,404,staff.browser);await observe(`/api/v1/admin/shipments/${booked.operation_id}`,undefined,404,staff.browser);
  const scoped=await observe('/api/v1/admin/fulfillments',undefined,200,staff.browser);assert.ok(scoped.data.every((p:{warehouse_id:string})=>p.warehouse_id===parcel.warehouse_id));
  await f.identity.sql`delete from app.warehouse_membership where user_id=${staff.id}`;await observe(root,undefined,404,staff.browser);
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id=${f.order.id}`)[0].n,0);validateExchanges(samples,'fulfillment');
 }finally{await cleanup(f.identity,[staff]);await f.close();}
});
