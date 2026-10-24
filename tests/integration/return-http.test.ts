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

// Runs ~28-33 s alone against a production build, at the 30 s default; explicit budget.
test('built return routes keep original browser authority and confirm refunds only through a fresh signed host worker',{timeout:180000},async()=>{
 const origin='http://127.0.0.1:3099',identity=createLocalAuth('local'),owner=await actor(identity,'owner',[]),samples:Exchange[]=[];
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 const host=(mode:string,...args:string[])=>execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','local',mode,...args],{timeout:15000,stdio:'pipe'});
 try{
  const staffContext=await browser.newContext({viewport:{width:1280,height:900}}),buyerContext=await browser.newContext({viewport:{width:390,height:844}}),anonymousContext=await browser.newContext();
  const staff=await staffContext.newPage(),buyer=await buyerContext.newPage(),anonymous=await anonymousContext.newPage();let pageErrors=0,failedApiRequests=0;
  for(const page of [staff,buyer,anonymous]){page.on('pageerror',()=>pageErrors++);page.on('requestfailed',request=>{if(request.url().startsWith(`${origin}/api/`))failedApiRequests++;});await page.goto(origin);}
  const call=async(page:Page,path:string,body?:Record<string,unknown>,record=false,key=randomUUID())=>{
   const headers={'content-type':'application/json',...(body?{'idempotency-key':key}:{})};
   const result=await page.evaluate(async({path,body,headers})=>{const response=await fetch(path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:response.status,headers:Object.fromEntries(response.headers),payload:await response.json()};},{path,body,headers});
   if(record)samples.push({url:origin+path,method:body?'POST':'GET',request_headers:headers,...(body?{request_body:JSON.stringify(body),body_bytes:Buffer.byteLength(JSON.stringify(body))}:{}),request_valid:true,...result});
   return result;
  };
  const expected=async(result:ReturnType<typeof call>,status:number)=>{const value=await result;assert.equal(value.status,status,`Safe browser return code ${value.payload.code??'none'}`);return value.payload;};
  assert.equal((await call(staff,'/api/v1/admin/returns')).status,401);await expected(call(staff,'/api/auth/sign-in/email',{email:owner.email,password:owner.password}),200);
  assert.equal((await call(staff,'/api/v1/admin/returns')).status,403);
  const setup=await expected(call(staff,'/api/auth/two-factor/enable',{password:owner.password}),200);await expected(call(staff,'/api/auth/two-factor/verify-totp',{code:totp(setup.totpURI)}),200);
  for(const cookie of await staffContext.cookies())owner.browser.cookies.set(cookie.name,cookie.value);
  assert.ok((await staffContext.cookies()).some(cookie=>cookie.name==='99ribu-local.session_token'&&cookie.httpOnly));
  const namespace=`return-${randomUUID().slice(0,10)}`,seeded=await seedCommerce(owner.browser.request('/api/v1/admin/products'),identity,'local',namespace);await installFulfillmentCalendars(identity,owner,namespace);
  const cartBody={lines:[{variant_id:seeded.offers['fixture-offer-shirt'],quantity:1,expected_publication_id:seeded.publications['fixture-offer-shirt'].id}]};
  assert.equal((await call(buyer,'/api/v1/carts',cartBody)).status,401);const cart=await expected(call(buyer,'/api/v1/carts',cartBody),201);
  const placed=await buyer.evaluate(async({cartId,contact})=>{
   const headers={'content-type':'application/json','idempotency-key':crypto.randomUUID(),'if-match':'"1"'},quote=await fetch('/api/v1/checkout/quotes',{method:'POST',headers,body:JSON.stringify({cart_id:cartId,address:{recipient_name:'SYNTHETIC Return Buyer',phone:'+6281200000000',address_line:'SYNTHETIC address',destination_id:'test-malang',postal_code:'00001'},contact:{phone:contact},payment_method:'cod'})});
   if(quote.status!==201)return {status:quote.status};const value=await quote.json(),response=await fetch('/api/v1/orders',{method:'POST',headers:{...headers,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({quote_id:value.id})});return {status:response.status,payload:await response.json()};
  },{cartId:cart.cart.id,contact:`+62812${String(Math.floor(Math.random()*1e8)).padStart(8,'0')}`});assert.equal(placed.status,201);
  const orderId=placed.payload.order.id,root=`/api/v1/orders/${orderId}`,[parcel]=await identity.sql`select f.* from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${orderId}`;
  const fulfillment=`/api/v1/admin/fulfillments/${parcel.id}`,prepared=await expected(call(staff,`${fulfillment}/preparations`,{expected_version:1}),201),booked=await expected(call(staff,'/api/v1/admin/shipments',{fulfillment_id:parcel.id,expected_version:prepared.version}),202);
  host('--issue-waybill',booked.operation_id);
  const ready=await expected(call(staff,fulfillment),200),packed=await expected(call(staff,`${fulfillment}/packing`,{expected_version:ready.version}),201);
  await expected(call(staff,`${fulfillment}/handover`,{expected_version:packed.version,shipment_id:parcel.shipment_id,handover_reference:'SYNTHETIC browser original parcel handover'}),201);host('--collect-cod',parcel.shipment_id);
  const [unit]=await identity.sql`select f.* from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${orderId} order by f.id`,dummy=randomUUID();
  const claim={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'damaged',details:'SYNTHETIC browser original offer claim'}],requested_resolution:'refund'};
  const endpoints:[string,Record<string,unknown>|undefined][]=[
   [`${root}/returns`,claim],[`${root}/returns`,undefined],[`${root}/returns/${dummy}`,undefined],[`${root}/returns/eligibility`,undefined],[`${root}/refunds/${dummy}`,undefined],[`${root}/refunds/${dummy}/destinations`,{destination_source_id:dummy,expected_version:1}],
   ['/api/v1/admin/returns',undefined],[`/api/v1/admin/returns/${dummy}`,undefined],[`/api/v1/admin/returns/${dummy}/decisions`,{decision:'approve_refund',expected_version:1,reason:'SYNTHETIC denied'}],
   [`/api/v1/admin/returns/${dummy}/inspections`,{expected_version:1,result:'accepted',reason:'SYNTHETIC denied',items:[{return_item_id:dummy,goods:[]}]}],['/api/v1/admin/refunds',{return_case_id:dummy,expected_version:1,reason:'SYNTHETIC denied',reauthentication_proof:'SYNTHETIC-NOT-ISSUED'}],
   [`/api/v1/admin/refunds/${dummy}`,undefined],[`/api/v1/admin/refunds/${dummy}/reconciliations`,{action:'reconcile',expected_version:1,reason:'SYNTHETIC denied',reauthentication_proof:'SYNTHETIC-NOT-ISSUED'}]
  ];
  for(const [path,body] of endpoints)await expected(call(anonymous,path,body,true),401);
  assert.equal((await expected(call(buyer,`${root}/returns/eligibility`,undefined,true),200)).data[0].state,'not_received');
  const reference=randomUUID();execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','local','--receive-parcel'],{input:JSON.stringify({reference,booking_id:booked.operation_id,unit_ids:[unit.id]}),timeout:15000,stdio:'pipe'});
  const [receiptSource]=await identity.sql`select id from app.local_parcel_receipt where reference=${reference}`;host('--reconcile-parcel-receipt',receiptSource.id);
  const receivedOrder=await expected(call(buyer,root),200);assert.equal(receivedOrder.shipments[0].status,'delivered');assert.equal(receivedOrder.items[0].received_quantity,1);assert.equal(receivedOrder.items[0].returned_quantity,0);assert.equal(receivedOrder.refund_total,0);assert.equal(receivedOrder.pending_refund_total,0);
  const purchases=async()=>JSON.stringify(await identity.sql`select id,receipt_id,occurred_at,merchandise_amount,payload from app.commerce_event where order_id=${orderId} and name='Purchase' order by id`),originalPurchases=await purchases();
  const key=randomUUID(),created=await expected(call(buyer,`${root}/returns`,claim,true,key),201);assert.deepEqual(await expected(call(buyer,`${root}/returns`,claim,true,key),201),created);
  assert.equal((await expected(call(buyer,`${root}/returns`,undefined,true),200)).data[0].id,created.id);await expected(call(buyer,`${root}/returns/${created.id}`,undefined,true),200);
  const caseRoot=`/api/v1/admin/returns/${created.id}`;await expected(call(staff,'/api/v1/admin/returns',undefined,true),200);const detail=await expected(call(staff,caseRoot,undefined,true),200);
  await expected(call(staff,`${caseRoot}/decisions`,{decision:'approve_refund',expected_version:1,reason:'SYNTHETIC browser original fault'},true),201);
  const [component]=await identity.sql`select balance_id,quantity from app.fulfillment_component_allocation where fulfillment_item_id=${unit.id} order by balance_id limit 1`;
  await expected(call(staff,`${caseRoot}/inspections`,{expected_version:2,result:'accepted',reason:'SYNTHETIC actual returned original goods',items:[{return_item_id:detail.items[0].id,goods:[{expected_balance_id:component.balance_id,quantity:component.quantity,identity_confirmed:true}]}]},true),201);
  const proof=async(subjectId:string)=>{const body=await expected(call(staff,'/api/v1/me/reauthentication-proofs',{password:owner.password,action:'finance.refund',subject_id:subjectId}),201);return body.proof as string;};
  const refund=await expected(call(staff,'/api/v1/admin/refunds',{return_case_id:created.id,expected_version:3,reason:'SYNTHETIC original browser obligation',reauthentication_proof:await proof(created.id)},true),202),refundRoot=`/api/v1/admin/refunds/${refund.id}`;
  assert.equal(refund.status,'awaiting_destination');await expected(call(buyer,`${root}/refunds/${refund.id}`,undefined,true),200);await expected(call(staff,refundRoot,undefined,true),200);
  host('--verify-refund-destination',refund.id);const [destination]=await identity.sql`select id from app.local_refund_destination where refund_id=${refund.id}`;
  await expected(call(buyer,`${root}/refunds/${refund.id}/destinations`,{destination_source_id:destination.id,expected_version:refund.version},true),201);host('--fail-refund',refund.id);
  const failed=await expected(call(staff,refundRoot,undefined,true),200);assert.equal(failed.status,'failed');
  const failedOrder=await expected(call(buyer,root),200);assert.equal(failedOrder.refund_total,0);assert.equal(failedOrder.pending_refund_total,refund.amount);assert.equal(failedOrder.items[0].returned_quantity,1);assert.equal(failedOrder.items[0].refunded_quantity,0);assert.equal(failedOrder.items[0].return_pending_quantity,1);
  await expected(call(staff,`${refundRoot}/reconciliations`,{action:'retry',expected_version:failed.version,reason:'SYNTHETIC explicit browser retry after bank rejection',reauthentication_proof:await proof(refund.id)},true),202);host('--confirm-refund',refund.id);host('--reconcile-refund',refund.id);
  await buyer.reload();assert.equal((await expected(call(buyer,`${root}/refunds/${refund.id}`,undefined,true),200)).status,'succeeded');assert.equal(await purchases(),originalPurchases);
  assert.equal((await identity.sql`select count(*)::int n from app.finance_transaction where order_id=${orderId} and kind='refund_cash'`)[0].n,1);
  const finalOrder=await expected(call(buyer,root),200);assert.equal(finalOrder.refund_total,refund.amount);assert.equal(finalOrder.pending_refund_total,0);assert.equal(finalOrder.items[0].returned_quantity,1);assert.equal(finalOrder.items[0].refunded_quantity,1);assert.equal(finalOrder.items[0].return_pending_quantity,0);assert.equal(finalOrder.buyer_total,receivedOrder.buyer_total);assert.equal(finalOrder.version,receivedOrder.version);assert.equal(finalOrder.payment_status,receivedOrder.payment_status);
  const history=await expected(call(staff,`/api/v1/admin/orders/${orderId}?history_limit=100`),200);for(const kind of ['return','refund'])assert.ok(history.history.some((row:{kind:string})=>row.kind===kind));assert.ok(history.history.some((row:{status:string})=>row.status==='buyer_received'));
  assert.equal((await staffContext.request.post(`${origin}${caseRoot}/decisions`,{headers:{origin:'http://foreign.invalid'},data:{decision:'reject',expected_version:1,reason:'SYNTHETIC cross-origin denial'}})).status(),403);
  assert.equal(await buyer.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.equal(pageErrors,0);assert.equal(failedApiRequests,0);
  const operation=(method:string,address:string)=>`${method} ${new URL(address).pathname.split('/').map(part=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(part)?':id':part).join('/')}`;
  const expectedOperations=new Set(endpoints.map(([path,body])=>operation(body?'POST':'GET',origin+path)));
  assert.deepEqual(new Set(samples.filter(sample=>sample.status<400).map(sample=>operation(sample.method,sample.url))),expectedOperations);assert.deepEqual(new Set(samples.filter(sample=>sample.status>=400).map(sample=>operation(sample.method,sample.url))),expectedOperations);
  validateExchanges(samples,'returns');
 }finally{await browser.close();try{await closeFulfillmentActor(identity,owner);}finally{await identity.sql.end();}}
});
