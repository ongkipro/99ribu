import {createHash} from 'node:crypto';
import {productionShipping} from '../../config/runtime.ts';
import {chargeableWeight,type Rate,type RateAdapter} from './rates.ts';

// S95: live Mengantar rate estimate. Contract observed read-only on 2026-10-30 (and in adsbookcms-a45-cli):
// GET {base}/api/public/{key}/order/estimate?origin_id&destination_id&courier=all&weight=<kg> answers
// {success:true,data:{<courier key>:{price,codFee,unsupported,unsupported_cod,coverage_cod?,estimate_delivery,...}}}.
// Bill `price`, never `estimatedSpecialPrice` (the integrator discount). Cargo keys are a separate product (not
// offered); `unsupported`/`unsupportedOriginSpx` hide the courier. COD only on an explicit `unsupported_cod:false`:
// JNE and SiCepat omit the flag (observed 2026-10-31 on two routes), and an unknown COD route must not take a COD order.
// The key sits in the URL path: errors never carry the URL or the response body.
export const MENGANTAR_RATE_VERSION='mengantar-estimate-v1';
// Uncached estimates are capped per process (300/minute) so a stream of new destinations cannot spend the account.
// A price is valid for PRICE_MS after Mengantar gave it but reused for only CACHE_MS, so every quote built from the
// cache keeps at least PRICE_MS-CACHE_MS (5 minutes) before it expires.
const CACHE_MS=300_000,PRICE_MS=600_000,LIMIT=1000,FETCH_TIMEOUT_MS=5000,FETCHES_PER_MINUTE=300;
let budget={start:0,count:0};
const COURIERS:Record<string,string>={JNE:'JNE',SiCepat:'SiCepat',SAP:'SAP Express',SAPLite:'SAP Express Lite',iDexpress:'ID Express',JT:'J&T Express',lion:'Lion Parcel',anteraja:'Anteraja',spx:'SPX Express',pos:'POS Indonesia'};
type Entry={at:number;rates:Promise<Omit<Rate,'expires_at'>[]>};
const cache=new Map<string,Entry>();
// Tests only: start from an empty cache and budget.
export function resetMengantarRates(){cache.clear();budget={start:0,count:0};}

export type EstimateRow={price?:unknown;unsupported?:unknown;unsupported_cod?:unknown;coverage_cod?:unknown;unsupportedOriginSpx?:unknown;estimate_delivery?:unknown};
export function parseEstimate(body:unknown,key:{origin:string;destination:string;grams:number}):Omit<Rate,'expires_at'>[]{
 const envelope=body as {success?:unknown;data?:unknown};
 if(envelope?.success!==true||!envelope.data||typeof envelope.data!=='object'||Array.isArray(envelope.data)) throw new Error('Mengantar estimate malformed');
 return Object.entries(envelope.data as Record<string,EstimateRow>).flatMap(([courier,row])=>{
  if(!(courier in COURIERS)||!row||typeof row!=='object'||row.unsupported===true||row.unsupportedOriginSpx===true) return [];
  const price=typeof row.price==='number'?row.price:Number.NaN;
  if(!Number.isSafeInteger(price)||price<=0) return [];
  // estimate_delivery observed 2026-10-31: "1 - 2 days", "2 - 3 Days", "1 - 2 Hari", "1-2 Day", "4 HARI", "-" (none).
  const days=typeof row.estimate_delivery==='string'?/^(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*(?:days?|hari)?$/i.exec(row.estimate_delivery.trim()):null;
  const eta=days?(days[2]&&days[2]!==days[1]?`${days[1]}-${days[2]}`:days[1]):null;
  return [{id:`mg_${createHash('sha256').update(JSON.stringify([MENGANTAR_RATE_VERSION,key.origin,key.destination,courier,key.grams,price])).digest('hex')}`,
   service_id:courier,courier_name:COURIERS[courier],service_name:eta?`Reguler, ${eta} hari`:'Reguler',shipping_amount:price,
   supports_cod:row.unsupported_cod===false&&row.coverage_cod!==false,source:'mengantar' as const,version:MENGANTAR_RATE_VERSION}];
 });
}

// The cached fetch owns its timeout: one buyer's short deadline must not abort the request other buyers wait on
// (each caller's own deadline is raced in estimateRates).
async function fetchEstimate(origin:string,destination:string,grams:number){
 const config=productionShipping(process.env);if(!config) throw new Error('Mengantar shipping is disabled');
 const now=Date.now();if(now-budget.start>=60_000)budget={start:now,count:0};
 if(++budget.count>FETCHES_PER_MINUTE) throw new Error('Mengantar estimate budget exhausted');
 const query=new URLSearchParams({origin_id:origin,destination_id:destination,courier:'all',weight:(grams/1000).toFixed(3)});
 let response:Response;
 try{response=await fetch(`${config.baseUrl}/api/public/${config.apiKey}/order/estimate?${query}`,{headers:{'x-client-source':'directCall',accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(FETCH_TIMEOUT_MS)});}
 catch{throw new Error('Mengantar estimate unreachable');}
 if(!response.ok) throw new Error(`Mengantar estimate HTTP ${response.status}`);
 let body:unknown;try{body=await response.json();}catch{throw new Error('Mengantar estimate malformed');}
 return parseEstimate(body,{origin,destination,grams});
}

export const mengantarRateAdapter:RateAdapter={source:'mengantar',version:MENGANTAR_RATE_VERSION,async estimate(request){
 if(!request.origin_area_id) return [];
 const grams=chargeableWeight(request.measures);if(grams===null) return [];
 const key=`${request.origin_area_id}:${request.destination_id}:${grams}`;let entry=cache.get(key);
 if(!entry||Date.now()-entry.at>=CACHE_MS){
  if(cache.size>=LIMIT) cache.delete(cache.keys().next().value as string);
  entry={at:Date.now(),rates:fetchEstimate(request.origin_area_id,request.destination_id,grams)};cache.set(key,entry);
  entry.rates.catch(()=>{if(cache.get(key)===entry) cache.delete(key);});
 }
 // A price is never offered for longer than ten minutes after Mengantar gave it.
 const expires=new Date(Math.min(Date.parse(request.now)+PRICE_MS,entry.at+PRICE_MS)).toISOString();
 return (await entry.rates).map(rate=>({...rate,expires_at:expires}));
}};
