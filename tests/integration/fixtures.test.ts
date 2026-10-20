import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { runOneJob } from "../../src/jobs/worker.ts";
import { advanceFixtureClock, readFixtureClock, readFixtureInbox, seedLocal } from "../../src/modules/local/fixtures.ts";
import { BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";

const exec = promisify(execFile);

test("local fixture seed preserves real identities, isolates inboxes and advances only its business clock", async (t) => {
  const namespaces = [0, 1].map(() => `s11-${randomUUID().slice(0, 16)}`);
  const identity = createLocalAuth("test");
  const seeds: Awaited<ReturnType<typeof seedLocal>>[] = [];
  const unrelated = randomUUID();
  const bucketKeys = ["/request-password-reset", "/reset-password", "/sign-in/email", "/get-session", "/two-factor/enable", "/two-factor/verify-totp"].map((path) => `127.0.0.1|${path}`);
  try {
    await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(bucketKeys)}`;
    await identity.sql`insert into app.warehouse (id,name,city) values (${unrelated},'Synthetic unrelated warehouse','Malang')`;
    await t.test("two concurrent seed transactions retain one complete identity set and do not reset other rows", async () => {
      const results = await Promise.all([seedLocal("test", namespaces[0]), seedLocal("test", namespaces[0])]);
      assert.deepEqual(results.map((r) => r.created).sort(), [false, true]);
      assert.deepEqual(results[0].principals, results[1].principals); assert.deepEqual(results[0].warehouses, results[1].warehouses);
      seeds.push(results[0], await seedLocal("test", namespaces[1]));
      assert.equal(Object.keys(seeds[0].principals).length, 8); assert.equal(Object.keys(seeds[0].warehouses).length, 2);
      assert.ok(Object.values(seeds[0].principals).every((id) => !Object.values(seeds[1].principals).includes(id)));
      assert.ok(Object.values(seeds[0].warehouses).every((id) => !Object.values(seeds[1].warehouses).includes(id)));
      const [facts] = await identity.sql`select count(*)::int as n from app.auth_account where user_id in ${identity.sql(Object.values(seeds[0].principals))} and provider_id='credential' and password is not null`;
      assert.equal(facts.n, 8);
      const [scope] = await identity.sql`select warehouse_id from app.warehouse_membership where user_id=${seeds[0].principals['fixture-warehouse']}`;
      assert.equal(scope.warehouse_id, seeds[0].warehouses["fixture-malang"]);
      const { stdout } = await exec(process.execPath, ["--env-file=.env.example", "scripts/seed.ts", "seed", "test", namespaces[0]], { timeout: 10000 });
      const report = JSON.parse(stdout); assert.equal(report.created, false); assert.deepEqual(report.principals, seeds[0].principals);
      assert.deepEqual(Object.keys(report).sort(), ["clock", "created", "namespace", "principals", "version", "warehouses"]);
      assert.equal((await identity.sql`select id from app.warehouse where id=${unrelated}`).length, 1);
      const [audit] = await identity.sql`select count(*)::int as n from app.audit_event where actor_id=${`local-seed:${namespaces[0]}`}`;
      assert.equal(audit.n, 1);
    });
    const sessions: { browser: BrowserSession; password: string; id: string }[] = [];
    await t.test("real auth recovery and worker delivery stay private and namespace-bound; staff still needs MFA", async () => {
      for (const fixtureId of ["fixture-buyer-a", "fixture-owner"]) {
        const id = seeds[0].principals[fixtureId];
        const [user] = await identity.sql`select email from app.auth_user where id=${id}`;
        const browser = new BrowserSession(identity); const password = randomBytes(24).toString("base64url");
        assert.equal((await browser.auth("/request-password-reset", { email: user.email, redirectTo: "http://127.0.0.1:3099/reset-password" })).status, 200);
        assert.equal((await readFixtureInbox("test", namespaces[0], id)).length, 0);
        await assert.rejects(readFixtureInbox("test", namespaces[1], id), /scope denied/);
        for (let i = 0; i < 20 && !(await readFixtureInbox("test", namespaces[0], id)).length; i++) await runOneJob(identity.sql);
        const inbox = await readFixtureInbox("test", namespaces[0], id); assert.equal(inbox.length, 1);
        const token = new URL(inbox[0].url).pathname.split("/").at(-1);
        assert.equal((await browser.auth("/reset-password", { token, newPassword: password })).status, 200);
        assert.equal((await browser.auth("/sign-in/email", { email: user.email, password })).status, 200);
        assert.equal((await browser.access("/me")).status, fixtureId === "fixture-owner" ? 403 : 200);
        if (fixtureId === "fixture-owner") { await enroll(browser, password); assert.equal((await browser.access("/me")).status, 200); }
        sessions.push({ browser, password, id });
        const { stdout } = await exec(process.execPath, ["--env-file=.env.example", "scripts/seed.ts", "inbox", "test", namespaces[0], id], { timeout: 10000 });
        assert.ok(!stdout.includes(inbox[0].url) && !stdout.includes(token as string) && !stdout.includes(password), "CLI must not disclose private recovery data");
        assert.deepEqual(Object.keys(JSON.parse(stdout).messages[0]).sort(), ["expiresAt", "id", "kind"]);
      }
    });
    await t.test("clock compare-and-set is isolated, persists on rerun/reconnect and never expires a real auth session", async () => {
      const initial = await readFixtureClock("test", namespaces[0]); const sibling = await readFixtureClock("test", namespaces[1]);
      const results = await Promise.allSettled([advanceFixtureClock("test", namespaces[0], 15 * 86400, initial.version), advanceFixtureClock("test", namespaces[0], 15 * 86400, initial.version)]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); assert.equal(results.filter((r) => r.status === "rejected").length, 1);
      const current = await readFixtureClock("test", namespaces[0]); assert.equal(current.version, initial.version + 1);
      assert.equal(Date.parse(current.now) - Date.parse(initial.now), 15 * 86400000);
      assert.deepEqual(await readFixtureClock("test", namespaces[1]), sibling);
      for (const seconds of [0, -1, 1.5, 31622401, Number.NaN]) await assert.rejects(advanceFixtureClock("test", namespaces[0], seconds, current.version));
      const owner = sessions[1];
      const [before] = await identity.sql`select password from app.auth_account where user_id=${owner.id} and provider_id='credential'`;
      await identity.sql`update app.role_grant set roles=ARRAY['ecommerce_admin']::text[],revision=revision+1 where user_id=${owner.id}`;
      await identity.sql`update app.warehouse set name='Synthetic edited warehouse',active=false where id=${seeds[0].warehouses['fixture-malang']}`;
      const rerun = await seedLocal("test", namespaces[0]); assert.equal(rerun.created, false); assert.equal(rerun.clock, current.now);
      const [after] = await identity.sql`select a.password,u.two_factor_enabled,g.roles from app.auth_account a join app.auth_user u on u.id=a.user_id join app.role_grant g on g.user_id=u.id where u.id=${owner.id}`;
      assert.ok(before.password === after.password, "Seed must preserve the recovered credential"); assert.equal(after.two_factor_enabled, true); assert.deepEqual(after.roles, ["ecommerce_admin"]);
      const [warehouse] = await identity.sql`select name,active from app.warehouse where id=${seeds[0].warehouses['fixture-malang']}`;
      assert.equal(warehouse.name, "Synthetic edited warehouse"); assert.equal(warehouse.active, false);
      assert.equal((await owner.browser.access("/me")).status, 200, "Business clock must not alter real session/MFA time");
      assert.equal((await sessions[0].browser.access("/me")).status, 200);
    });
    await t.test("invalid target, namespace, reset command and incomplete identity mappings fail closed", async () => {
      for (const namespace of ["../unsafe", "", "UPPER", "x".repeat(25)]) await assert.rejects(seedLocal("test", namespace));
      await assert.rejects(seedLocal("remote" as "test", namespaces[0]));
      for (const args of [["reset", "test", namespaces[0]], ["seed", "remote", namespaces[0]], ["seed", "test", namespaces[0], "--force"]]) await assert.rejects(exec(process.execPath, ["--env-file=.env.example", "scripts/seed.ts", ...args], { timeout: 10000 }));
      const previous = process.env.APP_ENV;
      try { process.env.APP_ENV = "production"; await assert.rejects(seedLocal("test", namespaces[0])); }
      finally { process.env.APP_ENV = previous; }
      await identity.sql`delete from app.local_fixture_principal where namespace=${namespaces[1]} and fixture_id='fixture-buyer-b'`;
      await assert.rejects(seedLocal("test", namespaces[1]), /mapping changed/);
      const [count] = await identity.sql`select count(*)::int as n from app.auth_user where email like ${`${namespaces[1]}.%@example.test`}`; assert.equal(count.n, 8);
    });
  } finally {
    for (const seed of seeds) {
      const users = await identity.sql`select id,email from app.auth_user where id in ${identity.sql(Object.values(seed.principals))}`;
      await identity.sql`delete from app.local_fixture_principal where namespace=${seed.namespace}`;
      await identity.sql`delete from app.local_fixture_warehouse where namespace=${seed.namespace}`;
      await cleanup(identity, users.map((u) => ({ id: u.id as string, email: u.email as string })));
      await identity.sql`delete from app.warehouse where id in ${identity.sql(Object.values(seed.warehouses))}`;
      await identity.sql`delete from app.local_fixture_namespace where name=${seed.namespace}`;
    }
    await identity.sql`delete from app.warehouse where id=${unrelated}`;
    await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(bucketKeys)}`;
    await identity.sql.end();
  }
});
