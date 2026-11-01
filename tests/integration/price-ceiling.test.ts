import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {patchProduct,readCatalogRevision} from '../../src/modules/catalog/catalog.ts';
import {offerInput} from '../../src/modules/catalog/validation.ts';
import {offerCommissionIdr} from '../../src/modules/affiliates/rates.ts';
import {evaluateContribution} from '../../src/modules/finance/contribution.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {ingestProviderEvent,readProviderEvents,simulateCollection} from '../../src/modules/payments/local.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {connectDatabase} from '../../src/db/client.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {handleAffiliateProfile} from '../../src/modules/affiliates/profile.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {handleCommerceExceptions} from '../../src/modules/checkout/exceptions/routes.ts';
import {submitOrder} from '../../src/modules/checkout/orders.ts';
import {createQuote} from '../../src/modules/checkout/quotes.ts';
import {accrueOrderCommissions} from '../../src/modules/commissions/service.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {allocateByWeight} from '../../src/modules/payments/methods.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {checkoutFixture,CommerceClient} from './checkout-fixture.ts';
import {closeFulfillmentActor,fulfillmentFixture} from './fulfillment-fixture.ts';
import {paymentFixture} from './payment-fixture.ts';
import {approvedRefundFixture} from './return-refund-fixture.ts';
import type {shippingFixture} from './shipping-fixture.ts';

// DEC-025 / S148: an offer has its own price (whole rupiah, at most IDR 99,000). The price is part of the offer
// revision; the cart line, quote, order item and every money guard use that frozen unit price, never a constant.
const PRICE=69000;

test('DEC-025 offer input and the database refuse a price outside IDR 1..99,000',async()=>{
 const base={label:'Satuan',attributes:[],weight_grams:100,length_mm:50,width_mm:50,height_mm:50,default_warehouse_id:randomUUID(),offer_kind:'unit',
  contents:[{stock_item_id:randomUUID(),name:'Barang',quantity:1}]};
 assert.equal(offerInput({...base,sku:'B99_TEST_OFFER'},true).price,99000);
 assert.equal(offerInput({...base,sku:'B99_TEST_OFFER',price:19000},true).price,19000);
 assert.equal('price' in offerInput(base,false),false,'an update without a price keeps the current one');
 for(const price of [0,99001,49000.5,'49000']) assert.throws(()=>offerInput({...base,sku:'B99_TEST_OFFER',price},true),{code:'INVALID_INPUT'});
 assert.equal(offerCommissionIdr(1000,99000),9900);assert.equal(offerCommissionIdr(1000,PRICE),6900);assert.equal(offerCommissionIdr(1500,19000),2850);
 const f=await checkoutFixture();
 try{
  const offerId=f.seeded.offers['fixture-offer-shirt'];
  // Offer revisions are written only through the sealed catalog path, so the ceiling is read from the live constraint.
  const [ceiling]=await f.identity.sql`select pg_get_constraintdef(oid) definition from pg_constraint where conname='offer_price_ceiling_check'`;
  assert.match(ceiling.definition,/price >= 1\) AND \(price <= 99000\)/);
  for(const [name,check] of [['cart_line_value_check',/unit_price >= 1\) AND \(unit_price <= 99000\)/],['order_item_value_check',/unit_price >= 1\) AND \(unit_price <= 99000\)/]] as const){
   const [row]=await f.identity.sql`select pg_get_constraintdef(oid) definition from pg_constraint where conname=${name}`;assert.match(row.definition,check);}
  assert.equal(offerId.length,36);
 }finally{await f.close();}
});

