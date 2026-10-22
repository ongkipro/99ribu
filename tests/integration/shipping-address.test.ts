import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeAddress,findDestinations} from '../../src/modules/shipping/address.ts';
import {estimateRates,localRateAdapter,rateBand} from '../../src/modules/shipping/rates.ts';
const denied=(code:string)=>(error:unknown)=>error instanceof Error&&'code' in error&&error.code===code;
const address={recipient_name:'Synthetic O’Test',phone:'0812 3456 7890',address_line:'Synthetic house / RT 01 RW 02',destination_id:'test-malang',postal_code:'00001'};
test('canonical TEST-ONLY Indonesian address/phone normalization preserves legitimate text and rejects fee/region/postcode authority',()=>{
 const normalized=normalizeAddress(address);assert.equal(normalized.phone,'+6281234567890');assert.equal(normalized.source,'TEST-ONLY');assert.equal(normalized.city,'Malang');
 for(const phone of ['+6281234567890','6281234567890','81234567890','(0812) 3456-7890']) assert.equal(normalizeAddress({...address,phone}).phone,normalized.phone);
 assert.ok(findDestinations('malang').length>0);assert.equal(findDestinations('missing').length,0);
 for(const input of [{...address,shipping_amount:0},{...address,phone:'abc'},{...address,recipient_name:'bad\nname'},{...address,phone:'+62081234567890'}]) assert.throws(()=>normalizeAddress(input));
 assert.throws(()=>normalizeAddress({...address,destination_id:'unknown'}),denied('DESTINATION_UNAVAILABLE'));
 assert.throws(()=>normalizeAddress({...address,postal_code:'00002'}),denied('DESTINATION_POSTCODE_MISMATCH'));
});
test('actual read-only rate adapter validates source, reachability, COD, expiry, integer money and a bounded timeout without effects',async()=>{
 const request={warehouse_id:'00000000-0000-4000-8000-000000000001',origin:{province:'Jawa Timur',city:'Malang',district:'Kecamatan Gudang Contoh A'},destination_id:'test-malang',measures:{weight_grams:1500,length_mm:200,width_mm:150,height_mm:300},now:new Date().toISOString()};
 const rates=await estimateRates(localRateAdapter,request);assert.equal(rates.find((r)=>r.service_id==='test-economy')?.shipping_amount,12000);assert.equal(rates.find((r)=>r.service_id==='test-regular')?.shipping_amount,15000);
 assert.deepEqual(await estimateRates(localRateAdapter,{...request,destination_id:'test-no-route'}),[]);
 assert.ok((await estimateRates(localRateAdapter,{...request,destination_id:'test-prepaid-only'})).every((r)=>!r.supports_cod));
 await assert.rejects(estimateRates({async estimate(){return [{...rates[0],shipping_amount:-1}];}},request),denied('SHIPPING_RATE_INVALID'));
 await assert.rejects(estimateRates({async estimate(){return [{...rates[0],private_provider_payload:'synthetic-private'}];}},request),denied('SHIPPING_RATE_INVALID'));
 await assert.rejects(estimateRates({async estimate(){return [{...rates[0],expires_at:new Date(Date.now()-60000).toISOString()}];}},request),denied('SHIPPING_RATE_EXPIRED'));
 await assert.rejects(estimateRates({async estimate(){return [{...rates[0],expires_at:'2026-02-30T00:00:00.000Z'}];}},request),denied('SHIPPING_RATE_INVALID'));
 let aborted=false;await assert.rejects(estimateRates({async estimate(_,signal){signal.addEventListener('abort',()=>{aborted=true;});return new Promise(()=>{});}},request),denied('SHIPPING_RATE_TIMEOUT'));assert.equal(aborted,true);
});
test('DEC-006 simulated rates band by kecamatan-level origin: same kecamatan < same city < same province < inter-province',async()=>{
 const measures={weight_grams:1500,length_mm:200,width_mm:150,height_mm:300},now=new Date().toISOString();
 const economy=async(origin:{province:string|null;city:string;district:string|null})=>(await estimateRates(localRateAdapter,{warehouse_id:'00000000-0000-4000-8000-000000000002',origin,destination_id:'test-malang',measures,now})).find((r)=>r.service_id==='test-economy')?.shipping_amount;
 // test-malang is Jawa Timur / Malang / Kecamatan Contoh A; one 1 kg step (4000) on each band base.
 const district=await economy({province:'JAWA TIMUR',city:'malang',district:'Kecamatan  Contoh A'}),city=await economy({province:'Jawa Timur',city:'Malang',district:'Kecamatan Lain'});
 const province=await economy({province:'Jawa Timur',city:'Surabaya',district:'Kecamatan Contoh A'}),national=await economy({province:'Banten',city:'Malang',district:'Kecamatan Contoh A'});
 assert.deepEqual([district,city,province,national],[10000,12000,19000,27000]);
 // Pre-DEC-006 rows without province/district compare by city only.
 assert.equal(await economy({province:null,city:'Malang',district:null}),12000);assert.equal(await economy({province:null,city:'Pontianak',district:null}),27000);
 // A kecamatan name only matches inside the same city; "Kota"/"Kabupaten" prefixes are not merged.
 assert.equal(rateBand({province:'Jawa Timur',city:'Kabupaten Malang',district:'Kecamatan Contoh A'},{province:'Jawa Timur',city:'Malang',district:'Kecamatan Contoh A'}),'province');
 await assert.rejects(estimateRates(localRateAdapter,{warehouse_id:'00000000-0000-4000-8000-000000000002',origin:{province:null,city:' ',district:null},destination_id:'test-malang',measures,now}),denied('ROUTE_UNCONFIGURED'));
});
