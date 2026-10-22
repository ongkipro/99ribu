import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {privateDirectory} from '../../src/config/local.ts';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {patchProduct,readCatalogRevision} from '../../src/modules/catalog/catalog.ts';
import {type CatalogDocument,CatalogDatasetError,importCatalog,MANIFEST_FORMAT,readCatalogDataset,withdrawalCandidates} from '../../src/modules/catalog/dataset.ts';
import {publishProduct,readPublicationState,withdrawPublication} from '../../src/modules/catalog/publication.ts';
import {appendCostVersion} from '../../src/modules/finance/costs.ts';
import {handleInventory} from '../../src/modules/inventory/routes.ts';
import {DEFAULT_OFFER_ASSUMPTIONS} from '../../src/modules/local/berlapak.ts';
import {buildBerlapakDataset,loadInitialStock,writeBerlapakDataset} from '../../src/modules/local/berlapak-dataset.ts';
import {withdrawTestPublications} from '../../src/modules/local/seed-runtime.ts';
import {catalogQuery,listProducts,publicProduct} from '../../src/modules/storefront/catalog.ts';
import {serveCatalogMedia} from '../../src/storage/catalog-media.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';

// Header-only WebP plus unique trailing bytes: distinct content hashes per run, so this suite
// can remove exactly its own stored photos afterwards.
const vp8x=(width:number,height:number)=>{const b=Buffer.alloc(30);b.write('RIFF',0,'latin1');b.writeUInt32LE(22,4);b.write('WEBPVP8X',8,'latin1');b.writeUInt32LE(10,16);b.writeUIntLE(width-1,24,3);b.writeUIntLE(height-1,27,3);return Buffer.concat([b,randomBytes(16)]);};
const SUPPLIER='Supplier Rahasia Jaya',WAREHOUSE='Gudang Rahasia',HPP=12345;
const raw=(rank:number,o:{name:string;hpp:number;qty:number;ready?:boolean})=>({rank,_id:`p${rank}`,name:o.name,slug:`p-${rank}`,
  pricing:{hpp_price:o.hpp},strategy_99ribu:{recommended_bundle_qty:o.qty},inventory:{is_ready_stock:o.ready??true,total_stock:80,weight_gram:200,weight_kg:0.2},
  supplier:{_id:'s1',name:SUPPLIER},variants_summary:{has_variants:false,variant_count:0,variants:[]},assets:{folder_slug:`${String(rank).padStart(3,'0')}-p-${rank}`},
  warehouse_and_shipping:{warehouse_id:'0123456789abcdef01234567',warehouse_name:WAREHOUSE,city:'TANGERANG SELATAN',province:'BANTEN'},category_mapping:{storefront_category_code:'CAT-02'}});
