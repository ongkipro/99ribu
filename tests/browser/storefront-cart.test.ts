import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {patchProduct,readCatalogRevision} from '../../src/modules/catalog/catalog.ts';
import {publishProduct,readPublicationState} from '../../src/modules/catalog/publication.ts';
import {appendCostVersion} from '../../src/modules/finance/costs.ts';
import {handleInventory} from '../../src/modules/inventory/routes.ts';
import {releaseReservation} from '../../src/modules/inventory/reservations.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {CommerceClient} from '../integration/checkout-fixture.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {chromium,expect,type Page,type Locator} from '@playwright/test';
import type {PublicProduct} from '../../src/modules/storefront/catalog.ts';
import {RENDERS} from '../render-root.ts';
// Owner 2026-10-31: a successful change renders no text; wait for the server's acknowledgement instead (the region's
// data-ack changes to the new intent key) and check the region stays empty.
const acknowledgements=new WeakMap<Page,string>();
async function acknowledged(page:Page){
 const feedback=page.locator('.cart-feedback[data-phase="success"]');const previous=acknowledgements.get(page)??'';
 await expect(feedback).toHaveAttribute('data-ack',/./);if(previous)await expect(feedback).not.toHaveAttribute('data-ack',previous);
 acknowledgements.set(page,await feedback.getAttribute('data-ack')??'');await expect(feedback).toBeEmpty();
}


