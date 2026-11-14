import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {MIN_RATE_SAMPLE} from '../../src/modules/reporting/metric-math.ts';
import {handleReporting} from '../../src/modules/reporting/service.ts';
import {bindingDeadlineAt,bindingDeadlineKind,codOutcomesInPeriod,latestCodOutcomes} from '../../src/modules/reporting/sources.ts';
import {createReturn} from '../../src/modules/returns/cases.ts';
import {ingestParcelReceiptSource,simulateParcelReceipt} from '../../src/modules/returns/receipt-source.ts';
import {handleSupport} from '../../src/modules/support/routes.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor} from './fulfillment-fixture.ts';
import {returnFixture} from './return-fixture.ts';

// S153 (DEC-027): every new metric equals an independent query, every tile count equals the rows of
// its drilldown, a comparison delta equals the same independent query over the previous period, and
// an incomplete input is never turned into zero. Database-backed; the independent queries below are
// written differently from the production fragments on purpose (EXISTS and plain joins).

type User=Awaited<ReturnType<typeof actor>>;
type Identity=Awaited<ReturnType<typeof returnFixture>>['identity'];
type Comparison={previous:number|null;delta:number|null;delta_kind:'percent'|'points';reason:string|null};
type Metric={key:string;kind:string;count:number|null;amount:number|null;complete:boolean;queue_key:string;queue_filter_token:string;
 denominator:number|null;rate:number|null;age_seconds:number|null;stale_count:number|null;comparison:Comparison|null;basis:string};
type Snapshot={workspace:string;from:string;to:string;as_of:string;comparison_period:{from:string;to:string}|null;metrics:Metric[];
 series:{bucket:string;points:{start:string;revenue:number;orders:number}[];previous:{start:string;revenue:number;orders:number}[]|null}|null;
 cod_ageing:{total:number;buckets:{amount:number;parcels:number}[]}|null;
 sales:{orders:number;units:number;gross_merchandise:number;by_status:{key:string;count:number}[];top_products:{amount:number}[]}|null};

async function dashboard(identity:Identity,user:User,params:Record<string,string>):Promise<Snapshot>{
 const response=await handleReporting(user.browser.request(`/api/v1/admin/dashboard?${new URLSearchParams(params)}`),identity);
 assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return response.json();
}
async function rows(identity:Identity,user:User,workspace:string,m:Metric){
 const ids:string[]=[];let cursor:string|null=null;
 do{
  const q=new URLSearchParams({workspace,queue:m.queue_key,filter_token:m.queue_filter_token,limit:'100'});if(cursor)q.set('cursor',cursor);
  const response=await handleReporting(user.browser.request(`/api/v1/admin/work-queues?${q}`),identity);
  assert.equal(response.status,200,`${workspace}/${m.key}: ${JSON.stringify(await response.clone().json())}`);
  const page=await response.json() as {data:{id:string}[];pagination:{next_cursor:string|null}};ids.push(...page.data.map(r=>r.id));cursor=page.pagination.next_cursor;
 }while(cursor);
 return ids;
}
const metric=(snap:Snapshot,key:string)=>{const m=snap.metrics.find(x=>x.key===key);assert.ok(m,`${snap.workspace} lens has ${key}`);return m;};

