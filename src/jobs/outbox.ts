import type { TransactionSql } from "postgres";

export function jsonIntent(payload: Record<string, unknown>) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid job intent.");
  const value = JSON.stringify(payload, (_key, item) => {
    if (item === undefined || typeof item === "function" || typeof item === "symbol" || (typeof item === "number" && !Number.isFinite(item))) throw new Error("Invalid job intent.");
    return item;
  });
  if (Buffer.byteLength(value) > 16384) throw new Error("Job intent too large.");
  return value;
}

export async function enqueueJob(tx: TransactionSql, kind: string, key: string, payload: Record<string, unknown>, maxAttempts = 5) {
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(kind) || !/^[A-Za-z0-9_.:-]{1,200}$/.test(key) ||
      !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error("Invalid job identity or retry limit.");
  const body = jsonIntent(payload);
  await tx`insert into app.outbox_job (kind,dedup_key,payload,max_attempts) values (${kind},${key},${body}::jsonb,${maxAttempts}) on conflict (dedup_key) do nothing`;
  const [job] = await tx`select id,kind,payload=${body}::jsonb as same_intent,max_attempts from app.outbox_job where dedup_key=${key}`;
  if (job.kind !== kind || !job.same_intent || job.max_attempts !== maxAttempts) throw new Error("Outbox identity conflicts with the original intent.");
  return job.id as string;
}

// Accept the caller's transaction: never commit a job separately from its domain intent.
export async function enqueueLocalDelivery(tx: TransactionSql, deliveryId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(deliveryId)) {
    throw new Error("Invalid local delivery reference.");
  }
  return enqueueJob(tx, "local.notification", `local-delivery:${deliveryId}`, { deliveryId });
}
