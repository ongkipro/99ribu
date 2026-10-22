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
	| "fulfillments_due"
	| "delivery_exceptions"
	| "returns_pending"
	| "stock_alerts"
	| "support_unassigned"
	| "finance_unmatched"
	| "cod_receivable"
	| "refund_liability"
	| "affiliate_liability"
	| "estimated_contribution"
	| "realized_contribution"
	| "net_merchandise_revenue";

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
		"fulfillments_due",
		"delivery_exceptions",
		"returns_pending",
		"stock_alerts",
	],
	finance: [
		"finance_unmatched",
		"cod_receivable",
		"refund_liability",
		"affiliate_liability",
		"estimated_contribution",
		"realized_contribution",
		"net_merchandise_revenue",
	],
	owner: [
		"orders_pending",
		"fulfillments_due",
		"delivery_exceptions",
		"returns_pending",
		"stock_alerts",
		"support_unassigned",
		"finance_unmatched",
		"cod_receivable",
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
	fulfillments_due: "fulfillments",
	delivery_exceptions: "delivery_exceptions",
	returns_pending: "returns",
	stock_alerts: "inventory",
	support_unassigned: "support",
	finance_unmatched: "reconciliation",
	cod_receivable: "reconciliation",
	refund_liability: "returns",
	affiliate_liability: "reconciliation",
	estimated_contribution: "orders",
	realized_contribution: "reconciliation",
	net_merchandise_revenue: "reconciliation",
};

const MONEY_METRICS = new Set<MetricKey>([
	"cod_receivable",
	"refund_liability",
	"affiliate_liability",
	"estimated_contribution",
	"realized_contribution",
	"net_merchandise_revenue",
]);

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
}

export type DueAtKind =
	| "payment_deadline"
	| "packing_deadline"
	| "handover_deadline"
	| "created"
	| "occurred"
	| "updated";

