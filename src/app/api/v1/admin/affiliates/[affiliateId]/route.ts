import { getLocalAuth } from "@/modules/access/auth";
import { handleAdminAffiliates } from "@/modules/affiliates/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleAdminAffiliates(request, getLocalAuth());
}
