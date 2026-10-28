import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { LocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { handleAuth } from "../../src/modules/access/handler.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { BrowserSession } from "../../src/modules/local/synthetic-session.ts";

export { BrowserSession, enroll } from "../../src/modules/local/synthetic-session.ts";

const ratePaths = ["/sign-up/email", "/sign-in/email", "/get-session", "/verify-email", "/sign-out", "/two-factor/enable", "/two-factor/verify-totp", "/two-factor/verify-backup-code"];
async function clearTestBuckets(identity: LocalAuth) {
  const keys = ratePaths.map((path) => `127.0.0.1|${path}`);
  await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(keys)}`;
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


/** Single-use `session.terminate_others` proof for the actor's own user id (password reauthentication). */
export async function terminationProof(identity: LocalAuth, who: { id: string; password: string; browser: BrowserSession }, password = who.password) {
  const request = who.browser.request("/api/v1/me/reauthentication-proofs", { password, action: "session.terminate_others", subject_id: who.id });
  request.headers.set("idempotency-key", randomUUID());
  const response = await handleAccess(request, identity);
  assert.equal(response.status, 201);
  return (await response.json()).proof as string;
}

/** Owner proof for both label-template creation and successor versions, never a commercial-policy proof. */
export async function labelTemplateProof(identity: LocalAuth, who: { id: string; password: string; browser: BrowserSession }) {
  await identity.sql`delete from app.auth_rate_limit where key=${`access-proof:${who.id}`}`;
  const request = who.browser.request("/api/v1/me/reauthentication-proofs", {
    password: who.password,
    action: "shipping_label_template.version",
    subject_id: "shipping-label-templates",
  });
  request.headers.set("idempotency-key", randomUUID());
  const response = await handleAccess(request, identity);
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).proof as string;
}
