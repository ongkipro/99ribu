import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { appOrigin } from "../../config/runtime.ts";
import { sniffImageOrMp4ContentType, scanImagePayload } from "../../storage/media-sniff.ts";
import {
	deletePrivateArtifact,
	savePrivateArtifact,
} from "../../storage/private.ts";
import type { LocalAuth } from "../access/auth.ts";
import {
	assertOrigin,
	privateJson,
	problem,
	readBody,
	requestOrigin,
} from "../access/http.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import { LIMITS, rateLimit } from "../access/rate-limit.ts";
import { id, integer, invalid, object, text } from "../catalog/validation.ts";

function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") throw invalid();
	return value;
}

import { actorScope, commerceActor, digest, mac, prefix, setCookie } from "../checkout/access.ts";
import { intentHash, mutationKey } from "../checkout/carts.ts";
import { type OrderRow, projectOrder } from "../checkout/orders.ts";
import { authorizeOrderOrContinuity } from "../orders/receipt.ts";
import { projectBuyerReturn } from "../returns/cases.ts";
import { clean, normalizePhone } from "../shipping/address.ts";

function normalizeIndonesianPhone(value: unknown): string {
	const phone = normalizePhone(value);
	if (!/^\+628[1-9][0-9]{6,11}$/.test(phone)) {
		throw new AccessError(422, "INVALID_INDONESIAN_PHONE");
	}
	return phone;
}

export type BuyerProfileResponse = {
	id: string;
	display_name: string;
	email: string | null;
	phone: string | null;
	email_verified: boolean;
	phone_verified: boolean;
	version: number;
};

export type BuyerAddressResponse = {
	id: string;
	version: number;
	address: {
		recipient_name: string;
		phone: string;
		street: string;
		district: string;
		city: string;
		province: string;
		postcode: string;
		subdistrict?: string;
		destination_code?: string;
		rt_rw?: string;
		landmark?: string;
		label?: string;
	};
	is_default: boolean;
};

export type BuyerAddressListResponse = {
	data: BuyerAddressResponse[];
	pagination: { next_cursor: string | null };
	book_version: number;
};

export type NotificationPreferenceResponse = {
	version: number;
	in_app_order_updates: boolean;
	in_app_support_updates: boolean;
	email_order_updates: boolean;
};

export type PrivateNotificationResponse = {
	id: string;
	kind: "order_update" | "return_update" | "support_reply";
	title: string;
	body: string;
	state: "unread" | "read";
	created_at: string;
};

type BuyerProfileRow = {
	user_id: string;
	display_name: string;
	phone: string | null;
	phone_verified_at: string | null;
	email: string | null;
	address_book_revision: number;
	default_address_id: string | null;
	revision: number;
	updated_at: string;
	user_email_verified: boolean;
};

type BuyerAddressRow = {
	id: string;
	user_id: string;
	label: string | null;
	recipient_name: string;
	phone: string;
	street: string;
	province: string;
	city: string;
	district: string;
	subdistrict: string;
	postcode: string;
	destination_code: string | null;
	rt_rw: string | null;
	landmark: string | null;
	is_default: boolean;
	deleted_at: string | null;
	revision: number;
	created_at: string;
	updated_at: string;
};

function parsePagination(url: URL) {
	for (const name of url.searchParams.keys()) {
		if (
			!["cursor", "limit"].includes(name) ||
			url.searchParams.getAll(name).length !== 1
		) {
			throw invalid();
		}
	}
	const raw = url.searchParams.get("limit") ?? "20";
	if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(raw)) throw invalid();
	return {
		limit: integer(Number(raw), 1, 100),
		cursor: url.searchParams.has("cursor")
			? id(url.searchParams.get("cursor"))
			: null,
	};
}

// Raw evidence body, refused as soon as it passes the granted size.
async function readUploadBytes(request: Request, maxBytes: number) {
	const reader = request.body?.getReader();
	if (!reader) throw new AccessError(400, "INVALID_INPUT");
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		size += chunk.value.byteLength;
		if (size > maxBytes) {
			await reader.cancel();
			throw new AccessError(413, "BODY_TOO_LARGE");
		}
		chunks.push(chunk.value);
	}
	return new Uint8Array(Buffer.concat(chunks));
}

// The code is keyed by the server secret: the public challenge id alone must never
// derive it. The simulated notification adapter (and tests) read it with the same key.
export async function challengeVerificationCode(
	identity: LocalAuth,
	challengeId: string,
): Promise<string> {
	const key = await mac(identity, "buyer-challenge-otp", [challengeId]);
	const numeric =
		(Buffer.from(key, "base64url").readUInt32BE(0) % 900000) + 100000;
	return String(numeric);
}

async function challengeDigest(
	identity: LocalAuth,
	challengeId: string,
	code: string,
): Promise<string> {
	return mac(identity, "buyer-challenge-digest", [challengeId, code]);
}

// Consume one attempt atomically before comparing, so parallel guesses cannot exceed the cap.
async function reserveChallengeAttempt(
	identity: LocalAuth,
	table: "support_challenge" | "buyer_identity_challenge",
	challengeId: string,
): Promise<number | null> {
	const pending =
		table === "support_challenge"
			? identity.sql`verified_at is null`
			: identity.sql`status = 'pending'`;
	const [row] = await identity.sql<{ attempts: number }[]>`
		update ${identity.sql(`app.${table}`)}
		set attempts = attempts + 1
		where id = ${challengeId} and ${pending}
			and attempts < 5 and expires_at > clock_timestamp()
		returning attempts
	`;
	return row ? Number(row.attempts) : null;
}

