import assert from 'node:assert/strict';
import {type ChildProcess,execFileSync,spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {homedir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {runOneJob} from '../../src/jobs/worker.ts';
import {type AutolarisClient,autolarisClientFor,classifyAdvice} from '../../src/modules/payments/autolaris.ts';
import {createAttempt} from '../../src/modules/payments/attempts.ts';
import {paymentAdapter} from '../../src/modules/payments/worker.ts';
import {MENGANTAR_RATE_VERSION,STAND_IN_RATE_VERSION,resetMengantarRates} from '../../src/modules/shipping/mengantar.ts';
import {checkStandIn} from '../../scripts/local-providers.ts';
import {paymentFixture} from './payment-fixture.ts';

// DEC-028 / S169 acceptance against the REAL AdsBookCMS stand-in (~/Projects/adsbookcms, `npm run dev:providers`),
// started here on a probed free port and stopped afterwards. Missing repository, command or port FAILS the case.
// The behaviour branches the real stand-in cannot produce (faults, create_payment, settlement) are exercised by the
// in-test fakes registered in the same case (shipping-stand-in*, autolaris-stand-in); their settle shape is invented and
// proves neither the real stand-in nor the real provider. Known gap, asserted, not hidden:
// the stand-in does not serve POST /api/h2h/create_payment (S162 A1; S171 is review-only by owner decision).
const ADSBOOKCMS=join(homedir(),'Projects/adsbookcms');
let child:ChildProcess|undefined,origin='';
const hex=()=>randomBytes(12).toString('hex');
// Courier keys the real stand-in serves (S179 offers every quoted key; before it only the first ten were kept). A fixture id must never appear.
const REAL_KEYS=new Set(['JNE','SiCepat','SAP','SAPLite','iDexpress','IDexpress','JT','lion','anteraja','Anteraja','spx','pos','Paxel']);

async function freePort(){return new Promise<number>((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const {port}=s.address() as {port:number};s.close(()=>resolve(port));});});}
test.before(async()=>{
 const head=execFileSync('git',['-C',ADSBOOKCMS,'rev-parse','--short','HEAD'],{encoding:'utf8'}).trim();
 const port=await freePort();origin=`http://127.0.0.1:${port}`;
 child=spawn('npm',['run','dev:providers'],{cwd:ADSBOOKCMS,env:{...process.env,DEV_PROVIDERS_PORT:String(port)},stdio:'ignore',detached:true});
 let spawnError:Error|undefined;child.on('error',error=>{spawnError=error;});
 // Backstop: never leave the stand-in running if this process ends without its after hook.
 process.once('exit',()=>{if(child?.pid&&child.exitCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{/* gone */}});
 const deadline=Date.now()+30000;
 for(;;){
  if(spawnError)throw new Error(`The AdsBookCMS stand-in could not start (${spawnError.message})`);
  if(child.exitCode!==null)throw new Error('The AdsBookCMS stand-in exited before answering');
  try{if((await fetch(`${origin}/`,{signal:AbortSignal.timeout(1000)})).ok)break;}catch{/* not up yet */}
  if(Date.now()>deadline)throw new Error(`The AdsBookCMS stand-in did not answer on ${origin} (start: cd ~/Projects/adsbookcms && DEV_PROVIDERS_PORT=<port> npm run dev:providers)`);
  await new Promise(r=>setTimeout(r,250));
 }
 console.log(`stand-in ${origin} adsbookcms HEAD ${head}`);
});
test.after(async()=>{
 const running=child;if(!running?.pid||running.exitCode!==null)return;
 const exited=new Promise<void>(resolve=>running.once('exit',()=>resolve()));
 try{process.kill(-running.pid,'SIGTERM');}catch{return;}
 const timer=setTimeout(()=>{try{if(running.pid)process.kill(-running.pid,'SIGKILL');}catch{/* gone */}},3000);
 await exited;clearTimeout(timer);
});

async function mode<T>(run:()=>Promise<T>){
 const saved=process.env,real=globalThis.fetch,stray:string[]=[];
 process.env={...saved,LOCAL_PROVIDER_ORIGIN:origin};resetMengantarRates();
 // Egress guard: nothing in provider mode may leave the stand-in origin.
 globalThis.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!==origin){stray.push(url.origin);return Promise.reject(new Error('egress refused'));}return real(input,init);}) as typeof fetch;
 try{const result=await run();assert.deepEqual(stray,[],'no request left loopback');return result;}finally{globalThis.fetch=real;process.env=saved;resetMengantarRates();}
}
async function plain<T>(run:()=>Promise<T>){const saved=process.env;process.env={...saved};delete process.env.LOCAL_PROVIDER_ORIGIN;try{return await run();}finally{process.env=saved;}}

test('S169 the real stand-in answers the shapes 99ribu relies on (create_payment reported as the S171 gap)',async()=>{
 const results=await checkStandIn(origin);
 assert.ok(results.every(r=>r.ok),JSON.stringify(results));
 assert.match(results.at(-1)?.note??'',/^GAP: not served \(HTTP 404\)/,'create_payment is still missing at the stand-in');
});

