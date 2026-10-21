import { getLocalAuth } from "@/modules/access/auth";
import { handleAccess } from "@/modules/access/routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
	return handleAccess(request, getLocalAuth());
}
