import type { LocalAuth } from "../access/auth.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { id, integer, invalid, object, text } from "../catalog/validation.ts";
import { mutateInventory } from "./operations.ts";
import { assertInventoryWarehouse, ensurePosition, inventoryAuthority, postMovement, projectPosition, readPosition, type Position } from "./state.ts";

function expiry(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-") ||
    !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10) !== value) throw invalid();
  return value;
}
export async function createInventoryLot(request: Request, identity: LocalAuth, principal: Principal, value: unknown) {
  const data = object(value, ["warehouse_id", "stock_item_id", "code", "expires_on", "reason"]);
  const input = { warehouse_id: id(data.warehouse_id), stock_item_id: id(data.stock_item_id), code: text(data.code, 100),
    expires_on: expiry(data.expires_on), reason: text(data.reason, 500) };
  return mutateInventory(request, identity, principal, "inventory.lot.create", input, [input.warehouse_id], input.reason, async (tx) => {
    if (!(await tx`select id from app.stock_item where id=${input.stock_item_id}`).length) throw new AccessError(404, "NOT_FOUND");
    const [lot] = await tx`insert into app.inventory_lot (stock_item_id,code,expires_on,origin_warehouse_id)
      values (${input.stock_item_id},${input.code},${input.expires_on},${input.warehouse_id}) returning id,stock_item_id,code,expires_on::text as expires_on`;
    return { id: lot.id, response: lot };
  });
}
export async function initializePosition(request: Request, identity: LocalAuth, principal: Principal, value: unknown) {
  const data = object(value, ["warehouse_id", "stock_item_id", "lot_id"]);
  const input = { warehouse_id: id(data.warehouse_id), stock_item_id: id(data.stock_item_id), lot_id: data.lot_id === null ? null : id(data.lot_id) };
  return mutateInventory(request, identity, principal, "inventory.position.initialize", input, [input.warehouse_id], "Initialize empty warehouse position", async (tx) => {
    const balanceId = await ensurePosition(tx, input.warehouse_id, input.stock_item_id, input.lot_id);
    return { id: balanceId, response: projectPosition(await readPosition(tx, balanceId)) };
  });
}
export async function createMovement(request: Request, identity: LocalAuth, principal: Principal, value: unknown) {
  const data = object(value, ["warehouse_id", "stock_item_id", "lot_id", "kind", "quantity", "reason", "expected_version"]);
  if (typeof data.kind !== "string" || !["receive", "adjust_up", "adjust_down", "quarantine", "release_quarantine", "write_off"].includes(data.kind)) throw invalid();
  const input = { warehouse_id: id(data.warehouse_id), stock_item_id: id(data.stock_item_id), lot_id: data.lot_id === undefined || data.lot_id === null ? null : id(data.lot_id),
    kind: String(data.kind) as "receive" | "adjust_up" | "adjust_down" | "quarantine" | "release_quarantine" | "write_off",
    quantity: integer(data.quantity, 1, 1000000), reason: text(data.reason, 500), expected_version: integer(data.expected_version, 0) };
  return mutateInventory(request, identity, principal, "inventory.movement.create", input, [input.warehouse_id], input.reason, async (tx, _access, sourceRef) => {
    const balanceId = await ensurePosition(tx, input.warehouse_id, input.stock_item_id, input.lot_id);
    await tx`select id from app.inventory_balance where id=${balanceId} for update`;
    const before = await readPosition(tx, balanceId);
    if (before.revision !== input.expected_version) throw new AccessError(409, "VERSION_CONFLICT");
    const quantity = input.quantity;
    const onHand = ["receive", "adjust_up"].includes(input.kind) ? quantity : ["adjust_down", "write_off"].includes(input.kind) ? -quantity : 0;
    const quarantined = input.kind === "quarantine" || (input.kind === "receive" && before.expired) ? quantity
      : ["release_quarantine", "write_off"].includes(input.kind) ? -quantity : 0;
    const movement = await postMovement(tx, { balanceId, kind: input.kind, quantity, onHand, reserved: 0, quarantined,
      sourceRef, actorId: principal.id, reason: input.reason });
    const balance = projectPosition(await readPosition(tx, balanceId));
    return { id: movement.id, response: { ...movement, warehouse_id: input.warehouse_id, stock_item_id: input.stock_item_id,
      lot_id: input.lot_id, reason: input.reason, actor_id: principal.id, on_hand_delta: onHand, reserved_delta: 0, quarantined_delta: quarantined,
      position_id: balanceId, balance_version: balance.version, balance } };
  });
}
function filters(url: URL, lots: boolean) {
  const names = lots ? ["warehouse_id", "stock_item_id", "cursor", "limit"] : ["warehouse_id", "stock_item_id", "lot_id", "position_id", "cursor", "limit"];
  if ([...url.searchParams.keys()].some((key) => !names.includes(key) || url.searchParams.getAll(key).length !== 1)) throw invalid();
  const limit = url.searchParams.get("limit") ?? "20"; if (!/^\d{1,3}$/.test(limit)) throw invalid();
  const selected = (key: string) => url.searchParams.has(key) ? id(url.searchParams.get(key)) : null;
  return { limit: integer(Number(limit), 1, 100), cursor: selected("cursor"), warehouseId: selected("warehouse_id"),
    stockItemId: selected("stock_item_id"), lotId: selected("lot_id"), positionId: selected("position_id") };
}
export async function listPositions(identity: LocalAuth, principal: Principal, url: URL) {
  const selected = filters(url, false);
  return identity.sql.begin(async (tx) => {
    const access = await inventoryAuthority(tx, principal);
    if (selected.warehouseId) await assertInventoryWarehouse(tx, selected.warehouseId, access, false);
    const rows = await tx<(Position & { sku: string; stockItemName: string })[]>`select b.id,b.warehouse_id as "warehouseId",b.stock_item_id as "stockItemId",b.lot_id as "lotId",
      b.on_hand as "onHand",b.reserved,b.quarantined,b.revision,l.code as "lotCode",l.expires_on::text as "expiresOn",
      coalesce(l.expires_on<(app.inventory_clock(w.id) at time zone w.timezone)::date,false) as expired,
      s.sku,s.name as "stockItemName"
      from app.inventory_balance b join app.warehouse w on w.id=b.warehouse_id join app.stock_item s on s.id=b.stock_item_id
      left join app.inventory_lot l on l.id=b.lot_id
      where (${selected.cursor}::uuid is null or b.id>${selected.cursor}::uuid)
        and (w.active or ${selected.warehouseId}::uuid is not null)
        and (${selected.warehouseId}::uuid is null or b.warehouse_id=${selected.warehouseId}::uuid)
        and (${selected.stockItemId}::uuid is null or b.stock_item_id=${selected.stockItemId}::uuid)
        and (${selected.lotId}::uuid is null or b.lot_id=${selected.lotId}::uuid)
        and (${selected.positionId}::uuid is null or b.id=${selected.positionId}::uuid)
        and (${access.owner} or exists (select 1 from app.warehouse_membership m where m.user_id=${principal.id} and m.warehouse_id=w.id and w.active))
      order by b.id limit ${selected.limit + 1}`;
    // S102: the physical SKU code and name label a row for warehouse staff (no cost or customer data).
    return { data: rows.slice(0, selected.limit).map((row) => ({ ...projectPosition(row), sku: row.sku, stock_item_name: row.stockItemName })), pagination: { next_cursor: rows.length > selected.limit ? rows[selected.limit - 1].id : null } };
  });
}
export async function listInventoryLots(identity: LocalAuth, principal: Principal, url: URL) {
  const selected = filters(url, true);
  return identity.sql.begin(async (tx) => {
    const access = await inventoryAuthority(tx, principal);
    if (selected.warehouseId) await assertInventoryWarehouse(tx, selected.warehouseId, access, false);
    const rows = await tx`select l.id,l.stock_item_id,l.code,l.expires_on::text as expires_on from app.inventory_lot l
      where (${selected.cursor}::uuid is null or l.id>${selected.cursor}::uuid)
        and (${selected.stockItemId}::uuid is null or l.stock_item_id=${selected.stockItemId}::uuid)
        and (${selected.warehouseId}::uuid is null or l.origin_warehouse_id=${selected.warehouseId}::uuid or exists (
          select 1 from app.inventory_balance b where b.lot_id=l.id and b.warehouse_id=${selected.warehouseId}::uuid))
        and (${access.owner} or exists (select 1 from app.warehouse_membership m join app.warehouse w on w.id=m.warehouse_id
          where m.user_id=${principal.id} and w.active and (m.warehouse_id=l.origin_warehouse_id or exists (
            select 1 from app.inventory_balance b where b.lot_id=l.id and b.warehouse_id=m.warehouse_id))))
      order by l.id limit ${selected.limit + 1}`;
    return { data: rows.slice(0, selected.limit), pagination: { next_cursor: rows.length > selected.limit ? rows[selected.limit - 1].id : null } };
  });
}

