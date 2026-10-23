import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { LocalAuth } from "../access/auth.ts";
import {
	assertOrigin,
	privateJson,
	problem,
	readBody,
} from "../access/http.ts";
import { localSigningKey } from "../access/local-key.ts";
import {
	AccessError,
	getPrincipal,
	type Principal,
	type Role,
} from "../access/policy.ts";
import { digest } from "../checkout/access.ts";
import {
	MENGANTAR_API_BOOKING_ENABLED,
	warehouseMode,
} from "../fulfillment/manual.ts";

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

const UUID_RE =
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

const WORKSPACE_METRICS: Record<CanonicalWorkspace, MetricKey[]> = {
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

const WORKSPACE_QUEUES: Record<CanonicalWorkspace, QueueKey[]> = {
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

const METRIC_QUEUE_MAP: Record<MetricKey, QueueKey> = {
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

const MONEY_METRICS = new Set<MetricKey>([
	"cod_receivable",
	"cod_remitted",
	"refund_liability",
	"affiliate_liability",
	"estimated_contribution",
	"realized_contribution",
	"net_merchandise_revenue",
]);

// Current-state counts: the selected period does not narrow them.
const SNAPSHOT_METRICS = new Set<MetricKey>([
	"manual_booking_pending",
	"transfers_near_deadline",
	"autolaris_pending",
	"stock_alerts",
]);

// The existing screen where staff act on the number; null = the drilldown queue on the dashboard itself
// (no dedicated screen exists yet: order detail is S100, inventory screens are S102).
const METRIC_ACTION_HREF: Partial<Record<MetricKey, string>> = {
	manual_booking_pending: "/admin/fulfillment",
	transfers_near_deadline: "/admin/payments",
	autolaris_pending: "/admin/payments",
	cod_receivable: "/admin/cod-settlements",
	cod_remitted: "/admin/cod-settlements",
};

const PAYMENT_CHANNEL_LABELS: Record<string, string> = {
	cod: "COD",
	"manual-bank": "Transfer manual",
	autolaris: "VA/QRIS AutoLaris",
	"local-prepaid": "Simulasi lokal",
};

function resolveSecret(): string {
	try {
		return localSigningKey("test");
	} catch {
		return "local-reporting-hmac-key";
	}
}

function signTokenPayload(payload: Record<string, unknown>): string {
	const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
		"base64url",
	);
	const sig = createHmac("sha256", resolveSecret())
		.update(encoded)
		.digest("base64url");
	return `${encoded}.${sig}`;
}

function verifyTokenPayload(token: string): Record<string, unknown> {
	if (typeof token !== "string" || token.length < 16 || token.length > 2000) {
		throw new AccessError(409, "INVALID_FILTER_TOKEN");
	}
	const parts = token.split(".");
	if (parts.length !== 2) throw new AccessError(409, "INVALID_FILTER_TOKEN");
	const [encoded, sig] = parts;
	const expected = createHmac("sha256", resolveSecret())
		.update(encoded)
		.digest("base64url");
	const a = Buffer.from(sig, "utf8");
	const b = Buffer.from(expected, "utf8");
	if (a.length !== b.length || !timingSafeEqual(a, b)) {
		throw new AccessError(409, "INVALID_FILTER_TOKEN");
	}
	try {
		const parsed = JSON.parse(
			Buffer.from(encoded, "base64url").toString("utf8"),
		);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new AccessError(409, "INVALID_FILTER_TOKEN");
		}
		return parsed as Record<string, unknown>;
	} catch (err) {
		if (err instanceof AccessError) throw err;
		throw new AccessError(409, "INVALID_FILTER_TOKEN");
	}
}

function resolveWorkspace(
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

async function resolveAuthorizedWarehouses(
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

function resolveDateRange(
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
	/** S100: the order the row belongs to (order detail link target); null for stock and settlement rows. */
	order_id: string | null;
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

async function automatedWarehouseIds(identity: LocalAuth): Promise<string[]> {
	// Warehouses in Mengantar API mode leave the manual queue (none while the flag is off).
	if (!MENGANTAR_API_BOOKING_ENABLED) return [];
	return identity.sql.begin(async (tx) => {
		const ids: string[] = [];
		for (const row of await tx`select distinct warehouse_id from app.warehouse_pickup_profile`)
			if ((await warehouseMode(tx, String(row.warehouse_id))).mode === "mengantar_api")
				ids.push(String(row.warehouse_id));
		return ids;
	});
}

type Sql = LocalAuth["sql"];

const isSnapshot = (metric: MetricKey | null) =>
	metric !== null && SNAPSHOT_METRICS.has(metric);
// The finance payment queues (S92 /admin/manual-transfers, S93 /admin/autolaris-payments) are
// company-wide; their KPIs match them exactly, so no warehouse scope applies.
const PAYMENT_QUEUE_METRICS = new Set<MetricKey>([
	"transfers_near_deadline",
	"autolaris_pending",
]);

/**
 * FROM/WHERE of the orders queue for a metric. The card's count and its drilldown page use this
 * same fragment. Conditional fragments (not boolean binds) keep commerce_order_history_idx usable.
 */
function ordersSource(
	sql: Sql,
	warehouseIds: string[],
	from: string,
	to: string,
	metric: MetricKey | null,
	asOf: string,
) {
	const period = isSnapshot(metric)
		? sql``
		: sql`and o.created_at >= ${from}::timestamptz and o.created_at <= ${to}::timestamptz`;
	// DEC-001: pending/processing are the non-terminal order states; cancelled and
	// partially_completed (every surviving unit received) are terminal; preparing is not yet placed.
	const filter =
		metric === "orders_pending"
			? sql`and o.status in ('pending', 'processing')`
			: metric === "orders_by_payment_method"
				? sql`and o.status <> 'preparing'`
				: metric === "transfers_near_deadline"
					? // Exactly the open set of listManualTransfers (src/modules/finance/manual-bank.ts),
						// limited to attempts due within N hours or already past due. Driven by open attempts.
						sql`and o.id in (
              select a.order_id from app.payment_attempt a
              where a.method_id = 'manual-bank' and a.status in ('pending', 'unknown')
                and a.expires_at <= ${asOf}::timestamptz + make_interval(hours => ${TRANSFER_DEADLINE_WARNING_HOURS})
                and not exists (select 1 from app.manual_bank_confirmation c where c.attempt_id = a.id)
            )`
					: metric === "autolaris_pending"
						? // Exactly the open set of listAutolarisPayments (src/modules/finance/autolaris-payments.ts).
							sql`and o.id in (
              select a.order_id from app.payment_attempt a join app.autolaris_payment l on l.attempt_id = a.id
              where a.status in ('preparing', 'pending', 'unknown')
            )`
						: sql``;
	const scope =
		warehouseIds.length > 0 && !(metric && PAYMENT_QUEUE_METRICS.has(metric))
			? sql`and (
          not exists (select 1 from app.order_shipment s0 where s0.order_id = o.id)
          or exists (select 1 from app.order_shipment s where s.order_id = o.id and s.warehouse_id = any(${warehouseIds}::uuid[]))
        )`
			: sql``;
	return sql`from app.commerce_order o where true ${period} ${filter} ${scope}`;
}

/** FROM/WHERE of the fulfillments queue for a metric (count and drilldown share it). */
function fulfillmentsSource(
	sql: Sql,
	warehouseIds: string[],
	from: string,
	to: string,
	metric: MetricKey | null,
	automated: string[],
) {
	const period = isSnapshot(metric)
		? sql``
		: sql`and f.created_at >= ${from}::timestamptz and f.created_at <= ${to}::timestamptz`;
	// handed_over is the only terminal fulfillment state; exception still needs work.
	const filter =
		metric === "fulfillments_due"
			? sql`and f.status <> 'handed_over'`
			: metric === "manual_booking_pending"
				? // S91 "Perlu dipesan kurir": keep identical to the `to_book` membership predicate of
					// listManualQueue in src/modules/fulfillment/manual.ts (admin-kpis.test.ts compares the ids).
					sql`and f.handover_at is null and f.booking_id is null
            and not exists (select 1 from app.shipment_booking b where b.fulfillment_id = f.id)
            and (f.status in ('ready', 'picking') or (f.status = 'exception' and f.calendar_error is not null))
            and exists (
              select 1 from app.fulfillment_item unit where unit.shipment_id = f.shipment_id
                and not exists (select 1 from app.exception_cancellation c where c.fulfillment_item_id = unit.id and c.replacement_link_id is null)
            )
            and w.active and not (s.warehouse_id = any(${automated}::uuid[]))`
				: sql``;
	return sql`from app.fulfillment f
      join app.order_shipment s on s.id = f.shipment_id
      join app.warehouse w on w.id = s.warehouse_id
      left join app.fulfillment_deadline d on d.id = f.deadline_id
      where s.warehouse_id = any(${warehouseIds}::uuid[]) ${period} ${filter}`;
}

/**
 * Stock positions (warehouse x SKU) with the catalog/reservation availability rule: on hand -
 * reserved - quarantined over lots not expired on the warehouse's local date
 * (src/modules/catalog/summary.ts, src/modules/inventory/reservations.ts). The id is a stable
 * synthetic UUID of the position; version sums the lot balance revisions.
 */
function stockPositions(sql: Sql, warehouseIds: string[]) {
	return sql`select md5(b.warehouse_id::text || ':' || b.stock_item_id::text)::uuid::text as id,
             b.warehouse_id,
             b.stock_item_id,
             coalesce(sum(b.on_hand - b.reserved - b.quarantined) filter (
               where l.expires_on is null or l.expires_on >= (app.inventory_clock(w.id) at time zone w.timezone)::date
             ), 0)::int as available,
             sum(b.revision)::int as revision
      from app.inventory_balance b
      join app.warehouse w on w.id = b.warehouse_id
      left join app.inventory_lot l on l.id = b.lot_id
      where b.warehouse_id = any(${warehouseIds}::uuid[])
      group by b.warehouse_id, b.stock_item_id`;
}

// Terminal states a metric leaves out of its queue (the rows' state is the stored status).
const METRIC_TERMINAL_STATES: Partial<Record<MetricKey, string[]>> = {
	delivery_exceptions: ["resolved"],
	returns_pending: ["rejected", "resolved"],
	finance_unmatched: ["matched"],
};

async function queryQueueRows(
	identity: LocalAuth,
	queue: QueueKey,
	warehouseIds: string[],
	from: string,
	to: string,
	statuses?: string[],
	scope?: MetricScope,
): Promise<QueueRowInternal[]> {
	const rows = await queueRows(
		identity,
		queue,
		warehouseIds,
		from,
		to,
		statuses,
		scope,
	);
	const terminal = scope ? METRIC_TERMINAL_STATES[scope.metric] : undefined;
	return terminal ? rows.filter((r) => !terminal.includes(r.state)) : rows;
}

async function queueRows(
	identity: LocalAuth,
	queue: QueueKey,
	warehouseIds: string[],
	from: string,
	to: string,
	statuses?: string[],
	scope?: MetricScope,
): Promise<QueueRowInternal[]> {
	const sql = identity.sql;
	const hasWarehouses = warehouseIds.length > 0;
	const metric = scope?.metric ?? null;
	const asOf = scope?.asOf ?? to;

	if (queue === "orders") {
		const rows = await sql<
			{
				id: string;
				number: string;
				status: string;
				revision: number;
				buyer_total: string;
				expires_at: string | null;
				created_at: string;
				warehouse_id: string | null;
				channel: string;
			}[]
		>`
      select o.id,
             o.number,
             o.status,
             o.revision,
             o.buyer_total::text as buyer_total,
             o.expires_at,
             o.created_at,
             coalesce(o.payment_channel, case when o.payment_method = 'cod' then 'cod' else 'local-prepaid' end) as channel,
             (select s.warehouse_id::text from app.order_shipment s where s.order_id = o.id order by s.id limit 1) as warehouse_id
      ${ordersSource(sql, warehouseIds, from, to, metric, asOf)}
      order by o.created_at desc, o.id asc
    `;
		return rows
			.filter((r) => !statuses?.length || statuses.includes(r.status))
			.map((r) => ({
				id: String(r.id),
				resource_kind: "order" as const,
				state: String(r.status),
				due_at: r.expires_at
					? new Date(r.expires_at).toISOString()
					: new Date(r.created_at).toISOString(),
				due_at_kind: r.expires_at
					? ("payment_deadline" as const)
					: ("created" as const),
				warehouse_id: r.warehouse_id ? String(r.warehouse_id) : null,
				version: Number(r.revision ?? 1),
				amount_idr: Number(r.buyer_total ?? 0),
				reference: String(r.number),
				order_id: String(r.id),
			}));
	}

	if (queue === "fulfillments") {
		if (!hasWarehouses) return [];
		const automated =
			metric === "manual_booking_pending"
				? await automatedWarehouseIds(identity)
				: [];
		const rows = await sql<
			{
				id: string;
				status: string;
				revision: number;
				warehouse_id: string;
				due_at: string | null;
				due_at_kind: "packing_deadline" | "handover_deadline" | "created";
				created_at: string;
				tracking_number: string | null;
				order_number: string;
				order_id: string;
			}[]
		>`
      select f.id,
             s.order_id::text as order_id,
             f.status,
             f.revision,
             s.warehouse_id::text as warehouse_id,
             coalesce(d.packing_due_at, d.handover_due_at, f.created_at) as due_at,
             case when d.packing_due_at is not null then 'packing_deadline'
                  when d.handover_due_at is not null then 'handover_deadline'
                  else 'created' end as due_at_kind,
             f.created_at,
             f.tracking_number,
             (select o.number from app.commerce_order o where o.id = s.order_id) as order_number
      ${fulfillmentsSource(sql, warehouseIds, from, to, metric, automated)}
      order by f.created_at desc, f.id asc
    `;
		return rows
			.filter((r) => !statuses?.length || statuses.includes(r.status))
			.map((r) => ({
				id: String(r.id),
				resource_kind: "fulfillment" as const,
				state: String(r.status),
				due_at: r.due_at ? new Date(r.due_at).toISOString() : null,
				due_at_kind: r.due_at_kind,
				warehouse_id: String(r.warehouse_id),
				version: Number(r.revision ?? 1),
				amount_idr: null,
				reference: String(r.tracking_number ?? r.order_number),
				order_id: String(r.order_id),
			}));
	}

	if (queue === "delivery_exceptions") {
		const rows = await sql<
			{
				id: string;
				status: string;
				revision: number;
				kind: string;
				occurred_at: string;
				warehouse_id: string | null;
				order_number: string | null;
				order_id: string | null;
			}[]
		>`
      select e.id,
             e.order_id::text as order_id,
             e.status,
             e.revision,
             e.kind,
             e.occurred_at,
             (select o.number from app.commerce_order o where o.id = e.order_id) as order_number,
             (
               select s.warehouse_id::text
               from app.order_shipment s
               where s.order_id = e.order_id
               order by s.id
               limit 1
             ) as warehouse_id
      from app.commerce_exception e
      where e.occurred_at >= ${from}::timestamptz
        and e.occurred_at <= ${to}::timestamptz
      order by e.occurred_at desc, e.id asc
    `;
		return rows
			.filter((r) => {
				if (statuses?.length && !statuses.includes(r.status)) return false;
				if (
					hasWarehouses &&
					r.warehouse_id &&
					!warehouseIds.includes(r.warehouse_id)
				)
					return false;
				return true;
			})
			.map((r) => ({
				id: String(r.id),
				resource_kind: "shipment" as const,
				state: String(r.status),
				due_at: new Date(r.occurred_at).toISOString(),
				due_at_kind: "occurred" as const,
				warehouse_id: r.warehouse_id ? String(r.warehouse_id) : null,
				version: Number(r.revision ?? 1),
				amount_idr: null,
				reference: r.order_number ? String(r.order_number) : null,
				order_id: r.order_id ? String(r.order_id) : null,
			}));
	}

	if (queue === "returns") {
		const rows = await sql<
			{
				id: string;
				status: string;
				revision: number;
				created_at: string;
				warehouse_id: string | null;
				merchandise_amount: string;
				order_number: string | null;
				order_id: string | null;
			}[]
		>`
      select rc.id,
             rc.order_id::text as order_id,
             rc.status,
             rc.revision,
             rc.created_at,
             (select o.number from app.commerce_order o where o.id = rc.order_id) as order_number,
             (
               select s.warehouse_id::text
               from app.order_shipment s
               where s.order_id = rc.order_id
               order by s.id
               limit 1
             ) as warehouse_id,
             coalesce((select sum(ri.merchandise_amount) from app.return_item ri where ri.case_id = rc.id), 0)::text as merchandise_amount
      from app.return_case rc
      where rc.created_at >= ${from}::timestamptz
        and rc.created_at <= ${to}::timestamptz
      order by rc.created_at desc, rc.id asc
    `;
		return rows
			.filter((r) => {
				if (statuses?.length && !statuses.includes(r.status)) return false;
				if (
					hasWarehouses &&
					r.warehouse_id &&
					!warehouseIds.includes(r.warehouse_id)
				)
					return false;
				return true;
			})
			.map((r) => ({
				id: String(r.id),
				resource_kind: "return" as const,
				state: String(r.status),
				due_at: new Date(r.created_at).toISOString(),
				due_at_kind: "created" as const,
				warehouse_id: r.warehouse_id ? String(r.warehouse_id) : null,
				version: Number(r.revision ?? 1),
				amount_idr: Number(r.merchandise_amount ?? 0),
				reference: r.order_number ? String(r.order_number) : null,
				order_id: r.order_id ? String(r.order_id) : null,
			}));
	}

	if (queue === "inventory") {
		if (!hasWarehouses) return [];
		const rows = await sql<
			{
				id: string;
				warehouse_id: string;
				available: number;
				revision: number;
				sku: string;
			}[]
		>`
      select p.id, p.warehouse_id::text as warehouse_id, p.available, p.revision, si.sku
      from (${stockPositions(sql, warehouseIds)}) p
      join app.stock_item si on si.id = p.stock_item_id
      order by p.warehouse_id, si.sku
    `;
		return rows
			.map((r) => {
				const available = Number(r.available);
				const state =
					available <= 0
						? "out_of_stock"
						: available <= LOW_STOCK_THRESHOLD
							? "low_stock"
							: "in_stock";
				return {
					id: String(r.id),
					resource_kind: "stock_item" as const,
					state,
					due_at: null,
					due_at_kind: null,
					warehouse_id: String(r.warehouse_id),
					version: Number(r.revision ?? 1),
					amount_idr: null,
					reference: String(r.sku),
					order_id: null,
				};
			})
			.filter((r) =>
				!statuses?.length ? r.state !== "in_stock" : statuses.includes(r.state),
			);
	}

	if (queue === "support") {
		const rows = await sql<
			{
				id: string;
				status: string;
				assigned_user_id: string | null;
				revision: number;
				updated_at: string;
				order_number: string | null;
				order_id: string | null;
			}[]
		>`
      select c.id,
             c.primary_order_id::text as order_id,
             c.status,
             c.assigned_user_id,
             c.revision,
             c.updated_at,
             (select o.number from app.commerce_order o where o.id = c.primary_order_id) as order_number
      from app.support_conversation c
      where c.created_at >= ${from}::timestamptz
        and c.created_at <= ${to}::timestamptz
        ${metric === "support_unassigned" ? sql`and c.assigned_user_id is null and c.status in ('open', 'waiting_customer')` : sql``}
      order by c.updated_at desc, c.id asc
    `;
		return rows
			.filter((r) => !statuses?.length || statuses.includes(r.status))
			.map((r) => ({
				id: String(r.id),
				resource_kind: "conversation" as const,
				state: r.assigned_user_id ? String(r.status) : "unassigned",
				due_at: new Date(r.updated_at).toISOString(),
				due_at_kind: "updated" as const,
				warehouse_id: null,
				version: Number(r.revision ?? 1),
				amount_idr: null,
				reference: r.order_number ? String(r.order_number) : null,
				order_id: r.order_id ? String(r.order_id) : null,
			}));
	}

	if (queue === "reconciliation") {
		const rows = await sql<
			{
				id: string;
				status: string;
				revision: number;
				created_at: string;
				net_amount: string;
				reference: string;
			}[]
		>`
      select ps.id,
             ps.status,
             ps.revision,
             ps.created_at,
             coalesce(lso.net_amount, 0)::text as net_amount,
             coalesce(lso.reference, ps.id::text) as reference
      from app.provider_settlement ps
      left join app.local_settlement_operation lso on lso.id = ps.operation_id
      where ps.created_at >= ${from}::timestamptz
        and ps.created_at <= ${to}::timestamptz
      order by ps.created_at desc, ps.id asc
    `;
		return rows
			.filter((r) => !statuses?.length || statuses.includes(r.status))
			.map((r) => ({
				id: String(r.id),
				resource_kind: "reconciliation" as const,
				state: String(r.status),
				due_at: new Date(r.created_at).toISOString(),
				due_at_kind: "created" as const,
				warehouse_id: null,
				version: Number(r.revision ?? 1),
				amount_idr: Number(r.net_amount ?? 0),
				reference: String(r.reference),
				order_id: null,
			}));
	}

	return [];
}

// Money metrics are company-wide for owner/finance: a requested warehouse_id narrows the counts,
// never the money (the definitions say so).
async function computeMoneyMetrics(
	identity: LocalAuth,
	from: string,
	to: string,
): Promise<
	Record<
		| "cod_receivable"
		| "cod_remitted"
		| "refund_liability"
		| "affiliate_liability"
		| "estimated_contribution"
		| "realized_contribution"
		| "net_merchandise_revenue",
		{
			complete: boolean;
			amount: number | null;
			financial_basis: "actual" | "estimated" | "mixed" | "unknown";
		}
	>
> {
	const sql = identity.sql;

	// 1. COD outstanding (balance snapshot, any order date): frozen COD due (cod_due) of parcels
	// handed to the courier that have no collection outcome yet (no COD receipt, no Mengantar
	// statement line, no collected/refused COD operation). Unshipped and cancelled parcels owe nothing.
	// Limitation: a parcel returned to sender stays here until an outcome is recorded (RTS handling
	// of manual parcels is the DEC-007 (6) follow-up).
	const [codRow] = await sql<{ amount: string }[]>`
    select coalesce(sum(s.cod_due), 0)::text as amount
    from app.order_shipment s
    join app.commerce_order o on o.id = s.order_id
    where o.payment_method = 'cod'
      and exists (select 1 from app.fulfillment f where f.shipment_id = s.id and f.handover_at is not null)
      and not exists (select 1 from app.economic_receipt r where r.shipment_id = s.id and r.kind = 'cod')
      and not exists (select 1 from app.cod_remittance_line l where l.shipment_id = s.id)
      and not exists (select 1 from app.local_cod_operation c where c.shipment_id = s.id and c.status in ('collected', 'refused'))
  `;

	// 1b. COD remitted: per-parcel collected amounts on Mengantar COD statements dated in the period
	// (gross, before Mengantar's shipping/COD-fee deductions), as finance recorded them (S91).
	const [remittedRow] = await sql<{ amount: string }[]>`
    select coalesce(sum(l.amount), 0)::text as amount
    from app.cod_remittance_line l
    join app.cod_remittance r on r.id = l.remittance_id
    where r.statement_at >= ${from}::timestamptz
      and r.statement_at <= ${to}::timestamptz
  `;

	// 2. Refund liability: pending/approved refunds + recovery refunds not yet completed
	const [refundRow] = await sql<{ amount: string }[]>`
    select (
      coalesce((
        select sum(r.amount) from app.refund r
        where r.created_at >= ${from}::timestamptz and r.created_at <= ${to}::timestamptz
          and r.status not in ('completed', 'cancelled', 'rejected')
      ), 0) +
      coalesce((
        select sum(rr.amount) from app.recovery_refund rr
        where rr.created_at >= ${from}::timestamptz and rr.created_at <= ${to}::timestamptz
          and rr.status not in ('completed', 'cancelled', 'rejected')
      ), 0)
    )::text as amount
  `;

	// 3. Affiliate liability: unpaid commission entries + active payouts
	const [affiliateRow] = await sql<{ amount: string }[]>`
    select coalesce(sum(ce.amount_idr), 0)::text as amount
    from app.commission_entry ce
    where ce.created_at >= ${from}::timestamptz
      and ce.created_at <= ${to}::timestamptz
      and ce.status in ('pending', 'available', 'claimed')
  `;

	// 4. Net merchandise revenue: verified economic receipts minus confirmed refund allocations
	const [revenueRow] = await sql<{ gross: string; refunded: string }[]>`
    select
      coalesce((
        select sum(er.merchandise_amount)
        from app.economic_receipt er
        where er.occurred_at >= ${from}::timestamptz
          and er.occurred_at <= ${to}::timestamptz
      ), 0)::text as gross,
      (
        coalesce((
          select sum(ra.merchandise_amount)
          from app.refund_allocation ra
          join app.refund r on r.id = ra.refund_id
          where r.created_at >= ${from}::timestamptz
            and r.created_at <= ${to}::timestamptz
            and r.status = 'completed'
        ), 0) +
        coalesce((
          select sum(rra.merchandise_amount)
          from app.recovery_refund_allocation rra
          join app.recovery_refund rr on rr.id = rra.refund_id
          where rr.created_at >= ${from}::timestamptz
            and rr.created_at <= ${to}::timestamptz
            and rr.status = 'completed'
        ), 0)
      )::text as refunded
  `;
	const netMerchandiseRevenue = Math.max(
		0,
		Number(revenueRow.gross) - Number(revenueRow.refunded),
	);

	// 5. Contribution metrics: check if any order_item in the window lacks a known component cost version or offer cost assumption!
	// Let's also check if any stock_item exists without a component_cost_version when orders exist, or if any offer lacks cost assumptions.
	const orderItems = await sql<
		{
			item_id: string;
			quantity: number;
			unit_price: number;
			offer_id: string;
			publication_id: string;
			subsidy_amount: string;
			has_pub_cost: boolean;
			pub_unit_cost: string | null;
			has_offer_assumption: boolean;
			assumption_cost: string | null;
		}[]
	>`
    select oi.id as item_id,
           oi.quantity,
           oi.unit_price,
           oi.offer_id,
           oi.publication_id,
           o.subsidy_amount::text as subsidy_amount,
           exists (
             select 1 from app.publication_component_cost pcc
             where pcc.publication_id = oi.publication_id and pcc.offer_id = oi.offer_id
           ) as has_pub_cost,
           (
             select sum(pcc.quantity * ccv.unit_cost)::text
             from app.publication_component_cost pcc
             join app.component_cost_version ccv on ccv.id = pcc.cost_version_id
             where pcc.publication_id = oi.publication_id and pcc.offer_id = oi.offer_id
           ) as pub_unit_cost,
           exists (
             select 1 from app.offer_cost_assumption_version oca
             where oca.offer_id = oi.offer_id
               and oca.effective_at <= ${to}::timestamptz
           ) as has_offer_assumption,
           (
             select (oca.packaging_idr + oca.provider_fee_idr + oca.returns_reserve_idr)::text
             from app.offer_cost_assumption_version oca
             where oca.offer_id = oi.offer_id
               and oca.effective_at <= ${to}::timestamptz
             order by oca.revision desc
             limit 1
           ) as assumption_cost
    from app.order_item oi
    join app.commerce_order o on o.id = oi.order_id
    where o.created_at >= ${from}::timestamptz
      and o.created_at <= ${to}::timestamptz
  `;

	// Check if any component_cost_version existed as of the end of the window `to`
	const [costCoverage] = await sql<{ count: string }[]>`
    select count(*)::text as count
    from app.component_cost_version ccv
    where ccv.effective_at <= ${to}::timestamptz
  `;

	const hasMissingCostSource =
		Number(costCoverage.count) === 0 ||
		orderItems.some(
			(item) =>
				!item.has_pub_cost ||
				item.pub_unit_cost === null ||
				!item.has_offer_assumption,
		);

	let estimatedContribution: {
		complete: boolean;
		amount: number | null;
		financial_basis: "actual" | "estimated" | "mixed" | "unknown";
	};
	let realizedContribution: {
		complete: boolean;
		amount: number | null;
		financial_basis: "actual" | "estimated" | "mixed" | "unknown";
	};

	if (hasMissingCostSource) {
		estimatedContribution = {
			complete: false,
			amount: null,
			financial_basis: "unknown",
		};
		realizedContribution = {
			complete: false,
			amount: null,
			financial_basis: "unknown",
		};
	} else {
		let estTotal = 0;
		for (const item of orderItems) {
			const revenue = Number(item.quantity) * Number(item.unit_price);
			const unitCost =
				Number(item.pub_unit_cost ?? 0) + Number(item.assumption_cost ?? 0);
			estTotal += revenue - Number(item.quantity) * unitCost;
		}
		estimatedContribution = {
			complete: true,
			amount: estTotal,
			financial_basis: "estimated",
		};
		realizedContribution = {
			complete: true,
			amount: netMerchandiseRevenue === 0 ? 0 : estTotal,
			financial_basis: "actual",
		};
	}

	return {
		cod_receivable: {
			complete: true,
			amount: Math.max(0, Number(codRow.amount)),
			financial_basis: "actual",
		},
		cod_remitted: {
			complete: true,
			amount: Math.max(0, Number(remittedRow.amount)),
			financial_basis: "actual",
		},
		refund_liability: {
			complete: true,
			amount: Math.max(0, Number(refundRow.amount)),
			financial_basis: "actual",
		},
		affiliate_liability: {
			complete: true,
			amount: Math.max(0, Number(affiliateRow.amount)),
			financial_basis: "actual",
		},
		estimated_contribution: estimatedContribution,
		realized_contribution: realizedContribution,
		net_merchandise_revenue: {
			complete: true,
			amount: netMerchandiseRevenue,
			financial_basis: "actual",
		},
	};
}

export async function getDashboardSnapshot(
	request: Request,
	identity: LocalAuth,
) {
	const url = new URL(request.url);
	if (
		["authorization", "x-cart-token", "x-order-token"].some((h) =>
			request.headers.has(h),
		)
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	const allowedParams = new Set([
		"workspace",
		"warehouse_id",
		"from",
		"to",
		"window",
		"as_of",
		"metric",
	]);
	for (const key of url.searchParams.keys()) {
		if (!allowedParams.has(key) || url.searchParams.getAll(key).length !== 1) {
			throw new AccessError(400, "INVALID_INPUT");
		}
	}

	const principal = await getPrincipal(request, identity);
	const workspace = resolveWorkspace(
		principal,
		url.searchParams.get("workspace"),
	);
	const requestedMetric = url.searchParams.get("metric") as MetricKey | null;
	if (requestedMetric) {
		if (!WORKSPACE_METRICS[workspace].includes(requestedMetric)) {
			throw new AccessError(403, "FORBIDDEN");
		}
	}

	const requestedWarehouseId = url.searchParams.get("warehouse_id");
	const warehouseIds = await resolveAuthorizedWarehouses(
		identity,
		principal,
		workspace,
		requestedWarehouseId,
	);

	const [clock] = await identity.sql<
		{ now: string }[]
	>`select clock_timestamp() as now`;
	const rawAsOf = url.searchParams.get("as_of");
	const asOf = rawAsOf
		? new Date(Date.parse(rawAsOf)).toISOString()
		: new Date(clock.now).toISOString();
	if (Number.isNaN(Date.parse(asOf)))
		throw new AccessError(400, "INVALID_INPUT");

	const { from, to } = resolveDateRange(url, asOf);
	const filterExpiresAt = new Date(
		Date.parse(asOf) + 30 * 60_000,
	).toISOString();

	const allowedKeys = WORKSPACE_METRICS[workspace];
	const sql = identity.sql;
	type Counted = {
		count: number;
		breakdown: { key: string; label: string; count: number }[] | null;
	};
	// Cards are SQL counts over the same fragments the drilldown pages list; rows are only
	// materialized for the drilldown (and for the small exception/return/support/settlement queues).
	// One grouped scan serves both order cards (same period and scope; active is a subset of placed).
	let orderCounts: Promise<
		{ channel: string; placed: number; active: number }[]
	> | null = null;
	const ordersByChannel = () => {
		orderCounts ??= (async () =>
			sql<{ channel: string; placed: number; active: number }[]>`
        select coalesce(o.payment_channel, case when o.payment_method = 'cod' then 'cod' else 'local-prepaid' end) as channel,
               count(*)::int as placed,
               count(*) filter (where o.status in ('pending', 'processing'))::int as active
        ${ordersSource(sql, warehouseIds, from, to, "orders_by_payment_method", asOf)}
        group by 1
      `)();
		return orderCounts;
	};
	const countOf = async (
		fragment: ReturnType<typeof ordersSource>,
	): Promise<number> =>
		Number((await sql<{ n: number }[]>`select count(*)::int as n ${fragment}`)[0].n);
	const countFor = async (key: MetricKey): Promise<Counted> => {
		if (key === "orders_pending" || key === "orders_by_payment_method") {
			const groups = await ordersByChannel();
			if (key === "orders_pending")
				return {
					count: groups.reduce((n, g) => n + g.active, 0),
					breakdown: null,
				};
			const placed = new Map(groups.map((g) => [g.channel, g.placed]));
			return {
				count: groups.reduce((n, g) => n + g.placed, 0),
				// The three launch methods always show (0 included); the local simulation only when present.
				breakdown: Object.entries(PAYMENT_CHANNEL_LABELS)
					.filter(([k]) => k !== "local-prepaid" || placed.has(k))
					.map(([k, label]) => ({ key: k, label, count: placed.get(k) ?? 0 })),
			};
		}
		if (PAYMENT_QUEUE_METRICS.has(key))
			return {
				count: await countOf(ordersSource(sql, warehouseIds, from, to, key, asOf)),
				breakdown: null,
			};
		if (key === "fulfillments_due" || key === "manual_booking_pending") {
			if (warehouseIds.length === 0) return { count: 0, breakdown: null };
			const ids =
				key === "manual_booking_pending"
					? await automatedWarehouseIds(identity)
					: [];
			return {
				count: await countOf(
					fulfillmentsSource(sql, warehouseIds, from, to, key, ids),
				),
				breakdown: null,
			};
		}
		if (key === "stock_alerts") {
			if (warehouseIds.length === 0) return { count: 0, breakdown: [] };
			// Per origin warehouse with at least one alert, most alerts first.
			const perWarehouse = await sql<
				{ id: string; name: string; n: number }[]
			>`
        select w.id::text as id, w.name, count(*)::int as n
        from (${stockPositions(sql, warehouseIds)}) p join app.warehouse w on w.id = p.warehouse_id
        where p.available <= ${LOW_STOCK_THRESHOLD}
        group by w.id, w.name
        order by n desc, w.name
      `;
			return {
				count: perWarehouse.reduce((n, w) => n + w.n, 0),
				breakdown: perWarehouse.map((w) => ({
					key: w.id,
					label: w.name,
					count: w.n,
				})),
			};
		}
		const rows = await queryQueueRows(
			identity,
			METRIC_QUEUE_MAP[key],
			warehouseIds,
			from,
			to,
			undefined,
			{ metric: key, asOf },
		);
		return { count: rows.length, breakdown: null };
	};

	const needsMoney = allowedKeys.some((k) => MONEY_METRICS.has(k));
	const moneyValues = needsMoney
		? await computeMoneyMetrics(identity, from, to)
		: null;

	// Each text states exactly what its query counts (S103).
	const definitions: Record<MetricKey, string> = {
		orders_pending:
			"Pesanan yang dibuat dalam periode dan masih berstatus menunggu atau diproses. Pesanan dibatalkan atau selesai tidak dihitung.",
		orders_by_payment_method:
			"Pesanan yang dibuat dalam periode (semua status kecuali draf checkout), dirinci per metode bayar: COD, transfer manual, dan VA/QRIS AutoLaris.",
		fulfillments_due:
			"Paket gudang yang dibuat dalam periode dan belum diserahkan ke kurir, termasuk paket bermasalah.",
		manual_booking_pending:
			"Paket di antrean Pengiriman Manual \"Perlu dipesan kurir\" saat ini: belum ada resi, belum dipesan lewat sistem, dan masih ada unit aktif.",
		delivery_exceptions:
			"Kendala pengiriman yang tercatat dalam periode dan belum selesai.",
		returns_pending:
			"Pengajuan retur atau penukaran yang dibuat dalam periode dan belum ditolak atau selesai.",
		stock_alerts: `Posisi stok (gudang dan SKU) saat ini dengan stok tersedia paling banyak ${LOW_STOCK_THRESHOLD} unit. Tersedia = stok fisik dikurangi stok dipesan dan karantina, tanpa lot kedaluwarsa, sama seperti ketersediaan katalog.`,
		support_unassigned:
			"Percakapan terbuka atau menunggu pembeli yang dibuat dalam periode dan belum punya staf penanggung jawab.",
		finance_unmatched:
			"Mutasi penyelesaian pembayaran/COD yang dibuat dalam periode dan belum cocok (masih disiapkan, menunggu, cocok sebagian, tidak cocok, atau bermasalah).",
		transfers_near_deadline: `Transfer bank manual yang masih terbuka di antrean Pembayaran (belum dikonfirmasi keuangan) dengan batas bayar tinggal ${TRANSFER_DEADLINE_WARNING_HOURS} jam atau kurang, atau sudah lewat. Seluruh perusahaan, tanpa filter gudang.`,
		autolaris_pending:
			"Pesanan dengan pembayaran VA/QRIS AutoLaris yang masih terbuka di antrean Pembayaran (belum lunas, gagal, atau kedaluwarsa). Seluruh perusahaan, tanpa filter gudang.",
		cod_receivable:
			"COD belum disetor, saldo saat ini untuk seluruh perusahaan (tanpa filter periode dan gudang): tagihan COD paket yang sudah diserahkan ke kurir tetapi belum punya hasil penagihan atau laporan setoran Mengantar. Paket yang diretur ke pengirim tetap terhitung sampai hasilnya dicatat.",
		cod_remitted:
			"COD sudah disetor untuk seluruh perusahaan (tanpa filter gudang): nilai COD per paket pada laporan setoran Mengantar bertanggal dalam periode, sebelum potongan ongkir dan biaya COD Mengantar.",
		refund_liability:
			"Kewajiban pengembalian dana pelanggan yang masih berjalan dalam Rupiah (IDR).",
		affiliate_liability:
			"Kewajiban komisi afiliasi tertunda atau siap cair dalam Rupiah (IDR).",
		estimated_contribution:
			"Estimasi kontribusi margin berdasarkan sumber biaya komponen dan asumsi penawaran yang lengkap.",
		realized_contribution:
			"Kontribusi terealisasi setelah penerimaan kas terverifikasi dan biaya komponen lengkap.",
		net_merchandise_revenue:
			"Pendapatan bersih barang dagangan (penerimaan terverifikasi dikurangi alokasi refund selesai).",
	};

	const metrics = [];
	for (const key of allowedKeys) {
		const queueKey = METRIC_QUEUE_MAP[key];
		const isMoney = MONEY_METRICS.has(key);
		const tokenPayload = {
			v: 1,
			actor_id: principal.id,
			workspace,
			warehouse_hash: digest(JSON.stringify(warehouseIds)),
			requested_warehouse_id: requestedWarehouseId,
			from,
			to,
			as_of: asOf,
			metric_key: key,
			queue_key: queueKey,
			exp: filterExpiresAt,
		};
		const queueFilterToken = signTokenPayload(tokenPayload);
		const common = {
			key,
			queue_key: queueKey,
			definition: definitions[key],
			as_of: asOf,
			action_href: METRIC_ACTION_HREF[key] ?? null,
			queue_filter_token: queueFilterToken,
			filter_version: 1,
			filter_expires_at: filterExpiresAt,
		};

		if (!isMoney) {
			const counted = await countFor(key);
			metrics.push({
				...common,
				count: counted.count,
				basis: SNAPSHOT_METRICS.has(key)
					? ("snapshot" as const)
					: ("event_period" as const),
				complete: true,
				kind: "count" as const,
				amount: null,
				currency: null,
				financial_basis: "not_applicable" as const,
				breakdown: counted.breakdown,
			});
		} else {
			const m = moneyValues?.[key as keyof NonNullable<typeof moneyValues>];
			const complete = m?.complete ?? false;
			metrics.push({
				...common,
				count: null,
				basis:
					key === "cod_receivable"
						? ("snapshot" as const)
						: ("event_period" as const),
				complete,
				kind: "money" as const,
				amount: complete ? (m?.amount ?? 0) : null,
				currency: "IDR" as const,
				financial_basis: m?.financial_basis ?? "unknown",
				breakdown: null,
			});
		}
	}

	return {
		workspace,
		warehouse_ids: warehouseIds,
		from,
		to,
		timezone: "Asia/Jakarta",
		as_of: asOf,
		metrics,
	};
}

export async function listWorkQueue(request: Request, identity: LocalAuth) {
	const url = new URL(request.url);
	if (
		["authorization", "x-cart-token", "x-order-token"].some((h) =>
			request.headers.has(h),
		)
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	const allowedParams = new Set([
		"workspace",
		"queue",
		"warehouse_id",
		"from",
		"to",
		"window",
		"filter_token",
		"drilldown_token",
		"cursor",
		"limit",
	]);
	for (const key of url.searchParams.keys()) {
		if (!allowedParams.has(key) || url.searchParams.getAll(key).length !== 1) {
			throw new AccessError(400, "INVALID_INPUT");
		}
	}

	const principal = await getPrincipal(request, identity);
	const workspace = resolveWorkspace(
		principal,
		url.searchParams.get("workspace"),
	);
	const rawQueue = url.searchParams.get("queue") as QueueKey | null;
	if (!rawQueue || !WORKSPACE_QUEUES.owner.includes(rawQueue)) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	if (!WORKSPACE_QUEUES[workspace].includes(rawQueue)) {
		throw new AccessError(403, "FORBIDDEN");
	}

	const requestedWarehouseId = url.searchParams.get("warehouse_id");
	const warehouseIds = await resolveAuthorizedWarehouses(
		identity,
		principal,
		workspace,
		requestedWarehouseId,
	);

	const [clock] = await identity.sql<
		{ now: string }[]
	>`select clock_timestamp() as now`;
	const nowIso = new Date(clock.now).toISOString();

	const filterToken =
		url.searchParams.get("filter_token") ??
		url.searchParams.get("drilldown_token");
	let from: string;
	let to: string;
	let scope: MetricScope | undefined;

	if (filterToken) {
		const decoded = verifyTokenPayload(filterToken);
		if (decoded.actor_id !== principal.id) {
			throw new AccessError(403, "FORBIDDEN");
		}
		if (
			typeof decoded.exp !== "string" ||
			Date.parse(decoded.exp) <= Date.parse(nowIso)
		) {
			throw new AccessError(409, "FILTER_TOKEN_EXPIRED");
		}
		if (decoded.workspace !== workspace || decoded.queue_key !== rawQueue) {
			throw new AccessError(409, "DRILLDOWN_SCOPE_MISMATCH");
		}
		if (decoded.warehouse_hash !== digest(JSON.stringify(warehouseIds))) {
			throw new AccessError(409, "DRILLDOWN_SCOPE_MISMATCH");
		}
		if (
			requestedWarehouseId !== null &&
			decoded.requested_warehouse_id !== null &&
			requestedWarehouseId !== decoded.requested_warehouse_id
		) {
			throw new AccessError(409, "DRILLDOWN_SCOPE_MISMATCH");
		}
		const rawFrom = url.searchParams.get("from");
		const rawTo = url.searchParams.get("to");
		if (
			(rawFrom && Date.parse(rawFrom) !== Date.parse(String(decoded.from))) ||
			(rawTo && Date.parse(rawTo) !== Date.parse(String(decoded.to)))
		) {
			throw new AccessError(409, "DRILLDOWN_SCOPE_MISMATCH");
		}
		from = String(decoded.from);
		to = String(decoded.to);
		const key = decoded.metric_key as MetricKey;
		// Count metrics carry their exact filter into the drilldown; money metrics open the plain queue.
		if (
			Object.hasOwn(METRIC_QUEUE_MAP, key) &&
			METRIC_QUEUE_MAP[key] === rawQueue &&
			!MONEY_METRICS.has(key)
		) {
			scope = { metric: key, asOf: String(decoded.as_of ?? nowIso) };
		}
	} else {
		const range = resolveDateRange(url, nowIso);
		from = range.from;
		to = range.to;
	}

	const rawLimit = url.searchParams.get("limit") ?? "20";
	if (
		!/^\d{1,3}$/.test(rawLimit) ||
		Number(rawLimit) < 1 ||
		Number(rawLimit) > 100
	) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const limit = Number(rawLimit);
	const cursor = url.searchParams.get("cursor");
	if (cursor !== null && !UUID_RE.test(cursor)) {
		throw new AccessError(400, "INVALID_INPUT");
	}

	const allRows = await queryQueueRows(
		identity,
		rawQueue,
		warehouseIds,
		from,
		to,
		undefined,
		scope,
	);
	let startIndex = 0;
	if (cursor) {
		const idx = allRows.findIndex((r) => r.id === cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_INPUT");
		startIndex = idx + 1;
	}
	const pageRows = allRows.slice(startIndex, startIndex + limit);
	const nextCursor =
		startIndex + limit < allRows.length
			? (pageRows[pageRows.length - 1]?.id ?? null)
			: null;

	return {
		data: pageRows.map((row) => ({
			id: row.id,
			resource_kind: row.resource_kind,
			state: row.state,
			due_at: row.due_at,
			due_at_kind: row.due_at_kind,
			warehouse_id: row.warehouse_id,
			version: row.version,
			reference: row.reference,
			order_id: row.order_id,
		})),
		pagination: {
			next_cursor: nextCursor,
		},
	};
}

const RESOURCE_QUEUE_MAP: Record<string, QueueKey> = {
	orders: "orders",
	fulfillments: "fulfillments",
	inventory: "inventory",
	returns: "returns",
	reconciliation: "reconciliation",
};

const RESOURCE_COLUMN_SETS: Record<string, string[]> = {
	orders: ["order_service"],
	fulfillments: ["warehouse_operations"],
	inventory: ["inventory_operations"],
	returns: ["return_service"],
	reconciliation: ["finance_reconciliation"],
};

function authorizeExportResource(
	principal: Principal,
	resource: string,
	columnSet?: string,
): CanonicalWorkspace {
	const workspace = resolveWorkspace(principal, null);
	const isOwner = principal.roles.includes("owner");
	if (!Object.hasOwn(RESOURCE_QUEUE_MAP, resource)) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	if (columnSet !== undefined) {
		const allowedSets = RESOURCE_COLUMN_SETS[resource] ?? [];
		if (!allowedSets.includes(columnSet)) {
			throw new AccessError(403, "FORBIDDEN");
		}
	}
	if (isOwner) return "owner";
	if (resource === "reconciliation" && !principal.roles.includes("finance")) {
		throw new AccessError(403, "FORBIDDEN");
	}
	if (
		resource === "orders" &&
		!principal.roles.some((r) =>
			["ecommerce_admin", "customer_service", "finance"].includes(r),
		)
	) {
		throw new AccessError(403, "FORBIDDEN");
	}
	if (
		resource === "fulfillments" &&
		!principal.roles.some((r) => ["warehouse", "ecommerce_admin"].includes(r))
	) {
		throw new AccessError(403, "FORBIDDEN");
	}
	if (
		resource === "inventory" &&
		!principal.roles.some((r) => ["warehouse", "ecommerce_admin"].includes(r))
	) {
		throw new AccessError(403, "FORBIDDEN");
	}
	if (
		resource === "returns" &&
		!principal.roles.some((r) =>
			["warehouse", "customer_service", "ecommerce_admin", "finance"].includes(
				r,
			),
		)
	) {
		throw new AccessError(403, "FORBIDDEN");
	}
	return workspace;
}

export async function createExportSelection(
	request: Request,
	identity: LocalAuth,
) {
	assertOrigin(request);
	const url = new URL(request.url);
	if (url.search) throw new AccessError(400, "INVALID_INPUT");
	if (
		["authorization", "x-cart-token", "x-order-token"].some((h) =>
			request.headers.has(h),
		)
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}

	const principal = await getPrincipal(request, identity);
	const body = await readBody(request);

	const resource = typeof body.resource === "string" ? body.resource : "";
	const workspace = authorizeExportResource(principal, resource);

	const requestedWarehouseId =
		body.warehouse_id === null || body.warehouse_id === undefined
			? null
			: typeof body.warehouse_id === "string"
				? body.warehouse_id
				: "__invalid__";
	if (requestedWarehouseId === "__invalid__")
		throw new AccessError(400, "INVALID_INPUT");

	const warehouseIds = await resolveAuthorizedWarehouses(
		identity,
		principal,
		workspace,
		requestedWarehouseId,
	);

	const rawFrom = typeof body.from === "string" ? body.from : null;
	const rawTo = typeof body.to === "string" ? body.to : null;
	const [clock] = await identity.sql<
		{ now: string }[]
	>`select clock_timestamp() as now`;
	const asOf = new Date(clock.now).toISOString();

	const from = rawFrom
		? new Date(Date.parse(rawFrom)).toISOString()
		: new Date(Date.parse(asOf) - 30 * 86400_000).toISOString();
	const to = rawTo
		? new Date(Date.parse(rawTo)).toISOString()
		: new Date(Date.parse(asOf) + 60_000).toISOString();
	if (
		Number.isNaN(Date.parse(from)) ||
		Number.isNaN(Date.parse(to)) ||
		Date.parse(from) >= Date.parse(to)
	) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	if (Date.parse(to) - Date.parse(from) > 366 * 86400_000) {
		throw new AccessError(400, "WINDOW_TOO_WIDE");
	}

	const statuses = Array.isArray(body.statuses)
		? body.statuses.filter(
				(s): s is string =>
					typeof s === "string" && s.length > 0 && s.length <= 80,
			)
		: [];
	const maxRows = typeof body.max_rows === "number" ? body.max_rows : 1000;
	if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 1000) {
		throw new AccessError(400, "INVALID_INPUT");
	}

	// Optional explicit rows with expected_version check (for bulk preview / selection validation)
	const expectedVersions = new Map<string, number>();
	if (Array.isArray(body.items)) {
		for (const item of body.items) {
			if (!item || typeof item !== "object")
				throw new AccessError(400, "INVALID_INPUT");
			const rec = item as Record<string, unknown>;
			if (typeof rec.id !== "string" || !UUID_RE.test(rec.id))
				throw new AccessError(400, "INVALID_INPUT");
			if (typeof rec.expected_version === "number") {
				expectedVersions.set(rec.id, rec.expected_version);
			}
		}
	}

	const queueKey = RESOURCE_QUEUE_MAP[resource];
	const allRows = await queryQueueRows(
		identity,
		queueKey,
		warehouseIds,
		from,
		to,
		statuses,
	);

	let selectedRows = allRows;
	if (expectedVersions.size > 0 || Array.isArray(body.resource_ids)) {
		const requestedIds: string[] = Array.isArray(body.resource_ids)
			? body.resource_ids.map(String)
			: [...expectedVersions.keys()];
		for (const id of requestedIds) {
			if (!UUID_RE.test(id)) throw new AccessError(400, "INVALID_INPUT");
		}
		const rowById = new Map(allRows.map((r) => [r.id, r]));
		selectedRows = [];
		for (const id of requestedIds) {
			const found = rowById.get(id);
			if (!found) {
				// Check if row exists in another warehouse -> 403 FORBIDDEN
				const unfilteredRows = await queryQueueRows(
					identity,
					queueKey,
					[],
					from,
					to,
				);
				if (unfilteredRows.some((r) => r.id === id)) {
					throw new AccessError(403, "FORBIDDEN");
				}
				throw new AccessError(404, "NOT_FOUND");
			}
			if (
				expectedVersions.has(id) &&
				found.version !== expectedVersions.get(id)
			) {
				throw new AccessError(409, "STALE_VERSION");
			}
			selectedRows.push(found);
		}
	}

	if (selectedRows.length > maxRows) {
		throw new AccessError(422, "EXPORT_ROW_LIMIT_EXCEEDED");
	}

	const expiresAt = new Date(Date.parse(asOf) + 30 * 60_000).toISOString();
	const selectionId = randomUUID();
	const rowSnapshot = selectedRows.map((r) => ({
		id: r.id,
		version: r.version,
		warehouse_id: r.warehouse_id,
	}));
	const filterHash = digest(
		JSON.stringify({
			resource,
			warehouse_ids: warehouseIds,
			from,
			to,
			statuses,
			rows: rowSnapshot,
		}),
	);
	const filterToken = signTokenPayload({
		selection_id: selectionId,
		actor_id: principal.id,
		resource,
		warehouse_hash: digest(JSON.stringify(warehouseIds)),
		from,
		to,
		filter_hash: filterHash,
		filter_version: 1,
		exp: expiresAt,
	});
	const tokenDigest = digest(filterToken);

	await identity.sql`
    insert into app.admin_export_selection (
      id, actor_id, scope, filter_hash, row_ids, token_digest, expires_at
    ) values (
      ${selectionId}::uuid,
      ${principal.id},
      ${`${workspace}:${resource}`},
      ${filterHash},
      ${JSON.stringify(rowSnapshot)}::jsonb,
      ${tokenDigest},
      ${expiresAt}::timestamptz
    )
  `;

	return {
		filter_token: filterToken,
		filter_version: 1,
		expires_at: expiresAt,
		row_count: selectedRows.length,
		as_of: asOf,
	};
}

export function sanitizeCsvCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	let str = String(value);
	if (/^[=+\-@\t\r]/.test(str)) {
		str = `'${str}`;
	}
	if (/[",\n\r]/.test(str)) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

export async function exportCsv(
	request: Request,
	identity: LocalAuth,
): Promise<Response> {
	assertOrigin(request);
	const url = new URL(request.url);
	if (url.search) throw new AccessError(400, "INVALID_INPUT");
	if (
		["authorization", "x-cart-token", "x-order-token"].some((h) =>
			request.headers.has(h),
		)
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}

	const principal = await getPrincipal(request, identity);
	const body = await readBody(request);

	const resource = typeof body.resource === "string" ? body.resource : "";
	const columnSet = typeof body.column_set === "string" ? body.column_set : "";
	const reason = typeof body.reason === "string" ? body.reason.trim() : "";
	if (!reason || reason.length > 1000)
		throw new AccessError(400, "INVALID_INPUT");

	const workspace = authorizeExportResource(principal, resource, columnSet);
	const warehouseIds = await resolveAuthorizedWarehouses(
		identity,
		principal,
		workspace,
		null,
	);

	const selection = body.selection;
	if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const sel = selection as Record<string, unknown>;
	const mode = sel.mode;

	const [clock] = await identity.sql<
		{ now: string }[]
	>`select clock_timestamp() as now`;
	const nowIso = new Date(clock.now).toISOString();
	const wideFrom = new Date(Date.parse(nowIso) - 365 * 86400_000).toISOString();
	const wideTo = new Date(Date.parse(nowIso) + 86400_000).toISOString();

	const queueKey = RESOURCE_QUEUE_MAP[resource];
	const targetRows: QueueRowInternal[] = [];

	if (mode === "filtered_snapshot") {
		if (sel.resource_ids !== undefined)
			throw new AccessError(400, "INVALID_INPUT");
		const filterToken =
			typeof sel.filter_token === "string" ? sel.filter_token : "";
		const filterVersion =
			typeof sel.filter_version === "number" ? sel.filter_version : 0;
		if (!filterToken || filterVersion < 1)
			throw new AccessError(400, "INVALID_INPUT");

		const decoded = verifyTokenPayload(filterToken);
		if (decoded.actor_id !== principal.id)
			throw new AccessError(403, "FORBIDDEN");
		if (
			decoded.resource !== resource ||
			decoded.filter_version !== filterVersion
		) {
			throw new AccessError(409, "EXPORT_SELECTION_MISMATCH");
		}

		const tokenDigest = digest(filterToken);
		const [stored] = await identity.sql<
			{
				id: string;
				actor_id: string;
				row_ids: { id: string; version: number; warehouse_id: string | null }[];
				expires_at: string;
			}[]
		>`
      select id, actor_id, row_ids, expires_at
      from app.admin_export_selection
      where token_digest = ${tokenDigest}
    `;
		if (!stored) throw new AccessError(409, "EXPORT_SELECTION_NOT_FOUND");
		if (stored.actor_id !== principal.id)
			throw new AccessError(403, "FORBIDDEN");
		if (Date.parse(stored.expires_at) <= Date.parse(nowIso)) {
			throw new AccessError(409, "EXPORT_SELECTION_EXPIRED");
		}

		const currentRows = await queryQueueRows(
			identity,
			queueKey,
			warehouseIds,
			String(decoded.from ?? wideFrom),
			String(decoded.to ?? wideTo),
		);
		const currentById = new Map(currentRows.map((r) => [r.id, r]));

		for (const snap of stored.row_ids) {
			const live = currentById.get(snap.id);
			if (!live) {
				// Check if it exists outside authorized warehouse scope
				const allUnscoped = await queryQueueRows(
					identity,
					queueKey,
					[],
					wideFrom,
					wideTo,
				);
				if (allUnscoped.some((r) => r.id === snap.id)) {
					throw new AccessError(403, "FORBIDDEN");
				}
				throw new AccessError(409, "EXPORT_ROW_MISSING_OR_STALE");
			}
			if (live.version !== snap.version) {
				throw new AccessError(409, "STALE_VERSION");
			}
			targetRows.push(live);
		}

		await identity.sql`
      update app.admin_export_selection
      set consumed_at = clock_timestamp()
      where id = ${stored.id}::uuid
    `;
	} else if (mode === "explicit_page") {
		if (sel.filter_token !== undefined || sel.filter_version !== undefined) {
			throw new AccessError(400, "INVALID_INPUT");
		}
		if (
			!Array.isArray(sel.resource_ids) ||
			sel.resource_ids.length < 1 ||
			sel.resource_ids.length > 100
		) {
			throw new AccessError(400, "INVALID_INPUT");
		}
		const ids = sel.resource_ids.map(String);
		if (
			new Set(ids).size !== ids.length ||
			ids.some((id) => !UUID_RE.test(id))
		) {
			throw new AccessError(400, "INVALID_INPUT");
		}
		const expectedVersions =
			sel.expected_versions &&
			typeof sel.expected_versions === "object" &&
			!Array.isArray(sel.expected_versions)
				? (sel.expected_versions as Record<string, number>)
				: {};

		const currentRows = await queryQueueRows(
			identity,
			queueKey,
			warehouseIds,
			wideFrom,
			wideTo,
		);
		const currentById = new Map(currentRows.map((r) => [r.id, r]));
		const allUnscoped = await queryQueueRows(
			identity,
			queueKey,
			[],
			wideFrom,
			wideTo,
		);
		const unscopedById = new Map(allUnscoped.map((r) => [r.id, r]));

		for (const id of ids) {
			const live = currentById.get(id);
			if (!live) {
				if (unscopedById.has(id)) {
					throw new AccessError(403, "FORBIDDEN");
				}
				throw new AccessError(404, "NOT_FOUND");
			}
			if (
				expectedVersions[id] !== undefined &&
				live.version !== expectedVersions[id]
			) {
				throw new AccessError(409, "STALE_VERSION");
			}
			targetRows.push(live);
		}
	} else {
		throw new AccessError(400, "INVALID_INPUT");
	}

	if (targetRows.length > 1000) {
		throw new AccessError(422, "EXPORT_ROW_LIMIT_EXCEEDED");
	}

	// Build role-appropriate CSV columns (warehouse never gets whole-order money or private buyer fields)
	const includeMoney =
		columnSet === "finance_reconciliation" ||
		(columnSet === "order_service" &&
			(principal.roles.includes("owner") ||
				principal.roles.includes("finance")));

	const headers = includeMoney
		? [
				"id",
				"resource_kind",
				"state",
				"warehouse_id",
				"due_at",
				"version",
				"reference",
				"amount_idr",
			]
		: [
				"id",
				"resource_kind",
				"state",
				"warehouse_id",
				"due_at",
				"version",
				"reference",
			];

	const csvLines = [headers.join(",")];
	for (const row of targetRows) {
		const cells = [
			sanitizeCsvCell(row.id),
			sanitizeCsvCell(row.resource_kind),
			sanitizeCsvCell(row.state),
			sanitizeCsvCell(row.warehouse_id ?? ""),
			sanitizeCsvCell(row.due_at ?? ""),
			sanitizeCsvCell(row.version),
			sanitizeCsvCell(row.reference ?? ""),
		];
		if (includeMoney) {
			cells.push(sanitizeCsvCell(row.amount_idr ?? 0));
		}
		csvLines.push(cells.join(","));
	}

	await identity.sql`
    insert into app.audit_event (actor_id, action, outcome, reason)
    values (
      ${principal.id},
      'admin.export.csv',
      'allowed',
      ${reason}
    )
  `;

	return new Response(`${csvLines.join("\n")}\n`, {
		status: 200,
		headers: {
			"Content-Type": "text/csv; charset=utf-8",
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
			"X-Content-Type-Options": "nosniff",
			"Content-Disposition": `attachment; filename="${resource}-${columnSet}.csv"`,
		},
	});
}

export async function getOperationStatus(
	request: Request,
	identity: LocalAuth,
	operationId: string,
) {
	const url = new URL(request.url);
	if (url.search) throw new AccessError(400, "INVALID_INPUT");
	if (!UUID_RE.test(operationId)) throw new AccessError(400, "INVALID_INPUT");
	if (
		["authorization", "x-cart-token", "x-order-token"].some((h) =>
			request.headers.has(h),
		)
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}

	const principal = await getPrincipal(request, identity);
	const isOwner = principal.roles.includes("owner");
	const isStaffMember = principal.roles.some((r) =>
		[
			"owner",
			"ecommerce_admin",
			"warehouse",
			"customer_service",
			"finance",
		].includes(r),
	);
	const sql = identity.sql;

	// 1. Check outbox_job
	const [job] = await sql<
		{
			id: string;
			kind: string;
			status: string;
			payload: Record<string, unknown>;
			last_error: string | null;
		}[]
	>`
    select id, kind, status, payload, last_error
    from app.outbox_job
    where id = ${operationId}::uuid
  `;
	if (job) {
		if (!isStaffMember) throw new AccessError(403, "FORBIDDEN");
		if (job.kind.startsWith("advertising.") && !isOwner) {
			throw new AccessError(403, "FORBIDDEN");
		}
		const statusMap: Record<
			string,
			"queued" | "processing" | "unknown" | "succeeded" | "failed"
		> = {
			pending: "queued",
			processing: "processing",
			unknown: "unknown",
			completed: "succeeded",
			failed: "failed",
		};
		const resourceId =
			typeof job.payload?.outboxId === "string" &&
			UUID_RE.test(job.payload.outboxId)
				? job.payload.outboxId
				: job.id;
		const response: Record<string, unknown> = {
			id: String(job.id),
			kind: String(job.kind),
			status: statusMap[job.status] ?? "unknown",
			resource_id: resourceId,
		};
		if (job.status === "failed" && job.last_error) {
			response.problem = {
				type: "about:blank",
				title: job.last_error,
				status: 409,
				code: job.last_error,
				request_id: String(job.id),
			};
		}
		return response;
	}

	// 2. Check access_operation
	const [accessOp] = await sql<
		{ id: string; actor_id: string; action: string }[]
	>`
    select id, actor_id, action from app.access_operation where id = ${operationId}::uuid
  `;
	if (accessOp) {
		if (!isOwner && accessOp.actor_id !== principal.id)
			throw new AccessError(403, "FORBIDDEN");
		return {
			id: String(accessOp.id),
			kind: String(accessOp.action),
			status: "succeeded" as const,
			resource_id: String(accessOp.id),
		};
	}

	// 3. Check commerce_operation
	const [commerceOp] = await sql<
		{
			id: string;
			actor_scope: string;
			action: string;
			resource_id: string;
		}[]
	>`
    select id, actor_scope, action, resource_id from app.commerce_operation where id = ${operationId}::uuid
  `;
	if (commerceOp) {
		const ownedByCaller = commerceOp.actor_scope === `user:${principal.id}`;
		if (
			!ownedByCaller &&
			!isOwner &&
			!principal.roles.includes("customer_service") &&
			!principal.roles.includes("finance")
		) {
			throw new AccessError(403, "FORBIDDEN");
		}
		return {
			id: String(commerceOp.id),
			kind: String(commerceOp.action),
			status: "succeeded" as const,
			resource_id: String(commerceOp.resource_id),
		};
	}

	// 4. Check shipping_label_job
	const [labelJob] = await sql<
		{
			id: string;
			shipment_id: string;
			warehouse_id: string;
			status: string;
		}[]
	>`
    select id, shipment_id, warehouse_id::text as warehouse_id, status
    from app.shipping_label_job
    where id = ${operationId}::uuid or operation_id = ${operationId}::uuid
    limit 1
  `;
	if (labelJob) {
		if (
			!isOwner &&
			(!principal.roles.includes("warehouse") ||
				!principal.warehouseIds.includes(labelJob.warehouse_id))
		) {
			throw new AccessError(403, "FORBIDDEN");
		}
		const statusMap: Record<
			string,
			"queued" | "processing" | "unknown" | "succeeded" | "failed"
		> = {
			queued: "queued",
			processing: "processing",
			ready: "succeeded",
			completed: "succeeded",
			failed: "failed",
		};
		return {
			id: operationId,
			kind: "shipping.label",
			status: statusMap[labelJob.status] ?? "processing",
			resource_id: String(labelJob.shipment_id),
		};
	}

	// 5. Check return_operation, replacement_operation, exception_operation
	const [retOp] = await sql<
		{
			id: string;
			actor_id: string | null;
			action: string;
			subject_id: string;
		}[]
	>`
    select id, actor_id, action, subject_id from app.return_operation where id = ${operationId}::uuid
    union all
    select id, actor_id, action, subject_id from app.replacement_operation where id = ${operationId}::uuid
    union all
    select id, actor_id, action, subject_id from app.exception_operation where id = ${operationId}::uuid
    limit 1
  `;
	if (retOp) {
		if (
			!isOwner &&
			retOp.actor_id !== principal.id &&
			!principal.roles.includes("customer_service")
		) {
			throw new AccessError(403, "FORBIDDEN");
		}
		return {
			id: String(retOp.id),
			kind: String(retOp.action),
			status: "succeeded" as const,
			resource_id: String(retOp.subject_id),
		};
	}

	throw new AccessError(404, "NOT_FOUND");
}

export async function handleReporting(
	request: Request,
	identity: LocalAuth,
	operationId?: string,
): Promise<Response> {
	try {
		assertOrigin(request);
		const url = new URL(request.url);
		if (
			request.method === "GET" &&
			url.pathname === "/api/v1/admin/dashboard"
		) {
			return privateJson(await getDashboardSnapshot(request, identity));
		}
		if (
			request.method === "GET" &&
			url.pathname === "/api/v1/admin/work-queues"
		) {
			return privateJson(await listWorkQueue(request, identity));
		}
		if (
			request.method === "POST" &&
			url.pathname === "/api/v1/admin/export-selections"
		) {
			return privateJson(await createExportSelection(request, identity), 201);
		}
		if (request.method === "POST" && url.pathname === "/api/v1/admin/exports") {
			return await exportCsv(request, identity);
		}
		if (
			request.method === "GET" &&
			url.pathname.startsWith("/api/v1/operations/")
		) {
			const opId = operationId ?? url.pathname.split("/").pop() ?? "";
			return privateJson(await getOperationStatus(request, identity, opId));
		}
		throw new AccessError(404, "NOT_FOUND");
	} catch (error) {
		return problem(error);
	}
}
