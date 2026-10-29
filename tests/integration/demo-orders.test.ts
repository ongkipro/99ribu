import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {createLocalAuth} from '../../src/modules/access/auth.ts';
import {getPrincipal} from '../../src/modules/access/policy.ts';
import {handleAccess} from '../../src/modules/access/routes.ts';
import {projectOrder} from '../../src/modules/checkout/orders.ts';
import {handleManualTransfers} from '../../src/modules/finance/manual-bank-routes.ts';
import {handleManualFulfillment} from '../../src/modules/fulfillment/manual-routes.ts';
import {createMovement} from '../../src/modules/inventory/positions.ts';
import {seedCommerce} from '../../src/modules/local/commerce.ts';
import {runDemoOrders} from '../../src/modules/local/demo-orders.ts';
import {prepareStorefront} from '../../src/modules/local/storefront.ts';
import {handleReturns} from '../../src/modules/returns/routes.ts';
import {handleSupport} from '../../src/modules/support/routes.ts';
import {actor,cleanup,enroll} from '../contract/access-fixture.ts';

// The local demo order fixture, run against the TEST database in its own namespace: every scenario is
// reached through the real flows and is visible in the buyer order projection and the admin queues.
const identity=createLocalAuth('test'),sql=identity.sql,namespace=`demo-${randomUUID().slice(0,8)}`;
const ACCOUNT={bank_name:'Bank SINTETIS',account_number:'1234567890',account_holder:'PT SINTETIS 99RIBU'};

