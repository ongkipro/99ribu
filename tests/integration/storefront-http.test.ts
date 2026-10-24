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
import {RENDERS} from '../render-root.ts';

const origin='http://127.0.0.1:3099',output=`${RENDERS}/s21`;
// The suite seeds and publishes its own namespace (no shared demo merchandising). Its four
// curated products are the newest publications, so they lead the home merchandising.
const identity=createLocalAuth('local'),namespace=`s21-${randomUUID().slice(0,8)}`,busana=`/kategori/shop-${namespace}-busana`;
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
async function ownCategoryId(){const [row]=await identity.sql<{id:string}[]>`select id from app.category where slug=${`shop-${namespace}-busana`}`;assert.ok(row);return row.id;}
async function ownHome(page:Page){
 for(const [index,name] of newest.entries()) await expect(page.locator('.product').nth(index).getByRole('heading',{level:3})).toHaveText(name);
 // Live catalog photos are served same-origin by content hash; sample fixtures render labelled slots.
 // Same-origin catalog media only, directly or through the Next image optimizer (SEO name <title-slug>-<12 hex>, or the legacy sha256 name).
 for(const raw of await page.locator('img.product-image').evaluateAll(images=>images.map(i=>i.getAttribute('src')))){const src=raw?.startsWith('/_next/image?')?new URL(raw,origin).searchParams.get('url'):raw;assert.match(src??'',/^\/(?:media\/catalog\/(?:[a-z0-9-]+-[0-9a-f]{12}|[0-9a-f]{64})\.webp|fixtures\/)/);}
}
async function capture(page:Page,file:string){
 await page.evaluate(()=>document.fonts.ready);const viewport=page.viewportSize();assert.ok(viewport);
 if(new URL(page.url()).pathname.startsWith('/produk/')){await expect(page.locator('.shopping-tabs')).toHaveCount(0);await expect(page.locator('.task-header')).toBeVisible();}
 else{await expect(page.locator('.shopping-tabs')).toHaveCount(1);if(viewport.width<=700)await expect(page.locator('.shopping-tabs')).toBeInViewport({ratio:1});else await expect(page.locator('.shopping-tabs')).toBeHidden();}
 const fullPage=await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight);
 await page.screenshot({path:`${output}/${file}`,fullPage});
}

