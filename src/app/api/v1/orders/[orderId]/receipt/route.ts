import { getLocalAuth } from "@/modules/access/auth";
import { handleOrderReceipt } from "@/modules/orders/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleOrderReceipt(request, getLocalAuth());
}
