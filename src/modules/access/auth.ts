import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { connectDatabase, type DatabaseTarget } from "../../db/client.ts";
import * as schema from "../../db/schema.ts";
import { readRuntimeConfig, runtimeTarget } from "../../config/runtime.ts";
import { localSigningKey } from "./local-key.ts";
import { enqueueLocalDelivery } from "../../jobs/outbox.ts";
import { randomBytes } from "node:crypto";
import { ACTIVATION_CALLBACK, isActivationCallback } from "./return-to.ts";

// Set by handleAuth on public sign-up and resend (never taken from the client) to the validated activation callback.
export const ACTIVATION_HEADER = "x-99ribu-activation";

export function isSyntheticEmail(value: unknown): value is string {
  return typeof value === "string" && /@[^@\s]+\.(?:invalid|test)$/i.test(value);
}

export function createLocalAuth(target: DatabaseTarget) {
  const config = readRuntimeConfig(process.env);
  const production = config.profile === "production";
  const connection = connectDatabase(target);
  async function deliver(recipient: string, kind: "verification" | "password_reset" | "existing_account", url: string) {
    // NOTIFICATION_ADAPTER is disabled in production (S86/OD-8 decide real delivery); nothing is queued.
    if (production) throw new Error("Notification delivery is disabled in the production profile.");
    if (!isSyntheticEmail(recipient) || !config.trustedOrigins.includes(new URL(url).origin)) {
      throw new Error("Local delivery requires a synthetic recipient and canonical origin.");
    }
    await connection.sql.begin(async (tx) => {
      await tx`delete from app.local_delivery where expires_at < now()`;
      const [message] = await tx`insert into app.local_delivery (recipient, kind, url, expires_at) values (${recipient}, ${kind}, ${url}, now() + interval '30 minutes') returning id`;
      await enqueueLocalDelivery(tx, message.id);
    });
  }
  // S123 (review M1, owner decision 2026-10-25): public sign-up takes no password (handleAuth stores a random
  // one nobody knows), and every email for an unverified account is a set-password link: Better Auth's own
  // reset token (same identifier, store and 30-minute expiry as /request-password-reset). onPasswordReset
  // below verifies the email once its owner has created the password, which also replaces any earlier one
  // and revokes sessions. The callback keeps a validated `next` (handleAuth passes it in ACTIVATION_HEADER).
  async function sendActivation(user: { id: string; email: string }, callback: string) {
    const context = await auth.$context;
    const token = randomBytes(24).toString("base64url");
    await context.internalAdapter.createVerificationValue({
      value: user.id, identifier: `reset-password:${token}`, expiresAt: new Date(Date.now() + 1800 * 1000),
    });
    await deliver(user.email, "password_reset", `${config.origin}/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(callback)}`);
  }
  const activationTarget = (request: Request | undefined, url?: string) => {
    const header = request?.headers.get(ACTIVATION_HEADER) ?? null;
    const fromUrl = url ? new URL(url).searchParams.get("callbackURL") : null;
    return header !== null && isActivationCallback(header) ? header : fromUrl !== null && isActivationCallback(fromUrl) ? fromUrl : ACTIVATION_CALLBACK;
  };
  const auth = betterAuth({
    appName: "99ribu", basePath: "/api/auth",
    // Default: one static loopback origin. With the opt-in tailnet origin, links and redirects follow the
    // request's Host, which handleAuth has already pinned to exactly these two hosts (no other host, no
    // forwarded headers: trustedProxyHeaders stays false); anything else falls back to loopback.
    baseURL: config.tailnetOrigin
      ? { allowedHosts: config.trustedOrigins.map((origin) => new URL(origin).host), protocol: "http", fallback: config.origin }
      : config.origin,
    // Production: the env secret validated by readProductionConfig (never a .local/auth file, never logged).
    secret: production ? process.env.BETTER_AUTH_SECRET as string : localSigningKey(target as "local" | "test"),
    trustedOrigins: [...config.trustedOrigins],
    database: drizzleAdapter(connection.db, { provider: "pg", schema, transaction: true }),
    plugins: [twoFactor({ issuer: "99ribu", skipVerificationOnEnable: false, allowPasswordless: false, twoFactorCookieMaxAge: 300 })],
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        if (!["/two-factor/verify-totp", "/two-factor/verify-backup-code"].includes(ctx.path)) return;
        const result = ctx.context.returned;
        if (!result || typeof result !== "object" || isAPIError(result) || !("user" in result)) return;
        // Enrollment rotates its session; challenge completion creates one. An
        // account flag alone must never authorize another pre-enrollment session.
        const verified = ctx.context.newSession ?? ctx.context.session;
        if (!verified?.user.twoFactorEnabled || !verified.session) return;
        await connection.sql`insert into app.mfa_session (session_id)
          select id from app.auth_session where id=${verified.session.id} and expires_at>now()
          on conflict (session_id) do update set verified_at=now()`;
      }),
    },
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true, requireEmailVerification: true, autoSignIn: false,
      minPasswordLength: 12, maxPasswordLength: 128, resetPasswordTokenExpiresIn: 1800,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) => deliver(user.email, "password_reset", url),
      // Same reply either way (Better Auth's generic duplicate response); only the email differs.
      onExistingUserSignUp: ({ user }, request) => user.emailVerified ? deliver(user.email, "existing_account", `${config.origin}/masuk`) : sendActivation(user, activationTarget(request)),
      // Called by POST /reset-password after the token was consumed and the new password stored.
      onPasswordReset: async ({ user }) => {
        if (!user.emailVerified) await connection.sql`update app.auth_user set email_verified=true, updated_at=now() where id=${user.id}`;
      },
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: false, autoSignInAfterVerification: false, expiresIn: 1800,
      // A public sign-up (ACTIVATION_HEADER, set by handleAuth) and every resend (only ever called for an
      // unverified account) get the set-password link. Only in-process harness sign-ups that pass a password
      // (fixtures, seeds; not reachable over HTTP) still get a plain verification link.
      sendVerificationEmail: ({ user, url }, request) =>
        request?.headers.has(ACTIVATION_HEADER) || (request && new URL(request.url).pathname.endsWith("/send-verification-email"))
          ? sendActivation(user, activationTarget(request, url)) : deliver(user.email, "verification", url),
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, freshAge: 900, cookieCache: { enabled: false } },
    account: { accountLinking: { enabled: false } },
    verification: { storeIdentifier: "hashed" },
    rateLimit: {
      // Loopback collapses every caller into one IP bucket, so locally these are global ceilings only;
      // in production they key on the trusted proxy's client IP (handleAuth).
      // Per-account budgets (handler.ts) carry the brute-force limits.
      enabled: true, storage: "database", window: 60, max: 300,
      customRules: {
        "/sign-in/email": { window: 60, max: 300 }, "/sign-up/email": { window: 60, max: 100 },
        "/request-password-reset": { window: 60, max: 100 }, "/reset-password": { window: 60, max: 100 },
        "/send-verification-email": { window: 60, max: 100 },
        "/two-factor/enable": { window: 60, max: 60 },
        "/change-password": { window: 60, max: 300 }, "/two-factor/generate-backup-codes": { window: 60, max: 300 },
        "/two-factor/verify-totp": { window: 60, max: 300 },
        "/two-factor/verify-backup-code": { window: 60, max: 300 },
      },
    },
    advanced: {
      // Local: HTTP is intentionally confined to this validated loopback profile, including NODE_ENV=production.
      // Both served origins are plain http (browsers drop Secure cookies on the non-loopback tailnet IP),
      // so session cookies stay non-Secure, host-only, HttpOnly and SameSite=Lax for either origin.
      // Production: one exact https origin, so cookies are Secure and __Secure- prefixed.
      useSecureCookies: production, cookiePrefix: `99ribu-${target}`, trustedProxyHeaders: false,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      // handleAuth overwrites this header on every request: the loopback stamp locally, the trusted proxy's client IP in production.
      ipAddress: { ipAddressHeaders: [production ? "x-99ribu-client-ip" : "x-99ribu-local-ip"] },
    },
  });
  return { auth, ...connection };
}

export type LocalAuth = ReturnType<typeof createLocalAuth>;
let local: LocalAuth | undefined;
export function getLocalAuth() {
  local ??= createLocalAuth(runtimeTarget());
  return local;
}
