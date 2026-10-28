import { createHash, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import {
	readPrivateArtifact,
	savePrivateArtifact,
} from "../../storage/private.ts";
import type { LocalAuth } from "../access/auth.ts";
import { consumeAccessProof } from "../access/grants.ts";
import {
	assertOrigin,
	privateJson,
	problem,
	readBody,
} from "../access/http.ts";
import {
	AccessError,
	getPrincipal,
	isStaff,
	type Principal,
} from "../access/policy.ts";
import {
	array,
	id,
	integer,
	invalid,
	object,
	text,
} from "../catalog/validation.ts";
import { intentHash, mutationKey } from "../checkout/carts.ts";
import { maskReceiptPhone } from "../orders/receipt.ts";

export type ShippingLabelFormat = "thermal_100x150" | "a4";
export type ShippingLabelPrivacyMode =
	| "masked_phone"
	| "carrier_required_full_phone";
export type ShippingLabelBrandMode = "99ribu" | "neutral_partner";

export type ShippingLabelTemplateVersionItem = {
	version: number;
	renderer_version: string;
	partner_brand_name: string | null;
	disclosure_text: string | null;
	actor_id: string;
	reason: string;
	created_at: string;
};

export type ShippingLabelTemplateResponse = {
	id: string;
	name: string;
	format: ShippingLabelFormat;
	privacy_mode: ShippingLabelPrivacyMode;
	brand_mode: ShippingLabelBrandMode;
	partner_brand_name: string | null;
	disclosure_text: string | null;
	active_version: number;
	updated_at: string;
	history?: ShippingLabelTemplateVersionItem[];
};

export type ShippingLabelJobResponse = {
	id: string;
	shipment_id: string;
	format: ShippingLabelFormat;
	status: "queued" | "rendering" | "succeeded" | "failed";
	artifact_id: string | null;
	failure_code: string | null;
	created_at: string;
};

export type ShippingLabelArtifactResponse = {
	id: string;
	shipment_id: string;
	tracking_number: string;
	format: ShippingLabelFormat;
	template_version: number;
	content_sha256: string;
	size_bytes: number;
	status:
		| "valid"
		| "invalidated_by_reissue"
		| "invalidated_by_cancellation"
		| "expired";
	created_at: string;
};

export type ShippingLabelBatchItemResponse = {
	shipment_id: string;
	status: "queued" | "succeeded" | "failed";
	label_job_id: string | null;
	artifact_id: string | null;
	failure_code: string | null;
};

export type ShippingLabelBatchResponse = {
	id: string;
	format: ShippingLabelFormat;
	status: "queued" | "processing" | "succeeded" | "partially_failed" | "failed";
	items: ShippingLabelBatchItemResponse[];
	created_at: string;
};

export type ShippingPrintAttemptResponse = {
	id: string;
	shipment_id: string;
	artifact_id: string;
	actor_user_id: string;
	kind: "initial_print" | "reprint";
	outcome: "sent_to_printer" | "completed" | "failed";
	reason: string | null;
	created_at: string;
};

type ResolvedShipment = {
	shipment_id: string;
	fulfillment_id: string | null;
	booking_id: string | null;
	warehouse_id: string;
	warehouse_name: string;
	warehouse_city: string;
	order_id: string;
	order_number: string;
	parcel_id: string;
	tracking_number: string | null;
	cancelled: boolean;
	payment_method: string;
	cod_due: number;
	recipient_name: string;
	recipient_phone: string;
	address_line: string;
	district: string;
	subdistrict: string;
	city: string;
	province: string;
	postal_code: string;
	carrier_name: string;
	service_name: string;
	item_count: number;
};

function parsePagination(url: URL) {
	for (const name of url.searchParams.keys()) {
		if (
			!["cursor", "limit"].includes(name) ||
			url.searchParams.getAll(name).length !== 1
		) {
			throw invalid();
		}
	}
	const raw = url.searchParams.get("limit") ?? "20";
	if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(raw)) throw invalid();
	return {
		limit: integer(Number(raw), 1, 100),
		cursor: url.searchParams.has("cursor")
			? id(url.searchParams.get("cursor"))
			: null,
	};
}

function requireStaffMfa(principal: Principal) {
	if (!isStaff(principal)) {
		throw new AccessError(403, "FORBIDDEN");
	}
	if (!principal.mfaAt) {
		throw new AccessError(403, "MFA_REQUIRED");
	}
}

function assertLabelReadPermission(principal: Principal) {
	requireStaffMfa(principal);
	const allowed =
		principal.roles.includes("owner") ||
		principal.roles.includes("warehouse") ||
		principal.roles.includes("ecommerce_admin") ||
		principal.permissions.includes("shipping.labels.read");
	if (!allowed) {
		throw new AccessError(403, "FORBIDDEN");
	}
}

// DEC-018 Q3: finance reads label template versions and history alongside owner/warehouse/ecommerce_admin.
function assertTemplateReadPermission(principal: Principal) {
	requireStaffMfa(principal);
	const allowed =
		principal.roles.includes("owner") ||
		principal.roles.includes("warehouse") ||
		principal.roles.includes("ecommerce_admin") ||
		principal.roles.includes("finance") ||
		principal.permissions.includes("shipping.labels.read");
	if (!allowed) {
		throw new AccessError(403, "FORBIDDEN");
	}
}

function assertLabelGeneratePermission(principal: Principal) {
	requireStaffMfa(principal);
	const allowed =
		principal.roles.includes("owner") ||
		principal.roles.includes("warehouse") ||
		principal.roles.includes("ecommerce_admin") ||
		principal.permissions.includes("shipping.labels.generate");
	if (!allowed) {
		throw new AccessError(403, "FORBIDDEN");
	}
}

function assertLabelPrintPermission(principal: Principal) {
	requireStaffMfa(principal);
	const allowed =
		principal.roles.includes("owner") ||
		principal.roles.includes("warehouse") ||
		principal.roles.includes("ecommerce_admin") ||
		principal.permissions.includes("shipping.labels.print");
	if (!allowed) {
		throw new AccessError(403, "FORBIDDEN");
	}
}

function assertTemplateManagePermission(principal: Principal) {
	requireStaffMfa(principal);
	if (!principal.roles.includes("owner")) {
		throw new AccessError(403, "FORBIDDEN");
	}
}

function assertWarehouseScope(principal: Principal, warehouseId: string) {
	if (principal.roles.includes("owner")) return;
	if (!principal.warehouseIds.includes(warehouseId)) {
		throw new AccessError(403, "WAREHOUSE_SCOPE_DENIED");
	}
}

async function checkIdempotency<T>(
	tx: TransactionSql,
	actorId: string,
	action: string,
	key: string,
	hash: string,
): Promise<T | null> {
	const [existing] = await tx<{ request_hash: string; response: T }[]>`
		select request_hash, response
		from app.access_operation
		where actor_id = ${actorId} and action = ${action} and key = ${key}
	`;
	if (!existing) return null;
	if (existing.request_hash !== hash) {
		throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
	}
	return existing.response;
}

