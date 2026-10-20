import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import test from 'node:test';
import {chromium,expect,type Page} from '@playwright/test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {expireOwnedOrderJob} from '../../src/modules/checkout/expiry.ts';
import {releaseReservation,reserveOffers} from '../../src/modules/inventory/reservations.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {allOrderIssuedCookies,orderReceiptPath,recoverOrderReceipt} from '../../src/modules/orders/receipt.ts';
import {ingestCodEvent,simulateCodCollection} from '../../src/modules/payments/cod-local.ts';
import {ingestProviderEvent,simulateCollection} from '../../src/modules/payments/local.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {handlePromotions} from '../../src/modules/promotions/routes.ts';
import {rupiah} from '../../src/modules/storefront/format.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {grantedChoices} from '../integration/advertising-fixture.ts';
import {CommerceClient} from '../integration/checkout-fixture.ts';

const origin='http://127.0.0.1:3099',buildId=readFileSync('.next/BUILD_ID','utf8').trim(),rootOutput='docs/spec/design/renders/s27',output=`${rootOutput}/${buildId}`,namespace=`s27-${randomUUID().slice(0,8)}`;
const identity=createLocalAuth('local'),carts=new Set<string>();
let owner:Awaited<ReturnType<typeof actor>>,seeded:Awaited<ReturnType<typeof seedCommerce>>,curated:Awaited<ReturnType<typeof prepareStorefront>>;

test.before(async()=>{
 owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 const request=()=>owner.browser.request('/api/v1/admin/products');
 seeded=await seedCommerce(request(),identity,'local',namespace);
 curated=await prepareStorefront(request(),identity,'local',namespace,seeded);
 const clock=await readFixtureClock('local',namespace),seconds=Math.ceil((Date.now()-Date.parse(clock.now))/1000);
 if(seconds>0)await advanceFixtureClock('local',namespace,seconds,clock.version);
});

test.after(async()=>{
 const failures:unknown[]=[];
 try{
  const orders=carts.size?await identity.sql`select id from app.commerce_order where clock_namespace=${namespace} and cart_id in ${identity.sql([...carts])} and status='pending' and payment_status='pending'`:[];
  if(orders.length){
   const clock=await readFixtureClock('local',namespace);await advanceFixtureClock('local',namespace,1860,clock.version);
   for(const order of orders){
    const [job]=await identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id} and status='ready'`;
    if(job)await identity.sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));
   }
  }
 }catch(error){failures.push(error);}
 try{
  if(seeded)for(const reservation of Object.values(seeded.reservations)){
   await identity.sql.begin(tx=>releaseReservation(tx,reservation,'Owned S27 browser fixture finished'));
   await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${reservation}`;
  }
  if(owner)await cleanup(identity,[owner]);
 }catch(error){failures.push(error);}
 await identity.sql.end();
 if(failures.length)throw new AggregateError(failures,'Owned S27 browser cleanup failed');
});

async function startOrder(width:number,payment_method:'prepaid'|'cod'='prepaid',javaScriptEnabled=true,lines?:{variant_id:string;quantity:number;expected_publication_id:string}[]){
 const product=curated.products['shirt-cream'];assert.ok(product.publication_id);
 const client=new CommerceClient(identity),body={lines:lines??[{variant_id:product.offer_id,quantity:1,expected_publication_id:product.publication_id}]},key=randomUUID();
 try{
  assert.equal((await client.call('/api/v1/carts',body,{key})).response.status,401);
  const request=client.request('/api/v1/carts',body,{key}),principal=await commerceActor(request,identity);assert.ok(principal?.kind==='guest');
  const created=await identity.sql.begin(tx=>createCart(tx,request,identity,principal,body,{clock_namespace:namespace}));carts.add(created.cart.id);
  const replay=await client.call('/api/v1/carts',body,{key});assert.equal(replay.response.status,201);
  const quote=await client.call('/api/v1/checkout/quotes',{cart_id:created.cart.id,address:{recipient_name:'Penerima Contoh',phone:'+6281200000000',address_line:'Jalan Contoh 12 RT 01',destination_id:'test-malang',postal_code:'00001'},contact:{phone:'+6281200000000',email:null},payment_method},{version:1});
  assert.equal(quote.response.status,201);
  const submitted=await client.call('/api/v1/orders',{quote_id:quote.payload.id,buyer_note:'Titip di penerima'},{version:1});
  assert.equal(submitted.response.status,201);
  const order=submitted.payload.order,uiPath=orderReceiptPath(order.id);
  const recovered=await recoverOrderReceipt(client.request(uiPath,{}),identity,order.id);
  for(const entry of await allOrderIssuedCookies(identity,order.id,recovered.cookies)){
   client.cookies.set(`${entry.name}:${entry.path}`,{name:entry.name,value:entry.value,path:entry.path});
  }
  const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  try{
   const context=await browser.newContext({viewport:{width,height:900},javaScriptEnabled,reducedMotion:'reduce'}),page=await context.newPage();page.setDefaultTimeout(15000);
   const errors:string[]=[];page.on('pageerror',()=>errors.push('Uncaught page error'));
   page.on('request',req=>assert.equal(new URL(req.url()).origin,origin,'No external browser request'));
   await context.addCookies([...client.cookies.values()].map(c=>({name:c.name,value:c.value,domain:'127.0.0.1',path:c.path,httpOnly:true,sameSite:'Lax' as const,secure:false})));
   return {browser,context,page,client,cart:created.cart,order,uiPath,errors};
  }catch(error){await browser.close();throw error;}
 }catch(error){await client.auth('/sign-out',{});throw error;}
}