test('the five DEC-027 metrics equal independent queries and their drilldown rows',{timeout:600000},async()=>{
 const f=await returnFixture('cod'),sql=f.identity.sql,users:User[]=[],conversations:string[]=[];
 try{
  const origin='http://127.0.0.1:3099';let cookie='';
  const guest=async(path:string,body:Record<string,unknown>)=>{
   const headers=new Headers({origin,'idempotency-key':randomUUID(),'content-type':'application/json'});if(cookie)headers.set('cookie',cookie);
   const response=await handleSupport(new Request(`${origin}${path}`,{method:'POST',headers,body:JSON.stringify(body)}),f.identity);
   for(const raw of response.headers.getSetCookie()){const [pair]=raw.split(';');cookie=cookie?`${cookie}; ${pair}`:pair;}
   return {status:response.status,payload:await response.json()};
  };
  // Seed: an unclaimed chat, buyer-received parcels (the return_rate denominator) and one open return (its numerator).
  assert.equal((await guest('/api/v1/guest-support-sessions',{client_request_id:`req-${randomUUID()}`})).status,201);
  const created=await guest('/api/v1/support/conversations',{client_conversation_id:`conv-${randomUUID()}`,product_id:f.seeded.products['fixture-offer-shirt']});
  assert.equal(created.status,200,JSON.stringify(created.payload));conversations.push(created.payload.id);
  for(const booking of f.bookings){
   const parcel=f.parcels.find(p=>p.id===booking.fulfillment_id);assert.ok(parcel);
   await f.run(await ingestParcelReceiptSource(sql,await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:f.units.filter(u=>u.shipment_id===parcel.shipment_id).map(u=>u.id)})));
  }
  const buyer=await commerceActor(f.client.request('/api/v1/carts'),f.identity);assert.ok(buyer);
  const unit=f.units[0],claim={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'damaged',details:'SYNTHETIC S153 open return'}],requested_resolution:'refund'};
  const returned=await createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,claim,{key:randomUUID()}),f.identity,buyer,f.order.id,claim) as {id:string};
  const [wall]=await sql`select clock_timestamp() now`,[{created_at}]=await sql`select created_at from app.return_case where id=${returned.id}`;
  const latest=Math.max(new Date(wall.now).getTime(),new Date(created_at).getTime());
  // Wide enough to hold the fixture's COD collections, which happened before the return.
  const period={from:new Date(latest-7*86400_000).toISOString(),to:new Date(latest+86400_000).toISOString()};
  // A late as_of makes the handed-over-or-not parcels past their deadline without touching the data.
  const asOf=new Date(latest+30*86400_000).toISOString();
  const owner=await dashboard(f.identity,f.owner,{workspace:'owner',...period,as_of:asOf});
  const {from,to}=period;

  // fulfillments_overdue: current state, no period; independent EXISTS-style query.
  const overdue=metric(owner,'fulfillments_overdue');
  const scope=(owner as unknown as {warehouse_ids:string[]}).warehouse_ids;
  const [{n:overdueN}]=await sql`select count(*)::int n from app.fulfillment f where f.status<>'handed_over'
   and f.shipment_id in (select id from app.order_shipment where warehouse_id=any(${scope}::uuid[]))
   and exists(select 1 from app.fulfillment_deadline d where d.id=f.deadline_id
    and (case when f.status in ('packed','handover_pending') and d.handover_due_at is not null then d.handover_due_at else d.packing_due_at end) < ${asOf}::timestamptz)`;
  assert.equal(overdue.count,overdueN);assert.equal(overdue.basis,'snapshot');assert.equal(overdue.comparison,null,'a snapshot never carries a delta');
  assert.equal((await rows(f.identity,f.owner,'owner',overdue)).length,overdue.count,'overdue tile equals its drilldown rows');
  const early=metric(await dashboard(f.identity,f.owner,{workspace:'owner',...period}),'fulfillments_overdue');
  assert.ok(Number(early.count)<=Number(overdue.count),'a later as_of never has fewer overdue parcels');

  // cod_failed_rate: numerator and denominator each from a different formulation.
  const cod=metric(owner,'cod_failed_rate');
  const [{failed,total}]=await sql`select count(*) filter (where e.failed)::int failed, count(*)::int total
   from app.order_shipment sh join app.commerce_order o on o.id=sh.order_id
   cross join lateral (select ev.failed,ev.occurred_at from (
     select op.status='refused' failed,op.occurred_at from app.local_cod_operation op where op.shipment_id=sh.id and op.status in ('collected','refused')
     union all select t.status='failed',t.occurred_at from app.shipment_tracking_event t join app.fulfillment fu on fu.id=t.fulfillment_id where fu.shipment_id=sh.id and t.status in ('delivered','failed')
     union all select true,po.occurred_at from app.local_parcel_outcome po where po.shipment_id=sh.id and po.status in ('failed','refused','returned_to_sender')
    ) ev order by ev.occurred_at desc,ev.failed asc limit 1) e
   where o.payment_method='cod' and sh.warehouse_id=any(${scope}::uuid[]) and e.occurred_at between ${from}::timestamptz and ${to}::timestamptz`;
  // One outcome per parcel: the numerator can never exceed the denominator.
  assert.equal(cod.count,failed);assert.equal(cod.denominator,total);
  assert.ok(total>0,'the COD fixture collected its parcels, so the denominator is not vacuous');
  assert.equal(cod.rate,total>0?failed/total:null);
  assert.ok(cod.count!==null&&cod.denominator!==null&&cod.count<=cod.denominator,'numerator <= denominator');
  assert.equal((await rows(f.identity,f.owner,'owner',cod)).length,failed,'failed COD parcels equal the numerator');

  // return_rate = return cases opened / orders with a buyer-received parcel, both in the period.
  const ret=metric(owner,'return_rate');
  const [{opened}]=await sql`select count(*)::int opened from app.return_case rc where rc.created_at between ${from}::timestamptz and ${to}::timestamptz
   and exists(select 1 from app.order_shipment sh where sh.order_id=rc.order_id and sh.warehouse_id=any(${scope}::uuid[]))`;
  const [{delivered}]=await sql`select count(distinct sh.order_id)::int delivered from app.local_parcel_receipt r join app.order_shipment sh on sh.id=r.shipment_id where r.occurred_at between ${from}::timestamptz and ${to}::timestamptz and sh.warehouse_id=any(${scope}::uuid[])`;
  assert.ok(opened>0&&delivered>0,'seeded: one open return and received parcels');
  assert.equal(ret.count,opened);assert.equal(ret.denominator,delivered);
  // Below the minimum sample no percentage is given (the tile shows count and denominator); at or above it the plain fraction.
  if(delivered<MIN_RATE_SAMPLE){assert.equal(ret.rate,null);assert.equal((ret as unknown as {low_sample:boolean}).low_sample,true);}
  else{assert.equal(ret.rate,opened/delivered);assert.equal((ret as unknown as {low_sample:boolean}).low_sample,false);}
  assert.equal((await rows(f.identity,f.owner,'owner',ret)).length,opened,'return_rate tile equals its drilldown rows');

  // average_order_value: ONE population. Merchandise (quantity x frozen unit price) of the orders placed
  // in the period (not cancelled, not a draft) over the count of those same orders; an estimate, never Aktual.
  const aov=metric(owner,'average_order_value');
  const [{orders,merch}]=await sql`select count(*)::int orders,coalesce(sum((select sum(oi.quantity*oi.unit_price) from app.order_item oi where oi.order_id=o.id)),0)::bigint merch
   from app.commerce_order o where o.status not in ('preparing','cancelled') and o.created_at between ${from}::timestamptz and ${to}::timestamptz`; // company-wide, not warehouse-scoped
  assert.equal(aov.denominator,orders);assert.ok(orders>0);
  assert.equal(aov.amount,Math.round(Number(merch)/orders));
  assert.equal((aov as unknown as {financial_basis:string}).financial_basis,'estimated');
  assert.equal((await rows(f.identity,f.owner,'owner',aov)).length,orders,'the orders behind the average are listed');
  const revenue=metric(owner,'net_merchandise_revenue');

  // oldest_unclaimed_chat_age: same set as support_unassigned, no period; age from the oldest created_at.
  const chat=metric(owner,'oldest_unclaimed_chat_age'),unassigned=metric(owner,'support_unassigned');
  const [{n:chats,oldest}]=await sql`select count(*)::int n,min(c.created_at) oldest from app.support_conversation c where c.assigned_user_id is null and c.status='open'`; // a chat waiting for the buyer is not staff's wait
  assert.ok(chats>0);assert.equal(chat.count,chats);
  assert.equal(chat.age_seconds,Math.max(0,Math.floor((Date.parse(asOf)-new Date(oldest).getTime())/1000)));
  assert.ok(unassigned.count!==null);
  assert.equal((await rows(f.identity,f.owner,'owner',chat)).length,chats);

  // Tile counts with a stale marker never exceed their rows; the marker is a FILTER over the same fragment.
  assert.equal(metric(owner,'fulfillments_due').stale_count,null,'fulfillments_due carries no stale marker; the overdue chip is the marker');
  assert.equal(metric(owner,'fulfillments_due').basis,'snapshot','the backlog behind the overdue chip is live, not period-limited');
  assert.ok(Number(metric(owner,'fulfillments_overdue').count)<=Number(metric(owner,'fulfillments_due').count),'overdue is a subset of the backlog');
  // orders_pending "more than 24 hours" counts what staff must act on: a prepaid order awaiting the BUYER's payment is excluded.
  const [{n:staleOrders}]=await sql`select count(*)::int n from app.commerce_order o where o.status in ('pending','processing')
   and o.created_at between ${from}::timestamptz and ${to}::timestamptz and o.created_at < ${asOf}::timestamptz - interval '24 hours'
   and not (o.payment_method='prepaid' and o.payment_status='pending')
   and (not exists(select 1 from app.order_shipment s0 where s0.order_id=o.id) or exists(select 1 from app.order_shipment s where s.order_id=o.id and s.warehouse_id=any(${scope}::uuid[])))`;
  assert.equal(metric(owner,'orders_pending').stale_count,staleOrders);
  for(const key of ['orders_pending','returns_pending','support_unassigned','delivery_exceptions']){
   const m=metric(owner,key);if(m.stale_count!==null)assert.ok(m.stale_count<=Number(m.count),`${key}: stale <= rows`);
  }

  // Incomplete input is never zero: the fixture has no cost versions, so contribution is unknown, not Rp0.
  const [{costs}]=await sql`select count(*)::int costs from app.component_cost_version where effective_at <= ${to}::timestamptz`;
  for(const key of ['estimated_contribution','realized_contribution']){
   const m=metric(owner,key);
   if(m.complete===false)assert.equal(m.amount,null,`${key} is null, never 0`);
   if(costs===0)assert.equal(m.complete,false,`${key}: no cost version exists, so the figure is unknown`);
  }
  for(const m of owner.metrics.filter(x=>x.kind==='money'))if(m.amount===0)assert.equal(m.complete,true,`${m.key}: a zero amount is a known zero`);

  // Role lenses: the warehouse sees only the overdue count, CS only the chat age, finance the average (its COD rate drilldown is a fulfillments queue finance cannot open), ecommerce_admin the COD rate.
  const wh=await actor(f.identity,'warehouse',[String(f.parcels[0].warehouse_id)]);users.push(wh);await enroll(wh.browser,wh.password);
  const whKeys=(await dashboard(f.identity,wh,{workspace:'warehouse',...period})).metrics.map(m=>m.key);
  assert.ok(whKeys.includes('fulfillments_overdue')&&!whKeys.includes('average_order_value')&&!whKeys.includes('oldest_unclaimed_chat_age'));
  const cs=await actor(f.identity,'customer_service',[]);users.push(cs);await enroll(cs.browser,cs.password);
  const csKeys=(await dashboard(f.identity,cs,{workspace:'customer_service',...period})).metrics.map(m=>m.key);
  assert.ok(csKeys.includes('oldest_unclaimed_chat_age')&&!csKeys.includes('cod_failed_rate'));
  const fin=await actor(f.identity,'finance',[]);users.push(fin);await enroll(fin.browser,fin.password);
  const finance=await dashboard(f.identity,fin,{workspace:'finance',...period});
  assert.ok(finance.metrics.some(m=>m.key==='average_order_value')&&!finance.metrics.some(m=>m.key==='cod_failed_rate'));
  // COD ageing (finance chart) adds up to the cod_receivable card; the revenue series (owner chart) to the revenue card.
  assert.ok(finance.cod_ageing);assert.equal(finance.cod_ageing.total,metric(finance,'cod_receivable').amount);
  assert.equal(finance.cod_ageing.buckets.reduce((n,b)=>n+b.amount,0),finance.cod_ageing.total);
  assert.ok(owner.series);assert.equal(Math.max(0,owner.series.points.reduce((n,p)=>n+p.revenue,0)),Number(revenue.amount),'the revenue series adds up to the revenue card');
  assert.equal(owner.series.points.reduce((n,p)=>n+p.orders,0),orders,'the series orders equal the average order denominator');
  assert.equal(owner.series.previous,null,'no previous series without compare');
  // Owner sales block: the same population as the average order value; finance gets none.
  assert.ok(owner.sales);assert.equal(owner.sales.orders,orders,'sales orders equal the average order denominator');
  assert.equal(owner.sales.gross_merchandise,Number(merch),'gross merchandise equals the average order numerator');
  assert.equal(owner.sales.by_status.filter(r=>r.key!=='cancelled').reduce((n,r)=>n+r.count,0),orders,'status mix without cancelled equals the orders');
  assert.ok(owner.sales.top_products.length<=5&&owner.sales.top_products.every((t,i,a)=>i===0||a[i-1].amount>=t.amount),'best sellers by amount, at most five');
  assert.equal(finance.sales,null,'the sales block is owner-only');
 }finally{
  try{
   for(const user of users)await closeFulfillmentActor(f.identity,user).catch(()=>{});
   if(conversations.length){
    for(const table of ['support_in_app_notification','support_challenge','support_conversation_tag','support_participant_preference','support_assignment_event','support_read_position','support_internal_note','support_context_card','support_attachment','support_message'])
     await sql`delete from ${sql(`app.${table}`)} where conversation_id in ${sql(conversations)}`;
    await sql`delete from app.support_conversation where id in ${sql(conversations)}`;
   }
  }finally{await f.close();}
 }
});

