import type { Sql } from "postgres";
import { deleteExpiredGuestContexts } from "../modules/checkout/access.ts";
import { AUTOLARIS_CALLBACK_RETENTION_DAYS, redactAutolarisCallbacks } from "../modules/payments/autolaris.ts";

// S105 retention registry: the worker's throttled housekeeping lane runs every entry once per minute per
// process (src/jobs/worker.ts). Each run is one bounded statement (at most RETENTION_BATCH rows) in its own
// transaction, so a repeat after a crash or a concurrent worker only finds the next batch (idempotent).
// Money, ledger and audit tables (finance_*, economic_receipt, *_event histories, audit_event, policy and
// catalog revisions) have no entry; a row they reference is never selected (FK RESTRICT stays the backstop).
export const RETENTION_BATCH = 500;
export type RetentionJob = { table: string; window: string; run: (sql: Sql) => Promise<number> };

// Single seam so tests can inject a failing cleanup without intercepting the job transaction.
export const guestCleanup = { run: deleteExpiredGuestContexts };

// Completed jobs of kinds whose dedup key is bound to a one-shot domain identity (a reservation, order,
// deadline, tracking entry, notice, delivery or ad decision), so a deleted key is never enqueued again.
// Money and carrier kinds keep their rows: their guards forbid deletion or recovery code reads them back.
export const OUTBOX_RETENTION_KINDS = [
  "local.notification", "inventory.reservation.expire", "promotion.reservation.expire", "checkout.order.expire",
  "fulfillment.deadline", "fulfillment.notice", "fulfillment.tracking.poll", "advertising.dispatch",
] as const;
// Idempotency replay records whose operation id is never stored elsewhere; the durable record of each of
// these actions is its domain row plus audit_event. Finance, payout, affiliate, fulfillment, policy, role
// and promotion operations are kept (their ids are referenced as sources or guarded by triggers).
// Exact actions, plus prefixes matched with starts_with (no LIKE wildcards, so `_` stays literal).
export const ACCESS_OPERATION_RETENTION_ACTIONS = ["catalog.mutate", "catalog.publication", "catalog.publication.withdraw", "inventory.mutate"] as const;
export const ACCESS_OPERATION_RETENTION_PREFIXES = [
  "buyer.", "guest_order_access.", "support.", "shipping.label.", "shipping.template.", "staff_roles.proof:",
] as const;

// Every single-column foreign key that points at app.<table>, read from the catalog on each run so a new
// referencing table is honoured without a code change. A composite reference refuses the job (logged).
// Returned wrapped: a bare fragment is a thenable, and awaiting it would run it as a query of its own.
async function unreferenced(sql: Sql, table: "outbox_job" | "access_operation") {
  const refs = await sql<{ nsp: string; rel: string; col: string; columns: number }[]>`
    select n.nspname nsp, r.relname rel, a.attname col, cardinality(c.conkey) columns from pg_constraint c
    join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid=${`app.${table}`}::regclass order by 1,2,3`;
  if (refs.some((ref) => ref.columns !== 1)) throw new Error(`Composite reference to app.${table}; retention refused.`);
  return { clause: refs.reduce((clause, ref) => sql`${clause} and not exists (select 1 from ${sql(ref.nsp)}.${sql(ref.rel)} ref where ref.${sql(ref.col)}=t.id)`, sql`true`) };
}

export const RETENTION_JOBS: Readonly<Record<string, RetentionJob>> = {
  "guest_context.expired": { table: "commerce_guest_context", window: "at expiry, when nothing references the context (DEC-002)",
    run: (sql) => guestCleanup.run(sql) },
  "autolaris_callback.body": { table: "autolaris_callback", window: `body emptied ${AUTOLARIS_CALLBACK_RETENTION_DAYS} days after receipt; digest kept`,
    run: (sql) => redactAutolarisCallbacks(sql) },
  "outbox.completed": { table: "outbox_job", window: "completed 30 days ago, allowlisted kinds, unreferenced",
    run: async (sql) => (await sql`delete from app.outbox_job where id in (select t.id from app.outbox_job t
      where t.status='completed' and t.completed_at<clock_timestamp()-interval '30 days' and t.kind in ${sql([...OUTBOX_RETENTION_KINDS])}
      and ${(await unreferenced(sql, "outbox_job")).clause} order by t.completed_at limit ${RETENTION_BATCH} for update skip locked)`).count },
  "access_operation.replay": { table: "access_operation", window: "created 90 days ago, allowlisted actions, unreferenced",
    run: async (sql) => (await sql`delete from app.access_operation where id in (select t.id from app.access_operation t
      where t.created_at<clock_timestamp()-interval '90 days' and (t.action=any(${[...ACCESS_OPERATION_RETENTION_ACTIONS]}::text[]) or exists (select 1 from unnest(${[...ACCESS_OPERATION_RETENTION_PREFIXES]}::text[]) p where starts_with(t.action, p)))
      and ${(await unreferenced(sql, "access_operation")).clause} order by t.created_at limit ${RETENTION_BATCH} for update skip locked)`).count },
  // mfa_session and access_proof rows go with their session (ON DELETE CASCADE).
  "auth.session": { table: "auth_session", window: "30 days after expiry (with its mfa_session and access_proof rows)",
    run: async (sql) => (await sql`delete from app.auth_session where id in (select id from app.auth_session
      where expires_at<clock_timestamp()-interval '30 days' order by expires_at limit ${RETENTION_BATCH} for update skip locked)`).count },
  "auth.verification": { table: "auth_verification", window: "7 days after expiry",
    run: async (sql) => (await sql`delete from app.auth_verification where id in (select id from app.auth_verification
      where expires_at<clock_timestamp()-interval '7 days' order by expires_at limit ${RETENTION_BATCH} for update skip locked)`).count },
  // lazy: no index on last_request (every request updates it, an index would end HOT updates); the bounded
  // scan is the price. Windows are at most 15 minutes, so a day-old bucket is always reset on next use.
  "auth.rate_limit": { table: "auth_rate_limit", window: "1 day after the last request",
    run: async (sql) => (await sql`delete from app.auth_rate_limit where id in (select id from app.auth_rate_limit
      where last_request<floor(extract(epoch from clock_timestamp())*1000)-86400000 limit ${RETENTION_BATCH} for update skip locked)`).count },
  "visitor.history": { table: "visitor_session", window: "90 days after visitor expiry, without order, receipt or transmitted-signal references",
    run: async (sql) => Number((await sql`select app.purge_expired_visitor_history(${RETENTION_BATCH}) purged`)[0].purged) },
};
