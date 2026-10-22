import {createHash,randomUUID} from "node:crypto";
import type {TransactionSql} from "postgres";
import type {LocalAuth} from "../access/auth.ts";
import {assertCurrentOwner,consumeAccessProof} from "../access/grants.ts";
import {AccessError,type Principal} from "../access/policy.ts";
import {evaluateContribution,lockContributionSources} from "../finance/contribution.ts";
import {offerAvailability} from "../inventory/reservations.ts";
import {assertScope,authority,readCatalogRevision,visibleBlocker} from "./catalog.ts";
import {definitions,id,integer,invalid,object,offerInput,text} from "./validation.ts";

type Draft=Awaited<ReturnType<typeof readCatalogRevision>>;
type Blocker={code:string;offer_id:string|null;fact_key?:string};
type Published={id:string;product_id:string;revision:number;product_revision:number;policy_version_id:string;exception_reason:string|null;created_at:string};
const projection=(row:Published)=>({id:row.id,product_id:row.product_id,version:row.revision,product_revision:row.product_revision,
  exception_applied:row.exception_reason!==null,created_at:new Date(row.created_at).toISOString()});

async function lockPhysicalSources(tx:TransactionSql,draft:Draft){
  const required=[...new Map(draft.variants.filter((v)=>!v.retired).flatMap((v)=>v.contents.map((c)=>{
    const value={warehouse_id:v.default_warehouse_id,stock_item_id:c.stock_item_id};return [`${value.warehouse_id}:${value.stock_item_id}`,value] as const;
  }))).values()];
  const warehouses=[...new Set(required.map((r)=>r.warehouse_id))].sort();
  if(warehouses.length) await tx`select id from app.warehouse where id in ${tx(warehouses)} order by id for share`;
  if(required.length) await tx`select b.id from app.inventory_balance b where exists (
    select 1 from jsonb_to_recordset(${JSON.stringify(required)}::jsonb) as r(warehouse_id uuid,stock_item_id uuid)
    where r.warehouse_id=b.warehouse_id and r.stock_item_id=b.stock_item_id) order by b.id for share`;
}
export async function publicationChecks(tx:TransactionSql,draft:Draft){
  const blockers:Blocker[]=[];const active=draft.variants.filter((v)=>!v.retired);
  if(!draft.images.length) blockers.push({code:'MEDIA_REQUIRED',offer_id:null});
  if(!draft.description.trim()) blockers.push({code:'DESCRIPTION_REQUIRED',offer_id:null});
  if(!active.length) blockers.push({code:'INVALID_OFFER_COUNT',offer_id:null});
  const categories=await tx`with recursive parents as (select id,parent_id,attribute_definitions from app.category where id=${draft.category_id}
    union all select c.id,c.parent_id,c.attribute_definitions from app.category c join parents p on c.id=p.parent_id) select attribute_definitions from parents`;
  if(!categories.length) blockers.push({code:'CATEGORY_REQUIRED',offer_id:null});
  const rules=categories.flatMap((c)=>definitions(c.attribute_definitions));
  for(const offer of active){
    try{offerInput({label:offer.label,attributes:offer.attributes,weight_grams:offer.weight_grams,length_mm:offer.length_mm,width_mm:offer.width_mm,height_mm:offer.height_mm,
      default_warehouse_id:offer.default_warehouse_id,offer_kind:offer.offer_kind,contents:offer.contents,...(offer.image?{image:offer.image}:{})},false);}
    catch(error){if(!(error instanceof AccessError)) throw error;blockers.push({code:'INVALID_OFFER',offer_id:offer.id});}
    for(const rule of rules){
      const fact=offer.attributes.find((a)=>a.key===rule.key)??draft.facts.find((a)=>a.key===rule.key);
      if(!fact){if(rule.required) blockers.push({code:'REQUIRED_FACT_MISSING',offer_id:offer.id,fact_key:rule.key});continue;}
      const valid=fact.values.every((value)=>rule.value_type==='number'?/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value))
        :rule.value_type==='boolean'?['true','false'].includes(value):rule.value_type==='enum'?rule.allowed_values.includes(value):Boolean(value.trim()));
      if(!valid) blockers.push({code:'FACT_TYPE_INVALID',offer_id:offer.id,fact_key:rule.key});
    }
    try{if(await offerAvailability(tx,{product_id:draft.id,product_revision:draft.version,offer_id:offer.id,warehouse_id:offer.default_warehouse_id})<1) blockers.push({code:'COMPLETE_STOCK_REQUIRED',offer_id:offer.id});}
    catch(error){if(!(error instanceof AccessError)||error.status!==404) throw error;blockers.push({code:'ACTIVE_WAREHOUSE_REQUIRED',offer_id:offer.id});}
  }
  return blockers;
}
const financialBlockers=(snapshot:Awaited<ReturnType<typeof evaluateContribution>>):Blocker[]=>snapshot.offers.flatMap((offer)=>[
  ...offer.missing_inputs.map((field)=>({code:`UNKNOWN_${field.startsWith('hpp:')?'HPP':field.toUpperCase()}`,offer_id:offer.offer_id})),
  ...(offer.below_floor?[{code:'BELOW_MARGIN_FLOOR',offer_id:offer.offer_id}]:[]),
]);

