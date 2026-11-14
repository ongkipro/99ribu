import {createHash,randomUUID} from 'node:crypto';
import {readLocalConfig} from '../../config/local.ts';
import {runOneJob} from '../../jobs/worker.ts';
import type {JobAdapter} from '../../jobs/leases.ts';
import {createLocalAuth,type LocalAuth} from '../access/auth.ts';
import {getPrincipal,type Principal} from '../access/policy.ts';
import {handleAccess} from '../access/routes.ts';
import {capability,commerceActor,prefix} from '../checkout/access.ts';
import {createCart} from '../checkout/carts.ts';
import {handleManualFulfillment} from '../fulfillment/manual-routes.ts';
import {simulateTrackingObservation} from '../fulfillment/manual.ts';
import {createTransfer,receiveTransfer,resolveTransfer} from '../inventory/transfers.ts';
import {ingestCodEvent,simulateCodCollection} from '../payments/cod-local.ts';
import {reconcileCodNow} from '../payments/cod-recovery.ts';
import {ingestProviderEvent,simulateCollection} from '../payments/local.ts';
import {reconcilePaymentNow} from '../payments/recovery.ts';
import {handlePayments} from '../payments/routes.ts';
import {paymentAdapter} from '../payments/worker.ts';
import {handleReturns} from '../returns/routes.ts';
import {shippingFixture} from '../shipping/address.ts';
import {seedLocal} from './fixtures.ts';
import {LOCAL_ACCOUNTS,LOCAL_DUMMY_PASSWORD,storedTotpUri} from './logins.ts';
import {BrowserSession,CommerceClient,totp} from './synthetic-session.ts';

// Local demo sales (owner 2026-11-14: "dummy untuk data penjualan, order, return"): a spread of ordinary orders over
// the past days so the owner dashboard, its trend and the lists read like a running store. Every order goes through the
// real cart, quote, order, payment, fulfillment, tracking, COD and return handlers; nothing is written to a business
// table directly.
//
// Time: one fixture namespace per day (`sale-YYYYMMDD`), its business clock set to that day's hours, so each order,
// payment, shipment and return carries the day it happened. The earliest day is the day after the oldest live
// publication of the sold offers (a cart refuses an offer that was not published yet), so the run is honest about the
// window it can fill. Stock for the namespaced orders moves into the namespace's own fixture warehouse by ordinary
// audited transfers first. A warehouse calendar cannot take effect in the past (RETROACTIVE_POLICY_FORBIDDEN), so a
// backdated parcel opens as the "calendar needs configuration" exception; manual shipment accepts that state, and the
// queues show it as they would for a real warehouse without a calendar. Resumable per order: an interrupted day
// continues where it stopped. LOCAL only.

type Offer={product_id:string;offer_id:string;publication_id:string;stock_item_id:string};
type Buyer={client:CommerceClient};
type Staff={browser:BrowserSession;password:string};
type Outcome='delivered'|'returned'|'in_transit'|'awaiting_shipment'|'cod_delivered'|'cod_refused'|'unpaid_expired';

const AUDIT='local_fixture.demo_sales';
const NAMES=[['Siti Rahmawati','Jl. Melati No. 12'],['Budi Santoso','Jl. Kenanga Raya No. 8'],['Dewi Lestari','Perum Griya Asri C2/4'],
 ['Agus Prasetyo','Jl. Diponegoro No. 21'],['Rina Wulandari','Jl. Merdeka Timur No. 45'],['Joko Susilo','Komplek Pondok Indah B7'],
 ['Nur Aisyah','Jl. Cempaka Putih No. 3'],['Hendra Wijaya','Jl. Ahmad Yani No. 102'],['Fitri Handayani','Jl. Anggrek No. 16'],
 ['Eko Saputro','Dusun Sukamaju RT 04'],['Maya Sari','Jl. Pahlawan No. 27'],['Rudi Hartono','Jl. Sudirman No. 9']] as const;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const unit=(seed:string)=>Number.parseInt(hash(seed).slice(0,8),16)/0xffffffff;
const digits=(v:string,n:number)=>String(BigInt(`0x${hash(v).slice(0,15)}`)).padStart(n,'0').slice(-n);

