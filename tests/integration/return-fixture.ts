import assert from 'node:assert/strict';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {ingestWaybillEvent,simulateWaybillIssue} from '../../src/modules/fulfillment/local.ts';
import {ingestCodEvent,simulateCodCollection} from '../../src/modules/payments/cod-local.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor,fulfillmentFixture} from './fulfillment-fixture.ts';

// Real predecessor checkout, collection, physical handover and auth writers.
// No S31 table, invented delivered flag or manually funded balance is seeded.
export async function returnFixture(method:'cod'|'prepaid'){
 const f=await fulfillmentFixture(method);let finance:Awaited<ReturnType<typeof actor>>|undefined;
 try{
  finance=await actor(f.identity,'finance',[]);await enroll(finance.browser,finance.password);
  await f.identity.sql`update app.role_grant set permissions=${['finance.refunds.read','finance.refunds.write']},revision=revision+1 where user_id=${finance.id}`;
  const bookings=[];
  for(const parcel of f.parcels){
   const booking=await f.book(parcel),root=`/api/v1/admin/fulfillments/${parcel.id}`;bookings.push(booking);
   await f.run(booking.creation_job_id);
   for(const callback of await f.identity.sql`select callback_job_id from app.waybill_provider_event where booking_id=${booking.id}`)await f.run(callback.callback_job_id);
   await f.run(await ingestWaybillEvent(f.identity.sql,await simulateWaybillIssue(f.identity.sql,'test',booking.id)));
   assert.equal((await f.fulfillmentCall(`${root}/packing`,{expected_version:4})).response.status,201);
   assert.equal((await f.fulfillmentCall(`${root}/handover`,{expected_version:5,shipment_id:parcel.shipment_id,handover_reference:'SYNTHETIC original return-fixture handover'})).response.status,201);
   if(method==='cod')await f.run(await ingestCodEvent(f.identity.sql,await simulateCodCollection(f.identity.sql,'test',parcel.shipment_id)));
  }
  const principal=await getPrincipal(finance.browser.request('/api/v1/me'),f.identity),units=await f.identity.sql`select f.* from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${f.order.id} order by f.id`;
  assert.equal(units.length,4);
  const financeActor=finance;
  return {...f,finance:financeActor,financePrincipal:principal,bookings,units,close:async()=>{try{await closeFulfillmentActor(f.identity,financeActor);}finally{await f.close();}}};
 }catch(error){try{if(finance)await closeFulfillmentActor(f.identity,finance);}finally{await f.close();}throw error;}
}
