import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {connectDatabase} from '../../db/client.ts';
import {runOneJob} from '../../jobs/worker.ts';
import {createLocalAuth,type LocalAuth} from '../access/auth.ts';
import {AccessError} from '../access/policy.ts';
import {handleAuth} from '../access/handler.ts';
import {handleAccess} from '../access/routes.ts';
import {capability,commerceActor,prefix} from '../checkout/access.ts';
import {createCart} from '../checkout/carts.ts';
import {importBerlapak} from './berlapak.ts';
import {prepareStorefront} from './storefront.ts';
import {seedCommerce} from './commerce.ts';
import {createAttempt} from '../payments/attempts.ts';
import {ingestProviderEvent,simulateCollection} from '../payments/local.ts';
import {reconcilePaymentNow} from '../payments/recovery.ts';
import {handlePayments} from '../payments/routes.ts';
import {paymentAdapter} from '../payments/worker.ts';
import {shippingFixture} from '../shipping/address.ts';
import {BrowserSession,CommerceClient,enroll} from './synthetic-session.ts';

type Target='local'|'test';
// Explicit runtime checks: a refused step aborts with a stable code and the caller's
// finally/lock cleanup still runs.
const need=(ok:boolean,code:string)=>{if(!ok) throw new AccessError(409,code);};
// Developer-only host bootstrap. Existing real rate limits remain enabled;
// unlike acceptance actor()/cleanup(), this command never clears shared buckets.
export async function withSeedOwner<T>(target:Target,namespace:string,run:(request:Request,identity:LocalAuth,signal:AbortSignal,session:{browser:BrowserSession;password:string})=>Promise<T>){
  if(!['local','test'].includes(target)||!/^[a-z][a-z0-9-]{0,23}$/.test(namespace)) throw new Error('Invalid local seed target.');
  const identity=createLocalAuth(target);const browser=new BrowserSession(identity);
  const interruption=new AbortController();
  const stopInt=()=>{process.exitCode=130;interruption.abort(new Error('Synthetic seed interrupted'));};
  const stopTerm=()=>{process.exitCode=143;interruption.abort(new Error('Synthetic seed interrupted'));};
  process.once('SIGINT',stopInt);process.once('SIGTERM',stopTerm);
  const check=()=>interruption.signal.throwIfAborted();
  const email=`${namespace}.seed-op-${randomUUID()}@example.invalid`;const password=randomBytes(24).toString('base64url');
  try{
    need((await browser.auth('/sign-up/email',{name:`SYNTHETIC temporary seed operator [${namespace}]`,email,password})).status===200,'SEED_SIGN_UP_REJECTED');check();
    const [user]=await identity.sql`select id from app.auth_user where email=${email}`;
    const [message]=await identity.sql`select url from app.local_delivery where recipient=${email} and kind='verification'`;
    need([200,302].includes((await handleAuth(new Request(message.url),identity)).status),'SEED_VERIFICATION_REJECTED');check();
    need((await browser.auth('/sign-in/email',{email,password})).status===200,'SEED_SIGN_IN_REJECTED');check();
    await identity.sql`insert into app.role_grant (user_id,roles) values (${user.id},ARRAY['owner']::text[])`;
    await enroll(browser,password);check();
    return await run(browser.request('/api/v1/admin/local-fixture-command'),identity,interruption.signal,{browser,password});
  }finally{
    process.off('SIGINT',stopInt);process.off('SIGTERM',stopTerm);
    // Scope cleanup to this exact randomly generated account, even when auth
    // fails before bootstrap returns its user ID. No other identity/bucket reset.
    await identity.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
    await identity.sql`delete from app.local_delivery where recipient=${email}`;
    const [user]=await identity.sql`select id from app.auth_user where email=${email}`;
    if(user){await identity.sql`delete from app.auth_verification where value=${user.id}`;await identity.sql`delete from app.access_operation where actor_id=${user.id}`;await identity.sql`delete from app.auth_user where id=${user.id}`;}
    await identity.sql.end();
  }
}

export function runCommerceFixture(target:Target,namespace:string,storefront=false){
  return withSeedOwner(target,namespace,async(request,identity,signal)=>{
    const seeded=await seedCommerce(request,identity,target,namespace,signal);
    if(!storefront) return seeded;
    return {...seeded,storefront:await prepareStorefront(request,identity,target,namespace,seeded,signal)};
  });
}

