import {randomInt,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError} from '../access/policy.ts';
import {readRuntimeConfig} from '../../config/runtime.ts';
import {lockRateActor} from '../affiliates/rates.ts';
import {readCatalogRevision} from '../catalog/catalog.ts';
import {id,invalid,object} from '../catalog/validation.ts';
import {reserveOffers} from '../inventory/reservations.ts';
import {lockInventoryClock} from '../inventory/state.ts';
import {reservePromotions} from '../promotions/reservations.ts';
import {clean} from '../shipping/address.ts';
import {checkShippingBenefit} from '../shipping/contribution.ts';
import {enqueueJob} from '../../jobs/outbox.ts';
import {authorizeCart,capability,cookie,digest,lockActor,prefix,type CommerceActor} from './access.ts';
import {cartClock,expectedCartVersion,intentHash,mutationKey,priorOperation,recordOperation} from './carts.ts';
import {assertQuoteCurrent,ownedQuote,parcelBenefits,promotionShipments} from './quotes.ts';
import {captureOrderPlacement} from '../advertising/events.ts';
import {confirmCodOrder} from '../payments/cod.ts';
import {buyerFulfillmentProgress,originalParcelReceiptProgress,originalWaybillProgress} from '../fulfillment/core.ts';
import {buyerReplacementProgress} from '../returns/replacement-core.ts';
import {buyerManualParcel} from '../fulfillment/manual.ts';
import {allocateByWeight,codFee,paymentTerms,PAYMENT_CHANNELS,type PaymentChannel} from '../payments/methods.ts';