/** Deterministic plan: orders per day rise toward today with a weekend lift; outcomes by order age. */
export function planDay(day:string,ageDays:number){
 const weekday=new Date(`${day}T12:00:00+07:00`).getUTCDay(),weekend=weekday===0||weekday===6;
 const count=Math.round(3+unit(`count:${day}`)*4+(weekend?2:0)+Math.max(0,6-ageDays)*0.4);
 const orders=[] as {index:number;hour:number;quantity:number;offer:number;method:'cod'|'prepaid';outcome:Outcome}[];
 for(let index=0;index<count;index++){
  const r=(k:string)=>unit(`${k}:${day}:${index}`);
  const method=r('method')<0.55?'cod':'prepaid';
  // Older orders have finished; the last two days still hold open work.
  const roll=r('outcome');
  let outcome:Outcome;
  if(ageDays<=1)outcome=method==='cod'?(roll<0.6?'awaiting_shipment':'in_transit'):(roll<0.15?'unpaid_expired':roll<0.6?'awaiting_shipment':'in_transit');
  else if(ageDays<=3)outcome=method==='cod'?(roll<0.5?'in_transit':'cod_delivered'):(roll<0.1?'unpaid_expired':roll<0.5?'in_transit':'delivered');
  else outcome=method==='cod'?(roll<0.08?'cod_refused':'cod_delivered'):(roll<0.08?'unpaid_expired':roll<0.3?'returned':'delivered');
  orders.push({index,hour:8+Math.floor(r('hour')*13),quantity:r('qty')<0.8?1:2,offer:Math.floor(r('offer')*1000),method,outcome});
 }
 return orders;
}

export async function runDemoSales(days=10){
 const config=readLocalConfig(process.env);void config;
 if(!Number.isSafeInteger(days)||days<1||days>30)throw new Error('Days must be 1..30.',{cause:'visible'});
 const identity=createLocalAuth('local');
 try{return await new SalesRun(identity).run(days);}finally{await identity.sql.end();}
}

class SalesRun{
 readonly sql:LocalAuth['sql'];readonly identity:LocalAuth;private sessions=new Map<string,Staff>();private offers:Offer[]=[];
 private adapters:Record<string,JobAdapter>;private principal!:Principal;
 constructor(identity:LocalAuth){this.identity=identity;this.sql=identity.sql;this.adapters={'payment.create':paymentAdapter(identity.sql,'local')};}

 async run(days:number){
  const [db]=await this.sql`select current_database() name`;if(db.name!=='99ribu_local')throw new Error('Demo sales run on 99ribu_local only.');
  this.offers=await this.selectOffers();
  this.principal=await getPrincipal((await this.session('owner')).browser.request('/api/v1/me'),this.identity);
  const [first]=await this.sql`select min(v.created_at) at from app.publication_version v where v.id in ${this.sql(this.offers.map(o=>o.publication_id))}`;
  const earliest=wibDay(new Date(new Date(first.at).getTime()+86400000));
  const summary:{day:string;orders:number;skipped?:string}[]=[];
  for(let age=days-1;age>=0;age--){
   const day=wibDay(new Date(Date.now()-age*86400000));
   if(day<earliest){summary.push({day,orders:0,skipped:'before the first publication of the sold offers'});continue;}
   summary.push(await this.day(day,age));
  }
  return summary;
 }