export async function publishProduct(request:Request,identity:LocalAuth,principal:Principal,productId:string,value:unknown){
  const body=object(value,['expected_version','expected_publication_version','reason','exception']);const product=id(productId);
  let exception:{reason:string;reauthentication_proof:string}|null=null;
  if(body.exception!==undefined){
    const e=object(body.exception,['reason','reauthentication_proof']);const proof=text(e.reauthentication_proof,100);
    if(proof!==e.reauthentication_proof||!/^[A-Za-z0-9_-]{1,100}$/.test(proof)) throw invalid();exception={reason:text(e.reason,500),reauthentication_proof:proof};
  }
  const input={product_id:product,expected_version:integer(body.expected_version,1),expected_publication_version:integer(body.expected_publication_version,0),reason:text(body.reason,500),exception_reason:exception?.reason??null};
  const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
  const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');const requestedException=exception;
  return identity.sql.begin(async(tx)=>{
    const access=await authority(tx,principal);if(requestedException&&!access.owner) throw new AccessError(403,'FORBIDDEN');
    await tx`select id from app.product where id=${product} for update`;const draft=await readCatalogRevision(tx,product);assertScope(draft,access);
    const [prior]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='catalog.publication' and key=${key}`;
    if(prior){
      if(prior.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');
      assertScope(await readCatalogRevision(tx,product,prior.response.product_revision),access);return prior.response;
    }
    if(draft.version!==input.expected_version) throw new AccessError(409,'VERSION_CONFLICT');
    await tx`insert into app.publication_head (product_id) values (${product}) on conflict do nothing`;
    const [head]=await tx`select revision from app.publication_head where product_id=${product} for update`;
    if(head.revision!==input.expected_publication_version) throw new AccessError(409,'PUBLICATION_VERSION_CONFLICT');
    await lockContributionSources(tx,draft);await lockPhysicalSources(tx,draft);
    const catalogue=await publicationChecks(tx,draft);if(catalogue.length) throw new AccessError(422,catalogue[0].code);
    const [clock]=await tx`select clock_timestamp()::text as now`;const snapshot=await evaluateContribution(tx,draft,clock.now);
    const financial=financialBlockers(snapshot);
    if(financial.length&&!requestedException) throw new AccessError(422,financial[0].code);
    if(requestedException){await assertCurrentOwner(tx,principal,true);await consumeAccessProof(tx,principal,'catalog_publication.exception',product,requestedException.reauthentication_proof);}
    const publicationId=randomUUID();
    const [published]=await tx<Published[]>`insert into app.publication_version (id,product_id,revision,product_revision,policy_version_id,minimum_contribution_idr,commission_bps,evaluated_at,exception_reason,actor_id,reason)
      values (${publicationId},${product},${head.revision+1},${draft.version},${snapshot.policy_version_id},${snapshot.minimum_contribution_idr},${snapshot.commission_bps},${snapshot.evaluated_at},${requestedException?.reason??null},${principal.id},${input.reason}) returning *`;
    for(const offer of snapshot.offers){
      await tx`insert into app.publication_offer (publication_id,product_id,product_revision,offer_id,assumption_version_id,estimated_hpp,estimated_contribution,complete)
        values (${publicationId},${product},${draft.version},${offer.offer_id},${offer.assumption_version_id},${offer.estimated_hpp},${offer.estimated_contribution},${offer.complete})`;
      for(const component of offer.components) await tx`insert into app.publication_component_cost (publication_id,offer_id,stock_item_id,quantity,cost_version_id)
        values (${publicationId},${offer.offer_id},${component.stock_item_id},${component.quantity},${component.cost_version_id})`;
    }
    await tx`update app.publication_head set revision=revision+1 where product_id=${product}`;
    const response=projection(published);
    await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},'catalog.product.publish',${product},'allowed',${input.reason},${JSON.stringify({publication_id:publicationId,product_revision:draft.version,exception_applied:response.exception_applied})}::jsonb)`;
    await tx`insert into app.access_operation (actor_id,action,key,request_hash,response)
      values (${principal.id},'catalog.publication',${key},${hash},${JSON.stringify(response)}::jsonb)`;
    return response;
  });
}

