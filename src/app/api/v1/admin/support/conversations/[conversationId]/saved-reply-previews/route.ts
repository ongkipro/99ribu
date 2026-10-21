import { getLocalAuth } from "../../../../../../../../modules/access/auth.ts";
import { handleSupport } from "../../../../../../../../modules/support/routes.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
	return handleSupport(request, getLocalAuth());
}
