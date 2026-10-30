import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import test from 'node:test';
import {findDestination,normalizeAddress,searchDestinations} from '../../src/modules/shipping/destinations.ts';
import {MENGANTAR_RATE_VERSION,parseEstimate} from '../../src/modules/shipping/mengantar.ts';
import {buildShippingPlans} from '../../src/modules/shipping/quotes.ts';
import type {RateAdapter} from '../../src/modules/shipping/rates.ts';
import {denied,shippingFixture} from './shipping-fixture.ts';

// S95 production path against the real test database: Mengantar areas from app.shipping_area, the warehouse origin
// area, live-shaped rates (the observed estimate body, parsed by the production parser) and the plan source. Only
// runtimeTarget()/productionShipping() see the synthetic production profile; the database connection stays the test one.
const production=(shipping:'mengantar'|'disabled'):NodeJS.ProcessEnv=>({NODE_ENV:'test',APP_ENV:'production',APP_ORIGIN:'https://99ribu.com',BETTER_AUTH_URL:'https://99ribu.com',
 BETTER_AUTH_SECRET:randomBytes(48).toString('base64'),PAYMENT_ADAPTER:'disabled',ADS_ADAPTER:'disabled',NOTIFICATION_ADAPTER:'disabled',PAYOUT_ADAPTER:'disabled',
 SHIPPING_ADAPTER:shipping,...(shipping==='mengantar'?{MENGANTAR_BASE_URL:'https://api-public.mengantar.com',MENGANTAR_API_KEY:'synthetic_key_0123456789'}:{}),
 EXTERNAL_DISPATCH:'disabled',DATABASE_HOST:'synthetic-host',DATABASE_APP_PASSWORD:'synthetic-app-password-0123456789',CLIENT_IP_HEADER:'x-real-ip'});
async function as<T>(env:NodeJS.ProcessEnv,run:()=>Promise<T>){const saved=process.env;process.env=env;try{return await run();}finally{process.env=saved;}}
const hex=()=>randomBytes(12).toString('hex');
// JNE omits unsupported_cod (as observed live) and is therefore prepaid-only; SiCepat states COD support here.
const observed={success:true,data:{JNE:{price:11000,estimate_delivery:'2-3'},SiCepat:{price:8500,unsupported_cod:false},SAP:{price:9000,unsupported_cod:true},JNECargo:{price:70000},anteraja:{price:9000,unsupported:true}}};

test('S95 production: Mengantar areas are the destinations, the warehouse area is the origin and plans carry the mengantar source',async()=>{
 const f=await shippingFixture();const origin=hex(),destination=hex(),version=`test-${hex()}`;const seen:(string|null)[]=[];
 const adapter:RateAdapter={source:'mengantar',version:MENGANTAR_RATE_VERSION,async estimate(request){seen.push(request.origin_area_id);if(!request.origin_area_id) return [];
  return parseEstimate(observed,{origin:request.origin_area_id,destination:request.destination_id,grams:1000}).map(r=>({...r,expires_at:new Date(Date.parse(request.now)+600000).toISOString()}));}};
 const warehouses=f.identity.sql`select warehouse_id from app.local_fixture_warehouse where namespace=${f.namespace}`;
 try{
  await f.identity.sql`insert into app.shipping_area (id,province,city,district,subdistrict,postal_code,dataset_version) values
   (${origin},'JAWA TIMUR','MALANG','KLOJEN','KAUMAN','65119',${version}),(${destination},'DKI JAKARTA','JAKARTA SELATAN','TEBET','TEBET BARAT SINTETIS','12810',${version})`;
  await f.identity.sql`update app.warehouse set provider_area_id=${origin} where id in (${warehouses})`;
  await as(production('mengantar'),async()=>{
   const found=await searchDestinations(f.identity.sql,'tebet barat sintetis');
   assert.deepEqual(found.map(d=>[d.id,d.label,d.source,d.version]),[[destination,'Tebet Barat Sintetis, Tebet, Jakarta Selatan, Dki Jakarta 12810','mengantar',version]]);
   assert.equal(await findDestination(f.identity.sql,'test-malang'),null,'fixture ids are not production destinations');
   assert.deepEqual(await searchDestinations(f.identity.sql,'%'),[],'LIKE wildcards are literal');
   const address=await normalizeAddress(f.identity.sql,{recipient_name:'Synthetic Buyer',phone:'081234567890',address_line:'Jl. Sintetis 1',destination_id:destination,postal_code:'12810'});
   assert.deepEqual([address.source,address.destination_version,address.district],['mengantar',version,'Tebet']);
   await assert.rejects(normalizeAddress(f.identity.sql,{recipient_name:'Synthetic Buyer',phone:'081234567890',address_line:'Jl. Sintetis 1',destination_id:destination,postal_code:'00001'}),denied('DESTINATION_POSTCODE_MISMATCH'));
   const lines=[f.line('fixture-offer-shirt')];
   const plans=await f.identity.sql.begin(tx=>buildShippingPlans(tx,{lines,payment_method:'prepaid',destination_id:destination},{clock_namespace:f.namespace,adapter}));
   assert.ok(seen.length&&seen.every(id=>id===origin),'every estimate uses the warehouse area');
   assert.deepEqual([plans[0].source,plans[0].destination_version,plans[0].shipping_total],['mengantar',version,8500]);
   assert.deepEqual(plans[0].packages[0].options.map(o=>[o.service_id,o.shipping_amount]),[['SiCepat',8500],['SAP',9000],['JNE',11000]]);
   const cod=await f.identity.sql.begin(tx=>buildShippingPlans(tx,{lines,payment_method:'cod',destination_id:destination},{clock_namespace:f.namespace,adapter}));
   assert.deepEqual(cod[0].packages[0].options.map(o=>o.service_id),['SiCepat'],'no-COD and unknown-COD couriers are hidden from a COD plan');
   // Moving the warehouse clears its area: no origin, no live rate, no route.
   await f.identity.sql`update app.warehouse set district=district||' Pindah' where id in (${warehouses})`;
   const [moved]=await f.identity.sql`select count(*)::int n from app.warehouse where id in (${warehouses}) and provider_area_id is not null`;assert.equal(moved.n,0);
   await assert.rejects(f.identity.sql.begin(tx=>buildShippingPlans(tx,{lines,payment_method:'prepaid',destination_id:destination},{clock_namespace:f.namespace,adapter})),denied('NO_SUPPORTED_ROUTE'));
  });
  await as(production('disabled'),async()=>{await assert.rejects(findDestination(f.identity.sql,destination),denied('SHIPPING_UNAVAILABLE'));});
 }finally{
  await f.identity.sql`update app.warehouse set provider_area_id=null,district=regexp_replace(district,' Pindah$','') where id in (${warehouses})`;
  await f.identity.sql`delete from app.shipping_area where id in (${origin},${destination})`;await f.close();
 }
});
