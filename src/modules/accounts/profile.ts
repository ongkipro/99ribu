import type { LocalAuth } from "../access/auth.ts";
import { privateJson, readBody } from "../access/http.ts";
import { AccessError, isStaff, type Principal } from "../access/policy.ts";
import { recordAuthAudit } from "../access/account-security.ts";
import { consumeAccessProof } from "../access/grants.ts";
import { LIMITS, rateLimit } from "../access/rate-limit.ts";
import { integer, invalid, object, text } from "../catalog/validation.ts";
import { intentHash, mutationKey } from "../checkout/carts.ts";
import { normalizeWhatsApp } from "../shipping/address.ts";
import { type BuyerProfileResponse, ensureBuyerProfile, formatBuyerProfile, checkIdempotency, saveIdempotency, withdrawConsentOnContactChange, normalizeEmailValue } from "./shared.ts";

export async function handleBuyerProfileRoutes(
	request: Request,
	identity: LocalAuth,
	url: URL,
	principal: Principal,
): Promise<Response | undefined> {
	// 3. Buyer profile: GET / POST /api/v1/me/profile
	if (url.pathname === "/api/v1/me/profile") {
		if (request.method === "GET") {
			if (url.search) throw invalid();
			const profile = await identity.sql.begin(async (tx) => {
				const row = await ensureBuyerProfile(tx, principal, false);
				return formatBuyerProfile(row);
			});
			return privateJson(profile, 200);
		}
		if (request.method === "POST") {
			const key = mutationKey(request);
			const body = object(await readBody(request), [
				"expected_version",
				"display_name",
				"email",
				"phone",
			]);
			const expectedVersion = integer(body.expected_version, 1, 2147483647);
			const displayName = text(body.display_name, 120).trim();
			if (!displayName) throw invalid();
			const optionalEmail =
				body.email === undefined
					? undefined
					: body.email === null || String(body.email).trim() === ""
						? null
						: normalizeEmailValue(body.email);
			// S123: the WhatsApp contact number (unverified: phone_verified_at stays null on a change; a
			// verified login contact still changes only through contact-change challenges). Stored E.164.
			const optionalPhone =
				body.phone === undefined
					? undefined
					: body.phone === null || String(body.phone).trim() === ""
						? null
						: normalizeWhatsApp(body.phone);
			const hash = await intentHash(identity, "buyer.profile.update", {
				expectedVersion,
				displayName,
				...(optionalEmail !== undefined ? { email: optionalEmail } : {}),
				...(optionalPhone !== undefined ? { phone: optionalPhone } : {}),
			});
			const updated = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<BuyerProfileResponse>(
					tx,
					principal.id,
					"buyer.profile.update",
					key,
					hash,
				);
				if (prior) return prior;
				const current = await ensureBuyerProfile(tx, principal, true);
				if (Number(current.revision) !== expectedVersion) {
					throw new AccessError(409, "PROFILE_VERSION_CONFLICT");
				}
				const nextEmail =
					optionalEmail === undefined ? current.email : optionalEmail;
				const nextPhone =
					optionalPhone === undefined ? current.phone : optionalPhone;
				// A verified phone changes or clears only through a contact-change challenge: this plain edit
				// would downgrade it to unverified and skip the reauthentication the support contact rebind
				// requires for a verified contact (S123 review).
				if (current.phone_verified_at && nextPhone !== current.phone) {
					throw new AccessError(409, "VERIFIED_PHONE_LOCKED");
				}
				await withdrawConsentOnContactChange(tx, principal.id, "whatsapp", nextPhone);
				await withdrawConsentOnContactChange(tx, principal.id, "email", nextEmail);
				await tx`
					update app.buyer_profile
					set
						display_name = ${displayName},
						email = ${nextEmail},
						phone = ${nextPhone},
						phone_verified_at = ${nextPhone === current.phone ? current.phone_verified_at : null},
						revision = revision + 1,
						updated_at = clock_timestamp()
					where user_id = ${principal.id}
				`;
				await tx`
					update app.auth_user
					set name = ${displayName}, updated_at = clock_timestamp()
					where id = ${principal.id}
				`;
				const reloaded = await ensureBuyerProfile(tx, principal, false);
				const response = formatBuyerProfile(reloaded);
				return saveIdempotency(
					tx,
					principal.id,
					"buyer.profile.update",
					key,
					hash,
					principal.id,
					"Updated buyer profile",
					response,
				);
			});
			return privateJson(updated, 201);
		}
		throw new AccessError(404, "NOT_FOUND");
	}
}

export async function handleSessionTerminationRoutes(
	request: Request,
	identity: LocalAuth,
	url: URL,
	principal: Principal,
): Promise<Response | undefined> {
	// 11. Session terminations: POST /api/v1/me/session-terminations (OpenAPI SessionTerminationInput, S129).
	// `current` ends this session; `all_other` ends every other session of the same account and needs a
	// single-use `session.terminate_others` proof (password reauthentication) bound to this session and user.
	if (url.pathname === "/api/v1/me/session-terminations") {
		if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
		const key = mutationKey(request);
		const body = object(await readBody(request), ["scope", "reauthentication_proof"]);
		if (body.scope !== "current" && body.scope !== "all_other") {
			throw invalid();
		}
		const scope = body.scope;
		let proof: string | null = null;
		if (scope === "all_other") {
			// A missing proof is a refusal of authority (403), not a malformed request.
			if (body.reauthentication_proof === undefined) {
				throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
			}
			proof = text(body.reauthentication_proof, 2000);
			if (proof.length < 16) throw invalid();
		}
		await rateLimit(
			identity.sql,
			`session-terminate:${principal.id}`,
			LIMITS.sessionTerminationPerUser,
		);
		// The proof is an authentication factor, not part of the retry intent.
		const hash = await intentHash(identity, "auth.sessions.terminate", {
			scope,
		});
		let ack: {
			id: string;
			version: number;
			status: string;
			as_of: string;
		};
		try {
			ack = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<{
					id: string;
					version: number;
					status: string;
					as_of: string;
				}>(tx, principal.id, "auth.sessions.terminate", key, hash);
				if (prior) return prior;
				let revoked: number;
				if (scope === "all_other") {
					await consumeAccessProof(
						tx,
						principal,
						"session.terminate_others",
						principal.id,
						proof as string,
					);
					revoked = (
						await tx`
							delete from app.auth_session
							where user_id = ${principal.id} and id <> ${principal.sessionId}
							returning id
						`
					).length;
				} else {
					revoked = (
						await tx`
							delete from app.auth_session
							where user_id = ${principal.id} and id = ${principal.sessionId}
							returning id
						`
					).length;
				}
				const [clock] = await tx<{ now: string }[]>`
					select clock_timestamp()::text as now
				`;
				const response = {
					id: principal.id,
					version: 1,
					status: "confirmed",
					as_of: new Date(clock.now).toISOString(),
				};
				return saveIdempotency(
					tx,
					principal.id,
					"auth.sessions.terminate",
					key,
					hash,
					principal.id,
					`own_sessions_terminated:${scope}`,
					response,
					{ scope, revoked_sessions: revoked },
				);
			});
		} catch (error) {
			// A refused step-up on a staff account is evidence worth keeping; buyers' refusals are not stored.
			if (
				error instanceof AccessError &&
				error.code === "REAUTHENTICATION_REQUIRED" &&
				isStaff(principal)
			) {
				await recordAuthAudit(identity.sql, {
					actorId: principal.id,
					action: "auth.sessions.terminate",
					outcome: "denied",
					reason: error.code,
					details: { scope },
				});
			}
			throw error;
		}
		return privateJson(ack, 201);
	}
}