function snapshot(){
  const dir=mkdtempSync(join(tmpdir(),'catalog-raw-'));mkdirSync(join(dir,'data-json'));
  const products=[raw(1,{name:`${SUPPLIER} Lem Perekat Super Kuat VIRAL Original COD`,hpp:HPP,qty:2}),raw(2,{name:'Botol Mahal',hpp:51000,qty:2}),
    raw(3,{name:'Sapu Belum Ready',hpp:5000,qty:2,ready:false}),raw(4,{name:'Spons Cuci Piring',hpp:23456,qty:1})];
  const json=(name:string,value:unknown)=>writeFileSync(join(dir,'data-json',name),JSON.stringify(value));
  json('products-up-to-49k-ready-stock.json',{updated_at:'2026-10-15T00:00:00Z',products});
  json('google-catalog-category-mapping.json',{storefront_categories:[{code:'CAT-02',slug:'02-rumah-tangga-dan-kebersihan',name:'Rumah Tangga & Kebersihan'}]});
  json('curated-99ribu-packages.json',{curated_cross_sku_bundles:[{code:'BND-01',title:'Paket Dapur Bersih (Best-Seller Duo)',selling_price:99000,
    items:[{rank:1,qty:1},{rank:4,qty:1}],google_catalog:{storefront_category:'Rumah Tangga & Kebersihan'}}]});
  for(const item of products){const folder=join(dir,'images',item.assets.folder_slug);mkdirSync(folder,{recursive:true});
    writeFileSync(join(folder,'thumb-clean-studio.webp'),vp8x(640,480));writeFileSync(join(folder,'img-02.webp'),vp8x(300,200));}
  return dir;
}
// Shared test database: catalog identities are immutable, so each run renames its SKUs/slugs.
function writeDataset(dir:string,catalog:CatalogDocument,photos:Map<string,{bytes:Buffer;width:number;height:number}>){
  mkdirSync(join(dir,'photos'),{recursive:true});const text=`${JSON.stringify(catalog,null,2)}\n`;writeFileSync(join(dir,'catalog.json'),text);
  for(const [hash,p] of photos) writeFileSync(join(dir,'photos',`${hash}.webp`),p.bytes);
  writeFileSync(join(dir,'manifest.json'),JSON.stringify({format:MANIFEST_FORMAT,catalog_sha256:createHash('sha256').update(text).digest('hex'),
    photos:[...photos].sort(([a],[b])=>a<b?-1:1).map(([sha256,p])=>({sha256,bytes:p.bytes.length,width:p.width,height:p.height}))}));
  return dir;
}
const unique=(catalog:CatalogDocument,run:string):CatalogDocument=>JSON.parse(JSON.stringify(catalog).replaceAll('"B99_',`"B99${run}_`).replaceAll('rumah-tangga-dan-kebersihan',`rumah-tangga-dan-kebersihan-${run.toLowerCase()}`));

test('generator: deterministic sanitized dataset; malformed datasets are refused before any write',()=>{
  const rawDir=snapshot();const out=mkdtempSync(join(tmpdir(),'catalog-out-'));
  try{
    const first=buildBerlapakDataset(rawDir),second=buildBerlapakDataset(rawDir);
    assert.equal(first.text,second.text);assert.deepEqual(first.manifest,second.manifest);
    assert.deepEqual(first.catalog.products.map((p)=>[p.key,p.offer.kind]),[['1','multipack'],['4','unit'],['BND-01','bundle']]);
    for(const banned of ['rahasia','gudang','tangerang','0123456789abcdef01234567','hpp',String(HPP),'23456','total_stock','supplier','warehouse'])
      assert.ok(!first.text.toLowerCase().includes(banned),`dataset leaks ${banned}`);
    const written=writeBerlapakDataset(rawDir,out);assert.equal(written.photos_written,4);
    const files=['catalog.json','manifest.json'].map((f)=>readFileSync(join(out,f),'utf8'));
    const again=writeBerlapakDataset(rawDir,out);assert.equal(again.photos_written,0);assert.equal(again.catalog_sha256,written.catalog_sha256);
    assert.deepEqual(['catalog.json','manifest.json'].map((f)=>readFileSync(join(out,f),'utf8')),files);
    assert.equal(readCatalogDataset(out).catalog.products.length,3);
    // Each corruption is caught by the reader, which performs no database work.
    const refused=(mutate:()=>void,pattern:RegExp)=>{const dir=mkdtempSync(join(tmpdir(),'catalog-bad-'));
      try{writeBerlapakDataset(rawDir,dir);const restore=process.cwd();process.chdir(dir);try{mutate();}finally{process.chdir(restore);}
        assert.throws(()=>readCatalogDataset(dir),(e)=>e instanceof CatalogDatasetError&&pattern.test(e.message));}finally{rmSync(dir,{recursive:true,force:true});}};
    const edit=(f:(c:Record<string,unknown>)=>void,resign=true)=>()=>{const c=JSON.parse(readFileSync('catalog.json','utf8'));f(c);const text=`${JSON.stringify(c,null,2)}\n`;writeFileSync('catalog.json',text);
      if(resign){const m=JSON.parse(readFileSync('manifest.json','utf8'));m.catalog_sha256=createHash('sha256').update(text).digest('hex');writeFileSync('manifest.json',JSON.stringify(m));}};
    refused(edit((c)=>{c.source='edited';},false),/manifest digest/);
    refused(edit((c)=>{c.price_idr=98000;}),/IDR 99,000/);
    refused(edit((c)=>{(c.products as {offer:{contents:{stock_item:string}[]}}[])[0].offer.contents[0].stock_item='B99_999';}),/unknown stock item/);
    refused(edit((c)=>{(c.products as Record<string,unknown>[])[0].hpp=HPP;}),/products\[0\]/);
    refused(()=>{const m=JSON.parse(readFileSync('manifest.json','utf8'));const name=join('photos',`${m.photos[0].sha256}.webp`);writeFileSync(name,Buffer.concat([readFileSync(name),Buffer.from('x')]));},/does not match|not a clean/);
  }finally{rmSync(rawDir,{recursive:true,force:true});rmSync(out,{recursive:true,force:true});}
});

