import {AccessError} from '../../access/policy.ts';
import {digest} from '../../checkout/access.ts';
import {matchingAllowed,measurementAllowed} from '../../consent/choices.ts';
import type {Consent} from '../../consent/receipts.ts';
import {normalizePhone} from '../../shipping/address.ts';
import type {EventPayload} from '../events.ts';
import {localSignalPayload} from '../worker.ts';

// TikTok Events API 2.0 facts verified 2026-10-19 against the rendered official TikTok API for Business docs:
// business-api.tiktok.com/portal/docs/report-app-web-offline-or-crm-events/v1.3 (POST /open_api/v1.3/event/track/;
//  event_source web with event_source_id = Pixel Code; event_time integer Unix seconds UTC+0; event_id dedupes;
//  page.url required for web events; user.email trim+lowercase SHA-256, user.phone E.164 with '+' SHA-256,
//  user.external_id SHA-256, ttclid/ttp/ip/user_agent raw and web-only; properties currency ISO 4217 incl. IDR,
//  value integer/decimal, content_type product when content_id is the catalog sku_id, content_ids, contents
//  content_id/price; contents quantity appears in every official example but not in the contents field table);
// portal/docs/supported-events/v1.3 (web standard event Purchase "when a payment is completed"; CompletePayment absent);
// portal/docs/event-deduplication/v1.3 (event_source_id+event+event_id; first kept, later copies within 48h of the
//  first discarded; 5-minute merge attempt; _ttp cookie dedupe only without event_id);
// portal/docs/events-api-v2-limited-data-use/v1.3 (limited_data_use is a US state opt-out flag requiring ip);
// portal/docs/responses-and-errors/v1.3 (code 0 success; 40001/40002/40100/40104; no retry or idempotency guidance).
export const TIKTOK_MARKETING_API_VERSION='v1.3';
// Explicit limitations of the current issued schema/evidence. None may be guessed into a payload.
export const tiktokVendorSchemaUnverified=[
 'real_dispatch: no credentials, event/track request or Test Events evidence; local sink only',
 'browser_pixel_purchase: Purchase is server-only; paired Pixel event_id mode and its envelope are not proven',
 'page_url: required for web events; no allowed source URL is stored',
 'ip_user_agent: recommended for matching and required for limited_data_use; original browser context is not stored',
 'click_identifier_source: ttclid/_ttp are not captured or stored yet; no caller can supply click evidence',
 'click_identifier_format: no documented ttclid/ttp grammar or length; only a bounded local token check',
 'matching_source: no encrypted bounded matching payload or stable advertiser external_id is stored yet',
 'cod_event_source: web follows the spec decision; delayed COD collection classification is unverified',
 'event_age_limit: no documented maximum event_time age; the local outbox expiry applies',
 'dedupe_window: platform dedupe covers 48h after first receipt; a later resend of an unknown outcome may duplicate',
 'retry_classification: docs list error codes but no retryable/idempotent classification',
 'test_events: no test_event_code is documented on the current reference; Test Events flow is unverified',
 'pixel_code_format: no documented Pixel Code grammar; only a bounded local token check',
 'catalog_match: content_type product assumes offer catalog_id equals the TikTok catalog sku_id',
 'limited_data_use: documented only for listed US states; Indonesia market policy is a PRIV-1 owner decision',
 'non_purchase_events: AddToCart/funnel server mapping not built',
 'adjustments: refunds/returns have no documented Events API retraction',
] as const;

export type TiktokStoredEvent={id:string;name:string;source_kind:string;occurred_at:string|Date;merchandise_amount:string|number;payload:EventPayload};
export type TiktokOutbox={id:string;event_id:string;platform:string;status:string;expires_at:string|Date};
export type TiktokDestination={platform:string;external_destination_id:string;enabled:boolean;server_purchase_enabled:boolean;browser_purchase_enabled:boolean};
export type TiktokMatching={email?:string|null;phone?:string|null;external_id?:string|null;ttclid?:string|null;ttp?:string|null};
export type TiktokUser={email?:string;phone?:string;external_id?:string;ttclid?:string;ttp?:string};
export type TiktokEvent={event:'Purchase';event_time:number;event_id:string;user:TiktokUser;properties:{currency:'IDR';value:number;content_type:'product';content_ids:string[];contents:{content_id:string;quantity:number;price:number}[]}};
export type TiktokBody={event_source:'web';event_source_id:string;data:[TiktokEvent]};
export type TiktokMapping={status:'mapped';outbox_id:string;event_id:string;body:TiktokBody;blockers:string[]}|{status:'suppressed';outbox_id:string;reason:'not_tiktok'|'not_queued'|'unsupported_event'|'withdrawn'|'expired'|'destination_invalid'};