 private async day(day:string,age:number){
  const ns=`sale-${day.replaceAll('-','')}`;
  const plan=planDay(day,age);
  // Resumable: an order already placed for a plan index is not placed again (an interrupted day continues).
  const placedIndexes=new Set((await this.sql`select (details->>'index')::int i from app.audit_event where actor_id=${`local-demo-sales:${ns}`} and action=${AUDIT}`).map(r=>Number(r.i)));
  if(plan.every(o=>placedIndexes.has(o.index)))return {day,orders:plan.length,skipped:'already filled'};
  await seedLocal('local',ns);
  const warehouse=String((await this.sql`select warehouse_id from app.local_fixture_warehouse where namespace=${ns} and fixture_id='fixture-malang'`)[0].warehouse_id);
  await this.calendar(ns,warehouse,day);
  const picked=plan.filter(o=>!placedIndexes.has(o.index)).map(o=>({...o,product:this.offers[o.offer%this.offers.length]}));
  const need=new Map<string,number>();for(const o of picked)need.set(o.product.stock_item_id,(need.get(o.product.stock_item_id)??0)+o.quantity);
  for(const [stockItem,units] of need)await this.stock(ns,warehouse,stockItem,units);
  // Phase 1, in time order: each order at its own minute of the day, prepaid orders paid at once. Phase 2: the day's
  // parcels move together (shipped, in transit, delivered or refused, returned), each step later in business time but
  // never past the real now, so recent days keep their open work and nothing is dated in the future.
  const latest=Date.now()-5*60000;
  const timed=picked.map(o=>({...o,at:Date.parse(`${day}T${String(o.hour).padStart(2,'0')}:${String(Number(digits(`${ns}:${o.index}:m`,4))%60).padStart(2,'0')}:00+07:00`)}))
   .filter(o=>o.at<latest).sort((a,b)=>a.at-b.at||a.index-b.index);
  const orders:{o:(typeof timed)[number];orderId:string;buyer:Buyer}[]=[];
  for(const o of timed){
   await this.setClock(ns,new Date(o.at).toISOString());
   const buyer={client:new CommerceClient(this.identity)};
   const orderId=await this.place(ns,buyer,o.product,o.quantity,o.method,o.index);
   await this.sql`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${`local-demo-sales:${ns}`},${AUDIT},${orderId},'allowed','Local demo sales fixture',${JSON.stringify({day,index:o.index,outcome:o.outcome})}::jsonb)`;
   if(o.outcome!=='unpaid_expired'&&o.method==='prepaid')await this.pay(orderId,buyer);
   orders.push({o,orderId,buyer});
  }
  const last=timed.at(-1)?.at??latest,step=(hours:number)=>new Date(Math.min(last+hours*3600000,latest)).toISOString();
  const moving=orders.filter(({o})=>!['unpaid_expired','awaiting_shipment'].includes(o.outcome));
  await this.setClock(ns,step(1));for(const {o,orderId} of moving)await this.ship(orderId,ns,o.index);
  await this.setClock(ns,step(21));for(const {orderId} of moving)await this.track(orderId,'IN_TRANSIT');
  const finishing=moving.filter(({o})=>o.outcome!=='in_transit');
  await this.setClock(ns,step(61));
  for(const {o,orderId} of finishing){
   if(o.outcome==='cod_refused'){await this.track(orderId,'FAILED');await this.cod(orderId,'refused');continue;}
   await this.track(orderId,'DELIVERED');if(o.method==='cod')await this.cod(orderId,'collected');
  }
  await this.setClock(ns,step(85));for(const {o,orderId,buyer} of finishing)if(o.outcome==='returned')await this.openReturn(orderId,buyer,o.index);
  const placed=orders.length;
  return {day,orders:placed+placedIndexes.size};
 }

