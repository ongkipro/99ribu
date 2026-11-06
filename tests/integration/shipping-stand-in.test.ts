import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createServer,type IncomingMessage,type Server} from 'node:http';
import test from 'node:test';
import {findDestination,normalizeAddress,searchDestinations,destinationSource} from '../../src/modules/shipping/destinations.ts';
import {MENGANTAR_RATE_VERSION,STAND_IN_RATE_VERSION,mengantarRateAdapter,resetMengantarRates} from '../../src/modules/shipping/mengantar.ts';
import {buildShippingPlans,rateSeam} from '../../src/modules/shipping/quotes.ts';
import {denied,shippingFixture} from './shipping-fixture.ts';
import {paymentFixture} from './payment-fixture.ts';
import {estimateRates} from '../../src/modules/shipping/rates.ts';

// DEC-028 / S164: local provider mode. Destinations come from app.shipping_area (production's path) and rates from a
// loopback stand-in through the production adapter. The stand-in here is an in-test HTTP server answering the
// AdsBookCMS dev-providers estimate shape (keyed by courier, recorded 2026-11-04 from scripts/dev-providers.ts @a913fcb);
// its prices are fakes and only structure is asserted as contract.
const hex=()=>randomBytes(12).toString('hex');
type Reply=(request:IncomingMessage)=>{status:number;body:string}|Promise<{status:number;body:string}>;
async function standIn(reply:Reply){
 const seen:string[]=[];
 const server:Server=createServer(async(request,response)=>{seen.push(request.url??'');const r=await reply(request);response.writeHead(r.status,{'content-type':'application/json'});response.end(r.body);});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=(server.address() as {port:number}).port;
 return {origin:`http://127.0.0.1:${port}`,seen,close:()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());})};
}
// Recorded stand-in shape. Since S179 every quoted key with a whole-rupiah price is offered; only J&T (a key with `&`) is dropped.
const recorded={success:true,data:{JNE:{price:12000,estimate_delivery:'3-4',unsupported:false,unsupported_cod:false,codFee:0},SiCepat:{price:10500,estimate_delivery:'3-4',unsupported:false,unsupported_cod:false,codFee:0},
 'J&T':{price:11000,estimate_delivery:'3-4',unsupported:false,unsupported_cod:false,codFee:0},SAP:{price:11500,estimate_delivery:'3-4',unsupported:false,unsupported_cod:false,codFee:0},
 Anteraja:{price:10000,estimate_delivery:'3-4',unsupported:false,unsupported_cod:false,codFee:0},Paxel:{price:15000,estimate_delivery:'3-4',unsupported:false,unsupported_cod:true,codFee:0},
 lion:{price:13000,estimate_delivery:'3-4',unsupported:false,unsupported_cod:false,codFee:0}}};
async function as<T>(change:Record<string,string|undefined>,run:()=>Promise<T>){
 const saved=process.env;process.env={...saved,...change};for(const [k,v] of Object.entries(change)) if(v===undefined) delete process.env[k];
 resetMengantarRates();try{return await run();}finally{process.env=saved;resetMengantarRates();}
}
// Egress guard: inside provider mode the process may only call the configured stand-in origin.
async function egressOnly<T>(origin:string,run:()=>Promise<T>){
 const real=globalThis.fetch;const stray:string[]=[];
 globalThis.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin!==origin){stray.push(url.origin);return Promise.reject(new Error('egress refused'));}return real(input,init);}) as typeof fetch;
 try{const result=await run();assert.deepEqual(stray,[],'no request left the stand-in origin');return result;}finally{globalThis.fetch=real;}
}

