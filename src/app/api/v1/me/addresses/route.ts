import { getLocalAuth } from "@/modules/access/auth";
import { handleAccounts } from "@/modules/accounts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleAccounts(request, getLocalAuth());
}

export function POST(request: Request) {
	return handleAccounts(request, getLocalAuth());
}
