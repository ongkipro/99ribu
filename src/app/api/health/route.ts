import { connectDatabase } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let connection: ReturnType<typeof connectDatabase> | undefined;

export async function GET() {
  try {
    connection ??= connectDatabase("local");
    // Schema-aware readiness for the current identity/worker foundation, not commerce availability.
    await connection.sql`select (select count(*) from app.auth_user where false), (select count(*) from app.outbox_job where false)`;
    return Response.json({ service: "99ribu", status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ service: "99ribu", status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