async function close(f:Awaited<ReturnType<typeof startOrder>>){
 const failures:unknown[]=[];
 try{const response=await f.page.request.post(`${origin}/api/auth/sign-out`,{headers:{origin},data:{}});assert.equal(response.status(),200);}catch(error){failures.push(error);}
 try{
  const orders=await identity.sql`select id from app.commerce_order where cart_id=${f.cart.id} and clock_namespace=${namespace} and status='pending' and payment_status='pending'`;
  if(orders.length){
   const clock=await readFixtureClock('local',namespace);await advanceFixtureClock('local',namespace,1860,clock.version);
   for(const order of orders){
    const [job]=await identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id} and status='ready'`;
    if(job)await identity.sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));
   }
  }
 }catch(error){failures.push(error);}
 await f.browser.close();
 if(failures.length)throw new AggregateError(failures,'Owned S27 scenario cleanup failed');
}

async function capture(page:Page,name:string){
 await mkdir(output,{recursive:true});await mkdir(rootOutput,{recursive:true});
 await page.evaluate(()=>document.fonts.ready);
 assert.doesNotMatch(await page.locator('body').innerText(),/\[s27-[a-f0-9]+\]|SYNTHETIC|Local shipping simulation|Regular simulation/,'Render-visible fixture labels stay natural Indonesian');
 await page.mouse.move(0,0);
 const bytes=await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
 await writeFile(`${rootOutput}/${name}.png`,bytes);
 const geometry=await page.evaluate(()=>({
  width:document.documentElement.clientWidth,
  overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
  offenders:[...document.querySelectorAll('body *')].flatMap(el=>{
   const box=el.getBoundingClientRect();
   return box.right>document.documentElement.clientWidth+1&&box.width>0?[{tag:el.tagName,id:el.id,class:el.className,right:box.right,width:box.width}]:[];
  }).slice(0,12)
 }));
 assert.ok(geometry.overflow<=1,`No horizontal overflow on ${name}: ${JSON.stringify(geometry)}`);
}

async function holdTwoOriginStock(){
 const [position]=await identity.sql<{warehouse_id:string;available:number}[]>`select b.warehouse_id,b.on_hand-b.reserved-b.quarantined as available from app.inventory_balance b join app.local_fixture_warehouse w on w.warehouse_id=b.warehouse_id where b.id=${seeded.positions['fixture-malang:fixture-shirt']} and b.stock_item_id=${seeded.stocks['fixture-shirt']} and w.namespace=${namespace} and w.fixture_id='fixture-malang'`;
 assert.ok(position);assert.ok(position.available>=1,'Owned Malang shirt stock must retain one complete unit');
 if(position.available===1)return null;
 const shirt=curated.products.shirt,[published]=await identity.sql<{product_revision:number}[]>`select product_revision from app.publication_version where id=${shirt.publication_id} and product_id=${shirt.id}`;assert.ok(published);
 const clock=await readFixtureClock('local',namespace);
 return identity.sql.begin(async tx=>{
  const held=await reserveOffers(tx,{key:`s27-two-origin:${namespace}:${randomUUID()}`,lines:[{line_id:'s27_owned_precondition',product_id:shirt.id,product_revision:published.product_revision,offer_id:shirt.offer_id,warehouse_id:position.warehouse_id,quantity:position.available-1}],expires_at:new Date(Date.parse(clock.now)+3600000).toISOString(),clock_namespace:namespace,actor_id:owner.id});
  return held.header.id;
 });
}

test('prepaid order receipt renders pending, instructions, unknown, failed, and confirmed states across 390, 768, 1024, and 1440px without emitting Purchase on reload',async()=>{
 const [window]=await identity.sql`select max(v.ends_at)::text ends from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where v.active`;
 const target=Math.max(Date.now(),Date.parse(window.ends??new Date().toISOString()))+1000;let clock=await readFixtureClock('local',namespace);
 while(Date.parse(clock.now)<target)clock=await advanceFixtureClock('local',namespace,Math.min(31622400,Math.ceil((target-Date.parse(clock.now))/1000)),clock.version);
 const config={expected_version:0,name:'Contoh subsidi ongkir tanda terima',active:true,starts_at:clock.now,ends_at:new Date(Date.parse(clock.now)+3600000).toISOString(),kind:'fixed',value:3000,maximum_per_order:3000,minimum_merchandise:99000,budget:100000,per_buyer_limit:10,payment_methods:['prepaid'],region_ids:['test-malang'],service_ids:[],stacking:'exclusive',priority:10000,reason:'Owned S27 visual proof; no unrelated configuration changes'};
 const save=async(id:string|null,body:Record<string,unknown>)=>{const request=owner.browser.request(`/api/v1/admin/shipping-promotions${id?`/${id}/versions`:''}`,body);request.headers.set('idempotency-key',randomUUID());const response=await handlePromotions(request,identity);assert.equal(response.status,201);return response.json();};
 const campaign=await save(null,config);let f:Awaited<ReturnType<typeof startOrder>>|undefined;
 try{
  f=await startOrder(390,'prepaid');
  assert.equal(f.order.subsidy_total,3000);
  const bootstrap=await f.page.request.post(`${origin}/api/v1/visitor-sessions`,{headers:{origin,'idempotency-key':randomUUID()},data:{client_request_id:randomUUID()}});assert.equal(bootstrap.status(),201);
  const consent=await f.page.request.post(`${origin}/api/v1/consent/receipt`,{headers:{origin,'idempotency-key':randomUUID()},data:{expected_version:0,policy_version:'local-privacy-v1',choices:grantedChoices}});assert.equal(consent.status(),201);
  await f.page.goto(`${origin}${f.uiPath}`);
  await expect(f.page.getByRole('heading',{name:'Menunggu pembayaran',exact:true})).toBeVisible();
  await expect(f.page.locator('.shopping-tabs')).toHaveCount(0);
  await expect(f.page.locator('.checkout-order-reference')).toContainText(f.order.number);
  await expect(f.page.getByText('+62••••0000',{exact:true})).toBeVisible();
  await expect(f.page.locator('.receipt-parcel .checkout-charges').getByText('Ongkir yang dibayar',{exact:true})).toBeVisible();
  await expect(f.page.locator('.receipt-summary-card .checkout-charges').getByText('Subsidi ongkir',{exact:true})).toBeAttached();
  assert.ok(!(await f.page.content()).includes('+6281200000000')&&!(await f.page.content()).includes('081200000000'),'Raw phone stays masked in HTML');
  for(const width of [390,768,1024,1440]){
   await f.page.setViewportSize({width,height:900});
   const statusBox=await f.page.locator('.receipt-status-card').boundingBox(),summaryBox=await f.page.locator('.receipt-summary-card').boundingBox(),parcelsBox=await f.page.locator('.receipt-parcels').boundingBox();
   assert.ok(statusBox&&summaryBox&&parcelsBox);
   if(width>=1024){
    assert.ok(summaryBox.x>statusBox.x+200,`Desktop ${width}px places summary beside primary status`);
    await expect(f.page.locator('.receipt-summary-card>details')).toHaveAttribute('open','');
    await expect(f.page.getByText('1 × Kaos contoh',{exact:true})).toBeVisible();
    await expect(f.page.getByText('2 × Krim contoh',{exact:true})).toBeVisible();
    await expect(f.page.locator('.receipt-summary-card .checkout-charges').getByText('Subsidi ongkir',{exact:true})).toBeVisible();
   }else{
    assert.ok(summaryBox.y>statusBox.y+50&&parcelsBox.y>summaryBox.y+40,`Mobile/tablet ${width}px stacks summary between status and parcels`);
    if(width===768){
     const headerBox=await f.page.locator('.checkout-header').boundingBox(),shiptoBox=await f.page.locator('.receipt-shipto').boundingBox();
     assert.ok(headerBox&&shiptoBox&&Math.abs(statusBox.x-shiptoBox.x)<2&&Math.abs(statusBox.width-shiptoBox.width)<2,'768px aligns single-column cards and header');
    }
    await expect(f.page.locator('.receipt-summary-card>details')).not.toHaveAttribute('open','');
   }
   await capture(f.page,`receipt-prepaid-pending-${width}`);
  }
  await f.page.setViewportSize({width:390,height:900});

  const currentOrderId=f.order.id;
  await expect.poll(async()=>(await identity.sql`select count(*)::int n from app.commerce_event where order_id=${currentOrderId} and name='receipt_viewed'`)[0].n).toBe(1);
  await f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true}).click();
  await expect(f.page.getByRole('heading',{name:'Instruksi pembayaran',exact:true})).toBeVisible();
  await capture(f.page,'receipt-prepaid-instructions-390');

  const [attempt]=await identity.sql`select id,creation_job_id from app.payment_attempt where order_id=${f.order.id}`;assert.ok(attempt);
  assert.equal(await runOneJob(identity.sql,{'payment.create':paymentAdapter(identity.sql,'local',new Map([[attempt.id,'creation-commit-lost-ack']]))},attempt.creation_job_id),true);
  await f.page.reload();
  await expect(f.page.getByRole('heading',{name:'Status pembayaran sedang diperiksa',exact:true})).toBeVisible();
  await expect(f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true})).toHaveCount(0);
  await capture(f.page,'receipt-prepaid-unknown-390');

  await identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${attempt.creation_job_id} and status='unknown'`;
  assert.equal(await runOneJob(identity.sql,{'payment.create':paymentAdapter(identity.sql,'local')},attempt.creation_job_id),true);
  const failed=await simulateCollection(identity.sql,'local',attempt.id,{status:'failed'});
  assert.equal(await runOneJob(identity.sql,{},await ingestProviderEvent(identity.sql,failed)),true);
  await f.page.reload();
  await expect(f.page.getByRole('heading',{name:'Percobaan pembayaran gagal',exact:true})).toBeVisible();
  await expect(f.page.locator('.checkout-payment-status')).toHaveAttribute('role','alert');
  await expect(f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true})).toBeVisible();
  await capture(f.page,'receipt-prepaid-failed-390');

  const retryClock=await readFixtureClock('local',namespace);
  await advanceFixtureClock('local',namespace,1,retryClock.version);
  await f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true}).click();
  await expect(f.page.getByRole('heading',{name:'Instruksi pembayaran',exact:true})).toBeVisible();
  const [secondAttempt]=await identity.sql`select id,creation_job_id from app.payment_attempt where order_id=${f.order.id} order by created_at desc,(status in ('confirmed','pending','unknown')) desc,id desc limit 1`;assert.ok(secondAttempt);
  assert.equal(await runOneJob(identity.sql,{'payment.create':paymentAdapter(identity.sql,'local')},secondAttempt.creation_job_id),true);
  const paid=await simulateCollection(identity.sql,'local',secondAttempt.id);
  assert.equal(await runOneJob(identity.sql,{},await ingestProviderEvent(identity.sql,paid)),true);
  await f.page.reload();
  await expect(f.page.getByRole('heading',{name:'Pembayaran terkonfirmasi',exact:true})).toBeVisible();
  for(const width of [390,768,1024,1440]){
   await f.page.setViewportSize({width,height:900});
   if(width===390){
    await f.page.locator('.receipt-summary-card>details>summary').click();
    await expect(f.page.locator('.receipt-summary-card .checkout-charges').getByText('Subsidi ongkir',{exact:true})).toBeVisible();
   }
   await capture(f.page,`receipt-prepaid-paid-${width}`);
   if(width===390)await f.page.locator('.receipt-summary-card>details>summary').click();
  }
  await f.page.setViewportSize({width:390,height:900});
  await f.page.reload();
  assert.equal((await identity.sql`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='Purchase'`)[0].n,1,'Reloading paid receipt never duplicates Purchase');
  assert.equal((await identity.sql`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='receipt_viewed'`)[0].n,1,'Reloading receipt never duplicates receipt_viewed');
  for(const cookie of (await f.context.cookies()).filter(c=>c.httpOnly)){
   assert.ok(!(await f.page.content()).includes(cookie.value),'No authority cookie in HTML');
  }
  assert.equal(await f.page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  assert.deepEqual(f.errors,[]);
 }finally{try{if(f)await close(f);}finally{await save(campaign.id,{...config,expected_version:1,active:false,reason:'Owned S27 scenario finished; retain configuration and history'});}}
});