async function saveIdempotency<T>(
	tx: TransactionSql,
	actorId: string,
	action: string,
	key: string,
	hash: string,
	subjectId: string | null,
	reason: string,
	response: T,
	details: Record<string, unknown> = {},
): Promise<T> {
	await tx`
		insert into app.access_operation (actor_id, action, key, request_hash, response)
		values (${actorId}, ${action}, ${key}, ${hash}, ${JSON.stringify(response)}::jsonb)
	`;
	await tx`
		insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
		values (${actorId}, ${action}, ${subjectId}, 'allowed', ${reason}, ${JSON.stringify(details)}::jsonb)
	`;
	return response;
}

async function ensureDefaultTemplates(tx: TransactionSql, actorId: string) {
	const defaults: Array<{
		code: string;
		format: ShippingLabelFormat;
	}> = [
		{ code: "99ribu-thermal-default", format: "thermal_100x150" },
		{ code: "99ribu-a4-default", format: "a4" },
	];
	for (const def of defaults) {
		const [existing] = await tx<{ id: string }[]>`
			select id from app.shipping_label_template where code = ${def.code}
		`;
		if (!existing) {
			const templateId = randomUUID();
			await tx`
				insert into app.shipping_label_template (
					id,
					code,
					carrier_code,
					service_code,
					format,
					brand_mode,
					privacy_mode,
					active_revision,
					enabled
				)
				values (
					${templateId},
					${def.code},
					'LOCAL',
					'REG',
					${def.format},
					'99ribu',
					'masked_phone',
					1,
					true
				)
				on conflict (code) do nothing
			`;
			const [tpl] = await tx<{ id: string }[]>`
				select id from app.shipping_label_template where code = ${def.code}
			`;
			if (tpl) {
				await tx`
					insert into app.shipping_label_template_version (
						template_id,
						revision,
						renderer_version,
						permission_evidence,
						disclosure_text,
						actor_id,
						reason
					)
					values (
						${tpl.id},
						1,
						'v1',
						'',
						'',
						${actorId},
						'Default 99ribu shipping label template'
					)
					on conflict (template_id, revision) do nothing
				`;
			}
		}
	}
}

async function formatTemplate(
	tx: TransactionSql,
	templateId: string,
): Promise<ShippingLabelTemplateResponse> {
	const [row] = await tx<
		{
			id: string;
			code: string;
			format: ShippingLabelFormat;
			privacy_mode: ShippingLabelPrivacyMode;
			brand_mode: ShippingLabelBrandMode;
			active_revision: number;
			updated_at: string;
			permission_evidence: string | null;
			disclosure_text: string | null;
		}[]
	>`
		select
			t.id,
			t.code,
			t.format,
			t.privacy_mode,
			t.brand_mode,
			t.active_revision,
			t.updated_at,
			v.permission_evidence,
			v.disclosure_text
		from app.shipping_label_template t
		left join app.shipping_label_template_version v
			on v.template_id = t.id and v.revision = t.active_revision
		where t.id = ${templateId}
	`;
	if (!row) throw new AccessError(404, "NOT_FOUND");
	const versions = await tx<
		{
			revision: number;
			renderer_version: string;
			permission_evidence: string | null;
			disclosure_text: string | null;
			actor_id: string;
			reason: string;
			created_at: string;
		}[]
	>`
		select revision, renderer_version, permission_evidence, disclosure_text, actor_id, reason, created_at
		from app.shipping_label_template_version
		where template_id = ${templateId}
		order by revision desc
	`;
	return {
		id: String(row.id),
		name: row.code,
		format: row.format,
		privacy_mode: row.privacy_mode,
		brand_mode: row.brand_mode,
		partner_brand_name: row.permission_evidence || null,
		disclosure_text: row.disclosure_text || null,
		active_version: Number(row.active_revision),
		updated_at: new Date(row.updated_at).toISOString(),
		history: versions.map((v) => ({
			version: Number(v.revision),
			renderer_version: v.renderer_version,
			partner_brand_name: v.permission_evidence || null,
			disclosure_text: v.disclosure_text || null,
			actor_id: v.actor_id,
			reason: v.reason,
			created_at: new Date(v.created_at).toISOString(),
		})),
	};
}

