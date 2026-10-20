import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {GOOGLE_CONVERSION_SOURCE,googleVendorSchemaUnverified,localGoogleSink,mapGoogleConversion,mapGoogleRestatement} from '../../src/modules/advertising/google/offline-clicks.ts';
import type {Consent} from '../../src/modules/consent/receipts.ts';

// Synthetic data only: one split COD order, parcel A collected two offers (Rp198.000) and parcel B one (Rp99.000).
const occurred='2026-10-17T03:04:05.678Z',now=new Date('2026-10-19T00:00:00.000Z'),landed='2026-10-16T22:00:00.000Z';
const A='7f9c2b1e-4d3a-4c5b-9e8f-0a1b2c3d4e5f',B='0d6a9c1f-2b3e-4f50-8a7b-6c5d4e3f2a1b',GCLID='Cj0KCQjw-synthetic_GCLID01';
const choices=(google='granted',ad_user_data='granted',ad_personalization='denied',measurement='granted')=>({analytics:'unspecified',advertising_measurement:measurement,marketing:'denied',meta:'denied',google,tiktok:'denied',google_signals:{ad_storage:'denied',analytics_storage:'denied',ad_user_data,ad_personalization}}) as Consent['choices'];
const consent=(id:string,c=choices()):Consent=>({id,visitor_id:'v-1',revision:1,policy_version:'local-privacy-v1',choices:c,effective_at:'2026-10-16T00:00:00.000Z',expires_at:'2026-10-20T00:00:00.000Z'});
const destination=()=>({platform:'google',external_destination_id:'1234567890',conversion_action_id:'987654321',enabled:true,server_purchase_enabled:true,browser_purchase_enabled:false,google_conversion_source:'UPLOAD_CLICKS'});
const parcel=(id:string,receipt_id:string,offers:string[])=>({id,name:'Purchase',source_kind:'economic_receipt',receipt_id,occurred_at:new Date(occurred),merchandise_amount:String(99000*offers.length),payload:{currency:'IDR' as const,contents:offers.map(o=>({id:o,quantity:1,merchandise_amount:99000})),content_ids:offers}});
const base=(event=parcel(A,'r-a',['OFR-0001','OFR-0002']))=>({
 outbox:{id:`o-${event.id}`,event_id:event.id,platform:'google',status:'queued',expires_at:'2026-10-20T00:00:00.000Z'},
 event,destination:destination(),captured:consent('c-1'),current:consent('c-2'),now,click:{gclid:GCLID,captured_at:landed} as Parameters<typeof mapGoogleConversion>[0]['click'],
});
const mapped=(input:Parameters<typeof mapGoogleConversion>[0])=>{const m=mapGoogleConversion(input);assert.equal(m.status,'mapped');return m as Extract<typeof m,{status:'mapped'}>;};
const reason=(input:Parameters<typeof mapGoogleConversion>[0])=>{const m=mapGoogleConversion(input);return m.status==='suppressed'?m.reason:m.status;};
const intent=(id:string,sequence:number,refunded:number,retained:number,over:Partial<Parameters<typeof mapGoogleRestatement>[0]['intent']>={})=>({id,receipt_id:'r-a',purchase_event_id:A as string|null,dispatch_reason:'pending_adapter',sequence,merchandise_refunded:String(refunded),retained_merchandise:String(retained),allocation:Array.from({length:refunded/99000},()=>({merchandise_amount:99000})),original_occurred_at:occurred,...over});

test('Google offline click conversion maps the owned UPLOAD_CLICKS action, original RFC 3339 time and integer IDR',()=>{
 const m=mapped(base()),[event]=m.body.events;
 assert.equal(GOOGLE_CONVERSION_SOURCE,'UPLOAD_CLICKS');
 assert.deepEqual(m.body.destinations,[{operatingAccount:{accountType:'GOOGLE_ADS',accountId:'1234567890'},productDestinationId:'987654321'}]);
 assert.deepEqual(event,{transactionId:A,eventTimestamp:occurred,eventSource:'WEB',conversionValue:198000,currency:'IDR',adIdentifiers:{gclid:GCLID},consent:{adUserData:'CONSENT_GRANTED',adPersonalization:'CONSENT_DENIED'}});
 assert.ok(Number.isSafeInteger(event.conversionValue),'currency units, not micros or a formatted string');
 assert.ok(event.transactionId.length<=64);assert.deepEqual(m.blockers,['login_account']);
 // Allowlist only: no order/receipt/offer/contact/shipping detail or unverified field reaches the vendor body.
 assert.doesNotMatch(JSON.stringify(m.body),/order|receipt|OFR-|address|shipping|hpp|"userData"|cartData|loginAccount|validateOnly|encoding|conversionCount/i);
 const later=mapped({...base(),now:new Date('2026-10-19T23:59:00.000Z')});assert.deepEqual(later.body,m.body,'retry keeps original time and payload');
 const b=mapped(base(parcel(B,'r-b',['OFR-0003'])));
 assert.equal(b.body.events[0].conversionValue,99000,'the other collected COD parcel reports only its own allocation');assert.equal(b.transaction_id,B);
});

