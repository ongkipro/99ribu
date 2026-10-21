import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { promisify } from "node:util";
import test from "node:test";
import { connectDatabase } from "../../src/db/client.ts";
import { enqueueJob } from "../../src/jobs/outbox.ts";
import { claimJob, expireLeases, markDispatched, renewLease, runLeasedJob, settleClaim, type JobAdapter, type Outcome } from "../../src/jobs/leases.ts";
import { checkUploadAndRateLimits, inspectOperationalProbes, recoverFailedExpiryJob, recoverOrphanSeedOperators, recoverUndeliveredSignInSession, redactDiagnosticLog } from "../../src/jobs/probes.ts";
import { runOneJob } from "../../src/jobs/worker.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAuth } from "../../src/modules/access/handler.ts";
import { AccessError } from "../../src/modules/access/policy.ts";
import { bootstrapGuest, cookie, prefix } from "../../src/modules/checkout/access.ts";
import { reserveOffers } from "../../src/modules/inventory/reservations.ts";
import { ensurePosition, postMovement } from "../../src/modules/inventory/state.ts";
import { advanceFixtureClock, readFixtureClock } from "../../src/modules/local/fixtures.ts";
import { actor, cleanup } from "../contract/access-fixture.ts";
import { promotionFixture } from "./promotion-fixture.ts";

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

