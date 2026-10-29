import { setTimeout } from "node:timers/promises";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectDatabase } from "../src/db/client.ts";

const [target, ...extra] = process.argv.slice(2);
if ((target !== "local" && target !== "test" && target !== "production") || extra.length) {
  throw new Error("Use migrate.ts local|test|production; other targets are refused.");
}
const { db, sql } = connectDatabase(target, "owner");
// Drizzle uses only the latest timestamp to decide what to apply. Validate the complete
// prefix first so changed history, missing rows and older images fail before SQL or grants.
const migrations = readMigrationFiles({ migrationsFolder: "./migrations" });
for (const [index, migration] of migrations.entries()) {
  if (!Number.isSafeInteger(migration.folderMillis) || migration.folderMillis < 0 ||
    (index > 0 && migration.folderMillis <= migrations[index - 1].folderMillis)) {
    throw new Error("Migration files must have strictly increasing safe timestamps.");
  }
}
const applied = async () => {
  const [journal] = await sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`;
  const rows = journal.present
    ? await sql`select hash, created_at from drizzle.__drizzle_migrations order by id`
    : [];
  if (rows.length > migrations.length || rows.some((row, index) =>
    row.hash !== migrations[index]?.hash || String(row.created_at) !== String(migrations[index]?.folderMillis))) {
    throw new Error("Migration history mismatch: applied rows must match the release prefix. Restore the matching release; do not rewrite applied history.");
  }
  return rows.length;
};
const lock = await sql.reserve();
try {
  // Two starting containers must not race: the session advisory lock serialises whole runs (migrations and grants);
  // the second run then finds every migration recorded and applies none. Polling keeps each statement short.
  const deadline = Date.now() + 120_000;
  while (!(await lock`select pg_try_advisory_lock(hashtext('99ribu:migrate')) as ok`)[0].ok) {
    if (Date.now() > deadline) throw new Error("Another migration run still holds the migration lock.");
    await setTimeout(500);
  }
  try {
    const before = await applied();
    await migrate(db, { migrationsFolder: "./migrations" });
    // Roles are fixed identifiers, not supplied by a request or environment URL.
    await sql.unsafe(`GRANT USAGE ON SCHEMA app TO "99ribu_${target}_app"`);
    await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO "99ribu_${target}_app"`);
    await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO "99ribu_${target}_app"`);
    await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "99ribu_${target}_app"`);
    await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO "99ribu_${target}_app"`);
    // S105: the only owner-privileged (SECURITY DEFINER) routine; 0037 revokes it from PUBLIC.
    await sql.unsafe(`GRANT EXECUTE ON FUNCTION app.purge_expired_visitor_history(integer, interval) TO "99ribu_${target}_app"`);
    console.log(`Migrations applied to isolated ${target} database (newly applied: ${(await applied()) - before}).`);
  } finally {
    await lock`select pg_advisory_unlock(hashtext('99ribu:migrate'))`;
  }
} finally {
  lock.release();
  await sql.end();
}
