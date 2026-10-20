import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {chromium} from '@playwright/test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';

test('built browser checkout uses HttpOnly scoped cookies, reload recovery and all twelve API operations without JS credentials',async()=>{
 const identity=createLocalAuth('local'),owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);const namespace=`checkout-${randomUUID().slice(0,8)}`;
 const seeded=await seedCommerce(owner.browser.request('/api/v1/admin/products'),identity,'local',namespace);const buyer=await actor(identity,'buyer',[]);
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});const samples:Exchange[]=[];
 try{
  const context=await browser.newContext(),page=await context.newPage();assert.equal((await page.goto('http://127.0.0.1:3099'))?.status(),200);
  const other=await browser.newContext(),otherPage=await other.newPage();await otherPage.goto('http://127.0.0.1:3099');
  const call=async(target:typeof page,path:string,body?:unknown,options:{method?:string;key?:string;version?:number}={})=>{
   const method=options.method??(body!==undefined?'POST':'GET'),headers={'content-type':'application/json',...(body!==undefined||method==='DELETE'?{'idempotency-key':options.key??randomUUID()}:{}),...(options.version?{'if-match':`"${options.version}"`}:{})};
   const result=await target.evaluate(async({path,body,method,headers})=>{const response=await fetch(path,{method,headers,body:body!==undefined?JSON.stringify(body):undefined});return {status:response.status,payload:await response.json(),headers:Object.fromEntries(response.headers)};},{path,body,method,headers});
   if(path.startsWith('/api/v1/')){
    assert.ok(result.payload.cart_access_token===undefined&&result.payload.guest_order_access_token===undefined);
    samples.push({url:`http://127.0.0.1:3099${path}`,method,request_headers:headers,request_body:body!==undefined?JSON.stringify(body):undefined,body_bytes:body!==undefined?Buffer.byteLength(JSON.stringify(body)):undefined,...result});
   }return result;
  };
  const start=randomUUID();assert.equal((await call(page,'/api/v1/carts',{}, {key:start})).status,401);
  let created=await call(page,'/api/v1/carts',{}, {key:start});assert.equal(created.status,201);let cart=created.payload.cart;
  const line=(key:string)=>({variant_id:seeded.offers[key],quantity:1,expected_publication_id:seeded.publications[key].id});
  assert.equal((await call(page,`/api/v1/carts/${cart.id}`)).status,200);assert.equal((await call(page,'/api/v1/carts/current')).status,200);
  assert.equal((await call(otherPage,`/api/v1/carts/${cart.id}`)).status,401);assert.equal((await call(otherPage,'/api/v1/carts/current')).status,401);
  created=await call(page,`/api/v1/carts/${cart.id}/lines`,line('fixture-offer-shirt'),{version:cart.version});assert.equal(created.status,201);cart=created.payload;
  assert.equal((await call(otherPage,`/api/v1/carts/${cart.id}/lines`,line('fixture-offer-shirt'),{version:1})).status,401);const first=cart.lines[0].id;
  created=await call(page,`/api/v1/carts/${cart.id}/lines/${first}`,{quantity:2,expected_version:cart.version},{method:'PATCH'});assert.equal(created.status,200);cart=created.payload;
  assert.equal((await call(otherPage,`/api/v1/carts/${cart.id}/lines/${first}`,{quantity:1,expected_version:1},{method:'PATCH'})).status,401);
  created=await call(page,`/api/v1/carts/${cart.id}/lines`,line('fixture-offer-cream-pack'),{version:cart.version});assert.equal(created.status,201);cart=created.payload;const extra=cart.lines.find((l:{id:string})=>l.id!==first);
  created=await call(page,`/api/v1/carts/${cart.id}/lines/${extra.id}`,undefined,{method:'DELETE',version:cart.version});assert.equal(created.status,200);cart=created.payload;
  assert.equal((await call(otherPage,`/api/v1/carts/${cart.id}/lines/${first}`,undefined,{method:'DELETE',version:1})).status,401);
  await page.reload();assert.equal((await call(page,'/api/v1/carts/current')).payload.id,cart.id);
  const input={cart_id:cart.id,address:{recipient_name:'SYNTHETIC Browser Recipient',phone:'+6281200000000',address_line:'SYNTHETIC browser address',destination_id:'test-malang',postal_code:'00001'},contact:{phone:`+62812${String(Math.floor(Math.random()*1e8)).padStart(8,'0')}`},payment_method:'cod'};
  const q=await call(page,'/api/v1/checkout/quotes',input,{version:cart.version});assert.equal(q.status,201);
  assert.equal((await call(otherPage,'/api/v1/checkout/quotes',input,{version:cart.version})).status,401);
  assert.equal((await call(page,`/api/v1/checkout/quotes/${q.payload.id}`)).status,200);assert.equal((await call(otherPage,`/api/v1/checkout/quotes/${q.payload.id}`)).status,401);
  const selection={packages:q.payload.packages.map((p:{id:string;selected_option_id:string})=>({package_id:p.id,shipping_option_id:p.selected_option_id}))};
  const selected=await call(page,`/api/v1/checkout/quotes/${q.payload.id}/selection`,selection,{version:cart.version});assert.equal(selected.status,201);assert.equal(selected.payload.expires_at,q.payload.expires_at);
  assert.equal((await call(otherPage,`/api/v1/checkout/quotes/${q.payload.id}/selection`,selection,{version:cart.version})).status,401);
  const key=randomUUID(),body={quote_id:selected.payload.id};created=await call(page,'/api/v1/orders',body,{key,version:cart.version});assert.equal(created.status,201);
  assert.equal((await call(page,'/api/v1/orders',body,{key,version:cart.version})).payload.order.id,created.payload.order.id);
  assert.equal((await call(otherPage,'/api/v1/orders',body,{version:cart.version})).status,401);
  const orderPath=`/api/v1/orders/${created.payload.order.id}`;assert.equal((await call(page,orderPath)).status,200);assert.equal((await call(otherPage,orderPath)).status,401);
  assert.equal((await call(page,'/api/v1/destinations?q=synthetic')).status,200);assert.equal((await call(page,'/api/v1/destinations')).status,400);
  const metadata=(await context.cookies()).filter(c=>/commerce_guest|cart_access|order_access/.test(c.name)).map(c=>({name:c.name,path:c.path,httpOnly:c.httpOnly,sameSite:c.sameSite}));
  assert.equal(metadata.length,3);assert.ok(metadata.every(c=>c.httpOnly&&c.sameSite==='Lax'));assert.ok(metadata.some(c=>c.name.endsWith('order_access')&&c.path===orderPath));
  assert.ok(!/commerce_guest|cart_access|order_access/.test(await page.evaluate(()=>document.cookie)));assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  assert.equal((await call(page,'/api/auth/sign-in/email',{email:buyer.email,password:buyer.password})).status,200);
  assert.equal((await call(page,orderPath)).status,404);assert.equal((await call(page,'/api/auth/sign-out',{})).status,200);assert.equal((await call(page,orderPath)).status,401);
  validateExchanges(samples,'checkout');
 }finally{await browser.close();await cleanup(identity,[owner,buyer]);await identity.sql.end();}
});
