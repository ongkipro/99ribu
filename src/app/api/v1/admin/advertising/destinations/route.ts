import { getLocalAuth } from "@/modules/access/auth";
import { handleAdvertisingDiagnostics } from "@/modules/advertising/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleAdvertisingDiagnostics(request, getLocalAuth());
}

export function POST(request: Request) {
	return handleAdvertisingDiagnostics(request, getLocalAuth());
}
