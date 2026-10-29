import type { LocalAuth } from "../access/auth.ts";
import { AccessError, getPrincipal } from "../access/policy.ts";
import { UUID_RE } from "./shared.ts";

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
