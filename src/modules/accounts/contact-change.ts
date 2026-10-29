import { randomUUID } from "node:crypto";
import type { LocalAuth } from "../access/auth.ts";
import { privateJson, readBody } from "../access/http.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { LIMITS, rateLimit } from "../access/rate-limit.ts";
import { id, integer, invalid, object, text } from "../catalog/validation.ts";
import { intentHash, mutationKey } from "../checkout/carts.ts";
import { normalizeIndonesianPhone, type BuyerProfileResponse, challengeVerificationCode, challengeDigest, reserveChallengeAttempt, ensureBuyerProfile, formatBuyerProfile, checkIdempotency, saveIdempotency, withdrawConsentOnContactChange, normalizeEmailValue } from "./shared.ts";

export async function handleContactChangeRoutes(
	request: Request,
	identity: LocalAuth,
	url: URL,
	principal: Principal,
): Promise<Response | undefined> {
	// 7. Contact change challenges: POST /api/v1/me/contact-change-challenges(/[challengeId]/verifications)
	const contactChallengeMatch =
		/^\/api\/v1\/me\/contact-change-challenges(?:\/([^/]+)\/verifications)?$/.exec(
			url.pathname,
		);
	if (contactChallengeMatch) {
		if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
		const key = mutationKey(request);
		const challengeIdParam = contactChallengeMatch[1];
		if (!challengeIdParam) {
			const body = object(await readBody(request), ["channel", "new_value"]);
			if (body.channel !== "phone" && body.channel !== "email") {
				throw invalid();
			}
			const channel = body.channel;
			const targetValue =
				channel === "phone"
					? normalizeIndonesianPhone(body.new_value)
					: normalizeEmailValue(body.new_value);
			const hash = await intentHash(
				identity,
				"buyer.contact_change.challenge",
				{ channel, targetValue },
			);
			await rateLimit(
				identity.sql,
				`buyer-challenge-user:${principal.id}`,
				LIMITS.buyerChallengePerUser,
			);
			const challenge = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<{
					challenge_id: string;
					expires_at: string;
				}>(tx, principal.id, "buyer.contact_change.challenge", key, hash);
				if (prior) return prior;
				await ensureBuyerProfile(tx, principal, false);
				const challengeId = randomUUID();
				const code = await challengeVerificationCode(identity, challengeId);
				const codeHash = await challengeDigest(identity, challengeId, code);
				const [inserted] = await tx<{ id: string; expires_at: string }[]>`
					insert into app.buyer_identity_challenge (
						id,
						user_id,
						kind,
						channel,
						target_value,
						code_digest,
						status,
						expires_at
					)
					values (
						${challengeId},
						${principal.id},
						'contact_change',
						${channel},
						${targetValue},
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
					"buyer.contact_change.challenge",
					key,
					hash,
					challengeId,
					"Issued buyer contact change challenge",
					response,
					{ challenge_id: challengeId, channel, targetValue },
				);
			});
			return privateJson(challenge, 201);
		}

		// Verify contact change challenge
		const challengeId = id(challengeIdParam);
		const body = object(await readBody(request), [
			"code",
			"expected_version",
		]);
		const code = text(body.code, 12).trim();
		if (code.length < 4) throw invalid();
		const expectedVersion = integer(body.expected_version, 1, 2147483647);
		const hash = await intentHash(identity, "buyer.contact_change.verify", {
			challengeId,
			code,
			expectedVersion,
		});

		const [challengeRow] = await identity.sql<
			{
				id: string;
				channel: "phone" | "email";
				target_value: string;
				code_digest: string;
				attempts: number;
				status: string;
				expires_at: string;
			}[]
		>`
			select id, channel, target_value, code_digest, attempts, status, expires_at
			from app.buyer_identity_challenge
			where id = ${challengeId} and user_id = ${principal.id} and kind = 'contact_change'
		`;
		if (!challengeRow) throw new AccessError(404, "NOT_FOUND");
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

		const updatedProfile = await identity.sql.begin(async (tx) => {
			const prior = await checkIdempotency<BuyerProfileResponse>(
				tx,
				principal.id,
				"buyer.contact_change.verify",
				key,
				hash,
			);
			if (prior) return prior;
			const currentProfile = await ensureBuyerProfile(tx, principal, true);
			if (Number(currentProfile.revision) !== expectedVersion) {
				throw new AccessError(409, "PROFILE_VERSION_CONFLICT");
			}
			const [lockedChallenge] = await tx<
				{
					id: string;
					channel: "phone" | "email";
					target_value: string;
					status: string;
				}[]
			>`
				select id, channel, target_value, status
				from app.buyer_identity_challenge
				where id = ${challengeId} and user_id = ${principal.id} and kind = 'contact_change'
				for update
			`;
			if (lockedChallenge?.status !== "pending") {
				throw new AccessError(409, "CHALLENGE_ALREADY_USED");
			}
			await tx`
				update app.buyer_identity_challenge
				set status = 'verified', verified_at = clock_timestamp()
				where id = ${challengeId}
			`;
			if (lockedChallenge.channel === "phone") {
				await withdrawConsentOnContactChange(tx, principal.id, "whatsapp", lockedChallenge.target_value);
				await tx`
					update app.buyer_profile
					set
						phone = ${lockedChallenge.target_value},
						phone_verified_at = clock_timestamp(),
						revision = revision + 1,
						updated_at = clock_timestamp()
					where user_id = ${principal.id}
				`;
			} else {
				const [dup] = await tx<{ id: string }[]>`
					select id from app.auth_user
					where lower(email) = lower(${lockedChallenge.target_value})
						and id <> ${principal.id}
				`;
				if (dup) throw new AccessError(409, "EMAIL_ALREADY_IN_USE");
				await withdrawConsentOnContactChange(tx, principal.id, "email", lockedChallenge.target_value);
				await tx`
					update app.auth_user
					set email = ${lockedChallenge.target_value}, email_verified = true, updated_at = clock_timestamp()
					where id = ${principal.id}
				`;
				await tx`
					update app.buyer_profile
					set
						email = ${lockedChallenge.target_value},
						revision = revision + 1,
						updated_at = clock_timestamp()
					where user_id = ${principal.id}
				`;
			}
			const reloaded = await ensureBuyerProfile(tx, principal, false);
			const response = formatBuyerProfile(reloaded);
			return saveIdempotency(
				tx,
				principal.id,
				"buyer.contact_change.verify",
				key,
				hash,
				principal.id,
				"Verified buyer contact change challenge",
				response,
			);
		});
		return privateJson(updatedProfile, 201);
	}
}
