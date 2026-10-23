import {createHash,randomUUID} from 'node:crypto';
import {readLocalConfig} from '../../config/local.ts';
import {connectDatabase} from '../../db/client.ts';
import {runOneJob} from '../../jobs/worker.ts';
import type {JobAdapter} from '../../jobs/leases.ts';
import {createLocalAuth,type LocalAuth} from '../access/auth.ts';
import {handleAuth} from '../access/handler.ts';
import {AccessError,getPrincipal,type Principal} from '../access/policy.ts';
import {handleAffiliateProfile} from '../affiliates/profile.ts';
import {capability,commerceActor,prefix} from '../checkout/access.ts';
import {createCart} from '../checkout/carts.ts';
import {handleCommerceExceptions} from '../checkout/exceptions/routes.ts';
import {salePublication} from '../catalog/publication.ts';
import {handleCodRemittances} from '../finance/cod-remittance-routes.ts';
import {handleManualTransfers} from '../finance/manual-bank-routes.ts';
import {handleManualFulfillment} from '../fulfillment/manual-routes.ts';
import {simulateTrackingObservation} from '../fulfillment/manual.ts';
import {createTransfer,receiveTransfer,resolveTransfer} from '../inventory/transfers.ts';
import {autolarisAdviceAdapter,simulateAutolarisStatus} from '../payments/autolaris.ts';
import {ingestCodEvent,simulateCodCollection} from '../payments/cod-local.ts';
import {reconcileCodNow} from '../payments/cod-recovery.ts';
import {paymentTerms} from '../payments/methods.ts';
import {reconcilePaymentNow} from '../payments/recovery.ts';
import {handlePayments} from '../payments/routes.ts';
import {paymentAdapter} from '../payments/worker.ts';
import {handleReturns} from '../returns/routes.ts';
import {shippingFixture} from '../shipping/address.ts';
import {handleSupport} from '../support/routes.ts';
import {advanceFixtureClock,readFixtureClock,seedLocal} from './fixtures.ts';
import {LOCAL_ACCOUNTS,LOCAL_DUMMY_PASSWORD,storedTotpUri} from './logins.ts';
import {BrowserSession,CommerceClient,enroll,totp} from './synthetic-session.ts';

// Local demo order fixture: every storefront/admin order screen gets realistic content, created only
// through the real cart/quote/order handlers, payment/COD/tracking simulators, finance, fulfillment,
// exception, return, support and affiliate services. Nothing is inserted into business tables directly.
//
// Time: most scenarios run on the wall clock (no clock namespace) against the real catalog and its origin
// warehouses, so every scoped staff account sees them and the worker treats them like any live order. Only
// the two transfer scenarios that need a past order time (near deadline, expired) run in the namespace's
// own business clock: it is moved to anchor-24h05m (expired order) and anchor-20h (near-deadline order),
// then to the anchor, where the expired order's real expiry job cancels it. The anchor is "now", unless the
// manual-bank payment terms were not yet in force 24 h ago: then it is the current terms' start + 24h10m
// (the namespace clock runs ahead of the wall clock). The namespace clock then stands still, so the worker
// never expires the near-deadline order; on the wall clock it passes its deadline after about 4 hours.
type Target='local'|'test';
type Offer={product_id:string;offer_id:string;publication_id:string;sku:string;stock_item_id:string};
export type DemoOfferInput={product_id:string;offer_id:string};
export type DemoRow={scenario:string;state:string;order_number:string|null;buyer:string;detail:string};
type Buyer={label:string;client:CommerceClient;userId:string|null};
type StaffKind='owner'|'gudang'|'keuangan'|'cs';type Staff={browser:BrowserSession;password:string};
type AccountKind=StaffKind|'pembeli'|'pembeli2'|'afiliasi';

const AUDIT='local_fixture.demo_order';
const NAMES=[['Siti Rahmawati','Jl. Melati No. 12, RT 03/RW 05'],['Budi Santoso','Jl. Kenanga Raya No. 8'],['Dewi Lestari','Perum Griya Asri Blok C2 No. 4'],
 ['Agus Prasetyo','Jl. Diponegoro Gg. Mawar No. 21'],['Rina Wulandari','Jl. Merdeka Timur No. 45'],['Joko Susilo','Komplek Pondok Indah Blok B No. 7'],
 ['Nur Aisyah','Jl. Cempaka Putih No. 3, RT 01/RW 02'],['Hendra Wijaya','Jl. Ahmad Yani No. 102'],['Fitri Handayani','Jl. Anggrek No. 16'],
 ['Eko Saputro','Dusun Sukamaju RT 04/RW 01'],['Maya Sari','Jl. Pahlawan No. 27'],['Rudi Hartono','Jl. Sudirman Gg. Kelapa No. 9']] as const;
const DESTINATIONS=shippingFixture().destinations.filter(d=>['test-malang','test-pontianak'].includes(d.id));
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const digits=(value:string,length:number)=>String(BigInt(`0x${hash(value).slice(0,15)}`)).padStart(length,'0').slice(-length);
const fail=(code:string):never=>{throw new AccessError(409,code);};

export async function runDemoOrders(target:Target,namespace='demo-orders',options:{offers?:DemoOfferInput[]}={}){
 readLocalConfig(process.env);if(!['local','test'].includes(target))throw new Error('Demo orders are local/test only.');
 if(!/^[a-z][a-z0-9-]{0,23}$/.test(namespace))throw new Error('Invalid demo namespace (lowercase, digits, hyphen; at most 24 characters).',{cause:'visible'});
 // Fixture warehouses + business clock for the namespace (idempotent).
 await seedLocal(target,namespace);
 const lock=connectDatabase(target).sql,reserved=await lock.reserve();
 try{
  const [held]=await reserved`select pg_try_advisory_lock(hashtextextended(${`99ribu:demo-orders:${namespace}`},0)) ok`;
  if(!held.ok)throw new Error('Another demo-orders run holds this namespace; retry after it finishes.',{cause:'visible'});
  const identity=createLocalAuth(target);
  try{return await new DemoRun(target,namespace,identity,options).run();}
  finally{await identity.sql.end();await reserved`select pg_advisory_unlock(hashtextextended(${`99ribu:demo-orders:${namespace}`},0))`;}
 }finally{reserved.release();await lock.end();}
}