test("failed inventory and promotion expiry jobs with active reservations are surfaced by probes and recovered while preserving physical stock and budget", async () => {
  const ns = `s63-exp-${randomUUID().slice(0, 8)}`;
  const f = await promotionFixture(ns);
  let invReservationId: string | null = null;
  let invJobId: string | null = null;
  try {
    const campaign = await f.campaign();
    const promoHold = await f.reserve(await f.input([campaign.id]));
    const [promoJob] = await f.identity.sql<{ id: string }[]>`
      select id from app.outbox_job where kind='promotion.reservation.expire' and payload->>'reservationId'=${promoHold.id}
    `;
    assert.ok(promoJob);

    const stockItemId = f.product.variants[0].contents[0].stock_item_id as string;
    const balanceId = await f.identity.sql.begin(async (tx) => {
      const id = await ensurePosition(tx, f.wh, stockItemId, null);
      await postMovement(tx, {
        balanceId: id,
        kind: "receive",
        quantity: 5,
        onHand: 5,
        reserved: 0,
        quarantined: 0,
        sourceRef: `s63-supply:${ns}`,
        actorId: f.owner.id,
        reason: "Synthetic S63 stock supply",
      });
      return id;
    });

    const clockBefore = await readFixtureClock("test", ns);
    const invHold = await f.identity.sql.begin((tx) =>
      reserveOffers(tx, {
        key: `s63-inv:${randomUUID()}`,
        lines: [{
          line_id: "line-1",
          product_id: f.product.id,
          product_revision: 1,
          offer_id: f.product.variants[0].id,
          warehouse_id: f.wh,
          quantity: 2,
        }],
        expires_at: new Date(Date.parse(clockBefore.now) + 120000).toISOString(),
        clock_namespace: ns,
        actor_id: f.owner.id,
      }),
    );
    invReservationId = invHold.header.id;
    const [invJob] = await f.identity.sql<{ id: string }[]>`
      select id from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${invReservationId}
    `;
    assert.ok(invJob);
    invJobId = invJob.id;

    // Advance fixture clock past both reservation deadlines, then simulate exhausted expiry jobs while reservations stay active.
    const clock = await readFixtureClock("test", ns);
    await advanceFixtureClock("test", ns, 180, clock.version);
    await f.identity.sql`
      update app.outbox_job
      set status='failed', attempts=max_attempts, last_error='TEMPORARY_DATABASE_FAILURE', completed_at=clock_timestamp()
      where id in (${invJob.id}, ${promoJob.id})
    `;

    const [beforeBalance] = await f.identity.sql<{ on_hand: number; reserved: number; quarantined: number }[]>`
      select on_hand, reserved, quarantined from app.inventory_balance where id=${balanceId}
    `;
    assert.deepEqual(beforeBalance, { on_hand: 5, reserved: 2, quarantined: 0 });
    const [beforePromo] = await f.identity.sql<{ reserved_amount: string }[]>`
      select reserved_amount::text from app.promotion where id=${campaign.id}
    `;
    assert.equal(beforePromo.reserved_amount, "10001");

    const probeBefore = await inspectOperationalProbes(f.identity.sql, {
      namespace: ns,
      jobIds: [invJob.id, promoJob.id],
    });
    assert.equal(probeBefore.environment, "local");
    assert.equal(probeBefore.remote_availability_claim, false);
    assert.equal(probeBefore.backlog.failed, 2);
    assert.equal(probeBefore.dead_letters.length, 2);
    assert.equal(probeBefore.stuck_expiry_reservations.length, 2);
    assert.deepEqual(
      probeBefore.stuck_expiry_reservations.map((r) => r.kind).sort(),
      ["inventory.reservation.expire", "promotion.reservation.expire"],
    );

    const recoveredInv = await recoverFailedExpiryJob(
      f.identity.sql,
      invJob.id,
      "Operator recovery for dead-lettered inventory expiry job",
      f.owner.id,
    );
    assert.equal(recoveredInv.job_status, "completed");
    assert.equal(recoveredInv.reservation_status, "expired");
    assert.equal(recoveredInv.replayed, false);

    const recoveredPromo = await recoverFailedExpiryJob(
      f.identity.sql,
      promoJob.id,
      "Operator recovery for dead-lettered promotion expiry job",
      f.owner.id,
    );
    assert.equal(recoveredPromo.job_status, "completed");
    assert.equal(recoveredPromo.reservation_status, "expired");
    assert.equal(recoveredPromo.replayed, false);

    // Idempotent replay of recovery must never double-release physical stock or promotion budget.
    const replayInv = await recoverFailedExpiryJob(f.identity.sql, invJob.id, "Replay check", f.owner.id);
    const replayPromo = await recoverFailedExpiryJob(f.identity.sql, promoJob.id, "Replay check", f.owner.id);
    assert.equal(replayInv.replayed, true);
    assert.equal(replayPromo.replayed, true);

    const [afterBalance] = await f.identity.sql<{ on_hand: number; reserved: number; quarantined: number }[]>`
      select on_hand, reserved, quarantined from app.inventory_balance where id=${balanceId}
    `;
    assert.deepEqual(afterBalance, { on_hand: 5, reserved: 0, quarantined: 0 });
    const [releaseMovements] = await f.identity.sql<{ n: number }[]>`
      select count(*)::int as n from app.stock_movement where balance_id=${balanceId} and kind='release' and source_ref=${invReservationId}
    `;
    assert.equal(releaseMovements.n, 1);

    const [afterPromo] = await f.identity.sql<{ reserved_amount: string; committed_amount: string }[]>`
      select reserved_amount::text, committed_amount::text from app.promotion where id=${campaign.id}
    `;
    assert.deepEqual(afterPromo, { reserved_amount: "0", committed_amount: "0" });

    const probeAfter = await inspectOperationalProbes(f.identity.sql, {
      namespace: ns,
      jobIds: [invJob.id, promoJob.id],
    });
    assert.equal(probeAfter.stuck_expiry_reservations.length, 0);
    assert.equal(probeAfter.backlog.completed, 2);
  } finally {
    if (invJobId) await f.identity.sql`delete from app.outbox_job where id=${invJobId}`;
    await f.close();
  }
});

