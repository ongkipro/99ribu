import type { TransactionSql } from "postgres";
import { AccessError, isStaff, type Principal } from "../access/policy.ts";
import { id, integer, invalid } from "../catalog/validation.ts";

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

export type ResolvedShipment = {
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

export function parsePagination(url: URL) {
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

export function assertLabelReadPermission(principal: Principal) {
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
export function assertTemplateReadPermission(principal: Principal) {
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

export function assertLabelGeneratePermission(principal: Principal) {
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

export function assertLabelPrintPermission(principal: Principal) {
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

export function assertTemplateManagePermission(principal: Principal) {
	requireStaffMfa(principal);
	if (!principal.roles.includes("owner")) {
		throw new AccessError(403, "FORBIDDEN");
	}
}

export function assertWarehouseScope(
	principal: Principal,
	warehouseId: string,
) {
	if (principal.roles.includes("owner")) return;
	if (!principal.warehouseIds.includes(warehouseId)) {
		throw new AccessError(403, "WAREHOUSE_SCOPE_DENIED");
	}
}

export async function checkIdempotency<T>(
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

export async function saveIdempotency<T>(
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