class DemoRun{
 readonly sql:LocalAuth["sql"];readonly rows:DemoRow[]=[];private anchor:Date|null=null;private registry=new Map<string,string>();private offers:Offer[]=[];private principal!:Principal;
 private buyers=new Map<string,Buyer>();private adapters:Record<string,JobAdapter>;private warehouses:Record<string,string>={};
 readonly target:Target;readonly ns:string;readonly identity:LocalAuth;readonly options:{offers?:DemoOfferInput[]};private sessions=new Map<StaffKind,Staff>();
 constructor(target:Target,ns:string,identity:LocalAuth,options:{offers?:DemoOfferInput[]}){
  this.target=target;this.ns=ns;this.identity=identity;this.options=options;this.sql=identity.sql;
  this.adapters={'payment.create':paymentAdapter(identity.sql,target),'payment.autolaris.advice':autolarisAdviceAdapter(identity.sql,target)};
 }

 async run(){
  for(const row of await this.sql`select subject_id,details->>'scenario' scenario from app.audit_event where actor_id=${`local-demo-orders:${this.ns}`} and action=${AUDIT}`)this.registry.set(String(row.scenario),String(row.subject_id));
  for(const row of await this.sql`select fixture_id,warehouse_id from app.local_fixture_warehouse where namespace=${this.ns}`)this.warehouses[String(row.fixture_id)]=String(row.warehouse_id);
  this.offers=await this.selectOffers();
  this.principal=await getPrincipal((await this.session('owner')).browser.request('/api/v1/me'),this.identity);
  // Wall-clock scenarios first that confirm manual-bank payments, so a buyer never holds more than the
  // two open transfers the checkout allows; the open "awaiting transfer" scenario comes after them.
  await this.transferConfirmed();await this.delivered();await this.returnRequested();await this.returnDecided();
  await this.timeShifted();
  await this.transferAwaiting();await this.autolaris(false);await this.autolaris(true);
  await this.codAwaitingBooking();await this.manualShipped();await this.inTransit();await this.codRemitted();await this.codRefused();await this.partialCancel();
  await this.support();await this.affiliate();
  return {namespace:this.ns,target:this.target,anchor:this.anchor?.toISOString()??null,orders:this.rows};
 }

 // ---- catalog -------------------------------------------------------------------------------------
 private async selectOffers(){
  const wanted=this.options.offers;
  const rows=await this.sql`select o.id offer_id,o.product_id,o.sku,v.id publication_id,min(c.stock_item_id::text) stock_item_id,
    coalesce((select sum(greatest(b.on_hand-b.reserved-b.quarantined,0)) from app.inventory_balance b join app.warehouse w on w.id=b.warehouse_id
      left join app.local_fixture_warehouse f on f.warehouse_id=w.id where b.stock_item_id=min(c.stock_item_id::text)::uuid and w.active
      and (${wanted?null:true}::boolean is null or (w.origin_key is not null and f.warehouse_id is null))),0)::int available
   from app.offer o join app.publication_head h on h.product_id=o.product_id join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision
   join app.offer_component c on c.product_id=o.product_id and c.revision=v.product_revision and c.offer_id=o.id
   where not exists(select 1 from app.publication_withdrawal w where w.publication_id=v.id)
    and ${wanted?this.sql`o.id in ${this.sql(wanted.map(w=>w.offer_id))}`:this.sql`o.sku ~ '^B99_[^_]+_OFFER$'`}
   group by o.id,o.product_id,o.sku,v.id having count(*)=1 and sum(c.quantity)=1 order by available desc,o.sku limit 40`;
  const picked:Offer[]=[];
  for(const row of rows){
   if(Number(row.available)<4)continue;
   const sale=await this.sql.begin(async tx=>{const [clock]=await tx`select clock_timestamp()::text now`;return salePublication(tx,String(row.product_id),clock.now);});
   if(sale?.publication_id===row.publication_id)picked.push({product_id:String(row.product_id),offer_id:String(row.offer_id),publication_id:String(row.publication_id),sku:String(row.sku),stock_item_id:String(row.stock_item_id)});
   if(picked.length>=16)break;
  }
  if(!picked.length)throw new Error('No published single-unit offer with available stock; import the DEC-005 catalog with initial stock first (README "Live catalog").',{cause:'visible'});
  return picked;
 }
 private offer(index:number){return this.offers[index%this.offers.length];}

 // ---- requests and jobs ---------------------------------------------------------------------------
 private async staff(kind:StaffKind,path:string,body?:Record<string,unknown>){
  const request=(await this.session(kind)).browser.request(path,body);if(body!==undefined)request.headers.set('idempotency-key',randomUUID());return request;
 }
 private async json(response:Response,expected:number[],code:string){
  const payload=await response.json();if(!expected.includes(response.status))throw new AccessError(409,`${code}_${payload?.code??response.status}`);return payload;
 }
 private async proof(kind:StaffKind,action:string,subject:string){
  const request=await this.staff(kind,'/api/v1/me/reauthentication-proofs',{password:(await this.session(kind)).password,action,subject_id:subject});
  const {handleAccess}=await import('../access/routes.ts');return String((await this.json(await handleAccess(request,this.identity),[201],'DEMO_PROOF')).proof);
 }
 private async runJob(jobId:string){
  await this.sql`update app.outbox_job set run_at=clock_timestamp() where id=${jobId} and status='pending' and run_at>clock_timestamp()`;
  await runOneJob(this.sql,this.adapters,jobId);
  const [job]=await this.sql`select status,last_error from app.outbox_job where id=${jobId}`;return job as {status:string;last_error:string|null};
 }
 private async now(){return new Date((await this.sql`select clock_timestamp() now`)[0].now);}

