import type { LocalAuth } from "../access/auth.ts";
import {
	MENGANTAR_API_BOOKING_ENABLED,
	warehouseMode,
} from "../fulfillment/manual.ts";
import {
	LOW_STOCK_THRESHOLD,
	type MetricKey,
	SNAPSHOT_METRICS,
	TRANSFER_DEADLINE_WARNING_HOURS,
} from "./shared.ts";

export async function automatedWarehouseIds(identity: LocalAuth): Promise<string[]> {
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
export const PAYMENT_QUEUE_METRICS = new Set<MetricKey>([
	"transfers_near_deadline",
	"autolaris_pending",
]);
// Order metrics without a warehouse filter: the payment queues above, and the average order value
// (its numerator is company-wide money, so its denominator is too).
const COMPANY_WIDE_ORDER_METRICS = new Set<MetricKey>([
	...PAYMENT_QUEUE_METRICS,
	"average_order_value",
]);

/**
 * FROM/WHERE of the orders queue for a metric. The card's count and its drilldown page use this
 * same fragment. Conditional fragments (not boolean binds) keep commerce_order_history_idx usable.
 */
export function ordersSource(
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
				: metric === "average_order_value"
					? // DEC-027 (4): orders placed in the period, not cancelled and not draft; the denominator of the average.
						sql`and o.status not in ('preparing', 'cancelled')`
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
		warehouseIds.length > 0 && !(metric && COMPANY_WIDE_ORDER_METRICS.has(metric))
			? sql`and (
          not exists (select 1 from app.order_shipment s0 where s0.order_id = o.id)
          or exists (select 1 from app.order_shipment s where s.order_id = o.id and s.warehouse_id = any(${warehouseIds}::uuid[]))
        )`
			: sql``;
	return sql`from app.commerce_order o where true ${period} ${filter} ${scope}`;
}

/**
 * The deadline that binds a parcel now: the handover deadline once it is packed (or waits for handover)
 * and the calendar set one, otherwise the packing deadline. Null when the calendar set none. The
 * fulfillments_overdue filter and the queue's `due_at` marker both read these two fragments, so the
 * tile and the "Lewat batas" marker cannot differ. Needs the `f` and `d` (fulfillment_deadline) aliases.
 */
export function bindingDeadlineAt(sql: Sql) {
	return sql`(case when f.status in ('packed', 'handover_pending') and d.handover_due_at is not null
                  then d.handover_due_at else d.packing_due_at end)`;
}
/** What `bindingDeadlineAt` holds; "created" when there is no deadline (the queue then shows creation time, unmarked). */
export function bindingDeadlineKind(sql: Sql) {
	return sql`(case when f.status in ('packed', 'handover_pending') and d.handover_due_at is not null then 'handover_deadline'
                  when d.packing_due_at is not null then 'packing_deadline'
                  else 'created' end)`;
}

/** FROM/WHERE of the fulfillments queue for a metric (count and drilldown share it). */
export function fulfillmentsSource(
	sql: Sql,
	warehouseIds: string[],
	from: string,
	to: string,
	metric: MetricKey | null,
	automated: string[],
	asOf: string = to,
) {
	// cod_failed_rate is dated by its COD outcome, not by the parcel's creation (codOutcomes).
	const period = isSnapshot(metric) || metric === "cod_failed_rate"
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
				: metric === "fulfillments_overdue"
					? // Parcels past the deadline that binds them now: the handover deadline once packed (when
						// the calendar set one), the packing deadline before. A parcel without a calendar deadline is
						// never counted (the queue shows it without a "Lewat batas" marker either).
						sql`and f.status <> 'handed_over' and ${bindingDeadlineAt(sql)} < ${asOf}::timestamptz`
					: metric === "cod_failed_rate"
						? sql`and f.shipment_id in (select co.shipment_id from (${codOutcomes(sql, warehouseIds, from, to)}) co where co.failed)`
						: sql``;
	return sql`from app.fulfillment f
      join app.order_shipment s on s.id = f.shipment_id
      join app.warehouse w on w.id = s.warehouse_id
      left join app.fulfillment_deadline d on d.id = f.deadline_id
      where s.warehouse_id = any(${warehouseIds}::uuid[]) ${period} ${filter}`;
}

/**
 * Terminal COD events, one row per event: success = the buyer took and paid the parcel (a collected
 * COD operation or a delivered tracking event); failed = refused by the buyer, a failed delivery, or
 * the parcel returned to the sender (local_parcel_outcome failed / refused / returned_to_sender).
 */
export function codTerminalEvents(sql: Sql) {
	return sql`select op.shipment_id, op.status = 'refused' as failed, op.occurred_at from app.local_cod_operation op
        where op.status in ('collected', 'refused')
      union all
      select f.shipment_id, e.status = 'failed', e.occurred_at
        from app.shipment_tracking_event e join app.fulfillment f on f.id = e.fulfillment_id
        where e.status in ('failed', 'delivered')
      union all
      select o.shipment_id, true, o.occurred_at from app.local_parcel_outcome o
        where o.status in ('failed', 'refused', 'returned_to_sender')`;
}

/**
 * One outcome per parcel: its LATEST terminal event (a failed attempt that is later delivered is a
 * success; a delivered parcel later returned is a failure), dated by that event. A tie goes to the
 * success so a parcel is never counted twice or as both.
 */
export function latestCodOutcomes(sql: Sql, events: ReturnType<typeof codTerminalEvents>) {
	return sql`select distinct on (x.shipment_id) x.shipment_id, x.failed, x.occurred_at
      from (${events}) x order by x.shipment_id, x.occurred_at desc, x.failed asc`;
}

/** The latest outcomes whose terminal event falls in the period: the rows of the rate (one per parcel). */
export function codOutcomesInPeriod(sql: Sql, latest: ReturnType<typeof latestCodOutcomes>, from: string, to: string) {
	return sql`select l.shipment_id, l.failed from (${latest}) l
      where l.occurred_at >= ${from}::timestamptz and l.occurred_at <= ${to}::timestamptz`;
}

/**
 * COD parcels with an outcome dated in the period, one row per parcel. The cod_failed_rate numerator
 * is the failed rows (its drilldown lists those parcels through this same function), the denominator
 * is all rows.
 */
export function codOutcomes(sql: Sql, warehouseIds: string[], from: string, to: string) {
	return sql`select s.id as shipment_id, co.failed
      from (${codOutcomesInPeriod(sql, latestCodOutcomes(sql, codTerminalEvents(sql)), from, to)}) co
      join app.order_shipment s on s.id = co.shipment_id
      join app.commerce_order o on o.id = s.order_id
      where o.payment_method = 'cod' and s.warehouse_id = any(${warehouseIds}::uuid[])`;
}

/**
 * The cod_receivable set: COD parcels handed to the courier that have no collection outcome yet (no
 * COD receipt, no Mengantar statement line, no collected/refused COD operation). One fragment feeds
 * the money figure and the ageing chart, so the buckets always add up to the figure.
 */
export function codReceivableSource(sql: Sql) {
	return sql`from app.order_shipment s
    join app.commerce_order o on o.id = s.order_id
    join app.fulfillment f on f.shipment_id = s.id and f.handover_at is not null
    where o.payment_method = 'cod'
      and not exists (select 1 from app.economic_receipt r where r.shipment_id = s.id and r.kind = 'cod')
      and not exists (select 1 from app.cod_remittance_line l where l.shipment_id = s.id)
      and not exists (select 1 from app.local_cod_operation c where c.shipment_id = s.id and c.status in ('collected', 'refused'))`;
}

/** Orders with a parcel received by the buyer in the period: the return_rate denominator. */
export function deliveredOrders(sql: Sql, warehouseIds: string[], from: string, to: string) {
	return sql`select count(distinct s.order_id)::int as n
      from app.local_parcel_receipt r join app.order_shipment s on s.id = r.shipment_id
      where r.occurred_at >= ${from}::timestamptz and r.occurred_at <= ${to}::timestamptz
        ${warehouseIds.length > 0 ? sql`and s.warehouse_id = any(${warehouseIds}::uuid[])` : sql``}`;
}

/**
 * Stock positions (warehouse x SKU) with the catalog/reservation availability rule: on hand -
 * reserved - quarantined over lots not expired on the warehouse's local date
 * (src/modules/catalog/summary.ts, src/modules/inventory/reservations.ts). The id is a stable
 * synthetic UUID of the position; version sums the lot balance revisions.
 */
export function stockPositions(sql: Sql, warehouseIds: string[]) {
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

/** The stock_alerts set (S113: the card and the inventory queue both read it). */
export function lowStockPositions(sql: Sql, warehouseIds: string[]) {
	return sql`select * from (${stockPositions(sql, warehouseIds)}) low where low.available <= ${LOW_STOCK_THRESHOLD}`;
}

/**
 * Row warehouse of the order-linked queues (exceptions, returns): the order's first shipment.
 * Rows without an order or a shipment stay visible to every scope (as before S113).
 */
function firstShipmentInScope(sql: Sql, warehouseIds: string[], row: "e" | "rc") {
	const orderId = row === "e" ? sql`e.order_id` : sql`rc.order_id`;
	return warehouseIds.length > 0
		? sql`and coalesce((select s.warehouse_id = any(${warehouseIds}::uuid[]) from app.order_shipment s where s.order_id = ${orderId} order by s.id limit 1), true)`
		: sql``;
}

// S113: FROM/WHERE of the small queues. A metric's terminal states are excluded here, so the card
// counts and the drilldown lists the same SQL set (no filter restated in application code).
export function exceptionsSource(sql: Sql, warehouseIds: string[], from: string, to: string, metric: MetricKey | null) {
	// cod_problems_open is a current backlog (no period): COD refusals and failed deliveries not yet resolved.
	return sql`from app.commerce_exception e
      where true ${isSnapshot(metric) ? sql`` : sql`and e.occurred_at >= ${from}::timestamptz and e.occurred_at <= ${to}::timestamptz`}
        ${metric === "delivery_exceptions" || metric === "cod_problems_open" ? sql`and e.status is distinct from 'resolved'` : sql``}
        ${metric === "cod_problems_open" ? sql`and e.kind in ('cod_refusal', 'delivery_failure') and exists (select 1 from app.commerce_order co where co.id = e.order_id and co.payment_method = 'cod')` : sql``}
        ${firstShipmentInScope(sql, warehouseIds, "e")}`;
}
export function returnsSource(sql: Sql, warehouseIds: string[], from: string, to: string, metric: MetricKey | null) {
	return sql`from app.return_case rc
      where rc.created_at >= ${from}::timestamptz and rc.created_at <= ${to}::timestamptz
        ${metric === "returns_pending" ? sql`and coalesce(rc.status not in ('rejected', 'resolved'), true)` : sql``}
        ${firstShipmentInScope(sql, warehouseIds, "rc")}`;
}
export function supportSource(sql: Sql, from: string, to: string, metric: MetricKey | null) {
	// oldest_unclaimed_chat_age is a current state (no period) of the chats that need a staff reply:
	// unassigned and open. A chat waiting for the buyer is not staff's wait and is left out of it.
	return sql`from app.support_conversation c
      where true ${isSnapshot(metric) ? sql`` : sql`and c.created_at >= ${from}::timestamptz and c.created_at <= ${to}::timestamptz`}
        ${metric === "support_unassigned" ? sql`and c.assigned_user_id is null and c.status in ('open', 'waiting_customer')` : sql``}
        ${metric === "oldest_unclaimed_chat_age" ? sql`and c.assigned_user_id is null and c.status = 'open'` : sql``}`;
}
export function reconciliationSource(sql: Sql, from: string, to: string, metric: MetricKey | null) {
	return sql`from app.provider_settlement ps
      left join app.local_settlement_operation lso on lso.id = ps.operation_id
      where ps.created_at >= ${from}::timestamptz and ps.created_at <= ${to}::timestamptz
        ${metric === "finance_unmatched" ? sql`and ps.status is distinct from 'matched'` : sql``}`;
}
