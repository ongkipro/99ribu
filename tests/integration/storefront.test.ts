import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {readCatalogRevision,patchProduct} from '../../src/modules/catalog/catalog.ts';
import {appendCostVersion} from '../../src/modules/finance/costs.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {catalogQuery,listProducts,publicProduct,matchingVariant} from '../../src/modules/storefront/catalog.ts';
import {shippingFixture,denied} from './shipping-fixture.ts';

test('storefront curation converges through guarded writers and preserves draft, unknown HPP and financial edits',async()=>{
 const f=await shippingFixture();try{
  const curate=()=>prepareStorefront(f.request(),f.identity,'test',f.namespace,f.seeded);
  const [first,again]=await Promise.all([curate(),curate()]);assert.deepEqual(first,again);assert.equal(Object.keys(first.products).length,4);
  for(const product of Object.values(first.products)) assert.ok(product.publication_id);
  const shirt=first.products.shirt,principal=await getPrincipal(f.request(),f.identity);
  const request=f.request();request.headers.set('idempotency-key',randomUUID());await patchProduct(request,f.identity,principal,shirt.id,{expected_version:1,name:'Preserved operator draft',reason:'Synthetic operator edit'});
  const cost=f.request();cost.headers.set('idempotency-key',randomUUID());await appendCostVersion(cost,f.identity,principal,'component',f.seeded.stocks['fixture-shirt'],{expected_version:1,unit_cost:31000,effective_from:null,source:'Synthetic corrected HPP',reason:'Preserve operator costing'});
  const final=await curate();assert.equal(final.products.shirt.id,shirt.id);assert.equal(final.products.shirt.publication_id,shirt.publication_id);assert.equal(final.products.shirt.preserved,true);
  assert.equal((await readCatalogRevision(f.identity.sql,shirt.id)).name,'Preserved operator draft');
  const [unknown]=await f.identity.sql`select unit_cost from app.component_cost_version where stock_item_id=${f.seeded.stocks['fixture-bag']}`;assert.equal(unknown.unit_cost,null);
  assert.equal(await f.identity.sql.begin(tx=>publicProduct(tx,shirt.id)),null);
  await assert.rejects(prepareStorefront(f.request(),f.identity,'local',f.namespace,f.seeded),denied('INVALID_INPUT'));
  await assert.rejects(prepareStorefront(f.request(),f.identity,'test','wrong-namespace',f.seeded),denied('INVALID_INPUT'));
 }finally{await f.close();}
});

test('public reads use frozen approved names, exact offer contents and whole-offer stock without leaking private sources',async()=>{
 const f=await shippingFixture();try{
  const curated=await prepareStorefront(f.request(),f.identity,'test',f.namespace,f.seeded),pair=curated.products['shirt-pair'];
  let product=await f.identity.sql.begin(tx=>publicProduct(tx,pair.id));assert.ok(product);assert.equal(product.variants[0].price,99000);assert.equal(product.variants[0].contents[0].quantity,2);assert.equal(product.variants[0].availability,'available');
  assert.deepEqual(Object.keys(product.variants[0].contents[0]).sort(),['name','quantity']);
  for(const key of ['sku','warehouse_id','stock_item_id','estimated_hpp','cost_version_id','assumption_version_id']) assert.ok(!JSON.stringify(product).includes(`"${key}"`));
  const request=f.request();request.headers.set('idempotency-key',randomUUID());await patchProduct(request,f.identity,f.principal,pair.id,{expected_version:1,name:'Unpublished edited draft',reason:'Synthetic draft isolation'});
  product=await f.identity.sql.begin(tx=>publicProduct(tx,pair.id));assert.equal(product?.name,'Contoh Paket 2 Kaos');assert.equal(product?.version,1);
  assert.equal(await f.identity.sql.begin(tx=>publicProduct(tx,f.seeded.products['fixture-offer-bag'])),null);
  // Leave only one usable shirt at each warehouse: two shirts in total cannot
  // fulfill a single two-shirt offer across warehouse boundaries.
  await f.move('fixture-malang:fixture-shirt','adjust_down',2);await f.move('fixture-pontianak:fixture-shirt','adjust_down',1);
  assert.equal((await f.identity.sql.begin(tx=>publicProduct(tx,pair.id)))?.variants[0].availability,'unavailable');
 }finally{await f.close();}
});