async function start(width=390,javaScriptEnabled=true){
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',javaScriptEnabled});const page=await context.newPage();page.setDefaultTimeout(10000);
 const errors:string[]=[];page.on('pageerror',()=>errors.push('Uncaught page error'));page.on('requestfailed',request=>{const error=request.failure()?.errorText??'';const browserDisabledScript=!javaScriptEnabled&&request.resourceType()==='script'&&error==='csp';if(!error.includes('ERR_ABORTED')&&!browserDisabledScript) errors.push(`Failed page request ${request.url()} ${error}`);});
 page.on('request',request=>{if(new URL(request.url()).origin!==origin) errors.push(`External request ${request.url().slice(0,120)}`);});
 return {browser,context,page,errors};
}
for(const width of [320,390,768,1440]) test(`built storefront home and category reflow at ${width}px with a single mobile bottom region`,async()=>{
 const f=await start(width);try{
  assert.equal((await f.page.goto(origin))?.status(),200);await expect(f.page.getByRole('heading',{level:1,name:'Semua Rp99.000'})).toBeVisible();await ownHome(f.page);
  await f.page.evaluate(()=>document.fonts.ready);// The Latin subset face renders the page; the full face (other scripts) stays unloaded by design, so fonts.check() over both faces would be false.
  assert.equal(await f.page.evaluate(()=>[...document.fonts].some(face=>face.family.replaceAll('"','')==='Inter'&&face.status==='loaded'&&face.unicodeRange.startsWith('U+0-FF,'))),true);
  await expect.poll(()=>f.page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),{message:'Page horizontal overflow delta'}).toBeLessThanOrEqual(1);
  const tabs=f.page.getByRole('navigation',{name:'Navigasi belanja'});if(width<=700){await expect(tabs).toBeVisible();await expect(tabs.getByRole('link')).toHaveCount(4);}else await expect(tabs).toBeHidden();
  for(const [index,name] of newest.entries()) await expect(f.page.locator('.product').nth(index).getByRole('img',{name:`Slot foto ${name}; foto produk asli belum tersedia`})).toHaveCount(1);
  await mkdir(output,{recursive:true});await capture(f.page,`home-${width}.png`);
  await f.page.goto(origin+busana);await expect(f.page.getByRole('heading',{level:1,name:'Busana'})).toBeVisible();await expect(f.page.locator('.product')).toHaveCount(2);
  await expect.poll(()=>f.page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),{message:'Page horizontal overflow delta'}).toBeLessThanOrEqual(1);
  await capture(f.page,`category-${width}.png`);
  const ownCategory=await ownCategoryId();
  await f.page.goto(`${origin}/cari?q=Contoh&offer_kind=multipack&category_id=${ownCategory}`);await expect(f.page.locator('.product')).toHaveCount(1);await expect(f.page.getByRole('group',{name:'Filter dan urutan'}).getByRole('link',{name:/^Hapus filter Isi pilihan: /})).toBeVisible();await capture(f.page,`search-${width}.png`);
  if([390,1440].includes(width)){await f.page.goto(`${origin}/kategori`);await expect(f.page.getByRole('heading',{level:1,name:'Kategori produk'})).toBeVisible();assert.ok(await f.page.locator('.category-grid li').count()>=await f.page.getByRole('navigation',{name:'Kategori produk'}).getByRole('link').count()-1,'/kategori lists every department; the pill row shows the top five plus Semua kategori');await capture(f.page,`departments-${width}.png`);await f.page.goto(`${origin}/bantuan#returns`);await expect(f.page.getByRole('heading',{name:'Pengembalian',exact:true})).toBeVisible();await capture(f.page,`help-${width}.png`);
   await f.page.goto(origin);const productHref=await f.page.locator('.product-link').first().getAttribute('href');assert.ok(productHref?.startsWith('/produk/'));await f.page.goto(`${origin}${productHref}`);await expect(f.page.locator('.offer-detail')).toBeVisible();await capture(f.page,`product-preview-${width}.png`);if(width===390){await f.page.locator('.detail-price').scrollIntoViewIfNeeded();await expect(f.page.locator('.detail-price')).toBeInViewport();await f.page.screenshot({path:`${output}/product-preview-detail-390.png`});}
   for(const [route,heading,file] of [['/keranjang','Keranjang masih kosong','cart-empty'],['/akun','Akun opsional','account-pending']] as const){await f.page.goto(origin+route);await expect(f.page.getByRole('heading',{level:1,name:heading})).toBeVisible();await capture(f.page,`${file}-${width}.png`);}
   assert.equal((await f.page.goto(`${origin}/kategori/not-a-real-department`))?.status(),404);await expect(f.page.getByRole('heading',{name:'Halaman belum tersedia'})).toBeVisible();await capture(f.page,`not-found-${width}.png`);}
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});

