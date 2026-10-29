import { randomBytes, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { consumeAccessProof } from "../access/grants.ts";
import { AccessError } from "../access/policy.ts";
import { LIMITS, rateLimit } from "../access/rate-limit.ts";
import { id, integer, invalid, object, text } from "../catalog/validation.ts";
import { cookie, digest, prefix } from "../checkout/access.ts";
import { mutationKey } from "../checkout/carts.ts";
import { resolveSupportCustomer } from "./actors.ts";
import {
	checkOperation,
	saveOperation,
	supportChallengeProof,
} from "./shared.ts";

export async function createGuestSupportSession(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	value: unknown,
) {
	if (
		request.headers.has("authorization") ||
		request.headers.has("x-cart-token") ||
		request.headers.has("x-order-token")
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	const key = mutationKey(request);
	const body = object(value, ["client_request_id"]);
	const clientRequestId = text(body.client_request_id, 100);
	if (
		clientRequestId.length < 16 ||
		!/^[A-Za-z0-9_-]{16,100}$/.test(clientRequestId)
	) {
		throw invalid();
	}
	const p = await prefix(identity);
	const requestHash = digest(
		JSON.stringify({ client_request_id: clientRequestId }),
	);
	const raw = cookie(request, `${p}.support_guest`);
	const match =
		raw &&
		/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i.exec(
			raw,
		);
	if (match) {
		const [existing] = await tx<
			{ id: string; token_digest: string; expires_at: string }[]
		>`
			select id, token_digest, expires_at
			from app.guest_support_identity
			where id = ${match[1].toLowerCase()}
			for update
		`;
		const [clock] = await tx<
			{ now: string }[]
		>`select clock_timestamp() as now`;
		if (
			existing &&
			new Date(existing.expires_at) > new Date(clock.now) &&
			existing.token_digest === digest(match[2])
		) {
			const prior = await checkOperation(
				tx,
				`guest_support:${existing.id}`,
				"support.guest.session",
				key,
				requestHash,
			);
			const state = (prior as {
				status: "active";
				expires_at: string;
			} | null) ?? {
				status: "active" as const,
				expires_at: new Date(existing.expires_at).toISOString(),
			};
			await saveOperation(
				tx,
				`guest_support:${existing.id}`,
				"support.guest.session",
				key,
				requestHash,
				state,
			);
			return {
				state,
				cookieValue: `${existing.id}.${match[2]}`,
				maxAge: Math.max(
					1,
					Math.floor(
						(new Date(existing.expires_at).getTime() - Date.now()) / 1000,
					),
				),
			};
		}
	}
	let commerceGuestId: string | null = null;
	const commerceCookie = cookie(request, `${p}.commerce_guest`);
	if (commerceCookie && /^[A-Za-z0-9_-]{43}$/.test(commerceCookie)) {
		const [cg] = await tx<{ id: string }[]>`
			select id from app.commerce_guest_context
			where digest = ${digest(commerceCookie)} and revoked_at is null and expires_at > clock_timestamp()
		`;
		if (cg) commerceGuestId = cg.id;
	}
	// lazy: an anonymous first request has no stable key, so new guest identities share one
	// budget (cookie replays above are free); add a trusted network key before remote activation.
	await rateLimit(
		tx,
		"support-guest-session",
		LIMITS.guestSupportSessionGlobal,
	);
	const token = randomBytes(32).toString("base64url");
	const guestSupportId = randomUUID();
	const [created] = await tx<{ id: string; expires_at: string }[]>`
		insert into app.guest_support_identity (id, token_digest, guest_id, expires_at)
		values (${guestSupportId}, ${digest(token)}, ${commerceGuestId}, clock_timestamp() + interval '7 days')
		returning id, expires_at
	`;
	const state = {
		status: "active" as const,
		expires_at: new Date(created.expires_at).toISOString(),
	};
	await saveOperation(
		tx,
		`guest_support:${created.id}`,
		"support.guest.session",
		key,
		requestHash,
		state,
	);
	return {
		state,
		cookieValue: `${created.id}.${token}`,
		maxAge: 604800,
	};
}

function parseVerifiedContact(value: unknown): {
	kind: "email" | "phone";
	normalized: string;
} {
	const data = object(value, ["kind", "email", "phone"]);
	if (data.kind === "email") {
		if (data.phone !== undefined) throw invalid();
		const email = text(data.email, 254).toLowerCase();
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid();
		return { kind: "email", normalized: `email:${email}` };
	}
	if (data.kind === "phone") {
		if (data.email !== undefined) throw invalid();
		const phone = text(data.phone, 20);
		if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw invalid();
		return { kind: "phone", normalized: `phone:${phone}` };
	}
	throw invalid();
}

export async function requestContactBinding(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	value: unknown,
) {
	const key = mutationKey(request);
	const actor = await resolveSupportCustomer(tx, request, identity);
	const body = object(value, [
		"expected_version",
		"contact",
		"reauthentication_proof",
	]);
	const expectedVersion = integer(body.expected_version, 0);
	const contact = parseVerifiedContact(body.contact);
	let reauthenticationProof: string | null = null;
	if (expectedVersion >= 1) {
		reauthenticationProof = text(body.reauthentication_proof, 2000);
		if (reauthenticationProof.length < 16) throw invalid();
	} else if (body.reauthentication_proof !== undefined) {
		throw invalid();
	}
	const requestHash = digest(
		JSON.stringify({ expectedVersion, contact: contact.normalized }),
	);
	const prior = await checkOperation(
		tx,
		actor.scope,
		"support.contact.challenge",
		key,
		requestHash,
	);
	if (prior) return prior as { challenge_id: string; expires_at: string };
	let currentVersion = 0;
	if (actor.kind === "guest") {
		const [row] = await tx<{ contact_verified_at: string | null }[]>`
			select contact_verified_at from app.guest_support_identity where id = ${actor.id} for update
		`;
		currentVersion = row?.contact_verified_at ? 1 : 0;
	} else {
		const [row] = await tx<{ phone_verified_at: string | null }[]>`
			select phone_verified_at from app.buyer_profile where user_id = ${actor.id} for share
		`;
		currentVersion = row?.phone_verified_at ? 1 : 0;
	}
	if (expectedVersion !== currentVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	if (reauthenticationProof !== null) {
		// Replacing a verified contact requires original-identity reauthentication:
		// a session/action/subject-bound single-use proof from
		// POST /me/reauthentication-proofs. A guest support identity has no
		// password session, so no reviewed reauthentication exists; fail closed.
		if (actor.kind !== "user") {
			throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
		}
		await consumeAccessProof(
			tx,
			actor.principal,
			"support.contact_rebind",
			actor.id,
			reauthenticationProof,
		);
	}
	await rateLimit(
		tx,
		`support-challenge-actor:${actor.scope}`,
		LIMITS.supportChallengePerActor,
	);
	await rateLimit(
		tx,
		`support-challenge-contact:${digest(contact.normalized)}`,
		LIMITS.supportChallengePerContact,
	);
	const challengeId = randomUUID();
	const rawProof = await supportChallengeProof(
		identity,
		challengeId,
		"contact_binding",
		contact.normalized,
	);
	const [challenge] = await tx<{ id: string; expires_at: string }[]>`
		insert into app.support_challenge (id, kind, actor_scope, target_reference, code_digest, expires_at)
		values (${challengeId}, 'contact_binding', ${actor.scope}, ${contact.normalized}, ${digest(rawProof)}, clock_timestamp() + interval '10 minutes')
		returning id, expires_at
	`;
	const response = {
		challenge_id: challenge.id,
		expires_at: new Date(challenge.expires_at).toISOString(),
	};
	await saveOperation(
		tx,
		actor.scope,
		"support.contact.challenge",
		key,
		requestHash,
		response,
	);
	return response;
}

export async function verifyContactBinding(
	request: Request,
	identity: LocalAuth,
	challengeIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const pool = identity.sql as unknown as TransactionSql;
	const actor = await resolveSupportCustomer(pool, request, identity);
	const challengeId = id(challengeIdParam);
	const body = object(value, ["proof"]);
	const proof = text(body.proof, 2000);
	const requestHash = digest(JSON.stringify({ challengeId, proof }));
	const prior = await checkOperation(
		pool,
		actor.scope,
		"support.contact.verify",
		key,
		requestHash,
	);
	if (prior) return prior;
	// Rate limit floods and reserve one of the 5 challenge attempts on the autocommit
	// pool BEFORE opening a transaction so wrong guesses persist across 403 without
	// holding a transaction connection across nested pool queries.
	await rateLimit(
		identity.sql,
		`support-verify:${challengeId}`,
		LIMITS.supportVerifyPerChallenge,
	);
	const [existing] = await identity.sql<{ id: string }[]>`
		select id from app.support_challenge
		where id = ${challengeId} and kind = 'contact_binding' and actor_scope = ${actor.scope}
	`;
	if (!existing) throw new AccessError(404, "NOT_FOUND");
	const [challenge] = await identity.sql<
		{
			id: string;
			target_reference: string;
			code_digest: string;
		}[]
	>`
		update app.support_challenge
		set attempts = attempts + 1
		where id = ${challengeId} and kind = 'contact_binding' and actor_scope = ${actor.scope}
			and verified_at is null and attempts < 5 and expires_at > clock_timestamp()
		returning id, target_reference, code_digest
	`;
	if (!challenge) {
		throw new AccessError(409, "CHALLENGE_EXPIRED");
	}
	if (digest(proof) !== challenge.code_digest) {
		throw new AccessError(403, "INVALID_CHALLENGE_PROOF");
	}
	return identity.sql.begin(async (tx) => {
		const replay = await checkOperation(
			tx,
			actor.scope,
			"support.contact.verify",
			key,
			requestHash,
		);
		if (replay) return replay;
		const [sealed] = await tx<{ now: string }[]>`
			update app.support_challenge
			set verified_at = clock_timestamp()
			where id = ${challenge.id} and verified_at is null
			returning verified_at as now
		`;
		if (!sealed) {
			throw new AccessError(409, "CHALLENGE_EXPIRED");
		}
		const clock = sealed;
		if (actor.kind === "guest") {
			// Guest challenges are only issued at version 0 (guest replacement fails
			// closed in requestContactBinding), so a verification may only perform the
			// first binding. A second challenge staged at version 0 cannot overwrite a
			// contact verified meanwhile; the failed write rolls back the seal too.
			const [bound] = await tx`
				update app.guest_support_identity
				set contact_value = ${challenge.target_reference}, contact_verified_at = ${clock.now}
				where id = ${actor.id} and contact_verified_at is null
				returning id
			`;
			if (!bound) throw new AccessError(409, "VERSION_CONFLICT");
		}
		const response = {
			id: challenge.id,
			version: 1,
			status: "confirmed" as const,
			as_of: new Date(clock.now).toISOString(),
		};
		await saveOperation(
			tx,
			actor.scope,
			"support.contact.verify",
			key,
			requestHash,
			response,
		);
		return response;
	});
}

export async function requestRecoveryChallenge(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	value: unknown,
) {
	const key = mutationKey(request);
	const actor = await resolveSupportCustomer(tx, request, identity);
	const body = object(value, ["contact", "recovery_reference"]);
	const contact = parseVerifiedContact(body.contact);
	const recoveryRef = text(body.recovery_reference, 200);
	const requestHash = digest(
		JSON.stringify({ contact: contact.normalized, recoveryRef }),
	);
	const prior = await checkOperation(
		tx,
		actor.scope,
		"support.recovery.challenge",
		key,
		requestHash,
	);
	if (prior) return prior as { challenge_id: string; expires_at: string };
	await rateLimit(
		tx,
		`support-challenge-actor:${actor.scope}`,
		LIMITS.supportChallengePerActor,
	);
	await rateLimit(
		tx,
		`support-challenge-contact:${digest(contact.normalized)}`,
		LIMITS.supportChallengePerContact,
	);

	let matchedGuestId: string | null = null;
	let matchedConversationId: string | null = null;
	if (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			recoveryRef,
		)
	) {
		const refUuid = recoveryRef.toLowerCase();
		const [byConv] = await tx<{ guest_id: string; conv_id: string }[]>`
			select g.id as guest_id, c.id as conv_id
			from app.support_conversation c
			join app.guest_support_identity g on g.id = c.guest_support_id
			where c.id = ${refUuid}
			  and g.contact_value = ${contact.normalized}
			  and g.contact_verified_at is not null
			limit 1
		`;
		if (byConv) {
			matchedGuestId = byConv.guest_id;
			matchedConversationId = byConv.conv_id;
		} else {
			const [byGuest] = await tx<{ id: string }[]>`
				select id from app.guest_support_identity
				where id = ${refUuid}
				  and contact_value = ${contact.normalized}
				  and contact_verified_at is not null
				limit 1
			`;
			if (byGuest) matchedGuestId = byGuest.id;
		}
	}
	const challengeId = randomUUID();
	const targetRef = matchedGuestId ?? "unmatched";
	const codeDigest = matchedGuestId
		? digest(
				await supportChallengeProof(
					identity,
					challengeId,
					"session_recovery",
					matchedGuestId,
				),
			)
		: "unmatched";
	const [challenge] = await tx<{ id: string; expires_at: string }[]>`
		insert into app.support_challenge (id, kind, actor_scope, target_reference, conversation_id, code_digest, expires_at)
		values (${challengeId}, 'session_recovery', ${actor.scope}, ${targetRef}, ${matchedConversationId}, ${codeDigest}, clock_timestamp() + interval '10 minutes')
		returning id, expires_at
	`;
	const response = {
		challenge_id: challenge.id,
		expires_at: new Date(challenge.expires_at).toISOString(),
	};
	await saveOperation(
		tx,
		actor.scope,
		"support.recovery.challenge",
		key,
		requestHash,
		response,
	);
	return response;
}

export async function verifyRecoveryChallenge(
	request: Request,
	identity: LocalAuth,
	challengeIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const pool = identity.sql as unknown as TransactionSql;
	const actor = await resolveSupportCustomer(pool, request, identity);
	const challengeId = id(challengeIdParam);
	const body = object(value, ["proof"]);
	const proof = text(body.proof, 2000);
	const requestHash = digest(JSON.stringify({ challengeId, proof }));
	const prior = await checkOperation(
		pool,
		actor.scope,
		"support.recovery.verify",
		key,
		requestHash,
	);
	if (prior) {
		return {
			state: prior as { status: "active"; expires_at: string },
			rotatedCookie: null as string | null,
		};
	}
	await rateLimit(
		identity.sql,
		`support-verify:${challengeId}`,
		LIMITS.supportVerifyPerChallenge,
	);
	const [existing] = await identity.sql<{ id: string }[]>`
		select id from app.support_challenge
		where id = ${challengeId} and kind = 'session_recovery' and actor_scope = ${actor.scope}
	`;
	if (!existing) throw new AccessError(404, "NOT_FOUND");
	const [challenge] = await identity.sql<
		{
			id: string;
			target_reference: string;
			code_digest: string;
		}[]
	>`
		update app.support_challenge
		set attempts = attempts + 1
		where id = ${challengeId} and kind = 'session_recovery' and actor_scope = ${actor.scope}
			and verified_at is null and attempts < 5 and expires_at > clock_timestamp()
		returning id, target_reference, code_digest
	`;
	if (!challenge) {
		throw new AccessError(409, "CHALLENGE_EXPIRED");
	}
	if (
		challenge.target_reference === "unmatched" ||
		digest(proof) !== challenge.code_digest
	) {
		throw new AccessError(403, "INVALID_CHALLENGE_PROOF");
	}
	return identity.sql.begin(async (tx) => {
		const replay = await checkOperation(
			tx,
			actor.scope,
			"support.recovery.verify",
			key,
			requestHash,
		);
		if (replay) {
			return {
				state: replay as { status: "active"; expires_at: string },
				rotatedCookie: null as string | null,
			};
		}
		const [sealed] = await tx<{ now: string }[]>`
			update app.support_challenge
			set verified_at = clock_timestamp()
			where id = ${challenge.id} and verified_at is null
			returning verified_at as now
		`;
		if (!sealed) {
			throw new AccessError(409, "CHALLENGE_EXPIRED");
		}
		const clock = sealed;
		const originalGuestId = challenge.target_reference;
		let rotatedCookie: string | null = null;
		let expiresAt = new Date(Date.parse(clock.now) + 604800000).toISOString();

		if (actor.kind === "user") {
			await tx`
				update app.guest_support_identity
				set linked_user_id = ${actor.id}
				where id = ${originalGuestId}
			`;
			await tx`
				update app.support_conversation
				set buyer_user_id = ${actor.id}
				where guest_support_id = ${originalGuestId} and buyer_user_id is null
			`;
		} else {
			const newToken = randomBytes(32).toString("base64url");
			const [updated] = await tx<{ expires_at: string }[]>`
				update app.guest_support_identity
				set token_digest = ${digest(newToken)}, expires_at = clock_timestamp() + interval '7 days'
				where id = ${originalGuestId}
				returning expires_at
			`;
			expiresAt = new Date(updated.expires_at).toISOString();
			rotatedCookie = `${originalGuestId}.${newToken}`;
		}
		const state = { status: "active" as const, expires_at: expiresAt };
		await saveOperation(
			tx,
			actor.scope,
			"support.recovery.verify",
			key,
			requestHash,
			state,
		);
		return { state, rotatedCookie };
	});
}
