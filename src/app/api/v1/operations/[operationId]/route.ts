import { getLocalAuth } from "@/modules/access/auth";
import { handleReporting } from "@/modules/reporting/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ operationId: string }> },
) {
  const { operationId } = await context.params;
  return handleReporting(request, getLocalAuth(), operationId);
}
