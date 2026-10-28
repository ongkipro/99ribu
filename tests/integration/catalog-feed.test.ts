import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {readLocalConfig} from '../../src/config/local.ts';
import {catalogFeed,feedXml} from '../../src/modules/catalog/feed.ts';
import {patchProduct,readCatalogRevision} from '../../src/modules/catalog/catalog.ts';
import {appendCostVersion} from '../../src/modules/finance/costs.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {shippingFixture} from './shipping-fixture.ts';

test('PR-15 local feed exports published offers only, with permanent IDs, exact price/availability and reported invalid data',async()=>{
 const f=await shippingFixture();try{
  const {origin}=readLocalConfig(process.env);
  const curated=await prepareStorefront(f.request(),f.identity,'test',f.namespace,f.seeded),base=(await readCatalogRevision(f.identity.sql,curated.products.shirt.id)).variants[0];
  const department=await f.catalog('/categories',{name:'Synthetic feed department',slug:`feed-${randomUUID()}`,parent_id:null,attribute_definitions:[]});
  const leaf=await f.catalog('/categories',{name:'Synthetic feed leaf',slug:`feed-leaf-${randomUUID()}`,parent_id:department.id,attribute_definitions:[]});
  const definition=(label:string,quantity:number)=>({sku:`FEED_${randomUUID()}`.toUpperCase(),label,attributes:[],offer_kind:quantity===1?'unit':'multipack',weight_grams:base.weight_grams,length_mm:base.length_mm,
   width_mm:base.width_mm,height_mm:base.height_mm,default_warehouse_id:base.default_warehouse_id,contents:[{...base.contents[0],quantity}]});
  const images=[{url:'https://media.invalid/feed/kaos.png',alt:'Synthetic feed media',width:1500,height:1500}];
  const created=await f.catalog('/products',{name:'Synthetic feed shirt',description:'Synthetic complete feed offer',category_id:leaf.id,images,variants:[definition('Satuan',1),definition('Paket 2',2)]});
  const [{public_slug:slug}]=await f.identity.sql`select public_slug from app.product where id=${created.id}`;
  assert.match(slug,/^synthetic-feed-shirt(-[0-9]+)?$/,'the clean slug comes from the name; a repeated test name only gets a counter');
  const draftOnly=await f.catalog('/products',{name:'Synthetic draft-only shirt',description:'Never published',category_id:leaf.id,images,variants:[definition('Satuan',1)]});
  const patch=async(version:number,body:Record<string,unknown>)=>{const request=f.request();request.headers.set('idempotency-key',randomUUID());await patchProduct(request,f.identity,f.principal,created.id,{expected_version:version,reason:'Synthetic feed revision',...body});};
  const publish=(version:number,publication:number)=>f.catalog(`/products/${created.id}/publications`,{expected_version:version,expected_publication_version:publication,reason:'Guarded feed fixture publication'});
  await patch(1,{facts:[{key:'brand',label:'Merek',values:['Merek Uji']}]});
  for(const offer of created.variants){const request=f.request();request.headers.set('idempotency-key',randomUUID());await appendCostVersion(request,f.identity,f.principal,'assumption',offer.id,{expected_version:0,effective_from:null,packaging_idr:1000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000,source:'Synthetic feed costing',reason:'Actual fixture assumption initialization'});}
  const [unit,pair]=[...created.variants].sort((a,b)=>a.contents[0].quantity-b.contents[0].quantity);
  const [stored]=await f.identity.sql`select count(*)::int n from app.offer where id in ${f.identity.sql([unit.id,pair.id])} and catalog_id in ${f.identity.sql([unit.catalog_id,pair.catalog_id])}`;assert.equal(stored.n,2);
  const mine=async()=>{const feed=await catalogFeed(f.identity.sql);return {feed,items:feed.items.filter(i=>[unit.catalog_id,pair.catalog_id].includes(i.id))};};

  let {feed,items}=await mine();assert.deepEqual(items,[],'an unpublished draft never reaches the feed');
  await publish(2,0);({feed,items}=await mine());
  assert.deepEqual(items.map(i=>i.id),[unit.catalog_id,pair.catalog_id].sort());
  for(const item of items){
   const offer=item.id===unit.catalog_id?unit:pair;
   assert.deepEqual(item,{id:offer.catalog_id,item_group_id:created.catalog_id,title:`Synthetic feed shirt - ${offer.label}`,description:'Synthetic complete feed offer',
    link:`${origin}/produk/${slug}`,image_link:images[0].url,availability:'in_stock',price:'99000.00 IDR',brand:'Merek Uji',product_type:'Synthetic feed department > Synthetic feed leaf'});
  }
  const ids=new Set(feed.items.map(i=>i.id));
  assert.ok(!draftOnly.variants.some((v:{catalog_id:string})=>ids.has(v.catalog_id)),'draft-only product is excluded');
  const [bag]=await f.identity.sql`select catalog_id from app.offer where product_id=${f.seeded.products['fixture-offer-bag']}`;assert.ok(!ids.has(bag.catalog_id),'unknown-HPP unpublished fixture is excluded');
  // Published sample media are SVG placeholders without a brand: reported, never exported.
  const sample=(await readCatalogRevision(f.identity.sql,curated.products.shirt.id)).variants[0].catalog_id;assert.ok(!ids.has(sample));
  assert.deepEqual(feed.issues.filter(i=>i.catalog_id===sample).map(i=>`${i.code}:${i.field}`).sort(),['MEDIA_REQUIRED:image_link','REQUIRED_FACT_MISSING:brand']);
  assert.ok(items.every(i=>!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(i.link)),'a feed link carries no id, not even ?offer=');
  assert.ok(feed.issues.every(i=>!ids.has(i.catalog_id)),'an item with any issue is never serialized');
  const first=feedXml(origin,items);assert.equal(feedXml(origin,(await mine()).items),first,'re-export is byte-identical');
  assert.ok(first.includes(`<g:id>${unit.catalog_id}</g:id>`)&&first.includes('<g:price>99000.00 IDR</g:price>'));

  await patch(2,{name:'Unpublished draft rename'});assert.deepEqual((await mine()).items,items,'draft edits stay out of the frozen publication');
  const offerUpdate=(v:typeof base,label:string)=>({operation:'update',variant_id:v.id,update:{label,attributes:v.attributes,weight_grams:v.weight_grams,length_mm:v.length_mm,width_mm:v.width_mm,height_mm:v.height_mm,
   default_warehouse_id:v.default_warehouse_id,offer_kind:v.offer_kind,contents:v.contents}});
  const current=(await readCatalogRevision(f.identity.sql,created.id)).variants;
  await patch(3,{name:'Synthetic renamed shirt',variant_changes:current.map(v=>offerUpdate(v,`${v.label} baru`))});await publish(4,1);
  ({items}=await mine());assert.deepEqual(items.map(i=>[i.id,i.item_group_id,i.title]),[unit,pair].sort((a,b)=>a.catalog_id.localeCompare(b.catalog_id)).map(v=>[v.catalog_id,created.catalog_id,`Synthetic renamed shirt - ${v.label} baru`]),'renamed offers keep permanent catalog IDs');

  // Leave one usable shirt per warehouse: the two-shirt offer becomes unavailable, the unit stays exact.
  await f.move('fixture-malang:fixture-shirt','adjust_down',2);await f.move('fixture-pontianak:fixture-shirt','adjust_down',1);
  ({items}=await mine());const availability=Object.fromEntries(items.map(i=>[i.id,[i.availability,i.price]]));
  assert.deepEqual(availability,{[unit.catalog_id]:['in_stock','99000.00 IDR'],[pair.catalog_id]:['out_of_stock','99000.00 IDR']});

  await patch(4,{variant_changes:[{operation:'retire',variant_id:pair.id}]});await publish(5,2);
  ({items}=await mine());assert.deepEqual(items.map(i=>i.id),[unit.catalog_id],'a retired offer leaves the feed; the surviving ID is unchanged');
  assert.equal(items[0].link,`${origin}/produk/${slug}`,'a renamed product keeps its clean slug, so the feed link stays stable');
 }finally{await f.close();}
});
