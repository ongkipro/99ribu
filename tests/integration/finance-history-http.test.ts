import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {chromium,type Page} from '@playwright/test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {actor,cleanup} from '../contract/access-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {totp} from './totp-fixture.ts';

test('built history APIs require browser MFA, whole-order permissions and current warehouse scope without client money writes',async()=>{
 const origin='http://127.0.0.1:3099',identity=createLocalAuth('local'),owner=await actor(identity,'owner',[]),samples:Exchange[]=[];
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{const context=await browser.newContext(),page=await context.newPage(),guestContext=await browser.newContext(),guest=await guestContext.newPage();
  assert.equal((await page.goto(origin))?.status(),200);await guest.goto(origin);
  const call=async(target:Page,path:string,body?:unknown,headers:Record<string,string>={})=>{
   const result=await target.evaluate(async({path,body,headers})=>{const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,headers:Object.fromEntries(response.headers),payload:await response.json()};},{path,body,headers});
   if(path.startsWith('/api/v1/admin/orders')) samples.push({url:origin+path,method:body===undefined?'GET':'POST',request_headers:{},...result});return result;
  };
  assert.equal((await call(page,'/api/v1/admin/orders')).status,401);assert.equal((await call(page,`/api/v1/admin/orders/${randomUUID()}`)).status,401);
  assert.equal((await call(page,'/api/auth/sign-in/email',{email:owner.email,password:owner.password})).status,200);
  assert.equal((await call(page,'/api/v1/admin/orders')).status,403);
  const setup=await call(page,'/api/auth/two-factor/enable',{password:owner.password});assert.equal(setup.status,200);
  assert.equal((await call(page,'/api/auth/two-factor/verify-totp',{code:totp(setup.payload.totpURI)})).status,200);
  for(const cookie of await context.cookies()) owner.browser.cookies.set(cookie.name,cookie.value);
  const seeded=await seedCommerce(owner.browser.request('/api/v1/admin/products'),identity,'local',`history-${randomUUID().slice(0,10)}`);
  const key=randomUUID(),input={lines:[{variant_id:seeded.offers['fixture-offer-shirt'],quantity:1,expected_publication_id:seeded.publications['fixture-offer-shirt'].id}]};
  assert.equal((await call(guest,'/api/v1/carts',input,{'idempotency-key':key})).status,401);
  const cart=await call(guest,'/api/v1/carts',input,{'idempotency-key':key});assert.equal(cart.status,201);
  const quote=await call(guest,'/api/v1/checkout/quotes',{cart_id:cart.payload.cart.id,address:{recipient_name:'SYNTHETIC History Buyer',phone:'+6281200000000',address_line:'SYNTHETIC test address',destination_id:'test-malang',postal_code:'00001'},contact:{phone:`+62812${String(Math.floor(Math.random()*1e8)).padStart(8,'0')}`},payment_method:'prepaid'},{'idempotency-key':randomUUID(),'if-match':'"1"'});assert.equal(quote.status,201);
  const submitted=await call(guest,'/api/v1/orders',{quote_id:quote.payload.id},{'idempotency-key':randomUUID(),'if-match':'"1"'});assert.equal(submitted.status,201);const order=submitted.payload.order,path=`/api/v1/admin/orders/${order.id}`;
  assert.equal((await call(guest,path)).status,401);assert.equal((await call(guest,'/api/v1/admin/orders')).status,401);
  const history=await call(page,`/api/v1/admin/orders?reference=${order.number}`);assert.equal(history.status,200);assert.equal(history.payload.data.length,1);
  const detail=await call(page,path);assert.equal(detail.status,200);assert.equal(detail.payload.order.id,order.id);assert.ok(detail.payload.history[0].recorded_at);
  for(const key of ['phone','address_line','recipient_name','unit_cost','source_id','reason']) assert.ok(!JSON.stringify(detail.payload).includes(`"${key}"`));
  await page.reload();assert.equal((await call(page,path)).status,200);
  assert.equal((await context.request.post(origin+path,{data:{payment_status:'confirmed',postings:[{amount:99000}]}})).status(),405);
  const [money]=await identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.id}`;assert.equal(money.n,0);assert.equal((await call(page,path)).payload.order.payment_status,'pending');
  await identity.sql`update app.role_grant set roles=ARRAY['finance']::text[],permissions=ARRAY[]::text[] where user_id=${owner.id}`;
  assert.equal((await call(page,path)).status,403);
  await identity.sql`update app.role_grant set permissions=ARRAY['orders.history.read']::text[] where user_id=${owner.id}`;
  assert.equal((await call(page,path)).status,404);
  await identity.sql`insert into app.warehouse_membership (user_id,warehouse_id) select ${owner.id},warehouse_id from app.order_shipment where order_id=${order.id} on conflict do nothing`;
  assert.equal((await call(page,path)).status,200);
  await identity.sql`update app.role_grant set roles=ARRAY['warehouse']::text[] where user_id=${owner.id}`;assert.equal((await call(page,path)).status,403);
  assert.equal((await call(page,'/api/auth/sign-out',{})).status,200);assert.equal((await call(page,path)).status,401);
  assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);validateExchanges(samples,'finance-history');
 }finally{await browser.close();await identity.sql`delete from app.auth_rate_limit where key=${`history-reference:${owner.id}`}`;await cleanup(identity,[owner]);await identity.sql.end();}
});
