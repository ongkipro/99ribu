import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {processDatabaseJob,runOneJob,type DatabaseJob} from '../../src/jobs/worker.ts';
import {capability,commerceActor,prefix} from '../../src/modules/checkout/access.ts';
import {createCart} from '../../src/modules/checkout/carts.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {allOrderIssuedCookies,orderReceiptPath,prepareOrderReceiptPayment,readOrderReceipt,receiptIssuedCookies,recoverOrderReceipt,type OrderReceipt} from '../../src/modules/orders/receipt.ts';
import {ingestCodEvent,simulateCodCollection} from '../../src/modules/payments/cod-local.ts';
import {ingestProviderEvent,simulateCollection} from '../../src/modules/payments/local.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {captureReceiptViewed} from '../../src/modules/storefront/checkout-signals.ts';
import {advertisingFixture,deniedChoices,grantedChoices} from './advertising-fixture.ts';
import {CommerceClient,ownShippingCampaign} from './checkout-fixture.ts';

function assertValidOrderReceiptSchema(samples:OrderReceipt[]){
 const script=`
import json, sys, yaml
from pathlib import Path
sys.path.insert(0, 'tests/contract')
from jsonschema import Draft202012Validator
from schema_formats import FORMATS
spec = yaml.safe_load(Path('docs/spec/openapi.yaml').read_text())
def remap(node):
    if isinstance(node, dict):
        return {k: (v.replace('#/components/schemas/', '#/$defs/') if k == '$ref' else remap(v)) for k, v in node.items()}
    if isinstance(node, list):
        return [remap(v) for v in node]
    return node
defs = remap(spec['components']['schemas'])
validator = Draft202012Validator({'$ref': '#/$defs/OrderReceipt', '$defs': defs}, format_checker=FORMATS)
items = json.load(sys.stdin)
for idx, item in enumerate(items):
    errors = list(validator.iter_errors(item))
    assert not errors, f"sample {idx} failed OrderReceipt schema: {errors[0].message} at {list(errors[0].path)}"
assert not validator.is_valid({'order': {}}), 'OrderReceipt schema canary'
print(json.dumps({'ok': True, 'count': len(items)}))
`;
 const res=spawnSync('python3',['-c',script],{input:JSON.stringify(samples),encoding:'utf8',timeout:15000});
 assert.equal(res.status,0,res.stderr||'OrderReceipt schema validation failed');
 assert.equal(JSON.parse(res.stdout).ok,true);
}

