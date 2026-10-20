import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {checkoutFixture,CommerceClient} from './checkout-fixture.ts';

test('twelve checkout operations have real success/denial parity and committed browser retry without plaintext credentials',async()=>{
 const f=await checkoutFixture();const samples:Exchange[]=[];const guest=new CommerceClient(f.identity);
 const observe=async(client:CommerceClient,path:string,expected:number,body?:unknown,options:Parameters<CommerceClient['call']>[2]={},valid?:boolean)=>{
  const result=await client.call(path,body,options);assert.equal(result.response.status,expected);
  const {cart_access_token:cartToken,guest_order_access_token:orderToken,...safe}=result.payload;
  assert.ok(cartToken===undefined&&orderToken===undefined);
  samples.push({url:result.request.url,method:result.request.method,request_headers:Object.fromEntries([...result.request.headers].filter(([k])=>['content-type','idempotency-key','if-match'].includes(k))),request_body:body!==undefined?JSON.stringify(body):undefined,body_bytes:body!==undefined?Buffer.byteLength(JSON.stringify(body)):undefined,request_valid:valid,
   status:result.response.status,headers:Object.fromEntries([...result.response.headers].filter(([k])=>['content-type','cache-control','referrer-policy','x-content-type-options','retry-after'].includes(k))),payload:safe});return result.payload;
 };
 try{
  const start=randomUUID(),initial={lines:[]};const [before]=await f.identity.sql`select count(*)::int n from app.cart`;
  await observe(f.client,'/api/v1/carts',401,initial,{key:start},true);const [after]=await f.identity.sql`select count(*)::int n from app.cart`;assert.equal(after.n,before.n);
  let cart=(await observe(f.client,'/api/v1/carts',201,initial,{key:start},true)).cart;assert.equal((await observe(f.client,'/api/v1/carts',201,initial,{key:start},true)).cart.id,cart.id);
  await observe(f.client,`/api/v1/carts/${cart.id}`,200,undefined,{},true);await observe(f.client,'/api/v1/carts/current',200,undefined,{},true);
  await observe(guest,`/api/v1/carts/${cart.id}`,401);await observe(guest,'/api/v1/carts/current',401);
  cart=await observe(f.client,`/api/v1/carts/${cart.id}/lines`,201,f.line(),{version:cart.version},true);
  await observe(guest,`/api/v1/carts/${cart.id}/lines`,401,f.line(),{version:1},true);
  const lineId=cart.lines[0].id;
  cart=await observe(f.client,`/api/v1/carts/${cart.id}/lines/${lineId}`,200,{quantity:2,expected_version:cart.version},{method:'PATCH'},true);
  await observe(guest,`/api/v1/carts/${cart.id}/lines/${lineId}`,401,{quantity:1,expected_version:1},{method:'PATCH'},true);
  cart=await observe(f.client,`/api/v1/carts/${cart.id}/lines`,201,f.line('fixture-offer-cream-pack'),{version:cart.version},true);const extra=cart.lines.find((l:{id:string})=>l.id!==lineId);
  cart=await observe(f.client,`/api/v1/carts/${cart.id}/lines/${extra.id}`,200,undefined,{method:'DELETE',version:cart.version},true);
  await observe(guest,`/api/v1/carts/${cart.id}/lines/${lineId}`,401,undefined,{method:'DELETE',version:1},true);
  const quoteBody={cart_id:cart.id,address:f.address,contact:f.contact(),payment_method:'cod'};
  const quote=await observe(f.client,'/api/v1/checkout/quotes',201,quoteBody,{version:cart.version},true);
  assert.equal(quote.merchandise_total,198000);assert.equal(quote.buyer_total,quote.merchandise_total+quote.shipping_total-quote.subsidy_total);
  await observe(guest,'/api/v1/checkout/quotes',401,quoteBody,{version:cart.version},true);
  await observe(f.client,`/api/v1/checkout/quotes/${quote.id}`,200,undefined,{},true);await observe(guest,`/api/v1/checkout/quotes/${quote.id}`,401);
  const selection={packages:quote.packages.map((p:{id:string;selected_option_id:string})=>({package_id:p.id,shipping_option_id:p.selected_option_id}))};
  const selected=await observe(f.client,`/api/v1/checkout/quotes/${quote.id}/selection`,201,selection,{version:cart.version},true);assert.equal(selected.expires_at,quote.expires_at);
  await observe(guest,`/api/v1/checkout/quotes/${quote.id}/selection`,401,selection,{version:cart.version},true);
  const orderBody={quote_id:selected.id},orderKey=randomUUID();const created=await observe(f.client,'/api/v1/orders',201,orderBody,{key:orderKey,version:cart.version},true);
  const replay=await observe(f.client,'/api/v1/orders',201,orderBody,{key:orderKey,version:cart.version},true);assert.equal(replay.order.id,created.order.id);
  await observe(guest,'/api/v1/orders',401,orderBody,{version:cart.version},true);await observe(f.client,'/api/v1/orders',409,orderBody,{version:cart.version},true);
  await observe(f.client,`/api/v1/orders/${created.order.id}`,200,undefined,{},true);await observe(guest,`/api/v1/orders/${created.order.id}`,401);
  await observe(f.client,'/api/v1/carts/current',200,undefined,{},true);
  await observe(guest,'/api/v1/destinations?q=synthetic',200,undefined,{},true);await observe(guest,'/api/v1/destinations',400,undefined,{},false);
  validateExchanges(samples,'checkout');
 }finally{await f.close();}
});
