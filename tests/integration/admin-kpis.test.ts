import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {commerceActor} from '../../src/modules/checkout/access.ts';
import {expireOwnedOrderJob} from '../../src/modules/checkout/expiry.ts';
import {handleAutolarisPayments} from '../../src/modules/finance/autolaris-routes.ts';
import {handleCodRemittances} from '../../src/modules/finance/cod-remittance-routes.ts';
import {handleManualTransfers} from '../../src/modules/finance/manual-bank-routes.ts';
import {handleManualFulfillment} from '../../src/modules/fulfillment/manual-routes.ts';
import {advanceFixtureClock,readFixtureClock} from '../../src/modules/local/fixtures.ts';
import {createAttempt} from '../../src/modules/payments/attempts.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {createReturn,decideReturn} from '../../src/modules/returns/cases.ts';
import {ingestParcelReceiptSource,simulateParcelReceipt} from '../../src/modules/returns/receipt-source.ts';
import {handleReporting,LOW_STOCK_THRESHOLD,TRANSFER_DEADLINE_WARNING_HOURS} from '../../src/modules/reporting/service.ts';
import {rupiah,wibDateTime,wibInput,wibInputToIso} from '../../src/modules/storefront/format.ts';
import {handleSupport} from '../../src/modules/support/routes.ts';
import {actor,enroll} from '../contract/access-fixture.ts';
import {closeFulfillmentActor,fulfillmentFixture} from './fulfillment-fixture.ts';
import {paymentFixture} from './payment-fixture.ts';
import {returnFixture} from './return-fixture.ts';
import {shippingFixture} from './shipping-fixture.ts';

// S103: dashboard KPIs count exactly their drilldown queues, terminal states stay out, and admin
// money/time formatting is one IDR formatter and WIB regardless of the device timezone.

type User=Awaited<ReturnType<typeof actor>>;
type Identity=Awaited<ReturnType<typeof paymentFixture>>['identity'];
type Metric={key:string;count:number|null;amount:number|null;kind:string;basis:string;queue_key:string;definition:string;action_href:string|null;breakdown:{key:string;label:string;count:number}[]|null;queue_filter_token:string};
type Snapshot={workspace:string;metrics:Metric[];requested_warehouse_id?:string};
type Row={id:string;state:string;reference:string|null;warehouse_id:string|null};

function withTimezone<T>(tz:string,run:()=>T):T{
 const previous=process.env.TZ;process.env.TZ=tz;
 try{return run();}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
}

test('one IDR formatter: whole rupiah, no decimals, no space',()=>{
 assert.equal(rupiah(99000),'Rp99.000');
 assert.equal(rupiah(0),'Rp0');
 assert.equal(rupiah(1234567),'Rp1.234.567');
 assert.equal(rupiah(1500.6),'Rp1.501','rounded to whole rupiah');
 assert.equal(rupiah(-5000),'-Rp5.000');
});

test('WIB helpers read datetime-local values as Asia/Jakarta (+07:00) whatever the device timezone',()=>{
 for(const tz of ['UTC','America/Los_Angeles','Asia/Jakarta','Pacific/Kiritimati'])withTimezone(tz,()=>{
  assert.equal(wibInputToIso('2026-10-24T13:05'),'2026-10-24T06:05:00.000Z',tz);
  assert.equal(wibInputToIso('2026-10-24T00:30'),'2026-10-23T17:30:00.000Z','00.30 WIB is the previous UTC day');
  assert.equal(wibInputToIso('2026-10-24T23:59'),'2026-10-24T16:59:00.000Z');
  assert.equal(wibInputToIso('2026-10-24T13:05:09'),'2026-10-24T06:05:09.000Z',tz);
  assert.equal(wibInputToIso('2026-10-24'),'2026-10-23T17:00:00.000Z','a date is 00.00 WIB');
  assert.equal(wibInputToIso('2026-01-01T03:00'),'2025-12-31T20:00:00.000Z','crosses the UTC year boundary');
  assert.equal(wibInput('2026-10-23T17:00:00.000Z'),'2026-10-24T00:00');
  assert.equal(wibInput('2026-10-24T06:05:09.000Z',true),'2026-10-24T13:05:09');
  const shown=wibDateTime('2026-10-24T06:05:00.000Z');
  assert.ok(shown.endsWith(' WIB')&&shown.includes('13.05'),shown);
 });
 for(const bad of ['','abc','2026-02-30T10:00','2026-10-24T24:00','2026-13-01','2026-10-24T13:5','2026-10-24 13:05'])assert.equal(wibInputToIso(bad),null,bad);
 // Input values for known instants (what a datetime-local shows for a stored time).
 assert.equal(wibInput('2026-10-23T17:30:00.000Z'),'2026-10-24T00:30');
 assert.equal(wibInput('2026-10-24T16:59:59.999Z'),'2026-10-24T23:59');
});

