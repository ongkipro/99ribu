import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import type { Sql, TransactionSql } from "postgres";
import { AccessError } from "../src/modules/access/policy.ts";
import { RETENTION_JOBS } from "../src/jobs/retention.ts";
import { DATABASE_JOBS, processDatabaseJob, sweepExpiredGuestContexts } from "../src/jobs/worker.ts";

const root = new URL("../", import.meta.url);

async function sourceFiles(dir: URL): Promise<URL[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    return entry.isDirectory() ? sourceFiles(url) : /\.tsx?$/.test(entry.name) ? [url] : [];
  }));
  return nested.flat();
}

// The leased adapter map is built inside the worker entrypoint, which connects
// on import, so read its literal keys instead of importing it.
async function leasedKinds() {
  const script = await readFile(new URL("scripts/worker.ts", root), "utf8");
  // Production gets an empty map (every adapter disabled, S82); the local/test map lists every leased kind.
  const map = /const adapters[^=]*=(?:[^?;]*\?\{\}:)?\{([^}]*)\};/.exec(script);
  assert.ok(map, "scripts/worker.ts must declare its leased adapter map");
  return new Set([...map[1].matchAll(/['"]([a-z][a-z0-9_.-]*)['"]\s*:/g)].map((m) => m[1]));
}

test("every enqueued job kind is registered with the database registry or a leased adapter", async () => {
  const leased = await leasedKinds();
  const enqueued = new Map<string, string>();
  for (const file of await sourceFiles(new URL("src/", root))) {
    for (const match of (await readFile(file, "utf8")).matchAll(/enqueueJob\(\s*\w+\s*,\s*['"]([a-z][a-z0-9_.-]*)['"]/g)) {
      enqueued.set(match[1], file.pathname.slice(root.pathname.length));
    }
  }
  assert.ok(enqueued.size >= 20, `expected the known enqueue sites, found ${enqueued.size}`);
  const unregistered = [...enqueued].filter(([kind]) => kind !== "local.notification" && !Object.hasOwn(DATABASE_JOBS, kind) && !leased.has(kind));
  assert.deepEqual(unregistered, [], "enqueued kinds without a worker owner");
  for (const kind of leased) assert.ok(!Object.hasOwn(DATABASE_JOBS, kind), `${kind} cannot be both leased and database-owned`);
});

test("unknown and inherited kinds are refused before any database effect", async () => {
  const tx = new Proxy({}, { get: () => assert.fail("refused job must not touch the transaction") }) as unknown as TransactionSql;
  for (const kind of ["unknown.kind", "constructor", "toString"]) {
    await assert.rejects(processDatabaseJob(tx, { id: "00000000-0000-4000-8000-000000000000", kind, payload: {}, attempts: 0, max_attempts: 5 }),
      (error) => error instanceof AccessError && error.status === 400 && error.message === "INVALID_DATABASE_JOB");
  }
});

// S105: the housekeeping lane is the retention registry; this keeps both truthful without a database.
test("the housekeeping sweep runs every retention registry entry once per throttle window and isolates failures", async (t) => {
  const names = Object.keys(RETENTION_JOBS);
  for (const name of ["guest_context.expired", "autolaris_callback.body", "outbox.completed", "access_operation.replay", "auth.session", "auth.verification", "auth.rate_limit", "visitor.history"]) {
    assert.ok(names.includes(name), `${name} is registered`);
  }
  for (const job of Object.values(RETENTION_JOBS)) assert.ok(job.table && job.window, "each entry documents its table and window");
  const calls: string[] = []; const logged: string[] = [];
  t.mock.method(console, "error", (line: string) => { logged.push(line); });
  const originals = new Map(Object.entries(RETENTION_JOBS).map(([name, job]) => [name, job.run]));
  try {
    for (const [name, job] of Object.entries(RETENTION_JOBS)) job.run = async () => { calls.push(name); throw Object.assign(new Error("secret row value"), { code: "23503" }); };
    const sql = {} as Sql;
    await sweepExpiredGuestContexts(sql);
    await sweepExpiredGuestContexts(sql);
    assert.deepEqual(calls, names, "one failing entry never stops the others; a second call inside a minute runs nothing");
    const events = logged.map((line) => JSON.parse(line));
    assert.deepEqual(events.find((e) => e.job === "outbox.completed"), { event: "jobs.retention_failed", job: "outbox.completed", error: "Error", sqlstate: "23503" });
    assert.ok(events.some((e) => e.event === "jobs.guest_cleanup_failed") && events.some((e) => e.event === "jobs.autolaris_callback_retention_failed"));
    assert.ok(!logged.join("").includes("secret row value"));
  } finally {
    for (const [name, job] of Object.entries(RETENTION_JOBS)) job.run = originals.get(name) as typeof job.run;
  }
});
