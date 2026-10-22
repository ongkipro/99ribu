import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { enqueueJob } from "../../jobs/outbox.ts";
import { AccessError } from "../access/policy.ts";
import { array, id, integer, invalid, object, text } from "../catalog/validation.ts";
import { lockInventoryClock, postMovement, readPosition } from "./state.ts";

export type Requirement = { warehouse_id: string; stock_item_id: string; quantity: number };
type Header = { id: string; key: string; request_hash: string; kind: "checkout" | "transfer" | "replacement";
  status: "preparing" | "active" | "released" | "expired" | "consumed"; expires_at: string | null; clock_namespace: string | null };

// Trusted server consumers only. Ownership/publication belong to the caller's
// real quote/order domain; neither a key nor a reservation ID grants access.
export async function readReservation(tx: TransactionSql, reservationId: string) {
  const [header] = await tx<Header[]>`select id,key,request_hash,kind,status,expires_at,clock_namespace from app.stock_reservation where id=${id(reservationId)}`;
  if (!header) throw new AccessError(404, "NOT_FOUND");
  const components = await tx`select c.balance_id,c.quantity,b.warehouse_id,b.stock_item_id,b.lot_id
    from app.stock_reservation_component c join app.inventory_balance b on b.id=c.balance_id where c.reservation_id=${header.id} order by c.balance_id`;
  return { header, components };
}
function mergeRequirements(values: readonly Requirement[]) {
  if (!values.length || values.length > 10000) throw invalid();
  const merged = new Map<string, Requirement>();
  for (const row of values) {
    const warehouseId = id(row.warehouse_id); const stockItemId = id(row.stock_item_id); const quantity = integer(row.quantity, 1);
    const key = `${warehouseId}:${stockItemId}`; const prior = merged.get(key);
    merged.set(key, { warehouse_id: warehouseId, stock_item_id: stockItemId, quantity: integer((prior?.quantity ?? 0) + quantity, 1) });
  }
  return [...merged.values()].sort((a,b) => `${a.warehouse_id}:${a.stock_item_id}`.localeCompare(`${b.warehouse_id}:${b.stock_item_id}`));
}
export async function prepareReservation(tx: TransactionSql, input: {
  key: string; kind: "checkout" | "transfer" | "replacement"; expiresAt: string | null; clockNamespace: string | null;
  requirements: readonly Requirement[]; intent: Record<string, unknown>; actorId: string | null;
}) {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(input.key) || !["checkout", "transfer", "replacement"].includes(input.kind)) throw invalid();
  const requirements = mergeRequirements(input.requirements); const warehouseIds = [...new Set(requirements.map((r) => r.warehouse_id))].sort();
  const warehouses = await tx`select id from app.warehouse where id in ${tx(warehouseIds)} and active order by id for share`;
  if (warehouses.length !== warehouseIds.length) throw new AccessError(404, "NOT_FOUND");
  // Every reservation consumer takes clock share locks before its reservation
  // row, then balance IDs in order. Host clock advancement follows this order.
  const clock = await lockInventoryClock(tx, input.clockNamespace, warehouseIds);
  const hash = createHash("sha256").update(JSON.stringify({ kind: input.kind, expires_at: input.expiresAt,
    clock_namespace: input.clockNamespace, requirements, intent: input.intent })).digest("hex");
  const [existing] = await tx<Header[]>`select id,key,request_hash,kind,status,expires_at,clock_namespace from app.stock_reservation where key=${input.key} for update`;
  if (existing) {
    if (existing.request_hash !== hash) throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
    if (existing.status === "preparing") throw new AccessError(409, "RESERVATION_INCOMPLETE");
    return { id: existing.id, created: false };
  }
  if (input.kind === "checkout") {
    if (typeof input.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expiresAt) ||
      !Number.isFinite(Date.parse(input.expiresAt)) || new Date(input.expiresAt).toISOString() !== input.expiresAt) throw invalid();
    const duration = Date.parse(input.expiresAt) - clock.now.getTime();
    if (duration <= 0) throw new AccessError(409, "RESERVATION_EXPIRED");
    // S92: a manual-bank order holds stock for its 24-hour transfer window (DEC-008).
    if (duration > 86400000) throw new AccessError(400, "RESERVATION_DEADLINE_TOO_DISTANT");
  } else if (input.expiresAt !== null) throw invalid();
  const inserted = await tx`insert into app.stock_reservation (key,request_hash,kind,expires_at,clock_namespace,created_at)
    values (${input.key},${hash},${input.kind},${input.expiresAt},${input.clockNamespace},${clock.now.toISOString()}) on conflict (key) do nothing returning id`;
  const [header] = await tx<Header[]>`select id,key,request_hash,kind,status,expires_at,clock_namespace from app.stock_reservation where key=${input.key} for update`;
  if (!header || header.request_hash !== hash) throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
  if (!inserted.length) {
    if (header.status === "preparing") throw new AccessError(409, "RESERVATION_INCOMPLETE");
    return { id: header.id, created: false };
  }
  const positions = await tx<{ id: string; warehouse_id: string; stock_item_id: string; available: number; expires_on: string | null }[]>`
    select b.id,b.warehouse_id,b.stock_item_id,b.on_hand-b.reserved-b.quarantined as available,l.expires_on::text as expires_on
    from app.inventory_balance b join jsonb_to_recordset(${JSON.stringify(requirements)}::jsonb) as required(warehouse_id uuid,stock_item_id uuid,quantity int)
      on b.warehouse_id=required.warehouse_id and b.stock_item_id=required.stock_item_id
    join app.warehouse w on w.id=b.warehouse_id left join app.inventory_lot l on l.id=b.lot_id
    where b.on_hand-b.reserved-b.quarantined>0 and (l.expires_on is null or l.expires_on>=(app.inventory_clock(w.id,${clock.namespace}) at time zone w.timezone)::date)
    order by b.id for update of b`;
  const allocations: { id: string; quantity: number }[] = [];
  for (const required of requirements) {
    let remaining = required.quantity;
    const eligible = positions.filter((p) => p.warehouse_id === required.warehouse_id && p.stock_item_id === required.stock_item_id)
      .sort((a,b) => Number(a.expires_on === null) - Number(b.expires_on === null) || (a.expires_on ?? "").localeCompare(b.expires_on ?? "") || a.id.localeCompare(b.id));
    for (const position of eligible) {
      const quantity = Math.min(remaining, position.available);
      if (quantity > 0) allocations.push({ id: position.id, quantity });
      remaining -= quantity; if (!remaining) break;
    }
    if (remaining) throw new AccessError(409, "INSUFFICIENT_STOCK");
  }
  for (const allocation of allocations.sort((a,b) => a.id.localeCompare(b.id))) {
    await tx`insert into app.stock_reservation_component (reservation_id,balance_id,quantity) values (${header.id},${allocation.id},${allocation.quantity})`;
    await postMovement(tx, { balanceId: allocation.id, kind: "reserve", quantity: allocation.quantity, onHand: 0, reserved: allocation.quantity,
      quarantined: 0, sourceRef: header.id, actorId: input.actorId, reason: "Reserve complete physical components" });
  }
  return { id: header.id, created: true };
}
export async function activateReservation(tx: TransactionSql, reservationId: string) {
  const [row] = await tx`select kind,expires_at,app.reservation_clock(clock_namespace) as now from app.stock_reservation where id=${reservationId}`;
  if (!row) throw new AccessError(404, "NOT_FOUND");
  if (row.kind === "checkout" && new Date(row.expires_at).getTime() <= new Date(row.now).getTime()) throw new AccessError(409, "RESERVATION_EXPIRED");
  await tx`update app.stock_reservation set status='active' where id=${reservationId}`;
}
export async function reserveOffers(tx: TransactionSql, value: {
  key: string; lines: readonly { line_id: string; product_id: string; product_revision: number; offer_id: string; warehouse_id: string; quantity: number }[];
  expires_at: string; clock_namespace?: string | null; actor_id?: string | null;
}) {
  const lines = array(value.lines, (value) => {
    const row = object(value, ["line_id", "product_id", "product_revision", "offer_id", "warehouse_id", "quantity"]);
    const lineId = text(row.line_id, 100); if (!/^[A-Za-z0-9_-]+$/.test(lineId)) throw invalid();
    return { line_id: lineId, product_id: id(row.product_id), product_revision: integer(row.product_revision, 1), offer_id: id(row.offer_id),
      warehouse_id: id(row.warehouse_id), quantity: integer(row.quantity, 1, 1000000) };
  }, 1);
  if (new Set(lines.map((l) => l.line_id)).size !== lines.length) throw invalid();
  lines.sort((a,b) => a.line_id.localeCompare(b.line_id));
  const definitions = await tx<{ line_id: string; warehouse_id: string; quantity: number; retired: boolean | null; stock_item_id: string | null; component_quantity: number | null }[]>`
    select wanted.line_id,wanted.warehouse_id,wanted.quantity,v.retired,c.stock_item_id,c.quantity as component_quantity
    from jsonb_to_recordset(${JSON.stringify(lines)}::jsonb) as wanted(line_id text,product_id uuid,product_revision int,offer_id uuid,warehouse_id uuid,quantity int)
    left join app.offer_revision v on v.product_id=wanted.product_id and v.revision=wanted.product_revision and v.offer_id=wanted.offer_id
    left join app.offer_component c on c.product_id=v.product_id and c.revision=v.revision and c.offer_id=v.offer_id`;
  const required: Requirement[] = [];
  for (const definition of definitions) {
    if (definition.retired === null || definition.retired) throw new AccessError(404, "NOT_FOUND");
    if (!definition.stock_item_id || !definition.component_quantity) throw new AccessError(503, "INVENTORY_INVALID");
    required.push({ warehouse_id: definition.warehouse_id, stock_item_id: definition.stock_item_id,
      quantity: integer(definition.quantity * definition.component_quantity, 1) });
  }

  const result = await prepareReservation(tx, { key: value.key, kind: "checkout", expiresAt: value.expires_at,
    clockNamespace: value.clock_namespace ?? null, requirements: required, intent: { lines }, actorId: value.actor_id ?? null });
  if (result.created) {
    for (const line of lines) await tx`insert into app.stock_reservation_item (reservation_id,line_id,product_id,product_revision,offer_id,warehouse_id,offer_quantity)
      values (${result.id},${line.line_id},${line.product_id},${line.product_revision},${line.offer_id},${line.warehouse_id},${line.quantity})`;
    await activateReservation(tx, result.id);
    const jobId = await enqueueJob(tx, "inventory.reservation.expire", `inventory-expire:${result.id}`, { reservationId: result.id });
    if (value.clock_namespace) {
      const [clock] = await tx`select app.reservation_clock(${value.clock_namespace}) as now`;
      const delay = Math.max(0, Date.parse(value.expires_at) - new Date(clock.now).getTime());
      await tx`update app.outbox_job set run_at=clock_timestamp()+${delay}*interval '1 millisecond' where id=${jobId}`;
    } else await tx`update app.outbox_job set run_at=${value.expires_at} where id=${jobId}`;
  }
  return readReservation(tx, result.id);
}
async function lockReservation(tx: TransactionSql, reservationId: string) {
  const prior = await readReservation(tx, reservationId);
  const warehouseIds = [...new Set(prior.components.map((c) => c.warehouse_id as string))];
  const clock = await lockInventoryClock(tx, prior.header.clock_namespace, warehouseIds);
  const [header] = await tx<Header[]>`select id,key,request_hash,kind,status,expires_at,clock_namespace from app.stock_reservation where id=${prior.header.id} for update`;
  if (!header) throw new AccessError(404, "NOT_FOUND");
  if (!prior.components.length) throw new AccessError(503, "INVENTORY_INVALID");
  await tx`select id from app.inventory_balance where id in ${tx(prior.components.map((c) => c.balance_id))} order by id for update`;
  return { header, components: prior.components, clock };
}
export async function releaseReservation(tx: TransactionSql, reservationId: string, reason: string, actorId: string | null = null, expired = false) {
  text(reason, 500);
  const state = await lockReservation(tx, id(reservationId));
  if (state.header.status !== "active") return readReservation(tx, state.header.id);
  if (expired && (state.header.kind !== "checkout" || !state.header.expires_at || Date.parse(state.header.expires_at) > state.clock.now.getTime())) throw new AccessError(409, "RESERVATION_NOT_DUE");
  for (const component of state.components) await postMovement(tx, { balanceId: component.balance_id, kind: "release", quantity: component.quantity,
    onHand: 0, reserved: -component.quantity, quarantined: 0, sourceRef: state.header.id, actorId, reason });
  await tx`update app.stock_reservation set status=${expired ? "expired" : "released"},resolved_at=${state.clock.now.toISOString()},resolution_reason=${reason} where id=${state.header.id}`;
  return readReservation(tx, state.header.id);
}
// Whole transfer dispatch only. Checkout retention and per-shipment consumption
// are separate S27-S30 contracts and must not reuse this operation.
export async function consumeTransferReservation(tx: TransactionSql, reservationId: string, actorId: string, reason: string) {
  text(reason, 500); const state = await lockReservation(tx, id(reservationId));
  if (state.header.kind !== "transfer") throw new AccessError(409, "INVALID_RESERVATION_KIND");
  if (state.header.status === "consumed") return readReservation(tx, state.header.id);
  if (state.header.status !== "active") throw new AccessError(409, "RESERVATION_NOT_ACTIVE");
  for (const component of state.components) {
    if ((await readPosition(tx, component.balance_id, state.clock.namespace)).expired) throw new AccessError(409, "LOT_EXPIRED");
    await postMovement(tx, { balanceId: component.balance_id, kind: "transfer_out", quantity: component.quantity,
      onHand: -component.quantity, reserved: -component.quantity, quarantined: 0, sourceRef: state.header.id, actorId, reason });
  }
  await tx`update app.stock_reservation set status='consumed',resolved_at=${state.clock.now.toISOString()},resolution_reason=${reason} where id=${state.header.id}`;
  return readReservation(tx, state.header.id);
}

