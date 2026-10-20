import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { promisify } from "node:util";
import test from "node:test";
import { connectDatabase } from "../../src/db/client.ts";
import { enqueueJob } from "../../src/jobs/outbox.ts";
import { claimJob, expireLeases, markDispatched, renewLease, runLeasedJob, settleClaim, type JobAdapter, type Outcome } from "../../src/jobs/leases.ts";
import { runOneJob } from "../../src/jobs/worker.ts";

const exec = promisify(execFile);
const command = ["--env-file=.env.example", "tests/integration/job-worker-fixture.ts"];
async function fixture(maxAttempts = 5) {
  const { sql } = connectDatabase("test");
  const reference = randomUUID(); const kind = `lease.probe.${randomUUID()}`;
  const key = `lease:${reference}`;
  const id = await sql.begin(async (tx) => {
    await tx`insert into app.local_delivery (id,recipient,kind,url,expires_at) values (${reference},${`lease-${reference}@example.test`},'existing_account','http://127.0.0.1:3099/login',now()+interval '1 hour')`;
    return enqueueJob(tx, kind, key, { deliveryId: reference }, maxAttempts);
  });
  return { sql, reference, kind, key, id,
    async close() { await sql`delete from app.outbox_job where id=${id}`; await sql`delete from app.local_delivery where id=${reference}`; await sql.end(); } };
}
async function crashAt(kind: string, mode: string, marker: string) {
  const child = spawn(process.execPath, [...command, kind, mode], { stdio: ["pipe", "pipe", "ignore"] });
  const exited = once(child, "exit");
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Test worker did not reach its committed barrier.")), 5000);
      const data = (chunk: Buffer) => { output += chunk.toString(); if (output.includes(marker)) { clearTimeout(timer); child.stdout.off("data", data); resolve(); } };
      child.stdout.on("data", data);
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Test worker exited before its barrier.")); });
    });
    assert.equal(child.kill("SIGKILL"), true); const [, signal] = await exited; assert.equal(signal, "SIGKILL");
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } }
}

test("outbox intent and caller transaction stay atomic, structurally deduplicated and conflict-safe", async () => {
  const f = await fixture(); const rollback = randomUUID();
  try {
    const replay = await f.sql.begin((tx) => enqueueJob(tx, f.kind, f.key, { deliveryId: f.reference })); assert.equal(replay, f.id);
    await assert.rejects(f.sql.begin((tx) => enqueueJob(tx, f.kind, f.key, { deliveryId: randomUUID() })), /conflicts/);
    await assert.rejects(f.sql.begin((tx) => enqueueJob(tx, f.kind, f.key, { deliveryId: f.reference }, 2)), /conflicts/);
    await assert.rejects(f.sql.begin(async (tx) => {
      await tx`insert into app.local_delivery (id,recipient,kind,url,expires_at) values (${rollback},'rollback@example.test','existing_account','http://127.0.0.1:3099/login',now()+interval '1 hour')`;
      await enqueueJob(tx, f.kind, `rollback:${rollback}`, { deliveryId: rollback });
      throw new Error("Synthetic rollback");
    }), /Synthetic rollback/);
    assert.equal((await f.sql`select id from app.local_delivery where id=${rollback}`).length, 0);
    assert.equal((await f.sql`select id from app.outbox_job where dedup_key=${`rollback:${rollback}`}`).length, 0);
    for (const payload of [{ bad: Number.NaN }, { bad: undefined }, { bad: "x".repeat(16385) }]) await assert.rejects(f.sql.begin((tx) => enqueueJob(tx, f.kind, randomUUID(), payload)));
  } finally { await f.close(); }
});

test("two independent worker processes claim one effect; replay keeps one committed receipt", async () => {
  const f = await fixture();
  try {
    await f.sql.begin(async (tx) => {
      await tx`select id from app.outbox_job where id=${f.id} for update`;
      // Both real workers must return while this eligible row is locked, proving SKIP LOCKED.
      const contenders = await Promise.all([exec(process.execPath, [...command, f.kind, "complete"], { timeout: 5000 }), exec(process.execPath, [...command, f.kind, "complete"], { timeout: 5000 })]);
      assert.ok(contenders.every((r) => !r.stdout.includes("dispatch_started") && r.stdout.includes("done")));
    });
    const runs = await Promise.all([exec(process.execPath, [...command, f.kind, "complete"], { timeout: 10000 }), exec(process.execPath, [...command, f.kind, "complete"], { timeout: 10000 })]);
    assert.equal(runs.filter((r) => r.stdout.includes("dispatch_started")).length, 1);
    const [row] = await f.sql`select status,attempts,result,lease_token from app.outbox_job where id=${f.id}`;
    assert.equal(row.status, "completed"); assert.equal(row.attempts, 1); assert.equal(row.result.reference, f.reference); assert.equal(row.lease_token, null);
    await exec(process.execPath, [...command, f.kind, "complete"], { timeout: 10000 });
    const [effects] = await f.sql`select count(*)::int as n from app.audit_event where actor_id=${`lease-effect:${f.reference}`}`; assert.equal(effects.n, 1);
  } finally { await f.close(); }
});

