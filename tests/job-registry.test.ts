import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import type { TransactionSql } from "postgres";
import { AccessError } from "../src/modules/access/policy.ts";
import { DATABASE_JOBS, processDatabaseJob } from "../src/jobs/worker.ts";

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