test("namespace-tagged orphan synthetic seed operators after host failure are inspected and recovered by explicit identity only", async () => {
  const identity = createLocalAuth("test");
  const nsA = `s63a-${randomUUID().slice(0, 8)}`;
  const nsB = `s63b-${randomUUID().slice(0, 8)}`;
  const orphanAId = randomUUID();
  const orphanBId = randomUUID();
  const orphanAEmail = `${nsA}.seed-op-${randomUUID()}@example.invalid`;
  const orphanBEmail = `${nsB}.seed-op-${randomUUID()}@example.invalid`;
  try {
    for (const [id, ns, email] of [
      [orphanAId, nsA, orphanAEmail],
      [orphanBId, nsB, orphanBEmail],
    ] as const) {
      const sessionId = randomUUID();
      const deliveryId = randomUUID();
      await identity.sql.begin(async (tx) => {
        await tx`insert into app.auth_user (id, name, email, email_verified, two_factor_enabled) values (${id}, ${`SYNTHETIC temporary seed operator [${ns}]`}, ${email}, true, true)`;
        await tx`insert into app.role_grant (user_id, roles) values (${id}, ARRAY['owner']::text[])`;
        await tx`insert into app.auth_session (id, user_id, token, expires_at) values (${sessionId}, ${id}, ${`tok-${randomUUID()}`}, clock_timestamp() + interval '1 hour')`;
        await tx`insert into app.mfa_session (session_id) values (${sessionId})`;
        await tx`insert into app.local_delivery (id, recipient, kind, url, expires_at) values (${deliveryId}, ${email}, 'verification', 'http://127.0.0.1:3099/api/auth/verify-email', clock_timestamp() + interval '30 minutes')`;
      });
    }

    const probeA = await inspectOperationalProbes(identity.sql, { namespace: nsA });
    assert.equal(probeA.orphan_seed_operators.length, 1);
    assert.equal(probeA.orphan_seed_operators[0].user_id, orphanAId);
    assert.equal(probeA.orphan_seed_operators[0].namespace, nsA);
    assert.equal(probeA.orphan_seed_operators[0].active_sessions, 1);
    assert.equal(probeA.orphan_seed_operators[0].mfa_sessions, 1);
    assert.equal(probeA.orphan_seed_operators[0].pending_deliveries, 1);
    assert.ok(!JSON.stringify(probeA).includes(orphanAEmail), "Probe output must not leak raw email addresses");

    // Cross-namespace recovery attempt must fail closed without touching either orphan.
    await assert.rejects(
      recoverOrphanSeedOperators(identity.sql, nsA, [orphanBId]),
      (err: unknown) => err instanceof AccessError && err.status === 409 && err.code === "ORPHAN_SEED_SCOPE_MISMATCH",
    );
    await assert.rejects(
      recoverOrphanSeedOperators(identity.sql, nsA, []),
      (err: unknown) => err instanceof AccessError && err.status === 400 && err.code === "EXPLICIT_IDENTITIES_REQUIRED",
    );

    const recovered = await recoverOrphanSeedOperators(
      identity.sql,
      nsA,
      [orphanAId],
      "Clean up orphan synthetic seed operator after simulated SIGKILL",
    );
    assert.deepEqual(recovered, {
      namespace: nsA,
      recovered_user_ids: [orphanAId],
      revoked_sessions: 1,
    });

    const [remainingA] = await identity.sql<{ n: number }[]>`select count(*)::int as n from app.auth_user where id=${orphanAId}`;
    const [remainingB] = await identity.sql<{ n: number }[]>`select count(*)::int as n from app.auth_user where id=${orphanBId}`;
    assert.equal(remainingA.n, 0);
    assert.equal(remainingB.n, 1, "Other namespace orphan operator must remain untouched");

    await recoverOrphanSeedOperators(identity.sql, nsB, [orphanBId]);
    const [finalB] = await identity.sql<{ n: number }[]>`select count(*)::int as n from app.auth_user where id=${orphanBId}`;
    assert.equal(finalB.n, 0);
  } finally {
    await identity.sql`delete from app.local_delivery where recipient in (${orphanAEmail}, ${orphanBEmail})`;
    await identity.sql`delete from app.auth_user where id in (${orphanAId}, ${orphanBId})`;
    await identity.sql.end();
  }
});