test("deadline keeps a worker alive to record unknown after its idle database connection is lost", async () => {
  const f = await fixture();
  const child = spawn(process.execPath, [...command, f.kind, "timeout"], { stdio: ["ignore", "pipe", "ignore"] });
  const exited = once(child, "exit");
  try {
    const pid = await new Promise<number>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Timeout worker did not reach its barrier.")), 5000);
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString(); const match = /adapter_waiting:(\d+)/.exec(output);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Timeout worker exited before its barrier.")); });
    });
    const [backend] = await f.sql`select pid from pg_stat_activity where pid=${pid} and datname='99ribu_test' and usename='99ribu_test_app'`;
    assert.ok(backend, "Terminate only the controlled test worker's database connection");
    await f.sql`select pg_terminate_backend(${pid})`;
    const [code] = await exited; assert.equal(code, 0, "Worker must remain alive until the bounded deadline settles its claim");
    const [row] = await f.sql`select status,last_error from app.outbox_job where id=${f.id}`;
    assert.equal(row.status, "unknown"); assert.equal(row.last_error, "UNKNOWN_OUTCOME");
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } await f.close(); }
});

test("ambiguous status/code pairing never automatically retries an uncertain outcome", async () => {
  const f = await fixture();
  try {
    await runOneJob(f.sql, { [f.kind]: {
      async dispatch() { return { status: "retryable", code: "UNKNOWN_OUTCOME" } as unknown as Outcome; },
      async reconcile() { return { status: "unknown", code: "UNKNOWN_OUTCOME" }; },
    } });
    const [row] = await f.sql`select status,last_error from app.outbox_job where id=${f.id}`;
    assert.equal(row.status, "unknown"); assert.equal(row.last_error, "UNKNOWN_OUTCOME");
  } finally { await f.close(); }
});

test("expired reconciliation is delayed and fenced; verified terminal no-effect results settle at the cap", async () => {
  const expired = await fixture();
  try {
    const first = await claimJob(expired.sql, expired.kind); assert.ok(first); await markDispatched(expired.sql, first);
    await settleClaim(expired.sql, first, { status: "unknown", code: "UNKNOWN_OUTCOME" });
    await expired.sql`update app.outbox_job set run_at=now()-interval '1 second' where id=${expired.id}`;
    const lookup = await claimJob(expired.sql, expired.kind, true); assert.ok(lookup);
    await expired.sql`update app.outbox_job set lease_until=now()-interval '1 second' where id=${expired.id}`;
    await expireLeases(expired.sql);
    const [row] = await expired.sql`select status,attempts,run_at>now() as delayed from app.outbox_job where id=${expired.id}`;
    assert.equal(row.status, "unknown"); assert.equal(row.delayed, true); assert.equal(row.attempts, 1);
    assert.equal(await claimJob(expired.sql, expired.kind, true), null);
    assert.equal(await settleClaim(expired.sql, lookup, { status: "succeeded", receipt: { reference: "stale" } }), false);
  } finally { await expired.close(); }
  for (const rejection of [false, true]) {
    const f = await fixture(1);
    try {
      const claim = await claimJob(f.sql, f.kind); assert.ok(claim); await markDispatched(f.sql, claim);
      await settleClaim(f.sql, claim, { status: "unknown", code: "UNKNOWN_OUTCOME" });
      await f.sql`update app.outbox_job set run_at=now()-interval '1 second' where id=${f.id}`;
      await runOneJob(f.sql, { [f.kind]: {
        async dispatch() { throw new Error("Unknown operation must not redispatch"); },
        async reconcile() {
          const [effect] = await f.sql`select delivered_at from app.local_delivery where id=${f.reference}`;
          assert.equal(effect.delivered_at, null);
          return rejection ? { status: "failed", code: "PERMANENT_REJECTION" } : { status: "retryable", code: "TEMPORARY_UNAVAILABLE" };
        },
      } });
      const [row] = await f.sql`select status,last_error,attempts,completed_at from app.outbox_job where id=${f.id}`;
      assert.equal(row.status, "failed"); assert.equal(row.last_error, rejection ? "PERMANENT_REJECTION" : "ATTEMPTS_EXHAUSTED"); assert.equal(row.attempts, 1); assert.ok(row.completed_at);
    } finally { await f.close(); }
  }
});

