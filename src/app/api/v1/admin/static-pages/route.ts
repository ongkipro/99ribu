import { getLocalAuth } from "@/modules/access/auth";
import { handleStaticPages } from "@/modules/storefront/static-pages";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleStaticPages(request, getLocalAuth()); }
