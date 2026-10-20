import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { assertInventoryWarehouse, inventoryAuthority, type InventoryAuthority } from "./state.ts";

export async function mutateInventory(request: Request, identity: LocalAuth, principal: Principal, action: string,
  input: unknown, warehouseIds: readonly string[], reason: string,
  write: (tx: TransactionSql, access: InventoryAuthority, sourceRef: string) => Promise<{ id: string; response: unknown }>) {
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400, "INVALID_IDEMPOTENCY_KEY");
  if (!warehouseIds.length) throw new AccessError(400, "INVALID_WAREHOUSE_SCOPE");
  const hash = createHash("sha256").update(JSON.stringify({ action, input })).digest("hex");
  const sourceRef = createHash("sha256").update(JSON.stringify([principal.id, action, key])).digest("hex");
  return identity.sql.begin(async (tx) => {
    const access = await inventoryAuthority(tx, principal);
    if (action === "inventory.transfer.create" && !access.roles.some((r) => ["owner", "ecommerce_admin"].includes(r))) throw new AccessError(403, "FORBIDDEN");
    const [previous] = await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='inventory.mutate' and key=${key}`;
    if (previous) {
      if (previous.request_hash !== hash) throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
      for (const warehouseId of previous.response.warehouse_ids) await assertInventoryWarehouse(tx, warehouseId, access, false);
      return previous.response.result;
    }
    const selected = [...new Set(warehouseIds)].sort();
    for (const warehouseId of selected) await assertInventoryWarehouse(tx, warehouseId, access);
    const result = await write(tx, access, sourceRef);
    await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},${action},${result.id},'allowed',${reason},${JSON.stringify({ warehouse_ids: selected })}::jsonb)`;
    await tx`insert into app.access_operation (actor_id,action,key,request_hash,response)
      values (${principal.id},'inventory.mutate',${key},${hash},${JSON.stringify({ warehouse_ids: selected, result: result.response })}::jsonb)`;
    return result.response;
  });
}