async function ensureBuyerProfile(
	tx: TransactionSql,
	principal: Principal,
	lock = false,
): Promise<BuyerProfileRow> {
	const [authUser] = await tx<{ name: string | null; email: string | null }[]>`
		select name, email from app.auth_user where id = ${principal.id}
	`;
	const fallbackName = authUser?.name?.trim() || "Pembeli";
	const initialEmail = authUser?.email?.trim() || null;
	await tx`
		insert into app.buyer_profile (user_id, display_name, email)
		values (${principal.id}, ${fallbackName.slice(0, 120)}, ${initialEmail})
		on conflict (user_id) do nothing
	`;
	const rows = lock
		? await tx<BuyerProfileRow[]>`
			select p.*, u.email_verified as user_email_verified
			from app.buyer_profile p
			join app.auth_user u on u.id = p.user_id
			where p.user_id = ${principal.id}
			for update of p
		`
		: await tx<BuyerProfileRow[]>`
			select p.*, u.email_verified as user_email_verified
			from app.buyer_profile p
			join app.auth_user u on u.id = p.user_id
			where p.user_id = ${principal.id}
		`;
	if (!rows[0]) throw new AccessError(404, "NOT_FOUND");
	return rows[0];
}

function formatBuyerProfile(row: BuyerProfileRow): BuyerProfileResponse {
	return {
		id: row.user_id,
		display_name: row.display_name,
		email: row.email ?? null,
		phone: row.phone ?? null,
		email_verified: Boolean(row.email && row.user_email_verified),
		phone_verified: Boolean(row.phone && row.phone_verified_at),
		version: Number(row.revision),
	};
}

function formatBuyerAddress(row: BuyerAddressRow): BuyerAddressResponse {
	return {
		id: String(row.id),
		version: Number(row.revision),
		address: {
			recipient_name: row.recipient_name,
			phone: row.phone,
			street: row.street,
			district: row.district,
			city: row.city,
			province: row.province,
			postcode: row.postcode,
			...(row.subdistrict ? { subdistrict: row.subdistrict } : {}),
			...(row.destination_code
				? { destination_code: row.destination_code }
				: {}),
			...(row.rt_rw ? { rt_rw: row.rt_rw } : {}),
			...(row.landmark ? { landmark: row.landmark } : {}),
			...(row.label ? { label: row.label } : {}),
		},
		is_default: Boolean(row.is_default),
	};
}

function parseShippingAddressInput(value: unknown) {
	const raw = object(value, [
		"recipient_name",
		"phone",
		"street",
		"rt_rw",
		"subdistrict",
		"district",
		"city",
		"province",
		"postcode",
		"destination_code",
		"landmark",
		"label",
	]);
	const recipient_name = clean(raw.recipient_name, 120);
	const phone = normalizeIndonesianPhone(raw.phone);
	const street = clean(raw.street, 240);
	const district = clean(raw.district, 80);
	const subdistrict =
		raw.subdistrict !== undefined &&
		raw.subdistrict !== null &&
		String(raw.subdistrict).trim() !== ""
			? clean(raw.subdistrict, 80)
			: district;
	const city = clean(raw.city, 80);
	const province = clean(raw.province, 80);
	const postcode = clean(raw.postcode, 10);
	if (!/^[0-9]{5}$/.test(postcode)) {
		throw new AccessError(422, "INVALID_POSTCODE");
	}
	const opt = (v: unknown, max: number) =>
		v === undefined || v === null || String(v).trim() === ""
			? null
			: clean(v, max);
	return {
		recipient_name,
		phone,
		street,
		district,
		subdistrict,
		city,
		province,
		postcode,
		destination_code: opt(raw.destination_code, 80),
		rt_rw: opt(raw.rt_rw, 32),
		landmark: opt(raw.landmark, 160),
		label: opt(raw.label, 80),
	};
}

async function checkIdempotency<T>(
	tx: TransactionSql,
	actorId: string,
	action: string,
	key: string,
	hash: string,
): Promise<T | null> {
	const [existing] = await tx<{ request_hash: string; response: T }[]>`
		select request_hash, response
		from app.access_operation
		where actor_id = ${actorId} and action = ${action} and key = ${key}
	`;
	if (!existing) return null;
	if (existing.request_hash !== hash) {
		throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
	}
	return existing.response;
}

async function saveIdempotency<T>(
	tx: TransactionSql,
	actorId: string,
	action: string,
	key: string,
	hash: string,
	subjectId: string | null,
	reason: string,
	response: T,
	details: Record<string, unknown> = {},
): Promise<T> {
	await tx`
		insert into app.access_operation (actor_id, action, key, request_hash, response)
		values (${actorId}, ${action}, ${key}, ${hash}, ${JSON.stringify(response)}::jsonb)
	`;
	await tx`
		insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
		values (
			${actorId.startsWith("guest:") ? null : actorId},
			${action},
			${subjectId},
			'allowed',
			${reason},
			${JSON.stringify(details)}::jsonb
		)
	`;
	return response;
}

async function listActiveAddresses(
	tx: TransactionSql,
	userId: string,
	limit = 20,
	cursor: string | null = null,
	bookVersion: number,
): Promise<BuyerAddressListResponse> {
	if (cursor) {
		const [anchor] = await tx<{ created_at: string }[]>`
			select created_at::text
			from app.buyer_address
			where id = ${cursor} and user_id = ${userId} and deleted_at is null
		`;
		if (!anchor) throw invalid();
		const rows = await tx<BuyerAddressRow[]>`
			select *
			from app.buyer_address
			where user_id = ${userId}
				and deleted_at is null
				and (created_at, id) < (${anchor.created_at}::timestamptz, ${cursor}::uuid)
			order by is_default desc, created_at desc, id desc
			limit ${limit + 1}
		`;
		const slice = rows.slice(0, limit);
		return {
			data: slice.map(formatBuyerAddress),
			pagination: {
				next_cursor:
					rows.length > limit ? String(slice.at(-1)?.id ?? null) : null,
			},
			book_version: Number(bookVersion),
		};
	}
	const rows = await tx<BuyerAddressRow[]>`
		select *
		from app.buyer_address
		where user_id = ${userId} and deleted_at is null
		order by is_default desc, created_at desc, id desc
		limit ${limit + 1}
	`;
	const slice = rows.slice(0, limit);
	return {
		data: slice.map(formatBuyerAddress),
		pagination: {
			next_cursor:
				rows.length > limit ? String(slice.at(-1)?.id ?? null) : null,
		},
		book_version: Number(bookVersion),
	};
}

