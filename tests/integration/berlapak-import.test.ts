import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {isDeepStrictEqual} from 'node:util';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {importBerlapak,publicName,readBerlapakSource,supplierPatterns,webpSize} from '../../src/modules/local/berlapak.ts';
import {variantKey} from '../../src/modules/local/berlapak-identities.ts';
import {handleStorefront} from '../../src/modules/storefront/routes.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {createBerlapakOrders} from '../../src/modules/local/seed-runtime.ts';
import {deactivateFixtureWarehouses} from './shipping-fixture.ts';

// Header-only WebP files: enough for the dimension parser; no decoder is involved.
const vp8x=(width:number,height:number)=>{const b=Buffer.alloc(30);b.write('RIFF',0,'latin1');b.writeUInt32LE(22,4);b.write('WEBPVP8X',8,'latin1');b.writeUInt32LE(10,16);b.writeUIntLE(width-1,24,3);b.writeUIntLE(height-1,27,3);return b;};
const vp8l=(width:number,height:number)=>{const b=Buffer.alloc(30);b.write('RIFF',0,'latin1');b.writeUInt32LE(22,4);b.write('WEBPVP8L',8,'latin1');b.writeUInt32LE(5,16);b[20]=0x2f;b.writeUInt32LE(((width-1)&0x3fff)|(((height-1)&0x3fff)<<14),21);return b;};
const SUPPLIER='Supplier Rahasia Jaya';
const product=(rank:number,o:{name:string;hpp:number;qty:number;ready?:boolean;stock?:number})=>({rank,_id:`p${rank}`,name:o.name,slug:`p-${rank}`,
  pricing:{hpp_price:o.hpp},strategy_99ribu:{recommended_bundle_qty:o.qty},inventory:{is_ready_stock:o.ready??true,total_stock:o.stock??80,weight_gram:200,weight_kg:0.2},
  supplier:{_id:'s1',name:SUPPLIER},variants_summary:{has_variants:false,variant_count:0,variants:[]},assets:{folder_slug:`${String(rank).padStart(3,'0')}-p-${rank}`},
  warehouse_and_shipping:{warehouse_id:'0123456789abcdef01234567',warehouse_name:'Gudang Rahasia',district:'SERPONG',city:'TANGERANG SELATAN',province:'BANTEN'},
  category_mapping:{storefront_category_code:'CAT-02'}});
function fixtureDir(){
  const dir=mkdtempSync(join(tmpdir(),'berlapak-fixture-'));mkdirSync(join(dir,'data-json'));
  const products=[product(1,{name:`${SUPPLIER} Lem Perekat Super Kuat VIRAL Original COD Lem Perekat`,hpp:12345,qty:2}),product(2,{name:'Botol Mahal',hpp:51000,qty:2}),
    product(3,{name:'Sapu Belum Ready',hpp:5000,qty:2,ready:false}),product(4,{name:'Spons Cuci Piring',hpp:23456,qty:1})];
  const json=(name:string,value:unknown)=>writeFileSync(join(dir,'data-json',name),JSON.stringify(value));
  json('products-up-to-49k-ready-stock.json',{updated_at:'2026-10-15T00:00:00Z',products});
  json('google-catalog-category-mapping.json',{storefront_categories:[{code:'CAT-02',slug:'02-rumah-tangga-dan-kebersihan',name:'Rumah Tangga & Kebersihan'}]});
  json('curated-99ribu-packages.json',{curated_cross_sku_bundles:[
    {code:'BND-01',title:'Paket Dapur Bersih (Best-Seller Duo)',selling_price:99000,items:[{rank:1,qty:1},{rank:4,qty:1}],google_catalog:{storefront_category:'Rumah Tangga & Kebersihan'}},
    {code:'BND-02',title:'Paket Tidak Lengkap',selling_price:99000,items:[{rank:1,qty:1},{rank:99,qty:1}],google_catalog:{storefront_category:'Rumah Tangga & Kebersihan'}}]});
  for(const item of products){const folder=join(dir,'images',item.assets.folder_slug);mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'img-01.webp'),vp8x(640,480));writeFileSync(join(folder,'img-02.webp'),vp8l(300,200));}
  return dir;
}

