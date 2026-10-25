import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {chromium,expect,type Page} from '@playwright/test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {patchProduct,readCatalogRevision} from '../../src/modules/catalog/catalog.ts';
import {publishProduct,readPublicationState} from '../../src/modules/catalog/publication.ts';
import {appendCostVersion} from '../../src/modules/finance/costs.ts';
import {handleInventory} from '../../src/modules/inventory/routes.ts';
import {releaseReservation} from '../../src/modules/inventory/reservations.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {productSlug} from '../../src/modules/storefront/navigation.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {RENDERS} from '../render-root.ts';

// S139 PDP precision pass (shop.com product page structure): the six product states at 390 (touch),
// 768 and 1440 with no horizontal overflow and no console errors, plus the behaviours the pass adds:
// server-rendered thumbnail links, option links that switch at once, the phone buy bar, the clamped
// description and the related shelf. Owned namespace; stock moved here is released in `after`.
const origin='http://127.0.0.1:3099',output=`${RENDERS}/s139`;
const identity=createLocalAuth('local'),namespace=`s139-pdp-${randomUUID().slice(0,8)}`;
let owner:Awaited<ReturnType<typeof actor>>|undefined,seeded:Awaited<ReturnType<typeof seedCommerce>>|undefined;
const quarantined:{id:string;quantity:number}[]=[];
const paths:Record<'default'|'bundle'|'multi'|'oos'|'unavailable'|'long',string>={default:'',bundle:'',multi:'',oos:'',unavailable:'',long:''};
let multiAlternate='';

async function move(id:string,kind:'quarantine'|'release_quarantine',quantity:number){
 assert.ok(owner);const [position]=await identity.sql`select warehouse_id,stock_item_id,revision from app.inventory_balance where id=${id}`;
 const request=owner.browser.request('/api/v1/admin/inventory/movements',{warehouse_id:position.warehouse_id,stock_item_id:position.stock_item_id,kind,quantity,expected_version:position.revision,reason:'Owned S139 PDP out-of-stock render'});request.headers.set('idempotency-key',randomUUID());
 assert.equal((await handleInventory(request,identity)).status,201);
}
// A dataset product by its exact catalog name, through the public storefront API.
async function catalogPath(name:string){
 const response=await fetch(`${origin}/api/v1/products?${new URLSearchParams({q:name,limit:'5'})}`);assert.equal(response.status,200);
 const body=await response.json() as {data:{id:string;name:string}[]};const found=body.data.find(p=>p.name===name);assert.ok(found,`catalog product ${name}`);
 return `/produk/${productSlug(found.id,found.name)}`;
}