 // ---- clock, calendar, stock ---------------------------------------------------------------------
 private async setClock(ns:string,at:string){
  // The business clock only moves forward; each day starts in its own namespace, so orders stay in time order.
  await this.sql`update app.local_fixture_namespace set clock=greatest(clock,${at}::timestamptz),revision=revision+1 where name=${ns}`;
 }
 private async calendar(ns:string,warehouse:string,day:string){
  if((await this.sql`select 1 from app.policy_head h join app.policy_version v on v.head_id=h.id where h.kind='warehouse_calendar' and h.warehouse_id=${warehouse}`).length)return;
  const owner=await this.session('owner');
  // At most five proofs a minute per account (grants.ts); a long run waits out the window instead of failing.
  let proofBody:{proof?:string;code?:string}={};
  for(let tries=0;tries<4&&!proofBody.proof;tries++){
   if(tries)await new Promise(r=>setTimeout(r,61000));
   const proof=owner.browser.request('/api/v1/me/reauthentication-proofs',{password:owner.password,action:'warehouse_calendar.version',subject_id:warehouse});proof.headers.set('idempotency-key',randomUUID());
   proofBody=await (await handleAccess(proof,this.identity)).json();
  }
  if(!proofBody.proof)throw new Error(`Reauthentication proof refused: ${proofBody.code}`);
  const year=Number(day.slice(0,4));
  const request=owner.browser.request('/api/v1/admin/policy-versions',{kind:'warehouse_calendar',warehouse_id:warehouse,effective_at:null,expected_version:0,
   values:{timezone:'Asia/Jakarta',year,working_weekdays:[0,1,2,3,4,5,6],cutoff_local:'23:59',closed_dates:[],source:'TEST-ONLY',approval:'test_only'},reason:'Demo sales fixture calendar',reauthentication_proof:proofBody.proof});
  request.headers.set('idempotency-key',randomUUID());
  const response=await handleAccess(request,this.identity);if(response.status!==201)throw new Error(`Calendar for ${ns} refused: ${response.status} ${await response.text()}`);
 }
 private async stock(ns:string,target:string,stockItem:string,units:number){
  const [have]=await this.sql`select coalesce(sum(greatest(on_hand-reserved-quarantined,0)),0)::int n from app.inventory_balance where warehouse_id=${target} and stock_item_id=${stockItem}`;
  if(have.n>=units)return;
  const [source]=await this.sql`select b.warehouse_id from app.inventory_balance b join app.warehouse w on w.id=b.warehouse_id left join app.local_fixture_warehouse f on f.warehouse_id=w.id
   where b.stock_item_id=${stockItem} and w.active and f.warehouse_id is null group by b.warehouse_id having sum(b.on_hand-b.reserved-b.quarantined)>=${units-have.n} order by 1 limit 1`;
  if(!source)throw new Error(`No catalog stock for ${stockItem}.`);
  const owner=(await this.session('owner')).browser,reason='Demo sales fixture: stock for the day';
  const command=()=>{const r=owner.request('/api/v1/admin/inventory/transfers',{});r.headers.set('idempotency-key',hash(`${ns}:${stockItem}:${randomUUID()}`).slice(0,64));return r;};
  type T={id:string;version:number;allocations:{source_balance_id:string;quantity:number;received_quantity:number}[]};
  let transfer=await createTransfer(command(),this.identity,this.principal,{from_warehouse_id:source.warehouse_id,to_warehouse_id:target,stock_item_id:stockItem,quantity:units-have.n,reason},null) as T;
  transfer=await resolveTransfer(command(),this.identity,this.principal,transfer.id,'dispatch',{expected_version:transfer.version,reason}) as T;
  await receiveTransfer(command(),this.identity,this.principal,transfer.id,{expected_version:transfer.version,reason,allocations:transfer.allocations.map(a=>({source_balance_id:a.source_balance_id,received_quantity:a.quantity-a.received_quantity,quarantined_quantity:0}))});
 }

