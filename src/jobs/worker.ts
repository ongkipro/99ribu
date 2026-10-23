import type { Sql, TransactionSql } from "postgres";
import { readRuntimeConfig } from "../config/runtime.ts";
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
import {processRecoveryRefundEvent} from '../modules/checkout/exceptions/refund-callback.ts';
import {processReplacementReceipt} from '../modules/returns/replacement-receipts.ts';
import {processReplacementWaybill} from '../modules/returns/replacement-shipping.ts';
import {processWaybillCancellationEvent} from '../modules/fulfillment/cancellations.ts';
import {COMMISSION_JOB_KINDS,processCommissionJob} from '../modules/commissions/jobs.ts';
import {processTrackingPoll} from '../modules/fulfillment/manual.ts';
import {processCodRemittanceMatch} from '../modules/finance/cod-remittance.ts';
import { guestCleanup, RETENTION_JOBS } from "./retention.ts";

export type DatabaseJob = { id: string; kind: string; payload: unknown; attempts: number; max_attempts: number };

type Expiry = { reservationId: string; status: string; deferMs: number | null; orderId?: string };
// complete: always complete with the handler result; defer: a non-null deferMs
// reschedules instead; expiry: order ownership is resolved first, `constraints`
// are sealed for unowned reservations and the outcome is written after the savepoint.
type DatabaseJobDefinition = { error: string } & (
  | { seal: "complete" | "defer"; run: (tx: TransactionSql, job: DatabaseJob) => Promise<object> }
  | { seal: "expiry"; constraints: string; run: (tx: TransactionSql, job: DatabaseJob) => Promise<Expiry> });

const STOCK_SEAL = "app.stock_movement_applied, app.stock_reservation_sealed";
const PROMOTION_SEAL = "app.promotion_movement_applied, app.promotion_reservation_sealed";
const OWNED_ORDER_SEAL = `${STOCK_SEAL}, ${PROMOTION_SEAL}, app.commerce_order_sealed, app.order_event_applied, app.checkout_stock_hold_sealed, app.checkout_promotion_hold_sealed`;

// Sole registry of database-owned job kinds: whitelist, dispatch, failure code
// and the runOneJob selector all derive from it. Leased adapter kinds
// (scripts/worker.ts) and local.notification are handled separately.
export const DATABASE_JOBS: Readonly<Record<string, DatabaseJobDefinition>> = {
  "inventory.reservation.expire": { seal: "expiry", error: "INVALID_INVENTORY_STATE", constraints: STOCK_SEAL, run: (tx, job) => expireReservationJob(tx, job.payload) },
  "promotion.reservation.expire": { seal: "expiry", error: "INVALID_PROMOTION_STATE", constraints: PROMOTION_SEAL, run: (tx, job) => expirePromotionJob(tx, job.payload) },
  // lazy: run is unreachable; expireOwnedOrderJob owns every order or throws 404.
  "checkout.order.expire": { seal: "expiry", error: "INVALID_INVENTORY_STATE", constraints: STOCK_SEAL, run: (tx, job) => expireReservationJob(tx, job.payload) },
  "payment.callback": { seal: "complete", error: "INVALID_PAYMENT_STATE", run: processPaymentEvent },
  "cod.callback": { seal: "complete", error: "INVALID_COD_STATE", run: processCodEvent },
  "settlement.callback": { seal: "complete", error: "INVALID_SETTLEMENT_STATE", run: processSettlementEvent },
  "parcel.receipt.callback": { seal: "complete", error: "INVALID_PARCEL_RECEIPT_STATE", run: processParcelReceipt },
  "refund.callback": { seal: "complete", error: "INVALID_REFUND_STATE", run: processRefundEvent },
  "recovery.refund.callback": { seal: "complete", error: "INVALID_RECOVERY_REFUND_STATE", run: processRecoveryRefundEvent },
  "replacement.shipping.callback": { seal: "complete", error: "INVALID_REPLACEMENT_STATE", run: processReplacementWaybill },
  "replacement.receipt.callback": { seal: "complete", error: "INVALID_REPLACEMENT_STATE", run: processReplacementReceipt },
  "shipping.callback": { seal: "defer", error: "INVALID_SHIPPING_STATE", run: processWaybillEvent },
  "shipping.cancel.callback": { seal: "defer", error: "INVALID_SHIPPING_CANCELLATION_STATE", run: processWaybillCancellationEvent },
  "fulfillment.deadline": { seal: "defer", error: "INVALID_FULFILLMENT_STATE", run: processFulfillmentDeadline },
  "fulfillment.notice": { seal: "defer", error: "INVALID_FULFILLMENT_STATE", run: processFulfillmentNotice },
  "fulfillment.tracking.poll": { seal: "defer", error: "INVALID_TRACKING_STATE", run: processTrackingPoll },
  "cod.remittance.match": { seal: "complete", error: "INVALID_COD_REMITTANCE_STATE", run: processCodRemittanceMatch },
  ...Object.fromEntries(COMMISSION_JOB_KINDS.map((kind) => [kind, { seal: "defer", error: "INVALID_COMMISSION_STATE", run: processCommissionJob } satisfies DatabaseJobDefinition])),
};
const SELECTED_KINDS = ["local.notification", ...Object.keys(DATABASE_JOBS)];