// Takes the current publication off sale (storefront, carts, quotes) through an immutable,
// audited withdrawal row; publication history is never edited. Republishing is an ordinary
// publishProduct against the unchanged latest_version. Already-placed orders keep their snapshots.
export async function withdrawPublication(request:Request,identity:LocalAuth,principal:Principal,productId:string,value:unknown){
  const body=object(value,['expected_publication_version','reason']);const product=id(productId);
  const input={product_id:product,expected_publication_version:integer(body.expected_publication_version,1),reason:text(body.reason,500)};
  const key=request.headers.get('idempotency-key');if(!key||!/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400,'INVALID_IDEMPOTENCY_KEY');
  const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return identity.sql.begin(async(tx)=>{
    const access=await authority(tx,principal);
    await tx`select id from app.product where id=${product} for update`;assertScope(await readCatalogRevision(tx,product),access);
    const [prior]=await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='catalog.publication.withdraw' and key=${key}`;
    if(prior){if(prior.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return prior.response;}
    const [head]=await tx`select revision from app.publication_head where product_id=${product} for update`;
    if((head?.revision??0)!==input.expected_publication_version) throw new AccessError(409,'PUBLICATION_VERSION_CONFLICT');
    const [current]=await tx`select v.id,v.product_revision,exists (select 1 from app.publication_withdrawal w where w.publication_id=v.id) withdrawn
      from app.publication_version v where v.product_id=${product} and v.revision=${input.expected_publication_version}`;
    if(current.withdrawn) throw new AccessError(409,'PUBLICATION_ALREADY_WITHDRAWN');
    const [row]=await tx`insert into app.publication_withdrawal (publication_id,product_id,product_revision,actor_id,reason)
      values (${current.id},${product},${current.product_revision},${principal.id},${input.reason}) returning created_at`;
    const response={publication_id:current.id as string,product_id:product,version:input.expected_publication_version,withdrawn_at:new Date(row.created_at).toISOString()};
    await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},'catalog.product.withdraw',${product},'allowed',${input.reason},${JSON.stringify({publication_id:current.id,publication_version:input.expected_publication_version})}::jsonb)`;
    await tx`insert into app.access_operation (actor_id,action,key,request_hash,response) values (${principal.id},'catalog.publication.withdraw',${key},${hash},${JSON.stringify(response)}::jsonb)`;
    return response;
  });
}

// Internal quote/storefront consumer. It returns catalog data only, never the
// private financial sources or owner exception text. The caller owns its clock,
// publication/quote lifecycle and authorization; no client as-of value is used.
export async function salePublication(tx:TransactionSql,productId:string,at:string){
  const product=id(productId);if(!(await tx`select id from app.product where id=${product} for share`).length) return null;
  const [published]=await tx<Published[]>`select v.* from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision
    where h.product_id=${product} and not exists (select 1 from app.publication_withdrawal w where w.publication_id=v.id) for share of h`;
  if(!published) return null;
  const draft=await readCatalogRevision(tx,published.product_id,published.product_revision);await lockContributionSources(tx,draft);
  let current:Awaited<ReturnType<typeof evaluateContribution>>;
  try{current=await evaluateContribution(tx,draft,at);}catch(error){if(error instanceof AccessError&&[409,422].includes(error.status)) return null;throw error;}
  if(current.policy_version_id!==published.policy_version_id) return null;
  const offers=await tx`select offer_id,assumption_version_id from app.publication_offer where publication_id=${published.id}`;
  const components=await tx`select offer_id,stock_item_id,cost_version_id from app.publication_component_cost where publication_id=${published.id}`;
  for(const offer of current.offers){
    if(!offers.some((old)=>old.offer_id===offer.offer_id&&old.assumption_version_id===offer.assumption_version_id)) return null;
    for(const component of offer.components) if(!components.some((old)=>old.offer_id===offer.offer_id&&old.stock_item_id===component.stock_item_id&&old.cost_version_id===component.cost_version_id)) return null;
  }
  return {publication_id:published.id,publication_version:published.revision,product_revision:published.product_revision,draft};
}
export async function readPublicationState(identity:LocalAuth,principal:Principal,productId:string){
  return identity.sql.begin(async(tx)=>{
    const access=await authority(tx,principal,true);const product=id(productId);await tx`select id from app.product where id=${product} for share`;
    const draft=await readCatalogRevision(tx,product);assertScope(draft,access);await lockContributionSources(tx,draft);await lockPhysicalSources(tx,draft);
    const blockers=await publicationChecks(tx,draft);const [clock]=await tx`select clock_timestamp()::text as now`;
    try{blockers.push(...financialBlockers(await evaluateContribution(tx,draft,clock.now)));}
    catch(error){if(!(error instanceof AccessError)||![409,422].includes(error.status)) throw error;blockers.push({code:error.code,offer_id:null});}
    const [head]=await tx`select revision from app.publication_head where product_id=${product}`;
    // A withdrawn head is not current: latest_version stays, so republishing expects it.
    const [published]=await tx<Published[]>`select v.* from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision
      where h.product_id=${product} and not exists (select 1 from app.publication_withdrawal w where w.publication_id=v.id)`;
    let current:ReturnType<typeof projection>|null=null;
    if(published){try{assertScope(await readCatalogRevision(tx,product,published.product_revision),access);current=projection(published);}catch(error){if(!(error instanceof AccessError)||error.status!==404) throw error;}}
    const currentReview=current?(await salePublication(tx,product,clock.now)?'approved':'requires_review'):null;
    // lazy: expose first100 actionable reasons; repeated preview after correction
    // reveals the remainder without an unbounded admin response.
    return {latest_version:head?.revision??0,current,current_review_state:currentReview,draft_version:draft.version,ready:blockers.length===0,
      blockers:blockers.slice(0,100).map((b)=>({...b,code:visibleBlocker(access,b.code)})),blocker_count:blockers.length,blockers_truncated:blockers.length>100};
  });
}
