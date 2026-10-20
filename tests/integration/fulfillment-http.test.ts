import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {chromium,type Page} from '@playwright/test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {actor} from '../contract/access-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {installFulfillmentCalendars,closeFulfillmentActor} from './fulfillment-fixture.ts';
import {totp} from './totp-fixture.ts';

test('built fulfillment routes preserve browser MFA/cookie scope and original shipment identity through a fresh host worker',async()=>{
 const origin='http://127.0.0.1:3099',identity=createLocalAuth('local'),owner=await actor(identity,'owner',[]),samples:Exchange[]=[];
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 try{
  const context=await browser.newContext(),page=await context.newPage(),buyerContext=await browser.newContext(),buyer=await buyerContext.newPage();await page.goto(origin);await buyer.goto(origin);
  const call=async(target:Page,path:string,body?:unknown,record=false)=>{
   const headers={'content-type':'application/json',...(body===undefined?{}:{'idempotency-key':randomUUID()})},result=await target.evaluate(async({path,body,headers})=>{const response=await fetch(path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,headers:Object.fromEntries(response.headers),payload:await response.json()};},{path,body,headers});
   if(record)samples.push({url:origin+path,method:body===undefined?'GET':'POST',request_headers:headers,...(body===undefined?{}:{request_body:JSON.stringify(body),body_bytes:Buffer.byteLength(JSON.stringify(body))}),request_valid:true,...result});return result;
  };
  assert.equal((await call(page,'/api/v1/admin/fulfillments')).status,401);assert.equal((await call(page,'/api/auth/sign-in/email',{email:owner.email,password:owner.password})).status,200);
  assert.equal((await call(page,'/api/v1/admin/fulfillments')).status,403);const setup=await call(page,'/api/auth/two-factor/enable',{password:owner.password});assert.equal(setup.status,200);
  assert.equal((await call(page,'/api/auth/two-factor/verify-totp',{code:totp(setup.payload.totpURI)})).status,200);
  for(const cookie of await context.cookies())owner.browser.cookies.set(cookie.name,cookie.value);
  const namespace=`fulfill-${randomUUID().slice(0,10)}`,seeded=await seedCommerce(owner.browser.request('/api/v1/admin/products'),identity,'local',namespace);await installFulfillmentCalendars(identity,owner,namespace);
  const cartInput={lines:[{variant_id:seeded.offers['fixture-offer-shirt'],quantity:1,expected_publication_id:seeded.publications['fixture-offer-shirt'].id}]};
  assert.equal((await call(buyer,'/api/v1/carts',cartInput)).status,401);const cart=await call(buyer,'/api/v1/carts',cartInput);assert.equal(cart.status,201);
  // The checkout version header is required independently of the staff actions.
  const order=await buyer.evaluate(async({cartId,contact})=>{
   const headers={'content-type':'application/json','idempotency-key':crypto.randomUUID(),'if-match':'"1"'},quote=await fetch('/api/v1/checkout/quotes',{method:'POST',headers,body:JSON.stringify({cart_id:cartId,address:{recipient_name:'SYNTHETIC Fulfillment Buyer',phone:'+6281200000000',address_line:'SYNTHETIC address',destination_id:'test-malang',postal_code:'00001'},contact:{phone:contact},payment_method:'cod'})});
   if(quote.status!==201)return {status:quote.status};const value=await quote.json(),response=await fetch('/api/v1/orders',{method:'POST',headers:{...headers,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({quote_id:value.id})});return {status:response.status,payload:await response.json()};
  },{cartId:cart.payload.cart.id,contact:`+62812${String(Math.floor(Math.random()*1e8)).padStart(8,'0')}`});assert.equal(order.status,201);
  const [parcel]=await identity.sql`select f.*,s.warehouse_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${order.payload.order.id}`,root=`/api/v1/admin/fulfillments/${parcel.id}`,shipment=`/api/v1/admin/shipments/${parcel.shipment_id}`;
  const endpoints:[string,unknown][]=[['/api/v1/admin/fulfillments',undefined],[root,undefined],[shipment,undefined],[`${root}/preparations`,{expected_version:1}],['/api/v1/admin/shipments',{fulfillment_id:parcel.id,expected_version:2}],[`${root}/packing`,{expected_version:4}],[`${root}/handover`,{expected_version:5,shipment_id:parcel.shipment_id,handover_reference:'SYNTHETIC handover'}],[`${root}/reschedules`,{expected_version:1,reason:'Private schedule reason',buyer_explanation:'Jadwal paket diperbarui.'}]];
  for(const [path,body] of endpoints)assert.equal((await call(buyer,path,body,true)).status,401);
  assert.equal((await call(page,`/api/v1/admin/fulfillments?warehouse_id=${parcel.warehouse_id}`,undefined,true)).status,200);assert.equal((await call(page,root,undefined,true)).status,200);assert.equal((await call(page,shipment,undefined,true)).status,200);
  const privateReason=`PRIVATE ${randomUUID()}`;let result=await call(page,`${root}/reschedules`,{expected_version:1,reason:privateReason,buyer_explanation:'Jadwal paket diperbarui.'},true);assert.equal(result.status,201);
  result=await call(page,`${root}/preparations`,{expected_version:2},true);assert.equal(result.status,201);assert.equal(result.payload.status,'picking');
  const booked=await call(page,'/api/v1/admin/shipments',{fulfillment_id:parcel.id,expected_version:3},true);assert.equal(booked.status,202);assert.equal(booked.payload.status_url,shipment);
  assert.equal((await call(page,shipment)).payload.status,'booking_pending');
  execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','local','--issue-waybill',booked.payload.operation_id],{timeout:15000,stdio:'pipe'});
  const issued=await call(page,shipment,undefined,true);assert.equal(issued.payload.status,'packed');assert.ok(issued.payload.tracking_number.startsWith('LOCAL-'));assert.ok(!issued.payload.delivered_at);
  result=await call(page,`${root}/packing`,{expected_version:5},true);assert.equal(result.status,201);
  result=await call(page,`${root}/handover`,{expected_version:6,shipment_id:parcel.shipment_id,handover_reference:'SYNTHETIC browser handover'},true);assert.equal(result.status,201);assert.equal(result.payload.status,'handed_over');assert.ok(!JSON.stringify(result.payload).includes(privateReason));
  await page.reload();assert.equal((await call(page,shipment,undefined,true)).payload.status,'handed_over');
  assert.equal((await identity.sql`select count(*)::int n from app.economic_receipt where order_id=${order.payload.order.id}`)[0].n,0);
  assert.equal((await context.request.post(`${origin}${root}/preparations`,{headers:{origin:'http://foreign.invalid'},data:{expected_version:7}})).status(),403);
  assert.equal((await context.request.put(origin+shipment,{data:{status:'delivered'}})).status(),405);
  assert.equal((await call(page,'/api/auth/sign-out',{})).status,200);assert.equal((await call(page,root,undefined,true)).status,401);assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);validateExchanges(samples,'fulfillment');
 }finally{await browser.close();try{await closeFulfillmentActor(identity,owner);}finally{await identity.sql.end();}}
});
