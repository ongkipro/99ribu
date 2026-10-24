import { getLocalAuth } from "@/modules/access/auth";
import { handleWarehouseCalendars } from "@/modules/settings/calendars";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return handleWarehouseCalendars(request, getLocalAuth()); }
