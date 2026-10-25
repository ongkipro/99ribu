import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test,{after,before} from 'node:test';
import {chromium,expect} from '@playwright/test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {releaseReservation} from '../../src/modules/inventory/reservations.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';

// Round 43: listing infinite scroll (first page in HTML, next pages appended from the crawlable
// rel="next" URL), Back restore from a PDP, the no-JS next link, and the header logo link.
const origin='http://127.0.0.1:3099',identity=createLocalAuth('local'),namespace=`s43-${randomUUID().slice(0,8)}`;
// One card per page in the suite's own department: its two products make two pages (the
// first in the HTML, the second appended). A query is not used: real catalog text matches too.
const listing=`/kategori/shop-${namespace}-busana?limit=1`;
let owner:Awaited<ReturnType<typeof actor>>|undefined,seeded:Awaited<ReturnType<typeof seedCommerce>>|undefined;
before(async()=>{
 owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);const request=()=>(owner as NonNullable<typeof owner>).browser.request('/api/v1/admin/products');
 seeded=await seedCommerce(request(),identity,'local',namespace);await prepareStorefront(request(),identity,'local',namespace,seeded);
});
after(async()=>{
 try{if(seeded)for(const id of Object.values(seeded.reservations)){await identity.sql.begin(tx=>releaseReservation(tx,id,'Owned S43 listing fixture finished'));await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${id}`;}}
 finally{try{if(owner)await cleanup(identity,[owner]);}finally{await identity.sql.end();}}
});

test('scrolling appends the next pages once each, announces them, stops at the end and restores them on Back',async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900}});page.setDefaultTimeout(10000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  // Only the first page is in the server HTML; the next one loads as its end nears the viewport.
  const html=await (await page.request.get(origin+listing)).text();assert.equal(html.match(/<li [^>]*class="product"/g)?.length,1);
  await page.goto(origin+listing);
  const cards=page.locator('.listing-grid li.product');
  // The crawlable next link stays in the DOM (rel="next") but is not a visible "load more" control.
  const next=page.locator('a[rel="next"]');await expect(next).toHaveCount(1);await expect(page.getByRole('button',{name:/Muat lebih|Lihat produk lainnya/})).toHaveCount(0);
  for(let i=0;i<6&&await cards.count()<2;i++){await page.mouse.wheel(0,2000);await page.waitForTimeout(400);}
  await expect(cards).toHaveCount(2);
  const ids=await cards.evaluateAll(items=>items.map(item=>item.id));assert.equal(new Set(ids).size,ids.length,'No product is appended twice');
  await expect(page.locator('.listing-more [role="status"]')).toContainText('Semua produk sudah tampil');
  await expect(page.locator('.listing-sentinel')).toHaveCount(0);
  // Open the second card (the appended page), then Back: the appended page and the card return.
  const third=cards.nth(1),id=await third.getAttribute('id');assert.ok(id);
  const href=new URL(await third.locator('a').getAttribute('href') as string,origin);assert.equal(href.searchParams.get('from'),`${listing}#${id}`,'Appended cards return to the listing URL, not a cursor page');
  await third.locator('a').click();await expect(page).toHaveURL(/\/produk\//);await page.goBack();
  // No PDP back link (DEC-021): browser Back returns to the list URL itself; the loaded pages and the card stay.
  await expect(page).toHaveURL(`${origin}${listing}`);await expect(cards).toHaveCount(2);await expect(page.locator(`#${id}`)).toBeInViewport();
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}
});

test('without JavaScript the next page is a working link with the same filters',async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{
  const page=await browser.newPage({viewport:{width:390,height:900},javaScriptEnabled:false});
  await page.goto(origin+listing);await expect(page.locator('li.product')).toHaveCount(1);const first=await page.locator('li.product').getAttribute('id');
  const next=page.getByRole('link',{name:'Halaman berikutnya',exact:true});await expect(next).toBeVisible();
  const url=new URL(await next.getAttribute('href') as string,origin);assert.equal(url.pathname,`/kategori/shop-${namespace}-busana`);assert.equal(url.searchParams.get('limit'),'1');assert.ok(url.searchParams.get('cursor'));
  await next.click();await expect(page.locator('li.product')).toHaveCount(1);assert.notEqual(await page.locator('li.product').getAttribute('id'),first);
 }finally{await browser.close();}
});

// Twelve full navigations against a production build take ~31 s alone, past the 30 s default.
test('the header logo goes home from every storefront page, also while its name is revealed',{timeout:120000},async()=>{
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{
  const desktop=await browser.newPage({viewport:{width:1440,height:900}});
  await desktop.goto(origin+listing);const product=await desktop.locator('.product-link').first().getAttribute('href');assert.ok(product);
  for(const path of ['/kategori',listing,'/cari','/keranjang','/bantuan','/promo',product]){
   await desktop.goto(origin+path);const logo=desktop.getByRole('link',{name:'Serba 99ribu, beranda',exact:true});
   await logo.hover();await desktop.waitForTimeout(300);await expect(logo).toContainText('Serba');await logo.click();await expect(desktop).toHaveURL(`${origin}/`);
  }
  // The PDP carries the same header (owner call 2026-10-24), so it is in the loop above.
  await desktop.setViewportSize({width:390,height:900});
  // Phones: no header logo (shop.com mobile header); home is the dock's first tab.
  await desktop.goto(`${origin}/cari`);await expect(desktop.locator('.store-header .brand')).toBeHidden();
  await desktop.getByRole('navigation',{name:'Navigasi belanja'}).getByRole('link',{name:'Beranda',exact:true}).click();await expect(desktop).toHaveURL(`${origin}/`);
 }finally{await browser.close();}
});
