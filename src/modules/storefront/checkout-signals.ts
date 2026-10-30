import type {LocalAuth} from '../access/auth.ts';
import {capturedPurpose} from '../advertising/events.ts';
import {recordFunnel} from '../advertising/funnel.ts';
import {authorizeCart,commerceActor,cookie,lockActor,mac,prefix} from '../checkout/access.ts';
import {assertCartOpen,cartLines} from '../checkout/carts.ts';
import {authorizeOrder} from '../checkout/orders.ts';
import {assertQuoteCurrent,ownedQuote} from '../checkout/quotes.ts';
import {readVisitor} from '../consent/context.ts';
import {currentConsent} from '../consent/receipts.ts';
import {assertCheckoutTransport,readCheckout} from './checkout.ts';
import {orderReceiptRequest} from '../orders/receipt.ts';

const milestones={started:['checkout_started'],contact:['contact_validated','address_validated'],shipping:['shipping_selected','payment_method_selected']} as const;
export type CheckoutMilestone={cart:string;version:number;stage:keyof typeof milestones;quote?:string};

// Observation is optional; the native order/payment paths remain independent.
export async function captureCheckoutMilestones(request:Request,identity:LocalAuth,input:CheckoutMilestone){
 try{
  if(request.method!=='POST')return;
  await assertCheckoutTransport(request,identity);
  if(!cookie(request,`${await prefix(identity)}.visitor`))return;
  if(input.stage==='started'){
   const view=await readCheckout(request,identity);if(view.kind!=='ready'||view.issue||view.cart?.id!==input.cart||view.cart.version!==input.version)return;
  }
  const actor=await commerceActor(request,identity);if(!actor)return;
  await identity.sql.begin(async tx=>{
   await lockActor(tx,actor);const cart=await authorizeCart(tx,request,identity,actor,input.cart);await assertCartOpen(tx,cart,input.version);
   if(!(await cartLines(tx,cart.id)).length)return;
   let acceptedAt:string|null=null;
   if(input.stage!=='started'){
    if(!input.quote)return;
    const {quote}=await ownedQuote(tx,request,identity,actor,input.quote);if(quote.cart_id!==cart.id)return;await assertQuoteCurrent(tx,cart,quote,input.version);
    const [operation]=await tx`select action,created_at from app.commerce_operation where id=${quote.operation_id} and resource_id=${quote.id}`;
    // Single page: a created quote's issued couriers are the buyer's choice when it is ordered unchanged.
    if(!operation||(input.stage==='contact'?operation.action!=='quote.create':!['quote.create','quote.select'].includes(operation.action)))return;acceptedAt=new Date(operation.created_at).toISOString();
   }
   const visitor=await readVisitor(tx,request,identity,actor,false);if(!visitor)return;
   const consent=await currentConsent(tx,visitor);if(!consent||!capturedPurpose(consent))return;
   if(acceptedAt&&new Date(consent.effective_at).getTime()>Date.parse(acceptedAt))return;
   for(const name of milestones[input.stage]){
    const key=await mac(identity,'checkout-milestone',[visitor.id,consent.id,cart.id,input.stage==='started'?String(cart.revision):input.quote as string,name]);
    if((await tx`select id from app.funnel_intake where visitor_id=${visitor.id} and client_event_id=${key}`).length)continue;
    const [clock]=await tx`select clock_timestamp()::text now`;
    await recordFunnel(tx,request,identity,actor,{client_event_id:key,name,occurred_at:acceptedAt??new Date(clock.now).toISOString(),consent_receipt_id:consent.id,product_id:null,variant_id:null,cart_id:cart.id,order_id:null});
   }
  });
 }catch{console.error(JSON.stringify({event:'optional_signal_capture_failed',code:'SIGNAL_CAPTURE_UNAVAILABLE'}));}
}

export async function captureReceiptViewed(request:Request,identity:LocalAuth,orderId:string):Promise<{status:'method_not_allowed'|'visitor_not_ready'|'consent_not_granted'|'recorded'|'duplicate'|'unavailable'}>{
 try{
  if(request.method!=='POST')return {status:'method_not_allowed'};
  const scoped=await orderReceiptRequest(request,identity,orderId);
  if(!cookie(scoped,`${await prefix(identity)}.visitor`))return {status:'visitor_not_ready'};
  const actor=await commerceActor(scoped,identity);
  return await identity.sql.begin(async tx=>{
   if(actor)await lockActor(tx,actor);
   const order=await authorizeOrder(tx,scoped,identity,actor,orderId);
   const visitor=await readVisitor(tx,scoped,identity,actor,false);if(!visitor)return {status:'visitor_not_ready' as const};
   const consent=await currentConsent(tx,visitor);if(!consent||!capturedPurpose(consent))return {status:'consent_not_granted' as const};
   const key=await mac(identity,'receipt-milestone',[visitor.id,consent.id,order.id,'receipt_viewed']);
   if((await tx`select id from app.funnel_intake where visitor_id=${visitor.id} and client_event_id=${key}`).length)return {status:'duplicate' as const};
   const [clock]=await tx`select clock_timestamp()::text now`;
   await recordFunnel(tx,scoped,identity,actor,{client_event_id:key,name:'receipt_viewed',occurred_at:new Date(clock.now).toISOString(),consent_receipt_id:consent.id,product_id:null,variant_id:null,cart_id:null,order_id:order.id});
   return {status:'recorded' as const};
  });
 }catch{console.error(JSON.stringify({event:'optional_signal_capture_failed',code:'SIGNAL_CAPTURE_UNAVAILABLE'}));return {status:'unavailable'};}
}