test('owned destination and click identifiers are validated, never guessed',()=>{
 for(const bad of [{google_conversion_source:'WEBPAGE'},{browser_purchase_enabled:true},{external_destination_id:'123-456-7890'},{external_destination_id:'123456789'},{conversion_action_id:'customers/1234567890/conversionActions/987654321'},{conversion_action_id:''},{conversion_action_id:'0'},{enabled:false},{server_purchase_enabled:false},{platform:'meta'}])
  assert.equal(reason({...base(),destination:{...destination(),...bad}}),'destination_invalid',JSON.stringify(bad));
 assert.equal(reason({...base(),click:null}),'no_click_identifier');assert.equal(reason({...base(),click:{captured_at:landed}}),'no_click_identifier');
 for(const click of [{gclid:GCLID,gbraid:'GBRAID_synthetic'},{gbraid:'GBRAID_synthetic',wbraid:'WBRAID_synthetic'},{gclid:GCLID,wbraid:'WBRAID_synthetic'}])
  assert.equal(reason({...base(),click:{...click,captured_at:landed}}),'click_identifier_conflict');
 for(const click of [{gclid:''},{gclid:' '},{gclid:'has space'},{gclid:'x'.repeat(501)},{gclid:GCLID,captured_at:occurred},{gclid:GCLID,captured_at:'2026-10-18T00:00:00.000Z'},{gclid:GCLID,captured_at:'not-a-time'}])
  assert.equal(reason({...base(),click:{captured_at:landed,...click}}),'click_identifier_invalid',JSON.stringify(click));
 assert.deepEqual(mapped({...base(),click:{gbraid:'GBRAID_synthetic',gclid:null,captured_at:landed}}).body.events[0].adIdentifiers,{gbraid:'GBRAID_synthetic'});
 assert.deepEqual(mapped({...base(),click:{wbraid:'WBRAID_synthetic',captured_at:landed}}).body.events[0].adIdentifiers,{wbraid:'WBRAID_synthetic'});
});

test('consent denied, withdrawn, expired or missing maps nothing; Data Manager consent reflects both receipts',()=>{
 const denied=consent('c-2',choices('denied')),unmeasured=consent('c-2',choices('granted','granted','denied','denied'));
 for(const change of [{current:denied},{captured:denied},{current:unmeasured},{captured:unmeasured},{current:null},{captured:null},
  {current:{...consent('c-2'),expires_at:'2026-10-18T00:00:00.000Z'}},{current:{...consent('c-2'),effective_at:'2026-10-19T01:00:00.000Z'}}]){
  const m=mapGoogleConversion({...base(),...change});assert.deepEqual(m,{status:'suppressed',outbox_id:`o-${A}`,reason:'withdrawn'});assert.doesNotMatch(JSON.stringify(m),/GCLID/);
 }
 const noUser=mapped({...base(),current:consent('c-2',choices('granted','denied','granted'))});
 assert.deepEqual(noUser.body.events[0].consent,{adUserData:'CONSENT_DENIED',adPersonalization:'CONSENT_DENIED'});assert.deepEqual(noUser.blockers,['login_account','ad_user_data_not_granted']);
 const open=mapped({...base(),captured:consent('c-1',choices('granted','unspecified','granted')),current:consent('c-2',choices('granted','granted','granted'))});
 assert.deepEqual(open.body.events[0].consent,{adUserData:'CONSENT_STATUS_UNSPECIFIED',adPersonalization:'CONSENT_GRANTED'});
});

