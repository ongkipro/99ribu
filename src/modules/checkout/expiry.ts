import type {TransactionSql} from 'postgres';
import {AccessError} from '../access/policy.ts';
import {id,object} from '../catalog/validation.ts';
import {releaseReservation} from '../inventory/reservations.ts';
import {lockInventoryClock} from '../inventory/state.ts';
import {resolvePromotionReservation} from '../promotions/reservations.ts';
import type {OrderRow} from './orders.ts';
import {readProviderEvents,verifyProviderEvent} from '../payments/local.ts';

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
   for(const source of events.filter(e=>e.status==='confirmed'&&e.amount===Number(order.buyer_total)&&Date.parse(e.occurred_at)<new Date(order.expires_at).getTime())){
    verifyProviderEvent(source);
    if(!(await tx`select event_id from app.payment_event_result where event_id=${source.id}`).length) return {reservationId:resourceId,orderId:order.id,status:'payment_reconciliation',deferMs:30000};
   }
  }
 }
 if(order.promotion_reservation_id) await resolvePromotionReservation(tx,order.promotion_reservation_id,'expired','Pending order expired');
 await releaseReservation(tx,order.stock_reservation_id,'Pending order expired',null,true);
 await tx`insert into app.order_event (order_id,revision,status,payment_status,reason,source_id,created_at) values (${order.id},2,'cancelled','expired','Unfunded checkout deadline passed',${job.id},${clock.now})`;
 await tx`update app.commerce_order set revision=2,status='cancelled',payment_status='expired' where id=${order.id}`;
 return {reservationId:resourceId,orderId:order.id,status:'cancelled',deferMs:null};
}