 // ---- catalog and accounts -----------------------------------------------------------------------
 private async selectOffers():Promise<Offer[]>{
  const rows=await this.sql`select o.id offer_id,o.product_id,v.id publication_id,min(c.stock_item_id::text) stock_item_id
   from app.offer o join app.publication_head h on h.product_id=o.product_id join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision
   join app.offer_component c on c.product_id=o.product_id and c.revision=v.product_revision and c.offer_id=o.id
   join app.publication_offer po on po.publication_id=v.id and po.offer_id=o.id
   where not exists(select 1 from app.publication_withdrawal w where w.publication_id=v.id) and o.sku ~ '^B99_[^_]+_OFFER$'
    and exists(select 1 from app.inventory_balance b join app.warehouse w on w.id=b.warehouse_id left join app.local_fixture_warehouse f on f.warehouse_id=w.id
      where b.stock_item_id=c.stock_item_id and w.active and f.warehouse_id is null and b.on_hand-b.reserved-b.quarantined>=20)
   group by o.id,o.product_id,v.id having count(*)=1 and sum(c.quantity)=1 order by o.id limit 60`;
  if(rows.length<10)throw new Error('Fewer than 10 published single-unit offers with stock; import the catalog with initial stock first.',{cause:'visible'});
  return rows.map(r=>({product_id:String(r.product_id),offer_id:String(r.offer_id),publication_id:String(r.publication_id),stock_item_id:String(r.stock_item_id)}));
 }
 private async session(kind:'owner'|'gudang'|'keuangan'|'cs'):Promise<Staff>{
  const cached=this.sessions.get(kind);if(cached)return cached;
  const spec=LOCAL_ACCOUNTS.find(a=>a.email===`${kind}@99ribu.test`);if(!spec)throw new Error(`Unknown local account ${kind}.`);
  const [user]=await this.sql`select id from app.auth_user where email=${spec.email}`;
  if(!user)throw new Error(`Local account ${spec.email} is missing; run \`npm run fixture -- login local\` first.`,{cause:'visible'});
  const browser=new BrowserSession(this.identity);
  if((await browser.auth('/sign-in/email',{email:spec.email,password:LOCAL_DUMMY_PASSWORD})).status!==200)throw new Error(`Sign-in for ${spec.email} refused; retry in a minute.`,{cause:'visible'});
  const uri=await storedTotpUri(this.identity,String(user.id),spec.email);if(!uri)throw new Error(`${spec.email} has no TOTP; run \`npm run fixture -- login local\`.`,{cause:'visible'});
  if((await browser.auth('/two-factor/verify-totp',{code:totp(uri)})).status!==200)throw new Error('TOTP refused.');
  const staff={browser,password:LOCAL_DUMMY_PASSWORD};this.sessions.set(kind,staff);return staff;
 }
 private async staff(kind:'owner'|'gudang'|'keuangan'|'cs',path:string,body?:Record<string,unknown>){
  const r=(await this.session(kind)).browser.request(path,body);if(body!==undefined)r.headers.set('idempotency-key',randomUUID());return r;
 }

