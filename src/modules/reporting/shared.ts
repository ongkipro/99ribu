import type { LocalAuth } from "../access/auth.ts";
import { AccessError, type Principal, type Role } from "../access/policy.ts";

export type CanonicalWorkspace =
	| "owner"
	| "ecommerce_admin"
	| "warehouse"
	| "customer_service"
	| "finance";
export type QueueKey =
	| "orders"
	| "fulfillments"
	| "delivery_exceptions"
	| "returns"
	| "inventory"
	| "support"
	| "reconciliation";
export type MetricKey =
	| "orders_pending"
	| "orders_by_payment_method"
	| "fulfillments_due"
	| "manual_booking_pending"
	| "delivery_exceptions"
	| "returns_pending"
	| "stock_alerts"
	| "support_unassigned"
	| "finance_unmatched"
	| "transfers_near_deadline"
	| "autolaris_pending"
	| "cod_receivable"
	| "cod_remitted"
	| "refund_liability"
	| "affiliate_liability"
	| "estimated_contribution"
	| "realized_contribution"
	| "net_merchandise_revenue";

/** A manual transfer is flagged this many hours before its 24-hour payment deadline (DEC-008 (4)). */
export const TRANSFER_DEADLINE_WARNING_HOURS = 6;
/** A stock position with at most this many available units is low stock. */
export const LOW_STOCK_THRESHOLD = 5;

export const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WORKSPACE_ALIASES: Record<string, CanonicalWorkspace> = {
	owner: "owner",
	ecommerce_admin: "ecommerce_admin",
	warehouse: "warehouse",
	warehouse_staff: "warehouse",
	customer_service: "customer_service",
	cs_staff: "customer_service",
	finance: "finance",
	finance_staff: "finance",
};

export const WORKSPACE_METRICS: Record<CanonicalWorkspace, MetricKey[]> = {
	warehouse: [
		"fulfillments_due",
		"manual_booking_pending",
		"delivery_exceptions",
		"returns_pending",
		"stock_alerts",
	],
	customer_service: [
		"orders_pending",
		"delivery_exceptions",
		"returns_pending",
		"support_unassigned",
	],
	ecommerce_admin: [
		"orders_pending",
		"orders_by_payment_method",
		"fulfillments_due",
		"manual_booking_pending",
		"delivery_exceptions",
		"returns_pending",
		"stock_alerts",
	],
	finance: [
		"finance_unmatched",
		"orders_by_payment_method",
		"transfers_near_deadline",
		"autolaris_pending",
		"cod_receivable",
		"cod_remitted",
		"refund_liability",
		"affiliate_liability",
		"estimated_contribution",
		"realized_contribution",
		"net_merchandise_revenue",
	],
	owner: [
		"orders_pending",
		"orders_by_payment_method",
		"fulfillments_due",
		"manual_booking_pending",
		"delivery_exceptions",
		"returns_pending",
		"stock_alerts",
		"support_unassigned",
		"finance_unmatched",
		"transfers_near_deadline",
		"autolaris_pending",
		"cod_receivable",
		"cod_remitted",
		"refund_liability",
		"affiliate_liability",
		"estimated_contribution",
		"realized_contribution",
		"net_merchandise_revenue",
	],
};

export const WORKSPACE_QUEUES: Record<CanonicalWorkspace, QueueKey[]> = {
	warehouse: ["fulfillments", "delivery_exceptions", "returns", "inventory"],
	customer_service: ["orders", "delivery_exceptions", "returns", "support"],
	ecommerce_admin: [
		"orders",
		"fulfillments",
		"delivery_exceptions",
		"returns",
		"inventory",
	],
	finance: ["reconciliation", "orders", "returns"],
	owner: [
		"orders",
		"fulfillments",
		"delivery_exceptions",
		"returns",
		"inventory",
		"support",
		"reconciliation",
	],
};

export const METRIC_QUEUE_MAP: Record<MetricKey, QueueKey> = {
	orders_pending: "orders",
	orders_by_payment_method: "orders",
	fulfillments_due: "fulfillments",
	manual_booking_pending: "fulfillments",
	delivery_exceptions: "delivery_exceptions",
	returns_pending: "returns",
	stock_alerts: "inventory",
	support_unassigned: "support",
	finance_unmatched: "reconciliation",
	transfers_near_deadline: "orders",
	autolaris_pending: "orders",
	cod_receivable: "reconciliation",
	cod_remitted: "reconciliation",
	refund_liability: "returns",
	affiliate_liability: "reconciliation",
	estimated_contribution: "orders",
	realized_contribution: "reconciliation",
	net_merchandise_revenue: "reconciliation",
};

export const MONEY_METRICS = new Set<MetricKey>([
	"cod_receivable",
	"cod_remitted",
	"refund_liability",
	"affiliate_liability",
	"estimated_contribution",
	"realized_contribution",
	"net_merchandise_revenue",
]);

// Current-state counts: the selected period does not narrow them.
export const SNAPSHOT_METRICS = new Set<MetricKey>([
	"manual_booking_pending",
	"transfers_near_deadline",
	"autolaris_pending",
	"stock_alerts",
]);