test('S164 provider mode: catalogue destinations, stand-in rates through the production adapter, stand-in version on every rate',async()=>{
 const f=await shippingFixture();const origin=hex(),destination=hex(),version=`test-${hex()}`,name=`TEBET BARAT STANDIN ${hex()}`;
 const server=await standIn(()=>({status:200,body:JSON.stringify(recorded)}));
 const warehouses=f.identity.sql`select warehouse_id from app.local_fixture_warehouse where namespace=${f.namespace}`;
 try{
  await f.identity.sql`insert into app.shipping_area (id,province,city,district,subdistrict,postal_code,dataset_version) values
   (${origin},'JAWA TIMUR','MALANG','KLOJEN','KAUMAN','65119',${version}),(${destination},'DKI JAKARTA','JAKARTA SELATAN','TEBET',${name},'12810',${version})`;
  await f.identity.sql`update app.warehouse set provider_area_id=${origin} where id in (${warehouses})`;
  // Mode off: the fixture stays the source and the catalogue id is unknown.
  await as({LOCAL_PROVIDER_ORIGIN:undefined},async()=>{
   assert.equal(destinationSource(),'TEST-ONLY');
   assert.equal(await findDestination(f.identity.sql,destination),null);
   assert.equal(rateSeam.adapter.source,'TEST-ONLY');
  });
  await as({LOCAL_PROVIDER_ORIGIN:server.origin},()=>egressOnly(server.origin,async()=>{
   assert.equal(destinationSource(),'mengantar');
   assert.equal(rateSeam.adapter,mengantarRateAdapter);
   assert.equal(mengantarRateAdapter.version,STAND_IN_RATE_VERSION);
   const found=await searchDestinations(f.identity.sql,name);
   assert.deepEqual(found.map(d=>[d.id,d.postal_code,d.source,d.version]),[[destination,'12810','mengantar',version]]);
   assert.equal(await findDestination(f.identity.sql,'test-malang'),null,'fixture ids are refused in provider mode');
   assert.equal(await findDestination(f.identity.sql,hex()),null,'a forged 24-hex id is unknown');
   const address={recipient_name:'Synthetic Buyer',phone:'081234567890',address_line:'Jl. Sintetis 1',destination_id:destination,postal_code:'12810'};
   const normalized=await normalizeAddress(f.identity.sql,address);
   assert.deepEqual([normalized.destination_id,normalized.postal_code,normalized.source,normalized.destination_version],[destination,'12810','mengantar',version]);
   await assert.rejects(normalizeAddress(f.identity.sql,{...address,postal_code:'00001'}),denied('DESTINATION_POSTCODE_MISMATCH'));
   await assert.rejects(normalizeAddress(f.identity.sql,{...address,destination_id:hex()}),denied('DESTINATION_UNAVAILABLE'));
   const lines=[f.line('fixture-offer-shirt')];
   const plans=await f.identity.sql.begin(tx=>buildShippingPlans(tx,{lines,payment_method:'prepaid',destination_id:destination},{clock_namespace:f.namespace}));
   assert.equal(plans[0].source,'mengantar');
   const options=plans[0].packages[0].options;
   assert.deepEqual(options.map(o=>o.service_id).sort(),['Anteraja','JNE','Paxel','SAP','SiCepat','lion'],'every quoted courier with a whole-rupiah price is offered (S179); the J&T key is not a valid courier key and stays hidden');
   assert.ok(options.every(o=>Number.isSafeInteger(o.shipping_amount)&&o.shipping_amount>0),'whole-rupiah prices');
   assert.ok(server.seen.length>0&&server.seen.every(u=>u.startsWith('/api/public/local/order/estimate?')&&u.includes(`origin_id=${origin}`)&&u.includes(`destination_id=${destination}`)&&u.includes('courier=all')),'literal key local, warehouse origin, courier=all');
   assert.ok(server.seen.every(u=>!u.includes('COD_AMOUNT')),'99ribu never sends COD_AMOUNT');
   const rates=await mengantarRateAdapter.estimate({warehouse_id:'w',origin:{province:null,city:'x',district:null},origin_area_id:origin,destination_id:destination,measures:{weight_grams:500,length_mm:100,width_mm:100,height_mm:100},now:new Date().toISOString()},new AbortController().signal);
   assert.ok(rates.length&&rates.every(r=>r.version===STAND_IN_RATE_VERSION&&r.id.startsWith('mg_')),'stand-in rates carry the stand-in version');
  }));
  // The production version is untouched by the mode (rate ids hash the version, so the two never collide).
  assert.notEqual(STAND_IN_RATE_VERSION,MENGANTAR_RATE_VERSION);
 }finally{
  await server.close();
  await f.identity.sql`update app.warehouse set provider_area_id=null where id in (${warehouses})`;
  await f.identity.sql`delete from app.shipping_area where id in (${origin},${destination})`;await f.close();
 }
});

