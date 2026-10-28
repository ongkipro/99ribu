import { mac, prefix, revokeGuestContext } from "../checkout/access.ts";
import { ACTIVATION_HEADER, isSyntheticEmail, type LocalAuth } from "./auth.ts";
import { getPrincipal, isStaff, projectMe, AccessError, type Principal } from "./policy.ts";
import { readAccountSecurity, recordAuthAudit, recordPasswordChange } from "./account-security.ts";
import { clientIp, privateJson, problem, requestOrigin } from "./http.ts";
import { readRuntimeConfig } from "../../config/runtime.ts";
import { rateLimit } from "./rate-limit.ts";
import { ACTIVATION_CALLBACK, isActivationCallback, isVerificationCallback } from "./return-to.ts";
import { emailDomainReceives } from "./email-domain.ts";
import { normalizeWhatsApp } from "../shipping/address.ts";
import { isValidEmail, normalizeEmailInput } from "../storefront/contact.ts";
import { parseCookies } from "better-auth/cookies";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function authCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  if (header.split(";").filter((part) => part.slice(0, part.indexOf("=")).trim() === name).length > 1) throw new AccessError(401, "UNAUTHENTICATED");
  return parseCookies(header).get(name) ?? null;
}

// Better Auth 1.7.10 two-factor: the signed `two_factor` cookie carries a fresh `2fa-*` verification
// identifier per sign-in whose row value is the user id. Resolve it (HMAC-SHA256 base64 signature, as
// better-call signs cookies) so every pending challenge for one account shares one budget.
async function pendingTwoFactorUser(identity: LocalAuth, signed: string) {
  const context = await identity.auth.$context;
  const dot = signed.lastIndexOf(".");
  const signature = Buffer.from(signed.slice(dot + 1), "base64");
  const expected = createHmac("sha256", context.secret).update(signed.slice(0, dot)).digest();
  if (dot < 1 || signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  const row = await context.internalAdapter.findVerificationValue(signed.slice(0, dot));
  return row && row.expiresAt > new Date() ? row.value : null;
}

// Per-account budgets [max, windowMs]; the Better Auth buckets are only global ceilings.
const ACCOUNT_LIMITS: Record<string, readonly [number, number]> = {
  "/api/auth/sign-in/email": [5, 60_000], "/api/auth/sign-up/email": [3, 60_000],
  "/api/auth/request-password-reset": [3, 60_000], "/api/auth/reset-password": [3, 60_000],
  "/api/auth/send-verification-email": [3, 60_000],
  "/api/auth/two-factor/enable": [3, 60_000], "/api/auth/two-factor/verify-totp": [5, 60_000],
  "/api/auth/two-factor/verify-backup-code": [5, 60_000],
};

// S129 own-account actions that re-ask for the current password: Better Auth's change-password and backup-code
// regeneration. One budget per account: 5 attempts per 15 minutes, counted whether or not the password was right.
const SENSITIVE_PATHS = ["/api/auth/change-password", "/api/auth/two-factor/generate-backup-codes"];
const SENSITIVE_LIMIT = [5, 900_000] as const;

async function auditSensitive(identity: LocalAuth, principal: Principal, path: string, response: Response) {
  const payload = await response.clone().json().catch(() => null) as { code?: unknown; token?: unknown } | null;
  const password = path === "/api/auth/change-password";
  if (response.ok) {
    if (password) await recordPasswordChange(identity, principal, payload?.token);
    else await recordAuthAudit(identity.sql, { actorId: principal.id, action: "auth.backup_codes.regenerate", outcome: "allowed", reason: "own_backup_codes_regenerated" });
    return;
  }
  const code = typeof payload?.code === "string" && /^[A-Z_]{1,64}$/.test(payload.code) ? payload.code : `HTTP_${response.status}`;
  await recordAuthAudit(identity.sql, { actorId: principal.id, action: password ? "auth.password.change" : "auth.backup_codes.regenerate", outcome: "denied", reason: code });
}

const MAIL_PATHS = ["/api/auth/sign-up/email", "/api/auth/send-verification-email", "/api/auth/request-password-reset"];
const MAIL_PER_DAY = [10, 86_400_000] as const;

// `public`: the network entry points (/api/auth/[...all] and /masuk/kirim) pass it; sign-up there takes no
// password and mails only set-password links. In-process callers (fixtures, seeds, tests) keep the
// password sign-up and plain verification link of the harness.
export async function handleAuth(request: Request, identity: LocalAuth, options: { public?: boolean } = {}) {
  const incoming = new URL(request.url);
  const path = incoming.pathname;
  const getPaths = ["/api/auth/get-session", "/api/auth/verify-email", "/api/auth/account-security"];
  const postPaths = ["/api/auth/sign-up/email", "/api/auth/sign-in/email", "/api/auth/sign-out", "/api/auth/request-password-reset", "/api/auth/reset-password", "/api/auth/send-verification-email", "/api/auth/two-factor/enable", "/api/auth/two-factor/verify-totp", "/api/auth/two-factor/verify-backup-code", ...SENSITIVE_PATHS];
  // Enable reviewed browser flows only. Better Auth's remaining routes are not public contracts yet: other-session
  // revocation, session lists (they carry tokens) and two-factor disable stay closed, so staff cannot switch MFA off.
  if (!(request.method === "GET" && (getPaths.includes(path) || /^\/api\/auth\/reset-password\/[A-Za-z0-9_-]+$/.test(path))) && !(request.method === "POST" && postPaths.includes(path))) {
    return Response.json({ code: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  // Same Host rule as every other mutation boundary (http.ts): loopback or the opt-in tailnet origin locally, the exact APP_ORIGIN host in production.
  const origin = requestOrigin(request);
  if (!origin) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  if (!["GET", "POST"].includes(request.method)) return new Response(null, { status: 405 });
  if (request.method === "POST" && request.headers.get("origin") !== origin) {
    return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  }
  if (request.method === "GET" && path === "/api/auth/account-security") {
    // The caller's own two-step state and sessions (no tokens, seeds or codes), one read budget per account.
    try {
      if (incoming.search) throw new AccessError(400, "INVALID_INPUT");
      const principal = await getPrincipal(request, identity);
      await rateLimit(identity.sql, `auth-security-read:${await mac(identity, "auth-account", [principal.id])}`, [60, 60_000]);
      return privateJson(await readAccountSecurity(identity, principal));
    } catch (error) { return problem(error); }
  }
  const { profile } = readRuntimeConfig(process.env);
  // Production has no notification adapter (S86/OD-8): flows that must send a message stay closed.
  if (profile === "production" && ["/api/auth/sign-up/email", "/api/auth/request-password-reset", "/api/auth/send-verification-email"].includes(path)) {
    return Response.json({ code: "NOTIFICATION_DISABLED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const headers = new Headers(request.headers);
  headers.delete(ACTIVATION_HEADER); // only ever set below, from a validated body
  // Locally Next is bound only to 127.0.0.1; in production only the configured trusted-proxy header counts.
  // Either way the header Better Auth reads is overwritten here, so a browser-supplied copy has no authority.
  try { headers.set(profile === "production" ? "x-99ribu-client-ip" : "x-99ribu-local-ip", clientIp(request)); }
  catch (error) { return problem(error); }
  let bodyText: string | undefined;
  let signUpPhone: string | null = null, signUpEmail = "", signUpExisted = true, mailDomain: string | null = null;
  if (request.method === "POST") {
    if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ code: "INVALID_INPUT" }, { status: 415 });
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ code: "INVALID_INPUT" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        return Response.json({ code: "BODY_TOO_LARGE" }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
    bodyText = Buffer.concat(chunks).toString("utf8");
    let body: Record<string, unknown> | null;
    try { body = JSON.parse(bodyText); } catch { body = null; }
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ code: "INVALID_INPUT" }, { status: 400 });
    // Local profile: synthetic identities only. Production sign-in uses real staff emails (sign-up is closed above).
    if (profile === "local" && body.email !== undefined && !isSyntheticEmail(body.email)) {
      return Response.json({ code: "SYNTHETIC_EMAIL_REQUIRED" }, { status: 400 });
    }
    // S123: only the reviewed fields (no `image` or other user columns), a link may only return to the
    // activation page (public) or the verification landing (harness) with a validated `next` (no open
    // redirect through a trusted origin's other paths), and a display name is 1-100 characters.
    // Owner decision 2026-10-25: a public sign-up never carries a password. Better Auth still needs one, so
    // a random 64-character value nobody learns is stored, and the email owner creates the real password
    // through the set-password link (auth.ts sendActivation / onPasswordReset).
    if (["/api/auth/sign-up/email", "/api/auth/send-verification-email"].includes(path)) {
      const signUp = path.endsWith("/sign-up/email");
      // Public sign-up (owner 2026-10-25): name, email and a WhatsApp number; no password.
      const keys = signUp ? ["name", "email", ...(options.public ? ["phone"] : ["password"]), "callbackURL"] : ["email", "callbackURL"];
      const callbackOk = body.callbackURL === undefined || (options.public ? isActivationCallback(body.callbackURL) : isVerificationCallback(body.callbackURL) || isActivationCallback(body.callbackURL));
      const reject = (code: string) => Response.json({ code }, { status: 400, headers: { "Cache-Control": "no-store" } });
      if (Object.keys(body).some((key) => !keys.includes(key)) || !callbackOk ||
          (signUp && (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100))) {
        return reject("INVALID_INPUT");
      }
      if (options.public) {
        // Shared contact rules (storefront/contact.ts) before any effect; the number is stored E.164 `+62…`.
        if (typeof body.email !== "string" || !isValidEmail(body.email)) return reject("INVALID_EMAIL");
        if (signUp) {
          try { signUpPhone = normalizeWhatsApp(body.phone); } catch { return reject("INVALID_WHATSAPP"); }
        }
        // Checked after the per-account budgets below, so unauthenticated callers cannot drive DNS lookups unmetered.
        if (profile === "production") mailDomain = body.email;
        headers.set(ACTIVATION_HEADER, typeof body.callbackURL === "string" ? body.callbackURL : ACTIVATION_CALLBACK);
        if (signUp) {
          const { phone: _phone, ...rest } = body;
          signUpEmail = normalizeEmailInput(body.email).toLowerCase();
          [{ exists: signUpExisted }] = await identity.sql<{ exists: boolean }[]>`select exists(select 1 from app.auth_user where email=${signUpEmail}) as exists`;
          bodyText = JSON.stringify({ ...rest, password: randomBytes(48).toString("base64url") });
        }
      }
    }
    if (path === "/api/auth/change-password") {
      const { currentPassword, newPassword } = body;
      if (Object.keys(body).some((key) => key !== "currentPassword" && key !== "newPassword") ||
          typeof currentPassword !== "string" || !currentPassword || currentPassword.length > 128 ||
          typeof newPassword !== "string" || newPassword.length > 128) {
        return Response.json({ code: "INVALID_INPUT" }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      if (newPassword === currentPassword) return Response.json({ code: "PASSWORD_UNCHANGED" }, { status: 400, headers: { "Cache-Control": "no-store" } });
      // A password change always ends every other session (S129); the client cannot opt out.
      bodyText = JSON.stringify({ currentPassword, newPassword, revokeOtherSessions: true });
    }
    if (path.includes("/two-factor/")) {
      const passwordBody = path.endsWith("/enable") || path.endsWith("/generate-backup-codes");
      const allowed = passwordBody ? ["password"] : ["code"];
      if (Object.keys(body).some((key) => !allowed.includes(key)) ||
          (passwordBody ? typeof body.password !== "string" || body.password.length > 128 : typeof body.code !== "string" || body.code.length > 64)) {
        return Response.json({ code: "INVALID_INPUT" }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      if (path.endsWith("/enable")) {
        const current = await identity.auth.api.getSession({ headers: request.headers });
        if (!current?.user.emailVerified) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
        if (current.user.twoFactorEnabled) return Response.json({ code: "MFA_ALREADY_ENABLED" }, { status: 409 });
      }
    }
  }
  const limit = ACCOUNT_LIMITS[path];
  if (request.method === "POST" && limit) {
    // Subject is never a client IP header: email, reset token, the pending 2FA user id, or the session cookie.
    const body = JSON.parse(bodyText as string) as Record<string, unknown>;
    try {
      // Key 2FA on the value Better Auth itself reads (same parser/normalisation); ambiguous duplicates are refused.
      const p = path.includes("/two-factor/") ? await prefix(identity) : "";
      const pending = p ? authCookie(request, `${p}.two_factor`) : null;
      // Unresolvable challenges share one conservative bucket; they are never unlimited.
      const subject = pending ? await pendingTwoFactorUser(identity, pending) ?? "two-factor:unresolved"
        : p ? authCookie(request, `${p}.session_token`)
        : path.endsWith("/reset-password") ? body.token
        : typeof body.email === "string" ? body.email.trim().toLowerCase() : null;
      if (typeof subject === "string" && subject) {
        await rateLimit(identity.sql, `auth-account:${path}:${await mac(identity, "auth-account", [subject])}`, limit);
        // S123 review L1: every flow that mails an address shares one daily budget per address (mail bombing).
        if (MAIL_PATHS.includes(path)) await rateLimit(identity.sql, `auth-mail-day:${await mac(identity, "auth-account", [subject])}`, MAIL_PER_DAY);
      }
    } catch (error) {
      const limited = problem(error);
      const retryAfter = limited.headers.get("Retry-After");
      if (retryAfter) limited.headers.set("X-Retry-After", retryAfter);
      return limited;
    }
  }
  let sensitive: Principal | null = null;
  if (request.method === "POST" && SENSITIVE_PATHS.includes(path)) {
    // Own-account reauthentication by password: the caller must hold a verified session (staff: MFA-verified),
    // and wrong guesses burn one budget per account (not per session or address), so extra sessions add nothing.
    try {
      sensitive = await getPrincipal(request, identity);
      // A session opened before two-step enrollment must not mint backup codes for the now-protected account.
      // An account without two-step falls through to Better Auth's own TWO_FACTOR_NOT_ENABLED refusal.
      if (path === "/api/auth/two-factor/generate-backup-codes" && !sensitive.mfaAt) {
        const [flag] = await identity.sql`select two_factor_enabled from app.auth_user where id=${sensitive.id}`;
        if (flag?.two_factor_enabled) throw new AccessError(403, "MFA_REQUIRED");
      }
      await rateLimit(identity.sql, `auth-account:${path}:${await mac(identity, "auth-account", [sensitive.id])}`, SENSITIVE_LIMIT);
    } catch (error) { return problem(error); }
  }
  if (mailDomain !== null && !(await emailDomainReceives(mailDomain))) {
    return Response.json({ code: "EMAIL_DOMAIN_UNREACHABLE" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const canonicalURL = new URL(path + incoming.search, origin);
  const response = await identity.auth.handler(new Request(canonicalURL, { method: request.method, headers, body: bodyText }));
  // S123: the WhatsApp number of a public sign-up is kept only on the account that sign-up created
  // (buyer_profile.phone; phone_verified_at null = unverified). For an existing account, verified or not, it is
  // dropped: an unauthenticated request never changes a stored number; the owner edits it in /akun.
  if (signUpPhone && !signUpExisted && response.ok) {
    await identity.sql`insert into app.buyer_profile (user_id, display_name, email, phone)
      select id, left(name, 120), email, ${signUpPhone} from app.auth_user where email=${signUpEmail}
      on conflict (user_id) do nothing`;
  }
  if (response.ok && ["/api/auth/sign-in/email", "/api/auth/sign-out"].includes(path)) {
    try { await revokeGuestContext(request,identity,response); } catch (error) { return problem(error); }
  }
  if (sensitive && (path === "/api/auth/change-password" || path === "/api/auth/two-factor/generate-backup-codes")) {
    try { await auditSensitive(identity, sensitive, path, response); } catch (error) { return problem(error); }
  }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (response.status >= 300 && response.status < 400) return response;
  if (response.headers.get("content-type")?.includes("application/json")) {
    let body = await response.json();
    if (body && typeof body === "object") {
      delete body.token;
      if (body.session) delete body.session.token;
      if (path === "/api/auth/sign-up/email" && response.ok) body = { status: true };
      // One uniform rejection, EMAIL_NOT_VERIFIED included: a publicly created unverified account has only
      // a random password nobody knows (it becomes usable when its owner creates one, which also verifies
      // the email), so naming that state would only ever answer harness accounts.
      if (path === "/api/auth/sign-in/email" && [401, 403].includes(response.status)) {
        return Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401, headers: response.headers });
      }
    }
    response.headers.delete("content-length");
    return Response.json(body, { status: response.status, headers: response.headers });
  }
  return response;
}

export async function requireIdentity(request: Request, identity: LocalAuth) {
  const session = await identity.auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!session?.user.emailVerified) return null;
  return { id: session.user.id, name: session.user.name, email: session.user.email };
}

export async function requireStaff(request: Request, identity: LocalAuth) {
  try {
    const principal = await getPrincipal(request, identity);
    if (!isStaff(principal)) throw new AccessError(403, "FORBIDDEN");
    return privateJson(projectMe(principal));
  } catch (error) { return problem(error); }
}