test("worker death before dispatch requeues; stale lease cannot start, renew or settle a newer claim", async () => {
  const f = await fixture();
  try {
    await crashAt(f.kind, "before", "claim_committed");
    const [before] = await f.sql`select status,attempts,dispatched_at from app.outbox_job where id=${f.id}`;
    assert.equal(before.status, "processing"); assert.equal(before.dispatched_at, null); assert.equal(before.attempts, 1);
    await f.sql`update app.outbox_job set lease_until=now()-interval '1 second' where id=${f.id}`;
    await expireLeases(f.sql);
    const first = await claimJob(f.sql, f.kind); assert.ok(first); assert.equal(await renewLease(f.sql, first), true);
    await f.sql`update app.outbox_job set lease_until=now()-interval '1 second' where id=${f.id}`;
    assert.equal(await markDispatched(f.sql, first), false); assert.equal(await renewLease(f.sql, first), false);
    await expireLeases(f.sql);
    const second = await claimJob(f.sql, f.kind); assert.ok(second); assert.notEqual(second.token, first.token);
    assert.equal(await markDispatched(f.sql, second), true);
    assert.equal(await settleClaim(f.sql, first, { status: "succeeded", receipt: { reference: "stale" } }), false);
    assert.equal(await renewLease(f.sql, first), false);
    assert.equal(await settleClaim(f.sql, second, { status: "succeeded", receipt: { reference: "current" } }), true);
    const [row] = await f.sql`select status,result,attempts from app.outbox_job where id=${f.id}`;
    assert.equal(row.status, "completed"); assert.equal(row.result.reference, "current"); assert.equal(row.attempts, 3);
  } finally { await f.close(); }
});

test("worker death after effect commit becomes unknown and restart reconciles without redispatch", async () => {
  const f = await fixture(1);
  try {
    await crashAt(f.kind, "after", "effect_committed");
    const [before] = await f.sql`select status,dispatched_at from app.outbox_job where id=${f.id}`;
    assert.equal(before.status, "processing"); assert.ok(before.dispatched_at);
    await f.sql`update app.outbox_job set lease_until=now()-interval '1 second' where id=${f.id}`;
    await expireLeases(f.sql);
    const [unknown] = await f.sql`select status from app.outbox_job where id=${f.id}`; assert.equal(unknown.status, "unknown");
    await f.sql`update app.outbox_job set run_at=now()-interval '1 second' where id=${f.id}`;
    const run = await exec(process.execPath, [...command, f.kind, "complete"], { timeout: 10000 });
    assert.ok(run.stdout.includes("reconcile_started") && !run.stdout.includes("dispatch_started"));
    const [row] = await f.sql`select status,attempts,result from app.outbox_job where id=${f.id}`;
    assert.equal(row.status, "completed"); assert.equal(row.attempts, 1); assert.equal(row.result.reference, f.reference);
    const [effects] = await f.sql`select count(*)::int as n from app.audit_event where actor_id=${`lease-effect:${f.reference}`}`; assert.equal(effects.n, 1);
  } finally { await f.close(); }
});

test("lost response is redacted and rate-bounded; unknown never silently resends the effect", async () => {
  const f = await fixture();
  try {
    await exec(process.execPath, [...command, f.kind, "unknown"], { timeout: 10000 });
    const [row] = await f.sql`select status,last_error,run_at>now() as delayed from app.outbox_job where id=${f.id}`;
    assert.equal(row.status, "unknown"); assert.equal(row.last_error, "UNKNOWN_OUTCOME"); assert.equal(row.delayed, true);
    const immediate = await exec(process.execPath, [...command, f.kind, "complete"], { timeout: 10000 });
    assert.ok(!immediate.stdout.includes("dispatch_started") && !immediate.stdout.includes("reconcile_started"));
    await f.sql`update app.outbox_job set run_at=now()-interval '1 second' where id=${f.id}`;
    const resumed = await exec(process.execPath, [...command, f.kind, "complete"], { timeout: 10000 });
    assert.ok(resumed.stdout.includes("reconcile_started") && !resumed.stdout.includes("dispatch_started"));
    const [effects] = await f.sql`select count(*)::int as n from app.audit_event where actor_id=${`lease-effect:${f.reference}`}`; assert.equal(effects.n, 1);
  } finally { await f.close(); }
});