test('built mobile search/filter/back/reload and all three anonymous API wire contracts preserve public state',async()=>{
 const f=await start(),samples:Exchange[]=[];try{
  await f.page.goto(origin+busana);await expect(f.page.locator('.product')).toHaveCount(2);const ownCategory=await ownCategoryId();
  // Chip row (JS): the chip names its current value; choosing an option navigates at once.
  await f.page.getByRole('button',{name:'Isi pilihan: Semua pilihan',exact:true}).click();await f.page.getByRole('dialog',{name:'Isi pilihan'}).getByRole('link',{name:'Paket barang yang sama',exact:true}).click();
  await expect(f.page.locator('.product')).toHaveCount(1);assert.equal(new URL(f.page.url()).searchParams.get('offer_kind'),'multipack');
  await expect(f.page.getByRole('group',{name:'Filter dan urutan'}).getByRole('link',{name:/^Hapus filter Isi pilihan: /})).toBeVisible();
  const filtered=f.page.url();await f.page.reload();await expect(f.page.getByRole('button',{name:'Isi pilihan: Paket barang yang sama',exact:true})).toBeVisible();
  await f.page.getByRole('link',{name:'Contoh Paket 2 Kaos'}).click();await expect(f.page.getByRole('heading',{level:1,name:'Contoh Paket 2 Kaos'})).toBeVisible();await expect(f.page.getByText('2 × Kaos contoh',{exact:true})).toBeVisible();
  await f.page.goBack();await expect(f.page.locator('.product')).toHaveCount(1);assert.equal(f.page.url(),filtered);
  const search=f.page.getByRole('combobox',{name:'Cari produk'});await search.focus();
  // Suggestions are product-type phrases: never a bare unit or generic head left over from a pack prefix ("2 × 5 pcs ...").
  const suggested=await f.page.getByRole('listbox').getByRole('option').allTextContents();assert.ok(suggested.length>0,'Focusing the omnibox lists suggestions');for(const option of suggested)assert.doesNotMatch(option.trim(),/^(?:pcs|pc|set|isi|paket|alat)$/i,`Unit or generic suggestion: ${option} in ${JSON.stringify(suggested)} (value ${JSON.stringify(await search.inputValue())})`);
  await search.fill('contoh-tidak-cocok');await f.page.getByRole('button',{name:'Cari produk',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Belum ada produk yang sesuai'})).toBeVisible();
  await capture(f.page,`empty-390.png`);
  await f.page.goto(`${origin}/cari?sort=cheapest&q=kaos`);await expect(f.page.getByRole('heading',{name:'Filter belum bisa digunakan'})).toBeVisible();await expect(search).toHaveValue('kaos');await capture(f.page,`invalid-filter-390.png`);
  const call=async(path:string,status:number)=>{const result=await f.page.evaluate(async path=>{const response=await fetch(path);return {status:response.status,headers:Object.fromEntries(response.headers),payload:await response.json()};},path);assert.equal(result.status,status);samples.push({url:origin+path,method:'GET',request_headers:{},...result});return result.payload;};
  await call('/api/v1/categories?limit=1',200);await call('/api/v1/categories?limit=0',400);
  const products=await call('/api/v1/products?q=Contoh&limit=1',200);assert.equal(products.data.length,1);await call('/api/v1/products?sort=cheapest',400);
  await call(`/api/v1/products/${products.data[0].id}`,200);await call(`/api/v1/products/${randomUUID()}`,404);validateExchanges(samples,'storefront');
  await f.page.goto(`${origin}/cari?q=Contoh&offer_kind=multipack&category_id=${ownCategory}`);await expect(f.page.locator('.product')).toHaveCount(1);await expect(f.page.getByRole('group',{name:'Filter dan urutan'}).getByRole('link',{name:/^Hapus filter Isi pilihan: /})).toBeVisible();await capture(f.page,`search-390.png`);
  assert.deepEqual(await f.page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length})),{local:0,session:0});assert.deepEqual(await f.context.cookies(),[]);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});

