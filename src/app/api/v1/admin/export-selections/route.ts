import { getLocalAuth } from "@/modules/access/auth";
import { handleReporting } from "@/modules/reporting/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return handleReporting(request, getLocalAuth());
}
