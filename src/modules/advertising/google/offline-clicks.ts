import {AccessError} from '../../access/policy.ts';
import {digest} from '../../checkout/access.ts';
import {measurementAllowed,type Decision} from '../../consent/choices.ts';
import type {Consent} from '../../consent/receipts.ts';
import type {EventPayload} from '../events.ts';
import {localSignalPayload} from '../worker.ts';

// Google offline click conversion facts verified 2026-10-19 against official developer docs:
// developers.google.com/data-manager/api/devguides/events/google-ads/offline/send-events (operatingAccount GOOGLE_ADS
//  10-digit customer ID without hyphens owns the conversion action; productDestinationId = that UPLOAD_CLICKS action;
//  eventSource required; transactionId dedupes; conversionValue with ISO 4217 currency; at least one identifier;
//  consent adUserData/adPersonalization);
// data-manager/api/reference/rest/v1/events/ingest (Event, AdIdentifiers gclid/gbraid/wbraid, EventSource WEB);
// data-manager/api/reference/rest/v1/Consent (CONSENT_STATUS_UNSPECIFIED|CONSENT_GRANTED|CONSENT_DENIED);
// data-manager/api/devguides/concepts/formatting (JSON Timestamp is RFC 3339);
// data-manager/api/devguides/events/google-ads/offline/upgrade/field-mappings (numeric action ID, not resource name;
//  value in currency units, not micros; order_id -> transactionId);
// data-manager/api/devguides/events/google-ads/offline/upgrade (no retractions; restatement keeps conversion count;
//  no adjustment type; same transactionId and conversion action is an adjustment);
// data-manager/api/devguides/events/google-ads/conversion-adjustments (new value replaces recorded value; same
//  transactionId/destination/action and identifiers; unmatched transactionId is a NEW conversion upload);
// google-ads/api/reference/rpc/v25/ConversionUploadErrorEnum.ConversionUploadError (legacy GBRAID_WBRAID_BOTH_SET).
export const GOOGLE_CONVERSION_SOURCE='UPLOAD_CLICKS';
// Explicit limitations of the current issued schema/evidence. None may be guessed into a payload.
export const googleVendorSchemaUnverified=[
 'real_dispatch: no credentials, ingest request or diagnostics evidence; local sink only',
 'browser_tag_purchase: Purchase is server-only; no gtag/GA4 purchase path and no WEBSITE multi-source route',
 'login_account: the credential account is unknown, so loginAccount is omitted',
 'click_identifier_source: gclid/gbraid/wbraid are not captured or stored yet; no caller can supply click evidence',
 'click_identifier_combination: Data Manager is silent; legacy API allows gclid+gbraid and rejects gbraid+wbraid; only exactly one maps',
 'click_identifier_format: no documented format or length; only a bounded local token check',
 'click_through_window: action lookback (EXPIRED_EVENT) and legacy 6h TOO_RECENT_EVENT are unverified for Data Manager',
 'event_age_limit: no documented maximum age, only a 24h recommendation; the local outbox expiry applies',
 'user_data: enhanced-conversion identifiers, hashing and account terms are not built; no userData is sent',
 'cod_event_source: WEB for delayed COD collection follows the spec decision; account compatibility is unverified',
 'restatement_timestamp: docs do not say whether eventTimestamp/lastUpdatedTimestamp carry original or adjustment time',
 'restatement_trial_period: value updates are disabled during a 14-day trial; account state is unknown',
 'zero_value_restatement: undocumented; a full refund is not sent and its conversion count is disclosed',
 'retraction: Data Manager does not support retraction; none is ever emitted',
 'cart_data: item-level cartData is not mapped',
] as const;

