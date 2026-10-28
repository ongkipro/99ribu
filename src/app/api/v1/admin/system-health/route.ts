import { getLocalAuth } from "@/modules/access/auth";
import { handleSystemHealth } from "@/modules/ops-health/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleSystemHealth(request, getLocalAuth());
}