test('only queued Google economic Purchase decisions map; expired decisions are never redated; ambiguous money is refused',()=>{
 for(const status of ['suppressed','cancelled','quarantined','accepted'])assert.equal(reason({...base(),outbox:{...base().outbox,status}}),'not_queued');
 assert.equal(reason({...base(),outbox:{...base().outbox,platform:'meta'}}),'not_google');assert.equal(reason({...base(),outbox:{...base().outbox,event_id:B}}),'not_google');
 for(const event of [{...base().event,name:'cart_changed'},{...base().event,source_kind:'browser'}])assert.equal(reason({...base(),event}),'unsupported_event');
 assert.equal(reason({...base(),outbox:{...base().outbox,expires_at:now.toISOString()}}),'expired');
 const event=base().event;
 for(const bad of [{...event,merchandise_amount:'99000'},{...event,merchandise_amount:'0',payload:{...event.payload,contents:[]}},{...event,merchandise_amount:'198000.5'}])
  assert.throws(()=>mapGoogleConversion({...base(),event:bad}),{code:'PURCHASE_SOURCE_NOT_ELIGIBLE'});
});

test('known-original restatement sends the retained value; full refund and unmatched adjustments are blocked and disclosed',()=>{
 const network=fetchless();
 try{
 const sink=localGoogleSink(),a=mapped(base()),b=mapped(base(parcel(B,'r-b',['OFR-0003'])));sink.accept(a);sink.accept(b);
 const restate=(over:Partial<Parameters<typeof mapGoogleRestatement>[0]>)=>mapGoogleRestatement({intent:intent('i-1',1,99000,99000),history:[intent('i-1',1,99000,99000)],purchase:base().event,original:sink.records.get(A)?.body??null,destination:destination(),captured:consent('c-1'),current:consent('c-2'),now,...over});
 const first=restate({});assert.equal(first.status,'mapped');if(first.status!=='mapped')throw new Error('unmapped');
 assert.deepEqual(first.body.events[0],{...a.body.events[0],conversionValue:99000},'same transactionId, original time, identifiers and action; only the retained value changes');
 assert.deepEqual(first.body.destinations,a.body.destinations);assert.equal(first.transaction_id,A);assert.equal(first.sequence,1);
 assert.deepEqual(first.blockers,['login_account','restatement_timestamp','restatement_trial_period']);
 assert.deepEqual(sink.restate(first),{status:'restated_local',transaction_id:A,sequence:1});
 assert.deepEqual(sink.records.get(B)?.body,b.body,'the unaffected COD parcel keeps its own conversion');assert.equal(sink.records.get(B)?.restatements.length,0);
 // Second unit refunded: retained Rp0. No retraction exists, so nothing is sent and the kept count is disclosed.
 const history=[intent('i-1',1,99000,99000),intent('i-2',2,99000,0)],full=restate({intent:history[1],history});
 assert.deepEqual(full,{status:'blocked',intent_id:'i-2',reason:'non_retractable'});sink.disclose(full as Extract<typeof full,{status:'blocked'}>);
 for(const unmatched of [restate({original:null}),restate({intent:intent('i-m',1,99000,99000,{purchase_event_id:null,dispatch_reason:'original_purchase_missing'})}),restate({original:{...a.body,destinations:[{...a.body.destinations[0],productDestinationId:'111'}]}}),restate({original:{...a.body,events:[{...a.body.events[0],conversionValue:99000}]}})]){
  assert.equal(unmatched.status==='blocked'&&unmatched.reason,'unmatched');sink.disclose(unmatched as Extract<typeof unmatched,{status:'blocked'}>);
 }
 assert.deepEqual(restate({current:consent('c-2',choices('denied'))}),{status:'blocked',intent_id:'i-1',reason:'withdrawn'});
 assert.deepEqual(restate({destination:{...destination(),browser_purchase_enabled:true}}),{status:'blocked',intent_id:'i-1',reason:'destination_invalid'});
 assert.deepEqual(sink.disclosure(),{unmatched:2,non_retractable:1,withdrawn:0,destination_invalid:0},'distinct intents counted once');
 assert.doesNotMatch(JSON.stringify([first,full,sink.disclosure()]),/RETRACTION|"conversionValue":-|conversionCount/);assert.equal(network.calls(),0);
 }finally{network.restore();}
});

