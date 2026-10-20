import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError} from '../access/policy.ts';
import {id,invalid,object} from '../catalog/validation.ts';
import {authorizeCart,lockActor,type CartRow,type CommerceActor} from '../checkout/access.ts';
import {intentHash} from '../checkout/carts.ts';
import {authorizeOrder} from '../checkout/orders.ts';
import {lockPaymentOrder} from '../payments/attempts.ts';
import {publicProduct} from '../storefront/catalog.ts';
import {readVisitor,visitorRate} from '../consent/context.ts';
import {currentConsent} from '../consent/receipts.ts';
import {appendCommerceEvent,capturedPurpose,type EventPayload} from './events.ts';

const names=['product_viewed','offer_selected','cart_changed','checkout_started','contact_validated','address_validated','shipping_selected','payment_method_selected','order_placed','receipt_viewed'];
function occurrence(value:unknown){
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value))throw invalid();
 const day=new Date(`${value.slice(0,10)}T00:00:00.000Z`),instant=new Date(value);
 if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value.slice(0,10)||!Number.isFinite(instant.getTime()))throw invalid();return instant.toISOString();
}
export function funnelInput(value:unknown,key:string,pathOrderId?:string){
 const body=object(value,['client_event_id','name','occurred_at','consent_receipt_id','product_id','variant_id','cart_id','order_id']);
 if(typeof body.client_event_id!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(body.client_event_id)||key!==body.client_event_id||typeof body.name!=='string'||!names.includes(body.name))throw invalid();
 const orderId=body.order_id===undefined?null:id(body.order_id),pathId=pathOrderId===undefined?null:id(pathOrderId);if(pathId&&orderId&&pathId!==orderId)throw invalid();
 return {client_event_id:body.client_event_id,name:body.name,occurred_at:occurrence(body.occurred_at),consent_receipt_id:id(body.consent_receipt_id),product_id:body.product_id===undefined?null:id(body.product_id),variant_id:body.variant_id===undefined?null:id(body.variant_id),cart_id:body.cart_id===undefined?null:id(body.cart_id),order_id:pathId??orderId};
}
const acknowledge=(row:{id:string;recorded_at:string})=>({id:row.id,version:1,status:'accepted' as const,as_of:new Date(row.recorded_at).toISOString()});
export async function recordFunnel(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor|null,input:ReturnType<typeof funnelInput>){
 if(actor)await lockActor(tx,actor);
 let order:Awaited<ReturnType<typeof authorizeOrder>>|null=null,cart:CartRow|null=null;
 if(input.order_id){const authorized=await authorizeOrder(tx,request,identity,actor,input.order_id);order=await lockPaymentOrder(tx,authorized.id);}
 if(input.cart_id){
  if(order){if(order.cart_id!==input.cart_id)throw new AccessError(404,'NOT_FOUND');[cart]=await tx<CartRow[]>`select * from app.cart where id=${order.cart_id}`;}
  else{if(!actor)throw new AccessError(401,'UNAUTHENTICATED');cart=await authorizeCart(tx,request,identity,actor,input.cart_id);}
 }
 if(!order&&!cart&&(request.headers.has('x-order-token')||request.headers.has('x-cart-token')))throw new AccessError(401,'UNSUPPORTED_AUTH_TRANSPORT');
 const visitor=await readVisitor(tx,request,identity,actor);if(!visitor)throw new AccessError(401,'VISITOR_CONTEXT_REQUIRED');await visitorRate(tx,`visitor-purpose:${visitor.id}`);
 const hash=await intentHash(identity,'funnel.observe',input),[prior]=await tx`select id,request_hash,recorded_at from app.funnel_intake where visitor_id=${visitor.id} and client_event_id=${input.client_event_id}`;
 if(prior){if(prior.request_hash!==hash)throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return acknowledge(prior as {id:string;recorded_at:string});}
 if(input.product_id||input.variant_id){
  let productId=input.product_id;
  if(!productId&&input.variant_id){const [offer]=await tx`select product_id from app.offer where id=${input.variant_id}`;productId=offer?.product_id??null;}
  if(!productId)throw new AccessError(404,'NOT_FOUND');const product=await publicProduct(tx,productId);
  if(!product||(input.variant_id&&!product.variants.some(v=>v.id===input.variant_id)))throw new AccessError(404,'NOT_FOUND');
 }
 if(['product_viewed','offer_selected'].includes(input.name)&&!input.product_id)throw invalid();if(input.name==='offer_selected'&&!input.variant_id)throw invalid();
 if(['cart_changed','checkout_started'].includes(input.name)&&!cart)throw invalid();
 if(['order_placed','receipt_viewed'].includes(input.name)&&!order)throw invalid();
 if(['contact_validated','address_validated','shipping_selected','payment_method_selected'].includes(input.name)){
  const quoteId=order?.quote_id??cart?.active_quote_id;if(!quoteId)throw new AccessError(409,'MILESTONE_NOT_CURRENT');
  const [quote]=await tx`select id,cart_id,cart_revision,expires_at,(document ? 'contact') contact_ready,(document ? 'address') address_ready,(document ? 'selected_plan') selection_ready from app.checkout_quote where id=${quoteId}`;
  const namespace=order?.clock_namespace??cart?.clock_namespace??null,[clock]=await tx`select app.reservation_clock(${namespace}) as now`;
  if(!quote?.contact_ready||!quote.address_ready||!quote.selection_ready||(order?(order.status!=='pending'||order.payment_status!=='pending'||new Date(order.expires_at)<=new Date(clock.now)):(cart?.state!=='open'||quote.cart_revision!==cart.revision||new Date(quote.expires_at)<=new Date(clock.now))))throw new AccessError(409,'MILESTONE_NOT_CURRENT');
 }
 const consent=await currentConsent(tx,visitor);if(!consent||consent.id!==input.consent_receipt_id)throw new AccessError(409,'CONSENT_VERSION_CONFLICT');
 const [wall]=await tx`select clock_timestamp() as now`;const at=Date.parse(input.occurred_at),now=new Date(wall.now).getTime();
 if(Math.abs(at-now)>300000||new Date(consent.effective_at).getTime()>at||new Date(consent.expires_at).getTime()<=at)throw new AccessError(409,'OBSERVATION_NOT_CURRENT');
 const intakeId=randomUUID(),eventId=capturedPurpose(consent)?randomUUID():null;
 const [intake]=await tx`insert into app.funnel_intake (id,visitor_id,client_event_id,request_hash,consent_receipt_id,event_id) values (${intakeId},${visitor.id},${input.client_event_id},${hash},${consent.id},${eventId}) returning id,recorded_at`;
 if(eventId){
  const payload:EventPayload={currency:'IDR',contents:[],content_ids:[],...(input.product_id?{product_id:input.product_id}:{}),...(input.variant_id?{variant_id:input.variant_id}:{}),...(input.cart_id?{cart_id:input.cart_id}:{}),...(input.order_id?{order_id:input.order_id}:{})};
  await appendCommerceEvent(tx,{name:input.name,source_kind:'browser',source_reference:intakeId,occurred_at:input.occurred_at,order_id:input.order_id,receipt_id:null,merchandise_amount:0,payload,visitor,consent},eventId);
 }
 return acknowledge(intake as {id:string;recorded_at:string});
}
