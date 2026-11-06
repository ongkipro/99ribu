import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createServer,type Server} from 'node:http';
import test from 'node:test';
import {chromium,expect,type Page} from '@playwright/test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {releaseReservation} from '../../src/modules/inventory/reservations.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {CommerceClient} from '../integration/checkout-fixture.ts';
import {RENDERS} from '../render-root.ts';

// DEC-028 / S168: checkout states in local provider mode. Required state: the built web is running with
// LOCAL_PROVIDER_ORIGIN=http://127.0.0.1:18790 and the local catalogue (S164) loaded. This file starts the provider
// stand-in itself on that port as an in-test fake (AdsBookCMS estimate shape with real Mengantar keys; S171 is review
// only), so each state is reachable deterministically. Prices are this test's fakes.
const origin='http://127.0.0.1:3099',FAKE_PORT=18790,namespace=`s168-${randomUUID().slice(0,8)}`;
const output=`${RENDERS}/s168/${readFileSync('.next/BUILD_ID','utf8').trim()}`;
const identity=createLocalAuth('local');
type Mode='ok'|'down'|'empty'|'nocod';
let mode:Mode='ok',server:Server|undefined,estimates=0;
let owner:Awaited<ReturnType<typeof actor>>,seeded:Awaited<ReturnType<typeof seedCommerce>>,curated:Awaited<ReturnType<typeof prepareStorefront>>;
let warehouses:string[]=[];const carts:string[]=[];
// The web process caches an estimate for five minutes per route (production behaviour), so every state uses its own
// destination: single-kelurahan postal codes from the loaded catalogue.
let postcodes:string[]=[];
const row=(price:number,cod:boolean)=>({price,estimate_delivery:'2-3',unsupported:false,unsupported_cod:!cod,codFee:0});