test('catalog import: catalog-only rows, served photos, idempotent rerun, guarded publication, revisions and preserved staff edits',async()=>{
  const identity=createLocalAuth('test');const sql=identity.sql;
  const owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
  const editor=await actor(identity,'owner',[]);await enroll(editor.browser,editor.password);
  const rawDir=snapshot();const run=randomUUID().slice(0,8).toUpperCase();const dir=mkdtempSync(join(tmpdir(),'catalog-ds-'));
  const built=buildBerlapakDataset(rawDir);const catalog=unique(built.catalog,run);const prefix=`B99${run}_`;
  const [wh]=await sql`insert into app.warehouse (name,city) values ('Synthetic catalog import','Malang') returning id`;
  try{
    const load=(c:CatalogDocument)=>readCatalogDataset(writeDataset(dir,c,built.photos));
    const importNow=(c:CatalogDocument,warehouseId:string=wh.id)=>importCatalog(owner.browser.request('/api/v1/admin/products'),identity,load(c),{warehouseId});
    const offerSkus=catalog.products.map((p)=>p.offer.sku);
    const counts=async()=>(await sql`select (select count(*)::int from app.category where slug=${`rumah-tangga-dan-kebersihan-${run.toLowerCase()}`}) categories,
      (select count(*)::int from app.stock_item where sku like ${`${prefix}%`}) stock_items,(select count(*)::int from app.offer where sku in ${sql(offerSkus)}) offers,
      (select count(*)::int from app.product_revision r where r.product_id in (select product_id from app.offer where sku in ${sql(offerSkus)})) revisions,
      (select count(*)::int from app.publication_version v where v.product_id in (select product_id from app.offer where sku in ${sql(offerSkus)})) publications,
      (select count(*)::int from app.audit_event where action='catalog.import' and actor_id=${owner.id}) runs`)[0];
    // Refused before any catalog write: unknown target warehouse.
    await assert.rejects(importNow(catalog,randomUUID()),CatalogDatasetError);
    assert.deepEqual(await counts(),{categories:0,stock_items:0,offers:0,revisions:0,publications:0,runs:0});

    const first=await importNow(catalog);
    assert.deepEqual({c:first.categories.created,s:first.stock_items.created,p:first.products.created,pub:first.published},{c:1,s:2,p:3,pub:0});
    assert.equal(first.blocked.COMPLETE_STOCK_REQUIRED,3,JSON.stringify(first.blocked));
    assert.deepEqual(await counts(),{categories:1,stock_items:2,offers:3,revisions:3,publications:0,runs:1});
    // Catalog only: no stock position, movement, cost, assumption or order row exists for the import.
    const [none]=await sql`select (select count(*)::int from app.inventory_balance b join app.stock_item s on s.id=b.stock_item_id where s.sku like ${`${prefix}%`}) balances,
      (select count(*)::int from app.component_cost_version v join app.stock_item s on s.id=v.stock_item_id where s.sku like ${`${prefix}%`}) costs,
      (select count(*)::int from app.offer_cost_assumption_version v join app.offer o on o.id=v.offer_id where o.sku in ${sql(offerSkus)}) assumptions,
      (select count(*)::int from app.order_item i join app.offer o on o.id=i.offer_id where o.sku in ${sql(offerSkus)}) orders`;
    assert.deepEqual(none,{balances:0,costs:0,assumptions:0,orders:0});
    // Public catalog fields carry no supplier/warehouse identity; photos resolve by content hash.
    const ids:Record<string,string>=Object.fromEntries((await sql`select o.sku,o.product_id from app.offer o where o.sku in ${sql(offerSkus)}`).map((r)=>[r.sku,r.product_id as string]));
    const unit=ids[`${prefix}4_OFFER`],multi=ids[`${prefix}1_OFFER`],bundle=ids[`${prefix}BND-01_OFFER`];
    const drafts=await Promise.all(Object.values(ids).map((pid)=>readCatalogRevision(sql,pid)));
    const publicText=JSON.stringify(drafts.map((d)=>({name:d.name,description:d.description,images:d.images,variants:d.variants.map((v)=>({label:v.label,contents:v.contents}))}))).toLowerCase();
    for(const banned of ['rahasia','gudang','tangerang',String(HPP)]) assert.ok(!publicText.includes(banned),`DB public field leaks ${banned}`);
    const image=drafts.find((d)=>d.id===unit)?.images[0] as {url:string;width:number};assert.match(image.url,/^http:\/\/127\.0\.0\.1:3099\/media\/catalog\/[0-9a-f]{64}\.webp$/);
    const name=image.url.split('/').at(-1) as string;const served=await serveCatalogMedia(name);
    assert.equal(served.status,200);assert.equal(served.headers.get('content-type'),'image/webp');
    assert.ok(Buffer.from(await served.arrayBuffer()).equals(built.photos.get(name.slice(0,64))?.bytes as Buffer));
    assert.equal((await serveCatalogMedia(`${'0'.repeat(64)}.webp`)).status,404);assert.equal((await serveCatalogMedia('../manifest.json')).status,404);

    // Rerun: zero new catalog rows and no run audit.
    const before=await counts();const second=await importNow(catalog);
    assert.equal(second.changed,false);assert.equal(second.products.unchanged,3);assert.equal(second.photos.stored,0);assert.deepEqual(await counts(),before);

    // Real admin flows supply stock, costs and policy; the next run publishes exactly the ready product.
    const issue=async(action:string,subject:string)=>{const req=owner.browser.request('/api/v1/me/reauthentication-proofs',{password:owner.password,action,subject_id:subject});
      req.headers.set('idempotency-key',randomUUID());const res=await handleAccess(req,identity);assert.equal(res.status,201);return (await res.json()).proof as string;};
    const history=await (await owner.browser.access('/admin/policy-versions?kind=commercial')).json();
    if(history.latest_version===0){const req=owner.browser.request('/api/v1/admin/policy-versions',{kind:'commercial',warehouse_id:null,expected_version:0,effective_at:null,
      values:{default_commission_bps:1000,minimum_payout_idr:99000},reason:'Synthetic catalog import baseline',reauthentication_proof:await issue('company_policy.version','company-commercial')});
      req.headers.set('idempotency-key',randomUUID());assert.equal((await handleAccess(req,identity)).status,201);}
    const unitDraft=await readCatalogRevision(sql,unit);const stockId=unitDraft.variants[0].contents[0].stock_item_id;const principal=await getPrincipal(owner.browser.request('/api/v1/me'),identity);
    const receive=owner.browser.request('/api/v1/admin/inventory/movements',{warehouse_id:wh.id,stock_item_id:stockId,kind:'receive',quantity:5,expected_version:0,reason:'Synthetic receiving'});
    receive.headers.set('idempotency-key',randomUUID());assert.equal((await handleInventory(receive,identity)).status,201);
    for(const [kind,scope,body] of [['component',stockId,{unit_cost:23456}],['assumption',unitDraft.variants[0].id,{packaging_idr:1000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000}]] as const){
      const req=owner.browser.request('/api/v1/admin/catalog-costs',{});req.headers.set('idempotency-key',randomUUID());
      await appendCostVersion(req,identity,principal,kind,scope,{...body,expected_version:0,effective_from:null,source:'Synthetic admin entry',reason:'Synthetic cost entry'});
    }
    const third=await importNow(catalog);assert.equal(third.published_now,1,JSON.stringify(third.blocked));assert.equal(third.published,1);
    assert.equal((await importNow(catalog)).changed,false);

    // A staff edit is preserved; a changed dataset appends a new revision and keeps the old one.
    const editReq=editor.browser.request(`/api/v1/admin/products/${bundle}`,{});editReq.headers.set('idempotency-key',randomUUID());
    await patchProduct(editReq,identity,await getPrincipal(editor.browser.request('/api/v1/me'),identity),bundle,{expected_version:1,reason:'Staff copy edit',description:'Staff-written description.'});
    const changed=JSON.parse(JSON.stringify(catalog)) as CatalogDocument;
    for(const p of changed.products) if(p.key!=='4') p.name=`${p.name} Edisi Baru`;
    const fourth=await importNow(changed);
    assert.equal(fourth.products.revised,1);assert.deepEqual(fourth.products.preserved,['BND-01']);assert.equal(fourth.published,1);
    assert.equal((await readCatalogRevision(sql,multi)).version,2);assert.equal((await readCatalogRevision(sql,multi,1)).name,catalog.products[0].name);
    assert.equal((await readCatalogRevision(sql,multi)).name,`${catalog.products[0].name} Edisi Baru`);
    assert.equal((await readCatalogRevision(sql,bundle)).description,'Staff-written description.');
    assert.equal((await importNow(changed)).changed,false);
  }finally{
    rmSync(rawDir,{recursive:true,force:true});rmSync(dir,{recursive:true,force:true});
    for(const hash of built.photos.keys()) try{unlinkSync(join(privateDirectory('catalog-media'),`${hash}.webp`));}catch{/* not stored */}
    await sql`update app.warehouse set active=false where id=${wh.id}`;await cleanup(identity,[owner,editor]);await sql.end();
  }
});

