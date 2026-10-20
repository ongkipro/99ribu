import type { TransactionSql } from "postgres";
import type { inventoryBalance } from "../../db/schema.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { integer, text } from "../catalog/validation.ts";

export type InventoryAuthority = { owner: boolean; roles: string[]; warehouseIds: string[] };
export type Position = typeof inventoryBalance.$inferSelect & { lotCode: string | null; expiresOn: string | null; expired: boolean };
export type MovementKind = "receive" | "adjust_up" | "adjust_down" | "quarantine" | "release_quarantine" | "write_off" | "reserve" | "release" | "consume" | "transfer_out" | "transfer_in";

export async function inventoryAuthority(tx: TransactionSql, principal: Principal): Promise<InventoryAuthority> {
  await tx`select id from app.auth_user where id=${principal.id} for update`;
  const [grant] = await tx`select g.roles from app.role_grant g join app.auth_user u on u.id=g.user_id
    join app.auth_session s on s.user_id=u.id join app.mfa_session m on m.session_id=s.id
    where u.id=${principal.id} and s.id=${principal.sessionId} and s.expires_at>clock_timestamp()
    and u.two_factor_enabled for share of g,s,m`;
  if (!grant?.roles.some((r: string) => ["owner", "ecommerce_admin", "warehouse"].includes(r))) throw new AccessError(403, "FORBIDDEN");
  const rows = await tx`select w.id from app.warehouse_membership m join app.warehouse w on w.id=m.warehouse_id
    where m.user_id=${principal.id} and w.active`;
  return { owner: grant.roles.includes("owner"), roles: grant.roles, warehouseIds: rows.map((v) => v.id) };
}
export async function assertInventoryWarehouse(tx: TransactionSql, warehouseId: string, access: InventoryAuthority, active = true) {
  if (!access.owner && !access.warehouseIds.includes(warehouseId)) throw new AccessError(404, "NOT_FOUND");
  const [row] = await tx`select id from app.warehouse where id=${warehouseId} and (not ${active} or active) for share`;
  if (!row) throw new AccessError(404, "NOT_FOUND");
}

// Host/server-only opt-in. Public inventory requests always use the null context.
export async function lockInventoryClock(tx: TransactionSql, namespace: string | null, warehouseIds: readonly string[]) {
  if (namespace === null) {
    const [row] = await tx`select clock_timestamp() as now`; return { namespace: null, now: new Date(row.now) };
  }
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(namespace) || !warehouseIds.length) throw new AccessError(400, "INVALID_SCENARIO_CLOCK");
  const [clock] = await tx`select clock from app.local_fixture_namespace where name=${namespace} for share`;
  if (!clock) throw new AccessError(400, "INVALID_SCENARIO_CLOCK");
  const selected = [...new Set(warehouseIds)];
  const rows = await tx`select warehouse_id from app.local_fixture_warehouse where namespace=${namespace} and warehouse_id in ${tx(selected)}`;
  if (rows.length !== selected.length) throw new AccessError(409, "CLOCK_CONTEXT_MISMATCH");
  return { namespace, now: new Date(clock.clock) };
}
export async function ensurePosition(tx: TransactionSql, warehouseId: string, stockItemId: string, lotId: string | null) {
  if (!(await tx`select id from app.stock_item where id=${stockItemId}`).length) throw new AccessError(404, "NOT_FOUND");
  if (lotId && !(await tx`select id from app.inventory_lot where id=${lotId} and stock_item_id=${stockItemId}`).length) throw new AccessError(404, "NOT_FOUND");
  // Multi-position callers create in warehouse/SKU/lot order, then lock all IDs in order.
  await tx`insert into app.inventory_balance (warehouse_id,stock_item_id,lot_id) values (${warehouseId},${stockItemId},${lotId})
    on conflict (warehouse_id,stock_item_id,lot_id) do nothing`;
  const [row] = await tx`select id from app.inventory_balance where warehouse_id=${warehouseId} and stock_item_id=${stockItemId} and lot_id is not distinct from ${lotId}::uuid`;
  return row.id as string;
}
export async function readPosition(tx: TransactionSql, balanceId: string, namespace: string | null = null): Promise<Position> {
  const [row] = await tx<Position[]>`select b.id,b.warehouse_id as "warehouseId",b.stock_item_id as "stockItemId",b.lot_id as "lotId",
    b.on_hand as "onHand",b.reserved,b.quarantined,b.revision,l.code as "lotCode",l.expires_on::text as "expiresOn",
    coalesce(l.expires_on<(app.inventory_clock(w.id,${namespace}) at time zone w.timezone)::date,false) as expired
    from app.inventory_balance b join app.warehouse w on w.id=b.warehouse_id left join app.inventory_lot l on l.id=b.lot_id where b.id=${balanceId}`;
  if (!row) throw new AccessError(404, "NOT_FOUND");
  return row;
}
export function projectPosition(row: Position) {
  return { id: row.id, warehouse_id: row.warehouseId, stock_item_id: row.stockItemId, lot_id: row.lotId,
    lot_code: row.lotCode, expires_on: row.expiresOn, expired: row.expired, on_hand: row.onHand,
    reserved: row.reserved, quarantined: row.quarantined, available: row.expired ? 0 : row.onHand - row.reserved - row.quarantined,
    version: row.revision };
}
export async function postMovement(tx: TransactionSql, input: {
  balanceId: string; kind: MovementKind; quantity: number; onHand: number; reserved: number; quarantined: number;
  sourceRef: string; actorId: string | null; reason: string;
}) {
  integer(input.quantity, 1); text(input.sourceRef, 200); text(input.reason, 500);
  if (![input.onHand, input.reserved, input.quarantined].every(Number.isSafeInteger)) throw new AccessError(400, "INVALID_INPUT");
  const [before] = await tx`select on_hand,reserved,quarantined,revision from app.inventory_balance where id=${input.balanceId} for update`;
  if (!before) throw new AccessError(404, "NOT_FOUND");
  const onHand = before.on_hand + input.onHand; const reserved = before.reserved + input.reserved; const quarantined = before.quarantined + input.quarantined;
  if ([onHand, reserved, quarantined].some((v) => v < 0) || reserved + quarantined > onHand) throw new AccessError(409, "INSUFFICIENT_STOCK");
  if ([onHand, reserved, quarantined, before.revision + 1].some((v) => v > 2147483647)) throw new AccessError(409, "INVENTORY_LIMIT_EXCEEDED");
  const [movement] = await tx`insert into app.stock_movement (balance_id,revision,kind,quantity,on_hand_delta,reserved_delta,quarantined_delta,source_ref,actor_id,reason)
    values (${input.balanceId},${before.revision + 1},${input.kind},${input.quantity},${input.onHand},${input.reserved},${input.quarantined},${input.sourceRef},${input.actorId},${input.reason}) returning id,kind,quantity,created_at`;
  await tx`update app.inventory_balance set on_hand=${onHand},reserved=${reserved},quarantined=${quarantined},revision=revision+1 where id=${input.balanceId}`;
  return { id: movement.id as string, kind: movement.kind as MovementKind, quantity: movement.quantity as number,
    created_at: new Date(movement.created_at).toISOString() };
}
