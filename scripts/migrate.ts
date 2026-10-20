import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connectDatabase } from "../src/db/client.ts";

const [target, ...extra] = process.argv.slice(2);
if ((target !== "local" && target !== "test") || extra.length) {
  throw new Error("Use migrate.ts local|test; other targets are refused.");
}
const { db, sql } = connectDatabase(target, "owner");
try {
  await migrate(db, { migrationsFolder: "./migrations" });
  // Roles are fixed identifiers, not supplied by a request or environment URL.
  await sql.unsafe(`GRANT USAGE ON SCHEMA app TO "99ribu_${target}_app"`);
  await sql.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO "99ribu_${target}_app"`);
  await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO "99ribu_${target}_app"`);
  await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "99ribu_${target}_app"`);
  await sql.unsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO "99ribu_${target}_app"`);
  console.log(`Migrations applied to isolated ${target} database.`);
} finally {
  await sql.end();
}
