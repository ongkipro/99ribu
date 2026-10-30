import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {initialCheckoutIntent,mutateCheckout} from '../../src/modules/storefront/checkout.ts';
import {captureCheckoutMilestones} from '../../src/modules/storefront/checkout-signals.ts';
import {advertisingFixture,deniedChoices,grantedChoices} from './advertising-fixture.ts';

test('checkout milestones require current consent/native acceptance, dedupe retries and never backfill an earlier validation or disclose typed fields',async()=>{
 const f=await advertisingFixture();try{
  const body={lines:[f.line()]},key=randomUUID();assert.equal((await f.client.call('/api/v1/carts',body,{key})).response.status,401);const created=await f.client.call('/api/v1/carts',body,{key});assert.equal(created.response.status,201);const cart=created.payload.cart;
  const entry={cart:cart.id,version:cart.version,stage:'started' as const},request=()=>f.client.request('/checkout',{}),events=()=>f.identity.sql`select name,payload,merchandise_amount from app.commerce_event where payload->>'cart_id'=${cart.id} order by name`;
  await captureCheckoutMilestones(request(),f.identity,entry);assert.equal((await events()).length,0);
  await f.consent(f.client,deniedChoices);await captureCheckoutMilestones(request(),f.identity,entry);assert.equal((await events()).length,0);
  const draft={recipient_name:'SYNTHETIC private recipient',phone:'081200000000',email:'synthetic@example.invalid',destination_id:'test-malang',address_line:'SYNTHETIC private street\nRT 01',buyer_note:'SYNTHETIC private note',payment_method:'prepaid'};
  const intent=initialCheckoutIntent({cart:cart.id,version:String(cart.version),draft}),deniedQuote=await mutateCheckout(request(),f.identity,intent);assert.equal(deniedQuote.state.phase,'success');assert.ok(deniedQuote.state.view.quote);
  const oldAcceptance={...entry,stage:'contact' as const,quote:deniedQuote.state.view.quote.id};await captureCheckoutMilestones(request(),f.identity,oldAcceptance);assert.equal((await events()).length,0);
  await f.consent(f.client,grantedChoices,1);await captureCheckoutMilestones(request(),f.identity,oldAcceptance);assert.equal((await events()).length,0,'later consent cannot backfill the original native validation');
  await Promise.all([1,2,3].map(()=>captureCheckoutMilestones(request(),f.identity,entry)));assert.deepEqual((await events()).map(e=>e.name),['checkout_started']);
  const quoted=await mutateCheckout(request(),f.identity,{...intent,key:randomUUID()});assert.equal(quoted.state.phase,'success');const quote=quoted.state.view.quote;assert.ok(quote);
  const contact={...entry,stage:'contact' as const,quote:quote.id};await captureCheckoutMilestones(request(),f.identity,contact);await captureCheckoutMilestones(request(),f.identity,contact);
  assert.equal(quoted.state.intent.kind,'order');
  // The single-page form applies a courier/split change as a 'shipping' intent (quote.select); an unchanged order press would place the order instead.
  const selected=await mutateCheckout(request(),f.identity,{...quoted.state.intent,kind:'shipping',packages:quote.packages.map(p=>({package_id:p.id,shipping_option_id:p.selected_option_id}))});assert.equal(selected.state.step,'review');assert.equal(selected.order,null);assert.ok(selected.state.view.quote);
  const shipping={...entry,stage:'shipping' as const,quote:selected.state.view.quote.id};await captureCheckoutMilestones(request(),f.identity,shipping);await captureCheckoutMilestones(request(),f.identity,shipping);
  const accepted=await events();assert.deepEqual(accepted.map(e=>e.name),['address_validated','checkout_started','contact_validated','payment_method_selected','shipping_selected']);assert.ok(accepted.every(e=>Number(e.merchandise_amount)===0));
  const serialized=JSON.stringify(accepted);for(const value of Object.values(draft))if(value.length>10)assert.ok(!serialized.includes(value),'Typed checkout data cannot enter observed event fields');assert.ok(!serialized.includes(draft.destination_id));
  await captureCheckoutMilestones(f.client.request('/checkout'),f.identity,entry);await captureCheckoutMilestones(request(),f.identity,{...entry,cart:randomUUID()});assert.equal((await events()).length,5,'GET and foreign/noncurrent cart cannot capture entry');
  const renewed=await mutateCheckout(request(),f.identity,{...intent,key:randomUUID()});assert.equal(renewed.state.phase,'success');await captureCheckoutMilestones(request(),f.identity,shipping);assert.equal((await events()).length,5,'superseded quote cannot capture an old shipping milestone');
  await f.consent(f.client,deniedChoices,2);await captureCheckoutMilestones(request(),f.identity,entry);assert.equal((await events()).length,5);
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where name='Purchase' and payload->>'cart_id'=${cart.id}`)[0].n,0);assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_order where cart_id=${cart.id}`)[0].n,0);
  await f.client.auth('/sign-out',{});await captureCheckoutMilestones(request(),f.identity,entry);assert.equal((await events()).length,5);
 }finally{try{await f.client.auth('/sign-out',{});}finally{await f.close();}}
});