 // ---- accounts ------------------------------------------------------------------------------------
 // LOCAL: the stable dummy accounts of `fixture -- login local` (shared dummy password, stored TOTP), so the
 // history reads "Keuangan", "Staf Gudang", ... TEST: namespaced synthetic accounts with the same roles and
 // permissions, created once through the real sign-up, verification and TOTP enrollment flow.
 private async account(kind:AccountKind){
  const spec=LOCAL_ACCOUNTS.find(a=>a.email===`${kind==='owner'?'owner':kind}@99ribu.test`);if(!spec)throw new Error(`Unknown local account kind ${kind}.`);
  if(this.target==='local'){
   const [user]=await this.sql`select id from app.auth_user where email=${spec.email}`;
   if(!user)throw new Error(`Local account ${spec.email} is missing; run \`npm run fixture -- login local\` first.`,{cause:'visible'});
   return {id:String(user.id),email:spec.email,password:LOCAL_DUMMY_PASSWORD,name:spec.name};
  }
  const email=`${this.ns}.demo-${kind}@example.test`,password=hash(`demo-orders:${this.ns}:${email}`).slice(0,32);
  let [user]=await this.sql`select id from app.auth_user where email=${email}`;
  if(!user){
   const browser=new BrowserSession(this.identity);
   if((await browser.auth('/sign-up/email',{name:spec.name,email,password})).status!==200)fail('DEMO_SIGN_UP_REJECTED');
   const [message]=await this.sql`select url from app.local_delivery where recipient=${email} and kind='verification'`;
   if(![200,302].includes((await handleAuth(new Request(message.url),this.identity)).status))fail('DEMO_VERIFICATION_REJECTED');
   [user]=await this.sql`select id from app.auth_user where email=${email}`;
   // Same grant shape as the local dummy accounts (provisionLocalAccounts); scoped staff work where the demo stock lives.
   await this.sql`insert into app.role_grant (user_id,roles,permissions) values (${user.id},${[spec.role]},${spec.permissions}) on conflict (user_id) do nothing`;
   if(['ecommerce_admin','warehouse','customer_service'].includes(spec.role))for(const warehouse of await this.sql`select distinct b.warehouse_id from app.inventory_balance b where b.stock_item_id in ${this.sql(this.offers.map(o=>o.stock_item_id))}`)
    await this.sql`insert into app.warehouse_membership (user_id,warehouse_id) values (${user.id},${warehouse.warehouse_id}) on conflict do nothing`;
  }
  return {id:String(user.id),email,password,name:spec.name};
 }
 private async session(kind:StaffKind):Promise<Staff>{
  const cached=this.sessions.get(kind);if(cached)return cached;
  const account=await this.account(kind),browser=new BrowserSession(this.identity);
  const signed=await browser.auth('/sign-in/email',{email:account.email,password:account.password});
  if(signed.status!==200)throw new Error(`Sign-in for ${account.email} was refused (HTTP ${signed.status}; per-account rate limit?); retry in a minute.`,{cause:'visible'});
  const uri=await storedTotpUri(this.identity,account.id,account.email);
  if(uri){if((await browser.auth('/two-factor/verify-totp',{code:totp(uri)})).status!==200)fail('DEMO_TOTP_REJECTED');}
  else if(this.target==='test')await enroll(browser,account.password);
  else throw new Error(`Local account ${account.email} has no TOTP enrollment; run \`npm run fixture -- login local\` first.`,{cause:'visible'});
  const staff={browser,password:account.password};this.sessions.set(kind,staff);return staff;
 }
 private async buyer(kind:'pembeli'|'pembeli2'|'afiliasi'):Promise<Buyer>{
  const cached=this.buyers.get(kind);if(cached)return cached;
  const account=await this.account(kind),client=new CommerceClient(this.identity);
  if((await client.auth('/sign-in/email',{email:account.email,password:account.password})).status!==200)throw new Error(`Sign-in for ${account.email} was refused (per-account rate limit?); retry in a minute.`,{cause:'visible'});
  const buyer={label:account.email,client,userId:account.id};this.buyers.set(kind,buyer);return buyer;
 }
 private guest():Buyer{return {label:'tamu',client:new CommerceClient(this.identity),userId:null};}

 // ---- orders --------------------------------------------------------------------------------------
 private async register(key:string,orderId:string){
  await this.sql`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${`local-demo-orders:${this.ns}`},${AUDIT},${orderId},'allowed',${`Local demo order fixture: ${key}`},${JSON.stringify({scenario:key,namespace:this.ns})}::jsonb)`;
  this.registry.set(key,orderId);
 }
 private async order(orderId:string){
  const [row]=await this.sql`select id,number,status,payment_status,payment_method,payment_channel,expires_at,created_at,clock_namespace,owner_user_id from app.commerce_order where id=${orderId}`;return row;
 }
 // Cart -> quote -> order through the real checkout handlers. A namespaced cart is created by the
 // checkout domain writer with the namespace clock (the HTTP route has no clock option).
 private async place(key:string,buyer:Buyer,input:{offer:Offer;quantity?:number;method:'cod'|'prepaid';channel?:'manual-bank'|'autolaris';index:number;namespaced?:boolean}){
  const client=buyer.client,lines=[{variant_id:input.offer.offer_id,quantity:input.quantity??1,expected_publication_id:input.offer.publication_id}],cartKey=randomUUID();
  let cartId:string,revision:number;
  if(input.namespaced){
   if(buyer.userId)fail('DEMO_NAMESPACED_GUEST_ONLY');
   if((await client.call('/api/v1/carts',{lines},{key:cartKey})).response.status!==401)fail('DEMO_GUEST_BOOTSTRAP_REJECTED');
   const request=client.request('/api/v1/carts',{lines},{key:cartKey}),actor=await commerceActor(request,this.identity);if(actor?.kind!=='guest')fail('DEMO_GUEST_ACTOR_MISSING');
   const created=await this.sql.begin(tx=>createCart(tx,request,this.identity,actor as NonNullable<typeof actor>,{lines},{clock_namespace:this.ns}));
   const name=`${await prefix(this.identity)}.cart_access`,token=await capability(this.identity,'cart',created.cart.id,(actor as {id:string}).id,created.cart.cap_issued_at as string);
   client.cookies.set(`${name}:/`,{name,value:`${created.cart.id}.${token}`,path:'/'});cartId=created.cart.id;revision=created.cart.revision;
  }else{
   let cart=await client.call('/api/v1/carts',{lines},{key:cartKey});
   if(cart.response.status===401&&!buyer.userId)cart=await client.call('/api/v1/carts',{lines},{key:cartKey});
   if(cart.response.status!==201)fail(`DEMO_CART_${cart.payload?.code??cart.response.status}`);
   cartId=String(cart.payload.cart.id);revision=Number(cart.payload.cart.version);
  }
  const [name,street]=NAMES[input.index%NAMES.length],destination=DESTINATIONS[input.index%DESTINATIONS.length];
  const phone=`+62812${digits(`${this.ns}:${key}:phone`,8)}`;
  const [account]=buyer.userId?await this.sql`select email from app.auth_user where id=${buyer.userId}`:[];
  const quote=await client.call('/api/v1/checkout/quotes',{cart_id:cartId,address:{recipient_name:name,phone,address_line:`${street}, ${destination.city}`,destination_id:destination.id,postal_code:destination.postal_code},
   contact:{phone,email:account?String(account.email):null},payment_method:input.method,...(input.channel?{payment_channel:input.channel}:{})},{version:revision});
  if(quote.response.status!==201)fail(`DEMO_QUOTE_${quote.payload?.code??quote.response.status}`);
  const submitted=await client.call('/api/v1/orders',{quote_id:quote.payload.id},{version:revision});
  if(submitted.response.status!==201)fail(`DEMO_ORDER_${submitted.payload?.code??submitted.response.status}`);
  const orderId=String(submitted.payload.order.id);await this.register(key,orderId);return orderId;
 }
 // Existing order of a scenario, or a new one. A manual-bank hold is capped per buyer: a buyer at the cap
 // (e.g. open transfers from an earlier namespace) is replaced by a guest.
 private async ensure(key:string,buyer:Buyer,input:Parameters<DemoRun['place']>[2]){
  const prior=this.registry.get(key);if(prior)return {orderId:prior,buyer:await this.ownerOf(prior,buyer)};
  try{return {orderId:await this.place(key,buyer,input),buyer};}
  catch(error){if(buyer.userId&&error instanceof AccessError&&error.code.endsWith('MANUAL_BANK_OPEN_LIMIT')){const guest=this.guest();return {orderId:await this.place(key,guest,input),buyer:guest};}throw error;}
 }
 private async ownerOf(orderId:string,buyer:Buyer){const order=await this.order(orderId);return order.owner_user_id&&order.owner_user_id===buyer.userId?buyer:{...buyer,label:order.owner_user_id?buyer.label:'tamu',userId:order.owner_user_id?buyer.userId:null};}
 private async record(scenario:string,state:string,orderId:string|null,buyer:string,detail:string){
  const order=orderId?await this.order(orderId):null;this.rows.push({scenario,state,order_number:order?String(order.number):null,buyer,detail});
 }