function normalizeEmailValue(raw: unknown): string {
	const value = text(raw, 254).normalize("NFC").trim().toLowerCase();
	if (
		!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
			value,
		)
	) {
		throw invalid();
	}
	return value;
}

function normalizeContactReference(raw: unknown): {
	channel: "phone" | "email";
	value: string;
} {
	const str = text(raw, 254).trim();
	if (str.includes("@")) {
		return { channel: "email", value: normalizeEmailValue(str) };
	}
	return { channel: "phone", value: normalizeIndonesianPhone(str) };
}

async function assertOrderContactMatches(
	tx: TransactionSql,
	orderId: string,
	contact: { channel: "phone" | "email"; value: string },
) {
	const [row] = await tx<
		{
			id: string;
			owner_guest_id: string | null;
			contact_phone: string | null;
			address_phone: string | null;
			contact_email: string | null;
		}[]
	>`
		select
			o.id,
			o.owner_guest_id,
			q.document->'contact'->>'phone' as contact_phone,
			q.document->'address'->>'phone' as address_phone,
			q.document->'contact'->>'email' as contact_email
		from app.commerce_order o
		join app.checkout_quote q on q.id = o.quote_id
		where o.id = ${orderId}
	`;
	if (!row) throw new AccessError(404, "NOT_FOUND");
	if (contact.channel === "phone") {
		const phones = [row.contact_phone, row.address_phone]
			.filter((v): v is string => Boolean(v))
			.map((v) => {
				try {
					return normalizeIndonesianPhone(v);
				} catch {
					return v;
				}
			});
		if (!phones.includes(contact.value)) {
			throw new AccessError(403, "ORDER_CONTACT_MISMATCH");
		}
	} else {
		const email = row.contact_email?.trim().toLowerCase() ?? null;
		if (!email || email !== contact.value) {
			throw new AccessError(403, "ORDER_CONTACT_MISMATCH");
		}
	}
	return row;
}

export async function createBuyerNotification(
	tx: TransactionSql,
	input: {
		userId: string;
		eventKey: string;
		kind: "order_update" | "return_update" | "support_reply";
		title: string;
		body: string;
		conversationId?: string | null;
	},
): Promise<PrivateNotificationResponse | null> {
	await tx`
		insert into app.buyer_notification_preference (user_id)
		values (${input.userId})
		on conflict (user_id) do nothing
	`;
	const [pref] = await tx<
		{
			order_updates_in_app: boolean;
			support_replies_in_app: boolean;
		}[]
	>`
		select order_updates_in_app, support_replies_in_app
		from app.buyer_notification_preference
		where user_id = ${input.userId}
	`;
	if (
		(input.kind === "order_update" || input.kind === "return_update") &&
		pref &&
		!pref.order_updates_in_app
	) {
		return null;
	}
	if (input.kind === "support_reply" && pref && !pref.support_replies_in_app) {
		return null;
	}
	const scope = `user:${input.userId}`;
	const [inserted] = await tx<
		{
			id: string;
			kind: "order_update" | "return_update" | "support_reply";
			title: string;
			summary: string;
			state: "unread" | "read";
			created_at: string;
		}[]
	>`
		insert into app.support_in_app_notification (
			recipient_scope,
			event_key,
			conversation_id,
			kind,
			title,
			summary,
			state
		)
		values (
			${scope},
			${input.eventKey},
			${input.conversationId ?? null},
			${input.kind},
			${input.title.slice(0, 200)},
			${input.body.slice(0, 1000)},
			'unread'
		)
		on conflict (recipient_scope, event_key) do update
			set updated_at = app.support_in_app_notification.updated_at
		returning id, kind, title, summary, state, created_at
	`;
	if (!inserted) return null;
	return {
		id: String(inserted.id),
		kind: inserted.kind,
		title: inserted.title,
		body: inserted.summary,
		state: inserted.state,
		created_at: new Date(inserted.created_at).toISOString(),
	};
}

async function ensureOrderNotifications(
	tx: TransactionSql,
	userId: string,
	orderUpdatesEnabled: boolean,
) {
	if (!orderUpdatesEnabled) return;
	const orders = await tx<{ id: string; number: string; status: string }[]>`
		select o.id, o.number, o.status
		from app.commerce_order o
		where o.owner_user_id = ${userId}
			or exists (
				select 1 from app.buyer_identity_challenge c
				where c.user_id = ${userId}
					and c.kind = 'guest_order_link'
					and c.status = 'verified'
					and c.order_id = o.id
			)
		order by o.created_at desc
		limit 10
	`;
	for (const ord of orders) {
		await createBuyerNotification(tx, {
			userId,
			eventKey: `order:${ord.id}:${ord.status}`,
			kind: "order_update",
			title: `Pesanan ${ord.number}`,
			body: `Status pesanan ${ord.number}: ${ord.status}.`,
		});
	}
}

