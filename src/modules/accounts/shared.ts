import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { id, integer, invalid, object, text } from "../catalog/validation.ts";
import { mac } from "../checkout/access.ts";
import { clean, normalizePhone } from "../shipping/address.ts";
import { isValidEmail } from "../storefront/contact.ts";

export function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") throw invalid();
	return value;
}

export function normalizeIndonesianPhone(value: unknown): string {
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

export type BuyerProfileRow = {
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
	birth_day: number | null;
	birth_month: number | null;
	birth_year: number | null;
	gender: "male" | "female" | "undisclosed" | null;
	favourite_category_ids: string[];
	details_revision: number;
};

export type BuyerAddressRow = {
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

export function parsePagination(url: URL) {
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
export async function readUploadBytes(request: Request, maxBytes: number) {
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

export async function challengeDigest(
	identity: LocalAuth,
	challengeId: string,
	code: string,
): Promise<string> {
	return mac(identity, "buyer-challenge-digest", [challengeId, code]);
}

// Consume one attempt atomically before comparing, so parallel guesses cannot exceed the cap.
export async function reserveChallengeAttempt(
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

export async function ensureBuyerProfile(
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

export function formatBuyerProfile(row: BuyerProfileRow): BuyerProfileResponse {
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

export function formatBuyerAddress(row: BuyerAddressRow): BuyerAddressResponse {
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

export function parseShippingAddressInput(value: unknown) {
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

export async function checkIdempotency<T>(
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

export async function saveIdempotency<T>(
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

// S126/DEC-017: a promo consent covers the contact the buyer saw when granting it. Call before the profile
// write; when the stored contact changes or is cleared, the active consent for that channel is withdrawn.
export async function withdrawConsentOnContactChange(
	tx: TransactionSql,
	userId: string,
	channel: "whatsapp" | "email",
	next: string | null,
) {
	await tx`
		update app.marketing_consent m
		set withdrawn_at = clock_timestamp()
		from app.buyer_profile p
		where m.user_id = ${userId} and m.channel = ${channel} and m.withdrawn_at is null
			and p.user_id = m.user_id
			and ${channel === "whatsapp" ? tx`p.phone` : tx`p.email`} is distinct from ${next}
	`;
}

export async function listActiveAddresses(
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

export function normalizeEmailValue(raw: unknown): string {
	const value = text(raw, 254).normalize("NFC").trim().toLowerCase();
	// S123: one shared email rule for every storefront contact (storefront/contact.ts).
	if (!isValidEmail(value)) throw invalid();
	return value;
}

export function normalizeContactReference(raw: unknown): {
	channel: "phone" | "email";
	value: string;
} {
	const str = text(raw, 254).trim();
	if (str.includes("@")) {
		return { channel: "email", value: normalizeEmailValue(str) };
	}
	return { channel: "phone", value: normalizeIndonesianPhone(str) };
}

// One statement whether or not the order exists (left join from a one-row seed), so a known number
// costs the same round trips as an unknown one.
export async function findOrderContactMatch(
	tx: TransactionSql,
	where: { id: string } | { number: string },
	contact: { channel: "phone" | "email"; value: string },
) {
	const [row] = await tx<OrderContactRow[]>`
		select
			o.id,
			o.owner_guest_id,
			q.document->'contact'->>'phone' as contact_phone,
			q.document->'address'->>'phone' as address_phone,
			q.document->'contact'->>'email' as contact_email
		from (select 1) seed
		left join app.commerce_order o
			on ${"id" in where ? tx`o.id = ${where.id}` : tx`o.number = ${where.number}`}
		left join app.checkout_quote q on q.id = o.quote_id
	`;
	return row?.id && orderContactMatches(row, contact) ? row : null;
}

export type OrderContactRow = {
	id: string;
	owner_guest_id: string | null;
	contact_phone: string | null;
	address_phone: string | null;
	contact_email: string | null;
};

export function orderContactMatches(
	row: OrderContactRow,
	contact: { channel: "phone" | "email"; value: string },
) {
	if (contact.channel === "email") {
		return (row.contact_email?.trim().toLowerCase() ?? null) === contact.value;
	}
	return [row.contact_phone, row.address_phone]
		.filter((v): v is string => Boolean(v))
		.map((v) => {
			try {
				return normalizeIndonesianPhone(v);
			} catch {
				return v;
			}
		})
		.includes(contact.value);
}

export async function assertOrderContactMatches(
	tx: TransactionSql,
	orderId: string,
	contact: { channel: "phone" | "email"; value: string },
) {
	const [row] = await tx<OrderContactRow[]>`
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
	if (!orderContactMatches(row, contact)) throw new AccessError(403, "ORDER_CONTACT_MISMATCH");
	return row;
}
