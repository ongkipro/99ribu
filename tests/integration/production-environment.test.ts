import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { connectDatabase } from "../../src/db/client.ts";

// S83 expand migration 0035: 'production' is added only where real production flows write (manual bank,
// AutoLaris, COD remittance/settlement, ledger, manual delivery receipts). Pure simulator stores keep the
// DB-level guarantee environment IN ('local','test'). Re-running migrations on the test database is a no-op.
const PRODUCTION_TABLES = ["autolaris_payment", "cod_remittance", "economic_receipt", "finance_transaction",
  "local_cod_operation", "local_parcel_receipt", "local_payment_operation", "local_settlement_operation"];
const SIMULATOR_TABLES = ["local_autolaris_transaction", "local_parcel_outcome", "local_recovery_destination",
  "local_recovery_operation", "local_refund_destination", "local_refund_operation", "local_replacement_operation",
  "local_replacement_receipt", "local_tracking_observation", "local_waybill_cancellation", "local_waybill_operation"];
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

test("real-flow tables list local, test and production; simulator stores keep exactly local and test", async () => {
  const { sql } = connectDatabase("test");
  try {
    const rows = await sql<{ table: string; def: string }[]>`select conrelid::regclass::text as table, pg_get_constraintdef(oid) as def
      from pg_constraint where contype='c' and connamespace='app'::regnamespace and pg_get_constraintdef(oid) like '%environment%' order by 1`;
    assert.deepEqual(rows.map((row) => row.table.replace(/^app\./, "")).sort(), [...PRODUCTION_TABLES, ...SIMULATOR_TABLES].sort());
    for (const row of rows) {
      const lists = row.def.match(/environment = ANY \(ARRAY\[[^\]]*\]\)/g) ?? [];
      const expected = PRODUCTION_TABLES.includes(row.table.replace(/^app\./, ""))
        ? "environment = ANY (ARRAY['local'::text, 'test'::text, 'production'::text])"
        : "environment = ANY (ARRAY['local'::text, 'test'::text])";
      assert.deepEqual(lists, [expected], row.table);
    }
  } finally { await sql.end(); }
});

test("a simulator store still rejects 'production' and unknown environments at the CHECK", async () => {
  const { sql } = connectDatabase("test");
  try {
    const insert = (environment: string) => sql.begin(async (tx) => {
      await tx`insert into app.local_tracking_observation (environment,courier,tracking_number,provider_status,occurred_at)
        values (${environment},'jne','S83CHECK00000001','IN_TRANSIT',clock_timestamp())`;
      // Never keep the probe row: the table is append-only history.
      throw Object.assign(new Error("rollback"), { code: "ROLLBACK_PROBE" });
    });
    for (const environment of ["local", "test"]) await assert.rejects(insert(environment), { code: "ROLLBACK_PROBE" }, environment);
    for (const environment of ["production", "staging", "Production", ""]) {
      await assert.rejects(insert(environment), { code: "23514", constraint_name: "local_tracking_observation_value_check" }, environment);
    }
  } finally { await sql.end(); }
});