test('public pagination binds filters, preserves UUID identity and never duplicates products across stable pages',async()=>{
 const f=await shippingFixture();try{
  const curated=await prepareStorefront(f.request(),f.identity,'test',f.namespace,f.seeded);
  const hidden=await f.catalog('/categories',{name:'Synthetic unpublished department',slug:`unpublished-${randomUUID()}`,parent_id:null,attribute_definitions:[]});await assert.rejects(listProducts(f.identity,catalogQuery(new URLSearchParams({category_id:hidden.id}))),denied('NOT_FOUND'));
  const params=new URLSearchParams({category_id:curated.categories.busana,limit:'1',sort:'newest'});
  const first=await listProducts(f.identity,catalogQuery(params));assert.equal(first.data.length,1);assert.ok(first.pagination.next_cursor);
  const corrupt=JSON.parse(Buffer.from(first.pagination.next_cursor,'base64url').toString());corrupt.t='2026-02-30T12:00:00.000000Z';const bad=new URLSearchParams(params);bad.set('cursor',Buffer.from(JSON.stringify(corrupt)).toString('base64url'));await assert.rejects(listProducts(f.identity,catalogQuery(bad)),denied('INVALID_INPUT'));
  params.set('cursor',first.pagination.next_cursor);const second=await listProducts(f.identity,catalogQuery(params));assert.equal(second.data.length,1);assert.notEqual(first.data[0].id,second.data[0].id);assert.equal(second.pagination.next_cursor,null);
  params.set('q','different');await assert.rejects(listProducts(f.identity,catalogQuery(params)),denied('INVALID_INPUT'));
  for(const query of ['q=a&q=b','cursor=','sort=','limit=41','sort=cheapest','q=%00','as_of=2030','attributes=%7B%22size%22%3A%5B%22M%22%5D%7D']) assert.throws(()=>catalogQuery(new URLSearchParams(query)),denied('INVALID_INPUT'));
  const empty=await listProducts(f.identity,catalogQuery(new URLSearchParams({q:`no-match-${randomUUID()}`})));assert.deepEqual(empty.data,[]);assert.equal(empty.pagination.next_cursor,null);
  assert.equal((await listProducts(f.identity,catalogQuery(new URLSearchParams({category_id:curated.categories.busana,q:'%'})))).data.length,0);
  const matched=await listProducts(f.identity,catalogQuery(new URLSearchParams({category_id:curated.categories.busana,offer_kind:'multipack',availability:'available'})));assert.equal(matched.data.length,1);assert.equal(matched.data[0].id,curated.products['shirt-pair'].id);
 }finally{await f.close();}
});

test('category attributes match one complete offer with product-fact fallback, never mixed variants',async()=>{
 const f=await shippingFixture();try{
  const curated=await prepareStorefront(f.request(),f.identity,'test',f.namespace,f.seeded),draft=await readCatalogRevision(f.identity.sql,curated.products.shirt.id),base=draft.variants[0];
  const category=await f.catalog('/categories',{name:'Synthetic attribute department',slug:`attr-${randomUUID()}`,parent_id:null,attribute_definitions:[
   {key:'size',label:'Ukuran',value_type:'enum',required:true,allowed_values:['M','L']},{key:'color',label:'Warna',value_type:'enum',required:true,allowed_values:['Blue','Red']},{key:'material',label:'Bahan',value_type:'enum',required:true,allowed_values:['Cotton']}]});
  const definition=(size:string,color:string)=>({sku:`ATTR_${randomUUID()}`.toUpperCase(),label:`${size} ${color}`,attributes:[{key:'size',label:'Ukuran',values:[size]},{key:'color',label:'Warna',values:[color]}],offer_kind:'unit',weight_grams:base.weight_grams,length_mm:base.length_mm,width_mm:base.width_mm,height_mm:base.height_mm,default_warehouse_id:base.default_warehouse_id,contents:base.contents});
  const product=await f.catalog('/products',{name:'Synthetic attributed offer',description:'Synthetic complete attributed offer',category_id:category.id,images:draft.images,variants:[definition('M','Blue'),definition('L','Red')]});
  const facts=f.request();facts.headers.set('idempotency-key',randomUUID());await patchProduct(facts,f.identity,f.principal,product.id,{expected_version:1,facts:[{key:'material',label:'Bahan',values:['Cotton']}],reason:'Synthetic shared product fact'});
  for(const offer of product.variants){const request=f.request();request.headers.set('idempotency-key',randomUUID());await appendCostVersion(request,f.identity,f.principal,'assumption',offer.id,{expected_version:0,effective_from:null,packaging_idr:1000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000,source:'Synthetic attribute costing',reason:'Actual fixture assumption initialization'});}
  await f.catalog(`/products/${product.id}/publications`,{expected_version:2,expected_publication_version:0,reason:'Guarded attributed fixture publication'});
  const query=(attributes:Record<string,string[]>)=>listProducts(f.identity,catalogQuery(new URLSearchParams({category_id:category.id,attributes:JSON.stringify(attributes)})));
  assert.equal((await query({size:['M'],color:['Red']})).data.length,0);
  const matched=await query({size:['M'],color:['Blue'],material:['Cotton']});assert.equal(matched.data.length,1);assert.equal(matched.data[0].id,product.id);assert.equal(matchingVariant(matched.data[0],catalogQuery(new URLSearchParams({category_id:category.id,attributes:JSON.stringify({size:['M'],color:['Blue']})})))?.label,'M Blue');assert.ok(matched.available_filters.some(v=>v.key==='material'&&v.values.includes('Cotton')));
  await assert.rejects(query({unknown:['x']}),denied('INVALID_INPUT'));
 }finally{await f.close();}
});