// Test-run teardown for the shared local database: withdraws, through the real publication
// service, every publication that a synthetic or since-removed principal made during this run
// (created at/after `since`) outside the committed catalog. Operator publications and the
// DEC-005 catalog are never touched; no temporary operator is created when nothing qualifies.
export async function withdrawTestPublications(target:Target,since:string){
  const {readCatalogDocument,summarizeCandidates,withdrawCandidates,withdrawalCandidates}=await import('../catalog/dataset.ts');
  const {defaultDatasetDir}=await import('./berlapak-dataset.ts');
  const keep=readCatalogDocument(defaultDatasetDir).products.flatMap((p)=>p.offers.map((o)=>o.sku));
  const probe=createLocalAuth(target);let pending:number;
  try{pending=(await withdrawalCandidates(probe.sql,keep,{since,syntheticOnly:true})).length;}finally{await probe.sql.end();}
  if(!pending) return {candidates:0,by_group:{},withdrawn:0,skipped:{}};
  return withSeedOwner(target,'test-teardown',async(request,identity,signal)=>{
    const candidates=await withdrawalCandidates(identity.sql,keep,{since,syntheticOnly:true});
    return {...summarizeCandidates(candidates),...await withdrawCandidates(request,identity,candidates,'Test-run teardown: fixture publications leave the shared storefront',signal)};
  });
}

const buyers=[
  ['Siti Rahmawati','Jl. Melati No. 12, RT 03/RW 05'],['Budi Santoso','Jl. Kenanga Raya No. 8'],['Dewi Lestari','Perum Griya Asri Blok C2 No. 4'],
  ['Agus Prasetyo','Jl. Diponegoro Gg. Mawar No. 21'],['Rina Wulandari','Jl. Merdeka Timur No. 45'],['Joko Susilo','Komplek Pondok Indah Blok B No. 7'],
  ['Nur Aisyah','Jl. Cempaka Putih No. 3, RT 01/RW 02'],['Hendra Wijaya','Jl. Ahmad Yani No. 102'],['Fitri Handayani','Jl. Anggrek No. 16'],
  ['Eko Saputro','Dusun Sukamaju RT 04/RW 01'],['Maya Sari','Jl. Pahlawan No. 27'],['Rudi Hartono','Jl. Sudirman Gg. Kelapa No. 9'],
  ['Lina Marlina','Perum Taman Sari Blok F No. 11'],['Dian Permata','Jl. Veteran No. 58'],['Yusuf Hidayat','Jl. Gajah Mada No. 33'],['Wati Kurniasih','Jl. Flamboyan No. 5'],
] as const;

