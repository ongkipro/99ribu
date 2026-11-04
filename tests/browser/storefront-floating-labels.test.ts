import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import test from 'node:test';
import {chromium,expect,type Locator,type Page} from '@playwright/test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {expireOwnedOrderJob} from '../../src/modules/checkout/expiry.ts';
import {releaseReservation} from '../../src/modules/inventory/reservations.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {CommerceClient} from '../integration/checkout-fixture.ts';
import {RENDERS} from '../render-root.ts';

// Checkout field labels and the S143 checkout-summary polish. 2026-11-03 the labels became static above their controls; on
// 2026-11-05 the owner brought floating labels back (Tokophi's CSS-only pattern at Shopify checkout's measurements: 49px fields,
// 14px resting label inside, 12px raised label). One owned seeded cart per scenario; labels are plain CSS, so every case also
// runs without JavaScript where it can.
const origin='http://127.0.0.1:3099',output=`${RENDERS}/s141/${readFileSync('.next/BUILD_ID','utf8').trim()}`,namespace=`s141-${randomUUID().slice(0,8)}`;
const identity=createLocalAuth('local'),carts=new Set<string>();
let owner:Awaited<ReturnType<typeof actor>>,seeded:Awaited<ReturnType<typeof seedCommerce>>,curated:Awaited<ReturnType<typeof prepareStorefront>>;
test.before(async()=>{
 owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 const request=()=>owner.browser.request('/api/v1/admin/products');
 seeded=await seedCommerce(request(),identity,'local',namespace);curated=await prepareStorefront(request(),identity,'local',namespace,seeded);
 const clock=await readFixtureClock('local',namespace),seconds=Math.ceil((Date.now()-Date.parse(clock.now))/1000);if(seconds>0)await advanceFixtureClock('local',namespace,seconds,clock.version);
});
test.after(async()=>{
 const failures:unknown[]=[];
 try{
  const orders=carts.size?await identity.sql`select id from app.commerce_order where clock_namespace=${namespace} and cart_id in ${identity.sql([...carts])}`:[];
  if(orders.length){const clock=await readFixtureClock('local',namespace);await advanceFixtureClock('local',namespace,1860,clock.version);
   for(const order of orders){const [job]=await identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;assert.ok(job);await identity.sql.begin(tx=>expireOwnedOrderJob(tx,{id:job.id,kind:job.kind,payload:job.payload}));}
  }
 }catch(error){failures.push(error);}
 try{if(seeded)for(const reservation of Object.values(seeded.reservations)){await identity.sql.begin(tx=>releaseReservation(tx,reservation,'Owned S141 browser fixture finished'));await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${reservation}`;}if(owner)await cleanup(identity,[owner]);}catch(error){failures.push(error);}
 await identity.sql.end();if(failures.length)throw new AggregateError(failures,'Owned S141 browser cleanup failed');
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

// The buyer note lives in a collapsed disclosure inside the order summary (owner 2026-11-05); open both (the summary is
// itself collapsed on phones) the way a buyer would before typing.
async function note(page:Page){
 if(!await page.locator('.checkout-note > summary').isVisible())await page.locator('.checkout-summary > details > summary').click();
 if(!await page.locator('.checkout-note').evaluate(el=>(el as HTMLDetailsElement).open))await page.locator('.checkout-note > summary').click();
 return page.getByLabel('Catatan pengiriman (opsional)',{exact:true});
}
// Couriers load by themselves once the address is complete (owner 2026-11-05). Without JavaScript "Cek ongkir" asks for
// them; with JavaScript an incomplete or rejected address is checked by pressing "Buat pesanan" in the contact step.
async function calculate(page:Page){
 const nojs=page.getByRole('button',{name:'Cek ongkir',exact:true}),review=page.locator('dl.checkout-review-box');
 if(await nojs.isVisible()){await nojs.click();return;}
 if(await review.isVisible()||await review.waitFor({timeout:2500}).then(()=>true,()=>false))return;
 await page.getByRole('button',{name:'Buat pesanan',exact:true}).click();
}
type Kind='input'|'select'|'textarea';
// Every text control the checkout contact step shows: its label (the accessible name), id, kind and a value to type.
const fields:{label:string;id:string;kind:Kind;value:string}[]=[
 {label:'Nama lengkap',id:'checkout-recipient_name',kind:'input',value:'Penerima Contoh'},
 {label:'Nomor WhatsApp',id:'checkout-phone',kind:'input',value:'081200000000'},
 {label:'Kecamatan tujuan',id:'checkout-query',kind:'input',value:'Malang'},
 {label:'Alamat lengkap',id:'checkout-address_line',kind:'textarea',value:'Jalan Contoh 12\nRT 01'},
 {label:'Catatan pengiriman (opsional)',id:'checkout-buyer_note',kind:'textarea',value:'Titip di penerima'},
];
const labelOf=(page:Page,id:string)=>page.locator(`label[for="${id}"]`);
const fontSize=(locator:Locator)=>locator.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
// Raised = the label is scaled down (transform matrix a < 1); resting = no transform.
const raised=(page:Page,id:string)=>labelOf(page,id).evaluate(el=>{const t=getComputedStyle(el).transform;return t!=='none'&&new DOMMatrix(t).a<0.99;});
async function boxes(page:Page,id:string){
 const label=await labelOf(page,id).boundingBox(),control=await page.locator(`#${id}`).boundingBox();assert.ok(label&&control,`${id} is rendered`);return {label,control};
}
// The label sits inside its control's box (floating label), starting at its left padding.
function assertInside(id:string,{label,control}:Awaited<ReturnType<typeof boxes>>,state:string){
 assert.ok(label.x>=control.x-0.5&&label.x+label.width<=control.x+control.width+1,`${id} ${state}: label inside the control horizontally ${JSON.stringify({label,control})}`);
 assert.ok(label.y>=control.y-0.5&&label.y<control.y+control.height,`${id} ${state}: label starts inside the control ${JSON.stringify({label,control})}`);
}
async function capture(page:Page,name:string){
 await mkdir(output,{recursive:true});await page.evaluate(()=>document.fonts.ready);await expect(page.getByText('Menyimpan draf…',{exact:true})).not.toBeVisible();
 await page.mouse.move(0,0);await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.ok(overflow<=0,`${name}: no horizontal overflow (${overflow}px)`);
}

for(const width of [390,768,1440])test(`checkout floating labels rest inside 49px controls and rise on focus or with a value at ${width}px`,{timeout:90000},async()=>{
 const f=await start(width);try{
  await f.page.goto(`${origin}/checkout`);
  // No email in checkout (owner 2026-11-05).
  await expect(f.page.locator('input[type=email], [name=email]')).toHaveCount(0);await expect(f.page.getByText('Email',{exact:false})).toHaveCount(0);
  await note(f.page);
  for(const field of fields){
   const control=f.page.locator(`#${field.id}`),label=labelOf(f.page,field.id);
   // The native label stays the accessible name and follows its control in the DOM (CSS sibling selector, no JavaScript).
   await expect(f.page.getByLabel(field.label,{exact:true})).toHaveAttribute('id',field.id);
   assert.ok(await control.evaluate(el=>Boolean(el.compareDocumentPosition(document.querySelector(`label[for="${el.id}"]`) as Node)&Node.DOCUMENT_POSITION_FOLLOWING)),`${field.id}: label after the control`);
   await control.scrollIntoViewIfNeeded();
   assert.equal(await fontSize(label),14,`${field.id}: label is 14px`);
   // 14px with a fine pointer (Shopify); the stylesheet raises it to 16px on touch screens (no iOS focus zoom).
   assert.ok(await fontSize(control)>=14,`${field.id}: control text is at least 14px`);
   const rest=await boxes(f.page,field.id);assertInside(field.id,rest,'at rest');
   assert.ok(rest.control.height>=48.5,`${field.id}: control is at least 49px tall (${rest.control.height})`);
   assert.equal(await raised(f.page,field.id),field.kind==='select',`${field.id}: at rest only a select's label is raised`);
   await control.focus();
   assert.equal(await raised(f.page,field.id),true,`${field.id}: focus raises the label`);
   assert.equal(await control.evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(91, 53, 213)',`${field.id}: purple focus frame`);
   assertInside(field.id,await boxes(f.page,field.id),'focused');
   if(field.kind==='select')await control.selectOption(field.value);else await control.fill(field.value);
   await control.blur();
   assert.equal(await raised(f.page,field.id),true,`${field.id}: a value keeps the label raised`);
   const typed=await boxes(f.page,field.id);assertInside(field.id,typed,'with a value');
   assert.ok(typed.label.y<rest.label.y||field.kind==='select',`${field.id}: the raised label sits higher`);
   if(field.kind==='select')await control.selectOption('');else await control.fill('');
   await control.blur();
   assert.equal(await raised(f.page,field.id),field.kind==='select',`${field.id}: an emptied field rests again`);
  }
  // Kelurahan and postal code (owner 2026-11-05): disabled until a kecamatan is chosen, then only that kecamatan's
  // kelurahan; the postal code follows the kelurahan, read-only and out of the tab order.
  const kelurahan=f.page.getByRole('combobox',{name:'Kelurahan / desa',exact:true}),postal=f.page.locator('#checkout-postal_code');
  await expect(kelurahan).toBeDisabled();await expect(postal).toBeDisabled();assert.equal(await raised(f.page,'checkout-destination_id'),false);
  await f.page.getByRole('combobox',{name:'Kecamatan tujuan',exact:true}).fill('Kecamatan Contoh A');await f.page.getByRole('option',{name:/Kecamatan Contoh A/}).click();
  await expect(kelurahan).toBeEnabled();await expect(kelurahan).toHaveValue('Kelurahan Contoh A');await expect(postal).toHaveValue('00001');await expect(postal).toHaveAttribute('readonly','');await expect(postal).toHaveAttribute('tabindex','-1');
  assert.equal(await raised(f.page,'checkout-destination_id'),true);assert.equal(await raised(f.page,'checkout-postal_code'),true);assertInside('checkout-destination_id',await boxes(f.page,'checkout-destination_id'),'chosen');
  await kelurahan.focus();await kelurahan.press('ArrowDown');await expect(f.page.getByRole('listbox',{name:'Kelurahan atau desa'}).getByRole('option')).toHaveText(['Kelurahan Contoh A00001']);await kelurahan.press('Escape');
  await f.page.getByRole('combobox',{name:'Kecamatan tujuan',exact:true}).fill('');await expect(kelurahan).toBeDisabled();await expect(postal).toHaveValue('');
  await capture(f.page,`labels-rest-${width}`);
  for(const field of fields){const control=f.page.locator(`#${field.id}`);if(field.kind==='select')await control.selectOption(field.value);else await control.fill(field.value);}
  await capture(f.page,`labels-filled-${width}`);
  // Desktop (Shopify): the summary sits on the grey right half (no card), 40px after the split at 50% + 50px.
  const summary=await f.page.locator('.checkout-summary').evaluate(el=>{const s=getComputedStyle(el);return {radius:s.borderTopLeftRadius,x:el.getBoundingClientRect().x};});
  assert.equal(summary.radius,'0px','the summary is a panel, not a rounded card');
  if(width>=1024)assert.ok(Math.abs(summary.x-(width/2+50+40))<=1,`summary column starts 40px after the split (${summary.x})`);
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

for(const javaScriptEnabled of [true,false])test(`server-prefilled values and server errors keep the label raised, the error and the hint associated (JavaScript ${javaScriptEnabled?'on':'off'})`,{timeout:90000},async()=>{
 const f=await start(390,javaScriptEnabled);try{
  await f.page.goto(`${origin}/checkout`);
  // No error yet: the kecamatan search, the phone and the still-disabled kelurahan are described by their hints.
  await expect(f.page.locator('#checkout-query')).toHaveAttribute('aria-describedby','checkout-query-hint');await expect(f.page.locator('#checkout-query-hint')).toBeVisible();
  await expect(f.page.locator('#checkout-phone')).toHaveAttribute('aria-describedby','checkout-phone-hint');await expect(f.page.locator('#checkout-phone-hint')).toHaveText('Contoh: 0812 3456 7890');
  await expect(f.page.locator('#checkout-destination_id')).toHaveAttribute('aria-describedby','checkout-destination-hint');await expect(f.page.locator('#checkout-destination-hint')).toHaveText('Pilih kecamatan dulu.');
  await f.page.getByLabel('Nama lengkap',{exact:true}).fill('Penerima Contoh');await (await note(f.page)).fill('Titip di penerima');
  // Submit with the phone, region and address empty: the server answers with its validation errors and the draft values.
  await calculate(f.page);
  // No error summary (owner 2026-11-05): each field shows its own error and the first invalid field in reading order takes focus.
  await expect(f.page.locator('#checkout-phone-error')).toBeVisible();await expect(f.page.locator('.checkout-error')).toHaveCount(0);await expect(f.page.locator('#checkout-phone')).toBeFocused();
  await expect(f.page.getByLabel('Nama lengkap',{exact:true})).toHaveValue('Penerima Contoh');
  assert.equal(await raised(f.page,'checkout-recipient_name'),true,'a server-prefilled value renders with the label raised (CSS only)');
  assert.equal(await raised(f.page,'checkout-buyer_note'),true,'a prefilled note renders with the label raised');
  await expect(f.page.locator('.checkout-note')).toHaveAttribute('open','');
  // No kecamatan yet: the kelurahan field is disabled, so the kecamatan field carries that error (review 2026-11-05).
  for(const id of ['checkout-phone','checkout-query','checkout-address_line']){
   const control=f.page.locator(`#${id}`);await expect(control).toHaveAttribute('aria-invalid','true');
   assert.equal(await control.evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(139, 36, 29)',`${id}: red border`);
   assertInside(id,await boxes(f.page,id),'invalid');
   const described=await control.getAttribute('aria-describedby');assert.ok(described,`${id} is described`);
   const message=f.page.locator(`#${described.split(' ')[0]}`);await expect(message).toBeVisible();await expect(message).toHaveClass(/checkout-field-error/);
   const m=await message.boundingBox(),c=await control.boundingBox();assert.ok(m&&c&&m.y>=c.y+c.height-1,`${id}: the error sits below the field`);
   await expect(f.page.getByLabel(fields.find(x=>x.id===id)?.label??'Kelurahan / desa',{exact:true})).toHaveAttribute('id',id);
  }
  // While the region still carries the server's error, that error is its description (aria-describedby names only the error).
  if(javaScriptEnabled){
   await f.page.getByRole('combobox',{name:'Kecamatan tujuan',exact:true}).fill('Kecamatan Contoh A');await f.page.getByRole('option',{name:/Kecamatan Contoh A/}).click();
   await expect(f.page.locator('#checkout-destination_id')).toHaveAttribute('aria-describedby','checkout-destination-error');
   await expect(f.page.locator('#checkout-destination-selected')).toBeVisible();await expect(f.page.locator('#checkout-postal_code')).toHaveValue('00001');
   assert.equal(await raised(f.page,'checkout-postal_code'),true,'the derived postal code raises its label');
  }
  if(javaScriptEnabled)assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('at 320px with 200% text the floating labels stay inside their fields: nothing clips sideways',{timeout:90000},async()=>{
 const f=await start(320);try{
  await f.page.goto(`${origin}/checkout`);await f.page.addStyleTag({content:'html {font-size:200%}'});await note(f.page);
  for(const state of ['rest','filled']){
   if(state==='filled')for(const field of fields){const control=f.page.locator(`#${field.id}`);if(field.kind==='select')await control.selectOption(field.value);else await control.fill(field.value);}
   for(const field of fields){
    await f.page.locator(`#${field.id}`).scrollIntoViewIfNeeded();const label=labelOf(f.page,field.id);
    assert.ok(await label.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${field.id} ${state}: label is not clipped sideways`);
    const {label:lb,control:cb}=await boxes(f.page,field.id);
    assert.ok(lb.x>=cb.x-0.5&&lb.x+lb.width<=cb.x+cb.width+1,`${field.id} ${state}: label within the field ${JSON.stringify({lb,cb})}`);
    assert.ok(lb.x>=0&&lb.x+lb.width<=320,`${field.id} ${state}: label inside the viewport`);
   }
   await capture(f.page,`labels-${state}-text-200-320`);
  }
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('the order summary shows each line with a quantity badge and no "Isi:" line, holds the collapsed buyer note before the charges, and its title is 16/400',{timeout:90000},async()=>{
 const f=await start(1440);try{
  await f.page.goto(`${origin}/keranjang`);
  const cart=await f.page.locator('.cart-line .line-variant').first().evaluate(el=>getComputedStyle(el).fontSize);
  await f.page.goto(`${origin}/checkout`);
  const line=f.page.locator('.checkout-summary-line').first();await expect(line).toBeVisible();
  await expect(line.locator('.checkout-qty')).toHaveText(/^[1-9][0-9]*$/);await expect(line.locator('.checkout-qty')).toBeVisible();
  await expect(line.locator('.checkout-summary-contents')).toHaveCount(0);await expect(f.page.locator('.checkout-summary')).not.toContainText('Isi:');
  await expect(f.page.locator('.checkout-summary .checkout-contents')).toHaveCount(0);await expect(f.page.locator('.checkout-summary')).not.toContainText('Isi per pilihan');
  assert.ok(Number.parseFloat(await line.locator('.checkout-summary-text>span').evaluate(el=>getComputedStyle(el).fontSize))>=Number.parseFloat(cart),'the summary variant line is at least the cart caption size');
  // Buyer note: collapsed by default, after the product lines and before the charges, and still part of the checkout form.
  const noteBox=f.page.locator('.checkout-summary .checkout-note');await expect(noteBox).not.toHaveAttribute('open',/.*/);await expect(noteBox.locator('summary')).toHaveText('Tambah catatan pengiriman');
  assert.ok(await noteBox.evaluate(el=>{const lines=document.querySelector('.checkout-summary-lines'),charges=document.querySelector('.checkout-summary .checkout-charges');return Boolean(lines&&charges&&lines.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING&&el.compareDocumentPosition(charges)&Node.DOCUMENT_POSITION_FOLLOWING);}),'the note sits between the lines and the charges');
  await expect(f.page.locator('#checkout-buyer_note')).toHaveAttribute('form','checkout-form');
  await noteBox.locator('summary').click();await expect(f.page.locator('#checkout-buyer_note')).toBeVisible();
  const title=f.page.locator('.summary-desktop-title');await expect(title).toBeVisible();
  assert.deepEqual(await title.evaluate(el=>{const s=getComputedStyle(el);return {size:s.fontSize,leading:s.lineHeight,weight:s.fontWeight};}),{size:'16px',leading:'22px',weight:'400'});
  await capture(f.page,'summary-1440');
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});
