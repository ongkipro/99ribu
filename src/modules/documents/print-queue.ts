import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import { integer, invalid } from "../catalog/validation.ts";
import {
	assertLabelReadPermission,
	type ShippingLabelArtifactResponse,
	type ShippingLabelFormat,
	type ShippingLabelTemplateResponse,
} from "./label-shared.ts";
import { ensureDefaultTemplates, formatTemplate } from "./label-templates.ts";

export const PRINT_QUEUE_PAGE = 30;

export type PrintQueueShipment = {
	shipment_id: string;
	parcel_id: string;
	warehouse_id: string;
	warehouse_name: string;
	order_number: string;
	tracking_number: string | null;
	fulfillment_status: string | null;
	cod_due: number;
	/** Packing deadline while a label is missing, handover deadline once labelled. */
	due_at: string | null;
};

// Opaque keyset cursor: action rank, deadline in epoch microseconds ("-" when
// none) and shipment id of the last row returned.
const PRINT_CURSOR =
	/^([012])\.(-|\d{1,17})\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function printQueueInput(url: URL) {
	for (const name of url.searchParams.keys()) {
		if (
			!["cursor", "limit"].includes(name) ||
			url.searchParams.getAll(name).length !== 1
		) {
			throw invalid();
		}
	}
	const raw = url.searchParams.get("limit") ?? String(PRINT_QUEUE_PAGE);
	if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(raw)) throw invalid();
	const cursor = url.searchParams.get("cursor");
	if (cursor !== null && !PRINT_CURSOR.test(cursor)) throw invalid();
	return { cursor, limit: integer(Number(raw), 1, 100) };
}

/**
 * Print-center queue in the principal's warehouse scope, ordered by what needs
 * action first: rank 0 = active parcel without a valid label (by packing
 * deadline), rank 1 = labelled parcel not yet handed over (by handover
 * deadline), rank 2 = handed over, exception, cancelled or not yet in
 * fulfillment. Ties break by deadline (none last) then shipment id. Keyset
 * pages are stable for unchanged rows; a parcel whose rank changes between
 * pages moves to its new position.
 */
export async function readPrintQueue(
	tx: TransactionSql,
	principal: Principal,
	page: { cursor: string | null; limit: number },
) {
	const isOwner = principal.roles.includes("owner");
	const anchor = page.cursor ? PRINT_CURSOR.exec(page.cursor) : null;
	if (page.cursor && !anchor) throw invalid();
	const rank = anchor ? Number(anchor[1]) : 0;
	const dueUs = anchor && anchor[2] !== "-" ? anchor[2] : null;
	const afterId = anchor ? anchor[3] : null;
	const rows = await tx<
		(Omit<PrintQueueShipment, "cod_due" | "due_at"> & {
			cod_due: string;
			due_at: string | null;
			rank: number;
			due_us: string | null;
		})[]
	>`
		with queue as (
			select
				s.id as shipment_id,
				s.parcel_id,
				s.warehouse_id,
				w.name as warehouse_name,
				o.number as order_number,
				f.tracking_number,
				f.status as fulfillment_status,
				s.cod_due::text as cod_due,
				case
					when f.id is null or o.status = 'cancelled' or f.status in ('handed_over', 'exception') then 2
					when exists (
						select 1 from app.shipping_label_artifact a
						where a.shipment_id = s.id and a.status = 'valid'
					) then 1
					else 0
				end as rank,
				d.packing_due_at,
				d.handover_due_at
			from app.order_shipment s
			join app.warehouse w on w.id = s.warehouse_id
			join app.commerce_order o on o.id = s.order_id
			left join app.fulfillment f on f.shipment_id = s.id
			left join app.fulfillment_deadline d on d.id = f.deadline_id
			where ${isOwner} or s.warehouse_id = any(${principal.warehouseIds}::uuid[])
		), keyed as (
			select q.*,
				case when q.rank = 1 then coalesce(q.handover_due_at, q.packing_due_at)
					else coalesce(q.packing_due_at, q.handover_due_at) end as due_at
			from queue q
		), sorted as (
			select k.*, (extract(epoch from k.due_at) * 1000000)::bigint as due_us from keyed k
		)
		select shipment_id, parcel_id, warehouse_id, warehouse_name, order_number,
			tracking_number, fulfillment_status, cod_due, due_at, rank, due_us::text as due_us
		from sorted
		where ${afterId}::uuid is null
			or rank > ${rank}::int
			or (rank = ${rank}::int and (
				case when ${dueUs}::bigint is null
					then due_us is null and shipment_id > ${afterId}::uuid
					else due_us > ${dueUs}::bigint or due_us is null
						or (due_us = ${dueUs}::bigint and shipment_id > ${afterId}::uuid)
				end))
		order by rank, due_us nulls last, shipment_id
		limit ${page.limit + 1}
	`;
	const pageRows = rows.slice(0, page.limit);
	const last = pageRows.at(-1);
	const ids = pageRows.map((r) => String(r.shipment_id));
	const artifacts = ids.length
		? await tx<
				{
					id: string;
					shipment_id: string;
					tracking_number: string;
					format: ShippingLabelFormat;
					sha256: string;
					byte_size: number;
					status: ShippingLabelArtifactResponse["status"];
					snapshot: Record<string, unknown>;
					created_at: string;
				}[]
			>`
				select id, shipment_id, tracking_number, format, sha256, byte_size, status, snapshot, created_at
				from app.shipping_label_artifact
				where shipment_id = any(${ids}::uuid[])
					and (${isOwner} or warehouse_id = any(${principal.warehouseIds}::uuid[]))
				order by created_at desc, id desc
				limit 300
			`
		: [];
	return {
		data: pageRows.map(
			(r): PrintQueueShipment => ({
				shipment_id: String(r.shipment_id),
				parcel_id: String(r.parcel_id),
				warehouse_id: String(r.warehouse_id),
				warehouse_name: r.warehouse_name,
				order_number: r.order_number,
				tracking_number: r.tracking_number,
				fulfillment_status: r.fulfillment_status,
				cod_due: Number(r.cod_due),
				due_at: r.due_at ? new Date(r.due_at).toISOString() : null,
			}),
		),
		artifacts: artifacts.map(
			(a): ShippingLabelArtifactResponse => ({
				id: String(a.id),
				shipment_id: String(a.shipment_id),
				tracking_number: a.tracking_number,
				format: a.format,
				template_version: Number(a.snapshot?.template_version ?? 1),
				content_sha256: a.sha256,
				size_bytes: Number(a.byte_size),
				status: a.status,
				created_at: new Date(a.created_at).toISOString(),
			}),
		),
		pagination: {
			next_cursor:
				rows.length > page.limit && last
					? `${last.rank}.${last.due_us ?? "-"}.${last.shipment_id}`
					: null,
		},
	};
}

