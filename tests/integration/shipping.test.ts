import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {appendCostVersion} from '../../src/modules/finance/costs.ts';
import {buildShippingPlans} from '../../src/modules/shipping/quotes.ts';
import {localRateAdapter} from '../../src/modules/shipping/rates.ts';
import {shippingFixture,denied} from './shipping-fixture.ts';

test('real stock-feasible consolidated/split plans compare exact supported charges and preserve every complete offer quantity',async()=>{
 const f=await shippingFixture();try{
  const lines=[f.line('fixture-offer-shirt'),f.line('fixture-offer-cream-pack')];const plans=await f.plans(lines);
  assert.equal(plans[0].shipping_total,8000);assert.equal(plans[0].packages.length,1);
  assert.ok(plans.some((p)=>p.packages.length===2));assert.ok(plans.filter((p)=>p.packages.length===1).length>=2);
  for(const plan of plans){assert.equal(plan.shipping_total,plan.packages.reduce((n,p)=>n+p.shipping_amount,0));assert.equal(plan.merchandise_total,198000);
   assert.equal(new Set(plan.packages.map((p)=>p.id)).size,plan.packages.length);
   for(const line of lines) assert.equal(plan.packages.flatMap((p)=>p.lines).filter((l)=>l.line_id===line.line_id).reduce((n,l)=>n+l.quantity,0),line.quantity);
  }
  const split=await f.plans([f.line('fixture-offer-shirt',4),f.line('fixture-offer-cream-pack')]);assert.equal(split[0].shipping_total,35000);assert.equal(split[0].packages.length,2);
  const [position]=await f.identity.sql`select on_hand,reserved,quarantined from app.inventory_balance where id=${f.seeded.positions['fixture-malang:fixture-shirt']}`;assert.deepEqual(position,{on_hand:5,reserved:1,quarantined:1},'A preview never creates a stock/money effect');
  const cod=await f.plans(lines,'cod');assert.equal(cod[0].shipping_total,10000);assert.ok(cod.every((p)=>p.packages.every((g)=>g.options.every((r)=>r.supports_cod))));
  await assert.rejects(f.plans(lines,'cod','test-prepaid-only'),denied('COD_UNAVAILABLE'));await assert.rejects(f.plans(lines,'prepaid','test-no-route'),denied('NO_SUPPORTED_ROUTE'));
 }finally{await f.close();}
});

test('bundle contents never combine different warehouses and multiple offers share one physical SKU capacity',async()=>{
 const f=await shippingFixture();try{
  const [shirt]=await f.identity.sql`select name from app.stock_item where id=${f.seeded.stocks['fixture-shirt']}`;const [cream]=await f.identity.sql`select name from app.stock_item where id=${f.seeded.stocks['fixture-cream']}`;
  const [category]=await f.identity.sql`select category_id from app.product_revision where product_id=${f.seeded.products['fixture-offer-shirt']} and revision=1`;
  const [warehouse]=await f.identity.sql`select warehouse_id from app.inventory_balance where id=${f.seeded.positions['fixture-malang:fixture-shirt']}`;
  const product=await f.catalog('/products',{name:'Synthetic complete bundle',description:'Synthetic allocation fixture',category_id:category.category_id,images:[{url:'http://127.0.0.1:3099/fixtures/mixed.svg',alt:'Synthetic bundle',width:480,height:600}],variants:[{sku:`SHIP-${randomUUID()}`.toUpperCase(),label:'Synthetic shirt cream bundle',attributes:[],offer_kind:'bundle',weight_grams:500,length_mm:200,width_mm:150,height_mm:100,default_warehouse_id:warehouse.warehouse_id,
   contents:[{stock_item_id:f.seeded.stocks['fixture-shirt'],name:shirt.name,quantity:1},{stock_item_id:f.seeded.stocks['fixture-cream'],name:cream.name,quantity:1}]}]});
  const req=f.request();req.headers.set('idempotency-key',randomUUID());await appendCostVersion(req,f.identity,f.principal,'assumption',product.variants[0].id,{expected_version:0,effective_from:null,packaging_idr:1000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000,source:'TEST-ONLY shipping fixture',reason:'Guarded bundle assumptions'});
  const published=await f.catalog(`/products/${product.id}/publications`,{expected_version:1,expected_publication_version:0,reason:'Guarded synthetic bundle publication'});
  const bundle={line_id:'bundle',product_id:product.id,offer_id:product.variants[0].id,publication_id:published.id,quantity:1};assert.ok((await f.plans([bundle])).length>0);
  await assert.rejects(f.plans([f.line('fixture-offer-shirt',3),{...bundle,quantity:3}]),denied('INSUFFICIENT_COMPLETE_STOCK'));
  await f.move('fixture-malang:fixture-shirt','adjust_down',3);await f.move('fixture-pontianak:fixture-cream','adjust_down',4);
  // Aggregate warehouse stock has every component, but neither warehouse has a
  // complete physical bundle. Splitting its contents must still be refused.
  await assert.rejects(f.plans([bundle]),denied('INSUFFICIENT_COMPLETE_STOCK'));
 }finally{await f.close();}
});