test('compare=previous: a delta equals an independent query over the previous period; snapshots and incomplete inputs get none',{timeout:600000},async()=>{
 const f=await returnFixture('cod'),sql=f.identity.sql;
 try{
  const [order]=await sql`select created_at from app.commerce_order where id=${f.order.id}`;
  const created=new Date(order.created_at).getTime(),hour=3600_000;
  // Current period holds no order; the previous period (shifted back by its own length) holds the fixture order.
  const params={workspace:'owner',from:new Date(created+hour).toISOString(),to:new Date(created+2*hour).toISOString(),compare:'previous'};
  const snap=await dashboard(f.identity,f.owner,params);
  assert.deepEqual(snap.comparison_period,{from:new Date(created).toISOString(),to:new Date(created+hour).toISOString()});
  const [{n:prevOrders}]=await sql`select count(*)::int n from app.commerce_order o where o.status<>'preparing' and o.created_at >= ${snap.comparison_period?.from}::timestamptz and o.created_at <= ${snap.comparison_period?.to}::timestamptz
   and (not exists(select 1 from app.order_shipment s0 where s0.order_id=o.id) or exists(select 1 from app.order_shipment s where s.order_id=o.id and s.warehouse_id=any(${(snap as unknown as {warehouse_ids:string[]}).warehouse_ids}::uuid[])))`;
  assert.ok(prevOrders>0,'the fixture order sits in the previous period');
  const orders=metric(snap,'orders_by_payment_method');
  assert.equal(orders.count,0);
  assert.ok(orders.comparison);assert.equal(orders.comparison.previous,prevOrders);
  assert.equal(orders.comparison.delta,-100,'0 against a non-zero base is -100%');assert.equal(orders.comparison.delta_kind,'percent');
  // average order value: no orders now, so there is no value to compare, and the chip must say so.
  // (The average is company-wide, so a concurrent fixture's order in this hour is counted: compare with the independent count, not a literal 0.)
  const aov=metric(snap,'average_order_value');
  const [{n:nowOrders}]=await sql`select count(*)::int n from app.commerce_order o where o.status not in ('preparing','cancelled') and o.created_at >= ${snap.from}::timestamptz and o.created_at <= ${snap.to}::timestamptz`;
  assert.equal(aov.denominator,nowOrders);
  if(nowOrders===0){assert.equal(aov.amount,null,'no orders: no average, never Rp0');assert.equal(aov.comparison?.delta,null);assert.equal(aov.comparison?.reason,'no_base');}
  // Rate metrics compare in points; a missing rate on either side gives no delta.
  const cod=metric(snap,'cod_failed_rate');assert.equal(cod.comparison?.delta_kind,'points');
  if(cod.rate===null)assert.equal(cod.comparison?.delta,null);
  // Snapshot metrics, open backlogs and contribution with an incomplete input carry no delta.
  for(const key of ['fulfillments_overdue','oldest_unclaimed_chat_age','manual_booking_pending','stock_alerts','orders_pending','returns_pending','refund_liability'])
   assert.equal(metric(snap,key).comparison,null,`${key} has no comparison`);
  const est=metric(snap,'estimated_contribution');
  if(!est.complete){assert.equal(est.amount,null);assert.equal(est.comparison?.delta,null);assert.equal(est.comparison?.reason,'incomplete');}
  // The chart series aligns bucket for bucket with the comparison.
  assert.ok(snap.series?.previous);assert.equal(snap.series.previous.length,snap.series.points.length);
  // Without compare there are no comparison objects at all.
  const plain=await dashboard(f.identity,f.owner,{workspace:'owner',from:params.from,to:params.to});
  assert.ok(plain.metrics.every(m=>m.comparison===null));assert.equal(plain.comparison_period,null);
  // Bad parameter value and the window presets.
  const bad=await handleReporting(f.owner.browser.request(`/api/v1/admin/dashboard?${new URLSearchParams({workspace:'owner',compare:'year'})}`),f.identity);
  assert.equal(bad.status,400);
  const today=await dashboard(f.identity,f.owner,{workspace:'owner',window:'today',compare:'previous'});
  assert.equal(new Date(today.from).getTime()%86400_000,17*hour%86400_000,'Hari ini starts at 00:00 WIB (17:00 UTC)');
  assert.equal(Date.parse(today.comparison_period?.from ?? ""),Date.parse(today.from)-86400_000);
 }finally{await f.close();}
});

