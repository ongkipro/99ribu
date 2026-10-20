import { getLocalAuth } from "@/modules/access/auth";
import { handleInventory } from "@/modules/inventory/routes";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleInventory(request, getLocalAuth()); }
