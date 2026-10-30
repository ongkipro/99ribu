import { randomBytes, randomUUID } from "node:crypto";
import { appOrigin, readRuntimeConfig } from "../../config/runtime.ts";
import type { LocalAuth } from "../access/auth.ts";
import { addressBucket, clientIp, privateJson, readBody, requestOrigin } from "../access/http.ts";
import { AccessError } from "../access/policy.ts";
import { LIMITS, rateLimit } from "../access/rate-limit.ts";
import { id, invalid, object, text } from "../catalog/validation.ts";
import { digest, prefix, setCookie } from "../checkout/access.ts";
import { intentHash, mutationKey } from "../checkout/carts.ts";
import { challengeVerificationCode, challengeDigest, reserveChallengeAttempt, checkIdempotency, saveIdempotency, normalizeContactReference, findOrderContactMatch } from "./shared.ts";

export async function handleGuestOrderAccessRoutes(
	request: Request,
	identity: LocalAuth,
	url: URL,
): Promise<Response | undefined> {
	// 1. Public guest-order-access challenge & verification
	if (url.pathname === "/api/v1/guest-order-access/challenges") {
		if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
		const key = mutationKey(request);
		const body = object(await readBody(request), ["order_number", "order_id", "tracking_number", "contact"]);
		// The contract field is `order_number` (what the buyer holds); `order_id` stays for callers
		// that already have the UUID; `tracking_number` (owner 2026-10-30) is a parcel's resi. Exactly one of them,
		// and the contact must still match the order (the same decoy, budgets and code as an order number).
		if ([body.order_number, body.order_id, body.tracking_number].filter((value) => value !== undefined).length !== 1) throw invalid();
		const orderNumber =
			body.order_number === undefined ? null : text(body.order_number, 19).toUpperCase();
		if (orderNumber !== null && !/^99-[A-Z0-9]{16}$/.test(orderNumber)) throw invalid();
		const trackingNumber =
			body.tracking_number === undefined ? null : text(body.tracking_number, 64).replace(/\s+/g, "").toUpperCase();
		if (trackingNumber !== null && !/^[A-Z0-9][A-Z0-9-]{5,63}$/.test(trackingNumber)) throw invalid();
		const orderRef =
			orderNumber !== null ? `n:${digest(orderNumber)}` : trackingNumber !== null ? `t:${digest(trackingNumber)}` : id(body.order_id);
		const contact = normalizeContactReference(body.contact);
		const hash = await intentHash(identity, "guest_order_access.challenge", {
			orderRef,
			contact,
		});
		const actorKey = `guest_access:${orderRef}`;
		// Counted in autocommit before any lookup, so known and unknown orders spend the same budget.
		// Every request commits a challenge row (decoys included), so attacker-rotated order/contact
		// pairs are also bounded per client (production, behind the trusted proxy) and globally.
		if (readRuntimeConfig(process.env).profile === "production") {
			await rateLimit(
				identity.sql,
				`guest-access-challenge-ip:${addressBucket(clientIp(request))}`,
				[20, 60_000],
			);
		}
		await rateLimit(identity.sql, "guest-access-challenge-global", [300, 60_000]);
		await rateLimit(
			identity.sql,
			`guest-access-challenge-order:${orderRef}`,
			LIMITS.guestAccessChallengePerOrder,
		);
		await rateLimit(
			identity.sql,
			`guest-access-challenge-contact:${digest(`${contact.channel}:${contact.value}`)}`,
			LIMITS.guestAccessChallengePerContact,
		);
		const result = await identity.sql.begin(async (tx) => {
			const prior = await checkIdempotency<{
				challenge_id: string;
				expires_at: string;
			}>(tx, actorKey, "guest_order_access.challenge", key, hash);
			if (prior) return prior;
			const order = await findOrderContactMatch(
				tx,
				orderNumber !== null ? { number: orderNumber } : trackingNumber !== null ? { tracking: trackingNumber } : { id: orderRef },
				contact,
			);
			// Enumeration-safe: an unknown order or a contact that does not match gets the same 202
			// with a decoy challenge (no order, random digest) that no code can verify.
			const challengeId = randomUUID();
			// Same HMAC work either way; a decoy digests a random code nobody receives.
			const codeHash = await challengeDigest(
				identity,
				challengeId,
				order
					? await challengeVerificationCode(identity, challengeId)
					: randomBytes(32).toString("base64url"),
			);
			const [inserted] = await tx<{ id: string; expires_at: string }[]>`
				insert into app.support_challenge (
					id,
					kind,
					actor_scope,
					target_reference,
					order_id,
					code_digest,
					expires_at
				)
				values (
					${challengeId},
					'guest_order_access',
					${order ? `guest:${order.owner_guest_id ?? order.id}` : "guest:unmatched"},
					${orderRef},
					${order?.id ?? null},
					${codeHash},
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
				actorKey,
				"guest_order_access.challenge",
				key,
				hash,
				challengeId,
				"Issued guest order access verification challenge",
				response,
				{ challenge_id: challengeId },
			);
		});
		return privateJson(result, 202);
	}

	if (url.pathname === "/api/v1/guest-order-access/verifications") {
		if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
		const key = mutationKey(request);
		const body = object(await readBody(request), ["challenge_id", "code"]);
		const challengeId = id(body.challenge_id);
		const code = text(body.code, 12).trim();
		if (code.length < 4) throw invalid();
		const hash = await intentHash(identity, "guest_order_access.verify", {
			challengeId,
			code,
		});
		const actorKey = `guest_verify:${challengeId}`;
		const [challengeRow] = await identity.sql<
			{
				id: string;
				order_id: string | null;
				target_reference: string;
				code_digest: string;
				attempts: number;
				verified_at: string | null;
				expires_at: string;
			}[]
		>`
			select id, order_id, target_reference, code_digest, attempts, verified_at, expires_at
			from app.support_challenge
			where id = ${challengeId} and kind = 'guest_order_access'
		`;
		if (!challengeRow) {
			throw new AccessError(404, "NOT_FOUND");
		}
		const expectedDigest = await challengeDigest(identity, challengeId, code);
		if (!challengeRow.verified_at) {
			// Keyed on the reference the challenge was requested with (target_reference until verified), so a
			// decoy and a real challenge for the same number share one bucket and answer alike.
			await rateLimit(
				identity.sql,
				`guest-access-verify-order:${challengeRow.target_reference}`,
				LIMITS.guestAccessVerifyPerOrder,
			);
			const attempts = await reserveChallengeAttempt(
				identity,
				"support_challenge",
				challengeId,
			);
			if (attempts === null) {
				throw new AccessError(409, "CHALLENGE_EXPIRED");
			}
			if (!challengeRow.order_id || challengeRow.code_digest !== expectedDigest) {
				throw new AccessError(403, "INVALID_CHALLENGE_CODE");
			}
		}
		const result = await identity.sql.begin(async (tx) => {
			const prior = await checkIdempotency<{
				order_id: string;
				order_access_token: string;
				expires_at: string;
			}>(tx, actorKey, "guest_order_access.verify", key, hash);
			if (prior) return prior;
			const [locked] = await tx<
				{
					id: string;
					order_id: string;
					verified_at: string | null;
					expires_at: string;
				}[]
			>`
				select id, order_id, verified_at, expires_at
				from app.support_challenge
				where id = ${challengeId} and kind = 'guest_order_access'
				for update
			`;
			if (!locked || locked.verified_at) {
				throw new AccessError(409, "CHALLENGE_ALREADY_USED");
			}
			const token = `ord_${randomBytes(24).toString("base64url")}`;
			const tokenDigest = digest(`order-access:${token}`);
			const [updated] = await tx<{ order_id: string; expires_at: string }[]>`
				update app.support_challenge
				set
					verified_at = clock_timestamp(),
					target_reference = ${tokenDigest},
					expires_at = clock_timestamp() + interval '7 days'
				where id = ${challengeId}
				returning order_id, expires_at
			`;
			const response = {
				order_id: String(updated.order_id),
				order_access_token: token,
				expires_at: new Date(updated.expires_at).toISOString(),
			};
			return saveIdempotency(
				tx,
				actorKey,
				"guest_order_access.verify",
				key,
				hash,
				String(updated.order_id),
				"Verified guest order access challenge",
				response,
			);
		});
		const res = privateJson(result, 201);
		// `__Host-` requires Secure, which browsers refuse on the plain-http tailnet IP. Only a request
		// through the validated opt-in tailnet origin gets the host-only, HttpOnly, Lax capability cookie
		// that receipt.ts already accepts; loopback keeps the prefixed cookie.
		if (requestOrigin(request) === appOrigin()) {
			res.headers.append(
				"set-cookie",
				`__Host-99ribu_order=${result.order_access_token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
			);
		} else {
			setCookie(res, `${await prefix(identity)}.guest_order_access`, result.order_access_token);
		}
		return res;
	}
}
