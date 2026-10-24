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
test('built browser replacement and rate routes preserve original charges, first receipt anchors and current staff authority',{timeout:180000},async()=>{
 const origin='http://127.0.0.1:3099',identity=createLocalAuth('local'),owner=await actor(identity,'owner',[]),samples:Exchange[]=[],rates:Exchange[]=[];
 const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
 let affiliate:Awaited<ReturnType<typeof actor>>|undefined;
 const host=(mode:string,...args:string[])=>execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','local',mode,...args],{timeout:15000,stdio:'pipe'});
 const receive=(mode:string,body:Record<string,unknown>)=>execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','local',mode],{input:JSON.stringify(body),timeout:15000,stdio:'pipe'});
 try{
  const staffContext=await browser.newContext({viewport:{width:1280,height:900}}),buyerContext=await browser.newContext({viewport:{width:390,height:844}}),anonymousContext=await browser.newContext();
  const staff=await staffContext.newPage(),buyer=await buyerContext.newPage(),anonymous=await anonymousContext.newPage();let pageErrors=0,failedApiRequests=0;
  for(const page of [staff,buyer,anonymous]){page.on('pageerror',()=>pageErrors++);page.on('requestfailed',request=>{if(request.url().startsWith(`${origin}/api/`))failedApiRequests++;});await page.goto(origin);}
  const call=async(page:Page,path:string,body?:Record<string,unknown>,group?:'replacements'|'affiliate-rates',key=randomUUID(),valid=true)=>{
   const headers={'content-type':'application/json',...(body?{'idempotency-key':key}:{})};
   const result=await page.evaluate(async({path,body,headers})=>{const response=await fetch(path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});return {status:response.status,headers:Object.fromEntries(response.headers),payload:await response.json()};},{path,body,headers});
   if(group)(group==='replacements'?samples:rates).push({url:origin+path,method:body?'POST':'GET',request_headers:headers,...(body?{request_body:JSON.stringify(body),body_bytes:Buffer.byteLength(JSON.stringify(body))}:{}),request_valid:valid,...result});
   return result;
  };
  const expected=async(result:ReturnType<typeof call>,status:number)=>{const value=await result;assert.equal(value.status,status,`Safe built replacement/rate code ${value.payload.code??'none'}`);return value.payload;};
  await expected(call(staff,'/api/auth/sign-in/email',{email:owner.email,password:owner.password}),200);
  const setup=await expected(call(staff,'/api/auth/two-factor/enable',{password:owner.password}),200);await expected(call(staff,'/api/auth/two-factor/verify-totp',{code:totp(setup.totpURI)}),200);
  for(const cookie of await staffContext.cookies())owner.browser.cookies.set(cookie.name,cookie.value);
  assert.ok((await staffContext.cookies()).some(cookie=>cookie.name==='99ribu-local.session_token'&&cookie.httpOnly));
  const namespace=`replace-${randomUUID().slice(0,10)}`,seeded=await seedCommerce(owner.browser.request('/api/v1/admin/products'),identity,'local',namespace);await installFulfillmentCalendars(identity,owner,namespace);
  const cartBody={lines:[{variant_id:seeded.offers['fixture-offer-shirt'],quantity:2,expected_publication_id:seeded.publications['fixture-offer-shirt'].id}]};
  await expected(call(buyer,'/api/v1/carts',cartBody),401);const cart=await expected(call(buyer,'/api/v1/carts',cartBody),201);
  const placed=await buyer.evaluate(async({cartId,contact})=>{
   const headers={'content-type':'application/json','idempotency-key':crypto.randomUUID(),'if-match':'"1"'},quote=await fetch('/api/v1/checkout/quotes',{method:'POST',headers,body:JSON.stringify({cart_id:cartId,address:{recipient_name:'SYNTHETIC Replacement Buyer',phone:'+6281200000000',address_line:'SYNTHETIC replacement address',destination_id:'test-malang',postal_code:'00001'},contact:{phone:contact},payment_method:'cod'})});
   if(quote.status!==201)return {status:quote.status};const value=await quote.json(),response=await fetch('/api/v1/orders',{method:'POST',headers:{...headers,'idempotency-key':crypto.randomUUID()},body:JSON.stringify({quote_id:value.id})});return {status:response.status,payload:await response.json()};
  },{cartId:cart.cart.id,contact:`+62812${String(Math.floor(Math.random()*1e8)).padStart(8,'0')}`});assert.equal(placed.status,201);
  const orderId=placed.payload.order.id,orderRoot=`/api/v1/orders/${orderId}`;
  const parcels=await identity.sql`select f.*,s.warehouse_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${orderId}`;assert.equal(parcels.length,1);const parcel=parcels[0],fulfillment=`/api/v1/admin/fulfillments/${parcel.id}`;
  const prepared=await expected(call(staff,`${fulfillment}/preparations`,{expected_version:1}),201),booked=await expected(call(staff,'/api/v1/admin/shipments',{fulfillment_id:parcel.id,expected_version:prepared.version}),202);
  host('--issue-waybill',booked.operation_id);
  const issued=await expected(call(staff,fulfillment),200),packed=await expected(call(staff,`${fulfillment}/packing`,{expected_version:issued.version}),201);
  await expected(call(staff,`${fulfillment}/handover`,{expected_version:packed.version,shipment_id:parcel.shipment_id,handover_reference:'SYNTHETIC original carrier pickup'}),201);host('--collect-cod',parcel.shipment_id);
  const units=await identity.sql`select f.* from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${orderId} order by f.id`;assert.equal(units.length,2);
  receive('--receive-parcel',{reference:randomUUID(),booking_id:booked.operation_id,unit_ids:units.map(unit=>unit.id)});
  const originalOrder=await expected(call(buyer,orderRoot),200),originalPurchases=JSON.stringify(await identity.sql`select id,receipt_id,occurred_at,payload from app.commerce_event where order_id=${orderId} and name='Purchase' order by id`);
  const claimBody={items:units.map(unit=>({order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'defective',details:'SYNTHETIC built replacement original unit'})),requested_resolution:'replacement'};
  const claim=await expected(call(buyer,`${orderRoot}/returns`,claimBody),201),caseRoot=`/api/v1/admin/returns/${claim.id}`;
  await expected(call(staff,`${caseRoot}/decisions`,{decision:'approve_replacement',expected_version:1,requires_goods:false,reason:'SYNTHETIC explicit original fault waiver'}),201);
  const detail=await expected(call(staff,caseRoot),200),create={return_item_ids:detail.items.map((item:{id:string})=>item.id),warehouse_id:parcel.warehouse_id,expected_version:detail.version,reason:'SYNTHETIC built zero-charge replacement'},createRoot=`${caseRoot}/replacements`,dummy=randomUUID(),action={expected_version:1,reason:'SYNTHETIC denied replacement action'};
  const endpoints:[string,Record<string,unknown>|undefined][]=[[createRoot,create],[`/api/v1/admin/replacements/${dummy}`,undefined],...['reservations','preparations','bookings'].map(suffix=>[`/api/v1/admin/replacements/${dummy}/${suffix}`,action] as [string,Record<string,unknown>]),[`/api/v1/admin/replacements/${dummy}/handover`,{...action,handover_reference:'SYNTHETIC denied pickup'}]];
  for(const [path,body] of endpoints)await expected(call(anonymous,path,body,'replacements'),401);
  const createKey=randomUUID(),initial=await expected(call(staff,createRoot,create,'replacements',createKey),201);assert.equal(initial.status,'awaiting_stock');
  let head=initial;const root=`/api/v1/admin/replacements/${head.id}`;await expected(call(staff,root,undefined,'replacements'),200);
  const required=await identity.sql`select c.stock_item_id,sum(c.quantity)::int quantity from app.replacement_link l join app.fulfillment_item f on f.id=l.original_fulfillment_item_id join app.order_item i on i.id=f.order_item_id join app.offer_component c on c.product_id=i.product_id and c.revision=i.product_revision and c.offer_id=i.offer_id where l.shipment_id=${head.id} group by c.stock_item_id order by c.stock_item_id`;
  for(const component of required){const [position]=await identity.sql`select revision,on_hand-reserved-quarantined available from app.inventory_balance where warehouse_id=${parcel.warehouse_id} and stock_item_id=${component.stock_item_id} and lot_id is null`;assert.ok(position);
   const quantity=Math.max(0,Number(component.quantity)-Number(position.available));if(quantity)await expected(call(staff,'/api/v1/admin/inventory/movements',{warehouse_id:parcel.warehouse_id,stock_item_id:component.stock_item_id,kind:'receive',quantity,expected_version:position.revision,reason:'SYNTHETIC actual built replacement replenishment'}),201);
  }
  head=await expected(call(staff,`${root}/reservations`,{expected_version:head.version,reason:'SYNTHETIC recover this exact replacement after intake'},'replacements'),201);assert.equal(head.status,'ready');
  await expected(call(staff,`${root}/preparations`,{expected_version:1,reason:'SYNTHETIC stale built preparation'},'replacements'),409);
  head=await expected(call(staff,`${root}/preparations`,{expected_version:head.version,reason:'SYNTHETIC replacement picking'},'replacements'),201);
  head=await expected(call(staff,`${root}/bookings`,{expected_version:head.version,reason:'SYNTHETIC one physical replacement booking'},'replacements'),202);assert.equal(head.status,'booking_pending');
  await expected(call(staff,`${root}/handover`,{expected_version:head.version,reason:'SYNTHETIC no usable waybill',handover_reference:'SYNTHETIC too early'},'replacements'),409);
  host('--issue-replacement-waybill',head.booking_id);head=await expected(call(staff,root,undefined,'replacements'),200);assert.equal(head.status,'packed');
  head=await expected(call(staff,`${root}/handover`,{expected_version:head.version,reason:'SYNTHETIC actual replacement carrier pickup',handover_reference:'SYNTHETIC replacement pickup'},'replacements'),201);assert.equal(head.status,'handed_over');assert.equal(head.cod_due,0);assert.equal(head.buyer_shipping,0);
  const firstReference=randomUUID();receive('--receive-replacement',{reference:firstReference,booking_id:head.booking_id,unit_ids:[head.items[0].id]});
  const [first]=await identity.sql`select id,received_at from app.replacement_buyer_receipt where replacement_link_id=${head.items[0].id}`;
  assert.equal((await expected(call(staff,root,undefined,'replacements'),200)).status,'partially_delivered');
  receive('--receive-replacement',{reference:randomUUID(),booking_id:head.booking_id,unit_ids:[head.items[0].id]});
  assert.deepEqual((await identity.sql`select id,received_at from app.replacement_buyer_receipt where replacement_link_id=${head.items[0].id}`)[0],first);
  receive('--receive-replacement',{reference:randomUUID(),booking_id:head.booking_id,unit_ids:[head.items[1].id]});
  await buyer.reload();const deliveredOrder=await expected(call(buyer,orderRoot),200),replacement=deliveredOrder.shipments.find((row:{id:string})=>row.id===head.id);
  assert.equal(replacement.kind,'replacement');assert.equal(replacement.status,'delivered');assert.equal(replacement.received_quantity,2);assert.equal(replacement.buyer_shipping_amount,0);assert.equal(replacement.cod_collect_amount,0);
  for(const field of ['buyer_total','merchandise_total','version','payment_status','payment_method'])assert.equal(deliveredOrder[field],originalOrder[field]);
  assert.equal(JSON.stringify(await identity.sql`select id,receipt_id,occurred_at,payload from app.commerce_event where order_id=${orderId} and name='Purchase' order by id`),originalPurchases);
  assert.deepEqual(await expected(call(staff,createRoot,create,'replacements',createKey),201),initial);
  const history=await expected(call(staff,`/api/v1/admin/orders/${orderId}?history_limit=100`),200),[replacementEvent]=await identity.sql`select id,status from app.replacement_event where shipment_id=${head.id} order by revision desc limit 1`;
  assert.ok(history.history.some((row:{id:string;kind:string;status:string})=>row.id===replacementEvent.id&&row.kind==='fulfillment'&&row.status===replacementEvent.status));
  // Validate the changed buyer/staff projections against their full canonical
  // response schemas as well as checking individual replacement fields.
  execFileSync('python3',['-c',`
import json,sys
from pathlib import Path
import yaml
from jsonschema import Draft202012Validator
sys.path.insert(0,str(Path('tests/contract').resolve()))
from schema_formats import FORMATS
spec=json.loads(json.dumps(yaml.safe_load(Path('docs/spec/openapi.yaml').read_text())).replace('#/components/schemas/','#/$defs/'))
for path,payload in json.load(sys.stdin):
 schema=spec['paths'][path]['get']['responses']['200']['content']['application/json']['schema']
 validator=Draft202012Validator({**schema,'$defs':spec['components']['schemas']},format_checker=FORMATS)
 assert validator.is_valid(payload),path+': observed replacement response schema'
 assert not validator.is_valid({**payload,'unexpected_contract_field':True}),path+': closed response canary'
`],{input:JSON.stringify([['/orders/{orderId}',originalOrder],['/orders/{orderId}',deliveredOrder],['/admin/orders/{orderId}',history]]),stdio:'pipe'});
  affiliate=await actor(identity,'affiliate',[]);const [account]=await identity.sql`insert into app.affiliate_account (user_id) values (${affiliate.id}) returning id`,rateRoot=`/api/v1/admin/affiliates/${account.id}/rates`;
  const proof=await expected(call(staff,'/api/v1/me/reauthentication-proofs',{password:owner.password,action:'affiliate_rate.version',subject_id:account.id}),201),rate={basis_points:0,effective_at:null,expected_version:0,reason:'SYNTHETIC current built owner override',reauthentication_proof:proof.proof},rateKey=randomUUID();
  await expected(call(anonymous,rateRoot,rate,'affiliate-rates'),401);
  const savedRate=await expected(call(staff,rateRoot,rate,'affiliate-rates',rateKey),201);assert.equal(savedRate.affiliate_id,account.id);assert.equal(savedRate.basis_points,0);
  assert.deepEqual(await expected(call(staff,rateRoot,rate,'affiliate-rates',rateKey),201),savedRate);
  await expected(call(staff,rateRoot,{...rate,basis_points:100},'affiliate-rates',rateKey),409);
  assert.equal((await staffContext.request.post(origin+rateRoot,{headers:{origin:'https://foreign.invalid'},data:rate})).status(),403);
  assert.equal(await buyer.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.equal(pageErrors,0);assert.equal(failedApiRequests,0);
  validateExchanges(samples,'replacements');validateExchanges(rates,'affiliate-rates');
 }finally{await browser.close();try{if(affiliate)await closeFulfillmentActor(identity,affiliate);await closeFulfillmentActor(identity,owner);}finally{await identity.sql.end();}}
});
