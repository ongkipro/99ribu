import {randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {enqueueJob} from '../../jobs/outbox.ts';
import type {LocalAuth} from '../access/auth.ts';
import {AccessError} from '../access/policy.ts';
import {id} from '../catalog/validation.ts';
import {digest,type CommerceActor} from '../checkout/access.ts';
import {financeInstant} from '../finance/ledger.ts';
import {readVisitor,type Visitor} from '../consent/context.ts';
import {currentConsent,type Consent} from '../consent/receipts.ts';
import {LOCAL_PRIVACY_POLICY_VERSION,measurementAllowed,type Platform} from '../consent/choices.ts';
import {receiptUnitIds} from '../finance/receipt-units.ts';

export type EventPayload={currency:'IDR';contents:{id:string;quantity:number;merchandise_amount:number}[];content_ids:string[];action?:string;cart_id?:string;order_id?:string;product_id?:string;variant_id?:string};
export type EventInput={name:string;source_kind:'economic_receipt'|'commerce_operation'|'browser';source_reference:string;occurred_at:string;order_id:string|null;receipt_id:string|null;merchandise_amount:number;payload:EventPayload;visitor:Visitor|null;consent:Consent|null};
export const capturedPurpose=(consent:Consent|null)=>consent!==null&&(consent.choices.analytics==='granted'||(['meta','google','tiktok'] as Platform[]).some(p=>measurementAllowed(consent.choices,p)));
export async function appendCommerceEvent(tx:TransactionSql,input:EventInput,eventId=randomUUID()){
 const occurred=financeInstant(input.occurred_at),hash=digest(JSON.stringify({name:input.name,source_kind:input.source_kind,source_reference:input.source_reference,occurred_at:occurred,order_id:input.order_id,receipt_id:input.receipt_id,merchandise_amount:input.merchandise_amount,payload:input.payload}));
 const [prior]=await tx`select id,request_hash from app.commerce_event where source_kind=${input.source_kind} and source_reference=${input.source_reference}`;
 if(prior){if(prior.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return String(prior.id);}
 id(eventId);
 await tx`insert into app.commerce_event (id,name,source_kind,source_reference,request_hash,visitor_id,consent_receipt_id,order_id,receipt_id,merchandise_amount,payload,occurred_at)
  values (${eventId},${input.name},${input.source_kind},${input.source_reference},${hash},${input.visitor?.id??null},${input.consent?.id??null},${input.order_id},${input.receipt_id},${input.merchandise_amount},${JSON.stringify(input.payload)}::jsonb,${occurred})`;
 const [clock]=await tx`select clock_timestamp() as now`;const now=new Date(clock.now).getTime();
 const expiry=Math.min(Date.parse(occurred)+86400000,input.visitor?new Date(input.visitor.expires_at).getTime():now+86400000,input.consent?new Date(input.consent.expires_at).getTime():now+86400000);
 const eligibleSource=input.name==='Purchase'||(input.source_kind==='commerce_operation'&&input.name==='cart_changed'&&input.payload.contents.length>0&&['cart.create','cart.line.add','cart.line.update'].includes(input.payload.action??''));
 for(const platform of ['meta','google','tiktok'] as Platform[]){
  const visitor=input.visitor,consent=input.consent;
  const allowed=visitor?.status==='active'&&new Date(visitor.expires_at).getTime()>now&&consent!==null&&visitor.current_consent_id===consent.id&&consent.policy_version===LOCAL_PRIVACY_POLICY_VERSION&&new Date(visitor.created_at).getTime()<=Date.parse(occurred)&&new Date(visitor.expires_at).getTime()>Date.parse(occurred)&&new Date(consent.effective_at).getTime()<=Date.parse(occurred)&&new Date(consent.expires_at).getTime()>Math.max(now,Date.parse(occurred))&&measurementAllowed(consent.choices,platform);
  const reason=!eligibleSource||Date.parse(occurred)>now+5000?'source_not_eligible':!allowed?'no_consent':expiry<=now?'expired':'eligible';
  const outboxId=randomUUID(),job=reason==='eligible'?await enqueueJob(tx,'advertising.dispatch',`ad-dispatch:${outboxId}`,{outboxId}):null;
  const [saved]=await tx`insert into app.ad_event_outbox (id,event_id,platform,status,reason,job_id,expires_at) values (${outboxId},${eventId},${platform},${reason==='eligible'?'queued':'suppressed'},${reason},${job},${new Date(expiry).toISOString()}) returning status,reason`;
  if(job&&saved.status==='suppressed') await tx`update app.outbox_job set status='completed',completed_at=clock_timestamp(),result=${JSON.stringify({outbox_id:outboxId,status:'suppressed',reason:saved.reason})}::jsonb where id=${job}`;
 }
 return eventId;
}
export async function recordPurchase(tx:TransactionSql,receiptId:string){
 const [prior]=await tx`select id from app.commerce_event where receipt_id=${id(receiptId)}`;if(prior)return String(prior.id);
 const [receipt]=await tx`select * from app.economic_receipt where id=${receiptId}`;
 if(!receipt)throw new AccessError(409,'PURCHASE_SOURCE_NOT_ELIGIBLE');
 let eligible=false;
 if(receipt.kind==='prepaid')eligible=(await tx`select event_id from app.payment_event_result where receipt_id=${receiptId} and outcome='confirmed'`).length===1;
 else if(receipt.kind==='cod'){const [cod]=await tx`select to_regclass('app.cod_event_result') is not null installed`;if(cod.installed)eligible=(await tx`select event_id from app.cod_event_result where receipt_id=${receiptId} and outcome='collected'`).length===1;}
 if(!eligible)throw new AccessError(409,'PURCHASE_SOURCE_NOT_ELIGIBLE');
 const [attribution]=await tx`select visitor_id from app.order_ad_attribution where order_id=${receipt.order_id} and recorded_at<=${receipt.occurred_at}`;
 const [found]=attribution?await tx<Visitor[]>`select * from app.visitor_session where id=${attribution.visitor_id} for update`:[];
 const choice=found?await currentConsent(tx,found):null;
 const occurred=new Date(receipt.occurred_at).getTime();
 const visitor=found?.status==='active'&&choice&&capturedPurpose(choice)&&new Date(found.created_at).getTime()<=occurred&&new Date(found.expires_at).getTime()>occurred&&new Date(choice.effective_at).getTime()<=occurred&&new Date(choice.expires_at).getTime()>occurred?found:null;
 const consent=visitor?choice:null;
 const funded=receipt.kind==='cod'?await receiptUnitIds(tx,String(receipt.id)):null;
 if(funded&&!funded.length)throw new AccessError(409,'PURCHASE_SOURCE_NOT_ELIGIBLE');
 const items=funded===null?await tx`select i.id,i.quantity,o.catalog_id from app.order_item i join app.offer o on o.id=i.offer_id where i.order_id=${receipt.order_id} order by i.id`:
  await tx`select i.id,count(*)::int quantity,o.catalog_id from app.fulfillment_item f join app.order_item i on i.id=f.order_item_id join app.offer o on o.id=i.offer_id where f.shipment_id=${receipt.shipment_id} and i.order_id=${receipt.order_id} and f.id in ${tx(funded)} group by i.id,o.catalog_id order by i.id`;
 const contents=items.map(i=>({id:String(i.catalog_id),quantity:Number(i.quantity),merchandise_amount:99000*Number(i.quantity)}));
 const event=await appendCommerceEvent(tx,{name:'Purchase',source_kind:'economic_receipt',source_reference:String(receipt.id),occurred_at:new Date(receipt.occurred_at).toISOString(),order_id:String(receipt.order_id),receipt_id:String(receipt.id),merchandise_amount:Number(receipt.merchandise_amount),payload:{currency:'IDR',contents,content_ids:contents.map(i=>i.id)},visitor:visitor??null,consent});
 for(const item of items) await tx`insert into app.purchase_allocation (event_id,order_item_id,quantity,merchandise_amount) values (${event},${item.id},${item.quantity},${99000*Number(item.quantity)})`;
 return event;
}
async function optionalCapture(tx:TransactionSql,run:(inner:TransactionSql)=>Promise<void>){
 // Before the additive signal migration, accepted checkout must keep working.
 const [installed]=await tx`select to_regclass('app.commerce_event') is not null installed`;if(!installed.installed)return;
 try{await tx.savepoint(async inner=>{
  await run(inner);
  await inner`set constraints app.commerce_event_sealed,app.ad_event_outbox_sealed immediate`;
  await inner`set constraints app.commerce_event_sealed,app.ad_event_outbox_sealed deferred`;
 });}catch{
  // No raw cookie/body/contact enters diagnostics. Optional capture can fail
  // without cancelling the user's cart/order; financial Purchase is mandatory.
  console.error(JSON.stringify({event:'optional_signal_capture_failed',code:'SIGNAL_CAPTURE_UNAVAILABLE'}));
 }
}
export async function captureCartMutation(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor,operationId:string){
 await optionalCapture(tx,async inner=>{
  const visitor=await readVisitor(inner,request,identity,actor,false);if(!visitor)return;const consent=await currentConsent(inner,visitor);if(!consent||!capturedPurpose(consent))return;
  const [op]=await inner`select * from app.commerce_operation where id=${operationId}`;
  if(!op||!['cart.create','cart.line.add','cart.line.update','cart.line.remove'].includes(op.action))return;
  if(new Date(consent.effective_at)>new Date(op.created_at))return;
  const [projected]=await inner`select app.signal_operation_payload(${op.id}) payload`;const payload=projected.payload as EventPayload;const contents=payload.contents;
  await appendCommerceEvent(inner,{name:'cart_changed',source_kind:'commerce_operation',source_reference:op.id,occurred_at:new Date(op.created_at).toISOString(),order_id:null,receipt_id:null,merchandise_amount:contents.reduce((n,l)=>n+l.merchandise_amount,0),payload,visitor,consent});
 });
}
export async function captureOrderPlacement(tx:TransactionSql,request:Request,identity:LocalAuth,actor:CommerceActor,orderId:string,operationId:string){
 await optionalCapture(tx,async inner=>{
  const visitor=await readVisitor(inner,request,identity,actor,false);if(!visitor)return;const consent=await currentConsent(inner,visitor);if(!consent||!capturedPurpose(consent))return;
  const [op]=await inner`select created_at from app.commerce_operation where id=${operationId}`;if(!op||new Date(consent.effective_at)>new Date(op.created_at))return;
  await inner`insert into app.order_ad_attribution (order_id,visitor_id,consent_receipt_id) values (${orderId},${visitor.id},${consent.id}) on conflict (order_id) do nothing`;
  await appendCommerceEvent(inner,{name:'order_placed',source_kind:'commerce_operation',source_reference:operationId,occurred_at:new Date(op.created_at).toISOString(),order_id:orderId,receipt_id:null,merchandise_amount:0,payload:{currency:'IDR',order_id:orderId,contents:[],content_ids:[]},visitor,consent});
 });
}