export async function movementHistory(identity: LocalAuth, principal: Principal, url: URL) {
  if ([...url.searchParams.keys()].some((key) => !["position_id", "cursor", "limit"].includes(key) || url.searchParams.getAll(key).length !== 1)) throw invalid();
  const positionId = id(url.searchParams.get("position_id")); const rawLimit = url.searchParams.get("limit") ?? "20";
  const rawCursor = url.searchParams.get("cursor");
  if (!/^\d{1,3}$/.test(rawLimit) || (rawCursor !== null && !/^\d{1,10}$/.test(rawCursor))) throw invalid();
  const limit = integer(Number(rawLimit), 1, 100); const cursor = rawCursor === null ? null : integer(Number(rawCursor), 1);
  return identity.sql.begin(async (tx) => {
    const access = await inventoryAuthority(tx, principal); const balance = await readPosition(tx, positionId);
    await assertInventoryWarehouse(tx, balance.warehouseId, access, false);
    // S102 audit view: the actor's display name (no email or other account data).
    const rows = await tx`select m.id,m.revision,m.kind,m.quantity,m.on_hand_delta,m.reserved_delta,m.quarantined_delta,m.actor_id,u.name as actor_name,m.reason,m.created_at
      from app.stock_movement m left join app.auth_user u on u.id=m.actor_id
      where m.balance_id=${positionId} and (${cursor}::int is null or m.revision<${cursor}::int)
      order by m.revision desc limit ${limit + 1}`;
    return { data: rows.slice(0,limit).map((m) => ({ id: m.id, warehouse_id: balance.warehouseId, stock_item_id: balance.stockItemId,
      lot_id: balance.lotId, position_id: balance.id, kind: m.kind, quantity: m.quantity, on_hand_delta: m.on_hand_delta,
      reserved_delta: m.reserved_delta, quarantined_delta: m.quarantined_delta, actor_id: m.actor_id, actor_name: m.actor_name ?? null, reason: m.reason,
      balance_version: m.revision, created_at: new Date(m.created_at).toISOString() })),
      pagination: { next_cursor: rows.length > limit ? String(rows[limit-1].revision) : null } };
  });
}
