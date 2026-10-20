import { connectDatabase } from "../../src/db/client.ts";
import { claimJob, expireLeases, runLeasedJob, type JobAdapter } from "../../src/jobs/leases.ts";
import { runOneJob } from "../../src/jobs/worker.ts";

const [kind, mode, ...extra] = process.argv.slice(2);
if (!/^lease\.probe\.[0-9a-f-]{36}$/.test(kind) || !["complete", "before", "after", "unknown", "timeout"].includes(mode) || extra.length) throw new Error("Invalid test worker arguments.");
const { sql } = connectDatabase("test");
async function pause() {
  process.stdin.resume();
  await new Promise<void>((resolve) => process.stdin.once("end", resolve));
}
try {
  if (mode === "before") {
    await expireLeases(sql);
    const claim = await claimJob(sql, kind);
    if (!claim) throw new Error("Expected controlled job claim.");
    console.log("claim_committed"); await pause();
  } else {
    const adapter: JobAdapter = {
      async dispatch(claim) {
        if (mode === "timeout") {
          const [backend] = await sql`select pg_backend_pid() as pid`;
          console.log(`adapter_waiting:${backend.pid}`);
          return new Promise<never>(() => {});
        }
        console.log("dispatch_started");
        const reference = claim.payload.deliveryId as string;
        await sql.begin(async (tx) => {
          const changed = await tx`update app.local_delivery set delivered_at=now() where id=${reference} and delivered_at is null returning id`;
          if (changed.length) await tx`insert into app.audit_event (actor_id,action,outcome,reason) values (${`lease-effect:${reference}`},'local.test.effect','allowed','Synthetic adapter effect')`;
        });
        if (mode === "after") { console.log("effect_committed"); await pause(); }
        if (mode === "unknown") throw new Error("Synthetic lost response");
        return { status: "succeeded", receipt: { reference } };
      },
      async reconcile(claim) {
        console.log("reconcile_started");
        const reference = claim.payload.deliveryId as string;
        const [effect] = await sql`select delivered_at from app.local_delivery where id=${reference}`;
        return effect?.delivered_at ? { status: "succeeded", receipt: { reference } } : { status: "unknown", code: "UNKNOWN_OUTCOME" };
      },
    };
    if (mode === "timeout") await runLeasedJob(sql, { [kind]: adapter }, 500);
    else await runOneJob(sql, { [kind]: adapter });
    console.log("done");
  }
} finally { await sql.end(); }
