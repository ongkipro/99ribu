import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { connectDatabase } from "../../src/db/client.ts";

// S83 expand migration 0035: every money-table `environment` CHECK accepts 'production' beside local/test,
// nothing else about those constraints changed, and re-running migrations on the test database is a no-op.
const journal = JSON.parse(readFileSync("migrations/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };

test("0035 is recorded on the test database and a re-run applies nothing", async () => {
  assert.equal(journal.entries.at(-1)?.tag, "0035_production_environment");
  const owner = connectDatabase("test", "owner");
  try {
    const [last] = await owner.sql`select hash from drizzle.__drizzle_migrations order by id desc limit 1`;
    assert.equal(last.hash, createHash("sha256").update(readFileSync("migrations/0035_production_environment.sql")).digest("hex"));
  } finally { await owner.sql.end(); }
  const rerun = spawnSync(process.execPath, ["scripts/migrate.ts", "test"], { encoding: "utf8", timeout: 60000 });
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.match(rerun.stdout, /Migrations applied to isolated test database \(newly applied: 0\)\./);
});

test("every environment CHECK lists exactly local, test and production", async () => {
  const { sql } = connectDatabase("test");
  try {
    const rows = await sql<{ name: string; def: string }[]>`select conrelid::regclass::text || '.' || conname as name, pg_get_constraintdef(oid) as def
      from pg_constraint where contype='c' and connamespace='app'::regnamespace and pg_get_constraintdef(oid) like '%environment%' order by 1`;
    assert.equal(rows.length, 19, rows.map((row) => row.name).join(", "));
    for (const row of rows) {
      const lists = row.def.match(/environment = ANY \(ARRAY\[[^\]]*\]\)/g) ?? [];
      assert.deepEqual(lists, ["environment = ANY (ARRAY['local'::text, 'test'::text, 'production'::text])"], row.name);
    }
  } finally { await sql.end(); }
});

test("a money-table CHECK accepts 'production' and still rejects unknown environments", async () => {
  const { sql } = connectDatabase("test");
  try {
    const insert = (environment: string) => sql.begin(async (tx) => {
      await tx`insert into app.local_tracking_observation (environment,courier,tracking_number,provider_status,occurred_at)
        values (${environment},'jne','S83CHECK00000001','IN_TRANSIT',clock_timestamp())`;
      // Never keep the probe row: the table is append-only history.
      throw Object.assign(new Error("rollback"), { code: "ROLLBACK_PROBE" });
    });
    for (const environment of ["local", "test", "production"]) await assert.rejects(insert(environment), { code: "ROLLBACK_PROBE" }, environment);
    for (const environment of ["staging", "Production", "prod", ""]) await assert.rejects(insert(environment), { code: "23514" }, environment);
  } finally { await sql.end(); }
});