const origin='http://127.0.0.1:3099',output=`${RENDERS}/s22`;
const fixtureIdentity=createLocalAuth('local'),fixtureNamespace=`s26-cart-${randomUUID().slice(0,8)}`;
let fixtureOwner:Awaited<ReturnType<typeof actor>>,fixtureSeed:Awaited<ReturnType<typeof seedCommerce>>,fixtureCatalog:Awaited<ReturnType<typeof prepareStorefront>>;
test.before(async()=>{
 fixtureOwner=await actor(fixtureIdentity,'owner',[]);await enroll(fixtureOwner.browser,fixtureOwner.password);
 const request=()=>fixtureOwner.browser.request('/api/v1/admin/products');fixtureSeed=await seedCommerce(request(),fixtureIdentity,'local',fixtureNamespace);fixtureCatalog=await prepareStorefront(request(),fixtureIdentity,'local',fixtureNamespace,fixtureSeed);
});
test.after(async()=>{
 try{if(fixtureSeed)for(const reservation of Object.values(fixtureSeed.reservations)){await fixtureIdentity.sql.begin(tx=>releaseReservation(tx,reservation,'Owned cart regression fixture finished'));await fixtureIdentity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${reservation}`;}}
 finally{try{if(fixtureOwner)await cleanup(fixtureIdentity,[fixtureOwner]);}finally{await fixtureIdentity.sql.end();}}
});
async function fixtureProduct(key:'shirt'|'shirt-cream'){
 const expected=fixtureCatalog.products[key];assert.ok(expected.publication_id);const response=await fetch(`${origin}/api/v1/products/${expected.id}`);assert.equal(response.status,200);return await response.json() as PublicProduct;
}
// The clean URL segment of a currently sold product, from the public API.
async function slugOf(id:string){const response=await fetch(`${origin}/api/v1/products/${id}`);assert.equal(response.status,200);return (await response.json() as PublicProduct).public_slug;}
async function product(){
 const bundle=await fixtureProduct('shirt-cream');assert.equal(bundle.name,'Contoh Paket Kaos dan Krim');
 const offer=bundle.variants.find((v:{availability:string})=>v.availability==='available');assert.ok(offer);
 return {bundle,offer,path:`/produk/${bundle.public_slug}?offer=${offer.id}`};
}
async function start(width=390,javaScriptEnabled=true){
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 const context=await browser.newContext({viewport:{width,height:900},javaScriptEnabled,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(15000);
 const errors:string[]=[];page.on('pageerror',()=>errors.push('Uncaught page error'));
 page.on('request',request=>assert.equal(new URL(request.url()).origin,origin,'No external browser request'));
 return {browser,context,page,errors};
}
async function current(page:Page){const response=await page.request.get(`${origin}/api/v1/carts/current`);assert.equal(response.status(),200);return response.json();}
async function capture(page:Page,name:string,focus?:Locator){await page.mouse.move(0,0);await mkdir(output,{recursive:true});await page.evaluate(()=>document.fonts.ready);if(focus){await focus.scrollIntoViewIfNeeded();await expect(focus).toBeInViewport({ratio:1});const rect=await focus.boundingBox(),tabs=await page.locator('.shopping-tabs').boundingBox();assert.ok(rect&&(!tabs||rect.y+rect.height<=tabs.y+1),'Viewport detail stays above real navigation');}await page.screenshot({path:`${output}/${name}.png`,fullPage:!focus});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)<=1);}
async function close(f:Awaited<ReturnType<typeof start>>){try{const response=await f.page.request.post(`${origin}/api/auth/sign-out`,{headers:{origin},data:{}});assert.equal(response.status(),200);}finally{await f.browser.close();}}

for(const width of [390,768,1024,1440])test(`selected bundle and authoritative cart add/change/remove at ${width}px`,async()=>{
 const f=await start(width),observedBodies:string[]=[],observedUrls:string[]=[];try{
  if(width===1024)await f.page.setViewportSize({width,height:768});
  if(width===390){f.page.on('request',request=>observedUrls.push(request.url()));await f.page.route('**/*',async(route,request)=>{if(request.resourceType()==='script'||request.method()==='POST'){const response=await route.fetch();assert.ok(response.ok());observedBodies.push(await response.text());await route.fulfill({response});}else await route.continue();});}
  const p=await product(),campaign=new URLSearchParams({utm_source:'synthetic',utm_campaign:'s22-local',fbclid:'SYNTHETIC_META_CLICK',gclid:'SYNTHETIC_GOOGLE_CLICK',ttclid:'SYNTHETIC_TIKTOK_CLICK',quantity:'50',cart_id:'00000000-0000-4000-8000-000000000099'});await f.page.goto(`${origin}${p.path}&${campaign}`);await expect(f.page.locator('.offer-detail')).toHaveCount(1);await expect(f.page.getByRole('spinbutton',{name:'Jumlah pilihan',exact:true})).toHaveValue('1');await expect(f.page.locator('.offer-picker .field-label, .offer-detail-label').first()).toContainText(p.offer.label);await expect(f.page.locator('.offer-picker a')).toHaveCount(0);await expect(f.page.getByRole('button',{name:'Lihat pilihan',exact:true})).toHaveCount(0);
  // Owner call 2026-10-24: the PDP keeps the full store header (search) and the phone dock. Owner call 2026-10-28: on phones the
  // product page swaps the search header for the floating back / share / cart / menu bar (up to 700px).
  await expect(f.page.locator(width<=700?'.pdp-bar':'.store-header')).toBeVisible();await expect(f.page.locator('.shopping-tabs')).toHaveCount(1);await f.page.locator('summary',{hasText:'Isi yang diterima'}).click();await expect(f.page.getByText('1 × Kaos contoh',{exact:true})).toBeVisible();await expect(f.page.getByText('2 × Krim contoh',{exact:true})).toBeVisible();await expect(f.page.locator('summary',{hasText:'Isi yang diterima'})).toBeVisible();// The fixture has no spec data: no empty Spesifikasi heading or placeholder (owner/coordinator round 48).
  await expect(f.page.getByRole('heading',{name:'Spesifikasi',exact:true})).toHaveCount(0);await expect(f.page.getByText('Spesifikasi tambahan belum tersedia.')).toHaveCount(0);// S111 phase 2b: the PDP price is shop.com's 16/22 600 at every width (DESIGN.md typography table).
  await expect(f.page.locator('.detail-price')).toHaveCSS('font-size','20px');await capture(f.page,`pdp-${width}`);if(width===390){const heading=f.page.locator('summary',{hasText:'Isi yang diterima'});assert.equal(await heading.textContent(),'Isi yang diterima');await heading.screenshot({path:`${output}/font-heading-390.png`});}
  // Owner 2026-10-31: no visible success box; the photo flies to the visible cart icon, which bumps and shows the new count.
  await f.page.evaluate(()=>{(window as unknown as {flights:number}).flights=0;new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n instanceof HTMLElement&&n.classList.contains('cart-fly'))(window as unknown as {flights:number}).flights++;}).observe(document.body,{childList:true});});
  // This context prefers reduced motion; allow motion for this one add, then restore it (no flight under reduce: next add).
  await f.page.emulateMedia({reducedMotion:'no-preference'});
  await f.page.getByRole('spinbutton',{name:'Jumlah pilihan',exact:true}).fill('2');await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();
  await acknowledged(f.page);
  await expect.poll(()=>f.page.evaluate(()=>(window as unknown as {flights:number}).flights)).toBe(1);await expect(f.page.locator('.cart-fly')).toHaveCount(0);await f.page.emulateMedia({reducedMotion:'reduce'});
  await expect(f.page.getByRole('link',{name:'Keranjang, 2 pilihan',exact:true}).first()).toBeVisible();let cart=await current(f.page);assert.equal(cart.lines[0].quantity,2);assert.equal(cart.merchandise_total,198000);
  await f.page.getByRole('link',{name:'Keranjang, 2 pilihan',exact:true}).first().click();await expect(f.page.getByRole('heading',{name:'Keranjang',exact:true})).toBeVisible();if([768,1024].includes(width))await expect(f.page.locator('.utilities .utility-count')).toBeVisible();await capture(f.page,`cart-${width}`);
  const update=f.page.locator('.cart-mutation').filter({has:f.page.locator('input[name=kind][value=update]')});await update.getByRole('spinbutton').fill('1');await update.locator('button[type=submit]').click();await acknowledged(f.page);cart=await current(f.page);assert.equal(cart.merchandise_total,99000);
  await f.page.getByRole('button',{name:/^Hapus Contoh Paket Kaos dan Krim,/}).click();await acknowledged(f.page);await expect(f.page.getByRole('heading',{name:'Keranjang masih kosong',exact:true})).toBeVisible();cart=await current(f.page);assert.equal(cart.lines.length,0);assert.equal(cart.merchandise_total,0);assert.doesNotMatch(await f.page.locator('main').innerText(),/Rp0\b/);await expect(f.page.locator('main a[href="/cari"]')).toHaveCount(1);await capture(f.page,`cart-empty-${width}`);
  const issued=(await f.context.cookies()).filter(c=>/commerce_guest|cart_access/.test(c.name));if(width===390){assert.ok(observedBodies.length>0);const visible=[await f.page.content(),JSON.stringify(cart),...observedBodies,...observedUrls];for(const token of issued.flatMap(c=>[c.value,c.value.split('.').at(-1)]).filter((value):value is string=>Boolean(value&&value.length>=40)))assert.ok(visible.every(body=>!body.includes(token)),'Generated private capability leaked into rendered/browser data');}const metadata=issued.map(c=>({httpOnly:c.httpOnly,path:c.path,sameSite:c.sameSite}));assert.equal(metadata.length,2);assert.ok(metadata.every(c=>c.httpOnly&&c.path==='/'&&c.sameSite==='Lax'));
  assert.equal(await f.page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('native forms retain acknowledged guest intent without JavaScript and reflow at enlarged text',async()=>{
 const f=await start(390,false);try{
  const p=await product();await f.page.goto(origin+p.path);await f.page.getByRole('spinbutton',{name:'Jumlah pilihan',exact:true}).fill('2');await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();
  await expect(f.page.locator('.cart-feedback')).toContainText('Sesi belanja siap');await expect(f.page.getByRole('spinbutton')).toHaveValue('2');await f.page.getByRole('button',{name:'Lanjutkan pilihan',exact:true}).click();await acknowledged(f.page);assert.equal((await current(f.page)).merchandise_total,198000);
  await f.page.goto(`${origin}/keranjang`);await f.page.reload();assert.equal((await current(f.page)).lines[0].quantity,2);await capture(f.page,'cart-nojs-390');
  await f.page.setViewportSize({width:320,height:568});await f.page.evaluate(()=>document.documentElement.style.fontSize='200%');await capture(f.page,'cart-text-200-320');await expect(f.page.locator('.shopping-tabs')).toHaveCSS('position','static');const button=f.page.getByRole('button',{name:/^Hapus Contoh Paket Kaos dan Krim,/});await button.focus();await expect(button).toBeFocused();await button.click();await expect(f.page.getByRole('heading',{name:'Keranjang masih kosong',exact:true})).toBeVisible();assert.equal((await current(f.page)).merchandise_total,0);await f.page.goto(origin+p.path);await f.page.evaluate(()=>document.documentElement.style.fontSize='200%');await capture(f.page,'pdp-text-200-short-320');const slot=await f.page.locator('.product-media .photo-slot').boundingBox();assert.ok(slot&&Math.abs(slot.width-slot.height)<=1);const add=f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true});await add.focus();await expect(add).toBeInViewport({ratio:1});assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('a lost actual add response is explicitly retried with its original intent and never duplicates quantity',async()=>{
 const f=await start();try{
  const p=await product();await f.page.goto(origin+p.path);await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await acknowledged(f.page);assert.equal((await current(f.page)).lines[0].quantity,1);
  let dropped=false;await f.page.route('**/produk/**',async(route,request)=>{if(!dropped&&request.method()==='POST'&&request.headers()['next-action']){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Hasil tindakan belum diketahui',exact:true})).toBeVisible();assert.equal(dropped,true);assert.equal((await current(f.page)).lines[0].quantity,2);await expect(f.page.locator('main a[href="/keranjang"]')).toHaveCount(1);await capture(f.page,'pdp-unknown-390');
  await f.page.getByRole('button',{name:'Ulangi tindakan yang sama',exact:true}).click();await acknowledged(f.page);assert.equal((await current(f.page)).lines[0].quantity,2);await f.page.reload();assert.equal((await current(f.page)).merchandise_total,198000);assert.equal(await f.page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 }finally{await close(f);}
});

test('foreign offer input cannot silently select another offer and a second tab reviews a stale cart version',async()=>{
 const f=await start();try{
  const p=await product();await f.page.goto(`${origin}/produk/${p.bundle.public_slug}?offer=${randomUUID()}`);await expect(f.page.getByRole('heading',{name:'Pilihan belum ditemukan',exact:true})).toBeVisible();await expect(f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true})).toHaveCount(0);
  // S139: options are links (shop.com swatches switch at once); none is current for a foreign offer.
  const invalidUrl=f.page.url(),picker=f.page.locator('.offer-picker a');await expect(picker).toHaveCount(1);await expect(picker).not.toHaveAttribute('aria-current');await picker.focus();await expect(f.page).toHaveURL(invalidUrl);await expect(picker).toBeFocused();await picker.press('Enter');await expect.poll(()=>{const offer=new URL(f.page.url()).searchParams.get('offer');return f.page.url()!==invalidUrl&&(offer===null||offer===p.offer.id);},{message:'the picker leaves the foreign offer for the page default (bare slug) or its own offer'}).toBe(true);await expect(f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true})).toBeVisible();await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await acknowledged(f.page);
  const other=await f.context.newPage();await other.goto(origin+p.path);await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await acknowledged(f.page);
  await other.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await expect(other.locator('.cart-form-error')).toContainText('halaman lain');await expect(other.locator('.cart-form-error')).toContainText('keranjang memuat 2 pilihan lengkap');assert.equal((await current(other)).lines[0].quantity,2);await capture(other,'pdp-version-conflict-390');
  await other.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await acknowledged(other);assert.equal((await current(other)).lines[0].quantity,3);await other.close();assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});


test('a revoked guest is denied, duplicate auth cookies fail closed, and explicit restart retains the original cart',async()=>{
 const f=await start(),identity=createLocalAuth('local');try{
  const p=await product();await f.page.goto(origin+p.path);await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await acknowledged(f.page);const saved=await current(f.page),oldCookies=await f.context.cookies();
  const guest=oldCookies.find(c=>c.name.endsWith('.commerce_guest'));assert.ok(guest);await f.context.clearCookies({name:guest.name});await f.page.goto(`${origin}/keranjang`);await expect(f.page.getByRole('heading',{name:'Sesi belanja perlu diperiksa',exact:true})).toBeVisible();await expect(f.page.locator('.cart-line')).toHaveCount(0);await f.context.addCookies(oldCookies);
  const signedOut=await f.page.request.post(`${origin}/api/auth/sign-out`,{headers:{origin},data:{}});assert.equal(signedOut.status(),200);await f.context.addCookies(oldCookies);await f.page.goto(`${origin}/keranjang`);
  await expect(f.page.getByRole('heading',{name:'Sesi belanja perlu diperiksa',exact:true})).toBeVisible();await expect(f.page.locator('.cart-line')).toHaveCount(0);await capture(f.page,'cart-session-denied-390');
  await f.page.getByRole('button',{name:'Akhiri sesi dan mulai ulang',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Keranjang masih kosong',exact:true})).toBeVisible();
  const [original]=await identity.sql`select revision,state,(select sum(quantity)::int from app.cart_line where cart_id=c.id) quantity from app.cart c where c.id=${saved.id}`;assert.equal(original.revision,saved.version);assert.equal(original.state,'open');assert.equal(original.quantity,1);
  const guestName=oldCookies.find(c=>c.name.endsWith('.commerce_guest'))?.name;assert.ok(guestName);
  const duplicate=await f.page.request.get(`${origin}/keranjang`,{headers:{cookie:`${guestName}=synthetic_one; ${guestName}=synthetic_two`}});assert.equal(duplicate.status(),200);assert.match(await duplicate.text(),/Sesi belanja perlu diperiksa/);assert.deepEqual(f.errors,[]);
 }finally{await identity.sql.end();await close(f);}
});


test('actual publication acknowledgement and stock loss preserve frozen cart facts and still allow removal',async()=>{
 const f=await start(),identity=createLocalAuth('local'),owner=await actor(identity,'owner',[]);let seeded:Awaited<ReturnType<typeof seedCommerce>>|undefined;
 const quarantined:{id:string;quantity:number}[]=[];
 const move=async(id:string,kind:'quarantine'|'release_quarantine',quantity:number)=>{
  const [position]=await identity.sql`select warehouse_id,stock_item_id,revision from app.inventory_balance where id=${id}`;
  const request=owner.browser.request('/api/v1/admin/inventory/movements',{warehouse_id:position.warehouse_id,stock_item_id:position.stock_item_id,kind,quantity,expected_version:position.revision,reason:'Owned S22 browser recovery stock proof'});request.headers.set('idempotency-key',randomUUID());const response=await handleInventory(request,identity);assert.equal(response.status,201);
 };
 try{
  await enroll(owner.browser,owner.password);const command=()=>{const request=owner.browser.request('/api/v1/admin/products');request.headers.set('idempotency-key',randomUUID());return request;},namespace=`s22-recovery-${randomUUID().slice(0,8)}`;// Own namespace per run: this test edits and republishes its product, so a withdrawn (teardown) edited fixture is never republished by prepareStorefront.
  seeded=await seedCommerce(command(),identity,'local',namespace);const curated=await prepareStorefront(command(),identity,'local',namespace,seeded),product=curated.products.shirt;assert.ok(product.publication_id);
  const draft=await readCatalogRevision(identity.sql,product.id),variant=draft.variants.find(v=>v.id===product.offer_id);assert.ok(variant);
  const slug=await slugOf(product.id),path=`/produk/${slug}?offer=${product.offer_id}`;await f.page.goto(origin+path);const quantity=f.page.getByRole('spinbutton',{name:'Jumlah pilihan',exact:true});await quantity.fill('50');await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await expect(f.page.locator('.cart-form-error')).toContainText('Jumlah itu belum tersedia');await expect(quantity).toHaveValue('50');await expect(f.page.locator('.cart-mutation [role=alert]')).toContainText('Jumlah itu belum tersedia');assert.equal((await current(f.page)).lines.length,0);await quantity.fill('1');await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await acknowledged(f.page);const saved=await current(f.page),originalQuantity=saved.lines[0].contents[0].quantity,nextQuantity=originalQuantity===1?2:1;
  await f.page.goto(origin+'/keranjang');const staleUpdate=f.page.locator('.cart-mutation').filter({has:f.page.locator('input[name=kind][value=update]')});await staleUpdate.getByRole('spinbutton').fill('2');
  const principal=await getPrincipal(command(),identity),publication=await readPublicationState(identity,principal,product.id);assert.ok(publication.current);
  const otherQuantity=nextQuantity===1?2:1,extra=draft.variants.find(v=>!v.retired&&v.sku.startsWith('S22_MULTI_')),choice={label:`Pilihan ${otherQuantity} kaos`,attributes:variant.attributes,weight_grams:500*otherQuantity,length_mm:variant.length_mm,width_mm:variant.width_mm,height_mm:100*otherQuantity,default_warehouse_id:variant.default_warehouse_id,offer_kind:otherQuantity===1?'unit':'multipack',contents:variant.contents.map(c=>({...c,quantity:otherQuantity})),...(variant.image?{image:variant.image}:{})};
  await patchProduct(command(),identity,principal,product.id,{expected_version:draft.version,reason:'Owned S22 explicit replacement facts',description:'Data contoh. Dua opsi kaos dengan jumlah isi berbeda.',variant_changes:[{operation:'update',variant_id:variant.id,update:{label:`Pilihan ${nextQuantity} kaos`,attributes:variant.attributes,weight_grams:500*nextQuantity,length_mm:variant.length_mm,width_mm:variant.width_mm,height_mm:100*nextQuantity,default_warehouse_id:variant.default_warehouse_id,offer_kind:nextQuantity===1?'unit':'multipack',contents:variant.contents.map(c=>({...c,quantity:nextQuantity})),...(variant.image?{image:variant.image}:{})}},...(extra?[{operation:'update',variant_id:extra.id,update:choice}]:[{operation:'create',create:{sku:`S22_MULTI_${randomUUID().replaceAll('-','').toUpperCase()}`, ...choice}}])]});
  const nextDraft=await readCatalogRevision(identity.sql,product.id),alternate=nextDraft.variants.find(v=>!v.retired&&v.sku.startsWith('S22_MULTI_'));assert.ok(alternate);
  if(!(await identity.sql`select id from app.offer_cost_assumption_version where offer_id=${alternate.id} limit 1`).length)await appendCostVersion(command(),identity,principal,'assumption',alternate.id,{expected_version:0,effective_from:null,packaging_idr:1000,provider_fee_idr:1000,subsidy_idr:5000,returns_reserve_idr:1000,source:'TEST-ONLY owned multi-option assumptions',reason:'Initialize only empty owned choice assumptions, preserve existing HPP/cost history'});
  const published=await publishProduct(command(),identity,principal,product.id,{expected_version:draft.version+1,expected_publication_version:publication.current.version,reason:'Owned S22 current publication recovery proof'});
  for(const [width,js] of [[390,true],[1440,true],[390,false]] as const){const choices=await start(width,js);try{
   const from=`/cari?q=Contoh#product-${product.id}`,query=new URLSearchParams({offer:product.offer_id,from});await choices.page.goto(`${origin}/produk/${slug}?${query}`);await expect(choices.page.locator('.offer-picker a')).toHaveCount(2);const currentOffer=new URL((await choices.page.locator('.offer-picker a[aria-current]').getAttribute('href'))??'',origin).searchParams.get('offer');assert.ok(currentOffer===null||currentOffer===product.offer_id,'the current choice is the bare slug (page default) or names its own offer');await expect(choices.page.getByText('Dua opsi kaos dengan jumlah isi berbeda.',{exact:true})).toBeVisible();const option=choices.page.locator('.offer-picker a:not([aria-current])'),alternateOffer=new URL((await option.getAttribute('href'))??'',origin).searchParams.get('offer');assert.ok(alternateOffer===null||alternateOffer===alternate.id,'the other choice is the bare slug (page default) or names the alternate offer');await option.focus();await expect(option).toBeFocused();await option.press('Enter');await expect(choices.page.locator('.offer-picker a[aria-current]')).toContainText(`Pilihan ${otherQuantity} kaos`);assert.equal(new URL(choices.page.url()).searchParams.get('offer'),alternateOffer);assert.equal(new URL(choices.page.url()).searchParams.get('from'),from);await choices.page.locator('summary',{hasText:'Isi yang diterima'}).click();await expect(choices.page.getByText(`${otherQuantity} × Kaos contoh`,{exact:true})).toBeVisible();await capture(choices.page,js?`pdp-options-${width}`:'pdp-options-nojs-390');assert.deepEqual(choices.errors,[]);
  }finally{await close(choices);}}
  await staleUpdate.locator('button[type=submit]').click();await expect(f.page.getByRole('heading',{name:'Rincian pilihan berubah',exact:true})).toBeVisible();await expect(f.page.locator('.cart-contents')).toContainText(`${originalQuantity} × Kaos contoh`);await expect(f.page.locator(`#review-${saved.lines[0].id}`)).toContainText(`${nextQuantity} × Kaos contoh`);await expect(f.page.getByRole('link',{name:'Lanjut ke checkout',exact:true})).toHaveCount(0);await capture(f.page,'cart-publication-review-390');const approve=f.page.getByRole('button',{name:/^Setujui isi terbaru Contoh Kaos,/});await approve.focus();await approve.evaluate(e=>e.scrollIntoView({block:'center'}));await capture(f.page,'cart-publication-detail-390',approve);await expect(approve).toHaveAttribute('aria-describedby',`review-${saved.lines[0].id}`);await expect(f.page.locator('.cart-form-error')).toHaveCount(0);
  let cart=await current(f.page);assert.equal(cart.version,saved.version);assert.equal(cart.lines[0].publication_id,product.publication_id);
  await expect(f.page.locator('.cart-line-actions').getByRole('spinbutton')).toHaveCount(0);await f.page.getByRole('button',{name:/^Setujui isi terbaru Contoh Kaos,/}).click();await acknowledged(f.page);cart=await current(f.page);assert.equal(cart.lines[0].quantity,1,'Publication approval must keep the current frozen quantity instead of a hidden rejected draft');assert.equal(cart.lines[0].publication_id,published.id);assert.equal(cart.lines[0].contents[0].quantity,nextQuantity);assert.equal(cart.merchandise_total,99000);
  const positions=await identity.sql<{id:string;available:number}[]>`select id,on_hand-reserved-quarantined as available from app.inventory_balance where id in ${identity.sql(Object.values(seeded.positions))} and stock_item_id=${seeded.stocks['fixture-shirt']}`;
  for(const position of positions)if(position.available>0){await move(position.id,'quarantine',position.available);quarantined.push({id:position.id,quantity:position.available});}
  await f.page.reload();await expect(f.page.getByText('Stok tidak cukup untuk jumlah ini. Kurangi jumlah atau hapus pilihan.',{exact:true})).toBeVisible();const update=f.page.locator('.cart-mutation').filter({has:f.page.locator('input[name=kind][value=update]')});await update.getByRole('spinbutton').fill('6');await update.locator('button[type=submit]').click();await expect(f.page.locator('.cart-form-error')).toContainText('Jumlah itu belum tersedia');await expect(update.getByRole('spinbutton')).toHaveValue('6');await expect(update.getByRole('spinbutton')).toHaveAttribute('aria-invalid','true');await expect(update.getByRole('alert')).toContainText('Jumlah itu belum tersedia');await expect(update.getByText('Stok tidak cukup untuk jumlah ini. Kurangi jumlah atau hapus pilihan.',{exact:true})).toHaveCount(0);await expect(f.page.getByText(/Jumlah itu belum tersedia/)).toHaveCount(1);assert.equal((await current(f.page)).version,cart.version);await capture(f.page,'cart-stock-conflict-390');await capture(f.page,'cart-stock-detail-390',update);
  await f.page.goto(origin+path);await expect(f.page.getByText('Stok pilihan belum tersedia',{exact:true})).toBeVisible();await expect(f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true})).toBeDisabled();await capture(f.page,'pdp-unavailable-390');
  while(quarantined.length){const position=quarantined[0];await move(position.id,'release_quarantine',position.quantity);quarantined.shift();}
  await f.page.goto(`${origin}/produk/${slug}?offer=${alternate.id}`);await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await acknowledged(f.page);await f.page.goto(origin+'/keranjang');
  const retiredLine=f.page.locator('.cart-line').filter({has:f.page.locator(`input[name=variant][value="${alternate.id}"]`)}),retiredForm=retiredLine.locator('.cart-mutation').filter({has:f.page.locator('input[name=kind][value=update]')});await retiredForm.getByRole('spinbutton').fill('2');
  const versionPage=await f.context.newPage();await versionPage.goto(origin+'/keranjang');
  const versionLine=versionPage.locator('.cart-line').filter({has:versionPage.locator(`input[name=variant][value="${alternate.id}"]`)}),versionForm=versionLine.locator('.cart-mutation').filter({has:versionPage.locator('input[name=kind][value=update]')});await versionForm.getByRole('spinbutton').fill('2');
  const primary=f.page.locator('.cart-line').filter({has:f.page.locator(`input[name=variant][value="${product.offer_id}"]`)}),primaryUpdate=primary.locator('.cart-mutation').filter({has:f.page.locator('input[name=kind][value=update]')});await primaryUpdate.getByRole('spinbutton').fill('2');await primaryUpdate.locator('button[type=submit]').click();await acknowledged(f.page);assert.equal((await current(f.page)).lines.find((line:{variant_id:string})=>line.variant_id===product.offer_id).quantity,2);
  const beforeRetire=await readCatalogRevision(identity.sql,product.id),currentPublication=await readPublicationState(identity,principal,product.id);assert.ok(currentPublication.current);
  await patchProduct(command(),identity,principal,product.id,{expected_version:beforeRetire.version,reason:'Owned S22 unavailable-option error association',variant_changes:[{operation:'retire',variant_id:alternate.id}]});await publishProduct(command(),identity,principal,product.id,{expected_version:beforeRetire.version+1,expected_publication_version:currentPublication.current.version,reason:'Keep original offer published while retiring only owned extra choice'});
  try{let conflictBody='';// Capture the body inside the route: the form submit navigates, and a body read after navigation is discarded.
  await versionPage.route(url=>url.pathname==='/keranjang',async route=>{if(route.request().method()!=='POST')return route.fallback();const fetched=await route.fetch();conflictBody=await fetched.text();await route.fulfill({response:fetched,body:conflictBody});});await versionForm.locator('button[type=submit]').click();await expect.poll(()=>conflictBody,{message:'Actual stale writer must return the native version code before publication'}).toContain('CART_VERSION_CONFLICT');await versionPage.unroute(url=>url.pathname==='/keranjang');const alert=versionForm.getByRole('alert');await expect(alert).toContainText('Pilihan ini tidak lagi dijual. Hapus');await expect(versionLine.locator('.cart-form-error')).toHaveCount(1);await expect(versionLine.locator('.cart-warning')).toHaveCount(0);const described=await alert.getAttribute('id');assert.ok(described);await expect(versionForm.getByRole('spinbutton')).toHaveAttribute('aria-describedby',described);await expect(versionPage.locator(`[id="${described}"]`)).toHaveCount(1);await expect(versionForm.getByRole('spinbutton')).not.toHaveAttribute('aria-invalid','true');await expect(versionForm.getByRole('spinbutton')).toHaveAttribute('readonly','');await expect(versionForm.locator('button[type=submit]')).toBeDisabled();assert.equal((await current(versionPage)).lines.find((line:{variant_id:string})=>line.variant_id===alternate.id).quantity,1);}finally{await versionPage.close();}
  await retiredForm.locator('button[type=submit]').click();const retiredError=retiredForm.locator('.cart-form-error[role=alert]');await expect(retiredError).toBeVisible();await expect(retiredError).toContainText('Pilihan ini tidak lagi dijual. Hapus');await expect(retiredError).not.toContainText('Periksa isi terbaru');await expect(retiredLine.locator('.cart-form-error')).toHaveCount(1);await expect(retiredLine.locator('.cart-warning')).toHaveCount(0);const errorId=await retiredError.getAttribute('id');assert.ok(errorId);await expect(retiredForm.getByRole('spinbutton')).toHaveAttribute('aria-describedby',errorId);await expect(f.page.locator(`[id="${errorId}"]`)).toHaveCount(1);assert.equal((await current(f.page)).lines.find((line:{variant_id:string})=>line.variant_id===alternate.id).quantity,1);await retiredForm.getByRole('spinbutton').focus();await retiredForm.evaluate(e=>e.scrollIntoView({block:'center'}));await capture(f.page,'cart-retired-offer-390',retiredForm);await retiredLine.getByRole('button',{name:/^Hapus /}).click();await acknowledged(f.page);assert.equal((await current(f.page)).lines.length,1);
  await f.page.goto(`${origin}/keranjang`);await f.page.getByRole('button',{name:/^Hapus Contoh Kaos,/}).click();await expect(f.page.getByRole('heading',{name:'Keranjang masih kosong',exact:true})).toBeVisible();assert.equal((await current(f.page)).merchandise_total,0);assert.deepEqual(f.errors,[]);
 }finally{
  try{while(quarantined.length){const position=quarantined[0];await move(position.id,'release_quarantine',position.quantity);quarantined.shift();}
   if(seeded)for(const id of Object.values(seeded.reservations)){await identity.sql.begin(tx=>releaseReservation(tx,id,'Owned S22 browser fixture finished'));await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${id}`;}
   await cleanup(identity,[owner]);
  }finally{await identity.sql.end();await close(f);}
 }
});


test('real owned-clock quotes expire and an expired cart starts anew only after a deliberate add',async()=>{
 const f=await start(),identity=createLocalAuth('local'),owner=await actor(identity,'owner',[]),namespace='s22-cart-clock';let seeded:Awaited<ReturnType<typeof seedCommerce>>|undefined;
 try{
  await enroll(owner.browser,owner.password);const request=()=>owner.browser.request('/api/v1/admin/products');seeded=await seedCommerce(request(),identity,'local',namespace);const curated=await prepareStorefront(request(),identity,'local',namespace,seeded),product=curated.products.shirt;assert.ok(product.publication_id);
  const empty=await start();try{
   const client=new CommerceClient(identity),body={lines:[]},key=randomUUID();assert.equal((await client.call('/api/v1/carts',body,{key})).response.status,401);const actor=await commerceActor(client.request('/keranjang'),identity);assert.ok(actor?.kind==='guest');const created=await identity.sql.begin(tx=>createCart(tx,client.request('/api/v1/carts',body,{key}),identity,actor,body,{clock_namespace:namespace}));const replay=await client.call('/api/v1/carts',body,{key});assert.equal(replay.response.status,201);assert.equal(replay.payload.cart.id,created.cart.id);await empty.context.addCookies([...client.cookies.values()].map(c=>({name:c.name,value:c.value,domain:'127.0.0.1',path:c.path,httpOnly:true,sameSite:'Lax' as const,secure:false})));
   const clock=await readFixtureClock('local',namespace);await advanceFixtureClock('local',namespace,Math.ceil((Date.parse(created.cart.expires_at)-Date.parse(clock.now))/1000)+1,clock.version);await empty.page.goto(origin+'/keranjang');await expect(empty.page.getByRole('heading',{name:'Keranjang kedaluwarsa',exact:true})).toBeVisible();await capture(empty.page,'cart-empty-expired-390');await expect(empty.page.getByRole('main').getByRole('link',{name:'Lihat produk',exact:true})).toHaveCount(1);await expect(empty.page.locator('.cart-warning')).not.toContainText('catatan');await expect(empty.page.locator('.cart-mutation')).toHaveCount(0);assert.equal((await current(empty.page)).id,created.cart.id);assert.deepEqual(empty.errors,[]);
  }finally{await close(empty);}
  const client=new CommerceClient(identity),body={lines:[{variant_id:product.offer_id,quantity:1,expected_publication_id:product.publication_id}]},key=randomUUID();assert.equal((await client.call('/api/v1/carts',body,{key})).response.status,401);
  const actor=await commerceActor(client.request('/keranjang'),identity);assert.ok(actor?.kind==='guest');
  // Only this fixture supplies a private business clock to the real writer.
  // Its exact API replay issues the normal cookie; the browser receives no clock input.
  const created=await identity.sql.begin(tx=>createCart(tx,client.request('/api/v1/carts',body,{key}),identity,actor,body,{clock_namespace:namespace}));
  const replay=await client.call('/api/v1/carts',body,{key});assert.equal(replay.response.status,201);assert.equal(replay.payload.cart.id,created.cart.id);
  await f.context.addCookies([...client.cookies.values()].map(c=>({name:c.name,value:c.value,domain:'127.0.0.1',path:c.path,httpOnly:true,sameSite:'Lax' as const,secure:false})));
  const cart=replay.payload.cart,quote=await client.call('/api/v1/checkout/quotes',{cart_id:cart.id,address:{recipient_name:'SYNTHETIC S22 clock recipient',phone:'+6281200000000',address_line:'SYNTHETIC S22 local address',destination_id:'test-malang',postal_code:'00001'},contact:{phone:'+6281200000000'},payment_method:'cod'},{version:cart.version});assert.equal(quote.response.status,201);
  await f.page.goto(`${origin}/keranjang`);await expect(f.page.getByText('Perhitungan pengiriman tersedia untuk isi keranjang saat ini. Perubahan isi perlu dihitung ulang.',{exact:true})).toBeVisible();
  let clock=await readFixtureClock('local',namespace);clock=await advanceFixtureClock('local',namespace,Math.ceil((Date.parse(quote.payload.expires_at)-Date.parse(clock.now))/1000)+1,clock.version);
  await f.page.reload();await expect(f.page.getByText('Perhitungan ongkir sebelumnya kedaluwarsa. Pilih ulang pengiriman saat checkout.',{exact:true})).toBeVisible();await capture(f.page,'cart-quote-expired-390');await capture(f.page,'cart-quote-expired-detail-390',f.page.locator('.cart-summary'));assert.equal((await current(f.page)).active_quote_id,quote.payload.id);
  await advanceFixtureClock('local',namespace,Math.ceil((Date.parse(cart.expires_at)-Date.parse(clock.now))/1000)+1,clock.version);await f.page.getByRole('button',{name:/^Perbarui jumlah /}).click();await expect(f.page.locator('.cart-feedback')).toHaveAttribute('role','alert');await expect(f.page.locator('.cart-feedback')).toContainText('Keranjang ini kedaluwarsa');await f.page.reload();await expect(f.page.getByRole('heading',{name:'Keranjang kedaluwarsa',exact:true})).toBeVisible();await expect(f.page.locator('.cart-heading a')).toHaveCount(0);await expect(f.page.locator('.cart-mutation')).toHaveCount(0);await expect(f.page.locator('.line-total')).toContainText('1 pilihan');await expect(f.page.locator('.shopping-tabs a[data-count]')).toHaveCount(0);await expect(f.page.locator('.cart-summary .cart-warning')).toHaveCount(0);assert.doesNotMatch(await f.page.locator('.cart-summary').innerText(),/Checkout sedang disiapkan/);const recovery=f.page.locator('.cart-warning').getByRole('link',{name:'Lihat produk',exact:true});await expect(recovery).toHaveAttribute('href','/cari');const colors=await recovery.evaluate(el=>({foreground:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor}));assert.notEqual(colors.foreground,colors.background,'Expired recovery text must contrast with its filled action surface');await capture(f.page,'cart-expired-390');
  await f.page.goto(`${origin}/produk/${await slugOf(product.id)}?offer=${product.offer_id}`);await expect(f.page.getByText('Keranjang sebelumnya kedaluwarsa. Penambahan berikutnya memulai keranjang baru.',{exact:true})).toBeVisible();assert.equal((await current(f.page)).id,cart.id);
  await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await acknowledged(f.page);const fresh=await current(f.page);assert.notEqual(fresh.id,cart.id);assert.equal(fresh.lines[0].quantity,1);assert.equal(fresh.merchandise_total,99000);
  const [original]=await identity.sql`select revision,state,active_quote_id,(select sum(quantity)::int from app.cart_line where cart_id=c.id) quantity from app.cart c where id=${cart.id}`;assert.equal(original.revision,cart.version);assert.equal(original.state,'open');assert.equal(original.quantity,1);assert.equal(original.active_quote_id,quote.payload.id);assert.deepEqual(f.errors,[]);
 }finally{
  try{if(seeded)for(const id of Object.values(seeded.reservations)){await identity.sql.begin(tx=>releaseReservation(tx,id,'Owned S22 clock browser fixture finished'));await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${id}`;}await cleanup(identity,[owner]);}
  finally{await identity.sql.end();await close(f);}
 }
});


