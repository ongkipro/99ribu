import type { TransactionSql } from "postgres";
import type { ResolvedShipment } from "./label-shared.ts";

export async function resolveShipment(
	tx: TransactionSql,
	shipmentId: string,
): Promise<ResolvedShipment | null> {
	const [orig] = await tx<
		{
			shipment_id: string;
			fulfillment_id: string | null;
			booking_id: string | null;
			booking_status: string | null;
			cancellation_pending: boolean;
			warehouse_id: string;
			warehouse_name: string;
			warehouse_city: string;
			order_id: string;
			order_number: string;
			order_status: string;
			parcel_id: string;
			tracking_number: string | null;
			fulfillment_status: string | null;
			payment_method: string;
			cod_due: string;
			shipment_snapshot: Record<string, unknown>;
			quote_document: Record<string, unknown>;
			active_units: number;
			total_units: number;
		}[]
	>`
		select
			s.id as shipment_id,
			f.id as fulfillment_id,
			coalesce(
				f.booking_id,
				(
					select sb.id
					from app.shipment_booking sb
					where sb.fulfillment_id = f.id
					order by sb.created_at desc
					limit 1
				)
			) as booking_id,
			b.status as booking_status,
			coalesce(
				exists (
					select 1
					from app.shipment_cancellation sc
					where sc.booking_id = f.booking_id
						and sc.status in ('queued', 'acknowledged', 'cancelled')
				),
				false
			) as cancellation_pending,
			s.warehouse_id,
			w.name as warehouse_name,
			w.city as warehouse_city,
			o.id as order_id,
			o.number as order_number,
			o.status as order_status,
			s.parcel_id,
			coalesce(
				f.tracking_number,
				(
					select lw.tracking_number
					from app.shipment_booking sb
					join app.local_waybill_operation lw on lw.booking_id = sb.id
					where sb.fulfillment_id = f.id and sb.status = 'issued'
					order by sb.created_at desc
					limit 1
				)
			) as tracking_number,
			f.status as fulfillment_status,
			o.payment_method,
			s.cod_due::text as cod_due,
			s.snapshot as shipment_snapshot,
			q.document as quote_document,
			(
				select count(*)::int
				from app.fulfillment_item fi
				where fi.shipment_id = s.id
			) as total_units,
			(
				select count(*)::int
				from app.fulfillment_item fi
				where fi.shipment_id = s.id
					and not exists (
						select 1 from app.exception_cancellation ec
						where ec.fulfillment_item_id = fi.id
							and ec.replacement_link_id is null
					)
			) as active_units
		from app.order_shipment s
		join app.warehouse w on w.id = s.warehouse_id
		join app.commerce_order o on o.id = s.order_id
		join app.checkout_quote q on q.id = o.quote_id
		left join app.fulfillment f on f.shipment_id = s.id
		left join app.shipment_booking b on b.id = f.booking_id
		where s.id = ${shipmentId} or f.id = ${shipmentId}
		limit 1
	`;
	if (orig) {
		const addr = (orig.quote_document?.address ?? {}) as Record<string, string>;
		const snap = (orig.shipment_snapshot ?? {}) as Record<string, string>;
		const isCancelled =
			orig.order_status === "cancelled" ||
			orig.booking_status === "cancelled" ||
			Boolean(orig.cancellation_pending) ||
			(orig.total_units > 0 && orig.active_units === 0);
		return {
			shipment_id: String(orig.shipment_id),
			fulfillment_id: orig.fulfillment_id ? String(orig.fulfillment_id) : null,
			booking_id: orig.booking_id ? String(orig.booking_id) : null,
			warehouse_id: String(orig.warehouse_id),
			warehouse_name: orig.warehouse_name,
			warehouse_city: orig.warehouse_city,
			order_id: String(orig.order_id),
			order_number: orig.order_number,
			parcel_id: orig.parcel_id,
			tracking_number: isCancelled ? null : (orig.tracking_number ?? null),
			cancelled: isCancelled,
			payment_method: orig.payment_method,
			cod_due: Number(orig.cod_due),
			recipient_name: String(addr.recipient_name ?? "Penerima"),
			recipient_phone: String(addr.phone ?? "+6281200000000"),
			address_line: String(addr.address_line ?? "Alamat Pengiriman"),
			district: String(addr.district ?? "-"),
			subdistrict: String(addr.subdistrict ?? addr.district ?? "-"),
			city: String(addr.city ?? "-"),
			province: String(addr.province ?? "-"),
			postal_code: String(addr.postal_code ?? "00000"),
			carrier_name: String(snap.courier_name ?? "LOCAL"),
			service_name: String(snap.service_name ?? "REG"),
			item_count: Math.max(
				1,
				Number(orig.active_units || orig.total_units || 1),
			),
		};
	}

	const [hasRepl] = await tx<{ installed: boolean }[]>`
		select to_regclass('app.replacement_shipment') is not null as installed
	`;
	if (hasRepl?.installed) {
		const [repl] = await tx<
			{
				shipment_id: string;
				booking_id: string | null;
				warehouse_id: string;
				warehouse_name: string;
				warehouse_city: string;
				order_id: string;
				order_number: string;
				tracking_number: string | null;
				status: string;
				quote_document: Record<string, unknown>;
			}[]
		>`
			select
				rs.id as shipment_id,
				rs.booking_id,
				rs.warehouse_id,
				w.name as warehouse_name,
				w.city as warehouse_city,
				o.id as order_id,
				o.number as order_number,
				rs.tracking_number,
				rs.status,
				q.document as quote_document
			from app.replacement_shipment rs
			join app.warehouse w on w.id = rs.warehouse_id
			join app.return_case rc on rc.id = rs.case_id
			join app.commerce_order o on o.id = rc.order_id
			join app.checkout_quote q on q.id = o.quote_id
			where rs.id = ${shipmentId}
			limit 1
		`;
		if (repl) {
			const addr = (repl.quote_document?.address ?? {}) as Record<
				string,
				string
			>;
			return {
				shipment_id: String(repl.shipment_id),
				fulfillment_id: null,
				booking_id: repl.booking_id ? String(repl.booking_id) : null,
				warehouse_id: String(repl.warehouse_id),
				warehouse_name: repl.warehouse_name,
				warehouse_city: repl.warehouse_city,
				order_id: String(repl.order_id),
				order_number: repl.order_number,
				parcel_id: `REPL-${String(repl.shipment_id).slice(0, 8)}`,
				tracking_number: repl.tracking_number ?? null,
				cancelled: repl.status === "cancelled",
				payment_method: "prepaid",
				cod_due: 0,
				recipient_name: String(addr.recipient_name ?? "Penerima"),
				recipient_phone: String(addr.phone ?? "+6281200000000"),
				address_line: String(addr.address_line ?? "Alamat Pengiriman"),
				district: String(addr.district ?? "-"),
				subdistrict: String(addr.subdistrict ?? addr.district ?? "-"),
				city: String(addr.city ?? "-"),
				province: String(addr.province ?? "-"),
				postal_code: String(addr.postal_code ?? "00000"),
				carrier_name: "LOCAL",
				service_name: "REPL",
				item_count: 1,
			};
		}
	}
	return null;
}
