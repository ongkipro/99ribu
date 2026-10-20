import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { readLocalConfig } from "../config/local.ts";
import { jsonIntent } from "./outbox.ts";
import {id} from '../modules/catalog/validation.ts';

export type Outcome = { status: "succeeded"; receipt: Record<string, unknown> } |
  { status: "retryable"; code: "TEMPORARY_UNAVAILABLE" } |
  { status: "failed"; code: "PERMANENT_REJECTION" | "INVALID_PAYLOAD" } |
  { status: "unknown"; code: "UNKNOWN_OUTCOME" };
export type Claim = { id: string; kind: string; payload: Record<string, unknown>; token: string; attempts: number; maxAttempts: number; reconciliation: boolean };
export type JobAdapter = {
  // retryable asserts a definitive no-effect result; thrown/timeout results are unknown.
  dispatch: (claim: Claim, signal: AbortSignal) => Promise<Outcome>;
  // A retryable lookup result must prove no effect occurred and the original attempt cannot later apply.
  reconcile: (claim: Claim, signal: AbortSignal) => Promise<Outcome>;
};

export async function expireLeases(sql: Sql,onlyJobId?:string) {
  readLocalConfig(process.env);
  if(onlyJobId!==undefined) id(onlyJobId);
  return sql`update app.outbox_job set
    status=case when dispatched_at is not null then 'unknown' when attempts>=max_attempts then 'failed' else 'pending' end,
    lease_token=null,lease_until=null,
    last_error=case when dispatched_at is null and attempts>=max_attempts then 'ATTEMPTS_EXHAUSTED' else 'LEASE_EXPIRED' end,
    completed_at=case when dispatched_at is null and attempts>=max_attempts then now() else null end,
    run_at=case when dispatched_at is not null then now()+interval '30 seconds' else now() end
    where status='processing' and lease_until<=now() and (${onlyJobId??null}::uuid is null or id=${onlyJobId??null}::uuid) returning id,status`;
}

export async function claimJob(sql: Sql, kind: string, reconciliation = false,onlyJobId?:string): Promise<Claim | null> {
  readLocalConfig(process.env);
  if(onlyJobId!==undefined) id(onlyJobId);
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(kind) || kind === "local.notification") throw new Error("Invalid leased job kind.");
  const token = randomUUID();
  const [job] = await sql`with due as (
    select id from app.outbox_job where kind=${kind} and status=${reconciliation ? "unknown" : "pending"}
    and run_at<=now() and (${reconciliation} or attempts<max_attempts) and (${onlyJobId??null}::uuid is null or id=${onlyJobId??null}::uuid)
    order by run_at,created_at,id for update skip locked limit 1
  ) update app.outbox_job j set status='processing',lease_token=${token},lease_until=now()+interval '30 seconds',
    attempts=attempts+${reconciliation ? 0 : 1},dispatched_at=case when ${reconciliation} then dispatched_at else null end
    from due where j.id=due.id returning j.id,j.kind,j.payload,j.attempts,j.max_attempts`;
  return job ? { id: job.id, kind: job.kind, payload: job.payload, token, attempts: job.attempts, maxAttempts: job.max_attempts, reconciliation } : null;
}

export async function markDispatched(sql: Sql, claim: Claim) {
  readLocalConfig(process.env);
  const rows = await sql`update app.outbox_job set dispatched_at=coalesce(dispatched_at,now()),lease_until=now()+interval '30 seconds'
    where id=${claim.id} and status='processing' and lease_token=${claim.token} and lease_until>now() returning id`;
  return rows.length === 1;
}

export async function renewLease(sql: Sql, claim: Claim) {
  readLocalConfig(process.env);
  const rows = await sql`update app.outbox_job set lease_until=now()+interval '30 seconds'
    where id=${claim.id} and status='processing' and lease_token=${claim.token} and lease_until>now() returning id`;
  return rows.length === 1;
}

export async function settleClaim(sql: Sql, claim: Claim, outcome: Outcome) {
  readLocalConfig(process.env);
  if (!outcome || !["succeeded", "retryable", "failed", "unknown"].includes(outcome.status)) throw new Error("Invalid adapter outcome.");
  const receipt = outcome.status === "succeeded" ? jsonIntent(outcome.receipt) : null;
  if (outcome.status !== "succeeded") {
    const valid = outcome.status === "retryable" ? outcome.code === "TEMPORARY_UNAVAILABLE" :
      outcome.status === "failed" ? ["PERMANENT_REJECTION", "INVALID_PAYLOAD"].includes(outcome.code) : outcome.code === "UNKNOWN_OUTCOME";
    if (!valid) throw new Error("Invalid adapter outcome/code pairing.");
  }
  const exhausted = outcome.status === "retryable" && claim.attempts >= claim.maxAttempts;
  const status = outcome.status === "succeeded" ? "completed" : outcome.status === "retryable" ? exhausted ? "failed" : "pending" : outcome.status;
  const error = exhausted ? "ATTEMPTS_EXHAUSTED" : outcome.status === "succeeded" ? null : outcome.code;
  const delay = Math.min(60, 2 ** Math.max(0, claim.attempts - 1));
  const rows = await sql`update app.outbox_job set status=${status},lease_token=null,lease_until=null,
    dispatched_at=case when ${status === "pending"} then null else dispatched_at end,
    run_at=case when ${status === "pending"} then now()+${delay}*interval '1 second' when ${status === "unknown"} then now()+interval '30 seconds' else run_at end,
    last_error=${error},result=${receipt}::jsonb,completed_at=case when ${["completed", "failed"].includes(status)} then now() else null end
    where id=${claim.id} and status='processing' and lease_token=${claim.token} and lease_until>now() and dispatched_at is not null returning id`;
  return rows.length === 1;
}

export async function runLeasedJob(sql: Sql, adapters: Readonly<Record<string, JobAdapter>>, deadlineMs = 25000,onlyJobId?:string) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 25000) throw new Error("Invalid adapter deadline.");
  for (const [kind, adapter] of Object.entries(adapters)) {
    // Recover an unknown original identity before starting another effect of this kind.
    const claim = await claimJob(sql, kind, true,onlyJobId) ?? await claimJob(sql, kind,false,onlyJobId);
    if (!claim) continue;
    if (!await markDispatched(sql, claim)) return true;
    const stop = new AbortController();
    const deadline = setTimeout(() => stop.abort(), deadlineMs);
    let outcome: Outcome;
    try {
      readLocalConfig(process.env);
      const timedOut = new Promise<never>((_resolve, reject) => stop.signal.addEventListener("abort", () => reject(new Error("Adapter deadline exceeded.")), { once: true }));
      outcome = await Promise.race([timedOut, claim.reconciliation ? adapter.reconcile(claim, stop.signal) : adapter.dispatch(claim, stop.signal)]);
      // Malformed receipt/outcome is uncertain, never an automatic retry.
      if (await settleClaim(sql, claim, outcome)) return true;
    } catch {
      await settleClaim(sql, claim, { status: "unknown", code: "UNKNOWN_OUTCOME" });
    } finally { clearTimeout(deadline); }
    return true;
  }
  return false;
}
