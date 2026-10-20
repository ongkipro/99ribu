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
import {grantedChoices,deniedChoices} from './advertising-fixture.ts';

test('built Chromium split COD retains private narrow order scope and two real host collections after reload without duplicate Purchase or settlement',async()=>{
 const identity=createLocalAuth('local'),owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 const seeded=await seedCommerce(owner.browser.request('/api/v1/admin/products'),identity,'local',`cod-${randomUUID().slice(0,8)}`),buyer=await actor(identity,'buyer',[]),samples:Exchange[]=[];
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{
  const context=await browser.newContext(),page=await context.newPage(),foreign=await browser.newContext(),stranger=await foreign.newPage();assert.equal((await page.goto('http://127.0.0.1:3099'))?.status(),200);await stranger.goto('http://127.0.0.1:3099');
  const call=async(target:typeof page,path:string,body?:unknown,version?:number,valid=true)=>{
   const method=body===undefined?'GET':'POST',headers={'content-type':'application/json',...(body===undefined?{}:{'idempotency-key':randomUUID()}),...(version?{'if-match':`"${version}"`}:{})};
   const result=await target.evaluate(async({path,body,method,headers})=>{const response=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,payload:await response.json(),headers:Object.fromEntries(response.headers)};},{path,body,method,headers});
   if(path.includes('/cod-collections'))samples.push({url:`http://127.0.0.1:3099${path}`,method,request_headers:headers,request_valid:valid,...result});return result;
  };
  const input={lines:[{variant_id:seeded.offers['fixture-offer-shirt'],quantity:4,expected_publication_id:seeded.publications['fixture-offer-shirt'].id}]};assert.equal((await call(page,'/api/v1/carts',input)).status,401);const cart=await call(page,'/api/v1/carts',input);assert.equal(cart.status,201);
  assert.equal((await call(page,'/api/v1/visitor-sessions',{client_request_id:randomUUID()})).status,201);assert.equal((await call(page,'/api/v1/consent/receipt',{expected_version:0,policy_version:'local-privacy-v1',choices:grantedChoices})).status,201);
  const quote=await call(page,'/api/v1/checkout/quotes',{cart_id:cart.payload.cart.id,address:{recipient_name:'SYNTHETIC COD Recipient',phone:'+6281200000000',address_line:'SYNTHETIC COD address',destination_id:'test-malang',postal_code:'00001'},contact:{phone:`+62812${String(Math.floor(Math.random()*1e8)).padStart(8,'0')}`},payment_method:'cod'},1);assert.equal(quote.status,201);
  const submitted=await call(page,'/api/v1/orders',{quote_id:quote.payload.id},1);assert.equal(submitted.status,201);const order=submitted.payload.order,path=`/api/v1/orders/${order.id}/cod-collections`;assert.equal(order.payment_status,'cod_due');assert.equal(order.version,2);
  const initial=await call(page,path);assert.equal(initial.status,200);assert.equal(initial.payload.collected_total,0);assert.equal(initial.payload.parcels.length,2);assert.equal(initial.payload.parcels.reduce((n:number,p:{amount_due:number})=>n+p.amount_due,0),order.buyer_total);
  assert.equal((await call(stranger,path)).status,401);assert.equal((await call(page,`${path}?collected=true`,undefined,undefined,false)).status,400);
  assert.equal((await call(page,`/api/v1/orders/${order.id}/payment-attempts`,{method_id:'local-prepaid'})).status,409);
  const host=(shipmentId:string)=>promisify(execFile)(process.execPath,['--env-file=.env.example','scripts/worker.ts','local','--collect-cod',shipmentId],{timeout:15000,maxBuffer:4096});
  await host(initial.payload.parcels[0].id);await page.reload();const partial=await call(page,path);assert.equal(partial.payload.version,3);assert.equal(partial.payload.collected_total,initial.payload.parcels[0].amount_due);assert.equal((await call(page,`/api/v1/orders/${order.id}`)).payload.payment_status,'partially_collected');
  await host(initial.payload.parcels[1].id);const complete=await call(page,path);assert.equal(complete.payload.version,4);assert.equal(complete.payload.collected_total,order.buyer_total);assert.equal(complete.payload.merchandise_collected,396000);assert.equal(complete.payload.confirmed_at,order.created_at);assert.equal((await call(page,`/api/v1/orders/${order.id}`)).payload.payment_status,'confirmed');
  await host(initial.payload.parcels[0].id);await page.reload();assert.equal((await call(page,path)).payload.version,4);
  const events=await identity.sql`select id,merchandise_amount from app.commerce_event where order_id=${order.id} and name='Purchase'`;assert.equal(events.length,2);assert.equal(events.reduce((n,e)=>n+Number(e.merchandise_amount),0),396000);assert.equal((await identity.sql`select count(*)::int n from app.ad_event_outbox where event_id in ${identity.sql(events.map(e=>e.id))} and status='queued'`)[0].n,6);
  assert.equal((await call(page,'/api/v1/consent/receipt',{expected_version:1,policy_version:'local-privacy-v1',choices:deniedChoices})).status,201);assert.equal((await identity.sql`select count(*)::int n from app.ad_event_outbox where event_id in ${identity.sql(events.map(e=>e.id))} and status='cancelled'`)[0].n,6);
  const cookie=(await context.cookies()).find(c=>c.name.endsWith('.order_access'));assert.ok(cookie?.httpOnly&&cookie.sameSite==='Lax'&&cookie.path===`/api/v1/orders/${order.id}`);assert.ok(!/visitor|commerce_guest|cart_access|order_access/.test(await page.evaluate(()=>document.cookie)));assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  assert.equal((await call(page,'/api/auth/sign-in/email',{email:buyer.email,password:buyer.password})).status,200);assert.equal((await call(page,path)).status,404);assert.equal((await call(page,'/api/auth/sign-out',{})).status,200);assert.equal((await call(page,path)).status,401);
  assert.equal((await identity.sql`select count(*)::int n from app.finance_posting p join app.finance_transaction j on j.id=p.transaction_id where j.order_id=${order.id} and p.account='company_cash'`)[0].n,0);validateExchanges(samples,'cod');
 }finally{await browser.close();await cleanup(identity,[owner,buyer]);await identity.sql.end();}
});
