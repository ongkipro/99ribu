import type { TransactionSql } from "postgres";
import { readLocalConfig } from "../../config/local.ts";

// Every dispatch revalidates the profile, including in a long-lived worker.
// No network/SDK sender exists in this local adapter.
export async function dispatchLocal(tx: TransactionSql, kind: string, payload: unknown) {
  const { trustedOrigins } = readLocalConfig(process.env);
  if (kind !== "local.notification") return "unsupported_job";
  if (!payload || typeof payload !== "object" || !("deliveryId" in payload) || Object.keys(payload).length !== 1 ||
      typeof payload.deliveryId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(payload.deliveryId)) return "invalid_payload";
  const [message] = await tx`select recipient, url, expires_at from app.local_delivery where id=${payload.deliveryId} for update`;
  if (!message) return "missing_delivery";
  if (!/@[^@\s]+\.(?:invalid|test)$/i.test(message.recipient)) return "invalid_recipient";
  try { if (!trustedOrigins.includes(new URL(message.url).origin)) return "invalid_destination"; }
  catch { return "invalid_destination"; }
  if (new Date(message.expires_at).getTime() <= Date.now()) return "expired_delivery";
  await tx`update app.local_delivery set delivered_at=coalesce(delivered_at, now()) where id=${payload.deliveryId}`;
  return null;
}
