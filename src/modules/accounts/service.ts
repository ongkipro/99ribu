import { createHash, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { appOrigin } from "../../config/runtime.ts";
import { sniffImageOrMp4ContentType, scanImagePayload } from "../../storage/media-sniff.ts";
import { deletePrivateArtifact, savePrivateArtifact } from "../../storage/private.ts";
import type { LocalAuth } from "../access/auth.ts";
import { assertOrigin, privateJson, problem, readBody, requestOrigin } from "../access/http.ts";
import { AccessError, getPrincipal } from "../access/policy.ts";
import { LIMITS, rateLimit } from "../access/rate-limit.ts";
import { id, integer, invalid, object, text } from "../catalog/validation.ts";
import { actorScope, commerceActor } from "../checkout/access.ts";
import { intentHash, mutationKey } from "../checkout/carts.ts";
import { authorizeOrderOrContinuity } from "../orders/receipt.ts";
import { projectBuyerReturn } from "../returns/cases.ts";
import { readUploadBytes, checkIdempotency, saveIdempotency } from "./shared.ts";
import { handleNotificationRoutes } from "./notifications.ts";
import { handleOrderHistoryRoutes } from "./workspace.ts";
import { handleGuestOrderAccessRoutes } from "./guest-order-access.ts";
import { handleBuyerProfileRoutes, handleSessionTerminationRoutes } from "./profile.ts";
import { handleAddressRoutes } from "./addresses.ts";
import { handleContactChangeRoutes } from "./contact-change.ts";
import { handleGuestOrderLinkRoutes } from "./guest-order-link.ts";

export type {
	BuyerAddressListResponse,
	BuyerAddressResponse,
	BuyerProfileResponse,
	BuyerProfileRow,
	NotificationPreferenceResponse,
	PrivateNotificationResponse,
} from "./shared.ts";
export {
	challengeVerificationCode,
	checkIdempotency,
	ensureBuyerProfile,
	saveIdempotency,
	withdrawConsentOnContactChange,
} from "./shared.ts";
export { createBuyerNotification } from "./notifications.ts";
export { readBuyerAccountWorkspace } from "./workspace.ts";

export async function handleAccounts(request: Request, identity: LocalAuth) {
	try {
		assertOrigin(request);
		if (
			["authorization", "x-cart-token", "x-order-token"].some((name) =>
				request.headers.has(name),
			)
		) {
			throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
		}
		const url = new URL(request.url);
		if (request.method !== "GET" && url.search) throw invalid();

		const guestOrderAccess = await handleGuestOrderAccessRoutes(request, identity, url);
		if (guestOrderAccess) return guestOrderAccess;

		// 2a. Return evidence bytes: PUT the upload_url returned by evidence-uploads
		const evidenceBytesMatch =
			/^\/api\/v1\/orders\/([^/]+)\/returns\/([^/]+)\/evidence-uploads\/([^/]+)$/.exec(
				url.pathname,
			);
		if (evidenceBytesMatch) {
			if (request.method !== "PUT") throw new AccessError(404, "NOT_FOUND");
			const orderId = id(evidenceBytesMatch[1]);
			const returnId = id(evidenceBytesMatch[2]);
			const uploadId = id(evidenceBytesMatch[3]);
			const actor = await commerceActor(request, identity);
			const loadGrant = async (tx: TransactionSql) => {
				const order = await authorizeOrderOrContinuity(
					tx,
					request,
					identity,
					actor,
					orderId,
				);
				const scope = actor
					? actorScope(actor)
					: `guest:${order.owner_guest_id ?? order.id}`;
				const [grant] = await tx<
					{
						id: string;
						uploader_scope: string;
						content_type: string;
						byte_size: number;
						status: string;
						live: boolean;
					}[]
				>`
					select id, uploader_scope, content_type, byte_size, status,
						expires_at > clock_timestamp() as live
					from app.return_evidence
					where id = ${uploadId} and case_id = ${returnId} and order_id = ${order.id}
					for update
				`;
				if (!grant || grant.uploader_scope !== scope) {
					throw new AccessError(404, "NOT_FOUND");
				}
				if (grant.status !== "pending_upload") {
					throw new AccessError(409, "EVIDENCE_UPLOAD_CLOSED");
				}
				if (!grant.live) throw new AccessError(409, "EVIDENCE_UPLOAD_EXPIRED");
				return grant;
			};
			const grant = await identity.sql.begin(loadGrant);
			const declaredType = request.headers
				.get("content-type")
				?.split(";", 1)[0]
				.trim()
				.toLowerCase();
			if (declaredType !== grant.content_type) {
				throw new AccessError(415, "UPLOAD_TYPE_MISMATCH");
			}
			const bytes = await readUploadBytes(request, Number(grant.byte_size));
			if (bytes.byteLength !== Number(grant.byte_size)) {
				throw new AccessError(400, "UPLOAD_SIZE_MISMATCH");
			}
			if (sniffImageOrMp4ContentType(bytes) !== grant.content_type) {
				throw new AccessError(415, "UPLOAD_TYPE_MISMATCH");
			}
			const scan = scanImagePayload(bytes);
			if (scan === "rejected") {
				await identity.sql`
					update app.return_evidence set status = 'rejected'
					where id = ${uploadId} and status = 'pending_upload'
				`;
				throw new AccessError(422, "EVIDENCE_REJECTED");
			}
			const sha256 = createHash("sha256").update(bytes).digest("hex");
			const storageKey = await savePrivateArtifact(bytes);
			try {
				const stored = await identity.sql.begin(async (tx) => {
					await loadGrant(tx);
					const [row] = await tx<
						{ id: string; status: string; byte_size: number; sha256: string }[]
					>`
						update app.return_evidence
						set storage_key = ${storageKey}, sha256 = ${sha256},
							status = ${scan === "ready" ? "uploaded" : "pending_scan"}
						where id = ${uploadId}
						returning id, status, byte_size, sha256
					`;
					return row;
				});
				return privateJson(
					{
						id: String(stored.id),
						status: stored.status,
						size_bytes: Number(stored.byte_size),
						sha256: stored.sha256,
					},
					200,
				);
			} catch (error) {
				await deletePrivateArtifact(storageKey).catch(() => undefined);
				throw error;
			}
		}

		// 2. Return evidence upload & attach routes (/api/v1/orders/[orderId]/returns/[returnId]/evidence*)
		const evidenceMatch =
			/^\/api\/v1\/orders\/([^/]+)\/returns\/([^/]+)\/(evidence-uploads|evidence-upload-sessions|evidence)$/.exec(
				url.pathname,
			);
		if (evidenceMatch) {
			if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
			const orderId = id(evidenceMatch[1]);
			const returnId = id(evidenceMatch[2]);
			const subroute = evidenceMatch[3];
			const key = mutationKey(request);
			const actor = await commerceActor(request, identity);

			if (
				subroute === "evidence-uploads" ||
				subroute === "evidence-upload-sessions"
			) {
				const body = object(await readBody(request), [
					"file_name",
					"media_type",
					"size_bytes",
				]);
				const fileName = text(body.file_name, 200).trim();
				if (!fileName) throw invalid();
				const allowedTypes = [
					"image/jpeg",
					"image/png",
					"image/webp",
					"video/mp4",
				] as const;
				if (
					typeof body.media_type !== "string" ||
					!allowedTypes.includes(
						body.media_type as (typeof allowedTypes)[number],
					)
				) {
					throw invalid();
				}
				const mediaType = body.media_type as (typeof allowedTypes)[number];
				const sizeBytes = integer(body.size_bytes, 1, 26_214_400);
				const hash = await intentHash(identity, "return.evidence.upload", {
					orderId,
					returnId,
					fileName,
					mediaType,
					sizeBytes,
				});
				const result = await identity.sql.begin(async (tx) => {
					const order = await authorizeOrderOrContinuity(
						tx,
						request,
						identity,
						actor,
						orderId,
					);
					const scope = actor
						? actorScope(actor)
						: `guest:${order.owner_guest_id ?? order.id}`;
					const prior = await checkIdempotency<{
						id: string;
						upload_url: string;
						expires_at: string;
						required_headers: Record<string, string>;
					}>(tx, scope, "return.evidence.upload", key, hash);
					if (prior) return prior;

					const [retCase] = await tx<{ id: string }[]>`
						select id from app.return_case
						where id = ${returnId} and order_id = ${order.id}
						for share
					`;
					if (!retCase) throw new AccessError(404, "NOT_FOUND");
					await rateLimit(
						tx,
						`evidence-upload:${returnId}`,
						LIMITS.evidenceUploadPerCase,
					);

					// A grant holds no bytes: storage_key/sha256 stay empty until the PUT to upload_url
					// stores sniffed, size-checked content, and attach refuses anything not 'uploaded'.
					const evidenceId = randomUUID();
					const [inserted] = await tx<{ id: string; expires_at: string }[]>`
						insert into app.return_evidence (
							id,
							case_id,
							order_id,
							uploader_scope,
							content_type,
							byte_size,
							sha256,
							storage_key,
							status,
							expires_at
						)
						values (
							${evidenceId},
							${returnId},
							${order.id},
							${scope},
							${mediaType},
							${sizeBytes},
							'',
							'',
							'pending_upload',
							clock_timestamp() + interval '30 minutes'
						)
						returning id, expires_at
					`;
					const origin = requestOrigin(request) ?? appOrigin();
					const response = {
						id: String(inserted.id),
						upload_url: `${origin}/api/v1/orders/${order.id}/returns/${returnId}/evidence-uploads/${inserted.id}`,
						expires_at: new Date(inserted.expires_at).toISOString(),
						required_headers: {
							"content-type": mediaType,
						},
					};
					return saveIdempotency(
						tx,
						scope,
						"return.evidence.upload",
						key,
						hash,
						evidenceId,
						"Prepared private return evidence upload target",
						response,
					);
				});
				return privateJson(result, 201);
			}

			// subroute === "evidence"
			const body = object(await readBody(request), [
				"upload_id",
				"expected_version",
			]);
			const uploadId = id(body.upload_id);
			const expectedVersion = integer(body.expected_version, 1, 2147483647);
			const hash = await intentHash(identity, "return.evidence.attach", {
				orderId,
				returnId,
				uploadId,
				expectedVersion,
			});
			const result = await identity.sql.begin(async (tx) => {
				const order = await authorizeOrderOrContinuity(
					tx,
					request,
					identity,
					actor,
					orderId,
				);
				const scope = actor
					? actorScope(actor)
					: `guest:${order.owner_guest_id ?? order.id}`;
				const prior = await checkIdempotency(
					tx,
					scope,
					"return.evidence.attach",
					key,
					hash,
				);
				if (prior) return prior;

				const [retCase] = await tx<{ id: string; revision: number }[]>`
					select id, revision from app.return_case
					where id = ${returnId} and order_id = ${order.id}
					for share
				`;
				if (!retCase) throw new AccessError(404, "NOT_FOUND");
				if (Number(retCase.revision) !== expectedVersion) {
					throw new AccessError(409, "RETURN_VERSION_CONFLICT");
				}
				const [evidence] = await tx<
					{
						id: string;
						status: string;
						expires_at: string;
						uploader_scope: string;
						storage_key: string;
					}[]
				>`
					select id, status, expires_at, uploader_scope, storage_key
					from app.return_evidence
					where id = ${uploadId} and case_id = ${returnId} and order_id = ${order.id}
					for update
				`;
				if (!evidence || evidence.uploader_scope !== scope) {
					throw new AccessError(404, "NOT_FOUND");
				}
				if (evidence.status !== "uploaded" || !evidence.storage_key) {
					throw new AccessError(409, "EVIDENCE_NOT_UPLOADED");
				}
				if (new Date(evidence.expires_at).getTime() <= Date.now()) {
					throw new AccessError(409, "EVIDENCE_UPLOAD_EXPIRED");
				}
				await tx`
					update app.return_evidence
					set status = 'attached'
					where id = ${uploadId}
				`;
				const projected = await projectBuyerReturn(tx, returnId);
				return saveIdempotency(
					tx,
					scope,
					"return.evidence.attach",
					key,
					hash,
					returnId,
					"Attached private return evidence to return case",
					projected,
					{ upload_id: uploadId },
				);
			});
			return privateJson(result, 201);
		}

		// All remaining /api/v1/me/* endpoints require an authenticated buyer principal
		const principal = await getPrincipal(request, identity);

		const profileResponse = await handleBuyerProfileRoutes(request, identity, url, principal);
		if (profileResponse) return profileResponse;
		const addressResponse = await handleAddressRoutes(request, identity, url, principal);
		if (addressResponse) return addressResponse;
		const contactChangeResponse = await handleContactChangeRoutes(request, identity, url, principal);
		if (contactChangeResponse) return contactChangeResponse;
		const guestOrderLinkResponse = await handleGuestOrderLinkRoutes(request, identity, url, principal);
		if (guestOrderLinkResponse) return guestOrderLinkResponse;
		const notificationResponse = await handleNotificationRoutes(request, identity, url, principal);
		if (notificationResponse) return notificationResponse;
		const sessionResponse = await handleSessionTerminationRoutes(request, identity, url, principal);
		if (sessionResponse) return sessionResponse;
		const orderHistoryResponse = await handleOrderHistoryRoutes(request, identity, url, principal);
		if (orderHistoryResponse) return orderHistoryResponse;

		throw new AccessError(404, "NOT_FOUND");
	} catch (error) {
		return problem(error);
	}
}
