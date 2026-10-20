import type { TransactionSql } from "postgres";
import { AccessError } from "../access/policy.ts";
import { id, object } from "../catalog/validation.ts";
import { readReservation, releaseReservation } from "./reservations.ts";
import { lockInventoryClock } from "./state.ts";

export async function expireReservationJob(tx: TransactionSql, payload: unknown) {
  const body = object(payload, ["reservationId"]); const reservationId = id(body.reservationId);
  const previous = await readReservation(tx, reservationId);
  if (previous.header.kind !== "checkout") throw new AccessError(400, "INVALID_EXPIRY_JOB");
  // Clock before reservation row prevents a host clock update from creating
  // a lock cycle with another reservation consumer.
  const clock = await lockInventoryClock(tx, previous.header.clock_namespace, [...new Set(previous.components.map((c) => c.warehouse_id as string))]);
  const [header] = await tx`select status,expires_at from app.stock_reservation where id=${reservationId} for update`;
  if (!header) throw new AccessError(404, "NOT_FOUND");
  if (header.status !== "active") return { reservationId, status: String(header.status), deferMs: null };
  const remaining = new Date(header.expires_at).getTime() - clock.now.getTime();
  if (remaining > 0) return { reservationId, status: "active", deferMs: Math.min(3600000, Math.max(50,remaining)) };
  const expired = await releaseReservation(tx, reservationId, "Reservation deadline expired", null, true);
  return { reservationId, status: expired.header.status, deferMs: null };
}
