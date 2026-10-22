import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {id,object} from '../catalog/validation.ts';
import {releaseReservation} from '../inventory/reservations.ts';
import {lockInventoryClock} from '../inventory/state.ts';
import {resolvePromotionReservation} from '../promotions/reservations.ts';
import type {OrderRow} from './orders.ts';
import {readProviderEvents,verifyProviderEvent} from '../payments/local.ts';
import {requestFinalAdvice} from '../payments/autolaris.ts';
import {AUTOLARIS_FINAL_ADVICE_WINDOW_MS,MANUAL_BANK_CONFIRMATION_GRACE_MS} from '../payments/methods.ts';

// Resolve ownership before legacy handlers acquire their reservation headers.
// All three job kinds serialize on clock -> order -> promotions -> stock.
export async function expireOwnedOrderJob(tx:TransactionSql,job:{id:string;kind:string;payload:unknown}){
 const direct=job.kind==='checkout.order.expire';const field=direct?'orderId':'reservationId';const body=object(job.payload,[field]);const resourceId=id(body[field]);
 const [prior]=direct?await tx<OrderRow[]>`select * from app.commerce_order where id=${resourceId}`:job.kind==='promotion.reservation.expire'
  ?await tx<OrderRow[]>`select * from app.commerce_order where promotion_reservation_id=${resourceId}`:await tx<OrderRow[]>`select * from app.commerce_order where stock_reservation_id=${resourceId}`;
 if(!prior){if(direct) throw new AccessError(404,'NOT_FOUND');return null;}
 const shipments=await tx`select warehouse_id from app.order_shipment where order_id=${prior.id}`;
 await lockInventoryClock(tx,prior.clock_namespace,shipments.map(s=>s.warehouse_id));
 const [order]=await tx<OrderRow[]>`select * from app.commerce_order where id=${prior.id} for update`;
 if(order.status!=='pending') return {reservationId:resourceId,orderId:order.id,status:order.status,deferMs:null};
 if(order.payment_status==='confirmed'||order.actionable_at) return {reservationId:resourceId,orderId:order.id,status:order.payment_method==='cod'?'cod_confirmed':'funded',deferMs:null};
 const [clock]=await tx`select app.reservation_clock(${order.clock_namespace})::text as now`;const remaining=new Date(order.expires_at).getTime()-Date.parse(clock.now);
 if(remaining>0) return {reservationId:resourceId,orderId:order.id,status:order.status,deferMs:Math.max(50,Math.min(3600000,remaining))};
 // Nullable actionable_at is introduced atomically with the payment domain.
 // Preserve pre-0016 expiry compatibility during rollback-only migration proof.
 if('actionable_at' in order){
  const waiting=await tx`select a.id,j.status job_status from app.payment_attempt a join app.outbox_job j on j.id=a.creation_job_id where a.order_id=${order.id} and a.status in ('pending','unknown')`;
  for(const attempt of waiting){
   const events=await readProviderEvents(tx,attempt.id);
   const terminal=events.filter(e=>e.status!=='pending');for(const event of terminal) verifyProviderEvent(event);
   if(['processing','unknown'].includes(attempt.job_status)&&terminal.length===0) return {reservationId:resourceId,orderId:order.id,status:'payment_reconciliation',deferMs:30000};
   for(const source of events.filter(e=>e.status==='confirmed'&&e.amount===Number(order.buyer_total)+Number(order.payment_charge_amount??0)&&Date.parse(e.occurred_at)<new Date(order.expires_at).getTime())){
    verifyProviderEvent(source);
    if(!(await tx`select event_id from app.payment_event_result where event_id=${source.id}`).length) return {reservationId:resourceId,orderId:order.id,status:'payment_reconciliation',deferMs:30000};
   }
  }
  // Spec 11 (R4): timeliness is the buyer's payment/transfer time, so do not cancel while an
  // on-time payment may still be learned. Bounded windows; afterwards money becomes recovery.
  const late=Date.parse(clock.now)-new Date(order.expires_at).getTime();
  if(order.payment_channel==='manual-bank'&&late<MANUAL_BANK_CONFIRMATION_GRACE_MS){
   const [open]=await tx`select a.id from app.payment_attempt a left join app.manual_bank_confirmation c on c.attempt_id=a.id where a.order_id=${order.id} and a.method_id='manual-bank' and a.status='pending' and c.attempt_id is null`;
   if(open) return {reservationId:resourceId,orderId:order.id,status:'payment_reconciliation',deferMs:Math.max(50,Math.min(3600000,MANUAL_BANK_CONFIRMATION_GRACE_MS-late))};
  }
  if(order.payment_channel==='autolaris'&&late<AUTOLARIS_FINAL_ADVICE_WINDOW_MS){
   const [live]=await tx`select l.attempt_id from app.autolaris_payment l join app.payment_attempt a on a.id=l.attempt_id join app.local_payment_operation p on p.id=l.operation_id
    where a.order_id=${order.id} and a.status in ('pending','unknown') and p.status='pending' and l.trx_id is not null and l.refusal_code is null`;
   if(live){
    const [seen]=await tx`select classification from app.autolaris_observation where attempt_id=${live.attempt_id} and occurred_at>=${order.expires_at} order by created_at desc,id desc limit 1`;
    // No read since the deadline yet, or the account still reports pending/unknown: read again and wait.
    if(seen?.classification!=='settled'){if(await requestFinalAdvice(tx,String(live.attempt_id)))return {reservationId:resourceId,orderId:order.id,status:'payment_reconciliation',deferMs:30000};}
   }
  }
 }
 if(order.promotion_reservation_id) await resolvePromotionReservation(tx,order.promotion_reservation_id,'expired','Pending order expired');
 await releaseReservation(tx,order.stock_reservation_id,'Pending order expired',null,true);
 await tx`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) values (${order.id},2,'cancelled','expired','Unfunded checkout deadline passed',${job.id},${clock.now})`;
 await tx`update app.commerce_order set revision=2,status='cancelled',payment_status='expired' where id=${order.id}`;
 return {reservationId:resourceId,orderId:order.id,status:'cancelled',deferMs:null};
}