test('private order receipt projects canonical OrderReceipt schema, masks ship-to phone, enforces receipt_access scope isolation, and records receipt_viewed once without Purchase',async()=>{
 const f=await advertisingFixture();let campaign:Awaited<ReturnType<typeof ownShippingCampaign>>|undefined,otherGuest:CommerceClient|null=null;
 const schemaSamples:OrderReceipt[]=[];
 try{
  campaign=await ownShippingCampaign(f,['prepaid']);
  const input={lines:[f.line('fixture-offer-shirt',2)]},key=randomUUID();
  assert.equal((await f.client.call('/api/v1/carts',input,{key})).response.status,401);
  const req=f.client.request('/api/v1/carts',input,{key}),actor=await commerceActor(req,f.identity);assert.ok(actor?.kind==='guest');
  const created=await f.identity.sql.begin(tx=>createCart(tx,req,f.identity,actor,input,{clock_namespace:f.namespace}));
  const p=await prefix(f.identity),cartToken=await capability(f.identity,'cart',created.cart.id,actor.id,created.cart.cap_issued_at as string);
  f.client.cookies.set(`${p}.cart_access:/`,{name:`${p}.cart_access`,value:`${created.cart.id}.${cartToken}`,path:'/'});
  const quote=await f.client.call('/api/v1/checkout/quotes',{cart_id:created.cart.id,address:f.address,contact:f.contact(),payment_method:'prepaid'},{version:1});
  assert.equal(quote.response.status,201);assert.equal(quote.payload.subsidy_total,3000);
  const submitted=await f.client.call('/api/v1/orders',{quote_id:quote.payload.id},{version:1});
  assert.equal(submitted.response.status,201);
  const orderId=submitted.payload.order.id as string,uiPath=orderReceiptPath(orderId);
  assert.equal(uiPath,`/pesanan/${orderId}`);

  // API-scoped order_access cookie alone must not authorize the /orders/{orderId} BFF surface.
  assert.equal((await readOrderReceipt(f.client.request(uiPath),f.identity,orderId)).kind,'denied');

  // Recover order access and verify allOrderIssuedCookies + receiptIssuedCookies attributes.
  const recovered=await recoverOrderReceipt(f.client.request(uiPath,{}),f.identity,orderId);
  assert.equal(recovered.order.id,orderId);
  const allCookies=await allOrderIssuedCookies(f.identity,orderId,recovered.cookies);
  assert.equal(allCookies.length,3);
  const receiptCookies=await receiptIssuedCookies(f.identity,orderId,recovered.cookies);
  assert.equal(receiptCookies.length,2);
  const alias=receiptCookies[1];
  assert.equal(alias.name,`${p}.receipt_access`);
  assert.equal(alias.path,uiPath);
  assert.ok(alias.httpOnly&&alias.sameSite==='lax'&&alias.maxAge>0&&alias.maxAge<=604800);
  for(const entry of allCookies)f.client.cookies.set(`${entry.name}:${entry.path}`,{name:entry.name,value:entry.value,path:entry.path});

  // Read pending prepaid receipt and validate against OpenAPI OrderReceipt schema.
  const initialView=await readOrderReceipt(f.client.request(uiPath),f.identity,orderId);
  assert.equal(initialView.kind,'ready');assert.ok(initialView.receipt);
  assert.equal(initialView.receipt.order.id,orderId);
  assert.equal(initialView.receipt.payment_state,'pending');
  assert.equal(initialView.receipt.money_basis,'frozen_order_totals_and_verified_allocations');
  assert.ok(initialView.receipt.next_actions.some(a=>a.kind==='retry_supported_payment'&&a.enabled));
  assert.ok(initialView.receipt.next_actions.some(a=>a.kind==='open_support'&&a.enabled));
  assert.match(initialView.receipt.ship_to.phone_masked,/^\+62••••\d{4}$/);
  const serialized=JSON.stringify(initialView);
  assert.ok(!serialized.includes(f.contact().phone)&&!serialized.includes('081234567890')&&!serialized.includes(alias.value),'No raw phone or capability token in receipt view');
  schemaSamples.push(initialView.receipt);

  // Duplicate or conflicting cookies and forbidden auth headers are denied.
  const baseReq=f.client.request(uiPath);
  for(const suffix of [`${alias.name}=${alias.value}`,`${p}.order_access=conflicting`]){
   const dupReq=new Request(baseReq);dupReq.headers.set('cookie',`${baseReq.headers.get('cookie')}; ${suffix}`);
   assert.equal((await readOrderReceipt(dupReq,f.identity,orderId)).kind,'denied');
  }
  for(const headerName of ['authorization','x-order-token','x-cart-token']){
   const badHeader=await prepareOrderReceiptPayment(f.client.request(uiPath,{},{headers:{[headerName]:'forged'}}),f.identity,{order:orderId,key:randomUUID()});
   assert.equal(badHeader.code,'UNSUPPORTED_AUTH_TRANSPORT');assert.equal(badHeader.blocked,true);
  }
  otherGuest=new CommerceClient(f.identity);
  assert.equal((await otherGuest.call('/api/v1/carts',{lines:[]})).response.status,401);
  otherGuest.cookies.set(`${alias.name}:${alias.path}`,{name:alias.name,value:alias.value,path:alias.path});
  assert.equal((await readOrderReceipt(otherGuest.request(uiPath),f.identity,orderId)).kind,'denied','receipt_access bound to another guest session is denied');

  // Verify receipt_viewed milestone signal and no-Purchase invariant.
  assert.equal((await captureReceiptViewed(f.client.request(uiPath),f.identity,orderId)).status,'method_not_allowed');
  assert.equal((await captureReceiptViewed(f.client.request(uiPath,{}),f.identity,orderId)).status,'visitor_not_ready');
  await f.consent(f.client,deniedChoices);
  assert.equal((await captureReceiptViewed(f.client.request(uiPath,{}),f.identity,orderId)).status,'consent_not_granted');
  await f.consent(f.client,grantedChoices,1);
  const firstSignal=await captureReceiptViewed(f.client.request(uiPath,{}),f.identity,orderId);
  assert.equal(firstSignal.status,'recorded');
  const duplicateSignal=await captureReceiptViewed(f.client.request(uiPath,{}),f.identity,orderId);
  assert.equal(duplicateSignal.status,'duplicate');
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${orderId} and name='receipt_viewed'`)[0].n,1);
  assert.equal((await f.identity.sql`select count(*)::int n from app.commerce_event where order_id=${orderId} and name='Purchase'`)[0].n,0,'Receipt view never emits Purchase');
  await f.consent(f.client,deniedChoices,2);
  assert.equal((await captureReceiptViewed(f.client.request(uiPath,{}),f.identity,orderId)).status,'consent_not_granted');

  // Prepare payment attempt from receipt surface, test unknown and failed states.
  const payKey=randomUUID();
  const prepared=await prepareOrderReceiptPayment(f.client.request(uiPath,{}),f.identity,{order:orderId,key:payKey});
  assert.equal(prepared.phase,'success');
  const [attempt]=await f.identity.sql`select id,creation_job_id from app.payment_attempt where order_id=${orderId}`;assert.ok(attempt);
  assert.equal(await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test',new Map([[attempt.id,'creation-commit-lost-ack']]))},attempt.creation_job_id),true);
  const unknownView=await readOrderReceipt(f.client.request(uiPath),f.identity,orderId);
  assert.equal(unknownView.kind,'ready');assert.ok(unknownView.receipt);assert.equal(unknownView.receipt.payment_state,'unknown');
  assert.ok(unknownView.receipt.next_actions.some(a=>a.kind==='check_original_payment'&&a.enabled));
  assert.ok(!unknownView.receipt.next_actions.some(a=>a.kind==='retry_supported_payment'));
  schemaSamples.push(unknownView.receipt);

  await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${attempt.creation_job_id} and status='unknown'`;
  assert.equal(await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},attempt.creation_job_id),true);
  const failedEvent=await simulateCollection(f.identity.sql,'test',attempt.id,{status:'failed'});
  assert.equal(await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,failedEvent)),true);
  const failedView=await readOrderReceipt(f.client.request(uiPath),f.identity,orderId);
  assert.equal(failedView.kind,'ready');assert.ok(failedView.receipt);assert.equal(failedView.receipt.payment_state,'failed');
  assert.ok(failedView.receipt.next_actions.some(a=>a.kind==='retry_supported_payment'&&a.enabled));
  schemaSamples.push(failedView.receipt);

  assertValidOrderReceiptSchema(schemaSamples);
 }finally{
  if(otherGuest)await otherGuest.auth('/sign-out',{});
  if(campaign)await campaign.close();
  await f.close();
 }
});

