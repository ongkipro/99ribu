import { getLocalAuth } from "@/modules/access/auth";
import { handleFinanceSummary } from "@/modules/finance/realized-contribution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleFinanceSummary(request, getLocalAuth());
}
