import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import test,{after,before} from 'node:test';
import {chromium,expect,type Page} from '@playwright/test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {releaseReservation} from '../../src/modules/inventory/reservations.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';

const origin='http://127.0.0.1:3099',output='docs/spec/design/renders/s21';
// The suite seeds and publishes its own namespace (no shared demo merchandising). Its four
// curated products are the newest publications, so they lead the home merchandising.
const identity=createLocalAuth('local'),namespace=`s21-${randomUUID().slice(0,8)}`,busana=`/category/shop-${namespace}-busana`;
const newest=['Contoh Paket Kaos dan Krim','Contoh Paket 2 Kaos','Contoh Paket 2 Krim','Contoh Kaos'];
let owner:Awaited<ReturnType<typeof actor>>|undefined,seeded:Awaited<ReturnType<typeof seedCommerce>>|undefined;
before(async()=>{
 owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);const request=()=>(owner as NonNullable<typeof owner>).browser.request('/api/v1/admin/products');
 seeded=await seedCommerce(request(),identity,'local',namespace);const curated=await prepareStorefront(request(),identity,'local',namespace,seeded);
 assert.ok(Object.values(curated.products).every(p=>p.publication_id),'own storefront products are published');
});
after(async()=>{
 try{if(seeded)for(const id of Object.values(seeded.reservations)){await identity.sql.begin(tx=>releaseReservation(tx,id,'Owned S21 storefront fixture finished'));await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${id}`;}}
 finally{try{if(owner)await cleanup(identity,[owner]);}finally{await identity.sql.end();}}
});
async function ownHome(page:Page){
 for(const [index,name] of newest.entries()) await expect(page.locator('.product').nth(index).getByRole('heading',{level:3})).toHaveText(name);
 // Live catalog photos are served same-origin by content hash; sample fixtures render labelled slots.
 for(const src of await page.locator('img.product-image').evaluateAll(images=>images.map(i=>i.getAttribute('src')))) assert.match(src??'',/^\/(?:media\/catalog\/[0-9a-f]{64}\.webp|fixtures\/)/);
}
async function capture(page:Page,file:string){
 await page.evaluate(()=>document.fonts.ready);const viewport=page.viewportSize();assert.ok(viewport);
 if(new URL(page.url()).pathname.startsWith('/product/')){await expect(page.locator('.shopping-tabs')).toHaveCount(0);await expect(page.locator('.task-header')).toBeVisible();}
 else{await expect(page.locator('.shopping-tabs')).toHaveCount(1);if(viewport.width<=700)await expect(page.locator('.shopping-tabs')).toBeInViewport({ratio:1});else await expect(page.locator('.shopping-tabs')).toBeHidden();}
 const fullPage=await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight);
 await page.screenshot({path:`${output}/${file}`,fullPage});
}

async function start(width=390,javaScriptEnabled=true){
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',javaScriptEnabled});const page=await context.newPage();page.setDefaultTimeout(10000);
 const errors:string[]=[];page.on('pageerror',()=>errors.push('Uncaught page error'));page.on('requestfailed',request=>{const error=request.failure()?.errorText??'';const browserDisabledScript=!javaScriptEnabled&&request.resourceType()==='script'&&error==='csp';if(!error.includes('ERR_ABORTED')&&!browserDisabledScript) errors.push('Failed page request');});
 page.on('request',request=>{if(new URL(request.url()).origin!==origin) errors.push('External request');});
 return {browser,context,page,errors};
}
for(const width of [320,390,768,1440]) test(`built storefront home and category reflow at ${width}px with a single mobile bottom region`,async()=>{
 const f=await start(width);try{
  assert.equal((await f.page.goto(origin))?.status(),200);await expect(f.page.getByRole('heading',{name:'Pilihan lengkap. Harga tetap.'})).toBeVisible();await ownHome(f.page);
  await f.page.evaluate(()=>document.fonts.ready);assert.equal(await f.page.evaluate(()=>document.fonts.check('16px Inter')),true);
  await expect.poll(()=>f.page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),{message:'Page horizontal overflow delta'}).toBeLessThanOrEqual(1);
  const tabs=f.page.getByRole('navigation',{name:'Navigasi belanja'});if(width<=700){await expect(tabs).toBeVisible();await expect(tabs.getByRole('link')).toHaveCount(4);}else await expect(tabs).toBeHidden();
  for(const [index,name] of newest.entries()) await expect(f.page.locator('.product').nth(index).getByRole('img',{name:`Slot foto ${name}; foto produk asli belum tersedia`})).toHaveCount(1);
  await mkdir(output,{recursive:true});await capture(f.page,`home-${width}.png`);
  await f.page.goto(origin+busana);await expect(f.page.getByRole('heading',{level:1,name:'Busana'})).toBeVisible();await expect(f.page.locator('.product')).toHaveCount(2);
  await expect.poll(()=>f.page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),{message:'Page horizontal overflow delta'}).toBeLessThanOrEqual(1);
  await capture(f.page,`category-${width}.png`);
  const ownCategory=await f.page.getByLabel('Kategori',{exact:true}).inputValue();
  await f.page.goto(`${origin}/search?q=Contoh&offer_kind=multipack&category_id=${ownCategory}`);await expect(f.page.locator('.product')).toHaveCount(1);await expect(f.page.getByRole('list',{name:'Filter aktif'}).getByRole('link',{name:/Isi pilihan/})).toBeVisible();await capture(f.page,`search-${width}.png`);
  if([390,1440].includes(width)){await f.page.goto(`${origin}/categories`);await expect(f.page.getByRole('heading',{level:1,name:'Kategori produk'})).toBeVisible();await expect(f.page.locator('.department-tiles li')).toHaveCount(4);await capture(f.page,`departments-${width}.png`);await f.page.goto(`${origin}/help#returns`);await expect(f.page.getByRole('heading',{name:'Pengembalian',exact:true})).toBeVisible();await capture(f.page,`help-${width}.png`);
   await f.page.goto(origin);const productHref=await f.page.locator('.product-link').first().getAttribute('href');assert.ok(productHref?.startsWith('/product/'));await f.page.goto(`${origin}${productHref}`);await expect(f.page.locator('.offer-detail')).toBeVisible();await capture(f.page,`product-preview-${width}.png`);if(width===390){await f.page.locator('.detail-price').scrollIntoViewIfNeeded();await expect(f.page.locator('.detail-price')).toBeInViewport();await f.page.screenshot({path:`${output}/product-preview-detail-390.png`});}
   for(const [route,heading,file] of [['/cart','Keranjang masih kosong','cart-empty'],['/account','Halaman akun sedang disiapkan','account-pending']] as const){await f.page.goto(origin+route);await expect(f.page.getByRole('heading',{level:1,name:heading})).toBeVisible();await capture(f.page,`${file}-${width}.png`);}
   assert.equal((await f.page.goto(`${origin}/category/not-a-real-department`))?.status(),404);await expect(f.page.getByRole('heading',{name:'Halaman belum tersedia'})).toBeVisible();await capture(f.page,`not-found-${width}.png`);}
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});

test('built mobile search/filter/back/reload and all three anonymous API wire contracts preserve public state',async()=>{
 const f=await start(),samples:Exchange[]=[];try{
  await f.page.goto(origin+busana);await expect(f.page.locator('.product')).toHaveCount(2);const ownCategory=await f.page.getByLabel('Kategori',{exact:true}).inputValue();
  await f.page.locator('.filters summary').click();await f.page.getByLabel('Isi pilihan',{exact:true}).selectOption('multipack');await f.page.getByRole('button',{name:'Terapkan filter'}).click();
  await expect(f.page.locator('.product')).toHaveCount(1);assert.equal(new URL(f.page.url()).searchParams.get('offer_kind'),'multipack');
  await expect(f.page.getByRole('list',{name:'Filter aktif'}).getByRole('link',{name:/Isi pilihan/})).toBeVisible();
  const filtered=f.page.url();await f.page.reload();await expect(f.page.getByLabel('Isi pilihan',{exact:true})).toHaveValue('multipack');
  await f.page.getByRole('link',{name:'Contoh Paket 2 Kaos'}).click();await expect(f.page.getByRole('heading',{level:1,name:'Contoh Paket 2 Kaos'})).toBeVisible();await expect(f.page.getByText('2 × Kaos contoh',{exact:true})).toBeVisible();
  await f.page.goBack();await expect(f.page.locator('.product')).toHaveCount(1);assert.equal(f.page.url(),filtered);
  const search=f.page.getByRole('searchbox',{name:'Cari produk'});await search.fill('contoh-tidak-cocok');await f.page.getByRole('button',{name:'Cari produk',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Belum ada produk yang sesuai'})).toBeVisible();
  await capture(f.page,`empty-390.png`);
  await f.page.goto(`${origin}/search?sort=cheapest&q=kaos`);await expect(f.page.getByRole('heading',{name:'Filter belum bisa digunakan'})).toBeVisible();await expect(search).toHaveValue('kaos');await capture(f.page,`invalid-filter-390.png`);
  const call=async(path:string,status:number)=>{const result=await f.page.evaluate(async path=>{const response=await fetch(path);return {status:response.status,headers:Object.fromEntries(response.headers),payload:await response.json()};},path);assert.equal(result.status,status);samples.push({url:origin+path,method:'GET',request_headers:{},...result});return result.payload;};
  await call('/api/v1/categories?limit=1',200);await call('/api/v1/categories?limit=0',400);
  const products=await call('/api/v1/products?q=Contoh&limit=1',200);assert.equal(products.data.length,1);await call('/api/v1/products?sort=cheapest',400);
  await call(`/api/v1/products/${products.data[0].id}`,200);await call(`/api/v1/products/${randomUUID()}`,404);validateExchanges(samples,'storefront');
  await f.page.goto(`${origin}/search?q=Contoh&offer_kind=multipack&category_id=${ownCategory}`);await expect(f.page.locator('.product')).toHaveCount(1);await expect(f.page.getByRole('list',{name:'Filter aktif'}).getByRole('link',{name:/Isi pilihan/})).toBeVisible();await capture(f.page,`search-390.png`);
  assert.deepEqual(await f.page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});assert.deepEqual(await f.context.cookies(),[]);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});

test('built storefront remains usable without JavaScript and keyboard focus remains clear at 200 percent text',async()=>{
 const f=await start(320);try{
  await f.page.goto(origin);await f.page.locator('.product').first().waitFor();await f.page.evaluate(()=>document.fonts.ready);await f.page.evaluate(()=>{document.documentElement.style.fontSize='200%';});await ownHome(f.page);
  await expect.poll(()=>f.page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),{message:'Page horizontal overflow delta'}).toBeLessThanOrEqual(1);
  await f.page.getByRole('link',{name:'99ribu, beranda'}).focus();await f.page.keyboard.press('Shift+Tab');await expect(f.page.getByRole('link',{name:'Lewati ke konten'})).toBeFocused();
  for(let i=0;i<20;i++){await f.page.keyboard.press('Tab');const focus=await f.page.locator(':focus').boundingBox();const bar=await f.page.locator('.shopping-tabs').boundingBox();assert.ok(focus&&bar);if(await f.page.locator('.shopping-tabs :focus').count())assert.ok(focus.y>=bar.y&&focus.y+focus.height<=bar.y+bar.height,'Focused shopping tab stays inside its navigation');else assert.ok(focus.y+focus.height>0&&focus.y<bar.y,'Focused content must not be covered by bottom navigation');}
  assert.ok(await f.page.locator('.shopping-tabs span').evaluateAll(spans=>spans.every(span=>{const range=document.createRange();range.selectNodeContents(span);const text=range.getBoundingClientRect(),target=span.parentElement?.getBoundingClientRect();return target!==undefined&&range.getClientRects().length===1&&text.left>=target.left-1&&text.right<=target.right+1;})),'Every enlarged tab label stays on one line');
  assert.ok(await f.page.locator('.department-photo').evaluateAll(elements=>elements.every(e=>e.scrollHeight-e.clientHeight<=1)),'Enlarged photograph briefs remain inside their slots');
  // Tiles drop to one column at 200% text, so compare labels of tiles that actually share a row.
  const tiles=await f.page.locator('.department-tiles li').evaluateAll(items=>items.map(li=>({row:Math.round(li.getBoundingClientRect().top),label:li.querySelector('a>span')?.getBoundingClientRect().top??Number.NaN})));assert.equal(tiles.length,4);
  for(const tile of tiles) for(const peer of tiles) if(peer.row===tile.row) assert.ok(Math.abs(tile.label-peer.label)<=1,'Enlarged department labels in one row share one baseline');
  await expect(f.page.getByRole('link',{name:'Lewati ke konten'})).toHaveCSS('clip-path','inset(50%)');
  await capture(f.page,`text-200-320.png`);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
 const nojs=await start(390,false);try{
  await nojs.page.goto(origin+busana);await expect(nojs.page.getByRole('heading',{level:1,name:'Busana'})).toBeVisible();const ownCategory=await nojs.page.getByLabel('Kategori',{exact:true}).inputValue();await nojs.page.getByRole('searchbox',{name:'Cari produk'}).fill('Contoh');await nojs.page.getByRole('button',{name:'Cari produk',exact:true}).click();await expect(nojs.page.getByRole('heading',{level:1,name:'Hasil untuk “Contoh”'})).toBeVisible();
  await nojs.page.locator('.filters summary').click();await nojs.page.getByLabel('Kategori',{exact:true}).selectOption(ownCategory);await nojs.page.getByLabel('Isi pilihan',{exact:true}).selectOption('multipack');await nojs.page.getByRole('button',{name:'Terapkan filter'}).click();await expect(nojs.page.locator('.product')).toHaveCount(1);assert.deepEqual(nojs.errors,[]);
 }finally{await nojs.browser.close();}
});