test('paid prepaid and confirmed split-COD orders survive all three concurrent checkout expiry jobs past quote and order deadlines and retain complete OrderReceipt projections',async()=>{
 const f=await advertisingFixture();let campaign:Awaited<ReturnType<typeof ownShippingCampaign>>|undefined;
 const clients:CommerceClient[]=[],schemaSamples:OrderReceipt[]=[];
 try{
  campaign=await ownShippingCampaign(f,['prepaid','cod']);
  const p=await prefix(f.identity);

  const placeOrder=async(payment_method:'prepaid'|'cod',quantity:number)=>{
   const client=new CommerceClient(f.identity);clients.push(client);
   const input={lines:[f.line('fixture-offer-shirt',quantity)]},key=randomUUID();
   assert.equal((await client.call('/api/v1/carts',input,{key})).response.status,401);
   const req=client.request('/api/v1/carts',input,{key}),actor=await commerceActor(req,f.identity);assert.ok(actor?.kind==='guest');
   const created=await f.identity.sql.begin(tx=>createCart(tx,req,f.identity,actor,input,{clock_namespace:f.namespace}));
   const cartToken=await capability(f.identity,'cart',created.cart.id,actor.id,created.cart.cap_issued_at as string);
   client.cookies.set(`${p}.cart_access:/`,{name:`${p}.cart_access`,value:`${created.cart.id}.${cartToken}`,path:'/'});
   const quote=await client.call('/api/v1/checkout/quotes',{cart_id:created.cart.id,address:f.address,contact:f.contact(),payment_method},{version:1});
   assert.equal(quote.response.status,201);
   const submitted=await client.call('/api/v1/orders',{quote_id:quote.payload.id},{version:1});
   assert.equal(submitted.response.status,201);
   const orderId=submitted.payload.order.id as string,uiPath=orderReceiptPath(orderId);
   const recovered=await recoverOrderReceipt(client.request(uiPath,{}),f.identity,orderId);
   for(const entry of await allOrderIssuedCookies(f.identity,orderId,recovered.cookies))client.cookies.set(`${entry.name}:${entry.path}`,{name:entry.name,value:entry.value,path:entry.path});
   return {client,orderId,uiPath,order:submitted.payload.order};
  };

  // 1. Place prepaid order and confirm payment before expiry.
  const prepaid=await placeOrder('prepaid',1);
  const prepared=await prepareOrderReceiptPayment(prepaid.client.request(prepaid.uiPath,{}),f.identity,{order:prepaid.orderId,key:randomUUID()});
  assert.equal(prepared.phase,'success');
  const [attempt]=await f.identity.sql`select id,creation_job_id from app.payment_attempt where order_id=${prepaid.orderId}`;assert.ok(attempt);
  assert.equal(await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test')},attempt.creation_job_id),true);
  const paidEvent=await simulateCollection(f.identity.sql,'test',attempt.id);
  assert.equal(await runOneJob(f.identity.sql,{},await ingestProviderEvent(f.identity.sql,paidEvent)),true);

  // 2. Place two-origin split-COD order (4 units -> 2 shipments).
  const cod=await placeOrder('cod',4);
  assert.equal(cod.order.shipments.length,2);

  // 3. Advance fixture clock 1860s (past 5m quote TTL and 30m order TTL) and execute all 3 expiry jobs for both orders.
  const clock=await readFixtureClock('test',f.namespace);
  await advanceFixtureClock('test',f.namespace,1860,clock.version);

  for(const target of [prepaid,cod]){
   const [row]=await f.identity.sql`select stock_reservation_id,promotion_reservation_id from app.commerce_order where id=${target.orderId}`;
   assert.ok(row.promotion_reservation_id);
   const jobs=await f.identity.sql<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where (kind='checkout.order.expire' and payload->>'orderId'=${target.orderId}) or (kind='inventory.reservation.expire' and payload->>'reservationId'=${row.stock_reservation_id}) or (kind='promotion.reservation.expire' and payload->>'reservationId'=${row.promotion_reservation_id}) order by kind`;
   assert.equal(jobs.length,3);
   await Promise.all(jobs.map(job=>f.identity.sql.begin(async tx=>{await tx`select id from app.outbox_job where id=${job.id} for update`;await processDatabaseJob(tx,job);})));
   const [holds]=await f.identity.sql`select o.status,o.payment_status,s.status stock_status,p.status promo_status from app.commerce_order o join app.stock_reservation s on s.id=o.stock_reservation_id join app.promotion_reservation p on p.id=o.promotion_reservation_id where o.id=${target.orderId}`;
   assert.equal(holds.stock_status,'active','Committed order stock reservation must survive expiry worker');
   assert.equal(holds.promo_status,'active','Committed order promotion reservation must survive expiry worker');
   assert.notEqual(holds.status,'cancelled');
  }

  // 4. Verify prepaid receipt after expiry retains confirmed state and immutable ship_to.
  const prepaidAfter=await readOrderReceipt(prepaid.client.request(prepaid.uiPath),f.identity,prepaid.orderId);
  assert.equal(prepaidAfter.kind,'ready');assert.ok(prepaidAfter.receipt);
  assert.equal(prepaidAfter.receipt.payment_state,'confirmed');
  assert.equal(prepaidAfter.receipt.collections_complete,true);
  assert.ok(prepaidAfter.receipt.next_actions.some(a=>a.kind==='track_parcel'));
  assert.equal(prepaidAfter.receipt.ship_to.city,'Malang');
  schemaSamples.push(prepaidAfter.receipt);

  // 5. Verify split-COD receipt across cod_due -> partially_collected -> confirmed.
  const codPending=await readOrderReceipt(cod.client.request(cod.uiPath),f.identity,cod.orderId);
  assert.equal(codPending.kind,'ready');assert.ok(codPending.receipt);
  assert.equal(codPending.receipt.order.payment_status,'cod_due');
  assert.equal(codPending.receipt.payment_state,'pending');
  assert.equal(codPending.receipt.collections_complete,true);
  assert.equal(codPending.receipt.collections.length,2);
  assert.ok(codPending.receipt.next_actions.some(a=>a.kind==='track_parcel'));
  schemaSamples.push(codPending.receipt);

  const [firstParcel,secondParcel]=codPending.receipt.order.shipments;
  const firstEvent=await simulateCodCollection(f.identity.sql,'test',firstParcel.id,{status:'collected'});
  assert.equal(await runOneJob(f.identity.sql,{},await ingestCodEvent(f.identity.sql,firstEvent)),true);

  const codPartial=await readOrderReceipt(cod.client.request(cod.uiPath),f.identity,cod.orderId);
  assert.equal(codPartial.kind,'ready');assert.ok(codPartial.receipt);
  assert.equal(codPartial.receipt.order.payment_status,'partially_collected');
  assert.equal(codPartial.receipt.payment_state,'pending');
  assert.equal(codPartial.receipt.collections_complete,true);
  assert.equal(codPartial.receipt.collections.filter(c=>c.status==='verified').length,1);
  schemaSamples.push(codPartial.receipt);

  const secondEvent=await simulateCodCollection(f.identity.sql,'test',secondParcel.id,{status:'collected'});
  assert.equal(await runOneJob(f.identity.sql,{},await ingestCodEvent(f.identity.sql,secondEvent)),true);

  const codConfirmed=await readOrderReceipt(cod.client.request(cod.uiPath),f.identity,cod.orderId);
  assert.equal(codConfirmed.kind,'ready');assert.ok(codConfirmed.receipt);
  assert.equal(codConfirmed.receipt.payment_state,'confirmed');
  assert.equal(codConfirmed.receipt.collections_complete,true);
  assert.equal(codConfirmed.receipt.collections.filter(c=>c.status==='verified').length,2);
  schemaSamples.push(codConfirmed.receipt);

  // Repeated receipt reads never generate additional Purchase events.
  const purchaseBefore=(await f.identity.sql`select count(*)::int n from app.commerce_event where order_id in (${prepaid.orderId},${cod.orderId}) and name='Purchase'`)[0].n;
  await readOrderReceipt(prepaid.client.request(prepaid.uiPath),f.identity,prepaid.orderId);
  await readOrderReceipt(cod.client.request(cod.uiPath),f.identity,cod.orderId);
  const purchaseAfter=(await f.identity.sql`select count(*)::int n from app.commerce_event where order_id in (${prepaid.orderId},${cod.orderId}) and name='Purchase'`)[0].n;
  assert.equal(purchaseAfter,purchaseBefore);

  assertValidOrderReceiptSchema(schemaSamples);
 }finally{
  for(const c of clients)try{await c.auth('/sign-out',{});}catch{}
  if(campaign)await campaign.close();
  await f.close();
 }
});
