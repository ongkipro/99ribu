import { getLocalAuth } from "@/modules/access/auth";
import { handleAuditLog } from "@/modules/audit/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleAuditLog(request, getLocalAuth());
}
