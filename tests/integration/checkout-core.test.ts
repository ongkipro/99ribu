import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {connectDatabase} from '../../src/db/client.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {capability,digest,prefix,type CommerceActor} from '../../src/modules/checkout/access.ts';
import {createQuote,selectQuote} from '../../src/modules/checkout/quotes.ts';
import {releaseReservation} from '../../src/modules/inventory/reservations.ts';
import {submitOrder} from '../../src/modules/checkout/orders.ts';
import {expireOwnedOrderJob} from '../../src/modules/checkout/expiry.ts';
import {shippingFixture} from './shipping-fixture.ts';

const origin='http://127.0.0.1:3099';
test('real rollback-only unpaid prepaid checkout seals a quote, original units and holds, then recovers and expires exactly once',async()=>{
 const fixture=await shippingFixture();const {sql}=connectDatabase('test','owner');const rollback=new Error('Expected rollback');
 try{await assert.rejects(sql.begin(async tx=>{
  const [installed]=await tx`select to_regclass('app.cart') is not null installed`;
  if(!installed.installed) for(const statement of readFileSync('migrations/0013_checkout_orders.sql','utf8').split('--> statement-breakpoint')) if(statement.trim()) await tx.unsafe(statement);
  const [guest]=await tx`insert into app.commerce_guest_context (digest,created_at,expires_at) select ${digest(randomBytes(32).toString('base64url'))},t,t+interval '7 days' from (select clock_timestamp() t) clock returning id`;
  const actor:CommerceActor={kind:'guest',id:guest.id};let cartCookie='';
  const request=(path:string,body:unknown,key=randomUUID(),version=1)=>new Request(`${origin}/api/v1${path}`,{method:'POST',headers:{origin,'content-type':'application/json','idempotency-key':key,'if-match':`"${version}"`,cookie:cartCookie},body:JSON.stringify(body)});
  const line=fixture.line('fixture-offer-shirt');const created=await createCart(tx,request('/carts',{}),fixture.identity,actor,{lines:[{variant_id:line.offer_id,quantity:2,expected_publication_id:line.publication_id},{variant_id:fixture.line('fixture-offer-cream-pack').offer_id,quantity:1,expected_publication_id:fixture.line('fixture-offer-cream-pack').publication_id}]},{clock_namespace:fixture.namespace});
  const token=await capability(fixture.identity,'cart',created.cart.id,actor.id,created.cart.cap_issued_at as string);
  cartCookie=`${await prefix(fixture.identity)}.cart_access=${created.cart.id}.${token}`;
  const quote=await createQuote(tx,request('/checkout/quotes',{}),fixture.identity,actor,{cart_id:created.cart.id,address:{recipient_name:'Synthetic Buyer',phone:'081234567890',address_line:'SYNTHETIC ADDRESS',destination_id:'test-malang',postal_code:'00001'},contact:{phone:'081234567891'},payment_method:'prepaid'}) as {id:string;packages:{id:string;options:{id:string}[];selected_option_id:string}[];buyer_total:number;merchandise_total:number;shipping_total:number;subsidy_total:number;expires_at:string};
  assert.equal(quote.merchandise_total,297000);assert.equal(quote.shipping_total,12000);assert.equal(quote.buyer_total,297000+12000-quote.subsidy_total);
  const selection={packages:quote.packages.map(p=>({package_id:p.id,shipping_option_id:p.selected_option_id}))};
  const selected=await selectQuote(tx,request(`/checkout/quotes/${quote.id}/selection`,{}),fixture.identity,actor,quote.id,selection) as typeof quote;
  assert.equal(selected.expires_at,quote.expires_at);
  await assert.rejects(tx.savepoint(async t=>{await t`insert into app.checkout_quote (cart_id,cart_revision,operation_id,document,payment_method,merchandise_amount,shipping_amount,subsidy_amount,buyer_total,created_at,expires_at)
    select cart_id,cart_revision,gen_random_uuid(),document,payment_method,merchandise_amount,shipping_amount,subsidy_amount,buyer_total,created_at,expires_at from app.checkout_quote where id=${selected.id}`;await t.unsafe('SET CONSTRAINTS app.checkout_quote_sealed IMMEDIATE');}),{code:'23514'});
  await assert.rejects(tx.savepoint(t=>t`insert into app.checkout_quote (cart_id,cart_revision,operation_id,document,payment_method,merchandise_amount,shipping_amount,subsidy_amount,buyer_total,created_at,expires_at)
    select cart_id,cart_revision,gen_random_uuid(),jsonb_set(document,'{selected_plan,packages,0,lines,0,quantity}','99'),payment_method,merchandise_amount,shipping_amount,subsidy_amount,buyer_total,created_at,expires_at from app.checkout_quote where id=${selected.id}`),{code:'23514'});

  // S95: the guard takes live Mengantar plans. A copy whose plans and every rate say `mengantar` passes the row guard
  // (rolled back here); a plan mixing sources or naming another source is refused.
  const [stored]=await tx<{document:Record<string,unknown>}[]>`select document from app.checkout_quote where id=${selected.id}`;
  const withSource=(planSource:string,rateSource:string)=>{const doc=structuredClone(stored.document) as {plans:{source:string;packages:{options:{source:string}[]}[]}[];selected_plan:{source:string;packages:{options:{source:string}[]}[]}};
   for(const plan of [...doc.plans,doc.selected_plan]){plan.source=planSource;for(const parcel of plan.packages)for(const option of parcel.options)option.source=rateSource;}return doc;};
  const copy=(doc:unknown)=>tx.savepoint(async t=>{await t`insert into app.checkout_quote (cart_id,cart_revision,operation_id,document,payment_method,merchandise_amount,shipping_amount,subsidy_amount,buyer_total,created_at,expires_at,payment_channel,payment_charge_amount,cod_fee_bps)
    select cart_id,cart_revision,gen_random_uuid(),${JSON.stringify(doc)}::jsonb,payment_method,merchandise_amount,shipping_amount,subsidy_amount,buyer_total,created_at,expires_at,payment_channel,payment_charge_amount,cod_fee_bps from app.checkout_quote where id=${selected.id}`;throw new Error('accepted');});
  await assert.rejects(copy(withSource('mengantar','mengantar')),/accepted/);
  await assert.rejects(copy(withSource('mengantar','TEST-ONLY')),{code:'23514'});
  await assert.rejects(copy(withSource('kurir-lain','kurir-lain')),{code:'23514'});

  const key=randomUUID();const body={quote_id:selected.id};const req=request('/orders',body,key);
  const submitted=await submitOrder(tx,req,fixture.identity,actor,body);
  await tx.unsafe('SET CONSTRAINTS ALL IMMEDIATE');
  assert.equal(submitted.response.order.buyer_total,quote.buyer_total);assert.equal(submitted.response.order.items.find(i=>i.variant_id===line.offer_id)?.quantity,2);
  const pack=submitted.response.order.items.find(i=>i.variant_id===fixture.line('fixture-offer-cream-pack').offer_id);assert.equal(pack?.quantity,1);assert.equal(pack?.contents[0].quantity,2);
  assert.equal(submitted.response.order.shipments.flatMap(s=>s.items).length,3);
  const [physical]=await tx`select sum(a.quantity)::int n from app.fulfillment_component_allocation a join app.fulfillment_item f on f.id=a.fulfillment_item_id join app.order_item i on i.id=f.order_item_id where i.order_id=${submitted.order.id}`;assert.equal(physical.n,4);
  const recovered=await submitOrder(tx,req,fixture.identity,actor,body);assert.equal(recovered.order.id,submitted.order.id);
  const [effects]=await tx`select count(*)::int n from app.commerce_order where cart_id=${created.cart.id}`;assert.equal(effects.n,1);
  await assert.rejects(tx.savepoint(t=>t`update app.order_item set quantity=3 where order_id=${submitted.order.id}`),{code:'23514'});
  await tx.unsafe('SET CONSTRAINTS ALL DEFERRED');
  await assert.rejects(tx.savepoint(async t=>{await t`update app.commerce_order set buyer_total=buyer_total+1 where id=${submitted.order.id}`;await t.unsafe('SET CONSTRAINTS ALL IMMEDIATE');}),{code:'23514'});
  const [job]=await tx`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${submitted.order.id}`;
  await assert.rejects(tx.savepoint(async t=>{await releaseReservation(t,submitted.order.stock_reservation_id,'Invalid independent order release');await t.unsafe('SET CONSTRAINTS app.checkout_stock_hold_sealed IMMEDIATE');}),{code:'23514'});
  await assert.rejects(tx.savepoint(t=>t`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) select id,2,'cancelled','expired','Invalid premature expiry',${job.id},created_at from app.commerce_order where id=${submitted.order.id}`),{code:'23514'});
  const premature=await expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload});assert.ok(premature?.deferMs);
  await tx`update app.local_fixture_namespace set clock=clock+interval '31 minutes',revision=revision+1 where name=${fixture.namespace}`;
  const expired=await expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload});assert.equal(expired?.status,'cancelled');
  await tx.unsafe('SET CONSTRAINTS ALL IMMEDIATE');
  const duplicate=await expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload});assert.equal(duplicate?.status,'cancelled');
  const [events]=await tx`select count(*)::int n from app.order_event where order_id=${submitted.order.id}`;assert.equal(events.n,2);
  throw rollback;
 }),error=>error===rollback);}finally{await sql.end();await fixture.close();}
});