test('deploy command: refuses a malformed dataset, imports as a removed temporary owner and reruns without changes',async()=>{
  const identity=createLocalAuth('test');const sql=identity.sql;const rawDir=snapshot();const run=randomUUID().slice(0,8).toUpperCase();
  const dir=mkdtempSync(join(tmpdir(),'catalog-cli-'));const built=buildBerlapakDataset(rawDir);writeDataset(dir,unique(built.catalog,run),built.photos);
  const [wh]=await sql`insert into app.warehouse (name,city) values ('Synthetic catalog CLI','Malang') returning id`;
  const cli=(...args:string[])=>spawnSync(process.execPath,['--env-file=.env.example','scripts/catalog.ts','import','test',...args],{encoding:'utf8',timeout:60000});
  try{
    const bad=mkdtempSync(join(tmpdir(),'catalog-cli-bad-'));writeFileSync(join(bad,'catalog.json'),'{');
    const refused=cli(wh.id,bad);rmSync(bad,{recursive:true,force:true});
    assert.equal(refused.status,1);assert.match(refused.stderr,/Malformed JSON: catalog\.json/);
    const operators=async()=>(await sql`select count(*)::int n from app.auth_user where email like 'catalog-import.seed-op-%'`)[0].n;
    const before=await operators();const first=cli(wh.id,dir);assert.equal(first.status,0,first.stderr);
    const summary=JSON.parse(first.stdout.trim().split('\n').at(-1) as string);assert.equal(summary.products.created,3);assert.equal(summary.changed,true);
    assert.equal(await operators(),before,'temporary operator removed');
    const [audit]=await sql`select a.actor_id,u.id as user_id from app.audit_event a left join app.auth_user u on u.id::text=a.actor_id where a.action='catalog.import' and a.details->>'catalog_sha256'=${summary.catalog_sha256}`;
    assert.ok(audit&&audit.user_id===null,'run audited under the removed operator identity');
    const second=cli(wh.id,dir);assert.equal(second.status,0,second.stderr);
    const rerun=JSON.parse(second.stdout.trim().split('\n').at(-1) as string);assert.equal(rerun.changed,false);assert.equal(rerun.products.unchanged,3);
  }finally{
    rmSync(rawDir,{recursive:true,force:true});rmSync(dir,{recursive:true,force:true});
    for(const hash of built.photos.keys()) try{unlinkSync(join(privateDirectory('catalog-media'),`${hash}.webp`));}catch{/* not stored */}
    await sql`update app.warehouse set active=false where id=${wh.id}`;await cleanup(identity,[]);await sql.end();
  }
});

