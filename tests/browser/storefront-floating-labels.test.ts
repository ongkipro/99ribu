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

// S141 floating labels and the S143 checkout-summary polish (owner request 2026-10-25). One owned seeded cart per scenario;
// the labels are CSS only (:placeholder-shown with a blank placeholder, :autofill), so every case also runs without JavaScript where it can.
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

type Kind='input'|'select'|'textarea';
// Every text control the checkout contact step shows: its label (the accessible name), id, kind and a value to type.
const fields:{label:string;id:string;kind:Kind;value:string}[]=[
 {label:'Nama penerima',id:'checkout-recipient_name',kind:'input',value:'Penerima Contoh'},
 {label:'Nomor HP',id:'checkout-phone',kind:'input',value:'081200000000'},
 {label:'Email (opsional)',id:'checkout-email',kind:'input',value:'penerima@example.com'},
 {label:'Cari wilayah (opsional)',id:'checkout-query',kind:'input',value:'Malang'},
 {label:'Wilayah pengiriman',id:'checkout-destination_id',kind:'select',value:'test-malang'},
 {label:'Alamat lengkap',id:'checkout-address_line',kind:'textarea',value:'Jalan Contoh 12\nRT 01'},
 {label:'Catatan pengiriman (opsional)',id:'checkout-buyer_note',kind:'textarea',value:'Titip di penerima'},
];
const labelOf=(page:Page,id:string)=>page.locator(`label[for="${id}"]`);
const fontSize=(locator:Locator)=>locator.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
async function boxes(page:Page,id:string){
 const label=await labelOf(page,id).boundingBox(),control=await page.locator(`#${id}`).boundingBox();assert.ok(label&&control,`${id} is rendered`);return {label,control};
}
// The label sits inside its control's box (not above it) with at least 1px of the border to spare on each side.
function assertInside(id:string,{label,control}:Awaited<ReturnType<typeof boxes>>,state:string){
 assert.ok(label.x>=control.x-0.5&&label.x+label.width<=control.x+control.width+0.5,`${id} ${state}: label inside horizontally ${JSON.stringify({label,control})}`);
 assert.ok(label.y>=control.y-0.5&&label.y+label.height<=control.y+control.height+0.5,`${id} ${state}: label inside vertically ${JSON.stringify({label,control})}`);
}
async function capture(page:Page,name:string){
 await mkdir(output,{recursive:true});await page.evaluate(()=>document.fonts.ready);await expect(page.getByText('Menyimpan draf…',{exact:true})).not.toBeVisible();
 await page.mouse.move(0,0);await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert.ok(overflow<=0,`${name}: no horizontal overflow (${overflow}px)`);
}

