import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { connectDatabase } from "../../db/client.ts";
import * as schema from "../../db/schema.ts";
import { readLocalConfig } from "../../config/local.ts";
import { localSigningKey } from "./local-key.ts";
import { enqueueLocalDelivery } from "../../jobs/outbox.ts";

export function isSyntheticEmail(value: unknown): value is string {
  return typeof value === "string" && /@[^@\s]+\.(?:invalid|test)$/i.test(value);
}

export function createLocalAuth(target: "local" | "test") {
  const config = readLocalConfig(process.env);
  const connection = connectDatabase(target);
  async function deliver(recipient: string, kind: "verification" | "password_reset" | "existing_account", url: string) {
    if (!isSyntheticEmail(recipient) || !config.trustedOrigins.includes(new URL(url).origin)) {
      throw new Error("Local delivery requires a synthetic recipient and canonical origin.");
    }
    await connection.sql.begin(async (tx) => {
      await tx`delete from app.local_delivery where expires_at < now()`;
      const [message] = await tx`insert into app.local_delivery (recipient, kind, url, expires_at) values (${recipient}, ${kind}, ${url}, now() + interval '30 minutes') returning id`;
      await enqueueLocalDelivery(tx, message.id);
    });
  }
  const auth = betterAuth({
    appName: "99ribu", basePath: "/api/auth",
    // Default: one static loopback origin. With the opt-in tailnet origin, links and redirects follow the
    // request's Host, which handleAuth has already pinned to exactly these two hosts (no other host, no
    // forwarded headers: trustedProxyHeaders stays false); anything else falls back to loopback.
    baseURL: config.tailnetOrigin
      ? { allowedHosts: config.trustedOrigins.map((origin) => new URL(origin).host), protocol: "http", fallback: config.origin }
      : config.origin,
    secret: localSigningKey(target), trustedOrigins: [...config.trustedOrigins],
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
      onExistingUserSignUp: ({ user }) => deliver(user.email, "existing_account", `${config.origin}/masuk`),
    },
    emailVerification: {
      sendOnSignUp: true, sendOnSignIn: false, autoSignInAfterVerification: false, expiresIn: 1800,
      sendVerificationEmail: ({ user, url }) => deliver(user.email, "verification", url),
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, freshAge: 900, cookieCache: { enabled: false } },
    account: { accountLinking: { enabled: false } },
    verification: { storeIdentifier: "hashed" },
    rateLimit: {
      // Loopback collapses every caller into one IP bucket, so these are global ceilings only.
      // Per-account budgets (handler.ts) carry the brute-force limits.
      enabled: true, storage: "database", window: 60, max: 300,
      customRules: {
        "/sign-in/email": { window: 60, max: 300 }, "/sign-up/email": { window: 60, max: 100 },
        "/request-password-reset": { window: 60, max: 100 }, "/reset-password": { window: 60, max: 100 },
        "/send-verification-email": { window: 60, max: 100 },
        "/two-factor/enable": { window: 60, max: 60 },
        "/two-factor/verify-totp": { window: 60, max: 300 },
        "/two-factor/verify-backup-code": { window: 60, max: 300 },
      },
    },
    advanced: {
      // HTTP is intentionally confined to this validated loopback profile, including NODE_ENV=production.
      // Both served origins are plain http (browsers drop Secure cookies on the non-loopback tailnet IP),
      // so session cookies stay non-Secure, host-only, HttpOnly and SameSite=Lax for either origin.
      useSecureCookies: false, cookiePrefix: `99ribu-${target}`, trustedProxyHeaders: false,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
      ipAddress: { ipAddressHeaders: ["x-99ribu-local-ip"] },
    },
  });
  return { auth, ...connection };
}

export type LocalAuth = ReturnType<typeof createLocalAuth>;
let local: LocalAuth | undefined;
export function getLocalAuth() {
  local ??= createLocalAuth("local");
  return local;
}
