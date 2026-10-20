import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {TIKTOK_MARKETING_API_VERSION,localTiktokSink,mapTiktokPurchase,tiktokVendorSchemaUnverified} from '../../src/modules/advertising/tiktok/events-api.ts';
import type {Consent} from '../../src/modules/consent/receipts.ts';

// Synthetic data only. Expected digests were computed outside the module (sha256sum) from the normalized values;
// VENDOR_* are TikTok's own documented examples (" ALICE_abc@gmail.com ", "user_123").
const EMAIL='13faa1183908e75429c479c4eeb20af902a285f5aaa273ba24285c2c9862824a',PHONE='62397bbd6a8c9ae53bc914a6017300eb6b13af5be20e4cc9ad2dc3d61ecb24cd',EXTERNAL='469d9fe21292020acecb422eb41a723154b9de8e011e8f438c788afc64982184';
const VENDOR_EMAIL='848a771458438fc2ec420560d769fb9b9b86851ee338ec56517baabd79d3bb4f',VENDOR_EXTERNAL='80fba0ae1c48e3978e43e4efc365e14e12ea0c830ba8ba5b9a2dafc7e3f2ab8b';
const TTCLID='E.C.P.synthetic-ttclid_0001',TTP='01234567-synthetic-ttp_0001',PIXEL='CSYNTHETICPIXEL0001';
// One split COD order: parcel A collected two offers (Rp198.000), parcel B one (Rp99.000).
const occurred='2026-10-17T03:04:05.678Z',now=new Date('2026-10-19T00:00:00.000Z');
const A='7f9c2b1e-4d3a-4c5b-9e8f-0a1b2c3d4e5f',B='0d6a9c1f-2b3e-4f50-8a7b-6c5d4e3f2a1b';
const choices=(tiktok='granted',measurement='granted')=>({analytics:'unspecified',advertising_measurement:measurement,marketing:'denied',meta:'denied',google:'denied',tiktok,google_signals:{ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'}}) as Consent['choices'];
const consent=(id:string,c=choices()):Consent=>({id,visitor_id:'v-1',revision:1,policy_version:'local-privacy-v1',choices:c,effective_at:'2026-10-17T00:00:00.000Z',expires_at:'2026-10-20T00:00:00.000Z'});
const destination=()=>({platform:'tiktok',external_destination_id:PIXEL,enabled:true,server_purchase_enabled:true,browser_purchase_enabled:false});
const parcel=(id:string,offers:string[])=>({id,name:'Purchase',source_kind:'economic_receipt',occurred_at:new Date(occurred),merchandise_amount:String(99000*offers.length),payload:{currency:'IDR' as const,contents:offers.map(o=>({id:o,quantity:1,merchandise_amount:99000})),content_ids:offers}});
const base=(event=parcel(A,['OFR-0001','OFR-0002']))=>({
 outbox:{id:`o-${event.id}`,event_id:event.id,platform:'tiktok',status:'queued',expires_at:'2026-10-20T00:00:00.000Z'},
 event,destination:destination(),captured:consent('c-1'),current:consent('c-2'),now,
 matching:{email:'  Buyer.Synthetic@Example.TEST ',phone:'0812-3456-7890',external_id:'visitor-synthetic-0001',ttclid:TTCLID,ttp:TTP} as Parameters<typeof mapTiktokPurchase>[0]['matching'],
});
const mapped=(input:Parameters<typeof mapTiktokPurchase>[0])=>{const m=mapTiktokPurchase(input);assert.equal(m.status,'mapped');return m as Extract<typeof m,{status:'mapped'}>;};
const reason=(input:Parameters<typeof mapTiktokPurchase>[0])=>{const m=mapTiktokPurchase(input);return m.status==='suppressed'?m.reason:m.status;};

test('TikTok Purchase maps stored identity, original UTC seconds, exact IDR value and offer catalog ids',()=>{
 const m=mapped(base()),[event]=m.body.data;
 assert.equal(TIKTOK_MARKETING_API_VERSION,'v1.3');assert.equal(m.body.event_source,'web');assert.equal(m.body.event_source_id,PIXEL);assert.equal(m.body.data.length,1);
 assert.equal(event.event,'Purchase');assert.equal(event.event_id,A);assert.equal(m.event_id,A);
 assert.equal(event.event_time,Math.floor(Date.parse(occurred)/1000));assert.equal(event.event_time,1792206245);
 assert.deepEqual(event.properties,{currency:'IDR',value:198000,content_type:'product',content_ids:['OFR-0001','OFR-0002'],contents:[{content_id:'OFR-0001',quantity:1,price:99000},{content_id:'OFR-0002',quantity:1,price:99000}]});
 assert.ok(Number.isSafeInteger(event.properties.value),'integer rupiah, not a formatted string');
 // Allowlist only: no order id, receipt, address, shipping/fee, cost or raw contact reaches the vendor body.
 assert.doesNotMatch(JSON.stringify(m.body),/order_id|receipt|address|shipping|Buyer|Synthetic@|0812|hpp|CompletePayment/i);
 const later=mapped({...base(),now:new Date('2026-10-19T23:59:00.000Z')});assert.deepEqual(later.body,m.body,'retry keeps original time and payload');
 const b=mapped(base(parcel(B,['OFR-0003'])));
 assert.equal(b.body.data[0].properties.value,99000,'the other collected COD parcel reports only its own allocation');assert.equal(b.event_id,B);
 const two=mapped(base({...parcel(A,['OFR-0001']),merchandise_amount:'198000',payload:{currency:'IDR',contents:[{id:'OFR-0001',quantity:2,merchandise_amount:198000}],content_ids:['OFR-0001']}}));
 assert.deepEqual(two.body.data[0].properties.contents,[{content_id:'OFR-0001',quantity:2,price:99000}],'price is per unit, value is the total');
});

test('matching identifiers follow TikTok normalization and hashing; click/cookie ids stay raw',()=>{
 const {user}=mapped(base()).body.data[0];
 assert.deepEqual(user,{email:EMAIL,phone:PHONE,external_id:EXTERNAL,ttclid:TTCLID,ttp:TTP});
 assert.deepEqual(mapped({...base(),matching:{email:' ALICE_abc@gmail.com ',external_id:'user_123'}}).body.data[0].user,{email:VENDOR_EMAIL,external_id:VENDOR_EXTERNAL},'TikTok documented examples');
 // E.164 keeps the '+' (Meta drops it): the hash of the unprefixed digits must never appear.
 for(const phone of ['+62 812 3456 7890','62(812)34567890','812-3456-7890'])assert.deepEqual(mapped({...base(),matching:{phone}}).body.data[0].user,{phone:PHONE});
 assert.notEqual(PHONE,'dd752605096029a73495a91862983963e1947a834a4300808074185af10bb725');
 // Unavailable or malformed identity is omitted, never synthesized or hashed empty.
 const omitted=mapped({...base(),matching:{email:'   ',phone:'not-a-phone',external_id:' ',ttclid:'has space',ttp:'x'.repeat(501)}});
 assert.deepEqual(omitted.body.data[0].user,{});assert.ok(omitted.blockers.includes('user_empty'));
 assert.deepEqual(mapped({...base(),matching:null}).body.data[0].user,{});
 assert.deepEqual(mapped(base()).blockers,['page_url']);
});

test('consent denied, withdrawn, expired or missing maps nothing at all',()=>{
 const denied=consent('c-2',choices('denied')),unmeasured=consent('c-2',choices('granted','denied'));
 const cases=[{current:denied},{captured:denied},{current:unmeasured},{captured:unmeasured},{current:null},{captured:null},
  {current:{...consent('c-2'),expires_at:'2026-10-18T00:00:00.000Z'}},{current:{...consent('c-2'),effective_at:'2026-10-19T01:00:00.000Z'}}];
 for(const change of cases){
  const m=mapTiktokPurchase({...base(),...change});assert.deepEqual(m,{status:'suppressed',outbox_id:`o-${A}`,reason:'withdrawn'});
  assert.doesNotMatch(JSON.stringify(m),new RegExp(`${EMAIL}|${PHONE}|${EXTERNAL}|synthetic-tt|${PIXEL}|OFR-`));
 }
});

test('only queued TikTok economic Purchase decisions for the owned Pixel map; expired decisions are never redated',()=>{
 for(const status of ['suppressed','cancelled','quarantined','accepted'])assert.equal(reason({...base(),outbox:{...base().outbox,status}}),'not_queued');
 assert.equal(reason({...base(),outbox:{...base().outbox,platform:'meta'}}),'not_tiktok');assert.equal(reason({...base(),outbox:{...base().outbox,event_id:B}}),'not_tiktok');
 for(const event of [{...base().event,name:'cart_changed'},{...base().event,source_kind:'browser'}])assert.equal(reason({...base(),event}),'unsupported_event');
 for(const bad of [{platform:'google'},{enabled:false},{server_purchase_enabled:false},{browser_purchase_enabled:true},{external_destination_id:''},{external_destination_id:'C PIXEL'},{external_destination_id:'C'.repeat(101)}])
  assert.equal(reason({...base(),destination:{...destination(),...bad}}),'destination_invalid',JSON.stringify(bad));
 assert.equal(reason({...base(),outbox:{...base().outbox,expires_at:now.toISOString()}}),'expired');
 // No vendor age limit is documented: inside the local outbox lifetime the original seconds are kept.
 const far='2026-12-01T00:00:00.000Z',aged=mapped({...base(),outbox:{...base().outbox,expires_at:far},captured:{...consent('c-1'),expires_at:far},current:{...consent('c-2'),expires_at:far},now:new Date('2026-11-20T00:00:00.000Z')});
 assert.equal(aged.body.data[0].event_time,1792206245);
});

test('ambiguous money evidence is refused rather than reported',()=>{
 const event=base().event;
 for(const bad of [{...event,merchandise_amount:'99000'},{...event,merchandise_amount:'0',payload:{...event.payload,contents:[]}},{...event,merchandise_amount:'198000.5'},{...event,payload:{...event.payload,content_ids:['OFR-0002','OFR-0001']}},{...event,merchandise_amount:'100001',payload:{currency:'IDR' as const,contents:[{id:'OFR-0001',quantity:2,merchandise_amount:100001}],content_ids:['OFR-0001']}}])
  assert.throws(()=>mapTiktokPurchase({...base(),event:bad}),{code:'PURCHASE_SOURCE_NOT_ELIGIBLE'});
});

test('local sink dedupes by stored event identity, refuses divergent replays and never dispatches',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=(async()=>{calls++;throw new Error('network forbidden');}) as typeof fetch;
 try{
  const sink=localTiktokSink(),m=mapped(base()),b=mapped(base(parcel(B,['OFR-0003'])));
  assert.deepEqual(sink.accept(m),{status:'accepted_local',event_id:A,outbox_id:`o-${A}`});
  assert.deepEqual(sink.accept(mapped({...base(),now:new Date('2026-10-19T12:00:00.000Z')})),{status:'duplicate',event_id:A,outbox_id:`o-${A}`});
  assert.throws(()=>sink.accept(mapped({...base(),matching:{email:'other@example.test'}})),{code:'IDEMPOTENCY_CONFLICT'});
  assert.throws(()=>sink.accept(mapped({...base(),destination:{...destination(),external_destination_id:'COTHERPIXEL'}})),{code:'IDEMPOTENCY_CONFLICT'});
  assert.deepEqual(sink.accept(b),{status:'accepted_local',event_id:B,outbox_id:`o-${B}`},'the second COD parcel is its own purchase');
  assert.equal(sink.records.size,2);assert.deepEqual(sink.records.get(A)?.body,m.body);
  assert.deepEqual(sink.dispatch(),{status:'disabled',code:'TIKTOK_DISPATCH_DISABLED'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});

test('browser Pixel stays off and current vendor schema limitations stay explicit and gated',()=>{
 for(const gate of ['real_dispatch','browser_pixel_purchase','page_url','ip_user_agent','click_identifier_source','click_identifier_format','matching_source','cod_event_source','event_age_limit','dedupe_window','retry_classification','test_events','pixel_code_format','catalog_match','limited_data_use','non_purchase_events','adjustments'])
  assert.ok(tiktokVendorSchemaUnverified.some(g=>g.startsWith(`${gate}:`)),gate);
 const event=mapped(base()).body.data[0] as Record<string,unknown>;
 for(const gated of ['page','limited_data_use','test_event_code','ad','app','lead'])assert.equal(gated in event,false,gated);
 for(const gated of ['ip','user_agent','phone_number','locale'])assert.equal(gated in (event.user as object),false,gated);
 for(const gated of ['order_id','shop_id','num_items','description'])assert.equal(gated in (event.properties as object),false,gated);
 // No browser TikTok Pixel loader or ttq call exists anywhere in application source.
 const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
 for(const file of files('src'))assert.doesNotMatch(readFileSync(file,'utf8'),/\bttq\s*\.|analytics\.tiktok\.com|TiktokAnalyticsObject/,file);
});