test('upright physical package limits create distinct parcels rather than silently overfilling one package',async()=>{
 const f=await shippingFixture();try{
  await f.move('fixture-malang:fixture-shirt','receive',20);
  const plans=await f.plans([f.line('fixture-offer-shirt',12)]);assert.ok(plans.length>0);assert.ok(plans[0].packages.length>=2);
  for(const plan of plans) assert.equal(new Set(plan.packages.map((p)=>p.id)).size,plan.packages.length);assert.ok(plans[0].packages.every((p)=>p.measures.height_mm<=1000));
  assert.equal(plans[0].packages.flatMap((p)=>p.lines).reduce((n,l)=>n+l.quantity,0),12);
  await assert.rejects(f.plans([f.line('fixture-offer-shirt',51)]),denied('ALLOCATION_REVIEW_REQUIRED'));
 }finally{await f.close();}
});

test('changed publication/cost, expired or timed-out rates require review/retry and leave actual stock unchanged',async()=>{
 const f=await shippingFixture();try{
  const lines=[f.line('fixture-offer-shirt')];await assert.rejects(f.plans([{...lines[0],publication_id:randomUUID()}]),denied('PUBLICATION_REVIEW_REQUIRED'));
  const body={lines,payment_method:'prepaid',destination_id:'test-malang'};
  await assert.rejects(f.identity.sql.begin((tx)=>buildShippingPlans(tx,body,{clock_namespace:f.namespace,adapter:{async estimate(request,signal){return (await localRateAdapter.estimate(request,signal)).map((r)=>({...r,expires_at:new Date(Date.parse(request.now)-1).toISOString()}));}}})),denied('SHIPPING_RATE_EXPIRED'));
  await assert.rejects(f.identity.sql.begin((tx)=>buildShippingPlans(tx,body,{clock_namespace:f.namespace,adapter:{async estimate(){return new Promise(()=>{});}}})),denied('SHIPPING_RATE_TIMEOUT'));
  const req=f.request();req.headers.set('idempotency-key',randomUUID());await appendCostVersion(req,f.identity,f.principal,'component',f.seeded.stocks['fixture-shirt'],{expected_version:1,unit_cost:31000,effective_from:null,source:'Synthetic changed supplier estimate',reason:'Requote requires renewed current financial review'});
  await assert.rejects(f.plans(lines),denied('PUBLICATION_REVIEW_REQUIRED'));
  const [stock]=await f.identity.sql`select on_hand,reserved,quarantined from app.inventory_balance where id=${f.seeded.positions['fixture-malang:fixture-shirt']}`;assert.deepEqual(stock,{on_hand:5,reserved:1,quarantined:1});
 }finally{await f.close();}
});

test('warehouse deactivation while quote waits is rechecked before choosing a supported origin',async()=>{
 const f=await shippingFixture();let unlock=()=>{};
 try{
  const [origin]=await f.identity.sql`select warehouse_id from app.inventory_balance where id=${f.seeded.positions['fixture-malang:fixture-shirt']}`;
  let ready=()=>{};const locked=new Promise<void>((r)=>{ready=r;});const held=new Promise<void>((r)=>{unlock=r;});
  const blocker=f.identity.sql.begin(async(tx)=>{await tx`update app.warehouse set active=false where id=${origin.warehouse_id}`;ready();await held;});
  let pending:ReturnType<typeof f.plans>|undefined;
  try{
   await locked;pending=f.plans([f.line('fixture-offer-shirt')]);const {setTimeout}=await import('node:timers/promises');let waiting=0;
   for(let i=0;i<100;i++){const [row]=await f.identity.sql`select count(*)::int as n from pg_stat_activity where datname='99ribu_test' and wait_event_type='Lock' and query like '%for share of w%'`;waiting=row.n;if(waiting===1) break;await setTimeout(20);}
   assert.equal(waiting,1);unlock();await blocker;const plans=await pending;assert.equal(plans[0].shipping_total,23000);
   assert.ok(plans.every((p)=>p.packages.every((g)=>g.warehouse_id!==origin.warehouse_id)));
  }finally{unlock();await blocker;await pending;}
 }finally{unlock();await f.close();}
});
