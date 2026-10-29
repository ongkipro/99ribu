import type { LocalAuth } from "../access/auth.ts";
import { AccessError, getPrincipal } from "../access/policy.ts";
import { digest } from "../checkout/access.ts";
import {
	LOW_STOCK_THRESHOLD,
	METRIC_QUEUE_MAP,
	type MetricKey,
	type MetricScope,
	MONEY_METRICS,
	type QueueKey,
	type QueueRowInternal,
	resolveAuthorizedWarehouses,
	resolveDateRange,
	resolveWorkspace,
	UUID_RE,
	WORKSPACE_QUEUES,
} from "./shared.ts";
import {
	automatedWarehouseIds,
	exceptionsSource,
	fulfillmentsSource,
	lowStockPositions,
	ordersSource,
	reconciliationSource,
	returnsSource,
	stockPositions,
	supportSource,
} from "./sources.ts";
import { verifyTokenPayload } from "./tokens.ts";

const TERMINAL_QUEUE_STATES: Record<QueueRowInternal["resource_kind"], readonly string[]> = {
	order: ["cancelled"],
	fulfillment: ["handed_over"],
	shipment: ["resolved"],
	return: ["rejected", "resolved"],
	stock_item: ["in_stock"],
	conversation: ["resolved", "closed"],
	reconciliation: ["matched"],
};
export const isTerminalQueueState = (kind: QueueRowInternal["resource_kind"], state: string) =>
	TERMINAL_QUEUE_STATES[kind].includes(state);

export async function queryQueueRows(
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
				awaiting_payment: boolean;
			}[]
		>`
      select o.id,
             o.number,
             o.status,
             o.revision,
             o.buyer_total::text as buyer_total,
             o.expires_at,
             o.created_at,
             (o.payment_method = 'prepaid' and o.payment_status = 'pending') as awaiting_payment,
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
				// The payment deadline only binds a prepaid order still awaiting payment; paid and COD
				// orders are timed by their creation.
				due_at: new Date(
					r.awaiting_payment && r.expires_at ? r.expires_at : r.created_at,
				).toISOString(),
				due_at_kind:
					r.awaiting_payment && r.expires_at
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
      ${exceptionsSource(sql, warehouseIds, from, to, metric)}
      order by e.occurred_at desc, e.id asc
    `;
		return rows
			.filter((r) => !statuses?.length || statuses.includes(r.status))
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
      ${returnsSource(sql, warehouseIds, from, to, metric)}
      order by rc.created_at desc, rc.id asc
    `;
		return rows
			.filter((r) => !statuses?.length || statuses.includes(r.status))
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
      from (${statuses?.length ? stockPositions(sql, warehouseIds) : lowStockPositions(sql, warehouseIds)}) p
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
			.filter((r) => !statuses?.length || statuses.includes(r.state));
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
      ${supportSource(sql, from, to, metric)}
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
				reference: string | null;
				provider: string | null;
				order_number: string | null;
				order_id: string | null;
			}[]
		>`
      select ps.id,
             ps.status,
             ps.revision,
             ps.created_at,
             coalesce(lso.net_amount, 0)::text as net_amount,
             lso.reference,
             lso.provider,
             -- First allocated order of the current (else last) match: the order staff open.
             (select o.number from app.settlement_allocation sa join app.commerce_order o on o.id = sa.order_id
               where sa.match_id = coalesce(ps.current_match_id, ps.last_match_id) order by sa.ordinal limit 1) as order_number,
             (select sa.order_id::text from app.settlement_allocation sa
               where sa.match_id = coalesce(ps.current_match_id, ps.last_match_id) order by sa.ordinal limit 1) as order_id
      ${reconciliationSource(sql, from, to, metric)}
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
				// S113: the matched order number staff know; else the mutation reference, never the row id.
				reference: r.order_number ?? r.reference ?? null,
				order_id: r.order_id,
				settlement_source: r.provider === "local.cod" ? ("cod" as const) : ("payment" as const),
			}));
	}

	return [];
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
		const decoded = await verifyTokenPayload(identity, filterToken);
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

	// S113: rows staff still act on come first, terminal states last (stable: each group keeps
	// the queue order). The cursor is a row id in this same ordering.
	const allRows = (
		await queryQueueRows(
			identity,
			rawQueue,
			warehouseIds,
			from,
			to,
			undefined,
			scope,
		)
	).sort(
		(a, b) =>
			Number(isTerminalQueueState(a.resource_kind, a.state)) -
			Number(isTerminalQueueState(b.resource_kind, b.state)),
	);
	let startIndex = 0;
	if (cursor) {
		const idx = allRows.findIndex((r) => r.id === cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_INPUT");
		startIndex = idx + 1;
	}
	const pageRows = allRows.slice(startIndex, startIndex + limit);
	// Console links address an order by its admin number; the page's orders are numbered in one read.
	const pageOrderIds = [
		...new Set(pageRows.flatMap((row) => (row.order_id ? [row.order_id] : []))),
	];
	const orderAdminNo = new Map<string, number>();
	if (pageOrderIds.length) {
		for (const row of await identity.sql<{ id: string; admin_no: string }[]>`
			select id::text as id, admin_no::text as admin_no from app.commerce_order where id = any(${pageOrderIds}::uuid[])`)
			orderAdminNo.set(row.id, Number(row.admin_no));
	}
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
			order_admin_no: row.order_id ? (orderAdminNo.get(row.order_id) ?? null) : null,
			// Settlement amount and feed for reconciliation rows only (no order totals in this contract).
			amount_idr: row.resource_kind === "reconciliation" ? row.amount_idr : null,
			settlement_source: row.settlement_source ?? null,
		})),
		pagination: {
			next_cursor: nextCursor,
		},
	};
}
