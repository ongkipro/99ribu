import type { LocalAuth } from "./auth.ts";

export const roles = ["owner", "ecommerce_admin", "warehouse", "customer_service", "finance", "buyer", "affiliate"] as const;
/** Roles the staff-grant endpoint may assign. `owner` is bootstrap-only: it is never granted here, only removed. */
export const staffRoles = ["ecommerce_admin", "warehouse", "customer_service", "finance"] as const;
export type Role = typeof roles[number];
export const permissions = ["orders.history.read", "finance.summary.read", "finance.costs.read", "finance.costs.write", "finance.reconciliation.read", "finance.reconciliation.write", "finance.refunds.read", "finance.refunds.write", "exports.read", "exports.download", "shipping.labels.read", "shipping.labels.generate", "shipping.labels.print"] as const;
export type Permission = typeof permissions[number];
export type Principal = { id: string; sessionId: string; roles: Role[]; permissions: Permission[]; warehouseIds: string[]; mfaAt: Date | null };

export class AccessError extends Error {
  status: number;
  code: string;
  retryAfter?: number;
  constructor(status: number, code: string, retryAfter?: number) { super(code); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}
export const isStaff = (principal: Principal) => principal.roles.some((role) => !["buyer", "affiliate"].includes(role));

export async function getPrincipal(request: Request, identity: LocalAuth): Promise<Principal> {
  const current = await identity.auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!current?.user.emailVerified) throw new AccessError(401, "UNAUTHENTICATED");
  const [grant] = await identity.sql`select roles, permissions from app.role_grant where user_id=${current.user.id}`;
  const memberships = await identity.sql`select w.id from app.warehouse_membership m join app.warehouse w on w.id=m.warehouse_id where m.user_id=${current.user.id} and w.active`;
  const [mfa] = await identity.sql`select verified_at from app.mfa_session where session_id=${current.session.id}`;
  const principal: Principal = { id: current.user.id, sessionId: current.session.id,
    roles: grant?.roles ?? ["buyer"], permissions: grant?.permissions ?? [], warehouseIds: memberships.map((row) => row.id),
    mfaAt: current.user.twoFactorEnabled && mfa ? new Date(mfa.verified_at) : null };
  if (principal.roles.some((role) => !roles.includes(role))) throw new AccessError(403, "FORBIDDEN");
  if (isStaff(principal) && !principal.mfaAt) throw new AccessError(403, "MFA_REQUIRED");
  return principal;
}

export function canReadWarehouse(principal: Principal, warehouseId: string) {
  return Boolean(principal.mfaAt) && (principal.roles.includes("owner") ||
    (principal.roles.some((role) => ["warehouse", "ecommerce_admin"].includes(role)) && principal.warehouseIds.includes(warehouseId)));
}
export function canReadOwn(principal: Principal, kind: "buyer" | "affiliate", ownerId: string) {
  return principal.roles.includes(kind) && principal.id === ownerId;
}
export function hasPermission(principal: Principal, permission: Permission) {
  if (!principal.mfaAt || !isStaff(principal)) return false;
  if (principal.roles.includes("owner")) return true;
  if (!principal.permissions.includes(permission)) return false;
  if (permission.startsWith("finance.")) return principal.roles.includes("finance");
  if (permission === "orders.history.read") return principal.roles.some((role) => ["ecommerce_admin", "customer_service", "finance"].includes(role));
  if (permission.startsWith("shipping.labels.")) return principal.roles.some((role) => ["warehouse", "ecommerce_admin"].includes(role));
  return permission === "exports.read" || permission === "exports.download";
}
export function canReadOrderHistory(principal: Principal, warehouseIds: readonly string[]) {
  return hasPermission(principal, "orders.history.read") && (principal.roles.includes("owner") ||
    (warehouseIds.length > 0 && warehouseIds.every((id) => principal.warehouseIds.includes(id))));
}
export function canExport(principal: Principal, domain: "orders" | "warehouse" | "finance", warehouseIds: readonly string[], download = false) {
  if (!hasPermission(principal, download ? "exports.download" : "exports.read")) return false;
  if (domain === "orders") return canReadOrderHistory(principal, warehouseIds);
  if (domain === "warehouse") return warehouseIds.length > 0 && warehouseIds.every((id) => canReadWarehouse(principal, id));
  return hasPermission(principal, "finance.summary.read");
}
export function projectMe(principal: Principal) {
  return { id: principal.id, roles: principal.roles, warehouse_ids: principal.warehouseIds };
}
// pickup_ready mirrors pickupReadiness (street address, PIC name and phone present) without exposing those values;
// shipping_area says whether live shipping rates can be quoted from this warehouse (S95).
export function projectWarehouse(row: { id: string; admin_no: number | string; name: string; city: string; province: string | null; district: string | null;
  timezone: string; active: boolean; shipping_area: boolean; pickup_ready: boolean }) {
  return { id: row.id, admin_no: Number(row.admin_no), name: row.name, city: row.city, province: row.province, district: row.district,
    timezone: row.timezone, active: row.active, shipping_area: row.shipping_area, pickup_ready: row.pickup_ready };
}
// The downstream history handler supplies its actual authorized order. Copy an
// explicit public schema, never an ORM row with contact/cost/proof fields.
export function projectOrderSummary(principal: Principal, warehouseIds: readonly string[], row: {
  id: string; admin_no: number | string; number: string; status: string; payment_status: string; payment_method: string;
  buyer_total: number; currency: "IDR"; created_at: string; version: number;
}) {
  if (!canReadOrderHistory(principal, warehouseIds)) throw new AccessError(403, "FORBIDDEN");
  return { id: row.id, admin_no: Number(row.admin_no), number: row.number, status: row.status, payment_status: row.payment_status,
    payment_method: row.payment_method, buyer_total: row.buyer_total, currency: row.currency,
    created_at: row.created_at, version: row.version };
}
