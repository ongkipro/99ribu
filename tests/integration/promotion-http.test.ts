import {resetBrowserAuthLimits} from './storefront-http-fixture.ts';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import test from 'node:test';
import {chromium} from '@playwright/test';
import {connectDatabase} from '../../src/db/client.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {totp} from './totp-fixture.ts';

test('built promotion API enforces browser MFA cookies, immutable configuration history and committed retry across all five operations',async()=>{
 await resetBrowserAuthLimits();
 const {sql}=connectDatabase('local');const email=`promotion-browser-${randomUUID()}@example.invalid`;const password=randomBytes(24).toString('base64url');let userId='';
 const samples:Exchange[]=[];const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{
  const context=await browser.newContext();const page=await context.newPage();assert.equal((await page.goto('http://127.0.0.1:3099'))?.status(),200);
  const authPaths=['/sign-up/email','/sign-in/email','/two-factor/enable','/two-factor/verify-totp'];await sql`delete from app.auth_rate_limit where key in ${sql(authPaths.map((p)=>`127.0.0.1|${p}`))}`;
  const call=async(path:string,body?:Record<string,unknown>,headers:Record<string,string>={})=>{
   const result=await page.evaluate(async({path,body,headers})=>{const response=await fetch(path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:response.status,payload:await response.json(),headers:Object.fromEntries(response.headers)};},{path,body,headers});
   if(path.includes('/shipping-promotions')) samples.push({url:`http://127.0.0.1:3099${path}`,method:body?'POST':'GET',request_headers:{'content-type':'application/json',...headers},request_body:body?JSON.stringify(body):undefined,body_bytes:body?Buffer.byteLength(JSON.stringify(body)):undefined,...result});return result;
  };
  const root='/api/v1/admin/shipping-promotions';const dummy=randomUUID();const key=()=>({'idempotency-key':randomUUID()});
  for(const path of ['',`/${dummy}`,`/${dummy}/versions`]) assert.equal((await call(root+path)).status,401);
  for(const path of ['',`/${dummy}/versions`]) assert.equal((await call(root+path,{},key())).status,401);
  assert.equal((await call('/api/auth/sign-up/email',{name:'Synthetic Promotion Browser Owner',email,password})).status,200);
  const [user]=await sql`select id from app.auth_user where email=${email}`;userId=user.id;
  const [message]=await sql`select url from app.local_delivery where recipient=${email} and kind='verification'`;assert.ok([200,302].includes((await context.request.get(message.url,{maxRedirects:0})).status()));
  await sql`insert into app.role_grant (user_id,roles) values (${userId},ARRAY['owner']::text[])`;
  assert.equal((await call('/api/auth/sign-in/email',{email,password})).status,200);assert.equal((await call(root)).status,403);
  const factor=await call('/api/auth/two-factor/enable',{password});assert.equal(factor.status,200);assert.equal((await call('/api/auth/two-factor/verify-totp',{code:totp(factor.payload.totpURI)})).status,200);
  const input={expected_version:0,name:'Synthetic browser shipping benefit',active:true,starts_at:new Date(Date.now()-60000).toISOString(),ends_at:new Date(Date.now()+3600000).toISOString(),kind:'percentage',value:5000,maximum_per_order:10000,minimum_merchandise:99000,budget:100000,per_buyer_limit:2,payment_methods:['prepaid','cod'],region_ids:['malang'],service_ids:['regular'],stacking:'exclusive',priority:10,reason:'Synthetic browser configuration'};
  const firstKey=key();const first=await call(root,input,firstKey);assert.equal(first.status,201);assert.deepEqual((await call(root,input,firstKey)).payload,first.payload);
  assert.equal((await call(root,{...input,budget:1},firstKey)).status,409);assert.equal((await call(root,{...input,value:10001},key())).status,400);
  assert.equal((await call(root)).status,200);assert.equal((await call(`${root}/${first.payload.id}`)).payload.version,1);
  const edit={...input,expected_version:1,value:2500,reason:'Synthetic revised percentage'};const editKey=key();const second=await call(`${root}/${first.payload.id}/versions`,edit,editKey);assert.equal(second.status,201);
  assert.deepEqual((await call(`${root}/${first.payload.id}/versions`,edit,editKey)).payload,second.payload);
  assert.equal((await call(`${root}/${first.payload.id}/versions`,edit,key())).status,409);
  const history=await call(`${root}/${first.payload.id}/versions?limit=1`);assert.equal(history.status,200);assert.equal(history.payload.pagination.next_cursor,'2');
  const old=await call(`${root}/${first.payload.id}/versions?cursor=2`);assert.equal(old.payload.data[0].value,5000);assert.equal(old.payload.data[0].version_id,first.payload.version_id);
  // Retire the campaign so later suites on this database never see a live synthetic window.
  assert.equal((await call(`${root}/${first.payload.id}/versions`,{...edit,expected_version:2,active:false,reason:'Synthetic browser campaign finished'},key())).status,201);
  assert.equal((await call(`${root}/${first.payload.id}?as_of=2030`)).status,400);assert.equal((await call(root,undefined,{'x-order-token':'synthetic-unsupported'})).status,401);
  assert.ok(!(await page.evaluate(()=>document.cookie)).includes('session_token'));
  assert.equal((await call('/api/auth/sign-out',{})).status,200);assert.equal((await call(root)).status,401);validateExchanges(samples,'promotions');
 }finally{
  await browser.close();await sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
  await sql`delete from app.local_delivery where recipient=${email}`;
  if(userId){await sql`delete from app.auth_verification where value=${userId}`;await sql`delete from app.access_operation where actor_id=${userId}`;await sql`delete from app.auth_user where id=${userId}`;}
  await sql.end();
 }
});