test.before(async()=>{
 owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 const command=()=>{assert.ok(owner);const request=owner.browser.request('/api/v1/admin/products');request.headers.set('idempotency-key',randomUUID());return request;};
 seeded=await seedCommerce(command(),identity,'local',namespace);const curated=await prepareStorefront(command(),identity,'local',namespace,seeded);
 // Multi-offer: the curated shirt gets a second complete offer (two shirts), published.
 const shirt=curated.products.shirt,draft=await readCatalogRevision(identity.sql,shirt.id),variant=draft.variants.find(v=>v.id===shirt.offer_id);assert.ok(variant);
 const principal=await getPrincipal(command(),identity),publication=await readPublicationState(identity,principal,shirt.id);assert.ok(publication.current);
 await patchProduct(command(),identity,principal,shirt.id,{expected_version:draft.version,reason:'Owned S139 multi-offer render',description:'Data contoh. Dua opsi kaos dengan jumlah isi berbeda.',variant_changes:[
  {operation:'update',variant_id:variant.id,update:{label:'Isi 1 kaos',attributes:variant.attributes,weight_grams:variant.weight_grams,length_mm:variant.length_mm,width_mm:variant.width_mm,height_mm:variant.height_mm,default_warehouse_id:variant.default_warehouse_id,offer_kind:variant.offer_kind,contents:variant.contents,...(variant.image?{image:variant.image}:{})}},
  {operation:'create',create:{sku:`S139_MULTI_${randomUUID().replaceAll('-','').toUpperCase()}`,label:'Isi 2 kaos',attributes:variant.attributes,weight_grams:1000,length_mm:variant.length_mm,width_mm:variant.width_mm,height_mm:200,default_warehouse_id:variant.default_warehouse_id,offer_kind:'multipack',contents:variant.contents.map(c=>({...c,quantity:2})),...(variant.image?{image:variant.image}:{})}}]});
 const next=await readCatalogRevision(identity.sql,shirt.id),alternate=next.variants.find(v=>!v.retired&&v.sku.startsWith('S139_MULTI_'));assert.ok(alternate);multiAlternate=alternate.id;
 await appendCostVersion(command(),identity,principal,'assumption',alternate.id,{expected_version:0,effective_from:null,packaging_idr:1000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000,source:'TEST-ONLY owned S139 option assumptions',reason:'Initialize the owned option assumptions'});
 await publishProduct(command(),identity,principal,shirt.id,{expected_version:draft.version+1,expected_publication_version:publication.current.version,reason:'Owned S139 multi-offer render'});
 paths.multi=`/produk/${productSlug(shirt.id,next.name)}?offer=${shirt.offer_id}`;
 // Out of stock: every position of the owned cream stock is quarantined (the cream pair cannot be completed).
 const cream=curated.products['cream-pair'];
 const positions=await identity.sql<{id:string;available:number}[]>`select id,on_hand-reserved-quarantined as available from app.inventory_balance where id in ${identity.sql(Object.values(seeded.positions))} and stock_item_id=${seeded.stocks['fixture-cream']}`;
 for(const position of positions)if(position.available>0){await move(position.id,'quarantine',position.available);quarantined.push({id:position.id,quantity:position.available});}
 paths.oos=`/produk/${cream.id}`;
 // Real catalog photos for the other states: a product with photos, the largest bundle (seven items, long text), the longest title.
 paths.default=await catalogPath('10 pcs Lem Perekat Super Kuat, 20ml');
 paths.bundle=await catalogPath('Paket Borongan Solusi Rumah Tangga');
 paths.long=await catalogPath('4 pcs Pengharum Ruangan Botol Apel, Black Coffee');
 paths.unavailable=`${paths.default}?offer=${randomUUID()}`;
});
test.after(async()=>{
 try{while(quarantined.length){const position=quarantined[0];await move(position.id,'release_quarantine',position.quantity);quarantined.shift();}
  if(seeded)for(const reservation of Object.values(seeded.reservations)){await identity.sql.begin(tx=>releaseReservation(tx,reservation,'Owned S139 PDP fixture finished'));await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${reservation}`;}}
 finally{try{if(owner)await cleanup(identity,[owner]);}finally{await identity.sql.end();}}
});

async function start(width:number,javaScriptEnabled=true){
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 const phone=width<=700,context=await browser.newContext({viewport:{width,height:phone?844:900},hasTouch:phone,isMobile:phone,javaScriptEnabled,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(15000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(`pageerror: ${error.message}`));page.on('console',message=>{if(message.type()==='error')errors.push(`console: ${message.text()}`);});
 return {browser,page,errors};
}
async function open(page:Page,path:string){await page.goto(origin+path);await expect(page.locator('h1#product-title')).toBeVisible();await page.evaluate(()=>document.fonts.ready);}
async function overflow(page:Page){return page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);}
async function capture(page:Page,name:string,fullPage=true){
 await mkdir(output,{recursive:true});await page.mouse.move(0,0);
 // A full-page capture does not scroll, so lazy photos below the fold are loaded and decoded first.
 if(fullPage)await page.evaluate(()=>Promise.all([...document.images].map(image=>{image.loading='eager';return image.decode().catch(()=>undefined);})));
 assert.ok(await overflow(page)<=1,`horizontal overflow ${await overflow(page)}px on ${name}`);await page.screenshot({path:`${output}/${name}.png`,fullPage});
}

for(const width of [390,768,1440])test(`PDP states render without overflow or console errors at ${width}px`,{timeout:90000},async()=>{
 const f=await start(width);try{
  for(const state of ['default','bundle','multi','oos','unavailable','long'] as const){
   await open(f.page,paths[state]);
   if(state==='oos'){await expect(f.page.getByText('Stok pilihan belum tersedia',{exact:true})).toBeVisible();await expect(f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true})).toBeDisabled();await expect(f.page.getByRole('button',{name:'Tambah jumlah',exact:true})).toBeDisabled();await expect(f.page.getByRole('button',{name:'Kurangi jumlah',exact:true})).toBeDisabled();await expect(f.page.locator('.buy-bar')).toHaveCount(0);await expect(f.page.getByRole('link',{name:'Cari produk tersedia',exact:true})).toHaveAttribute('href',/availability=available/);}
   if(state==='unavailable'){await expect(f.page.getByRole('heading',{name:'Pilihan belum ditemukan',exact:true})).toBeVisible();await expect(f.page.locator('.detail-price')).toHaveText(/Rp99\.000/);await expect(f.page.locator('.offer-picker a')).toHaveCount(1);await expect(f.page.locator('.offer-picker a[aria-current]')).toHaveCount(0);await expect(f.page.locator('.buy-box .cart-advisory').filter({hasText:'Belum ada pilihan'})).toHaveCount(0);}
   if(state==='multi'){await expect(f.page.locator('.offer-picker a')).toHaveCount(2);await expect(f.page.locator('.offer-picker .field-label')).toContainText('Isi 1 kaos');}
   if(state==='bundle'){await expect(f.page.locator('.offer-detail li')).toHaveCount(7);await expect(f.page.locator('.read-more')).toHaveCount(1);}
   if(['default','bundle','long'].includes(state)){await expect(f.page.locator('.related-shelf .product').first()).toBeVisible();}
   // Phones: the buy bar shows while the main button is out of view (touch, the first screen).
   if(width===390&&state!=='oos'&&state!=='unavailable'){await f.page.evaluate(()=>window.scrollTo(0,0));
    const main=f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true});if(!await main.evaluate(el=>{const r=el.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;}))await expect(f.page.locator('.buy-bar')).toBeVisible();
    // Full-page captures paint fixed layers at the first screen; the bar has its own viewport capture.
    await main.scrollIntoViewIfNeeded();await expect(f.page.locator('.buy-bar')).toBeHidden();}
   await capture(f.page,`${state}-${width}`);
  }
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});

test('gallery thumbnails are server links, take their column before hydration and move the photo row',{timeout:60000},async()=>{
 const html=await (await fetch(origin+paths.bundle)).text();
 assert.match(html,/class="gallery-thumbs"[\s\S]*?<a href="#foto-1"[^>]*aria-label="Foto 1 dari 4"/,'thumbnail links are in the server HTML');
 const f=await start(1440);try{
  await open(f.page,paths.bundle);const thumbs=f.page.locator('.gallery-thumbs a');await expect(thumbs).toHaveCount(4);await expect(thumbs.first()).toHaveAttribute('aria-current','true');
  await thumbs.nth(2).click();await expect(thumbs.nth(2)).toHaveAttribute('aria-current','true');await expect.poll(()=>f.page.locator('.gallery-row').evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  assert.equal(new URL(f.page.url()).hash,'','thumbnail clicks scroll the row only, without a page jump');
  await f.page.keyboard.press('Tab');await expect(thumbs.nth(3)).toBeFocused();await capture(f.page,'gallery-thumb-focus-1440',false);
  // Description: clamped with "Baca selengkapnya"; opening shows the full text.
  const text=f.page.locator('.description-body .detail-description'),closed=await text.evaluate(el=>el.clientHeight);
  await f.page.locator('.read-more summary').click();await expect(f.page.locator('.read-more')).toHaveAttribute('open','');assert.ok(await text.evaluate(el=>el.clientHeight)>closed,'the full description opens');await expect(f.page.locator('.read-more summary')).toHaveAccessibleName('Tampilkan lebih sedikit');
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
 // Without JavaScript the strip is already there and each thumbnail is a working in-page link.
 const nojs=await start(1440,false);try{await open(nojs.page,paths.bundle);await expect(nojs.page.locator('.gallery-thumbs a')).toHaveCount(4);await nojs.page.locator('.gallery-thumbs a').nth(1).click();assert.equal(new URL(nojs.page.url()).hash,'#foto-2');}finally{await nojs.browser.close();}
});

test('option links switch the offer at once, keep the return path and work without JavaScript',{timeout:60000},async()=>{
 for(const js of [true,false]){const f=await start(390,js);try{
  const from='/cari?q=Contoh',path=`${paths.multi}&${new URLSearchParams({from})}`;await open(f.page,path);
  const option=f.page.locator(`.offer-picker a[href*="offer=${multiAlternate}"]`);await option.focus();await option.press('Enter');
  await expect(f.page.locator(`.offer-picker a[href*="offer=${multiAlternate}"]`)).toHaveAttribute('aria-current','true');await f.page.locator('summary',{hasText:'Isi yang diterima'}).click();await expect(f.page.getByText('2 × Kaos contoh',{exact:true})).toBeVisible();
  assert.equal(new URL(f.page.url()).searchParams.get('offer'),multiAlternate);assert.equal(new URL(f.page.url()).searchParams.get('from'),from);await expect(f.page.locator('.offer-picker .field-label')).toContainText('Isi 2 kaos');
  if(js){await capture(f.page,'multi-switched-390');assert.deepEqual(f.errors,[]);}
 }finally{await f.browser.close();}}
});

test('the phone buy bar submits the same form, then brings the feedback into view',{timeout:60000},async()=>{
 const f=await start(390);try{
  await open(f.page,paths.multi);await f.page.evaluate(()=>window.scrollTo(0,0));const bar=f.page.locator('.buy-bar');
  const main=f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true});await expect(main).toHaveCount(1);
  await main.scrollIntoViewIfNeeded();await expect(bar).toBeHidden();
  // S143: the denser type puts the main button on the first phone screen, so scroll it out of view (above) to show the bar.
  await main.evaluate(el=>window.scrollTo(0,el.getBoundingClientRect().bottom+window.scrollY+8));
  await expect(bar).toBeVisible();await capture(f.page,'buy-bar-390',false);
  await bar.locator('button').tap();
  await expect(f.page.locator('.cart-feedback')).toContainText('ditambahkan');await expect(f.page.locator('.cart-feedback')).toBeInViewport();await expect(bar).toBeHidden();
  const cart=await (await f.page.request.get(`${origin}/api/v1/carts/current`)).json();assert.equal(cart.lines[0].quantity,1);await capture(f.page,'buy-bar-added-390',false);
  assert.deepEqual(f.errors,[]);
 }finally{try{await f.page.request.post(`${origin}/api/auth/sign-out`,{headers:{origin},data:{}});}finally{await f.browser.close();}}
});

test('long title and bundle reflow at 320px with 200% text',{timeout:60000},async()=>{
 const f=await start(320);try{
  for(const state of ['long','bundle'] as const){await open(f.page,paths[state]);await f.page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
   // Enlarged text keeps the phone buy bar off (it would cover a third of the screen); the main button remains.
   // (Each observer notification is awaited: two scrolls in one frame would report only the final state.)
   await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).scrollIntoViewIfNeeded();await expect(f.page.locator('.buy-bar')).toBeHidden();await f.page.evaluate(()=>window.scrollTo(0,0));await f.page.waitForFunction(()=>window.scrollY===0);await f.page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(null)))));assert.equal(await f.page.locator('.buy-bar').isVisible(),false,'no bar at enlarged text');await capture(f.page,`${state}-320-text200`);}
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});