test('S164 provider mode faults through the adapter: 5xx, non-JSON and a slow answer give no rate, and a failure is never cached',async()=>{
 let reply={status:503,body:'{}',delayMs:0};let calls=0;
 const server=await standIn(async()=>{calls++;if(reply.delayMs) await new Promise(r=>setTimeout(r,reply.delayMs));return {status:reply.status,body:reply.body};});
 const request=()=>({warehouse_id:'w',origin:{province:null,city:'x',district:null},origin_area_id:hex(),destination_id:hex(),measures:{weight_grams:500,length_mm:100,width_mm:100,height_mm:100},now:new Date().toISOString()});
 const code=(name:string)=>(error:unknown)=>(error as {code?:string}).code===name;
 try{await as({LOCAL_PROVIDER_ORIGIN:server.origin},()=>egressOnly(server.origin,async()=>{
  const same=request();
  await assert.rejects(estimateRates(mengantarRateAdapter,same),code('SHIPPING_RATE_UNAVAILABLE'),'5xx');
  reply={status:200,body:JSON.stringify(recorded),delayMs:0};
  assert.ok((await estimateRates(mengantarRateAdapter,same)).length>0,'a failed estimate is not cached: the retry refetches');
  assert.equal(calls,2);
  reply={status:200,body:'not json',delayMs:0};
  await assert.rejects(estimateRates(mengantarRateAdapter,request()),code('SHIPPING_RATE_UNAVAILABLE'),'non-JSON');
  reply={status:200,body:JSON.stringify(recorded),delayMs:2500};
  await assert.rejects(estimateRates(mengantarRateAdapter,request()),code('SHIPPING_RATE_TIMEOUT'),'slower than the 2000 ms cap');
 }));}finally{await server.close();}
});

test('S164 provider mode end to end: the catalogue id and postal code reach the stored quote and the order unchanged',async()=>{
 const f=await paymentFixture();const origin=hex(),destination=hex(),version=`test-${hex()}`;
 const server=await standIn(()=>({status:200,body:JSON.stringify(recorded)}));
 const warehouses=f.identity.sql`select warehouse_id from app.local_fixture_warehouse where namespace=${f.namespace}`;
 const fixtureAddress={...f.address};
 try{
  await f.identity.sql`insert into app.shipping_area (id,province,city,district,subdistrict,postal_code,dataset_version) values
   (${origin},'JAWA TIMUR','MALANG','KLOJEN','KAUMAN','65119',${version}),(${destination},'DKI JAKARTA','JAKARTA SELATAN','TEBET',${`TEBET TIMUR ${hex()}`},'12820',${version})`;
  await f.identity.sql`update app.warehouse set provider_area_id=${origin} where id in (${warehouses})`;
  Object.assign(f.address,{destination_id:destination,postal_code:'12820'});
  await as({LOCAL_PROVIDER_ORIGIN:server.origin},()=>egressOnly(server.origin,async()=>{
   const {order}=await f.order(1,'prepaid');
   const [stored]=await f.identity.sql`select q.document from app.commerce_order o join app.checkout_quote q on q.id=o.quote_id where o.id=${order.id}`;
   const document=stored.document as {address:{destination_id:string;postal_code:string;source:string;destination_version:string}};
   assert.deepEqual([document.address.destination_id,document.address.postal_code,document.address.source,document.address.destination_version],[destination,'12820','mengantar',version]);
   const text=JSON.stringify(stored.document);
   assert.ok(text.includes(STAND_IN_RATE_VERSION),'the frozen quote carries the stand-in rate version');
   assert.ok(!text.includes(`"version":"${MENGANTAR_RATE_VERSION}"`),'no rate in the quote claims the production version');
  }));
 }finally{
  Object.assign(f.address,fixtureAddress);await server.close();
  await f.identity.sql`update app.warehouse set provider_area_id=null where id in (${warehouses})`;
  await f.identity.sql`delete from app.shipping_area where id in (${origin},${destination})`;
  await f.close();
 }
});
