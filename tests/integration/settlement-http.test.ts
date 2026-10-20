import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {chromium,type Page} from '@playwright/test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {actor} from '../contract/access-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {closeFulfillmentActor,installFulfillmentCalendars} from './fulfillment-fixture.ts';
import {totp} from './totp-fixture.ts';

test('built settlement routes preserve browser cookie/MFA authority, original bank identity, immutable matching history and Purchase count',async()=>{
 const origin='http://127.0.0.1:3099',identity=createLocalAuth('local'),owner=await actor(identity,'owner',[]),samples:Exchange[]=[];
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 const host=(mode:string,...args:string[])=>execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','local',mode,...args],{timeout:15000,stdio:'pipe'});
 try{
  const context=await browser.newContext(),page=await context.newPage(),buyerContext=await browser.newContext(),buyer=await buyerContext.newPage();await page.goto(origin);await buyer.goto(origin);
  const call=async(target:Page,path:string,body?:Record<string,unknown>,record=false,key=randomUUID())=>{
   const headers={'content-type':'application/json',...(body?{'idempotency-key':key}:{})};
   const result=await target.evaluate(async({path,body,headers})=>{const response=await fetch(path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:response.status,headers:Object.fromEntries(response.headers),payload:await response.json()};},{path,body,headers});
   if(record)samples.push({url:origin+path,method:body?'POST':'GET',request_headers:headers,...(body?{request_body:JSON.stringify(body),body_bytes:Buffer.byteLength(JSON.stringify(body))}:{}),request_valid:true,...result});return result;
  };
  assert.equal((await call(page,'/api/v1/admin/reconciliation')).status,401);
  assert.equal((await call(page,'/api/auth/sign-in/email',{email:owner.email,password:owner.password})).status,200);
  assert.equal((await call(page,'/api/v1/admin/reconciliation')).status,403);
  const setup=await call(page,'/api/auth/two-factor/enable',{password:owner.password});assert.equal(setup.status,200);
  assert.equal((await call(page,'/api/auth/two-factor/verify-totp',{code:totp(setup.payload.totpURI)})).status,200);
  for(const cookie of await context.cookies())owner.browser.cookies.set(cookie.name,cookie.value);
  assert.ok((await context.cookies()).some(cookie=>cookie.name==='99ribu-local.session_token'&&cookie.httpOnly));
  const namespace=`settle-${randomUUID().slice(0,10)}`,seeded=await seedCommerce(owner.browser.request('/api/v1/admin/products'),identity,'local',namespace);await installFulfillmentCalendars(identity,owner,namespace);
  const cartInput={lines:[{variant_id:seeded.offers['fixture-offer-shirt'],quantity:1,expected_publication_id:seeded.publications['fixture-offer-shirt'].id}]};
  assert.equal((await call(buyer,'/api/v1/carts',cartInput)).status,401);const cart=await call(buyer,'/api/v1/carts',cartInput);assert.equal(cart.status,201);
  const order=await buyer.evaluate(async({cartId,contact})=>{
   const headers={'content-type':'application/json','idempotency-key':crypto.randomUUID(),'if-match':'"1"'},quote=await fetch('/api/v1/checkout/quotes',{method:'POST',headers,body:JSON.stringify({cart_id:cartId,address:{recipient_name:'SYNTHETIC Settlement Buyer',phone:'+6281200000000',address_line:'SYNTHETIC address',destination_id:'test-malang',postal_code:'00001'},contact:{phone:contact},payment_method:'cod'})});
   if(quote.status!==201)return {status:quote.status};const value=await quote.json(),response=await fetch('/api/v1/orders',{method:'POST',headers:{...headers,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({quote_id:value.id})});return {status:response.status,payload:await response.json()};
  },{cartId:cart.payload.cart.id,contact:`+62812${String(Math.floor(Math.random()*1e8)).padStart(8,'0')}`});assert.equal(order.status,201);
  const [parcel]=await identity.sql`select id from app.order_shipment where order_id=${order.payload.order.id} order by id`;host('--collect-cod',parcel.id);
  const [receipt]=await identity.sql`select * from app.economic_receipt where shipment_id=${parcel.id}`,purchases=async()=>Number((await identity.sql`select count(*)::int n from app.commerce_event where order_id=${order.payload.order.id} and name='Purchase'`)[0].n),originalPurchases=await purchases();assert.ok(originalPurchases>0);
  const [orderClock]=await identity.sql`select clock_namespace from app.commerce_order where id=${order.payload.order.id}`;assert.equal(orderClock.clock_namespace,null,'Public checkout uses wall time even for seeded products');
  const sourceInput={provider:'local.cod',reference:randomUUID(),direction:'credit',net_amount:9,clock_namespace:orderClock.clock_namespace,statement:{gross_amount:11,carrier_fee:1,provider_fee:1,allocation_claims:null,reverses_reference:null}};
  execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','local','--observe-settlement'],{input:JSON.stringify(sourceInput),timeout:15000,stdio:'pipe'});
  const [head]=await identity.sql`select p.*,o.id source_id from app.provider_settlement p join app.local_settlement_operation o on o.id=p.operation_id where o.reference=${sourceInput.reference}`,root=`/api/v1/admin/reconciliation/${head.id}`,sourceRoot=`/api/v1/admin/settlements/${head.source_id}`;
  const input={action:'match',expected_version:head.revision,expected_match_id:null,source_reference:head.current_statement_id,reason:'SYNTHETIC browser original receipt verification',allocations:[{receivable_transaction_id:receipt.transaction_id,gross_amount:11}],reauthentication_proof:'SYNTHETIC-NOT-ISSUED'};
  const endpoints:[string,Record<string,unknown>|undefined][]=[['/api/v1/admin/reconciliation',undefined],[root,undefined],[sourceRoot,undefined],[`${root}/decisions`,input],[`${root}/matches/${randomUUID()}`,undefined]];
  for(const [path,body] of endpoints)assert.equal((await call(buyer,path,body,true)).status,401);
  assert.equal((await call(page,`/api/v1/admin/reconciliation?reference=${sourceInput.reference}`,undefined,true)).status,200);
  const initial=await call(page,root,undefined,true);assert.equal(initial.status,200);assert.equal(initial.payload.item.amount,9);assert.equal(initial.payload.match,null);assert.equal((await call(page,sourceRoot,undefined,true)).status,200);
  const proof=async()=>{const result=await call(page,'/api/v1/me/reauthentication-proofs',{password:owner.password,action:'finance.reconcile',subject_id:head.id});assert.equal(result.status,201);return result.payload.proof as string;};
  const key=randomUUID(),valid={...input,reauthentication_proof:await proof()},matched=await call(page,`${root}/decisions`,valid,true,key);assert.equal(matched.status,201,`Safe finance decision result: ${matched.payload.code??'success'}`);assert.equal(matched.payload.status,'matched');
  assert.deepEqual((await call(page,`${root}/decisions`,valid,true,key)).payload,matched.payload);
  const historic=await call(page,`${root}/matches/${matched.payload.current_match_id}`,undefined,true);assert.equal(historic.status,200);assert.equal(historic.payload.active,true);assert.equal(historic.payload.allocations[0].receipt_id,receipt.id);
  const unmatched=await call(page,`${root}/decisions`,{...valid,action:'unmatch',expected_version:matched.payload.version,expected_match_id:matched.payload.current_match_id,allocations:[],reauthentication_proof:await proof()},true);assert.equal(unmatched.status,201);assert.equal(unmatched.payload.status,'pending');assert.equal(unmatched.payload.cash_transaction_id,matched.payload.cash_transaction_id);assert.equal(unmatched.payload.fee_transaction_id,matched.payload.fee_transaction_id);
  const after=await call(page,`${root}/matches/${matched.payload.current_match_id}`,undefined,true);assert.equal(after.payload.active,false);assert.deepEqual(after.payload.allocations,historic.payload.allocations);
  host('--reconcile-settlement',head.source_id);assert.equal((await call(page,root)).payload.item.version,unmatched.payload.version);assert.equal(await purchases(),originalPurchases);
  await identity.sql`delete from app.role_grant where user_id=${owner.id}`;
  assert.equal((await call(page,root,undefined,true)).status,403);assert.equal((await call(page,`${root}/decisions`,valid,true,key)).status,403);
  validateExchanges(samples,'settlements');
 }finally{await browser.close();try{await closeFulfillmentActor(identity,owner);}finally{await identity.sql.end();}}
});
