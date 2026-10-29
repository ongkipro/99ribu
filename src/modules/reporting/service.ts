import type { LocalAuth } from "../access/auth.ts";
import { assertOrigin, privateJson, problem } from "../access/http.ts";
import { AccessError } from "../access/policy.ts";
import { getDashboardSnapshot } from "./dashboard.ts";
import { createExportSelection, exportCsv } from "./exports.ts";
import { getOperationStatus } from "./operations.ts";
import { listWorkQueue } from "./queue.ts";

export { getDashboardSnapshot } from "./dashboard.ts";
export { createExportSelection, exportCsv, sanitizeCsvCell } from "./exports.ts";
export { getOperationStatus } from "./operations.ts";
export { isTerminalQueueState, listWorkQueue } from "./queue.ts";
export {
	type CanonicalWorkspace,
	type DueAtKind,
	LOW_STOCK_THRESHOLD,
	type MetricKey,
	type MetricScope,
	type QueueKey,
	type QueueRowInternal,
	TRANSFER_DEADLINE_WARNING_HOURS,
} from "./shared.ts";
export { signTokenPayload, verifyTokenPayload } from "./tokens.ts";

export async function handleReporting(
	request: Request,
	identity: LocalAuth,
	operationId?: string,
): Promise<Response> {
	try {
		assertOrigin(request);
		const url = new URL(request.url);
		if (
			request.method === "GET" &&
			url.pathname === "/api/v1/admin/dashboard"
		) {
			return privateJson(await getDashboardSnapshot(request, identity));
		}
		if (
			request.method === "GET" &&
			url.pathname === "/api/v1/admin/work-queues"
		) {
			return privateJson(await listWorkQueue(request, identity));
		}
		if (
			request.method === "POST" &&
			url.pathname === "/api/v1/admin/export-selections"
		) {
			return privateJson(await createExportSelection(request, identity), 201);
		}
		if (request.method === "POST" && url.pathname === "/api/v1/admin/exports") {
			return await exportCsv(request, identity);
		}
		if (
			request.method === "GET" &&
			url.pathname.startsWith("/api/v1/operations/")
		) {
			const opId = operationId ?? url.pathname.split("/").pop() ?? "";
			return privateJson(await getOperationStatus(request, identity, opId));
		}
		throw new AccessError(404, "NOT_FOUND");
	} catch (error) {
		return problem(error);
	}
}
