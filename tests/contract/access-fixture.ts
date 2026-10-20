import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { LocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { handleAuth } from "../../src/modules/access/handler.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { totp } from "../integration/totp-fixture.ts";

const origin = "http://127.0.0.1:3099";
const ratePaths = ["/sign-up/email", "/sign-in/email", "/get-session", "/verify-email", "/sign-out", "/two-factor/enable", "/two-factor/verify-totp", "/two-factor/verify-backup-code"];
async function clearTestBuckets(identity: LocalAuth) {
  const keys = ratePaths.map((path) => `127.0.0.1|${path}`);
  await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(keys)}`;
}
export class BrowserSession {
  cookies = new Map<string, string>();
  readonly identity: LocalAuth;
  constructor(identity: LocalAuth) { this.identity = identity; }
  request(path: string, body?: Record<string, unknown>) {
    return new Request(`${origin}${path}`, { method: body ? "POST" : "GET", headers: { origin, "content-type": "application/json",
      cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ") }, body: body ? JSON.stringify(body) : undefined });
  }
  async auth(path: string, body?: Record<string, unknown>) {
    const response = await handleAuth(this.request(`/api/auth${path}`, body), this.identity);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";")[0]; const index = pair.indexOf("=");
      const name = pair.slice(0, index); const value = pair.slice(index + 1);
      if (value) this.cookies.set(name, value); else this.cookies.delete(name);
    }
    return response;
  }
  access(path: string, body?: Record<string, unknown>) { return handleAccess(this.request(`/api/v1${path}`, body), this.identity); }
}
export async function actor(identity: LocalAuth, role: Role, warehouseIds: string[]) {
  await clearTestBuckets(identity);
  const email = `access-${randomUUID()}@example.invalid`; const password = randomBytes(24).toString("base64url");
  const browser = new BrowserSession(identity);
  assert.equal((await browser.auth("/sign-up/email", { name: "Synthetic Access", email, password })).status, 200);
  const [user] = await identity.sql`select id from app.auth_user where email=${email}`;
  // This fixture consumes its own verification URL through the public handler;
  // inbox delivery persistence itself is covered by the foundation worker tests.
  const [message] = await identity.sql`select url from app.local_delivery where recipient=${email} and kind='verification'`;
  assert.ok([200, 302].includes((await handleAuth(new Request(message.url), identity)).status));
  assert.equal((await browser.auth("/sign-in/email", { email, password })).status, 200);
  await identity.sql`insert into app.role_grant (user_id, roles) values (${user.id}, ${[role]})`;
  for (const id of warehouseIds) await identity.sql`insert into app.warehouse_membership (user_id,warehouse_id) values (${user.id},${id})`;
  return { id: user.id as string, email, password, browser };
}
export async function enroll(browser: BrowserSession, password: string) {
  const response = await browser.auth("/two-factor/enable", { password });
  assert.equal(response.status, 200);
  const setup = await response.json();
  assert.equal((await browser.auth("/two-factor/verify-totp", { code: totp(setup.totpURI) })).status, 200);
  return setup as { totpURI: string; backupCodes: string[] };
}
export async function cleanup(identity: LocalAuth, users: { id: string; email: string }[]) {
  for (const user of users) {
    await identity.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${user.email})`;
    await identity.sql`delete from app.local_delivery where recipient=${user.email}`;
    await identity.sql`delete from app.auth_verification where value=${user.id}`;
    await identity.sql`delete from app.access_operation where actor_id=${user.id}`;
    await identity.sql`delete from app.auth_rate_limit where key=${`access-proof:${user.id}`}`;
    await identity.sql`delete from app.auth_user where id=${user.id}`;
  }
  await clearTestBuckets(identity);
}

