import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {handlePromotions} from '../../src/modules/promotions/routes.ts';
import {capability,commerceActor,prefix} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {handlePayments} from '../../src/modules/payments/routes.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {ingestProviderEvent,simulateCollection} from '../../src/modules/payments/local.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {checkoutFixture} from './checkout-fixture.ts';

// S177 stage 2B (docs/spec/vouchers/S177-stage-2b-design.md): a store voucher discounts the merchandise subtotal, stacks
// with the automatic shipping promotions (decision 11) and is frozen per unit; COD fee and amount use the net.
const unique=(prefix:string)=>`${prefix}-${randomUUID().slice(0,8)}`.toUpperCase();

test('store voucher: config rules, stacks with an automatic shipping promotion, order freezes the discount per unit with COD on the net',async()=>{
 const f=await checkoutFixture();const owned:{id:string;config:Record<string,unknown>}[]=[];
 const write=async(path:string,body:Record<string,unknown>,expected=201)=>{const request=f.owner.browser.request(`/api/v1/admin/shipping-promotions${path}`,body);request.headers.set('idempotency-key',randomUUID());const response=await handlePromotions(request,f.identity);const payload=await response.json();assert.equal(response.status,expected,JSON.stringify(payload));return payload;};
 try{
  await f.identity.sql`delete from app.auth_rate_limit where key like 'rl:voucher-code:%'`;
  const [window]=await f.identity.sql`select max(v.ends_at)::text ends from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where v.active`;
  const target=Math.max(Date.now(),Date.parse(window.ends??new Date().toISOString()))+1000;let clock=await readFixtureClock('test',f.namespace);
  while(Date.parse(clock.now)<target) clock=await advanceFixtureClock('test',f.namespace,Math.min(31622400,Math.ceil((target-Date.parse(clock.now))/1000)),clock.version);
  const base={expected_version:0,name:'SYNTHETIC store voucher',active:true,starts_at:clock.now,ends_at:new Date(Date.parse(clock.now)+3600000).toISOString(),kind:'percentage',value:1000,maximum_per_order:50000,minimum_merchandise:1,budget:1000000,per_buyer_limit:1,payment_methods:['prepaid','cod'],region_ids:[],service_ids:[],stacking:'exclusive',priority:10,reason:'Synthetic',target:'merchandise'};
  const promo=async(overrides:Record<string,unknown>)=>{const config={...base,...overrides};const created=await write('',config);owned.push({id:created.id,config});return created;};
  // Configuration: a store voucher needs a code, and a percentage one a cap that covers % × minimum purchase.
  assert.equal((await write('',{...base},400)).code,'INVALID_INPUT');
  assert.equal((await write('',{...base,code:unique('kecil'),minimum_merchandise:1000000,maximum_per_order:50000},400)).code,'INVALID_INPUT');
  const code=unique('toko');const voucher=await promo({code});assert.equal(voucher.target,'merchandise');
  // An automatic shipping promotion the store voucher stacks with.
  await promo({name:'SYNTHETIC automatic shipping',target:'shipping',kind:'fixed',value:1000,maximum_per_order:1000,per_buyer_limit:10,stacking:'allowed'});

  assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);
  const request=f.client.request('/api/v1/carts',{}),buyer=await commerceActor(request,f.identity);assert.ok(buyer?.kind==='guest');
  const created=await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,buyer,{lines:[f.line('fixture-offer-shirt',3)]},{clock_namespace:f.namespace}));
  const p=await prefix(f.identity),token=await capability(f.identity,'cart',created.cart.id,buyer.id,created.cart.cap_issued_at as string);f.client.cookies.set(`${p}.cart_access:/`,{name:`${p}.cart_access`,value:`${created.cart.id}.${token}`,path:'/'});
  const quote=await f.client.call('/api/v1/checkout/quotes',{cart_id:created.cart.id,address:f.address,contact:f.contact(),payment_method:'cod',voucher_code:code.toLowerCase()},{version:1});
  assert.equal(quote.response.status,201,JSON.stringify(quote.payload));const q=quote.payload;
  const gross=q.merchandise_total,discount=Math.min(Math.floor((gross*1000+5000)/10000),50000);
  assert.deepEqual({status:q.voucher.status,target:q.voucher.target,amount:q.voucher.amount,discount:q.merchandise_discount_total,subsidy:q.subsidy_total},{status:'applied',target:'merchandise',amount:discount,discount,subsidy:1000},'stacked');
  assert.equal(q.buyer_total,gross-discount+q.shipping_total-1000);
  const packageDiscount=q.packages.reduce((n:number,pkg:{merchandise_discount_amount:number})=>n+pkg.merchandise_discount_amount,0);assert.equal(packageDiscount,discount);
  for(const pkg of q.packages)assert.equal(pkg.cod_collect_amount,pkg.merchandise_amount-pkg.merchandise_discount_amount+pkg.buyer_shipping_amount+pkg.cod_fee_amount);
  assert.equal(q.amount_due,q.buyer_total+q.cod_fee_total);

  const order=await f.client.call('/api/v1/orders',{quote_id:q.id},{version:1});assert.equal(order.response.status,201,JSON.stringify(order.payload));
  const id=order.payload.order.id;
  const [header]=await f.identity.sql`select merchandise_amount::int gross,merchandise_discount::int discount,subsidy_amount::int subsidy,buyer_total::int total from app.commerce_order where id=${id}`;
  assert.deepEqual(header,{gross,discount,subsidy:1000,total:q.buyer_total});
  const units=await f.identity.sql<{unit_index:number;unit_price:number;discount:number;subsidy:number}[]>`select f.unit_index,i.unit_price,f.merchandise_discount::int discount,f.subsidy_amount::int subsidy
   from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${id} order by f.unit_index`;
  assert.equal(units.length,3);assert.equal(units.reduce((n,u)=>n+u.discount,0),discount);
  assert.deepEqual(units.map(u=>u.discount),[0,1,2].map(i=>Math.floor(discount/3)+(i<discount%3?1:0)),'floor each, +1 to the first units');
  assert.ok(units.every(u=>u.unit_price-u.discount>=1));assert.equal(units.reduce((n,u)=>n+u.subsidy,0),1000,'the stacked shipping subsidy is frozen too');
  const shipments=await f.identity.sql<{merchandise:number;discount:number;buyer_shipping:number;charge:number;cod_due:number}[]>`select merchandise_amount::int merchandise,merchandise_discount::int discount,buyer_shipping::int,payment_charge::int charge,cod_due::int from app.order_shipment where order_id=${id}`;
  for(const s of shipments)assert.equal(s.cod_due,s.merchandise-s.discount+s.buyer_shipping+s.charge);
  const [hold]=await f.identity.sql`select r.discount_amount::int discount,r.subsidy_amount::int subsidy,(select count(*)::int from app.promotion_line_allocation l where l.reservation_id=r.id) lines from app.commerce_order o join app.promotion_reservation r on r.id=o.promotion_reservation_id where o.id=${id}`;
  assert.deepEqual(hold,{discount,subsidy:1000,lines:1});
  // The frozen unit split cannot be rewritten (immutable units; the seal recomputes it).
  await assert.rejects(f.identity.sql`update app.fulfillment_item set merchandise_discount=0 where order_item_id in (select id from app.order_item where order_id=${id})`);
 }finally{
  for(const {id} of owned){const [current]=await f.identity.sql`select v.*,p.code from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where p.id=${id}`;
   if(!current.active)continue;
   await write(`/${id}/versions`,{expected_version:current.revision,name:current.name,active:false,starts_at:new Date(current.starts_at).toISOString(),ends_at:new Date(current.ends_at).toISOString(),kind:current.kind,value:Number(current.value),maximum_per_order:Number(current.maximum_per_order),minimum_merchandise:Number(current.minimum_merchandise),budget:Number(current.budget),per_buyer_limit:current.per_buyer_limit,payment_methods:current.payment_methods,region_ids:current.region_ids,service_ids:current.service_ids,stacking:current.stacking,priority:current.priority,reason:'Synthetic cleanup',code:current.code,target:current.target}).catch(()=>{});}
  await f.close();
 }
});