 // ---- payment steps -------------------------------------------------------------------------------
 private async attempt(orderId:string,buyer:Buyer,body:Record<string,unknown>){
  const [existing]=await this.sql`select id from app.payment_attempt where order_id=${orderId} order by created_at limit 1`;
  if(existing)return String(existing.id);
  // A guest's order capability lives only in this run's client: a rerun cannot resume a guest step.
  if(!buyer.userId&&!buyer.client.cookies.size)fail('DEMO_GUEST_STEP_NOT_RESUMABLE');
  const created=await this.json(await handlePayments(buyer.client.request(`/api/v1/orders/${orderId}/payment-attempts`,body),this.identity),[201],'DEMO_ATTEMPT');
  for(const job of await reconcilePaymentNow(this.sql,created.id))await runOneJob(this.sql,this.adapters,job);
  return String(created.id);
 }
 private async confirmTransfer(orderId:string,buyer:Buyer){
  const attemptId=await this.attempt(orderId,buyer,{method_id:'manual-bank'});
  if(!(await this.sql`select 1 from app.manual_bank_confirmation where attempt_id=${attemptId}`).length){
   const [row]=await this.sql`select a.expected_amount,v.values->'manual_bank_accounts'->0->>'account_number' account from app.payment_attempt a join app.commerce_order o on o.id=a.order_id join app.policy_version v on v.id=o.payment_policy_version_id where a.id=${attemptId}`;
   const transferredAt=(await this.now()).toISOString(),subject=attemptId;
   const body={amount:Number(row.expected_amount),bank_reference:`DEMO-${digits(`${this.ns}:${orderId}:bank`,10)}`,account_number:String(row.account),transferred_at:transferredAt,late_transfer:false,
    evidence:'Mutasi rekening contoh: kredit masuk sesuai nominal dan kode unik',reason:'Nominal dan kode unik cocok dengan mutasi',reauthentication_proof:await this.proof('keuangan','finance.reconcile',subject)};
   await this.json(await handleManualTransfers(await this.staff('keuangan',`/api/v1/admin/manual-transfers/${attemptId}/confirmations`,body),this.identity),[201],'DEMO_TRANSFER_CONFIRM');
  }
  for(const job of await reconcilePaymentNow(this.sql,attemptId))await runOneJob(this.sql,this.adapters,job);
  if((await this.order(orderId)).payment_status!=='confirmed')fail('DEMO_TRANSFER_NOT_CONFIRMED');
 }

 // ---- fulfillment steps ---------------------------------------------------------------------------
 private async parcels(orderId:string){
  return this.sql`select f.id,f.revision,f.status,f.handover_at,s.id shipment_id,s.warehouse_id from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${orderId} order by s.id`;
 }
 private async ship(orderId:string,key:string,courier='jne',reference?:string){
  for(const [index,parcel] of (await this.parcels(orderId)).entries()){
   if((await this.sql`select 1 from app.manual_tracking where fulfillment_id=${parcel.id}`).length)continue;
   const resi=`${courier==='jne'?'JP':'SC'}${digits(`${this.ns}:${key}:${index}:resi`,10)}`;
   await this.json(await handleManualFulfillment(await this.staff('gudang',`/api/v1/admin/fulfillments/${parcel.id}/manual-shipment`,{expected_version:parcel.revision,courier,tracking_number:resi,...(reference?{purchase_reference:reference}:{})}),this.identity),[201],'DEMO_SHIP');
  }
 }
 private async track(orderId:string,providerStatus:'IN_TRANSIT'|'DELIVERED'|'FAILED'){
  const wanted={IN_TRANSIT:'in_transit',DELIVERED:'delivered',FAILED:'failed'}[providerStatus];
  for(const parcel of await this.parcels(orderId)){
   if(!(await this.sql`select 1 from app.shipment_tracking_event where fulfillment_id=${parcel.id} and status=${wanted}`).length){
    const [current]=await this.sql`select courier,tracking_number from app.manual_tracking where fulfillment_id=${parcel.id} order by version desc limit 1`;if(!current)fail('DEMO_PARCEL_NOT_SHIPPED');
    await simulateTrackingObservation(this.sql,this.target,{courier:String(current.courier),tracking_number:String(current.tracking_number),provider_status:providerStatus});
    for(const poll of await this.sql`select id from app.outbox_job where kind='fulfillment.tracking.poll' and payload->>'fulfillmentId'=${String(parcel.id)} and status='pending'`)await this.runJob(String(poll.id));
    if(!(await this.sql`select 1 from app.shipment_tracking_event where fulfillment_id=${parcel.id} and status=${wanted}`).length)fail('DEMO_TRACKING_NOT_OBSERVED');
   }
   // Delivered: the buyer receipt callback records the receipts of the frozen shipped units.
   for(const receipt of await this.sql`select j.id from app.shipment_tracking_event t join app.parcel_receipt_provider_event p on p.id=t.receipt_source_id join app.outbox_job j on j.id=p.callback_job_id where t.fulfillment_id=${parcel.id} and j.status='pending'`)
    if((await this.runJob(String(receipt.id))).status!=='completed')fail('DEMO_RECEIPT_FAILED');
  }
 }