test('S169 guest journey in provider mode against the real stand-in: catalogue destination, real-key couriers, stand-in version frozen in the order',async()=>{
 const f=await paymentFixture();const originArea=hex(),destination=hex(),version=`test-${hex()}`;const fixtureAddress={...f.address};
 const warehouses=f.identity.sql`select warehouse_id from app.local_fixture_warehouse where namespace=${f.namespace}`;
 try{
  await f.identity.sql`insert into app.shipping_area (id,province,city,district,subdistrict,postal_code,dataset_version) values
   (${originArea},'JAWA TIMUR','MALANG','KLOJEN','KAUMAN','65119',${version}),(${destination},'DKI JAKARTA','JAKARTA SELATAN','TEBET',${`TEBET BARAT S169 ${hex()}`},'12810',${version})`;
  await f.identity.sql`update app.warehouse set provider_area_id=${originArea} where id in (${warehouses})`;
  Object.assign(f.address,{destination_id:destination,postal_code:'12810'});
  await mode(async()=>{
   const {order}=await f.order(1,'prepaid');
   const [stored]=await f.identity.sql`select q.document from app.commerce_order o join app.checkout_quote q on q.id=o.quote_id where o.id=${order.id}`;
   const document=stored.document as {address:{destination_id:string;postal_code:string;source:string}};
   assert.deepEqual([document.address.destination_id,document.address.postal_code,document.address.source],[destination,'12810','mengantar']);
   const text=JSON.stringify(stored.document);
   assert.ok(text.includes(STAND_IN_RATE_VERSION)&&!text.includes(`"version":"${MENGANTAR_RATE_VERSION}"`),'stand-in provenance frozen in the order');
   const services=[...text.matchAll(/"service_id":"([^"]+)"/g)].map(m=>m[1]);
   assert.ok(services.length>0&&services.every(s=>REAL_KEYS.has(s)),`only real Mengantar keys reach the order (${[...new Set(services)].join(',')})`);
  });
 }finally{
  Object.assign(f.address,fixtureAddress);
  await f.identity.sql`update app.warehouse set provider_area_id=null where id in (${warehouses})`;
  await f.identity.sql`delete from app.shipping_area where id in (${originArea},${destination})`;await f.close();
 }
});

test('S169 AutoLaris against the real stand-in: channels listed; create_payment is the documented gap (job unknown, no reference, no settlement)',async()=>{
 const f=await paymentFixture();let attemptId='',jobId='';
 try{
  const {order}=await plain(()=>f.order(1,'prepaid','autolaris'));
  await mode(async()=>{
   const client=autolarisClientFor('test',f.identity.sql);
   const channels=await client.listPayment();assert.equal(channels.rc,'00');assert.ok(Array.isArray(channels.data)&&channels.data.length>0);
   const shown=await f.identity.sql.begin(tx=>createAttempt(tx,order.id,randomUUID(),{method_id:'autolaris',channel_code:'VABCA'}));
   const [attempt]=await f.identity.sql`select creation_job_id from app.payment_attempt where id=${shown.id}`;attemptId=shown.id;jobId=String(attempt.creation_job_id);
   await f.identity.sql`update app.outbox_job set run_at=clock_timestamp() where id=${attempt.creation_job_id}`;
   await runOneJob(f.identity.sql,{'payment.create':paymentAdapter(f.identity.sql,'test',new Map(),client)},String(attempt.creation_job_id));
   const [job]=await f.identity.sql`select status from app.outbox_job where id=${attempt.creation_job_id}`;
   assert.equal(job.status,'unknown','HTTP 404 from the stand-in is an unknown outcome, replayed later with the same reff_id');
   const [row]=await f.identity.sql`select trx_id,responded_at from app.autolaris_payment where attempt_id=${shown.id}`;
   assert.deepEqual([row.trx_id,row.responded_at],[null,null],'no payment reference is invented');
   // The stand-in's own advice shapes never settle in 99ribu.
   assert.equal(classifyAdvice(await client.advice({transaction_id:'0'})).classification,'unknown');
  });
 }finally{
  // Leave nothing open in the shared test database: cancel the attempt through the normal refusal path (a provider
  // rc 07 answer fails the operation); no receipt is posted and nothing is paid.
  if(attemptId)await plain(async()=>{
   const sql=f.identity.sql,refuse:AutolarisClient={listPayment:async()=>({rc:'00',ket:'',data:[{channel_code:'VABCA',name:'VABCA'}]}),createPayment:async()=>({rc:'07',ket:'Channel tidak aktif',data:null}),advice:async()=>({rc:'02',ket:'PENDING',data:null})};
   await sql`update app.outbox_job set run_at=clock_timestamp() where id=${jobId}`;await runOneJob(sql,{'payment.create':paymentAdapter(sql,'test',new Map(),refuse)},jobId);
   for(const event of await sql`select callback_job_id from app.payment_provider_event where attempt_id=${attemptId}`){const [cb]=await sql`select status from app.outbox_job where id=${event.callback_job_id}`;if(cb.status==='pending')await runOneJob(sql,{},event.callback_job_id);}
   const [end]=await sql`select status from app.payment_attempt where id=${attemptId}`;assert.equal(end.status,'failed','the attempt is closed without payment');
  });
  await f.close();
 }
});