const live=(consent:Consent|null,now:number)=>consent!==null&&new Date(consent.effective_at).getTime()<=now&&new Date(consent.expires_at).getTime()>now;
// lazy: TikTok documents no Pixel Code/ttclid/_ttp grammar; a bounded visible-ASCII token is the local ceiling until one is verified.
const token=(value:string|null|undefined,max:number)=>typeof value==='string'&&value.length<=max&&/^[\x21-\x7e]+$/.test(value);
// Owned server-only Pixel destination: the configured code is validated, never derived or guessed.
const pixelOf=(d:TiktokDestination)=>d.platform==='tiktok'&&d.enabled&&d.server_purchase_enabled&&d.browser_purchase_enabled===false&&token(d.external_destination_id,100)?d.external_destination_id:null;
function userOf(matching:TiktokMatching|null|undefined):TiktokUser{
 const out:TiktokUser={},email=matching?.email?.trim().toLowerCase(),external=matching?.external_id?.trim();
 if(email&&/^[^\s@]+@[^\s@]+$/.test(email))out.email=digest(email);
 // lazy: reuses the Indonesian checkout phone rule; TikTok keeps the '+' of E.164, unlike Meta. Other countries need their own rule.
 if(matching?.phone)try{out.phone=digest(normalizePhone(matching.phone));}catch{/* omit invalid identity, never synthesize */}
 if(external)out.external_id=digest(external);
 for(const key of ['ttclid','ttp'] as const){const value=matching?.[key];if(token(value,500))out[key]=value as string;}
 return out;
}
// Pure mapping of a stored canonical outbox decision; no clock, network or database. Retry maps the same stored
// identity, original occurrence time and money truth, so an identical body follows.
export function mapTiktokPurchase(input:{outbox:TiktokOutbox;event:TiktokStoredEvent;destination:TiktokDestination;captured:Consent|null;current:Consent|null;now:Date;matching?:TiktokMatching|null}):TiktokMapping{
 const {outbox,event,captured,current}=input,now=input.now.getTime(),outbox_id=outbox.id;
 if(outbox.platform!=='tiktok'||outbox.event_id!==event.id)return {status:'suppressed',outbox_id,reason:'not_tiktok'};
 if(outbox.status!=='queued')return {status:'suppressed',outbox_id,reason:'not_queued'};
 if(event.name!=='Purchase'||event.source_kind!=='economic_receipt')return {status:'suppressed',outbox_id,reason:'unsupported_event'};
 if(!live(current,now)||!captured||!measurementAllowed((current as Consent).choices,'tiktok')||!measurementAllowed(captured.choices,'tiktok'))return {status:'suppressed',outbox_id,reason:'withdrawn'};
 const pixel=pixelOf(input.destination);if(!pixel)return {status:'suppressed',outbox_id,reason:'destination_invalid'};
 const local=localSignalPayload({...event,occurred_at:new Date(event.occurred_at).toISOString(),merchandise_amount:String(event.merchandise_amount)}),occurred=Date.parse(local.occurred_at);
 // Never redate: an expired local decision stays expired.
 if(new Date(outbox.expires_at).getTime()<=now)return {status:'suppressed',outbox_id,reason:'expired'};
 const contents=local.contents.map(c=>({content_id:c.id,quantity:c.quantity,price:c.merchandise_amount/c.quantity}));
 if(!Number.isSafeInteger(local.value)||local.value<=0||local.contents.reduce((n,c)=>n+c.merchandise_amount,0)!==local.value||contents.some(c=>!Number.isSafeInteger(c.price)||c.price<=0)||JSON.stringify(local.content_ids)!==JSON.stringify(contents.map(c=>c.content_id)))throw new AccessError(409,'PURCHASE_SOURCE_NOT_ELIGIBLE');
 const user=matchingAllowed((current as Consent).choices,'tiktok')&&matchingAllowed(captured.choices,'tiktok')?userOf(input.matching):{};
 const blockers=['page_url',...(Object.keys(user).length?[]:['user_empty'])];
 // IDR has no minor unit: integer rupiah is already TikTok's numeric value.
 return {status:'mapped',outbox_id,event_id:local.event_id,blockers,body:{event_source:'web',event_source_id:pixel,data:[{event:'Purchase',event_time:Math.floor(occurred/1000),event_id:local.event_id,user,properties:{currency:local.currency,value:local.value,content_type:'product',content_ids:local.content_ids,contents}}]}};
}
// Local recorder with hard-disabled real dispatch: nothing here can reach business-api.tiktok.com.
export function localTiktokSink(){
 const records=new Map<string,{outbox_id:string;hash:string;body:TiktokBody}>();
 return {records,dispatch:()=>({status:'disabled' as const,code:'TIKTOK_DISPATCH_DISABLED' as const}),
  accept(mapping:Extract<TiktokMapping,{status:'mapped'}>){
   const hash=digest(JSON.stringify(mapping.body)),prior=records.get(mapping.event_id);
   if(prior){if(prior.hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return {status:'duplicate' as const,event_id:mapping.event_id,outbox_id:prior.outbox_id};}
   records.set(mapping.event_id,{outbox_id:mapping.outbox_id,hash,body:mapping.body});return {status:'accepted_local' as const,event_id:mapping.event_id,outbox_id:mapping.outbox_id};
  }};
}