test('the overdue tile and the queue marker read one deadline rule (shared fragment), case by case',{timeout:600000},async()=>{
 const f=await returnFixture('cod'),sql=f.identity.sql;
 try{
  const asOf='2026-11-02T10:00:00.000Z',past='2026-11-01T10:00:00.000Z',future='2026-11-03T10:00:00.000Z',created='2026-10-30T10:00:00.000Z';
  // [status, packing_due_at, handover_due_at, overdue?, kind]
  const cases:[string,string|null,string|null,boolean,string][]=[
   ['packed',past,future,false,'handover_deadline'],      // packed: the future handover deadline binds, the past packing deadline no longer does
   ['picking',null,past,false,'created'],                 // picking with only a handover deadline: not counted, not marked
   ['picking',past,future,true,'packing_deadline'],
   ['packed',past,null,true,'packing_deadline'],          // packed without a handover deadline falls back to the packing deadline
   ['handover_pending',past,past,true,'handover_deadline'],
   ['ready',null,null,false,'created'],
  ];
  for(const [status,packing,handover,overdue,kind] of cases){
   const [row]=await sql`select ${bindingDeadlineAt(sql)} < ${asOf}::timestamptz as tile,
     ${bindingDeadlineKind(sql)} as kind,
     (coalesce(${bindingDeadlineAt(sql)},${created}::timestamptz) < ${asOf}::timestamptz and ${bindingDeadlineKind(sql)} <> 'created') as marker
     from (select ${status}::text as status) f, (select ${packing}::timestamptz as packing_due_at,${handover}::timestamptz as handover_due_at) d`;
   assert.equal(row.tile===true,overdue,`${status}/${packing}/${handover}: tile`);
   assert.equal(row.kind,kind,`${status}/${packing}/${handover}: kind`);
   assert.equal(row.marker,overdue,`${status}/${packing}/${handover}: marker equals tile`);
  }
 }finally{await f.close();}
});