async function dashboard(identity:Identity,user:User,params:Record<string,string>):Promise<Snapshot>{
 const response=await handleReporting(user.browser.request(`/api/v1/admin/dashboard?${new URLSearchParams(params)}`),identity);
 assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return {...await response.json(),requested_warehouse_id:params.warehouse_id};
}
const metric=(snapshot:Snapshot,key:string)=>{const m=snapshot.metrics.find(x=>x.key===key);assert.ok(m,`${key} present in ${snapshot.workspace}`);return m;};
const part=(m:Metric,key:string)=>m.breakdown?.find(b=>b.key===key)?.count??0;
// Every row behind a count metric's token, across pages.
async function drilldown(identity:Identity,user:User,snapshot:Snapshot,m:Metric){
 const rows:Row[]=[];let cursor:string|null=null;
 do{
  const q=new URLSearchParams({workspace:snapshot.workspace,queue:m.queue_key,filter_token:m.queue_filter_token,limit:'100'});if(cursor)q.set('cursor',cursor);if(snapshot.requested_warehouse_id)q.set('warehouse_id',snapshot.requested_warehouse_id);
  const response=await handleReporting(user.browser.request(`/api/v1/admin/work-queues?${q}`),identity);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  const page=await response.json() as {data:Row[];pagination:{next_cursor:string|null}};rows.push(...page.data);cursor=page.pagination.next_cursor;
 }while(cursor);
 assert.equal(rows.length,m.count,`${m.key}: the card equals its drilldown`);
 return rows;
}

// The plain queue (no KPI token) for an explicit period, across pages.
async function queueAll(identity:Identity,user:User,workspace:string,queue:string,from:string,to:string){
 const rows:Row[]=[];let cursor:string|null=null;
 do{
  const q=new URLSearchParams({workspace,queue,from,to,limit:'100'});if(cursor)q.set('cursor',cursor);
  const response=await handleReporting(user.browser.request(`/api/v1/admin/work-queues?${q}`),identity);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  const page=await response.json() as {data:Row[];pagination:{next_cursor:string|null}};rows.push(...page.data);cursor=page.pagination.next_cursor;
 }while(cursor);
 return rows;
}
const ids=(rows:{id:string}[])=>[...new Set(rows.map(r=>r.id))].sort();

const ACCOUNTS=[{bank_name:'Bank SINTETIS',account_number:'1234567890',account_holder:'PT SINTETIS 99RIBU'}];
type PaymentFixture=Awaited<ReturnType<typeof paymentFixture>>;
async function proof(f:{identity:Identity},user:User,action:string,subject:string){
 const req=user.browser.request('/api/v1/me/reauthentication-proofs',{password:user.password,action,subject_id:subject});req.headers.set('idempotency-key',randomUUID());
 const response=await handleAccess(req,f.identity);assert.equal(response.status,201);return (await response.json()).proof as string;
}
// Owner payment terms with a manual-bank account (same flow as payment-methods.test.ts); restored afterwards.
async function withManualBank(f:PaymentFixture){
 const read=async()=>(await (await f.owner.browser.access('/admin/policy-versions?kind=payment')).json()) as {latest_version:number;current:{values:Record<string,unknown>}|null};
 const write=async(values:Record<string,unknown>,reason:string)=>{const history=await read();
  const req=f.owner.browser.request('/api/v1/admin/policy-versions',{kind:'payment',warehouse_id:null,expected_version:history.latest_version,effective_at:null,values,reason,reauthentication_proof:await proof(f,f.owner,'payment_policy.version','company-payment')});
  req.headers.set('idempotency-key',randomUUID());const response=await handleAccess(req,f.identity);assert.equal(response.status,201,JSON.stringify(await response.clone().json()));};
 const original=(await read()).current?.values??{cod_fee_bps:0,manual_bank_accounts:[]};
 await write({cod_fee_bps:0,manual_bank_accounts:ACCOUNTS},'SYNTHETIC S103 manual bank terms');
 const clock=await readFixtureClock('test',f.namespace),[wall]=await f.identity.sql`select clock_timestamp() now`;
 await advanceFixtureClock('test',f.namespace,Math.max(1,Math.ceil((new Date(wall.now).getTime()-Date.parse(clock.now))/1000)+5),clock.version);
 return ()=>write(original,'SYNTHETIC S103 restore previous payment terms');
}
async function financeUser(identity:Identity,users:User[]){
 const user=await actor(identity,'finance',[]);users.push(user);await enroll(user.browser,user.password);
 await identity.sql`update app.role_grant set permissions=${['finance.reconciliation.read','finance.reconciliation.write']} where user_id=${user.id}`;return user;
}