test('built storefront remains usable without JavaScript and keyboard focus remains clear at 200 percent text',async()=>{
 const f=await start(320);try{
  await f.page.goto(origin);await f.page.locator('.product').first().waitFor();await f.page.evaluate(()=>document.fonts.ready);await f.page.evaluate(()=>{document.documentElement.style.fontSize='200%';});await ownHome(f.page);
  await expect.poll(()=>f.page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),{message:'Page horizontal overflow delta'}).toBeLessThanOrEqual(1);
  // Phones have no header logo (shop.com mobile header): the search field is the first control after the skip link.
  await f.page.getByRole('combobox',{name:'Cari produk'}).focus();await f.page.keyboard.press('Shift+Tab');await expect(f.page.getByRole('link',{name:'Lewati ke konten'})).toBeFocused();
  for(let i=0;i<20;i++){await f.page.keyboard.press('Tab');const focus=await f.page.locator(':focus').boundingBox();const bar=await f.page.locator('.shopping-tabs').boundingBox();
   // The dock steps aside while the search field has focus (phone keyboard up), so nothing can cover it.
   if(!bar){assert.equal(await f.page.evaluate(()=>document.activeElement?.id),'site-search');continue;}assert.ok(focus);if(await f.page.locator('.shopping-tabs :focus').count())assert.ok(focus.y>=bar.y&&focus.y+focus.height<=bar.y+bar.height,'Focused shopping tab stays inside its navigation');else assert.ok(focus.y+focus.height>0&&focus.y<bar.y,'Focused content must not be covered by bottom navigation');}
  // Icon-only dock: each tab is named by its accessible name and keeps a 44px target at enlarged text.
  const dock=f.page.getByRole('navigation',{name:'Navigasi belanja'});for(const name of ['Beranda','Kategori','Keranjang','Akun'])await expect(dock.getByRole('link',{name,exact:true})).toHaveCount(1);
  assert.ok(await f.page.locator('.shopping-tabs a').evaluateAll(links=>links.every(a=>{const r=a.getBoundingClientRect();return r.width>=44&&r.height>=44&&a.textContent?.trim()==='';})),'Dock tabs are icon-only 44px targets');
  assert.ok(await f.page.locator('.department-photo').evaluateAll(elements=>elements.every(e=>e.scrollHeight-e.clientHeight<=1)),'Enlarged photograph briefs remain inside their slots');
  // Tiles drop to one column at 200% text, so compare labels of tiles that actually share a row.
  assert.ok(await f.page.locator('.switcher-row > *').count()>0,'Home shows the category switcher');
  await expect(f.page.getByRole('link',{name:'Lewati ke konten'})).toHaveCSS('clip-path','inset(50%)');
  await capture(f.page,`text-200-320.png`);assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
 const nojs=await start(390,false);try{
  await nojs.page.goto(origin+busana);await expect(nojs.page.getByRole('heading',{level:1,name:'Busana'})).toBeVisible();const ownCategory=await nojs.page.getByRole('combobox',{name:'Kategori',exact:true,includeHidden:true}).inputValue();await nojs.page.getByRole('combobox',{name:'Cari produk'}).fill('Contoh');await nojs.page.getByRole('button',{name:'Cari produk',exact:true}).click();await expect(nojs.page.getByRole('heading',{level:1,name:'Hasil untuk “Contoh”'})).toBeVisible();
  await nojs.page.locator('.filters summary').click();await nojs.page.getByRole('combobox',{name:'Kategori',exact:true,includeHidden:true}).selectOption(ownCategory);await nojs.page.getByLabel('Isi pilihan',{exact:true}).selectOption('multipack');await nojs.page.getByRole('button',{name:'Terapkan filter'}).click();await expect(nojs.page.locator('.product')).toHaveCount(1);assert.deepEqual(nojs.errors,[]);
 }finally{await nojs.browser.close();}
});

test('built /promo renders and lists only promotions that are active in the database',async()=>{
 const f=await start(1440);try{
  assert.equal((await f.page.goto(`${origin}/promo`))?.status(),200);
  await expect(f.page.getByRole('heading',{level:1,name:'Promo'})).toBeVisible();
  await expect(f.page.getByRole('heading',{level:2,name:'Promo ongkir'})).toBeVisible();await expect(f.page.getByRole('heading',{level:2,name:'Paket campuran'})).toBeVisible();
  const listed=await f.page.locator('[data-promotion-id]').evaluateAll(items=>items.map(item=>item.getAttribute('data-promotion-id')??''));
  if(!listed.length) await expect(f.page.getByText('Belum ada promo ongkir aktif.')).toBeVisible();
  for(const id of listed){
   const [row]=await identity.sql`select 1 from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision
    where p.id=${id} and v.active and v.starts_at<=now() and v.ends_at>now()`;
   assert.ok(row,`listed promotion ${id} is active`);
  }
  assert.deepEqual(f.errors,[]);
 }finally{await f.browser.close();}
});
