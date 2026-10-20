import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {readEffectiveAffiliateRate} from '../affiliates/rates.ts';
import {readCatalogRevision} from '../catalog/catalog.ts';
import {salePublication} from '../catalog/publication.ts';
import {integer} from '../catalog/validation.ts';
import {evaluateContribution,lockContributionSources} from '../finance/contribution.ts';
import type {ShippingPlan} from './quotes.ts';

export async function lockPublishedSources(tx:TransactionSql,productIds:readonly string[]){
  const ids=[...new Set(productIds)].sort();
  await tx`select id from app.product where id in ${tx(ids)} order by id for share`;
  await tx`select product_id from app.publication_head where product_id in ${tx(ids)} order by product_id for share`;
  for(const productId of ids){
    const [published]=await tx`select v.product_revision from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision where h.product_id=${productId}`;
    if(!published) throw new AccessError(409,'PUBLICATION_REVIEW_REQUIRED');
    await lockContributionSources(tx,await readCatalogRevision(tx,productId,published.product_revision));
  }
}

// Trusted S17 rule output only. S20 supplies authorized cart/customer/quote and
// atomically reserves positive benefits after this current-source check.
export async function checkShippingBenefit(tx:TransactionSql,plan:ShippingPlan,allocations:readonly {shipment_id:string;amount:number}[],affiliateId:string|null=null,buyerUserId:string|null=null){
  if(new Set(allocations.map((a)=>a.shipment_id)).size!==allocations.length||allocations.length>100) throw new AccessError(400,'INVALID_SHIPPING_BENEFIT');
  const byLine=new Map<string,bigint>();const segments=new Map<string,{quantity:number;amount:bigint}[]>();
  for(const allocation of allocations){
    integer(allocation.amount,0,Number.MAX_SAFE_INTEGER);const parcel=plan.packages.find((p)=>p.id===allocation.shipment_id);
    if(!parcel||allocation.amount>parcel.shipping_amount) throw new AccessError(400,'INVALID_SHIPPING_BENEFIT');
    const total=parcel.lines.reduce((n,l)=>n+BigInt(l.quantity),0n);const amount=BigInt(allocation.amount);
    const shares=parcel.lines.map((l)=>({line_id:l.line_id,quantity:l.quantity,base:amount*BigInt(l.quantity)/total,remainder:amount*BigInt(l.quantity)%total}));
    let extra=amount-shares.reduce((sum,s)=>sum+s.base,0n);
    shares.sort((a,b)=>a.remainder===b.remainder?a.line_id<b.line_id?-1:a.line_id>b.line_id?1:0:a.remainder>b.remainder?-1:1);
    for(const share of shares){if(extra>0n){share.base++;extra--;}byLine.set(share.line_id,(byLine.get(share.line_id)??0n)+share.base);segments.set(share.line_id,[...(segments.get(share.line_id)??[]),{quantity:share.quantity,amount:share.base}]);}
  }
  await lockPublishedSources(tx,plan.lines.map((l)=>l.product_id));
  const sources=[];const [clock]=await tx`select clock_timestamp()::text as now`;
  const rate=affiliateId===null?null:await readEffectiveAffiliateRate(tx,affiliateId,new Date(clock.now).toISOString(),buyerUserId);
  for(const productId of [...new Set(plan.lines.map((l)=>l.product_id))].sort()){
    const publication=await salePublication(tx,productId,clock.now);if(!publication) throw new AccessError(409,'PUBLICATION_REVIEW_REQUIRED');
    const snapshot=await evaluateContribution(tx,publication.draft,clock.now,rate?{basis_points:rate.basis_points,policy_version_id:rate.policy.id}:undefined);
    const [approval]=await tx`select exception_reason is not null as approved,commission_bps from app.publication_version where id=${publication.publication_id}`;
    for(const line of plan.lines.filter((l)=>l.product_id===productId)){
      if(line.publication_id!==publication.publication_id||line.product_revision!==publication.product_revision) throw new AccessError(409,'PUBLICATION_REVIEW_REQUIRED');
      const offer=snapshot.offers.find((o)=>o.offer_id===line.offer_id);if(!offer) throw new AccessError(409,'OFFER_UNAVAILABLE');
      const subsidy=byLine.get(line.line_id)??0n;const assumed=offer.assumptions.subsidy_idr;
      let exceptionApplied=false;
      // Do not let a profitable unit/parcel subsidize a different unit beyond
      // its frozen owner allowance. Integer remainder goes to a real unit.
      for(const segment of segments.get(line.line_id)??[{quantity:line.quantity,amount:0n}]){
        // Preserve historical default/no-subsidy quote identity. Attributed
        // quotes must also evaluate a higher rate when there is no subsidy.
        if(segment.amount===0n&&rate===null) continue;
        const worstUnit=(segment.amount+BigInt(segment.quantity)-1n)/BigInt(segment.quantity);
        const bounded=approval.approved&&snapshot.commission_bps<=Number(approval.commission_bps)
          &&(worstUnit===0n||(assumed!==null&&assumed!==undefined&&worstUnit<=BigInt(assumed)));
        const contribution=offer.complete&&offer.estimated_contribution!==null&&assumed!==null&&assumed!==undefined
          ?BigInt(offer.estimated_contribution)+BigInt(assumed)-worstUnit:null;
        const needsReview=contribution===null||contribution<BigInt(snapshot.minimum_contribution_idr);
        if(needsReview&&!bounded) throw new AccessError(422,rate?'AFFILIATE_CONTRIBUTION_REVIEW_REQUIRED':'PROMOTIONAL_CONTRIBUTION_REVIEW_REQUIRED');
        if(needsReview) exceptionApplied=true;
      }
      sources.push({line_id:line.line_id,publication_id:publication.publication_id,policy_version_id:snapshot.policy_version_id,assumption_version_id:offer.assumption_version_id,
        component_cost_version_ids:offer.components.map((c)=>c.cost_version_id),allocated_subsidy:Number(subsidy),exception_applied:exceptionApplied,
        ...(rate?{affiliate_id:rate.affiliate_id,rate_version_id:rate.rate_version_id,commission_bps:rate.basis_points,commission_idr:rate.commission_idr}:{})});
    }
  }
  return {eligible:true,sources};
}
