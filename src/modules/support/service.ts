import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { TransactionSql } from "postgres";
import {
	scanImagePayload,
	sniffImageContentType,
} from "../../storage/media-sniff.ts";
import {
	deletePrivateArtifact,
	readPrivateArtifact,
	savePrivateArtifact,
} from "../../storage/private.ts";
import type { LocalAuth } from "../access/auth.ts";
import { LIMITS, rateLimit } from "../access/rate-limit.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import {
	array,
	id,
	integer,
	invalid,
	object,
	text,
} from "../catalog/validation.ts";
import {
	type CommerceActor,
	cookie,
	digest,
	lockActor,
	mac,
	prefix,
} from "../checkout/access.ts";
import { mutationKey } from "../checkout/carts.ts";
import { authorizeOrder } from "../checkout/orders.ts";

export type SupportCustomerActor =
	| {
			kind: "user";
			id: string;
			scope: string;
			principal: Principal;
			linkedGuestIds: string[];
	  }
	| {
			kind: "guest";
			id: string;
			scope: string;
			commerceGuestId: string | null;
	  };

export type ConversationRow = {
	id: string;
	buyer_user_id: string | null;
	guest_support_id: string | null;
	primary_product_id: string | null;
	primary_order_id: string | null;
	status: "open" | "waiting_customer" | "resolved";
	assigned_user_id: string | null;
	priority: "low" | "normal" | "high";
	public_sequence: number;
	revision: number;
	last_public_message_at: string | null;
	created_at: string;
	updated_at: string;
};

type MessageRow = {
	id: string;
	conversation_id: string;
	public_sequence: number;
	sender_side: "buyer" | "customer_service";
	sender_user_id: string | null;
	sender_guest_id: string | null;
	client_message_id: string;
	request_hash: string;
	body: string;
	reply_to_message_id: string | null;
	redacted_at: string | null;
	redacted_reason: string | null;
	created_at: string;
};

const ALLOWED_PLACEHOLDERS = [
	"customer_name",
	"product_title",
	"order_reference",
] as const;
const MAX_IMAGE_BYTES = 5_242_880;

export async function supportCookieName(identity: LocalAuth) {
	return `${await prefix(identity)}.support_guest`;
}

export async function supportChallengeProof(
	identity: LocalAuth,
	challengeId: string,
	kind: "contact_binding" | "session_recovery",
	targetReference: string,
) {
	return mac(identity, "support-challenge", [
		challengeId,
		kind,
		targetReference,
	]);
}

function escapeExcerpt(raw: string, maxLen = 500) {
	const cleaned = raw
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
		.trim();
	return Array.from(cleaned).slice(0, maxLen).join("");
}

function slugify(input: string, suffix: string) {
	const base = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return `${base || "item"}-${suffix.slice(0, 8)}`;
}

async function checkOperation(
	tx: TransactionSql,
	actorId: string,
	action: string,
	key: string,
	requestHash: string,
): Promise<unknown | null> {
	const [prior] = await tx<{ request_hash: string; response: unknown }[]>`
		select request_hash, response
		from app.access_operation
		where actor_id = ${actorId} and action = ${action} and key = ${key}
	`;
	if (!prior) return null;
	if (prior.request_hash !== requestHash)
		throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
	return prior.response;
}

async function saveOperation(
	tx: TransactionSql,
	actorId: string,
	action: string,
	key: string,
	requestHash: string,
	response: unknown,
) {
	await tx`
		insert into app.access_operation (actor_id, action, key, request_hash, response)
		values (${actorId}, ${action}, ${key}, ${requestHash}, ${JSON.stringify(response)}::jsonb)
		on conflict (actor_id, action, key) do nothing
	`;
}