test('two-origin split-COD receipt renders cod_due, partial collection, full collection, 3-item disclosure, and 320px/200% text reflow',async()=>{
 const shirt=curated.products.shirt,cream=curated.products['cream-pair'],bundle=curated.products['shirt-cream'];
 assert.ok(shirt.publication_id&&cream.publication_id&&bundle.publication_id);
 const held=await holdTwoOriginStock();
 try{
  const f=await startOrder(390,'cod',true,[
   {variant_id:shirt.offer_id,quantity:2,expected_publication_id:shirt.publication_id},
   {variant_id:cream.offer_id,quantity:1,expected_publication_id:cream.publication_id},
   {variant_id:bundle.offer_id,quantity:1,expected_publication_id:bundle.publication_id}
  ]);
  try{
   assert.equal(f.order.shipments.length,2);
   assert.equal(f.order.items.length,3);
   await f.page.goto(`${origin}${f.uiPath}`);
   await expect(f.page.getByRole('heading',{name:'Pesanan COD dikonfirmasi',exact:true})).toBeVisible();
   await expect(f.page.locator('.receipt-parcel')).toHaveCount(2);
   await expect(f.page.locator('.receipt-summary-card>details')).not.toHaveAttribute('open','');
   await capture(f.page,'receipt-cod-due-390');

   await f.page.setViewportSize({width:1440,height:900});
   await expect(f.page.locator('.receipt-summary-card>details')).toHaveAttribute('open','');
   await expect(f.page.locator('.receipt-more-items')).toHaveAttribute('open','');
   await expect(f.page.locator('.receipt-summary-card').getByText('Contoh Kaos',{exact:true})).toBeVisible();
   await capture(f.page,'receipt-cod-due-1440');

   await f.page.setViewportSize({width:320,height:568});
   const enlarged=await f.page.addStyleTag({content:'html {font-size:200%}'});
   await expect(f.page.locator('.receipt-summary-card>details')).not.toHaveAttribute('open','');
   const back=await f.page.locator('.checkout-back').boundingBox(),help=await f.page.getByRole('link',{name:'Bantuan',exact:true}).boundingBox(),panelBox=await f.page.locator('.receipt-cod-panel').boundingBox(),leadBox=await f.page.locator('.receipt-lead').boundingBox(),figureBox=await f.page.locator('.receipt-cod-figure').boundingBox();
   assert.ok(back&&help&&panelBox&&leadBox&&figureBox);
   assert.ok(leadBox.y<panelBox.y&&figureBox.y+figureBox.height<568,'320px/200% keeps lead above COD panel and places COD cash figure in the first 568px screen');
   assert.ok(help.width>=44&&help.height>=44,'Help keeps 44px target at 320px/200%');
   await f.page.locator('.receipt-summary-card>details>summary').click();
   await expect(f.page.locator('.receipt-summary-card>details')).toHaveAttribute('open','');
   await f.page.locator('.receipt-more-items summary').click();
   await expect(f.page.locator('.receipt-more-items')).toHaveAttribute('open','');
   await capture(f.page,'receipt-cod-text-200-320');
   await f.page.locator('.receipt-summary-card>details>summary').click();
   await enlarged.evaluate(el=>el.parentNode?.removeChild(el));
   await f.page.setViewportSize({width:390,height:900});

   const [firstParcel,secondParcel]=f.order.shipments;
   await expect(f.page.locator('.receipt-cod-panel')).toContainText('Sisa tagihan kurir (2 paket)');
   const codClock1=await readFixtureClock('local',namespace);
   await advanceFixtureClock('local',namespace,5400,codClock1.version);
   const firstEvent=await simulateCodCollection(identity.sql,'local',firstParcel.id,{status:'collected'});
   assert.equal(await runOneJob(identity.sql,{},await ingestCodEvent(identity.sql,firstEvent)),true);
   await f.page.getByRole('link',{name:'Perbarui status',exact:true}).click();
   await expect(f.page.getByRole('heading',{name:'Sebagian paket COD tertagih',exact:true})).toBeVisible();
   await expect(f.page.locator('.receipt-cod-panel')).toContainText('Sisa tagihan kurir (1 paket)');
   await expect(f.page.locator('.receipt-cod-panel')).toContainText(rupiah(firstParcel.cod_collect_amount));
   await expect(f.page.locator('.receipt-cod-panel')).toContainText(rupiah(secondParcel.cod_collect_amount));
   await expect(f.page.locator('.receipt-parcel').first().locator('.receipt-badge')).toHaveText('Diterima lengkap');
   await expect(f.page.getByRole('heading',{name:'Retur dan pengembalian dana',exact:true})).toBeVisible();
   await capture(f.page,'receipt-cod-partial-390');

   await f.page.setViewportSize({width:1440,height:900});
   await capture(f.page,'receipt-cod-partial-1440');
   await f.page.setViewportSize({width:390,height:900});

   const codClock2=await readFixtureClock('local',namespace);
   await advanceFixtureClock('local',namespace,3600,codClock2.version);
   const secondEvent=await simulateCodCollection(identity.sql,'local',secondParcel.id,{status:'collected'});
   assert.equal(await runOneJob(identity.sql,{},await ingestCodEvent(identity.sql,secondEvent)),true);
   await f.page.reload();
   await expect(f.page.getByRole('heading',{name:'Pembayaran COD selesai',exact:true})).toBeVisible();
   await expect(f.page.locator('.receipt-cod-panel')).toContainText('Sisa tagihan kurir');
   await expect(f.page.locator('.receipt-cod-panel')).not.toContainText('Sisa tagihan kurir (');
   await capture(f.page,'receipt-cod-paid-390');
   await f.page.reload();
   assert.equal((await identity.sql`select count(*)::int n from app.commerce_event where order_id=${f.order.id} and name='Purchase'`)[0].n,2,'Two COD parcels emit two Purchases total and zero on reload');
   assert.deepEqual(f.errors,[]);
  }finally{await close(f);}
 }finally{
  if(held)await identity.sql.begin(async tx=>{
   await releaseReservation(tx,held,'Owned S27 two-origin browser precondition finished',owner.id);
   await tx`delete from app.outbox_job where kind='inventory.reservation.expire' and dedup_key=${`inventory-expire:${held}`} and payload->>'reservationId'=${held} and status='ready'`;
  });
 }
});

