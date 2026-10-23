import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { connectDatabase } from "../src/db/client.ts";
import { privateDirectory } from "../src/config/local.ts";

test("local and test databases reconnect under restricted application roles", async () => {
  for (const target of ["local", "test"] as const) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { sql } = connectDatabase(target);
      try {
        const [identity] = await sql`SELECT current_database() AS database, current_user AS role,
          current_setting('server_version') AS version, current_setting('listen_addresses') AS listener`;
        assert.equal(identity.database, `99ribu_${target}`);
        assert.equal(identity.role, `99ribu_${target}_app`);
        assert.match(identity.version, /^18\.6\b/);
        assert.equal(identity.listener, "");
        const [permissions] = await sql`SELECT
          has_schema_privilege(current_user, 'app', 'USAGE') AS can_read,
          has_schema_privilege(current_user, 'app', 'CREATE') AS can_create,
          rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user`;
        assert.equal(permissions.can_read, true);
        assert.equal(permissions.can_create, false);
        assert.equal(permissions.rolsuper, false);
        assert.equal(permissions.rolcreatedb, false);
        assert.equal(permissions.rolcreaterole, false);
        await assert.rejects(sql`CREATE TABLE app.denied_ddl (id integer)`, { code: "42501" });
      } finally {
        await sql.end();
      }
    }
  }
});

test("local and test application identities cannot connect to each other's databases", async () => {
  for (const [role, database] of [["99ribu_local_app", "99ribu_test"], ["99ribu_test_app", "99ribu_local"]]) {
    const sql = postgres({ path: join(privateDirectory("pgsocket"), ".s.PGSQL.5432"), username: role, database, max: 1, connect_timeout: 3 });
    try {
      await assert.rejects(sql`SELECT 1`, { code: "42501" });
    } finally {
      await sql.end();
    }
  }
});

test("reviewed migrations are recorded exactly once with matching content hashes", async () => {
  const journal = JSON.parse(readFileSync("migrations/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
  const expected = journal.entries.map(({ tag }) => createHash("sha256").update(readFileSync(`migrations/${tag}.sql`)).digest("hex"));
  for (const target of ["local", "test"] as const) {
    const { sql } = connectDatabase(target, "owner");
    try {
      const rows = await sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id`;
      assert.deepEqual(rows.map((row) => row.hash), expected);
    } finally {
      await sql.end();
    }
  }
});