async function queryQueueRows(
	identity: LocalAuth,
	queue: QueueKey,
	warehouseIds: string[],
	from: string,
	to: string,
	statuses?: string[],
): Promise<QueueRowInternal[]> {
	const sql = identity.sql;
	const hasWarehouses = warehouseIds.length > 0;

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
			}[]
		>`
      select o.id,
             o.number,
             o.status,
             o.revision,
             o.buyer_total::text as buyer_total,
             o.expires_at,
             o.created_at,
             (select s.warehouse_id::text from app.order_shipment s where s.order_id = o.id order by s.id limit 1) as warehouse_id
      from app.commerce_order o
      where o.created_at >= ${from}::timestamptz
        and o.created_at <= ${to}::timestamptz
        and (
          ${!hasWarehouses}
          or not exists (select 1 from app.order_shipment s0 where s0.order_id = o.id)
          or exists (
            select 1 from app.order_shipment s
            where s.order_id = o.id and s.warehouse_id::text in ${sql(hasWarehouses ? warehouseIds : ["00000000-0000-0000-0000-000000000000"])}
          )
        )
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
			}));
	}

	if (queue === "fulfillments") {
		if (!hasWarehouses) return [];
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
			}[]
		>`
      select f.id,
             f.status,
             f.revision,
             s.warehouse_id::text as warehouse_id,
             coalesce(d.packing_due_at, d.handover_due_at, f.created_at) as due_at,
             case when d.packing_due_at is not null then 'packing_deadline'
                  when d.handover_due_at is not null then 'handover_deadline'
                  else 'created' end as due_at_kind,
             f.created_at,
             f.tracking_number,
             o.number as order_number
      from app.fulfillment f
      join app.order_shipment s on s.id = f.shipment_id
      join app.commerce_order o on o.id = s.order_id
      left join app.fulfillment_deadline d on d.id = f.deadline_id
      where s.warehouse_id::text in ${sql(warehouseIds)}
        and f.created_at >= ${from}::timestamptz
        and f.created_at <= ${to}::timestamptz
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
			}[]
		>`
      select e.id,
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
			}[]
		>`
      select rc.id,
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
			}));
	}

	if (queue === "inventory") {
		if (!hasWarehouses) return [];
		const rows = await sql<
			{
				id: string;
				warehouse_id: string;
				on_hand: number;
				reserved: number;
				quarantined: number;
				revision: number;
				sku: string;
			}[]
		>`
      select b.id,
             b.warehouse_id::text as warehouse_id,
             b.on_hand,
             b.reserved,
             b.quarantined,
             b.revision,
             si.sku
      from app.inventory_balance b
      join app.stock_item si on si.id = b.stock_item_id
      where b.warehouse_id::text in ${sql(warehouseIds)}
      order by b.id asc
    `;
		return rows
			.map((r) => {
				const available = Number(r.on_hand) - Number(r.reserved);
				const state =
					available <= 0
						? "out_of_stock"
						: available <= 5 || Number(r.quarantined) > 0
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
			}[]
		>`
      select c.id,
             c.status,
             c.assigned_user_id,
             c.revision,
             c.updated_at,
             (select o.number from app.commerce_order o where o.id = c.primary_order_id) as order_number
      from app.support_conversation c
      where c.created_at >= ${from}::timestamptz
        and c.created_at <= ${to}::timestamptz
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
			}));
	}

	return [];
}

async function computeMoneyMetrics(
	identity: LocalAuth,
	warehouseIds: string[],
	from: string,
	to: string,
): Promise<
	Record<
		| "cod_receivable"
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
	const _hasWarehouses = warehouseIds.length > 0;

	// 1. COD receivable: COD shipments not yet settled
	const [codRow] = await sql<{ amount: string }[]>`
    select coalesce(sum(s.cod_due), 0)::text as amount
    from app.order_shipment s
    join app.commerce_order o on o.id = s.order_id
    where o.payment_method = 'cod'
      and o.created_at >= ${from}::timestamptz
      and o.created_at <= ${to}::timestamptz
      and not exists (
        select 1 from app.economic_receipt r
        where r.shipment_id = s.id and r.kind = 'cod'
      )
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
	const queueCache = new Map<QueueKey, QueueRowInternal[]>();
	const getQueue = async (q: QueueKey) => {
		const cached = queueCache.get(q);
		if (cached) return cached;
		const rows = await queryQueueRows(identity, q, warehouseIds, from, to);
		queueCache.set(q, rows);
		return rows;
	};

	const needsMoney = allowedKeys.some((k) => MONEY_METRICS.has(k));
	const moneyValues = needsMoney
		? await computeMoneyMetrics(identity, warehouseIds, from, to)
		: null;

	const definitions: Record<MetricKey, string> = {
		orders_pending:
			"Pesanan aktif dalam jendela waktu yang memerlukan tindak lanjut operasional.",
		fulfillments_due:
			"Pemenuhan gudang yang siap dikemas atau diserahkan ke kurir.",
		delivery_exceptions:
			"Pengecualian pengiriman aktif (gagal kirim, alamat tidak valid, atau penolakan COD).",
		returns_pending:
			"Pengajuan retur atau penukaran barang yang menunggu keputusan atau inspeksi.",
		stock_alerts:
			"Saldo stok gudang yang mencapai batas stok rendah atau dikarantina.",
		support_unassigned:
			"Percakapan layanan pelanggan yang belum memiliki agen penanggung jawab.",
		finance_unmatched:
			"Mutasi penyelesaian pembayaran/COD yang belum direkonsiliasi.",
		cod_receivable:
			"Piutang COD dari pengiriman yang belum diselesaikan dalam Rupiah (IDR).",
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
		const rows = await getQueue(queueKey);
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

		if (!isMoney) {
			metrics.push({
				key,
				count: rows.length,
				basis:
					key === "stock_alerts"
						? ("snapshot" as const)
						: ("event_period" as const),
				complete: true,
				queue_key: queueKey,
				kind: "count" as const,
				amount: null,
				currency: null,
				financial_basis: "not_applicable" as const,
				definition: definitions[key],
				as_of: asOf,
				queue_filter_token: queueFilterToken,
				filter_version: 1,
				filter_expires_at: filterExpiresAt,
			});
		} else {
			const m = moneyValues?.[key as keyof NonNullable<typeof moneyValues>];
			const complete = m?.complete ?? false;
			metrics.push({
				key,
				count: null,
				basis: "event_period" as const,
				complete,
				queue_key: queueKey,
				kind: "money" as const,
				amount: complete ? (m?.amount ?? 0) : null,
				currency: "IDR" as const,
				financial_basis: m?.financial_basis ?? "unknown",
				definition: definitions[key],
				as_of: asOf,
				queue_filter_token: queueFilterToken,
				filter_version: 1,
				filter_expires_at: filterExpiresAt,
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
