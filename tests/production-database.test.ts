import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { connectDatabase } from "../src/db/client.ts";
import { createLocalAuth } from "../src/modules/access/auth.ts";
import { AccessError } from "../src/modules/access/policy.ts";
import { bootstrapGuest } from "../src/modules/checkout/access.ts";

// S83 rehearsal on a disposable PostgreSQL container (same pinned image as compose.yaml) reached over TCP with
// SCRAM: the production bootstrap applies once, migrations serialise and are idempotent, and the app role is
// confined. Every password here is a synthetic per-run value that is never printed; the container is removed.
const image = /^\s*image:\s*(\S+)$/m.exec(readFileSync("compose.yaml", "utf8"))?.[1] ?? "";
const name = `99ribu-s83-rehearsal-${randomUUID().slice(0, 8)}`;
const password = { superuser: randomBytes(24).toString("base64url"), owner: randomBytes(24).toString("base64url"), app: randomBytes(24).toString("base64url") };
const migrations = (JSON.parse(readFileSync("migrations/meta/_journal.json", "utf8")) as { entries: unknown[] }).entries.length;
let port = 0;
let production: Record<string, string> = {};

const docker = (args: string[], input?: string) => spawnSync("docker", args, {
  encoding: "utf8", input, timeout: 120000, env: { ...process.env, POSTGRES_PASSWORD: password.superuser },
});
const bootstrap = () => docker(["exec", "-i", name, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"], readFileSync("src/db/bootstrap-production.sql", "utf8"));
const connect = (username: string, secret: string, database: string) =>
  postgres({ host: "127.0.0.1", port, username, password: secret, database, max: 1, connect_timeout: 3, onnotice: () => {} });
function node(args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ["--env-file=.env.example", ...args], { env: { ...process.env, ...production } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}
const applied = (stdout: string) => Number(/newly applied: (\d+)\)/.exec(stdout)?.[1] ?? Number.NaN);

before(async () => {
  assert.match(image, /^postgres:18\.6-bookworm@sha256:[0-9a-f]{64}$/);
  // Trust only on the container's own Unix socket (docker exec psql); every TCP rule, loopback included, is scram-sha-256.
  const started = docker(["run", "-d", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256", "-p", "127.0.0.1::5432", image]);
  assert.equal(started.status, 0, "docker run failed");
  port = Number(/:(\d+)\s*$/m.exec(docker(["port", name, "5432/tcp"]).stdout)?.[1]);
  assert.ok(port > 0);
  for (let attempt = 0; ; attempt++) {
    const sql = connect("postgres", password.superuser, "postgres");
    try { await sql`select 1`; break; } catch (error) { if (attempt > 60) throw error; await sleep(1000); } finally { await sql.end(); }
  }
  production = {
    APP_ENV: "production", APP_ORIGIN: "https://99ribu.com", BETTER_AUTH_URL: "https://99ribu.com", BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
    PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "disabled", ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled",
    EXTERNAL_DISPATCH: "disabled", CLIENT_IP_HEADER: "x-real-ip", DATABASE_HOST: "127.0.0.1", DATABASE_PORT: String(port),
    DATABASE_APP_PASSWORD: password.app, DATABASE_OWNER_PASSWORD: password.owner,
  };
}, { timeout: 120000 });

after(() => { docker(["rm", "-f", name]); });

test("host connections require SCRAM and the bootstrap applies exactly once", async () => {
  const sql = connect("postgres", password.superuser, "postgres");
  try {
    const rules = await sql`select distinct auth_method from pg_hba_file_rules where type like 'host%'`;
    assert.deepEqual(rules.map((rule) => rule.auth_method), ["scram-sha-256"]);
    const first = bootstrap();
    assert.equal(first.status, 0, first.stderr);
    const state = () => sql`select (select array_agg(rolname order by rolname) from pg_roles where rolname like '99ribu%') roles,
      (select array_agg(datname order by datname) from pg_database) databases`;
    const [created] = await state();
    assert.deepEqual(created.roles, ["99ribu_production_app", "99ribu_production_owner"]);
    const second = bootstrap();
    assert.notEqual(second.status, 0, "a second bootstrap must fail loudly");
    assert.match(second.stderr, /already exists/);
    const [unchanged] = await state();
    assert.deepEqual({ ...unchanged }, { ...created }, "the failed second run changed nothing");
    const [roles] = await sql`select bool_and(not rolsuper and not rolcreatedb and not rolcreaterole and rolcanlogin) restricted
      from pg_roles where rolname like '99ribu_production_%'`;
    assert.equal(roles.restricted, true);
    const [database] = await sql`select pg_get_userbyid(datdba) owner, has_database_privilege('public', '99ribu_production', 'CONNECT') public_connect,
      has_database_privilege('public', 'postgres', 'CONNECT') postgres_connect, has_database_privilege('public', 'template1', 'CONNECT') template_connect
      from pg_database where datname='99ribu_production'`;
    assert.deepEqual({ ...database }, { owner: "99ribu_production_owner", public_connect: false, postgres_connect: false, template_connect: false });
    // Operators run \password interactively; the rehearsal sets synthetic values the same SCRAM way.
    await sql.unsafe(`ALTER ROLE "99ribu_production_owner" PASSWORD '${password.owner}'`);
    await sql.unsafe(`ALTER ROLE "99ribu_production_app" PASSWORD '${password.app}'`);
    const [verifiers] = await sql`select bool_and(rolpassword like 'SCRAM-SHA-256$%') scram from pg_authid where rolname like '99ribu_production_%'`;
    assert.equal(verifiers.scram, true);
  } finally { await sql.end(); }
  const publicSchema = connect("99ribu_production_owner", password.owner, "99ribu_production");
  try {
    const [schema] = await publicSchema`select has_schema_privilege('public', 'public', 'CREATE') public_create`;
    assert.equal(schema.public_create, false);
  } finally { await publicSchema.end(); }
});

test("two concurrent production migrate runs both succeed, one applies every migration, a re-run is a no-op", { timeout: 120000 }, async () => {
  const runs = await Promise.all([node(["scripts/migrate.ts", "production"]), node(["scripts/migrate.ts", "production"])]);
  for (const run of runs) assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(runs.map((run) => applied(run.stdout)).sort((a, b) => a - b), [0, migrations]);
  const again = await node(["scripts/migrate.ts", "production"]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(applied(again.stdout), 0);
  for (const run of [...runs, again]) {
    for (const secret of Object.values(password)) assert.ok(!run.stdout.includes(secret) && !run.stderr.includes(secret), "a password was printed");
  }
});

test("the production app role connects over TCP with its limits and is refused DDL, TRUNCATE and other databases", async () => {
  const saved = process.env;
  process.env = { ...production } as NodeJS.ProcessEnv;
  const { sql } = connectDatabase("production");
  try {
    const [identity] = await sql`select current_user, current_database() database, current_setting('application_name') application,
      current_setting('statement_timeout') statement, current_setting('lock_timeout') lock, current_setting('idle_in_transaction_session_timeout') idle,
      current_setting('server_version') version, (select count(*)::int from app.outbox_job) jobs`;
    assert.deepEqual({ ...identity, version: identity.version.split(" ")[0] },
      { current_user: "99ribu_production_app", database: "99ribu_production", application: "99ribu-production-app", statement: "10s", lock: "5s", idle: "30s", version: "18.6", jobs: 0 });
    await assert.rejects(sql`CREATE TABLE app.denied_ddl (id integer)`, { code: "42501" });
    await assert.rejects(sql`TRUNCATE app.finance_transaction`, { code: "42501" });
    const [check] = await sql`select pg_get_constraintdef(oid) def from pg_constraint where conname='finance_transaction_identity_check'`;
    assert.match(check.def, /ARRAY\['local'::text, 'test'::text, 'production'::text\]/);
  } finally { await sql.end(); process.env = saved; }
  const other = connect("99ribu_production_app", password.app, "postgres");
  try { await assert.rejects(other`select 1`, { code: "42501" }); } finally { await other.end(); }
  const wrong = connect("99ribu_production_app", `${password.app}x`, "99ribu_production");
  try { await assert.rejects(wrong`select 1`, { code: "28P01" }); } finally { await wrong.end(); }
});

test("production guest bootstrap is budgeted per trusted-proxy client IP and issues Secure cookies", async () => {
  const saved = process.env;
  process.env = { ...production } as NodeJS.ProcessEnv;
  const identity = createLocalAuth("production");
  try {
    const request = (ip: string) => new Request("https://99ribu.com/api/v1/carts", { method: "POST", headers: { host: "99ribu.com", "x-real-ip": ip } });
    for (let index = 0; index < 30; index++) {
      const response = await bootstrapGuest(identity, new Response(null, { status: 401 }), request("203.0.113.30"));
      assert.match(response.headers.get("set-cookie") ?? "", /^__Secure-99ribu-production\.commerce_guest=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax;/);
    }
    await assert.rejects(bootstrapGuest(identity, new Response(null), request("203.0.113.30")), (error: unknown) => error instanceof AccessError && error.status === 429);
    await bootstrapGuest(identity, new Response(null), request("203.0.113.31")); // another client keeps its own budget
    await assert.rejects(bootstrapGuest(identity, new Response(null), new Request("https://99ribu.com/api/v1/carts", { method: "POST" })),
      (error: unknown) => error instanceof AccessError && error.code === "CLIENT_IP_UNAVAILABLE");
  } finally { await identity.sql.end(); process.env = saved; }
});

test("the production worker starts against the target with every adapter disabled", async () => {
  const run = await node(["scripts/worker.ts", "production", "--once"]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /worker_ready target=production dispatch=disabled/);
});
