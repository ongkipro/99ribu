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
export function fulfillmentsSource(
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
	return sql`from app.commerce_exception e
      where e.occurred_at >= ${from}::timestamptz and e.occurred_at <= ${to}::timestamptz
        ${metric === "delivery_exceptions" ? sql`and e.status is distinct from 'resolved'` : sql``}
        ${firstShipmentInScope(sql, warehouseIds, "e")}`;
}
export function returnsSource(sql: Sql, warehouseIds: string[], from: string, to: string, metric: MetricKey | null) {
	return sql`from app.return_case rc
      where rc.created_at >= ${from}::timestamptz and rc.created_at <= ${to}::timestamptz
        ${metric === "returns_pending" ? sql`and coalesce(rc.status not in ('rejected', 'resolved'), true)` : sql``}
        ${firstShipmentInScope(sql, warehouseIds, "rc")}`;
}
export function supportSource(sql: Sql, from: string, to: string, metric: MetricKey | null) {
	return sql`from app.support_conversation c
      where c.created_at >= ${from}::timestamptz and c.created_at <= ${to}::timestamptz
        ${metric === "support_unassigned" ? sql`and c.assigned_user_id is null and c.status in ('open', 'waiting_customer')` : sql``}`;
}
export function reconciliationSource(sql: Sql, from: string, to: string, metric: MetricKey | null) {
	return sql`from app.provider_settlement ps
      left join app.local_settlement_operation lso on lso.id = ps.operation_id
      where ps.created_at >= ${from}::timestamptz and ps.created_at <= ${to}::timestamptz
        ${metric === "finance_unmatched" ? sql`and ps.status is distinct from 'matched'` : sql``}`;
}