test("successful auth followed by failed guest-context revocation returns 503 without claiming sign-in and recovers the exact undelivered session", async () => {
  const identity = createLocalAuth("test");
  const buyer = await actor(identity, "buyer", []);
  let guestToken = "";
  try {
    // Sign out the fixture bootstrap session so we start with 0 active sessions for buyer.
    assert.equal((await buyer.browser.auth("/sign-out", {})).status, 200);
    const [initialSessions] = await identity.sql<{ n: number }[]>`
      select count(*)::int as n from app.auth_session where user_id=${buyer.id}
    `;
    assert.equal(initialSessions.n, 0);

    const guestInit = await bootstrapGuest(identity, new Response(null, { status: 200 }));
    const p = await prefix(identity);
    const rawCookie = guestInit.headers.getSetCookie().find((c) => c.startsWith(`${p}.commerce_guest=`));
    assert.ok(rawCookie);
    guestToken = rawCookie.split(";")[0].slice(`${p}.commerce_guest=`.length);

    // Inject a failure in identity.sql used by revokeGuestContext after Better Auth commits the session via Drizzle.
    const failingIdentity = {
      ...identity,
      sql: new Proxy(identity.sql, {
        apply() {
          throw new Error("Synthetic guest-context revocation database failure");
        },
      }),
    } as typeof identity;

    const signInReq = new Request("http://127.0.0.1:3099/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:3099",
        "content-type": "application/json",
        cookie: `${p}.commerce_guest=${guestToken}`,
      },
      body: JSON.stringify({ email: buyer.email, password: buyer.password }),
    });

    const failedResponse = await handleAuth(signInReq, failingIdentity);
    assert.equal(failedResponse.status, 503);
    assert.equal(failedResponse.headers.get("set-cookie"), null, "503 must never deliver a session_token or claim completed identity transition");
    const problemBody = await failedResponse.json();
    assert.equal(problemBody.code, "SERVICE_UNAVAILABLE");
    assert.equal(cookie(new Request("http://127.0.0.1:3099", { headers: failedResponse.headers }), `${p}.session_token`), null);

    // Verify the undelivered session exists in DB while the client received 503.
    const undelivered = await identity.sql<{ id: string }[]>`
      select id from app.auth_session where user_id=${buyer.id}
    `;
    assert.equal(undelivered.length, 1);

    const recovery = await recoverUndeliveredSignInSession(
      identity.sql,
      undelivered[0].id,
      guestToken,
      "Revoke undelivered sign-in session after 503 guest revocation failure",
    );
    assert.equal(recovery.session_id, undelivered[0].id);
    assert.equal(recovery.user_id, buyer.id);
    assert.equal(recovery.session_revoked, true);
    assert.equal(recovery.guest_context_active, true);

    const afterRecovery = await identity.sql<{ id: string }[]>`
      select id from app.auth_session where user_id=${buyer.id}
    `;
    assert.equal(afterRecovery.length, 0, "Undelivered session must be revoked");

    // Retrying sign-in with the recovered guest context now succeeds and revokes the guest context cleanly.
    const retryResponse = await handleAuth(
      new Request("http://127.0.0.1:3099/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3099",
          "content-type": "application/json",
          cookie: `${p}.commerce_guest=${guestToken}`,
        },
        body: JSON.stringify({ email: buyer.email, password: buyer.password }),
      }),
      identity,
    );
    assert.equal(retryResponse.status, 200);
    assert.ok(retryResponse.headers.getSetCookie().some((c) => c.startsWith(`${p}.session_token=`)));
    const [guestRow] = await identity.sql<{ revoked_at: string | null }[]>`
      select revoked_at::text from app.commerce_guest_context where id=${recovery.guest_context_id}
    `;
    assert.ok(guestRow.revoked_at, "Guest context is revoked once sign-in succeeds");
  } finally {
    await identity.sql`delete from app.commerce_guest_context where id in (select subject_id::uuid from app.audit_event where action='auth.undelivered_session.recover' and false)`;
    await cleanup(identity, [buyer]);
    await identity.sql.end();
  }
});

