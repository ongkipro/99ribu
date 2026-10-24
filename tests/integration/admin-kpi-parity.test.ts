import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {handleReporting} from '../../src/modules/reporting/service.ts';
import {createReturn} from '../../src/modules/returns/cases.ts';
import {ingestParcelReceiptSource,simulateParcelReceipt} from '../../src/modules/returns/receipt-source.ts';
import {handleSupport} from '../../src/modules/support/routes.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor,fulfillmentFixture} from './fulfillment-fixture.ts';
import {returnFixture} from './return-fixture.ts';

// S113: one data source per screen. Every count KPI of every workspace lens equals the number of
// rows its drilldown lists (all pages), with no row listed twice and per-warehouse splits adding up,
// for company-wide and warehouse-scoped principals and an explicit warehouse filter.

type User=Awaited<ReturnType<typeof actor>>;
type Identity=Awaited<ReturnType<typeof fulfillmentFixture>>['identity'];
type Metric={key:string;kind:string;count:number|null;complete:boolean;queue_key:string;queue_filter_token:string;breakdown:{key:string;count:number}[]|null};
type Snapshot={workspace:string;metrics:Metric[]};

async function dashboard(identity:Identity,user:User,params:Record<string,string>):Promise<Snapshot>{
 const response=await handleReporting(user.browser.request(`/api/v1/admin/dashboard?${new URLSearchParams(params)}`),identity);
 assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return response.json();
}
async function drilldownIds(identity:Identity,user:User,workspace:string,m:Metric,warehouse?:string){
 const ids:string[]=[];let cursor:string|null=null;
 do{
  const q=new URLSearchParams({workspace,queue:m.queue_key,filter_token:m.queue_filter_token,limit:'100'});if(cursor)q.set('cursor',cursor);if(warehouse)q.set('warehouse_id',warehouse);
  const response=await handleReporting(user.browser.request(`/api/v1/admin/work-queues?${q}`),identity);
  assert.equal(response.status,200,`${workspace}/${m.key}: ${JSON.stringify(await response.clone().json())}`);
  const page=await response.json() as {data:{id:string}[];pagination:{next_cursor:string|null}};ids.push(...page.data.map(r=>r.id));cursor=page.pagination.next_cursor;
 }while(cursor);
 return ids;
}
/** Asserts every count card of the snapshot against its drilldown; returns how many cards were checked. */
async function assertParity(identity:Identity,user:User,params:Record<string,string>,nonZero:string[]=[]){
 const snap=await dashboard(identity,user,params),counts=snap.metrics.filter(m=>m.kind==='count');
 assert.ok(counts.length>0,`${snap.workspace} has count cards`);
 for(const m of counts){
  const label=`${snap.workspace}${params.warehouse_id?' (warehouse filter)':''}/${m.key}`;
  assert.equal(m.complete,true,label);
  const ids=await drilldownIds(identity,user,snap.workspace,m,params.warehouse_id);
  assert.equal(new Set(ids).size,ids.length,`${label}: no row listed twice`);
  assert.equal(ids.length,m.count,`${label}: the card equals its drilldown row count`);
  if(m.breakdown?.length)assert.equal(m.breakdown.reduce((n,b)=>n+b.count,0),m.count,`${label}: the split adds up to the card`);
  if(nonZero.includes(m.key))assert.ok(Number(m.count)>0,`${label}: seeded rows make the comparison non-vacuous`);
 }
 return counts.length;
}

test('every dashboard count KPI equals its drilldown row count for each workspace, role scope and warehouse filter',{timeout:600000},async()=>{
 const f=await fulfillmentFixture('cod'),users:User[]=[];
 try{
  const sql=f.identity.sql,warehouse=String(f.parcels[0].warehouse_id),[order]=await sql`select created_at from app.commerce_order where id=${f.order.id}`,[wall]=await sql`select clock_timestamp() now`;
  // Fixture business clocks may run ahead of the wall clock: an explicit period spans both.
  const created=new Date(order.created_at).getTime(),now=new Date(wall.now).getTime();
  const period={from:new Date(Math.min(created,now)-3600_000).toISOString(),to:new Date(Math.max(created,now)+86400_000).toISOString()};
  let checked=0;
  for(const workspace of ['owner','ecommerce_admin','warehouse','customer_service','finance']){
   checked+=await assertParity(f.identity,f.owner,{workspace,...period});
   checked+=await assertParity(f.identity,f.owner,{workspace,window:'30d'});
  }
  checked+=await assertParity(f.identity,f.owner,{workspace:'owner',warehouse_id:warehouse,...period});
  // Warehouse-scoped principals see only their warehouses; company-wide roles see all.
  for(const [role,warehouses] of [['warehouse',[warehouse]],['ecommerce_admin',[warehouse]],['customer_service',[]],['finance',[]]] as const){
   const user=await actor(f.identity,role,[...warehouses]);users.push(user);await enroll(user.browser,user.password);
   checked+=await assertParity(f.identity,user,{workspace:role,...period});
  }
  // 18 metrics, 7 of them money: the owner lens alone checks 11 count cards per call.
  assert.ok(checked>=11*3,`checked ${checked} cards`);
 }finally{for(const user of users)await closeFulfillmentActor(f.identity,user).catch(()=>{});await f.close();}
});

