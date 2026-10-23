import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {LocalAuth} from '../../src/modules/access/auth.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {handleFulfillment} from '../../src/modules/fulfillment/routes.ts';
import {shippingAdapter} from '../../src/modules/fulfillment/worker.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {simulateCollection,ingestProviderEvent} from '../../src/modules/payments/local.ts';
import {createAttempt} from '../../src/modules/payments/attempts.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {releaseReservation} from '../../src/modules/inventory/reservations.ts';
import {expireOwnedOrderJob} from '../../src/modules/checkout/expiry.ts';
import {readFixtureClock,advanceFixtureClock} from '../../src/modules/local/fixtures.ts';
import {cleanup,type actor} from '../contract/access-fixture.ts';
import {paymentFixture} from './payment-fixture.ts';
import {ownShippingCampaign} from './checkout-fixture.ts';

export async function closeFulfillmentActor(identity:LocalAuth,user:{id:string;email:string}){
 // Booking history retains AccessOperation. End the synthetic principal's
 // authority without deleting its referenced immutable operations.
 await identity.sql.begin(async tx=>{
  await tx`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${user.email})`;
  await tx`delete from app.local_delivery where recipient=${user.email}`;
  await tx`delete from app.auth_verification where value=${user.id}`;
  await tx`delete from app.auth_session where user_id=${user.id}`;
  await tx`delete from app.role_grant where user_id=${user.id}`;
  await tx`delete from app.warehouse_membership where user_id=${user.id}`;
  await tx`delete from app.auth_rate_limit where key in (${`access-proof:${user.id}`},${`history-reference:${user.id}`})`;
 });
 await cleanup(identity,[]);
}

export async function installFulfillmentCalendars(identity:LocalAuth,owner:Awaited<ReturnType<typeof actor>>,namespace:string){
 const warehouses=await identity.sql`select w.id,w.timezone,extract(year from (greatest(n.clock,clock_timestamp()) at time zone w.timezone))::int calendar_year from app.warehouse w join app.local_fixture_warehouse fixture on fixture.warehouse_id=w.id join app.local_fixture_namespace n on n.name=fixture.namespace where fixture.namespace=${namespace} order by w.id`;
 for(const warehouse of warehouses){
  const proofRequest=owner.browser.request('/api/v1/me/reauthentication-proofs',{password:owner.password,action:'warehouse_calendar.version',subject_id:warehouse.id});proofRequest.headers.set('idempotency-key',randomUUID());
  const proof=await handleAccess(proofRequest,identity);assert.equal(proof.status,201);
  const request=owner.browser.request('/api/v1/admin/policy-versions',{kind:'warehouse_calendar',warehouse_id:warehouse.id,effective_at:null,expected_version:0,values:{timezone:warehouse.timezone,year:warehouse.calendar_year,working_weekdays:[0,1,2,3,4,5,6],cutoff_local:'23:59',closed_dates:[],source:'TEST-ONLY',approval:'test_only'},reason:'SYNTHETIC owned fulfillment calendar',reauthentication_proof:(await proof.json()).proof});request.headers.set('idempotency-key',randomUUID());assert.equal((await handleAccess(request,identity)).status,201);
 }
 await identity.sql`update app.local_fixture_namespace set clock=greatest(clock,clock_timestamp())+interval '2 seconds',revision=revision+1 where name=${namespace}`;
}
export async function fulfillmentFixture(method:'cod'|'prepaid'='cod',{calendars=true}:{calendars?:boolean}={}){
 const f=await paymentFixture();let campaign:Awaited<ReturnType<typeof ownShippingCampaign>>|undefined;
 try{
  campaign=await ownShippingCampaign(f,[method]);if(calendars)await installFulfillmentCalendars(f.identity,f.owner,f.namespace);
  const {client,order}=await f.order(4,method),sql=f.identity.sql;
  const run=async(jobId:string)=>{assert.equal(await runOneJob(sql,{'shipping.create':shippingAdapter(sql,'test'),'payment.create':paymentAdapter(sql,'test')},jobId),true);const [job]=await sql`select status,last_error from app.outbox_job where id=${jobId}`;assert.equal(job.status,'completed',`Owned fulfillment job: ${job.last_error??'no error'}`);};
  if(method==='prepaid'){
   const attempt=await sql.begin(tx=>createAttempt(tx,order.id,randomUUID(),{method_id:'local-prepaid'})),[stored]=await sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`;await run(stored.creation_job_id);await run(await ingestProviderEvent(sql,await simulateCollection(sql,'test',attempt.id)));
  }
  const parcels=await sql`select f.*,s.warehouse_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${order.id} order by s.id`;assert.equal(parcels.length,2);
  const call=async(path:string,body?:Record<string,unknown>,key=randomUUID())=>{const request=f.owner.browser.request(path,body);if(body!==undefined)request.headers.set('idempotency-key',key);const response=await handleFulfillment(request,f.identity);return {request,response,payload:await response.json()};};
  const book=async(parcel=parcels[0])=>{
   const prepared=await call(`/api/v1/admin/fulfillments/${parcel.id}/preparations`,{expected_version:1});assert.equal(prepared.response.status,201);
   const booked=await call('/api/v1/admin/shipments',{fulfillment_id:parcel.id,expected_version:2});assert.equal(booked.response.status,202);
   const [booking]=await sql`select * from app.shipment_booking where id=${booked.payload.operation_id}`;return booking;
  };
  const close=async()=>{
   try{
    await campaign?.close();const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
    const [expiry]=await sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;
    if(expiry)await sql.begin(tx=>expireOwnedOrderJob(tx,{id:expiry.id,kind:expiry.kind,payload:expiry.payload}));
    for(const reservation of Object.values(f.seeded.reservations)){await sql.begin(tx=>releaseReservation(tx,reservation,'SYNTHETIC fulfillment fixture finished'));await sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${reservation}`;}
   }finally{try{await closeFulfillmentActor(f.identity,f.owner);}finally{await sql.end();}}
  };
  return {...f,placeOrder:f.order,client,order,parcels,run,fulfillmentCall:call,book,close};
 }catch(error){try{await campaign?.close();}finally{await f.close();}throw error;}
}
