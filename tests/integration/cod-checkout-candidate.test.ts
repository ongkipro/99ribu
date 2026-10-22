import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {capability,commerceActor,prefix} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {createQuote} from '../../src/modules/checkout/quotes.ts';
import {submitOrder} from '../../src/modules/checkout/orders.ts';
import {expireOwnedOrderJob} from '../../src/modules/checkout/expiry.ts';
import {bootstrapVisitor,visitorCookieName,visitorToken} from '../../src/modules/consent/context.ts';
import {recordConsent} from '../../src/modules/consent/receipts.ts';
import {grantedChoices} from './advertising-fixture.ts';
import {checkoutFixture} from './checkout-fixture.ts';

test('actual checkout confirms supported split COD once without money, retains eligible purpose context and protects original holds after the checkout deadline',async()=>{
 const f=await checkoutFixture(),owner=connectDatabase('test','owner'),rollback=new Error('Expected COD checkout candidate rollback');let stage='bootstrap';
 try{
  assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);const base=f.client.request('/api/v1/visitor-sessions',{client_request_id:randomUUID()}),actor=await commerceActor(base,f.identity);assert.ok(actor?.kind==='guest');
  await assert.rejects(owner.sql.begin(async tx=>{
   stage='ddl';const [installed]=await tx`select to_regclass('app.cod_confirmation') is not null installed`;if(!installed.installed)for(const part of readFileSync('migrations/0018_cod_collections.sql','utf8').split('--> statement-breakpoint'))if(part.trim())await tx.unsafe(part);
   const active=await bootstrapVisitor(tx,base,f.identity,actor,randomUUID(),{client_request_id:randomUUID()}),name=await visitorCookieName(f.identity),token=await visitorToken(f.identity,active.visitor);f.client.cookies.set(`${name}:/`,{name,value:`${active.visitor.id}.${token}`,path:'/'});
   await recordConsent(tx,active.visitor,randomUUID(),{expected_version:0,policy_version:'local-privacy-v1',choices:grantedChoices});
   stage='cart';const cartBody={lines:[f.line('fixture-offer-shirt',4)]},cart=await createCart(tx,f.client.request('/api/v1/carts',cartBody),f.identity,actor,cartBody,{clock_namespace:f.namespace});
   const cartName=`${await prefix(f.identity)}.cart_access`,cartToken=await capability(f.identity,'cart',cart.cart.id,actor.id,cart.cart.cap_issued_at as string);f.client.cookies.set(`${cartName}:/`,{name:cartName,value:`${cart.cart.id}.${cartToken}`,path:'/'});
   stage='unsupported split';const denied={cart_id:cart.cart.id,address:{...f.address,destination_id:'test-prepaid-only',postal_code:'00003'},contact:f.contact(),payment_method:'cod'};
   await assert.rejects(tx.savepoint(t=>createQuote(t,f.client.request('/api/v1/checkout/quotes',denied,{version:1}),f.identity,actor,denied)),{code:'COD_UNAVAILABLE'});
   const mixed={...denied,payment_method:'mixed'};await assert.rejects(tx.savepoint(t=>createQuote(t,f.client.request('/api/v1/checkout/quotes',mixed,{version:1}),f.identity,actor,mixed)),{code:'INVALID_INPUT'});
   stage='automatic COD acceptance';const input={cart_id:cart.cart.id,address:f.address,contact:f.contact(),payment_method:'cod'},quote=await createQuote(tx,f.client.request('/api/v1/checkout/quotes',input,{version:1}),f.identity,actor,input),body={quote_id:quote.id},key=randomUUID(),request=f.client.request('/api/v1/orders',body,{version:1,key});
   const saved=await submitOrder(tx,request,f.identity,actor,body),order=saved.response.order;assert.equal(order.payment_status,'cod_due');assert.equal(order.version,2);assert.equal(order.shipments.length,2);assert.equal(order.shipments.reduce((n,s)=>n+(s.cod_collect_amount??0),0),order.amount_due);
   assert.equal((await submitOrder(tx,request,f.identity,actor,body)).response.order.id,order.id);
   assert.equal((await tx`select count(*)::int n from app.cod_confirmation where order_id=${order.id}`)[0].n,1);
   assert.equal((await tx`select count(*)::int n from app.order_ad_attribution where order_id=${order.id} and visitor_id=${active.visitor.id}`)[0].n,1);
   assert.equal((await tx`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);assert.equal((await tx`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,0);
   stage='original hold after deadline';await tx`update app.local_fixture_namespace set clock=clock+interval '31 minutes' where name=${f.namespace}`;
   const [job]=await tx`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;const expired=await expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload});assert.equal(expired?.status,'cod_confirmed');assert.equal(expired?.deferMs,null);
   const [state]=await tx`select o.actionable_at,o.created_at,r.status from app.commerce_order o join app.stock_reservation r on r.id=o.stock_reservation_id where o.id=${order.id}`;assert.equal(new Date(state.actionable_at).toISOString(),new Date(state.created_at).toISOString());assert.equal(state.status,'active');
   stage='final seals';await tx`set constraints all immediate`;throw rollback;
  }),error=>{if(error===rollback)return true;const safe=error as {code?:unknown;constraint_name?:unknown};assert.fail(`COD checkout candidate failed at ${stage} (${String(safe.code??'domain')}/${String(safe.constraint_name??'constraint')})`);});
 }finally{await owner.sql.end();await f.close();}
});