// Synthetic buyers through the real cart/quote/order handlers and the existing local
// payment simulation (same steps as `worker.ts --confirm-payment`). Idempotent per
// namespace by the synthetic contact email stored in each order's quote. A dedicated
// connection holds a transactional advisory lock for the whole check-then-create pass, so
// concurrent runs never duplicate a buyer; an order left without its expected payment step
// (crash between /orders and the attempt) resumes that step under the same deterministic key.
export async function createBerlapakOrders(identity:LocalAuth,target:Target,namespace:string,products:Record<string,{product_id:string;offer_id:string;warehouse_id:string;publication_id:string|null}>){
  const offers=Object.entries(products).filter(([,p])=>p.publication_id).sort(([a],[b])=>a.localeCompare(b,'en',{numeric:true}));
  if(!offers.length) return {created:0,existing:0,resumed:0,states:{}};
  const destinations=shippingFixture().destinations.filter((d)=>['test-malang','test-pontianak'].includes(d.id));
  const lockDatabase=connectDatabase(target).sql;
  try{return await lockDatabase.begin(async(connection)=>{
    // A concurrent pass may hold the lock for all 16 orders; bound the wait above the 10s default.
    await connection`select set_config('statement_timeout','300000',true),set_config('application_name',${`99ribu-berlapak-orders-${namespace}`},true)`;
    await connection`select pg_advisory_xact_lock(hashtextextended(${`99ribu:berlapak-orders:${namespace}`},0))`;
    let created=0,existing=0,resumed=0;const emails:string[]=[];
    for(const [index,[recipient,street]] of buyers.entries()){
      const email=`${namespace}.buyer-${String(index+1).padStart(2,'0')}@example.invalid`;emails.push(email);
      const method:'prepaid'|'cod'=index>=10?'cod':'prepaid';const stage=method==='cod'?'cod':index<4?'pending':index<6?'attempt':'confirm';
      const attemptKey=createHash('sha256').update(`berlapak-order:${namespace}:${email}:attempt`).digest('hex');
      const [prior]=await identity.sql`select o.id,o.status,o.payment_status,o.expires_at>app.reservation_clock(o.clock_namespace) payable from app.commerce_order o join app.checkout_quote q on q.id=o.quote_id where o.clock_namespace=${namespace} and q.document->'contact'->>'email'=${email}`;
      let orderId:string;
      if(prior){
        existing++;orderId=prior.id;if(stage!=='attempt'&&stage!=='confirm') continue;
        const [attempt]=await identity.sql`select id from app.payment_attempt where order_id=${orderId} order by created_at limit 1`;
        if(!attempt){
          if(prior.status!=='pending'||prior.payment_status!=='pending'||!prior.payable) continue;
          await identity.sql.begin((tx)=>createAttempt(tx,orderId,attemptKey,{method_id:'local-prepaid'}));resumed++;
        }else if(stage==='attempt'||prior.payment_status==='confirmed') continue;
      }else{
        const [key,first]=offers[(index*7)%offers.length];const lines=[{variant_id:first.offer_id,quantity:index%3===0?2:1,expected_publication_id:first.publication_id as string}];
        const companion=index%4===1?offers.find(([k,p])=>k!==key&&p.warehouse_id===first.warehouse_id):undefined;
        if(companion) lines.push({variant_id:companion[1].offer_id,quantity:1,expected_publication_id:companion[1].publication_id as string});
        const client=new CommerceClient(identity),input={lines},cartKey=randomUUID();
        need((await client.call('/api/v1/carts',input,{key:cartKey})).response.status===401,'SEED_GUEST_BOOTSTRAP_REJECTED');
        const request=client.request('/api/v1/carts',input,{key:cartKey}),actor=await commerceActor(request,identity);if(actor?.kind!=='guest') throw new AccessError(409,'SEED_GUEST_ACTOR_MISSING');
        const cart=await identity.sql.begin((tx)=>createCart(tx,request,identity,actor,input,{clock_namespace:namespace}));
        const name=`${await prefix(identity)}.cart_access`,token=await capability(identity,'cart',cart.cart.id,actor.id,cart.cart.cap_issued_at as string);
        client.cookies.set(`${name}:/`,{name,value:`${cart.cart.id}.${token}`,path:'/'});
        const destination=destinations[index%destinations.length];
        const phone=`+62812${String(Number.parseInt(createHash('sha256').update(email).digest('hex').slice(0,10),16)%1e8).padStart(8,'0')}`;
        const quote=await client.call('/api/v1/checkout/quotes',{cart_id:cart.cart.id,address:{recipient_name:`${recipient} (contoh)`,phone,address_line:`${street}, ${destination.city}`,destination_id:destination.id,postal_code:destination.postal_code},
          contact:{phone,email},payment_method:method},{version:cart.cart.revision});
        need(quote.response.status===201,'SEED_QUOTE_REJECTED');
        const submitted=await client.call('/api/v1/orders',{quote_id:quote.payload.id},{version:cart.cart.revision});need(submitted.response.status===201,'SEED_ORDER_REJECTED');created++;
        orderId=submitted.payload.order.id as string;if(stage!=='attempt'&&stage!=='confirm') continue;
        const response=await handlePayments(client.request(`/api/v1/orders/${orderId}/payment-attempts`,{method_id:'local-prepaid'},{key:attemptKey}),identity);
        await response.json();need(response.status===201,'SEED_ATTEMPT_REJECTED');
        if(stage==='attempt') continue;
      }
      // Each step is idempotent: completed jobs are not rerun, the local operation returns its
      // final event, and provider events are deduplicated by id.
      const [attempt]=await identity.sql`select id,status from app.payment_attempt where order_id=${orderId} order by created_at limit 1`;
      if(!['pending','unknown'].includes(attempt.status)) continue;
      const adapters={'payment.create':paymentAdapter(identity.sql,target)};
      for(const job of await reconcilePaymentNow(identity.sql,attempt.id)) await runOneJob(identity.sql,adapters,job);
      await ingestProviderEvent(identity.sql,await simulateCollection(identity.sql,target,attempt.id));
      for(const job of await reconcilePaymentNow(identity.sql,attempt.id)) await runOneJob(identity.sql,adapters,job);
    }
    const rows=await identity.sql`select o.payment_method,o.status,o.payment_status,count(*)::int n from app.commerce_order o join app.checkout_quote q on q.id=o.quote_id
      where o.clock_namespace=${namespace} and q.document->'contact'->>'email' in ${identity.sql(emails)} group by 1,2,3 order by 1,2,3`;
    return {created,existing,resumed,states:Object.fromEntries(rows.map((r)=>[`${r.payment_method}:${r.status}:${r.payment_status}`,r.n]))};
  });}finally{await lockDatabase.end();}
}