async function resolveShipment(
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

function escapePdfText(input: string): string {
	return input
		.replace(/•/g, "*")
		.replace(/\\/g, "\\\\")
		.replace(/\(/g, "\\(")
		.replace(/\)/g, "\\)")
		.replace(/[^\x20-\x7E]/g, "?");
}

function renderShippingLabelPdf(snapshot: {
	format: ShippingLabelFormat;
	brand_mode: ShippingLabelBrandMode;
	partner_brand_name: string | null;
	disclosure_text: string | null;
	privacy_mode: ShippingLabelPrivacyMode;
	tracking_number: string;
	order_number: string;
	parcel_id: string;
	carrier_name: string;
	service_name: string;
	warehouse_name: string;
	warehouse_city: string;
	recipient_name: string;
	recipient_phone: string;
	address_line: string;
	district: string;
	subdistrict: string;
	city: string;
	province: string;
	postal_code: string;
	payment_method: string;
	cod_due: number;
	item_count: number;
	template_version: number;
}): Buffer {
	const width = snapshot.format === "thermal_100x150" ? 283 : 595;
	const height = snapshot.format === "thermal_100x150" ? 425 : 842;
	const headerTitle =
		snapshot.brand_mode === "neutral_partner" && snapshot.partner_brand_name
			? `${snapshot.partner_brand_name} (Fulfilled via 99ribu)`
			: "99RIBU OFFICIAL LOGISTICS";
	const codBanner =
		snapshot.payment_method === "cod" && snapshot.cod_due > 0
			? `COD TAGIHAN: Rp ${snapshot.cod_due.toLocaleString("id-ID")}`
			: "NON-COD (LUNAS)";

	const lines = [
		`HEADER: ${headerTitle}`,
		...(snapshot.disclosure_text
			? [`DISCLOSURE: ${snapshot.disclosure_text}`]
			: []),
		`RESI / WAYBILL: ${snapshot.tracking_number}`,
		`BARCODE: |||| ${snapshot.tracking_number} ||||`,
		`KURIR: ${snapshot.carrier_name} - ${snapshot.service_name}`,
		`PEMBAYARAN: ${codBanner}`,
		`PESANAN: ${snapshot.order_number} (${snapshot.parcel_id})`,
		`ASAL GUDANG: ${snapshot.warehouse_name} (${snapshot.warehouse_city})`,
		`PENERIMA: ${snapshot.recipient_name}`,
		`TELEPON (${snapshot.privacy_mode}): ${snapshot.recipient_phone}`,
		`ALAMAT: ${snapshot.address_line}`,
		`KECAMATAN/KOTA: ${snapshot.subdistrict}, ${snapshot.district}, ${snapshot.city}`,
		`PROVINSI/KODEPOS: ${snapshot.province} ${snapshot.postal_code}`,
		`RINGKASAN PAKET: ${snapshot.item_count} unit (Rp99.000 Toko Serba 99 Ribu)`,
		`FORMAT: ${snapshot.format} | REV: v${snapshot.template_version}`,
	];

	const streamOps = [
		"BT",
		"/F1 10 Tf",
		`18 ${height - 28} Td`,
		"14 TL",
		...lines.map((line, index) =>
			index === 0
				? `(${escapePdfText(line)}) Tj`
				: `T* (${escapePdfText(line)}) Tj`,
		),
		"ET",
	].join("\n");

	const streamBytes = Buffer.byteLength(streamOps, "utf8");
	const objects = [
		"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
		"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
		`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
		"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
		`5 0 obj\n<< /Length ${streamBytes} >>\nstream\n${streamOps}\nendstream\nendobj\n`,
	];

	let pdf = "%PDF-1.4\n";
	const offsets: number[] = [0];
	for (const obj of objects) {
		offsets.push(Buffer.byteLength(pdf, "utf8"));
		pdf += obj;
	}
	const xrefOffset = Buffer.byteLength(pdf, "utf8");
	pdf += `xref\n0 ${objects.length + 1}\n`;
	pdf += "0000000000 65535 f \n";
	for (let i = 1; i < offsets.length; i++) {
		pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return Buffer.from(pdf, "utf8");
}

async function revalidateShipmentArtifacts(
	tx: TransactionSql,
	shipment: ResolvedShipment,
) {
	if (shipment.cancelled) {
		await tx`
			update app.shipping_label_artifact
			set status = 'invalidated_by_cancellation'
			where shipment_id = ${shipment.shipment_id} and status = 'valid'
		`;
		return;
	}
	if (shipment.tracking_number) {
		await tx`
			update app.shipping_label_artifact
			set status = 'invalidated_by_reissue'
			where shipment_id = ${shipment.shipment_id}
				and status = 'valid'
				and tracking_number <> ${shipment.tracking_number}
		`;
	}
	await tx`
		update app.shipping_label_artifact
		set status = 'expired'
		where shipment_id = ${shipment.shipment_id}
			and status = 'valid'
			and expires_at <= clock_timestamp()
	`;
}

async function generateOrReuseLabelForShipment(
	tx: TransactionSql,
	principal: Principal,
	shipment: ResolvedShipment,
	format: ShippingLabelFormat,
	templateId?: string | null,
): Promise<{
	job: ShippingLabelJobResponse;
	artifact: ShippingLabelArtifactResponse;
}> {
	await revalidateShipmentArtifacts(tx, shipment);
	if (shipment.cancelled) {
		throw new AccessError(409, "SHIPMENT_CANCELLED");
	}
	if (!shipment.tracking_number) {
		throw new AccessError(409, "WAYBILL_REQUIRED");
	}

	await ensureDefaultTemplates(tx, principal.id);
	const [templateRow] = templateId
		? await tx<
				{
					id: string;
					code: string;
					format: ShippingLabelFormat;
					brand_mode: ShippingLabelBrandMode;
					privacy_mode: ShippingLabelPrivacyMode;
					active_revision: number;
					version_id: string;
					permission_evidence: string | null;
					disclosure_text: string | null;
				}[]
			>`
				select
					t.id,
					t.code,
					t.format,
					t.brand_mode,
					t.privacy_mode,
					t.active_revision,
					v.id as version_id,
					v.permission_evidence,
					v.disclosure_text
				from app.shipping_label_template t
				join app.shipping_label_template_version v
					on v.template_id = t.id and v.revision = t.active_revision
				where t.id = ${templateId} and t.enabled = true
			`
		: await tx<
				{
					id: string;
					code: string;
					format: ShippingLabelFormat;
					brand_mode: ShippingLabelBrandMode;
					privacy_mode: ShippingLabelPrivacyMode;
					active_revision: number;
					version_id: string;
					permission_evidence: string | null;
					disclosure_text: string | null;
				}[]
			>`
				select
					t.id,
					t.code,
					t.format,
					t.brand_mode,
					t.privacy_mode,
					t.active_revision,
					v.id as version_id,
					v.permission_evidence,
					v.disclosure_text
				from app.shipping_label_template t
				join app.shipping_label_template_version v
					on v.template_id = t.id and v.revision = t.active_revision
				where t.format = ${format} and t.enabled = true
				order by (t.code like '99ribu-%') desc, t.updated_at desc
				limit 1
			`;
	if (!templateRow) {
		throw new AccessError(404, "TEMPLATE_NOT_FOUND");
	}
	if (templateRow.format !== format) {
		throw new AccessError(409, "TEMPLATE_FORMAT_MISMATCH");
	}

	// Check for an existing valid artifact for this exact shipment + tracking_number + format + template_version
	const [existing] = await tx<
		{
			job_id: string;
			job_created_at: string;
			artifact_id: string;
			tracking_number: string;
			format: ShippingLabelFormat;
			sha256: string;
			byte_size: number;
			status:
				| "valid"
				| "invalidated_by_reissue"
				| "invalidated_by_cancellation"
				| "expired";
			snapshot: Record<string, unknown>;
			artifact_created_at: string;
		}[]
	>`
		select
			j.id as job_id,
			j.created_at as job_created_at,
			a.id as artifact_id,
			a.tracking_number,
			a.format,
			a.sha256,
			a.byte_size,
			a.status,
			a.snapshot,
			a.created_at as artifact_created_at
		from app.shipping_label_artifact a
		join app.shipping_label_job j on j.id = a.label_job_id
		where a.shipment_id = ${shipment.shipment_id}
			and a.tracking_number = ${shipment.tracking_number}
			and a.format = ${format}
			and a.status = 'valid'
			and j.template_version_id = ${templateRow.version_id}
		order by a.created_at desc
		limit 1
	`;
	if (existing) {
		return {
			job: {
				id: String(existing.job_id),
				shipment_id: shipment.shipment_id,
				format: existing.format,
				status: "succeeded",
				artifact_id: String(existing.artifact_id),
				failure_code: null,
				created_at: new Date(existing.job_created_at).toISOString(),
			},
			artifact: {
				id: String(existing.artifact_id),
				shipment_id: shipment.shipment_id,
				tracking_number: existing.tracking_number,
				format: existing.format,
				template_version: Number(
					existing.snapshot?.template_version ?? templateRow.active_revision,
				),
				content_sha256: existing.sha256,
				size_bytes: Number(existing.byte_size),
				status: existing.status,
				created_at: new Date(existing.artifact_created_at).toISOString(),
			},
		};
	}

	const phoneDisplay =
		templateRow.privacy_mode === "masked_phone"
			? maskReceiptPhone(shipment.recipient_phone)
			: shipment.recipient_phone;
	const snapshot = {
		format,
		brand_mode: templateRow.brand_mode,
		partner_brand_name: templateRow.permission_evidence || null,
		disclosure_text: templateRow.disclosure_text || null,
		privacy_mode: templateRow.privacy_mode,
		tracking_number: shipment.tracking_number,
		order_number: shipment.order_number,
		parcel_id: shipment.parcel_id,
		carrier_name: shipment.carrier_name,
		service_name: shipment.service_name,
		warehouse_name: shipment.warehouse_name,
		warehouse_city: shipment.warehouse_city,
		recipient_name: shipment.recipient_name,
		recipient_phone: phoneDisplay,
		address_line: shipment.address_line,
		district: shipment.district,
		subdistrict: shipment.subdistrict,
		city: shipment.city,
		province: shipment.province,
		postal_code: shipment.postal_code,
		payment_method: shipment.payment_method,
		cod_due: shipment.cod_due,
		item_count: shipment.item_count,
		template_id: String(templateRow.id),
		template_version: Number(templateRow.active_revision),
	};

	const pdfBytes = renderShippingLabelPdf(snapshot);
	const sha256 = createHash("sha256").update(pdfBytes).digest("hex");
	const byteSize = pdfBytes.byteLength;
	const jobId = randomUUID();
	const artifactId = randomUUID();
	const operationId = randomUUID();
	const storageKey = await savePrivateArtifact(pdfBytes);

	const [jobRow] = await tx<{ id: string; created_at: string }[]>`
		insert into app.shipping_label_job (
			id,
			shipment_id,
			fulfillment_id,
			booking_id,
			warehouse_id,
			tracking_number,
			template_version_id,
			format,
			status,
			operation_id,
			artifact_id
		)
		values (
			${jobId},
			${shipment.shipment_id},
			${shipment.fulfillment_id},
			${shipment.booking_id},
			${shipment.warehouse_id},
			${shipment.tracking_number},
			${templateRow.version_id},
			${format},
			'succeeded',
			${operationId},
			${artifactId}
		)
		returning id, created_at
	`;

	const [artifactRow] = await tx<{ id: string; created_at: string }[]>`
		insert into app.shipping_label_artifact (
			id,
			label_job_id,
			shipment_id,
			warehouse_id,
			tracking_number,
			format,
			storage_key,
			sha256,
			byte_size,
			page_count,
			status,
			snapshot,
			expires_at
		)
		values (
			${artifactId},
			${jobId},
			${shipment.shipment_id},
			${shipment.warehouse_id},
			${shipment.tracking_number},
			${format},
			${storageKey},
			${sha256},
			${byteSize},
			1,
			'valid',
			${JSON.stringify(snapshot)}::jsonb,
			clock_timestamp() + interval '30 days'
		)
		returning id, created_at
	`;

	return {
		job: {
			id: String(jobRow.id),
			shipment_id: shipment.shipment_id,
			format,
			status: "succeeded",
			artifact_id: String(artifactRow.id),
			failure_code: null,
			created_at: new Date(jobRow.created_at).toISOString(),
		},
		artifact: {
			id: String(artifactRow.id),
			shipment_id: shipment.shipment_id,
			tracking_number: shipment.tracking_number,
			format,
			template_version: Number(templateRow.active_revision),
			content_sha256: sha256,
			size_bytes: byteSize,
			status: "valid",
			created_at: new Date(artifactRow.created_at).toISOString(),
		},
	};
}

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

function printQueueInput(url: URL) {
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

export async function handleShippingLabels(
	request: Request,
	identity: LocalAuth,
) {
	try {
		assertOrigin(request);
		if (
			["authorization", "x-cart-token", "x-order-token"].some((name) =>
				request.headers.has(name),
			)
		) {
			throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
		}
		const url = new URL(request.url);
		if (request.method !== "GET" && url.search) throw invalid();
		const principal = await getPrincipal(request, identity);

		// 0. Print-center queue: GET /api/v1/admin/label-queue (cursor-paged, warehouse-scoped)
		if (url.pathname === "/api/v1/admin/label-queue") {
			if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
			assertLabelReadPermission(principal);
			const page = printQueueInput(url);
			return privateJson(
				await identity.sql.begin((tx) => readPrintQueue(tx, principal, page)),
				200,
			);
		}

		// 1. Templates: GET / POST /api/v1/admin/shipping-label-templates & POST /api/v1/admin/shipping-label-templates/[templateId]/versions
		if (url.pathname === "/api/v1/admin/shipping-label-templates") {
			if (request.method === "GET") {
				assertTemplateReadPermission(principal);
				const paging = parsePagination(url);
				const list = await identity.sql.begin(async (tx) => {
					await ensureDefaultTemplates(tx, principal.id);
					let rows: { id: string; created_at: string }[];
					if (paging.cursor) {
						const [anchor] = await tx<{ created_at: string }[]>`
							select created_at::text
							from app.shipping_label_template
							where id = ${paging.cursor}
						`;
						if (!anchor) throw invalid();
						rows = await tx`
							select id, created_at
							from app.shipping_label_template
							where (created_at, id) < (${anchor.created_at}::timestamptz, ${paging.cursor}::uuid)
							order by created_at desc, id desc
							limit ${paging.limit + 1}
						`;
					} else {
						rows = await tx`
							select id, created_at
							from app.shipping_label_template
							order by created_at desc, id desc
							limit ${paging.limit + 1}
						`;
					}
					const slice = rows.slice(0, paging.limit);
					const data: ShippingLabelTemplateResponse[] = [];
					for (const r of slice) {
						data.push(await formatTemplate(tx, r.id));
					}
					return {
						data,
						pagination: {
							next_cursor:
								rows.length > paging.limit
									? String(slice.at(-1)?.id ?? null)
									: null,
						},
					};
				});
				return privateJson(list, 200);
			}
			if (request.method === "POST") {
				assertTemplateManagePermission(principal);
				const key = mutationKey(request);
				const body = object(await readBody(request), [
					"name",
					"code",
					"carrier_code",
					"service_code",
					"format",
					"privacy_mode",
					"brand_mode",
					"partner_brand_name",
					"permission_evidence",
					"disclosure_text",
					"renderer_version",
					"reason",
					"expected_version",
					"reauthentication_proof",
				]);
				const expectedVersion =
					body.expected_version === undefined
						? undefined
						: integer(body.expected_version, 0, 2147483647);
				if (
					typeof body.reauthentication_proof !== "string" ||
					!body.reauthentication_proof.length ||
					body.reauthentication_proof.length > 100
				) {
					throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
				}
				const reauthenticationProof = body.reauthentication_proof;
				if (expectedVersion !== undefined && expectedVersion !== 0) {
					throw new AccessError(409, "TEMPLATE_VERSION_CONFLICT");
				}
				const name = text(body.name ?? body.code, 120).trim();
				if (!name) throw invalid();
				if (body.format !== "thermal_100x150" && body.format !== "a4") {
					throw invalid();
				}
				if (
					body.privacy_mode !== "masked_phone" &&
					body.privacy_mode !== "carrier_required_full_phone"
				) {
					throw invalid();
				}
				if (
					body.brand_mode !== "99ribu" &&
					body.brand_mode !== "neutral_partner"
				) {
					throw invalid();
				}
				const format = body.format;
				const privacyMode = body.privacy_mode;
				const brandMode = body.brand_mode;
				const rawPartnerBrand =
					body.partner_brand_name ?? body.permission_evidence ?? null;
				const partnerBrandName =
					rawPartnerBrand === null || String(rawPartnerBrand).trim() === ""
						? null
						: text(rawPartnerBrand, 500).trim();
				const rawDisclosure = body.disclosure_text ?? null;
				const disclosureText =
					rawDisclosure === null || String(rawDisclosure).trim() === ""
						? null
						: text(rawDisclosure, 500).trim();
				if (
					brandMode === "neutral_partner" &&
					(!partnerBrandName || !disclosureText)
				) {
					throw new AccessError(422, "PARTNER_BRAND_GOVERNANCE_REQUIRED");
				}
				const carrierCode =
					body.carrier_code === undefined
						? "LOCAL"
						: text(body.carrier_code, 60).trim() || "LOCAL";
				const serviceCode =
					body.service_code === undefined
						? "REG"
						: text(body.service_code, 60).trim() || "REG";
				const rendererVersion =
					body.renderer_version === undefined
						? "v1"
						: text(body.renderer_version, 40).trim() || "v1";
				const reason =
					body.reason === undefined
						? "Created shipping label template"
						: text(body.reason, 500).trim() ||
							"Created shipping label template";
				const hash = await intentHash(identity, "shipping.template.create", {
					name,
					format,
					privacyMode,
					brandMode,
					partnerBrandName,
					disclosureText,
					carrierCode,
					serviceCode,
					rendererVersion,
				});
				const created = await identity.sql.begin(async (tx) => {
					const prior = await checkIdempotency<ShippingLabelTemplateResponse>(
						tx,
						principal.id,
						"shipping.template.create",
						key,
						hash,
					);
					if (prior) return prior;
					const [dup] = await tx<{ id: string }[]>`
						select id from app.shipping_label_template where code = ${name.slice(0, 80)}
					`;
					if (dup) {
						throw new AccessError(409, "TEMPLATE_NAME_CONFLICT");
					}
					await consumeAccessProof(
						tx,
						principal,
						"shipping_label_template.version",
						"shipping-label-templates",
						reauthenticationProof,
					);
					const templateId = randomUUID();
					await tx`
						insert into app.shipping_label_template (
							id,
							code,
							carrier_code,
							service_code,
							format,
							brand_mode,
							privacy_mode,
							active_revision,
							enabled
						)
						values (
							${templateId},
							${name.slice(0, 80)},
							${carrierCode},
							${serviceCode},
							${format},
							${brandMode},
							${privacyMode},
							1,
							true
						)
					`;
					await tx`
						insert into app.shipping_label_template_version (
							template_id,
							revision,
							renderer_version,
							permission_evidence,
							disclosure_text,
							actor_id,
							reason
						)
						values (
							${templateId},
							1,
							${rendererVersion},
							${partnerBrandName ?? ""},
							${disclosureText ?? ""},
							${principal.id},
							${reason}
						)
					`;
					const response = await formatTemplate(tx, templateId);
					return saveIdempotency(
						tx,
						principal.id,
						"shipping.template.create",
						key,
						hash,
						templateId,
						reason,
						response,
					);
				});
				return privateJson(created, 201);
			}
			throw new AccessError(404, "NOT_FOUND");
		}

		const tplVersionMatch =
			/^\/api\/v1\/admin\/shipping-label-templates\/([^/]+)\/versions$/.exec(
				url.pathname,
			);
		if (tplVersionMatch) {
			if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
			assertTemplateManagePermission(principal);
			const templateId = id(tplVersionMatch[1]);
			const key = mutationKey(request);
			const body = object(await readBody(request), [
				"name",
				"code",
				"format",
				"privacy_mode",
				"brand_mode",
				"partner_brand_name",
				"permission_evidence",
				"disclosure_text",
				"renderer_version",
				"reason",
				"expected_version",
				"reauthentication_proof",
			]);
			if (
				typeof body.reauthentication_proof !== "string" ||
				!body.reauthentication_proof.length ||
				body.reauthentication_proof.length > 100
			) {
				throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
			}
			const reauthenticationProof = body.reauthentication_proof;
			if (body.format !== "thermal_100x150" && body.format !== "a4") {
				throw invalid();
			}
			if (
				body.privacy_mode !== "masked_phone" &&
				body.privacy_mode !== "carrier_required_full_phone"
			) {
				throw invalid();
			}
			if (
				body.brand_mode !== "99ribu" &&
				body.brand_mode !== "neutral_partner"
			) {
				throw invalid();
			}
			const format = body.format;
			const privacyMode = body.privacy_mode;
			const brandMode = body.brand_mode;
			const expectedVersion =
				body.expected_version === undefined
					? undefined
					: integer(body.expected_version, 1, 2147483647);
			const rawPartnerBrand =
				body.partner_brand_name ?? body.permission_evidence ?? null;
			const partnerBrandName =
				rawPartnerBrand === null || String(rawPartnerBrand).trim() === ""
					? null
					: text(rawPartnerBrand, 500).trim();
			const rawDisclosure = body.disclosure_text ?? null;
			const disclosureText =
				rawDisclosure === null || String(rawDisclosure).trim() === ""
					? null
					: text(rawDisclosure, 500).trim();
			if (
				brandMode === "neutral_partner" &&
				(!partnerBrandName || !disclosureText)
			) {
				throw new AccessError(422, "PARTNER_BRAND_GOVERNANCE_REQUIRED");
			}
			const rendererVersion =
				body.renderer_version === undefined
					? "v2"
					: text(body.renderer_version, 40).trim() || "v2";
			const reason =
				body.reason === undefined
					? "Published new shipping label template version"
					: text(body.reason, 500).trim() ||
						"Published new shipping label template version";
			const nameOverride =
				(body.name ?? body.code)
					? text(body.name ?? body.code, 120).trim()
					: null;
			const hash = await intentHash(identity, "shipping.template.version", {
				templateId,
				nameOverride,
				format,
				privacyMode,
				brandMode,
				partnerBrandName,
				disclosureText,
				expectedVersion,
				rendererVersion,
			});

			const updated = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<ShippingLabelTemplateResponse>(
					tx,
					principal.id,
					"shipping.template.version",
					key,
					hash,
				);
				if (prior) return prior;
				const [current] = await tx<
					{ id: string; code: string; active_revision: number }[]
				>`
					select id, code, active_revision
					from app.shipping_label_template
					where id = ${templateId}
					for update
				`;
				if (!current) throw new AccessError(404, "NOT_FOUND");
				if (
					expectedVersion !== undefined &&
					Number(current.active_revision) !== expectedVersion
				) {
					throw new AccessError(409, "TEMPLATE_VERSION_CONFLICT");
				}
				await consumeAccessProof(
					tx,
					principal,
					"shipping_label_template.version",
					"shipping-label-templates",
					reauthenticationProof,
				);
				const nextRevision = Number(current.active_revision) + 1;
				const nextCode = nameOverride
					? nameOverride.slice(0, 80)
					: current.code;
				await tx`
					update app.shipping_label_template
					set
						code = ${nextCode},
						format = ${format},
						brand_mode = ${brandMode},
						privacy_mode = ${privacyMode},
						active_revision = ${nextRevision},
						updated_at = clock_timestamp()
					where id = ${templateId}
				`;
				await tx`
					insert into app.shipping_label_template_version (
						template_id,
						revision,
						renderer_version,
						permission_evidence,
						disclosure_text,
						actor_id,
						reason
					)
					values (
						${templateId},
						${nextRevision},
						${rendererVersion},
						${partnerBrandName ?? ""},
						${disclosureText ?? ""},
						${principal.id},
						${reason}
					)
				`;
				const response = await formatTemplate(tx, templateId);
				return saveIdempotency(
					tx,
					principal.id,
					"shipping.template.version",
					key,
					hash,
					templateId,
					reason,
					response,
				);
			});
			return privateJson(updated, 201);
		}

		// 2. Single-parcel label job & current label PDF: /api/v1/admin/shipments/[shipmentId]/(label-jobs|label|print-attempts)
		const shipmentLabelMatch =
			/^\/api\/v1\/admin\/shipments\/([^/]+)\/(label-jobs|label|print-attempts)$/.exec(
				url.pathname,
			);
		if (shipmentLabelMatch) {
			const shipmentIdParam = id(shipmentLabelMatch[1]);
			const actionKind = shipmentLabelMatch[2];

			if (actionKind === "label-jobs") {
				if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
				assertLabelGeneratePermission(principal);
				const key = mutationKey(request);
				const body = object(await readBody(request), ["format", "template_id"]);
				if (body.format !== "thermal_100x150" && body.format !== "a4") {
					throw invalid();
				}
				const format = body.format;
				const templateId =
					body.template_id === undefined || body.template_id === null
						? null
						: id(body.template_id);
				const hash = await intentHash(identity, "shipping.label.generate", {
					shipmentId: shipmentIdParam,
					format,
					templateId,
				});
				const job = await identity.sql.begin(async (tx) => {
					const prior = await checkIdempotency<ShippingLabelJobResponse>(
						tx,
						principal.id,
						"shipping.label.generate",
						key,
						hash,
					);
					if (prior) return prior;
					const shipment = await resolveShipment(tx, shipmentIdParam);
					if (!shipment) throw new AccessError(404, "NOT_FOUND");
					assertWarehouseScope(principal, shipment.warehouse_id);
					const generated = await generateOrReuseLabelForShipment(
						tx,
						principal,
						shipment,
						format,
						templateId,
					);
					return saveIdempotency(
						tx,
						principal.id,
						"shipping.label.generate",
						key,
						hash,
						shipment.shipment_id,
						"Generated or reused shipment label artifact",
						generated.job,
						{ artifact_id: generated.artifact.id },
					);
				});
				return privateJson(job, 202);
			}

			if (actionKind === "label") {
				if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
				if (url.search) throw invalid();
				assertLabelReadPermission(principal);
				const { storageKey, sha256, byteSize, trackingNumber } =
					await identity.sql.begin(async (tx) => {
						const shipment = await resolveShipment(tx, shipmentIdParam);
						if (!shipment) throw new AccessError(404, "NOT_FOUND");
						assertWarehouseScope(principal, shipment.warehouse_id);
						await revalidateShipmentArtifacts(tx, shipment);
						const [artifact] = await tx<
							{
								id: string;
								storage_key: string;
								sha256: string;
								byte_size: number;
								tracking_number: string;
								status: string;
							}[]
						>`
							select id, storage_key, sha256, byte_size, tracking_number, status
							from app.shipping_label_artifact
							where shipment_id = ${shipment.shipment_id}
							order by (status = 'valid') desc, created_at desc
							limit 1
						`;
						if (!artifact) throw new AccessError(404, "NOT_FOUND");
						if (artifact.status !== "valid") {
							throw new AccessError(409, "LABEL_ARTIFACT_INVALIDATED");
						}
						return {
							storageKey: artifact.storage_key,
							sha256: artifact.sha256,
							byteSize: Number(artifact.byte_size),
							trackingNumber: artifact.tracking_number,
						};
					});
				const bytes = await readPrivateArtifact(storageKey);
				const actualSha = createHash("sha256").update(bytes).digest("hex");
				if (actualSha !== sha256 || bytes.byteLength !== byteSize) {
					throw new AccessError(500, "LABEL_CHECKSUM_MISMATCH");
				}
				return new Response(new Uint8Array(bytes), {
					status: 200,
					headers: {
						"content-type": "application/pdf",
						"cache-control": "no-store",
						"x-content-type-options": "nosniff",
						"content-disposition": `inline; filename="label-${trackingNumber}.pdf"`,
					},
				});
			}

			// actionKind === "print-attempts"
			if (request.method === "GET") {
				assertLabelReadPermission(principal);
				const paging = parsePagination(url);
				const list = await identity.sql.begin(async (tx) => {
					const shipment = await resolveShipment(tx, shipmentIdParam);
					if (!shipment) throw new AccessError(404, "NOT_FOUND");
					assertWarehouseScope(principal, shipment.warehouse_id);
					let rows: {
						id: string;
						shipment_id: string;
						artifact_id: string;
						actor_id: string;
						kind: "initial_print" | "reprint";
						reported_outcome: "sent_to_printer" | "completed" | "failed";
						reason: string | null;
						created_at: string;
					}[];
					if (paging.cursor) {
						const [anchor] = await tx<{ created_at: string }[]>`
							select created_at::text
							from app.shipping_print_attempt
							where id = ${paging.cursor} and shipment_id = ${shipment.shipment_id}
						`;
						if (!anchor) throw invalid();
						rows = await tx`
							select id, shipment_id, artifact_id, actor_id, kind, reported_outcome, reason, created_at
							from app.shipping_print_attempt
							where shipment_id = ${shipment.shipment_id}
								and (created_at, id) < (${anchor.created_at}::timestamptz, ${paging.cursor}::uuid)
							order by created_at desc, id desc
							limit ${paging.limit + 1}
						`;
					} else {
						rows = await tx`
							select id, shipment_id, artifact_id, actor_id, kind, reported_outcome, reason, created_at
							from app.shipping_print_attempt
							where shipment_id = ${shipment.shipment_id}
							order by created_at desc, id desc
							limit ${paging.limit + 1}
						`;
					}
					const slice = rows.slice(0, paging.limit);
					return {
						data: slice.map((r) => ({
							id: String(r.id),
							shipment_id: String(r.shipment_id),
							artifact_id: String(r.artifact_id),
							actor_user_id: r.actor_id,
							kind: r.kind,
							outcome: r.reported_outcome,
							reason: r.reason || null,
							created_at: new Date(r.created_at).toISOString(),
						})),
						pagination: {
							next_cursor:
								rows.length > paging.limit
									? String(slice.at(-1)?.id ?? null)
									: null,
						},
					};
				});
				return privateJson(list, 200);
			}

			if (request.method === "POST") {
				assertLabelPrintPermission(principal);
				const key = mutationKey(request);
				const body = object(await readBody(request), [
					"artifact_id",
					"kind",
					"outcome",
					"reason",
				]);
				const artifactId = id(body.artifact_id);
				if (body.kind !== "initial_print" && body.kind !== "reprint") {
					throw invalid();
				}
				if (
					body.outcome !== "sent_to_printer" &&
					body.outcome !== "completed" &&
					body.outcome !== "failed"
				) {
					throw invalid();
				}
				const kind = body.kind;
				const outcome = body.outcome;
				const reason =
					body.reason === undefined ||
					body.reason === null ||
					String(body.reason).trim() === ""
						? null
						: text(body.reason, 500).trim();
				if (kind === "reprint" && !reason) {
					throw new AccessError(422, "REPRINT_REASON_REQUIRED");
				}
				const hash = await intentHash(identity, "shipping.label.print", {
					shipmentId: shipmentIdParam,
					artifactId,
					kind,
					outcome,
					reason,
				});
				const attempt = await identity.sql.begin(async (tx) => {
					const prior = await checkIdempotency<ShippingPrintAttemptResponse>(
						tx,
						principal.id,
						"shipping.label.print",
						key,
						hash,
					);
					if (prior) return prior;
					const shipment = await resolveShipment(tx, shipmentIdParam);
					if (!shipment) throw new AccessError(404, "NOT_FOUND");
					assertWarehouseScope(principal, shipment.warehouse_id);
					await revalidateShipmentArtifacts(tx, shipment);

					const [artifact] = await tx<
						{ id: string; shipment_id: string; status: string }[]
					>`
						select id, shipment_id, status
						from app.shipping_label_artifact
						where id = ${artifactId} and shipment_id = ${shipment.shipment_id}
						for share
					`;
					if (!artifact) throw new AccessError(404, "NOT_FOUND");
					if (artifact.status !== "valid") {
						throw new AccessError(409, "LABEL_ARTIFACT_INVALIDATED");
					}
					if (kind === "initial_print") {
						const [completedInitial] = await tx<{ id: string }[]>`
							select id from app.shipping_print_attempt
							where shipment_id = ${shipment.shipment_id}
								and artifact_id = ${artifactId}
								and reported_outcome = 'completed'
							limit 1
						`;
						if (completedInitial) {
							throw new AccessError(409, "INITIAL_PRINT_ALREADY_COMPLETED");
						}
					}
					const attemptId = randomUUID();
					const [inserted] = await tx<
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
						insert into app.shipping_print_attempt (
							id,
							shipment_id,
							artifact_id,
							warehouse_id,
							actor_id,
							kind,
							reported_outcome,
							reason
						)
						values (
							${attemptId},
							${shipment.shipment_id},
							${artifactId},
							${shipment.warehouse_id},
							${principal.id},
							${kind},
							${outcome},
							${reason ?? ""}
						)
						returning id, shipment_id, artifact_id, actor_id, kind, reported_outcome, reason, created_at
					`;
					const response: ShippingPrintAttemptResponse = {
						id: String(inserted.id),
						shipment_id: String(inserted.shipment_id),
						artifact_id: String(inserted.artifact_id),
						actor_user_id: inserted.actor_id,
						kind: inserted.kind,
						outcome: inserted.reported_outcome,
						reason: inserted.reason || null,
						created_at: new Date(inserted.created_at).toISOString(),
					};
					return saveIdempotency(
						tx,
						principal.id,
						"shipping.label.print",
						key,
						hash,
						shipment.shipment_id,
						reason ?? `Recorded ${kind} (${outcome})`,
						response,
						{ attempt_id: attemptId, artifact_id: artifactId, kind, outcome },
					);
				});
				return privateJson(attempt, 201);
			}
			throw new AccessError(404, "NOT_FOUND");
		}

		// 3. Label job lookup: GET /api/v1/admin/label-jobs/[labelJobId]
		const labelJobMatch = /^\/api\/v1\/admin\/label-jobs\/([^/]+)$/.exec(
			url.pathname,
		);
		if (labelJobMatch) {
			if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
			if (url.search) throw invalid();
			assertLabelReadPermission(principal);
			const jobId = id(labelJobMatch[1]);
			const job = await identity.sql.begin(async (tx) => {
				const [row] = await tx<
					{
						id: string;
						shipment_id: string;
						warehouse_id: string;
						format: ShippingLabelFormat;
						status: "queued" | "rendering" | "succeeded" | "failed";
						artifact_id: string | null;
						created_at: string;
					}[]
				>`
					select id, shipment_id, warehouse_id, format, status, artifact_id, created_at
					from app.shipping_label_job
					where id = ${jobId}
				`;
				if (!row) throw new AccessError(404, "NOT_FOUND");
				assertWarehouseScope(principal, String(row.warehouse_id));
				return {
					id: String(row.id),
					shipment_id: String(row.shipment_id),
					format: row.format,
					status: row.status,
					artifact_id: row.artifact_id ? String(row.artifact_id) : null,
					failure_code: null,
					created_at: new Date(row.created_at).toISOString(),
				};
			});
			return privateJson(job, 200);
		}

		// 4. Label artifact metadata & content: GET /api/v1/admin/label-artifacts/[artifactId](/content)
		const artifactMatch =
			/^\/api\/v1\/admin\/label-artifacts\/([^/]+)(?:\/(content))?$/.exec(
				url.pathname,
			);
		if (artifactMatch) {
			if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
			if (url.search) throw invalid();
			assertLabelReadPermission(principal);
			const artifactId = id(artifactMatch[1]);
			const isContent = artifactMatch[2] === "content";

			const info = await identity.sql.begin(async (tx) => {
				const [row] = await tx<
					{
						id: string;
						shipment_id: string;
						warehouse_id: string;
						tracking_number: string;
						format: ShippingLabelFormat;
						storage_key: string;
						sha256: string;
						byte_size: number;
						status:
							| "valid"
							| "invalidated_by_reissue"
							| "invalidated_by_cancellation"
							| "expired";
						snapshot: Record<string, unknown>;
						created_at: string;
					}[]
				>`
					select id, shipment_id, warehouse_id, tracking_number, format, storage_key, sha256, byte_size, status, snapshot, created_at
					from app.shipping_label_artifact
					where id = ${artifactId}
				`;
				if (!row) throw new AccessError(404, "NOT_FOUND");
				assertWarehouseScope(principal, String(row.warehouse_id));
				const shipment = await resolveShipment(tx, String(row.shipment_id));
				if (shipment) {
					await revalidateShipmentArtifacts(tx, shipment);
				}
				const [reloaded] = await tx<(typeof row)[]>`
					select id, shipment_id, warehouse_id, tracking_number, format, storage_key, sha256, byte_size, status, snapshot, created_at
					from app.shipping_label_artifact
					where id = ${artifactId}
				`;
				return reloaded;
			});

			if (!isContent) {
				const metadata: ShippingLabelArtifactResponse = {
					id: String(info.id),
					shipment_id: String(info.shipment_id),
					tracking_number: info.tracking_number,
					format: info.format,
					template_version: Number(info.snapshot?.template_version ?? 1),
					content_sha256: info.sha256,
					size_bytes: Number(info.byte_size),
					status: info.status,
					created_at: new Date(info.created_at).toISOString(),
				};
				return privateJson(metadata, 200);
			}

			if (info.status !== "valid") {
				throw new AccessError(409, "LABEL_ARTIFACT_INVALIDATED");
			}
			const bytes = await readPrivateArtifact(info.storage_key);
			const actualSha = createHash("sha256").update(bytes).digest("hex");
			if (
				actualSha !== info.sha256 ||
				bytes.byteLength !== Number(info.byte_size)
			) {
				throw new AccessError(500, "LABEL_CHECKSUM_MISMATCH");
			}
			return new Response(new Uint8Array(bytes), {
				status: 200,
				headers: {
					"content-type": "application/pdf",
					"cache-control": "no-store",
					"x-content-type-options": "nosniff",
					"content-disposition": `inline; filename="label-${info.tracking_number}.pdf"`,
				},
			});
		}

		// 5. Batch label generation & lookup: /api/v1/admin/label-batches(/[batchId])
		if (url.pathname === "/api/v1/admin/label-batches") {
			if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
			assertLabelGeneratePermission(principal);
			const key = mutationKey(request);
			const body = object(await readBody(request), [
				"shipment_ids",
				"format",
				"template_id",
			]);
			const shipmentIds = array(body.shipment_ids, (v) => id(v), 1, 100);
			if (new Set(shipmentIds).size !== shipmentIds.length) {
				throw invalid();
			}
			if (body.format !== "thermal_100x150" && body.format !== "a4") {
				throw invalid();
			}
			const format = body.format;
			const templateId =
				body.template_id === undefined || body.template_id === null
					? null
					: id(body.template_id);
			const hash = await intentHash(identity, "shipping.label.batch", {
				shipmentIds,
				format,
				templateId,
			});

			const batch = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<ShippingLabelBatchResponse>(
					tx,
					principal.id,
					"shipping.label.batch",
					key,
					hash,
				);
				if (prior) return prior;

				const items: Array<{
					shipment_id: string;
					shipment_exists: boolean;
					ordinal: number;
					outcome: "ready" | "reused" | "failed";
					label_job_id: string | null;
					artifact_id: string | null;
					failure_code: string | null;
				}> = [];
				let batchWarehouseId: string | null = principal.warehouseIds[0] ?? null;

				for (let index = 0; index < shipmentIds.length; index++) {
					const targetShipmentId = shipmentIds[index];
					const shipment = await resolveShipment(tx, targetShipmentId);
					if (!shipment) {
						items.push({
							shipment_id: targetShipmentId,
							shipment_exists: false,
							ordinal: index + 1,
							outcome: "failed",
							label_job_id: null,
							artifact_id: null,
							failure_code: "SHIPMENT_NOT_FOUND",
						});
						continue;
					}
					if (
						!principal.roles.includes("owner") &&
						!principal.warehouseIds.includes(shipment.warehouse_id)
					) {
						items.push({
							shipment_id: shipment.shipment_id,
							shipment_exists: true,
							ordinal: index + 1,
							outcome: "failed",
							label_job_id: null,
							artifact_id: null,
							failure_code: "WAREHOUSE_SCOPE_DENIED",
						});
						continue;
					}
					if (!batchWarehouseId) {
						batchWarehouseId = shipment.warehouse_id;
					}
					try {
						const res = await generateOrReuseLabelForShipment(
							tx,
							principal,
							shipment,
							format,
							templateId,
						);
						items.push({
							shipment_id: shipment.shipment_id,
							shipment_exists: true,
							ordinal: index + 1,
							outcome: "ready",
							label_job_id: res.job.id,
							artifact_id: res.artifact.id,
							failure_code: null,
						});
					} catch (err) {
						const code =
							err instanceof AccessError ? err.code : "GENERATION_FAILED";
						items.push({
							shipment_id: shipment.shipment_id,
							shipment_exists: true,
							ordinal: index + 1,
							outcome: "failed",
							label_job_id: null,
							artifact_id: null,
							failure_code: code,
						});
					}
				}

				if (!batchWarehouseId) {
					const [anyWh] = await tx<{ id: string }[]>`
						select id from app.warehouse order by id limit 1
					`;
					if (!anyWh) throw new AccessError(409, "WAREHOUSE_REQUIRED");
					batchWarehouseId = String(anyWh.id);
				}

				const succeededCount = items.filter(
					(i) => i.outcome !== "failed",
				).length;
				const failedCount = items.length - succeededCount;
				const dbStatus =
					failedCount === 0
						? "succeeded"
						: succeededCount === 0
							? "failed"
							: "partial";
				const apiStatus: ShippingLabelBatchResponse["status"] =
					failedCount === 0
						? "succeeded"
						: succeededCount === 0
							? "failed"
							: "partially_failed";

				const batchId = randomUUID();
				const summaryItems = items.map((i) => ({
					shipment_id: i.shipment_id,
					status:
						i.outcome === "failed"
							? ("failed" as const)
							: ("succeeded" as const),
					label_job_id: i.label_job_id,
					artifact_id: i.artifact_id,
					failure_code: i.failure_code,
				}));
				const summary = {
					total: items.length,
					succeeded: succeededCount,
					failed: failedCount,
					items: summaryItems,
				};
				const [batchRow] = await tx<{ id: string; created_at: string }[]>`
					insert into app.shipping_print_batch (
						id,
						warehouse_id,
						actor_id,
						format,
						status,
						summary
					)
					values (
						${batchId},
						${batchWarehouseId},
						${principal.id},
						${format},
						${dbStatus},
						${JSON.stringify(summary)}::jsonb
					)
					returning id, created_at
				`;

				for (const item of items) {
					if (!item.shipment_exists) continue;
					await tx`
						insert into app.shipping_print_batch_item (
							batch_id,
							shipment_id,
							ordinal,
							label_job_id,
							artifact_id,
							outcome,
							reason
						)
						values (
							${batchId},
							${item.shipment_id},
							${item.ordinal},
							${item.label_job_id},
							${item.artifact_id},
							${item.outcome},
							${item.failure_code ?? ""}
						)
					`;
				}

				const response: ShippingLabelBatchResponse = {
					id: String(batchRow.id),
					format,
					status: apiStatus,
					items: summaryItems,
					created_at: new Date(batchRow.created_at).toISOString(),
				};
				return saveIdempotency(
					tx,
					principal.id,
					"shipping.label.batch",
					key,
					hash,
					batchId,
					"Created shipping label print batch",
					response,
					summary,
				);
			});
			return privateJson(batch, 202);
		}

		const batchMatch = /^\/api\/v1\/admin\/label-batches\/([^/]+)$/.exec(
			url.pathname,
		);
		if (batchMatch) {
			if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
			if (url.search) throw invalid();
			assertLabelReadPermission(principal);
			const batchId = id(batchMatch[1]);
			const batch = await identity.sql.begin(async (tx) => {
				const [row] = await tx<
					{
						id: string;
						warehouse_id: string;
						format: ShippingLabelFormat;
						status: string;
						summary: {
							items?: Array<{
								shipment_id: string;
								status: "succeeded" | "failed";
								label_job_id: string | null;
								artifact_id: string | null;
								failure_code: string | null;
							}>;
						};
						created_at: string;
					}[]
				>`
					select id, warehouse_id, format, status, summary, created_at
					from app.shipping_print_batch
					where id = ${batchId}
				`;
				if (!row) throw new AccessError(404, "NOT_FOUND");
				assertWarehouseScope(principal, String(row.warehouse_id));
				const itemRows = await tx<
					{
						shipment_id: string;
						ordinal: number;
						label_job_id: string | null;
						artifact_id: string | null;
						outcome: string;
						reason: string | null;
					}[]
				>`
					select shipment_id, ordinal, label_job_id, artifact_id, outcome, reason
					from app.shipping_print_batch_item
					where batch_id = ${batchId}
					order by ordinal asc
				`;
				const apiStatus: ShippingLabelBatchResponse["status"] =
					row.status === "partial"
						? "partially_failed"
						: (row.status as ShippingLabelBatchResponse["status"]);
				const mappedItems =
					Array.isArray(row.summary?.items) &&
					row.summary.items.length > itemRows.length
						? row.summary.items
						: itemRows.map((i) => ({
								shipment_id: String(i.shipment_id),
								status:
									i.outcome === "failed"
										? ("failed" as const)
										: ("succeeded" as const),
								label_job_id: i.label_job_id ? String(i.label_job_id) : null,
								artifact_id: i.artifact_id ? String(i.artifact_id) : null,
								failure_code:
									i.outcome === "failed" ? i.reason || "FAILED" : null,
							}));
				return {
					id: String(row.id),
					format: row.format,
					status: apiStatus,
					items: mappedItems,
					created_at: new Date(row.created_at).toISOString(),
				};
			});
			return privateJson(batch, 200);
		}

		throw new AccessError(404, "NOT_FOUND");
	} catch (error) {
		return problem(error);
	}
}