test('store voucher, prepaid: the receipt and the Purchase signal carry the net; uneven unit shares become two integer-priced contents',async()=>{
 const f=await checkoutFixture();let voucherId='';let config:Record<string,unknown>={};
 const write=async(path:string,body:Record<string,unknown>)=>{const request=f.owner.browser.request(`/api/v1/admin/shipping-promotions${path}`,body);request.headers.set('idempotency-key',randomUUID());const response=await handlePromotions(request,f.identity);const payload=await response.json();assert.equal(response.status,201,JSON.stringify(payload));return payload;};
 try{
  await f.identity.sql`delete from app.auth_rate_limit where key like 'rl:voucher-code:%'`;
  const [window]=await f.identity.sql`select max(v.ends_at)::text ends from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where v.active`;
  const target=Math.max(Date.now(),Date.parse(window.ends??new Date().toISOString()))+1000;let clock=await readFixtureClock('test',f.namespace);
  while(Date.parse(clock.now)<target) clock=await advanceFixtureClock('test',f.namespace,Math.min(31622400,Math.ceil((target-Date.parse(clock.now))/1000)),clock.version);
  const code=unique('lunas');
  config={expected_version:0,name:'SYNTHETIC store voucher prepaid',active:true,starts_at:clock.now,ends_at:new Date(Date.parse(clock.now)+3600000).toISOString(),kind:'fixed',value:1000,maximum_per_order:1000,minimum_merchandise:1,budget:100000,per_buyer_limit:1,payment_methods:['prepaid'],region_ids:[],service_ids:[],stacking:'exclusive',priority:10,reason:'Synthetic',code,target:'merchandise'};
  voucherId=(await write('',config)).id;
  assert.equal((await f.client.call('/api/v1/carts',{})).response.status,401);
  const request=f.client.request('/api/v1/carts',{}),buyer=await commerceActor(request,f.identity);assert.ok(buyer?.kind==='guest');
  const created=await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,buyer,{lines:[f.line('fixture-offer-shirt',3)]},{clock_namespace:f.namespace}));
  const p=await prefix(f.identity),token=await capability(f.identity,'cart',created.cart.id,buyer.id,created.cart.cap_issued_at as string);f.client.cookies.set(`${p}.cart_access:/`,{name:`${p}.cart_access`,value:`${created.cart.id}.${token}`,path:'/'});
  const quote=await f.client.call('/api/v1/checkout/quotes',{cart_id:created.cart.id,address:f.address,contact:f.contact(),payment_method:'prepaid',voucher_code:code},{version:1});
  assert.equal(quote.response.status,201,JSON.stringify(quote.payload));assert.equal(quote.payload.merchandise_discount_total,1000);
  const order=await f.client.call('/api/v1/orders',{quote_id:quote.payload.id},{version:1});assert.equal(order.response.status,201,JSON.stringify(order.payload));
  const id=order.payload.order.id;
  const attemptResponse=await handlePayments(f.client.request(`/api/v1/orders/${id}/payment-attempts`,{method_id:'local-prepaid'}),f.identity);assert.equal(attemptResponse.status,201);
  const attempt=await attemptResponse.json();assert.equal(attempt.expected_amount??attempt.amount,quote.payload.amount_due,'the buyer pays the net total');
  const [stored]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`;
  assert.equal(await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},stored.creation_job_id),true);
  const event=await simulateCollection(f.identity.sql,'test',attempt.id),job=await ingestProviderEvent(f.identity.sql,event);assert.equal(await runOneJob(f.identity.sql,{},job),true);
  const [gross]=await f.identity.sql`select sum(quantity*unit_price)::int amount from app.order_item where order_id=${id}`;
  const [receipt]=await f.identity.sql`select merchandise_amount::int merchandise,amount::int amount from app.economic_receipt where order_id=${id}`;
  assert.equal(receipt.merchandise,gross.amount-1000,'receipt merchandise is net');assert.equal(receipt.amount,quote.payload.amount_due);
  const [purchase]=await f.identity.sql`select id,merchandise_amount::int value,payload from app.commerce_event where order_id=${id} and name='Purchase'`;
  assert.equal(purchase.value,gross.amount-1000,'Purchase value is net');
  const contents=purchase.payload.contents as {id:string;quantity:number;merchandise_amount:number}[];
  assert.equal(contents.length,2,'334 + 333 + 333: two integer unit prices');
  assert.equal(contents.reduce((n,c)=>n+c.merchandise_amount,0),gross.amount-1000);
  assert.ok(contents.every(c=>Number.isInteger(c.merchandise_amount/c.quantity)));
  assert.deepEqual(purchase.payload.content_ids,contents.map(c=>c.id));
  const [allocated]=await f.identity.sql`select sum(merchandise_amount)::int amount,sum(quantity)::int units from app.purchase_allocation where event_id=${purchase.id}`;assert.deepEqual(allocated,{amount:gross.amount-1000,units:3});
 }finally{
  if(voucherId)await write(`/${voucherId}/versions`,{...config,expected_version:1,active:false,reason:'Synthetic cleanup'}).catch(()=>{});
  await f.close();
 }
});
