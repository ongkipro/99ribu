import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { readRuntimeConfig } from "../../config/runtime.ts";
import { AccessError } from "./policy.ts";

// The caller's address for per-client budgets. Locally every request arrives over loopback. In production
// only the configured trusted-proxy header counts (never X-Forwarded-For); a missing or malformed value means
// the request did not come through that proxy, so it is refused instead of sharing one bucket.
export function clientIp(request: Request) {
  const config = readRuntimeConfig(process.env);
  if (config.profile !== "production") return "127.0.0.1";
  const value = request.headers.get(config.clientIpHeader)?.trim() ?? "";
  if (!isIP(value)) throw new AccessError(503, "CLIENT_IP_UNAVAILABLE");
  return value;
}

// Budget key for a client address: IPv4 as is, IPv6 by its /64 (one end site; Better Auth's default ipv6Subnet),
// so rotating addresses inside one prefix share a bucket. IPv4-mapped IPv6 counts as the IPv4 address.
export function addressBucket(ip: string) {
  if (isIP(ip) !== 6) return ip;
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return mapped[1];
  const [head, tail] = lower.split("::");
  const parts = (value: string | undefined) => (value ? value.split(":") : []).flatMap((group) => {
    if (!group.includes(".")) return [group];
    const [a, b, c, d] = group.split(".").map(Number);
    return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
  });
  const left = parts(head), right = tail === undefined ? [] : parts(tail);
  const groups = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return `${groups.slice(0, 4).map((group) => Number.parseInt(group, 16).toString(16)).join(":")}::/64`;
}

export function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
export function problem(error: unknown) {
  const known = error instanceof AccessError;
  const status = known ? error.status : 503;
  const headers = new Headers({ "Content-Type": "application/problem+json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  if (known && error.retryAfter) headers.set("Retry-After", String(error.retryAfter));
  const requestId = randomUUID();
  // Redacted by design: messages/stacks can carry buyer fields or SQL values (spec 16), so log only class and SQLSTATE.
  if (!known) console.error(JSON.stringify({ event: "http.unexpected_error", request_id: requestId,
    error: error instanceof Error ? error.name : typeof error,
    sqlstate: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : undefined }));
  return new Response(JSON.stringify({ type: "about:blank", title: known ? error.code : "SERVICE_UNAVAILABLE", status,
    code: known ? error.code : "SERVICE_UNAVAILABLE", request_id: requestId }),
  { status, headers });
}
// The browser origin a request arrived through, or null. Next builds request.url from its own
// loopback listener (NextURL normalizes 127.0.0.1 to localhost, accepted only with an actual Host),
// so the browser-visible origin is the exact Host header: the loopback host, or the opt-in tailnet
// IP:port that `tailscale serve --tcp` forwards unchanged. Any other Host (DNS rebinding, aliases) is refused.
export function requestOrigin(request: Request) {
  const config = readRuntimeConfig(process.env);
  const { origin, tailnetOrigin } = config;
  // Production: Next sits behind the one trusted proxy, so request.url's scheme is not the browser's.
  // The Host the proxy forwards must be exactly the configured origin's host; anything else is refused.
  if (config.profile === "production") return request.headers.get("host") === new URL(origin).host ? origin : null;
  const incoming = new URL(request.url).origin;
  if (!request.headers.has("host")) return incoming === origin ? origin : null;
  if (incoming !== origin && incoming !== "http://localhost:3099") return null;
  const host = request.headers.get("host");
  if (host === new URL(origin).host) return origin;
  return tailnetOrigin && host === new URL(tailnetOrigin).host ? tailnetOrigin : null;
}
export function assertOrigin(request: Request) {
  const origin = requestOrigin(request);
  if (!origin || (request.method !== "GET" && request.headers.get("origin") !== origin)) throw new AccessError(403, "INVALID_ORIGIN");
  return origin;
}
export async function readBody(request: Request, maxBytes: 16384 | 32768 = 16384): Promise<Record<string, unknown>> {
  if (maxBytes !== 16384 && maxBytes !== 32768) throw new AccessError(500, "INVALID_BODY_LIMIT");
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") throw new AccessError(415, "INVALID_INPUT");
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError(400, "INVALID_INPUT");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.length;
    if (size > maxBytes) { await reader.cancel(); throw new AccessError(413, "BODY_TOO_LARGE"); }
    chunks.push(chunk.value);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new AccessError(400, "INVALID_INPUT"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccessError(400, "INVALID_INPUT");
  return value as Record<string, unknown>;
}
