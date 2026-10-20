import assert from 'node:assert/strict';
import test from 'node:test';
import {handlePayments} from '../../src/modules/payments/routes.ts';
import {CommerceClient} from './checkout-fixture.ts';
import {paymentFixture} from './payment-fixture.ts';

test('staff sessions never bypass buyer payment ownership and header mode uses only its issued order capability',async()=>{
 const f=await paymentFixture();try{
  const owned=await f.order(),path=`/api/v1/orders/${owned.order.id}/payment-attempts`,staff=new CommerceClient(f.identity);
  for(const [name,value] of f.owner.browser.cookies) staff.cookies.set(`${name}:/`,{name,value,path:'/'});
  assert.equal((await f.call(staff,path,{method_id:'local-prepaid'})).response.status,404);
  assert.equal((await f.call(owned.client,path,{method_id:'local-prepaid'},{headers:{authorization:'Bearer unissued'}})).response.status,401);
  const client=new CommerceClient(f.identity),input={lines:[f.line()],access_transport:'header'};
  assert.equal((await client.call('/api/v1/carts',input)).response.status,401);const cart=await client.call('/api/v1/carts',input);assert.equal(cart.response.status,201);
  const headers={'x-cart-token':cart.payload.cart_access_token};assert.equal(typeof headers['x-cart-token'],'string');
  const quote=await client.call('/api/v1/checkout/quotes',{cart_id:cart.payload.cart.id,address:f.address,contact:f.contact(),payment_method:'prepaid'},{version:1,headers});assert.equal(quote.response.status,201);
  const order=await client.call('/api/v1/orders',{quote_id:quote.payload.id},{version:1,headers});assert.equal(order.response.status,201);
  const token=order.payload.guest_order_access_token;assert.equal(typeof token,'string');const paymentPath=`/api/v1/orders/${order.payload.order.id}/payment-attempts`;
  const attempt=await f.call(client,paymentPath,{method_id:'local-prepaid'},{anonymous:true,headers:{'x-order-token':token}});assert.equal(attempt.response.status,201);
  assert.equal((await f.call(client,`${paymentPath}/${attempt.payload.id}`,undefined,{anonymous:true,headers:{'x-order-token':token}})).response.status,200);
  assert.equal((await f.call(client,paymentPath,{method_id:'local-prepaid'},{anonymous:true,headers})).response.status,401);
  const response=await handlePayments(client.request(`${paymentPath}/${attempt.payload.id}`,undefined,{anonymous:true}),f.identity);assert.equal(response.status,401);
 }finally{await f.close();}
});
