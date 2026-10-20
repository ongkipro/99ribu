import type {TransactionSql} from "postgres";
import type {LocalAuth} from "../access/auth.ts";
import {AccessError,type Principal} from "../access/policy.ts";
import {offerCommissionIdr} from '../affiliates/rates.ts';
import {readCatalogRevision} from "../catalog/catalog.ts";
import {id} from "../catalog/validation.ts";
import {resolvePolicy} from "../settings/policies.ts";
import {financeAuthority} from "./costs.ts";

type Draft=Awaited<ReturnType<typeof readCatalogRevision>>;
type Cost={id:string;stock_item_id:string;unit_cost:number|null};
type Assumptions={id:string;offer_id:string;packaging_idr:number|null;provider_fee_idr:number|null;subsidy_idr:number|null;returns_reserve_idr:number|null};
const assumptionFields=['packaging_idr','provider_fee_idr','subsidy_idr','returns_reserve_idr'] as const;
function amount(value:bigint){
  if(value>BigInt(Number.MAX_SAFE_INTEGER)||value<BigInt(Number.MIN_SAFE_INTEGER)) throw new AccessError(422,'COST_CALCULATION_LIMIT');
  return Number(value);
}

// Publication takes product FOR UPDATE first; financial reads take FOR SHARE.
// Cost/assumption appenders lock only their existing SKU/offer identity, avoiding
// a reverse product/offer lock cycle. All readers use this same source order.
export async function lockContributionSources(tx:TransactionSql,draft:Draft){
  const offers=draft.variants.filter((v)=>!v.retired);const stocks=[...new Set(offers.flatMap((o)=>o.contents.map((c)=>c.stock_item_id)))].sort();
  const offerIds=offers.map((o)=>o.id).sort();
  if(stocks.length) await tx`select id from app.stock_item where id in ${tx(stocks)} order by id for share`;
  if(offerIds.length) await tx`select id from app.offer where id in ${tx(offerIds)} order by id for share`;
  await tx`select id from app.policy_head where kind='commercial' and warehouse_id is null for share`;
}
// Trusted internal snapshot builder; its financial values must never be sent to
// ordinary catalog staff or a public storefront projection.
export async function evaluateContribution(tx:TransactionSql,draft:Draft,at:string,rate?:{basis_points:number;policy_version_id:string}){
  const variants=draft.variants.filter((v)=>!v.retired);const stockIds=[...new Set(variants.flatMap((v)=>v.contents.map((c)=>c.stock_item_id)))];
  const offerIds=variants.map((v)=>v.id);
  if(!stockIds.length||!offerIds.length) throw new AccessError(422,'INVALID_OFFER_COUNT');
  const policy=await resolvePolicy(tx,'commercial',null,new Date(at));
  if(!('default_commission_bps' in policy.values)) throw new AccessError(503,'POLICY_INVALID');
  if(rate&&rate.policy_version_id!==policy.id)throw new AccessError(409,'FINANCIAL_REVIEW_REQUIRED');
  const commissionBps=rate?.basis_points??policy.values.default_commission_bps;const floor=policy.values.minimum_contribution_idr??0;
  const commission=offerCommissionIdr(commissionBps);
  const costs=await tx<Cost[]>`select distinct on (stock_item_id) id,stock_item_id,unit_cost from app.component_cost_version
    where stock_item_id in ${tx(stockIds)} and effective_at<=${at}::timestamptz order by stock_item_id,effective_at desc,revision desc`;
  const profiles=await tx<Assumptions[]>`select distinct on (offer_id) id,offer_id,packaging_idr,provider_fee_idr,subsidy_idr,returns_reserve_idr
    from app.offer_cost_assumption_version where offer_id in ${tx(offerIds)} and effective_at<=${at}::timestamptz order by offer_id,effective_at desc,revision desc`;
  const costsByStock=new Map(costs.map((cost)=>[cost.stock_item_id,cost]));const profilesByOffer=new Map(profiles.map((profile)=>[profile.offer_id,profile]));
  const offers=variants.map((offer)=>{
    const missing:string[]=[];let hpp=0n;
    const components=offer.contents.map((part)=>{
      const source=costsByStock.get(part.stock_item_id);const unit=source?.unit_cost??null;
      if(unit===null) missing.push(`hpp:${part.stock_item_id}`);else hpp+=BigInt(unit)*BigInt(part.quantity);
      return {stock_item_id:part.stock_item_id,quantity:part.quantity,cost_version_id:source?.id??null,unit_cost:unit};
    });
    const estimatedHpp=missing.length?null:amount(hpp);const profile=profilesByOffer.get(offer.id)??null;let variable=0n;
    for(const field of assumptionFields){const value=profile?.[field]??null;if(value===null) missing.push(field);else variable+=BigInt(value);}
    const complete=missing.length===0;
    const contribution=complete?amount(99000n-hpp-variable-BigInt(commission)):null;
    return {offer_id:offer.id,estimated_hpp:estimatedHpp,estimated_contribution:contribution,complete,missing_inputs:missing,
      below_floor:contribution!==null&&contribution<floor,commission_idr:commission,assumption_version_id:profile?.id??null,
      assumptions:profile?Object.fromEntries(assumptionFields.map((name)=>[name,profile[name]])):Object.fromEntries(assumptionFields.map((name)=>[name,null])),components};
  });
  return {product_id:draft.id,product_revision:draft.version,policy_version_id:policy.id,commission_bps:commissionBps,minimum_contribution_idr:floor,
    evaluated_at:at,currency:'IDR',price_idr:99000,offers};
}
export async function readContribution(identity:LocalAuth,principal:Principal,productId:string){
  return identity.sql.begin(async(tx)=>{
    await financeAuthority(tx,principal,'finance.costs.read');
    const selected=id(productId);await tx`select id from app.product where id=${selected} for share`;
    const draft=await readCatalogRevision(tx,selected);await lockContributionSources(tx,draft);
    const [clock]=await tx`select clock_timestamp()::text as now`;const snapshot=await evaluateContribution(tx,draft,clock.now);
    await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},'finance.contribution.read',${selected},'allowed','Read current estimated contribution',${JSON.stringify({product_revision:draft.version})}::jsonb)`;
    return {...snapshot,evaluated_at:new Date(snapshot.evaluated_at).toISOString()};
  });
}