export async function offerAvailability(tx: TransactionSql, input: {
  product_id: string; product_revision: number; offer_id: string; warehouse_id: string; clock_namespace?: string | null;
}) {
  const productId = id(input.product_id); const revision = integer(input.product_revision, 1);
  const offerId = id(input.offer_id); const warehouseId = id(input.warehouse_id);
  const [offer] = await tx`select retired from app.offer_revision where product_id=${productId} and revision=${revision} and offer_id=${offerId}`;
  if (!offer || offer.retired) throw new AccessError(404, "NOT_FOUND");
  if (!(await tx`select id from app.warehouse where id=${warehouseId} and active`).length) throw new AccessError(404, "NOT_FOUND");
  const clock = await lockInventoryClock(tx, input.clock_namespace ?? null, [warehouseId]);
  const [row] = await tx`select least(2147483647::numeric,coalesce(floor(min(coalesce(stock.available,0)::numeric/c.quantity)),0))::int as quantity
    from app.offer_component c left join lateral (
      select sum((b.on_hand-b.reserved-b.quarantined)::bigint) as available
      from app.inventory_balance b join app.warehouse w on w.id=b.warehouse_id left join app.inventory_lot l on l.id=b.lot_id
      where b.warehouse_id=${warehouseId} and b.stock_item_id=c.stock_item_id and w.active
        and (l.expires_on is null or l.expires_on>=(app.inventory_clock(w.id,${clock.namespace}) at time zone w.timezone)::date)
    ) stock on true where c.product_id=${productId} and c.revision=${revision} and c.offer_id=${offerId}`;
  // lazy: per-position/command quantities use int32; expose a conservative int32
  // availability ceiling until a reviewed bigint quantity migration is needed.
  return row.quantity as number;
}
