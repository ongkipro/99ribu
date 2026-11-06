import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import test from 'node:test';
import {STAND_IN_RATE_VERSION,mengantarRateAdapter,resetMengantarRates} from '../../src/modules/shipping/mengantar.ts';
import {buildShippingPlans} from '../../src/modules/shipping/quotes.ts';
import {estimateRates,type RateAdapter,type RateRequest} from '../../src/modules/shipping/rates.ts';
import {denied,shippingFixture} from './shipping-fixture.ts';

// DEC-028 / S165: every branch of the S95 adapter in provider mode, driven by an in-test server (deterministic, no
// cross-repository dependency). Amounts below are this test's own fakes; only structure and invariants are asserted.
// estimateRates' 2000 ms cap is the effective limit (the adapter's own fetch timeout is 5000 ms).
const hex=()=>randomBytes(12).toString('hex');
type Reply={status?:number;body:string;delayMs?:number};
async function standIn(reply:(query:URLSearchParams)=>Reply){
 let calls=0;
 const server:Server=createServer((request,response)=>{calls++;const r=reply(new URL(request.url??'/','http://x').searchParams);
  const send=()=>{if(response.destroyed)return;response.writeHead(r.status??200,{'content-type':'application/json'});response.end(r.body);};
  if(r.delayMs) setTimeout(send,r.delayMs).unref(); else send();});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {origin:`http://127.0.0.1:${(server.address() as {port:number}).port}`,calls:()=>calls,close:()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());})};
}
async function mode<T>(origin:string,run:()=>Promise<T>){
 const saved=process.env;process.env={...saved,LOCAL_PROVIDER_ORIGIN:origin};resetMengantarRates();
 try{return await run();}finally{process.env=saved;resetMengantarRates();}
}
const request=(destination=hex(),now=new Date().toISOString()):RateRequest=>({warehouse_id:'w',origin:{province:null,city:'Malang',district:null},origin_area_id:'a'.repeat(24),destination_id:destination,
 measures:{weight_grams:500,length_mm:100,width_mm:100,height_mm:100},now});
const row=(price:unknown,extra:Record<string,unknown>={})=>({price,estimate_delivery:'2-3',unsupported:false,unsupported_cod:false,codFee:0,...extra});
const body=(data:Record<string,unknown>)=>JSON.stringify({success:true,data});
const code=(name:string)=>(error:unknown)=>{assert.equal((error as {code?:string}).code,name);return true;};

test('S165 real courier keys become whole-rupiah rates with stable ids; flags hide couriers and COD',async()=>{
 const s=await standIn(()=>({body:body({JNE:row(12000),SiCepat:row(10500,{unsupported_cod:undefined}),JT:row(11000,{unsupported_cod:true}),iDexpress:row(9000,{unsupported:true}),
  spx:row(9800,{unsupportedOriginSpx:true}),anteraja:row(10000,{coverage_cod:false}),lion:row(0),pos:row(9999.5),SAP:row(-1),SAPLite:row('8000'),Paxel:row(15000),Frac:row('7500.5'),'J&T':row(9000)})}));
 try{await mode(s.origin,async()=>{
  const destination=hex();
  const first=await estimateRates(mengantarRateAdapter,request(destination));
  assert.deepEqual(first.map(r=>[r.service_id,r.shipping_amount,r.supports_cod]).sort(),[['JNE',12000,true],['JT',11000,false],['Paxel',15000,true],['SAPLite',8000,true],['SiCepat',10500,false],['anteraja',10000,false]],
   'unsupported/unsupportedOriginSpx hidden; COD only on explicit unsupported_cod:false with coverage; zero, fractional, negative and fractional-string prices and keys outside [A-Za-z0-9_-] dropped; a whole-rupiah string price and a new key are offered (S179)');
  assert.ok(first.every(r=>r.version===STAND_IN_RATE_VERSION&&r.source==='mengantar'));
  resetMengantarRates();
  const again=await estimateRates(mengantarRateAdapter,request(destination));
  assert.deepEqual(again.map(r=>r.id).sort(),first.map(r=>r.id).sort(),'ids are stable for the same route, weight and price');
 });}finally{await s.close();}
});