 // ---- scenarios -----------------------------------------------------------------------------------
 private async transferConfirmed(){
  const buyer=await this.buyer('pembeli'),{orderId,buyer:owner}=await this.ensure('transfer_confirmed',buyer,{offer:this.offer(0),method:'prepaid',channel:'manual-bank',index:0});
  await this.confirmTransfer(orderId,owner);
  await this.record('transfer_confirmed','Transfer bank dikonfirmasi keuangan (menunggu dipesan kurir)',orderId,owner.label,'manual-bank, finance confirmation, parcel in "Perlu dipesan kurir"');
 }
 private async delivered(){
  const buyer=await this.buyer('pembeli'),{orderId,buyer:owner}=await this.ensure('delivered',buyer,{offer:this.offer(1),method:'prepaid',channel:'manual-bank',index:1});
  await this.confirmTransfer(orderId,owner);await this.ship(orderId,'delivered');await this.track(orderId,'IN_TRANSIT');await this.track(orderId,'DELIVERED');
  await this.record('delivered','Terkirim, penerimaan pembeli tercatat',orderId,owner.label,'manual-bank paid, resi, tracking delivered, buyer receipt');
 }
 private async deliveredFor(key:string,kind:'pembeli'|'pembeli2',index:number){
  const buyer=await this.buyer(kind),{orderId,buyer:owner}=await this.ensure(key,buyer,{offer:this.offer(index),method:'prepaid',channel:'manual-bank',index});
  await this.confirmTransfer(orderId,owner);await this.ship(orderId,key);await this.track(orderId,'DELIVERED');return {orderId,owner};
 }
 private async openReturn(orderId:string,owner:Buyer){
  const [existing]=await this.sql`select id,status,revision from app.return_case where order_id=${orderId} order by created_at limit 1`;if(existing)return existing;
  const [unit]=await this.sql`select f.id,f.order_item_id from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id where i.order_id=${orderId} order by f.id limit 1`;
  const body={items:[{order_item_id:unit.order_item_id,delivered_fulfillment_item_id:unit.id,quantity:1,reason:'damaged',details:'Jahitan lepas di bagian samping saat paket dibuka.'}],requested_resolution:'refund'};
  const created=await this.json(await handleReturns(owner.client.request(`/api/v1/orders/${orderId}/returns`,body),this.identity),[201],'DEMO_RETURN');
  return {id:created.id,status:created.status,revision:created.version};
 }
 private async returnRequested(){
  const {orderId,owner}=await this.deliveredFor('return_requested','pembeli',2);
  if(!owner.userId)fail('DEMO_RETURN_NEEDS_ACCOUNT');const created=await this.openReturn(orderId,owner);
  await this.record('return_requested','Retur diajukan pembeli (menunggu keputusan)',orderId,owner.label,`return case ${created.status}`);
 }
 private async returnDecided(){
  const {orderId,owner}=await this.deliveredFor('return_decided','pembeli2',3);
  if(!owner.userId)fail('DEMO_RETURN_NEEDS_ACCOUNT');const created=await this.openReturn(orderId,owner);
  if(created.status==='requested')await this.json(await handleReturns(await this.staff('cs',`/api/v1/admin/returns/${created.id}/decisions`,{decision:'approve_refund',expected_version:Number(created.revision),reason:'Foto pembeli menunjukkan kerusakan; refund disetujui setelah barang kembali.'}),this.identity),[201],'DEMO_RETURN_DECISION');
  const [now]=await this.sql`select status from app.return_case where id=${created.id}`;
  await this.record('return_decided','Retur diputuskan (refund disetujui, menunggu barang)',orderId,owner.label,`return case ${now.status}`);
 }
 private async transferAwaiting(){
  const buyer=await this.buyer('pembeli'),{orderId,buyer:owner}=await this.ensure('transfer_awaiting',buyer,{offer:this.offer(4),method:'prepaid',channel:'manual-bank',index:4});
  await this.attempt(orderId,owner,{method_id:'manual-bank'});
  const order=await this.order(orderId),left=(new Date(order.expires_at).getTime()-(await this.now()).getTime())/3600000;
  await this.record('transfer_awaiting','Transfer bank menunggu pembayaran (batas 24 jam)',orderId,owner.label,`deadline in ${left.toFixed(1)} h`);
 }
 private async autolaris(paid:boolean){
  const key=paid?'autolaris_paid':'autolaris_pending',buyer=paid?this.guest():await this.buyer('pembeli2');
  const {orderId,buyer:owner}=await this.ensure(key,buyer,{offer:this.offer(paid?6:5),method:'prepaid',channel:'autolaris',index:paid?6:5});
  const attemptId=await this.attempt(orderId,owner,{method_id:'autolaris',channel_code:paid?'QRIS':'VABCA'});
  if(paid&&(await this.order(orderId)).payment_status!=='confirmed'){
   // Same steps as `worker.ts --autolaris-paid`: the simulated account reports payment; the next advice poll observes it.
   await simulateAutolarisStatus(this.sql,this.target,attemptId,'paid');
   for(const poll of await this.sql`select id from app.outbox_job where kind='payment.autolaris.advice' and payload->>'attemptId'=${attemptId} and status='pending'`)await this.runJob(String(poll.id));
   for(const job of await reconcilePaymentNow(this.sql,attemptId))await runOneJob(this.sql,this.adapters,job);
   if((await this.order(orderId)).payment_status!=='confirmed')fail('DEMO_AUTOLARIS_NOT_PAID');
  }
  await this.record(key,paid?'AutoLaris QRIS dibayar (simulasi)':'AutoLaris VA BCA menunggu pembayaran',orderId,owner.label,paid?'advice poll observed the simulated settlement':'VA issued by the simulated AutoLaris account');
 }
 private async codAwaitingBooking(){
  const {orderId,buyer}=await this.ensure('cod_awaiting_booking',await this.buyer('pembeli2'),{offer:this.offer(7),method:'cod',index:7});
  await this.record('cod_awaiting_booking','COD menunggu dipesan kurir (antrean manual)',orderId,buyer.label,'COD confirmed, "Perlu dipesan kurir"');
 }
 private async manualShipped(){
  const {orderId,buyer}=await this.ensure('manual_shipped',this.guest(),{offer:this.offer(8),method:'cod',index:8});
  await this.ship(orderId,'manual_shipped','jne',`BL-INV/2026/${digits(`${this.ns}:bl`,4)}`);
  await this.record('manual_shipped','Dikirim manual: resi + referensi Berlapak',orderId,buyer.label,'courier JNE, resi entered, Berlapak purchase reference');
 }
 private async inTransit(){
  const {orderId,buyer}=await this.ensure('in_transit',await this.buyer('pembeli'),{offer:this.offer(9),method:'cod',index:9});
  await this.ship(orderId,'in_transit','sicepat');await this.track(orderId,'IN_TRANSIT');
  await this.record('in_transit','Dalam perjalanan (status kurir)',orderId,buyer.label,'simulated tracking IN_TRANSIT');
 }
 private async codRemitted(){
  const {orderId,buyer}=await this.ensure('cod_remitted',this.guest(),{offer:this.offer(10),method:'cod',index:10});
  await this.ship(orderId,'cod_remitted');await this.track(orderId,'DELIVERED');
  const order=await this.order(orderId);
  if(!(await this.sql`select 1 from app.cod_remittance_line l join app.order_shipment s on s.id=l.shipment_id where s.order_id=${orderId}`).length){
   const listed=await this.json(await handleCodRemittances(await this.staff('keuangan',`/api/v1/admin/cod-collectible-parcels?reference=${order.number}`),this.identity),[200],'DEMO_COD_COLLECTIBLE');
   const lines=(listed.data as {shipment_id:string;cod_due:number;order_id?:string}[]).filter(p=>p.order_id===undefined||p.order_id===orderId).map(p=>({shipment_id:p.shipment_id,amount:p.cod_due}));
   if(!lines.length)fail('DEMO_COD_NOT_COLLECTIBLE');
   const gross=lines.reduce((n,l)=>n+l.amount,0),id=randomUUID(),shipping=9000,fee=Math.ceil(gross*0.03);
   await this.json(await handleCodRemittances(await this.staff('keuangan','/api/v1/admin/cod-remittances',{id,reference:`MGT-${digits(`${this.ns}:remit`,8)}`,statement_at:new Date((await this.now()).getTime()-60000).toISOString(),lines,
    shipping_deduction:shipping,cod_fee_deduction:fee,other_deduction:0,net_amount:gross-shipping-fee,evidence:'Laporan saldo COD dashboard Mengantar (contoh)',reason:'Penarikan saldo COD',reauthentication_proof:await this.proof('keuangan','finance.reconcile',id)}),this.identity),[201],'DEMO_COD_REMITTANCE');
  }
  // Settle exactly like the S91 statement flow: collection callbacks, then the match, then settlement callbacks.
  for(const remittance of await this.sql`select distinct l.remittance_id from app.cod_remittance_line l join app.order_shipment s on s.id=l.shipment_id where s.order_id=${orderId}`){
   for(const job of await this.sql`select p.callback_job_id id from app.cod_remittance_line l join app.local_cod_event e on e.operation_id=l.cod_operation_id join app.cod_provider_event p on p.id=e.id join app.outbox_job j on j.id=p.callback_job_id where l.remittance_id=${remittance.remittance_id} and j.status='pending'`)await this.runJob(String(job.id));
   const [statement]=await this.sql`select r.match_job_id,r.settlement_operation_id,j.status from app.cod_remittance r join app.outbox_job j on j.id=r.match_job_id where r.id=${remittance.remittance_id}`;
   if(statement.status==='pending')await this.runJob(String(statement.match_job_id));
   for(const job of await this.sql`select p.callback_job_id id from app.settlement_provider_event p join app.outbox_job j on j.id=p.callback_job_id where p.operation_id=${statement.settlement_operation_id} and j.status='pending' order by p.id`)await this.runJob(String(job.id));
  }
  await this.record('cod_remitted','COD tertagih + setoran Mengantar dicatat',orderId,buyer.label,'delivered, COD remittance statement posted and matched');
 }
 private async codRefused(){
  const {orderId,buyer}=await this.ensure('cod_refused',this.guest(),{offer:this.offer(11),method:'cod',index:11});
  await this.ship(orderId,'cod_refused');await this.track(orderId,'FAILED');
  for(const parcel of await this.parcels(orderId)){
   // Same steps as `worker.ts --refuse-cod`.
   if(!(await this.sql`select 1 from app.local_cod_operation where shipment_id=${parcel.shipment_id} and status='refused'`).length)await ingestCodEvent(this.sql,await simulateCodCollection(this.sql,this.target,String(parcel.shipment_id),{status:'refused'}));
   for(const job of await reconcileCodNow(this.sql,String(parcel.shipment_id)))await runOneJob(this.sql,this.adapters,job);
  }
  await this.record('cod_refused','COD ditolak pembeli, paket retur',orderId,buyer.label,'tracking failed/returned, COD refused');
 }
 private async partialCancel(){
  const buyer=await this.buyer('pembeli2'),{orderId,buyer:owner}=await this.ensure('cod_partial_cancel',buyer,{offer:this.offer(12),quantity:2,method:'cod',index:12});
  if(!(await this.sql`select 1 from app.exception_cancellation c join app.fulfillment_item f on f.id=c.fulfillment_item_id join app.order_shipment s on s.id=f.shipment_id where s.order_id=${orderId}`).length){
   const parcel=(await this.parcels(orderId))[0];
   const [unit]=await this.sql`select id from app.fulfillment_item where shipment_id=${parcel.shipment_id} order by id limit 1`;
   const balances=await this.sql`select distinct a.balance_id,a.stock_item_id,b.revision from app.fulfillment_component_allocation a join app.inventory_balance b on b.id=a.balance_id where a.fulfillment_item_id=${unit.id} order by a.balance_id`;
   const exceptions=async(request:Request)=>this.json(await handleCommerceExceptions(request,this.identity),[201],'DEMO_EXCEPTION');
   // S99 path: one unit short at packing -> cancellation proposed -> accepted by the buyer -> applied before handover.
   let [open]=await this.sql`select id from app.commerce_exception where order_id=${orderId} order by created_at limit 1`;
   const reported=open?await (await handleCommerceExceptions(await this.staff('owner',`/api/v1/admin/commerce-exceptions/${open.id}`),this.identity)).json():await exceptions(await this.staff('owner','/api/v1/admin/commerce-exceptions',{fulfillment_id:parcel.id,fulfillment_item_ids:[unit.id],expected_version:parcel.revision,
    reason:'Stok fisik kurang satu saat dikemas',observed_components:balances.map((b,index)=>({balance_id:b.balance_id,stock_item_id:b.stock_item_id,expected_balance_version:Number(b.revision),missing_quantity:index===0?1:0}))}));
   open={id:reported.id};
   const proposed=await exceptions(await this.staff('owner',`/api/v1/admin/commerce-exceptions/${reported.id}/decisions`,{expected_version:reported.version,decision:'propose_cancellation',reason:'Batalkan satu unit yang kurang; unit lain tetap dikirim'}));
   const accepted=await exceptions(owner.client.request(`/api/v1/orders/${orderId}/recovery-actions`,{exception_id:reported.id,expected_version:proposed.version,action:'accept_proposal',proposal_id:proposed.proposal.id}));
   await exceptions(await this.staff('owner',`/api/v1/admin/commerce-exceptions/${reported.id}/decisions`,{expected_version:accepted.version,proposal_id:proposed.proposal.id,reason:'Pembatalan disetujui pembeli; diterapkan sebelum serah terima'}));
  }
  const [basis]=await this.sql.begin(async tx=>tx`select (app.cod_current_collection_basis(s.id)->>'amount')::int amount,s.cod_due from app.order_shipment s where s.order_id=${orderId} order by s.id limit 1`);
  await this.record('cod_partial_cancel','COD sebagian dibatalkan (tagihan COD berkurang)',orderId,owner.label,`COD due ${basis.cod_due} -> current basis ${basis.amount}`);
 }
 private async support(){
  const buyer=await this.buyer('pembeli'),orderId=this.registry.get('in_transit');if(!orderId)throw new AccessError(409,'DEMO_SUPPORT_ORDER_MISSING');
  const [existing]=await this.sql`select id from app.support_conversation where primary_order_id=${orderId} limit 1`;
  if(!existing){
   const created=await this.json(await handleSupport(buyer.client.request('/api/v1/support/conversations',{client_conversation_id:`demo-${hash(`${this.ns}:support`).slice(0,24)}`,order_id:orderId}),this.identity),[200,201],'DEMO_SUPPORT');
   await this.json(await handleSupport(buyer.client.request(`/api/v1/support/conversations/${created.id}/messages`,{client_message_id:`demo-${hash(`${this.ns}:support-message`).slice(0,24)}`,text:'Halo, paket saya sudah dikirim tapi belum sampai. Kira-kira kapan tiba?',attachment_ids:[],context:{kind:'order',order_id:orderId}}),this.identity),[200,201],'DEMO_SUPPORT_MESSAGE');
  }
  await this.record('support_conversation','Percakapan layanan pelanggan terkait pesanan',orderId as string,buyer.label,'support conversation with order context');
 }
 private async affiliate(){
  const affiliate=await this.buyer('afiliasi');
  let profile=await (await handleAffiliateProfile(affiliate.client.request('/api/v1/me/affiliate'),this.identity)).json();
  if(!profile?.referral_url){await this.json(await handleAffiliateProfile(affiliate.client.request('/api/v1/me/affiliate',{terms_version:'v1',referral_code:this.target==='local'?'MITRA99':`DEMO-${hash(this.ns).slice(0,8).toUpperCase()}`}),this.identity),[201],'DEMO_AFFILIATE_ENROLL');profile=await (await handleAffiliateProfile(affiliate.client.request('/api/v1/me/affiliate'),this.identity)).json();}
  // The buyer follows the affiliate's own referral link (`?ref=`).
  const code=new URL(String(profile.referral_url)).searchParams.get('ref');if(!code)fail('DEMO_AFFILIATE_LINK_MISSING');
  let orderId=this.registry.get('affiliate_order');let buyer=this.guest();
  if(!orderId){
   // The buyer arrives through the affiliate link (referral touch on the guest visitor), then checks out.
   const lines=[{variant_id:this.offer(13).offer_id,quantity:1,expected_publication_id:this.offer(13).publication_id}];
   if((await buyer.client.call('/api/v1/carts',{lines})).response.status!==401)fail('DEMO_GUEST_BOOTSTRAP_REJECTED');
   await this.json(await handleAffiliateProfile(buyer.client.request('/api/v1/referral-touches',{referral_code:code}),this.identity),[201],'DEMO_REFERRAL_TOUCH');
   orderId=await this.place('affiliate_order',buyer,{offer:this.offer(13),method:'cod',index:13});
  }else buyer={...buyer,label:'tamu'};
  for(const job of await this.sql`select id from app.outbox_job where kind='commission.accrue' and payload->>'orderId'=${orderId} and status='pending'`)await this.runJob(String(job.id));
  const [attribution]=await this.sql`select affiliate_id from app.order_attribution where order_id=${orderId}`;if(!attribution)fail('DEMO_AFFILIATE_NOT_ATTRIBUTED');
  await this.record('affiliate_order','Pesanan dari tautan afiliasi',orderId,buyer.label,`attributed to ${affiliate.label} (${code})`);
 }