type ConsentStatus='CONSENT_GRANTED'|'CONSENT_DENIED'|'CONSENT_STATUS_UNSPECIFIED';
type AdIdentifiers={gclid:string}|{gbraid:string}|{wbraid:string};
export type GoogleStoredEvent={id:string;name:string;source_kind:string;receipt_id:string;occurred_at:string|Date;merchandise_amount:string|number;payload:EventPayload};
export type GoogleOutbox={id:string;event_id:string;platform:string;status:string;expires_at:string|Date};
export type GoogleDestination={platform:string;external_destination_id:string;conversion_action_id:string;enabled:boolean;server_purchase_enabled:boolean;browser_purchase_enabled:boolean;google_conversion_source:string};
export type GoogleClick={gclid?:string|null;gbraid?:string|null;wbraid?:string|null;captured_at:string|Date};
export type GoogleAdjustmentIntent={id:string;receipt_id:string;purchase_event_id:string|null;dispatch_reason:string;sequence:number;merchandise_refunded:string|number;retained_merchandise:string|number;allocation:{merchandise_amount:number}[];original_occurred_at:string|Date};
export type GoogleEvent={transactionId:string;eventTimestamp:string;eventSource:'WEB';conversionValue:number;currency:'IDR';adIdentifiers:AdIdentifiers;consent:{adUserData:ConsentStatus;adPersonalization:ConsentStatus}};
export type GoogleBody={destinations:[{operatingAccount:{accountType:'GOOGLE_ADS';accountId:string};productDestinationId:string}];events:[GoogleEvent]};
export type GoogleConversion={status:'mapped';kind:'conversion';outbox_id:string;transaction_id:string;body:GoogleBody;blockers:string[]};
export type GoogleMapping=GoogleConversion|{status:'suppressed';outbox_id:string;reason:'not_google'|'not_queued'|'unsupported_event'|'withdrawn'|'expired'|'destination_invalid'|'no_click_identifier'|'click_identifier_invalid'|'click_identifier_conflict'};
export type GoogleRestatement={status:'mapped';kind:'restatement';intent_id:string;transaction_id:string;sequence:number;body:GoogleBody;blockers:string[]};
export type GoogleAdjustment=GoogleRestatement|{status:'blocked';intent_id:string;reason:'unmatched'|'non_retractable'|'withdrawn'|'destination_invalid'};

const live=(consent:Consent|null,now:number)=>consent!==null&&new Date(consent.effective_at).getTime()<=now&&new Date(consent.expires_at).getTime()>now;
const both=(a:Decision,b:Decision):ConsentStatus=>a==='granted'&&b==='granted'?'CONSENT_GRANTED':a==='denied'||b==='denied'?'CONSENT_DENIED':'CONSENT_STATUS_UNSPECIFIED';
const consentFor=(captured:Consent,current:Consent)=>({adUserData:both(captured.choices.google_signals.ad_user_data,current.choices.google_signals.ad_user_data),adPersonalization:both(captured.choices.google_signals.ad_personalization,current.choices.google_signals.ad_personalization)});
const allowed=(captured:Consent|null,current:Consent|null,now:number)=>live(current,now)&&captured!==null&&measurementAllowed((current as Consent).choices,'google')&&measurementAllowed(captured.choices,'google');
// Owned destination only: configured IDs are validated, never derived or guessed.
const destinationOf=(d:GoogleDestination):GoogleBody['destinations']|null=>d.platform==='google'&&d.enabled&&d.server_purchase_enabled&&d.browser_purchase_enabled===false&&d.google_conversion_source===GOOGLE_CONVERSION_SOURCE&&/^\d{10}$/.test(d.external_destination_id)&&/^[1-9]\d{0,18}$/.test(d.conversion_action_id)
 ?[{operatingAccount:{accountType:'GOOGLE_ADS',accountId:d.external_destination_id},productDestinationId:d.conversion_action_id}]:null;