test('no-JS receipt payment, expired unpaid order receipt, and denied access recovery without private leakage',async()=>{
 const f=await startOrder(390,'prepaid',false),navigations:string[]=[];
 f.page.on('request',r=>{if(r.isNavigationRequest())navigations.push(r.method());});
 try{
  await f.page.goto(`${origin}${f.uiPath}`);
  await expect(f.page.getByRole('heading',{name:'Menunggu pembayaran',exact:true})).toBeVisible();
  await capture(f.page,'receipt-nojs-390');
  await f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true}).click();
  await expect(f.page.getByRole('heading',{name:'Instruksi pembayaran',exact:true})).toBeVisible();
  assert.equal(navigations.at(-1),'GET','Native receipt payment redirects to read-only GET document');

  const clock=await readFixtureClock('local',namespace);
  await advanceFixtureClock('local',namespace,1860,clock.version);
  const [job]=await identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${f.order.id}`;
  assert.ok(job);await identity.sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));
  await f.page.reload();
  await expect(f.page.getByRole('heading',{name:'Pesanan tidak lagi aktif',exact:true})).toBeVisible();
  await expect(f.page.getByRole('button',{name:'Siapkan instruksi pembayaran',exact:true})).toHaveCount(0);
  await expect(f.page.getByRole('link',{name:'Lihat produk',exact:true})).toBeVisible();
  await capture(f.page,'receipt-expired-390');

  const strangerOrderId=randomUUID();
  await f.page.goto(`${origin}/orders/${strangerOrderId}`);
  await expect(f.page.getByRole('heading',{name:'Akses pesanan perlu diperiksa',exact:true})).toBeVisible();
  await expect(f.page.locator('.checkout-charges')).toHaveCount(0);
  assert.ok(!(await f.page.content()).includes('Penerima Contoh')&&!(await f.page.content()).includes('Jalan Contoh'),'Denied receipt exposes no private recipient or address');
  await expect(f.page.getByRole('button',{name:'Pulihkan akses pesanan',exact:true})).toBeVisible();
  await capture(f.page,'receipt-denied-390');
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});