test("rate limits, upload limits, correlation propagation and diagnostic log redaction strip private values locally", async () => {
  const { sql } = connectDatabase("test");
  const scope = `s63-rate-${randomUUID()}`;
  const correlationId = `corr-${randomUUID()}`;
  try {
    const redacted = redactDiagnosticLog({
      event: "checkout.payment.callback",
      correlation_id: correlationId,
      order_id: randomUUID(),
      password: "super-secret-password",
      session_token: "99ribu-test.session_token=secret_value",
      authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.secret",
      email: "buyer-private@example.test",
      phone: "+6281234567890",
      bank_account: "1234567890123",
      proof_url: "http://127.0.0.1:3099/private/proof/secret",
      nested: {
        cookie: "99ribu-local.commerce_guest=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
        note: "Contact buyer-private@example.test or 081234567890 for account 1234567890123 at https://example.test/secret",
      },
    });
    assert.equal(redacted.correlation_id, correlationId);
    assert.equal(redacted.causation_id, correlationId);
    assert.equal(redacted.environment, "local");
    assert.equal(redacted.remote_availability_claim, false);
    const serialized = JSON.stringify(redacted);
    for (const secret of [
      "super-secret-password",
      "secret_value",
      "eyJhbGciOiJIUzI1NiJ9",
      "buyer-private@example.test",
      "81234567890",
      "1234567890123",
      "http://127.0.0.1:3099/private/proof/secret",
      "https://example.test/secret",
    ]) {
      assert.ok(!serialized.includes(secret), `Redacted log leaked sensitive value: ${secret}`);
    }

    const validPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    await assert.rejects(
      checkUploadAndRateLimits(sql, {
        routeClass: "private_upload",
        scopeKey: scope,
        upload: { bytes: new TextEncoder().encode("<script>alert(1)</script>"), mimeType: "text/html" },
      }),
      (err: unknown) => err instanceof AccessError && err.status === 415 && err.code === "UNSUPPORTED_MEDIA_TYPE",
    );
    await assert.rejects(
      checkUploadAndRateLimits(sql, {
        routeClass: "private_upload",
        scopeKey: scope,
        upload: { bytes: new TextEncoder().encode("not a png"), mimeType: "image/png" },
      }),
      (err: unknown) => err instanceof AccessError && err.status === 400 && err.code === "INVALID_UPLOAD_CONTENT",
    );
    await assert.rejects(
      checkUploadAndRateLimits(sql, {
        routeClass: "private_upload",
        scopeKey: scope,
        upload: { bytes: new Uint8Array(2049), mimeType: "image/png", maxBytes: 2048 },
      }),
      (err: unknown) => err instanceof AccessError && err.status === 413 && err.code === "BODY_TOO_LARGE",
    );

    const first = await checkUploadAndRateLimits(sql, {
      routeClass: "private_upload",
      scopeKey: scope,
      max: 2,
      windowMs: 60000,
      correlationId,
      upload: { bytes: validPng, mimeType: "image/png", maxBytes: 2048 },
    });
    assert.equal(first.correlation_id, correlationId);
    assert.equal(first.bucket_count, 1);

    const second = await checkUploadAndRateLimits(sql, {
      routeClass: "private_upload",
      scopeKey: scope,
      max: 2,
      windowMs: 60000,
      correlationId,
      upload: { bytes: validPng, mimeType: "image/png", maxBytes: 2048 },
    });
    assert.equal(second.bucket_count, 2);

    await assert.rejects(
      checkUploadAndRateLimits(sql, {
        routeClass: "private_upload",
        scopeKey: scope,
        max: 2,
        windowMs: 60000,
        correlationId,
        upload: { bytes: validPng, mimeType: "image/png", maxBytes: 2048 },
      }),
      (err: unknown) => err instanceof AccessError && err.status === 429 && err.code === "RATE_LIMITED" && Number(err.retryAfter) > 0,
    );
  } finally {
    await sql`delete from app.auth_rate_limit where key=${`probe:private_upload:${scope}`}`;
    await sql.end();
  }
});