export type OrderRow={id:string;operation_id:string;actionable_at?:string|null;number:string;cart_id:string;quote_id:string;owner_user_id:string|null;owner_guest_id:string|null;stock_reservation_id:string;promotion_reservation_id:string|null;payment_method:'prepaid'|'cod';payment_channel:PaymentChannel|null;payment_charge_amount:string;cod_fee_bps:number|null;transfer_code:number|null;payment_policy_version_id:string|null;merchandise_amount:string;shipping_amount:string;subsidy_amount:string;buyer_total:string;buyer_note:string|null;revision:number;status:string;payment_status:string;clock_namespace:string|null;created_at:string;expires_at:string};
export async function projectOrder(tx:TransactionSql,orderId:string){
 const [o]=await tx<OrderRow[]>`select * from app.commerce_order where id=${orderId} for share`;if(!o) throw new AccessError(404,'NOT_FOUND');
 const items=await tx`select i.*,v.catalog_id from app.order_item i join app.offer v on v.id=i.offer_id where i.order_id=${o.id} order by i.line_id`;
 const shipments=await tx`select * from app.order_shipment where order_id=${o.id} order by parcel_id`;
 const [schema]=await tx`select to_regclass('app.refund') is not null returns_installed,to_regclass('app.exception_cancellation') is not null exceptions_installed`;
 const received=schema.returns_installed?tx`receipt.received_at`:tx`null::timestamptz`,receiptJoin=schema.returns_installed?tx`left join app.buyer_receipt receipt on receipt.fulfillment_item_id=f.id`:tx``;
 const cancelled=schema.exceptions_installed?tx`exists(select 1 from app.exception_cancellation cancelled where cancelled.fulfillment_item_id=f.id and cancelled.replacement_link_id is null)`:tx`false`;
 const units=await tx<{id:string;order_item_id:string;shipment_id:string;unit_index:number;received_at:string|null;cancelled:boolean}[]>`select f.*,i.order_id,${received} received_at,${cancelled} cancelled from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id ${receiptJoin} where i.order_id=${o.id} order by f.order_item_id,f.unit_index`;
 const recoveryFacts=schema.exceptions_installed?tx`union select allocation.fulfillment_item_id,'refunded' kind from app.recovery_refund refund join app.recovery_refund_allocation allocation on allocation.refund_id=refund.id where refund.order_id=${o.id} and refund.status='succeeded'`:tx``;
 const facts=schema.returns_installed?await tx`
  select r.fulfillment_item_id,'pending' kind from app.return_case c join app.return_item r on r.case_id=c.id where c.order_id=${o.id} and r.claim_state in ('held','replacing')
  union select r.fulfillment_item_id,'returned' kind from app.return_case c join app.return_event e on e.case_id=c.id join app.return_goods g on g.event_id=e.id join app.return_item r on r.id=g.return_item_id and r.case_id=c.id where c.order_id=${o.id}
  union select i.fulfillment_item_id,'refunded' kind from app.refund r join app.refund_allocation a on a.refund_id=r.id join app.return_item i on i.id=a.return_item_id where r.order_id=${o.id} and r.status='succeeded' ${recoveryFacts}`:[];
 const pending=new Set(facts.filter(row=>row.kind==='pending').map(row=>String(row.fulfillment_item_id))),returned=new Set(facts.filter(row=>row.kind==='returned').map(row=>String(row.fulfillment_item_id))),refunded=new Set(facts.filter(row=>row.kind==='refunded').map(row=>String(row.fulfillment_item_id)));
 const recoveryTotals=schema.exceptions_installed?tx`union all select amount,status from app.recovery_refund where order_id=${o.id}`:tx``;
 const [refundTotals]=schema.returns_installed?await tx`select coalesce(sum(amount) filter(where status='succeeded'),0)::text confirmed,coalesce(sum(amount) filter(where status<>'succeeded'),0)::text pending
  from (select amount,status from app.refund where order_id=${o.id} ${recoveryTotals}) refunds`:[{confirmed:'0',pending:'0'}];
 const progress=await buyerFulfillmentProgress(tx,o.id),replacements=await buyerReplacementProgress(tx,o.id);
 // S91: a manually booked parcel shows its operator-entered courier and resi.
 const manualParcels=new Map<string,NonNullable<Awaited<ReturnType<typeof buyerManualParcel>>>>();for(const s of shipments){const manual=await buyerManualParcel(tx,s.id);if(manual)manualParcels.set(s.id,manual);}
 return {id:o.id,number:o.number,status:o.status,payment_status:o.payment_status,payment_method:o.payment_method,currency:'IDR',version:o.revision,created_at:new Date(o.created_at).toISOString(),expires_at:new Date(o.expires_at).toISOString(),
  merchandise_total:Number(o.merchandise_amount),shipping_total:Number(o.shipping_amount),subsidy_total:Number(o.subsidy_amount),buyer_total:Number(o.buyer_total),payment_channel:o.payment_channel??(o.payment_method==='cod'?'cod':'local-prepaid'),payment_channel_label:PAYMENT_CHANNELS[o.payment_channel??(o.payment_method==='cod'?'cod':'local-prepaid')].label,payment_charge_total:Number(o.payment_charge_amount??0),...(o.payment_method==='cod'?{cod_fee_bps:o.cod_fee_bps??0}:{}),amount_due:Number(o.buyer_total)+Number(o.payment_charge_amount??0),refund_total:Number(refundTotals.confirmed),pending_refund_total:Number(refundTotals.pending),
  ...(progress.notices.length?{fulfillment_notices:progress.notices}:{}),
  items:items.map(i=>{const original=units.filter(unit=>unit.order_item_id===i.id);return {id:i.id,variant_id:i.offer_id,catalog_id:i.catalog_id,name:i.snapshot.name,variant_label:i.snapshot.offer.label,offer_kind:i.snapshot.offer.offer_kind,contents:i.snapshot.offer.contents,quantity:i.quantity,unit_price:99000,subtotal:99000*i.quantity,cancelled_quantity:original.filter(unit=>unit.cancelled).length,received_quantity:original.filter(unit=>unit.received_at!==null).length,returned_quantity:original.filter(unit=>returned.has(unit.id)).length,refunded_quantity:original.filter(unit=>refunded.has(unit.id)).length,return_pending_quantity:original.filter(unit=>pending.has(unit.id)).length};}),
  shipments:[...shipments.map(s=>{const rate=s.snapshot.options.find((r:{id:string})=>r.id===s.snapshot.selected_option_id),parcel=progress.parcels.find(p=>p.shipment_id===s.id),waybill=originalWaybillProgress(parcel),original=units.filter(unit=>unit.shipment_id===s.id),receipt=originalParcelReceiptProgress(original),delivered=receipt.delivered_at!==null;return {id:s.id,kind:'original',origin_city:s.snapshot.origin_city,received_quantity:receipt.received_quantity,status:delivered?'delivered':receipt.active_received_quantity?'partially_delivered':parcel?.handover_at?'handed_over':receipt.active_quantity===0||o.status==='cancelled'?'cancelled':waybill.status,courier_name:manualParcels.get(s.id)?.courier_name??rate.courier_name,service_name:rate.service_name,
   ...(delivered?{delivered_at:receipt.delivered_at as string}:{}),
   ...(waybill.tracking_number&&parcel?.waybill_issued_at?{tracking_number:waybill.tracking_number,waybill_issued_at:new Date(parcel.waybill_issued_at).toISOString()}:{}),
   ...(manualParcels.get(s.id)&&parcel?.waybill_issued_at?{tracking_number:manualParcels.get(s.id)?.tracking_number as string,waybill_issued_at:new Date(parcel.waybill_issued_at).toISOString(),...(manualParcels.get(s.id)?.tracking_status?{tracking_status:manualParcels.get(s.id)?.tracking_status as string}:{})}:{}),
   items:units.filter(f=>f.shipment_id===s.id).map(f=>({order_item_id:f.order_item_id,fulfillment_item_id:f.id,quantity:1,cancelled:Boolean(f.cancelled)})),buyer_shipping_amount:Number(s.buyer_shipping),...(o.payment_method==='cod'?{cod_collect_amount:Number(s.cod_due),cod_fee_amount:Number(s.payment_charge??0)}:{})};}),...replacements]};
}
// Match the financial guard: allocate each parcel to lines by largest remainder,
// then give the integer remainder to original unit indexes within that line.
export function unitMoney(amount:number,lines:readonly {line_id:string;quantity:number}[]){
 const total=lines.reduce((n,l)=>n+BigInt(l.quantity),0n);const shares=lines.map(l=>({...l,amount:BigInt(amount)*BigInt(l.quantity)/total,remainder:BigInt(amount)*BigInt(l.quantity)%total}));
 let extra=BigInt(amount)-shares.reduce((n,l)=>n+l.amount,0n);
 shares.sort((a,b)=>a.remainder===b.remainder?a.line_id<b.line_id?-1:a.line_id>b.line_id?1:0:a.remainder>b.remainder?-1:1);
 for(const share of shares) if(extra>0n){share.amount++;extra--;}
 return new Map(shares.map(l=>[l.line_id,Array.from({length:l.quantity},(_,n)=>Number(l.amount/BigInt(l.quantity)+(BigInt(n)<l.amount%BigInt(l.quantity)?1n:0n)))]));
}
// R4 (S92 finding 3): open manual-bank orders per buyer, and transfer codes kept free.
export const MANUAL_BANK_OPEN_PER_ACTOR=2,MANUAL_BANK_CODE_RESERVE=99;
// S104: a code stays reserved while its order is open and for 72 hours after the order's deadline, so a
// late or duplicate transfer of an expired/paid order's exact amount never matches a newer order. Callers
// hold the transfer-code advisory lock (selection is serialized); `now` is the cart's business clock.
export const TRANSFER_CODE_QUARANTINE_HOURS=72;
export async function reservedTransferCodes(tx:TransactionSql,now:Date){
 const rows=await tx`select transfer_code from app.commerce_order where payment_channel='manual-bank' and status='pending' and payment_status='pending'
  union select transfer_code from app.commerce_order where payment_channel='manual-bank' and expires_at>${now.toISOString()}::timestamptz-make_interval(hours=>${TRANSFER_CODE_QUARANTINE_HOURS})`;
 return new Set(rows.map(r=>Number(r.transfer_code)));
}
export async function submitOrder(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor,value:unknown){
 // Production has no issued payment/shipping provider yet (OD-7): every order entry point stays closed.
 if(readRuntimeConfig(process.env).profile==='production')throw new AccessError(503,'CHECKOUT_CLOSED');
 const body=object(value,['quote_id','buyer_note']);const quoteId=id(body.quote_id);const buyerNote=body.buyer_note===undefined?null:clean(body.buyer_note,500);
 const version=expectedCartVersion(request),key=mutationKey(request),hash=await intentHash(identity,'order.create',{quoteId,buyerNote,version});
 const [before]=await tx`select document->>'affiliate_id' affiliate_id from app.checkout_quote where id=${quoteId}`;
 await lockRateActor(tx,actor,before?.affiliate_id??null);const {cart,quote}=await ownedQuote(tx,request,identity,actor,quoteId);
 const prior=await priorOperation(tx,actor,key,'order.create',hash);
 if(prior){const [order]=await tx<OrderRow[]>`select * from app.commerce_order where id=${prior.resource_id} and cart_id=${cart.id}`;if(!order) throw new AccessError(404,'NOT_FOUND');return {order,response:{order:await projectOrder(tx,order.id)},transport:cart.transport};}
 await assertQuoteCurrent(tx,cart,quote,version);const document=quote.document,plan=document.selected_plan;
 const origins=[...new Set(plan.packages.map(p=>p.warehouse_id))].sort();await lockInventoryClock(tx,cart.clock_namespace,origins);
 if((await tx`select id from app.warehouse where id in ${tx(origins)} and active order by id for share`).length!==origins.length) throw new AccessError(409,'WAREHOUSE_UNAVAILABLE');
 const financial=await checkShippingBenefit(tx,plan,parcelBenefits(plan,document.promotions),document.affiliate_id??null,cart.owner_user_id);
 if(!isDeepStrictEqual(financial.sources,document.financial_sources)) throw new AccessError(409,'FINANCIAL_REVIEW_REQUIRED');
 const promotionIds=document.promotions.map(a=>a.promotion_id).sort();
 if(promotionIds.length){
  await tx`select id from app.promotion where id in ${tx(promotionIds)} order by id for update`;
  const current=await tx`select v.id,v.promotion_id from app.promotion p join app.promotion_version v on v.promotion_id=p.id and v.revision=p.configuration_revision where p.id in ${tx(promotionIds)}`;
  if(document.promotions.some(a=>!current.some(v=>v.promotion_id===a.promotion_id&&v.id===a.version_id))) throw new AccessError(409,'PROMOTION_REVIEW_REQUIRED');
 }
 const now=await cartClock(tx,cart);if(Date.parse(quote.expires_at)<=now.getTime()) throw new AccessError(409,'QUOTE_EXPIRED');
 // DEC-008: manual bank transfer keeps the order and its holds for 24 hours; other channels 30 minutes.
 const channel:PaymentChannel=quote.payment_channel??(plan.payment_method==='cod'?'cod':'local-prepaid');
 const expires=new Date(now.getTime()+(channel==='manual-bank'?86400000:1800000)).toISOString(),orderId=randomUUID(),operationId=randomUUID();
 let transferCode:number|null=null,termsVersion:string|null=null;
 if(channel==='manual-bank'){
  const terms=await paymentTerms(tx,now);if(!terms.version_id||!terms.manual_bank_accounts.length)throw new AccessError(409,'MANUAL_BANK_UNAVAILABLE');termsVersion=terms.version_id;
  // R4: a 24-hour hold is capped per buyer (guest context or account; the actor is locked above).
  const [mine]=await tx`select count(*)::int n from app.commerce_order where payment_channel='manual-bank' and status='pending' and payment_status='pending' and (owner_user_id=${actor.kind==='user'?actor.id:null} or owner_guest_id=${actor.kind==='guest'?actor.id:null}::uuid)`;
  if(mine.n>=MANUAL_BANK_OPEN_PER_ACTOR)throw new AccessError(409,'MANUAL_BANK_OPEN_LIMIT');
  // Unique among open and recently closed manual-bank orders (reservedTransferCodes) so a bank statement amount identifies one order. Code
  // selection is serialized, and a reserve keeps the space from running out under load.
  await tx`select pg_advisory_xact_lock(hashtextextended('99ribu:manual-bank-transfer-codes',0))`;
  const used=await reservedTransferCodes(tx,now);
  const free=Array.from({length:999},(_,n)=>n+1).filter(code=>!used.has(code));if(free.length<=MANUAL_BANK_CODE_RESERVE)throw new AccessError(409,'MANUAL_BANK_BUSY');
  transferCode=free[randomInt(free.length)];
 }
 let promotionReservationId:string|null=null;
 if(promotionIds.length){
  const reserved=await reservePromotions(tx,{key:`checkout:${orderId}`,customer_key:document.customer_key,promotion_ids:promotionIds,payment_method:plan.payment_method,lines:plan.lines.map(l=>({line_id:l.line_id,product_id:l.product_id,product_revision:l.product_revision,offer_id:l.offer_id,quantity:l.quantity})),shipments:promotionShipments(plan),expires_at:expires,clock_namespace:cart.clock_namespace,actor_id:actor.kind==='user'?actor.id:null});
  if(!isDeepStrictEqual(reserved.allocations,document.promotions)) throw new AccessError(409,'PROMOTION_REVIEW_REQUIRED');promotionReservationId=reserved.id;
 }
 const purchased=new Map<string,{id:string;snapshot:unknown;contents:{stock_item_id:string;name:string;quantity:number}[]}>();
 for(const line of plan.lines){const revision=await readCatalogRevision(tx,line.product_id,line.product_revision);const offer=revision.variants.find(v=>v.id===line.offer_id);if(!offer) throw new AccessError(503,'ORDER_INVALID');
  purchased.set(line.line_id,{id:randomUUID(),contents:offer.contents,snapshot:{name:revision.name,offer:{label:offer.label,offer_kind:offer.offer_kind,attributes:offer.attributes,contents:offer.contents}}});
 }
 const counts=new Map<string,number>();const benefits=parcelBenefits(plan,document.promotions);
 const shipments=plan.packages.map(parcel=>{
  const subsidy=benefits.find(a=>a.shipment_id===parcel.id)?.amount??0;const net=parcel.shipping_amount-subsidy;
  const subsidyShares=unitMoney(subsidy,parcel.lines),netShares=unitMoney(net,parcel.lines);
  return {id:randomUUID(),parcel,subsidy,net,charge:0,units:parcel.lines.flatMap(l=>Array.from({length:l.quantity},(_,n)=>{const index=(counts.get(l.line_id)??0)+1;counts.set(l.line_id,index);
   return {id:randomUUID(),line_id:l.line_id,unit_index:index,subsidy:subsidyShares.get(l.line_id)?.[n]??0,buyer_shipping:netShares.get(l.line_id)?.[n]??0,payment_charge:0};}))};
 });
 // DEC-009/DEC-008 buyer-paid payment charge: the COD fee per parcel, or the transfer code
 // order-wide, frozen per unit by stable largest remainder over unit price + shipping share.
 const allocateCharge=(total:number,units:{id:string;buyer_shipping:number;payment_charge:number}[])=>{const shares=allocateByWeight(total,units.map(u=>({id:u.id,weight:99000+u.buyer_shipping})));for(const u of units)u.payment_charge=shares.get(u.id)??0;};
 if(plan.payment_method==='cod')for(const shipment of shipments){shipment.charge=codFee(shipment.parcel.merchandise_amount+shipment.net,quote.cod_fee_bps??0);allocateCharge(shipment.charge,shipment.units);}
 if(transferCode!==null){allocateCharge(transferCode,shipments.flatMap(s=>s.units));for(const shipment of shipments)shipment.charge=shipment.units.reduce((n,u)=>n+u.payment_charge,0);}
 const paymentCharge=shipments.reduce((n,s)=>n+s.charge,0);
 const stock=await reserveOffers(tx,{key:`checkout:${orderId}`,lines:shipments.flatMap(s=>s.units.map(unit=>{const line=plan.lines.find(l=>l.line_id===unit.line_id);if(!line) throw invalid();return {line_id:unit.id,product_id:line.product_id,product_revision:line.product_revision,offer_id:line.offer_id,warehouse_id:s.parcel.warehouse_id,quantity:1};})),expires_at:expires,clock_namespace:cart.clock_namespace,actor_id:actor.kind==='user'?actor.id:null});
 const [order]=await tx<OrderRow[]>`insert into app.commerce_order (id,number,cart_id,quote_id,owner_user_id,owner_guest_id,stock_reservation_id,promotion_reservation_id,operation_id,payment_method,merchandise_amount,shipping_amount,subsidy_amount,buyer_total,buyer_note,clock_namespace,created_at,expires_at,payment_channel,payment_charge_amount,cod_fee_bps,transfer_code,payment_policy_version_id)
  values (${orderId},${`99-${orderId.replaceAll('-','').slice(0,16).toUpperCase()}`},${cart.id},${quote.id},${cart.owner_user_id},${cart.owner_guest_id},${stock.header.id},${promotionReservationId},${operationId},${quote.payment_method},${quote.merchandise_amount},${quote.shipping_amount},${quote.subsidy_amount},${quote.buyer_total},${buyerNote},${cart.clock_namespace},${now.toISOString()},${expires},${channel},${paymentCharge},${quote.cod_fee_bps??null},${transferCode},${termsVersion}) returning *`;
 for(const line of plan.lines){const item=purchased.get(line.line_id);if(!item) throw invalid();await tx`insert into app.order_item (id,order_id,line_id,product_id,product_revision,offer_id,publication_id,quantity,snapshot) values (${item.id},${order.id},${line.line_id},${line.product_id},${line.product_revision},${line.offer_id},${line.publication_id},${line.quantity},${JSON.stringify(item.snapshot)}::jsonb)`;}
 const remaining=stock.components.map(c=>({balance_id:String(c.balance_id),warehouse_id:String(c.warehouse_id),stock_item_id:String(c.stock_item_id),remaining:Number(c.quantity)}));
 for(const shipment of shipments){const p=shipment.parcel;
  await tx`insert into app.order_shipment (id,order_id,parcel_id,warehouse_id,merchandise_amount,shipping_amount,subsidy_amount,buyer_shipping,cod_due,snapshot,payment_charge)
   values (${shipment.id},${order.id},${p.id},${p.warehouse_id},${p.merchandise_amount},${p.shipping_amount},${shipment.subsidy},${shipment.net},${order.payment_method==='cod'?p.merchandise_amount+shipment.net+shipment.charge:0},${JSON.stringify(p)}::jsonb,${shipment.charge})`;
  for(const unit of shipment.units){const item=purchased.get(unit.line_id);const line=plan.lines.find(l=>l.line_id===unit.line_id);if(!item||!line) throw invalid();
   await tx`insert into app.fulfillment_item (id,order_item_id,shipment_id,unit_index,buyer_shipping,subsidy_amount,payment_charge) values (${unit.id},${item.id},${shipment.id},${unit.unit_index},${unit.buyer_shipping},${unit.subsidy},${unit.payment_charge})`;
   const components=item.contents;
   for(const component of components){let quantity=component.quantity;
    for(const balance of remaining.filter(b=>b.warehouse_id===p.warehouse_id&&b.stock_item_id===component.stock_item_id&&b.remaining>0)){
     const take=Math.min(quantity,balance.remaining);if(take>0) await tx`insert into app.fulfillment_component_allocation (fulfillment_item_id,balance_id,stock_item_id,quantity) values (${unit.id},${balance.balance_id},${component.stock_item_id},${take})`;
     balance.remaining-=take;quantity-=take;if(!quantity) break;
    }if(quantity) throw new AccessError(503,'ORDER_ALLOCATION_INVALID');
   }
  }
 }
 if(remaining.some(b=>b.remaining)) throw new AccessError(503,'ORDER_ALLOCATION_INVALID');
 if(actor.kind==='guest'){
  const [wall]=await tx`select clock_timestamp() as now`;const issued=new Date(wall.now).toISOString();const token=await capability(identity,'order',order.id,actor.id,issued);
  await tx`insert into app.order_access (order_id,guest_id,digest,issued_at,expires_at) values (${order.id},${actor.id},${digest(token)},${issued},${new Date(Date.parse(issued)+604800000).toISOString()})`;
 }
 // Re-evaluate after every promotion/balance wait and snapshot insert: an
 // already-scheduled cost may become effective without a writer changing a row.
 await lockActor(tx,actor);await authorizeCart(tx,request,identity,actor,cart.id);await assertQuoteCurrent(tx,cart,quote,version);
 const acceptedFinancial=await checkShippingBenefit(tx,plan,parcelBenefits(plan,document.promotions),document.affiliate_id??null,cart.owner_user_id);
 if(!isDeepStrictEqual(acceptedFinancial.sources,document.financial_sources)) throw new AccessError(409,'FINANCIAL_REVIEW_REQUIRED');
 await tx`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) values (${order.id},1,'pending','pending','Buyer submitted the frozen checkout',${operationId},${now.toISOString()})`;
 await tx`update app.commerce_order set revision=1,status='pending' where id=${order.id}`;
 await tx`update app.cart set state='submitted',submitted_order_id=${order.id} where id=${cart.id}`;
 if(order.payment_method==='cod'){const [cod]=await tx`select to_regclass('app.cod_confirmation') is not null installed`;if(cod.installed)await confirmCodOrder(tx,order.id);}
 const response={order:await projectOrder(tx,order.id)};await recordOperation(tx,actor,key,'order.create',hash,order.id,response,operationId);
 await captureOrderPlacement(tx,request,identity,actor,order.id,operationId);
 const job=await enqueueJob(tx,'checkout.order.expire',`order-expire:${order.id}`,{orderId:order.id});
 if(cart.clock_namespace) await tx`update app.outbox_job set run_at=clock_timestamp()+${channel==='manual-bank'?'24 hours':'30 minutes'}::interval where id=${job}`;
 else await tx`update app.outbox_job set run_at=${expires} where id=${job}`;
 return {order:{...order,revision:response.order.version,status:'pending'},response,transport:cart.transport};
}
export async function authorizeOrder(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor|null,orderId:string){
 if(request.headers.has('x-cart-token')) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
 const [order]=await tx<OrderRow[]>`select * from app.commerce_order where id=${id(orderId)}`;if(!order) throw new AccessError(404,'NOT_FOUND');
 if(actor?.kind==='user'){await lockActor(tx,actor);if(order.owner_user_id!==actor.id) throw new AccessError(404,'NOT_FOUND');return order;}
 const [access]=await tx`select a.*,c.transport from app.order_access a join app.cart c on c.id=${order.cart_id} where a.order_id=${order.id}`;
 if(!access) throw new AccessError(401,'UNAUTHENTICATED');
 const guest:CommerceActor={kind:'guest',id:access.guest_id};await lockActor(tx,guest);
 const pointer=cookie(request,`${await prefix(identity)}.order_access`),header=request.headers.get('x-order-token');
 if(header&&pointer) throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
 const token=access.transport==='header'?header:pointer?.startsWith(`${order.id}.`)?pointer.slice(37):null;
 const [wall]=await tx`select clock_timestamp() as now`;
 if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token)||digest(token)!==access.digest||access.revoked_at||new Date(access.expires_at)<=new Date(wall.now)||(access.transport==='browser'&&(actor?.kind!=='guest'||actor.id!==guest.id))) throw new AccessError(401,'UNAUTHENTICATED');return order;
}
