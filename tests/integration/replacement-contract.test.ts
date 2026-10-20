import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {handleInventory} from '../../src/modules/inventory/routes.ts';
import {createReturn,decideReturn} from '../../src/modules/returns/cases.ts';
import {handleReplacements} from '../../src/modules/returns/replacement-routes.ts';
import {simulateParcelReceipt,ingestParcelReceiptSource} from '../../src/modules/returns/receipt-source.ts';
import {simulateReplacementReceipt,ingestReplacementReceiptSource} from '../../src/modules/returns/replacement-receipts.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {closeFulfillmentActor} from './fulfillment-fixture.ts';
import {returnFixture} from './return-fixture.ts';

test('current cookie adapters execute every replacement operation with owned stock, immutable retries and scoped denials',async()=>{
 const f=await returnFixture('cod'),sql=f.identity.sql,samples:Exchange[]=[];
 let outsider:Awaited<ReturnType<typeof actor>>|undefined;
 const command=(path:string,body?:Record<string,unknown>,key=randomUUID(),browser=f.owner.browser)=>{const request=browser.request(path,body);if(body)request.headers.set('idempotency-key',key);return request;};
 const observe=async(request:Request,valid=true)=>{
  const text=request.method==='GET'?undefined:await request.clone().text(),response=await handleReplacements(request,f.identity),payload=await response.json(),headers=Object.fromEntries(response.headers);
  for(const [name,value] of [['cache-control','no-store'],['referrer-policy','no-referrer'],['x-content-type-options','nosniff']])assert.equal(headers[name],value);
  samples.push({url:request.url,method:request.method,request_headers:Object.fromEntries(request.headers),...(text===undefined?{}:{request_body:text,body_bytes:Buffer.byteLength(text)}),request_valid:valid,status:response.status,headers,payload});
  return {status:response.status,payload};
 };
 const expected=async(result:ReturnType<typeof observe>,status:number)=>{const value=await result;assert.equal(value.status,status,`Safe replacement adapter code ${value.payload.code??'none'}`);return value.payload;};
 try{
  const units=f.units.filter(unit=>unit.shipment_id===f.units[0].shipment_id),parcel=f.parcels.find(row=>row.shipment_id===units[0].shipment_id),booking=f.bookings.find(row=>row.fulfillment_id===parcel?.id);assert.ok(parcel&&booking);assert.equal(units.length,2);
  await f.run(await ingestParcelReceiptSource(sql,await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:units.map(unit=>unit.id)})));
  const buyer=await commerceActor(f.client.request('/api/v1/carts'),f.identity);assert.ok(buyer);
  const claimBody={items:units.map(unit=>({order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'defective',details:'SYNTHETIC replacement adapter original units'})),requested_resolution:'replacement'};
  const claim=await createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,claimBody),f.identity,buyer,f.order.id,claimBody) as {id:string};
  const decision={decision:'approve_replacement',expected_version:1,requires_goods:false,reason:'SYNTHETIC actual approved company-fault replacement waiver'};
  await decideReturn(command(`/api/v1/admin/returns/${claim.id}/decisions`,decision),f.identity,f.principal,claim.id,decision);
  const selected=await sql`select id from app.return_item where case_id=${claim.id} order by id`,create={return_item_ids:selected.map(row=>row.id),warehouse_id:parcel.warehouse_id,expected_version:2,reason:'SYNTHETIC current replacement adapter intent'},createRoot=`/api/v1/admin/returns/${claim.id}/replacements`,key=randomUUID();
  const dummy=randomUUID(),action={expected_version:1,reason:'SYNTHETIC denied replacement action'};
  const endpoints:[string,Record<string,unknown>|undefined][]=[[createRoot,create],[`/api/v1/admin/replacements/${dummy}`,undefined],...['reservations','preparations','bookings'].map(suffix=>[`/api/v1/admin/replacements/${dummy}/${suffix}`,action] as [string,Record<string,unknown>]),[`/api/v1/admin/replacements/${dummy}/handover`,{...action,handover_reference:'SYNTHETIC denied handover'}]];
  for(const [path,body] of endpoints){const request=command(path,body);request.headers.delete('cookie');await expected(observe(request),401);}
  await expected(observe(command(createRoot,create,randomUUID(),f.finance.browser)),403);
  const initial=await expected(observe(command(createRoot,create,key)),201);assert.equal(initial.status,'awaiting_stock');assert.equal(initial.items.length,2);
  let head=initial;const root=`/api/v1/admin/replacements/${head.id}`;
  assert.deepEqual(await expected(observe(command(createRoot,create,key)),201),initial);
  assert.equal((await expected(observe(command(root)),200)).id,head.id);
  const waiting={expected_version:head.version,reason:'SYNTHETIC retry without sufficient components'};
  head=await expected(observe(command(`${root}/reservations`,waiting)),201);assert.equal(head.status,'awaiting_stock');
  const required=await sql`select c.stock_item_id,sum(c.quantity)::int quantity from app.replacement_link l join app.fulfillment_item f on f.id=l.original_fulfillment_item_id join app.order_item i on i.id=f.order_item_id join app.offer_component c on c.product_id=i.product_id and c.revision=i.product_revision and c.offer_id=i.offer_id where l.shipment_id=${head.id} group by c.stock_item_id order by c.stock_item_id`;
  for(const component of required){const [position]=await sql`select revision,on_hand-reserved-quarantined available from app.inventory_balance where warehouse_id=${parcel.warehouse_id} and stock_item_id=${component.stock_item_id} and lot_id is null`;assert.ok(position);
   const quantity=Math.max(0,Number(component.quantity)-Number(position.available));if(!quantity)continue;
   const intake:Record<string,unknown>={warehouse_id:parcel.warehouse_id,stock_item_id:component.stock_item_id,kind:'receive',quantity,expected_version:position.revision,reason:'SYNTHETIC actual replacement contract intake'};
   assert.equal((await handleInventory(command('/api/v1/admin/inventory/movements',intake),f.identity)).status,201);
  }
  const reserve={expected_version:head.version,reason:'SYNTHETIC complete owned replacement stock'},reserveKey=randomUUID();
  head=await expected(observe(command(`${root}/reservations`,reserve,reserveKey)),201);assert.equal(head.status,'ready');
  assert.deepEqual(await expected(observe(command(`${root}/reservations`,reserve,reserveKey)),201),head);
  await expected(observe(command(`${root}/preparations`,{expected_version:1,reason:'SYNTHETIC stale replacement revision'})),409);
  await expected(observe(command(`${root}/preparations`,{expected_version:head.version,reason:'SYNTHETIC forged charge',cod_due:99000}),false),400);
  outsider=await actor(f.identity,'warehouse',[]);await enroll(outsider.browser,outsider.password);
  await expected(observe(command(root,undefined,randomUUID(),outsider.browser)),404);
  head=await expected(observe(command(`${root}/preparations`,{expected_version:head.version,reason:'SYNTHETIC physical replacement preparation'})),201);assert.equal(head.status,'picking');
  head=await expected(observe(command(`${root}/bookings`,{expected_version:head.version,reason:'SYNTHETIC one replacement carrier booking'})),202);assert.equal(head.status,'booking_pending');assert.ok(head.booking_id);
  await expected(observe(command(`${root}/handover`,{expected_version:head.version,reason:'SYNTHETIC unusable waybill cannot hand over',handover_reference:'SYNTHETIC too early'})),409);
  execFileSync(process.execPath,['--env-file=.env.example','scripts/worker.ts','test','--issue-replacement-waybill',head.booking_id],{timeout:15000,stdio:'pipe'});
  head=await expected(observe(command(root)),200);assert.equal(head.status,'packed');
  head=await expected(observe(command(`${root}/handover`,{expected_version:head.version,reason:'SYNTHETIC actual replacement physical handover',handover_reference:'SYNTHETIC replacement carrier pickup'})),201);assert.equal(head.status,'handed_over');assert.equal(head.buyer_shipping,0);assert.equal(head.cod_due,0);
  await f.run(await ingestReplacementReceiptSource(sql,await simulateReplacementReceipt(sql,'test',{reference:randomUUID(),booking_id:head.booking_id,unit_ids:head.items.map((item:{id:string})=>item.id)})));
  assert.equal((await expected(observe(command(root)),200)).status,'delivered');
  assert.deepEqual(await expected(observe(command(createRoot,create,key)),201),initial);
  for(const header of ['authorization','x-cart-token','x-order-token']){const request=command(root);request.headers.set(header,'SYNTHETIC unsupported credential');await expected(observe(request),401);}
  await expected(observe(command(`${root}?unexpected=1`),false),400);
  const revoked=command(root);await sql`update app.auth_user set email_verified=false where id=${f.owner.id}`;
  try{await expected(observe(revoked),401);}finally{await sql`update app.auth_user set email_verified=true where id=${f.owner.id}`;}
  const operation=(method:string,address:string)=>`${method} ${new URL(address).pathname.replace(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g,':id')}`;
  const all=new Set(endpoints.map(([path,body])=>operation(body?'POST':'GET',`http://127.0.0.1:3099${path}`)));
  assert.deepEqual(new Set(samples.filter(row=>row.status<400).map(row=>operation(row.method,row.url))),all);
  assert.deepEqual(new Set(samples.filter(row=>row.status>=400).map(row=>operation(row.method,row.url))),all);
  validateExchanges(samples,'replacements');
 }finally{try{if(outsider)await closeFulfillmentActor(f.identity,outsider);}finally{await f.close();}}
});
