import { randomUUID } from "node:crypto";
import { readRuntimeConfig } from "../../config/runtime.ts";
import { CATALOG_MEDIA_LIMIT, catalogMediaFileName, saveCatalogMedia } from "../../storage/catalog-media.ts";
import { scanImagePayload, sniffImageContentType, webpSize } from "../../storage/media-sniff.ts";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { invalid } from "./validation.ts";

// S-P1: product photo upload for the admin product form. The browser converts the photo to WebP (inside 1080 px) before
// sending, so the server only accepts a clean WebP within the catalog media limit (the same store and checks as the
// committed catalog and the banner upload) and returns the absolute URL a product image entry needs. 20 per minute.
export async function uploadProductPhoto(request: Request, identity: LocalAuth, principal: Principal) {
	if (!principal.roles.some((role) => role === "owner" || role === "ecommerce_admin")) throw new AccessError(403, "FORBIDDEN");
	const key = request.headers.get("idempotency-key");
	if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400, "INVALID_IDEMPOTENCY_KEY");
	const now = Date.now();
	const [rate] = await identity.sql`insert into app.auth_rate_limit (id,key,count,last_request) values (${randomUUID()},${`product-photo:${principal.id}`},1,${now})
		on conflict (key) do update set count=case when app.auth_rate_limit.last_request<${now - 60000} then 1 else app.auth_rate_limit.count+1 end,
		last_request=case when app.auth_rate_limit.last_request<${now - 60000} then ${now} else app.auth_rate_limit.last_request end returning count,last_request`;
	if (rate.count > 20) throw new AccessError(429, "RATE_LIMITED", Math.max(1, Math.ceil((Number(rate.last_request) + 60000 - now) / 1000)));
	if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "image/webp") throw new AccessError(415, "UNSUPPORTED_IMAGE_TYPE");
	const declared = request.headers.get("content-length");
	if (declared !== null && (!/^\d{1,9}$/.test(declared) || Number(declared) > CATALOG_MEDIA_LIMIT)) throw new AccessError(413, "BODY_TOO_LARGE");
	const reader = request.body?.getReader();
	if (!reader) throw invalid();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
		size += chunk.value.byteLength;
		if (size > CATALOG_MEDIA_LIMIT) { await reader.cancel(); throw new AccessError(413, "BODY_TOO_LARGE"); }
		chunks.push(chunk.value);
	}
	const bytes = new Uint8Array(Buffer.concat(chunks));
	if (!bytes.byteLength) throw invalid();
	let type: string;
	try { type = sniffImageContentType(bytes); } catch { throw new AccessError(415, "UPLOAD_TYPE_MISMATCH"); }
	if (type !== "image/webp") throw new AccessError(415, "UPLOAD_TYPE_MISMATCH");
	if (scanImagePayload(bytes) !== "ready") throw new AccessError(422, "PRODUCT_PHOTO_REJECTED");
	const { width, height } = webpSize(bytes);
	if (width < 300 || height < 300) throw new AccessError(422, "PRODUCT_PHOTO_TOO_SMALL");
	const { name, created } = await saveCatalogMedia(bytes);
	const sha256 = name.slice(0, 64);
	await identity.sql`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
		values (${principal.id},'catalog.photo_upload',${sha256},'allowed','Product photo upload',${JSON.stringify({ byte_size: bytes.byteLength, width, height, created })}::jsonb)`;
	return { sha256, width, height, byte_size: bytes.byteLength, url: `${readRuntimeConfig(process.env).origin}/media/catalog/${catalogMediaFileName("", sha256)}` };
}
