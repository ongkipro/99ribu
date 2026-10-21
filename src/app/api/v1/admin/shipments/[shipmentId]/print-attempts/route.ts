import { getLocalAuth } from "@/modules/access/auth";
import { handleShippingLabels } from "@/modules/documents/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleShippingLabels(request, getLocalAuth());
}

export function POST(request: Request) {
	return handleShippingLabels(request, getLocalAuth());
}