// S113 slice 2: the small queues (returns, support, settlements, exceptions) now count over the
// same SQL fragment their drilldown lists. Seed an open return claim and an unassigned conversation
// so the comparison is not 0 = 0 for them, under company-wide and warehouse-scoped principals.
test('returns and support KPIs equal their drilldown with seeded open rows',{timeout:600000},async()=>{
 const f=await returnFixture('prepaid'),sql=f.identity.sql,conversations:string[]=[],users:User[]=[];
 try{
  const origin='http://127.0.0.1:3099';let cookie='';
  const guest=async(path:string,body:Record<string,unknown>)=>{
   const headers=new Headers({origin,'idempotency-key':randomUUID(),'content-type':'application/json'});if(cookie)headers.set('cookie',cookie);
   const response=await handleSupport(new Request(`${origin}${path}`,{method:'POST',headers,body:JSON.stringify(body)}),f.identity);
   for(const raw of response.headers.getSetCookie()){const [pair]=raw.split(';');cookie=cookie?`${cookie}; ${pair}`:pair;}
   return {status:response.status,payload:await response.json()};
  };
  assert.equal((await guest('/api/v1/guest-support-sessions',{client_request_id:`req-${randomUUID()}`})).status,201);
  const created=await guest('/api/v1/support/conversations',{client_conversation_id:`conv-${randomUUID()}`,product_id:f.seeded.products['fixture-offer-shirt']});
  assert.equal(created.status,200,JSON.stringify(created.payload));conversations.push(created.payload.id);
  // A buyer-received parcel and an open return claim (admin-kpis.test.ts flow, not decided).
  for(const booking of f.bookings){
   const parcel=f.parcels.find(p=>p.id===booking.fulfillment_id);assert.ok(parcel);
   await f.run(await ingestParcelReceiptSource(sql,await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:f.units.filter(u=>u.shipment_id===parcel.shipment_id).map(u=>u.id)})));
  }
  const buyer=await commerceActor(f.client.request('/api/v1/carts'),f.identity);assert.ok(buyer);
  const unit=f.units[0],claim={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'damaged',details:'SYNTHETIC S113 open return'}],requested_resolution:'refund'};
  const returned=await createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,claim,{key:randomUUID()}),f.identity,buyer,f.order.id,claim) as {id:string;status:string};
  assert.equal(returned.status,'requested');
  const [wall]=await sql`select clock_timestamp() now`,[{created_at}]=await sql`select created_at from app.return_case where id=${returned.id}`;
  const latest=Math.max(new Date(wall.now).getTime(),new Date(created_at).getTime());
  const period={from:new Date(latest-3600_000).toISOString(),to:new Date(latest+86400_000).toISOString()};
  await assertParity(f.identity,f.owner,{workspace:'owner',...period},['returns_pending','support_unassigned']);
  const support=(await dashboard(f.identity,f.owner,{workspace:'owner',...period})).metrics.find(m=>m.key==='support_unassigned');
  assert.equal((support as unknown as {action_href:string|null}).action_href,'/admin/support','the unassigned card links to the inbox');
  const warehouse=String(f.parcels[0].warehouse_id);
  await assertParity(f.identity,f.owner,{workspace:'owner',warehouse_id:warehouse,...period},['returns_pending']);
  const scoped=await actor(f.identity,'warehouse',[warehouse]);users.push(scoped);await enroll(scoped.browser,scoped.password);
  await assertParity(f.identity,scoped,{workspace:'warehouse',...period},['returns_pending']);
  const cs=await actor(f.identity,'customer_service',[]);users.push(cs);await enroll(cs.browser,cs.password);
  await assertParity(f.identity,cs,{workspace:'customer_service',...period},['returns_pending','support_unassigned']);
 }finally{
  try{
   for(const user of users)await closeFulfillmentActor(f.identity,user).catch(()=>{});
   // Same teardown as admin-kpis.test.ts / support-chat.test.ts; a refused delete fails the test.
   if(conversations.length){
    for(const table of ['support_in_app_notification','support_challenge','support_conversation_tag','support_participant_preference','support_assignment_event','support_read_position','support_internal_note','support_context_card','support_attachment','support_message'])
     await sql`delete from ${sql(`app.${table}`)} where conversation_id in ${sql(conversations)}`;
    await sql`delete from app.support_conversation where id in ${sql(conversations)}`;
   }
  }finally{await f.close();}
 }
});
