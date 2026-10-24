import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError} from '../access/policy.ts';
import {lockRateActor} from '../affiliates/rates.ts';
import {array,id,integer,invalid,object,text} from '../catalog/validation.ts';
import {allocate,compare,safeMoney,type Rule,type Shipment} from '../promotions/allocation.ts';
import {identifier} from '../promotions/configuration.ts';
import {normalizeAddress,normalizePhone,shippingFixture} from '../shipping/address.ts';
import {buildShippingPlans,type ShippingPlan} from '../shipping/quotes.ts';
import {isValidEmail} from '../storefront/contact.ts';
import {checkShippingBenefit} from '../shipping/contribution.ts';
import {authorizeCart,digest,mac,type CartRow,type CommerceActor} from './access.ts';
import {codFee,paymentTerms,PAYMENT_CHANNELS,paymentChannel,type PaymentChannel} from '../payments/methods.ts';
import {assertCartOpen,cartClock,cartLines,expectedCartVersion,intentHash,mutationKey,priorOperation,recordOperation} from './carts.ts';

export type PromotionAllocation=ReturnType<typeof allocate>[number];
export type QuoteDocument={plans:ShippingPlan[];selected_plan:ShippingPlan;address:ReturnType<typeof normalizeAddress>;contact:{phone:string;email:string|null};customer_key:string;promotions:PromotionAllocation[];financial_sources:Awaited<ReturnType<typeof checkShippingBenefit>>['sources'];affiliate_id?:string};
export type QuoteRow={id:string;cart_id:string;cart_revision:number;parent_id:string|null;operation_id:string;document:QuoteDocument;payment_method:'prepaid'|'cod';merchandise_amount:string;shipping_amount:string;subsidy_amount:string;buyer_total:string;created_at:string;expires_at:string;payment_channel:PaymentChannel|null;payment_charge_amount:string;cod_fee_bps:number|null};
export function normalizeContact(value:unknown){
 const b=object(value,['phone','email']);let email:string|null=null;
 if(b.email!==undefined&&b.email!==null){email=text(b.email,254).normalize('NFC').toLowerCase();if(!isValidEmail(email)) throw invalid();}
 return {phone:normalizePhone(b.phone),email};
}
export function promotionShipments(plan:ShippingPlan):Shipment[]{
 const destination=shippingFixture().destinations.find(d=>d.id===plan.destination_id);if(!destination) throw new AccessError(409,'DESTINATION_UNAVAILABLE');
 return plan.packages.map(p=>{const option=p.options.find(o=>o.id===p.selected_option_id);if(!option) throw new AccessError(409,'SHIPPING_OPTION_UNAVAILABLE');return {shipment_id:p.id,origin_warehouse_id:p.warehouse_id,shipping_fee:p.shipping_amount,service_id:option.service_id,region_ids:[destination.id]};});
}
export function parcelBenefits(plan:ShippingPlan,promotions:readonly PromotionAllocation[]){return plan.packages.map(p=>({shipment_id:p.id,amount:promotions.reduce((n,a)=>n+(a.shipments.find(s=>s.shipment_id===p.id)?.amount??0),0)}));}
export async function previewPromotions(tx:TransactionSql,plan:ShippingPlan,customerKey:string,now:string){
 const rules=await tx<(Rule&{starts_at:string;ends_at:string;budget:string;reserved_amount:string;committed_amount:string;reserved_uses:number;committed_uses:number;per_buyer_limit:number})[]>`
  select v.*,p.reserved_amount,p.committed_amount,coalesce(b.reserved_uses,0)::int reserved_uses,coalesce(b.committed_uses,0)::int committed_uses
  from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision
  left join app.promotion_buyer_usage b on b.promotion_id=p.id and b.customer_key=${customerKey}
  where v.active and v.starts_at<=${now} and v.ends_at>${now} and ${plan.payment_method}=any(v.payment_methods) and v.minimum_merchandise<=${plan.merchandise_total}
  order by v.priority desc,p.id limit 101`;
 if(rules.length>100) throw new AccessError(422,'PROMOTION_REVIEW_REQUIRED');
 const chosen:(typeof rules)[number][]=[];let allocations:PromotionAllocation[]=[];const shipments=promotionShipments(plan);
 for(const rule of rules){
  if(chosen.some(r=>r.stacking==='exclusive')||(rule.stacking==='exclusive'&&chosen.length)) continue;
  if(rule.reserved_uses+rule.committed_uses>=rule.per_buyer_limit) continue;
  const proposed=allocate([...chosen,rule],shipments);const own=proposed.find(a=>a.promotion_id===rule.promotion_id);if(!own) continue;
  if(BigInt(rule.reserved_amount)+BigInt(rule.committed_amount)+BigInt(own.amount)>BigInt(rule.budget)) continue;
  chosen.push(rule);allocations=proposed;
 }
 return allocations.sort((a,b)=>compare(a.promotion_id,b.promotion_id));
}
export function projectPackages(plan:ShippingPlan,promotions:readonly PromotionAllocation[],codFeeBps:number|null=null){
 const benefits=parcelBenefits(plan,promotions);
 return plan.packages.map(p=>{const subsidy=benefits.find(a=>a.shipment_id===p.id)?.amount??0,fee=plan.payment_method==='cod'?codFee(p.merchandise_amount+p.shipping_amount-subsidy,codFeeBps??0):0;return {id:p.id,origin_city:p.origin_city,lines:p.lines.map(l=>({cart_line_id:l.line_id,variant_id:plan.lines.find(v=>v.line_id===l.line_id)?.offer_id,quantity:l.quantity})),
  options:p.options.map(o=>({id:o.id,courier_name:o.courier_name,service_name:o.service_name,shipping_amount:o.shipping_amount,supports_cod:o.supports_cod,source:o.source,expires_at:o.expires_at})),
  selected_option_id:p.selected_option_id,merchandise_amount:p.merchandise_amount,shipping_amount:p.shipping_amount,subsidy_amount:subsidy,buyer_shipping_amount:p.shipping_amount-subsidy,
  ...(plan.payment_method==='cod'?{cod_fee_amount:fee,cod_collect_amount:p.merchandise_amount+p.shipping_amount-subsidy+fee}:{})};});
}
export function projectQuote(row:QuoteRow){const d=row.document,channel=row.payment_channel??(row.payment_method==='cod'?'cod':'local-prepaid'),charge=Number(row.payment_charge_amount??0);
 return {id:row.id,cart_id:row.cart_id,cart_version:row.cart_revision,expires_at:new Date(row.expires_at).toISOString(),payment_method:row.payment_method,payment_channel:channel,currency:'IDR',
  merchandise_total:Number(row.merchandise_amount),shipping_total:Number(row.shipping_amount),subsidy_total:Number(row.subsidy_amount),buyer_total:Number(row.buyer_total),
  cod_fee_bps:row.cod_fee_bps??null,cod_fee_total:row.payment_method==='cod'?charge:0,amount_due:Number(row.buyer_total)+charge,
  available_payment_methods:[{id:channel==='cod'?'local-cod':channel,label:PAYMENT_CHANNELS[channel].label,kind:row.payment_method,action_kind:'none'}],
  packages:projectPackages(d.selected_plan,d.promotions,row.cod_fee_bps??null),selected_allocation_id:d.selected_plan.id,allocation_options:d.plans.map(p=>({id:p.id,shipping_total:p.shipping_total,package_count:p.packages.length,origins:[...new Set(p.packages.map(g=>g.origin_city))]})),address:d.address,contact:d.contact,source:'TEST-ONLY'};
}
export async function ownedQuote(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor,quoteId:string){
 const [quote]=await tx<QuoteRow[]>`select * from app.checkout_quote where id=${id(quoteId)}`;if(!quote) throw new AccessError(404,'NOT_FOUND');
 const cart=await authorizeCart(tx,request,identity,actor,quote.cart_id);return {cart,quote};
}
export async function assertQuoteCurrent(tx:TransactionSql,cart:CartRow,quote:QuoteRow,version:number){
 await assertCartOpen(tx,cart,version);
 if(cart.active_quote_id!==quote.id||cart.revision!==quote.cart_revision) throw new AccessError(409,'QUOTE_SUPERSEDED');
 if(new Date(quote.expires_at)<=await cartClock(tx,cart)) throw new AccessError(409,'QUOTE_EXPIRED');
}
async function persistQuote(tx:TransactionSql,actor:CommerceActor,key:string,hash:string,cart:CartRow,document:QuoteDocument,parent:QuoteRow|null,channel:PaymentChannel){
 const now=await cartClock(tx,cart);const plan=document.selected_plan;
 const expires=new Date(Math.min(Date.parse(plan.expires_at),Date.parse(cart.expires_at),parent?Date.parse(parent.expires_at):Infinity)).toISOString();
 if(Date.parse(expires)<=now.getTime()) throw new AccessError(409,'QUOTE_EXPIRED');
 if(Buffer.byteLength(JSON.stringify(document))>1048576) throw new AccessError(422,'QUOTE_REVIEW_REQUIRED');
 const subsidy=document.promotions.reduce((n,a)=>n+a.amount,0);integer(subsidy,0,Number.MAX_SAFE_INTEGER);
 const buyerTotal=safeMoney(BigInt(plan.merchandise_total)+BigInt(plan.shipping_total)-BigInt(subsidy));
 // DEC-009/DEC-008: freeze the buyer COD fee rate in force; manual transfer needs configured accounts.
 const terms=await paymentTerms(tx,now);
 if(channel==='manual-bank'&&!terms.manual_bank_accounts.length)throw new AccessError(409,'MANUAL_BANK_UNAVAILABLE');
 const bps=plan.payment_method==='cod'?terms.cod_fee_bps:null,charge=plan.payment_method==='cod'?projectPackages(plan,document.promotions,bps).reduce((n,p)=>n+(p.cod_fee_amount??0),0):0;
 const operationId=randomUUID();const [quote]=await tx<QuoteRow[]>`insert into app.checkout_quote (cart_id,cart_revision,parent_id,operation_id,document,payment_method,merchandise_amount,shipping_amount,subsidy_amount,buyer_total,created_at,expires_at,payment_channel,payment_charge_amount,cod_fee_bps)
  values (${cart.id},${cart.revision},${parent?.id??null},${operationId},${JSON.stringify(document)}::jsonb,${plan.payment_method},${plan.merchandise_total},${plan.shipping_total},${subsidy},${buyerTotal},${now.toISOString()},${expires},${channel},${charge},${bps}) returning *`;
 await tx`update app.cart set active_quote_id=${quote.id} where id=${cart.id}`;
 const response=projectQuote(quote);await recordOperation(tx,actor,key,parent?'quote.select':'quote.create',hash,quote.id,response,operationId);return response;
}
export async function createQuote(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor,value:unknown,context:{affiliate_id?:string|null}={}){
 const body=object(value,['cart_id','address','contact','payment_method','payment_channel']);const cartId=id(body.cart_id),address=normalizeAddress(body.address),contact=normalizeContact(body.contact);
 if(typeof body.payment_method!=='string'||!['prepaid','cod'].includes(body.payment_method)) throw invalid();const method=body.payment_method as 'prepaid'|'cod',channel=paymentChannel(method,body.payment_channel);
 const affiliateId=context.affiliate_id==null?null:id(context.affiliate_id);
 const version=expectedCartVersion(request),key=mutationKey(request),hash=await intentHash(identity,'quote.create',{cartId,address,contact,method,version,...(channel!=='local-prepaid'&&channel!=='cod'?{channel}:{}),...(affiliateId?{affiliateId}:{})});
 await lockRateActor(tx,actor,affiliateId);const cart=await authorizeCart(tx,request,identity,actor,cartId);
 const prior=await priorOperation(tx,actor,key,'quote.create',hash);if(prior) return prior.result;
 await assertCartOpen(tx,cart,version);const lines=await cartLines(tx,cart.id);if(!lines.length) throw new AccessError(422,'CART_EMPTY');
 const plans=await buildShippingPlans(tx,{lines:lines.map(l=>({line_id:l.id,product_id:l.product_id,offer_id:l.offer_id,publication_id:l.publication_id,quantity:l.quantity})),destination_id:address.destination_id,payment_method:method},{clock_namespace:cart.clock_namespace});
 const plan=plans[0];const customerKey=digest(await mac(identity,'promotion-buyer',[contact.phone]));const now=(await cartClock(tx,cart)).toISOString();
 const promotions=await previewPromotions(tx,plan,customerKey,now);const finance=await checkShippingBenefit(tx,plan,parcelBenefits(plan,promotions),affiliateId,cart.owner_user_id);
 return persistQuote(tx,actor,key,hash,cart,{plans,selected_plan:plan,address,contact,customer_key:customerKey,promotions,financial_sources:finance.sources,...(affiliateId?{affiliate_id:affiliateId}:{})},null,channel);
}
export async function selectQuote(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor,quoteId:string,value:unknown){
 const b=object(value,['allocation_id','packages']);const allocationId=b.allocation_id===undefined?null:identifier(b.allocation_id);
 const selections=array(b.packages,v=>{const p=object(v,['package_id','shipping_option_id']);return {package_id:identifier(p.package_id),shipping_option_id:identifier(p.shipping_option_id)};},1,50).sort((a,b)=>compare(a.package_id,b.package_id));
 if(new Set(selections.map(s=>s.package_id)).size!==selections.length) throw invalid();
 const version=expectedCartVersion(request),key=mutationKey(request),hash=await intentHash(identity,'quote.select',{quoteId:id(quoteId),allocationId,selections,version});
 const [before]=await tx`select document->>'affiliate_id' affiliate_id from app.checkout_quote where id=${id(quoteId)}`;
 await lockRateActor(tx,actor,before?.affiliate_id??null);const {cart,quote}=await ownedQuote(tx,request,identity,actor,quoteId);const prior=await priorOperation(tx,actor,key,'quote.select',hash);if(prior) return prior.result;
 await assertQuoteCurrent(tx,cart,quote,version);const plan=structuredClone(quote.document.plans.find(p=>p.id===(allocationId??quote.document.selected_plan.id)));
 if(!plan||selections.length!==plan.packages.length) throw new AccessError(409,'SHIPPING_OPTION_UNAVAILABLE');
 for(const parcel of plan.packages){const choice=selections.find(s=>s.package_id===parcel.id);const rate=parcel.options.find(o=>o.id===choice?.shipping_option_id);
  if(!rate||(plan.payment_method==='cod'&&!rate.supports_cod)||Date.parse(rate.expires_at)<Date.parse(quote.expires_at)) throw new AccessError(409,'SHIPPING_OPTION_UNAVAILABLE');
  parcel.selected_option_id=rate.id;parcel.shipping_amount=rate.shipping_amount;
 }
 plan.shipping_total=plan.packages.reduce((n,p)=>n+p.shipping_amount,0);integer(plan.shipping_total,0,Number.MAX_SAFE_INTEGER);
 const promotions=await previewPromotions(tx,plan,quote.document.customer_key,(await cartClock(tx,cart)).toISOString());const finance=await checkShippingBenefit(tx,plan,parcelBenefits(plan,promotions),quote.document.affiliate_id??null,cart.owner_user_id);
 return persistQuote(tx,actor,key,hash,cart,{...quote.document,selected_plan:plan,promotions,financial_sources:finance.sources},quote,quote.payment_channel??(plan.payment_method==='cod'?'cod':'local-prepaid'));
}
