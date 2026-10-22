import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { connectDatabase } from "../../src/db/client.ts";
import { enqueueLocalDelivery } from "../../src/jobs/outbox.ts";
import { guestCleanup, runOneJob, sweepExpiredGuestContexts } from "../../src/jobs/worker.ts";

test("a failing guest-context cleanup is logged redacted, throttled, and never stops job processing", async (t) => {
  const { sql } = connectDatabase("test");
  const deliveryId = randomUUID();
  let cleanups = 0;
  // Inject a cleanup failure with a constraint SQLSTATE and a message that must never reach the log.
  const original = guestCleanup.run;
  guestCleanup.run = async () => {
    cleanups++;
    throw Object.assign(new Error("guest buyer@example.test"), { code: "23514" });
  };
  const logged: string[] = [];
  t.mock.method(console, "error", (line: string) => { logged.push(line); });
  try {
    await sql.begin(async (tx) => {
      await tx`insert into app.local_delivery (id, recipient, kind, url, expires_at) values (${deliveryId}, 'cleanup@example.test', 'existing_account', 'http://127.0.0.1:3099/login', now()+interval '30 minutes')`;
      const jobId = await enqueueLocalDelivery(tx, deliveryId);
      // Oldest run_at: the unscoped selector (which is the path that cleans up) picks this job first.
      await tx`update app.outbox_job set run_at=now()-interval '10 years' where id=${jobId}`;
    });
    assert.equal(await runOneJob(sql), true);
    const [job] = await sql`select status, attempts from app.outbox_job where dedup_key=${`local-delivery:${deliveryId}`}`;
    assert.equal(job.status, "completed"); assert.equal(job.attempts, 1);
    assert.equal(cleanups, 1);
    assert.deepEqual(logged.map((line) => JSON.parse(line)), [{ event: "jobs.guest_cleanup_failed", error: "Error", sqlstate: "23514" }]);
    assert.ok(!logged.join("").includes("buyer@example.test"));
    // Throttle check without consuming other suites' jobs from the shared queue.
    await sweepExpiredGuestContexts(sql);
    assert.equal(cleanups, 1, "cleanup runs at most once per minute per process");
  } finally {
    guestCleanup.run = original;
    await sql`delete from app.outbox_job where dedup_key=${`local-delivery:${deliveryId}`}`;
    await sql`delete from app.local_delivery where id=${deliveryId}`;
    await sql.end();
  }
});
