import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {handleOrderHistory} from '../../src/modules/finance/history-routes.ts';
import {handleManualFulfillment} from '../../src/modules/fulfillment/manual-routes.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor,fulfillmentFixture} from './fulfillment-fixture.ts';

// S100 staff order search and detail over the existing order-history API: exact rules (order number,
// current or superseded resi, phone digit suffix), no contact data in lists or detail, spec-07 scope
// (owner company-wide; other granted staff only orders whose every parcel is in their warehouses;
// warehouse role never) and the shared 30/minute search limiter.
type User=Awaited<ReturnType<typeof actor>>;
const history=async(user:User,identity:Parameters<typeof handleOrderHistory>[1],path:string)=>{
 const response=await handleOrderHistory(user.browser.request(`/api/v1/admin/orders${path}`),identity);
 return {status:response.status,payload:await response.json()};
};

test('S100 order search by number, resi and phone suffix; detail shows payment, resi and tracking without contacts; scope and denials hold',{timeout:300000},async()=>{
 const f=await fulfillmentFixture('cod'),sql=f.identity.sql,identity=f.identity,staff:User[]=[];
 const stamp=String(Date.now()).slice(-8),resiOld=`JQ${stamp}01`,resiNew=`JQ${stamp}02`;
 const staffUser=async(role:'customer_service'|'finance'|'warehouse'|'ecommerce_admin',warehouses:string[],granted=true)=>{
  const user=await actor(identity,role,warehouses);staff.push(user);await enroll(user.browser,user.password);
  if(granted)await sql`update app.role_grant set permissions=ARRAY['orders.history.read']::text[] where user_id=${user.id}`;return user;
 };
 try{
  const [manual]=f.parcels,warehouses=[...new Set(f.parcels.map(p=>String(p.warehouse_id)))];assert.equal(warehouses.length,2);
  const ship=async(path:string,body:Record<string,unknown>)=>{const request=f.owner.browser.request(path,body);request.headers.set('idempotency-key',randomUUID());const response=await handleManualFulfillment(request,identity);const payload=await response.json();assert.equal(response.status,201,JSON.stringify(payload));return payload;};
  const shipped=await ship(`/api/v1/admin/fulfillments/${manual.id}/manual-shipment`,{expected_version:manual.revision,courier:'jne',tracking_number:resiOld});
  await ship(`/api/v1/admin/fulfillments/${manual.id}/tracking-corrections`,{expected_version:shipped.version,courier:'jne',tracking_number:resiNew,reason:'Salah ketik resi'});
  const [quote]=await sql`select q.document->'contact'->>'phone' phone,q.document->'address'->>'address_line' street from app.checkout_quote q join app.commerce_order o on o.quote_id=q.id where o.id=${f.order.id}`;
  const phone=String(quote.phone),suffix=phone.slice(-8);

  const cs=await staffUser('customer_service',warehouses);
  const found=async(path:string)=>{const result=await history(cs,identity,path);assert.equal(result.status,200,`${path} ${JSON.stringify(result.payload)}`);return (result.payload.data as {id:string}[]).map(r=>r.id);};
  assert.deepEqual(await found(`?reference=${f.order.number.toLowerCase()}`),[f.order.id],'order number, any case');
  assert.deepEqual(await found(`?reference=${encodeURIComponent(resiNew.toLowerCase().replace(/(.{4})/g,'$1 ').trim())}`),[f.order.id],'current resi with spaces and lower case');
  assert.deepEqual(await found(`?reference=${resiOld}`),[f.order.id],'a superseded resi still finds the order');
  assert.deepEqual(await found(`?reference=JQ${stamp}99`),[],'unknown resi');
  const bySuffix=await history(cs,identity,`?phone_suffix=${suffix}`);assert.equal(bySuffix.status,200);
  assert.deepEqual((bySuffix.payload.data as {id:string}[]).map(r=>r.id),[f.order.id]);
  const listed=JSON.stringify(bySuffix.payload);assert.ok(!listed.includes(suffix)&&!listed.includes(phone),'the phone never comes back in a list');
  assert.deepEqual(Object.keys(bySuffix.payload.data[0]).sort(),['admin_no','buyer_total','created_at','currency','id','number','payment_method','payment_status','status','version']);
  for(const bad of ['12345','123456789','abcdef','1234567890123','12 3456'])assert.equal((await history(cs,identity,`?phone_suffix=${encodeURIComponent(bad)}`)).status,400,bad);
  assert.equal((await history(cs,identity,`?phone_suffix=${suffix}&phone_suffix=${suffix}`)).status,400,'one value per key');

  // Detail: payment state incl. COD fee, per-parcel COD due, resi and tracking; no contacts or address.
  const detail=await history(cs,identity,`/${f.order.id}?history_limit=100`);assert.equal(detail.status,200,JSON.stringify(detail.payload));
  const order=detail.payload.order;assert.equal(order.number,f.order.number);assert.equal(order.payment_method,'cod');assert.equal(typeof order.cod_fee_bps,'number');
  const stored=await sql`select id,cod_due,payment_charge from app.order_shipment where order_id=${f.order.id}`;
  for(const s of stored){const projected=order.shipments.find((x:{id:string})=>x.id===s.id);assert.equal(projected.cod_collect_amount,Number(s.cod_due));assert.equal(projected.cod_fee_amount,Number(s.payment_charge));}
  const parcel=order.shipments.find((x:{id:string})=>x.id===manual.shipment_id);assert.equal(parcel.tracking_number,resiNew);assert.equal(parcel.courier_name,'JNE');assert.equal(parcel.status,'handed_over');
  assert.ok(detail.payload.history.some((e:{kind:string;status:string})=>e.kind==='fulfillment'&&e.status==='handed_over'),'timeline carries the handover');
  const body=JSON.stringify(detail.payload);assert.ok(!body.includes(phone)&&!body.includes(String(quote.street))&&!body.includes('+6281200000000'),'no contact or ship-to data in staff history');
  const audits=JSON.stringify(await sql`select reason,details from app.audit_event where actor_id=${cs.id}`);assert.ok(!audits.includes(suffix)&&!audits.includes(resiOld),'searches audit no search terms');

  // Scope and denials.
  const unassigned=await staffUser('customer_service',[]);
  assert.deepEqual((await history(unassigned,identity,`?reference=${f.order.number}`)).payload.data,[],'no membership, no orders');
  assert.equal((await history(unassigned,identity,`/${f.order.id}`)).status,404);
  const partial=await staffUser('customer_service',[warehouses[0]]);
  assert.deepEqual((await history(partial,identity,`?reference=${resiNew}`)).payload.data,[],'an order with a parcel outside the scope stays hidden');
  assert.equal((await history(partial,identity,`/${f.order.id}`)).status,404);
  const keeper=await staffUser('warehouse',warehouses);
  assert.equal((await history(keeper,identity,`?reference=${f.order.number}`)).status,403,'warehouse role never reads whole orders');
  assert.equal((await history(keeper,identity,`/${f.order.id}`)).status,403);
  const ungranted=await staffUser('customer_service',warehouses,false);
  assert.equal((await history(ungranted,identity,`?phone_suffix=${suffix}`)).status,403);
  const finance=await staffUser('finance',warehouses);
  assert.deepEqual((await history(finance,identity,`?reference=${resiNew}`)).payload.data.map((r:{id:string})=>r.id),[f.order.id]);
  assert.deepEqual((await history(f.owner as User,identity,`?reference=${resiNew}`)).payload.data.map((r:{id:string})=>r.id),[f.order.id],'owner company-wide');
  // The shared synthetic recipient phone matches many orders company-wide: the cursor binds the
  // filters with a keyed MAC, so neither the suffix nor an unkeyed digest of it is recoverable.
  const paged=await history(f.owner as User,identity,'?phone_suffix=00000000&limit=1');assert.equal(paged.status,200);
  assert.ok(paged.payload.pagination.next_cursor,'more than one match');
  const decoded=Buffer.from(paged.payload.pagination.next_cursor,'base64url').toString();assert.ok(!decoded.includes('00000000'));
  assert.match(JSON.parse(decoded).h,/^[A-Za-z0-9_-]{43}$/,'HMAC-SHA256 base64url, not a hex SHA-256 of the filters');

  // Number, resi and phone searches share the 30/minute limiter.
  const limited=await staffUser('customer_service',warehouses);
  for(let n=0;n<30;n++)assert.equal((await history(limited,identity,n%2?`?phone_suffix=${suffix}`:`?reference=${resiNew}`)).status,200);
  assert.equal((await history(limited,identity,`?phone_suffix=${suffix}`)).status,429);
  assert.equal((await history(limited,identity,'')).status,200,'browsing without a search term is not limited');
 }finally{
  for(const user of [...staff,f.owner])await sql`delete from app.auth_rate_limit where key=${`history-reference:${user.id}`}`.catch(()=>{});
  for(const user of staff)await closeFulfillmentActor(identity,user).catch(()=>{});await f.close();
 }
});
