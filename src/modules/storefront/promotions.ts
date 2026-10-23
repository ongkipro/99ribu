import type {LocalAuth} from '../access/auth.ts';
import {catalogQuery,listProducts} from './catalog.ts';
import {homeSafe} from './department-photos.ts';

// Public read of shipping promotions for /promo: the same activity rule checkout applies
// (active configuration, inside its window) plus budget left; only the terms a buyer needs.
export type PublicShippingPromotion={id:string;name:string;kind:'fixed'|'percentage';value:number;maximum_per_order:number;minimum_merchandise:number;payment_methods:string[];regions:number;ends_at:string};
export async function activeShippingPromotions(identity:LocalAuth,now=new Date()):Promise<PublicShippingPromotion[]>{
 const rows=await identity.sql`select v.promotion_id,v.name,v.kind,v.value,v.maximum_per_order,v.minimum_merchandise,v.payment_methods,v.region_ids,v.ends_at
  from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision
  where v.active and v.starts_at<=${now.toISOString()} and v.ends_at>${now.toISOString()} and p.reserved_amount+p.committed_amount<v.budget
  order by v.priority desc,v.ends_at,p.id limit 50`;
 return rows.map(row=>({id:String(row.promotion_id),name:String(row.name),kind:row.kind==='percentage'?'percentage':'fixed',value:Number(row.value),maximum_per_order:Number(row.maximum_per_order),
  minimum_merchandise:Number(row.minimum_merchandise),payment_methods:row.payment_methods as string[],regions:(row.region_ids as string[]).length,ends_at:new Date(String(row.ends_at)).toISOString()}));
}
// Mixed bundles only: an offer with at least two different items (a pack of one item is a multipack).
export async function bundleOffers(identity:LocalAuth,limit=12){
 const {data}=await listProducts(identity,catalogQuery(new URLSearchParams({offer_kind:'bundle',sort:'newest',limit:'40'})));
 // Most varied bundles first (by distinct items), so the section is a curated view, not the catalog order.
 // Like the other curated surfaces, it leaves out claim names and photos (homeSafe).
 const variety=(p:(typeof data)[number])=>Math.max(0,...p.variants.filter(v=>v.offer_kind==='bundle').map(v=>new Set(v.contents.map(c=>c.name)).size));
 return data.filter(p=>variety(p)>=2&&homeSafe(p)).sort((a,b)=>variety(b)-variety(a)).slice(0,limit);
}
// The header shows the Promo link only when /promo has something real to show.
export async function hasPromoContent(identity:LocalAuth){
 const [promo]=await identity.sql`select 1 from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision
  where v.active and v.starts_at<=now() and v.ends_at>now() and p.reserved_amount+p.committed_amount<v.budget limit 1`;
 return Boolean(promo)||(await bundleOffers(identity,1)).length>0;
}
