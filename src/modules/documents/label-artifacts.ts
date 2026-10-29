import { createHash, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { savePrivateArtifact } from "../../storage/private.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { maskReceiptPhone } from "../orders/receipt.ts";
import type {
	ResolvedShipment,
	ShippingLabelArtifactResponse,
	ShippingLabelBrandMode,
	ShippingLabelFormat,
	ShippingLabelJobResponse,
	ShippingLabelPrivacyMode,
} from "./label-shared.ts";
import { ensureDefaultTemplates } from "./label-templates.ts";

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

export async function revalidateShipmentArtifacts(
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

export async function generateOrReuseLabelForShipment(
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
