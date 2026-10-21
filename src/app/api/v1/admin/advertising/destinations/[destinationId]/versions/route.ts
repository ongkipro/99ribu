import { getLocalAuth } from "@/modules/access/auth";
import { handleAdvertisingDiagnostics } from "@/modules/advertising/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
	request: Request,
	context: { params: Promise<{ destinationId: string }> },
) {
	const { destinationId } = await context.params;
	return handleAdvertisingDiagnostics(request, getLocalAuth(), destinationId);
}