test('image selection: every img-NN then var-NN in numeric order, byte-identical copies dropped, at most 20, AI studio thumbnails and other files ignored',()=>{
  const sourceDir=fixtureDir();
  try{
    const folder=join(sourceDir,'images','001-p-1');
    // The fixture already holds img-01 (640x480) and img-02 (300x200).
    for(const [file,size] of [['img-10.webp',410],['img-03.webp',411],['var-02.webp',412],['var-01.webp',413],['thumb-clean-studio.webp',414]] as const) writeFileSync(join(folder,file),vp8x(size,size));
    writeFileSync(join(folder,'img-04.webp'),vp8x(640,480));writeFileSync(join(folder,'notes.txt'),'not an image');
    const files=()=>readBerlapakSource(sourceDir).stocks.find((s)=>s.rank===1)?.images.map((i)=>i.file)??[];
    assert.deepEqual(files(),['img-01.webp','img-02.webp','img-03.webp','img-10.webp','var-01.webp','var-02.webp']);
    for(let n=20;n<45;n++) writeFileSync(join(folder,`var-${n}.webp`),vp8x(500+n,500+n));
    const capped=readBerlapakSource(sourceDir).offers.find((o)=>o.key==='1')?.images.map((i)=>i.file)??[];assert.equal(capped.length,20);assert.equal(capped[0],'img-01.webp');assert.ok(capped.indexOf('var-01.webp')>capped.indexOf('img-10.webp'),'photos before variant photos');
  }finally{rmSync(sourceDir,{recursive:true,force:true});}
});

test('webp header sizes and public names never carry supplier names or marketplace spam',()=>{
  assert.deepEqual(webpSize(vp8x(1080,720)),{width:1080,height:720});assert.deepEqual(webpSize(vp8l(300,200)),{width:300,height:200});
  assert.throws(()=>webpSize(Buffer.from('not a webp image at all, padding....')));
  const name=publicName(`${SUPPLIER} Lem Perekat Super Kuat VIRAL Original COD Lem Perekat`,supplierPatterns([SUPPLIER]));
  assert.equal(name,'Lem Perekat Super Kuat');
  assert.ok(publicName(`${'A '.repeat(10)}Kata Sangat Panjang Sekali Untuk Memastikan Batas Tujuh Puluh Karakter Dipotong Rapi`,[]).length<=70);
  // One word after the '|' cut falls back to the following segment(s), then to a product fact.
  assert.equal(publicName('NENAVIN | CUKA NANAS |  Mengontrol kadar gula dalam darah',[]),'Nenavin Cuka Nanas');
  assert.equal(publicName('MAKSIR',[],70,'Suplemen & Herbal Kesehatan'),'Maksir Suplemen & Herbal Kesehatan');
  // A supplier name that is also a common word is stripped only when two words remain, and never output alone.
  const sena=supplierPatterns(['Sena']);
  assert.equal(publicName('Sena Lampu',sena),'Sena Lampu');assert.equal(publicName('Sena Lampu Tidur LED',sena),'Lampu Tidur LED');
  assert.equal(publicName('SENA | Lampu Tidur',sena),'Lampu Tidur');assert.throws(()=>publicName('Sena',sena));
});

