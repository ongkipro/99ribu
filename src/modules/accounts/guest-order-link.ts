import { randomBytes, randomUUID } from "node:crypto";
import type { LocalAuth } from "../access/auth.ts";
import { privateJson, readBody } from "../access/http.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { LIMITS, rateLimit } from "../access/rate-limit.ts";
import { id, invalid, object, text } from "../catalog/validation.ts";
import { intentHash, mutationKey } from "../checkout/carts.ts";
import { challengeVerificationCode, challengeDigest, reserveChallengeAttempt, ensureBuyerProfile, checkIdempotency, saveIdempotency, normalizeContactReference, findOrderContactMatch } from "./shared.ts";

export async function handleGuestOrderLinkRoutes(
	request: Request,
	identity: LocalAuth,
	url: URL,
	principal: Principal,
): Promise<Response | undefined> {
	// 8. Guest order link challenges: POST /api/v1/me/guest-order-link-challenges(/[challengeId]/verifications)
	const orderLinkMatch =
		/^\/api\/v1\/me\/guest-order-link-challenges(?:\/([^/]+)\/verifications)?$/.exec(
			url.pathname,
		);
	if (orderLinkMatch) {
		if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
		const key = mutationKey(request);
		const challengeIdParam = orderLinkMatch[1];
		if (!challengeIdParam) {
			const body = object(await readBody(request), ["order_id", "contact"]);
			const orderId = id(body.order_id);
			const contact = normalizeContactReference(body.contact);
			const hash = await intentHash(
				identity,
				"buyer.guest_order_link.challenge",
				{ orderId, contact },
			);
			await rateLimit(
				identity.sql,
				`buyer-challenge-user:${principal.id}`,
				LIMITS.buyerChallengePerUser,
			);
			// Signed-in callers are bounded per user; the order budget is shared with the public order_id path
			// (the public order_number path has its own per-number bucket).
			await rateLimit(
				identity.sql,
				`guest-access-challenge-order:${orderId}`,
				LIMITS.guestAccessChallengePerOrder,
			);
			const challenge = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<{
					challenge_id: string;
					expires_at: string;
				}>(tx, principal.id, "buyer.guest_order_link.challenge", key, hash);
				if (prior) return prior;
				await ensureBuyerProfile(tx, principal, false);
				// S120: enumeration-safe like the public guest-order-access path. An unknown order or a contact that does
				// not match gets the same 201 with a decoy challenge (no order, digest of a random code nobody receives),
				// which then fails verification exactly like a real challenge given a wrong code.
				const order = await findOrderContactMatch(tx, { id: orderId }, contact);
				const challengeId = randomUUID();
				// Same work either way (both values are always computed); only a match digests the deliverable code.
				const code = await challengeVerificationCode(identity, challengeId);
				const decoy = randomBytes(32).toString("base64url");
				const codeHash = await challengeDigest(identity, challengeId, order ? code : decoy);
				const [inserted] = await tx<{ id: string; expires_at: string }[]>`
					insert into app.buyer_identity_challenge (
						id,
						user_id,
						kind,
						channel,
						target_value,
						order_id,
						code_digest,
						status,
						expires_at
					)
					values (
						${challengeId},
						${principal.id},
						'guest_order_link',
						${contact.channel},
						${contact.value},
						${order?.id ?? null},
						${codeHash},
						'pending',
						clock_timestamp() + interval '15 minutes'
					)
					returning id, expires_at
				`;
				const response = {
					challenge_id: String(inserted.id),
					expires_at: new Date(inserted.expires_at).toISOString(),
				};
				return saveIdempotency(
					tx,
					principal.id,
					"buyer.guest_order_link.challenge",
					key,
					hash,
					challengeId,
					"Issued guest order link challenge",
					response,
					{ challenge_id: challengeId, order_id: orderId },
				);
			});
			return privateJson(challenge, 201);
		}

		// Verify guest order link challenge
		const challengeId = id(challengeIdParam);
		const body = object(await readBody(request), ["code"]);
		const code = text(body.code, 12).trim();
		if (code.length < 4) throw invalid();
		const hash = await intentHash(identity, "buyer.guest_order_link.verify", {
			challengeId,
			code,
		});
		const [challengeRow] = await identity.sql<
			{
				id: string;
				order_id: string | null;
				code_digest: string;
				attempts: number;
				status: string;
				expires_at: string;
			}[]
		>`
			select id, order_id, code_digest, attempts, status, expires_at
			from app.buyer_identity_challenge
			where id = ${challengeId} and user_id = ${principal.id} and kind = 'guest_order_link'
		`;
		// A decoy (order_id null) is answered like a pending challenge with a wrong code; only a missing row is 404.
		if (!challengeRow) {
			throw new AccessError(404, "NOT_FOUND");
		}
		const expectedDigest = await challengeDigest(identity, challengeId, code);
		if (challengeRow.status === "pending") {
			await rateLimit(
				identity.sql,
				`buyer-verify-user:${principal.id}`,
				LIMITS.buyerVerifyPerUser,
			);
			const attempts = await reserveChallengeAttempt(
				identity,
				"buyer_identity_challenge",
				challengeId,
			);
			const matches = challengeRow.code_digest === expectedDigest;
			if (attempts === null || (!matches && attempts >= 5)) {
				await identity.sql`
					update app.buyer_identity_challenge
					set status = 'expired'
					where id = ${challengeId} and status = 'pending'
				`;
			}
			if (attempts === null) {
				throw new AccessError(409, "CHALLENGE_EXPIRED");
			}
			if (!matches) throw new AccessError(403, "INVALID_CHALLENGE_CODE");
		}

		const ack = await identity.sql.begin(async (tx) => {
			const prior = await checkIdempotency<{
				id: string;
				version: number;
				status: string;
				as_of: string;
			}>(tx, principal.id, "buyer.guest_order_link.verify", key, hash);
			if (prior) return prior;
			const [locked] = await tx<
				{ id: string; order_id: string; status: string }[]
			>`
				select id, order_id, status
				from app.buyer_identity_challenge
				where id = ${challengeId} and user_id = ${principal.id} and kind = 'guest_order_link'
				for update
			`;
			if (locked?.status !== "pending") {
				throw new AccessError(409, "CHALLENGE_ALREADY_USED");
			}
			// Unreachable for a decoy (its digest matches no code); kept so a decoy can never link anything.
			if (!locked.order_id) throw new AccessError(403, "INVALID_CHALLENGE_CODE");
			const [verified] = await tx<{ verified_at: string }[]>`
				update app.buyer_identity_challenge
				set status = 'verified', verified_at = clock_timestamp()
				where id = ${challengeId}
				returning verified_at
			`;
			const response = {
				id: String(locked.order_id),
				version: 1,
				status: "linked",
				as_of: new Date(verified.verified_at).toISOString(),
			};
			return saveIdempotency(
				tx,
				principal.id,
				"buyer.guest_order_link.verify",
				key,
				hash,
				String(locked.order_id),
				"Linked guest order to buyer account after contact verification",
				response,
			);
		});
		return privateJson(ack, 201);
	}
}