test('retained value must equal the stored refund chain; tampered or ambiguous evidence is refused',()=>{
 const sink=localGoogleSink(),a=mapped(base());sink.accept(a);
 const run=(i:ReturnType<typeof intent>,history:ReturnType<typeof intent>[],purchase=base().event)=>()=>mapGoogleRestatement({intent:i,history,purchase,original:a.body,destination:destination(),captured:consent('c-1'),current:consent('c-2'),now});
 const bad:[ReturnType<typeof intent>,ReturnType<typeof intent>[]][]=[
  [intent('i-1',1,99000,198000),[intent('i-1',1,99000,198000)]],
  [intent('i-2',2,99000,99000),[intent('i-1',1,99000,99000),intent('i-2',2,99000,99000)]],
  [intent('i-2',2,99000,0),[intent('i-2',2,99000,0)]],
  [intent('i-1',1,99000,99000,{allocation:[]}),[intent('i-1',1,99000,99000,{allocation:[]})]],
  [intent('i-1',1,99000,99000,{receipt_id:'r-b'}),[intent('i-1',1,99000,99000,{receipt_id:'r-b'})]],
  [intent('i-1',1,99000,99000,{original_occurred_at:'2026-10-17T03:04:06.000Z'}),[intent('i-1',1,99000,99000,{original_occurred_at:'2026-10-17T03:04:06.000Z'})]],
  [intent('i-3',3,198000,-99000),[intent('i-1',1,99000,99000),intent('i-2',2,99000,0),intent('i-3',3,198000,-99000)]],
  [intent('i-9',1,99000,99000),[intent('i-1',1,99000,99000)]],
 ];
 for(const [i,history] of bad)assert.throws(run(i,history),{code:'PURCHASE_SOURCE_NOT_ELIGIBLE'},i.id);
 assert.equal(sink.records.get(A)?.restatements.length,0);
});

test('local sink dedupes by transactionId, keeps newest restatement and never dispatches',async()=>{
 const network=fetchless();
 try{
  const sink=localGoogleSink(),m=mapped(base());
  assert.deepEqual(sink.accept(m),{status:'accepted_local',transaction_id:A,outbox_id:`o-${A}`});
  assert.deepEqual(sink.accept(mapped({...base(),now:new Date('2026-10-19T12:00:00.000Z')})),{status:'duplicate',transaction_id:A,outbox_id:`o-${A}`});
  assert.throws(()=>sink.accept(mapped({...base(),click:{wbraid:'WBRAID_synthetic',captured_at:landed}})),{code:'IDEMPOTENCY_CONFLICT'});
  const prepaid=[intent('i-1',1,99000,99000)],one=mapGoogleRestatement({intent:prepaid[0],history:prepaid,purchase:base().event,original:m.body,destination:destination(),captured:consent('c-1'),current:consent('c-2'),now});
  assert.equal(one.status,'mapped');if(one.status!=='mapped')throw new Error('unmapped');
  assert.equal(sink.restate(one).status,'restated_local');assert.equal(sink.restate(one).status,'duplicate');
  assert.throws(()=>sink.restate({...one,body:{...one.body,events:[{...one.body.events[0],conversionValue:1}]}}),{code:'IDEMPOTENCY_CONFLICT'});
  assert.equal(sink.restate({...one,sequence:3}).status,'restated_local');assert.equal(sink.restate({...one,sequence:2}).status,'stale');
  assert.throws(()=>sink.restate({...one,transaction_id:B}),{code:'PURCHASE_SOURCE_NOT_ELIGIBLE'});
  assert.equal(sink.records.size,1);assert.deepEqual(sink.records.get(A)?.body,m.body,'original conversion is never rewritten');
  assert.deepEqual(sink.dispatch(),{status:'disabled',code:'GOOGLE_DISPATCH_DISABLED'});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(network.calls(),0);
 }finally{network.restore();}
});

test('browser Purchase stays off and current vendor schema limitations stay explicit and gated',()=>{
 for(const gate of ['real_dispatch','browser_tag_purchase','login_account','click_identifier_source','click_identifier_combination','click_identifier_format','click_through_window','event_age_limit','user_data','cod_event_source','restatement_timestamp','restatement_trial_period','zero_value_restatement','retraction','cart_data'])
  assert.ok(googleVendorSchemaUnverified.some(g=>g.startsWith(`${gate}:`)),gate);
 const event=mapped(base()).body.events[0] as Record<string,unknown>;
 for(const gated of ['userData','cartData','lastUpdatedTimestamp','conversionCount','eventName','destinationReferences','eventDeviceInfo'])assert.equal(gated in event,false,gated);
 // No browser Google tag, GA4 purchase or Ads conversion path exists anywhere in application source.
 const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
 for(const file of files('src'))assert.doesNotMatch(readFileSync(file,'utf8'),/gtag\s*\(|googletagmanager\.com|googleadservices\.com|send_to\s*:/,file);
});

function fetchless(){
 const original=globalThis.fetch;let count=0;globalThis.fetch=(async()=>{count++;throw new Error('network forbidden');}) as typeof fetch;
 return {calls:()=>count,restore:()=>{globalThis.fetch=original;}};
}