test('COD outcome matrix: one outcome per parcel, its latest terminal event, RTS included',{timeout:600000},async()=>{
 const f=await returnFixture('cod'),sql=f.identity.sql;
 try{
  const day=86400_000,t0=Date.parse('2026-10-20T17:00:00.000Z'),at=(ms:number)=>new Date(ms).toISOString();
  const ids={refused:randomUUID(),failedThenDelivered:randomUUID(),acrossMidnight:randomUUID(),rts:randomUUID(),delivered:randomUUID()};
  // [parcel, failed?, when]: P = [t0, t0 + 1 day).
  const events:[string,boolean,number][]=[
   [ids.refused,true,t0+3600_000],                                   // refused by the buyer
   [ids.failedThenDelivered,true,t0+3600_000],[ids.failedThenDelivered,false,t0+5*3600_000], // failed attempt, delivered later in the same period
   [ids.acrossMidnight,true,t0-3600_000],[ids.acrossMidnight,false,t0+3600_000],             // failed the day before, delivered after midnight
   [ids.rts,false,t0+3600_000],[ids.rts,true,t0+2*3600_000],                                  // delivered, then returned to sender
   [ids.delivered,false,t0+9*3600_000],
  ];
  const run=async(from:number,to:number)=>{
   const evs=sql`select * from jsonb_to_recordset(${JSON.stringify(events.map(e=>({shipment_id:e[0],failed:e[1],occurred_at:at(e[2])})))}::jsonb) as v(shipment_id uuid,failed boolean,occurred_at timestamptz)`;
   return sql<{shipment_id:string;failed:boolean}[]>`${codOutcomesInPeriod(sql,latestCodOutcomes(sql,evs),at(from),at(to))}`;
  };
  const rowsP=await run(t0,t0+day-1);
  assert.equal(rowsP.length,5,'one outcome per parcel');
  assert.equal(new Set(rowsP.map(r=>r.shipment_id)).size,5);
  const failed=new Set(rowsP.filter(r=>r.failed).map(r=>r.shipment_id));
  assert.deepEqual([...failed].sort(),[ids.refused,ids.rts].sort(),'refused and RTS fail; a failed attempt that was later delivered does not');
  assert.ok(failed.size<=rowsP.length,'numerator <= denominator');
  // The day before: the across-midnight parcel has no terminal outcome yet (its failed attempt is superseded), so it is in neither numerator nor denominator.
  const before=await run(t0-day,t0-1);
  assert.equal(before.length,0,'a parcel falls into exactly one period, dated by its latest terminal event');
  // The next period holds none of them again.
  assert.equal((await run(t0+day,t0+2*day-1)).length,0);
 }finally{await f.close();}
});
