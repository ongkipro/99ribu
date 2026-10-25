import { getLocalAuth } from "@/modules/access/auth";
import { handleProfileCompletion } from "@/modules/accounts/profile-completion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleProfileCompletion(request, getLocalAuth());
}

export function POST(request: Request) {
	return handleProfileCompletion(request, getLocalAuth());
}
