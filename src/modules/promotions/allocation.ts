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

// S177 stage 2B (store voucher): the merchandise discount is frozen per unit and every unit keeps at least Rp1
// (design §3.3–3.4). Order → lines by weight q × (price − 1) with largest remainder (ties by line_id); line → units in
// the given unit order, floor(share / q) each and +1 to the first (share mod q). The SQL twin in the seal trigger and
// the reservation guard must give the same rows.
export type MerchandiseLine={line_id:string;unit_price:number;quantity:number};
export const merchandiseCapacity=(lines:readonly MerchandiseLine[])=>lines.reduce((sum,l)=>sum+BigInt(l.quantity)*BigInt(l.unit_price-1),0n);
export function merchandiseBenefit(rule:{kind:string;value:string|number;maximum_per_order:string|number},lines:readonly MerchandiseLine[]){
  const gross=lines.reduce((sum,l)=>sum+BigInt(l.quantity)*BigInt(l.unit_price),0n);
  const requested=rule.kind==='fixed'?BigInt(rule.value):(gross*BigInt(rule.value)+5000n)/10000n;
  return safeMoney([requested,BigInt(rule.maximum_per_order),merchandiseCapacity(lines)].reduce((a,b)=>a<b?a:b));
}
export function allocateMerchandise(amount:number,lines:readonly MerchandiseLine[]){
  const total=BigInt(amount),capacity=merchandiseCapacity(lines);
  if(total<0n||total>capacity) throw new AccessError(409,'PROMOTION_AMOUNT_LIMIT');
  const sorted=[...lines].sort((a,b)=>compare(a.line_id,b.line_id));
  const portions=sorted.map((l)=>{const weight=BigInt(l.quantity)*BigInt(l.unit_price-1);const numerator=capacity?total*weight:0n;
    return {line:l,amount:capacity?numerator/capacity:0n,remainder:capacity?numerator%capacity:0n};});
  let extra=total-portions.reduce((sum,p)=>sum+p.amount,0n);
  for(const p of [...portions].sort((a,b)=>a.remainder===b.remainder?compare(a.line.line_id,b.line.line_id):a.remainder>b.remainder?-1:1)) if(extra>0n){p.amount++;extra--;}
  return portions.map((p)=>{const q=BigInt(p.line.quantity);
    return {line_id:p.line.line_id,amount:safeMoney(p.amount),units:Array.from({length:p.line.quantity},(_,i)=>safeMoney(p.amount/q+(BigInt(i)<p.amount%q?1n:0n)))};});
}
