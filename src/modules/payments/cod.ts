import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {id,object} from '../catalog/validation.ts';
import {appendFinanceTransaction} from '../finance/ledger.ts';
import {postEconomicReceipt} from '../finance/receipts.ts';
import {recordPurchase} from '../advertising/events.ts';
import {lockPaymentOrder} from './attempts.ts';
import {readCodEvent,verifyCodEvent} from './cod-local.ts';
import {initializeFulfillments} from '../fulfillment/core.ts';
import {openCollectionException} from '../checkout/exceptions/collection-cases.ts';
import {codCollectionBasis} from '../finance/receipt-units.ts';

export async function confirmCodOrder(tx:TransactionSql,orderId:string){
 const order=await lockPaymentOrder(tx,id(orderId));if(order.payment_method!=='cod')throw new AccessError(409,'COD_NOT_APPLICABLE');
 const [prior]=await tx`select * from app.cod_confirmation where order_id=${order.id}`;if(prior){await initializeFulfillments(tx,order.id);return prior;}
 if(order.status!=='pending'||order.payment_status!=='pending'||order.revision!==1)throw new AccessError(409,'COD_CONFIRMATION_NOT_CURRENT');
 const [confirmation]=await tx`insert into app.cod_confirmation (order_id,operation_id,accepted_at) values (${order.id},${order.operation_id},${new Date(order.created_at).toISOString()}) returning *`;
 await tx`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) values (${order.id},2,'pending','cod_due','Server accepted the complete COD checkout',${confirmation.id},${confirmation.accepted_at})`;
 await tx`update app.commerce_order set revision=2,payment_status='cod_due',actionable_at=${confirmation.accepted_at} where id=${order.id}`;await initializeFulfillments(tx,order.id);return confirmation;
}

// Own caller transaction: source registration, original money, state/Purchase
// and completion of this exact callback are sealed by the database worker.
export async function processCodEvent(tx:TransactionSql,job:{id:string;payload:unknown}){
 const input=object(job.payload,['eventId']),eventId=id(input.eventId),[registered]=await tx`select p.*,s.order_id from app.cod_provider_event p join app.order_shipment s on s.id=p.shipment_id where p.id=${eventId} and p.callback_job_id=${job.id}`;
 if(!registered)throw new AccessError(400,'INVALID_COD_JOB');
 const order=await lockPaymentOrder(tx,registered.order_id),source=await readCodEvent(tx,eventId);if(!source)throw new AccessError(400,'INVALID_COD_JOB');const event=verifyCodEvent(source);
 const [exceptions]=await tx`select to_regclass('app.commerce_exception') is not null installed`;
 // New recovery callbacks record original money only. Confirmation already
 // owns physical activation; late funds cannot recreate a retired intent.
 if(!exceptions.installed)await initializeFulfillments(tx,order.id);
 const [prior]=await tx`select outcome from app.cod_event_result where event_id=${eventId}`;if(prior)return {event_id:eventId,outcome:String(prior.outcome)};
 const [confirmation]=await tx`select accepted_at from app.cod_confirmation where order_id=${order.id}`;
 if(!confirmation||order.payment_method!=='cod'||!(exceptions.installed?['pending','processing','partially_completed','cancelled']:['pending','processing']).includes(order.status)||Date.parse(event.occurred_at)<new Date(confirmation.accepted_at).getTime())throw new AccessError(409,'COD_SOURCE_NOT_ELIGIBLE');
 const [shipment]=await tx`select * from app.order_shipment where id=${event.shipment_id} and order_id=${order.id}`;if(!shipment)throw new AccessError(400,'INVALID_COD_JOB');
 let outcome='refused',reason='recipient_refused',receiptId:string|null=null,transactionId:string|null=null;
 if(event.status==='collected'){
  const [previous]=await tx`select * from app.economic_receipt where source='local.cod' and environment=${event.environment} and effect_reference=${event.operation_id}`;
  const [recovery]=await tx`select id from app.finance_transaction where source='local.cod.recovery' and environment=${event.environment} and effect_reference=${event.operation_id}`;
  if(previous||recovery){outcome='duplicate';reason='duplicate_callback';receiptId=previous?.id??null;transactionId=previous?.transaction_id??recovery.id;}
  else{
   const basis=await codCollectionBasis(tx,String(shipment.id),event.operation_id);
   const exact=event.amount===basis.amount&&basis.unit_ids.length>0,[allocated]=await tx`select id from app.economic_receipt where shipment_id=${shipment.id} and kind='cod'`;
   if(exact&&!allocated){
    const [eligibility]=exceptions.installed?await tx`select app.cod_operation_purchase_eligible(${event.operation_id}::uuid) eligible`:[{eligible:true}];
    const receipt=await postEconomicReceipt(tx,{order_id:order.id,shipment_id:shipment.id,source:'local.cod',environment:event.environment,event_id:event.id,effect_reference:event.operation_id,amount:event.amount,occurred_at:event.occurred_at});receiptId=receipt.id;transactionId=receipt.transaction_id;outcome=eligibility.eligible?'collected':'recovery';reason=eligibility.eligible?'verified_collection':'late_collection';
   }else{
    const journal=await appendFinanceTransaction(tx,{kind:'adjustment',source:'local.cod.recovery',environment:event.environment,effect_reference:event.operation_id,order_id:order.id,reason:'Verified COD funds await allocation; no extra merchandise or settlement',occurred_at:event.occurred_at,postings:[{account:'provider_receivable',side:'debit',amount:event.amount},{account:'buyer_funds_liability',side:'credit',amount:event.amount}]});transactionId=journal.id;outcome='recovery';reason=exact?'conflicting_allocation':'amount_mismatch';
   }
  }
 }else{
  const [original]=await tx`select r.event_id from app.cod_event_result r join app.local_cod_event e on e.id=r.event_id where e.operation_id=${event.operation_id} and r.outcome='refused'`;if(original){outcome='duplicate';reason='duplicate_callback';}
 }
 await tx`insert into app.cod_event_result (event_id,outcome,reason,receipt_id,transaction_id) values (${event.id},${outcome},${reason},${receiptId},${transactionId})`;
 if(outcome==='collected'){
  const [progress]=await tx`select (select count(*) from app.cod_event_result r join app.economic_receipt e on e.id=r.receipt_id where e.order_id=${order.id} and r.outcome='collected')::int paid,(select count(*) from app.order_shipment where order_id=${order.id})::int parcels`;
  const [current]=exceptions.installed?await tx`select app.cod_collection_payment_status(${order.id}::uuid) status`:[{status:progress.paid===progress.parcels?'confirmed':'partially_collected'}];
  const status=String(current.status);
  await tx`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) values (${order.id},${order.revision+1},${order.status},${status},'Verified original COD parcel collection',${event.id},${event.occurred_at})`;
  await tx`update app.commerce_order set revision=revision+1,payment_status=${status} where id=${order.id}`;
  await recordPurchase(tx,receiptId as string);
 }
 if(outcome==='recovery'){
  if(exceptions.installed)await openCollectionException(tx,'local.cod',event.id);
 }
 return {event_id:event.id,outcome};
}

