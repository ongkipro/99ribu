import {digest} from '../../checkout/access.ts';
import {matchingAllowed,measurementAllowed} from '../../consent/choices.ts';
import type {Consent} from '../../consent/receipts.ts';
import {AccessError} from '../../access/policy.ts';
import {normalizePhone} from '../../shipping/address.ts';
import {localSignalPayload} from '../worker.ts';
import type {EventPayload} from '../events.ts';

// Meta Conversions API facts verified 2026-10-19 against official developer docs:
// graph-api/changelog (latest Graph/Marketing API v26.0, 2026-07-29);
// conversions-api/parameters/server-event (event_time UTC seconds, any event >7 days old fails the whole request,
//  event_id+event_name dedupe within 48h, action_source values, event_source_url required for website events, LDU only);
// conversions-api/parameters/customer-information-parameters (em trim+lowercase, ph digits with country code and no
//  symbols/leading zeros, hashed SHA-256; external_id hashing recommended; fbp/fbc/IP/UA never hashed; client_user_agent
//  required for website events; at least one user_data field);
// conversions-api/parameters/custom-data (value numeric and currency ISO 4217 required for Purchase; contents id/quantity/item_price;
//  content_type product); conversions-api/deduplicate-pixel-and-server-events; conversions-api/using-the-api.
export const META_GRAPH_API_VERSION='v26.0';
export const META_EVENT_MAX_AGE_MS=7*86400000;
// Explicit limitations of the current issued schema/evidence. None may be guessed into a payload.
export const metaVendorSchemaUnverified=[
 'real_dispatch: no credentials, Graph request or Test Events evidence; local sink only',
 'browser_pixel_purchase: Purchase is server-only; paired Pixel eventID mode is not proven',
 'action_source_cod: website is provisional; delayed COD collection classification is unverified',
 'event_source_url: required for website events; no allowed source URL is stored',
 'client_user_agent/client_ip_address: required/recommended for website events; original browser context is not stored',
 'matching_source: no encrypted bounded matching payload or stable advertiser external_id is stored yet',
 'valid_user_data_combinations: v13+ combination rules live on the best-practices page, not verified',
 'data_processing_options: only US LDU is documented; Indonesia market policy is a PRIV-1 owner decision',
 'non_purchase_events: AddToCart/funnel server mapping not built',
 'adjustments: refunds/returns have no verified CAPI retraction',
] as const;

export type MetaStoredEvent={id:string;name:string;source_kind:string;occurred_at:string|Date;merchandise_amount:string|number;payload:EventPayload};
export type MetaOutbox={id:string;event_id:string;platform:string;status:string;expires_at:string|Date};
export type MetaMatching={email?:string|null;phone?:string|null;external_id?:string|null;fbp?:string|null;fbc?:string|null};
export type MetaUserData={em?:string[];ph?:string[];external_id?:string[];fbp?:string;fbc?:string};
export type MetaServerEvent={event_name:'Purchase';event_time:number;event_id:string;action_source:'website';user_data:MetaUserData;custom_data:{currency:'IDR';value:number;content_type:'product';content_ids:string[];contents:{id:string;quantity:number;item_price:number}[]}};
export type MetaMapping={status:'mapped';outbox_id:string;event_id:string;body:{data:[MetaServerEvent]};blockers:string[]}|{status:'suppressed';outbox_id:string;reason:'not_meta'|'not_queued'|'unsupported_event'|'withdrawn'|'expired'};

