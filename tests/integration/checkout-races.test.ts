import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {checkoutFixture,CommerceClient,ownShippingCampaign} from './checkout-fixture.ts';
import {handleCheckout} from '../../src/modules/checkout/routes.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {capability,commerceActor,prefix} from '../../src/modules/checkout/access.ts';
import {appendCostVersion} from '../../src/modules/finance/costs.ts';
import {estimateRates,localRateAdapter,type RateRequest} from '../../src/modules/shipping/rates.ts';
import {normalizeAddress} from '../../src/modules/shipping/destinations.ts';

async function quote(f:Awaited<ReturnType<typeof checkoutFixture>>,client:CommerceClient,quantity:number,namespace:string|null=null){
 const key=randomUUID(),input={lines:[f.line('fixture-offer-shirt',quantity)]};assert.equal((await client.call('/api/v1/carts',input,{key})).response.status,401);
 let created:{payload:{cart:{id:string;lines:{id:string}[]}}};
 if(namespace){const request=client.request('/api/v1/carts',input,{key});const actor=await commerceActor(request,f.identity);assert.ok(actor?.kind==='guest');const result=await f.identity.sql.begin(tx=>createCart(tx,request,f.identity,actor,input,{clock_namespace:namespace}));const p=await prefix(f.identity),token=await capability(f.identity,'cart',result.cart.id,actor.id,result.cart.cap_issued_at as string);client.cookies.set(`${p}.cart_access:/`,{name:`${p}.cart_access`,value:`${result.cart.id}.${token}`,path:'/'});created={payload:{cart:result.response}};}
 else{const response=await client.call('/api/v1/carts',input,{key});assert.equal(response.response.status,201);created=response;}

 const q=await client.call('/api/v1/checkout/quotes',{cart_id:created.payload.cart.id,address:f.address,contact:f.contact(),payment_method:'prepaid'},{version:1});assert.equal(q.response.status,201);return {cart:created.payload.cart,quote:q.payload};
}
test('two-warehouse concurrent identical submits and lost response replay disclose one conserved order and two original groups',async()=>{
 const f=await checkoutFixture();try{
  const c=await quote(f,f.client,5),key=randomUUID(),body={quote_id:c.quote.id};assert.equal(c.quote.packages.length,2);
  const results=await Promise.all([f.client.call('/api/v1/orders',body,{key,version:1}),f.client.call('/api/v1/orders',body,{key,version:1})]);
  assert.ok(results.every(r=>r.response.status===201));assert.equal(results[0].payload.order.id,results[1].payload.order.id);
  const [count]=await f.identity.sql`select count(*)::int n from app.commerce_order where cart_id=${c.cart.id}`;assert.equal(count.n,1);
  const output=results[0].payload.order;assert.equal(output.buyer_total,c.quote.buyer_total);assert.equal(output.shipments.length,2);
  const parcels=await f.identity.sql`select s.id,s.parcel_id,s.warehouse_id,i.line_id,count(*)::int quantity from app.order_shipment s join app.fulfillment_item f on f.shipment_id=s.id join app.order_item i on i.id=f.order_item_id where s.order_id=${output.id} group by s.id,s.parcel_id,s.warehouse_id,i.line_id`;
  assert.equal(new Set(parcels.map(p=>p.warehouse_id)).size,2);
  for(const quoted of c.quote.packages){const actual=parcels.filter(p=>p.parcel_id===quoted.id);assert.deepEqual(actual.map(p=>({cart_line_id:p.line_id,quantity:p.quantity})).sort((a,b)=>a.cart_line_id.localeCompare(b.cart_line_id)),quoted.lines.map((l:{cart_line_id:string;quantity:number})=>({cart_line_id:l.cart_line_id,quantity:l.quantity})).sort((a:{cart_line_id:string},b:{cart_line_id:string})=>a.cart_line_id.localeCompare(b.cart_line_id)));assert.ok(output.shipments.some((s:{id:string})=>s.id===actual[0]?.id));}
  assert.equal((await f.client.call('/api/v1/orders',body,{key,version:1})).payload.order.id,results[0].payload.order.id);
  assert.equal((await f.client.call('/api/v1/orders',body,{version:1})).response.status,409);
 }finally{await f.close();}
});
test('two fully quoted buyers racing for the same physical stock yield one atomic order, with no losing subsidy hold',async()=>{
 const f=await checkoutFixture();let campaign:Awaited<ReturnType<typeof ownShippingCampaign>>|undefined;
 try{
  campaign=await ownShippingCampaign(f,['prepaid']);
  const second=new CommerceClient(f.identity);const a=await quote(f,f.client,5,f.namespace),b=await quote(f,second,5,f.namespace);assert.equal(a.quote.subsidy_total,3000);assert.equal(b.quote.subsidy_total,3000);
  const [before]=await f.identity.sql`select coalesce(sum(reserved_amount),0)::text amount from app.promotion`;
  const results=await Promise.all([f.client.call('/api/v1/orders',{quote_id:a.quote.id},{version:1}),second.call('/api/v1/orders',{quote_id:b.quote.id},{version:1})]);
  assert.deepEqual(results.map(r=>r.response.status).sort(),[201,409]);assert.equal(results.find(r=>r.response.status===409)?.payload.code,'INSUFFICIENT_STOCK');const winner=results[0].response.status===201?a:b;
  const [after]=await f.identity.sql`select coalesce(sum(reserved_amount),0)::text amount from app.promotion`;
  assert.equal(BigInt(after.amount)-BigInt(before.amount),BigInt(winner.quote.subsidy_total));
  const [count]=await f.identity.sql`select count(*)::int n from app.commerce_order where cart_id in (${a.cart.id},${b.cart.id})`;assert.equal(count.n,1);
  const [stock]=await f.identity.sql`select sum(reserved)::int n from app.inventory_balance where stock_item_id=${f.seeded.stocks['fixture-shirt']}`;assert.equal(stock.n,6);
 }finally{if(campaign) await campaign.close();await f.close();}
});
test('current version/publication, closed inputs, recipient controls and remaining rate budget reject unsafe checkout intent',async()=>{
 const f=await checkoutFixture();try{
  const c=await quote(f,f.client,1);
  const body={cart_id:c.cart.id,address:f.address,contact:f.contact(),payment_method:'prepaid'};
  assert.equal((await f.client.call('/api/v1/checkout/quotes',body)).response.status,428);
  assert.equal((await f.client.call('/api/v1/checkout/quotes',body,{version:2})).response.status,409);
  assert.equal((await f.client.call('/api/v1/checkout/quotes',{...body,clock_namespace:f.namespace},{version:1})).response.status,400);
  assert.equal((await f.client.call(`/api/v1/carts/${c.cart.id}/lines`,{...f.line(),expected_publication_id:randomUUID()},{version:1})).response.status,409);
  for(const character of ['\u0085','\u202e','\u2066']) await assert.rejects(normalizeAddress(f.identity.sql,{...f.address,recipient_name:`Synthetic${character}Recipient`}),{code:'INVALID_INPUT'});
  const linePath=`/api/v1/carts/${c.cart.id}/lines/${c.cart.lines[0].id}`;
  const empty=f.client.request(linePath,undefined,{method:'DELETE',version:1});
  const bad=new Request(empty,{body:new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));controller.close();}}),duplex:'half'} as RequestInit&{duplex:'half'});assert.equal((await handleCheckout(bad,f.identity)).status,400);
  const streamed=new Request(empty,{body:new ReadableStream({start(controller){controller.close();}}),duplex:'half'} as RequestInit&{duplex:'half'});assert.equal((await handleCheckout(streamed,f.identity)).status,200);
  const request:RateRequest={warehouse_id:randomUUID(),origin:{province:'Jawa Timur',city:'Malang',district:'Kecamatan Gudang Contoh A'},origin_area_id:null,destination_id:'test-malang',measures:{weight_grams:100,length_mm:100,width_mm:100,height_mm:100},now:new Date().toISOString()};
  const started=performance.now();await assert.rejects(estimateRates({source:'TEST-ONLY',version:localRateAdapter.version,async estimate(){return new Promise(()=>{});}},request,40),{code:'SHIPPING_RATE_TIMEOUT'});assert.ok(performance.now()-started<1000);
 }finally{await f.close();}
});