for(const width of [390,768,1440])test(`checkout labels sit inside the fields, stay on focus and shrink once a value is typed at ${width}px`,{timeout:90000},async()=>{
 const f=await start(width);try{
  await f.page.goto(`${origin}/checkout`);
  for(const field of fields){
   const control=f.page.locator(`#${field.id}`),label=labelOf(f.page,field.id);
   // The native label stays the accessible name; the blank placeholder is not a name.
   await expect(f.page.getByLabel(field.label,{exact:true})).toHaveAttribute('id',field.id);
   if(field.kind!=='select')await expect(control).toHaveAttribute('placeholder',' ');
   await control.scrollIntoViewIfNeeded();
   assert.equal(await fontSize(label),16,`${field.id} rest: label is the 16px body size`);
   const rest=await boxes(f.page,field.id);assertInside(field.id,rest,'at rest');
   await control.focus();
   assert.equal(await fontSize(label),16,`${field.id} focus: label stays large`);
   const focused=await boxes(f.page,field.id);assertInside(field.id,focused,'focused');
   assert.ok(Math.abs(focused.label.y-rest.label.y)<=0.5&&Math.abs(focused.label.x-rest.label.x)<=0.5,`${field.id}: label does not move on focus`);
   if(field.kind==='select')await control.selectOption(field.value);else await control.fill(field.value);
   assert.equal(await fontSize(label),12,`${field.id} typed: label shrinks to 12px`);
   const typed=await boxes(f.page,field.id);assertInside(field.id,typed,'with a value');
   assert.ok(typed.label.y+typed.label.height<=typed.control.y+28,`${field.id}: shrunk label sits in the top strip of the field`);
   assert.ok(typed.label.height<rest.label.height,`${field.id}: label box got smaller (it moved to the top strip)`);
   if(field.kind==='select')await control.selectOption('');else await control.fill('');
   assert.equal(await fontSize(label),16,`${field.id} cleared: label is back at rest`);
   await expect(f.page.getByLabel(field.label,{exact:true})).toHaveAttribute('id',field.id);
  }
  await capture(f.page,`labels-rest-${width}`);
  for(const field of fields){const control=f.page.locator(`#${field.id}`);if(field.kind==='select')await control.selectOption(field.value);else await control.fill(field.value);}
  await capture(f.page,`labels-filled-${width}`);
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('a value set without an input event (autofill, script, restored form) shrinks the label and :autofill is styled',{timeout:60000},async()=>{
 const f=await start(390);try{
  await f.page.goto(`${origin}/checkout`);
  // Browser autofill and form restoration write the value without a typing event: only the CSS can react.
  await f.page.evaluate(()=>{for(const id of ['checkout-recipient_name','checkout-phone','checkout-address_line']){const el=document.getElementById(id) as HTMLInputElement|HTMLTextAreaElement;Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value')?.set?.call(el,'Contoh');}});
  for(const id of ['checkout-recipient_name','checkout-phone','checkout-address_line'])assert.equal(await fontSize(labelOf(f.page,id)),12,`${id}: label shrinks for a value written without an event`);
  assert.equal(await fontSize(labelOf(f.page,'checkout-email')),16,'an untouched field keeps its large label');
  // Real autofill cannot be driven from Playwright, so the declaration that handles it is read from the stylesheet.
  const rule=await f.page.evaluate(()=>{const found:{selector:string;fontSize:string}[]=[];const walk=(rules:CSSRuleList)=>{for(const rule of rules){if(rule instanceof CSSStyleRule&&/autofill/.test(rule.selectorText)&&rule.style.fontSize)found.push({selector:rule.selectorText,fontSize:rule.style.fontSize});else if('cssRules' in rule)walk((rule as CSSGroupingRule).cssRules);}};for(const sheet of document.styleSheets)try{walk(sheet.cssRules);}catch{}return found;});
  assert.ok(rule.some(r=>r.fontSize==='var(--caption-size)'&&/checkout-field/.test(r.selector)),`:autofill shrinks .checkout-field labels: ${JSON.stringify(rule)}`);
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

for(const javaScriptEnabled of [true,false])test(`server-prefilled values and server errors keep the label small, the error and the hint associated (JavaScript ${javaScriptEnabled?'on':'off'})`,{timeout:90000},async()=>{
 const f=await start(390,javaScriptEnabled);try{
  await f.page.goto(`${origin}/checkout`);
  // No error yet: the region select is described by its hint.
  await expect(f.page.locator('#checkout-destination_id')).toHaveAttribute('aria-describedby',/checkout-destination-hint/);await expect(f.page.locator('#checkout-destination-hint')).toBeVisible();
  await f.page.getByLabel('Nama penerima',{exact:true}).fill('Penerima Contoh');await f.page.getByLabel('Catatan pengiriman (opsional)',{exact:true}).fill('Titip di penerima');
  // Submit with the phone, region and address empty: the server answers with its validation errors and the draft values.
  await f.page.getByRole('button',{name:'Hitung ongkir',exact:true}).click();
  await expect(f.page.locator('.checkout-error')).toBeVisible();
  await expect(f.page.getByLabel('Nama penerima',{exact:true})).toHaveValue('Penerima Contoh');
  assert.equal(await fontSize(labelOf(f.page,'checkout-recipient_name')),12,'a prefilled value starts with the small label');
  assert.equal(await fontSize(labelOf(f.page,'checkout-buyer_note')),12,'a prefilled note starts with the small label');
  for(const id of ['checkout-phone','checkout-destination_id','checkout-address_line']){
   const control=f.page.locator(`#${id}`);await expect(control).toHaveAttribute('aria-invalid','true');
   assert.equal(await fontSize(labelOf(f.page,id)),16,`${id}: an empty invalid field keeps the large label`);assertInside(id,await boxes(f.page,id),'invalid');
   const described=await control.getAttribute('aria-describedby');assert.ok(described,`${id} is described`);
   const message=f.page.locator(`#${described.split(' ')[0]}`);await expect(message).toBeVisible();await expect(message).toHaveClass(/checkout-field-error/);
   const m=await message.boundingBox(),c=await control.boundingBox();assert.ok(m&&c&&m.y>=c.y+c.height-1,`${id}: the error sits below the field, not over the label`);
   await expect(f.page.getByLabel(fields.find(x=>x.id===id)?.label??'',{exact:true})).toHaveAttribute('id',id);
  }
  // While the region still carries the server's error, that error is its description (aria-describedby names only the error); the hint stays on screen.
  if(javaScriptEnabled){
   await f.page.getByLabel('Wilayah pengiriman',{exact:true}).selectOption('test-malang');
   await expect(f.page.locator('#checkout-destination_id')).toHaveAttribute('aria-describedby','checkout-destination-error');
   await expect(f.page.locator('#checkout-destination-hint')).toBeVisible();
   assert.equal(await fontSize(labelOf(f.page,'checkout-destination_id')),12,'a chosen region shrinks the label');
  }
  if(javaScriptEnabled)assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('at 320px with 200% text the labels fall back to plain labels above the fields: nothing clips or overlaps',{timeout:90000},async()=>{
 const f=await start(320);try{
  await f.page.goto(`${origin}/checkout`);await f.page.addStyleTag({content:'html {font-size:200%}'});
  for(const state of ['rest','filled']){
   if(state==='filled')for(const field of fields){const control=f.page.locator(`#${field.id}`);if(field.kind==='select')await control.selectOption(field.value);else await control.fill(field.value);}
   for(const field of fields){
    await f.page.locator(`#${field.id}`).scrollIntoViewIfNeeded();const label=labelOf(f.page,field.id);
    assert.ok(await label.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${field.id} ${state}: label is not clipped sideways`);
    const {label:lb,control:cb}=await boxes(f.page,field.id);
    assert.ok(lb.y+lb.height<=cb.y+1,`${field.id} ${state}: the narrow field shows its label above the control, not over the value ${JSON.stringify({lb,cb})}`);
    assert.ok(lb.x>=0&&lb.x+lb.width<=320,`${field.id} ${state}: label inside the viewport`);
   }
   await capture(f.page,`labels-${state}-text-200-320`);
  }
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});

test('the order summary lists contents with filled bullets like the cart, and its title is 16/400',{timeout:90000},async()=>{
 const f=await start(1440);try{
  await f.page.goto(`${origin}/keranjang`);
  const cart=await f.page.locator('.cart-contents').first().evaluate(el=>{const s=getComputedStyle(el);return {type:s.listStyleType,left:s.paddingLeft,size:s.fontSize};});
  await f.page.goto(`${origin}/checkout`);
  const summary=await f.page.locator('.checkout-summary-lines .checkout-contents').first().evaluate(el=>{const s=getComputedStyle(el);return {type:s.listStyleType,left:s.paddingLeft,size:s.fontSize};});
  assert.deepEqual(summary,cart,'checkout summary bullets match the cart list');assert.equal(summary.type,'disc');
  const title=f.page.locator('.summary-desktop-title');await expect(title).toBeVisible();
  assert.deepEqual(await title.evaluate(el=>{const s=getComputedStyle(el);return {size:s.fontSize,leading:s.lineHeight,weight:s.fontWeight};}),{size:'16px',leading:'22px',weight:'400'});
  await capture(f.page,'summary-1440');
  assert.deepEqual(f.errors,[]);
 }finally{await close(f);}
});
