import type { Sql, TransactionSql } from "postgres";
import { readLocalConfig } from "../config/local.ts";
import { dispatchLocal } from "../modules/integrations/local.ts";
import { expireLeases, type JobAdapter, runLeasedJob } from "./leases.ts";
import { expireReservationJob } from "../modules/inventory/expiry.ts";
import { expirePromotionJob } from "../modules/promotions/reservations.ts";
import { expireOwnedOrderJob } from "../modules/checkout/expiry.ts";
import { AccessError } from "../modules/access/policy.ts";
import {id} from '../modules/catalog/validation.ts';
import {processPaymentEvent} from '../modules/payments/events.ts';
import {processCodEvent} from '../modules/payments/cod.ts';
import {processWaybillEvent,processFulfillmentDeadline,processFulfillmentNotice} from '../modules/fulfillment/worker.ts';
import {processSettlementEvent} from '../modules/finance/settlements/core.ts';
import {processParcelReceipt} from '../modules/returns/receipts.ts';
import {processRefundEvent} from '../modules/returns/worker.ts';
import {processReplacementReceipt} from '../modules/returns/replacement-receipts.ts';
import {processReplacementWaybill} from '../modules/returns/replacement-shipping.ts';
import {processWaybillCancellationEvent} from '../modules/fulfillment/cancellations.ts';

export type DatabaseJob = { id: string; kind: string; payload: unknown; attempts: number; max_attempts: number };

// Shared by the production selector and rollback/crash proof: effect and job
// completion always use the caller's actual database transaction.
export async function processDatabaseJob(tx: TransactionSql, job: DatabaseJob) {
  readLocalConfig(process.env);
  if (job.kind === "local.notification") {
    const error = await dispatchLocal(tx, job.kind, job.payload);
    await tx`update app.outbox_job set status=${error ? "failed" : "completed"},attempts=attempts+1,last_error=${error},completed_at=now() where id=${job.id}`;
    return;
  }
  if (!["inventory.reservation.expire","promotion.reservation.expire","checkout.order.expire","payment.callback","cod.callback","shipping.callback","shipping.cancel.callback","fulfillment.deadline","fulfillment.notice","settlement.callback","parcel.receipt.callback","refund.callback","replacement.shipping.callback","replacement.receipt.callback"].includes(job.kind)) throw new AccessError(400, "INVALID_DATABASE_JOB");
  try {
    const result = await tx.savepoint(async (inner) => {
      if(job.kind==='replacement.shipping.callback'||job.kind==='replacement.receipt.callback'){
        const result=job.kind==='replacement.shipping.callback'?await processReplacementWaybill(inner,job):await processReplacementReceipt(inner,job);
        await inner`update app.outbox_job set status='completed',attempts=attempts+1,last_error=null,completed_at=clock_timestamp(),result=${JSON.stringify(result)}::jsonb where id=${job.id}`;
        await inner`set constraints all immediate`;return null;
      }
      if(['shipping.callback','shipping.cancel.callback','fulfillment.deadline','fulfillment.notice'].includes(job.kind)){
        const result=job.kind==='shipping.cancel.callback'?await processWaybillCancellationEvent(inner,job):job.kind==='shipping.callback'?await processWaybillEvent(inner,job):job.kind==='fulfillment.deadline'?await processFulfillmentDeadline(inner,job):await processFulfillmentNotice(inner,job);
        if('deferMs' in result&&result.deferMs!==null)await inner`update app.outbox_job set run_at=clock_timestamp()+${result.deferMs}*interval '1 millisecond',last_error=null where id=${job.id}`;
        else await inner`update app.outbox_job set status='completed',attempts=attempts+1,last_error=null,completed_at=clock_timestamp(),result=${JSON.stringify(result)}::jsonb where id=${job.id}`;
        await inner`set constraints all immediate`;return null;
      }
      if(job.kind==='payment.callback'||job.kind==='cod.callback'||job.kind==='settlement.callback'||job.kind==='parcel.receipt.callback'||job.kind==='refund.callback'){
        const result=job.kind==='refund.callback'?await processRefundEvent(inner,job):job.kind==='parcel.receipt.callback'?await processParcelReceipt(inner,job):job.kind==='settlement.callback'?await processSettlementEvent(inner,job):job.kind==='cod.callback'?await processCodEvent(inner,job):await processPaymentEvent(inner,job);
        await inner`update app.outbox_job set status='completed',attempts=attempts+1,last_error=null,completed_at=clock_timestamp(),result=${JSON.stringify(result)}::jsonb where id=${job.id}`;
        await inner`set constraints all immediate`;
        return null;
      }
      const owned = await expireOwnedOrderJob(inner,job);
      const outcome = owned ?? (job.kind === "promotion.reservation.expire" ? await expirePromotionJob(inner,job.payload) : await expireReservationJob(inner, job.payload));
      // Check deferred stock invariants before leaving the recoverable savepoint.
      await inner.unsafe(owned
        ? "SET CONSTRAINTS app.stock_movement_applied, app.stock_reservation_sealed, app.promotion_movement_applied, app.promotion_reservation_sealed, app.commerce_order_sealed, app.order_event_applied, app.checkout_stock_hold_sealed, app.checkout_promotion_hold_sealed IMMEDIATE"
        : job.kind === "promotion.reservation.expire"
        ? "SET CONSTRAINTS app.promotion_movement_applied, app.promotion_reservation_sealed IMMEDIATE"
        : "SET CONSTRAINTS app.stock_movement_applied, app.stock_reservation_sealed IMMEDIATE");
      return outcome;
    });
    if(result===null) return;
    if (result.deferMs !== null) {
      await tx`update app.outbox_job set run_at=clock_timestamp()+${result.deferMs}*interval '1 millisecond',last_error=${result.status==='payment_reconciliation'?'PAYMENT_RECONCILIATION_PENDING':null} where id=${job.id}`;
      return;
    }
    await tx`update app.outbox_job set status='completed',attempts=attempts+1,last_error=null,completed_at=clock_timestamp(),
      result=${JSON.stringify({...(job.kind==='checkout.order.expire'?{}:{reservation_id:result.reservationId}),...('orderId' in result?{order_id:result.orderId}:{}),status:result.status})}::jsonb where id=${job.id}`;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const retryable = ["40P01", "55P03", "57014", "PAYMENT_RECONCILIATION_PENDING"].includes(code);
    const attempts = job.attempts + 1; const failed = !retryable || attempts >= job.max_attempts;
    const message = error instanceof AccessError && [400,404].includes(error.status) ? "INVALID_PAYLOAD"
      : retryable ? "TEMPORARY_DATABASE_FAILURE" : job.kind.startsWith('replacement.')?'INVALID_REPLACEMENT_STATE':job.kind==='payment.callback'?'INVALID_PAYMENT_STATE':job.kind==='cod.callback'?'INVALID_COD_STATE':job.kind==='refund.callback'?'INVALID_REFUND_STATE':job.kind==='parcel.receipt.callback'?'INVALID_PARCEL_RECEIPT_STATE':job.kind==='settlement.callback'?'INVALID_SETTLEMENT_STATE':job.kind==='shipping.cancel.callback'?'INVALID_SHIPPING_CANCELLATION_STATE':job.kind==='shipping.callback'?'INVALID_SHIPPING_STATE':job.kind.startsWith('fulfillment.')?'INVALID_FULFILLMENT_STATE':job.kind === "promotion.reservation.expire" ? "INVALID_PROMOTION_STATE" : "INVALID_INVENTORY_STATE";
    const delay = Math.min(60, 2 ** Math.max(0, attempts-1));
    await tx`update app.outbox_job set status=${failed ? "failed" : "pending"},attempts=${attempts},last_error=${message},
      run_at=clock_timestamp()+${delay}*interval '1 second',completed_at=case when ${failed} then clock_timestamp() else null end where id=${job.id}`;
  }
}

