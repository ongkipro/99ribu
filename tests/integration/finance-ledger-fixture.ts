import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {checkoutFixture,CommerceClient} from './checkout-fixture.ts';
import {commerceActor,capability,prefix} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {expireOwnedOrderJob} from '../../src/modules/checkout/expiry.ts';
import {readFixtureClock,advanceFixtureClock} from '../../src/modules/local/fixtures.ts';

export async function financeFixture(){
 const f=await checkoutFixture(),orders:string[]=[];
 const order=async(payment_method:'prepaid'|'cod'='prepaid',quantity=1)=>{
  const client=new CommerceClient(f.identity),input={lines:[f.line('fixture-offer-shirt',quantity)]},key=randomUUID();
  assert.equal((await client.call('/api/v1/carts',input,{key})).response.status,401);
  const request=client.request('/api/v1/carts',input,{key}),actor=await commerceActor(request,f.identity);assert.ok(actor?.kind==='guest');
  const result=await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,actor,input,{clock_namespace:f.namespace}));
  const name=`${await prefix(f.identity)}.cart_access`,token=await capability(f.identity,'cart',result.cart.id,actor.id,result.cart.cap_issued_at as string);
  client.cookies.set(`${name}:/`,{name,value:`${result.cart.id}.${token}`,path:'/'});
  const quoted=await client.call('/api/v1/checkout/quotes',{cart_id:result.cart.id,address:f.address,contact:f.contact(),payment_method},{version:1});assert.equal(quoted.response.status,201);
  const submitted=await client.call('/api/v1/orders',{quote_id:quoted.payload.id},{version:1});assert.equal(submitted.response.status,201);orders.push(submitted.payload.order.id);return submitted.payload.order;
 };
 const close=async()=>{
  try{if(orders.length){const clock=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,clock.version);
   for(const orderId of orders){const [job]=await f.identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${orderId}`;
    assert.ok(job);await f.identity.sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));}
  }}finally{await f.close();}
 };
 return {...f,order,close};
}
