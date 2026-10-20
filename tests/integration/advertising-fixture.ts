import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleSignals} from '../../src/modules/advertising/routes.ts';
import {handlePayments} from '../../src/modules/payments/routes.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {ingestProviderEvent,simulateCollection} from '../../src/modules/payments/local.ts';
import {parseChoices,type Choices} from '../../src/modules/consent/choices.ts';
import {checkoutFixture,type CommerceClient} from './checkout-fixture.ts';

export const grantedChoices=parseChoices({analytics:'granted',advertising_measurement:'granted',marketing:'denied',meta:'granted',google:'granted',tiktok:'granted',google_signals:{ad_storage:'denied',analytics_storage:'granted',ad_user_data:'denied',ad_personalization:'denied'}});
export const deniedChoices=parseChoices({...grantedChoices,analytics:'denied',advertising_measurement:'denied',meta:'denied',google:'denied',tiktok:'denied'});
export async function advertisingFixture(){
 const f=await checkoutFixture();
 const signals=async(client:CommerceClient,path:string,body?:unknown,options:Parameters<CommerceClient['request']>[2]={})=>{
  const request=client.request(path,body,options),response=await handleSignals(request,f.identity);client.absorb(response);return {request,response,payload:await response.json()};
 };
 const consent=async(client:CommerceClient,choices:Choices=grantedChoices,version=0)=>{
  if(version===0){const body={client_request_id:randomUUID()},key=randomUUID();const first=await signals(client,'/api/v1/visitor-sessions',body,{key});assert.ok([201,401].includes(first.response.status));if(first.response.status===401) assert.equal((await signals(client,'/api/v1/visitor-sessions',body,{key})).response.status,201);}
  const result=await signals(client,'/api/v1/consent/receipt',{expected_version:version,policy_version:'local-privacy-v1',choices});assert.equal(result.response.status,201);return result.payload;
 };
 const order=async(client:CommerceClient)=>{
  // Wall-clock order: consent and actual provider occurrence share real time.
  const input={lines:[f.line()]},key=randomUUID();let cart=await client.call('/api/v1/carts',input,{key});if(cart.response.status===401)cart=await client.call('/api/v1/carts',input,{key});assert.equal(cart.response.status,201);
  const quote=await client.call('/api/v1/checkout/quotes',{cart_id:cart.payload.cart.id,address:f.address,contact:f.contact(),payment_method:'prepaid'},{version:1});assert.equal(quote.response.status,201);
  const submitted=await client.call('/api/v1/orders',{quote_id:quote.payload.id},{version:1});assert.equal(submitted.response.status,201);return submitted.payload.order;
 };
 const pay=async(client:CommerceClient,orderId:string)=>{
  const response=await handlePayments(client.request(`/api/v1/orders/${orderId}/payment-attempts`,{method_id:'local-prepaid'}),f.identity);assert.equal(response.status,201);const attempt=await response.json();
  const [stored]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`;
  assert.equal(await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},stored.creation_job_id),true);
  const event=await simulateCollection(f.identity.sql,'test',attempt.id),job=await ingestProviderEvent(f.identity.sql,event);
  return {attempt,event,job,complete:()=>runOneJob(f.identity.sql,{},job)};
 };
 return {...f,signals,consent,order,pay};
}