export async function runOneJob(sql: Sql, adapters: Readonly<Record<string, JobAdapter>> = {},onlyJobId?:string) {
  readLocalConfig(process.env);
  if(onlyJobId!==undefined) id(onlyJobId);
  await expireLeases(sql,onlyJobId);
  if(Object.keys(adapters).length>0&&Object.keys(adapters).every((k)=>k.startsWith("lease.probe."))) return runLeasedJob(sql,adapters,undefined,onlyJobId);
  const [installed]=await sql`select to_regclass('app.fulfillment_deadline') is not null installed`;
  const fulfillmentDue=installed.installed?sql`(o.kind='fulfillment.deadline' and o.last_error is null and exists (
    select 1 from app.fulfillment_deadline d join app.fulfillment f on f.id=d.fulfillment_id join app.order_shipment s on s.id=f.shipment_id join app.commerce_order r on r.id=s.order_id join app.local_fixture_namespace n on n.name=r.clock_namespace
    where d.id::text=o.payload->>'deadlineId' and (case when o.payload->>'kind'='packing' then d.packing_due_at else d.handover_due_at end)<=n.clock))`:sql`false`;
  const processed = await sql.begin(async (tx) => {
    const [job] = await tx<DatabaseJob[]>`select o.id,o.kind,o.payload,o.attempts,o.max_attempts from app.outbox_job o
      where o.status='pending' and (${onlyJobId??null}::uuid is null or o.id=${onlyJobId??null}::uuid) and o.kind in ('local.notification','inventory.reservation.expire','promotion.reservation.expire','checkout.order.expire','payment.callback','cod.callback','shipping.callback','shipping.cancel.callback','fulfillment.deadline','fulfillment.notice','settlement.callback','parcel.receipt.callback','refund.callback','replacement.shipping.callback','replacement.receipt.callback') and (
        o.run_at<=clock_timestamp() or (o.kind='inventory.reservation.expire' and o.last_error is null and exists (
          select 1 from app.stock_reservation r join app.local_fixture_namespace n on n.name=r.clock_namespace
          where r.id::text=o.payload->>'reservationId' and r.kind='checkout' and r.status='active' and r.expires_at<=n.clock))
        or (o.kind='promotion.reservation.expire' and o.last_error is null and exists (
          select 1 from app.promotion_reservation r join app.local_fixture_namespace n on n.name=r.clock_namespace
          where r.id::text=o.payload->>'reservationId' and r.status='active' and r.expires_at<=n.clock))
        or (o.kind='checkout.order.expire' and o.last_error is null and exists (
          select 1 from app.commerce_order r join app.local_fixture_namespace n on n.name=r.clock_namespace
          where r.id::text=o.payload->>'orderId' and r.status='pending' and r.expires_at<=n.clock)) or ${fulfillmentDue})
      order by o.run_at,o.created_at,o.id for update of o skip locked limit 1`;
    if (!job) return false;
    await processDatabaseJob(tx, job);
    return true;
  });
  return processed || runLeasedJob(sql, adapters,undefined,onlyJobId);
}