test('source boundary refuses image folders and image roots that resolve outside the data directory',()=>{
  const sourceDir=fixtureDir();const outside=mkdtempSync(join(tmpdir(),'berlapak-outside-'));
  try{
    assert.deepEqual(readBerlapakSource(sourceDir).skipped,{'not-ready-stock':1,'hpp-at-or-above-price':1,'bundle-rank-unresolved':1});
    // Valid WebP files, but reached through a symlinked folder: the product loses every image.
    renameSync(join(sourceDir,'images','004-p-4'),join(outside,'004-p-4'));symlinkSync(join(outside,'004-p-4'),join(sourceDir,'images','004-p-4'));
    const source=readBerlapakSource(sourceDir);assert.equal(source.skipped['image-missing'],1);assert.ok(!source.stocks.some((s)=>s.rank===4));
    renameSync(join(sourceDir,'images'),join(outside,'images'));symlinkSync(join(outside,'images'),join(sourceDir,'images'));
    assert.throws(()=>readBerlapakSource(sourceDir));
  }finally{rmSync(sourceDir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('local snapshot import: 99000 offers, private HPP, skip rules, copied images and idempotent rerun',async()=>{
  const identity=createLocalAuth('test');const owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
  const sourceDir=fixtureDir();const publicDir=mkdtempSync(join(tmpdir(),'berlapak-public-'));const namespace=`bl-${randomUUID().slice(0,8)}`;
  try{
    const run=()=>importBerlapak(owner.browser.request('/api/v1/admin/products'),identity,'test',namespace,{sourceDir,publicDir});
    // A symlinked destination folder is refused instead of followed.
    const outside=mkdtempSync(join(tmpdir(),'berlapak-target-'));symlinkSync(outside,join(publicDir,'4'));
    try{await assert.rejects(run(),/non-directory image destination/);assert.ok(!existsSync(join(outside,'img-02.webp')));}finally{rmSync(join(publicDir,'4'));rmSync(outside,{recursive:true,force:true});}
    const first=await run();
    assert.deepEqual(first.summary.skipped,{'not-ready-stock':1,'hpp-at-or-above-price':1,'bundle-rank-unresolved':1});
    assert.equal(first.summary.offers,3);assert.equal(first.summary.bundles,1);assert.equal(first.summary.stock_items,2);assert.equal(first.summary.warehouses,1);
    assert.equal(first.summary.published,3,JSON.stringify(first.summary.blocked));
    for(const rank of ['1','4']) for(const file of ['img-01.webp','img-02.webp']) assert.ok(existsSync(join(publicDir,rank,file)));
    const offers=await identity.sql`select o.sku,o.product_id,c.stock_item_id,c.quantity from app.offer o join app.offer_component c on c.offer_id=o.id where o.sku like ${`BL_${namespace.toUpperCase()}_%`} order by o.sku`;
    assert.deepEqual([...new Set(offers.map((o)=>o.sku))],[`BL_${namespace.toUpperCase()}_1_OFFER`,`BL_${namespace.toUpperCase()}_4_OFFER`,`BL_${namespace.toUpperCase()}_BND-01_OFFER`]);
    const [position]=await identity.sql`select b.on_hand,b.warehouse_id from app.inventory_balance b join app.stock_item s on s.id=b.stock_item_id where s.sku=${`BL_${namespace.toUpperCase()}_1`}`;
    assert.equal(position.on_hand,80);assert.equal(position.warehouse_id,first.products['1'].warehouse_id);
    const [cost]=await identity.sql`select v.unit_cost from app.component_cost_version v join app.stock_item s on s.id=v.stock_item_id where s.sku=${`BL_${namespace.toUpperCase()}_1`}`;assert.equal(Number(cost.unit_cost),12345);
    const [category]=await identity.sql`select id from app.category where slug=${`bl-${createHash('sha256').update(namespace).digest('hex').slice(0,8)}-rumah-tangga-dan-kebersihan`}`;
    const call=async(path:string)=>{const response=await handleStorefront(new Request(`http://127.0.0.1:3099/api/v1${path}`),identity);const body=await response.text();assert.equal(response.status,200,body);return body;};
    const listing=await call(`/products?category_id=${category.id}`);const listed=JSON.parse(listing);assert.equal(listed.data.length,3);
    const details=await Promise.all(Object.values(first.products).map((p)=>call(`/products/${p.product_id}`)));
    for(const body of [listing,...details]){
      assert.ok(!body.includes('12345')&&!body.includes('23456')&&!body.includes('51000'),'HPP stays private');
      assert.ok(!body.toLowerCase().includes('rahasia')&&!/hpp|unit_cost|supplier/i.test(body),'supplier identity and cost fields stay private');
    }
    for(const body of details){const detail=JSON.parse(body);const prices=JSON.stringify(detail).match(/"price[a-z_]*":\s*\d+/g)??[];assert.ok(prices.length>0&&prices.every((p)=>p.endsWith('99000')),body);
      assert.ok(detail.images.every((image:{url:string;width:number;height:number})=>image.url.startsWith('http://127.0.0.1:3099/catalog-local/')&&image.width===(image.url.endsWith('img-02.webp')?300:640)));}
    const second=await run();
    assert.deepEqual(second.products,first.products);assert.equal(second.summary.positions_received_now,0);assert.equal(second.summary.published,3);
    assert.equal((await identity.sql`select count(*)::int n from app.offer where sku like ${`BL_${namespace.toUpperCase()}_%`}`)[0].n,3);
    assert.equal((await identity.sql`select count(*)::int n from app.stock_movement m join app.inventory_balance b on b.id=m.balance_id join app.stock_item s on s.id=b.stock_item_id where m.kind='receive' and s.sku like ${`BL_${namespace.toUpperCase()}_%`}`)[0].n,2);
    // Two concurrent passes serialize on the namespace order lock: exactly 16 orders in total.
    const pair=await Promise.all([createBerlapakOrders(identity,'test',namespace,first.products),createBerlapakOrders(identity,'test',namespace,first.products)]);
    assert.equal(pair[0].created+pair[1].created,16,JSON.stringify(pair));assert.equal(pair[0].resumed+pair[1].resumed,0);
    const count=async()=>(await identity.sql`select count(*)::int n from app.commerce_order where clock_namespace=${namespace}`)[0].n;assert.equal(await count(),16);
    const again=await createBerlapakOrders(identity,'test',namespace,first.products);assert.equal(again.created,0);assert.equal(again.existing,16);assert.equal(again.resumed,0);assert.equal(await count(),16);
    assert.ok(pair.some((p)=>isDeepStrictEqual(p.states,again.states)),JSON.stringify(pair));
    assert.ok(Object.keys(again.states).some((s)=>s.startsWith('cod:'))&&Object.keys(again.states).some((s)=>s.endsWith(':confirmed')),JSON.stringify(again.states));
  }finally{rmSync(sourceDir,{recursive:true,force:true});rmSync(publicDir,{recursive:true,force:true});await deactivateFixtureWarehouses(identity,namespace);await cleanup(identity,[owner]);await identity.sql.end();}
});

test('S69 fixture imports three sellable variants as one product with independent physical stock and frozen variant photos',async()=>{
  const identity=createLocalAuth('test'),owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
  const sourceDir=fixtureDir(),publicDir=mkdtempSync(join(tmpdir(),'berlapak-variants-')),namespace=`bl-${randomUUID().slice(0,8)}`;
  const file=join(sourceDir,'data-json','products-up-to-49k-ready-stock.json'),data=JSON.parse(readFileSync(file,'utf8')),row=data.products[0];
  const ids=['68f5d3f165db302e467c8204','red-variant','green-variant'];
  row.variants_summary={has_variants:true,variants:ids.map((id,index)=>({_id:id,name:['Biru','Merah','Hijau'][index],hpp_price:10000+index*5000,stock:30-index*5,
    image_local_path:`images/${row.assets.folder_slug}/var-0${index+1}.webp`}))};
  for(let n=1;n<=3;n++) writeFileSync(join(sourceDir,'images',row.assets.folder_slug,`var-0${n}.webp`),vp8x(400+n,300+n));
  writeFileSync(file,JSON.stringify(data));
  try{
    const run=()=>importBerlapak(owner.browser.request('/api/v1/admin/products'),identity,'test',namespace,{sourceDir,publicDir}),first=await run();
    assert.equal(first.summary.stock_items,4);assert.equal(first.summary.offers,5);assert.equal(first.summary.published,3);
    const keys=ids.map((id)=>variantKey(1,id)),products=keys.map((key)=>first.products[key]);
    assert.ok(products.every((p)=>p.product_id===products[0].product_id));assert.equal(new Set(products.map((p)=>p.offer_id)).size,3);
    const rows=await identity.sql`select s.sku,b.on_hand,c.unit_cost from app.stock_item s join app.inventory_balance b on b.stock_item_id=s.id
      join app.component_cost_version c on c.stock_item_id=s.id where s.sku in ${identity.sql(keys.map((key)=>`BL_${namespace.toUpperCase()}_${key.replaceAll('-','_')}`))}`;
    assert.equal(rows.length,3);assert.deepEqual(rows.map((r)=>r.on_hand).sort((a,b)=>b-a),[30,25,20]);
    assert.deepEqual(rows.map((r)=>r.unit_cost).sort((a,b)=>a-b),[10000,15000,20000]);
    const response=await handleStorefront(new Request(`http://127.0.0.1:3099/api/v1/products/${products[0].product_id}`),identity);
    assert.equal(response.status,200);const product=await response.json();assert.equal(product.variants.length,3);
    assert.ok(product.variants.every((v:{image:{url:string};price:number})=>/\/var-0[123]\.webp$/.test(v.image.url)&&v.price===99000));
    assert.ok(!/Biru|Merah|Hijau/.test(product.name));
    const again=await run();assert.deepEqual(again.products,first.products);assert.equal(again.summary.positions_received_now,0);
  }finally{rmSync(sourceDir,{recursive:true,force:true});rmSync(publicDir,{recursive:true,force:true});await deactivateFixtureWarehouses(identity,namespace);await cleanup(identity,[owner]);await identity.sql.end();}
});
