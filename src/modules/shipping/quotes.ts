import {createHash} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {salePublication} from '../catalog/publication.ts';
import {array,id,integer,invalid,object} from '../catalog/validation.ts';
import {lockInventoryClock} from '../inventory/state.ts';
import {identifier} from '../promotions/configuration.ts';
import {safeMoney} from '../promotions/allocation.ts';
import {lockPublishedSources} from './contribution.ts';
import {shippingFixture} from './address.ts';
import {enumerateAllocations,parcelKey,type CompleteUnit} from './allocation.ts';
import {estimateRates,localRateAdapter,type Rate,type RateAdapter} from './rates.ts';

export type ShippingLine={line_id:string;product_id:string;offer_id:string;publication_id:string;quantity:number};
export type ShippingPlan={id:string;payment_method:'prepaid'|'cod';destination_id:string;destination_version:string;expires_at:string;pricing_evaluated_at:string;source:'TEST-ONLY';
  merchandise_total:number;shipping_total:number;default_warehouse_units:number;packages:{id:string;warehouse_id:string;origin_city:string;measures:CompleteUnit['measures'];lines:{line_id:string;quantity:number}[];options:Rate[];selected_option_id:string;merchandise_amount:number;shipping_amount:number}[];
  lines:(ShippingLine&{product_revision:number})[]};
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
export async function buildShippingPlans(tx:TransactionSql,value:unknown,context:{clock_namespace?:string|null;adapter?:RateAdapter}={}){
  const body=object(value,['lines','destination_id','payment_method']);const fixture=shippingFixture();
  if(typeof body.destination_id!=='string'||!fixture.destinations.some((d)=>d.id===body.destination_id)||typeof body.payment_method!=='string'||!['prepaid','cod'].includes(body.payment_method)) throw invalid();
  const method=body.payment_method as 'prepaid'|'cod';
  const lines=array(body.lines,(value)=>{const l=object(value,['line_id','product_id','offer_id','publication_id','quantity']);return {line_id:identifier(l.line_id),product_id:id(l.product_id),offer_id:id(l.offer_id),publication_id:id(l.publication_id),quantity:integer(l.quantity,1,1000000)};},1).sort((a,b)=>compare(a.line_id,b.line_id));
  if(new Set(lines.map((l)=>l.line_id)).size!==lines.length) throw invalid();
  if(lines.reduce((n,l)=>n+l.quantity,0)>50) throw new AccessError(422,'ALLOCATION_REVIEW_REQUIRED');
  const namespace=context.clock_namespace??null;
  // Every active warehouse in the clock scope is a quotable origin, exactly the warehouses the
  // publication guard accepts as default warehouses (DEC-006: rates band by its kecamatan/city).
  let warehouses=await tx<{id:string;province:string|null;city:string;district:string|null}[]>`select w.id,w.province,w.city,w.district from app.warehouse w
    left join app.local_fixture_warehouse f on f.warehouse_id=w.id where w.active and (${namespace}::text is null or f.namespace=${namespace}) order by w.id`;
  const clock=await lockInventoryClock(tx,namespace,warehouses.map((w)=>w.id));
  // Re-read active status after the row wait; keep origin changes serialized
  // through the same quote transaction without locking before its clock.
  if(warehouses.length) warehouses=await tx`select w.id,w.province,w.city,w.district from app.warehouse w where w.id in ${tx(warehouses.map((w)=>w.id))} and w.active
    order by w.id for share of w`;
  const productIds=[...new Set(lines.map((l)=>l.product_id))].sort();
  await lockPublishedSources(tx,productIds);
  const [pricing]=await tx`select clock_timestamp()::text as now`;
  const units:CompleteUnit[]=[];const frozen:(ShippingLine&{product_revision:number})[]=[];const required=new Map<string,number>();
  for(const line of lines){
    const publication=await salePublication(tx,line.product_id,pricing.now);
    if(!publication||publication.publication_id!==line.publication_id) throw new AccessError(409,'PUBLICATION_REVIEW_REQUIRED');
    const variant=publication.draft.variants.find((v)=>v.id===line.offer_id&&!v.retired);if(!variant) throw new AccessError(409,'OFFER_UNAVAILABLE');
    frozen.push({...line,product_revision:publication.product_revision});
    const unit={line_id:line.line_id,offer_id:line.offer_id,default_warehouse_id:variant.default_warehouse_id,components:variant.contents.map((c)=>({stock_item_id:c.stock_item_id,quantity:c.quantity})),
      measures:{weight_grams:variant.weight_grams,length_mm:variant.length_mm,width_mm:variant.width_mm,height_mm:variant.height_mm}};
    for(const c of unit.components) required.set(c.stock_item_id,(required.get(c.stock_item_id)??0)+c.quantity*line.quantity);
    for(let n=0;n<line.quantity;n++) units.push(unit);
  }
  const positions=warehouses.length?await tx<{warehouse_id:string;stock_item_id:string;available:number}[]>`select b.warehouse_id,b.stock_item_id,b.on_hand-b.reserved-b.quarantined as available
    from app.inventory_balance b join app.warehouse w on w.id=b.warehouse_id left join app.inventory_lot l on l.id=b.lot_id
    where b.warehouse_id in ${tx(warehouses.map((w)=>w.id))} and b.stock_item_id in ${tx([...required.keys()])}
      and b.on_hand-b.reserved-b.quarantined>0 and (l.expires_on is null or l.expires_on>=(app.inventory_clock(w.id,${namespace}) at time zone w.timezone)::date)
    order by b.id for share of b`:[];
  const available=new Map<string,number>();for(const p of positions){const key=`${p.warehouse_id}:${p.stock_item_id}`;available.set(key,Math.min(required.get(p.stock_item_id)??0,(available.get(key)??0)+p.available));}
  const eligible=warehouses.filter((w)=>positions.some((p)=>p.warehouse_id===w.id));
  const candidates=enumerateAllocations(units,eligible.map((w)=>w.id),available);
  const rates=new Map<string,Rate[]>();const plans:ShippingPlan[]=[];let supportedPrepaid=false;const deadline=Date.now()+3000;
  const [wall]=await tx`select clock_timestamp()::text as now`;const businessNow=namespace===null?wall.now:clock.now.toISOString();
  for(const candidate of candidates){
    const packages:ShippingPlan['packages']=[];let valid=true;let prepaidCandidate=true;
    for(const [parcelIndex,parcel] of candidate.entries()){
      if(Date.now()>deadline) throw new AccessError(503,'SHIPPING_RATE_TIMEOUT');
      const key=parcelKey({...parcel,lines:[]});let options=rates.get(key);
      const origin=eligible.find((w)=>w.id===parcel.warehouse_id);if(!origin) throw new AccessError(422,'ROUTE_UNCONFIGURED');
      if(!options){if(rates.size>=500) throw new AccessError(422,'ALLOCATION_REVIEW_REQUIRED');options=await estimateRates(context.adapter??localRateAdapter,{warehouse_id:origin.id,origin:{province:origin.province,city:origin.city,district:origin.district},destination_id:body.destination_id,measures:parcel.measures,now:businessNow},deadline-Date.now());rates.set(key,options);}
      if(!options.length) prepaidCandidate=false;
      const supported=options.filter((r)=>method==='prepaid'||r.supports_cod).sort((a,b)=>a.shipping_amount-b.shipping_amount||compare(a.id,b.id));
      if(!supported.length){valid=false;continue;}const selected=supported[0];
      packages.push({id:`parcel_${hash([parcel,parcelIndex])}`,warehouse_id:origin.id,origin_city:origin.city,measures:parcel.measures,lines:parcel.lines,options:supported,selected_option_id:selected.id,
        merchandise_amount:safeMoney(parcel.lines.reduce((sum,l)=>sum+BigInt(l.quantity)*99000n,0n)),shipping_amount:selected.shipping_amount});
    }
    if(prepaidCandidate) supportedPrepaid=true;
    if(!valid) continue;
    const shipping=safeMoney(packages.reduce((sum,p)=>sum+BigInt(p.shipping_amount),0n));
    const defaultUnits=packages.reduce((sum,p)=>sum+p.lines.reduce((n,l)=>n+(units.find((u)=>u.line_id===l.line_id)?.default_warehouse_id===p.warehouse_id?l.quantity:0),0),0);
    plans.push({id:`plan_${hash([body.destination_id,method,packages,lines])}`,payment_method:method,destination_id:body.destination_id,destination_version:fixture.version,source:'TEST-ONLY',pricing_evaluated_at:new Date(pricing.now).toISOString(),
      expires_at:new Date(Math.min(Date.parse(businessNow)+600000,...packages.flatMap((p)=>p.options.map((r)=>Date.parse(r.expires_at))))).toISOString(),
      merchandise_total:safeMoney(BigInt(units.length)*99000n),shipping_total:shipping,default_warehouse_units:defaultUnits,packages,lines:frozen});
  }
  if(Date.now()>deadline) throw new AccessError(503,'SHIPPING_RATE_TIMEOUT');
  if(!plans.length) throw new AccessError(422,method==='cod'&&supportedPrepaid?'COD_UNAVAILABLE':'NO_SUPPORTED_ROUTE');
  const [finalClock]=await tx`select clock_timestamp()::text as now,app.reservation_clock(${namespace})::text as business_now`;
  for(const productId of productIds) if(!await salePublication(tx,productId,finalClock.now)) throw new AccessError(409,'PUBLICATION_REVIEW_REQUIRED');
  if(plans.some((p)=>Date.parse(p.expires_at)<=Date.parse(finalClock.business_now))) throw new AccessError(409,'SHIPPING_RATE_EXPIRED');
  return plans.sort((a,b)=>a.shipping_total-b.shipping_total||a.packages.length-b.packages.length||b.default_warehouse_units-a.default_warehouse_units||compare(a.id,b.id)).slice(0,20);
}