function clickOf(click:GoogleClick|null|undefined,occurred:number):AdIdentifiers|'no_click_identifier'|'click_identifier_invalid'|'click_identifier_conflict'{
 const present=(['gclid','gbraid','wbraid'] as const).filter(k=>click?.[k]!==undefined&&click?.[k]!==null);
 if(!click||!present.length)return 'no_click_identifier';
 if(present.length>1)return 'click_identifier_conflict';
 const key=present[0],value=click[key] as string,captured=new Date(click.captured_at).getTime();
 // lazy: Google documents no click ID grammar; a bounded URL-safe token is the local ceiling until one is verified.
 if(!/^[A-Za-z0-9_-]{1,500}$/.test(value)||!Number.isFinite(captured)||captured>=occurred)return 'click_identifier_invalid';
 return {[key]:value} as AdIdentifiers;
}
function purchaseValue(event:GoogleStoredEvent){
 const local=localSignalPayload({...event,occurred_at:new Date(event.occurred_at).toISOString(),merchandise_amount:String(event.merchandise_amount)});
 if(!Number.isSafeInteger(local.value)||local.value<=0||local.contents.reduce((n,c)=>n+c.merchandise_amount,0)!==local.value)throw new AccessError(409,'PURCHASE_SOURCE_NOT_ELIGIBLE');
 return local;
}
// Pure mapping of a stored canonical outbox decision; no clock, network or database. Retry maps the same stored
// identity, original occurrence time and money truth, so an identical body follows.
export function mapGoogleConversion(input:{outbox:GoogleOutbox;event:GoogleStoredEvent;destination:GoogleDestination;captured:Consent|null;current:Consent|null;now:Date;click?:GoogleClick|null}):GoogleMapping{
 const {outbox,event,captured,current}=input,now=input.now.getTime(),outbox_id=outbox.id;
 if(outbox.platform!=='google'||outbox.event_id!==event.id)return {status:'suppressed',outbox_id,reason:'not_google'};
 if(outbox.status!=='queued')return {status:'suppressed',outbox_id,reason:'not_queued'};
 if(event.name!=='Purchase'||event.source_kind!=='economic_receipt')return {status:'suppressed',outbox_id,reason:'unsupported_event'};
 if(!allowed(captured,current,now))return {status:'suppressed',outbox_id,reason:'withdrawn'};
 const destinations=destinationOf(input.destination);if(!destinations)return {status:'suppressed',outbox_id,reason:'destination_invalid'};
 const local=purchaseValue(event),occurred=Date.parse(local.occurred_at);
 // Never redate: an expired local decision stays expired.
 if(new Date(outbox.expires_at).getTime()<=now)return {status:'suppressed',outbox_id,reason:'expired'};
 const adIdentifiers=clickOf(input.click,occurred);if(typeof adIdentifiers==='string')return {status:'suppressed',outbox_id,reason:adIdentifiers};
 const consent=consentFor(captured as Consent,current as Consent);
 // IDR has no minor unit: integer rupiah is already the currency-unit conversionValue (not micros).
 return {status:'mapped',kind:'conversion',outbox_id,transaction_id:local.event_id,blockers:['login_account',...(consent.adUserData==='CONSENT_GRANTED'?[]:['ad_user_data_not_granted'])],
  body:{destinations,events:[{transactionId:local.event_id,eventTimestamp:local.occurred_at,eventSource:'WEB',conversionValue:local.value,currency:local.currency,adIdentifiers,consent}]}};
}
// Restates only a conversion this sink already holds for the same action. Data Manager has no retraction and treats an
// unmatched transactionId as a new conversion, so unmatched or zero-retained adjustments are blocked and disclosed.
export function mapGoogleRestatement(input:{intent:GoogleAdjustmentIntent;history:GoogleAdjustmentIntent[];purchase:GoogleStoredEvent;original:GoogleBody|null;destination:GoogleDestination;captured:Consent|null;current:Consent|null;now:Date}):GoogleAdjustment{
 const {intent,purchase,original}=input,intent_id=intent.id,local=purchaseValue(purchase);
 if(intent.purchase_event_id===null||intent.dispatch_reason!=='pending_adapter')return {status:'blocked',intent_id,reason:'unmatched'};
 if(intent.purchase_event_id!==purchase.id||intent.receipt_id!==purchase.receipt_id||new Date(intent.original_occurred_at).toISOString()!==local.occurred_at)throw new AccessError(409,'PURCHASE_SOURCE_NOT_ELIGIBLE');
 // Retained value is recomputed from the complete stored adjustment chain of this original receipt.
 const chain=[...input.history].sort((a,b)=>a.sequence-b.sequence);let retained=local.value;
 chain.forEach((a,i)=>{
  const refunded=Number(a.merchandise_refunded);retained-=refunded;
  if(a.sequence!==i+1||a.receipt_id!==intent.receipt_id||a.purchase_event_id!==intent.purchase_event_id||!Number.isSafeInteger(refunded)||refunded<=0||a.allocation.reduce((n,x)=>n+x.merchandise_amount,0)!==refunded||retained<0||Number(a.retained_merchandise)!==retained)throw new AccessError(409,'PURCHASE_SOURCE_NOT_ELIGIBLE');
 });
 const current=chain.find(a=>a.id===intent.id);if(!current||current.sequence!==intent.sequence||Number(current.retained_merchandise)!==Number(intent.retained_merchandise))throw new AccessError(409,'PURCHASE_SOURCE_NOT_ELIGIBLE');
 const value=Number(intent.retained_merchandise),destinations=destinationOf(input.destination),[prior]=original?.events??[];
 if(!destinations)return {status:'blocked',intent_id,reason:'destination_invalid'};
 if(!original||!prior||JSON.stringify(original.destinations)!==JSON.stringify(destinations)||prior.transactionId!==purchase.id||prior.eventTimestamp!==local.occurred_at||prior.conversionValue!==local.value)return {status:'blocked',intent_id,reason:'unmatched'};
 if(value===0)return {status:'blocked',intent_id,reason:'non_retractable'};
 if(!allowed(input.captured,input.current,input.now.getTime()))return {status:'blocked',intent_id,reason:'withdrawn'};
 const consent=consentFor(input.captured as Consent,input.current as Consent);
 return {status:'mapped',kind:'restatement',intent_id,transaction_id:prior.transactionId,sequence:intent.sequence,blockers:['login_account','restatement_timestamp','restatement_trial_period',...(consent.adUserData==='CONSENT_GRANTED'?[]:['ad_user_data_not_granted'])],
  body:{destinations,events:[{...prior,conversionValue:value,consent}]}};
}
// Local recorder with hard-disabled real dispatch: nothing here can reach datamanager.googleapis.com.
export function localGoogleSink(){
 const records=new Map<string,{outbox_id:string;hash:string;body:GoogleBody;restatements:{sequence:number;hash:string;body:GoogleBody}[]}>(),blocked=new Map<string,Extract<GoogleAdjustment,{status:'blocked'}>['reason']>();
 return {records,dispatch:()=>({status:'disabled' as const,code:'GOOGLE_DISPATCH_DISABLED' as const}),
  accept(mapping:GoogleConversion){
   const hash=digest(JSON.stringify(mapping.body)),prior=records.get(mapping.transaction_id);
   if(prior){if(prior.hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return {status:'duplicate' as const,transaction_id:mapping.transaction_id,outbox_id:prior.outbox_id};}
   records.set(mapping.transaction_id,{outbox_id:mapping.outbox_id,hash,body:mapping.body,restatements:[]});return {status:'accepted_local' as const,transaction_id:mapping.transaction_id,outbox_id:mapping.outbox_id};
  },
  restate(mapping:GoogleRestatement){
   const record=records.get(mapping.transaction_id),hash=digest(JSON.stringify(mapping.body));
   if(!record)throw new AccessError(409,'PURCHASE_SOURCE_NOT_ELIGIBLE');
   const same=record.restatements.find(r=>r.sequence===mapping.sequence),last=record.restatements.at(-1)?.sequence??0;
   if(same){if(same.hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return {status:'duplicate' as const,transaction_id:mapping.transaction_id,sequence:mapping.sequence};}
   // An older correction never overwrites a newer retained value.
   if(mapping.sequence<last)return {status:'stale' as const,transaction_id:mapping.transaction_id,sequence:mapping.sequence};
   record.restatements.push({sequence:mapping.sequence,hash,body:mapping.body});return {status:'restated_local' as const,transaction_id:mapping.transaction_id,sequence:mapping.sequence};
  },
  disclose(adjustment:Extract<GoogleAdjustment,{status:'blocked'}>){blocked.set(adjustment.intent_id,adjustment.reason);},
  // Counts, not identities: platform conversion count cannot follow a refund.
  disclosure(){const counts={unmatched:0,non_retractable:0,withdrawn:0,destination_invalid:0};for(const reason of blocked.values())counts[reason]++;return counts;},
 };
}