test('S165 failures: slow answer times out, 5xx / non-JSON / wrong envelope are unavailable, no rate is invented',async()=>{
 const cases:[Reply,string][]=[[{body:body({JNE:row(12000)}),delayMs:2600},'SHIPPING_RATE_TIMEOUT'],[{status:503,body:'{}'},'SHIPPING_RATE_UNAVAILABLE'],
  [{body:'not json'},'SHIPPING_RATE_UNAVAILABLE'],[{body:'{}'},'SHIPPING_RATE_UNAVAILABLE'],[{body:JSON.stringify({success:false,message:'X001'})},'SHIPPING_RATE_UNAVAILABLE'],
  [{body:JSON.stringify({success:true,data:[]})},'SHIPPING_RATE_UNAVAILABLE']];
 for(const [reply,expected] of cases){
  const s=await standIn(()=>reply);
  try{await mode(s.origin,async()=>{
   const started=Date.now();
   await assert.rejects(estimateRates(mengantarRateAdapter,request()),code(expected),expected);
   assert.ok(Date.now()-started<2600,'the 2000 ms cap holds');
  });}finally{await s.close();}
 }
 // An empty courier map is a valid answer with no rate (the plan builder then answers NO_SUPPORTED_ROUTE).
 const s=await standIn(()=>({body:body({})}));
 try{await mode(s.origin,async()=>{assert.deepEqual(await estimateRates(mengantarRateAdapter,request()),[]);});}finally{await s.close();}
});

test('S165 cache, expiry and the per-process budget',async()=>{
 const s=await standIn(()=>({body:body({JNE:row(12000)})}));
 try{await mode(s.origin,async()=>{
  const destination=hex();
  await estimateRates(mengantarRateAdapter,request(destination));await estimateRates(mengantarRateAdapter,request(destination));
  assert.equal(s.calls(),1,'a replay within five minutes reuses the cached estimate');
  // A cached price is never offered past ten minutes after the provider gave it.
  await assert.rejects(estimateRates(mengantarRateAdapter,request(destination,new Date(Date.now()+601_000).toISOString())),code('SHIPPING_RATE_EXPIRED'));
  resetMengantarRates();const before=s.calls();
  for(let n=0;n<300;n++) await estimateRates(mengantarRateAdapter,request());
  await assert.rejects(estimateRates(mengantarRateAdapter,request()),code('SHIPPING_RATE_UNAVAILABLE'),'the 301st uncached estimate in a minute is refused');
  assert.equal(s.calls()-before,300,'the refused estimate never reached the provider');
 });}finally{await s.close();}
});

test('S165 COD order with only COD-unsupported couriers: COD_UNAVAILABLE; prepaid still quotes',async()=>{
 const f=await shippingFixture();const origin=hex(),destination=hex(),version=`test-${hex()}`;
 const s=await standIn(()=>({body:body({JNE:row(12000,{unsupported_cod:undefined}),SiCepat:row(10500,{unsupported_cod:true})})}));
 const warehouses=f.identity.sql`select warehouse_id from app.local_fixture_warehouse where namespace=${f.namespace}`;
 try{
  await f.identity.sql`insert into app.shipping_area (id,province,city,district,subdistrict,postal_code,dataset_version) values
   (${origin},'JAWA TIMUR','MALANG','KLOJEN','KAUMAN','65119',${version}),(${destination},'DKI JAKARTA','JAKARTA SELATAN','TEBET',${`TEBET BARAT COD ${hex()}`},'12810',${version})`;
  await f.identity.sql`update app.warehouse set provider_area_id=${origin} where id in (${warehouses})`;
  await mode(s.origin,async()=>{
   const lines=[f.line('fixture-offer-shirt')];
   await assert.rejects(f.identity.sql.begin(tx=>buildShippingPlans(tx,{lines,payment_method:'cod',destination_id:destination},{clock_namespace:f.namespace})),denied('COD_UNAVAILABLE'));
   const prepaid=await f.identity.sql.begin(tx=>buildShippingPlans(tx,{lines,payment_method:'prepaid',destination_id:destination},{clock_namespace:f.namespace}));
   assert.equal(prepaid[0].shipping_total,10500);
  });
 }finally{
  await s.close();
  await f.identity.sql`update app.warehouse set provider_area_id=null where id in (${warehouses})`;
  await f.identity.sql`delete from app.shipping_area where id in (${origin},${destination})`;await f.close();
 }
});

test('S165 more than 100 rates is an invalid answer (unreachable through the Mengantar parser, guarded anyway)',async()=>{
 const now=new Date().toISOString(),expires=new Date(Date.now()+600000).toISOString();
 const many:RateAdapter={source:'TEST-ONLY',version:'synthetic-v1',async estimate(){return Array.from({length:101},(_,n)=>({id:`r${n}`,service_id:`s${n}`,courier_name:'Synthetic',service_name:'Reguler',shipping_amount:1000,supports_cod:false,source:'TEST-ONLY' as const,version:'synthetic-v1',expires_at:expires}));}};
 await assert.rejects(estimateRates(many,request(hex(),now)),code('SHIPPING_RATE_INVALID'));
 const hundred:RateAdapter={...many,async estimate(){return (await many.estimate(request(),new AbortController().signal)).slice(0,100);}};
 assert.equal((await estimateRates(hundred,request(hex(),now))).length,100);
});
