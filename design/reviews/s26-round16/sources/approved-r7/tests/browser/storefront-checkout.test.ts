import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
import {releaseReservation} from '../../src/modules/inventory/reservations.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {CommerceClient} from '../integration/checkout-fixture.ts';
import {deniedChoices,grantedChoices} from '../integration/advertising-fixture.ts';

const origin='http://127.0.0.1:3099',output='docs/spec/design/renders/s26',namespace=`s26-${randomUUID().slice(0,8)}`;
const identity=createLocalAuth('local'),carts=new Set<string>();
let expiredFixture:Awaited<ReturnType<typeof start>>|undefined;
let owner:Awaited<ReturnType<typeof actor>>,seeded:Awaited<ReturnType<typeof seedCommerce>>,curated:Awaited<ReturnType<typeof prepareStorefront>>;
test.before(async()=>{
 owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 const request=()=>owner.browser.request('/api/v1/admin/products');
 seeded=await seedCommerce(request(),identity,'local',namespace);curated=await prepareStorefront(request(),identity,'local',namespace,seeded);
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
async function capture(page:Page,name:string){await mkdir(output,{recursive:true});await page.evaluate(()=>document.fonts.ready);await page.mouse.move(0,0);await page.screenshot({path:`${output}/${name}.png`,fullPage:true});const geometry=await page.evaluate(()=>({width:document.documentElement.clientWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,offenders:[...document.querySelectorAll('body *')].flatMap(el=>{const box=el.getBoundingClientRect();return box.right>document.documentElement.clientWidth+1&&box.width>0?[{tag:el.tagName,id:el.id,class:el.className,right:box.right,width:box.width}]:[]}).slice(0,12)}));if(geometry.overflow>1)await writeFile(`${output}/${name}-overflow.json`,JSON.stringify(geometry,null,2));assert.ok(geometry.overflow<=1,'No horizontal overflow; inspect captured geometry');}
async function contact(page:Page,method='prepaid'){
 await page.getByLabel('Nama penerima',{exact:true}).fill('Penerima Contoh');await page.getByLabel('Nomor HP',{exact:true}).fill('081200000000');
 await page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('test-malang');await page.getByLabel('Alamat lengkap',{exact:true}).fill('Jalan Contoh 12\nRT 01');await page.getByLabel('Catatan pengiriman (opsional)',{exact:true}).fill('Titip di penerima\nHubungi saat tiba');
 await page.locator(`input[name=payment_method][value=${method}]`).check();
}

for(const javaScriptEnabled of [true,false])test(`checkout draft survives cart exit and review reload with JavaScript ${javaScriptEnabled?'enabled':'disabled'}`,async()=>{
 const f=await start(390,javaScriptEnabled);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);
  if(javaScriptEnabled){
   await expect(f.page.getByText('Draf tersimpan.',{exact:true})).toBeVisible();await f.page.reload();
   await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');await expect(f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true})).toHaveValue('Titip di penerima\nHubungi saat tiba');
  }
  await f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true}).fill('SYNTHETIC note on task exit\nKeep this note');
  await f.page.getByRole('button',{name:'Keranjang',exact:true}).click();await f.page.waitForURL(`${origin}/cart`);await f.page.getByRole('link',{name:'Lanjut ke checkout',exact:true}).click();
  await expect(f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true})).toHaveValue('SYNTHETIC note on task exit\nKeep this note');await expect(f.page.getByLabel('Nomor HP',{exact:true})).toHaveValue('081200000000');
  await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();await f.page.getByRole('button',{name:'Tinjau pesanan',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Tinjau pesanan',exact:true})).toBeVisible();
  await f.page.getByRole('button',{name:'Keranjang',exact:true}).click();await f.page.waitForURL(`${origin}/cart`);await f.page.getByRole('link',{name:'Lanjut ke checkout',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Tinjau pesanan',exact:true})).toBeVisible();
  await expect(f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true})).toHaveValue('SYNTHETIC note on task exit\nKeep this note');
  await f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true}).fill('');if(javaScriptEnabled)await expect(f.page.getByText('Tidak ada catatan pengiriman.',{exact:true})).toBeVisible();
  await f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true}).fill('SYNTHETIC final note\nRing once');await capture(f.page,`review-draft-${javaScriptEnabled?'js':'nojs'}-390`);
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);
  const orders=await identity.sql`select id,buyer_note from app.commerce_order where cart_id=${f.cart.id}`;assert.equal(orders.length,1);assert.equal(orders[0].buyer_note,'SYNTHETIC final note Ring once');
  await f.page.goto(`${origin}/cart`);await f.page.getByRole('link',{name:'Periksa pesanan',exact:true}).click();await f.page.waitForURL(`${origin}/checkout/order/${orders[0].id}`);await expect(f.page.getByRole('heading',{name:'Menunggu pembayaran',exact:true})).toBeVisible();
  assert.equal(await f.page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('competing checkout drafts preserve local input and a revoked autosave clears the private view',async()=>{
 const f=await start(390);try{
  await f.page.goto(`${origin}/checkout`);await f.page.getByLabel('Nama penerima',{exact:true}).fill('SYNTHETIC first draft');await expect(f.page.getByText('Draf tersimpan.',{exact:true})).toBeVisible();
  const other=await f.context.newPage();await other.goto(`${origin}/checkout`);await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('SYNTHETIC first draft');
  await f.page.getByLabel('Nama penerima',{exact:true}).fill('SYNTHETIC newer first draft');await expect(f.page.getByText('Draf tersimpan.',{exact:true})).toBeVisible();
  await other.getByLabel('Nama penerima',{exact:true}).fill('SYNTHETIC unsaved competing draft');await expect(other.getByText('Draf berubah di halaman lain. Muat ulang untuk memeriksanya.',{exact:true})).toBeVisible();await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('SYNTHETIC unsaved competing draft');await expect(other.getByRole('button',{name:'Lanjut ke pengiriman',exact:true})).toBeDisabled();await expect(other.locator('.checkout-conflict')).toHaveAttribute('role','alert');await capture(other,'draft-conflict-390');other.once('dialog',dialog=>dialog.accept());await other.getByRole('link',{name:'Muat ulang draf tersimpan',exact:true}).click();await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('SYNTHETIC newer first draft');await expect(other.getByRole('button',{name:'Lanjut ke pengiriman',exact:true})).toBeEnabled();
  const check=await f.context.newPage();await check.goto(`${origin}/checkout`);await expect(check.getByLabel('Nama penerima',{exact:true})).toHaveValue('SYNTHETIC newer first draft');await check.close();await other.close();
  assert.equal((await identity.sql`select count(*)::int n from app.checkout_quote where cart_id=${f.cart.id}`)[0].n,0);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);
  const revoked=await f.page.request.post(`${origin}/api/auth/sign-out`,{headers:{origin},data:{}});assert.equal(revoked.status(),200);
  await f.page.getByLabel('Nama penerima',{exact:true}).fill('SYNTHETIC revoked local input');await expect(f.page.getByRole('heading',{name:'Sesi belanja perlu diperiksa',exact:true})).toBeVisible();await expect(f.page.getByLabel('Nama penerima',{exact:true})).toHaveCount(0);assert.ok(!(await f.page.locator('main').innerText()).includes('SYNTHETIC'));await capture(f.page,'draft-scope-denied-390');assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('native conflicting checkout draft blocks advance and reloads the stored copy without overwriting it',async()=>{
 const f=await start(390,false);try{
  await f.page.goto(`${origin}/checkout`);const other=await f.context.newPage();await other.goto(`${origin}/checkout`);
  await contact(f.page);await f.page.getByLabel('Nama penerima',{exact:true}).fill('SYNTHETIC native stored draft');await f.page.getByRole('button',{name:'Cari wilayah',exact:true}).click();await expect(f.page.getByText('Pilih tujuan dari hasil pencarian.',{exact:true})).toBeVisible();
  await contact(other);await other.getByLabel('Nama penerima',{exact:true}).fill('SYNTHETIC native unsaved draft');await other.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();
  await expect(other.getByText('Draf berubah di halaman lain. Muat ulang untuk memeriksanya.',{exact:true})).toBeVisible();await expect(other.getByRole('button',{name:'Lanjut ke pengiriman',exact:true})).toBeDisabled();await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('SYNTHETIC native unsaved draft');await capture(other,'draft-conflict-nojs-390');
  assert.equal((await identity.sql`select count(*)::int n from app.checkout_quote where cart_id=${f.cart.id}`)[0].n,0);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);
  await other.getByRole('link',{name:'Muat ulang draf tersimpan',exact:true}).click();await expect(other.getByLabel('Nama penerima',{exact:true})).toHaveValue('SYNTHETIC native stored draft');await expect(other.getByRole('button',{name:'Lanjut ke pengiriman',exact:true})).toBeEnabled();await other.close();assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

for(const javaScriptEnabled of [true,false])test(`implicit Enter stays in checkout and searches without an exit or financial action with JavaScript ${javaScriptEnabled?'enabled':'disabled'}`,async()=>{
 const f=await start(390,javaScriptEnabled);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);
  for(const name of ['Nama penerima','Nomor HP']){
   await f.page.getByLabel(name,{exact:true}).press('Enter');await expect(f.page.getByText('Pilih tujuan dari hasil pencarian.',{exact:true})).toBeVisible();await expect(f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true})).toBeEnabled();await expect(f.page).toHaveURL(`${origin}/checkout`);await expect(f.page.getByRole('heading',{name:'Alamat penerima',exact:true})).toBeVisible();await expect(f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true})).toHaveValue('Titip di penerima\nHubungi saat tiba');
  }
  await f.page.getByLabel('Cari wilayah (opsional)',{exact:true}).fill('not-a-destination');await f.page.getByLabel('Cari wilayah (opsional)',{exact:true}).press('Enter');await expect(f.page.getByText('Tujuan tidak ditemukan. Coba nama wilayah lain.',{exact:true})).toBeVisible();await expect(f.page).toHaveURL(`${origin}/checkout`);
  assert.equal((await identity.sql`select count(*)::int n from app.checkout_quote where cart_id=${f.cart.id}`)[0].n,0);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

for(const width of [390,768,1024,1440])test(`guest checkout contact/shipping/review creates one native pending order at ${width}px`,async()=>{
 const f=await start(width);try{
  await f.page.goto(`${origin}/cart`);await expect(f.page.getByRole('link',{name:'Lanjut ke checkout',exact:true})).toBeVisible();await f.page.getByRole('link',{name:'Lanjut ke checkout',exact:true}).click();
  await expect(f.page.getByRole('heading',{name:'Alamat penerima',exact:true})).toBeVisible();await expect(f.page.locator('.shopping-tabs')).toHaveCount(0);await expect(f.page.locator('.checkout-summary summary')).toContainText('Rp198.000');
  await contact(f.page,width===768?'cod':'prepaid');
  if(width===390){
   await f.page.getByLabel('Nomor HP',{exact:true}).fill('wrong');await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.locator('#checkout-phone-error')).toBeVisible();await expect(f.page.getByLabel('Nomor HP',{exact:true})).toBeFocused();await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');await capture(f.page,'contact-error-390');await f.page.getByLabel('Nomor HP',{exact:true}).fill('081200000000');
   await f.page.getByLabel('Cari wilayah (opsional)',{exact:true}).fill('not-a-destination');await f.page.getByRole('button',{name:'Cari wilayah',exact:true}).click();await expect(f.page.getByText('Tujuan tidak ditemukan. Coba nama wilayah lain.',{exact:true})).toBeVisible();await expect(f.page.getByLabel('Nomor HP',{exact:true})).toHaveValue('081200000000');
   await f.page.getByLabel('Cari wilayah (opsional)',{exact:true}).fill('');await f.page.getByRole('button',{name:'Cari wilayah',exact:true}).click();await expect(f.page.getByText('Pilih tujuan dari hasil pencarian.',{exact:true})).toBeVisible();
  }
  await capture(f.page,`contact-${width}`);await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();await capture(f.page,`shipping-${width}`);
  await f.page.getByRole('link',{name:'Bantuan',exact:true}).click();await f.page.getByText('Mengapa ongkir perlu dihitung ulang?',{exact:true}).click();await f.page.getByRole('link',{name:'Kembali ke formulir',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeFocused();
  await f.page.getByRole('button',{name:'Tinjau pesanan',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Tinjau pesanan',exact:true})).toBeVisible();await expect(f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true})).toHaveValue('Titip di penerima\nHubungi saat tiba');await capture(f.page,`review-${width}`);
  if(width!==768)await expect(f.page.getByRole('button',{name:/^Buat pesanan/})).toContainText('Pembayaran simulasi');
  const [quote]=await identity.sql`select buyer_total from app.checkout_quote where cart_id=${f.cart.id} order by created_at desc limit 1`;
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);await expect(f.page.getByRole('heading',{name:width===768?'Pembayaran COD':'Menunggu pembayaran',exact:true})).toBeVisible();
  const orders=await identity.sql`select id,buyer_total,payment_status from app.commerce_order where cart_id=${f.cart.id}`;assert.equal(orders.length,1);assert.equal(Number(orders[0].buyer_total),Number(quote.buyer_total));assert.equal(orders[0].payment_status,width===768?'cod_due':'pending');
  await capture(f.page,`payment-${width}`);if(width===390){await f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Instruksi pembayaran',exact:true})).toBeVisible();await capture(f.page,'payment-instructions-390');
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
  await f.page.goto(`${origin}/checkout`);await contact(f.page);await f.page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('');await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.locator('#checkout-destination-error')).toBeVisible();await expect(f.page.getByLabel('Wilayah pengiriman',{exact:true})).toBeFocused();await f.page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('test-malang');
  await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();
  await f.page.getByRole('button',{name:'Ubah alamat atau metode',exact:true}).click();await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');await expect(f.page.getByLabel('Email (opsional)',{exact:true})).toHaveValue('');await capture(f.page,'contact-nojs-390');
  await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();await f.page.getByRole('button',{name:'Tinjau pesanan',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Tinjau pesanan',exact:true})).toBeVisible();
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);await expect(f.page.getByRole('heading',{name:'Menunggu pembayaran',exact:true})).toBeVisible();await capture(f.page,'payment-nojs-390');await f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Instruksi pembayaran',exact:true})).toBeVisible();assert.equal(navigations.at(-1),'GET','Native payment success redirects to a read-only document');await f.page.reload();assert.equal(navigations.at(-1),'GET');
  const orders=await identity.sql`select id from app.commerce_order where cart_id=${f.cart.id}`;assert.equal(orders.length,1);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('320px enlarged text and viewport changes retain the active checkout fields and operable summary',async()=>{
 const f=await start(320);try{
  await f.page.setViewportSize({width:320,height:568});await f.page.goto(`${origin}/checkout`);await contact(f.page);
  await f.page.addStyleTag({content:'html {font-size:200%}'});await expect(f.page.locator('.checkout-summary details')).not.toHaveAttribute('open','');await capture(f.page,'contact-text-200-collapsed-320');await f.page.locator('.checkout-summary summary').click();await expect(f.page.locator('.checkout-summary details')).toHaveAttribute('open','');await capture(f.page,'contact-text-200-320');
  await f.page.setViewportSize({width:768,height:1024});await expect(f.page.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh');await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('discarded committed order reply requires explicit exact retry and returns the original private order',async()=>{
 const f=await start(390);let discarded=false,submissions=0,actionId:string|null=null,arrive!:()=>void,release!:()=>void;const committedReady=new Promise<void>(r=>arrive=r),held=new Promise<void>(r=>release=r);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();await f.page.getByRole('button',{name:'Tinjau pesanan',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Tinjau pesanan',exact:true})).toBeVisible();
  await f.page.route('**/checkout',async(route,request)=>{
   if(request.method()==='POST'&&request.headers()['next-action']){actionId??=request.headers()['next-action'];if(request.headers()['next-action']===actionId)submissions++;}if(!discarded&&request.method()==='POST'&&request.headers()['next-action']===actionId){await route.fetch({maxRedirects:0});discarded=true;arrive();await held;await route.abort('failed');}else await route.continue();
  });
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await committedReady;const pending=f.page.getByRole('button',{name:'Menyimpan pesanan…',exact:true});await expect(pending).toBeDisabled();await pending.evaluate(el=>(el as HTMLButtonElement).click());assert.equal(submissions,1,'A second activation while pending cannot submit another order request');await capture(f.page,'review-pending-390');release();await expect(f.page.getByRole('button',{name:'Periksa hasil tindakan',exact:true})).toBeVisible();assert.equal(discarded,true);
  const committed=await identity.sql`select id,buyer_total from app.commerce_order where cart_id=${f.cart.id}`;assert.equal(committed.length,1);await expect(f.page.getByRole('heading',{name:'Hasil tindakan belum diketahui',exact:true})).toBeVisible();await expect(f.page.locator('.checkout-summary summary')).toContainText('Rp');await expect(f.page.getByRole('heading',{name:'Bantuan checkout',exact:true})).toBeVisible();await capture(f.page,'order-unknown-390');
  // Reconnecting/reading this state has not made a second request or payment.
  assert.equal((await identity.sql`select count(*)::int n from app.payment_attempt where order_id=${committed[0].id}`)[0].n,0);
  await f.page.getByRole('button',{name:'Periksa hasil tindakan',exact:true}).click();await f.page.waitForURL(`${origin}/checkout/order/${committed[0].id}`);await expect(f.page.getByRole('heading',{name:'Menunggu pembayaran',exact:true})).toBeVisible();
  assert.equal(submissions,2,'Only the initial action and explicit exact retry reached the order action');assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,1);assert.equal((await identity.sql`select count(*)::int n from app.commerce_event where order_id=${committed[0].id} and name='Purchase'`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{release();await close(f);}
});

test('expired quote requires explicit recalculation and renewed parcel review while preserving the safe draft',async()=>{
 const f=await start(390);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page);await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();await f.page.getByRole('button',{name:'Tinjau pesanan',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Tinjau pesanan',exact:true})).toBeVisible();
  const [quote]=await identity.sql`select expires_at from app.checkout_quote where cart_id=${f.cart.id} order by created_at desc limit 1`,clock=await readFixtureClock('local',namespace);await advanceFixtureClock('local',namespace,Math.ceil((new Date(quote.expires_at).getTime()-Date.parse(clock.now))/1000)+1,clock.version);
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await expect(f.page.getByRole('heading',{name:'Alamat penerima',exact:true})).toBeVisible();await expect(f.page.locator('.checkout-feedback')).toContainText('kedaluwarsa');await expect(f.page.getByLabel('Nomor HP',{exact:true})).toHaveValue('081200000000');await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');await capture(f.page,'quote-expired-390');
  assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();await expect(f.page.getByRole('button',{name:/^Buat pesanan/})).toHaveCount(0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('unavailable COD and unsupported destination retain draft and require an explicit supported method',async()=>{
 const f=await start(390);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page,'cod');await f.page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('test-prepaid-only');await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.locator('.checkout-feedback')).toContainText('COD belum tersedia');await expect(f.page.getByLabel('Alamat lengkap',{exact:true})).toHaveValue('Jalan Contoh 12\nRT 01');await capture(f.page,'cod-unavailable-390');
  await f.page.locator('input[name=payment_method][value=prepaid]').check();await f.page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('test-no-route');await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.locator('.checkout-feedback')).toContainText('Belum ada pengiriman');await expect(f.page.getByLabel('Nomor HP',{exact:true})).toHaveValue('081200000000');await capture(f.page,'shipping-unavailable-390');
  assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);await f.page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('test-prepaid-only');await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();await expect(f.page.locator('.checkout-parcel').first()).toContainText('simulasi');assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('built checkout observes five consented milestones once and sends no typed fields or Purchase',async()=>{
 const f=await start(390);try{
  const bootstrap=await f.page.request.post(`${origin}/api/v1/visitor-sessions`,{headers:{origin,'idempotency-key':randomUUID()},data:{client_request_id:randomUUID()}});assert.equal(bootstrap.status(),201);
  const consent=await f.page.request.post(`${origin}/api/v1/consent/receipt`,{headers:{origin,'idempotency-key':randomUUID()},data:{expected_version:0,policy_version:'local-privacy-v1',choices:grantedChoices}});assert.equal(consent.status(),201);
  const events=()=>identity.sql`select name,payload,merchandise_amount from app.commerce_event where payload->>'cart_id'=${f.cart.id} order by name`;
  await f.page.goto(`${origin}/checkout`);await expect(f.page.getByRole('heading',{name:'Alamat penerima',exact:true})).toBeVisible();await expect.poll(async()=>(await events()).map(e=>e.name)).toEqual(['checkout_started']);
  await contact(f.page);await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();await expect.poll(async()=>(await events()).map(e=>e.name)).toEqual(['address_validated','checkout_started','contact_validated']);
  await f.page.getByRole('button',{name:'Tinjau pesanan',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Tinjau pesanan',exact:true})).toBeVisible();await expect.poll(async()=>(await events()).map(e=>e.name)).toEqual(['address_validated','checkout_started','contact_validated','payment_method_selected','shipping_selected']);
  await f.page.reload();await expect(f.page.getByRole('heading',{name:'Tinjau pesanan',exact:true})).toBeVisible();const captured=await events();assert.equal(captured.length,5);assert.ok(captured.every(e=>Number(e.merchandise_amount)===0));
  const payload=JSON.stringify(captured);for(const privateValue of ['Penerima Contoh','081200000000','+6281200000000','Jalan Contoh','Titip di penerima','test-malang'])assert.ok(!payload.includes(privateValue),'No typed checkout field or destination in captured events');await capture(f.page,'review-consented-390');
  const withdrawn=await f.page.request.post(`${origin}/api/v1/consent/receipt`,{headers:{origin,'idempotency-key':randomUUID()},data:{expected_version:1,policy_version:'local-privacy-v1',choices:deniedChoices}});assert.equal(withdrawn.status(),201);await f.page.reload();await expect(f.page.getByRole('heading',{name:'Tinjau pesanan',exact:true})).toBeVisible();assert.equal((await events()).length,5);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('a current owned shipping subsidy is disclosed in each parcel and the final authoritative total',async()=>{
 const [window]=await identity.sql`select max(v.ends_at)::text ends from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where v.active`;
 const target=Math.max(Date.now(),Date.parse(window.ends??new Date().toISOString()))+1000;let clock=await readFixtureClock('local',namespace);
 while(Date.parse(clock.now)<target)clock=await advanceFixtureClock('local',namespace,Math.min(31622400,Math.ceil((target-Date.parse(clock.now))/1000)),clock.version);
 const config={expected_version:0,name:'SYNTHETIC owned S26 campaign',active:true,starts_at:clock.now,ends_at:new Date(Date.parse(clock.now)+3600000).toISOString(),kind:'fixed',value:3000,maximum_per_order:3000,minimum_merchandise:99000,budget:100000,per_buyer_limit:10,payment_methods:['prepaid'],region_ids:['test-malang'],service_ids:[],stacking:'exclusive',priority:10000,reason:'Owned S26 visual proof; no unrelated configuration changes'};
 const save=async(id:string|null,body:Record<string,unknown>)=>{const request=owner.browser.request(`/api/v1/admin/shipping-promotions${id?`/${id}/versions`:''}`,body);request.headers.set('idempotency-key',randomUUID());const response=await handlePromotions(request,identity);assert.equal(response.status,201);return response.json();};
 const campaign=await save(null,config);let f:Awaited<ReturnType<typeof start>>|undefined;
 try{
  f=await start(390);await f.page.goto(`${origin}/checkout`);await contact(f.page);await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();await expect(f.page.getByText('Subsidi paket tersimpan',{exact:true})).toBeVisible();await capture(f.page,'shipping-subsidized-390');
  await f.page.getByRole('button',{name:'Tinjau pesanan',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Tinjau pesanan',exact:true})).toBeVisible();await expect(f.page.locator('.checkout-fields').getByText('Subsidi ongkir',{exact:true})).toBeVisible();await capture(f.page,'review-subsidized-390');
  const current=await f.page.request.get(`${origin}/api/v1/carts/current`);assert.equal(current.status(),200);const cart=await current.json(),response=await f.page.request.get(`${origin}/api/v1/checkout/quotes/${cart.active_quote_id}`);assert.equal(response.status(),200);const quote=await response.json();assert.equal(Number(quote.subsidy_total),3000);assert.equal(Number(quote.buyer_total),Number(quote.merchandise_total)+Number(quote.shipping_total)-3000);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);const [order]=await identity.sql`select id,buyer_total from app.commerce_order where cart_id=${f.cart.id}`;assert.ok(order);assert.equal(Number(order.buyer_total),Number(quote.buyer_total));
  const expiryClock=await readFixtureClock('local',namespace);await advanceFixtureClock('local',namespace,1860,expiryClock.version);const [expiry]=await identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;assert.ok(expiry);await identity.sql.begin(tx=>expireOwnedOrderJob(tx,{id:expiry.id,kind:expiry.kind,payload:expiry.payload}));
  await f.page.reload();await expect(f.page.getByRole('heading',{name:'Pembayaran tidak tersedia',exact:true})).toBeVisible();await expect(f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true})).toHaveCount(0);await capture(f.page,'payment-expired-390');assert.equal((await identity.sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{try{if(f)await close(f);}finally{await save(campaign.id,{...config,expected_version:1,active:false,reason:'Owned S26 scenario finished; retain configuration and history'});}}
});

for(const method of ['prepaid','cod'])test(`two physical origins retain complete quantities and disclosed ${method} parcel amounts`,async()=>{
 const shirt=curated.products.shirt,cream=curated.products['cream-pair'];assert.ok(shirt.publication_id&&cream.publication_id);
 const f=await start(390,true,[{variant_id:shirt.offer_id,quantity:3,expected_publication_id:shirt.publication_id},{variant_id:cream.offer_id,quantity:1,expected_publication_id:cream.publication_id}]);try{
  await f.page.goto(`${origin}/checkout`);await contact(f.page,method);await f.page.getByRole('button',{name:'Lanjut ke pengiriman',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();await expect(f.page.locator('.checkout-parcel')).toHaveCount(2);await capture(f.page,`shipping-two-origins-${method}-390`);for(const width of [768,1024,1440]){await f.page.setViewportSize({width,height:900});await capture(f.page,`shipping-two-origins-${method}-${width}`);}await f.page.setViewportSize({width:390,height:900});await expect(f.page.locator('.checkout-summary details')).not.toHaveAttribute('open','');
  if(method==='prepaid'){
   const plans=f.page.getByLabel('Pembagian paket',{exact:true}),current=await plans.inputValue(),next=await plans.locator('option').evaluateAll((options,value)=>options.map(option=>(option as HTMLOptionElement).value).find(id=>id!==value),current);assert.ok(next);await plans.selectOption(next);await expect(f.page.getByText('Paket baru ditampilkan setelah pembagian diperbarui.',{exact:true})).toBeVisible();await expect(f.page.locator('.checkout-parcel')).toHaveCount(0);await expect(f.page.locator('.checkout-summary summary')).toContainText('Perhitungan tersimpan');await capture(f.page,'allocation-changed-390');
   await f.page.getByRole('button',{name:'Perbarui pembagian paket',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();await expect(f.page.locator('.checkout-parcel')).toHaveCount(2);assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);
  }
  const services=f.page.locator('select[name=shipping_option_id]');await expect(services).toHaveCount(2);const packageId=await f.page.locator('input[name=package_id]').first().inputValue();const chosen=await services.first().locator('option').last().getAttribute('value');assert.ok(chosen);await services.first().selectOption(chosen);await expect(f.page.locator('.checkout-summary summary')).toContainText('Perhitungan tersimpan');await expect(f.page.getByText('Perhitungan tersimpan belum mengikuti pilihan pengiriman. Tinjau pesanan untuk memperbarui total.',{exact:true})).toBeVisible();if(method==='prepaid'){
   await capture(f.page,'shipping-service-changed-390');await expect(f.page.locator('.checkout-parcel').first().locator('.checkout-charges')).toHaveCount(0);await expect(f.page.getByText('Draf tersimpan.',{exact:true})).toBeVisible();await f.page.reload();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();await expect(services.first()).toHaveValue(chosen);await expect(f.page.locator('.checkout-summary summary')).toContainText('Perhitungan tersimpan');await expect(f.page.locator('.checkout-parcel').first().locator('.checkout-charges')).toHaveCount(0);await expect(f.page.locator('.checkout-parcel').first().getByText('Biaya paket menunggu perhitungan baru.',{exact:true})).toBeVisible();await capture(f.page,'shipping-service-restored-390');
  }
  await f.page.getByRole('button',{name:'Tinjau pesanan',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Tinjau pesanan',exact:true})).toBeVisible();await expect(f.page.locator('.checkout-parcel')).toHaveCount(2);await capture(f.page,`review-two-origins-${method}-390`);for(const width of [768,1024,1440]){await f.page.setViewportSize({width,height:900});await capture(f.page,`review-two-origins-${method}-${width}`);}await f.page.setViewportSize({width:390,height:900});await expect(f.page.locator('.checkout-summary details')).not.toHaveAttribute('open','');
  const current=await f.page.request.get(`${origin}/api/v1/carts/current`);assert.equal(current.status(),200);const cart=await current.json(),response=await f.page.request.get(`${origin}/api/v1/checkout/quotes/${cart.active_quote_id}`);assert.equal(response.status(),200);const quote=await response.json();assert.equal(quote.merchandise_total,396000);assert.equal(quote.packages.length,2);assert.equal(new Set(quote.packages.map((p:{origin_city:string})=>p.origin_city)).size,2);assert.equal(quote.packages.find((p:{id:string})=>p.id===packageId)?.selected_option_id,chosen);
  assert.equal(quote.packages.reduce((sum:number,p:{lines:{quantity:number}[]})=>sum+p.lines.reduce((n,l)=>n+l.quantity,0),0),4);assert.equal(quote.buyer_total,quote.merchandise_total+quote.shipping_total-quote.subsidy_total);
  if(method==='prepaid'){
   await f.page.getByRole('button',{name:'Ubah pengiriman',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Pengiriman per paket',exact:true})).toBeVisible();
   await expect(f.page.getByLabel('Pembagian paket',{exact:true}).locator('option:checked'),'Current allocation retains the native selected shipping total after task Back').toContainText(rupiah(quote.shipping_total));
   for(const [index,parcel] of quote.packages.entries())await expect(f.page.locator('.checkout-parcel').nth(index)).toContainText(rupiah(parcel.buyer_shipping_amount));await capture(f.page,'shipping-return-selected-390');
   await f.page.getByRole('button',{name:'Tinjau pesanan',exact:true}).click();await expect(f.page.getByRole('heading',{name:'Tinjau pesanan',exact:true})).toBeVisible();
  }
  if(method==='cod'){assert.equal(quote.packages.reduce((sum:number,p:{cod_collect_amount:number})=>sum+p.cod_collect_amount,0),quote.buyer_total);await expect(f.page.getByText('COD paket ini',{exact:true})).toHaveCount(2);}
  await f.page.getByRole('button',{name:/^Buat pesanan/}).click();await f.page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);await expect(f.page.getByRole('heading',{name:method==='cod'?'Pembayaran COD':'Menunggu pembayaran',exact:true})).toBeVisible();const orders=await identity.sql`select id,buyer_total from app.commerce_order where cart_id=${f.cart.id}`;assert.equal(orders.length,1);assert.equal(Number(orders[0].buyer_total),quote.buyer_total);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});


test('empty checkout and unavailable private order expose task recovery without private details',async()=>{
 const f=await start(390,true,[]);try{
  await f.page.goto(`${origin}/checkout`);await expect(f.page.getByRole('heading',{name:'Keranjang masih kosong',exact:true})).toBeVisible();await expect(f.page.getByRole('link',{name:'Lihat produk',exact:true})).toBeVisible();await capture(f.page,'checkout-empty-390');
  await f.page.goto(`${origin}/checkout/order/${randomUUID()}`);await expect(f.page.getByRole('heading',{name:'Akses pesanan perlu diperiksa',exact:true})).toBeVisible();await expect(f.page.locator('.checkout-charges')).toHaveCount(0);await expect(f.page.getByRole('button',{name:'Pulihkan akses pesanan',exact:true})).toBeVisible();await capture(f.page,'payment-denied-390');
  assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('business-expired cart keeps an explicit recovery instead of editable checkout',async()=>{
 const f=expiredFixture;assert.ok(f);expiredFixture=undefined;try{
  const clock=await readFixtureClock('local',namespace);await advanceFixtureClock('local',namespace,604801,clock.version);
  await f.page.goto(`${origin}/checkout`);await expect(f.page.getByRole('heading',{name:'Keranjang perlu diperiksa',exact:true})).toBeVisible();await expect(f.page.getByLabel('Nama penerima',{exact:true})).toHaveCount(0);await expect(f.page.getByRole('link',{name:'Kembali ke keranjang',exact:true})).toBeVisible();await capture(f.page,'checkout-expired-390');
  assert.equal((await identity.sql`select count(*)::int n from app.commerce_order where cart_id=${f.cart.id}`)[0].n,0);assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});