test('an authenticated buyer retains ownership and safe cookie-only SSR through add/reload/sign-out',async()=>{
 const f=await start(),identity=createLocalAuth('local'),buyer=await actor(identity,'buyer',[]);try{
  await f.page.goto(origin);const signed=await f.page.request.post(`${origin}/api/auth/sign-in/email`,{headers:{origin},data:{email:buyer.email,password:buyer.password}});assert.equal(signed.status(),200);
  const p=await product();await f.page.goto(origin+p.path);await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await acknowledged(f.page);const cart=await current(f.page);assert.equal(cart.merchandise_total,99000);
  const [owner]=await identity.sql`select owner_user_id,owner_guest_id from app.cart where id=${cart.id}`;assert.equal(owner.owner_user_id,buyer.id);assert.equal(owner.owner_guest_id,null);
  await f.page.reload();await expect(f.page.getByRole('link',{name:'Keranjang, 1 pilihan',exact:true}).first()).toBeVisible();await f.page.goto(`${origin}/keranjang`);await expect(f.page.locator('.cart-line')).toHaveCount(1);
  const cookies=await f.context.cookies(),html=await f.page.content();for(const cookie of cookies.filter(c=>c.name.endsWith('.session_token')))assert.ok(!html.includes(cookie.value),'Generated session credential leaked in HTML');assert.ok(!cookies.some(c=>c.name.endsWith('.commerce_guest')));assert.equal(await f.page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  const out=await f.page.request.post(`${origin}/api/auth/sign-out`,{headers:{origin},data:{}});assert.equal(out.status(),200);await f.page.goto(`${origin}/keranjang`);await expect(f.page.getByRole('heading',{name:'Keranjang masih kosong',exact:true})).toBeVisible();assert.deepEqual(f.errors,[]);
 }finally{
  // A real buyer/cart FK retains identity history. Sign out both actual sessions;
  // never delete that user or cart to make fixture cleanup pass.
  try{assert.equal((await buyer.browser.auth('/sign-out',{})).status,200);await cleanup(identity,[]);}
  finally{await identity.sql.end();await close(f);}
 }
});


test('pending updates stay on their own forms and another line keeps its unsaved quantity',async()=>{
 const f=await start(),releases:(()=>void)[]=[],completed:Promise<void>[]=[];let held:{arrive:()=>void;wait:Promise<void>;complete:()=>void}|null=null;
 const hold=()=>{let arrive!:()=>void,release!:()=>void,complete!:()=>void;const ready=new Promise<void>(r=>arrive=r),wait=new Promise<void>(r=>release=r),done=new Promise<void>(r=>complete=r);held={arrive,wait,complete};releases.push(release);completed.push(done);return {ready,release};};
 try{
  const p=await product();await f.page.goto(origin+p.path);await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await acknowledged(f.page);
  const other=await fixtureProduct('shirt');assert.equal(other.name,'Contoh Kaos');assert.notEqual(other.id,p.bundle.id);const option=other.variants.find((v:{availability:string})=>v.availability==='available');assert.ok(option);
  await f.page.goto(`${origin}/produk/${other.public_slug}?offer=${option.id}`);await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await acknowledged(f.page);await f.page.getByRole('link',{name:'Keranjang, 2 pilihan',exact:true}).first().click();await expect(f.page.locator('.cart-line')).toHaveCount(2);
  const form=(slug:string)=>f.page.locator('.cart-line').filter({has:f.page.locator(`a[href^="/produk/${slug}?"]`)}).locator('.cart-mutation').filter({has:f.page.locator('input[name=kind][value=update]')});const a=form(p.bundle.public_slug),b=form(other.public_slug);
  await f.page.route('**/keranjang',async(route,request)=>{if(held&&request.method()==='POST'&&request.headers()['next-action']){const pause=held;held=null;try{const response=await route.fetch();pause.arrive();await pause.wait;await route.fulfill({response});}finally{pause.complete();}}else await route.continue();});
  await b.getByRole('spinbutton').fill('3');await a.getByRole('spinbutton').fill('2');const first=hold();await a.locator('button[type=submit]').click();await first.ready;await expect(a.locator('button[type=submit]')).toBeDisabled();await expect(a.getByRole('status')).toContainText('Menyimpan perubahan');await expect(b.locator('button[type=submit]')).toBeEnabled();await expect(f.page.getByRole('link',{name:'Lanjut ke checkout',exact:true})).toHaveCount(0);await capture(f.page,'cart-pending-390');await a.evaluate(e=>e.scrollIntoView({block:'center'}));await capture(f.page,'cart-pending-detail-390',a);first.release();await acknowledged(f.page);await expect(b.getByRole('spinbutton')).toHaveValue('3');await expect(f.page.getByRole('link',{name:'Lanjut ke checkout',exact:true})).toBeVisible();
  let cart=await current(f.page);assert.equal(cart.lines.find((l:{product_id:string})=>l.product_id===p.bundle.id).quantity,2);assert.equal(cart.lines.find((l:{product_id:string})=>l.product_id===other.id).quantity,1);
  await a.getByRole('spinbutton').fill('1');const second=hold();await a.locator('button[type=submit]').click();await second.ready;await b.locator('button[type=submit]').click();await expect(a.locator('button[type=submit]')).toBeDisabled();await expect(b.locator('button[type=submit]')).toBeDisabled();second.release();await expect(f.page.locator('.cart-form-error')).toContainText('halaman lain');await expect(b.getByRole('spinbutton')).toHaveValue('3');
  cart=await current(f.page);assert.equal(cart.lines.find((l:{product_id:string})=>l.product_id===p.bundle.id).quantity,1);assert.equal(cart.lines.find((l:{product_id:string})=>l.product_id===other.id).quantity,1);assert.equal(cart.merchandise_total,198000);await a.getByRole('spinbutton').fill('2');await a.locator('button[type=submit]').click();await acknowledged(f.page);await expect(b.getByRole('spinbutton')).toHaveValue('3');
  const otherTab=await f.context.newPage();await otherTab.goto(origin+'/keranjang');await otherTab.locator('.cart-line').filter({has:otherTab.locator(`a[href^="/produk/${other.public_slug}?"]`)}).getByRole('button',{name:/^Hapus /}).click();await acknowledged(otherTab);
  await b.locator('button[type=submit]').click();await expect(f.page.locator('.cart-feedback')).toContainText('halaman lain');await expect(f.page.locator('.cart-feedback')).toHaveAttribute('role','alert');await expect(b).toHaveCount(0);assert.equal((await current(f.page)).lines.length,1);await otherTab.close();assert.deepEqual(f.errors,[]);
 }finally{for(const release of releases)release();await Promise.allSettled(completed);await close(f);}
});

for(const width of [390,1440])test(`Browser Back from a PDP restores the filtered source and native scroll at ${width}px`,async()=>{
 const f=await start(width);try{
  await f.page.setViewportSize({width,height:600});
  if(width===390)await f.context.addInitScript(()=>{Reflect.deleteProperty(URLSearchParams.prototype,'size');});
  const source='/cari?q=Contoh&offer_kind=multipack&availability=available&sort=newest&limit=40';
  await f.page.goto(origin+source);const card=f.page.locator('.product-link').first();await expect(card).toBeVisible();
  if(width===390)assert.equal(await f.page.evaluate(()=>'size' in URLSearchParams.prototype),false,'Exercise the older browser API without URLSearchParams.size');
  const href=await card.getAttribute('href');assert.ok(href);const target=new URL(href,origin),id=(await card.evaluate(a=>a.closest('li')?.id??'')).slice('product-'.length);assert.match(target.pathname,/^\/produk\/[a-z0-9]+(-[a-z0-9]+)*$/,'a card links to the clean slug');assert.ok(id);
  // The card names an offer only when it is not the one the page selects by default.
  const explicit=target.searchParams.get('offer');
  assert.equal(target.searchParams.get('from'),`${source}#product-${id}`);
  await card.scrollIntoViewIfNeeded();await card.focus();const y=await f.page.evaluate(()=>scrollY);await card.click();
  const offer=await f.page.locator('.cart-mutation input[name=variant]').inputValue();assert.ok(offer);if(explicit)assert.equal(explicit,offer);assert.equal(new URL(f.page.url()).searchParams.get('offer'),explicit);await expect(f.page.locator('.shopping-tabs')).toHaveCount(1);
  await capture(f.page,`pdp-back-${width}`);
  await f.page.getByRole('button',{name:'Tambah ke keranjang',exact:true}).click();await acknowledged(f.page);assert.equal((await current(f.page)).lines[0].variant_id,offer);
  if(width===1440)await f.page.reload();
  // The PDP has no back link (owner 2026-10-25); browser Back restores the filtered list and its scroll.
  await f.page.goBack();await expect(f.page).toHaveURL(origin+source);
  await expect.poll(()=>f.page.evaluate(()=>scrollY)).toBeCloseTo(y,0);await expect(f.page.locator('.product-link').first()).toBeVisible();await capture(f.page,`pdp-back-list-${width}`);
  assert.equal(await f.page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

