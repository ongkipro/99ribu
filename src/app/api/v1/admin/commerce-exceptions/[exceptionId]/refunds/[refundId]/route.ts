import { getLocalAuth } from "@/modules/access/auth";
import { handleCommerceExceptions } from "@/modules/checkout/exceptions/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleCommerceExceptions(request, getLocalAuth());
}
