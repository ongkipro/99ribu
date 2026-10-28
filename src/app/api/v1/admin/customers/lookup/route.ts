import { getLocalAuth } from "@/modules/access/auth";
import { handleCustomerLookup } from "@/modules/accounts/lookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
	return handleCustomerLookup(request, getLocalAuth());
}