export async function readBuyerAccountWorkspace(
	request: Request,
	identity: LocalAuth,
) {
	try {
		const principal = await getPrincipal(request, identity);
		return await identity.sql.begin(async (tx) => {
			const profileRow = await ensureBuyerProfile(tx, principal, false);
			const profile = formatBuyerProfile(profileRow);
			const addresses = await listActiveAddresses(
				tx,
				principal.id,
				50,
				null,
				profileRow.address_book_revision,
			);
			await tx`
				insert into app.buyer_notification_preference (user_id)
				values (${principal.id})
				on conflict (user_id) do nothing
			`;
			const [prefRow] = await tx<
				{
					revision: number;
					order_updates_in_app: boolean;
					support_replies_in_app: boolean;
					order_updates_email: boolean;
				}[]
			>`
				select revision, order_updates_in_app, support_replies_in_app, order_updates_email
				from app.buyer_notification_preference
				where user_id = ${principal.id}
			`;
			const preferences: NotificationPreferenceResponse = {
				version: Number(prefRow?.revision ?? 1),
				in_app_order_updates: Boolean(prefRow?.order_updates_in_app ?? true),
				in_app_support_updates: Boolean(
					prefRow?.support_replies_in_app ?? true,
				),
				email_order_updates: Boolean(prefRow?.order_updates_email ?? true),
			};
			await ensureOrderNotifications(
				tx,
				principal.id,
				preferences.in_app_order_updates,
			);
			const notifRows = await tx<
				{
					id: string;
					kind: "order_update" | "return_update" | "support_reply";
					title: string;
					summary: string;
					state: "unread" | "read";
					created_at: string;
				}[]
			>`
				select id, kind, title, summary, state, created_at
				from app.support_in_app_notification
				where recipient_scope in (${`user:${principal.id}`}, ${principal.id})
				order by created_at desc, id desc
				limit 20
			`;
			const notifications: PrivateNotificationResponse[] = notifRows.map(
				(row) => ({
					id: String(row.id),
					kind: row.kind,
					title: row.title,
					body: row.summary,
					state: row.state,
					created_at: new Date(row.created_at).toISOString(),
				}),
			);
			const orderRows = await tx<{ id: string }[]>`
				select o.id
				from app.commerce_order o
				where o.owner_user_id = ${principal.id}
					or exists (
						select 1 from app.buyer_identity_challenge c
						where c.user_id = ${principal.id}
							and c.kind = 'guest_order_link'
							and c.status = 'verified'
							and c.order_id = o.id
					)
				order by o.created_at desc, o.id desc
				limit 20
			`;
			const orders = [];
			for (const row of orderRows) {
				orders.push(await projectOrder(tx, row.id));
			}
			return {
				authenticated: true as const,
				profile,
				addresses,
				preferences,
				notifications,
				orders,
			};
		});
	} catch {
		return {
			authenticated: false as const,
			profile: null,
			addresses: null,
			preferences: null,
			notifications: [],
			orders: [],
		};
	}
}

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

		// 1. Public guest-order-access challenge & verification
		if (url.pathname === "/api/v1/guest-order-access/challenges") {
			if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
			const key = mutationKey(request);
			const body = object(await readBody(request), ["order_id", "contact"]);
			const orderId = id(body.order_id);
			const contact = normalizeContactReference(body.contact);
			const hash = await intentHash(identity, "guest_order_access.challenge", {
				orderId,
				contact,
			});
			const actorKey = `guest_access:${orderId}`;
			// Counted in autocommit so contact mismatches (which roll back) still spend budget.
			await rateLimit(
				identity.sql,
				`guest-access-challenge-order:${orderId}`,
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
				const order = await assertOrderContactMatches(tx, orderId, contact);
				const challengeId = randomUUID();
				const code = await challengeVerificationCode(identity, challengeId);
				const codeHash = await challengeDigest(identity, challengeId, code);
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
						${`guest:${order.owner_guest_id ?? order.id}`},
						${contact.value},
						${order.id},
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
					code_digest: string;
					attempts: number;
					verified_at: string | null;
					expires_at: string;
				}[]
			>`
				select id, order_id, code_digest, attempts, verified_at, expires_at
				from app.support_challenge
				where id = ${challengeId} and kind = 'guest_order_access'
			`;
			if (!challengeRow?.order_id) {
				throw new AccessError(404, "NOT_FOUND");
			}
			const expectedDigest = await challengeDigest(identity, challengeId, code);
			if (!challengeRow.verified_at) {
				await rateLimit(
					identity.sql,
					`guest-access-verify-order:${challengeRow.order_id}`,
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
				if (challengeRow.code_digest !== expectedDigest) {
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
				const hash = await intentHash(identity, "buyer.profile.update", {
					expectedVersion,
					displayName,
					...(optionalEmail !== undefined ? { email: optionalEmail } : {}),
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
					await tx`
						update app.buyer_profile
						set
							display_name = ${displayName},
							email = ${nextEmail},
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

		// 4. Address book list & create: GET / POST /api/v1/me/addresses
		if (url.pathname === "/api/v1/me/addresses") {
			if (request.method === "GET") {
				const paging = parsePagination(url);
				const list = await identity.sql.begin(async (tx) => {
					const profile = await ensureBuyerProfile(tx, principal, false);
					return listActiveAddresses(
						tx,
						principal.id,
						paging.limit,
						paging.cursor,
						profile.address_book_revision,
					);
				});
				return privateJson(list, 200);
			}
			if (request.method === "POST") {
				const key = mutationKey(request);
				const body = object(await readBody(request), [
					"address",
					"make_default",
					"expected_book_version",
				]);
				const validated = parseShippingAddressInput(body.address);
				const makeDefault =
					body.make_default === undefined ? false : boolean(body.make_default);
				const expectedBookVersion =
					body.expected_book_version === undefined
						? undefined
						: integer(body.expected_book_version, 0, 2147483647);
				const hash = await intentHash(identity, "buyer.address.create", {
					address: validated,
					makeDefault,
					...(expectedBookVersion !== undefined ? { expectedBookVersion } : {}),
				});
				const created = await identity.sql.begin(async (tx) => {
					const prior = await checkIdempotency<BuyerAddressResponse>(
						tx,
						principal.id,
						"buyer.address.create",
						key,
						hash,
					);
					if (prior) return prior;
					const profile = await ensureBuyerProfile(tx, principal, true);
					if (
						expectedBookVersion !== undefined &&
						Number(profile.address_book_revision) !== expectedBookVersion
					) {
						throw new AccessError(409, "ADDRESS_BOOK_VERSION_CONFLICT");
					}
					const [countRow] = await tx<{ n: number }[]>`
						select count(*)::int as n
						from app.buyer_address
						where user_id = ${principal.id} and deleted_at is null
					`;
					const isFirst = (countRow?.n ?? 0) === 0;
					const isDefault = isFirst || makeDefault;
					if (isDefault) {
						await tx`
							update app.buyer_address
							set is_default = false, updated_at = clock_timestamp()
							where user_id = ${principal.id} and deleted_at is null and is_default = true
						`;
					}
					const addressId = randomUUID();
					const [inserted] = await tx<BuyerAddressRow[]>`
						insert into app.buyer_address (
							id,
							user_id,
							label,
							recipient_name,
							phone,
							street,
							province,
							city,
							district,
							subdistrict,
							postcode,
							destination_code,
							rt_rw,
							landmark,
							is_default,
							revision
						)
						values (
							${addressId},
							${principal.id},
							${validated.label ?? ""},
							${validated.recipient_name},
							${validated.phone},
							${validated.street},
							${validated.province},
							${validated.city},
							${validated.district},
							${validated.subdistrict},
							${validated.postcode},
							${validated.destination_code ?? ""},
							${validated.rt_rw ?? null},
							${validated.landmark ?? null},
							${isDefault},
							1
						)
						returning *
					`;
					await tx`
						update app.buyer_profile
						set
							address_book_revision = address_book_revision + 1,
							default_address_id = ${isDefault ? addressId : profile.default_address_id},
							updated_at = clock_timestamp()
						where user_id = ${principal.id}
					`;
					const response = formatBuyerAddress(inserted);
					return saveIdempotency(
						tx,
						principal.id,
						"buyer.address.create",
						key,
						hash,
						addressId,
						"Created buyer shipping address",
						response,
					);
				});
				return privateJson(created, 201);
			}
			throw new AccessError(404, "NOT_FOUND");
		}

		// 5. Default address switch: POST /api/v1/me/address-default
		if (url.pathname === "/api/v1/me/address-default") {
			if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
			const key = mutationKey(request);
			const body = object(await readBody(request), [
				"expected_book_version",
				"address_id",
			]);
			const expectedBookVersion = integer(
				body.expected_book_version,
				0,
				2147483647,
			);
			const addressId = id(body.address_id);
			const hash = await intentHash(identity, "buyer.address.default", {
				expectedBookVersion,
				addressId,
			});
			const list = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<BuyerAddressListResponse>(
					tx,
					principal.id,
					"buyer.address.default",
					key,
					hash,
				);
				if (prior) return prior;
				const profile = await ensureBuyerProfile(tx, principal, true);
				if (Number(profile.address_book_revision) !== expectedBookVersion) {
					throw new AccessError(409, "ADDRESS_BOOK_VERSION_CONFLICT");
				}
				const [target] = await tx<BuyerAddressRow[]>`
					select * from app.buyer_address
					where id = ${addressId} and user_id = ${principal.id} and deleted_at is null
					for update
				`;
				if (!target) throw new AccessError(404, "NOT_FOUND");
				await tx`
					update app.buyer_address
					set is_default = false, updated_at = clock_timestamp()
					where user_id = ${principal.id} and deleted_at is null and id <> ${addressId} and is_default = true
				`;
				await tx`
					update app.buyer_address
					set is_default = true, revision = revision + 1, updated_at = clock_timestamp()
					where id = ${addressId}
				`;
				const [updatedProfile] = await tx<{ address_book_revision: number }[]>`
					update app.buyer_profile
					set
						address_book_revision = address_book_revision + 1,
						default_address_id = ${addressId},
						updated_at = clock_timestamp()
					where user_id = ${principal.id}
					returning address_book_revision
				`;
				const response = await listActiveAddresses(
					tx,
					principal.id,
					20,
					null,
					updatedProfile.address_book_revision,
				);
				return saveIdempotency(
					tx,
					principal.id,
					"buyer.address.default",
					key,
					hash,
					addressId,
					"Switched default buyer address",
					response,
				);
			});
			return privateJson(list, 201);
		}

		// 6. Address item read, update, and soft-delete: /api/v1/me/addresses/[addressId](/deletions)
		const addressMatch =
			/^\/api\/v1\/me\/addresses\/([^/]+)(?:\/(deletions))?$/.exec(
				url.pathname,
			);
		if (addressMatch) {
			const addressId = id(addressMatch[1]);
			const isDeletion = addressMatch[2] === "deletions";
			if (!isDeletion && request.method === "GET") {
				if (url.search) throw invalid();
				const item = await identity.sql.begin(async (tx) => {
					const [row] = await tx<BuyerAddressRow[]>`
						select * from app.buyer_address
						where id = ${addressId} and user_id = ${principal.id} and deleted_at is null
					`;
					if (!row) throw new AccessError(404, "NOT_FOUND");
					return formatBuyerAddress(row);
				});
				return privateJson(item, 200);
			}
			if (!isDeletion && request.method === "POST") {
				const key = mutationKey(request);
				const body = object(await readBody(request), [
					"expected_version",
					"address",
				]);
				const expectedVersion = integer(body.expected_version, 1, 2147483647);
				const validated = parseShippingAddressInput(body.address);
				const hash = await intentHash(identity, "buyer.address.update", {
					addressId,
					expectedVersion,
					address: validated,
				});
				const updated = await identity.sql.begin(async (tx) => {
					const prior = await checkIdempotency<BuyerAddressResponse>(
						tx,
						principal.id,
						"buyer.address.update",
						key,
						hash,
					);
					if (prior) return prior;
					await ensureBuyerProfile(tx, principal, true);
					const [existing] = await tx<BuyerAddressRow[]>`
						select * from app.buyer_address
						where id = ${addressId} and user_id = ${principal.id} and deleted_at is null
						for update
					`;
					if (!existing) throw new AccessError(404, "NOT_FOUND");
					if (Number(existing.revision) !== expectedVersion) {
						throw new AccessError(409, "ADDRESS_VERSION_CONFLICT");
					}
					const [row] = await tx<BuyerAddressRow[]>`
						update app.buyer_address
						set
							label = ${validated.label ?? ""},
							recipient_name = ${validated.recipient_name},
							phone = ${validated.phone},
							street = ${validated.street},
							province = ${validated.province},
							city = ${validated.city},
							district = ${validated.district},
							subdistrict = ${validated.subdistrict},
							postcode = ${validated.postcode},
							destination_code = ${validated.destination_code ?? ""},
							rt_rw = ${validated.rt_rw ?? null},
							landmark = ${validated.landmark ?? null},
							revision = revision + 1,
							updated_at = clock_timestamp()
						where id = ${addressId}
						returning *
					`;
					await tx`
						update app.buyer_profile
						set address_book_revision = address_book_revision + 1, updated_at = clock_timestamp()
						where user_id = ${principal.id}
					`;
					const response = formatBuyerAddress(row);
					return saveIdempotency(
						tx,
						principal.id,
						"buyer.address.update",
						key,
						hash,
						addressId,
						"Updated buyer shipping address",
						response,
					);
				});
				return privateJson(updated, 201);
			}
			if (isDeletion && request.method === "POST") {
				const key = mutationKey(request);
				const body = object(await readBody(request), [
					"expected_version",
					"expected_book_version",
					"replacement_default_id",
					"replacement_default_address_id",
				]);
				const expectedVersion = integer(body.expected_version, 1, 2147483647);
				const expectedBookVersion = integer(
					body.expected_book_version,
					0,
					2147483647,
				);
				const rawReplacement =
					body.replacement_default_id ??
					body.replacement_default_address_id ??
					null;
				const replacementId =
					rawReplacement === null ? null : id(rawReplacement);
				const hash = await intentHash(identity, "buyer.address.delete", {
					addressId,
					expectedVersion,
					expectedBookVersion,
					replacementId,
				});
				const ack = await identity.sql.begin(async (tx) => {
					const prior = await checkIdempotency<{
						id: string;
						version: number;
						status: string;
						as_of: string;
					}>(tx, principal.id, "buyer.address.delete", key, hash);
					if (prior) return prior;
					const profile = await ensureBuyerProfile(tx, principal, true);
					if (Number(profile.address_book_revision) !== expectedBookVersion) {
						throw new AccessError(409, "ADDRESS_BOOK_VERSION_CONFLICT");
					}
					const [existing] = await tx<BuyerAddressRow[]>`
						select * from app.buyer_address
						where id = ${addressId} and user_id = ${principal.id} and deleted_at is null
						for update
					`;
					if (!existing) throw new AccessError(404, "NOT_FOUND");
					if (Number(existing.revision) !== expectedVersion) {
						throw new AccessError(409, "ADDRESS_VERSION_CONFLICT");
					}
					const others = await tx<{ id: string }[]>`
						select id from app.buyer_address
						where user_id = ${principal.id} and deleted_at is null and id <> ${addressId}
						for update
					`;
					let nextDefaultId = profile.default_address_id;
					if (existing.is_default) {
						if (others.length > 0) {
							if (
								!replacementId ||
								!others.some((o) => String(o.id) === replacementId)
							) {
								throw new AccessError(409, "DEFAULT_REPLACEMENT_REQUIRED");
							}
							await tx`
								update app.buyer_address
								set is_default = true, revision = revision + 1, updated_at = clock_timestamp()
								where id = ${replacementId}
							`;
							nextDefaultId = replacementId;
						} else {
							if (replacementId !== null) {
								throw new AccessError(409, "INVALID_DEFAULT_REPLACEMENT");
							}
							nextDefaultId = null;
						}
					} else if (replacementId !== null) {
						throw new AccessError(409, "INVALID_DEFAULT_REPLACEMENT");
					}
					const [deleted] = await tx<
						{ revision: number; updated_at: string }[]
					>`
						update app.buyer_address
						set
							is_default = false,
							deleted_at = clock_timestamp(),
							revision = revision + 1,
							updated_at = clock_timestamp()
						where id = ${addressId}
						returning revision, updated_at
					`;
					await tx`
						update app.buyer_profile
						set
							address_book_revision = address_book_revision + 1,
							default_address_id = ${nextDefaultId},
							updated_at = clock_timestamp()
						where user_id = ${principal.id}
					`;
					const response = {
						id: addressId,
						version: Number(deleted.revision),
						status: "deleted",
						as_of: new Date(deleted.updated_at).toISOString(),
					};
					return saveIdempotency(
						tx,
						principal.id,
						"buyer.address.delete",
						key,
						hash,
						addressId,
						"Soft-deleted buyer shipping address",
						response,
					);
				});
				return privateJson(ack, 201);
			}
			throw new AccessError(404, "NOT_FOUND");
		}

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
				// Signed-in callers are bounded per user; the order budget is shared with the public path.
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
					await assertOrderContactMatches(tx, orderId, contact);
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
							${orderId},
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
			if (!challengeRow?.order_id) {
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

		// 9. Notification preferences: GET / POST /api/v1/me/notification-preferences
		if (url.pathname === "/api/v1/me/notification-preferences") {
			if (request.method === "GET") {
				if (url.search) throw invalid();
				const pref = await identity.sql.begin(async (tx) => {
					await tx`
						insert into app.buyer_notification_preference (user_id)
						values (${principal.id})
						on conflict (user_id) do nothing
					`;
					const [row] = await tx<
						{
							revision: number;
							order_updates_in_app: boolean;
							support_replies_in_app: boolean;
							order_updates_email: boolean;
						}[]
					>`
						select revision, order_updates_in_app, support_replies_in_app, order_updates_email
						from app.buyer_notification_preference
						where user_id = ${principal.id}
					`;
					return {
						version: Number(row.revision),
						in_app_order_updates: Boolean(row.order_updates_in_app),
						in_app_support_updates: Boolean(row.support_replies_in_app),
						email_order_updates: Boolean(row.order_updates_email),
					};
				});
				return privateJson(pref, 200);
			}
			if (request.method === "POST") {
				const key = mutationKey(request);
				const body = object(await readBody(request), [
					"expected_version",
					"in_app_order_updates",
					"in_app_support_updates",
					"email_order_updates",
				]);
				const expectedVersion = integer(body.expected_version, 1, 2147483647);
				const inAppOrderUpdates = boolean(body.in_app_order_updates);
				const inAppSupportUpdates = boolean(body.in_app_support_updates);
				const emailOrderUpdates = boolean(body.email_order_updates);
				const hash = await intentHash(
					identity,
					"buyer.notification_preferences.update",
					{
						expectedVersion,
						inAppOrderUpdates,
						inAppSupportUpdates,
						emailOrderUpdates,
					},
				);
				const updated = await identity.sql.begin(async (tx) => {
					const prior = await checkIdempotency<NotificationPreferenceResponse>(
						tx,
						principal.id,
						"buyer.notification_preferences.update",
						key,
						hash,
					);
					if (prior) return prior;
					await tx`
						insert into app.buyer_notification_preference (user_id)
						values (${principal.id})
						on conflict (user_id) do nothing
					`;
					const [current] = await tx<{ revision: number }[]>`
						select revision from app.buyer_notification_preference
						where user_id = ${principal.id}
						for update
					`;
					if (!current || Number(current.revision) !== expectedVersion) {
						throw new AccessError(409, "PREFERENCE_VERSION_CONFLICT");
					}
					const [row] = await tx<
						{
							revision: number;
							order_updates_in_app: boolean;
							support_replies_in_app: boolean;
							order_updates_email: boolean;
						}[]
					>`
						update app.buyer_notification_preference
						set
							order_updates_in_app = ${inAppOrderUpdates},
							support_replies_in_app = ${inAppSupportUpdates},
							order_updates_email = ${emailOrderUpdates},
							revision = revision + 1,
							updated_at = clock_timestamp()
						where user_id = ${principal.id}
						returning revision, order_updates_in_app, support_replies_in_app, order_updates_email
					`;
					const response: NotificationPreferenceResponse = {
						version: Number(row.revision),
						in_app_order_updates: Boolean(row.order_updates_in_app),
						in_app_support_updates: Boolean(row.support_replies_in_app),
						email_order_updates: Boolean(row.order_updates_email),
					};
					return saveIdempotency(
						tx,
						principal.id,
						"buyer.notification_preferences.update",
						key,
						hash,
						principal.id,
						"Updated buyer notification preferences",
						response,
					);
				});
				return privateJson(updated, 201);
			}
			throw new AccessError(404, "NOT_FOUND");
		}

		// 10. Notifications list & state update: /api/v1/me/notifications(/[notificationId]/state)
		if (url.pathname === "/api/v1/me/notifications") {
			if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
			const paging = parsePagination(url);
			const list = await identity.sql.begin(async (tx) => {
				const scopes = [`user:${principal.id}`, principal.id];
				await tx`
					insert into app.buyer_notification_preference (user_id)
					values (${principal.id})
					on conflict (user_id) do nothing
				`;
				const [pref] = await tx<{ order_updates_in_app: boolean }[]>`
					select order_updates_in_app from app.buyer_notification_preference
					where user_id = ${principal.id}
				`;
				await ensureOrderNotifications(
					tx,
					principal.id,
					Boolean(pref?.order_updates_in_app ?? true),
				);
				let rows: {
					id: string;
					kind: "order_update" | "return_update" | "support_reply";
					title: string;
					summary: string;
					state: "unread" | "read";
					created_at: string;
				}[];
				if (paging.cursor) {
					const [anchor] = await tx<{ created_at: string }[]>`
						select created_at::text
						from app.support_in_app_notification
						where id = ${paging.cursor} and recipient_scope in ${tx(scopes)}
					`;
					if (!anchor) throw invalid();
					rows = await tx`
						select id, kind, title, summary, state, created_at
						from app.support_in_app_notification
						where recipient_scope in ${tx(scopes)}
							and (created_at, id) < (${anchor.created_at}::timestamptz, ${paging.cursor}::uuid)
						order by created_at desc, id desc
						limit ${paging.limit + 1}
					`;
				} else {
					rows = await tx`
						select id, kind, title, summary, state, created_at
						from app.support_in_app_notification
						where recipient_scope in ${tx(scopes)}
						order by created_at desc, id desc
						limit ${paging.limit + 1}
					`;
				}
				const slice = rows.slice(0, paging.limit);
				return {
					data: slice.map((r) => ({
						id: String(r.id),
						kind: r.kind,
						title: r.title,
						body: r.summary,
						state: r.state,
						created_at: new Date(r.created_at).toISOString(),
					})),
					pagination: {
						next_cursor:
							rows.length > paging.limit
								? String(slice.at(-1)?.id ?? null)
								: null,
					},
				};
			});
			return privateJson(list, 200);
		}

		const notifStateMatch =
			/^\/api\/v1\/me\/notifications\/([^/]+)\/state$/.exec(url.pathname);
		if (notifStateMatch) {
			if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
			const notificationId = id(notifStateMatch[1]);
			const key = mutationKey(request);
			const body = object(await readBody(request), ["state"]);
			if (body.state !== "read" && body.state !== "unread") {
				throw invalid();
			}
			const nextState = body.state;
			const hash = await intentHash(identity, "buyer.notification.state", {
				notificationId,
				nextState,
			});
			const updated = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<PrivateNotificationResponse>(
					tx,
					principal.id,
					"buyer.notification.state",
					key,
					hash,
				);
				if (prior) return prior;
				const scopes = [`user:${principal.id}`, principal.id];
				const [row] = await tx<
					{
						id: string;
						kind: "order_update" | "return_update" | "support_reply";
						title: string;
						summary: string;
						state: "unread" | "read";
						created_at: string;
					}[]
				>`
					update app.support_in_app_notification
					set state = ${nextState}, updated_at = clock_timestamp()
					where id = ${notificationId} and recipient_scope in ${tx(scopes)}
					returning id, kind, title, summary, state, created_at
				`;
				if (!row) throw new AccessError(404, "NOT_FOUND");
				const response: PrivateNotificationResponse = {
					id: String(row.id),
					kind: row.kind,
					title: row.title,
					body: row.summary,
					state: row.state,
					created_at: new Date(row.created_at).toISOString(),
				};
				return saveIdempotency(
					tx,
					principal.id,
					"buyer.notification.state",
					key,
					hash,
					notificationId,
					"Updated in-app notification read state",
					response,
				);
			});
			return privateJson(updated, 201);
		}

		// 11. Session terminations: POST /api/v1/me/session-terminations
		if (url.pathname === "/api/v1/me/session-terminations") {
			if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
			const key = mutationKey(request);
			const body = object(await readBody(request), ["scope"]);
			if (body.scope !== "others" && body.scope !== "all") {
				throw invalid();
			}
			const scope = body.scope;
			const hash = await intentHash(identity, "buyer.session.terminate", {
				scope,
			});
			const ack = await identity.sql.begin(async (tx) => {
				const prior = await checkIdempotency<{
					id: string;
					version: number;
					status: string;
					as_of: string;
				}>(tx, principal.id, "buyer.session.terminate", key, hash);
				if (prior) return prior;
				if (scope === "others") {
					await tx`
						delete from app.auth_session
						where user_id = ${principal.id} and id <> ${principal.sessionId}
					`;
				} else {
					await tx`
						delete from app.auth_session
						where user_id = ${principal.id}
					`;
				}
				const [clock] = await tx<{ now: string }[]>`
					select clock_timestamp()::text as now
				`;
				const response = {
					id: principal.sessionId,
					version: 1,
					status: scope === "all" ? "terminated_all" : "terminated_others",
					as_of: new Date(clock.now).toISOString(),
				};
				return saveIdempotency(
					tx,
					principal.id,
					"buyer.session.terminate",
					key,
					hash,
					principal.id,
					`Terminated buyer sessions (${scope})`,
					response,
				);
			});
			return privateJson(ack, 201);
		}

		// 12. Buyer order history: GET /api/v1/me/orders
		if (url.pathname === "/api/v1/me/orders") {
			if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
			const paging = parsePagination(url);
			const list = await identity.sql.begin(async (tx) => {
				let rows: OrderRow[];
				if (paging.cursor) {
					const [anchor] = await tx<{ created_at: string }[]>`
						select o.created_at::text
						from app.commerce_order o
						where o.id = ${paging.cursor}
							and (
								o.owner_user_id = ${principal.id}
								or exists (
									select 1 from app.buyer_identity_challenge c
									where c.user_id = ${principal.id}
										and c.kind = 'guest_order_link'
										and c.status = 'verified'
										and c.order_id = o.id
								)
							)
					`;
					if (!anchor) throw invalid();
					rows = await tx<OrderRow[]>`
						select o.*
						from app.commerce_order o
						where (
								o.owner_user_id = ${principal.id}
								or exists (
									select 1 from app.buyer_identity_challenge c
									where c.user_id = ${principal.id}
										and c.kind = 'guest_order_link'
										and c.status = 'verified'
										and c.order_id = o.id
								)
							)
							and (o.created_at, o.id) < (${anchor.created_at}::timestamptz, ${paging.cursor}::uuid)
						order by o.created_at desc, o.id desc
						limit ${paging.limit + 1}
					`;
				} else {
					rows = await tx<OrderRow[]>`
						select o.*
						from app.commerce_order o
						where o.owner_user_id = ${principal.id}
							or exists (
								select 1 from app.buyer_identity_challenge c
								where c.user_id = ${principal.id}
									and c.kind = 'guest_order_link'
									and c.status = 'verified'
									and c.order_id = o.id
							)
						order by o.created_at desc, o.id desc
						limit ${paging.limit + 1}
					`;
				}
				const slice = rows.slice(0, paging.limit);
				const data = [];
				for (const row of slice) {
					data.push(await projectOrder(tx, row.id));
				}
				return {
					data,
					pagination: {
						next_cursor:
							rows.length > paging.limit
								? String(slice.at(-1)?.id ?? null)
								: null,
					},
				};
			});
			return privateJson(list, 200);
		}

		throw new AccessError(404, "NOT_FOUND");
	} catch (error) {
		return problem(error);
	}
}
