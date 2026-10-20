import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import {chromium} from '@playwright/test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';

test('built browser payment attempts use current private order cookies and recover verified payment after reload',async()=>{
 const identity=createLocalAuth('local'),owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 const seeded=await seedCommerce(owner.browser.request('/api/v1/admin/products'),identity,'local',`payment-${randomUUID().slice(0,8)}`),buyer=await actor(identity,'buyer',[]);
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}),samples:Exchange[]=[];
 try{
  const context=await browser.newContext(),page=await context.newPage(),other=await browser.newContext(),stranger=await other.newPage();
  assert.equal((await page.goto('http://127.0.0.1:3099'))?.status(),200);await stranger.goto('http://127.0.0.1:3099');
  const call=async(target:typeof page,path:string,body?:unknown)=>{
   const method=body===undefined?'GET':'POST',headers={'content-type':'application/json',...(body===undefined?{}:{'idempotency-key':randomUUID()})};
   const result=await target.evaluate(async({path,body,method,headers})=>{const response=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,payload:await response.json(),headers:Object.fromEntries(response.headers)};},{path,body,method,headers});
   if(path.includes('/payment-attempts')) samples.push({url:`http://127.0.0.1:3099${path}`,method,request_headers:headers,request_body:body===undefined?undefined:JSON.stringify(body),body_bytes:body===undefined?undefined:Buffer.byteLength(JSON.stringify(body)),request_valid:true,...result});
   return result;
  };
  assert.equal((await call(page,'/api/v1/carts',{lines:[]})).status,401);const created=await call(page,'/api/v1/carts',{lines:[]});assert.equal(created.status,201);const cart=created.payload.cart;
  const line={variant_id:seeded.offers['fixture-offer-shirt'],quantity:1,expected_publication_id:seeded.publications['fixture-offer-shirt'].id};
  const added=await page.evaluate(async({cartId,line,key})=>{const response=await fetch(`/api/v1/carts/${cartId}/lines`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,'if-match':'"1"'},body:JSON.stringify(line)});return {status:response.status,payload:await response.json()};},{cartId:cart.id,line,key:randomUUID()});assert.equal(added.status,201);
  const quote=await page.evaluate(async({cartId,version,key})=>{const response=await fetch('/api/v1/checkout/quotes',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,'if-match':`"${version}"`},body:JSON.stringify({cart_id:cartId,address:{recipient_name:'SYNTHETIC Payment Recipient',phone:'+6281200000000',address_line:'SYNTHETIC payment address',destination_id:'test-malang',postal_code:'00001'},contact:{phone:`+62812${String(Math.floor(Math.random()*1e8)).padStart(8,'0')}`},payment_method:'prepaid'})});return {status:response.status,payload:await response.json()};},{cartId:cart.id,version:added.payload.version,key:randomUUID()});assert.equal(quote.status,201);
  const submitted=await page.evaluate(async({quoteId,version,key})=>{const response=await fetch('/api/v1/orders',{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,'if-match':`"${version}"`},body:JSON.stringify({quote_id:quoteId})});return {status:response.status,payload:await response.json()};},{quoteId:quote.payload.id,version:added.payload.version,key:randomUUID()});assert.equal(submitted.status,201);
  const order=submitted.payload.order,path=`/api/v1/orders/${order.id}/payment-attempts`,attempt=await call(page,path,{method_id:'local-prepaid'});assert.equal(attempt.status,201);
  assert.equal((await call(stranger,path,{method_id:'local-prepaid'})).status,401);assert.equal((await call(stranger,`${path}/${attempt.payload.id}`)).status,401);
  await promisify(execFile)(process.execPath,['--env-file=.env.example','scripts/worker.ts','local','--confirm-payment',attempt.payload.id],{timeout:15000,maxBuffer:4096});
  await page.reload();assert.equal((await call(page,`${path}/${attempt.payload.id}`)).payload.status,'confirmed');
  const cookie=(await context.cookies()).find(c=>c.name.endsWith('order_access'));assert.ok(cookie?.httpOnly&&cookie.sameSite==='Lax'&&cookie.path===`/api/v1/orders/${order.id}`);
  assert.ok(!/commerce_guest|cart_access|order_access/.test(await page.evaluate(()=>document.cookie)));assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  assert.equal((await call(page,'/api/auth/sign-in/email',{email:buyer.email,password:buyer.password})).status,200);
  assert.equal((await call(page,`${path}/${attempt.payload.id}`)).status,404);assert.equal((await call(page,'/api/auth/sign-out',{})).status,200);assert.equal((await call(page,`${path}/${attempt.payload.id}`)).status,401);
  validateExchanges(samples,'payments');
 }finally{await browser.close();await cleanup(identity,[owner,buyer]);await identity.sql.end();}
});
