import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {capability,commerceActor,prefix} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {createQuote} from '../../src/modules/checkout/quotes.ts';
import {submitOrder} from '../../src/modules/checkout/orders.ts';
import {bootstrapVisitor,readVisitor,visitorCookieName,visitorToken} from '../../src/modules/consent/context.ts';
import {recordConsent} from '../../src/modules/consent/receipts.ts';
import {funnelInput,recordFunnel} from '../../src/modules/advertising/funnel.ts';
import {checkoutFixture} from './checkout-fixture.ts';

test('order-path observation receives the real scoped cookie; visitor alone fails, retries recover once and denial retains no behavior payload',async()=>{
 const f=await checkoutFixture(),owner=connectDatabase('test','owner'),rollback=new Error('Expected order-funnel candidate rollback');let stage='bootstrap';
 try{
  assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);const base=f.client.request('/api/v1/visitor-sessions',{client_request_id:randomUUID()}),actor=await commerceActor(base,f.identity);assert.ok(actor?.kind==='guest');
  await assert.rejects(owner.sql.begin(async tx=>{
   const [installed]=await tx`select to_regclass('app.commerce_event') is not null installed`;if(!installed.installed)for(const part of readFileSync('migrations/0017_canonical_signals.sql','utf8').split('--> statement-breakpoint'))if(part.trim())await tx.unsafe(part);
   const active=await bootstrapVisitor(tx,base,f.identity,actor,randomUUID(),{client_request_id:randomUUID()}),vName=await visitorCookieName(f.identity),vToken=await visitorToken(f.identity,active.visitor);f.client.cookies.set(`${vName}:/`,{name:vName,value:`${active.visitor.id}.${vToken}`,path:'/'});
   const choices={analytics:'granted',advertising_measurement:'denied',marketing:'denied',meta:'denied',google:'denied',tiktok:'denied',google_signals:{ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'}};
   const consent=await recordConsent(tx,active.visitor,randomUUID(),{expected_version:0,policy_version:'local-privacy-v1',choices});
   stage='owned order';const cart=await createCart(tx,f.client.request('/api/v1/carts',{lines:[f.line()]}),f.identity,actor,{lines:[f.line()]},{clock_namespace:f.namespace});
   const cName=`${await prefix(f.identity)}.cart_access`,cToken=await capability(f.identity,'cart',cart.cart.id,actor.id,cart.cart.cap_issued_at as string);f.client.cookies.set(`${cName}:/`,{name:cName,value:`${cart.cart.id}.${cToken}`,path:'/'});
   const quoteBody={cart_id:cart.cart.id,address:f.address,contact:f.contact(),payment_method:'prepaid'},quote=await createQuote(tx,f.client.request('/api/v1/checkout/quotes',quoteBody,{version:1}),f.identity,actor,quoteBody);
   const body={quote_id:quote.id},submitted=await submitOrder(tx,f.client.request('/api/v1/orders',body,{version:1}),f.identity,actor,body),order=submitted.order;
   const [access]=await tx`select issued_at from app.order_access where order_id=${order.id}`,oName=`${await prefix(f.identity)}.order_access`,oToken=await capability(f.identity,'order',order.id,actor.id,access.issued_at);
   f.client.cookies.set(`${oName}:/api/v1/orders/${order.id}`,{name:oName,value:`${order.id}.${oToken}`,path:`/api/v1/orders/${order.id}`});
   const input={client_event_id:randomUUID(),name:'receipt_viewed',occurred_at:new Date().toISOString(),consent_receipt_id:consent.id,order_id:order.id},general=f.client.request('/api/v1/funnel/events',input,{key:input.client_event_id}),path=`/api/v1/orders/${order.id}/funnel/events`,scoped=f.client.request(path,input,{key:input.client_event_id});
   stage='independent order scope';await assert.rejects(recordFunnel(tx,general,f.identity,actor,funnelInput(input,input.client_event_id)),{code:'UNAUTHENTICATED'});
   const ack=await recordFunnel(tx,scoped,f.identity,actor,funnelInput(input,input.client_event_id,order.id));assert.equal(ack.status,'accepted');
   assert.deepEqual(await recordFunnel(tx,scoped,f.identity,actor,funnelInput(input,input.client_event_id,order.id)),ack);
   assert.equal((await tx`select count(*)::int n from app.commerce_event where source_kind='browser' and order_id=${order.id}`)[0].n,1);
   stage='withdrawn replay';const current=await readVisitor(tx,scoped,f.identity,actor);assert.ok(current);const declined=await recordConsent(tx,current,randomUUID(),{expected_version:1,policy_version:'local-privacy-v1',choices:{...choices,analytics:'denied'}});
   assert.deepEqual(await recordFunnel(tx,scoped,f.identity,actor,funnelInput(input,input.client_event_id,order.id)),ack);
   const denied={...input,client_event_id:randomUUID(),occurred_at:new Date().toISOString(),consent_receipt_id:declined.id};
   await recordFunnel(tx,f.client.request(path,denied,{key:denied.client_event_id}),f.identity,actor,funnelInput(denied,denied.client_event_id,order.id));
   assert.equal((await tx`select count(*)::int n from app.commerce_event where source_kind='browser' and order_id=${order.id}`)[0].n,1);
   assert.equal((await tx`select event_id from app.funnel_intake where visitor_id=${active.visitor.id} and client_event_id=${denied.client_event_id}`)[0].event_id,null);
   assert.equal((await tx`select count(*)::int n from app.economic_receipt where order_id=${order.id}`)[0].n,0);
   stage='complete seals';await tx`set constraints all immediate`;throw rollback;
  }),error=>{if(error===rollback)return true;const safe=error as {code?:unknown;constraint_name?:unknown};assert.fail(`Order-funnel candidate failed at ${stage} (${String(safe.code??'domain')}/${String(safe.constraint_name??'constraint')})`);});
 }finally{await owner.sql.end();await f.close();}
});
