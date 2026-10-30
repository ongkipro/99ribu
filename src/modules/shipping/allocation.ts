
import {AccessError} from '../access/policy.ts';
import {chargeableWeight,PACKAGE_POLICY,type ParcelMeasures} from './rates.ts';
export type CompleteUnit={line_id:string;offer_id:string;default_warehouse_id:string;components:{stock_item_id:string;quantity:number}[];measures:ParcelMeasures};
export type Parcel={warehouse_id:string;measures:ParcelMeasures;lines:{line_id:string;quantity:number}[]};
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
export function parcelKey(parcel:Parcel){return JSON.stringify([parcel.warehouse_id,parcel.measures,[...parcel.lines].sort((a,b)=>compare(a.line_id,b.line_id))]);}
export function enumerateAllocations(units:readonly CompleteUnit[],warehouses:readonly string[],available:ReadonlyMap<string,number>){
  if(!units.length||units.length>50) throw new AccessError(422,'ALLOCATION_REVIEW_REQUIRED');
  const policy=PACKAGE_POLICY;if(units.some((u)=>chargeableWeight(u.measures,policy)===null)) throw new AccessError(422,'PACKAGE_UNSUPPORTED');const remaining=new Map(available);const parcels:Parcel[]=[];const candidates=new Map<string,Parcel[]>();const visited=new Set<string>();let nodes=0;
  function search(index:number){
    // lazy: exact retail search is capped20k attempts/1k candidates/50 units.
    // Exhaustion returns review, never an unproven cheapest shipping claim;
    // replace with a reviewed optimizer if real carts outgrow this ceiling.
    if(++nodes>20000||candidates.size>1000) throw new AccessError(422,'ALLOCATION_REVIEW_REQUIRED');
    const ordered=[...parcels].sort((a,b)=>compare(parcelKey(a),parcelKey(b)));
    const state=JSON.stringify([index,ordered.map(parcelKey)]);if(visited.has(state)) return;visited.add(state);
    if(index===units.length){candidates.set(state,structuredClone(ordered));return;}
    const unit=units[index];
    for(const warehouse of [...warehouses].sort()){
      if(unit.components.some((c)=>(remaining.get(`${warehouse}:${c.stock_item_id}`)??0)<c.quantity)) continue;
      for(const c of unit.components) remaining.set(`${warehouse}:${c.stock_item_id}`,(remaining.get(`${warehouse}:${c.stock_item_id}`)??0)-c.quantity);
      const equivalent=new Set<string>();
      for(const parcel of parcels){
        if(parcel.warehouse_id!==warehouse) continue;
        const before=structuredClone(parcel);const signature=parcelKey(parcel);if(equivalent.has(signature)) continue;equivalent.add(signature);
        const combined={weight_grams:parcel.measures.weight_grams+unit.measures.weight_grams,length_mm:Math.max(parcel.measures.length_mm,unit.measures.length_mm),width_mm:Math.max(parcel.measures.width_mm,unit.measures.width_mm),height_mm:parcel.measures.height_mm+unit.measures.height_mm};
        if(chargeableWeight(combined,policy)===null) continue;
        parcel.measures=combined;const line=parcel.lines.find((l)=>l.line_id===unit.line_id);if(line) line.quantity++;else parcel.lines.push({line_id:unit.line_id,quantity:1});
        search(index+1);parcel.measures=before.measures;parcel.lines=before.lines;
      }
      if(chargeableWeight(unit.measures,policy)!==null){parcels.push({warehouse_id:warehouse,measures:{...unit.measures},lines:[{line_id:unit.line_id,quantity:1}]});search(index+1);parcels.pop();}
      for(const c of unit.components) remaining.set(`${warehouse}:${c.stock_item_id}`,(remaining.get(`${warehouse}:${c.stock_item_id}`)??0)+c.quantity);
    }
  }
  search(0);if(!candidates.size) throw new AccessError(409,'INSUFFICIENT_COMPLETE_STOCK');return [...candidates.values()];
}
