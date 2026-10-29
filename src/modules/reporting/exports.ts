import { randomUUID } from "node:crypto";
import type { LocalAuth } from "../access/auth.ts";
import { assertOrigin, readBody } from "../access/http.ts";
import {
	AccessError,
	getPrincipal,
	hasPermission,
	type Principal,
} from "../access/policy.ts";
import { digest } from "../checkout/access.ts";
import { queryQueueRows } from "./queue.ts";
import {
	type CanonicalWorkspace,
	type QueueKey,
	type QueueRowInternal,
	resolveAuthorizedWarehouses,
	resolveWorkspace,
	UUID_RE,
} from "./shared.ts";
import { signTokenPayload, verifyTokenPayload } from "./tokens.ts";

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
	permission: "exports.read" | "exports.download",
	resource: string,
	columnSet?: string,
): CanonicalWorkspace {
	const workspace = resolveWorkspace(principal, null);
	// Contract: freezing a selection needs exports.read; producing the CSV
	// download needs exports.download. hasPermission grants owner both.
	if (!hasPermission(principal, permission)) {
		throw new AccessError(403, "FORBIDDEN");
	}
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
	const workspace = authorizeExportResource(principal, "exports.read", resource);

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
	const filterToken = await signTokenPayload(identity, {
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

	const workspace = authorizeExportResource(
		principal,
		"exports.download",
		resource,
		columnSet,
	);
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

		const decoded = await verifyTokenPayload(identity, filterToken);
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