test("only authoritative no-effect results retry; attempts and backoff end in a durable dead letter", async () => {
  const f = await fixture(2); let dispatches = 0;
  const adapter: JobAdapter = {
    async dispatch() { dispatches++; return { status: "retryable", code: "TEMPORARY_UNAVAILABLE" }; },
    async reconcile() { throw new Error("Unexpected reconciliation"); },
  };
  try {
    assert.equal(await runOneJob(f.sql, { [f.kind]: adapter }), true);
    const [retry] = await f.sql`select status,attempts,run_at>now() as delayed,dispatched_at from app.outbox_job where id=${f.id}`;
    assert.equal(retry.status, "pending"); assert.equal(retry.attempts, 1); assert.equal(retry.delayed, true); assert.equal(retry.dispatched_at, null);
    assert.equal(await runOneJob(f.sql, { [f.kind]: adapter }), false);
    await f.sql`update app.outbox_job set run_at=now()-interval '1 second' where id=${f.id}`;
    assert.equal(await runOneJob(f.sql, { [f.kind]: adapter }), true);
    const [dead] = await f.sql`select status,attempts,last_error,completed_at,payload from app.outbox_job where id=${f.id}`;
    assert.equal(dead.status, "failed"); assert.equal(dead.attempts, 2); assert.equal(dead.last_error, "ATTEMPTS_EXHAUSTED"); assert.ok(dead.completed_at); assert.equal(dead.payload.deliveryId, f.reference);
    assert.equal(await runOneJob(f.sql, { [f.kind]: adapter }), false); assert.equal(dispatches, 2);
  } finally { await f.close(); }
});

test("verified absence can retry the original identity; malformed adapter receipt remains unknown", async () => {
  const f = await fixture(); let dispatches = 0; let lookups = 0; const identities: string[] = [];
  const adapter: JobAdapter = {
    async dispatch(claim) {
      identities.push(claim.id); dispatches++;
      if (dispatches === 1) throw new Error("Synthetic unavailable response");
      return { status: "succeeded", receipt: { reference: f.reference } };
    },
    async reconcile() {
      lookups++;
      const [effect] = await f.sql`select delivered_at from app.local_delivery where id=${f.reference}`;
      assert.equal(effect.delivered_at, null, "Controlled simulator must authoritatively have no applied effect");
      return { status: "retryable", code: "TEMPORARY_UNAVAILABLE" };
    },
  };
  try {
    await runOneJob(f.sql, { [f.kind]: adapter });
    assert.equal(await runOneJob(f.sql, { [f.kind]: adapter }), false); assert.equal(dispatches, 1);
    await f.sql`update app.outbox_job set run_at=now()-interval '1 second' where id=${f.id}`;
    await runOneJob(f.sql, { [f.kind]: adapter }); assert.equal(lookups, 1); assert.equal(dispatches, 1);
    await f.sql`update app.outbox_job set run_at=now()-interval '1 second' where id=${f.id}`;
    await runOneJob(f.sql, { [f.kind]: adapter }); assert.deepEqual(identities, [f.id, f.id]);
    const [row] = await f.sql`select status,attempts from app.outbox_job where id=${f.id}`; assert.equal(row.status, "completed"); assert.equal(row.attempts, 2);
    const bad = await fixture();
    try {
      await runOneJob(bad.sql, { [bad.kind]: { async dispatch() { return { status: "succeeded", receipt: { invalid: undefined } }; }, async reconcile() { return { status: "unknown", code: "UNKNOWN_OUTCOME" }; } } });
      const [unknown] = await bad.sql`select status,last_error from app.outbox_job where id=${bad.id}`; assert.equal(unknown.status, "unknown"); assert.equal(unknown.last_error, "UNKNOWN_OUTCOME");
    } finally { await bad.close(); }
  } finally { await f.close(); }
});

test("last unstarted lease becomes a dead letter; bounded adapter timeout remains uncertain", async () => {
  const final = await fixture(1); const timed = await fixture(); let aborted = false;
  try {
    assert.ok(await claimJob(final.sql, final.kind));
    await final.sql`update app.outbox_job set lease_until=now()-interval '1 second' where id=${final.id}`;
    await expireLeases(final.sql);
    const [row] = await final.sql`select status,last_error from app.outbox_job where id=${final.id}`;
    assert.equal(row.status, "failed"); assert.equal(row.last_error, "ATTEMPTS_EXHAUSTED");
    const adapter: JobAdapter = {
      async dispatch(_claim, signal) {
        return new Promise((resolve) => signal.addEventListener("abort", () => { aborted = true; resolve({ status: "unknown", code: "UNKNOWN_OUTCOME" }); }, { once: true }));
      },
      async reconcile() { return { status: "unknown", code: "UNKNOWN_OUTCOME" }; },
    };
    await runLeasedJob(timed.sql, { [timed.kind]: adapter }, 10);
    assert.equal(aborted, true);
    const [unknown] = await timed.sql`select status,last_error from app.outbox_job where id=${timed.id}`;
    assert.equal(unknown.status, "unknown"); assert.equal(unknown.last_error, "UNKNOWN_OUTCOME");
  } finally { await final.close(); await timed.close(); }
});
