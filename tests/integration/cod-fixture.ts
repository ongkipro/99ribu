import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {CommerceClient} from './checkout-fixture.ts';
import {advertisingFixture} from './advertising-fixture.ts';
import {handleCodCollections} from '../../src/modules/payments/cod-routes.ts';
import {simulateCodCollection,ingestCodEvent} from '../../src/modules/payments/cod-local.ts';
import {runOneJob} from '../../src/jobs/worker.ts';

export async function codFixture(){
 const f=await advertisingFixture();
 const order=async(client:CommerceClient,quantity=4)=>{
  const input={lines:[f.line('fixture-offer-shirt',quantity)]},key=randomUUID();let cart=await client.call('/api/v1/carts',input,{key});if(cart.response.status===401)cart=await client.call('/api/v1/carts',input,{key});assert.equal(cart.response.status,201);
  const quote=await client.call('/api/v1/checkout/quotes',{cart_id:cart.payload.cart.id,address:f.address,contact:f.contact(),payment_method:'cod'},{version:1});assert.equal(quote.response.status,201);
  const submitted=await client.call('/api/v1/orders',{quote_id:quote.payload.id},{version:1});assert.equal(submitted.response.status,201);assert.equal(submitted.payload.order.payment_status,'cod_due');return submitted.payload.order;
 };
 const collections=async(client:CommerceClient,orderId:string)=>{const response=await handleCodCollections(client.request(`/api/v1/orders/${orderId}/cod-collections`),f.identity);return {response,payload:await response.json()};};
 const collect=async(shipmentId:string,input:Parameters<typeof simulateCodCollection>[3]={})=>{const event=await simulateCodCollection(f.identity.sql,'test',shipmentId,input),job=await ingestCodEvent(f.identity.sql,event);assert.equal(await runOneJob(f.identity.sql,{},job),true);assert.equal((await f.identity.sql`select status from app.outbox_job where id=${job}`)[0].status,'completed');return {event,job};};
 return {...f,order,collections,collect};
}
