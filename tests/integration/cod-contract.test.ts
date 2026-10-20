import assert from 'node:assert/strict';
import test from 'node:test';
import {handleCodCollections} from '../../src/modules/payments/cod-routes.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {actor} from '../contract/access-fixture.ts';
import {CommerceClient} from './checkout-fixture.ts';
import {codFixture} from './cod-fixture.ts';

test('COD read wire parity uses real guest/order, account and issued header scope; purpose/foreign/forged queries grant no money or private data',async()=>{
 const f=await codFixture(),buyer=await actor(f.identity,'buyer',[]),samples:Exchange[]=[];
 const observe=async(client:CommerceClient,path:string,expected:number,options:Parameters<CommerceClient['request']>[2]={},valid=true)=>{
  const request=client.request(path,undefined,options),response=await handleCodCollections(request,f.identity),payload=await response.json();assert.equal(response.status,expected);
  samples.push({url:request.url,method:request.method,request_headers:{'content-type':'application/json'},request_valid:valid,status:response.status,headers:Object.fromEntries(response.headers),payload});return payload;
 };
 try{
  const order=await f.order(f.client,1),path=`/api/v1/orders/${order.id}/cod-collections`,anonymous=new CommerceClient(f.identity);const current=await observe(f.client,path,200);assert.equal(current.collected_total,0);assert.ok(current.parcels.every((p:{status:string})=>p.status==='due'));
  await observe(anonymous,path,401);await observe(f.client,path,401,{headers:{'x-cart-token':'not-issued'}});await observe(f.client,path,401,{headers:{authorization:'Bearer not-issued'}});
  await observe(f.client,`${path}?paid=true`,400,{},false);await observe(f.client,path,403,{headers:{host:'foreign.invalid'}});
  const visitorOnly=new CommerceClient(f.identity);await f.consent(visitorOnly);await observe(visitorOnly,path,401);
  const cartOnly=new CommerceClient(f.identity);assert.equal((await cartOnly.call('/api/v1/carts',{})).response.status,401);assert.equal((await cartOnly.call('/api/v1/carts',{})).response.status,201);
  for(const [key,cookie] of f.client.cookies)if(cookie.name.endsWith('.order_access'))cartOnly.cookies.set(key,cookie);await observe(cartOnly,path,401);
  assert.equal((await f.client.auth('/sign-in/email',{email:buyer.email,password:buyer.password})).status,200);await observe(f.client,path,404);
  const owned=await f.order(f.client,1);await observe(f.client,`/api/v1/orders/${owned.id}/cod-collections`,200);
  assert.equal((await f.client.auth('/sign-out',{})).status,200);await observe(f.client,`/api/v1/orders/${owned.id}/cod-collections`,401);
  const headerClient=new CommerceClient(f.identity),input={access_transport:'header',lines:[f.line()]};assert.equal((await headerClient.call('/api/v1/carts',input)).response.status,401);const created=await headerClient.call('/api/v1/carts',input);assert.equal(created.response.status,201);
  const headers={'x-cart-token':created.payload.cart_access_token},quote=await headerClient.call('/api/v1/checkout/quotes',{cart_id:created.payload.cart.id,address:f.address,contact:f.contact(),payment_method:'cod'},{version:1,headers});assert.equal(quote.response.status,201);
  const submitted=await headerClient.call('/api/v1/orders',{quote_id:quote.payload.id},{version:1,headers});assert.equal(submitted.response.status,201);const headerPath=`/api/v1/orders/${submitted.payload.order.id}/cod-collections`;
  await observe(anonymous,headerPath,200,{headers:{'x-order-token':submitted.payload.guest_order_access_token}});await observe(anonymous,headerPath,401,{headers:{'x-order-token':created.payload.cart_access_token}});
  assert.equal((await f.identity.sql`select count(*)::int n from app.economic_receipt where order_id in (${order.id},${owned.id},${submitted.payload.order.id})`)[0].n,0);
  validateExchanges(samples,'cod');
 }finally{
  // Immutable account-owned orders retain the synthetic principal. End its
  // sessions/grant; deleting it would violate the real order ownership FK.
  await f.identity.sql`delete from app.auth_session where user_id=${buyer.id}`;await f.identity.sql`delete from app.role_grant where user_id=${buyer.id}`;await f.close();
 }
});
