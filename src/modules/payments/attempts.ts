import {createHash,randomUUID} from 'node:crypto';
import type {TransactionSql} from 'postgres';
import {enqueueJob} from '../../jobs/outbox.ts';
import {AccessError} from '../access/policy.ts';
import {id,invalid,object} from '../catalog/validation.ts';
import {lockInventoryClock} from '../inventory/state.ts';
import type {OrderRow} from '../checkout/orders.ts';

export type AttemptRow={id:string;order_id:string;creation_job_id:string;provider_operation_id:string|null;receipt_id:string|null;status:string;revision:number;expected_amount:string;created_at:string;expires_at:string;request_hash:string};
export async function lockPaymentOrder(tx:TransactionSql,orderId:string){
 const [prior]=await tx<OrderRow[]>`select * from app.commerce_order where id=${id(orderId)}`;if(!prior) throw new AccessError(404,'NOT_FOUND');
 const shipments=await tx`select warehouse_id from app.order_shipment where order_id=${prior.id}`;
 await lockInventoryClock(tx,prior.clock_namespace,shipments.map(s=>s.warehouse_id));
 const [order]=await tx<OrderRow[]>`select * from app.commerce_order where id=${prior.id} for update`;return order;
}
export async function projectAttempt(tx:TransactionSql,orderId:string,attemptId:string){
 const [a]=await tx`select a.*,j.status job_status,o.payment_status order_payment_status,o.status order_status,
   app.reservation_clock(o.clock_namespace)>=a.expires_at overdue from app.payment_attempt a join app.commerce_order o on o.id=a.order_id
   join app.outbox_job j on j.id=a.creation_job_id where a.id=${id(attemptId)} and a.order_id=${id(orderId)}`;
 if(!a) throw new AccessError(404,'NOT_FOUND');
 const status=a.status==='confirmed'?'confirmed':a.status==='unknown'||a.job_status==='unknown'?'unknown':['failed','expired'].includes(a.status)?a.status:a.order_status==='cancelled'||a.overdue?'expired':a.status;
 return {id:a.id as string,order_id:a.order_id as string,status:status as 'pending'|'confirmed'|'unknown'|'expired'|'failed',expires_at:new Date(a.expires_at).toISOString(),action:status==='pending'?{kind:'instructions' as const,display_text:'Simulasi lokal. Tidak ada rekening atau pembayaran nyata.'}:{kind:'none' as const}};
}
// Ownership is checked by the HTTP boundary before entering this domain writer.
export async function createAttempt(tx:TransactionSql,orderId:string,key:string,value:unknown){
 const body=object(value,['method_id']);if(body.method_id!=='local-prepaid'||!/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw invalid();
 const order=await lockPaymentOrder(tx,orderId),hash=createHash('sha256').update(JSON.stringify({method_id:body.method_id})).digest('hex');
 const [prior]=await tx<AttemptRow[]>`select * from app.payment_attempt where order_id=${order.id} and key=${key}`;
 if(prior){if(prior.request_hash!==hash) throw new AccessError(409,'IDEMPOTENCY_CONFLICT');return projectAttempt(tx,order.id,prior.id);}
 const [clock]=await tx`select app.reservation_clock(${order.clock_namespace}) as now`;
 if(order.payment_method!=='prepaid'||order.status!=='pending'||order.payment_status!=='pending'||new Date(order.expires_at)<=new Date(clock.now)) throw new AccessError(409,'PAYMENT_NOT_AVAILABLE');
 if((await tx`select id from app.payment_attempt where order_id=${order.id} and status in ('pending','unknown','confirmed')`).length) throw new AccessError(409,'PAYMENT_ATTEMPT_ACTIVE');
 if((await tx`select count(*)::int n from app.payment_attempt where order_id=${order.id}`)[0].n>=5) throw new AccessError(409,'PAYMENT_ATTEMPT_LIMIT');
 const attemptId=randomUUID(),job=await enqueueJob(tx,'payment.create',`payment-create:${attemptId}`,{attemptId});
 const [attempt]=await tx<AttemptRow[]>`insert into app.payment_attempt (id,order_id,method_id,key,request_hash,creation_job_id,expected_amount,created_at,expires_at)
   values (${attemptId},${order.id},${body.method_id},${key},${hash},${job},${order.buyer_total},${new Date(clock.now).toISOString()},${order.expires_at}) returning *`;
 await advanceAttempt(tx,attempt,{status:'pending',source_type:'request',source_id:job,occurred_at:new Date(clock.now).toISOString()});
 return projectAttempt(tx,order.id,attempt.id);
}
export async function advanceAttempt(tx:TransactionSql,attempt:AttemptRow,event:{status:string;source_type:string;source_id:string;occurred_at:string;provider_operation_id?:string|null;receipt_id?:string|null}){
 const operation=event.provider_operation_id===undefined?attempt.provider_operation_id:event.provider_operation_id,receipt=event.receipt_id===undefined?attempt.receipt_id:event.receipt_id;
 await tx`insert into app.payment_attempt_event (attempt_id,revision,status,source_type,source_id,provider_operation_id,receipt_id,occurred_at)
   values (${attempt.id},${attempt.revision+1},${event.status},${event.source_type},${event.source_id},${operation},${receipt},${event.occurred_at})`;
 await tx`update app.payment_attempt set revision=${attempt.revision+1},status=${event.status},provider_operation_id=${operation},receipt_id=${receipt} where id=${attempt.id}`;
}
