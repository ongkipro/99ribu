import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { totp } from "../src/modules/local/synthetic-session.ts";

// S86/S87 on a disposable production-profile PostgreSQL (same harness as production-database.test.ts): the first
// owner from the operator command, TOTP enrolment, and the production catalog load acting as that MFA-verified owner.
// Every credential is a synthetic per-run value that is never printed; the container is removed afterwards.
const image = /^\s*image:\s*(\S+)$/m.exec(readFileSync("compose.yaml", "utf8"))?.[1] ?? "";
const name = `99ribu-s86-rehearsal-${randomUUID().slice(0, 8)}`;
const password = { superuser: randomBytes(24).toString("base64url"), owner: randomBytes(24).toString("base64url"), app: randomBytes(24).toString("base64url") };
const owner = { name: "Pemilik Rehearsal", email: "pemilik@99ribu.com", password: randomBytes(18).toString("base64url") };
let port = 0;
let production: Record<string, string> = {};
let uri = "";

const docker = (args: string[], input?: string) => spawnSync("docker", args, {
  encoding: "utf8", input, timeout: 120000, env: { ...process.env, POSTGRES_PASSWORD: password.superuser },
});
const connect = (username: string, secret: string) =>
  postgres({ host: "127.0.0.1", port, username, password: secret, database: username === "postgres" ? "postgres" : "99ribu_production", max: 1, connect_timeout: 3, onnotice: () => {} });

// Runs a production command; `answer(stderr)` supplies the next stdin line once its prompt has appeared.
function run(args: string[], answers: ((stderr: string) => string | null)[], env: Record<string, string> = {}) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, ["--env-file=.env.example", ...args], { env: { ...process.env, ...production, ...env } });
    let stdout = "", stderr = "", next = 0;
    const feed = () => {
      while (next < answers.length) {
        const line = answers[next](stderr);
        if (line === null) return;
        child.stdin.write(`${line}\n`);
        next++;
      }
      child.stdin.end();
    };
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; feed(); });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    feed();
  });
}
const always = (value: string) => () => value;
const code = () => (stderr: string) => {
  uri = /(otpauth:\/\/\S+)/.exec(stderr)?.[1] ?? uri;
  return /6-digit code/.test(stderr) && uri ? totp(uri) : null;
};
// A fresh 30-second step, so a code is never replayed across commands.
async function nextStep() { await sleep(30_000 - (Date.now() % 30_000) + 500); }
// Test-only: the per-account sign-in budget (5/min) would otherwise refuse the later commands of this run.
async function resetAuthLimits() { const sql = connect("99ribu_production_owner", password.owner); try { await sql`delete from app.auth_rate_limit`; } finally { await sql.end(); } }
const ownerLogin = () => [always(owner.email), always(owner.password), (stderr: string) => (/6-digit code/.test(stderr) ? totp(uri) : null)];

