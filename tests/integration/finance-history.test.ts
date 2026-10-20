import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {handleOrderHistory} from '../../src/modules/finance/history-routes.ts';
import {postEconomicReceipt} from '../../src/modules/finance/receipts.ts';
import {actor,BrowserSession,cleanup,enroll} from '../contract/access-fixture.ts';
import {validateExchanges,type Exchange} from '../contract/openapi-probe.ts';
import {financeFixture} from './finance-ledger-fixture.ts';

test('actual history APIs enforce all seven roles, whole-order scope, bound pagination and sanitized event evidence',async()=>{
 const f=await financeFixture(),users:Awaited<ReturnType<typeof actor>>[]=[],samples:Exchange[]=[];
 const observe=async(browser:BrowserSession,path:string,expected:number,valid?:boolean)=>{const request=browser.request(`/api/v1/admin/orders${path}`),response=await handleOrderHistory(request,f.identity),payload=await response.json();assert.equal(response.status,expected,JSON.stringify(payload));samples.push({url:request.url,method:'GET',request_headers:{},request_valid:valid,status:response.status,headers:Object.fromEntries(response.headers),payload});return {payload,response};};
 try{const one=await f.order(),split=await f.order('prepaid',4);assert.equal(split.shipments.length,2);const origins=await f.identity.sql`select distinct warehouse_id from app.order_shipment where order_id=${split.id} order by warehouse_id`;const [home]=await f.identity.sql`select warehouse_id from app.order_shipment where order_id=${one.id}`;
  const guest=new BrowserSession(f.identity);await observe(guest,'',401);await observe(guest,`/${one.id}`,401);
  const owner=await observe(f.owner.browser,`?warehouse_id=${home.warehouse_id}&limit=1`,200,true);assert.equal(owner.payload.data.length,1);assert.ok(owner.payload.pagination.next_cursor);
  assert.equal((await observe(f.owner.browser,`?warehouse_id=${home.warehouse_id}&from=2000-01-01T00:00:00.000Z&to=9999-01-01T00:00:00.000Z`,200,true)).payload.data.length,2);
  const next=await observe(f.owner.browser,`?warehouse_id=${home.warehouse_id}&limit=1&cursor=${owner.payload.pagination.next_cursor}`,200,true);assert.equal(next.payload.data.length,1);assert.notEqual(next.payload.data[0].id,owner.payload.data[0].id);assert.equal(next.payload.pagination.next_cursor,null);
  await observe(f.owner.browser,`?limit=1&cursor=${owner.payload.pagination.next_cursor}`,400,true);
  for(const role of ['warehouse','buyer','affiliate'] as const){const u=await actor(f.identity,role,[home.warehouse_id]);users.push(u);if(role==='warehouse') await enroll(u.browser,u.password);await observe(u.browser,'',403);await observe(u.browser,`/${one.id}`,403);}
  for(const role of ['ecommerce_admin','customer_service','finance'] as const){const u=await actor(f.identity,role,[home.warehouse_id]);users.push(u);await enroll(u.browser,u.password);await observe(u.browser,'',403);
   await f.identity.sql`update app.role_grant set permissions=ARRAY['orders.history.read']::text[] where user_id=${u.id}`;
   const listed=await observe(u.browser,`?warehouse_id=${home.warehouse_id}`,200,true);assert.deepEqual(listed.payload.data.map((o:{id:string})=>o.id),[one.id]);
   await observe(u.browser,`/${one.id}`,200,true);const forbidden=await observe(u.browser,`/${split.id}`,404,true),missing=await observe(u.browser,`/${randomUUID()}`,404,true);assert.equal(forbidden.payload.title,missing.payload.title);
  }
  const finance=users.at(-1);assert.ok(finance);
  for(const origin of origins) await f.identity.sql`insert into app.warehouse_membership (user_id,warehouse_id) values (${finance.id},${origin.warehouse_id}) on conflict do nothing`;
  await observe(finance.browser,`/${split.id}`,200,true);await observe(finance.browser,`?warehouse_id=${home.warehouse_id}&limit=1&cursor=${owner.payload.pagination.next_cursor}`,400,true);
  await f.identity.sql.begin(tx=>postEconomicReceipt(tx,{order_id:one.id,shipment_id:null,source:'local.payment',environment:'test',event_id:randomUUID(),effect_reference:randomUUID(),amount:one.buyer_total,occurred_at:new Date().toISOString()}));
  const detail=await observe(f.owner.browser,`/${one.id}?history_limit=1`,200,true);assert.equal(detail.payload.history.length,1);assert.ok(detail.payload.history_pagination.next_cursor);assert.ok(detail.payload.history[0].recorded_at);
  const older=await observe(f.owner.browser,`/${one.id}?history_limit=1&history_cursor=${detail.payload.history_pagination.next_cursor}`,200,true);assert.equal(older.payload.history.length,1);assert.notEqual(older.payload.history[0].id,detail.payload.history[0].id);assert.equal(older.payload.history_pagination.next_cursor,null);assert.ok(older.payload.history[0].recorded_at);
  for(const key of ['recipient_name','phone','address_line','unit_cost','reason','source_id','payment_credentials']) assert.ok(!JSON.stringify(detail.payload).includes(`"${key}"`));
  assert.equal((await observe(f.owner.browser,`?reference=${one.number}`,200,true)).payload.data.length,1);
  assert.equal((await observe(f.owner.browser,`?warehouse_id=${home.warehouse_id}&status=cancelled`,200,true)).payload.data.length,0);
  assert.equal((await observe(f.owner.browser,`?warehouse_id=${home.warehouse_id}&fulfillment_status=packed`,200,true)).payload.data.length,0);
  for(const query of ['?cursor=','?limit=0','?status=wrong','?from=2026-02-30T00:00:00.000Z','?from=2026-03-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z','?warehouse_id=x','?tenant=forged']) await observe(f.owner.browser,query,400,query.includes('&to='));
  const [audit]=await f.identity.sql`select count(*)::int n from app.audit_event where actor_id=${f.owner.id} and action like 'orders.history.%'`;assert.ok(audit.n>=5);
  const isolated=createLocalAuth('test');await isolated.sql.end();const failed=await handleOrderHistory(f.owner.browser.request('/api/v1/admin/orders'),isolated);assert.equal(failed.status,503);
  validateExchanges(samples,'finance-history');
 }finally{for(const u of [f.owner,...users]) await f.identity.sql`delete from app.auth_rate_limit where key=${`history-reference:${u.id}`}`;await cleanup(f.identity,users);await f.close();}
});

test('exact history reference lookup enforces a persistent actor-bound window without leaking contacts',async()=>{
 const identity=createLocalAuth('test'),owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 try{for(let n=0;n<30;n++) assert.equal((await handleOrderHistory(owner.browser.request('/api/v1/admin/orders?reference=99-SYNTHETIC-NO-MATCH'),identity)).status,200);
  const denied=await handleOrderHistory(owner.browser.request('/api/v1/admin/orders?reference=99-SYNTHETIC-NO-MATCH'),identity);assert.equal(denied.status,429);assert.ok(Number(denied.headers.get('retry-after'))>0);
  await identity.sql`delete from app.auth_session where user_id=${owner.id}`;assert.equal((await handleOrderHistory(owner.browser.request('/api/v1/admin/orders'),identity)).status,401);
 }finally{await identity.sql`delete from app.auth_rate_limit where key=${`history-reference:${owner.id}`}`;await cleanup(identity,[owner]);await identity.sql.end();}
});
