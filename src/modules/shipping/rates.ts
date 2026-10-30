import {createHash} from 'node:crypto';
import {AccessError} from '../access/policy.ts';
import {integer,invalid,object} from '../catalog/validation.ts';
import {shippingFixture} from './address.ts';
import type {DestinationSource} from './destinations.ts';
export type ParcelMeasures={weight_grams:number;length_mm:number;width_mm:number;height_mm:number};
export type Rate={id:string;service_id:string;courier_name:string;service_name:string;shipping_amount:number;supports_cod:boolean;source:DestinationSource;version:string;expires_at:string};
// DEC-006: the origin is the warehouse's kecamatan-level location, never a street address.
// province/district are null only on pre-DEC-006 rows (city-level comparison).
export type RateOrigin={province:string|null;city:string;district:string|null};
// origin_area_id: the warehouse's Mengantar area (S95); null until resolved, and such a warehouse has no live rates.
export type RateRequest={warehouse_id:string;origin:RateOrigin;origin_area_id:string|null;destination_id:string;measures:ParcelMeasures;now:string};
export type RateAdapter={source:DestinationSource;version:string;estimate:(request:RateRequest,signal:AbortSignal)=>Promise<Rate[]>};
// The parcel policy is store policy, not fixture data (the fixture keeps an equal copy; tests/shipping-policy pins it).
export const PACKAGE_POLICY={kind:'upright-stack-v1',maximum_weight_grams:20000,maximum_dimension_mm:1000,volumetric_divisor_mm3_per_gram:6000} as const;
export function chargeableWeight(measures:ParcelMeasures,policy:{maximum_weight_grams:number;maximum_dimension_mm:number;volumetric_divisor_mm3_per_gram:number}=PACKAGE_POLICY){for(const value of Object.values(measures)) integer(value,1);
  const volume=BigInt(measures.length_mm)*BigInt(measures.width_mm)*BigInt(measures.height_mm);const divisor=BigInt(policy.volumetric_divisor_mm3_per_gram);
  const volumetric=(volume+divisor-1n)/divisor;const weight=volumetric>BigInt(measures.weight_grams)?volumetric:BigInt(measures.weight_grams);
  if([measures.length_mm,measures.width_mm,measures.height_mm].some((v)=>v>policy.maximum_dimension_mm)||weight>BigInt(policy.maximum_weight_grams)) return null;
  return Number(weight);
}
// Names compare case/space-insensitively and exactly otherwise ("Kota X" and "Kabupaten X" stay
// distinct). A district only matches inside the same city; a city inside the same province
// unless either province is unknown. lazy: name matching suits the simulated adapter only; a
// real courier adapter maps the kecamatan to the provider's own area id.
const place=(value:string|null)=>value===null?null:value.normalize('NFKC').toLocaleLowerCase('id-ID').replace(/\s+/g,' ').trim()||null;
export function rateBand(origin:RateOrigin,destination:{province:string;city:string;district:string}){
  const province=place(origin.province)!==null&&place(origin.province)===place(destination.province);
  const city=place(origin.city)!==null&&place(origin.city)===place(destination.city)&&(origin.province===null||province);
  if(city&&place(origin.district)!==null&&place(origin.district)===place(destination.district)) return 'district' as const;
  return city?'city' as const:province?'province' as const:'national' as const;
}
export const localRateAdapter:RateAdapter={source:'TEST-ONLY',get version(){return shippingFixture().version;},async estimate(request,signal){
  signal.throwIfAborted();const fixture=shippingFixture();const destination=fixture.destinations.find((d)=>d.id===request.destination_id);
  if(!destination||place(request.origin?.city??null)===null) throw new AccessError(422,'ROUTE_UNCONFIGURED');
  if(destination.id==='test-no-route') return [];const weight=chargeableWeight(request.measures,fixture.policy);if(weight===null) return [];
  const band=rateBand(request.origin,destination);const steps=Math.ceil(weight/1000)-1;
  return fixture.services.map((s)=>({id:`sim_${createHash('sha256').update(JSON.stringify([fixture.version,request.warehouse_id,destination.id,s.id,request.measures])).digest('hex')}`,
    service_id:s.id,courier_name:'Pengiriman simulasi',service_name:s.name,shipping_amount:{district:s.district_base_idr,city:s.local_base_idr,province:s.province_base_idr,national:s.cross_base_idr}[band]+steps*s.step_idr,
    supports_cod:s.supports_cod&&destination.id!=='test-prepaid-only',source:'TEST-ONLY' as const,version:fixture.version,expires_at:new Date(Date.parse(request.now)+600000).toISOString()}));
}};
export async function estimateRates(adapter:RateAdapter,request:RateRequest,remainingMs=2000){
  if(!Number.isFinite(remainingMs)||remainingMs<=0) throw new AccessError(503,'SHIPPING_RATE_TIMEOUT');
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new AccessError(503,'SHIPPING_RATE_TIMEOUT'));controller.abort();},Math.min(2000,remainingMs));});
  try{
    const result=await Promise.race([adapter.estimate(request,controller.signal),timeout]);
    if(!Array.isArray(result)||result.length>100) throw invalid();
    for(const rate of result){
      object(rate,['id','service_id','courier_name','service_name','shipping_amount','supports_cod','source','version','expires_at']);
      if(!rate||typeof rate.id!=='string'||!rate.id||rate.id.length>200||typeof rate.service_id!=='string'||!rate.service_id||rate.service_id.length>100||typeof rate.courier_name!=='string'||!rate.courier_name||rate.courier_name.length>200||typeof rate.service_name!=='string'||!rate.service_name||rate.service_name.length>200||typeof rate.supports_cod!=='boolean'||rate.source!==adapter.source||rate.version!==adapter.version||typeof rate.expires_at!=='string'||!Number.isFinite(Date.parse(rate.expires_at))||new Date(rate.expires_at).toISOString()!==rate.expires_at) throw invalid();
      integer(rate.shipping_amount,0,Number.MAX_SAFE_INTEGER);
      if(Date.parse(rate.expires_at)<=Date.parse(request.now)) throw new AccessError(409,'SHIPPING_RATE_EXPIRED');
    }
    if(new Set(result.map((r)=>r.id)).size!==result.length) throw invalid();return result;
  }catch(error){
    if(error instanceof AccessError){if(error.code==='INVALID_INPUT') throw new AccessError(503,'SHIPPING_RATE_INVALID');throw error;}
    throw new AccessError(503,'SHIPPING_RATE_UNAVAILABLE');
  }finally{if(timer) clearTimeout(timer);}
}