export async function readPrintCenterWorkspace(
	request: Request,
	identity: LocalAuth,
) {
	try {
		const principal = await getPrincipal(request, identity);
		assertLabelReadPermission(principal);
		return await identity.sql.begin(async (tx) => {
			await ensureDefaultTemplates(tx, principal.id);
			const tplIds = await tx<{ id: string }[]>`
				select id from app.shipping_label_template order by created_at desc
			`;
			const templates: ShippingLabelTemplateResponse[] = [];
			for (const t of tplIds) {
				templates.push(await formatTemplate(tx, t.id));
			}

			const isOwner = principal.roles.includes("owner");
			const queue = await readPrintQueue(tx, principal, {
				cursor: null,
				limit: PRINT_QUEUE_PAGE,
			});

			const attempts = await tx<
				{
					id: string;
					shipment_id: string;
					artifact_id: string;
					actor_id: string;
					kind: "initial_print" | "reprint";
					reported_outcome: "sent_to_printer" | "completed" | "failed";
					reason: string | null;
					created_at: string;
				}[]
			>`
				select id, shipment_id, artifact_id, actor_id, kind, reported_outcome, reason, created_at
				from app.shipping_print_attempt
				where ${isOwner} or warehouse_id = any(${principal.warehouseIds}::uuid[])
				order by created_at desc
				limit 30
			`;

			return {
				authorized: true as const,
				principal,
				templates,
				shipments: queue.data,
				artifacts: queue.artifacts,
				next_cursor: queue.pagination.next_cursor,
				attempts: attempts.map((att) => ({
					id: String(att.id),
					shipment_id: String(att.shipment_id),
					artifact_id: String(att.artifact_id),
					actor_user_id: att.actor_id,
					kind: att.kind,
					outcome: att.reported_outcome,
					reason: att.reason || null,
					created_at: new Date(att.created_at).toISOString(),
				})),
			};
		});
	} catch (error) {
		return {
			authorized: false as const,
			code: error instanceof AccessError ? error.code : "UNAUTHENTICATED",
			principal: null,
			templates: [],
			shipments: [],
			artifacts: [],
			attempts: [],
			next_cursor: null,
		};
	}
}
