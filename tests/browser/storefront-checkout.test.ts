import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import test from 'node:test';
import {chromium,expect,type Page} from '@playwright/test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {rupiah} from '../../src/modules/storefront/format.ts';
import {runOneJob} from '../../src/jobs/worker.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {ingestProviderEvent,simulateCollection} from '../../src/modules/payments/local.ts';
import {handlePromotions} from '../../src/modules/promotions/routes.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {expireOwnedOrderJob} from '../../src/modules/checkout/expiry.ts';
import {releaseReservation,reserveOffers} from '../../src/modules/inventory/reservations.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {CommerceClient} from '../integration/checkout-fixture.ts';
import {deniedChoices,grantedChoices} from '../integration/advertising-fixture.ts';
import {RENDERS} from '../render-root.ts';

const origin='http://127.0.0.1:3099',output=`${RENDERS}/s26/${readFileSync('.next/BUILD_ID','utf8').trim()}`,namespace=`s26-${randomUUID().slice(0,8)}`;
const identity=createLocalAuth('local'),carts=new Set<string>();
let expiredFixture:Awaited<ReturnType<typeof start>>|undefined;
let owner:Awaited<ReturnType<typeof actor>>,seeded:Awaited<ReturnType<typeof seedCommerce>>,curated:Awaited<ReturnType<typeof prepareStorefront>>;
test.before(async()=>{
 owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 const request=()=>owner.browser.request('/api/v1/admin/products');
 seeded=await seedCommerce(request(),identity,'local',namespace);curated=await prepareStorefront(request(),identity,'local',namespace,seeded);
 const clock=await readFixtureClock('local',namespace),seconds=Math.ceil((Date.now()-Date.parse(clock.now))/1000);if(seconds>0)await advanceFixtureClock('local',namespace,seconds,clock.version);
 // Create this read-only cart before the COD cases retain genuine stock.
 expiredFixture=await start(390);
});
test.after(async()=>{
 const failures:unknown[]=[];
 if(expiredFixture){try{await close(expiredFixture);}catch(error){failures.push(error);}}
 try{
  const orders=carts.size?await identity.sql`select id from app.commerce_order where clock_namespace=${namespace} and cart_id in ${identity.sql([...carts])}`:[];
  if(orders.length){const clock=await readFixtureClock('local',namespace);await advanceFixtureClock('local',namespace,1860,clock.version);
   for(const order of orders){const [job]=await identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;assert.ok(job);await identity.sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));}
  }
 }catch(error){failures.push(error);}
 try{if(seeded)for(const reservation of Object.values(seeded.reservations)){await identity.sql.begin(tx=>releaseReservation(tx,reservation,'Owned S26 browser fixture finished'));await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${reservation}`;}if(owner)await cleanup(identity,[owner]);}catch(error){failures.push(error);}
 await identity.sql.end();if(failures.length)throw new AggregateError(failures,'Owned S26 browser cleanup failed');
});
async function start(width:number,javaScriptEnabled=true,lines?:{variant_id:string;quantity:number;expected_publication_id:string}[]){
 const product=curated.products['shirt-cream'];assert.ok(product.publication_id);
 const client=new CommerceClient(identity),body={lines:lines??[{variant_id:product.offer_id,quantity:2,expected_publication_id:product.publication_id}]},key=randomUUID();
 try{
  assert.equal((await client.call('/api/v1/carts',body,{key})).response.status,401);
  const request=client.request('/api/v1/carts',body,{key}),principal=await commerceActor(request,identity);assert.ok(principal?.kind==='guest');
  const created=await identity.sql.begin(tx=>createCart(tx,request,identity,principal,body,{clock_namespace:namespace}));carts.add(created.cart.id);
  const replay=await client.call('/api/v1/carts',body,{key});assert.equal(replay.response.status,201);assert.equal(replay.payload.cart.id,created.cart.id);
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  try{
   const context=await browser.newContext({viewport:{width,height:900},javaScriptEnabled,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(15000);
   const errors:string[]=[];page.on('pageerror',()=>errors.push('Uncaught page error'));
   page.on('request',request=>assert.equal(new URL(request.url()).origin,origin,'No external browser request'));
   await context.addCookies([...client.cookies.values()].map(c=>({name:c.name,value:c.value,domain:'127.0.0.1',path:c.path,httpOnly:true,sameSite:'Lax' as const,secure:false})));
   return {browser,context,page,client,cart:created.cart,errors};
  }catch(error){await browser.close();throw error;}
 }catch(error){await client.auth('/sign-out',{});throw error;}
}
async function close(f:Awaited<ReturnType<typeof start>>){
 const failures:unknown[]=[];
 try{const response=await f.page.request.post(`${origin}/api/auth/sign-out`,{headers:{origin},data:{}});assert.equal(response.status(),200);}catch(error){failures.push(error);}
 try{
  const orders=await identity.sql`select id from app.commerce_order where cart_id=${f.cart.id} and clock_namespace=${namespace}`;
  if(orders.length){const clock=await readFixtureClock('local',namespace);await advanceFixtureClock('local',namespace,1860,clock.version);
   for(const order of orders){const [job]=await identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;assert.ok(job);await identity.sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));}
  }
 }catch(error){failures.push(error);}
 await f.browser.close();if(failures.length)throw new AggregateError(failures,'Owned scenario cleanup failed');
}
async function capture(page:Page,name:string){await mkdir(output,{recursive:true});await page.evaluate(()=>document.fonts.ready);await expect(page.getByText('Menyimpan draf…',{exact:true})).not.toBeVisible();assert.doesNotMatch(await page.locator('body').innerText(),/\[s26-[a-f0-9]+\]|SYNTHETIC|Local shipping simulation|Regular simulation/,'Render-visible fixture labels stay natural Indonesian');await page.mouse.move(0,0);await page.screenshot({path:`${output}/${name}.png`,fullPage:true});const geometry=await page.evaluate(()=>({width:document.documentElement.clientWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,offenders:[...document.querySelectorAll('body *')].flatMap(el=>{const box=el.getBoundingClientRect();return box.right>document.documentElement.clientWidth+1&&box.width>0?[{tag:el.tagName,id:el.id,class:el.className,right:box.right,width:box.width}]:[]}).slice(0,12)}));if(geometry.overflow>1)await writeFile(`${output}/${name}-overflow.json`,JSON.stringify(geometry,null,2));assert.ok(geometry.overflow<=1,'No horizontal overflow; inspect captured geometry');}
async function holdTwoOriginStock(){
 const [position]=await identity.sql<{warehouse_id:string;available:number}[]>`select b.warehouse_id,b.on_hand-b.reserved-b.quarantined as available from app.inventory_balance b join app.local_fixture_warehouse w on w.warehouse_id=b.warehouse_id where b.id=${seeded.positions['fixture-malang:fixture-shirt']} and b.stock_item_id=${seeded.stocks['fixture-shirt']} and w.namespace=${namespace} and w.fixture_id='fixture-malang'`;
 assert.ok(position);assert.ok(position.available>=1,'Owned Malang shirt stock must retain one complete unit');if(position.available===1)return null;
 const shirt=curated.products.shirt,[published]=await identity.sql<{product_revision:number}[]>`select product_revision from app.publication_version where id=${shirt.publication_id} and product_id=${shirt.id}`;assert.ok(published);
 const clock=await readFixtureClock('local',namespace);
 return identity.sql.begin(async tx=>{
  const held=await reserveOffers(tx,{key:`s26-two-origin:${namespace}:${randomUUID()}`,lines:[{line_id:'s26_owned_precondition',product_id:shirt.id,product_revision:published.product_revision,offer_id:shirt.offer_id,warehouse_id:position.warehouse_id,quantity:position.available-1}],expires_at:new Date(Date.parse(clock.now)+3600000).toISOString(),clock_namespace:namespace,actor_id:owner.id});return held.header.id;
 });
}
async function contact(page:Page,method='prepaid'){
 await page.getByLabel('Nama penerima',{exact:true}).fill('Penerima Contoh');await page.getByLabel('Nomor HP',{exact:true}).fill('081200000000');
 await page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('test-malang');await page.getByLabel('Alamat lengkap',{exact:true}).fill('Jalan Contoh 12\nRT 01');await page.getByLabel('Catatan pengiriman (opsional)',{exact:true}).fill('Titip di penerima\nHubungi saat tiba');
 await page.locator(`input[name=payment_method][value=${method}]`).check();
}
// Single-page checkout: before a quote the page shows Kontak/Alamat pengiriman/Pembayaran and a Pengiriman placeholder;
// after "Hitung ongkir" it shows the review box, editable shipping choices and the order button together.
async function expectContactStep(page:Page){
 await expect(page.getByRole('heading',{name:'Alamat pengiriman',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Kontak',exact:true})).toBeVisible();
 await expect(page.locator('dl.checkout-review-box')).toHaveCount(0);await expect(page.getByRole('button',{name:'Hitung ongkir',exact:true})).toBeVisible();
}
async function expectOrderStep(page:Page){
 await expect(page.locator('dl.checkout-review-box')).toBeVisible();await expect(page.getByRole('heading',{name:'Pengiriman',exact:true})).toBeVisible();
 await expect(page.locator('#checkout-primary')).toHaveAccessibleName(/^Buat pesanan · Rp[0-9.]+$/);await expect(page.getByLabel('Nama penerima',{exact:true})).toHaveCount(0);
 for(const name of ['Ubah kontak','Ubah kirim ke','Ubah pembayaran'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
}
async function activeQuote(page:Page){
 const current=await page.request.get(`${origin}/api/v1/carts/current`);assert.equal(current.status(),200);const cart=await current.json();
 const response=await page.request.get(`${origin}/api/v1/checkout/quotes/${cart.active_quote_id}`);assert.equal(response.status(),200);return {cart,quote:await response.json()};
}
const orderCount=async(cart:string)=>(await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${cart}`)[0].n as number;
const stepNotice=(page:Page)=>page.locator('.checkout-fields>p.checkout-step-notice');

for(const javaScriptEnabled of [true,false])test(`checkout draft survives cart exit and review reload with JavaScript ${javaScriptEnabled?'enabled':'disabled'}`,async()=>{
 const f=await start(390,javaScriptEnabled);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);
  if(javaScriptEnabled){
   await expect(f.page.getByText('Draf tersimpan.',{exact:true})).toBeVisible();await f.page.reload();
   await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');await expect(f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true})).toHaveValue('Titip di penerima\nHubungi saat tiba');
  }
  await f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true}).fill('Titip di penerima\nCatatan tetap disimpan');
  await f.page.getByRole('button',{name:'Keranjang',exact:true}).click();await f.page.waitForURL(`${origin}/keranjang`);await f.page.getByRole('link',{name:'Lanjut ke checkout',exact:true}).click();
  await expect(f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true})).toHaveValue('Titip di penerima\nCatatan tetap disimpan');await expect(f.page.getByLabel('Nomor HP',{exact:true})).toHaveValue('081200000000');
  await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);
  await expect(f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true})).toHaveValue('Titip di penerima\nCatatan tetap disimpan');
  await f.page.getByRole('button',{name:'Keranjang',exact:true}).click();await f.page.waitForURL(`${origin}/keranjang`);await f.page.getByRole('link',{name:'Lanjut ke checkout',exact:true}).click();await expectOrderStep(f.page);
  await expect(f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true})).toHaveValue('Titip di penerima\nCatatan tetap disimpan');
  assert.equal(await orderCount(f.cart.id),0,'leaving and resuming the order step places no order');
  await f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true}).fill('');
  await f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true}).fill('Catatan terakhir\nBunyikan bel sekali');await capture(f.page,`review-draft-${javaScriptEnabled?'js':'nojs'}-390`);
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);
  const orders=await identity.sql`select id,buyer_note from app.commerce_order where cart_id=${f.cart.id}`;assert.equal(orders.length,1);assert.equal(orders[0].buyer_note,'Catatan terakhir Bunyikan bel sekali');
  await f.page.goto(`${origin}/keranjang`);await f.page.getByRole('link',{name:'Periksa pesanan',exact:true}).click();await f.page.waitForURL(`${origin}/checkout/order/${orders[0].id}`);await expect(f.page.getByRole('heading',{name:'Menunggu pembayaran',exact:true})).toBeVisible();
  assert.equal(await f.page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('competing checkout drafts preserve local input and a revoked autosave clears the private view',async()=>{
 const f=await start(390);try{
  await f.page.goto(`${origin}/checkout`);await f.page.getByLabel('Nama penerima',{exact:true}).fill('Penerima Contoh Awal');await expect(f.page.getByText('Draf tersimpan.',{exact:true})).toBeVisible();
  const other=await f.context.newPage();await other.goto(`${origin}/checkout`);await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh Awal');
  await f.page.getByLabel('Nama penerima',{exact:true}).fill('Penerima Contoh Terbaru');await expect(f.page.getByText('Draf tersimpan.',{exact:true})).toBeVisible();
  await other.getByLabel('Nama penerima',{exact:true}).fill('Penerima Draf Lokal');await expect(other.getByText('Draf berubah di halaman lain. Muat ulang untuk memeriksanya.',{exact:true})).toBeVisible();await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Draf Lokal');await expect(other.getByRole('button',{name:'Hitung ongkir',exact:true})).toBeDisabled();await expect(other.locator('.checkout-conflict')).toHaveAttribute('role','alert');await capture(other,'draft-conflict-390');other.once('dialog',dialog=>dialog.accept());await other.getByRole('link',{name:'Muat ulang draf tersimpan',exact:true}).click();await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh Terbaru');await expect(other.getByRole('button',{name:'Hitung ongkir',exact:true})).toBeEnabled();
  const check=await f.context.newPage();await check.goto(`${origin}/checkout`);await expect(check.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh Terbaru');await check.close();
  await f.page.getByLabel('Nama penerima',{exact:true}).fill('Penerima Contoh Terkini');await expect(f.page.getByText('Draf tersimpan.',{exact:true})).toBeVisible();await other.getByLabel('Nama penerima',{exact:true}).fill('Penerima Isian Lokal');await expect(other.locator('.checkout-conflict')).toBeVisible();await other.getByRole('button',{name:'Keranjang',exact:true}).click();await expect(other.getByRole('link',{name:'Muat ulang draf tersimpan',exact:true})).toBeFocused();await expect(other).toHaveURL(`${origin}/checkout`);
  other.once('dialog',dialog=>dialog.accept());await other.getByRole('link',{name:'Kembali ke keranjang tanpa menyimpan isian ini',exact:true}).click();await expect(other).toHaveURL(`${origin}/keranjang`);
  let releaseHistory!:()=>void;const historyScripts=new Promise<void>(r=>releaseHistory=r);await other.route('**/_next/static/**/*.js',async route=>{await historyScripts;await route.continue();});
  try{
   await other.goBack({waitUntil:'domcontentloaded'});await expect(other).toHaveURL(`${origin}/checkout`);assert.equal(await other.evaluate(()=>(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)?.type),'back_forward');await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh Terkini');
   const historyEntry=other.waitForRequest(request=>request.method()==='POST'&&request.url()===`${origin}/checkout`&&Boolean(request.headers()['next-action']));releaseHistory();await historyEntry;await other.waitForLoadState('load');const saving=other.getByText('Menyimpan draf…',{exact:true});if(await saving.isVisible())await expect(saving).not.toBeVisible();
   const winner=await f.context.newPage();await winner.goto(`${origin}/checkout`);await expect(winner.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh Terkini');await winner.close();await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh Terkini');await expect(other.getByText('Draf tersimpan.',{exact:true})).not.toBeVisible();
  }finally{releaseHistory();}
  await other.unroute('**/_next/static/**/*.js');let releaseRestored!:()=>void;const restoredScripts=new Promise<void>(r=>releaseRestored=r);await other.route('**/_next/static/**/*.js',async route=>{await restoredScripts;await route.continue();});
  try{
   await other.reload({waitUntil:'domcontentloaded'});assert.equal(await other.evaluate(()=>(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)?.type),'reload');
   // Model browser-restored form state without a new input event; Chromium Back above restores the winner itself.
   await other.getByLabel('Nama penerima',{exact:true}).evaluate((input,value)=>{(input as HTMLInputElement).value=value;},'Penerima Isian Lokal');
   const restoredEntry=other.waitForRequest(request=>request.method()==='POST'&&request.url()===`${origin}/checkout`&&Boolean(request.headers()['next-action']));releaseRestored();await restoredEntry;await other.waitForLoadState('load');const saving=other.getByText('Menyimpan draf…',{exact:true});if(await saving.isVisible())await expect(saving).not.toBeVisible();
   const winner=await f.context.newPage();await winner.goto(`${origin}/checkout`);await expect(winner.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh Terkini');await winner.close();await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh Terkini');await expect(other.getByText('Draf tersimpan.',{exact:true})).not.toBeVisible();
  }finally{releaseRestored();}
  await other.goto(`${origin}/keranjang`);await other.getByRole('link',{name:'Lanjut ke checkout',exact:true}).click();await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh Terkini');await other.close();
  assert.equal((await identity.sql`select count(*)::int n from app.checkout_quote where cart_id=${f.cart.id}`)[0].n,0);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);
  const revoked=await f.page.request.post(`${origin}/api/auth/sign-out`,{headers:{origin},data:{}});assert.equal(revoked.status(),200);
  await f.page.getByLabel('Nama penerima',{exact:true}).fill('Penerima Sesi Berakhir');await expect(f.page.getByRole('heading',{name:'Sesi belanja perlu diperiksa',exact:true})).toBeVisible();await expect(f.page.getByLabel('Nama penerima',{exact:true})).toHaveCount(0);assert.ok(!(await f.page.locator('main').innerText()).includes('Penerima Sesi Berakhir'));await capture(f.page,'draft-scope-denied-390');assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('native conflicting checkout draft blocks advance and reloads the stored copy without overwriting it',async()=>{
 const f=await start(390,false);try{
  await f.page.goto(`${origin}/checkout`);const other=await f.context.newPage();await other.goto(`${origin}/checkout`);
  await contact(f.page);await f.page.getByLabel('Nama penerima',{exact:true}).fill('Penerima Draf Tersimpan');const lookupKey=await f.page.locator('input[name=key]').inputValue();await f.page.getByRole('button',{name:'Cari wilayah',exact:true}).click();await expect(f.page.locator('input[name=key]')).not.toHaveValue(lookupKey);await expect(f.page.locator('.checkout-feedback')).toHaveCount(0);await expect(f.page.getByText('Pilih tujuan dari hasil pencarian.',{exact:true})).not.toBeVisible();
  await contact(other);await other.getByLabel('Nama penerima',{exact:true}).fill('Penerima Draf Belum Tersimpan');await other.getByRole('button',{name:'Hitung ongkir',exact:true}).click();
  await expect(other.getByText('Draf berubah di halaman lain. Muat ulang untuk memeriksanya.',{exact:true})).toBeVisible();await expect(other.getByRole('button',{name:'Hitung ongkir',exact:true})).toBeDisabled();await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Draf Belum Tersimpan');await capture(other,'draft-conflict-nojs-390');
  assert.equal((await identity.sql`select count(*)::int n from app.checkout_quote where cart_id=${f.cart.id}`)[0].n,0);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);
  await other.getByRole('link',{name:'Muat ulang draf tersimpan',exact:true}).click();await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Draf Tersimpan');await expect(other.getByRole('button',{name:'Hitung ongkir',exact:true})).toBeEnabled();
  await f.page.getByLabel('Nama penerima',{exact:true}).fill('Penerima Tersimpan Terkini');const nextKey=await f.page.locator('input[name=key]').inputValue();await f.page.getByRole('button',{name:'Cari wilayah',exact:true}).click();await expect(f.page.locator('input[name=key]')).not.toHaveValue(nextKey);await other.getByLabel('Nama penerima',{exact:true}).fill('Penerima Isian Lokal');await other.getByRole('button',{name:'Keranjang',exact:true}).click();await expect(other.locator('.checkout-conflict')).toBeVisible();await expect(other).toHaveURL(`${origin}/checkout`);await other.getByRole('link',{name:'Kembali ke keranjang tanpa menyimpan isian ini',exact:true}).click();await expect(other).toHaveURL(`${origin}/keranjang`);await other.getByRole('link',{name:'Lanjut ke checkout',exact:true}).click();await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Tersimpan Terkini');await other.close();
  assert.equal((await identity.sql`select count(*)::int n from app.checkout_quote where cart_id=${f.cart.id}`)[0].n,0);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

for(const javaScriptEnabled of [true,false])test(`implicit Enter stays in checkout and searches without an exit or financial action with JavaScript ${javaScriptEnabled?'enabled':'disabled'}`,async()=>{
 const f=await start(390,javaScriptEnabled);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);
  for(const name of ['Nama penerima','Nomor HP']){
   const lookupKey=await f.page.locator('input[name=key]').inputValue();await f.page.getByLabel(name,{exact:true}).press('Enter');await expect(f.page.locator('input[name=key]')).not.toHaveValue(lookupKey);await expect(f.page.locator('.checkout-feedback')).toHaveCount(0);await expect(f.page.getByText('Pilih tujuan dari hasil pencarian.',{exact:true})).not.toBeVisible();await expect(f.page.getByRole('button',{name:'Hitung ongkir',exact:true})).toBeEnabled();await expect(f.page).toHaveURL(`${origin}/checkout`);await expectContactStep(f.page);await expect(f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true})).toHaveValue('Titip di penerima\nHubungi saat tiba');
  }
  await f.page.getByLabel('Kelurahan atau kode pos',{exact:true}).fill('wilayah-tidak-ada');await f.page.getByLabel('Kelurahan atau kode pos',{exact:true}).press('Enter');await expect(f.page.getByText('Tujuan tidak ditemukan. Coba nama kelurahan atau kecamatan lain.',{exact:true})).toBeVisible();await expect(f.page).toHaveURL(`${origin}/checkout`);
  assert.equal((await identity.sql`select count(*)::int n from app.checkout_quote where cart_id=${f.cart.id}`)[0].n,0);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

for(const javaScriptEnabled of [true,false])test(`shipping radio Enter retains its step and choice with JavaScript ${javaScriptEnabled?'enabled':'disabled'}`,async()=>{
 const f=await start(390,javaScriptEnabled);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);
  const quoteCount=async()=>(await identity.sql`select count(*)::int n from app.checkout_quote where cart_id=${f.cart.id}`)[0].n;
  const issuedQuote=(await activeQuote(f.page)).quote;
  const group=f.page.getByRole('group',{name:'Layanan pengiriman',exact:true}).first(),alternative=group.locator('input:not(:checked)').first(),chosen=await alternative.inputValue();
  // Each option names the courier, then the service, with the price right-aligned.
  const option=group.locator('label').filter({has:f.page.locator(`input[value="${chosen}"]`)}),issuedOption=issuedQuote.packages[0].options.find((o:{id:string})=>o.id===chosen);assert.ok(issuedOption);
  await expect(option.locator('span>strong')).toHaveText(issuedOption.courier_name);await expect(option.locator('span>span')).toHaveText(issuedOption.service_name);await expect(option.locator('.checkout-choice-price')).toHaveText(rupiah(issuedOption.shipping_amount));
  await alternative.check();
  if(javaScriptEnabled){
   // With JavaScript a changed courier applies at once (a 'shipping' intent) and the page stays on the order step.
   await expect.poll(async()=>(await activeQuote(f.page)).quote.packages[0].selected_option_id).toBe(chosen);
   await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName(`Buat pesanan · ${rupiah((await activeQuote(f.page)).quote.buyer_total)}`);
  }else await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName('Perbarui pengiriman',{timeout:1000}); // no JS: the next press applies the choice, it never orders
  const quote=await f.page.locator('input[name=quote]').inputValue(),key=await f.page.locator('input[name=key]').inputValue();
  await alternative.press('Enter');
  // Enter submits the hidden 'stay' button: same step, the checked courier kept. Without JavaScript it is not applied yet, so
  // the button offers the update (never an order); with JavaScript it was applied on change.
  await expect(f.page.locator('input[name=key]')).not.toHaveValue(key);if(javaScriptEnabled)await expectOrderStep(f.page);else{await expect(f.page.locator('dl.checkout-review-box')).toBeVisible();await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName('Perbarui pengiriman');}
  await expect(group.locator('input:checked')).toHaveValue(chosen);await expect(f.page.locator('input[name=quote]')).toHaveValue(quote);
  assert.equal(await orderCount(f.cart.id),0,'Enter on a courier never places an order');
  const plans=f.page.getByRole('group',{name:'Pembagian paket',exact:true});
  await expect(plans.locator('details')).not.toHaveAttribute('open','');
  await plans.locator('details>summary').click();const plan=plans.locator('input:not(:checked)').first(),allocation=await plan.inputValue();
  await plan.check();
  if(javaScriptEnabled){await expect.poll(async()=>(await activeQuote(f.page)).quote.selected_allocation_id).toBe(allocation);await expect(stepNotice(f.page)).toHaveText('Pembagian paket diperbarui. Periksa total lalu buat pesanan.');}
  const nextQuote=await f.page.locator('input[name=quote]').inputValue(),nextKey=await f.page.locator('input[name=key]').inputValue();
  await plans.locator('input:checked').press('Enter');
  await expect(f.page.locator('input[name=key]')).not.toHaveValue(nextKey);
  if(javaScriptEnabled)await expectOrderStep(f.page);
  // Without JavaScript the returned page knows the split is not applied yet and offers to apply it instead of ordering.
  else await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName('Perbarui pengiriman');
  await expect(plans.locator('input:checked')).toHaveValue(allocation);await expect(plans.locator('input:checked')).toBeVisible();await expect(f.page.locator('input[name=quote]')).toHaveValue(nextQuote);
  assert.equal(await orderCount(f.cart.id),0);assert.deepEqual(f.errors,[]);
  if(!javaScriptEnabled)assert.equal(await quoteCount(),1,'without JavaScript a radio change or Enter only keeps the choice; nothing is recalculated yet');
  // Back to the issued split, then "Buat pesanan".
  if(await plans.locator('details:not([open])').count())await plans.locator('details>summary').click();
  await plans.locator(`input[value="${issuedQuote.selected_allocation_id}"]`).check();
  if(javaScriptEnabled){
   await expect.poll(async()=>(await activeQuote(f.page)).quote.selected_allocation_id).toBe(issuedQuote.selected_allocation_id);
   await expect(stepNotice(f.page)).toHaveText('Pembagian paket diperbarui. Periksa total lalu buat pesanan.');
  }else{
   // No JavaScript: "Perbarui pengiriman" applies the issued split; no order yet.
   await f.page.locator('#checkout-primary').click();await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName(/^Buat pesanan · /);
   const applied=(await activeQuote(f.page)).quote;assert.equal(applied.selected_allocation_id,issuedQuote.selected_allocation_id);assert.equal(applied.packages[0].selected_option_id,issuedQuote.packages[0].selected_option_id,'a pending split hides the parcels, so the split is applied with the quote couriers');
   assert.equal(await orderCount(f.cart.id),0,'a changed selection on "Buat pesanan" must not place an order');
  }
  await expect(f.page.locator('.checkout-feedback.checkout-error')).toHaveCount(0);await expectOrderStep(f.page);
  const {quote:final}=await activeQuote(f.page);await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName(`Buat pesanan · ${rupiah(final.buyer_total)}`);await expect(f.page.locator('.checkout-due strong')).toHaveText(rupiah(final.buyer_total));
  await f.page.locator('#checkout-primary').click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);
  const orders=await identity.sql`select buyer_total from app.commerce_order where cart_id=${f.cart.id}`;assert.equal(orders.length,1);assert.equal(Number(orders[0].buyer_total),final.buyer_total);
 }finally{await close(f);}
});

for(const width of [390,768,1024,1440])test(`guest checkout contact/shipping/review creates one native pending order at ${width}px`,async()=>{
 const f=await start(width);try{
  await f.page.goto(`${origin}/keranjang`);await expect(f.page.getByRole('link',{name:'Lanjut ke checkout',exact:true})).toBeVisible();await f.page.getByRole('link',{name:'Lanjut ke checkout',exact:true}).click();
  await expectContactStep(f.page);await expect(f.page.locator('.shopping-tabs')).toHaveCount(0);await expect(f.page.locator('.checkout-summary summary')).toContainText('Rp198.000');
  await contact(f.page,width===768?'cod':'prepaid');
  if(width===390){
   await f.page.getByLabel('Nomor HP',{exact:true}).fill('keliru');await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expect(f.page.locator('#checkout-phone-error')).toBeVisible();await expect(f.page.getByLabel('Nomor HP',{exact:true})).toBeFocused();await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');await capture(f.page,'contact-error-390');await f.page.getByLabel('Nomor HP',{exact:true}).fill('081200000000');
   await f.page.getByLabel('Kelurahan atau kode pos',{exact:true}).fill('wilayah-tidak-ada');await f.page.getByRole('button',{name:'Cari wilayah',exact:true}).click();await expect(f.page.getByText('Tujuan tidak ditemukan. Coba nama kelurahan atau kecamatan lain.',{exact:true})).toBeVisible();await expect(f.page.getByLabel('Nomor HP',{exact:true})).toHaveValue('081200000000');
   await f.page.getByLabel('Kelurahan atau kode pos',{exact:true}).fill('');const lookupKey=await f.page.locator('input[name=key]').inputValue();await f.page.getByRole('button',{name:'Cari wilayah',exact:true}).click();await expect(f.page.locator('input[name=key]')).not.toHaveValue(lookupKey);await expect(f.page.locator('.checkout-feedback')).toHaveCount(0);await expect(f.page.getByText('Pilih tujuan dari hasil pencarian.',{exact:true})).not.toBeVisible();
  }
  await capture(f.page,`contact-${width}`);await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);await capture(f.page,`shipping-${width}`);
  await f.page.getByRole('link',{name:'Bantuan',exact:true}).click();await f.page.getByText('Mengapa ongkir perlu dihitung ulang?',{exact:true}).click();await f.page.getByRole('link',{name:'Kembali ke formulir',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Periksa dan buat pesanan',exact:true})).toBeFocused();
  await expect(f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true})).toHaveValue('Titip di penerima\nHubungi saat tiba');await capture(f.page,`review-${width}`);
  const [quote]=await identity.sql`select buyer_total,buyer_total+payment_charge_amount as amount_due from app.checkout_quote where cart_id=${f.cart.id} order by created_at desc limit 1`;
  // The review box restates what the quote was computed for; the order button and total row carry the quote's total.
  const review=f.page.locator('dl.checkout-review-box');await expect(review.locator('dt')).toHaveText(['Kontak','Kirim ke','Pembayaran']);
  await expect(review).toContainText('Penerima Contoh');await expect(review).toContainText('Jalan Contoh 12');await expect(review).toContainText(width===768?'Bayar di tempat (COD)':'Pembayaran simulasi');
  await expect(f.page.getByRole('button',{name:/^Buat pesanan/})).toHaveAccessibleName(`Buat pesanan · ${rupiah(Number(quote.amount_due??quote.buyer_total))}`);await expect(f.page.locator('.checkout-due strong')).toHaveText(rupiah(Number(quote.amount_due??quote.buyer_total)));
  await expect(f.page.locator('.checkout-summary summary>strong')).toHaveText(rupiah(Number(quote.amount_due??quote.buyer_total)));assert.equal(await orderCount(f.cart.id),0);
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);await expect(f.page.getByRole('heading',{name:width===768?'Pembayaran COD':'Menunggu pembayaran',exact:true})).toBeVisible();
  const orders=await identity.sql`select id,buyer_total,payment_status,expires_at from app.commerce_order where cart_id=${f.cart.id}`;assert.equal(orders.length,1);assert.equal(Number(orders[0].buyer_total),Number(quote.buyer_total));assert.equal(orders[0].payment_status,width===768?'cod_due':'pending');
  if(width!==768){const deadline=new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'short'}).format(new Date(orders[0].expires_at));await expect(f.page.getByText(`Batas pembayaran: ${deadline} WIB.`,{exact:true})).toBeVisible();}if(width>=1024){const column=await f.page.locator('.checkout-payment').boundingBox(),back=await f.page.locator('.checkout-header .checkout-back').boundingBox(),footer=await f.page.locator('.checkout-footer>p').boundingBox();assert.ok(column&&back&&footer);assert.ok(Math.abs(back.x-column.x)<=1&&Math.abs(footer.x-column.x)<=1,`Payment shell aligns: ${JSON.stringify({column,back,footer})}`);}await capture(f.page,`payment-${width}`);if(width===390){await f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Instruksi pembayaran',exact:true})).toBeVisible();await capture(f.page,'payment-instructions-390');
   const [attempt]=await identity.sql`select id,creation_job_id from app.payment_attempt where order_id=${orders[0].id}`;assert.ok(attempt);
   assert.equal(await runOneJob(identity.sql,{'payment.create':paymentAdapter(identity.sql,'local',new Map([[attempt.id,'creation-commit-lost-ack']]))},attempt.creation_job_id),true);
   await f.page.reload();await expect(f.page.getByRole('heading',{name:'Status pembayaran sedang diperiksa',exact:true})).toBeVisible();await expect(f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true})).toHaveCount(0);await capture(f.page,'payment-unknown-390');
   await identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${attempt.creation_job_id} and status='unknown'`;assert.equal(await runOneJob(identity.sql,{'payment.create':paymentAdapter(identity.sql,'local')},attempt.creation_job_id),true);
   const failed=await simulateCollection(identity.sql,'local',attempt.id,{status:'failed'});assert.equal(await runOneJob(identity.sql,{},await ingestProviderEvent(identity.sql,failed)),true);
   await f.page.reload();await expect(f.page.getByRole('heading',{name:'Percobaan pembayaran gagal',exact:true})).toBeVisible();await expect(f.page.locator('.checkout-payment-status')).toHaveAttribute('role','alert');await expect(f.page.getByText('Percobaan pembayaran gagal. Selama pesanan masih berlaku, Anda dapat menyiapkan percobaan baru.',{exact:true})).toBeVisible();await expect(f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true})).toBeVisible();await capture(f.page,'payment-failed-390');assert.equal((await identity.sql`select count(*)::int n from app.payment_attempt where order_id=${orders[0].id}`)[0].n,1);
  }await f.page.reload();await expect(f.page.locator('.checkout-order-reference')).toBeVisible();
  assert.equal((await identity.sql`select count(*)::int n from app.commerce_event where order_id=${orders[0].id} and name='Purchase'`)[0].n,0);
  for(const cookie of (await f.context.cookies()).filter(c=>c.httpOnly)){assert.ok(!(await f.page.content()).includes(cookie.value),'No authority cookie in HTML');}
  assert.equal(await f.page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('checkout native forms work without JavaScript and retain fields through readonly help return',async()=>{
 const f=await start(390,false),navigations:string[]=[];f.page.on('request',r=>{if(r.isNavigationRequest())navigations.push(r.method());});try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);await f.page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('');await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expect(f.page.locator('#checkout-destination-error')).toBeVisible();await expect(f.page.getByLabel('Wilayah pengiriman',{exact:true})).toBeFocused();await f.page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('test-malang');
  await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);
  await expect(f.page.getByRole('button',{name:'Ubah kontak',exact:true})).toBeVisible();await expect(f.page.getByRole('button',{name:'Ubah pembayaran',exact:true})).toBeVisible();await f.page.getByRole('button',{name:'Ubah kirim ke',exact:true}).click();await expectContactStep(f.page);await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');await expect(f.page.getByLabel('Email (opsional)',{exact:true})).toHaveValue('');await capture(f.page,'contact-nojs-390');
  await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);await expect(f.page.getByRole('heading',{name:'Menunggu pembayaran',exact:true})).toBeVisible();await capture(f.page,'payment-nojs-390');await f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Instruksi pembayaran',exact:true})).toBeVisible();assert.equal(navigations.at(-1),'GET','Native payment success redirects to a read-only document');await f.page.reload();assert.equal(navigations.at(-1),'GET');
  const orders=await identity.sql`select id from app.commerce_order where cart_id=${f.cart.id}`;assert.equal(orders.length,1);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('contact typed before delayed hydration survives the first enhanced edit and autosave',async()=>{
 const f=await start(390);let release!:()=>void;const held=new Promise<void>(r=>release=r);try{
  await f.page.route('**/_next/static/**/*.js',async route=>{await held;await route.continue();});await f.page.goto(`${origin}/checkout`,{waitUntil:'commit'});await expectContactStep(f.page);await contact(f.page);
  const entry=f.page.waitForRequest(request=>request.method()==='POST'&&request.url()===`${origin}/checkout`&&Boolean(request.headers()['next-action']));release();await entry;await f.page.waitForLoadState('load');await expect(f.page.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh');await f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true}).fill('Catatan setelah halaman siap');await expect(f.page.getByText('Draf tersimpan.',{exact:true})).toBeVisible();
  await expect(f.page.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh');await expect(f.page.getByLabel('Nomor HP',{exact:true})).toHaveValue('081200000000');await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');await expect(f.page.getByLabel('Wilayah pengiriman',{exact:true})).toHaveValue('test-malang');await f.page.reload();await expect(f.page.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh');await expect(f.page.getByLabel('Nomor HP',{exact:true})).toHaveValue('081200000000');await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');await expect(f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true})).toHaveValue('Catatan setelah halaman siap');assert.equal((await identity.sql`select count(*)::int n from app.checkout_quote where cart_id=${f.cart.id}`)[0].n,0);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{release();await close(f);}
});

test('320px enlarged text and viewport changes retain the active checkout fields and operable summary',async()=>{
 const f=await start(320);try{
  await f.page.setViewportSize({width:320,height:568});await f.page.goto(`${origin}/checkout`);await contact(f.page);
  await f.page.addStyleTag({content:'html {font-size:200%}'});await expect(f.page.getByRole('link',{name:'Bantuan',exact:true})).toHaveAccessibleName('Bantuan');await expect(f.page.locator('.checkout-help-link span')).toBeVisible();const back=await f.page.locator('.checkout-back').boundingBox(),help=await f.page.getByRole('link',{name:'Bantuan',exact:true}).boundingBox();assert.ok(back&&help);assert.ok(Math.abs(back.y+back.height/2-help.y-help.height/2)<=1,`Back and Help share a row at320px/200%: ${JSON.stringify({back,help})}`);assert.ok(help.width>=44&&help.height>=44,'Help keeps its44px target');assert.equal(await f.page.locator('html').evaluate(el=>getComputedStyle(el).fontSize),'32px');const radio=await f.page.locator('input[name=payment_method]').first().boundingBox(),radioLabel=await f.page.locator('.checkout-methods label').first().boundingBox();assert.ok(radio&&radio.width>=39&&radio.height>=39,'Native radio scales with200percent text');assert.ok(radioLabel&&radioLabel.width>=44&&radioLabel.height>=44,'Radio label retains44px target');await expect(f.page.locator('.checkout-summary details')).not.toHaveAttribute('open','');await capture(f.page,'contact-text-200-collapsed-320');await f.page.locator('.checkout-summary summary').click();await expect(f.page.locator('.checkout-summary details')).toHaveAttribute('open','');await expect(f.page.locator('.checkout-summary-lines')).toContainText('Rp198.000');await capture(f.page,'contact-text-200-320');
  await f.page.setViewportSize({width:768,height:1024});await expect(f.page.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh');await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('discarded committed order reply requires explicit exact retry and returns the original private order',async()=>{
 const f=await start(390);let discarded=false,submissions=0,actionId:string|null=null,arrive!:()=>void,release!:()=>void;const committedReady=new Promise<void>(r=>arrive=r),held=new Promise<void>(r=>release=r);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);
  await f.page.route('**/checkout',async(route,request)=>{
   if(request.method()==='POST'&&request.headers()['next-action']){actionId??=request.headers()['next-action'];if(request.headers()['next-action']===actionId)submissions++;}if(!discarded&&request.method()==='POST'&&request.headers()['next-action']===actionId){await route.fetch({maxRedirects:0});discarded=true;arrive();await held;await route.abort('failed');}else await route.continue();
  });
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await committedReady;const pending=f.page.getByRole('button',{name:'Menyimpan pesanan…',exact:true});await expect(pending).toBeDisabled();for(const name of ['Ubah kontak','Ubah kirim ke','Ubah pembayaran'])await expect(f.page.getByRole('button',{name,exact:true})).toBeDisabled();await expect(f.page.getByRole('group',{name:'Layanan pengiriman',exact:true}).first().locator('input').first()).toBeDisabled();await pending.evaluate(el=>(el as HTMLButtonElement).click());assert.equal(submissions,1,'A second activation while pending cannot submit another order request');await capture(f.page,'review-pending-390');release();await expect(f.page.getByRole('button',{name:'Periksa hasil tindakan',exact:true})).toBeVisible();assert.equal(discarded,true);
  const committed=await identity.sql`select id,buyer_total from app.commerce_order where cart_id=${f.cart.id}`;assert.equal(committed.length,1);await expect(f.page.getByRole('heading',{name:'Hasil tindakan belum diketahui',exact:true})).toBeVisible();await expect(f.page.locator('.checkout-summary summary')).toContainText('Rp');await expect(f.page.getByRole('heading',{name:'Bantuan checkout',exact:true})).toBeVisible();await expect(f.page.locator('#checkout-help').getByText('Bagaimana jika hasil pembuatan pesanan belum diketahui?',{exact:true})).toBeVisible();await expect(f.page.locator('#checkout-help').getByText('Mengapa akses perlu diperiksa?',{exact:true})).toHaveCount(0);await capture(f.page,'order-unknown-390');
  // Reconnecting/reading this state has not made a second request or payment.
  assert.equal((await identity.sql`select count(*)::int n from app.payment_attempt where order_id=${committed[0].id}`)[0].n,0);
  await f.page.getByRole('button',{name:'Periksa hasil tindakan',exact:true}).click();await f.page.waitForURL(`${origin}/checkout/order/${committed[0].id}`);await expect(f.page.getByRole('heading',{name:'Menunggu pembayaran',exact:true})).toBeVisible();
  assert.equal(submissions,2,'Only the initial action and explicit exact retry reached the order action');assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,1);assert.equal((await identity.sql`select count(*)::int n from app.commerce_event where order_id=${committed[0].id} and name='Purchase'`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{release();await close(f);}
});

test('expired quote requires explicit recalculation and renewed parcel review while preserving the safe draft',async()=>{
 const f=await start(390);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);
  const [quote]=await identity.sql`select id,expires_at from app.checkout_quote where cart_id=${f.cart.id} order by created_at desc limit 1`,clock=await readFixtureClock('local',namespace),expiredId=quote.id;await advanceFixtureClock('local',namespace,Math.ceil((new Date(quote.expires_at).getTime()-Date.parse(clock.now))/1000)+1,clock.version);
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await expectContactStep(f.page);await expect(f.page.locator('.checkout-feedback')).toContainText('kedaluwarsa');await expect(f.page.locator('.checkout-feedback')).toContainText('Hitung ongkir');await expect(f.page.locator('.checkout-feedback').getByRole('link',{name:'Hitung ongkir',exact:true})).toBeVisible();await expect(f.page.getByLabel('Nomor HP',{exact:true})).toHaveValue('081200000000');await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');await expect(f.page.locator('.checkout-summary summary')).toContainText('Kedaluwarsa · hitung ulang');await capture(f.page,'quote-expired-390');
  assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);const {quote:renewed}=await activeQuote(f.page);assert.notEqual(renewed.id,expiredId,'recalculation issues a new quote');assert.ok(Date.parse(renewed.expires_at)>Date.parse((await readFixtureClock('local',namespace)).now));
  // The renewed quote is shown with its parcels and new total next to the order button; nothing is ordered until it is pressed again.
  await expect(f.page.locator('.checkout-parcel')).toHaveCount(renewed.packages.length);await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName(`Buat pesanan · ${rupiah(renewed.buyer_total)}`);
  await expect(f.page.locator('.checkout-summary summary')).not.toContainText('Kedaluwarsa');assert.equal(await orderCount(f.cart.id),0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('unavailable COD and unsupported destination retain draft and require an explicit supported method',async()=>{
 const f=await start(390);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page,'cod');await f.page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('test-prepaid-only');await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expect(f.page.locator('.checkout-feedback')).toContainText('COD belum tersedia');await expect(f.page.locator('#checkout-payment_method')).toHaveAttribute('aria-invalid','true');await expect(f.page.locator('#checkout-method-error')).toBeVisible();await expect(f.page.locator('.checkout-feedback a[href="#checkout-payment_method"]')).toBeVisible();await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');await capture(f.page,'cod-unavailable-390');
  await f.page.locator('input[name=payment_method][value=prepaid]').check();await f.page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('test-no-route');await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expect(f.page.locator('.checkout-feedback')).toContainText('Belum ada pengiriman');await expect(f.page.getByLabel('Wilayah pengiriman',{exact:true})).toHaveAttribute('aria-invalid','true');await expect(f.page.locator('.checkout-feedback a[href="#checkout-destination_id"]')).toBeVisible();await expect(f.page.getByLabel('Nomor HP',{exact:true})).toHaveValue('081200000000');await capture(f.page,'shipping-unavailable-390');
  assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);await f.page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('test-prepaid-only');await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);await expect(f.page.locator('.checkout-parcel').first()).toContainText('simulasi');assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('built checkout observes five consented milestones once and sends no typed fields or Purchase',async()=>{
 const f=await start(390);try{
  const bootstrap=await f.page.request.post(`${origin}/api/v1/visitor-sessions`,{headers:{origin,'idempotency-key':randomUUID()},data:{client_request_id:randomUUID()}});assert.equal(bootstrap.status(),201);
  const consent=await f.page.request.post(`${origin}/api/v1/consent/receipt`,{headers:{origin,'idempotency-key':randomUUID()},data:{expected_version:0,policy_version:'local-privacy-v1',choices:grantedChoices}});assert.equal(consent.status(),201);
  const events=()=>identity.sql`select name,payload,merchandise_amount from app.commerce_event where payload->>'cart_id'=${f.cart.id} order by name`;
  await f.page.goto(`${origin}/checkout`);await expectContactStep(f.page);await expect.poll(async()=>(await events()).map(e=>e.name)).toEqual(['checkout_started']);
  await contact(f.page);await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);await expect.poll(async()=>(await events()).map(e=>e.name)).toEqual(['address_validated','checkout_started','contact_validated']);
  // A courier change on the order step is applied as a native selection, which carries the shipping/payment milestones.
  const alternative=f.page.getByRole('group',{name:'Layanan pengiriman',exact:true}).first().locator('input:not(:checked)').first(),chosen=await alternative.inputValue();await alternative.check();
  await expect.poll(async()=>(await activeQuote(f.page)).quote.packages[0].selected_option_id).toBe(chosen);await expectOrderStep(f.page);
  await expect.poll(async()=>(await events()).map(e=>e.name)).toEqual(['address_validated','checkout_started','contact_validated','payment_method_selected','shipping_selected']);
  await f.page.reload();await expectOrderStep(f.page);const captured=await events();assert.equal(captured.length,5);assert.ok(captured.every(e=>Number(e.merchandise_amount)===0));
  const payload=JSON.stringify(captured);for(const privateValue of ['Penerima Contoh','081200000000','+6281200000000','Jalan Contoh','Titip di penerima','test-malang'])assert.ok(!payload.includes(privateValue),'No typed checkout field or destination in captured events');
  const withdrawn=await f.page.request.post(`${origin}/api/v1/consent/receipt`,{headers:{origin,'idempotency-key':randomUUID()},data:{expected_version:1,policy_version:'local-privacy-v1',choices:deniedChoices}});assert.equal(withdrawn.status(),201);await f.page.reload();await expectOrderStep(f.page);assert.equal((await events()).length,5);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

// Most buyers keep the issued couriers. Reaching the order step with them already selected and placing the order must
// still report the shipping and payment-method milestones once (the native quote already holds both choices).
test('a buyer who keeps the issued couriers still records shipping and payment-method milestones before the order',async()=>{
 const f=await start(390);try{
  const bootstrap=await f.page.request.post(`${origin}/api/v1/visitor-sessions`,{headers:{origin,'idempotency-key':randomUUID()},data:{client_request_id:randomUUID()}});assert.equal(bootstrap.status(),201);
  const consent=await f.page.request.post(`${origin}/api/v1/consent/receipt`,{headers:{origin,'idempotency-key':randomUUID()},data:{expected_version:0,policy_version:'local-privacy-v1',choices:grantedChoices}});assert.equal(consent.status(),201);
  const events=async()=>(await identity.sql`select name from app.commerce_event where payload->>'cart_id'=${f.cart.id} order by name`).map(e=>e.name);
  await f.page.goto(`${origin}/checkout`);await expectContactStep(f.page);await expect.poll(events).toEqual(['checkout_started']);
  await contact(f.page);await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);
  await expect.poll(events).toEqual(['address_validated','checkout_started','contact_validated']);
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);assert.equal(await orderCount(f.cart.id),1);
  const names=await events();for(const name of ['shipping_selected','payment_method_selected'])assert.equal(names.filter(n=>n===name).length,1,`${name} is recorded once for the issued selection (recorded: ${names.join(', ')})`);
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('a current owned shipping subsidy is disclosed in each parcel and the final authoritative total',async()=>{
 const [window]=await identity.sql`select max(v.ends_at)::text ends from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where v.active`;
 const target=Math.max(Date.now(),Date.parse(window.ends??new Date().toISOString()))+1000;let clock=await readFixtureClock('local',namespace);
 while(Date.parse(clock.now)<target)clock=await advanceFixtureClock('local',namespace,Math.min(31622400,Math.ceil((target-Date.parse(clock.now))/1000)),clock.version);
 const config={expected_version:0,name:'Contoh subsidi ongkir',active:true,starts_at:clock.now,ends_at:new Date(Date.parse(clock.now)+3600000).toISOString(),kind:'fixed',value:3000,maximum_per_order:3000,minimum_merchandise:99000,budget:100000,per_buyer_limit:10,payment_methods:['prepaid'],region_ids:['test-malang'],service_ids:[],stacking:'exclusive',priority:10000,reason:'Owned S26 visual proof; no unrelated configuration changes'};
 const save=async(id:string|null,body:Record<string,unknown>)=>{const request=owner.browser.request(`/api/v1/admin/shipping-promotions${id?`/${id}/versions`:''}`,body);request.headers.set('idempotency-key',randomUUID());const response=await handlePromotions(request,identity);assert.equal(response.status,201);return response.json();};
 const campaign=await save(null,config);let f:Awaited<ReturnType<typeof start>>|undefined;
 try{
  f=await start(390);await f.page.goto(`${origin}/checkout`);await contact(f.page);await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);await expect(f.page.getByText('Subsidi paket',{exact:true})).toBeVisible();
  const shippingCartReply=await f.page.request.get(`${origin}/api/v1/carts/current`);assert.equal(shippingCartReply.status(),200);const shippingCart=await shippingCartReply.json(),shippingQuoteReply=await f.page.request.get(`${origin}/api/v1/checkout/quotes/${shippingCart.active_quote_id}`);assert.equal(shippingQuoteReply.status(),200);const shippingQuote=await shippingQuoteReply.json();assert.equal(shippingQuote.subsidy_total,3000);assert.notEqual(shippingQuote.packages[0].shipping_amount,shippingQuote.packages[0].buyer_shipping_amount);
  const allocations=f.page.getByRole('group',{name:'Pembagian paket',exact:true}),checked=allocations.locator('label').filter({has:f.page.locator('input:checked')});await expect(checked.locator('span>strong').first()).toHaveText(`${shippingQuote.packages.length} paket · Tarif ${rupiah(shippingQuote.shipping_total)}`);await expect(allocations).toContainText('Tarif belum dikurangi subsidi.');
  const charges=f.page.locator('.checkout-parcel').first().locator('.checkout-charges');await expect(charges.locator('div').filter({has:f.page.getByText('Tarif paket',{exact:true})})).toContainText(rupiah(shippingQuote.packages[0].shipping_amount));await expect(charges.locator('div').filter({has:f.page.getByText('Ongkir',{exact:true})})).toContainText(rupiah(shippingQuote.packages[0].buyer_shipping_amount));await capture(f.page,'shipping-subsidized-390');
  await expect(charges.locator('div').filter({has:f.page.getByText('Subsidi paket',{exact:true})})).toContainText(`−${rupiah(shippingQuote.packages[0].subsidy_amount)}`);await expect(f.page.locator('.checkout-summary .checkout-charges')).toContainText('Subsidi ongkir');await expect(f.page.locator('.checkout-summary .checkout-charges')).toContainText(`−${rupiah(shippingQuote.subsidy_total)}`);await expect(f.page.locator('.checkout-due strong')).toHaveText(rupiah(shippingQuote.buyer_total));await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName(`Buat pesanan · ${rupiah(shippingQuote.buyer_total)}`);await expect(f.page.locator('.checkout-summary .checkout-charges')).toContainText(`Tarif pengiriman ${shippingQuote.packages.length} paket`);await expect(f.page.locator('.checkout-fields .checkout-parcel').getByText('Ongkir paket',{exact:true})).toHaveCount(0);await capture(f.page,'review-subsidized-390');
  const current=await f.page.request.get(`${origin}/api/v1/carts/current`);assert.equal(current.status(),200);const cart=await current.json(),response=await f.page.request.get(`${origin}/api/v1/checkout/quotes/${cart.active_quote_id}`);assert.equal(response.status(),200);const quote=await response.json();assert.equal(Number(quote.subsidy_total),3000);assert.equal(Number(quote.buyer_total),Number(quote.merchandise_total)+Number(quote.shipping_total)-3000);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);const [order]=await identity.sql`select id,buyer_total from app.commerce_order where cart_id=${f.cart.id}`;assert.ok(order);assert.equal(Number(order.buyer_total),Number(quote.buyer_total));
  const expiryClock=await readFixtureClock('local',namespace);await advanceFixtureClock('local',namespace,1860,expiryClock.version);const [expiry]=await identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;assert.ok(expiry);await identity.sql.begin(tx=>expireOwnedOrderJob(tx,{id:expiry.id,kind:expiry.kind,payload:expiry.payload}));
  await f.page.reload();await expect(f.page.getByRole('heading',{name:'Pembayaran tidak tersedia',exact:true})).toBeVisible();await expect(f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true})).toHaveCount(0);await expect(f.page.locator('.checkout-payment').getByRole('link',{name:'Lihat produk',exact:true})).toBeVisible();await expect(f.page.locator('.checkout-payment').getByText('Tarif pengiriman',{exact:true})).toBeVisible();await expect(f.page.locator('.checkout-payment').getByText('Ongkir',{exact:true})).toHaveCount(0);await capture(f.page,'payment-expired-390');await f.page.locator('.checkout-payment').getByRole('link',{name:'Lihat produk',exact:true}).click();await expect(f.page).toHaveURL(`${origin}/cari`);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,1);assert.equal((await identity.sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{try{if(f)await close(f);}finally{await save(campaign.id,{...config,expected_version:1,active:false,reason:'Owned S26 scenario finished; retain configuration and history'});}}
});

test('the two-origin order step at 320px with 200% text keeps every section inside the viewport',async()=>{
 const shirt=curated.products.shirt,cream=curated.products['cream-pair'];assert.ok(shirt.publication_id&&cream.publication_id);
 const held=await holdTwoOriginStock();try{
 const f=await start(390,true,[{variant_id:shirt.offer_id,quantity:3,expected_publication_id:shirt.publication_id},{variant_id:cream.offer_id,quantity:1,expected_publication_id:cream.publication_id}]);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);await expect(f.page.locator('.checkout-parcel')).toHaveCount(2);
  await f.page.setViewportSize({width:320,height:900});await f.page.addStyleTag({content:'html {font-size:200%}'});await capture(f.page,'shipping-two-origins-text-200-320');assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
 }finally{if(held)await identity.sql.begin(async tx=>{await releaseReservation(tx,held,'Owned two-origin browser precondition finished',owner.id);await tx`delete from app.outbox_job where kind='inventory.reservation.expire' and dedup_key=${`inventory-expire:${held}`} and payload->>'reservationId'=${held} and status='ready'`;});}
});

test('arrow keys on the package split apply each split and keep keyboard focus on the checked split',async()=>{
 const shirt=curated.products.shirt,cream=curated.products['cream-pair'];assert.ok(shirt.publication_id&&cream.publication_id);
 const held=await holdTwoOriginStock();try{
 const f=await start(390,true,[{variant_id:shirt.offer_id,quantity:3,expected_publication_id:shirt.publication_id},{variant_id:cream.offer_id,quantity:1,expected_publication_id:cream.publication_id}]);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);await expect(f.page.locator('.checkout-parcel')).toHaveCount(2);
  const plans=f.page.getByRole('group',{name:'Pembagian paket',exact:true});await plans.locator('details>summary').click();
  const issued=await plans.locator('input:checked').inputValue();
  await plans.locator('input:checked').press('ArrowDown');
  await expect.poll(async()=>(await activeQuote(f.page)).quote.selected_allocation_id).not.toBe(issued);const applied=(await activeQuote(f.page)).quote.selected_allocation_id;
  await expect(stepNotice(f.page)).toHaveText('Pembagian paket diperbarui. Periksa total lalu buat pesanan.');await expect(plans.locator('input:checked')).toHaveValue(applied);
  await expect(plans.locator('input:checked'),'keyboard focus stays on the checked split after the automatic recalculation').toBeFocused();
  assert.equal(await orderCount(f.cart.id),0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
 }finally{if(held)await identity.sql.begin(async tx=>{await releaseReservation(tx,held,'Owned two-origin browser precondition finished',owner.id);await tx`delete from app.outbox_job where kind='inventory.reservation.expire' and dedup_key=${`inventory-expire:${held}`} and payload->>'reservationId'=${held} and status='ready'`;});}
});

test('native multi-parcel radio choices submit independently without JavaScript',async()=>{
 const shirt=curated.products.shirt,cream=curated.products['cream-pair'];assert.ok(shirt.publication_id&&cream.publication_id);
 const held=await holdTwoOriginStock();try{
 const f=await start(390,false,[{variant_id:shirt.offer_id,quantity:3,expected_publication_id:shirt.publication_id},{variant_id:cream.offer_id,quantity:1,expected_publication_id:cream.publication_id}]);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);
  const {quote:issued}=await activeQuote(f.page);
  // Couriers: each parcel's radio group submits on its own. Without JavaScript nothing recalculates on change.
  const groups=f.page.getByRole('group',{name:'Layanan pengiriman',exact:true});await expect(groups).toHaveCount(2);const selected:string[]=[];
  for(let i=0;i<2;i++){const radio=groups.nth(i).locator('input:not(:checked)').first();selected.push(await radio.inputValue());await radio.check();}
  // A checked courier that is not the quote's own turns the button into an update (CSS :has, no JavaScript) and hides the old total.
  await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName('Perbarui pengiriman');await expect(f.page.locator('.checkout-due')).toBeHidden();
  const oldTotal=await f.page.locator('.checkout-summary summary>strong').innerText();await capture(f.page,'shipping-two-origins-nojs-390');
  // First press: the server applies both couriers instead of ordering.
  await f.page.locator('#checkout-primary').click();await expect(stepNotice(f.page)).toHaveText('Pengiriman diperbarui. Periksa total lalu buat pesanan.');await expectOrderStep(f.page);
  assert.equal(await orderCount(f.cart.id),0,'changed couriers on "Buat pesanan" must not place an order');
  const {quote:couriers}=await activeQuote(f.page);assert.equal(couriers.selected_allocation_id,issued.selected_allocation_id);assert.deepEqual(couriers.packages.map((parcel:{selected_option_id:string})=>parcel.selected_option_id),selected);assert.equal(couriers.buyer_total,couriers.merchandise_total+couriers.shipping_total-couriers.subsidy_total);
  for(let i=0;i<2;i++)await expect(groups.nth(i).locator('input:checked')).toHaveValue(selected[i]);
  if(couriers.buyer_total!==issued.buyer_total){await expect(f.page.locator('.checkout-total-change')).toContainText('Total berubah dari');assert.ok((await f.page.locator('.checkout-total-change').innerText()).includes(oldTotal));}
  await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName(`Buat pesanan · ${rupiah(couriers.buyer_total)}`);await expect(f.page.locator('.checkout-due strong')).toHaveText(rupiah(couriers.buyer_total));
  await capture(f.page,'review-two-origins-nojs-390');
  // Split: the order press with another split applies it first, then the page must offer ordering that split.
  const plans=f.page.getByRole('group',{name:'Pembagian paket',exact:true});await expect(plans.locator('details')).not.toHaveAttribute('open','');await plans.locator('details>summary').click();
  const allocation=await plans.locator('input:not(:checked)').first().inputValue();await plans.locator(`input[value="${allocation}"]`).check();
  await expect(f.page.locator('.checkout-parcels')).toBeVisible();await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName('Perbarui pengiriman');
  await f.page.locator('#checkout-primary').click();
  await expect.poll(async()=>(await activeQuote(f.page)).quote.selected_allocation_id).toBe(allocation);assert.equal(await orderCount(f.cart.id),0,'a changed split on "Buat pesanan" must not place an order');
  await expect(plans.locator('input[data-issued-selected=true]')).toHaveValue(allocation);
  await expect(plans.locator('input:checked'),'after the server applied the split, the page must not re-check the previous split as a pending choice').toHaveValue(allocation);
  await expect(stepNotice(f.page)).toHaveText('Pembagian paket diperbarui. Periksa total lalu buat pesanan.');await expectOrderStep(f.page);
  const {quote}=await activeQuote(f.page);await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName(`Buat pesanan · ${rupiah(quote.buyer_total)}`);
  // The next press with an unchanged selection places exactly one order at the shown total.
  await f.page.locator('#checkout-primary').click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);
  const orders=await identity.sql`select buyer_total from app.commerce_order where cart_id=${f.cart.id}`;assert.equal(orders.length,1);assert.equal(Number(orders[0].buyer_total),quote.buyer_total);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
 }finally{if(held)await identity.sql.begin(async tx=>{await releaseReservation(tx,held,'Owned two-origin browser precondition finished',owner.id);await tx`delete from app.outbox_job where kind='inventory.reservation.expire' and dedup_key=${`inventory-expire:${held}`} and payload->>'reservationId'=${held} and status='ready'`;});}
});

for(const method of ['prepaid','cod'])test(`two physical origins retain complete quantities and disclosed ${method} parcel amounts`,async()=>{
 const shirt=curated.products.shirt,cream=curated.products['cream-pair'];assert.ok(shirt.publication_id&&cream.publication_id);
 const held=await holdTwoOriginStock();try{
 const f=await start(390,true,[{variant_id:shirt.offer_id,quantity:3,expected_publication_id:shirt.publication_id},{variant_id:cream.offer_id,quantity:1,expected_publication_id:cream.publication_id}]);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page,method);await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();await expectOrderStep(f.page);await expect(f.page.locator('.checkout-parcel')).toHaveCount(2);
  await capture(f.page,`shipping-two-origins-${method}-390`);for(const width of [768,1024,1440]){await f.page.setViewportSize({width,height:900});await capture(f.page,`shipping-two-origins-${method}-${width}`);}await f.page.setViewportSize({width:390,height:900});
  await expect(f.page.locator('.checkout-summary details')).not.toHaveAttribute('open','');
  if(method==='prepaid'){
   const plans=f.page.getByRole('group',{name:'Pembagian paket',exact:true});await expect(plans.locator('details')).not.toHaveAttribute('open','');await plans.locator('details>summary').click();
   const labels=await plans.locator('label').allTextContents();assert.equal(new Set(labels).size,labels.length,'Every allocation choice has distinct buyer-visible content');assert.ok(labels.every(label=>!label.includes('isi per pilihan:')&&!label.includes('Layanan lain:')&&!label.includes('Pengiriman simulasi')));
   const differences=await plans.locator('.checkout-allocation-difference').allTextContents();assert.equal(new Set(differences).size,differences.length,'Each allocation header explains a distinct change from saved');assert.ok(differences.some(text=>text.includes('dikirim dari Pontianak')&&text.includes('bersama produk lain')));assert.ok(differences.some(text=>text.includes('dikirim dari Pontianak')&&text.includes('dalam paket terpisah')));assert.ok(differences.some(text=>text==='Malang: 2 paket'));assert.ok(differences.some(text=>text==='Pontianak: 2 paket'));
   await expect(plans.locator(':scope>.checkout-allocation-option')).toHaveCount(2);await capture(f.page,'allocation-more-390');
   const issuedAllocation=await plans.locator('input[data-issued-selected=true]').inputValue();
   // With JavaScript a picked split is applied at once (keyboard focus is covered by its own test).
   const moved=await plans.locator('input:not(:checked)').first().inputValue();await plans.locator(`input[value="${moved}"]`).check();
   await expect.poll(async()=>(await activeQuote(f.page)).quote.selected_allocation_id).toBe(moved);
   await expect(stepNotice(f.page)).toHaveText('Pembagian paket diperbarui. Periksa total lalu buat pesanan.');await expectOrderStep(f.page);
   await expect(plans.locator('input:checked')).toHaveValue(moved);await expect(plans.locator('input[data-issued-selected=true]')).toHaveValue(moved);
   assert.equal(await orderCount(f.cart.id),0);await capture(f.page,'allocation-changed-390');
   // Back to the two-origin split the quote first issued.
   if(await plans.locator('details:not([open])').count())await plans.locator('details>summary').click();
   await plans.locator(`input[value="${issuedAllocation}"]`).check();
   await expect.poll(async()=>(await activeQuote(f.page)).quote.selected_allocation_id).toBe(issuedAllocation);await expectOrderStep(f.page);await expect(f.page.locator('.checkout-parcel')).toHaveCount(2);assert.equal(await orderCount(f.cart.id),0);
  }
  const services=f.page.getByRole('group',{name:'Layanan pengiriman',exact:true});await expect(services).toHaveCount(2);
  const packageId=await f.page.locator('input[name=package_id]').first().inputValue();let chosen=await services.first().locator('input:checked').inputValue();
  if(method==='prepaid'){
   const before=(await activeQuote(f.page)).quote,alternative=services.first().locator('input:not(:checked)').first();chosen=await alternative.inputValue();await alternative.check();
   // With JavaScript the courier applies at once; the order button only ever offers the recalculated total.
   await expect.poll(async()=>(await activeQuote(f.page)).quote.packages.find((p:{id:string})=>p.id===packageId)?.selected_option_id).toBe(chosen);
   const after=(await activeQuote(f.page)).quote;await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName(`Buat pesanan · ${rupiah(after.buyer_total)}`);
   if(after.buyer_total!==before.buyer_total)await expect(f.page.locator('.checkout-total-change')).toContainText(`Total berubah dari ${rupiah(before.buyer_total)} menjadi ${rupiah(after.buyer_total)}`);
   await capture(f.page,'shipping-service-changed-390');
   await f.page.reload();await expectOrderStep(f.page);await expect(services.first().locator('input:checked')).toHaveValue(chosen);
   for(const [index,parcel] of after.packages.entries())await expect(f.page.locator('.checkout-parcel').nth(index)).toContainText(rupiah(parcel.buyer_shipping_amount));
   await expect(f.page.getByRole('group',{name:'Pembagian paket',exact:true}).locator('label').filter({has:f.page.locator('input:checked')})).toContainText(rupiah(after.shipping_total));
  }else{for(let i=0;i<2;i++){await expect(services.nth(i).getByRole('radio')).toHaveCount(1);await expect(services.nth(i).getByRole('radio')).toBeChecked();}}
  await expect(f.page.locator('.checkout-parcel')).toHaveCount(2);
  await capture(f.page,`review-two-origins-${method}-390`);for(const width of [768,1024,1440]){await f.page.setViewportSize({width,height:900});await capture(f.page,`review-two-origins-${method}-${width}`);}await f.page.setViewportSize({width:390,height:900});
  await expect(f.page.locator('.checkout-summary details')).not.toHaveAttribute('open','');
  const {cart,quote}=await activeQuote(f.page);assert.equal(quote.merchandise_total,396000);assert.equal(quote.packages.length,2);assert.equal(new Set(quote.packages.map((p:{origin_city:string})=>p.origin_city)).size,2);assert.equal(quote.packages.find((p:{id:string})=>p.id===packageId)?.selected_option_id,chosen);
  assert.equal(quote.packages.reduce((sum:number,p:{lines:{quantity:number}[]})=>sum+p.lines.reduce((n,l)=>n+l.quantity,0),0),4);assert.equal(quote.buyer_total,quote.merchandise_total+quote.shipping_total-quote.subsidy_total);
  // Summary lines follow parcel order; each shows a quantity badge, "variant · N pilihan" and one "Isi: …" line.
  const parcelLineIds=[...new Set(quote.packages.flatMap((p:{lines:{cart_line_id:string}[]})=>p.lines.map(line=>line.cart_line_id)))] as string[],ordered=parcelLineIds.map(id=>cart.lines.find((line:{id:string})=>line.id===id));
  const lines=f.page.locator('.checkout-summary-line');await expect(lines.locator('.checkout-summary-text>strong')).toHaveText(ordered.map(line=>line.name));
  await expect(lines.locator('.checkout-qty')).toHaveText(ordered.map(line=>String(line.quantity)));await expect(lines.locator('.checkout-summary-text>span:not(.checkout-summary-contents)')).toHaveText(ordered.map(line=>`${line.variant_label} · ${line.quantity} pilihan`));
  await expect(lines.locator('.checkout-summary-contents')).toHaveText(ordered.map(line=>`Isi: ${line.contents.map((c:{quantity:number;name:string})=>`${c.quantity} × ${c.name}`).join(', ')}`));
  await expect(f.page.locator('.checkout-summary .checkout-contents')).toHaveCount(0);await expect(f.page.locator('.checkout-parcel .checkout-contents')).toHaveCount(quote.packages.reduce((n:number,p:{lines:unknown[]})=>n+p.lines.length,0),{timeout:1000});
  if(method==='cod'){
   await expect(f.page.locator('.checkout-due span')).toHaveText('Total COD');await expect(f.page.locator('.checkout-summary .checkout-total dt')).toHaveText('Total COD (2 paket)');
   assert.equal(quote.packages.reduce((sum:number,p:{cod_collect_amount:number})=>sum+p.cod_collect_amount,0),quote.amount_due,'couriers collect the buyer total plus any frozen DEC-009 COD fee');
   await expect(f.page.getByText('COD paket ini',{exact:true})).toHaveCount(2);
   for(const [index,parcel] of quote.packages.entries())await expect(f.page.locator('.checkout-parcel').nth(index).locator('.checkout-total dd')).toHaveText(rupiah(parcel.cod_collect_amount));
  }
  // COD: the order button carries what the couriers collect (amount_due includes any frozen COD fee).
  await expect(f.page.locator('#checkout-primary')).toHaveAccessibleName(`Buat pesanan · ${rupiah(method==='cod'?quote.amount_due:quote.buyer_total)}`);assert.equal(await orderCount(f.cart.id),0);
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);
  await expect(f.page.getByRole('heading',{name:method==='cod'?'Pembayaran COD':'Menunggu pembayaran',exact:true})).toBeVisible();const orders=await identity.sql`select id,buyer_total from app.commerce_order where cart_id=${f.cart.id}`;assert.equal(orders.length,1);assert.equal(Number(orders[0].buyer_total),quote.buyer_total);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
 }finally{if(held)await identity.sql.begin(async tx=>{await releaseReservation(tx,held,'Owned two-origin browser precondition finished',owner.id);await tx`delete from app.outbox_job where kind='inventory.reservation.expire' and dedup_key=${`inventory-expire:${held}`} and payload->>'reservationId'=${held} and status='ready'`;});}
});


test('empty checkout and unavailable private order expose task recovery without private details',async()=>{
 const f=await start(390,true,[]);try{
  await f.page.goto(`${origin}/checkout`);await expect(f.page.getByRole('heading',{name:'Keranjang masih kosong',exact:true})).toBeVisible();await expect(f.page.getByRole('link',{name:'Lihat produk',exact:true})).toBeVisible();await expect(f.page.locator('#checkout-help summary')).toHaveText(['Bagaimana melanjutkan belanja?']);await capture(f.page,'checkout-empty-390');
  await f.page.goto(`${origin}/checkout/order/${randomUUID()}`);await expect(f.page.getByRole('heading',{name:'Akses pesanan perlu diperiksa',exact:true})).toBeVisible();await expect(f.page.locator('.checkout-charges')).toHaveCount(0);await expect(f.page.getByRole('button',{name:'Pulihkan akses pesanan',exact:true})).toBeVisible();await expect(f.page.locator('#checkout-help').getByText('Mengapa akses perlu diperiksa?',{exact:true})).toBeVisible();await expect(f.page.locator('#checkout-help').getByText('Bagaimana jika status pembayaran belum diketahui?',{exact:true})).toHaveCount(0);await capture(f.page,'payment-denied-390');
  assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('business-expired cart keeps an explicit recovery instead of editable checkout',async()=>{
 const f=expiredFixture;assert.ok(f);expiredFixture=undefined;try{
  const clock=await readFixtureClock('local',namespace);await advanceFixtureClock('local',namespace,604801,clock.version);
  await f.page.goto(`${origin}/checkout`);await expect(f.page.getByRole('heading',{name:'Keranjang perlu diperiksa',exact:true})).toBeVisible();await expect(f.page.getByLabel('Nama penerima',{exact:true})).toHaveCount(0);await expect(f.page.getByRole('link',{name:'Kembali ke keranjang',exact:true})).toBeVisible();await expect(f.page.locator('#checkout-help summary')).toHaveText(['Bagaimana melanjutkan belanja?']);await capture(f.page,'checkout-expired-390');
  assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});