// The existing screen where staff act on the number; null = the drilldown queue on the dashboard itself
// (no dedicated screen exists yet: inventory screens are S102, returns screens S101).
export const METRIC_ACTION_HREF: Partial<Record<MetricKey, string>> = {
	manual_booking_pending: "/admin/pesanan/kirim",
	transfers_near_deadline: "/admin/keuangan/pembayaran",
	autolaris_pending: "/admin/keuangan/pembayaran",
	cod_receivable: "/admin/keuangan/cod",
	cod_remitted: "/admin/keuangan/cod",
	support_unassigned: "/admin/obrolan",
};

export const PAYMENT_CHANNEL_LABELS: Record<string, string> = {
	cod: "COD",
	"manual-bank": "Transfer manual",
	autolaris: "VA/QRIS AutoLaris",
	"local-prepaid": "Simulasi lokal",
};

export function resolveWorkspace(
	principal: Principal,
	rawWorkspace: string | null,
): CanonicalWorkspace {
	const staffRoles = principal.roles.filter((r): r is CanonicalWorkspace =>
		[
			"owner",
			"ecommerce_admin",
			"warehouse",
			"customer_service",
			"finance",
		].includes(r),
	);
	if (staffRoles.length === 0) throw new AccessError(403, "FORBIDDEN");
	if (!rawWorkspace) {
		for (const candidate of [
			"owner",
			"finance",
			"ecommerce_admin",
			"warehouse",
			"customer_service",
		] as CanonicalWorkspace[]) {
			if (staffRoles.includes(candidate)) return candidate;
		}
		return staffRoles[0];
	}
	const normalized = WORKSPACE_ALIASES[rawWorkspace];
	if (!normalized) throw new AccessError(400, "INVALID_INPUT");
	if (
		!principal.roles.includes("owner" as Role) &&
		!staffRoles.includes(normalized)
	) {
		throw new AccessError(403, "FORBIDDEN");
	}
	return normalized;
}

export async function resolveAuthorizedWarehouses(
	identity: LocalAuth,
	principal: Principal,
	workspace: CanonicalWorkspace,
	requestedWarehouseId: string | null,
): Promise<string[]> {
	if (requestedWarehouseId !== null && !UUID_RE.test(requestedWarehouseId)) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const isOwner = principal.roles.includes("owner");
	const isCompanyWideRole =
		isOwner || workspace === "finance" || workspace === "customer_service";
	if (!isCompanyWideRole) {
		const assigned = [...principal.warehouseIds].sort();
		if (requestedWarehouseId !== null) {
			if (!assigned.includes(requestedWarehouseId)) {
				throw new AccessError(403, "FORBIDDEN");
			}
			return [requestedWarehouseId];
		}
		return assigned;
	}
	if (requestedWarehouseId !== null) {
		const rows = await identity.sql<{ id: string }[]>`
      select id from app.warehouse where id = ${requestedWarehouseId}::uuid and active
    `;
		if (rows.length === 0) throw new AccessError(404, "NOT_FOUND");
		return [requestedWarehouseId];
	}
	const all = await identity.sql<{ id: string }[]>`
    select id from app.warehouse where active order by id
  `;
	return all.map((r) => String(r.id));
}

export function resolveDateRange(
	url: URL,
	nowIso: string,
): { from: string; to: string } {
	const rawFrom = url.searchParams.get("from");
	const rawTo = url.searchParams.get("to");
	const windowParam = url.searchParams.get("window");
	const nowMs = Date.parse(nowIso);
	if (rawFrom && rawTo) {
		const fromMs = Date.parse(rawFrom);
		const toMs = Date.parse(rawTo);
		if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
			throw new AccessError(400, "INVALID_INPUT");
		}
		if (toMs - fromMs > 366 * 86400_000) {
			throw new AccessError(400, "WINDOW_TOO_WIDE");
		}
		return {
			from: new Date(fromMs).toISOString(),
			to: new Date(toMs).toISOString(),
		};
	}
	if (rawFrom || rawTo) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	let days = 30;
	if (windowParam === "7d") days = 7;
	else if (windowParam === "30d" || !windowParam) days = 30;
	else if (windowParam === "90d") days = 90;
	else if (windowParam === "365d" || windowParam === "all") days = 365;
	else throw new AccessError(400, "INVALID_INPUT");
	return {
		from: new Date(nowMs - days * 86400_000).toISOString(),
		to: new Date(nowMs + 60_000).toISOString(),
	};
}

export interface QueueRowInternal {
	id: string;
	resource_kind:
		| "order"
		| "fulfillment"
		| "shipment"
		| "return"
		| "stock_item"
		| "conversation"
		| "reconciliation";
	state: string;
	due_at: string | null;
	/** What `due_at` holds for this row, so the console can label it exactly. */
	due_at_kind: DueAtKind | null;
	warehouse_id: string | null;
	version: number;
	amount_idr: number | null;
	/** Human reference: order number, waybill, SKU or settlement reference; null when the row has none. */
	reference: string | null;
	/** S100: the order the row belongs to (order detail link target); null for stock rows and unmatched settlements. */
	order_id: string | null;
	/** Reconciliation rows: which settlement feed the mutation came from. */
	settlement_source?: "payment" | "cod";
}

export type DueAtKind =
	| "payment_deadline"
	| "packing_deadline"
	| "handover_deadline"
	| "created"
	| "occurred"
	| "updated";

/**
 * A count metric's exact queue filter. The dashboard count and the drilldown
 * queue both come from these predicates, so a card never differs from its queue.
 */
export interface MetricScope {
	metric: MetricKey;
	asOf: string;
}
