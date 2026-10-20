import { revokeGuestContext } from "../checkout/access.ts";
import { readLocalConfig } from "../../config/local.ts";
import { isSyntheticEmail, type LocalAuth } from "./auth.ts";
import { getPrincipal, isStaff, projectMe, AccessError } from "./policy.ts";
import { privateJson, problem } from "./http.ts";

export async function handleAuth(request: Request, identity: LocalAuth) {
  const { origin } = readLocalConfig(process.env);
  const incoming = new URL(request.url);
  const path = incoming.pathname;
  const getPaths = ["/api/auth/get-session", "/api/auth/verify-email"];
  const postPaths = ["/api/auth/sign-up/email", "/api/auth/sign-in/email", "/api/auth/sign-out", "/api/auth/request-password-reset", "/api/auth/reset-password", "/api/auth/send-verification-email", "/api/auth/two-factor/enable", "/api/auth/two-factor/verify-totp", "/api/auth/two-factor/verify-backup-code"];
  // Enable reviewed browser flows only. Better Auth's remaining routes are not public contracts yet.
  if (!(request.method === "GET" && (getPaths.includes(path) || /^\/api\/auth\/reset-password\/[A-Za-z0-9_-]+$/.test(path))) && !(request.method === "POST" && postPaths.includes(path))) {
    return Response.json({ code: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const canonicalHost = new URL(origin).host;
  // NextURL normalizes 127.0.0.1 to localhost. Accept that internal representation
  // only when the actual Host is canonical; browser aliases stay rejected.
  const normalizedByNext = incoming.origin === "http://localhost:3099" && request.headers.get("host") === canonicalHost;
  if ((incoming.origin !== origin && !normalizedByNext) || (request.headers.has("host") && request.headers.get("host") !== canonicalHost)) {
    return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  }
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
