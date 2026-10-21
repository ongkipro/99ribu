import { getLocalAuth } from "@/modules/access/auth";
import { handleCommissions } from "@/modules/commissions/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleCommissions(request, getLocalAuth());
}