 // ---- namespaced clock scenarios ------------------------------------------------------------------
 private async timeShifted(){
  const wall=await this.now(),manual=async(at:Date)=>(await this.sql.begin(tx=>paymentTerms(tx,at))).manual_bank_accounts.length>0;
  const back=(anchor:Date,ms:number)=>new Date(anchor.getTime()-ms);
  let anchor=wall;
  if(!(await manual(back(wall,86700000))&&await manual(back(wall,72000000)))){
   const [current]=await this.sql`select v.effective_at from app.policy_head h join app.policy_version v on v.head_id=h.id where h.kind='payment' and h.warehouse_id is null and v.effective_at<=clock_timestamp() order by v.effective_at desc,v.revision desc limit 1`;
   anchor=current&&await manual(wall)?new Date(new Date(current.effective_at).getTime()+86400000+600000):wall;
  }
  if(!(await manual(back(anchor,86700000)))){
   for(const state of ['Transfer bank kedaluwarsa (dibatalkan)','Transfer bank mendekati batas (<6 jam)'])
    await this.record(state.includes('kedaluwarsa')?'transfer_expired':'transfer_near_deadline',state,null,'-','skipped: no manual-bank payment terms in force; run `npm run fixture -- payment-terms local demo`');
   return;
  }
  this.anchor=anchor;
  const clockTo=async(at:Date)=>{const clock=await readFixtureClock(this.target,this.ns);const seconds=Math.ceil((at.getTime()-Date.parse(clock.now))/1000);if(seconds>0)await advanceFixtureClock(this.target,this.ns,seconds,clock.version);};
  const clockAt=async()=>new Date((await readFixtureClock(this.target,this.ns)).now);
  const expiredAt=back(anchor,86700000),nearAt=back(anchor,72000000),offer=this.offer(14);
  const missing=['transfer_expired','transfer_near_deadline'].filter(key=>!this.registry.has(key)).length;
  if(missing)await this.stockNamespace(offer,missing);
  let expiredId=this.registry.get('transfer_expired');
  if(!expiredId&&(await clockAt())<=expiredAt){await clockTo(expiredAt);expiredId=await this.place('transfer_expired',this.guest(),{offer,method:'prepaid',channel:'manual-bank',index:15,namespaced:true});}
  let nearId=this.registry.get('transfer_near_deadline');
  if(!nearId&&(await clockAt())<=nearAt){
   await clockTo(nearAt);const guest=this.guest();nearId=await this.place('transfer_near_deadline',guest,{offer,method:'prepaid',channel:'manual-bank',index:16,namespaced:true});
   await this.attempt(nearId,guest,{method_id:'manual-bank'});
  }
  await clockTo(anchor);
  if(expiredId&&(await this.order(expiredId)).status==='pending'){
   // The order's own expiry job (no transfer instructions were requested, so no confirmation grace applies).
   for(const job of await this.sql`select id from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${expiredId} and status='pending'`)await this.runJob(String(job.id));
  }
  const skipped='skipped: the namespace clock is already past this order time; use a new namespace';
  if(expiredId){const order=await this.order(expiredId);await this.record('transfer_expired','Transfer bank kedaluwarsa (dibatalkan)',expiredId,'tamu',`${order.status}/${order.payment_status}, 24 h window passed`);}
  else await this.record('transfer_expired','Transfer bank kedaluwarsa (dibatalkan)',null,'-',skipped);
  if(nearId){const order=await this.order(nearId),left=(new Date(order.expires_at).getTime()-anchor.getTime())/3600000;await this.record('transfer_near_deadline','Transfer bank mendekati batas (<6 jam)',nearId,'tamu',`deadline in ${left.toFixed(1)} h at ${anchor.toISOString()}`);}
  else await this.record('transfer_near_deadline','Transfer bank mendekati batas (<6 jam)',null,'-',skipped);
 }
 // The namespaced orders draw stock from the namespace's own fixture warehouse. When it has none, units
 // move there from a catalog warehouse by ordinary audited transfers (create -> dispatch -> receive).
 private async stockNamespace(offer:Offer,units:number){
  const target=this.warehouses['fixture-malang'];if(!target)fail('DEMO_NAMESPACE_WAREHOUSE_MISSING');
  const [have]=await this.sql`select coalesce(sum(greatest(b.on_hand-b.reserved-b.quarantined,0)),0)::int n from app.inventory_balance b join app.local_fixture_warehouse f on f.warehouse_id=b.warehouse_id where f.namespace=${this.ns} and b.stock_item_id=${offer.stock_item_id}`;
  if(have.n>=units)return;
  const [source]=await this.sql`select b.warehouse_id from app.inventory_balance b join app.warehouse w on w.id=b.warehouse_id left join app.local_fixture_warehouse f on f.warehouse_id=w.id
   where b.stock_item_id=${offer.stock_item_id} and w.active and (f.namespace is distinct from ${this.ns}) group by b.warehouse_id having sum(b.on_hand-b.reserved-b.quarantined)>=${units-have.n} order by sum(b.on_hand-b.reserved-b.quarantined) desc limit 1`;
  if(!source)fail('DEMO_NAMESPACE_STOCK_UNAVAILABLE');
  const owner=(await this.session('owner')).browser;
  const command=(step:string)=>{const next=owner.request('/api/v1/admin/inventory/transfers',{});next.headers.set('idempotency-key',hash(`demo-orders:${this.ns}:${step}:${randomUUID()}`).slice(0,64));return next;};
  const reason='Demo order fixture: stock for the namespaced transfer orders';
  type Transfer={id:string;status:string;version:number;allocations:{source_balance_id:string;quantity:number;received_quantity:number}[]};
  let transfer=await createTransfer(command('create'),this.identity,this.principal,{from_warehouse_id:source.warehouse_id,to_warehouse_id:target,stock_item_id:offer.stock_item_id,quantity:units-have.n,reason},null) as Transfer;
  transfer=await resolveTransfer(command('dispatch'),this.identity,this.principal,transfer.id,'dispatch',{expected_version:transfer.version,reason}) as Transfer;
  await receiveTransfer(command('receive'),this.identity,this.principal,transfer.id,{expected_version:transfer.version,reason,allocations:transfer.allocations.map(a=>({source_balance_id:a.source_balance_id,received_quantity:a.quantity-a.received_quantity,quarantined_quantity:0}))});
 }
}

// Plain-text summary for the CLI: state, order number, buyer, detail. No IDs, tokens or credentials.
export function formatDemoSummary(result:{namespace:string;orders:DemoRow[]}){
 const rows=[['State','Order','Buyer','Detail'],...result.orders.map(r=>[r.state,r.order_number??'-',r.buyer,r.detail])];
 const widths=[0,1,2].map(i=>Math.max(...rows.map(r=>r[i].length)));
 const line=(r:string[])=>r.map((cell,i)=>i<3?cell.padEnd(widths[i]):cell).join('  ');
 return [`Demo orders, namespace ${result.namespace}`,line(rows[0]),`${widths.map(w=>'-'.repeat(w)).join('  ')}  ------`,...rows.slice(1).map(line)].join('\n');
}
