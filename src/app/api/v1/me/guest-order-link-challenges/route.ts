import { getLocalAuth } from "@/modules/access/auth";
import { handleAccounts } from "@/modules/accounts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
	return handleAccounts(request, getLocalAuth());
}