test('orders: active counts exclude terminal states; per payment method, near-deadline transfers and open AutoLaris payments match their drilldowns; WIB transfer time decides timeliness',async()=>{
 const f=await paymentFixture(),sql=f.identity.sql,users:User[]=[];let restore:(()=>Promise<void>)|undefined;
 try{
  restore=await withManualBank(f);
  const clock0=Date.parse((await readFixtureClock('test',f.namespace)).now),[wall]=await sql`select clock_timestamp() now`;
  const window={from:new Date(clock0-3600_000).toISOString(),to:new Date(Math.max(clock0,new Date(wall.now).getTime())+2*86400_000).toISOString(),as_of:new Date(new Date(wall.now).getTime()+60_000).toISOString()};
  const before=await dashboard(f.identity,f.owner,{workspace:'owner',...window});

  const cod=(await f.order(1,'cod')).order,simulated=(await f.order(1,'prepaid')).order,auto=(await f.order(1,'prepaid','autolaris')).order,manual=(await f.order(1,'prepaid','manual-bank')).order;
  await sql.begin(tx=>createAttempt(tx,auto.id,randomUUID(),{method_id:'autolaris',channel_code:'VABNI'}));
  const attempt=await sql.begin(tx=>createAttempt(tx,manual.id,randomUUID(),{method_id:'manual-bank'}));
  const [created]=await sql`select creation_job_id,expires_at from app.payment_attempt where id=${attempt.id}`;
  assert.equal(await runOneJob(sql,{'payment.create':paymentAdapter(sql,'test')},created.creation_job_id),true);
  // The simulated prepaid order lapses: cancelled is terminal.
  const c=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,1860,c.version);
  const [expiry]=await sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${simulated.id}`;
  await sql.begin(tx=>expireOwnedOrderJob(tx,{id:expiry.id,kind:expiry.kind,payload:expiry.payload}));
  assert.equal((await sql`select status from app.commerce_order where id=${simulated.id}`)[0].status,'cancelled');

  const after=await dashboard(f.identity,f.owner,{workspace:'owner',...window});
  const delta=(key:string)=>Number(metric(after,key).count)-Number(metric(before,key).count);
  const byMethod=[metric(before,'orders_by_payment_method'),metric(after,'orders_by_payment_method')];
  assert.equal(delta('orders_by_payment_method'),4,'every placed order counts, cancelled included');
  for(const channel of ['cod','manual-bank','autolaris','local-prepaid'])assert.equal(part(byMethod[1],channel)-part(byMethod[0],channel),1,channel);
  assert.equal(byMethod[1].breakdown?.reduce((n,b)=>n+b.count,0),byMethod[1].count,'the split adds up to the card');
  assert.deepEqual(byMethod[1].breakdown?.slice(0,3).map(b=>b.label),['COD','Transfer manual','VA/QRIS AutoLaris']);
  assert.equal(delta('orders_pending'),3,'the cancelled order is not active');
  assert.equal(delta('autolaris_pending'),1);
  assert.equal(metric(after,'autolaris_pending').basis,'snapshot');

  const active=await drilldown(f.identity,f.owner,after,metric(after,'orders_pending'));
  assert.ok(active.every(r=>['pending','processing'].includes(r.state)),'no terminal order in the active queue');
  for(const order of [cod,auto,manual])assert.ok(active.some(r=>r.id===order.id));
  assert.ok(!active.some(r=>r.id===simulated.id));
  const placed=await drilldown(f.identity,f.owner,after,byMethod[1]);assert.ok(placed.some(r=>r.id===simulated.id));
  const open=await drilldown(f.identity,f.owner,after,metric(after,'autolaris_pending'));assert.ok(open.some(r=>r.id===auto.id)&&!open.some(r=>r.id===manual.id));
  assert.equal(metric(after,'autolaris_pending').action_href,'/admin/payments');
  // The two payment KPIs are exactly the finance queues (S92/S93), company-wide.
  const finance=await financeUser(f.identity,users);
  const financeQueue=async(path:string,handle:typeof handleManualTransfers)=>{const response=await handle(finance.browser.request(path),f.identity);assert.equal(response.status,200);
   const rows=(await response.json()).data as {order_id:string;expires_at:string}[];assert.ok(rows.length<100,'the finance queue fits one page');return rows;};
  assert.deepEqual(ids(open),[...new Set((await financeQueue('/api/v1/admin/autolaris-payments?state=open&limit=100',handleAutolarisPayments)).map(t=>t.order_id))].sort(),'autolaris_pending equals the open AutoLaris queue');

  // Near the 24 h deadline: in at (deadline - N + 1 h), out at (deadline - N - 1 h).
  const deadline=new Date(created.expires_at).getTime(),near=async(hoursBefore:number)=>{
   const asOf=deadline-hoursBefore*3600_000;
   const snap=await dashboard(f.identity,f.owner,{workspace:'owner',from:window.from,to:window.to,as_of:new Date(asOf).toISOString()});
   const rows=await drilldown(f.identity,f.owner,snap,metric(snap,'transfers_near_deadline'));
   const queue=(await financeQueue('/api/v1/admin/manual-transfers?state=open&limit=100',handleManualTransfers)).filter(t=>Date.parse(t.expires_at)<=asOf+TRANSFER_DEADLINE_WARNING_HOURS*3600_000);
   assert.deepEqual(ids(rows),[...new Set(queue.map(t=>t.order_id))].sort(),'transfers_near_deadline equals the open transfer queue due by then');
   return rows.some(r=>r.id===manual.id);
  };
  assert.equal(await near(TRANSFER_DEADLINE_WARNING_HOURS-1),true);
  assert.equal(await near(TRANSFER_DEADLINE_WARNING_HOURS+1),false);
  assert.equal(await near(-1),true,'past due but not yet cancelled still needs finance');

  // WIB conversion: finance types the bank statement's WIB time one minute before the deadline.
  // Read as WIB it is on time; the old device-time reading (here a UTC device) lands 7 h later, after the deadline.
  const typed=wibInput(deadline-60_000),onTime=withTimezone('UTC',()=>wibInputToIso(typed));
  // Independent oracle: the same wall time with an explicit +07:00 offset, parsed by Date itself.
  assert.equal(onTime,new Date(`${typed}:00+07:00`).toISOString());
  assert.ok(onTime&&Date.parse(onTime)<deadline);
  assert.ok(withTimezone('UTC',()=>new Date(typed).getTime())>=deadline,'device-time parsing would mark the transfer late');
  const k=await readFixtureClock('test',f.namespace);await advanceFixtureClock('test',f.namespace,Math.ceil((deadline-Date.parse(k.now))/1000)+120,k.version);
  const [{expected_amount}]=await sql`select expected_amount from app.payment_attempt where id=${attempt.id}`;
  const req=finance.browser.request(`/api/v1/admin/manual-transfers/${attempt.id}/confirmations`,{amount:Number(expected_amount),bank_reference:`BCA-${randomUUID().slice(0,8)}`,account_number:'1234567890',transferred_at:onTime,late_transfer:false,evidence:'Mutasi rekening (WIB)',reason:'Cocok dengan mutasi',reauthentication_proof:await proof(f,finance,'finance.reconcile',attempt.id)});
  req.headers.set('idempotency-key',randomUUID());const confirmed=await handleManualTransfers(req,f.identity);
  assert.equal(confirmed.status,201,JSON.stringify(await confirmed.clone().json()));
  const body=await confirmed.json();assert.equal(body.confirmation.late_transfer,false);assert.equal(body.confirmation.transferred_at,onTime);
  assert.equal(await near(-1),false,'a confirmed transfer leaves the near-deadline count');
 }finally{for(const user of users)await closeFulfillmentActor(f.identity,user).catch(()=>{});try{await restore?.();}finally{await f.close();}}
});

test('fulfillment: due excludes handed-over parcels, manual booking equals the S91 queue, COD outstanding moves to remitted; role scoping is unchanged',async()=>{
 const f=await fulfillmentFixture('cod'),sql=f.identity.sql,users:User[]=[];
 try{
  const [parcel]=f.parcels,warehouse=String(parcel.warehouse_id),[order]=await sql`select created_at from app.commerce_order where id=${f.order.id}`,[wall]=await sql`select clock_timestamp() now`;
  // Fixture business clocks may run ahead of the wall clock: the period spans both (order time, statement date).
  const created=new Date(order.created_at).getTime(),now=new Date(wall.now).getTime();
  const scope={workspace:'owner',warehouse_id:warehouse,from:new Date(Math.min(created,now)-3600_000).toISOString(),to:new Date(Math.max(created,now)+86400_000).toISOString()};
  const manualQueue=async()=>{const response=await handleManualFulfillment(f.owner.browser.request(`/api/v1/admin/manual-shipments?queue=to_book&warehouse_id=${warehouse}&limit=100`),f.identity);assert.equal(response.status,200);
   const page=await response.json();assert.equal(page.pagination.next_cursor,null);return (page.data as {id:string}[]).map(r=>r.id).sort();};

  const s0=await dashboard(f.identity,f.owner,scope),booking0=metric(s0,'manual_booking_pending');
  assert.deepEqual((await drilldown(f.identity,f.owner,s0,booking0)).map(r=>r.id).sort(),await manualQueue(),'same parcels as "Perlu dipesan kurir"');
  assert.ok((await drilldown(f.identity,f.owner,s0,metric(s0,'fulfillments_due'))).some(r=>r.id===parcel.id));
  assert.equal(booking0.action_href,'/admin/fulfillment');assert.equal(booking0.basis,'snapshot');
  const [{cod_due}]=await sql`select cod_due from app.order_shipment where id=${parcel.shipment_id}`,due=Number(cod_due);assert.ok(due>0);

  const ship=f.owner.browser.request(`/api/v1/admin/fulfillments/${parcel.id}/manual-shipment`,{expected_version:parcel.revision,courier:'jne',tracking_number:`JP${String(Date.now()).slice(-8)}03`});
  ship.headers.set('idempotency-key',randomUUID());assert.equal((await handleManualFulfillment(ship,f.identity)).status,201);
  const s1=await dashboard(f.identity,f.owner,scope),diff=(a:Snapshot,b:Snapshot,key:string)=>Number(metric(b,key).count??metric(b,key).amount)-Number(metric(a,key).count??metric(a,key).amount);
  assert.equal(diff(s0,s1,'manual_booking_pending'),-1);
  assert.deepEqual((await drilldown(f.identity,f.owner,s1,metric(s1,'manual_booking_pending'))).map(r=>r.id).sort(),await manualQueue());
  assert.equal(diff(s0,s1,'fulfillments_due'),-1,'handed_over is terminal');
  const dueRows=await drilldown(f.identity,f.owner,s1,metric(s1,'fulfillments_due'));
  assert.ok(!dueRows.some(r=>r.id===parcel.id)&&dueRows.every(r=>r.state!=='handed_over'));
  assert.equal(diff(s0,s1,'cod_receivable'),due,'a shipped COD parcel is outstanding');
  assert.equal(diff(s0,s1,'cod_remitted'),0);

  const finance=await financeUser(f.identity,users),id=randomUUID();
  const body={id,reference:`MGT-S103-${String(Date.now()).slice(-8)}`,statement_at:new Date(Date.now()-60_000).toISOString(),lines:[{shipment_id:parcel.shipment_id,amount:due}],shipping_deduction:0,cod_fee_deduction:0,other_deduction:0,net_amount:due,evidence:'Laporan saldo COD Mengantar',reason:'Setoran COD'};
  const req=finance.browser.request('/api/v1/admin/cod-remittances',{...body,reauthentication_proof:await proof(f,finance,'finance.reconcile',id)});req.headers.set('idempotency-key',randomUUID());
  const recorded=await handleCodRemittances(req,f.identity);assert.equal(recorded.status,201,JSON.stringify(await recorded.clone().json()));
  const s2=await dashboard(f.identity,f.owner,scope);
  assert.equal(diff(s1,s2,'cod_receivable'),-due,'a parcel on a Mengantar statement is no longer outstanding');
  assert.equal(diff(s1,s2,'cod_remitted'),due);
  assert.equal(metric(s2,'cod_remitted').action_href,'/admin/cod-settlements');
  assert.equal(metric(s2,'cod_receivable').basis,'snapshot');
  // Money is company-wide for owner/finance: the warehouse filter narrows counts only.
  const {warehouse_id:_scoped,...companyScope}=scope,company=await dashboard(f.identity,f.owner,companyScope);
  for(const key of ['cod_receivable','cod_remitted'])assert.equal(metric(company,key).amount,metric(s2,key).amount,key);

  // finance_unmatched leaves out matched settlements: settle the statement (seeded terminal state).
  for(const job of await sql`select p.callback_job_id id from app.cod_remittance_line l join app.local_cod_event e on e.operation_id=l.cod_operation_id join app.cod_provider_event p on p.id=e.id where l.remittance_id=${id}`)await f.run(job.id);
  const [remittance]=await sql`select match_job_id,settlement_operation_id from app.cod_remittance where id=${id}`;await f.run(remittance.match_job_id);
  for(const job of await sql`select callback_job_id id from app.settlement_provider_event where operation_id=${remittance.settlement_operation_id} order by id`){
   const [state]=await sql`select status from app.outbox_job where id=${job.id}`;if(state.status==='pending')await f.run(job.id);
  }
  const [settlement]=await sql`select id,status from app.provider_settlement where operation_id=${remittance.settlement_operation_id}`;
  assert.equal(settlement.status,'matched');
  const s3=await dashboard(f.identity,f.owner,companyScope);
  assert.ok(!(await drilldown(f.identity,f.owner,s3,metric(s3,'finance_unmatched'))).some(r=>r.id===settlement.id),'a matched settlement is not unmatched');
  assert.ok((await queueAll(f.identity,f.owner,'owner','reconciliation',scope.from,scope.to)).some(r=>r.id===settlement.id&&r.state==='matched'),'it stays in the plain queue');

  // Role scoping: warehouse sees its warehouses and counts only; money only for owner/finance.
  const staff=await actor(f.identity,'warehouse',[warehouse]);users.push(staff);await enroll(staff.browser,staff.password);
  const wh=await dashboard(f.identity,staff,{workspace:'warehouse'});
  assert.deepEqual(wh.metrics.map(m=>m.key),['fulfillments_due','manual_booking_pending','delivery_exceptions','returns_pending','stock_alerts']);
  assert.ok(wh.metrics.every(m=>m.kind==='count'&&m.amount===null));
  assert.equal(metric(wh,'manual_booking_pending').count,metric(s2,'manual_booking_pending').count,'same snapshot for the assigned warehouse');
  const other=f.parcels.find(p=>String(p.warehouse_id)!==warehouse);
  if(other)assert.equal((await handleReporting(staff.browser.request(`/api/v1/admin/dashboard?workspace=warehouse&warehouse_id=${other.warehouse_id}`),f.identity)).status,403);
  const fin=await dashboard(f.identity,finance,{workspace:'finance'});
  assert.deepEqual(fin.metrics.map(m=>m.key),['finance_unmatched','orders_by_payment_method','transfers_near_deadline','autolaris_pending','cod_receivable','cod_remitted','refund_liability','affiliate_liability','estimated_contribution','realized_contribution','net_merchandise_revenue']);
  const admin=await actor(f.identity,'ecommerce_admin',[warehouse]);users.push(admin);await enroll(admin.browser,admin.password);
  const ecom=await dashboard(f.identity,admin,{workspace:'ecommerce_admin'});
  assert.ok(ecom.metrics.every(m=>m.kind==='count'));assert.ok(!ecom.metrics.some(m=>['transfers_near_deadline','autolaris_pending'].includes(m.key)));
  const cs=await actor(f.identity,'customer_service',[]);users.push(cs);await enroll(cs.browser,cs.password);
  assert.deepEqual((await dashboard(f.identity,cs,{workspace:'customer_service'})).metrics.map(m=>m.key),['orders_pending','delivery_exceptions','returns_pending','support_unassigned']);
  assert.equal((await handleReporting(admin.browser.request('/api/v1/admin/dashboard?workspace=ecommerce_admin&metric=cod_remitted'),f.identity)).status,403);
 }finally{for(const user of users)await closeFulfillmentActor(f.identity,user).catch(()=>{});await f.close();}
});

test('low stock is one row per warehouse SKU, quarantine-aware availability, split per origin warehouse',async()=>{
 const f=await shippingFixture(),sql=f.identity.sql;
 try{
  const positionKey='fixture-malang:fixture-cream',[position]=await sql`select b.warehouse_id::text warehouse_id,b.stock_item_id,s.sku from app.inventory_balance b join app.stock_item s on s.id=b.stock_item_id where b.id=${f.seeded.positions[positionKey]}`;
  const warehouse=String(position.warehouse_id);
  const available=async()=>Number((await sql`select sum(on_hand-reserved-quarantined)::int n from app.inventory_balance where warehouse_id=${warehouse} and stock_item_id=${position.stock_item_id}`)[0].n);
  const start=await available();assert.ok(start>=LOW_STOCK_THRESHOLD+2,`fixture cream has ${start} available`);
  const alerts=async()=>{const snap=await dashboard(f.identity,f.owner,{workspace:'owner',warehouse_id:warehouse});const m=metric(snap,'stock_alerts');
   const rows=await drilldown(f.identity,f.owner,snap,m);assert.equal(new Set(rows.map(r=>r.reference)).size,rows.length,'one row per SKU in the warehouse, not per lot');
   assert.equal(m.basis,'snapshot');assert.deepEqual(m.breakdown?.map(b=>[b.key,b.count]),rows.length?[[warehouse,rows.length]]:[]);
   return {count:Number(m.count),row:rows.find(r=>r.reference===position.sku)};};
  const s0=await alerts();assert.equal(s0.row,undefined,'cream starts in stock');
  // Some quarantined units alone are no alert while enough stay available.
  await f.move(positionKey,'quarantine',1);
  const s1=await alerts();assert.equal(s1.count,s0.count);assert.equal(s1.row,undefined);
  // Quarantine down to the threshold: quarantined units are not available.
  await f.move(positionKey,'quarantine',start-1-LOW_STOCK_THRESHOLD);assert.equal(await available(),LOW_STOCK_THRESHOLD);
  const s2=await alerts();assert.equal(s2.count,s0.count+1);assert.equal(s2.row?.state,'low_stock');
  const named=await dashboard(f.identity,f.owner,{workspace:'owner',warehouse_id:warehouse});
  const [{name}]=await sql`select name from app.warehouse where id=${warehouse}`;assert.equal(metric(named,'stock_alerts').breakdown?.[0]?.label,name);
 }finally{await f.close();}
});

// Terminal states for the small queues: the card's drilldown is the plain queue minus terminal
// states, with seeded terminal rows: a rejected return, a resolved conversation (matched settlements
// are seeded in the fulfillment test). No fixture resolves a delivery exception, so that metric
// requires at least one resolved exception to exist in the period.
test('open exceptions, returns, settlements and unassigned conversations exclude terminal states',async()=>{
 const f=await returnFixture('prepaid'),sql=f.identity.sql,conversations:string[]=[];
 try{
  const origin='http://127.0.0.1:3099';let cookie='';
  const guest=async(path:string,body:Record<string,unknown>)=>{
   const headers=new Headers({origin,'idempotency-key':randomUUID(),'content-type':'application/json'});if(cookie)headers.set('cookie',cookie);
   const response=await handleSupport(new Request(`${origin}${path}`,{method:'POST',headers,body:JSON.stringify(body)}),f.identity);
   for(const raw of response.headers.getSetCookie()){const [pair]=raw.split(';');cookie=cookie?`${cookie}; ${pair}`:pair;}
   return {status:response.status,payload:await response.json()};
  };
  const product=f.seeded.products['fixture-offer-shirt'];
  // One guest session per conversation (a session reuses its open conversation).
  for(let n=0;n<2;n++){cookie='';assert.equal((await guest('/api/v1/guest-support-sessions',{client_request_id:`req-${randomUUID()}`})).status,201);
   const created=await guest('/api/v1/support/conversations',{client_conversation_id:`conv-${randomUUID()}`,product_id:product});assert.equal(created.status,200,JSON.stringify(created.payload));conversations.push(created.payload.id);}
  assert.notEqual(conversations[0],conversations[1]);
  const [stillOpen,resolved]=conversations;
  const [{revision}]=await sql`select revision from app.support_conversation where id=${resolved}`;
  const req=f.owner.browser.request(`/api/v1/admin/support/conversations/${resolved}/status`,{status:'resolved',expected_version:Number(revision),reason:'SYNTHETIC S103 terminal state'});req.headers.set('idempotency-key',randomUUID());
  assert.equal((await handleSupport(req,f.identity)).status,200);

  // A buyer-received parcel, a return claim and a rejection (return-lifecycle.test.ts flow).
  for(const booking of f.bookings){
   const parcel=f.parcels.find(p=>p.id===booking.fulfillment_id);assert.ok(parcel);
   await f.run(await ingestParcelReceiptSource(sql,await simulateParcelReceipt(sql,'test',{reference:randomUUID(),booking_id:booking.id,unit_ids:f.units.filter(u=>u.shipment_id===parcel.shipment_id).map(u=>u.id)})));
  }
  const buyer=await commerceActor(f.client.request('/api/v1/carts'),f.identity);assert.ok(buyer);
  const unit=f.units[0],claim={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'damaged',details:'SYNTHETIC S103 terminal return'}],requested_resolution:'refund'};
  const returned=await createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`,claim,{key:randomUUID()}),f.identity,buyer,f.order.id,claim) as {id:string;status:string};
  assert.equal(returned.status,'requested');
  const decision={decision:'reject',expected_version:1,reason:'SYNTHETIC S103 terminal return'},decide=f.owner.browser.request(`/api/v1/admin/returns/${returned.id}/decisions`,decision);decide.headers.set('idempotency-key',randomUUID());
  assert.equal((await decideReturn(decide,f.identity,f.principal,returned.id,decision) as {status:string}).status,'rejected');

  const [wall]=await sql`select clock_timestamp() now`,[{created_at}]=await sql`select created_at from app.return_case where id=${returned.id}`;
  const now=new Date(wall.now).getTime(),latest=Math.max(now,new Date(created_at).getTime());
  const period={from:new Date(latest-360*86400_000).toISOString(),to:new Date(latest+86400_000).toISOString()};
  const snap=await dashboard(f.identity,f.owner,{workspace:'owner',...period});
  const terminal:Record<string,string[]>={delivery_exceptions:['resolved'],returns_pending:['rejected','resolved'],finance_unmatched:['matched']};
  for(const [key,states] of Object.entries(terminal)){
   const m=metric(snap,key),card=await drilldown(f.identity,f.owner,snap,m),plainRows=await queueAll(f.identity,f.owner,'owner',m.queue_key,period.from,period.to);
   assert.ok(plainRows.some(r=>states.includes(r.state)),`${key}: the period holds at least one terminal row, so the exclusion is exercised`);
   assert.ok(card.every(r=>!states.includes(r.state)),`${key}: no terminal row`);
   assert.deepEqual(ids(card),ids(plainRows.filter(r=>!states.includes(r.state))),`${key}: plain queue minus terminal states`);
  }
  const returns=await drilldown(f.identity,f.owner,snap,metric(snap,'returns_pending'));
  assert.ok(!returns.some(r=>r.id===returned.id),'the rejected return is not open');
  const support=await drilldown(f.identity,f.owner,snap,metric(snap,'support_unassigned'));
  assert.ok(support.some(r=>r.id===stillOpen),'an open unassigned conversation counts');
  assert.ok(!support.some(r=>r.id===resolved),'a resolved conversation does not');
  const plain=await queueAll(f.identity,f.owner,'owner','support',period.from,period.to);
  assert.ok(plain.some(r=>r.id===resolved));
  assert.ok(support.every(r=>plain.some(p=>p.id===r.id&&p.state==='unassigned')));
 }finally{
  // Same teardown as support-chat.test.ts; a refused delete fails the test instead of hiding.
  try{
   if(conversations.length){
    for(const table of ['support_in_app_notification','support_challenge','support_conversation_tag','support_participant_preference','support_assignment_event','support_read_position','support_internal_note','support_context_card','support_attachment','support_message'])
     await sql`delete from ${sql(`app.${table}`)} where conversation_id in ${sql(conversations)}`;
    await sql`delete from app.support_conversation where id in ${sql(conversations)}`;
   }
  }finally{await f.close();}
 }
});
