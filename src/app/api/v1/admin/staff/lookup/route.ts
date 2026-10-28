import { getLocalAuth } from "@/modules/access/auth";
import { handleStaff } from "@/modules/access/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleStaff(request, getLocalAuth());
}
