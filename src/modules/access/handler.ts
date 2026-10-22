import { mac, prefix, revokeGuestContext } from "../checkout/access.ts";
import { isSyntheticEmail, type LocalAuth } from "./auth.ts";
import { getPrincipal, isStaff, projectMe, AccessError } from "./policy.ts";
import { privateJson, problem, requestOrigin } from "./http.ts";
import { rateLimit } from "./rate-limit.ts";
import { parseCookies } from "better-auth/cookies";
import { createHmac, timingSafeEqual } from "node:crypto";

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

export async function handleAuth(request: Request, identity: LocalAuth) {
  const incoming = new URL(request.url);
  const path = incoming.pathname;
  const getPaths = ["/api/auth/get-session", "/api/auth/verify-email"];
  const postPaths = ["/api/auth/sign-up/email", "/api/auth/sign-in/email", "/api/auth/sign-out", "/api/auth/request-password-reset", "/api/auth/reset-password", "/api/auth/send-verification-email", "/api/auth/two-factor/enable", "/api/auth/two-factor/verify-totp", "/api/auth/two-factor/verify-backup-code"];
  // Enable reviewed browser flows only. Better Auth's remaining routes are not public contracts yet.
  if (!(request.method === "GET" && (getPaths.includes(path) || /^\/api\/auth\/reset-password\/[A-Za-z0-9_-]+$/.test(path))) && !(request.method === "POST" && postPaths.includes(path))) {
    return Response.json({ code: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  // Same Host rule as every other mutation boundary (http.ts): loopback or the opt-in tailnet origin only.
  const origin = requestOrigin(request);
  if (!origin) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  if (!["GET", "POST"].includes(request.method)) return new Response(null, { status: 405 });
  if (request.method === "POST" && request.headers.get("origin") !== origin) {
    return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  }
  const headers = new Headers(request.headers);
  // Next is bound only to 127.0.0.1. Forwarded identity supplied by a browser has no authority.
  headers.set("x-99ribu-local-ip", "127.0.0.1");
  let bodyText: string | undefined;
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
    if (body.email !== undefined && !isSyntheticEmail(body.email)) {
      return Response.json({ code: "SYNTHETIC_EMAIL_REQUIRED" }, { status: 400 });
    }
    if (path.includes("/two-factor/")) {
      const enable = path.endsWith("/enable");
      const allowed = enable ? ["password"] : ["code"];
      if (Object.keys(body).some((key) => !allowed.includes(key)) ||
          (enable ? typeof body.password !== "string" || body.password.length > 128 : typeof body.code !== "string" || body.code.length > 64)) {
        return Response.json({ code: "INVALID_INPUT" }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      if (enable) {
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
      if (typeof subject === "string" && subject)
        await rateLimit(identity.sql, `auth-account:${path}:${await mac(identity, "auth-account", [subject])}`, limit);
    } catch (error) {
      const limited = problem(error);
      const retryAfter = limited.headers.get("Retry-After");
      if (retryAfter) limited.headers.set("X-Retry-After", retryAfter);
      return limited;
    }
  }
  const canonicalURL = new URL(path + incoming.search, origin);
  const response = await identity.auth.handler(new Request(canonicalURL, { method: request.method, headers, body: bodyText }));
  if (response.ok && ["/api/auth/sign-in/email", "/api/auth/sign-out"].includes(path)) {
    try { await revokeGuestContext(request,identity,response); } catch (error) { return problem(error); }
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
