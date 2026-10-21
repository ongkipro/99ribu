import { getLocalAuth } from "@/modules/access/auth";
import { handleAffiliateProfile } from "@/modules/affiliates/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
	return handleAffiliateProfile(request, getLocalAuth());
}

export function POST(request: Request) {
	return handleAffiliateProfile(request, getLocalAuth());
}