test('DEC-025 a repriced offer is frozen through publication, plan, cart, quote and order; money guards use the unit price',async()=>{
 const f=await checkoutFixture();
 try{
  const productId=f.seeded.products['fixture-offer-shirt'],offerId=f.seeded.offers['fixture-offer-shirt'];
  const before=await readCatalogRevision(f.identity.sql,productId),current=before.variants.find((v)=>v.id===offerId);assert.ok(current);assert.equal(current.price,99000);
  const {id:_id,catalog_id:_catalog,sku:_sku,retired:_retired,...definition}=current;
  const patch=f.request();patch.headers.set('idempotency-key',randomUUID());
  const revised=await patchProduct(patch,f.identity,f.principal,productId,{expected_version:before.version,reason:'DEC-025 synthetic reprice',
   variant_changes:[{operation:'update',variant_id:offerId,update:{...definition,image:definition.image??undefined,price:PRICE}}]}) as {version:number;variants:{id:string;price:number}[]};
  assert.equal(revised.variants.find((v)=>v.id===offerId)?.price,PRICE);
  // The publication trigger derives contribution from the offer price (DEC-025), so publishing proves the SQL arithmetic.
  const [{revision}]=await f.identity.sql`select coalesce(max(revision),0)::int revision from app.publication_version where product_id=${productId}`;
  const published=await f.catalog(`/products/${productId}/publications`,{expected_version:revised.version,expected_publication_version:revision,reason:'DEC-025 synthetic reprice publication'});
  f.seeded.publications['fixture-offer-shirt'].id=published.id;
  const [frozen]=await f.identity.sql`select o.estimated_contribution,o.estimated_hpp from app.publication_offer o where o.publication_id=${published.id} and o.offer_id=${offerId}`;
  const estimate=await f.identity.sql.begin(async(tx)=>evaluateContribution(tx,await readCatalogRevision(tx,productId,revised.version),new Date().toISOString()));
  const offer=estimate.offers.find((o)=>o.offer_id===offerId);assert.ok(offer);assert.equal(offer.price_idr,PRICE);
  assert.equal(offer.commission_idr,offerCommissionIdr(estimate.commission_bps,PRICE));
  assert.equal(Number(frozen.estimated_contribution),offer.estimated_contribution);assert.ok(Number(frozen.estimated_contribution)<PRICE-Number(frozen.estimated_hpp));

  const plan=(await f.plans([{line_id:'shirt',product_id:productId,offer_id:offerId,publication_id:published.id,quantity:2}]))[0];
  assert.equal(plan.merchandise_total,2*PRICE);assert.equal(plan.packages.reduce((sum,p)=>sum+p.merchandise_amount,0),2*PRICE);

  const key=randomUUID(),body={access_transport:'header',lines:[f.line('fixture-offer-shirt',2)]};
  assert.equal((await f.client.call('/api/v1/carts',body,{key})).response.status,401);
  const created=await f.client.call('/api/v1/carts',body,{key});assert.equal(created.response.status,201);
  const cart=created.payload.cart,headers={'x-cart-token':created.payload.cart_access_token};
  assert.equal(cart.lines[0].unit_price,PRICE);assert.equal(cart.lines[0].line_total,2*PRICE);assert.equal(cart.merchandise_total,2*PRICE);
  // The unit price comes from the offer revision, never the writer: a forged price is replaced on write.
  await f.identity.sql`update app.cart_line set unit_price=99000 where cart_id=${cart.id}`;
  const [line]=await f.identity.sql`select unit_price from app.cart_line where cart_id=${cart.id}`;assert.equal(Number(line.unit_price),PRICE);

  const quoted=await f.client.call('/api/v1/checkout/quotes',{cart_id:cart.id,address:f.address,contact:f.contact(),payment_method:'prepaid'},{version:1,headers});
  assert.equal(quoted.response.status,201,JSON.stringify(quoted.payload));
  const [quote]=await f.identity.sql`select merchandise_amount from app.checkout_quote where id=${quoted.payload.id}`;assert.equal(Number(quote.merchandise_amount),2*PRICE);
  const submitted=await f.client.call('/api/v1/orders',{quote_id:quoted.payload.id},{key:randomUUID(),version:1,headers});assert.equal(submitted.response.status,201,JSON.stringify(submitted.payload));
  const orderId=submitted.payload.order?.id??submitted.payload.id;
  const [order]=await f.identity.sql`select merchandise_amount from app.commerce_order where id=${orderId}`;assert.equal(Number(order.merchandise_amount),2*PRICE);
  const items=await f.identity.sql`select unit_price,quantity from app.order_item where order_id=${orderId}`;assert.deepEqual(items.map((i)=>[Number(i.unit_price),Number(i.quantity)]),[[PRICE,2]]);
  const [shipment]=await f.identity.sql`select sum(merchandise_amount)::bigint merchandise from app.order_shipment where order_id=${orderId}`;assert.equal(Number(shipment.merchandise),2*PRICE);
 }finally{await f.close();}
});