test('demo-orders fixture creates every order state through the real flows, idempotently per namespace',{timeout:900000},async()=>{
 const owner=await actor(identity,'owner',[]);await enroll(owner.browser,owner.password);
 const proof=async(action:string,subject:string)=>{const request=owner.browser.request('/api/v1/me/reauthentication-proofs',{password:owner.password,action,subject_id:subject});request.headers.set('idempotency-key',randomUUID());
  const response=await handleAccess(request,identity);assert.equal(response.status,201);return (await response.json()).proof as string;};
 const readTerms=async()=>(await (await owner.browser.access('/admin/policy-versions?kind=payment')).json()) as {latest_version:number;current:{values:Record<string,unknown>}|null};
 const writeTerms=async(values:Record<string,unknown>,reason:string)=>{const history=await readTerms();
  const request=owner.browser.request('/api/v1/admin/policy-versions',{kind:'payment',warehouse_id:null,expected_version:history.latest_version,effective_at:null,values,reason,reauthentication_proof:await proof('payment_policy.version','company-payment')});
  request.headers.set('idempotency-key',randomUUID());const response=await handleAccess(request,identity);assert.equal(response.status,201,JSON.stringify(await response.clone().json()));};
 const original=(await readTerms()).current?.values??{cod_fee_bps:0,manual_bank_accounts:[]};let written=0;
 try{
  // DEC-008/009 terms for the run, and a namespaced sellable catalog (the TEST database has no DEC-005 stock).
  await writeTerms({cod_fee_bps:333,manual_bank_accounts:[ACCOUNT]},'SYNTHETIC demo-orders fixture payment terms');written=(await readTerms()).latest_version;
  const command=()=>owner.browser.request('/api/v1/admin/local-fixture-command');
  const seeded=await seedCommerce(command(),identity,'test',namespace);const curated=await prepareStorefront(command(),identity,'test',namespace,seeded);
  const shirt=curated.products.shirt;assert.ok(shirt.publication_id,'the sample shirt is published');
  const [position]=await sql`select warehouse_id,stock_item_id,revision from app.inventory_balance where id=${seeded.positions['fixture-malang:fixture-shirt']}`;
  const receive=owner.browser.request('/api/v1/admin/inventory/movements',{});receive.headers.set('idempotency-key',randomUUID());
  await createMovement(receive,identity,await getPrincipal(receive,identity),{warehouse_id:position.warehouse_id,stock_item_id:position.stock_item_id,kind:'receive',quantity:60,expected_version:Number(position.revision),reason:'SYNTHETIC demo-orders stock'});

  const first=await runDemoOrders('test',namespace,{offers:[{product_id:shirt.id,offer_id:shirt.offer_id}]});
  const rows=new Map(first.orders.map(row=>[row.scenario,row]));
  const scenarios=['transfer_confirmed','delivered','return_requested','return_decided','transfer_expired','transfer_near_deadline','transfer_awaiting','autolaris_pending','autolaris_paid',
   'cod_awaiting_booking','manual_shipped','in_transit','cod_remitted','cod_refused','cod_partial_cancel','support_conversation','affiliate_order'];
  assert.deepEqual([...rows.keys()].sort(),[...scenarios].sort());
  for(const row of first.orders)assert.ok(row.order_number,`${row.scenario}: ${row.detail}`);
  const ids=new Map<string,string>(),idOf=(key:string)=>{const value=ids.get(key);assert.ok(value,key);return value;};
  for(const row of first.orders)ids.set(row.scenario,String((await sql`select id from app.commerce_order where number=${row.order_number}`)[0].id));
  const order=(key:string)=>sql.begin(tx=>projectOrder(tx,idOf(key)));
  const parcel=async(key:string)=>(await order(key)).shipments[0] as Record<string,unknown>;
  const staff=async(handler:(request:Request,identity:ReturnType<typeof createLocalAuth>)=>Promise<Response>,path:string)=>{const response=await handler(owner.browser.request(path),identity);assert.equal(response.status,200,path);return response.json();};

  // Payments: buyer projection plus the finance transfer queue.
  const awaiting=await order('transfer_awaiting');assert.deepEqual([awaiting.status,awaiting.payment_status,awaiting.payment_channel],['pending','pending','manual-bank']);
  const hours=(at:string,from:number)=>(Date.parse(at)-from)/3600000;
  assert.ok(hours(awaiting.expires_at,Date.now())>23&&hours(awaiting.expires_at,Date.now())<=24,'awaiting transfer: 24 h window from now');
  const anchor=Date.parse(first.anchor as string),near=await order('transfer_near_deadline');
  assert.equal(near.payment_status,'pending');assert.ok(hours(near.expires_at,anchor)>0&&hours(near.expires_at,anchor)<6,'near deadline: under 6 h left at the fixture anchor');
  const open=(await staff(handleManualTransfers,'/api/v1/admin/manual-transfers?state=open&limit=100')).data as {order_id:string;expires_at:string}[];
  for(const key of ['transfer_awaiting','transfer_near_deadline'])assert.ok(open.some(t=>t.order_id===idOf(key)),`${key} is in the open transfer queue`);
  const resolved=(await staff(handleManualTransfers,'/api/v1/admin/manual-transfers?state=resolved&limit=100')).data as {order_id:string;confirmation:{outcome:string}}[];
  assert.ok(resolved.some(t=>t.order_id===idOf('transfer_confirmed')),'the confirmed transfer is in the resolved queue');
  const expired=await order('transfer_expired');assert.deepEqual([expired.status,expired.payment_status],['cancelled','expired']);
  assert.equal((await order('transfer_confirmed')).payment_status,'confirmed');
  const pendingVa=await order('autolaris_pending');assert.deepEqual([pendingVa.payment_channel,pendingVa.payment_status],['autolaris','pending']);
  assert.equal((await sql`select count(*)::int n from app.autolaris_payment l join app.payment_attempt a on a.id=l.attempt_id where a.order_id=${idOf('autolaris_pending')} and l.trx_id is not null`)[0].n,1,'the VA was issued');
  const paidQr=await order('autolaris_paid');assert.deepEqual([paidQr.payment_channel,paidQr.payment_status],['autolaris','confirmed']);

  // Manual fulfillment queue and the buyer's courier/resi/tracking view.
  const booking=await sql`select f.id,s.warehouse_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${idOf('cod_awaiting_booking')}`;
  const queue=(await staff(handleManualFulfillment,`/api/v1/admin/manual-shipments?queue=to_book&warehouse_id=${booking[0].warehouse_id}&limit=100`)).data as {id:string;booking:{cod_amount_due:number;cancelled_units:number}}[];
  assert.ok(queue.some(p=>p.id===booking[0].id),'COD parcel waits in "Perlu dipesan kurir"');
  const shipped=await parcel('manual_shipped');assert.equal(shipped.status,'handed_over');assert.ok(shipped.tracking_number);
  assert.equal((await sql`select count(*)::int n from app.fulfillment_purchase_reference r join app.fulfillment f on f.id=r.fulfillment_id join app.order_shipment s on s.id=f.shipment_id where s.order_id=${idOf('manual_shipped')}`)[0].n,1,'Berlapak reference stored');
  assert.equal((await parcel('in_transit')).tracking_status,'in_transit');
  for(const key of ['delivered','return_requested','return_decided','cod_remitted'])assert.equal((await parcel(key)).status,'delivered',key);
  const remitted=await order('cod_remitted');assert.equal(remitted.payment_status,'confirmed','the COD remittance posted the collection');
  assert.equal((await sql`select ps.status from app.cod_remittance_line l join app.cod_remittance r on r.id=l.remittance_id join app.provider_settlement ps on ps.operation_id=r.settlement_operation_id join app.order_shipment s on s.id=l.shipment_id where s.order_id=${idOf('cod_remitted')}`)[0].status,'matched');
  assert.equal((await parcel('cod_refused')).tracking_status,'failed');
  assert.equal((await sql`select r.outcome from app.cod_event_result r join app.local_cod_event e on e.id=r.event_id join app.local_cod_operation o on o.id=e.operation_id join app.order_shipment s on s.id=o.shipment_id where s.order_id=${idOf('cod_refused')}`)[0].outcome,'refused');
  const partial=await order('cod_partial_cancel');assert.equal(partial.items[0].cancelled_quantity,1);
  const reduced=await sql`select f.id,s.warehouse_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${idOf('cod_partial_cancel')}`;
  const reducedRow=((await staff(handleManualFulfillment,`/api/v1/admin/manual-shipments?queue=to_book&warehouse_id=${reduced[0].warehouse_id}&limit=100`)).data as {id:string;booking:{cod_amount_due:number;cancelled_units:number}}[]).find(p=>p.id===reduced[0].id);
  assert.ok(reducedRow,'the partially cancelled parcel still waits for booking');assert.equal(reducedRow.booking.cancelled_units,1);
  assert.ok(reducedRow.booking.cod_amount_due<Number(partial.shipments[0].cod_collect_amount),'S99: booking shows the reduced COD basis');

  // Returns, support and affiliate projections.
  const returns=async(key:string)=>(await sql`select id from app.return_case where order_id=${idOf(key)}`)[0].id as string;
  assert.equal((await staff(handleReturns,`/api/v1/admin/returns/${await returns('return_requested')}`)).status,'requested');
  assert.equal((await staff(handleReturns,`/api/v1/admin/returns/${await returns('return_decided')}`)).status,'awaiting_goods');
  const [conversation]=await sql`select id from app.support_conversation where primary_order_id=${idOf('support_conversation')}`;assert.ok(conversation,'support conversation linked to the order');
  assert.ok(JSON.stringify(await staff(handleSupport,'/api/v1/admin/support/conversations')).includes(String(conversation.id)),'the staff support inbox lists it');
  assert.equal(idOf('support_conversation'),idOf('in_transit'),'the conversation is about the in-transit order');
  const [attribution]=await sql`select a.user_id from app.order_attribution t join app.affiliate_account a on a.id=t.affiliate_id where t.order_id=${idOf('affiliate_order')}`;
  assert.ok(attribution,'affiliate attribution recorded');
  assert.ok((await sql`select count(*)::int n from app.commission_entry where order_id=${idOf('affiliate_order')}`)[0].n>=1,'commission accrued');

  // Rerun: same orders, nothing new.
  const second=await runDemoOrders('test',namespace,{offers:[{product_id:shirt.id,offer_id:shirt.offer_id}]});
  assert.deepEqual(second.orders.map(r=>[r.scenario,r.order_number]),first.orders.map(r=>[r.scenario,r.order_number]));
  assert.equal((await sql`select count(*)::int n from app.audit_event where actor_id=${`local-demo-orders:${namespace}`} and action='local_fixture.demo_order'`)[0].n,16);
 }finally{
  try{if(written&&(await readTerms()).latest_version===written)await writeTerms(original,'SYNTHETIC demo-orders fixture finished; restore previous payment terms');}
  finally{await cleanup(identity,[owner]).catch(()=>{});await sql`update app.warehouse set active=false where active and id in (select warehouse_id from app.local_fixture_warehouse where namespace=${namespace})`;await sql.end();}
 }
});