// Shared by the production selector and rollback/crash proof: effect and job
// completion always use the caller's actual database transaction.
export async function processDatabaseJob(tx: TransactionSql, job: DatabaseJob) {
  readRuntimeConfig(process.env);
  if (job.kind === "local.notification") {
    const error = await dispatchLocal(tx, job.kind, job.payload);
    await tx`update app.outbox_job set status=${error ? "failed" : "completed"},attempts=attempts+1,last_error=${error},completed_at=now() where id=${job.id}`;
    return;
  }
  const definition = Object.hasOwn(DATABASE_JOBS, job.kind) ? DATABASE_JOBS[job.kind] : undefined;
  if (!definition) throw new AccessError(400, "INVALID_DATABASE_JOB");
  try {
    const result = await tx.savepoint(async (inner) => {
      if (definition.seal !== "expiry") {
        const result = await definition.run(inner, job);
        if (definition.seal === "defer" && "deferMs" in result && result.deferMs != null) await inner`update app.outbox_job set run_at=clock_timestamp()+${result.deferMs as number}*interval '1 millisecond',last_error=null where id=${job.id}`;
        else await inner`update app.outbox_job set status='completed',attempts=attempts+1,last_error=null,completed_at=clock_timestamp(),result=${JSON.stringify(result)}::jsonb where id=${job.id}`;
        await inner`set constraints all immediate`;
        return null;
      }
      const owned = await expireOwnedOrderJob(inner,job);
      const outcome = owned ?? await definition.run(inner, job);
      // Check deferred stock invariants before leaving the recoverable savepoint.
      await inner.unsafe(`SET CONSTRAINTS ${owned ? OWNED_ORDER_SEAL : definition.constraints} IMMEDIATE`);
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
    const retryable = ["40P01", "55P03", "57014", "PAYMENT_RECONCILIATION_PENDING", "TRACKING_ADAPTER_UNAVAILABLE", "COD_COLLECTION_PENDING"].includes(code);
    const attempts = job.attempts + 1; const failed = !retryable || attempts >= job.max_attempts;
    const message = error instanceof AccessError && [400,404].includes(error.status) ? "INVALID_PAYLOAD"
      : retryable ? (["TRACKING_ADAPTER_UNAVAILABLE", "COD_COLLECTION_PENDING"].includes(code) ? code : "TEMPORARY_DATABASE_FAILURE") : definition.error;
    const delay = Math.min(60, 2 ** Math.max(0, attempts-1));
    await tx`update app.outbox_job set status=${failed ? "failed" : "pending"},attempts=${attempts},last_error=${message},
      run_at=clock_timestamp()+${delay}*interval '1 second',completed_at=case when ${failed} then clock_timestamp() else null end where id=${job.id}`;
  }
}

let guestCleanupAt = Number.NEGATIVE_INFINITY;
export { guestCleanup };
// Event names that predate the S105 registry stay stable for existing log consumers.
const RETENTION_FAILURE_EVENTS: Readonly<Record<string, string>> = {
  "guest_context.expired": "jobs.guest_cleanup_failed", "autolaris_callback.body": "jobs.autolaris_callback_retention_failed",
};

// Housekeeping lane: every RETENTION_JOBS entry (src/jobs/retention.ts) at most once per minute per process
// (monotonic clock). Each failure is logged redacted (class + SQLSTATE) and never stops jobs or other entries.
export async function sweepExpiredGuestContexts(sql: Sql) {
  if (performance.now() - guestCleanupAt < 60000) return;
  guestCleanupAt = performance.now();
  for (const [name, job] of Object.entries(RETENTION_JOBS)) {
    try { await job.run(sql); }
    catch (error) {
      const legacy = Object.hasOwn(RETENTION_FAILURE_EVENTS, name);
      console.error(JSON.stringify({ event: legacy ? RETENTION_FAILURE_EVENTS[name] : "jobs.retention_failed", ...(legacy ? {} : { job: name }),
        error: error instanceof Error ? error.name : typeof error,
        sqlstate: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : undefined }));
    }
  }
}
export async function runOneJob(sql: Sql, adapters: Readonly<Record<string, JobAdapter>> = {},onlyJobId?:string) {
  readRuntimeConfig(process.env);
  if(onlyJobId!==undefined) id(onlyJobId);
  await expireLeases(sql,onlyJobId);
  if(onlyJobId===undefined) await sweepExpiredGuestContexts(sql);
  if(Object.keys(adapters).length>0&&Object.keys(adapters).every((k)=>k.startsWith("lease.probe."))) return runLeasedJob(sql,adapters,undefined,onlyJobId);
  const [installed]=await sql`select to_regclass('app.fulfillment_deadline') is not null installed`;
  const fulfillmentDue=installed.installed?sql`(o.kind='fulfillment.deadline' and o.last_error is null and exists (
    select 1 from app.fulfillment_deadline d join app.fulfillment f on f.id=d.fulfillment_id join app.order_shipment s on s.id=f.shipment_id join app.commerce_order r on r.id=s.order_id join app.local_fixture_namespace n on n.name=r.clock_namespace
    where d.id::text=o.payload->>'deadlineId' and (case when o.payload->>'kind'='packing' then d.packing_due_at else d.handover_due_at end)<=n.clock))`:sql`false`;
  const processed = await sql.begin(async (tx) => {
    const [job] = await tx<DatabaseJob[]>`select o.id,o.kind,o.payload,o.attempts,o.max_attempts from app.outbox_job o
      where o.status='pending' and (${onlyJobId??null}::uuid is null or o.id=${onlyJobId??null}::uuid) and o.kind in ${tx(SELECTED_KINDS)} and (
        o.run_at<=clock_timestamp() or (o.kind='inventory.reservation.expire' and o.last_error is null and exists (
          select 1 from app.stock_reservation r join app.local_fixture_namespace n on n.name=r.clock_namespace
          where r.id::text=o.payload->>'reservationId' and r.kind='checkout' and r.status='active' and r.expires_at<=n.clock))
        or (o.kind='promotion.reservation.expire' and o.last_error is null and exists (
          select 1 from app.promotion_reservation r join app.local_fixture_namespace n on n.name=r.clock_namespace
          where r.id::text=o.payload->>'reservationId' and r.status='active' and r.expires_at<=n.clock))
        or (o.kind='checkout.order.expire' and o.last_error is null and exists (
          select 1 from app.commerce_order r join app.local_fixture_namespace n on n.name=r.clock_namespace
          where r.id::text=o.payload->>'orderId' and r.status='pending' and r.expires_at<=n.clock)) or ${fulfillmentDue}
        or (o.kind='commission.mature' and o.last_error is null and exists (
          select 1 from app.commission_entry ce join app.commerce_order r on r.id=ce.order_id
          where ce.id::text=o.payload->>'commissionEntryId' and ce.available_at<=app.reservation_clock(r.clock_namespace))))
      order by o.run_at,o.created_at,o.id for update of o skip locked limit 1`;
    if (!job) return false;
    await processDatabaseJob(tx, job);
    return true;
  });
  return processed || runLeasedJob(sql, adapters,undefined,onlyJobId);
}