test.before(async()=>{
 server=createServer((request,response)=>{
  const path=new URL(request.url??'/','http://x').pathname;
  if(/^\/api\/public\/[^/]+\/order\/estimate$/.test(path)){
   estimates++;
   if(mode==='down'){response.writeHead(503,{'content-type':'application/json'});response.end('{}');return;}
   const data=mode==='empty'?{}:mode==='nocod'?{JNE:row(12000,false),SiCepat:row(10500,false)}:{JNE:row(12000,true),SiCepat:row(10500,false),'J&T':row(9000,true)};
   response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({success:true,data}));return;
  }
  response.writeHead(404,{'content-type':'application/json'});response.end('{"error":"not found"}');
 });
 await new Promise<void>((resolve,reject)=>{server?.once('error',reject);server?.listen(FAKE_PORT,'127.0.0.1',()=>resolve());});
 owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 const request=()=>owner.browser.request('/api/v1/admin/products');
 seeded=await seedCommerce(request(),identity,'local',namespace);curated=await prepareStorefront(request(),identity,'local',namespace,seeded);
 const clock=await readFixtureClock('local',namespace),seconds=Math.ceil((Date.now()-Date.parse(clock.now))/1000);if(seconds>0)await advanceFixtureClock('local',namespace,seconds,clock.version);
 // Origin: a real catalogue kelurahan for the owned fixture warehouses (the fixture names match no Mengantar area).
 const [area]=await identity.sql`select id from app.shipping_area where district='KLOJEN' and city like '%MALANG%' order by postal_code,id limit 1`;
 assert.ok(area,'S164 catalogue must be loaded into 99ribu_local');
 // Random per run: the web process caches an estimate for five minutes per route, so a rerun soon after must not
 // reuse the previous run's destinations.
 postcodes=(await identity.sql`select postal_code from (select postal_code from app.shipping_area where postal_code<>'' group by postal_code having count(*)=1) single order by random() limit 12`).map(r=>String(r.postal_code));
 assert.equal(postcodes.length,12);
 warehouses=(await identity.sql`select warehouse_id from app.local_fixture_warehouse where namespace=${namespace}`).map(r=>String(r.warehouse_id));
 await identity.sql`update app.warehouse set provider_area_id=${area.id} where id in ${identity.sql(warehouses)}`;
});
test.after(async()=>{
 const failures:unknown[]=[];
 try{if(warehouses.length)await identity.sql`update app.warehouse set provider_area_id=null where id in ${identity.sql(warehouses)}`;}catch(error){failures.push(error);}
 try{if(seeded)for(const reservation of Object.values(seeded.reservations)){await identity.sql.begin(tx=>releaseReservation(tx,reservation,'Owned S168 browser fixture finished'));await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${reservation}`;}if(owner)await cleanup(identity,[owner]);}catch(error){failures.push(error);}
 await new Promise<void>(resolve=>{if(!server)return resolve();server.closeAllConnections();server.close(()=>resolve());});
 await identity.sql.end();if(failures.length)throw new AggregateError(failures,'Owned S168 browser cleanup failed');
});

async function start(width:number){
 const product=curated.products['shirt-cream'];assert.ok(product.publication_id);
 const client=new CommerceClient(identity),body={lines:[{variant_id:product.offer_id,quantity:1,expected_publication_id:product.publication_id}]},key=randomUUID();
 assert.equal((await client.call('/api/v1/carts',body,{key})).response.status,401);
 const request=client.request('/api/v1/carts',body,{key}),principal=await commerceActor(request,identity);assert.ok(principal?.kind==='guest');
 const created=await identity.sql.begin(tx=>createCart(tx,request,identity,principal,body,{clock_namespace:namespace}));carts.push(created.cart.id);
 assert.equal((await client.call('/api/v1/carts',body,{key})).response.status,201);
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 // Phone widths run as a touch device: the checkout keeps 14 px controls for a mouse and 16 px under (pointer: coarse).
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',...(width<=430?{hasTouch:true,isMobile:true}:{})}),page=await context.newPage();page.setDefaultTimeout(15000);
 const errors:string[]=[];page.on('pageerror',()=>errors.push('Uncaught page error'));
 page.on('request',r=>assert.equal(new URL(r.url()).origin,origin,'the browser never calls a provider'));
 await context.addCookies([...client.cookies.values()].map(c=>({name:c.name,value:c.value,domain:'127.0.0.1',path:c.path,httpOnly:true,sameSite:'Lax' as const,secure:false})));
 return {browser,page,errors};
}
async function capture(page:Page,name:string){
 await mkdir(output,{recursive:true});await page.evaluate(()=>document.fonts.ready);
 const text=await page.locator('body').innerText();assert.doesNotMatch(text,/SHIPPING_|NO_SUPPORTED|COD_UNAVAILABLE|127\.0\.0\.1:18790|undefined|NaN/,'no provider code, URL or raw value on screen');
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);assert.equal(overflow,false,`${name}: no horizontal overflow`);
 const small=await page.evaluate(()=>[...document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),select,textarea')].filter(e=>(e as HTMLElement).offsetParent&&Number.parseFloat(getComputedStyle(e).fontSize)<(matchMedia('(pointer: coarse)').matches?16:14)).map(e=>`${e.tagName.toLowerCase()}${e.id?`#${e.id}`:''}${e.getAttribute('name')?`[name=${e.getAttribute('name')}]`:''}${e.getAttribute('data-testid')?`[${e.getAttribute('data-testid')}]`:''} ${getComputedStyle(e).fontSize}`));
 assert.deepEqual(small,[],`${name}: text controls are at least 16 px on touch (no iOS zoom) and 14 px with a mouse`);
 await writeFile(`${output}/${name}.png`,await page.screenshot({fullPage:true}));
}
// Couriers load by themselves once the address is complete (owner 2026-11-05). Without JavaScript "Cek ongkir" asks for
// them; with JavaScript an incomplete or rejected address is checked by pressing "Buat pesanan" in the contact step.
async function calculate(page:Page){
 const nojs=page.getByRole('button',{name:'Cek ongkir',exact:true}),review=page.locator('dl.checkout-review-box');
 if(await nojs.isVisible()){await nojs.click();return;}
 if(await review.isVisible()||await review.waitFor({timeout:2500}).then(()=>true,()=>false))return;
 await page.getByRole('button',{name:'Buat pesanan',exact:true}).click();
}
async function fill(page:Page,method:'prepaid'|'cod',postcode:string){
 await page.getByLabel('Nama lengkap',{exact:true}).fill('Penerima Contoh');await page.getByLabel('Nomor WhatsApp',{exact:true}).fill('081200000000');
 // Kecamatan type-ahead finds the kecamatan holding this postal code; then the kelurahan with that code is chosen.
 await page.getByLabel('Kecamatan tujuan',{exact:true}).fill(postcode);
 const suggestion=page.getByRole('listbox',{name:'Kecamatan'}).getByRole('option').first();
 await expect(suggestion).toBeVisible();await suggestion.click();
 const kelurahan=page.getByRole('combobox',{name:'Kelurahan / desa',exact:true});await expect(kelurahan).toBeEnabled();
 if(!await page.locator('input[type=hidden][name=destination_id]').inputValue()){await kelurahan.fill(postcode);await page.getByRole('listbox',{name:'Kelurahan atau desa'}).getByRole('option').first().click();}
 await page.getByLabel('Alamat lengkap',{exact:true}).fill('Jalan Contoh 12\nRT 01');
 await page.locator(`input[name=payment_method][value=${method}]`).check();
}

for(const [index,width] of [390,768,1440].entries()){
 test(`S168 provider-mode checkout states at ${width}px`,async()=>{
  // Area search: none found.
  {const f=await start(width);try{
   await f.page.goto(`${origin}/checkout`);await f.page.getByLabel('Kecamatan tujuan',{exact:true}).fill('zzqxw');
   await expect(f.page.getByText('Kecamatan tidak ditemukan. Periksa ejaan atau coba nama kecamatan lain.',{exact:true})).toBeVisible();
   await capture(f.page,`area-none-${width}`);assert.deepEqual(f.errors,[]);
  }finally{await f.browser.close();}}
  // Couriers listed with prices; COD only where the provider allows it.
  {mode='ok';const before=estimates;const f=await start(width);try{
   await f.page.goto(`${origin}/checkout`);await fill(f.page,'prepaid',postcodes[index*4]);await calculate(f.page);
   await expect(f.page.locator('dl.checkout-review-box')).toBeVisible();
   const shipping=f.page.locator('section',{has:f.page.getByRole('heading',{name:'Metode pengiriman',exact:true})});
   await expect(shipping.getByText('SiCepat',{exact:false}).first()).toBeVisible();await expect(shipping.getByText('JNE',{exact:false}).first()).toBeVisible();
   assert.equal(await shipping.getByText('J&T',{exact:false}).count(),0,'a stand-in key that is not a real Mengantar key is hidden');
   assert.ok(estimates>before,'the quote used the provider');
   await capture(f.page,`couriers-${width}`);assert.deepEqual(f.errors,[]);
  }finally{await f.browser.close();}}
  // Provider down: concrete retry copy, draft kept, no unknown-outcome recovery.
  {mode='down';const f=await start(width);try{
   await f.page.goto(`${origin}/checkout`);await fill(f.page,'prepaid',postcodes[index*4+1]);await calculate(f.page);
   await expect(f.page.getByText('Pilihan kurir belum bisa dimuat. Isian Anda tersimpan. Coba lagi sebentar lagi.',{exact:true})).toBeVisible();
   await expect(f.page.getByText('Hasil tindakan belum diketahui',{exact:false})).toHaveCount(0);
   await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');
   await expect(f.page.getByRole('button',{name:'Coba lagi',exact:true})).toBeVisible();
   await expect(f.page.getByText('Pilihan kurir belum bisa dimuat.',{exact:true})).toBeVisible();
   await expect(f.page.locator('#checkout-primary')).toBeVisible();
   await capture(f.page,`provider-down-${width}`);assert.deepEqual(f.errors,[]);
  }finally{await f.browser.close();}}
  // No courier for the destination.
  {mode='empty';const f=await start(width);try{
   await f.page.goto(`${origin}/checkout`);await fill(f.page,'prepaid',postcodes[index*4+2]);await calculate(f.page);
   await expect(f.page.getByText('Belum ada pengiriman untuk tujuan dan isi keranjang ini.',{exact:false}).first()).toBeVisible();
   await capture(f.page,`no-courier-${width}`);assert.deepEqual(f.errors,[]);
  }finally{await f.browser.close();}}
  // COD chosen but no courier accepts COD here.
  {mode='nocod';const f=await start(width);try{
   await f.page.goto(`${origin}/checkout`);await fill(f.page,'cod',postcodes[index*4+3]);await calculate(f.page);
   await expect(f.page.getByText('COD belum tersedia untuk tujuan atau paket ini.',{exact:false}).first()).toBeVisible();
   await capture(f.page,`cod-unavailable-${width}`);assert.deepEqual(f.errors,[]);
  }finally{await f.browser.close();}}
 });
}

test('S176 provider mode: the account address form searches the real area catalogue and saves its area id',async()=>{
 const buyer=await actor(identity,'buyer',[]);
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   await context.addCookies([...buyer.browser.cookies].map(([name,value])=>({name,value,domain:'127.0.0.1',path:'/'})));
   const page=await context.newPage();page.setDefaultTimeout(15000);const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
   try{
    await page.goto(`${origin}/akun/profil`);
    await page.getByTestId('address-add-button').click();
    const form=page.getByTestId('main-address-form');
    await expect(form.getByRole('combobox')).toHaveCount(0); // no fixture list in provider mode
    await form.getByLabel('Nama penerima').fill('Penerima Contoh');await form.getByLabel('Nomor HP penerima').fill('081200000000');
    await form.getByTestId('main-address-query').fill('zzqxw');await form.getByRole('button',{name:'Cari wilayah'}).click();
    await expect(page.getByText('Wilayah tidak ditemukan. Coba nama kelurahan, kecamatan, atau kode pos lain.')).toBeVisible();
    await form.getByTestId('main-address-query').fill(postcodes[width===390?0:1]);await form.getByRole('button',{name:'Cari wilayah'}).click();
    const option=form.getByRole('list',{name:'Saran wilayah'}).getByRole('button').first();await expect(option).toBeVisible();
    await capture(page,`account-area-search-${width}`);
    await option.click();await expect(form.getByTestId('main-address-destination')).toContainText(postcodes[width===390?0:1]);
    await form.getByTestId('main-address-street').fill('Jalan Contoh 12');
    await form.getByTestId('main-address-save').click();await expect(form).toHaveCount(0);
    const [saved]=await identity.sql`select destination_code,postcode from app.buyer_address where user_id=${buyer.id} order by created_at desc limit 1`;
    const [area]=await identity.sql`select id from app.shipping_area where id=${saved.destination_code}`;
    assert.ok(area,'the saved area id exists in the catalogue');assert.equal(saved.postcode,postcodes[width===390?0:1]);
    assert.deepEqual(errors,[]);
   }finally{await context.close();}
  }
 }finally{
  await browser.close();
  // Same owned cleanup as buyer-profile.test.ts: the profile page creates preferences, the form an address.
  for(const table of ['marketing_consent','buyer_address','buyer_notification_preference','buyer_profile'] as const)await identity.sql`delete from ${identity.sql('app.'+table)} where user_id=${buyer.id}`;
  await cleanup(identity,[buyer]);
 }
});

test('S176 provider mode: the shipping promotion form offers real couriers and provinces, not fixture destinations',async()=>{
 const staff=await actor(identity,'owner',[]);await enroll(staff.browser,staff.password);
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   await context.addCookies([...staff.browser.cookies].map(([name,value])=>({name,value,domain:'127.0.0.1',path:'/'})));
   const page=await context.newPage();page.setDefaultTimeout(15000);const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
   try{
    await page.goto(`${origin}/admin/promo/ongkir`);await page.getByTestId('promotion-create').click();
    const dialog=page.getByRole('dialog');
    for(const label of ['DKI Jakarta','DI Yogyakarta','Jawa Timur','J&T Express','SiCepat'])await expect(dialog.getByLabel(label,{exact:true})).toBeAttached();
    await expect(dialog.getByText('Contoh',{exact:false})).toHaveCount(0);
    await writeFile(`${output}/admin-promo-${width}.png`,await dialog.screenshot());
    assert.deepEqual(errors,[]);
   }finally{await context.close();}
  }
 }finally{await browser.close();await identity.sql`delete from app.auth_rate_limit where key=${`access-proof:${staff.id}`}`;await cleanup(identity,[staff]);}
});