const live=(consent:Consent|null,now:number)=>consent!==null&&new Date(consent.effective_at).getTime()<=now&&new Date(consent.expires_at).getTime()>now;
function userData(matching:MetaMatching|null|undefined):MetaUserData{
 const out:MetaUserData={},email=matching?.email?.trim().toLowerCase(),external=matching?.external_id?.trim();
 if(email&&/^[^\s@]+@[^\s@]+$/.test(email))out.em=[digest(email)];
 // lazy: reuses the Indonesian checkout phone rule; other countries need their own country-code normalization.
 if(matching?.phone)try{out.ph=[digest(normalizePhone(matching.phone).slice(1))];}catch{/* omit invalid identity, never synthesize */}
 if(external)out.external_id=[digest(external)];
 for(const key of ['fbp','fbc'] as const){const value=matching?.[key];if(value&&value.length<=500&&/^fb\.\d+\.\d+\.\S+$/.test(value))out[key]=value;}
 return out;
}
// Pure mapping of a stored canonical outbox decision; no clock, network or database. Retry maps the same stored
// identity, original occurrence time and money truth, so an identical body follows.
export function mapMetaPurchase(input:{outbox:MetaOutbox;event:MetaStoredEvent;captured:Consent|null;current:Consent|null;now:Date;matching?:MetaMatching|null}):MetaMapping{
 const {outbox,event,captured,current}=input,now=input.now.getTime(),outbox_id=outbox.id;
 if(outbox.platform!=='meta'||outbox.event_id!==event.id)return {status:'suppressed',outbox_id,reason:'not_meta'};
 if(outbox.status!=='queued')return {status:'suppressed',outbox_id,reason:'not_queued'};
 if(event.name!=='Purchase'||event.source_kind!=='economic_receipt')return {status:'suppressed',outbox_id,reason:'unsupported_event'};
 if(!live(current,now)||!captured||!measurementAllowed((current as Consent).choices,'meta')||!measurementAllowed(captured.choices,'meta'))return {status:'suppressed',outbox_id,reason:'withdrawn'};
 const local=localSignalPayload({...event,occurred_at:new Date(event.occurred_at).toISOString(),merchandise_amount:String(event.merchandise_amount)}),occurred=Date.parse(local.occurred_at);
 // Never redate: an event Meta would reject for age stays expired locally.
 if(new Date(outbox.expires_at).getTime()<=now||now-occurred>META_EVENT_MAX_AGE_MS)return {status:'suppressed',outbox_id,reason:'expired'};
 const contents=local.contents.map(c=>({id:c.id,quantity:c.quantity,item_price:c.merchandise_amount/c.quantity}));
 if(!Number.isSafeInteger(local.value)||local.value<=0||local.contents.reduce((n,c)=>n+c.merchandise_amount,0)!==local.value||contents.some(c=>!Number.isSafeInteger(c.item_price)||c.item_price<=0)||JSON.stringify(local.content_ids)!==JSON.stringify(contents.map(c=>c.id)))throw new AccessError(409,'PURCHASE_SOURCE_NOT_ELIGIBLE');
 const user_data=matchingAllowed((current as Consent).choices,'meta')&&matchingAllowed(captured.choices,'meta')?userData(input.matching):{};
 const blockers=['event_source_url','client_user_agent',...(Object.keys(user_data).length?[]:['user_data_empty'])];
 // IDR has no minor unit: integer rupiah is already Meta's numeric value.
 return {status:'mapped',outbox_id,event_id:local.event_id,blockers,body:{data:[{event_name:'Purchase',event_time:Math.floor(occurred/1000),event_id:local.event_id,action_source:'website',user_data,custom_data:{currency:local.currency,value:local.value,content_type:'product',content_ids:local.content_ids,contents}}]}};
}
// Local recorder with hard-disabled real dispatch: nothing here can reach graph.facebook.com.
export function localMetaSink(){
 const records=new Map<string,{outbox_id:string;hash:string;body:{data:[MetaServerEvent]}}>();
 return {records,dispatch:()=>({status:'disabled' as const,code:'META_DISPATCH_DISABLED' as const}),
  accept(mapping:Extract<MetaMapping,{status:'mapped'}>){
   const hash=digest(JSON.stringify(mapping.body)),prior=records.get(mapping.event_id);
   if(prior){if(prior.hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return {status:'duplicate' as const,event_id:mapping.event_id,outbox_id:prior.outbox_id};}
   records.set(mapping.event_id,{outbox_id:mapping.outbox_id,hash,body:mapping.body});return {status:'accepted_local' as const,event_id:mapping.event_id,outbox_id:mapping.outbox_id};
  }};
}