// LOCAL-only developer terms (DEC-008/DEC-009): appends a payment-policy version
// with the 333 bps buyer COD fee and a SYNTHETIC manual-bank account through the
// real owner reauthentication + policy-version routes. Takes effect now (wall
// clock); a cart on a fixture clock namespace sees it once that clock passes now.
export const LOCAL_PAYMENT_TERMS={cod_fee_bps:333,manual_bank_accounts:[{bank_name:'Bank SINTETIS',account_number:'1234567890',account_holder:'PT SINTETIS 99RIBU'}]};
// Local baseline commercial policy so a fresh local DB can publish the imported
// catalog (10% default commission, IDR 99,000 minimum payout), same owner route.
export const LOCAL_COMMERCIAL_TERMS={default_commission_bps:1000,minimum_payout_idr:99000};
export const runPaymentTermsFixture=(target:Target,namespace:string)=>runPolicyFixture(target,namespace,'payment',LOCAL_PAYMENT_TERMS,'payment_policy.version','company-payment','SYNTHETIC local developer payment terms (COD fee 333 bps, synthetic manual bank)');
export const runCommercialTermsFixture=(target:Target,namespace:string)=>runPolicyFixture(target,namespace,'commercial',LOCAL_COMMERCIAL_TERMS,'company_policy.version','company-commercial','SYNTHETIC local developer commercial baseline (1000 bps commission, IDR 99,000 minimum payout)');
function runPolicyFixture(target:Target,namespace:string,kind:'payment'|'commercial',values:Record<string,unknown>,action:string,subject:string,reason:string){
  if(target!=='local') throw new Error(`${kind} terms fixture is local-only.`);
  return withSeedOwner(target,namespace,async(_request,identity,signal,{browser,password})=>{
    const [database]=await identity.sql`select current_database() as name`;need(database.name==='99ribu_local','SEED_TARGET_REFUSED');
    const call=async(path:string,body:Record<string,unknown>)=>{const request=browser.request(`/api/v1${path}`,body);request.headers.set('idempotency-key',randomUUID());
      const response=await handleAccess(request,identity);const payload=await response.json();if(response.status!==201) throw new AccessError(409,`SEED_${payload.code??response.status}`);return payload;};
    const history=await (await browser.access(`/admin/policy-versions?kind=${kind}`)).json() as {latest_version:number;current:{values:Record<string,unknown>}|null};
    signal.throwIfAborted();
    // A baseline only fills a gap: an existing current version (owner-set or earlier run) is never overwritten.
    if(history.current) return {kind,changed:false,version:history.latest_version,values:history.current.values};
    const proof=(await call('/me/reauthentication-proofs',{password,action,subject_id:subject})).proof;signal.throwIfAborted();
    await call('/admin/policy-versions',{kind,warehouse_id:null,expected_version:history.latest_version,effective_at:null,values,reason,reauthentication_proof:proof});
    return {kind,changed:true,version:history.latest_version+1,values};
  });
}

export function runBerlapakFixture(target:Target,namespace:string){
  const sourceDir=process.env.BERLAPAK_DATA_DIR||undefined;
  return withSeedOwner(target,namespace,async(request,identity,signal)=>{
    const imported=await importBerlapak(request,identity,target,namespace,{sourceDir},signal);
    signal.throwIfAborted();
    return {namespace,catalog:imported.summary,orders:await createBerlapakOrders(identity,target,namespace,imported.products)};
  });
}