 // ---- order flow ---------------------------------------------------------------------------------
 private async place(ns:string,buyer:Buyer,offer:Offer,quantity:number,method:'cod'|'prepaid',index:number){
  const client=buyer.client,lines=[{variant_id:offer.offer_id,quantity,expected_publication_id:offer.publication_id}],cartKey=randomUUID();
  if((await client.call('/api/v1/carts',{lines},{key:cartKey})).response.status!==401)throw new Error('Guest bootstrap was not requested.');
  const request=client.request('/api/v1/carts',{lines},{key:cartKey}),actor=await commerceActor(request,this.identity);if(actor?.kind!=='guest')throw new Error('No guest actor.');
  const created=await this.sql.begin(tx=>createCart(tx,request,this.identity,actor,{lines},{clock_namespace:ns}));
  const name=`${await prefix(this.identity)}.cart_access`,token=await capability(this.identity,'cart',created.cart.id,actor.id,created.cart.cap_issued_at as string);
  client.cookies.set(`${name}:/`,{name,value:`${created.cart.id}.${token}`,path:'/'});
  const [person,street]=NAMES[(index+ns.length)%NAMES.length],destination=shippingFixture().destinations.find(d=>d.id==='test-malang') as {id:string;city:string;postal_code:string};
  const phone=`+62812${digits(`${ns}:${index}:phone`,8)}`;
  const quote=await client.call('/api/v1/checkout/quotes',{cart_id:created.cart.id,address:{recipient_name:person,phone,address_line:`${street}, ${destination.city}`,destination_id:destination.id,postal_code:destination.postal_code},
   contact:{phone,email:null},payment_method:method},{version:created.cart.revision});
  if(quote.response.status!==201)throw new Error(`Quote refused: ${JSON.stringify(quote.payload)}`);
  const submitted=await client.call('/api/v1/orders',{quote_id:quote.payload.id},{version:created.cart.revision});
  if(submitted.response.status!==201)throw new Error(`Order refused: ${JSON.stringify(submitted.payload)}`);
  return String(submitted.payload.order.id);
 }
 private async pay(orderId:string,buyer:Buyer){
  const response=await handlePayments(buyer.client.request(`/api/v1/orders/${orderId}/payment-attempts`,{method_id:'local-prepaid'}),this.identity);
  if(response.status!==201)throw new Error(`Payment attempt refused: ${response.status} ${await response.text()}`);
  const attempt=await response.json();
  for(const job of await reconcilePaymentNow(this.sql,attempt.id))await runOneJob(this.sql,this.adapters,job);
  const job=await ingestProviderEvent(this.sql,await simulateCollection(this.sql,'local',attempt.id));await runOneJob(this.sql,this.adapters,job);
  for(const next of await reconcilePaymentNow(this.sql,attempt.id))await runOneJob(this.sql,this.adapters,next);
 }
 private async parcels(orderId:string){
  return this.sql`select f.id,f.revision,s.id shipment_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${orderId} order by s.id`;
 }
 private async ship(orderId:string,ns:string,index:number){
  // Shipped by the owner: the day's fixture warehouse has no warehouse-staff membership (S91 scoping).
  for(const [n,parcel] of (await this.parcels(orderId)).entries()){
   const courier=index%3===0?'sicepat':'jne',resi=`${courier==='jne'?'JP':'SC'}${digits(`${ns}:${index}:${n}`,10)}`;
   const response=await handleManualFulfillment(await this.staff('owner',`/api/v1/admin/fulfillments/${parcel.id}/manual-shipment`,{expected_version:parcel.revision,courier,tracking_number:resi}),this.identity);
   if(response.status!==201)throw new Error(`Shipment refused: ${response.status} ${await response.text()}`);
  }
 }
 private async track(orderId:string,status:'IN_TRANSIT'|'DELIVERED'|'FAILED'){
  for(const parcel of await this.parcels(orderId)){
   const [current]=await this.sql`select courier,tracking_number from app.manual_tracking where fulfillment_id=${parcel.id} order by version desc limit 1`;
   await simulateTrackingObservation(this.sql,'local',{courier:String(current.courier),tracking_number:String(current.tracking_number),provider_status:status});
   for(const poll of await this.sql`select id from app.outbox_job where kind='fulfillment.tracking.poll' and payload->>'fulfillmentId'=${String(parcel.id)} and status='pending'`){
    await this.sql`update app.outbox_job set run_at=clock_timestamp() where id=${poll.id} and status='pending'`;await runOneJob(this.sql,this.adapters,String(poll.id));
   }
   for(const receipt of await this.sql`select j.id from app.shipment_tracking_event t join app.parcel_receipt_provider_event p on p.id=t.receipt_source_id join app.outbox_job j on j.id=p.callback_job_id where t.fulfillment_id=${parcel.id} and j.status='pending'`){
    await this.sql`update app.outbox_job set run_at=clock_timestamp() where id=${receipt.id} and status='pending'`;await runOneJob(this.sql,this.adapters,String(receipt.id));
   }
  }
 }
 private async cod(orderId:string,status:'collected'|'refused'){
  for(const parcel of await this.parcels(orderId)){
   await ingestCodEvent(this.sql,await simulateCodCollection(this.sql,'local',String(parcel.shipment_id),{status}));
   for(const job of await reconcileCodNow(this.sql,String(parcel.shipment_id)))await runOneJob(this.sql,this.adapters,job);
  }
 }
 private async openReturn(orderId:string,buyer:Buyer,index:number){
  const [item]=await this.sql`select f.id,f.order_item_id from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${orderId} order by f.id limit 1`;
  const reasons=['damaged','defective','not_as_described','wrong_item'] as const,reason=reasons[index%reasons.length];
  const details={damaged:'Kemasan penyok dan isi tumpah saat paket dibuka.',defective:'Produk tidak berfungsi sejak pertama dipakai.',not_as_described:'Warna berbeda dari foto di halaman produk.',wrong_item:'Varian yang datang tidak sesuai pesanan.'}[reason];
  const response=await handleReturns(buyer.client.request(`/api/v1/orders/${orderId}/returns`,{items:[{order_item_id:item.order_item_id,delivered_fulfillment_item_id:item.id,quantity:1,reason,details}],requested_resolution:index%2?'replacement':'refund'}),this.identity);
  if(response.status!==201)throw new Error(`Return refused: ${response.status} ${await response.text()}`);
 }
}

function wibDay(at:Date){return new Date(at.getTime()+7*3600000).toISOString().slice(0,10);}