before(async () => {
  assert.match(image, /^postgres:18\.6-bookworm@sha256:[0-9a-f]{64}$/);
  assert.equal(docker(["run", "-d", "--rm", "--init", "--name", name, "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256", "-p", "127.0.0.1::5432", image]).status, 0, "docker run failed");
  port = Number(/:(\d+)\s*$/m.exec(docker(["port", name, "5432/tcp"]).stdout)?.[1]);
  for (let attempt = 0; ; attempt++) {
    const sql = connect("postgres", password.superuser);
    try { await sql`select 1`; break; } catch (error) { if (attempt > 60) throw error; await sleep(1000); } finally { await sql.end(); }
  }
  assert.equal(docker(["exec", "-i", name, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"], readFileSync("src/db/bootstrap-production.sql", "utf8")).status, 0);
  const sql = connect("postgres", password.superuser);
  try {
    await sql.unsafe(`ALTER ROLE "99ribu_production_owner" PASSWORD '${password.owner}'`);
    await sql.unsafe(`ALTER ROLE "99ribu_production_app" PASSWORD '${password.app}'`);
  } finally { await sql.end(); }
  production = {
    APP_ENV: "production", APP_ORIGIN: "https://99ribu.com", BETTER_AUTH_URL: "https://99ribu.com", BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
    PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "disabled", ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled",
    EXTERNAL_DISPATCH: "disabled", CLIENT_IP_HEADER: "x-real-ip", DATABASE_HOST: "127.0.0.1", DATABASE_PORT: String(port),
    DATABASE_APP_PASSWORD: password.app, DATABASE_OWNER_PASSWORD: password.owner,
  };
  const migrated = await run(["scripts/migrate.ts", "production"], []);
  assert.equal(migrated.status, 0, migrated.stderr);
}, { timeout: 180000 });

after(() => { docker(["rm", "-f", name]); });

const accessAsOwner = async (path: string) => {
  const saved = process.env;
  process.env = { ...production } as NodeJS.ProcessEnv;
  const { createLocalAuth } = await import("../src/modules/access/auth.ts");
  const { operatorSession } = await import("../src/modules/access/operator.ts");
  const identity = createLocalAuth("production");
  try {
    const browser = operatorSession(identity);
    const signIn = await browser.auth("/sign-in/email", { email: owner.email, password: owner.password });
    assert.equal(signIn.status, 200);
    if ((await signIn.json()).twoFactorRedirect) assert.equal((await browser.auth("/two-factor/verify-totp", { code: totp(uri) })).status, 200);
    const response = await browser.access(path);
    return { status: response.status, code: (await response.json().catch(() => null))?.code ?? null };
  } finally { await identity.sql.end(); process.env = saved; }
};

// The owner records the commercial terms (what /admin/pengaturan/komersial sends): reauthentication proof, then a
// policy version through the real access route. Publication needs a current commercial policy.
async function ownerCommercialTerms() {
  const saved = process.env;
  process.env = { ...production } as NodeJS.ProcessEnv;
  const { createLocalAuth } = await import("../src/modules/access/auth.ts");
  const { ownerSession } = await import("../src/modules/access/operator.ts");
  const { handleAccess } = await import("../src/modules/access/routes.ts");
  const identity = createLocalAuth("production");
  try {
    const browser = await ownerSession(identity, { email: owner.email, password: owner.password, code: totp(uri) });
    const call = async (path: string, body: Record<string, unknown>) => {
      const request = browser.request(`/api/v1${path}`, body);
      request.headers.set("idempotency-key", randomUUID());
      const response = await handleAccess(request, identity);
      assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
      return response.json();
    };
    const history = await (await browser.access("/admin/policy-versions?kind=commercial")).json();
    const { proof } = await call("/me/reauthentication-proofs", { password: owner.password, action: "company_policy.version", subject_id: "company-commercial" });
    await call("/admin/policy-versions", { kind: "commercial", warehouse_id: null, expected_version: history.latest_version, effective_at: null,
      values: { default_commission_bps: 1000, minimum_payout_idr: 99000 }, reason: "Rehearsal commercial terms", reauthentication_proof: proof });
  } finally { await identity.sql.end(); process.env = saved; }
}

test("S86: bootstrap-owner creates one owner and one audit row, MFA gates the console until enrolled, a rerun and dummy logins are refused", { timeout: 240000 }, async () => {
  const sql = connect("99ribu_production_owner", password.owner);
  try {
    // Synthetic and short inputs are refused before any write.
    const synthetic = await run(["scripts/staff.ts", "bootstrap-owner", "production"], [always(owner.name), always("pemilik@99ribu.test"), always(owner.password), always(owner.password)]);
    assert.notEqual(synthetic.status, 0);
    assert.match(synthetic.stderr, /OWNER_EMAIL_INVALID/);
    // Bootstrap, then three wrong codes: the owner exists but has no two-step yet.
    const wrong = await run(["scripts/staff.ts", "bootstrap-owner", "production"],
      [always(owner.name), always(owner.email), always(owner.password), always(owner.password), ...[1, 2, 3].map(() => (stderr: string) => {
        uri = /(otpauth:\/\/\S+)/.exec(stderr)?.[1] ?? uri;
        return uri ? "000000" : null;
      })]);
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /MFA_VERIFY_REJECTED/);
    assert.doesNotMatch(wrong.stdout + wrong.stderr, new RegExp(owner.password));
    const [state] = await sql`select (select count(*)::int from app.role_grant where 'owner'=any(roles)) owners,
      (select count(*)::int from app.audit_event where action='staff.bootstrap_owner') audits,
      (select bool_and(email_verified) from app.auth_user where email=${owner.email}) verified`;
    assert.deepEqual({ ...state }, { owners: 1, audits: 1, verified: true });
    await resetAuthLimits();
    assert.deepEqual(await accessAsOwner("/admin/warehouses"), { status: 403, code: "MFA_REQUIRED" }, "MFA_REQUIRED until the TOTP enrolment is verified");
    // A second bootstrap is refused with no write.
    const again = await run(["scripts/staff.ts", "bootstrap-owner", "production"], [always("Lain"), always("lain@99ribu.com"), always(owner.password), always(owner.password)]);
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /OWNER_EXISTS/);
    const [unchanged] = await sql`select (select count(*)::int from app.auth_user) users, (select count(*)::int from app.role_grant) grants,
      (select count(*)::int from app.audit_event where action='staff.bootstrap_owner') audits`;
    assert.deepEqual({ ...unchanged }, { users: 1, grants: 1, audits: 1 });
    // enroll-mfa finishes the interrupted enrolment; the console then answers 200.
    await resetAuthLimits();
    uri = "";
    const enrolled = await run(["scripts/staff.ts", "enroll-mfa", "production"], [always(owner.email), always(owner.password), code()]);
    assert.equal(enrolled.status, 0, enrolled.stderr);
    assert.deepEqual(JSON.parse(enrolled.stdout), { command: "enroll-mfa", target: "production", mfa_enrolled: true });
    const [enrolAudit] = await sql`select count(*)::int n from app.audit_event where action='auth.mfa.enroll'`;
    assert.equal(enrolAudit.n, 1);
    await nextStep();
    await resetAuthLimits();
    assert.equal((await accessAsOwner("/admin/warehouses")).status, 200);
    // Local dummy accounts never reach production.
    const dummy = await run(["scripts/seed.ts", "login", "production"], []);
    assert.notEqual(dummy.status, 0);
    const [synthetic2] = await sql`select count(*)::int n from app.auth_user where email ~* '@(99ribu\\.test|example\\.invalid)$'`;
    assert.equal(synthetic2.n, 0);
  } finally { await sql.end(); }
});

test("S87: the production catalog load runs as the MFA-verified owner, matches its summaries, and a repeat writes nothing", { timeout: 900000 }, async () => {
  const sql = connect("99ribu_production_owner", password.owner);
  try {
    const raw = process.env.BERLAPAK_DATA_DIR || "/data/99ribu-berlapak-data";
    const missing = await run(["scripts/catalog.ts", "initial-stock", "production"], [], { BERLAPAK_DATA_DIR: "" });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Set BERLAPAK_DATA_DIR/);
    const step = async (args: string[], env: Record<string, string> = {}) => {
      await nextStep();
      await resetAuthLimits();
      const result = await run(["scripts/catalog.ts", ...args, "production"], ownerLogin(), env);
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(owner.password));
      return JSON.parse(result.stdout);
    };
    const first = await step(["import"]);
    const stock = await step(["initial-stock"], { BERLAPAK_DATA_DIR: raw });
    await nextStep();
    await resetAuthLimits();
    await ownerCommercialTerms();
    const second = await step(["import"]);
    const dry = await run(["scripts/catalog.ts", "withdraw", "production"], []);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).candidates, 0);
    const verified = await run(["scripts/catalog.ts", "verify", "production"], []);
    assert.equal(verified.status, 0, verified.stderr);
    const counts = JSON.parse(verified.stdout);
    assert.equal(counts.photo_hash_mismatches, 0);
    // DEC-022 (owner 2026-10-30, also for production): the unit-only Rp99.000 scope of the committed dataset.
    assert.deepEqual({ categories: counts.categories, origin_warehouses: counts.origin_warehouses, stock_items: counts.stock_items, offers: counts.offers },
      { categories: 14, origin_warehouses: 34, stock_items: 287, offers: 287 });
    assert.equal(counts.receive_movements, counts.stock_items, "one receive movement per stock item");
    assert.equal(counts.cost_versions, counts.stock_items, "one HPP version per stock item");
    assert.equal(counts.published_products, second.published, JSON.stringify({ first, stock, second }));
    assert.ok(second.published > 0);
    assert.equal(stock.receive.received, counts.stock_items);
    // No synthetic operator was created on the production database.
    const [synthetic] = await sql`select count(*)::int n from app.auth_user where email ~* '@(99ribu\\.test|example\\.invalid)$'`;
    assert.equal(synthetic.n, 0);
    // A repeat of the load writes nothing.
    const before = await sql`select count(*)::int movements from app.stock_movement`;
    await step(["import"]);
    await step(["initial-stock"], { BERLAPAK_DATA_DIR: raw });
    const afterRepeat = await sql`select count(*)::int movements from app.stock_movement`;
    assert.equal(afterRepeat[0].movements, before[0].movements);
    const again = await run(["scripts/catalog.ts", "verify", "production"], []);
    assert.deepEqual(JSON.parse(again.stdout), counts);
  } finally { await sql.end(); }
});
