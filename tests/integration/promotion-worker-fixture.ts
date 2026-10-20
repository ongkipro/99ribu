import { connectDatabase } from "../../src/db/client.ts";
import { processDatabaseJob, type DatabaseJob } from "../../src/jobs/worker.ts";

const [jobId, mode, ...extra] = process.argv.slice(2);
if (!/^[0-9a-f-]{36}$/.test(jobId ?? "") || !["pause", "timeout"].includes(mode) || extra.length) throw new Error("Invalid promotion worker proof arguments.");
const { sql } = connectDatabase("test");
try {
  await sql.begin(async (tx) => {
    if (mode === "timeout") await tx.unsafe("SET LOCAL statement_timeout='100ms'");
    const [job] = await tx<DatabaseJob[]>`select id,kind,payload,attempts,max_attempts from app.outbox_job where id=${jobId} and kind='promotion.reservation.expire' and status='pending' for update`;
    if (!job) throw new Error("Owned pending promotion job is missing.");
    await processDatabaseJob(tx, job);
    if (mode === "pause") {
      console.log("effect_ready");
      const timer = setInterval(() => {}, 1000);
      try { await new Promise(() => {}); } finally { clearInterval(timer); }
    }
  });
} finally { await sql.end(); }
