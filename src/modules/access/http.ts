import { randomUUID } from "node:crypto";
import { readLocalConfig } from "../../config/local.ts";
import { AccessError } from "./policy.ts";

export function privateJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
export function problem(error: unknown) {
  const known = error instanceof AccessError;
  const status = known ? error.status : 503;
  const headers = new Headers({ "Content-Type": "application/problem+json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
  if (known && error.retryAfter) headers.set("Retry-After", String(error.retryAfter));
  return new Response(JSON.stringify({ type: "about:blank", title: known ? error.code : "SERVICE_UNAVAILABLE", status,
    code: known ? error.code : "SERVICE_UNAVAILABLE", request_id: randomUUID() }),
  { status, headers });
}
export function assertOrigin(request: Request) {
  const { origin } = readLocalConfig(process.env);
  const incoming = new URL(request.url);
  const host = new URL(origin).host;
  const normalizedByNext = incoming.origin === "http://localhost:3099" && request.headers.get("host") === host;
  if ((incoming.origin !== origin && !normalizedByNext) || (request.headers.has("host") && request.headers.get("host") !== host) ||
    (request.method !== "GET" && request.headers.get("origin") !== origin)) throw new AccessError(403, "INVALID_ORIGIN");
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
