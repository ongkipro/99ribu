import assert from 'node:assert/strict';
import test from 'node:test';
import {handleReporting} from '../../src/modules/reporting/service.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor,fulfillmentFixture} from './fulfillment-fixture.ts';

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
async function assertParity(identity:Identity,user:User,params:Record<string,string>){
 const snap=await dashboard(identity,user,params),counts=snap.metrics.filter(m=>m.kind==='count');
 assert.ok(counts.length>0,`${snap.workspace} has count cards`);
 for(const m of counts){
  const label=`${snap.workspace}${params.warehouse_id?' (warehouse filter)':''}/${m.key}`;
  assert.equal(m.complete,true,label);
  const ids=await drilldownIds(identity,user,snap.workspace,m,params.warehouse_id);
  assert.equal(new Set(ids).size,ids.length,`${label}: no row listed twice`);
  assert.equal(ids.length,m.count,`${label}: the card equals its drilldown row count`);
  if(m.breakdown?.length)assert.equal(m.breakdown.reduce((n,b)=>n+b.count,0),m.count,`${label}: the split adds up to the card`);
 }
 return counts.length;
}

test('every dashboard count KPI equals its drilldown row count for each workspace, role scope and warehouse filter',async()=>{
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
