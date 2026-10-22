import {createHash} from 'node:crypto';
import {AccessError} from '../access/policy.ts';
import {integer,invalid,object} from '../catalog/validation.ts';
import {shippingFixture} from './address.ts';
export type ParcelMeasures={weight_grams:number;length_mm:number;width_mm:number;height_mm:number};
export type Rate={id:string;service_id:string;courier_name:string;service_name:string;shipping_amount:number;supports_cod:boolean;source:'TEST-ONLY';version:string;expires_at:string};
export type RateRequest={warehouse_id:string;origin_fixture_id:string;destination_id:string;measures:ParcelMeasures;now:string};
export type RateAdapter={estimate:(request:RateRequest,signal:AbortSignal)=>Promise<Rate[]>};
export function chargeableWeight(measures:ParcelMeasures,policy=shippingFixture().policy){for(const value of Object.values(measures)) integer(value,1);
  const volume=BigInt(measures.length_mm)*BigInt(measures.width_mm)*BigInt(measures.height_mm);const divisor=BigInt(policy.volumetric_divisor_mm3_per_gram);
  const volumetric=(volume+divisor-1n)/divisor;const weight=volumetric>BigInt(measures.weight_grams)?volumetric:BigInt(measures.weight_grams);
  if([measures.length_mm,measures.width_mm,measures.height_mm].some((v)=>v>policy.maximum_dimension_mm)||weight>BigInt(policy.maximum_weight_grams)) return null;
  return Number(weight);
}
export const localRateAdapter:RateAdapter={async estimate(request,signal){
  signal.throwIfAborted();const fixture=shippingFixture();const destination=fixture.destinations.find((d)=>d.id===request.destination_id);
  // Local snapshot warehouses (berlapak-<id>) are simulated cross-city origins.
  if(!destination||!(['fixture-malang','fixture-pontianak'].includes(request.origin_fixture_id)||/^berlapak-[0-9a-f]{24}$/.test(request.origin_fixture_id))) throw new AccessError(422,'ROUTE_UNCONFIGURED');
  if(destination.id==='test-no-route') return [];const weight=chargeableWeight(request.measures,fixture.policy);if(weight===null) return [];
  const local=request.origin_fixture_id===`fixture-${destination.city.toLowerCase()}`;const steps=Math.ceil(weight/1000)-1;
  return fixture.services.map((s)=>({id:`sim_${createHash('sha256').update(JSON.stringify([fixture.version,request.warehouse_id,destination.id,s.id,request.measures])).digest('hex')}`,
    service_id:s.id,courier_name:'Pengiriman simulasi',service_name:s.name,shipping_amount:(local?s.local_base_idr:s.cross_base_idr)+steps*s.step_idr,
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
      if(!rate||typeof rate.id!=='string'||!rate.id||rate.id.length>200||typeof rate.service_id!=='string'||!rate.service_id||rate.service_id.length>100||typeof rate.courier_name!=='string'||!rate.courier_name||rate.courier_name.length>200||typeof rate.service_name!=='string'||!rate.service_name||rate.service_name.length>200||typeof rate.supports_cod!=='boolean'||rate.source!=='TEST-ONLY'||rate.version!==shippingFixture().version||typeof rate.expires_at!=='string'||!Number.isFinite(Date.parse(rate.expires_at))||new Date(rate.expires_at).toISOString()!==rate.expires_at) throw invalid();
      integer(rate.shipping_amount,0,Number.MAX_SAFE_INTEGER);
      if(Date.parse(rate.expires_at)<=Date.parse(request.now)) throw new AccessError(409,'SHIPPING_RATE_EXPIRED');
    }
    if(new Set(result.map((r)=>r.id)).size!==result.length) throw invalid();return result;
  }catch(error){
    if(error instanceof AccessError){if(error.code==='INVALID_INPUT') throw new AccessError(503,'SHIPPING_RATE_INVALID');throw error;}
    throw new AccessError(503,'SHIPPING_RATE_UNAVAILABLE');
  }finally{if(timer) clearTimeout(timer);}
}
