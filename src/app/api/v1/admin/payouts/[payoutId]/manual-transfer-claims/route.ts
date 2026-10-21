import { getLocalAuth } from "@/modules/access/auth";
import { handlePayouts } from "@/modules/payouts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
	return handlePayouts(request, getLocalAuth());
}
