import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import test from 'node:test';
import {actor,cleanup} from '../contract/access-fixture.ts';
import {capability,digest,prefix} from '../../src/modules/checkout/access.ts';
import {checkoutFixture,CommerceClient} from './checkout-fixture.ts';

async function cart(client:CommerceClient,body:unknown){const key=randomUUID();assert.equal((await client.call('/api/v1/carts',body,{key})).response.status,401);const r=await client.call('/api/v1/carts',body,{key});assert.equal(r.response.status,201);return r.payload;}

test('header capabilities are purpose-scoped; current guest context, login/logout revocation and real expiry are enforced',async()=>{
 const f=await checkoutFixture();let buyer:Awaited<ReturnType<typeof actor>>|undefined;
 try{
  const created=await cart(f.client,{access_transport:'header',lines:[f.line()]});const c=created.cart;const token=created.cart_access_token;
  assert.ok(typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token));const headers={'x-cart-token':token};
  assert.equal((await f.client.call(`/api/v1/carts/${c.id}`,undefined,{headers})).response.status,200);
  assert.equal((await f.client.call(`/api/v1/carts/${c.id}`)).response.status,401);
  const other=new CommerceClient(f.identity);await cart(other,{});
  assert.equal((await other.call(`/api/v1/carts/${c.id}`,undefined,{headers})).response.status,404);
  const quoted=await f.client.call('/api/v1/checkout/quotes',{cart_id:c.id,address:f.address,contact:f.contact(),payment_method:'prepaid'},{version:1,headers});assert.equal(quoted.response.status,201);
  const key=randomUUID(),body={quote_id:quoted.payload.id};const submitted=await f.client.call('/api/v1/orders',body,{key,version:1,headers});assert.equal(submitted.response.status,201);const orderToken=submitted.payload.guest_order_access_token;assert.ok(typeof orderToken==='string'&&/^[A-Za-z0-9_-]{43}$/.test(orderToken));
  const independent=new CommerceClient(f.identity),orderPath=`/api/v1/orders/${submitted.payload.order.id}`;
  assert.equal((await independent.call(orderPath,undefined,{headers:{'x-order-token':orderToken}})).response.status,200);
  assert.equal((await independent.call(orderPath,undefined,{headers:{'x-order-token':token}})).response.status,401);
  assert.equal((await independent.call(orderPath,undefined,{headers:{'x-cart-token':token}})).response.status,401);
  assert.equal((await f.client.call('/api/v1/orders',{...body,buyer_note:'Changed intent'},{key,version:1,headers})).response.status,409);
  buyer=await actor(f.identity,'buyer',[]);assert.equal((await f.client.auth('/sign-in/email',{email:buyer.email,password:buyer.password})).status,200);
  assert.equal((await f.client.call(`/api/v1/carts/${c.id}`)).response.status,404);
  assert.equal((await f.client.call(orderPath,undefined,{headers:{'x-order-token':orderToken}})).response.status,401);
  assert.equal((await independent.call(orderPath,undefined,{headers:{'x-order-token':orderToken}})).response.status,401);
  assert.equal((await f.client.auth('/sign-out',{})).status,200);
  assert.equal((await f.client.call('/api/v1/orders',body,{key,version:1,headers})).response.status,401);
  const p=await prefix(f.identity),expired=new CommerceClient(f.identity),expiredToken=randomBytes(32).toString('base64url');
  await f.identity.sql`insert into app.commerce_guest_context (digest,created_at,expires_at) values (${digest(expiredToken)},clock_timestamp()-interval '8 days',clock_timestamp()-interval '2 days')`;
  expired.cookies.set('expired',{name:`${p}.commerce_guest`,value:expiredToken,path:'/'});
  assert.equal((await expired.call('/api/v1/carts',{})).response.status,401);
  const current=new CommerceClient(f.identity);await cart(current,{});const currentToken=[...current.cookies.values()].find(c=>c.name===`${p}.commerce_guest`)?.value;
  const [guest]=await f.identity.sql`select id from app.commerce_guest_context where digest=${digest(currentToken as string)}`;
  const expiredCartId=randomUUID(),issued=new Date(Date.now()-8*86400000).toISOString();const expiredCap=await capability(f.identity,'cart',expiredCartId,guest.id,issued);
  await f.identity.sql`insert into app.cart (id,owner_guest_id,transport,cap_digest,cap_issued_at,cap_expires_at,created_at,expires_at) select ${expiredCartId},${guest.id},'browser',${digest(expiredCap)},${issued},${new Date(Date.parse(issued)+7*86400000).toISOString()},t,t+interval '7 days' from (select clock_timestamp() t) clock`;
  current.cookies.set(`${p}.cart_access:/`,{name:`${p}.cart_access`,value:`${expiredCartId}.${expiredCap}`,path:'/'});
  assert.equal((await current.call(`/api/v1/carts/${expiredCartId}`)).response.status,401);
 }finally{if(buyer) await cleanup(f.identity,[buyer]);await f.close();}
});

test('account ownership has no staff bypass, no guest fallback and no native bearer issuance',async()=>{
 const f=await checkoutFixture();const a=await actor(f.identity,'buyer',[]),b=await actor(f.identity,'buyer',[]);
 const client=new CommerceClient(f.identity),foreign=new CommerceClient(f.identity),staff=new CommerceClient(f.identity);
 for(const [target,user] of [[client,a],[foreign,b],[staff,f.owner]] as const) for(const [name,value] of user.browser.cookies) target.cookies.set(`${name}:/`,{name,value,path:'/'});
 try{
  const created=await client.call('/api/v1/carts',{lines:[f.line()]});assert.equal(created.response.status,201);const c=created.payload.cart;
  assert.equal((await foreign.call(`/api/v1/carts/${c.id}`)).response.status,404);
  assert.equal((await staff.call(`/api/v1/carts/${c.id}`)).response.status,404);
  assert.equal((await client.call('/api/v1/carts',{access_transport:'header'})).response.status,400);
  assert.equal((await client.call(`/api/v1/carts/${c.id}`,undefined,{headers:{authorization:'Bearer unissued'}})).response.status,401);
  const q=await client.call('/api/v1/checkout/quotes',{cart_id:c.id,address:f.address,contact:f.contact(),payment_method:'prepaid'},{version:1});assert.equal(q.response.status,201);
  const submitted=await client.call('/api/v1/orders',{quote_id:q.payload.id},{version:1});assert.equal(submitted.response.status,201);assert.ok(submitted.payload.guest_order_access_token===undefined);
  const [counts]=await f.identity.sql`select owner_user_id,(select count(*)::int from app.order_access where order_id=o.id) capabilities from app.commerce_order o where id=${submitted.payload.order.id}`;assert.equal(counts.owner_user_id,a.id);assert.equal(counts.capabilities,0);
  assert.equal((await foreign.call(`/api/v1/orders/${submitted.payload.order.id}`)).response.status,404);
  await f.identity.sql`delete from app.auth_session where user_id=${a.id}`;
  assert.equal((await client.call(`/api/v1/orders/${submitted.payload.order.id}`)).response.status,401);
 }finally{
  // Immutable synthetic commerce retains its account FK, but no usable login/session.
  await f.identity.sql`delete from app.auth_session where user_id=${a.id}`;await f.identity.sql`delete from app.auth_account where user_id=${a.id}`;
  await f.identity.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${a.email})`;
  await f.identity.sql`delete from app.local_delivery where recipient=${a.email}`;await cleanup(f.identity,[b]);await f.close();
 }
});