test('a scheduled cost becoming effective during the real balance wait rolls back the complete order and subsidy claim',async()=>{
 const f=await checkoutFixture();let release:()=>void=()=>{};let blocker:Promise<unknown>|undefined;
 try{
  const c=await quote(f,f.client,2);const effective=new Date(Date.now()+4000).toISOString();const req=f.request();req.headers.set('idempotency-key',randomUUID());
  await appendCostVersion(req,f.identity,f.principal,'component',f.seeded.stocks['fixture-shirt'],{expected_version:1,unit_cost:31000,effective_from:effective,source:'TEST-ONLY scheduled supplier estimate',reason:'Verify current sources after stock wait'});
  let acquired:(pid:number)=>void=()=>{};const locked=new Promise<number>(resolve=>{acquired=resolve;});const barrier=new Promise<void>(resolve=>{release=resolve;});
  blocker=f.identity.sql.begin(async tx=>{await tx`select id from app.inventory_balance where stock_item_id=${f.seeded.stocks['fixture-shirt']} order by id for update`;const [p]=await tx`select pg_backend_pid() pid`;acquired(p.pid);await barrier;});
  const pid=await locked;const submission=f.client.call('/api/v1/orders',{quote_id:c.quote.id},{version:1});let waited=false;const deadline=Date.now()+2000;
  while(Date.now()<deadline){const [state]=await f.identity.sql`select exists(select 1 from pg_stat_activity where ${pid}=any(pg_blocking_pids(pid))) blocked`;if(state.blocked){waited=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
  assert.ok(waited,'Submission must actually wait on the held inventory row');
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(effective)-Date.now()+30)));release();await blocker;blocker=undefined;
  const result=await submission;assert.equal(result.response.status,409);assert.equal(result.payload.code,'PUBLICATION_REVIEW_REQUIRED');
  const [counts]=await f.identity.sql`select (select count(*)::int from app.commerce_order where cart_id=${c.cart.id}) orders,(select count(*)::int from app.stock_reservation where key like 'checkout:%' and id in (select stock_reservation_id from app.commerce_order where cart_id=${c.cart.id})) holds`;assert.equal(counts.orders,0);assert.equal(counts.holds,0);
  const [stock]=await f.identity.sql`select sum(reserved)::int n from app.inventory_balance where stock_item_id=${f.seeded.stocks['fixture-shirt']}`;assert.equal(stock.n,1);
 }finally{release();if(blocker) await blocker;await f.close();}
});
