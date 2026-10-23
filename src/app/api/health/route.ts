import { getLocalAuth } from "@/modules/access/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // The web process's own app pool (profile-selected target), not a second pool per probe.
    const { sql } = getLocalAuth();
    // Schema-aware readiness for the current identity/worker foundation, not commerce availability.
    await sql`select (select count(*) from app.auth_user where false), (select count(*) from app.outbox_job where false)`;
    return Response.json({ service: "99ribu", status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ service: "99ribu", status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