test('DEC-025 a paid order at a non-ceiling price posts the receipt, Purchase allocation and signal at the unit price',async()=>{
 const f=await paymentFixture();
 try{
  const productId=f.seeded.products['fixture-offer-shirt'],offerId=f.seeded.offers['fixture-offer-shirt'];
  const before=await readCatalogRevision(f.identity.sql,productId),current=before.variants.find((v)=>v.id===offerId);assert.ok(current);
  const {id:_id,catalog_id:_catalog,sku:_sku,retired:_retired,...definition}=current;
  const patch=f.request();patch.headers.set('idempotency-key',randomUUID());
  const revised=await patchProduct(patch,f.identity,f.principal,productId,{expected_version:before.version,reason:'DEC-025 synthetic reprice',
   variant_changes:[{operation:'update',variant_id:offerId,update:{...definition,image:definition.image??undefined,price:PRICE}}]}) as {version:number};
  const [{revision}]=await f.identity.sql`select coalesce(max(revision),0)::int revision from app.publication_version where product_id=${productId}`;
  const published=await f.catalog(`/products/${productId}/publications`,{expected_version:revised.version,expected_publication_version:revision,reason:'DEC-025 synthetic reprice publication'});
  f.seeded.publications['fixture-offer-shirt'].id=published.id;
  const {order,client}=await f.order(2);
  assert.equal(order.merchandise_total,2*PRICE);assert.deepEqual(order.items.map((i:{unit_price:number;subtotal:number})=>[i.unit_price,i.subtotal]),[[PRICE,2*PRICE]]);
  const attempt=(await f.call(client,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).payload;
  const [stored]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${attempt.id}`;
  assert.equal(await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},stored.creation_job_id),true);
  // The local adapter answers pending; the simulated collection is the confirmed provider event.
  const events=await f.identity.sql.begin((tx)=>readProviderEvents(tx,attempt.id));
  const paid=events.find((e)=>e.status==='confirmed')??await simulateCollection(f.identity.sql,'test',attempt.id);
  assert.equal(await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,paid)),true);
  const [receipt]=await f.identity.sql`select id,merchandise_amount from app.economic_receipt where order_id=${order.id}`;assert.equal(Number(receipt.merchandise_amount),2*PRICE);
  const [event]=await f.identity.sql`select id,payload from app.commerce_event where name='Purchase' and receipt_id=${receipt.id}`;assert.ok(event,'the paid receipt appends one Purchase');
  assert.deepEqual(event.payload.contents.map((c:{quantity:number;merchandise_amount:number})=>[c.quantity,c.merchandise_amount]),[[2,2*PRICE]]);
  const allocations=await f.identity.sql`select quantity,merchandise_amount from app.purchase_allocation where event_id=${event.id}`;
  assert.deepEqual(allocations.map((a)=>[Number(a.quantity),Number(a.merchandise_amount)]),[[2,2*PRICE]]);
  const [{payload}]=await f.identity.sql`select app.purchase_signal_payload(${order.id}) payload`;assert.equal(payload.contents[0].merchandise_amount,2*PRICE);
 }finally{await f.close();}
});

// ---- S148 reviewer gaps: mixed prices, COD base, refunds/recoveries, commissions, later price changes, DB refusals ----
const SHIRT='fixture-offer-shirt',CREAM='fixture-offer-cream-pack',CREAM_PRICE=79000;
// Structural: only what reprice uses, so checkout, payment and fulfillment fixtures all fit.
type Shop=Pick<Awaited<ReturnType<typeof shippingFixture>>,'identity'|'seeded'|'request'|'principal'|'catalog'>;
// Reprice one seeded offer through the real catalog writer and republish it; later f.line() calls freeze the new publication.
async function reprice(f:Shop,key:string,price:number){
 const productId=f.seeded.products[key],offerId=f.seeded.offers[key];
 const before=await readCatalogRevision(f.identity.sql,productId),current=before.variants.find((v)=>v.id===offerId);assert.ok(current);
 const {id:_id,catalog_id:_catalog,sku:_sku,retired:_retired,...definition}=current;
 const patch=f.request();patch.headers.set('idempotency-key',randomUUID());
 const revised=await patchProduct(patch,f.identity,f.principal,productId,{expected_version:before.version,reason:'DEC-025 synthetic reprice',
  variant_changes:[{operation:'update',variant_id:offerId,update:{...definition,image:definition.image??undefined,price}}]}) as {version:number;variants:{id:string;price:number}[]};
 assert.equal(revised.variants.find((v)=>v.id===offerId)?.price,price);
 const [{revision}]=await f.identity.sql`select coalesce(max(revision),0)::int revision from app.publication_version where product_id=${productId}`;
 const published=await f.catalog(`/products/${productId}/publications`,{expected_version:revised.version,expected_publication_version:revision,reason:'DEC-025 synthetic reprice publication'});
 f.seeded.publications[key].id=published.id;return String(published.id);
}
type Checkout=Awaited<ReturnType<typeof checkoutFixture>>;
// Header-transport guest cart through the public checkout handlers.
async function openCart(client:CommerceClient,lines:ReturnType<Checkout['line']>[]){
 const key=randomUUID(),body={access_transport:'header',lines};let created=await client.call('/api/v1/carts',body,{key});
 if(created.response.status===401)created=await client.call('/api/v1/carts',body,{key});assert.equal(created.response.status,201,JSON.stringify(created.payload));
 return {cart:created.payload.cart,headers:{'x-cart-token':created.payload.cart_access_token} as Record<string,string>};
}
const quoteCart=(f:Checkout,client:CommerceClient,cart:{id:string;version:number},headers:Record<string,string>,payment_method:'prepaid'|'cod'='prepaid')=>
 client.call('/api/v1/checkout/quotes',{cart_id:cart.id,address:f.address,contact:f.contact(),payment_method},{version:cart.version,headers});
const placeOrder=(client:CommerceClient,quoteId:string,version:number,headers:Record<string,string>)=>client.call('/api/v1/orders',{quote_id:quoteId},{key:randomUUID(),version,headers});
async function orderMoney(sql:Checkout['identity']['sql'],orderId:string){
 const items=await sql`select i.offer_id,i.unit_price,i.quantity from app.order_item i where i.order_id=${orderId} order by i.offer_id`;
 const shipments=await sql`select s.id,s.merchandise_amount,s.buyer_shipping,s.payment_charge,s.cod_due,(select coalesce(sum(i.unit_price),0)::bigint from app.fulfillment_item fi join app.order_item i on i.id=fi.order_item_id where fi.shipment_id=s.id) unit_merchandise from app.order_shipment s where s.order_id=${orderId} order by s.id`;
 const units=await sql`select fi.id,fi.shipment_id,fi.buyer_shipping,fi.payment_charge,i.unit_price,i.offer_id from app.fulfillment_item fi join app.order_item i on i.id=fi.order_item_id where i.order_id=${orderId} order by fi.id`;
 return {items:items.map((i)=>({offer_id:String(i.offer_id),unit_price:Number(i.unit_price),quantity:Number(i.quantity)})),shipments,units};
}
const pgRefusal=(code:string,check:{constraint?:string;message?:RegExp})=>(error:{code?:string;constraint_name?:string;message?:string})=>
 error.code===code&&(check.constraint===undefined||error.constraint_name===check.constraint)&&(check.message===undefined||check.message.test(error.message??''));
// Rolled-back owner transaction: lets a test attempt a forbidden direct write and observe which database rule refuses it.
async function ownerAttempt(work:(tx:TransactionSql)=>Promise<void>){
 const owner=connectDatabase('test','owner').sql,ROLLBACK=new Error('rollback');
 try{await assert.rejects(owner.begin(async(tx)=>{await work(tx);throw ROLLBACK;}),(e)=>e===ROLLBACK);}finally{await owner.end();}
}
// Payment policy (COD fee) through the real owner flow; restored by the caller (mirrors payment-methods.test.ts).
async function withCodFee(f:Checkout,bps:number){
 const proof=async()=>{const req=f.owner.browser.request('/api/v1/me/reauthentication-proofs',{password:f.owner.password,action:'payment_policy.version',subject_id:'company-payment'});req.headers.set('idempotency-key',randomUUID());const response=await handleAccess(req,f.identity);assert.equal(response.status,201);return (await response.json()).proof as string;};
 const read=async()=>(await (await f.owner.browser.access('/admin/policy-versions?kind=payment')).json()) as {latest_version:number;current:{values:Record<string,unknown>}|null};
 const write=async(values:Record<string,unknown>,reason:string)=>{const history=await read();
  const req=f.owner.browser.request('/api/v1/admin/policy-versions',{kind:'payment',warehouse_id:null,expected_version:history.latest_version,effective_at:null,values,reason,reauthentication_proof:await proof()});
  req.headers.set('idempotency-key',randomUUID());const response=await handleAccess(req,f.identity);assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
  const clock=await readFixtureClock('test',f.namespace),[wall]=await f.identity.sql`select clock_timestamp() now`;
  await advanceFixtureClock('test',f.namespace,Math.max(1,Math.ceil((new Date(wall.now).getTime()-Date.parse(clock.now))/1000)+5),clock.version);};
 const original=(await read()).current?.values??{cod_fee_bps:0,manual_bank_accounts:[]};
 await write({...original,cod_fee_bps:bps},'SYNTHETIC DEC-025 COD fee on mixed prices');
 return ()=>write(original,'SYNTHETIC DEC-025 restore previous payment terms');
}

test('DEC-025 two lines at different prices conserve per-line, cart, quote, order, parcel and unit merchandise',async()=>{
 const f=await checkoutFixture();
 try{
  await reprice(f,SHIRT,PRICE);await reprice(f,CREAM,CREAM_PRICE);
  const shirtId=f.seeded.offers[SHIRT],creamId=f.seeded.offers[CREAM],expected=2*PRICE+CREAM_PRICE;
  const {cart,headers}=await openCart(f.client,[f.line(SHIRT,2),f.line(CREAM,1)]);
  const byOffer=new Map(cart.lines.map((l:{variant_id:string;unit_price:number;line_total:number;quantity:number})=>[l.variant_id,[l.unit_price,l.quantity,l.line_total]]));
  assert.deepEqual(byOffer.get(shirtId),[PRICE,2,2*PRICE]);assert.deepEqual(byOffer.get(creamId),[CREAM_PRICE,1,CREAM_PRICE]);assert.equal(cart.merchandise_total,expected);
  const stored=await f.identity.sql`select offer_id,unit_price from app.cart_line where cart_id=${cart.id}`;
  assert.deepEqual(Object.fromEntries(stored.map((l)=>[l.offer_id,Number(l.unit_price)])),{[shirtId]:PRICE,[creamId]:CREAM_PRICE});
  const quoted=await quoteCart(f,f.client,cart,headers);assert.equal(quoted.response.status,201,JSON.stringify(quoted.payload));
  const [quote]=await f.identity.sql`select merchandise_amount,document from app.checkout_quote where id=${quoted.payload.id}`;assert.equal(Number(quote.merchandise_amount),expected);
  assert.equal(quote.document.selected_plan.merchandise_total,expected);
  assert.equal(quote.document.selected_plan.packages.reduce((n:number,p:{merchandise_amount:number})=>n+p.merchandise_amount,0),expected);
  const submitted=await placeOrder(f.client,quoted.payload.id,cart.version,headers);assert.equal(submitted.response.status,201,JSON.stringify(submitted.payload));
  const orderId=submitted.payload.order.id;assert.equal(submitted.payload.order.merchandise_total,expected);
  const [order]=await f.identity.sql`select merchandise_amount,buyer_total,shipping_amount,subsidy_amount from app.commerce_order where id=${orderId}`;
  assert.equal(Number(order.merchandise_amount),expected);assert.equal(Number(order.buyer_total),expected+Number(order.shipping_amount)-Number(order.subsidy_amount));
  const money=await orderMoney(f.identity.sql,orderId);
  assert.deepEqual(money.items,[{offer_id:shirtId,unit_price:PRICE,quantity:2},{offer_id:creamId,unit_price:CREAM_PRICE,quantity:1}].sort((a,b)=>a.offer_id.localeCompare(b.offer_id)));
  assert.equal(money.shipments.reduce((n,s)=>n+Number(s.merchandise_amount),0),expected);
  for(const s of money.shipments)assert.equal(Number(s.merchandise_amount),Number(s.unit_merchandise),'each parcel merchandise is the sum of its units at their own frozen price');
  assert.deepEqual(money.units.map((u)=>Number(u.unit_price)).sort(),[CREAM_PRICE,PRICE,PRICE].sort());
 }finally{await f.close();}
});

test('DEC-025 COD with mixed prices: per-parcel fee base and per-unit fee shares use each unit price',async()=>{
 const f=await checkoutFixture();let restore:(()=>Promise<void>)|undefined;
 try{
  restore=await withCodFee(f,333);
  await reprice(f,SHIRT,PRICE);await reprice(f,CREAM,CREAM_PRICE);
  const expected=2*PRICE+CREAM_PRICE,{cart,headers}=await openCart(f.client,[f.line(SHIRT,2),f.line(CREAM,1)]);
  const quoted=await quoteCart(f,f.client,cart,headers,'cod');assert.equal(quoted.response.status,201,JSON.stringify(quoted.payload));
  const submitted=await placeOrder(f.client,quoted.payload.id,cart.version,headers);assert.equal(submitted.response.status,201,JSON.stringify(submitted.payload));
  const orderId=submitted.payload.order.id;assert.equal(submitted.payload.order.payment_status,'cod_due');
  const [order]=await f.identity.sql`select merchandise_amount,cod_fee_bps,payment_charge_amount from app.commerce_order where id=${orderId}`;
  assert.equal(Number(order.merchandise_amount),expected);assert.equal(order.cod_fee_bps,333);
  const money=await orderMoney(f.identity.sql,orderId);let total=0;
  for(const s of money.shipments){
   const base=Number(s.merchandise_amount)+Number(s.buyer_shipping),fee=Math.ceil(base*333/10000);
   assert.equal(Number(s.merchandise_amount),Number(s.unit_merchandise));
   assert.equal(Number(s.payment_charge),fee,'COD fee base is frozen merchandise (each unit at its own price) plus buyer shipping');
   assert.equal(Number(s.cod_due),base+fee);total+=fee;
   const units=money.units.filter((u)=>u.shipment_id===s.id);
   const shares=allocateByWeight(fee,units.map((u)=>({id:String(u.id),weight:Number(u.unit_price)+Number(u.buyer_shipping)})));
   for(const u of units)assert.equal(Number(u.payment_charge),shares.get(String(u.id)),'unit fee share is weighted by its own unit price plus shipping share');
   assert.equal(units.reduce((n,u)=>n+Number(u.payment_charge),0),fee);
  }
  assert.ok(total>0);assert.equal(Number(order.payment_charge_amount),total);
  // The mixed parcel really splits by price: the 79,000 unit carries more fee than a 69,000 unit with the same shipping share.
  const cream=money.units.find((u)=>Number(u.unit_price)===CREAM_PRICE),shirt=money.units.find((u)=>Number(u.unit_price)===PRICE&&u.shipment_id===cream?.shipment_id&&Number(u.buyer_shipping)===Number(cream?.buyer_shipping));
  assert.ok(cream&&shirt,'the fixture puts a 79,000 and a 69,000 unit in one parcel with the same shipping share');
  assert.ok(Number(cream.payment_charge)>Number(shirt.payment_charge));
 }finally{try{await restore?.();}finally{await f.close();}}
});

test('DEC-025 a refund of a unit priced below 99,000 allocates exactly that unit price; the database refuses any other unit merchandise',async()=>{
 const f=await approvedRefundFixture('prepaid',{prepare:(shop)=>reprice(shop,SHIRT,PRICE)});
 try{
  const sql=f.identity.sql,[item]=await sql`select unit_price from app.order_item where id=${f.unit.order_item_id}`;assert.equal(Number(item.unit_price),PRICE);
  const [order]=await sql`select merchandise_amount from app.commerce_order where id=${f.order.id}`;assert.equal(Number(order.merchandise_amount),4*PRICE);
  const [returned]=await sql`select id,merchandise_amount,buyer_shipping,payment_charge from app.return_item where case_id=${f.caseId}`;assert.equal(Number(returned.merchandise_amount),PRICE);
  const allocations=await sql`select return_item_id,merchandise_amount,buyer_shipping,payment_charge,amount from app.refund_allocation where refund_id=${f.refund.id}`;
  assert.equal(allocations.length,1);const [allocation]=allocations;
  assert.equal(Number(allocation.merchandise_amount),PRICE,'refund allocation = quantity x frozen unit price');
  assert.equal(Number(allocation.amount),PRICE+Number(f.unit.buyer_shipping)+Number(f.unit.payment_charge));
  const [refund]=await sql`select amount from app.refund where id=${f.refund.id}`;assert.equal(Number(refund.amount),Number(allocation.amount));
  // Direct writes of the former constant are refused by assert_unit_merchandise (other guards are lifted inside the rolled-back transaction).
  await ownerAttempt(async(tx)=>{
   await tx`alter table app.return_item disable trigger return_item_guard`;await tx`alter table app.refund_allocation disable trigger refund_allocation_immutable`;
   for(const amount of [99000,PRICE-1]){
    await assert.rejects(tx.savepoint((sp)=>sp`update app.return_item set merchandise_amount=${amount} where id=${returned.id}`),pgRefusal('23514',{message:/Unit merchandise equals its order item unit price/}));
    await assert.rejects(tx.savepoint((sp)=>sp`update app.refund_allocation set merchandise_amount=${amount},amount=${amount+Number(allocation.buyer_shipping)+Number(allocation.payment_charge)} where refund_id=${f.refund.id} and return_item_id=${allocation.return_item_id}`),pgRefusal('23514',{message:/Unit merchandise equals its order item unit price/}));
   }
  });
 }finally{await f.close();}
});

test('DEC-025 a recovery refund of units priced below 99,000 allocates each unit at its frozen price; the database refuses the former constant',async()=>{
 const f=await fulfillmentFixture('prepaid',{prepare:(shop)=>reprice(shop,SHIRT,PRICE)}),sql=f.identity.sql;let finance:Awaited<ReturnType<typeof actor>>|undefined;
 try{
  finance=await actor(f.identity,'finance',[]);await enroll(finance.browser,finance.password);
  await sql`update app.role_grant set permissions=${['finance.refunds.read','finance.refunds.write']},revision=revision+1 where user_id=${finance.id}`;
  const call=async(staff:{browser:{request:(p:string,b?:Record<string,unknown>)=>Request}},path:string,body:Record<string,unknown>)=>{const request=staff.browser.request(path,body);request.headers.set('idempotency-key',randomUUID());const response=await handleCommerceExceptions(request,f.identity);return {status:response.status,payload:await response.json()};};
  const parcel=f.parcels[0],units=await sql<{id:string}[]>`select id from app.fulfillment_item where shipment_id=${parcel.shipment_id} order by id`;
  const balances=await sql`select distinct a.balance_id,a.stock_item_id,b.revision from app.fulfillment_component_allocation a join app.inventory_balance b on b.id=a.balance_id where a.fulfillment_item_id in ${sql(units.map((u)=>u.id))} order by a.balance_id`;
  const reported=await call(f.owner,'/api/v1/admin/commerce-exceptions',{fulfillment_id:parcel.id,fulfillment_item_ids:units.map((u)=>u.id),expected_version:1,reason:'SYNTHETIC DEC-025 shortage at a non-ceiling price',
   observed_components:balances.map((b,index)=>({balance_id:b.balance_id,stock_item_id:b.stock_item_id,expected_balance_version:Number(b.revision),missing_quantity:index===0?1:0}))});
  assert.equal(reported.status,201,JSON.stringify(reported.payload));const exceptionId=String(reported.payload.id);
  const proposed=await call(f.owner,`/api/v1/admin/commerce-exceptions/${exceptionId}/decisions`,{expected_version:1,decision:'propose_cancellation',reason:'SYNTHETIC propose cancelling affected units'});assert.equal(proposed.status,201,JSON.stringify(proposed.payload));
  const proposalId=String(proposed.payload.proposal.id),accept=f.client.request(`/api/v1/orders/${f.order.id}/recovery-actions`,{exception_id:exceptionId,expected_version:2,action:'accept_proposal',proposal_id:proposalId});
  accept.headers.set('idempotency-key',randomUUID());assert.equal((await handleCommerceExceptions(accept,f.identity)).status,201);
  assert.equal((await call(f.owner,`/api/v1/admin/commerce-exceptions/${exceptionId}/decisions`,{expected_version:3,proposal_id:proposalId,reason:'SYNTHETIC apply buyer-accepted cancellation'})).status,201);
  const [session]=await sql`select id from app.auth_session where user_id=${finance.id} order by created_at desc limit 1`,proof=`recovery-proof-${randomUUID()}`;
  await sql`insert into app.access_proof (digest,session_id,action,subject_id,expires_at) values (${createHash('sha256').update(proof).digest('hex')},${session.id},'finance.recovery_refund',${exceptionId},clock_timestamp()+interval '5 minutes')`;
  const queued=await call(finance,`/api/v1/admin/commerce-exceptions/${exceptionId}/refunds`,{expected_version:4,reason:'SYNTHETIC queue DEC-025 recovery refund',reauthentication_proof:proof});
  assert.equal(queued.status,201,JSON.stringify(queued.payload));const refundId=String(queued.payload.refunds[0].id);
  const allocations=await sql`select a.id,a.merchandise_amount,a.buyer_shipping,a.payment_charge,a.amount,fi.buyer_shipping unit_shipping,fi.payment_charge unit_charge from app.recovery_refund_allocation a join app.fulfillment_item fi on fi.id=a.fulfillment_item_id where a.refund_id=${refundId}`;
  assert.ok(allocations.length>0,'the cancelled units are refunded per unit');
  for(const a of allocations){assert.equal(Number(a.merchandise_amount),PRICE,'recovery allocation = frozen unit price');assert.equal(Number(a.amount),PRICE+Number(a.buyer_shipping)+Number(a.payment_charge));}
  const [refund]=await sql`select amount from app.recovery_refund where id=${refundId}`;
  assert.equal(Number(refund.amount),(await sql`select sum(amount)::bigint n from app.recovery_refund_allocation where refund_id=${refundId}`)[0].n*1);
  await ownerAttempt(async(tx)=>{
   await tx`alter table app.recovery_refund_allocation disable trigger recovery_refund_allocation_immutable`;
   const [a]=allocations;
   for(const amount of [99000,PRICE+1])await assert.rejects(tx.savepoint((sp)=>sp`update app.recovery_refund_allocation set merchandise_amount=${amount},amount=${amount+Number(a.buyer_shipping)+Number(a.payment_charge)} where id=${a.id}`),pgRefusal('23514',{message:/Unit merchandise equals its order item unit price/}));
  });
 }finally{try{if(finance)await closeFulfillmentActor(f.identity,finance);}finally{await f.close();}}
});

test('DEC-025 attributed order with mixed prices below 99,000 accrues each unit commission from its own frozen price',async()=>{
 const f=await checkoutFixture(),affiliate=await actor(f.identity,'affiliate',[]),sql=f.identity.sql;
 try{
  const enrollRequest=affiliate.browser.request('/api/v1/me/affiliate',{terms_version:'v1',referral_code:`PRICE-${randomUUID().slice(0,8).toUpperCase()}`});enrollRequest.headers.set('idempotency-key',randomUUID());
  const enrolled=await handleAffiliateProfile(enrollRequest,f.identity);assert.equal(enrolled.status,201);const profile=await enrolled.json();
  await reprice(f,SHIRT,PRICE);await reprice(f,CREAM,CREAM_PRICE);
  const client=new CommerceClient(f.identity),key=randomUUID(),body={lines:[f.line(SHIRT,2),f.line(CREAM,1)]};
  let cart=await client.call('/api/v1/carts',body,{key});if(cart.response.status===401)cart=await client.call('/api/v1/carts',body,{key});assert.equal(cart.response.status,201,JSON.stringify(cart.payload));
  const buyer=await commerceActor(client.request('/api/v1/carts'),f.identity);assert.ok(buyer);
  const quoteInput={cart_id:cart.payload.cart.id,address:f.address,contact:f.contact(),payment_method:'prepaid' as const};
  // createQuote runs assert_attributed_checkout_cost (0044), which recomputes each line's commission from the frozen offer price.
  const quote=await sql.begin((tx)=>createQuote(tx,client.request('/api/v1/checkout/quotes',quoteInput,{version:1}),f.identity,buyer,quoteInput,{affiliate_id:profile.id})) as {id:string};
  const [stored]=await sql`select merchandise_amount,document from app.checkout_quote where id=${quote.id}`;assert.equal(Number(stored.merchandise_amount),2*PRICE+CREAM_PRICE);assert.equal(stored.document.affiliate_id,profile.id);
  const submitted=await sql.begin((tx)=>submitOrder(tx,client.request('/api/v1/orders',{quote_id:quote.id},{version:1}),f.identity,buyer,{quote_id:quote.id}));
  const accrued=await sql.begin((tx)=>accrueOrderCommissions(tx,{orderId:submitted.order.id}));assert.equal(accrued.length,3,'one commission per purchased unit');
  const prices=new Map((await sql`select fi.id,i.unit_price from app.fulfillment_item fi join app.order_item i on i.id=fi.order_item_id where i.order_id=${submitted.order.id}`).map((r)=>[String(r.id),Number(r.unit_price)]));
  const bps=Number(accrued[0].basis_points);assert.ok(bps>0);
  for(const entry of accrued){const price=prices.get(String(entry.fulfillment_item_id));assert.ok(price);
   assert.equal(Number(entry.merchandise_amount),price);assert.equal(Number(entry.amount_idr),offerCommissionIdr(bps,price),'commission uses the unit price, not the 99,000 ceiling');}
  const total=accrued.reduce((n,e)=>n+Number(e.amount_idr),0);
  assert.equal(total,offerCommissionIdr(bps,PRICE)*2+offerCommissionIdr(bps,CREAM_PRICE));assert.notEqual(total,offerCommissionIdr(bps,99000)*3);
 }finally{try{await closeFulfillmentActor(f.identity,affiliate);}finally{await f.close();}}
});

test('DEC-025 a later price change never rewrites an existing cart, quote or order; approving the new publication re-freezes the line',async()=>{
 const f=await checkoutFixture(),NEW_PRICE=59000;
 try{
  const shirtId=f.seeded.offers[SHIRT],first=await reprice(f,SHIRT,PRICE);
  const open1=await openCart(f.client,[f.line(SHIRT,1)]),quote1=await quoteCart(f,f.client,open1.cart,open1.headers);assert.equal(quote1.response.status,201,JSON.stringify(quote1.payload));
  const open2=await openCart(f.client,[f.line(SHIRT,2)]),quote2=await quoteCart(f,f.client,open2.cart,open2.headers);assert.equal(quote2.response.status,201,JSON.stringify(quote2.payload));
  const placed=await placeOrder(f.client,quote2.payload.id,open2.cart.version,open2.headers);assert.equal(placed.response.status,201,JSON.stringify(placed.payload));const orderId=placed.payload.order.id;
  const second=await reprice(f,SHIRT,NEW_PRICE);assert.notEqual(second,first);
  // Existing records keep the price frozen at their own publication.
  const [line]=await f.identity.sql`select id,unit_price,publication_id from app.cart_line where cart_id=${open1.cart.id}`;assert.equal(Number(line.unit_price),PRICE);assert.equal(line.publication_id,first);
  const [q1]=await f.identity.sql`select merchandise_amount from app.checkout_quote where id=${quote1.payload.id}`;assert.equal(Number(q1.merchandise_amount),PRICE);
  const money=await orderMoney(f.identity.sql,orderId);assert.deepEqual(money.items,[{offer_id:shirtId,unit_price:PRICE,quantity:2}]);
  assert.equal(Number((await f.identity.sql`select merchandise_amount from app.commerce_order where id=${orderId}`)[0].merchandise_amount),2*PRICE);
  assert.equal(money.shipments.reduce((n,s)=>n+Number(s.merchandise_amount),0),2*PRICE);
  const viewed=await f.client.call(`/api/v1/carts/${open1.cart.id}`,undefined,{headers:open1.headers});assert.equal(viewed.response.status,200,JSON.stringify(viewed.payload));
  const shown=viewed.payload.cart??viewed.payload;assert.equal(shown.lines[0].unit_price,PRICE);assert.equal(shown.lines[0].publication_changed,true);
  // The stale quote, a new quote and a stale add all require review of the new publication.
  const stale=await placeOrder(f.client,quote1.payload.id,open1.cart.version,open1.headers);assert.equal(stale.response.status,409,JSON.stringify(stale.payload));assert.equal(stale.payload.code,'PUBLICATION_REVIEW_REQUIRED');
  const requote=await quoteCart(f,f.client,open1.cart,open1.headers);assert.equal(requote.response.status,409,JSON.stringify(requote.payload));assert.equal(requote.payload.code,'PUBLICATION_REVIEW_REQUIRED');
  const staleAdd=await f.client.call(`/api/v1/carts/${open1.cart.id}/lines`,{variant_id:shirtId,quantity:1,expected_publication_id:first},{version:open1.cart.version,headers:open1.headers});
  assert.equal(staleAdd.response.status,409,JSON.stringify(staleAdd.payload));assert.equal(staleAdd.payload.code,'PUBLICATION_REVIEW_REQUIRED');
  // Approving the latest content re-freezes the line at the new price; old quote and order stay unchanged.
  const approved=await f.client.call(`/api/v1/carts/${open1.cart.id}/lines/${line.id}`,{quantity:1,expected_version:open1.cart.version,expected_publication_id:second},{method:'PATCH',headers:open1.headers});
  assert.equal(approved.response.status,200,JSON.stringify(approved.payload));
  assert.equal(approved.payload.lines[0].unit_price,NEW_PRICE);assert.equal(approved.payload.lines[0].line_total,NEW_PRICE);assert.equal(approved.payload.merchandise_total,NEW_PRICE);assert.equal(approved.payload.lines[0].publication_changed,false);
  const [refrozen]=await f.identity.sql`select unit_price,publication_id from app.cart_line where id=${line.id}`;assert.equal(Number(refrozen.unit_price),NEW_PRICE);assert.equal(refrozen.publication_id,second);
  const requoted=await quoteCart(f,f.client,{id:open1.cart.id,version:approved.payload.version},open1.headers);assert.equal(requoted.response.status,201,JSON.stringify(requoted.payload));
  assert.equal(Number((await f.identity.sql`select merchandise_amount from app.checkout_quote where id=${requoted.payload.id}`)[0].merchandise_amount),NEW_PRICE);
  assert.equal(Number((await f.identity.sql`select merchandise_amount from app.checkout_quote where id=${quote1.payload.id}`)[0].merchandise_amount),PRICE);
  assert.deepEqual((await orderMoney(f.identity.sql,orderId)).items,[{offer_id:shirtId,unit_price:PRICE,quantity:2}]);
 }finally{await f.close();}
});

test('DEC-025 the database refuses a direct price write of 0 or 99,001 on offer revision, cart line and order item',async()=>{
 const f=await checkoutFixture();
 try{
  const offerId=f.seeded.offers[SHIRT],{cart,headers}=await openCart(f.client,[f.line(SHIRT,1)]);
  const quoted=await quoteCart(f,f.client,cart,headers);assert.equal(quoted.response.status,201);
  const placed=await placeOrder(f.client,quoted.payload.id,cart.version,headers);assert.equal(placed.response.status,201,JSON.stringify(placed.payload));
  const [item]=await f.identity.sql`select id from app.order_item where order_id=${placed.payload.order.id}`;
  // The app role cannot bypass the freezing triggers; the owner lifts every user trigger so only the CHECK constraint is left to refuse.
  await ownerAttempt(async(tx)=>{
   for(const table of ['offer_revision','cart_line','order_item'])await tx.unsafe(`alter table app.${table} disable trigger user`);
   for(const price of [0,99001]){
    await assert.rejects(tx.savepoint((sp)=>sp`update app.offer_revision set price=${price} where offer_id=${offerId}`),pgRefusal('23514',{constraint:'offer_price_ceiling_check'}));
    await assert.rejects(tx.savepoint((sp)=>sp`update app.cart_line set unit_price=${price} where cart_id=${cart.id}`),pgRefusal('23514',{constraint:'cart_line_value_check'}));
    await assert.rejects(tx.savepoint((sp)=>sp`update app.order_item set unit_price=${price} where id=${item.id}`),pgRefusal('23514',{constraint:'order_item_value_check'}));
   }
   // Control: the same direct write inside the ceiling is accepted, so the refusals above are the price rule and nothing else.
   await tx.savepoint((sp)=>sp`update app.order_item set unit_price=1 where id=${item.id}`);
  });
  // With triggers in force, the app role cannot rewrite a purchased unit price at all (immutability trigger); the frozen price stays.
  await assert.rejects(f.identity.sql`update app.order_item set unit_price=1 where id=${item.id}`,(e:{code?:string;message?:string})=>e.code==='23514'&&/revision history are immutable/.test(e.message??''));
  assert.equal(Number((await f.identity.sql`select unit_price from app.order_item where id=${item.id}`)[0].unit_price),99000);
 }finally{await f.close();}
});