export async function resolveSupportStaff(
	request: Request,
	identity: LocalAuth,
): Promise<Principal> {
	if (
		request.headers.has("authorization") ||
		request.headers.has("x-cart-token") ||
		request.headers.has("x-order-token")
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	const principal = await getPrincipal(request, identity);
	if (
		!principal.roles.includes("owner") &&
		!principal.roles.includes("customer_service")
	) {
		throw new AccessError(403, "FORBIDDEN");
	}
	return principal;
}

export function canManageSupportTools(principal: Principal) {
	return (
		principal.roles.includes("owner") ||
		(principal.roles.includes("customer_service") &&
			(principal.permissions as readonly string[]).includes(
				"support.tools.manage",
			))
	);
}

export async function resolveSupportCustomer(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
): Promise<SupportCustomerActor> {
	if (
		request.headers.has("authorization") ||
		request.headers.has("x-cart-token")
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	const p = await prefix(identity);
	const session = await identity.auth.api.getSession({
		headers: request.headers,
		query: { disableCookieCache: true },
	});
	if (session) {
		const principal = await getPrincipal(request, identity);
		await lockActor(tx, { kind: "user", id: principal.id, principal });
		const linked = await tx<{ id: string }[]>`
			select id from app.guest_support_identity where linked_user_id = ${principal.id}
		`;
		return {
			kind: "user",
			id: principal.id,
			scope: `user:${principal.id}`,
			principal,
			linkedGuestIds: linked.map((r) => r.id),
		};
	}
	if (cookie(request, `${p}.session_token`)) {
		throw new AccessError(401, "UNAUTHENTICATED");
	}
	const raw = cookie(request, `${p}.support_guest`);
	const match =
		raw &&
		/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/i.exec(
			raw,
		);
	if (!match) throw new AccessError(401, "UNAUTHENTICATED");
	const [guest] = await tx<
		{
			id: string;
			token_digest: string;
			guest_id: string | null;
			expires_at: string;
		}[]
	>`
		select id, token_digest, guest_id, expires_at
		from app.guest_support_identity
		where id = ${match[1].toLowerCase()}
	`;
	const [clock] = await tx<{ now: string }[]>`select clock_timestamp() as now`;
	if (!guest || new Date(guest.expires_at) <= new Date(clock.now)) {
		throw new AccessError(401, "UNAUTHENTICATED");
	}
	const expectedBuf = Buffer.from(guest.token_digest, "hex");
	const actualBuf = Buffer.from(digest(match[2]), "hex");
	if (
		expectedBuf.length !== actualBuf.length ||
		!timingSafeEqual(expectedBuf, actualBuf)
	) {
		throw new AccessError(401, "UNAUTHENTICATED");
	}
	let commerceGuestId: string | null = guest.guest_id;
	const commerceCookie = cookie(request, `${p}.commerce_guest`);
	if (commerceCookie && /^[A-Za-z0-9_-]{43}$/.test(commerceCookie)) {
		const [cg] = await tx<{ id: string }[]>`
			select id from app.commerce_guest_context
			where digest = ${digest(commerceCookie)} and revoked_at is null and expires_at > clock_timestamp()
		`;
		if (cg) commerceGuestId = cg.id;
	}
	return {
		kind: "guest",
		id: guest.id,
		scope: `guest_support:${guest.id}`,
		commerceGuestId,
	};
}

function toCommerceActor(actor: SupportCustomerActor): CommerceActor | null {
	if (actor.kind === "user") {
		return { kind: "user", id: actor.id, principal: actor.principal };
	}
	if (actor.commerceGuestId) {
		return { kind: "guest", id: actor.commerceGuestId };
	}
	return null;
}

function ownsConversation(actor: SupportCustomerActor, row: ConversationRow) {
	if (actor.kind === "user") {
		return (
			row.buyer_user_id === actor.id ||
			(row.guest_support_id !== null &&
				actor.linkedGuestIds.includes(row.guest_support_id))
		);
	}
	return row.guest_support_id === actor.id;
}

export async function requireOwnedConversation(
	tx: TransactionSql,
	actor: SupportCustomerActor,
	conversationId: string,
	forUpdate = false,
): Promise<ConversationRow> {
	const cid = id(conversationId);
	const [row] = forUpdate
		? await tx<
				ConversationRow[]
			>`select * from app.support_conversation where id = ${cid} for update`
		: await tx<
				ConversationRow[]
			>`select * from app.support_conversation where id = ${cid} for share`;
	if (!row || !ownsConversation(actor, row)) {
		throw new AccessError(404, "NOT_FOUND");
	}
	return row;
}

export async function requireStaffConversation(
	tx: TransactionSql,
	conversationId: string,
	forUpdate = false,
): Promise<ConversationRow> {
	const cid = id(conversationId);
	const [row] = forUpdate
		? await tx<
				ConversationRow[]
			>`select * from app.support_conversation where id = ${cid} for update`
		: await tx<
				ConversationRow[]
			>`select * from app.support_conversation where id = ${cid} for share`;
	if (!row) throw new AccessError(404, "NOT_FOUND");
	return row;
}

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
	if (expectedVersion >= 1) {
		const proof = text(body.reauthentication_proof, 2000);
		if (proof.length < 16) throw invalid();
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
			await tx`
				update app.guest_support_identity
				set contact_value = ${challenge.target_reference}, contact_verified_at = ${clock.now}
				where id = ${actor.id}
			`;
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

export async function projectPublicConversation(
	tx: TransactionSql,
	row: ConversationRow,
) {
	const [reads] = await tx<{ buyer_read: number; staff_read: number }[]>`
		select
			coalesce(max(last_read_sequence) filter (where reader_side = 'customer'), 0)::int as buyer_read,
			coalesce(max(last_read_sequence) filter (where reader_side = 'staff'), 0)::int as staff_read
		from app.support_read_position
		where conversation_id = ${row.id}
	`;
	return {
		id: row.id,
		status: row.status,
		version: row.revision,
		created_at: new Date(row.created_at).toISOString(),
		updated_at: new Date(row.updated_at).toISOString(),
		last_message_sequence: row.public_sequence,
		...(row.primary_product_id ? { product_id: row.primary_product_id } : {}),
		...(row.primary_order_id ? { order_id: row.primary_order_id } : {}),
		buyer_last_read_sequence: reads?.buyer_read ?? 0,
		staff_last_read_sequence: reads?.staff_read ?? 0,
	};
}

export async function projectStaffConversation(
	tx: TransactionSql,
	row: ConversationRow,
	staffUserId: string,
) {
	const conversation = await projectPublicConversation(tx, row);
	const [agentRead] = await tx<{ last_read_sequence: number }[]>`
		select last_read_sequence
		from app.support_read_position
		where conversation_id = ${row.id} and participant_scope = ${`user:${staffUserId}`}
	`;
	const currentAgentRead = agentRead?.last_read_sequence ?? 0;
	const unread = Math.max(0, row.public_sequence - currentAgentRead);
	return {
		conversation,
		assignee_user_id: row.assigned_user_id ?? null,
		assignment_version: row.revision,
		current_agent_last_read_sequence: currentAgentRead,
		current_agent_unread_messages: unread,
	};
}

async function verifyPublishedProduct(
	tx: TransactionSql,
	productId: string,
	variantId?: string | null,
) {
	const pid = id(productId);
	const [prod] = await tx<
		{
			id: string;
			publication_revision: number | null;
			published_revision: number | null;
		}[]
	>`
		select p.id, ph.revision as publication_revision, pub.product_revision as published_revision
		from app.product p
		left join app.publication_head ph on ph.product_id = p.id and ph.revision > 0
		left join app.publication_version pub on pub.product_id = p.id and pub.revision = ph.revision
			and not exists (select 1 from app.publication_withdrawal w where w.publication_id = pub.id)
		where p.id = ${pid}
	`;
	if (!prod?.publication_revision || prod.published_revision === null) {
		throw new AccessError(404, "NOT_FOUND");
	}
	const [rev] = await tx<{ name: string }[]>`
		select name from app.product_revision
		where product_id = ${pid} and revision = ${prod.published_revision}
	`;
	let title = rev?.name ?? "Produk 99ribu";
	if (variantId) {
		const vid = id(variantId);
		const [offer] = await tx<{ label: string }[]>`
			select v.label
			from app.offer o
			join app.offer_revision v
				on v.product_id = o.product_id
				and v.offer_id = o.id
				and v.revision = ${prod.published_revision}
			where o.id = ${vid} and o.product_id = ${pid} and v.retired = false
		`;
		if (!offer) throw new AccessError(404, "NOT_FOUND");
		title = `${title} — ${offer.label}`;
	}
	return {
		productId: pid,
		variantId: variantId ? id(variantId) : null,
		title: title.slice(0, 200),
	};
}

export async function createSupportConversation(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	value: unknown,
) {
	const key = mutationKey(request);
	const actor = await resolveSupportCustomer(tx, request, identity);
	const body = object(value, [
		"client_conversation_id",
		"product_id",
		"order_id",
	]);
	const clientConversationId = text(body.client_conversation_id, 100);
	if (
		clientConversationId.length < 16 ||
		!/^[A-Za-z0-9_-]{16,100}$/.test(clientConversationId)
	) {
		throw invalid();
	}
	const productId = body.product_id !== undefined ? id(body.product_id) : null;
	const orderId = body.order_id !== undefined ? id(body.order_id) : null;
	if (!orderId && request.headers.has("x-order-token")) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}

	if (productId) {
		await verifyPublishedProduct(tx, productId);
	}
	if (orderId) {
		await authorizeOrder(
			tx,
			request,
			identity,
			toCommerceActor(actor),
			orderId,
		);
	}

	const requestHash = digest(
		JSON.stringify({
			client_conversation_id: clientConversationId,
			product_id: productId,
			order_id: orderId,
		}),
	);

	await tx`select pg_advisory_xact_lock(hashtextextended(${`support.conv:${actor.scope}`}, 0))`;
	const priorByKey = await checkOperation(
		tx,
		actor.scope,
		"support.conversation.create",
		key,
		requestHash,
	);
	if (priorByKey) {
		const [existing] = await tx<ConversationRow[]>`
			select * from app.support_conversation where id = ${(priorByKey as { id: string }).id}
		`;
		if (existing) return projectPublicConversation(tx, existing);
	}
	const priorByClient = await checkOperation(
		tx,
		actor.scope,
		"support.conversation.client",
		clientConversationId,
		requestHash,
	);
	if (priorByClient) {
		const [existing] = await tx<ConversationRow[]>`
			select * from app.support_conversation where id = ${(priorByClient as { id: string }).id}
		`;
		if (existing) return projectPublicConversation(tx, existing);
	}

	const [converged] = await tx<ConversationRow[]>`
		select *
		from app.support_conversation
		where status in ('open', 'waiting_customer')
		  and ${actor.kind === "user" ? tx`buyer_user_id = ${actor.id}` : tx`guest_support_id = ${actor.id}`}
		  and primary_product_id is not distinct from ${productId}
		  and primary_order_id is not distinct from ${orderId}
		order by created_at desc
		limit 1
		for update
	`;
	const row =
		converged ??
		(
			await tx<ConversationRow[]>`
				insert into app.support_conversation (
					buyer_user_id, guest_support_id, primary_product_id, primary_order_id, status, priority, public_sequence, revision
				)
				values (
					${actor.kind === "user" ? actor.id : null},
					${actor.kind === "guest" ? actor.id : null},
					${productId},
					${orderId},
					'open',
					'normal',
					0,
					1
				)
				returning *
			`
		)[0];
	const projected = await projectPublicConversation(tx, row);
	await saveOperation(
		tx,
		actor.scope,
		"support.conversation.create",
		key,
		requestHash,
		{ id: row.id },
	);
	await saveOperation(
		tx,
		actor.scope,
		"support.conversation.client",
		clientConversationId,
		requestHash,
		{
			id: row.id,
		},
	);
	return projected;
}

export async function listCustomerConversations(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	url: URL,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const actor = await resolveSupportCustomer(tx, request, identity);
	for (const k of url.searchParams.keys()) {
		if (
			!["cursor", "limit", "view", "status"].includes(k) ||
			url.searchParams.getAll(k).length !== 1
		) {
			throw invalid();
		}
	}
	const limitRaw = url.searchParams.get("limit") ?? "20";
	if (!/^\d{1,3}$/.test(limitRaw)) throw invalid();
	const limit = integer(Number(limitRaw), 1, 100);
	const cursor = url.searchParams.has("cursor")
		? id(url.searchParams.get("cursor"))
		: null;
	const view = url.searchParams.get("view") ?? "active";
	if (!["active", "archived", "all"].includes(view)) throw invalid();
	const status = url.searchParams.get("status");
	if (
		status !== null &&
		!["open", "waiting_customer", "resolved"].includes(status)
	)
		throw invalid();

	return queryCustomerConversationList(tx, actor, {
		limit,
		cursor,
		view,
		status,
		query: null,
	});
}

export async function searchCustomerConversations(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	value: unknown,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const key = mutationKey(request);
	const actor = await resolveSupportCustomer(tx, request, identity);
	const body = object(value, ["query", "cursor", "limit", "view", "status"]);
	const query = text(body.query, 200);
	const limit = body.limit !== undefined ? integer(body.limit, 1, 100) : 20;
	const cursor = body.cursor !== undefined ? id(body.cursor) : null;
	const view = body.view !== undefined ? text(body.view, 20) : "all";
	if (!["active", "archived", "all"].includes(view)) throw invalid();
	const status = body.status !== undefined ? text(body.status, 30) : null;
	if (
		status !== null &&
		!["open", "waiting_customer", "resolved"].includes(status)
	)
		throw invalid();

	const requestHash = digest(
		JSON.stringify({ query, cursor, limit, view, status }),
	);
	const prior = await checkOperation(
		tx,
		actor.scope,
		"support.conversation.search",
		key,
		requestHash,
	);
	if (prior) return prior;

	const result = await queryCustomerConversationList(tx, actor, {
		limit,
		cursor,
		view,
		status,
		query,
	});
	await saveOperation(
		tx,
		actor.scope,
		"support.conversation.search",
		key,
		requestHash,
		result,
	);
	return result;
}

async function queryCustomerConversationList(
	tx: TransactionSql,
	actor: SupportCustomerActor,
	opts: {
		limit: number;
		cursor: string | null;
		view: string;
		status: string | null;
		query: string | null;
	},
) {
	const ownerFilter =
		actor.kind === "user"
			? actor.linkedGuestIds.length > 0
				? tx`(c.buyer_user_id = ${actor.id} or c.guest_support_id in ${tx(actor.linkedGuestIds)})`
				: tx`c.buyer_user_id = ${actor.id}`
			: tx`c.guest_support_id = ${actor.id}`;
	const viewFilter =
		opts.view === "active"
			? tx`and coalesce(p.archived, false) = false`
			: opts.view === "archived"
				? tx`and coalesce(p.archived, false) = true`
				: tx``;
	const statusFilter = opts.status ? tx`and c.status = ${opts.status}` : tx``;
	const pattern = opts.query ? `%${opts.query.toLowerCase()}%` : null;
	const searchFilter = pattern
		? tx`and (
				lower(c.status) like ${pattern}
				or lower(c.id::text) like ${pattern}
				or exists (
					select 1 from app.commerce_order o
					where o.id = c.primary_order_id and lower(o.number) like ${pattern}
				)
				or exists (
					select 1 from app.product_revision pv
					where pv.product_id = c.primary_product_id and lower(pv.name) like ${pattern}
				)
			)`
		: tx``;

	const allRows = await tx<ConversationRow[]>`
		select c.*
		from app.support_conversation c
		left join app.support_participant_preference p
			on p.conversation_id = c.id and p.participant_scope = ${actor.scope}
		where ${ownerFilter}
		  ${viewFilter}
		  ${statusFilter}
		  ${searchFilter}
		order by coalesce(c.last_public_message_at, c.created_at) desc, c.id desc
	`;
	let startIndex = 0;
	if (opts.cursor) {
		const idx = allRows.findIndex((r) => r.id === opts.cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
		startIndex = idx + 1;
	}
	const pageRows = allRows.slice(startIndex, startIndex + opts.limit);
	const hasMore = startIndex + opts.limit < allRows.length;
	const data = [];
	for (const row of pageRows) {
		data.push(await projectPublicConversation(tx, row));
	}
	return {
		data,
		pagination: {
			next_cursor:
				hasMore && pageRows.length > 0
					? pageRows[pageRows.length - 1].id
					: null,
			has_more: hasMore,
		},
	};
}

export async function getCustomerConversation(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationId: string,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const actor = await resolveSupportCustomer(tx, request, identity);
	const row = await requireOwnedConversation(tx, actor, conversationId, false);
	return projectPublicConversation(tx, row);
}

async function projectMessage(
	tx: TransactionSql,
	row: MessageRow,
	conversation: ConversationRow,
) {
	const attachments = row.redacted_at
		? []
		: await tx<
				{
					id: string;
					content_type: "image/jpeg" | "image/png" | "image/webp";
					byte_size: number;
					scan_status: "pending_scan" | "ready" | "rejected";
				}[]
			>`
				select id, content_type, byte_size, scan_status
				from app.support_attachment
				where message_id = ${row.id} and conversation_id = ${row.conversation_id}
				order by created_at asc, id asc
			`;

	let reply: {
		message_id: string;
		state: "visible" | "redacted" | "expired";
		excerpt: string;
	} | null = null;
	if (row.reply_to_message_id) {
		const [target] = await tx<MessageRow[]>`
			select * from app.support_message
			where id = ${row.reply_to_message_id} and conversation_id = ${row.conversation_id}
		`;
		if (!target) {
			reply = {
				message_id: row.reply_to_message_id,
				state: "expired",
				excerpt: "",
			};
		} else if (target.redacted_at) {
			reply = { message_id: target.id, state: "redacted", excerpt: "" };
		} else {
			reply = {
				message_id: target.id,
				state: "visible",
				excerpt: escapeExcerpt(target.body || "[Lampiran gambar]", 500),
			};
		}
	}

	let context: {
		kind: "product" | "order";
		product_id?: string;
		variant_id?: string;
		order_id?: string;
		title: string;
		availability: "available" | "unavailable" | "redacted";
		snapshot_at: string;
	} | null = null;

	const [card] = await tx<
		{
			kind: "product" | "order";
			resource_id: string;
			snapshot: {
				title?: string;
				variant_id?: string;
				snapshot_at?: string;
				revoked?: boolean;
			};
			created_at: string;
		}[]
	>`
		select kind, resource_id, snapshot, created_at
		from app.support_context_card
		where message_id = ${row.id} and conversation_id = ${row.conversation_id}
		limit 1
	`;
	if (card) {
		const snapshotAt = new Date(
			card.snapshot.snapshot_at ?? card.created_at,
		).toISOString();
		if (row.redacted_at) {
			context =
				card.kind === "product"
					? {
							kind: "product",
							product_id: card.resource_id,
							title: "Konteks dihapus",
							availability: "redacted",
							snapshot_at: snapshotAt,
						}
					: {
							kind: "order",
							order_id: card.resource_id,
							title: "Konteks dihapus",
							availability: "redacted",
							snapshot_at: snapshotAt,
						};
		} else if (card.kind === "product") {
			const [prod] = await tx<{ revision: number }[]>`
				select h.revision from app.publication_head h join app.publication_version pub
					on pub.product_id = h.product_id and pub.revision = h.revision
				where h.product_id = ${card.resource_id} and not exists (select 1 from app.publication_withdrawal w where w.publication_id = pub.id)
			`;
			const available =
				Boolean(prod && prod.revision > 0) && !card.snapshot.revoked;
			context = {
				kind: "product",
				product_id: card.resource_id,
				...(card.snapshot.variant_id
					? { variant_id: card.snapshot.variant_id }
					: {}),
				title: available
					? (card.snapshot.title ?? "Produk 99ribu")
					: "Produk tidak tersedia",
				availability: available ? "available" : "unavailable",
				snapshot_at: snapshotAt,
			};
		} else {
			const [ord] = await tx<{ id: string; number: string; status: string }[]>`
				select id, number, status from app.commerce_order where id = ${card.resource_id}
			`;
			const available =
				Boolean(ord) &&
				!card.snapshot.revoked &&
				conversation.primary_order_id === card.resource_id;
			context = {
				kind: "order",
				order_id: card.resource_id,
				title:
					available && ord
						? `Pesanan ${ord.number} (${ord.status})`
						: "Pesanan tidak tersedia",
				availability: available ? "available" : "unavailable",
				snapshot_at: snapshotAt,
			};
		}
	}

	return {
		id: row.id,
		conversation_id: row.conversation_id,
		sequence: row.public_sequence,
		client_message_id: row.client_message_id,
		sender: row.sender_side,
		text: row.redacted_at ? "[Pesan dihapus]" : row.body,
		attachments: attachments.map((a) => ({
			id: a.id,
			media_type: a.content_type,
			size_bytes: a.byte_size,
			status: a.scan_status,
		})),
		created_at: new Date(row.created_at).toISOString(),
		...(reply ? { reply } : {}),
		...(context ? { context } : {}),
	};
}

export async function listPublicMessages(
	tx: TransactionSql,
	conversation: ConversationRow,
	url: URL,
) {
	for (const k of url.searchParams.keys()) {
		if (
			!["cursor", "limit", "around_sequence"].includes(k) ||
			url.searchParams.getAll(k).length !== 1
		) {
			throw invalid();
		}
	}
	const limitRaw = url.searchParams.get("limit") ?? "20";
	if (!/^\d{1,3}$/.test(limitRaw)) throw invalid();
	const limit = integer(Number(limitRaw), 1, 100);
	const cursor = url.searchParams.has("cursor")
		? id(url.searchParams.get("cursor"))
		: null;
	const aroundRaw = url.searchParams.get("around_sequence");
	if (cursor && aroundRaw !== null) throw invalid();

	let rows: MessageRow[];
	let hasMore = false;
	if (aroundRaw !== null) {
		if (!/^\d+$/.test(aroundRaw)) throw invalid();
		const around = integer(Number(aroundRaw), 1);
		const half = Math.max(1, Math.floor(limit / 2));
		rows = await tx<MessageRow[]>`
			select * from app.support_message
			where conversation_id = ${conversation.id}
			  and public_sequence between ${Math.max(1, around - half)} and ${around + half}
			order by public_sequence asc
		`;
	} else {
		const allRows = await tx<MessageRow[]>`
			select * from app.support_message
			where conversation_id = ${conversation.id}
			order by public_sequence asc
		`;
		let startIndex = 0;
		if (cursor) {
			const idx = allRows.findIndex((r) => r.id === cursor);
			if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
			startIndex = idx + 1;
		}
		rows = allRows.slice(startIndex, startIndex + limit);
		hasMore = startIndex + limit < allRows.length;
	}
	const data = [];
	for (const row of rows) {
		data.push(await projectMessage(tx, row, conversation));
	}
	return {
		data,
		pagination: {
			next_cursor: hasMore && rows.length > 0 ? rows[rows.length - 1].id : null,
			has_more: hasMore,
		},
	};
}

function parseContextInput(value: unknown): {
	kind: "product" | "order";
	product_id?: string;
	variant_id?: string;
	order_id?: string;
} {
	const data = object(value, ["kind", "product_id", "variant_id", "order_id"]);
	if (data.kind === "product") {
		if (data.order_id !== undefined) throw invalid();
		const productId = id(data.product_id);
		const variantId =
			data.variant_id !== undefined ? id(data.variant_id) : undefined;
		return {
			kind: "product",
			product_id: productId,
			...(variantId ? { variant_id: variantId } : {}),
		};
	}
	if (data.kind === "order") {
		if (data.product_id !== undefined || data.variant_id !== undefined)
			throw invalid();
		return { kind: "order", order_id: id(data.order_id) };
	}
	throw invalid();
}

export async function commitPublicMessage(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationIdParam: string,
	sender:
		| { side: "buyer"; actor: SupportCustomerActor }
		| { side: "customer_service"; principal: Principal },
	value: unknown,
) {
	const key = mutationKey(request);
	const body = object(value, [
		"client_message_id",
		"text",
		"attachment_ids",
		"reply_to_message_id",
		"context",
	]);
	const clientMessageId = text(body.client_message_id, 100);
	if (
		clientMessageId.length < 16 ||
		!/^[A-Za-z0-9_-]{16,100}$/.test(clientMessageId)
	) {
		throw invalid();
	}
	const rawText = text(body.text, 4000, true);
	const attachmentIds = array(body.attachment_ids, (v) => id(v), 0, 3);
	if (new Set(attachmentIds).size !== attachmentIds.length) throw invalid();
	const replyToMessageId =
		body.reply_to_message_id !== undefined
			? id(body.reply_to_message_id)
			: null;
	const contextInput =
		body.context !== undefined ? parseContextInput(body.context) : null;

	if (contextInput?.kind !== "order" && request.headers.has("x-order-token")) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	if (!rawText.trim() && attachmentIds.length === 0) {
		throw invalid();
	}
	if (contextInput && !rawText.trim()) {
		throw invalid();
	}

	const conversation =
		sender.side === "buyer"
			? await requireOwnedConversation(
					tx,
					sender.actor,
					conversationIdParam,
					true,
				)
			: await requireStaffConversation(tx, conversationIdParam, true);

	if (
		sender.side === "customer_service" &&
		conversation.assigned_user_id !== sender.principal.id
	) {
		throw new AccessError(409, "CLAIM_REQUIRED");
	}

	const senderScope =
		sender.side === "buyer"
			? sender.actor.scope
			: `user:${sender.principal.id}`;
	const requestHash = digest(
		JSON.stringify({
			text: rawText,
			attachment_ids: attachmentIds,
			reply_to_message_id: replyToMessageId,
			context: contextInput,
		}),
	);

	const [existingMsg] = await tx<MessageRow[]>`
		select * from app.support_message
		where conversation_id = ${conversation.id}
		  and sender_side = ${sender.side}
		  and client_message_id = ${clientMessageId}
	`;
	if (existingMsg) {
		if (existingMsg.request_hash !== requestHash) {
			throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
		}
		return projectMessage(tx, existingMsg, conversation);
	}

	const priorByKey = await checkOperation(
		tx,
		senderScope,
		`support.message.send:${conversation.id}`,
		key,
		requestHash,
	);
	if (priorByKey) {
		const [msg] = await tx<MessageRow[]>`
			select * from app.support_message where id = ${(priorByKey as { id: string }).id}
		`;
		if (msg) return projectMessage(tx, msg, conversation);
	}

	if (replyToMessageId) {
		const [replyTarget] = await tx<MessageRow[]>`
			select * from app.support_message
			where id = ${replyToMessageId} and conversation_id = ${conversation.id}
		`;
		if (!replyTarget || replyTarget.redacted_at) {
			throw new AccessError(400, "INVALID_REPLY_TARGET");
		}
	}

	if (attachmentIds.length > 0) {
		const attachments = await tx<
			{
				id: string;
				conversation_id: string;
				message_id: string | null;
				uploader_scope: string;
				scan_status: string;
			}[]
		>`
			select id, conversation_id, message_id, uploader_scope, scan_status
			from app.support_attachment
			where id in ${tx(attachmentIds)}
			for update
		`;
		if (attachments.length !== attachmentIds.length) {
			throw new AccessError(404, "NOT_FOUND");
		}
		for (const att of attachments) {
			if (
				att.conversation_id !== conversation.id ||
				att.uploader_scope !== senderScope
			) {
				throw new AccessError(403, "FORBIDDEN");
			}
			if (att.scan_status !== "ready") {
				throw new AccessError(409, "ATTACHMENT_NOT_READY");
			}
			if (att.message_id !== null) {
				throw new AccessError(409, "ATTACHMENT_ALREADY_USED");
			}
		}
	}

	let contextCardData: {
		kind: "product" | "order";
		resourceId: string;
		snapshot: Record<string, unknown>;
	} | null = null;
	const [clock] = await tx<{ now: string }[]>`select clock_timestamp() as now`;
	const nowIso = new Date(clock.now).toISOString();

	if (contextInput) {
		if (contextInput.kind === "product" && contextInput.product_id) {
			const prod = await verifyPublishedProduct(
				tx,
				contextInput.product_id,
				contextInput.variant_id,
			);
			contextCardData = {
				kind: "product",
				resourceId: prod.productId,
				snapshot: {
					title: prod.title,
					...(prod.variantId ? { variant_id: prod.variantId } : {}),
					snapshot_at: nowIso,
				},
			};
		} else if (contextInput.kind === "order" && contextInput.order_id) {
			if (sender.side === "buyer") {
				const ord = await authorizeOrder(
					tx,
					request,
					identity,
					toCommerceActor(sender.actor),
					contextInput.order_id,
				);
				contextCardData = {
					kind: "order",
					resourceId: ord.id,
					snapshot: {
						title: `Pesanan ${ord.number} (${ord.status})`,
						snapshot_at: nowIso,
					},
				};
			} else {
				const [ord] = await tx<
					{
						id: string;
						number: string;
						status: string;
						owner_user_id: string | null;
					}[]
				>`
					select id, number, status, owner_user_id
					from app.commerce_order
					where id = ${contextInput.order_id}
				`;
				if (
					!ord ||
					(conversation.primary_order_id !== ord.id &&
						(!conversation.buyer_user_id ||
							ord.owner_user_id !== conversation.buyer_user_id))
				) {
					throw new AccessError(403, "FORBIDDEN");
				}
				contextCardData = {
					kind: "order",
					resourceId: ord.id,
					snapshot: {
						title: `Pesanan ${ord.number} (${ord.status})`,
						snapshot_at: nowIso,
					},
				};
			}
		}
	}

	const nextSequence = conversation.public_sequence + 1;
	const reopen = sender.side === "buyer" && conversation.status !== "open";
	const nextStatus = reopen ? "open" : conversation.status;
	const nextRevision =
		sender.side === "buyer" ? conversation.revision + 1 : conversation.revision;
	const nextProductId =
		contextCardData?.kind === "product"
			? (conversation.primary_product_id ?? contextCardData.resourceId)
			: conversation.primary_product_id;
	const nextOrderId =
		contextCardData?.kind === "order"
			? contextCardData.resourceId
			: conversation.primary_order_id;

	const [updatedConv] = await tx<ConversationRow[]>`
		update app.support_conversation
		set public_sequence = ${nextSequence},
		    status = ${nextStatus},
		    revision = ${nextRevision},
		    primary_product_id = ${nextProductId},
		    primary_order_id = ${nextOrderId},
		    last_public_message_at = ${clock.now},
		    updated_at = ${clock.now}
		where id = ${conversation.id}
		returning *
	`;

	if (reopen) {
		await tx`
			insert into app.support_assignment_event (
				conversation_id, revision, kind, previous_user_id, assigned_user_id, actor_id, reason, created_at
			)
			values (
				${conversation.id},
				${nextRevision},
				'reopen',
				${conversation.assigned_user_id},
				${conversation.assigned_user_id},
				${senderScope},
				'Reopened by new customer message',
				${clock.now}
			)
		`;
	}

	const messageId = randomUUID();
	const [insertedMsg] = await tx<MessageRow[]>`
		insert into app.support_message (
			id, conversation_id, public_sequence, sender_side, sender_user_id, sender_guest_id,
			client_message_id, request_hash, body, reply_to_message_id, created_at
		)
		values (
			${messageId},
			${conversation.id},
			${nextSequence},
			${sender.side},
			${sender.side === "customer_service" ? sender.principal.id : sender.actor.kind === "user" ? sender.actor.id : null},
			${sender.side === "buyer" && sender.actor.kind === "guest" ? sender.actor.id : null},
			${clientMessageId},
			${requestHash},
			${rawText},
			${replyToMessageId},
			${clock.now}
		)
		returning *
	`;

	if (attachmentIds.length > 0) {
		await tx`
			update app.support_attachment
			set message_id = ${messageId}
			where id in ${tx(attachmentIds)} and conversation_id = ${conversation.id}
		`;
	}

	if (contextCardData) {
		await tx`
			insert into app.support_context_card (
				conversation_id, message_id, kind, resource_id, snapshot, created_at
			)
			values (
				${conversation.id},
				${messageId},
				${contextCardData.kind},
				${contextCardData.resourceId},
				${JSON.stringify(contextCardData.snapshot)}::jsonb,
				${clock.now}
			)
		`;
	}

	const readerSide = sender.side === "buyer" ? "customer" : "staff";
	await tx`
		insert into app.support_read_position (
			conversation_id, participant_scope, reader_side, last_read_sequence, updated_at
		)
		values (${conversation.id}, ${senderScope}, ${readerSide}, ${nextSequence}, ${clock.now})
		on conflict (conversation_id, participant_scope) do update
		set last_read_sequence = greatest(app.support_read_position.last_read_sequence, ${nextSequence}),
		    updated_at = ${clock.now}
	`;

	await tx`
		update app.support_participant_preference
		set archived = false,
		    revision = revision + 1,
		    updated_at = ${clock.now}
		where conversation_id = ${conversation.id}
		  and participant_scope <> ${senderScope}
		  and archived = true
	`;

	if (sender.side === "customer_service") {
		const recipientScope = updatedConv.buyer_user_id
			? `user:${updatedConv.buyer_user_id}`
			: updatedConv.guest_support_id
				? `guest_support:${updatedConv.guest_support_id}`
				: null;
		if (recipientScope) {
			const [pref] = await tx<{ muted: boolean }[]>`
				select muted from app.support_participant_preference
				where conversation_id = ${conversation.id} and participant_scope = ${recipientScope}
			`;
			if (!pref?.muted) {
				await tx`
					insert into app.support_in_app_notification (
						recipient_scope, event_key, conversation_id, kind, title, summary, state, created_at, updated_at
					)
					values (
						${recipientScope},
						${`msg:${messageId}`},
						${conversation.id},
						'support_attention',
						'Balasan layanan pelanggan',
						'Tim bantuan telah membalas percakapan Anda.',
						'unread',
						${clock.now},
						${clock.now}
					)
					on conflict (recipient_scope, event_key) do nothing
				`;
			}
		}
	} else if (updatedConv.assigned_user_id) {
		const recipientScope = `user:${updatedConv.assigned_user_id}`;
		await tx`
			insert into app.support_in_app_notification (
				recipient_scope, event_key, conversation_id, kind, title, summary, state, created_at, updated_at
			)
			values (
				${recipientScope},
				${`msg:${messageId}`},
				${conversation.id},
				'support_attention',
				'Pesan pelanggan baru',
				'Pelanggan mengirim pesan baru pada percakapan yang Anda klaim.',
				'unread',
				${clock.now},
				${clock.now}
			)
			on conflict (recipient_scope, event_key) do nothing
		`;
	}

	await saveOperation(
		tx,
		senderScope,
		`support.message.send:${conversation.id}`,
		key,
		requestHash,
		{
			id: messageId,
		},
	);
	return projectMessage(tx, insertedMsg, updatedConv);
}

export async function redactSupportMessage(
	tx: TransactionSql,
	messageIdParam: string,
	reason = "Redacted by authorized moderation",
) {
	const mid = id(messageIdParam);
	await tx`
		update app.support_message
		set redacted_at = clock_timestamp(),
		    redacted_reason = ${reason}
		where id = ${mid}
	`;
}

export async function revokeConversationOrderLink(
	tx: TransactionSql,
	conversationIdParam: string,
) {
	const cid = id(conversationIdParam);
	await tx`
		update app.support_conversation
		set primary_order_id = null,
		    revision = revision + 1,
		    updated_at = clock_timestamp()
		where id = ${cid}
	`;
}

async function resolveAttachmentCaller(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationIdParam: string,
): Promise<{
	conversation: ConversationRow;
	callerScope: string;
	isStaff: boolean;
}> {
	if (
		request.headers.has("authorization") ||
		request.headers.has("x-cart-token") ||
		request.headers.has("x-order-token")
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	const session = await identity.auth.api.getSession({
		headers: request.headers,
		query: { disableCookieCache: true },
	});
	if (session) {
		const principal = await getPrincipal(request, identity);
		if (
			principal.roles.includes("owner") ||
			principal.roles.includes("customer_service")
		) {
			const conv = await requireStaffConversation(
				tx,
				conversationIdParam,
				false,
			);
			if (conv.buyer_user_id === principal.id) {
				return {
					conversation: conv,
					callerScope: `user:${principal.id}`,
					isStaff: false,
				};
			}
			if (conv.assigned_user_id !== principal.id) {
				throw new AccessError(403, "CLAIM_REQUIRED");
			}
			return {
				conversation: conv,
				callerScope: `user:${principal.id}`,
				isStaff: true,
			};
		}
	}
	const actor = await resolveSupportCustomer(tx, request, identity);
	const conv = await requireOwnedConversation(
		tx,
		actor,
		conversationIdParam,
		false,
	);
	return { conversation: conv, callerScope: actor.scope, isStaff: false };
}

export async function uploadSupportAttachment(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationIdParam: string,
) {
	const key = mutationKey(request);
	const { conversation, callerScope } = await resolveAttachmentCaller(
		tx,
		request,
		identity,
		conversationIdParam,
	);
	const contentTypeHeader =
		request.headers.get("content-type")?.toLowerCase() ?? "";
	if (!contentTypeHeader.startsWith("multipart/form-data")) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const keys = [...form.keys()];
	if (
		keys.length !== 2 ||
		!keys.includes("client_attachment_id") ||
		!keys.includes("file") ||
		form.getAll("client_attachment_id").length !== 1 ||
		form.getAll("file").length !== 1
	) {
		throw invalid();
	}
	const clientAttachmentId = text(form.get("client_attachment_id"), 100);
	if (
		clientAttachmentId.length < 16 ||
		!/^[A-Za-z0-9_-]{16,100}$/.test(clientAttachmentId)
	) {
		throw invalid();
	}
	const fileEntry = form.get("file");
	if (!(fileEntry instanceof Blob)) throw invalid();
	const bytes = new Uint8Array(await fileEntry.arrayBuffer());
	if (bytes.byteLength < 1 || bytes.byteLength > MAX_IMAGE_BYTES) {
		throw new AccessError(400, "INVALID_IMAGE_SIZE");
	}
	const mediaType = sniffImageContentType(bytes);
	const scanStatus = scanImagePayload(bytes);
	const sha256 = digest(Buffer.from(bytes).toString("base64"));
	const requestHash = digest(
		JSON.stringify({
			clientAttachmentId,
			sha256,
			byteLength: bytes.byteLength,
		}),
	);

	const prior = await checkOperation(
		tx,
		callerScope,
		`support.attachment.upload:${conversation.id}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	const priorClient = await checkOperation(
		tx,
		callerScope,
		`support.attachment.client:${conversation.id}`,
		clientAttachmentId,
		requestHash,
	);
	if (priorClient) return priorClient;

	const storageKey = await savePrivateArtifact(bytes);
	// Remove the file if the row is never written so a failed request leaves no orphan.
	// lazy: a failure at COMMIT after this point can still orphan; a sweeper owns that case.
	try {
		const [inserted] = await tx<
			{
				id: string;
				content_type: "image/jpeg" | "image/png" | "image/webp";
				byte_size: number;
				scan_status: "pending_scan" | "ready" | "rejected";
			}[]
		>`
			insert into app.support_attachment (
				conversation_id, uploader_scope, content_type, byte_size, sha256, storage_key, scan_status
			)
			values (
				${conversation.id}, ${callerScope}, ${mediaType}, ${bytes.byteLength}, ${sha256}, ${storageKey}, ${scanStatus}
			)
			returning id, content_type, byte_size, scan_status
		`;
		const response = {
			id: inserted.id,
			media_type: inserted.content_type,
			size_bytes: inserted.byte_size,
			status: inserted.scan_status,
		};
		await saveOperation(
			tx,
			callerScope,
			`support.attachment.upload:${conversation.id}`,
			key,
			requestHash,
			response,
		);
		await saveOperation(
			tx,
			callerScope,
			`support.attachment.client:${conversation.id}`,
			clientAttachmentId,
			requestHash,
			response,
		);
		return response;
	} catch (error) {
		await deletePrivateArtifact(storageKey).catch(() => undefined);
		throw error;
	}
}

export async function getSupportAttachment(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationIdParam: string,
	attachmentIdParam: string,
) {
	const { conversation, callerScope } = await resolveAttachmentCaller(
		tx,
		request,
		identity,
		conversationIdParam,
	);
	const attachmentId = id(attachmentIdParam);
	const [row] = await tx<
		{
			id: string;
			conversation_id: string;
			message_id: string | null;
			uploader_scope: string;
			content_type: "image/jpeg" | "image/png" | "image/webp";
			byte_size: number;
			storage_key: string;
			scan_status: "pending_scan" | "ready" | "rejected";
		}[]
	>`
		select * from app.support_attachment
		where id = ${attachmentId} and conversation_id = ${conversation.id}
	`;
	if (!row) throw new AccessError(404, "NOT_FOUND");
	if (row.message_id === null && row.uploader_scope !== callerScope) {
		throw new AccessError(404, "NOT_FOUND");
	}
	if (row.message_id !== null) {
		const [msg] = await tx<{ redacted_at: string | null }[]>`
			select redacted_at from app.support_message where id = ${row.message_id}
		`;
		if (!msg || msg.redacted_at !== null) {
			throw new AccessError(404, "NOT_FOUND");
		}
	}
	const accept = request.headers.get("accept") ?? "";
	if (accept.includes("application/json")) {
		return {
			kind: "json" as const,
			body: {
				id: row.id,
				media_type: row.content_type,
				size_bytes: row.byte_size,
				status: row.scan_status,
			},
		};
	}
	if (row.scan_status !== "ready") {
		throw new AccessError(404, "ATTACHMENT_NOT_READY");
	}
	const bytes = await readPrivateArtifact(row.storage_key);
	const ext =
		row.content_type === "image/png"
			? "png"
			: row.content_type === "image/webp"
				? "webp"
				: "jpg";
	return {
		kind: "binary" as const,
		bytes,
		contentType: row.content_type,
		filename: `support-${row.id}.${ext}`,
	};
}

export async function advanceReadMarker(
	tx: TransactionSql,
	request: Request,
	conversation: ConversationRow,
	participantScope: string,
	readerSide: "customer" | "staff",
	value: unknown,
) {
	const key = mutationKey(request);
	const body = object(value, ["last_seen_sequence"]);
	const lastSeen = integer(body.last_seen_sequence, 0);
	if (lastSeen > conversation.public_sequence) {
		throw new AccessError(400, "INVALID_READ_SEQUENCE");
	}
	const requestHash = digest(JSON.stringify({ last_seen_sequence: lastSeen }));
	await checkOperation(
		tx,
		participantScope,
		`support.read:${conversation.id}`,
		key,
		requestHash,
	);
	const [row] = await tx<{ last_read_sequence: number; updated_at: string }[]>`
		insert into app.support_read_position (
			conversation_id, participant_scope, reader_side, last_read_sequence, updated_at
		)
		values (${conversation.id}, ${participantScope}, ${readerSide}, ${lastSeen}, clock_timestamp())
		on conflict (conversation_id, participant_scope) do update
		set last_read_sequence = greatest(app.support_read_position.last_read_sequence, ${lastSeen}),
		    updated_at = clock_timestamp()
		returning last_read_sequence, updated_at
	`;
	const response = {
		conversation_id: conversation.id,
		last_seen_sequence: row.last_read_sequence,
		updated_at: new Date(row.updated_at).toISOString(),
		reader_side: readerSide,
	};
	await saveOperation(
		tx,
		participantScope,
		`support.read:${conversation.id}`,
		key,
		requestHash,
		response,
	);
	return response;
}

export async function searchPublicMessages(
	tx: TransactionSql,
	request: Request,
	conversation: ConversationRow,
	callerScope: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const body = object(value, ["query", "cursor", "limit"]);
	const query = text(body.query, 200);
	const limit = body.limit !== undefined ? integer(body.limit, 1, 100) : 20;
	const cursorRaw = body.cursor !== undefined ? text(body.cursor, 2000) : null;

	const requestHash = digest(
		JSON.stringify({ query, cursor: cursorRaw, limit }),
	);
	const prior = await checkOperation(
		tx,
		callerScope,
		`support.message.search:${conversation.id}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	let afterSeq = 0;
	if (cursorRaw) {
		const expectedPrefix = `msearch:${conversation.id}:${digest(query.toLowerCase())}:`;
		if (!cursorRaw.startsWith(expectedPrefix))
			throw new AccessError(400, "INVALID_CURSOR");
		const seqStr = cursorRaw.slice(expectedPrefix.length);
		if (!/^\d+$/.test(seqStr)) throw new AccessError(400, "INVALID_CURSOR");
		afterSeq = integer(Number(seqStr), 1);
	}

	const pattern = `%${query.toLowerCase()}%`;
	const matches = await tx<MessageRow[]>`
		select *
		from app.support_message
		where conversation_id = ${conversation.id}
		  and redacted_at is null
		  and public_sequence > ${afterSeq}
		  and lower(body) like ${pattern}
		order by public_sequence asc
		limit ${limit + 1}
	`;
	const hasMore = matches.length > limit;
	const page = matches.slice(0, limit);
	const data = page.map((m) => ({
		message_id: m.id,
		sequence: m.public_sequence,
		excerpt: escapeExcerpt(m.body, 500),
		created_at: new Date(m.created_at).toISOString(),
	}));
	const nextCursor =
		hasMore && page.length > 0
			? `msearch:${conversation.id}:${digest(query.toLowerCase())}:${page[page.length - 1].public_sequence}`
			: null;
	const response = {
		data,
		pagination: {
			next_cursor: nextCursor,
			has_more: hasMore,
		},
	};
	await saveOperation(
		tx,
		callerScope,
		`support.message.search:${conversation.id}`,
		key,
		requestHash,
		response,
	);
	return response;
}

export async function getCustomerPreferences(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationIdParam: string,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const actor = await resolveSupportCustomer(tx, request, identity);
	const conv = await requireOwnedConversation(
		tx,
		actor,
		conversationIdParam,
		false,
	);
	const [pref] = await tx<
		{
			archived: boolean;
			muted: boolean;
			revision: number;
			updated_at: string;
		}[]
	>`
		select archived, muted, revision, updated_at
		from app.support_participant_preference
		where conversation_id = ${conv.id} and participant_scope = ${actor.scope}
	`;
	return {
		conversation_id: conv.id,
		version: pref?.revision ?? 1,
		archived: pref?.archived ?? false,
		muted: pref?.muted ?? false,
		updated_at: new Date(pref?.updated_at ?? conv.created_at).toISOString(),
	};
}

export async function setCustomerPreferences(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	conversationIdParam: string,
	value: unknown,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const key = mutationKey(request);
	const actor = await resolveSupportCustomer(tx, request, identity);
	const conv = await requireOwnedConversation(
		tx,
		actor,
		conversationIdParam,
		false,
	);
	const body = object(value, ["expected_version", "archived", "muted"]);
	const expectedVersion = integer(body.expected_version, 0);
	if (typeof body.archived !== "boolean" || typeof body.muted !== "boolean")
		throw invalid();
	const archived = body.archived;
	const muted = body.muted;

	const requestHash = digest(
		JSON.stringify({ expectedVersion, archived, muted }),
	);
	const prior = await checkOperation(
		tx,
		actor.scope,
		`support.preferences:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	const [existing] = await tx<
		{
			archived: boolean;
			muted: boolean;
			revision: number;
			updated_at: string;
		}[]
	>`
		select archived, muted, revision, updated_at
		from app.support_participant_preference
		where conversation_id = ${conv.id} and participant_scope = ${actor.scope}
		for update
	`;
	const currentVersion = existing ? existing.revision : 0;
	if (
		expectedVersion !== currentVersion &&
		!(existing === undefined && expectedVersion === 1)
	) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	const nextRevision = (existing?.revision ?? 0) + 1;
	const [saved] = await tx<
		{
			archived: boolean;
			muted: boolean;
			revision: number;
			updated_at: string;
		}[]
	>`
		insert into app.support_participant_preference (
			conversation_id, participant_scope, archived, muted, revision, updated_at
		)
		values (${conv.id}, ${actor.scope}, ${archived}, ${muted}, ${nextRevision}, clock_timestamp())
		on conflict (conversation_id, participant_scope) do update
		set archived = ${archived},
		    muted = ${muted},
		    revision = ${nextRevision},
		    updated_at = clock_timestamp()
		returning archived, muted, revision, updated_at
	`;
	const response = {
		conversation_id: conv.id,
		version: saved.revision,
		archived: saved.archived,
		muted: saved.muted,
		updated_at: new Date(saved.updated_at).toISOString(),
	};
	await saveOperation(
		tx,
		actor.scope,
		`support.preferences:${conv.id}`,
		key,
		requestHash,
		response,
	);
	return response;
}

function projectNotification(row: {
	id: string;
	conversation_id: string | null;
	kind: string;
	state: "unread" | "seen" | "dismissed";
	created_at: string;
	updated_at: string;
}) {
	const version = row.state === "unread" ? 1 : row.state === "seen" ? 2 : 3;
	return {
		id: row.id,
		kind: "support_attention" as const,
		target_kind: "conversation" as const,
		target_id: row.conversation_id ?? row.id,
		created_at: new Date(row.created_at).toISOString(),
		seen_at:
			row.state === "seen" || row.state === "dismissed"
				? new Date(row.updated_at).toISOString()
				: null,
		dismissed_at:
			row.state === "dismissed" ? new Date(row.updated_at).toISOString() : null,
		version,
	};
}

export async function listSupportNotifications(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	url: URL,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const actor = await resolveSupportCustomer(tx, request, identity);
	for (const k of url.searchParams.keys()) {
		if (
			!["cursor", "limit"].includes(k) ||
			url.searchParams.getAll(k).length !== 1
		)
			throw invalid();
	}
	const limitRaw = url.searchParams.get("limit") ?? "20";
	if (!/^\d{1,3}$/.test(limitRaw)) throw invalid();
	const limit = integer(Number(limitRaw), 1, 100);
	const cursor = url.searchParams.has("cursor")
		? id(url.searchParams.get("cursor"))
		: null;

	const scopes =
		actor.kind === "user" && actor.linkedGuestIds.length > 0
			? [actor.scope, ...actor.linkedGuestIds.map((g) => `guest_support:${g}`)]
			: [actor.scope];
	const allRows = await tx<
		{
			id: string;
			conversation_id: string | null;
			kind: string;
			state: "unread" | "seen" | "dismissed";
			created_at: string;
			updated_at: string;
		}[]
	>`
		select id, conversation_id, kind, state, created_at, updated_at
		from app.support_in_app_notification
		where recipient_scope in ${tx(scopes)}
		order by created_at desc, id desc
	`;
	let startIndex = 0;
	if (cursor) {
		const idx = allRows.findIndex((r) => r.id === cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
		startIndex = idx + 1;
	}
	const page = allRows.slice(startIndex, startIndex + limit);
	const hasMore = startIndex + limit < allRows.length;
	return {
		data: page.map(projectNotification),
		pagination: {
			next_cursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
			has_more: hasMore,
		},
	};
}

export async function updateSupportNotificationState(
	tx: TransactionSql,
	request: Request,
	identity: LocalAuth,
	notificationIdParam: string,
	value: unknown,
) {
	if (request.headers.has("x-order-token"))
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	const key = mutationKey(request);
	const actor = await resolveSupportCustomer(tx, request, identity);
	const notificationId = id(notificationIdParam);
	const body = object(value, ["expected_version", "state"]);
	const expectedVersion = integer(body.expected_version, 1);
	const nextState = text(body.state, 20);
	if (!["seen", "dismissed"].includes(nextState)) throw invalid();

	const requestHash = digest(
		JSON.stringify({ expectedVersion, state: nextState }),
	);
	const prior = await checkOperation(
		tx,
		actor.scope,
		`support.notification:${notificationId}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	const scopes =
		actor.kind === "user" && actor.linkedGuestIds.length > 0
			? [actor.scope, ...actor.linkedGuestIds.map((g) => `guest_support:${g}`)]
			: [actor.scope];
	const [row] = await tx<
		{
			id: string;
			conversation_id: string | null;
			kind: string;
			state: "unread" | "seen" | "dismissed";
			created_at: string;
			updated_at: string;
		}[]
	>`
		select id, conversation_id, kind, state, created_at, updated_at
		from app.support_in_app_notification
		where id = ${notificationId} and recipient_scope in ${tx(scopes)}
		for update
	`;
	if (!row) throw new AccessError(404, "NOT_FOUND");
	const currentVersion =
		row.state === "unread" ? 1 : row.state === "seen" ? 2 : 3;
	if (expectedVersion !== currentVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	if (row.state === "dismissed" && nextState === "seen") {
		throw new AccessError(409, "INVALID_NOTIFICATION_STATE");
	}
	const [updated] = await tx<
		{
			id: string;
			conversation_id: string | null;
			kind: string;
			state: "unread" | "seen" | "dismissed";
			created_at: string;
			updated_at: string;
		}[]
	>`
		update app.support_in_app_notification
		set state = ${nextState}, updated_at = clock_timestamp()
		where id = ${row.id}
		returning id, conversation_id, kind, state, created_at, updated_at
	`;
	const response = projectNotification(updated);
	await saveOperation(
		tx,
		actor.scope,
		`support.notification:${notificationId}`,
		key,
		requestHash,
		response,
	);
	return response;
}

export async function readPublicSupportEvents(
	tx: TransactionSql,
	request: Request,
	conversation: ConversationRow,
	url: URL,
) {
	for (const k of url.searchParams.keys()) {
		if (
			!["cursor", "limit"].includes(k) ||
			url.searchParams.getAll(k).length !== 1
		)
			throw invalid();
	}
	const limitRaw = url.searchParams.get("limit") ?? "20";
	if (!/^\d{1,3}$/.test(limitRaw)) throw invalid();
	const limit = integer(Number(limitRaw), 1, 100);
	const queryCursor = url.searchParams.get("cursor");
	const headerCursor = request.headers.get("last-event-id");
	if (
		queryCursor !== null &&
		headerCursor !== null &&
		queryCursor !== headerCursor
	) {
		throw new AccessError(400, "CURSOR_MISMATCH");
	}
	const effectiveCursor = queryCursor ?? headerCursor;
	let afterSequence = 0;
	if (effectiveCursor !== null) {
		if (effectiveCursor.startsWith("expired:")) {
			throw new AccessError(409, "CURSOR_EXPIRED");
		}
		const prefixStr = `evt:${conversation.id}:`;
		if (!effectiveCursor.startsWith(prefixStr)) {
			throw new AccessError(400, "INVALID_CURSOR");
		}
		const seqPart = effectiveCursor.slice(prefixStr.length);
		if (!/^\d+$/.test(seqPart)) throw new AccessError(400, "INVALID_CURSOR");
		afterSequence = integer(Number(seqPart), 0);
		if (afterSequence > conversation.public_sequence) {
			throw new AccessError(409, "CURSOR_EXPIRED");
		}
	}

	const rows = await tx<MessageRow[]>`
		select *
		from app.support_message
		where conversation_id = ${conversation.id}
		  and public_sequence > ${afterSequence}
		order by public_sequence asc
		limit ${limit + 1}
	`;
	const hasMore = rows.length > limit;
	const page = rows.slice(0, limit);
	const events = [];
	for (const msgRow of page) {
		const projected = await projectMessage(tx, msgRow, conversation);
		events.push({
			cursor: `evt:${conversation.id}:${msgRow.public_sequence}`,
			kind: "message" as const,
			conversation_id: conversation.id,
			message: projected,
		});
	}
	const nextCursor =
		hasMore && events.length > 0 ? events[events.length - 1].cursor : null;
	return {
		events,
		page: {
			data: events,
			pagination: {
				next_cursor: nextCursor,
				has_more: hasMore,
			},
		},
	};
}

export function formatSseStream(
	events: readonly { cursor: string; kind: string }[],
) {
	let out = ": heartbeat\n\n";
	for (const ev of events) {
		out += `id: ${ev.cursor}\nevent: ${ev.kind}\ndata: ${JSON.stringify(ev)}\n\n`;
	}
	return out;
}

export async function listStaffSupportInbox(
	tx: TransactionSql,
	principal: Principal,
	url: URL,
) {
	const allowedKeys = [
		"cursor",
		"limit",
		"assignment",
		"status",
		"tag_id",
		"priority",
		"unread",
		"assignee_user_id",
		"age_from",
	];
	for (const k of url.searchParams.keys()) {
		if (!allowedKeys.includes(k) || url.searchParams.getAll(k).length !== 1)
			throw invalid();
	}
	const limitRaw = url.searchParams.get("limit") ?? "20";
	if (!/^\d{1,3}$/.test(limitRaw)) throw invalid();
	const limit = integer(Number(limitRaw), 1, 100);
	const cursor = url.searchParams.has("cursor")
		? id(url.searchParams.get("cursor"))
		: null;
	const assignment = url.searchParams.get("assignment") ?? "unassigned";
	if (!["unassigned", "assigned_to_me", "all"].includes(assignment))
		throw invalid();
	const status = url.searchParams.get("status");
	if (
		status !== null &&
		!["open", "waiting_customer", "resolved"].includes(status)
	)
		throw invalid();
	const tagId = url.searchParams.has("tag_id")
		? id(url.searchParams.get("tag_id"))
		: null;
	const priority = url.searchParams.get("priority");
	if (priority !== null && !["low", "normal", "high"].includes(priority))
		throw invalid();
	const unreadParam = url.searchParams.get("unread");
	if (unreadParam !== null && !["true", "false"].includes(unreadParam))
		throw invalid();
	const assigneeUserId = url.searchParams.has("assignee_user_id")
		? text(url.searchParams.get("assignee_user_id"), 200)
		: null;
	const ageFromRaw = url.searchParams.get("age_from");
	if (ageFromRaw !== null && Number.isNaN(Date.parse(ageFromRaw)))
		throw invalid();

	const assignmentFilter =
		assignment === "unassigned"
			? tx`and c.assigned_user_id is null`
			: assignment === "assigned_to_me"
				? tx`and c.assigned_user_id = ${principal.id}`
				: tx``;
	const statusFilter = status ? tx`and c.status = ${status}` : tx``;
	const priorityFilter = priority ? tx`and c.priority = ${priority}` : tx``;
	const assigneeFilter = assigneeUserId
		? tx`and c.assigned_user_id = ${assigneeUserId}`
		: tx``;
	const tagFilter = tagId
		? tx`and exists (
				select 1 from app.support_conversation_tag ct
				where ct.conversation_id = c.id and ct.tag_id = ${tagId}
			)`
		: tx``;
	const ageFilter = ageFromRaw
		? tx`and c.created_at >= ${new Date(ageFromRaw).toISOString()}`
		: tx``;

	const allRows = await tx<ConversationRow[]>`
		select c.*
		from app.support_conversation c
		where true
		  ${assignmentFilter}
		  ${statusFilter}
		  ${priorityFilter}
		  ${assigneeFilter}
		  ${tagFilter}
		  ${ageFilter}
		order by coalesce(c.last_public_message_at, c.created_at) desc, c.id desc
	`;

	const projectedAll = [];
	for (const row of allRows) {
		const item = await projectStaffConversation(tx, row, principal.id);
		if (unreadParam === "true" && item.current_agent_unread_messages === 0)
			continue;
		if (unreadParam === "false" && item.current_agent_unread_messages > 0)
			continue;
		projectedAll.push(item);
	}

	let startIndex = 0;
	if (cursor) {
		const idx = projectedAll.findIndex(
			(item) => item.conversation.id === cursor,
		);
		if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
		startIndex = idx + 1;
	}
	const page = projectedAll.slice(startIndex, startIndex + limit);
	const hasMore = startIndex + limit < projectedAll.length;
	return {
		data: page,
		pagination: {
			next_cursor:
				hasMore && page.length > 0
					? page[page.length - 1].conversation.id
					: null,
			has_more: hasMore,
		},
	};
}

export async function claimStaffConversation(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const body = object(value, ["expected_version"]);
	const expectedVersion = integer(body.expected_version, 1);
	const conv = await requireStaffConversation(tx, conversationIdParam, true);
	const requestHash = digest(JSON.stringify({ expectedVersion }));
	const prior = await checkOperation(
		tx,
		principal.id,
		`support.claim:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return projectStaffConversation(tx, conv, principal.id);

	if (
		conv.assigned_user_id !== null &&
		conv.assigned_user_id !== principal.id
	) {
		throw new AccessError(409, "ALREADY_CLAIMED");
	}
	if (conv.revision !== expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	if (conv.assigned_user_id === principal.id) {
		const result = await projectStaffConversation(tx, conv, principal.id);
		await saveOperation(
			tx,
			principal.id,
			`support.claim:${conv.id}`,
			key,
			requestHash,
			{ ok: true },
		);
		return result;
	}
	const nextRevision = conv.revision + 1;
	const [updated] = await tx<ConversationRow[]>`
		update app.support_conversation
		set assigned_user_id = ${principal.id},
		    revision = ${nextRevision}
		where id = ${conv.id}
		returning *
	`;
	await tx`
		insert into app.support_assignment_event (
			conversation_id, revision, kind, previous_user_id, assigned_user_id, actor_id, reason
		)
		values (
			${conv.id}, ${nextRevision}, 'claim', null, ${principal.id}, ${principal.id}, 'Claimed conversation'
		)
	`;
	await saveOperation(
		tx,
		principal.id,
		`support.claim:${conv.id}`,
		key,
		requestHash,
		{ ok: true },
	);
	return projectStaffConversation(tx, updated, principal.id);
}

export async function assignStaffConversation(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const body = object(value, [
		"expected_version",
		"assignee_user_id",
		"reason",
	]);
	const expectedVersion = integer(body.expected_version, 1);
	const assigneeUserId =
		body.assignee_user_id === null ? null : text(body.assignee_user_id, 200);
	const reason = text(body.reason, 500);
	const conv = await requireStaffConversation(tx, conversationIdParam, true);

	const requestHash = digest(
		JSON.stringify({ expectedVersion, assigneeUserId, reason }),
	);
	const prior = await checkOperation(
		tx,
		principal.id,
		`support.assign:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return projectStaffConversation(tx, conv, principal.id);

	if (
		!principal.roles.includes("owner") &&
		conv.assigned_user_id !== principal.id
	) {
		throw new AccessError(403, "CLAIM_REQUIRED");
	}
	if (conv.revision !== expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	if (assigneeUserId !== null) {
		const [targetGrant] = await tx<{ roles: string[] }[]>`
			select g.roles
			from app.auth_user u
			join app.role_grant g on g.user_id = u.id
			where u.id = ${assigneeUserId}
		`;
		if (
			!targetGrant ||
			(!targetGrant.roles.includes("customer_service") &&
				!targetGrant.roles.includes("owner"))
		) {
			throw new AccessError(403, "INVALID_ASSIGNEE_ROLE");
		}
	}
	const nextRevision = conv.revision + 1;
	const [updated] = await tx<ConversationRow[]>`
		update app.support_conversation
		set assigned_user_id = ${assigneeUserId},
		    revision = ${nextRevision}
		where id = ${conv.id}
		returning *
	`;
	await tx`
		insert into app.support_assignment_event (
			conversation_id, revision, kind, previous_user_id, assigned_user_id, actor_id, reason
		)
		values (
			${conv.id},
			${nextRevision},
			${assigneeUserId === null ? "release" : "handoff"},
			${conv.assigned_user_id},
			${assigneeUserId},
			${principal.id},
			${reason}
		)
	`;
	await saveOperation(
		tx,
		principal.id,
		`support.assign:${conv.id}`,
		key,
		requestHash,
		{ ok: true },
	);
	return projectStaffConversation(tx, updated, principal.id);
}

export async function setStaffConversationStatus(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const body = object(value, ["expected_version", "status", "reason"]);
	const expectedVersion = integer(body.expected_version, 1);
	const status = text(body.status, 30) as
		| "open"
		| "waiting_customer"
		| "resolved";
	if (!["open", "waiting_customer", "resolved"].includes(status))
		throw invalid();
	const reason = text(body.reason, 500);
	const conv = await requireStaffConversation(tx, conversationIdParam, true);

	const requestHash = digest(
		JSON.stringify({ expectedVersion, status, reason }),
	);
	const prior = await checkOperation(
		tx,
		principal.id,
		`support.status:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return projectStaffConversation(tx, conv, principal.id);

	if (
		!principal.roles.includes("owner") &&
		conv.assigned_user_id !== principal.id
	) {
		throw new AccessError(403, "CLAIM_REQUIRED");
	}
	if (conv.revision !== expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	const nextRevision = conv.revision + 1;
	const [updated] = await tx<ConversationRow[]>`
		update app.support_conversation
		set status = ${status},
		    revision = ${nextRevision}
		where id = ${conv.id}
		returning *
	`;
	await tx`
		insert into app.support_assignment_event (
			conversation_id, revision, kind, previous_user_id, assigned_user_id, actor_id, reason
		)
		values (
			${conv.id},
			${nextRevision},
			${`status:${status}`},
			${conv.assigned_user_id},
			${conv.assigned_user_id},
			${principal.id},
			${reason}
		)
	`;
	await saveOperation(
		tx,
		principal.id,
		`support.status:${conv.id}`,
		key,
		requestHash,
		{ ok: true },
	);
	return projectStaffConversation(tx, updated, principal.id);
}

export async function addStaffInternalNote(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const conv = await requireStaffConversation(tx, conversationIdParam, false);
	const body = object(value, ["text"]);
	const noteText = text(body.text, 4000);
	const requestHash = digest(JSON.stringify({ text: noteText }));

	const [existing] = await tx<
		{
			id: string;
			conversation_id: string;
			author_user_id: string;
			request_hash: string;
			body: string;
			created_at: string;
		}[]
	>`
		select *
		from app.support_internal_note
		where conversation_id = ${conv.id}
		  and author_user_id = ${principal.id}
		  and client_note_id = ${key}
	`;
	if (existing) {
		if (existing.request_hash !== requestHash)
			throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
		return {
			id: existing.id,
			conversation_id: existing.conversation_id,
			author_id: existing.author_user_id,
			text: existing.body,
			created_at: new Date(existing.created_at).toISOString(),
		};
	}

	const [inserted] = await tx<
		{
			id: string;
			conversation_id: string;
			author_user_id: string;
			body: string;
			created_at: string;
		}[]
	>`
		insert into app.support_internal_note (
			conversation_id, author_user_id, client_note_id, request_hash, body
		)
		values (${conv.id}, ${principal.id}, ${key}, ${requestHash}, ${noteText})
		returning id, conversation_id, author_user_id, body, created_at
	`;
	return {
		id: inserted.id,
		conversation_id: inserted.conversation_id,
		author_id: inserted.author_user_id,
		text: inserted.body,
		created_at: new Date(inserted.created_at).toISOString(),
	};
}

export async function listStaffInternalNotes(
	tx: TransactionSql,
	conversationIdParam: string,
	url: URL,
) {
	const conv = await requireStaffConversation(tx, conversationIdParam, false);
	for (const k of url.searchParams.keys()) {
		if (
			!["cursor", "limit"].includes(k) ||
			url.searchParams.getAll(k).length !== 1
		)
			throw invalid();
	}
	const limitRaw = url.searchParams.get("limit") ?? "20";
	if (!/^\d{1,3}$/.test(limitRaw)) throw invalid();
	const limit = integer(Number(limitRaw), 1, 100);
	const cursor = url.searchParams.has("cursor")
		? id(url.searchParams.get("cursor"))
		: null;

	const allRows = await tx<
		{
			id: string;
			conversation_id: string;
			author_user_id: string;
			body: string;
			created_at: string;
		}[]
	>`
		select id, conversation_id, author_user_id, body, created_at
		from app.support_internal_note
		where conversation_id = ${conv.id}
		order by created_at asc, id asc
	`;
	let startIndex = 0;
	if (cursor) {
		const idx = allRows.findIndex((r) => r.id === cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
		startIndex = idx + 1;
	}
	const page = allRows.slice(startIndex, startIndex + limit);
	const hasMore = startIndex + limit < allRows.length;
	return {
		data: page.map((r) => ({
			id: r.id,
			conversation_id: r.conversation_id,
			author_id: r.author_user_id,
			text: r.body,
			created_at: new Date(r.created_at).toISOString(),
		})),
		pagination: {
			next_cursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
			has_more: hasMore,
		},
	};
}

export async function searchStaffInternalNotes(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const conv = await requireStaffConversation(tx, conversationIdParam, false);
	const body = object(value, ["query", "cursor", "limit"]);
	const query = text(body.query, 200);
	const limit = body.limit !== undefined ? integer(body.limit, 1, 100) : 20;
	const cursor = body.cursor !== undefined ? id(body.cursor) : null;

	const requestHash = digest(JSON.stringify({ query, cursor, limit }));
	const prior = await checkOperation(
		tx,
		principal.id,
		`support.note.search:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	const pattern = `%${query.toLowerCase()}%`;
	const allRows = await tx<
		{
			id: string;
			conversation_id: string;
			author_user_id: string;
			body: string;
			created_at: string;
		}[]
	>`
		select id, conversation_id, author_user_id, body, created_at
		from app.support_internal_note
		where conversation_id = ${conv.id}
		  and lower(body) like ${pattern}
		order by created_at asc, id asc
	`;
	let startIndex = 0;
	if (cursor) {
		const idx = allRows.findIndex((r) => r.id === cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
		startIndex = idx + 1;
	}
	const page = allRows.slice(startIndex, startIndex + limit);
	const hasMore = startIndex + limit < allRows.length;
	const response = {
		data: page.map((r) => ({
			id: r.id,
			conversation_id: r.conversation_id,
			author_id: r.author_user_id,
			text: r.body,
			created_at: new Date(r.created_at).toISOString(),
		})),
		pagination: {
			next_cursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
			has_more: hasMore,
		},
	};
	await saveOperation(
		tx,
		principal.id,
		`support.note.search:${conv.id}`,
		key,
		requestHash,
		response,
	);
	return response;
}

export async function getStaffClassification(
	tx: TransactionSql,
	conversationIdParam: string,
) {
	const conv = await requireStaffConversation(tx, conversationIdParam, false);
	const tags = await tx<{ tag_id: string; created_at: string }[]>`
		select tag_id, created_at
		from app.support_conversation_tag
		where conversation_id = ${conv.id}
		order by tag_id asc
	`;
	const latestTagAt = tags.reduce(
		(max, t) => (new Date(t.created_at) > new Date(max) ? t.created_at : max),
		conv.created_at,
	);
	return {
		conversation_id: conv.id,
		version: conv.revision,
		tag_ids: tags.map((t) => t.tag_id),
		priority: conv.priority,
		updated_at: new Date(latestTagAt).toISOString(),
	};
}

export async function setStaffClassification(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const conv = await requireStaffConversation(tx, conversationIdParam, true);
	const body = object(value, [
		"expected_version",
		"tag_ids",
		"priority",
		"reason",
	]);
	const expectedVersion = integer(body.expected_version, 1);
	const tagIds = array(body.tag_ids, (v) => id(v), 0, 20);
	if (new Set(tagIds).size !== tagIds.length) throw invalid();
	const priority = text(body.priority, 20) as "low" | "normal" | "high";
	if (!["low", "normal", "high"].includes(priority)) throw invalid();
	const reason = text(body.reason, 500);

	const requestHash = digest(
		JSON.stringify({ expectedVersion, tagIds, priority, reason }),
	);
	const prior = await checkOperation(
		tx,
		principal.id,
		`support.classification:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	if (conv.revision !== expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	if (tagIds.length > 0) {
		const validTags = await tx<{ id: string }[]>`
			select id from app.support_tag where id in ${tx(tagIds)} and enabled = true
		`;
		if (validTags.length !== tagIds.length) {
			throw new AccessError(400, "INVALID_TAG");
		}
	}
	const nextRevision = conv.revision + 1;
	const priorTags = await tx<{ tag_id: string }[]>`
		select tag_id from app.support_conversation_tag
		where conversation_id = ${conv.id}
		order by tag_id asc
	`;
	await tx`
		update app.support_conversation
		set priority = ${priority},
		    revision = ${nextRevision}
		where id = ${conv.id}
	`;
	await tx`delete from app.support_conversation_tag where conversation_id = ${conv.id}`;
	for (const tid of tagIds) {
		await tx`
			insert into app.support_conversation_tag (conversation_id, tag_id, actor_id)
			values (${conv.id}, ${tid}, ${principal.id})
		`;
	}
	const [clock] = await tx<{ now: string }[]>`select clock_timestamp() as now`;
	const response = {
		conversation_id: conv.id,
		version: nextRevision,
		tag_ids: [...tagIds].sort(),
		priority,
		updated_at: new Date(clock.now).toISOString(),
	};
	await tx`
		insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
		values (
			${principal.id},
			'support.classification.set',
			${conv.id},
			'allowed',
			${reason},
			${JSON.stringify({
				version: nextRevision,
				before: {
					priority: conv.priority,
					tag_ids: priorTags.map((t) => t.tag_id),
				},
				after: { priority, tag_ids: response.tag_ids },
			})}::jsonb
		)
	`;
	await saveOperation(
		tx,
		principal.id,
		`support.classification:${conv.id}`,
		key,
		requestHash,
		response,
	);
	return response;
}

export async function listSupportSavedReplies(tx: TransactionSql, url: URL) {
	for (const k of url.searchParams.keys()) {
		if (
			!["cursor", "limit"].includes(k) ||
			url.searchParams.getAll(k).length !== 1
		)
			throw invalid();
	}
	const limitRaw = url.searchParams.get("limit") ?? "20";
	if (!/^\d{1,3}$/.test(limitRaw)) throw invalid();
	const limit = integer(Number(limitRaw), 1, 100);
	const cursor = url.searchParams.has("cursor")
		? id(url.searchParams.get("cursor"))
		: null;

	const allRows = await tx<
		{
			id: string;
			title: string;
			body_template: string;
			placeholders: string[];
			enabled: boolean;
			revision: number;
		}[]
	>`
		select id, title, body_template, placeholders, enabled, revision
		from app.support_saved_reply
		order by title asc, id asc
	`;
	let startIndex = 0;
	if (cursor) {
		const idx = allRows.findIndex((r) => r.id === cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
		startIndex = idx + 1;
	}
	const page = allRows.slice(startIndex, startIndex + limit);
	const hasMore = startIndex + limit < allRows.length;
	return {
		data: page.map((r) => ({
			id: r.id,
			version: r.revision,
			title: r.title,
			text: r.body_template,
			placeholders: r.placeholders,
			enabled: r.enabled,
		})),
		pagination: {
			next_cursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
			has_more: hasMore,
		},
	};
}

function parseSavedReplyInput(value: unknown) {
	const body = object(value, [
		"expected_version",
		"title",
		"text",
		"placeholders",
		"enabled",
		"reason",
	]);
	const expectedVersion = integer(body.expected_version, 0);
	const title = text(body.title, 120);
	const templateText = text(body.text, 4000);
	const placeholders = array(
		body.placeholders,
		(v) => {
			const s = text(v, 40);
			if (
				!ALLOWED_PLACEHOLDERS.includes(
					s as (typeof ALLOWED_PLACEHOLDERS)[number],
				)
			)
				throw invalid();
			return s;
		},
		0,
		10,
	);
	if (new Set(placeholders).size !== placeholders.length) throw invalid();
	const matches = [...templateText.matchAll(/\{\{([a-z0-9_]+)\}\}/gi)].map(
		(m) => m[1],
	);
	for (const token of matches) {
		if (
			!ALLOWED_PLACEHOLDERS.includes(
				token as (typeof ALLOWED_PLACEHOLDERS)[number],
			)
		) {
			throw invalid();
		}
	}
	if (typeof body.enabled !== "boolean") throw invalid();
	const reason = text(body.reason, 500);
	return {
		expectedVersion,
		title,
		templateText,
		placeholders,
		enabled: body.enabled,
		reason,
	};
}

// lazy: support definitions have no *_version table; the immutable audit row keeps
// each prior/next snapshot until a dedicated version table exists.
async function auditSupportDefinition(
	tx: TransactionSql,
	actorId: string,
	action: string,
	subjectId: string,
	reason: string,
	details: Record<string, unknown>,
) {
	await tx`
		insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
		values (${actorId}, ${action}, ${subjectId}, 'allowed', ${reason}, ${JSON.stringify(details)}::jsonb)
	`;
}

export async function createOrUpdateSavedReply(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	definitionIdParam: string | null,
	value: unknown,
) {
	if (!canManageSupportTools(principal)) {
		throw new AccessError(403, "FORBIDDEN");
	}
	const key = mutationKey(request);
	const parsed = parseSavedReplyInput(value);
	const requestHash = digest(JSON.stringify({ definitionIdParam, ...parsed }));
	const action = definitionIdParam
		? `support.saved_reply.version:${definitionIdParam}`
		: "support.saved_reply.create";
	const prior = await checkOperation(
		tx,
		principal.id,
		action,
		key,
		requestHash,
	);
	if (prior) return prior;

	if (definitionIdParam === null) {
		if (parsed.expectedVersion !== 0)
			throw new AccessError(409, "VERSION_CONFLICT");
		const defId = randomUUID();
		const [inserted] = await tx<
			{
				id: string;
				title: string;
				body_template: string;
				placeholders: string[];
				enabled: boolean;
				revision: number;
			}[]
		>`
			insert into app.support_saved_reply (
				id, slug, title, body_template, placeholders, enabled, revision, actor_id
			)
			values (
				${defId},
				${slugify(parsed.title, defId)},
				${parsed.title},
				${parsed.templateText},
				${JSON.stringify(parsed.placeholders)}::jsonb,
				${parsed.enabled},
				1,
				${principal.id}
			)
			returning id, title, body_template, placeholders, enabled, revision
		`;
		const response = {
			id: inserted.id,
			version: inserted.revision,
			title: inserted.title,
			text: inserted.body_template,
			placeholders: inserted.placeholders,
			enabled: inserted.enabled,
		};
		await auditSupportDefinition(
			tx,
			principal.id,
			"support.saved_reply.create",
			inserted.id,
			parsed.reason,
			{ version: inserted.revision, before: null, after: response },
		);
		await saveOperation(tx, principal.id, action, key, requestHash, response);
		return response;
	}

	const defId = id(definitionIdParam);
	const [existing] = await tx<
		{
			id: string;
			title: string;
			body_template: string;
			placeholders: string[];
			enabled: boolean;
			revision: number;
		}[]
	>`
		select id, title, body_template, placeholders, enabled, revision
		from app.support_saved_reply where id = ${defId} for update
	`;
	if (!existing) throw new AccessError(404, "NOT_FOUND");
	if (existing.revision !== parsed.expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	const nextRevision = existing.revision + 1;
	const [updated] = await tx<
		{
			id: string;
			title: string;
			body_template: string;
			placeholders: string[];
			enabled: boolean;
			revision: number;
		}[]
	>`
		update app.support_saved_reply
		set title = ${parsed.title},
		    body_template = ${parsed.templateText},
		    placeholders = ${JSON.stringify(parsed.placeholders)}::jsonb,
		    enabled = ${parsed.enabled},
		    revision = ${nextRevision},
		    actor_id = ${principal.id},
		    updated_at = clock_timestamp()
		where id = ${defId}
		returning id, title, body_template, placeholders, enabled, revision
	`;
	const response = {
		id: updated.id,
		version: updated.revision,
		title: updated.title,
		text: updated.body_template,
		placeholders: updated.placeholders,
		enabled: updated.enabled,
	};
	await auditSupportDefinition(
		tx,
		principal.id,
		"support.saved_reply.version",
		updated.id,
		parsed.reason,
		{
			version: updated.revision,
			before: {
				id: existing.id,
				version: existing.revision,
				title: existing.title,
				text: existing.body_template,
				placeholders: existing.placeholders,
				enabled: existing.enabled,
			},
			after: response,
		},
	);
	await saveOperation(tx, principal.id, action, key, requestHash, response);
	return response;
}

export async function previewSavedReplyDraft(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	conversationIdParam: string,
	value: unknown,
) {
	const key = mutationKey(request);
	const conv = await requireStaffConversation(tx, conversationIdParam, false);
	if (conv.assigned_user_id !== principal.id) {
		throw new AccessError(409, "CLAIM_REQUIRED");
	}
	const body = object(value, ["saved_reply_id", "saved_reply_version"]);
	const savedReplyId = id(body.saved_reply_id);
	const savedReplyVersion = integer(body.saved_reply_version, 1);
	const requestHash = digest(
		JSON.stringify({ savedReplyId, savedReplyVersion }),
	);
	const prior = await checkOperation(
		tx,
		principal.id,
		`support.saved_reply.preview:${conv.id}`,
		key,
		requestHash,
	);
	if (prior) return prior;

	const [template] = await tx<
		{
			id: string;
			body_template: string;
			placeholders: string[];
			enabled: boolean;
			revision: number;
		}[]
	>`
		select id, body_template, placeholders, enabled, revision
		from app.support_saved_reply
		where id = ${savedReplyId}
	`;
	if (!template?.enabled) throw new AccessError(404, "NOT_FOUND");
	if (template.revision !== savedReplyVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}

	let customerName: string | null = null;
	if (conv.buyer_user_id) {
		const [profile] = await tx<{ display_name: string }[]>`
			select display_name from app.buyer_profile where user_id = ${conv.buyer_user_id}
		`;
		if (profile?.display_name) {
			customerName = profile.display_name;
		} else {
			const [u] = await tx<{ name: string }[]>`
				select name from app.auth_user where id = ${conv.buyer_user_id}
			`;
			customerName = u?.name ?? null;
		}
	}

	let productTitle: string | null = null;
	if (conv.primary_product_id) {
		const [prod] = await tx<{ name: string }[]>`
			select pv.name
			from app.publication_head ph
			join app.publication_version pub
				on pub.product_id = ph.product_id and pub.revision = ph.revision
			join app.product_revision pv
				on pv.product_id = ph.product_id and pv.revision = pub.product_revision
			where ph.product_id = ${conv.primary_product_id} and ph.revision > 0
				and not exists (select 1 from app.publication_withdrawal w where w.publication_id = pub.id)
		`;
		productTitle = prod?.name ?? null;
	}

	let orderReference: string | null = null;
	if (conv.primary_order_id) {
		const [ord] = await tx<{ number: string }[]>`
			select number from app.commerce_order where id = ${conv.primary_order_id}
		`;
		orderReference = ord?.number ?? null;
	}

	const values: Record<string, string | null> = {
		customer_name: customerName,
		product_title: productTitle,
		order_reference: orderReference,
	};

	const unresolved = new Set<string>();
	let rendered = template.body_template;
	for (const pName of ALLOWED_PLACEHOLDERS) {
		const token = `{{${pName}}}`;
		if (rendered.includes(token) || template.placeholders.includes(pName)) {
			const resolved = values[pName];
			if (resolved) {
				rendered = rendered.replaceAll(token, resolved);
			} else {
				unresolved.add(pName);
			}
		}
	}
	const unresolvedList = [...unresolved];
	const response = {
		text: rendered,
		unresolved_placeholders: unresolvedList,
		can_send: unresolvedList.length === 0 && rendered.trim().length > 0,
	};
	await saveOperation(
		tx,
		principal.id,
		`support.saved_reply.preview:${conv.id}`,
		key,
		requestHash,
		response,
	);
	return response;
}

export async function listSupportTags(tx: TransactionSql, url: URL) {
	for (const k of url.searchParams.keys()) {
		if (
			!["cursor", "limit"].includes(k) ||
			url.searchParams.getAll(k).length !== 1
		)
			throw invalid();
	}
	const limitRaw = url.searchParams.get("limit") ?? "20";
	if (!/^\d{1,3}$/.test(limitRaw)) throw invalid();
	const limit = integer(Number(limitRaw), 1, 100);
	const cursor = url.searchParams.has("cursor")
		? id(url.searchParams.get("cursor"))
		: null;

	const allRows = await tx<
		{ id: string; label: string; enabled: boolean; revision: number }[]
	>`
		select id, label, enabled, revision
		from app.support_tag
		order by label asc, id asc
	`;
	let startIndex = 0;
	if (cursor) {
		const idx = allRows.findIndex((r) => r.id === cursor);
		if (idx === -1) throw new AccessError(400, "INVALID_CURSOR");
		startIndex = idx + 1;
	}
	const page = allRows.slice(startIndex, startIndex + limit);
	const hasMore = startIndex + limit < allRows.length;
	return {
		data: page.map((r) => ({
			id: r.id,
			version: r.revision,
			label: r.label,
			enabled: r.enabled,
		})),
		pagination: {
			next_cursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
			has_more: hasMore,
		},
	};
}

export async function createOrUpdateSupportTag(
	tx: TransactionSql,
	request: Request,
	principal: Principal,
	definitionIdParam: string | null,
	value: unknown,
) {
	if (!canManageSupportTools(principal)) {
		throw new AccessError(403, "FORBIDDEN");
	}
	const key = mutationKey(request);
	const body = object(value, [
		"expected_version",
		"label",
		"enabled",
		"reason",
	]);
	const expectedVersion = integer(body.expected_version, 0);
	const label = text(body.label, 80);
	if (typeof body.enabled !== "boolean") throw invalid();
	const enabled = body.enabled;
	const reason = text(body.reason, 500);

	const requestHash = digest(
		JSON.stringify({
			definitionIdParam,
			expectedVersion,
			label,
			enabled,
			reason,
		}),
	);
	const action = definitionIdParam
		? `support.tag.version:${definitionIdParam}`
		: "support.tag.create";
	const prior = await checkOperation(
		tx,
		principal.id,
		action,
		key,
		requestHash,
	);
	if (prior) return prior;

	if (definitionIdParam === null) {
		if (expectedVersion !== 0) throw new AccessError(409, "VERSION_CONFLICT");
		const tagId = randomUUID();
		const [inserted] = await tx<
			{ id: string; label: string; enabled: boolean; revision: number }[]
		>`
			insert into app.support_tag (id, slug, label, enabled, revision, actor_id)
			values (${tagId}, ${slugify(label, tagId)}, ${label}, ${enabled}, 1, ${principal.id})
			returning id, label, enabled, revision
		`;
		const response = {
			id: inserted.id,
			version: inserted.revision,
			label: inserted.label,
			enabled: inserted.enabled,
		};
		await auditSupportDefinition(
			tx,
			principal.id,
			"support.tag.create",
			inserted.id,
			reason,
			{ version: inserted.revision, before: null, after: response },
		);
		await saveOperation(tx, principal.id, action, key, requestHash, response);
		return response;
	}

	const tagId = id(definitionIdParam);
	const [existing] = await tx<
		{ id: string; label: string; enabled: boolean; revision: number }[]
	>`
		select id, label, enabled, revision from app.support_tag where id = ${tagId} for update
	`;
	if (!existing) throw new AccessError(404, "NOT_FOUND");
	if (existing.revision !== expectedVersion) {
		throw new AccessError(409, "VERSION_CONFLICT");
	}
	const nextRevision = existing.revision + 1;
	const [updated] = await tx<
		{ id: string; label: string; enabled: boolean; revision: number }[]
	>`
		update app.support_tag
		set label = ${label},
		    enabled = ${enabled},
		    revision = ${nextRevision},
		    actor_id = ${principal.id},
		    updated_at = clock_timestamp()
		where id = ${tagId}
		returning id, label, enabled, revision
	`;
	const response = {
		id: updated.id,
		version: updated.revision,
		label: updated.label,
		enabled: updated.enabled,
	};
	await auditSupportDefinition(
		tx,
		principal.id,
		"support.tag.version",
		updated.id,
		reason,
		{
			version: updated.revision,
			before: {
				id: existing.id,
				version: existing.revision,
				label: existing.label,
				enabled: existing.enabled,
			},
			after: response,
		},
	);
	await saveOperation(tx, principal.id, action, key, requestHash, response);
	return response;
}
