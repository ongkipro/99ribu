import assert from 'node:assert/strict';
import test from 'node:test';
import {META_EVENT_MAX_AGE_MS,META_GRAPH_API_VERSION,localMetaSink,mapMetaPurchase,metaVendorSchemaUnverified} from '../../src/modules/advertising/meta/capi.ts';
import type {Consent} from '../../src/modules/consent/receipts.ts';

// Synthetic data only. Expected digests were computed outside the module (sha256sum) from the normalized values.
const EMAIL='13faa1183908e75429c479c4eeb20af902a285f5aaa273ba24285c2c9862824a',PHONE='dd752605096029a73495a91862983963e1947a834a4300808074185af10bb725',EXTERNAL='469d9fe21292020acecb422eb41a723154b9de8e011e8f438c788afc64982184';
const FBP='fb.1.1760850000000.1234567890',FBC='fb.1.1760850000000.IwAR-synthetic_click';
const occurred='2026-10-17T03:04:05.678Z',now=new Date('2026-10-19T00:00:00.000Z'),eventId='7f9c2b1e-4d3a-4c5b-9e8f-0a1b2c3d4e5f';
const choices=(meta='granted',measurement='granted')=>({analytics:'unspecified',advertising_measurement:measurement,marketing:'denied',meta,google:'denied',tiktok:'denied',google_signals:{ad_storage:'denied',analytics_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'}}) as Consent['choices'];
const consent=(id:string,c=choices()):Consent=>({id,visitor_id:'v-1',revision:1,policy_version:'local-privacy-v1',choices:c,effective_at:'2026-10-17T00:00:00.000Z',expires_at:'2026-10-20T00:00:00.000Z'});
const base=()=>({
 outbox:{id:'o-meta-1',event_id:eventId,platform:'meta',status:'queued',expires_at:'2026-10-20T00:00:00.000Z'},
 event:{id:eventId,name:'Purchase',source_kind:'economic_receipt',occurred_at:new Date(occurred),merchandise_amount:'198000',payload:{currency:'IDR' as const,contents:[{id:'OFR-0001',quantity:1,merchandise_amount:99000},{id:'OFR-0002',quantity:1,merchandise_amount:99000}],content_ids:['OFR-0001','OFR-0002']}},
 captured:consent('c-1'),current:consent('c-2'),now,
 matching:{email:'  Buyer.Synthetic@Example.TEST ',phone:'0812-3456-7890',external_id:'visitor-synthetic-0001',fbp:FBP,fbc:FBC},
});
const mapped=(input:Parameters<typeof mapMetaPurchase>[0])=>{const m=mapMetaPurchase(input);assert.equal(m.status,'mapped');return m as Extract<typeof m,{status:'mapped'}>;};

test('Meta Purchase maps stored identity, original UTC seconds, exact IDR value and offer catalog ids',()=>{
 const m=mapped(base()),[event]=m.body.data;
 assert.equal(META_GRAPH_API_VERSION,'v26.0');assert.equal(m.body.data.length,1);
 assert.equal(event.event_name,'Purchase');assert.equal(event.event_id,eventId);assert.equal(event.action_source,'website');
 assert.equal(event.event_time,Math.floor(Date.parse(occurred)/1000));assert.equal(event.event_time,1792206245);
 assert.deepEqual(event.custom_data,{currency:'IDR',value:198000,content_type:'product',content_ids:['OFR-0001','OFR-0002'],contents:[{id:'OFR-0001',quantity:1,item_price:99000},{id:'OFR-0002',quantity:1,item_price:99000}]});
 assert.equal(typeof event.custom_data.value,'number');
 // Allowlist only: no order id, receipt, address, shipping/fee, cost or raw contact reaches the vendor body.
 assert.doesNotMatch(JSON.stringify(m.body),/order_id|receipt|address|shipping|Buyer|Synthetic@|0812|hpp/i);
 const later=mapped({...base(),now:new Date('2026-10-19T23:59:00.000Z')});assert.deepEqual(later.body,m.body,'retry keeps original time and payload');
});

test('matching identifiers follow Meta normalization and hashing; click/browser ids stay raw',()=>{
 const {user_data}=mapped(base()).body.data[0];
 assert.deepEqual(user_data,{em:[EMAIL],ph:[PHONE],external_id:[EXTERNAL],fbp:FBP,fbc:FBC});
 for(const phone of ['+62 812 3456 7890','62(812)34567890','812-3456-7890'])assert.deepEqual(mapped({...base(),matching:{phone}}).body.data[0].user_data,{ph:[PHONE]});
 // Unavailable or malformed identity is omitted, never synthesized or hashed empty.
 const omitted=mapped({...base(),matching:{email:'   ',phone:'not-a-phone',external_id:' ',fbp:'abc',fbc:'fb.1.x.'}});
 assert.deepEqual(omitted.body.data[0].user_data,{});assert.ok(omitted.blockers.includes('user_data_empty'));
 assert.deepEqual(mapped({...base(),matching:null}).body.data[0].user_data,{});
 assert.deepEqual(mapped(base()).blockers,['event_source_url','client_user_agent']);
});

test('consent denied, withdrawn, expired or missing maps nothing at all',()=>{
 const denied=consent('c-2',choices('denied')),unmeasured=consent('c-2',choices('granted','denied'));
 const cases=[{current:denied},{captured:denied},{current:unmeasured},{captured:unmeasured},{current:null},{captured:null},
  {current:{...consent('c-2'),expires_at:'2026-10-18T00:00:00.000Z'}},{current:{...consent('c-2'),effective_at:'2026-10-19T01:00:00.000Z'}}];
 for(const change of cases){
  const m=mapMetaPurchase({...base(),...change});assert.deepEqual(m,{status:'suppressed',outbox_id:'o-meta-1',reason:'withdrawn'});
  assert.doesNotMatch(JSON.stringify(m),new RegExp(`${EMAIL}|${PHONE}|${EXTERNAL}|fb\\.1`));
 }
});

test('only queued Meta economic Purchase decisions map; aged events are never redated',()=>{
 const reason=(input:Parameters<typeof mapMetaPurchase>[0])=>{const m=mapMetaPurchase(input);return m.status==='suppressed'?m.reason:m.status;};
 for(const status of ['suppressed','cancelled','quarantined','accepted'])assert.equal(reason({...base(),outbox:{...base().outbox,status}}),'not_queued');
 assert.equal(reason({...base(),outbox:{...base().outbox,platform:'tiktok'}}),'not_meta');assert.equal(reason({...base(),outbox:{...base().outbox,event_id:'other'}}),'not_meta');
 for(const event of [{...base().event,name:'cart_changed'},{...base().event,source_kind:'browser'}])assert.equal(reason({...base(),event}),'unsupported_event');
 assert.equal(reason({...base(),outbox:{...base().outbox,expires_at:now.toISOString()}}),'expired');
 // Isolate Meta's 7-day age limit from the shorter local outbox/consent lifetimes.
 const far='2026-12-01T00:00:00.000Z',aged=(ms:number)=>({...base(),outbox:{...base().outbox,expires_at:far},captured:{...consent('c-1'),expires_at:far},current:{...consent('c-2'),expires_at:far},now:new Date(Date.parse(occurred)+ms)});
 assert.equal(reason(aged(META_EVENT_MAX_AGE_MS+1)),'expired');
 const edge=mapped(aged(META_EVENT_MAX_AGE_MS));assert.equal(edge.body.data[0].event_time,1792206245);
});

test('ambiguous money evidence is refused rather than reported',()=>{
 const event=base().event;
 for(const bad of [{...event,merchandise_amount:'99000'},{...event,merchandise_amount:'0',payload:{...event.payload,contents:[]}},{...event,merchandise_amount:'198000.5'},{...event,payload:{...event.payload,content_ids:['OFR-0002','OFR-0001']}},{...event,merchandise_amount:'100001',payload:{currency:'IDR' as const,contents:[{id:'OFR-0001',quantity:2,merchandise_amount:100001}],content_ids:['OFR-0001']}}])
  assert.throws(()=>mapMetaPurchase({...base(),event:bad}),{code:'PURCHASE_SOURCE_NOT_ELIGIBLE'});
 const split=mapped({...base(),event:{...event,merchandise_amount:99000,payload:{currency:'IDR',contents:[{id:'OFR-0001',quantity:1,merchandise_amount:99000}],content_ids:['OFR-0001']}}});
 assert.equal(split.body.data[0].custom_data.value,99000,'one collected COD parcel reports only its own allocation');
});

test('local sink dedupes by stored event identity, refuses divergent replays and never dispatches',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=(async()=>{calls++;throw new Error('network forbidden');}) as typeof fetch;
 try{
  const sink=localMetaSink(),m=mapped(base());
  assert.deepEqual(sink.accept(m),{status:'accepted_local',event_id:eventId,outbox_id:'o-meta-1'});
  assert.deepEqual(sink.accept(mapped({...base(),now:new Date('2026-10-19T12:00:00.000Z')})),{status:'duplicate',event_id:eventId,outbox_id:'o-meta-1'});
  assert.throws(()=>sink.accept(mapped({...base(),matching:{email:'other@example.test'}})),{code:'IDEMPOTENCY_CONFLICT'});
  assert.equal(sink.records.size,1);assert.deepEqual(sink.records.get(eventId)?.body,m.body);
  assert.deepEqual(sink.dispatch(),{status:'disabled',code:'META_DISPATCH_DISABLED'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});

test('current vendor schema limitations stay explicit and gated',()=>{
 for(const gate of ['real_dispatch','browser_pixel_purchase','action_source_cod','event_source_url','client_user_agent','matching_source','valid_user_data_combinations','data_processing_options','non_purchase_events','adjustments'])
  assert.ok(metaVendorSchemaUnverified.some(g=>g.startsWith(gate)),gate);
 const event=mapped(base()).body.data[0] as Record<string,unknown>;
 for(const gated of ['event_source_url','data_processing_options','opt_out','test_event_code'])assert.equal(gated in event,false,gated);
 assert.equal('client_user_agent' in (event.user_data as object),false);assert.equal('client_ip_address' in (event.user_data as object),false);
});
