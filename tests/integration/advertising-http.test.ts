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

test('built Chromium first-party signals retain HttpOnly purpose and narrow order scope; reload and duplicate payment never create another Purchase',async()=>{
 const identity=createLocalAuth('local'),owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 const seeded=await seedCommerce(owner.browser.request('/api/v1/admin/products'),identity,'local',`signal-${randomUUID().slice(0,8)}`),buyer=await actor(identity,'buyer',[]),samples:Exchange[]=[];
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{
  const context=await browser.newContext(),page=await context.newPage(),foreign=await browser.newContext(),stranger=await foreign.newPage();assert.equal((await page.goto('http://127.0.0.1:3099'))?.status(),200);await stranger.goto('http://127.0.0.1:3099');
  const call=async(target:typeof page,path:string,body?:unknown,key=randomUUID(),version?:number)=>{
   const method=body===undefined?'GET':'POST',headers={'content-type':'application/json',...(body===undefined?{}:{'idempotency-key':key}),...(version?{'if-match':`"${version}"`}:{})};
   const result=await target.evaluate(async({path,body,method,headers})=>{const response=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,payload:await response.json(),headers:Object.fromEntries(response.headers)};},{path,body,method,headers});
   if(['/api/v1/visitor-sessions','/api/v1/consent/receipt','/api/v1/funnel/events'].includes(path)||path.endsWith('/funnel/events'))samples.push({url:`http://127.0.0.1:3099${path}`,method,request_headers:headers,request_body:body===undefined?undefined:JSON.stringify(body),body_bytes:body===undefined?undefined:Buffer.byteLength(JSON.stringify(body)),request_valid:true,...result});return result;
  };
  const bootstrap={client_request_id:randomUUID()},key=randomUUID();assert.equal((await call(page,'/api/v1/visitor-sessions',bootstrap,key)).status,401);assert.equal((await call(page,'/api/v1/consent/receipt')).status,401);assert.equal((await call(page,'/api/v1/visitor-sessions',bootstrap,key)).status,201);
  const grantBody={expected_version:0,policy_version:'local-privacy-v1',choices:grantedChoices},grantKey=randomUUID(),grant=await call(page,'/api/v1/consent/receipt',grantBody,grantKey);assert.equal(grant.status,201);assert.equal((await call(page,'/api/v1/consent/receipt')).payload.id,grant.payload.id);assert.equal((await call(stranger,'/api/v1/consent/receipt')).status,401);assert.equal((await call(stranger,'/api/v1/consent/receipt',grantBody)).status,401);
  const observation={client_event_id:randomUUID(),name:'product_viewed',occurred_at:new Date().toISOString(),consent_receipt_id:grant.payload.id,product_id:seeded.products['fixture-offer-shirt']};assert.equal((await call(page,'/api/v1/funnel/events',observation,observation.client_event_id)).status,202);assert.equal((await call(stranger,'/api/v1/funnel/events',observation,observation.client_event_id)).status,401);
  assert.equal((await call(page,'/api/v1/carts',{lines:[]})).status,401);const cart=await call(page,'/api/v1/carts',{lines:[]});assert.equal(cart.status,201);
  const line={variant_id:seeded.offers['fixture-offer-shirt'],quantity:1,expected_publication_id:seeded.publications['fixture-offer-shirt'].id},lineKey=randomUUID(),linePath=`/api/v1/carts/${cart.payload.cart.id}/lines`,added=await call(page,linePath,line,lineKey,1);assert.equal(added.status,201);assert.equal((await call(page,linePath,line,lineKey,1)).payload.version,added.payload.version);
  const quote=await call(page,'/api/v1/checkout/quotes',{cart_id:cart.payload.cart.id,address:{recipient_name:'SYNTHETIC Signal Recipient',phone:'+6281200000000',address_line:'SYNTHETIC signal address',destination_id:'test-malang',postal_code:'00001'},contact:{phone:`+62812${String(Math.floor(Math.random()*1e8)).padStart(8,'0')}`},payment_method:'prepaid'},randomUUID(),added.payload.version);assert.equal(quote.status,201);
  const submitted=await call(page,'/api/v1/orders',{quote_id:quote.payload.id},randomUUID(),added.payload.version);assert.equal(submitted.status,201);const order=submitted.payload.order;
  const milestone={client_event_id:randomUUID(),name:'receipt_viewed',occurred_at:new Date().toISOString(),consent_receipt_id:grant.payload.id,order_id:order.id},path=`/api/v1/orders/${order.id}/funnel/events`;
  assert.equal((await call(page,'/api/v1/funnel/events',milestone,milestone.client_event_id)).status,401);assert.equal((await call(page,path,milestone,milestone.client_event_id)).status,202);assert.equal((await call(stranger,path,milestone,milestone.client_event_id)).status,401);
  const paymentPath=`/api/v1/orders/${order.id}/payment-attempts`,attempt=await call(page,paymentPath,{method_id:'local-prepaid'});assert.equal(attempt.status,201);
  await promisify(execFile)(process.execPath,['--env-file=.env.example','scripts/worker.ts','local','--confirm-payment',attempt.payload.id],{timeout:15000,maxBuffer:4096});await page.reload();assert.equal((await call(page,`${paymentPath}/${attempt.payload.id}`)).payload.status,'confirmed');
  assert.equal((await identity.sql`select count(*)::int n from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].n,1);const [purchase]=await identity.sql`select id,merchandise_amount from app.commerce_event where order_id=${order.id} and name='Purchase'`;assert.equal(Number(purchase.merchandise_amount),99000);assert.equal((await identity.sql`select count(*)::int n from app.ad_event_outbox where event_id=${purchase.id} and status='queued'`)[0].n,3);
  const visitor=(await context.cookies()).find(c=>c.name.endsWith('.visitor')),orderCookie=(await context.cookies()).find(c=>c.name.endsWith('.order_access'));assert.ok(visitor?.httpOnly&&visitor.sameSite==='Lax'&&visitor.path==='/');assert.equal(orderCookie?.path,`/api/v1/orders/${order.id}`);assert.ok(!/visitor|commerce_guest|cart_access|order_access/.test(await page.evaluate(()=>document.cookie)));assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  const withdrawn=await call(page,'/api/v1/consent/receipt',{expected_version:1,policy_version:'local-privacy-v1',choices:deniedChoices});assert.equal(withdrawn.status,201);assert.equal((await call(page,'/api/v1/consent/receipt',grantBody,grantKey)).payload.id,withdrawn.payload.id);assert.equal((await identity.sql`select count(*)::int n from app.ad_event_outbox where event_id=${purchase.id} and status='cancelled'`)[0].n,3);
  assert.equal((await call(page,'/api/auth/sign-in/email',{email:buyer.email,password:buyer.password})).status,200);assert.equal((await call(page,'/api/v1/consent/receipt')).status,401);assert.equal((await call(page,'/api/v1/visitor-sessions',{client_request_id:randomUUID()})).status,201);assert.equal((await call(page,'/api/v1/consent/receipt')).status,404);assert.equal((await call(page,path,milestone,milestone.client_event_id)).status,404);
  assert.equal((await call(page,'/api/auth/sign-out',{})).status,200);assert.equal((await call(page,'/api/v1/consent/receipt')).status,401);
  validateExchanges(samples,'advertising');
 }finally{await browser.close();await cleanup(identity,[owner,buyer]);await identity.sql.end();}
});
