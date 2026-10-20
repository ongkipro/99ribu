import { getLocalAuth } from "@/modules/access/auth";
import { handleAuth } from "@/modules/access/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleAuth(request, getLocalAuth()); }
export function POST(request: Request) { return handleAuth(request, getLocalAuth()); }
