import { readRuntimeConfig } from "../../config/runtime.ts";
import { BrowserSession } from "../local/synthetic-session.ts";
import { isValidEmail } from "../storefront/contact.ts";
import { isSyntheticEmail, type LocalAuth } from "./auth.ts";
import { AccessError, getPrincipal } from "./policy.ts";

// S86/S87 operator commands (scripts/staff.ts, scripts/catalog.ts … production) run inside the deployed container
// and call the real auth handlers in process, with the headers the trusted proxy would send: the configured origin
// as Origin and Host, and the loopback address as the client IP. No synthetic principal is ever created here.
export function operatorSession(identity: LocalAuth) {
  const config = readRuntimeConfig(process.env);
  return new BrowserSession(identity, config.origin, {
    host: new URL(config.origin).host,
    ...(config.profile === "production" ? { [config.clientIpHeader]: "127.0.0.1" } : {}),
  });
}

// Operator-typed values: a real address (no synthetic test domain) and a password within the auth limits.
export function ownerInput(name: string, email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  if (!name.trim() || name.trim().length > 100) throw new AccessError(400, "OWNER_NAME_INVALID");
  if (!isValidEmail(normalized) || isSyntheticEmail(normalized)) throw new AccessError(400, "OWNER_EMAIL_INVALID");
  if (password.length < 12 || password.length > 128) throw new AccessError(400, "OWNER_PASSWORD_INVALID");
  return { name: name.trim(), email: normalized, password };
}

// The first owner (S86): refused when any owner exists or the email is taken. The operator typed the address on
// the server, so it counts as verified (operator-assisted verification; production mail delivery is S124). One
// session advisory lock serialises concurrent runs across the check, the user rows, the grant and the audit row.
// The account stays MFA_REQUIRED for every staff screen until its TOTP enrolment is verified.
export async function bootstrapOwner(identity: LocalAuth, input: { name: string; email: string; password: string }) {
  const owner = ownerInput(input.name, input.email, input.password);
  const context = await identity.auth.$context;
  const lock = await identity.sql.reserve();
  try {
    await lock`select pg_advisory_lock(hashtext('99ribu:bootstrap-owner'))`;
    try {
      const [existing] = await lock`select count(*)::int as n from app.role_grant where 'owner' = any(roles)`;
      if (existing.n > 0) throw new AccessError(409, "OWNER_EXISTS");
      if (await context.internalAdapter.findUserByEmail(owner.email)) throw new AccessError(409, "EMAIL_TAKEN");
      const user = await context.internalAdapter.createUser({ email: owner.email, name: owner.name, emailVerified: true }, { method: "admin" });
      try {
        await context.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await context.password.hash(owner.password) });
        await identity.sql.begin(async (tx) => {
          await tx`insert into app.role_grant (user_id,roles,permissions) values (${user.id},${["owner"]},${[]})`;
          await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason)
            values ('operator:bootstrap-owner','staff.bootstrap_owner',${user.id},'allowed','First owner created by the operator command (S86); email verified by the operator')`;
        });
      } catch (error) {
        // No half-created owner: the user row (and its credential, by cascade) goes, so a rerun with the same email works.
        await identity.sql`delete from app.auth_user where id=${user.id}`;
        throw error;
      }
      return user.id;
    } finally {
      await lock`select pg_advisory_unlock(hashtext('99ribu:bootstrap-owner'))`;
    }
  } finally {
    lock.release();
  }
}

// TOTP enrolment for a staff account that has none (after bootstrap, or for a newly granted staff member): password
// sign-in, then Better Auth's enable. The caller shows the URI and backup codes to the operator and verifies a code.
export async function startEnrollment(identity: LocalAuth, email: string, password: string) {
  const browser = operatorSession(identity);
  const signIn = await browser.auth("/sign-in/email", { email: email.trim().toLowerCase(), password });
  if (signIn.status !== 200) throw new AccessError(401, "OPERATOR_SIGN_IN_REJECTED");
  if ((await signIn.json())?.twoFactorRedirect === true) throw new AccessError(409, "MFA_ALREADY_ENROLLED");
  const enable = await browser.auth("/two-factor/enable", { password });
  if (enable.status !== 200) throw new AccessError(409, "MFA_ENABLE_REJECTED");
  const setup = (await enable.json()) as { totpURI: string; backupCodes: string[] };
  const verify = async (code: string) => {
    if ((await browser.auth("/two-factor/verify-totp", { code: code.replace(/\s+/g, "") })).status !== 200) return false;
    const [user] = await identity.sql`select id from app.auth_user where email=${email.trim().toLowerCase()}`;
    await identity.sql`insert into app.audit_event (actor_id,action,subject_id,outcome,reason)
      values ('operator:enroll-mfa','auth.mfa.enroll',${user.id},'allowed','TOTP enrolled through the operator command (S86)')`;
    return true;
  };
  // The enrolment session ends with the command (it only ever lived in this process).
  return { setup, verify, end: async () => { await browser.auth("/sign-out", {}); } };
}

// S87: an MFA-verified owner session for the catalog commands, from the operator's email, password and current code.
export async function ownerSession(identity: LocalAuth, credentials: { email: string; password: string; code: string }) {
  const browser = operatorSession(identity);
  try {
    const signIn = await browser.auth("/sign-in/email", { email: credentials.email.trim().toLowerCase(), password: credentials.password });
    if (signIn.status !== 200) throw new AccessError(401, "OPERATOR_SIGN_IN_REJECTED");
    if ((await signIn.json())?.twoFactorRedirect !== true) throw new AccessError(403, "MFA_REQUIRED");
    if ((await browser.auth("/two-factor/verify-totp", { code: credentials.code.replace(/\s+/g, "") })).status !== 200) throw new AccessError(401, "OPERATOR_TOTP_REJECTED");
    const principal = await getPrincipal(browser.request("/api/v1/admin/operator-command"), identity);
    if (!principal.roles.includes("owner")) throw new AccessError(403, "OPERATOR_NOT_OWNER");
    return browser;
  } catch (error) {
    await browser.auth("/sign-out", {});
    throw error;
  }
}