export async function projectCodCollections(tx:TransactionSql,orderId:string){
 await lockPaymentOrder(tx,id(orderId));
 const [order]=await tx`select o.*,c.accepted_at from app.commerce_order o join app.cod_confirmation c on c.order_id=o.id where o.id=${id(orderId)}`;if(!order)throw new AccessError(409,'COD_NOT_CONFIRMED');
 const [schema]=await tx`select to_regclass('app.commerce_exception') is not null installed`;
 const collectible=schema.installed?tx`app.cod_current_collection_basis(s.id)`:tx`jsonb_build_object('amount',s.cod_due,'merchandise_amount',s.merchandise_amount,'buyer_shipping',s.buyer_shipping)`;
 const rows=await tx`select s.*,receipt.id receipt_id,receipt.amount collected_amount,receipt.merchandise_amount collected_merchandise,receipt.buyer_shipping collected_shipping,receipt.occurred_at collected_at,${collectible} collectible,
  (select r.outcome from app.cod_event_result r join app.cod_provider_event p on p.id=r.event_id where p.shipment_id=s.id and r.outcome in ('refused','recovery') order by r.recorded_at desc,r.event_id desc limit 1) unresolved,
  exists(select 1 from app.local_cod_operation op join app.local_cod_event e on e.operation_id=op.id where op.shipment_id=s.id and op.status='collected' and not exists(select 1 from app.cod_event_result where event_id=e.id)) awaiting
  from app.order_shipment s left join lateral (select e.* from app.economic_receipt e join app.cod_event_result r on r.receipt_id=e.id and r.outcome='collected' where e.shipment_id=s.id) receipt on true where s.order_id=${order.id} order by s.parcel_id,s.id`;
 return {id:order.id,version:order.revision,confirmed_at:new Date(order.accepted_at).toISOString(),currency:'IDR' as const,buyer_total:Number(order.buyer_total),collected_total:rows.reduce((n,s)=>n+(s.receipt_id?Number(s.collected_amount):0),0),merchandise_collected:rows.reduce((n,s)=>n+(s.receipt_id?Number(s.collected_merchandise):0),0),parcels:rows.map(s=>({id:s.id,status:s.receipt_id?'collected':s.awaiting||s.unresolved==='recovery'?'reconciliation':Number(s.collectible.amount)===0?'cancelled':s.unresolved==='refused'?'refused':'due',amount_due:Number(s.receipt_id?s.collected_amount:s.collectible.amount),merchandise_amount:Number(s.receipt_id?s.collected_merchandise:s.collectible.merchandise_amount),buyer_shipping_amount:Number(s.receipt_id?s.collected_shipping:s.collectible.buyer_shipping),collected_at:s.collected_at?new Date(s.collected_at).toISOString():null,receipt_id:s.receipt_id??null}))};
}