test('initial stock and HPP from the raw snapshot, guarded publication, withdrawal and test-run teardown',async()=>{
  const identity=createLocalAuth('test');const sql=identity.sql;
  const owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
  const rawDir=snapshot();const run=randomUUID().slice(0,8).toUpperCase();const dir=mkdtempSync(join(tmpdir(),'catalog-stock-'));const stale=mkdtempSync(join(tmpdir(),'catalog-stale-'));
  const built=buildBerlapakDataset(rawDir);const catalog=unique(built.catalog,run);const prefix=`B99${run}_`;writeDataset(dir,catalog,built.photos);
  writeDataset(stale,{...catalog,source_snapshot:'2026-01-01T00:00:00Z'},built.photos);
  const [wh]=await sql`insert into app.warehouse (name,city) values ('Synthetic initial stock','Malang') returning id`;
  const [{at:since}]=await sql`select clock_timestamp()::text as at`;
  const request=(path='/api/v1/admin/products')=>{const r=owner.browser.request(path,{});r.headers.set('idempotency-key',randomUUID());return r;};
  const load=(datasetDir=dir)=>loadInitialStock(request(),identity,{warehouseId:wh.id,sourceDir:rawDir,datasetDir});
  const state=async()=>(await sql`select
      (select count(*)::int from app.stock_movement m join app.inventory_balance b on b.id=m.balance_id join app.stock_item s on s.id=b.stock_item_id where s.sku like ${`${prefix}%`}) movements,
      (select coalesce(sum(b.on_hand),0)::int from app.inventory_balance b join app.stock_item s on s.id=b.stock_item_id where s.sku like ${`${prefix}%`} and b.warehouse_id=${wh.id}) on_hand,
      (select count(*)::int from app.component_cost_version v join app.stock_item s on s.id=v.stock_item_id where s.sku like ${`${prefix}%`}) costs,
      (select count(*)::int from app.offer_cost_assumption_version v join app.offer o on o.id=v.offer_id where o.sku like ${`${prefix}%`}) assumptions`)[0];
  try{
    // Refused before any write: the catalog is not imported yet, or the snapshot is not the dataset's.
    await assert.rejects(load(),(e)=>e instanceof CatalogDatasetError&&/run catalog:import first/.test(e.message));
    await importCatalog(request(),identity,readCatalogDataset(dir),{warehouseId:wh.id});
    await assert.rejects(load(stale),(e)=>e instanceof CatalogDatasetError&&/not the committed dataset snapshot/.test(e.message));
    assert.deepEqual(await state(),{movements:0,on_hand:0,costs:0,assumptions:0});

    const first=await load();
    assert.deepEqual(first.receive,{received:2,units:160,existing:0,capped:0,differs_from_snapshot:0});
    assert.deepEqual(first.hpp,{appended:2,existing:0,differs_from_snapshot:0});assert.deepEqual(first.assumptions,{appended:3,existing:0});
    assert.deepEqual(await state(),{movements:2,on_hand:160,costs:2,assumptions:3});
    const [cost]=await sql`select v.unit_cost from app.component_cost_version v join app.stock_item s on s.id=v.stock_item_id where s.sku=${`${prefix}1`}`;assert.equal(cost.unit_cost,HPP);
    const [assumption]=await sql`select v.packaging_idr,v.provider_fee_idr,v.subsidy_idr,v.returns_reserve_idr from app.offer_cost_assumption_version v join app.offer o on o.id=v.offer_id where o.sku=${`${prefix}4_OFFER`}`;
    assert.deepEqual({...assumption},{...DEFAULT_OFFER_ASSUMPTIONS});
    // Rerun and a changed snapshot never receive again or overwrite HPP; differences are reported only.
    const second=await load();assert.equal(second.receive.received,0);assert.equal(second.receive.existing,2);assert.equal(second.hpp.appended,0);assert.equal(second.assumptions.appended,0);
    const rawFile=join(rawDir,'data-json','products-up-to-49k-ready-stock.json');const raw=JSON.parse(readFileSync(rawFile,'utf8'));
    for(const product of raw.products){product.inventory.total_stock=90;if(product.rank===4) product.pricing.hpp_price=20000;}writeFileSync(rawFile,JSON.stringify(raw));
    const changed=await load();assert.deepEqual(changed.receive,{received:0,units:0,existing:2,capped:0,differs_from_snapshot:2});assert.equal(changed.hpp.differs_from_snapshot,1);
    assert.deepEqual(await state(),{movements:2,on_hand:160,costs:2,assumptions:3});

    // Publication stays the guarded import rerun.
    const published=await importCatalog(request(),identity,readCatalogDataset(dir),{warehouseId:wh.id});assert.equal(published.published,3,JSON.stringify(published.blocked));
    const ids:Record<string,string>=Object.fromEntries((await sql`select sku,product_id from app.offer where sku like ${`${prefix}%`}`).map((r)=>[r.sku,r.product_id as string]));
    const unit=ids[`${prefix}4_OFFER`],bundle=ids[`${prefix}BND-01_OFFER`];const principal=await getPrincipal(request('/api/v1/me'),identity);
    const visible=async(productId:string)=>(await listProducts(identity,catalogQuery(new URLSearchParams({q:(await readCatalogRevision(sql,productId)).name,limit:'40'})))).data.some((p)=>p.id===productId);
    assert.ok(await sql.begin((tx)=>publicProduct(tx,unit)));assert.ok(await visible(unit));

    // Withdrawal: versioned, idempotent, audited; history kept; the product leaves every public reader.
    const head=await readPublicationState(identity,principal,unit);assert.ok(head.current);
    const withdraw=(key:string,body:Record<string,unknown>)=>{const r=owner.browser.request(`/api/v1/admin/products/${unit}/publications`,{});r.headers.set('idempotency-key',key);return withdrawPublication(r,identity,principal,unit,body);};
    const code=(c:string)=>(e:unknown)=>e instanceof Error&&'code' in e&&e.code===c;
    await assert.rejects(withdraw(randomUUID(),{expected_publication_version:head.latest_version+1,reason:'Stale'}),code('PUBLICATION_VERSION_CONFLICT'));
    const key=randomUUID(),body={expected_publication_version:head.latest_version,reason:'Synthetic withdrawal'};const out=await withdraw(key,body);
    assert.deepEqual(await withdraw(key,body),out);await assert.rejects(withdraw(randomUUID(),{...body,reason:'Again'}),code('PUBLICATION_ALREADY_WITHDRAWN'));
    const after=await readPublicationState(identity,principal,unit);assert.equal(after.current,null);assert.equal(after.latest_version,head.latest_version);
    assert.equal(await sql.begin((tx)=>publicProduct(tx,unit)),null);assert.equal(await visible(unit),false);
    assert.equal((await sql`select count(*)::int n from app.audit_event where action='catalog.product.withdraw' and subject_id=${unit}`)[0].n,1);
    await assert.rejects(sql`update app.publication_withdrawal set reason='Edited' where publication_id=${out.publication_id}`,/immutable/);
    await assert.rejects(sql`delete from app.publication_withdrawal where publication_id=${out.publication_id}`,/immutable/);
    // Republishing is the ordinary guarded publication against the unchanged latest version.
    const draft=await readCatalogRevision(sql,unit);
    const again=await publishProduct(request(),identity,principal,unit,{expected_version:draft.version,expected_publication_version:after.latest_version,reason:'Synthetic republish'});
    assert.equal(again.version,after.latest_version+1);assert.ok(await sql.begin((tx)=>publicProduct(tx,unit)));
    // The database refuses a withdrawal of a publication that is no longer the head.
    const bundleDraft=await readCatalogRevision(sql,bundle);const old=await readPublicationState(identity,principal,bundle);assert.ok(old.current);
    await publishProduct(request(),identity,principal,bundle,{expected_version:bundleDraft.version,expected_publication_version:old.latest_version,reason:'Synthetic second publication'});
    await assert.rejects(sql`insert into app.publication_withdrawal (publication_id,product_id,product_revision,actor_id,reason) values (${old.current.id},${bundle},${bundleDraft.version},${owner.id},'Not head')`,/current publication/);

    // Selection keeps catalog offers; the test-run teardown withdraws this run's synthetic publications.
    const offerSkus=catalog.products.map((p)=>p.offer.sku);
    const mine=(rows:{product_id:string}[])=>rows.filter((r)=>Object.values(ids).includes(r.product_id)).length;
    assert.equal(mine(await withdrawalCandidates(sql,offerSkus,{since,syntheticOnly:true})),0);
    assert.equal(mine(await withdrawalCandidates(sql,[],{since,syntheticOnly:true})),3);
    const teardown=await withdrawTestPublications('test',since);assert.ok(teardown.withdrawn>=3,JSON.stringify(teardown));
    for(const productId of Object.values(ids)) assert.equal(await sql.begin((tx)=>publicProduct(tx,productId)),null);
    assert.equal((await withdrawTestPublications('test',since)).candidates,0);
  }finally{
    for(const path of [rawDir,dir,stale]) rmSync(path,{recursive:true,force:true});
    for(const hash of built.photos.keys()) try{unlinkSync(join(privateDirectory('catalog-media'),`${hash}.webp`));}catch{/* not stored */}
    await sql`update app.warehouse set active=false where id=${wh.id}`;await cleanup(identity,[owner]);await sql.end();
  }
});

test('operator commands: initial-stock refuses a missing snapshot; withdraw dry-run is read-only',()=>{
  const env={...process.env,BERLAPAK_DATA_DIR:join(tmpdir(),`missing-${randomUUID()}`)};
  const cli=(...args:string[])=>spawnSync(process.execPath,['--env-file=.env.example','scripts/catalog.ts',...args],{encoding:'utf8',timeout:60000,env});
  const missing=cli('initial-stock','test',randomUUID());assert.equal(missing.status,1);assert.match(missing.stderr,/Berlapak data directory not found/);
  const dry=cli('withdraw','test');assert.equal(dry.status,0,dry.stderr);
  const summary=JSON.parse(dry.stdout.trim().split('\n').at(-1) as string);assert.equal(summary.mode,'dry-run');assert.equal(typeof summary.candidates,'number');
  assert.equal(Object.values(summary.by_group as Record<string,number>).reduce((n,v)=>n+v,0),summary.candidates);
  assert.equal(cli('withdraw','test','--now').status,1);
});
