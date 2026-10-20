import {AccessError} from '../access/policy.ts';
import {MAX_MONEY} from './configuration.ts';
export type Shipment={shipment_id:string;origin_warehouse_id:string;shipping_fee:number;service_id:string;region_ids:string[]};
export type Rule={promotion_id:string;id:string;priority:number;kind:string;value:string|number;maximum_per_order:string|number;service_ids:string[];region_ids:string[];stacking:string};
export const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
export function safeMoney(value:bigint){if(value<0n||value>BigInt(MAX_MONEY)) throw new AccessError(409,'PROMOTION_AMOUNT_LIMIT');return Number(value);}
export function allocate(rules:readonly Rule[],shipments:readonly Shipment[]){
  if(rules.length>1&&rules.some((r)=>r.stacking==='exclusive')) throw new AccessError(409,'PROMOTION_STACKING_CONFLICT');
  const remaining=new Map(shipments.map((s)=>[s.shipment_id,BigInt(s.shipping_fee)]));
  const allocations:{promotion_id:string;version_id:string;amount:number;shipments:{shipment_id:string;amount:number}[]}[]=[];
  for(const rule of [...rules].sort((a,b)=>b.priority-a.priority||compare(a.promotion_id,b.promotion_id))){
    const eligible=shipments.filter((s)=>(!rule.service_ids.length||rule.service_ids.includes(s.service_id))&&(!rule.region_ids.length||s.region_ids.some((id)=>rule.region_ids.includes(id))));
    const total=eligible.reduce((sum,s)=>sum+(remaining.get(s.shipment_id)??0n),0n);
    if(!total) continue;
    const requested=rule.kind==='fixed'?BigInt(rule.value):(total*BigInt(rule.value)+5000n)/10000n;
    const benefit=[requested,BigInt(rule.maximum_per_order),total].reduce((a,b)=>a<b?a:b);
    if(!benefit) continue;
    const portions=eligible.map((s)=>{const numerator=benefit*(remaining.get(s.shipment_id)??0n);return {shipment_id:s.shipment_id,amount:numerator/total,remainder:numerator%total};});
    let extra=benefit-portions.reduce((sum,s)=>sum+s.amount,0n);
    for(const portion of portions.sort((a,b)=>a.remainder===b.remainder?compare(a.shipment_id,b.shipment_id):a.remainder>b.remainder?-1:1)) if(extra>0n){portion.amount++;extra--;}
    for(const portion of portions) remaining.set(portion.shipment_id,(remaining.get(portion.shipment_id)??0n)-portion.amount);
    allocations.push({promotion_id:rule.promotion_id,version_id:rule.id,amount:safeMoney(benefit),shipments:portions.filter((s)=>s.amount>0n).sort((a,b)=>compare(a.shipment_id,b.shipment_id)).map((s)=>({shipment_id:s.shipment_id,amount:safeMoney(s.amount)}))});
  }
  return allocations;
}
