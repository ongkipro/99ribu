// S126 / DEC-017 buyer profile completion: optional birthday, gender and favourite categories on the buyer's own
// profile, per-channel promo consent (explicit, withdrawable, recorded with the policy version), and read-only
// aggregate segment counts for owner / e-commerce admin. Every buyer route resolves the signed-in principal and
// reads or writes only that principal's rows; no route takes a user id.
import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { assertCurrentOwner } from "../access/grants.ts";
import {
	assertOrigin,
	privateJson,
	problem,
	readBody,
} from "../access/http.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import { id, integer, invalid, object } from "../catalog/validation.ts";
import { intentHash, mutationKey } from "../checkout/carts.ts";
import { LOCAL_PRIVACY_POLICY_VERSION } from "../consent/choices.ts";
import { featuredDepartments, publicCategory } from "../storefront/catalog.ts";
import {
	type BuyerProfileRow,
	checkIdempotency,
	ensureBuyerProfile,
	saveIdempotency,
} from "./service.ts";

// Promo consent is given under the privacy policy shown on /privasi (one policy version for the site).
export const MARKETING_POLICY_VERSION = LOCAL_PRIVACY_POLICY_VERSION;
export const CONSENT_CHANNELS = ["whatsapp", "email"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export const GENDERS = ["male", "female", "undisclosed"] as const;
export type Gender = (typeof GENDERS)[number];
export const MAX_FAVOURITE_CATEGORIES = 5;
export const MINIMUM_AGE = 18;
const WIB_OFFSET_MS = 7 * 3600_000; // Asia/Jakarta, UTC+07:00, no daylight saving

// DEC-017 programs the profile fields feed. Terms (value, validity, cadence) are owner work in S127; until they are
// recorded nothing is issued. The doorprize has no entry mechanics until a Kemensos permit exists (S127).
export const PROFILE_PROGRAMS = [
	{ key: "birthday_voucher", status: "terms_pending", uses: ["birthday"] },
	{
		key: "category_promo",
		status: "terms_pending",
		uses: ["favourite_categories"],
	},
	{ key: "doorprize", status: "coming_soon", uses: [] },
] as const;

export type ProfileDetailsResponse = {
	version: number;
	birth_day: number | null;
	birth_month: number | null;
	birth_year: number | null;
	gender: Gender | null;
	favourite_category_ids: string[];
	completion: {
		completed: number;
		total: number;
		fields: {
			main_address: boolean;
			whatsapp: boolean;
			birthday: boolean;
			gender: boolean;
			favourite_categories: boolean;
		};
	};
};

export type MarketingConsentResponse = {
	policy_version: string;
	channels: {
		channel: ConsentChannel;
		granted: boolean;
		granted_at: string | null;
		policy_version: string | null;
		contact_available: boolean;
	}[];
	history: {
		channel: ConsentChannel;
		policy_version: string;
		source: "account";
		granted_at: string;
		withdrawn_at: string | null;
	}[];
};

export type BuyerSegmentsResponse = {
	as_of: string;
	profiles: number;
	birth_months: { month: number; count: number }[];
	favourite_categories: { category_id: string; name: string; count: number }[];
	consent_channels: { channel: ConsentChannel; count: number }[];
	programs: typeof PROFILE_PROGRAMS;
};

const iso = (value: string | Date | null) =>
	value === null ? null : new Date(value).toISOString();

export function formatProfileDetails(
	row: BuyerProfileRow,
): ProfileDetailsResponse {
	const fields = {
		main_address: Boolean(row.default_address_id),
		whatsapp: Boolean(row.phone),
		birthday: row.birth_day !== null,
		gender: row.gender !== null,
		favourite_categories: row.favourite_category_ids.length > 0,
	};
	return {
		version: Number(row.details_revision),
		birth_day: row.birth_day === null ? null : Number(row.birth_day),
		birth_month: row.birth_month === null ? null : Number(row.birth_month),
		birth_year: row.birth_year === null ? null : Number(row.birth_year),
		gender: row.gender,
		favourite_category_ids: row.favourite_category_ids.map(String),
		completion: {
			completed: Object.values(fields).filter(Boolean).length,
			total: Object.keys(fields).length,
			fields,
		},
	};
}

// Full replacement: every field is sent; null (or an empty list) clears it, which is how a buyer deletes data.
export function parseProfileDetails(value: unknown, now = new Date()) {
	const keys = [
		"expected_version",
		"birth_day",
		"birth_month",
		"birth_year",
		"gender",
		"favourite_category_ids",
	];
	const raw = object(value, keys);
	if (keys.some((key) => !(key in raw))) throw invalid();
	const expectedVersion = integer(raw.expected_version, 1);
	const day = raw.birth_day === null ? null : integer(raw.birth_day, 1, 31);
	const month =
		raw.birth_month === null ? null : integer(raw.birth_month, 1, 12);
	const year =
		raw.birth_year === null
			? null
			: integer(raw.birth_year, 1900, now.getUTCFullYear());
	if ((day === null) !== (month === null) || (year !== null && day === null)) {
		throw new AccessError(422, "INVALID_BIRTHDAY");
	}
	// Without a year, 29 February stays valid (checked against a leap year).
	if (day !== null && month !== null) {
		const date = new Date(Date.UTC(year ?? 2000, month - 1, day));
		if (date.getUTCMonth() !== month - 1 || date > now)
			throw new AccessError(422, "INVALID_BIRTHDAY");
	}
	// DEC-019(b): buyers are at least 18. Only a full date with a year can show an age; birth year stays optional.
	if (year !== null && day !== null && month !== null) {
		const today = new Date(now.getTime() + WIB_OFFSET_MS); // the WIB calendar date, read with UTC getters
		const age =
			today.getUTCFullYear() -
			year -
			(today.getUTCMonth() + 1 < month ||
			(today.getUTCMonth() + 1 === month && today.getUTCDate() < day)
				? 1
				: 0);
		if (age < MINIMUM_AGE) throw new AccessError(422, "UNDER_MINIMUM_AGE");
	}
	if (raw.gender !== null && !GENDERS.includes(raw.gender as Gender))
		throw invalid();
	const gender = raw.gender as Gender | null;
	if (
		!Array.isArray(raw.favourite_category_ids) ||
		raw.favourite_category_ids.length > MAX_FAVOURITE_CATEGORIES
	) {
		throw invalid();
	}
	const categories = raw.favourite_category_ids.map(id);
	if (new Set(categories).size !== categories.length) throw invalid();
	return { expectedVersion, day, month, year, gender, categories };
}

// Top-level departments of the live catalog: the only favourite categories a buyer can pick.
export const favouriteCategoryChoices = (identity: LocalAuth) =>
	featuredDepartments(identity, 30);

// The contact a promo consent may cover: the profile WhatsApp number (unverified by design, DEC-015), and for email
// only the account email its owner verified. The profile email is a free-text contact a buyer can set to anyone's
// address, so it never receives promo email on its own (R4 review).
async function consentContacts(tx: TransactionSql, row: BuyerProfileRow) {
	const [verified] =
		row.email && row.user_email_verified
			? await tx`select 1 from app.auth_user where id = ${row.user_id} and email_verified and lower(email) = lower(${row.email})`
			: [];
	return { whatsapp: Boolean(row.phone), email: Boolean(verified) };
}

async function readConsents(
	tx: TransactionSql,
	row: BuyerProfileRow,
): Promise<MarketingConsentResponse> {
	const contacts = await consentContacts(tx, row);
	const active = await tx<
		{ channel: ConsentChannel; policy_version: string; granted_at: string }[]
	>`
		select channel, policy_version, granted_at from app.marketing_consent
		where user_id = ${row.user_id} and withdrawn_at is null
	`;
	const history = await tx<
		{
			channel: ConsentChannel;
			policy_version: string;
			source: "account";
			granted_at: string;
			withdrawn_at: string | null;
		}[]
	>`
		select channel, policy_version, source, granted_at, withdrawn_at from app.marketing_consent
		where user_id = ${row.user_id}
		order by greatest(granted_at, coalesce(withdrawn_at, granted_at)) desc, id desc
		limit 20
	`;
	return {
		policy_version: MARKETING_POLICY_VERSION,
		channels: CONSENT_CHANNELS.map((channel) => {
			const current = active.find((item) => item.channel === channel);
			return {
				channel,
				granted: Boolean(current),
				granted_at: iso(current?.granted_at ?? null),
				policy_version: current?.policy_version ?? null,
				contact_available: contacts[channel],
			};
		}),
		history: history.map((item) => ({
			channel: item.channel,
			policy_version: item.policy_version,
			source: item.source,
			granted_at: iso(item.granted_at) as string,
			withdrawn_at: iso(item.withdrawn_at),
		})),
	};
}

/** The /akun server render: the signed-in buyer's details, consents and the category choices. */
export async function readProfileCompletion(
	request: Request,
	identity: LocalAuth,
) {
	const principal = await getPrincipal(request, identity);
	const [state, categories] = await Promise.all([
		identity.sql.begin(async (tx) => {
			const row = await ensureBuyerProfile(tx, principal, false);
			return {
				details: formatProfileDetails(row),
				consents: await readConsents(tx, row),
			};
		}),
		favouriteCategoryChoices(identity),
	]);
	return {
		...state,
		categories: categories.map(({ id, name }) => ({ id, name })),
	};
}

async function updateDetails(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
) {
	const key = mutationKey(request);
	const input = parseProfileDetails(await readBody(request));
	const hash = await intentHash(
		identity,
		"buyer.profile_details.update",
		input,
	);
	return identity.sql.begin(async (tx) => {
		const prior = await checkIdempotency<ProfileDetailsResponse>(
			tx,
			principal.id,
			"buyer.profile_details.update",
			key,
			hash,
		);
		if (prior) return prior;
		const current = await ensureBuyerProfile(tx, principal, true);
		if (Number(current.details_revision) !== input.expectedVersion) {
			throw new AccessError(409, "PROFILE_VERSION_CONFLICT");
		}
		for (const categoryId of input.categories) {
			const category = await publicCategory(tx, categoryId);
			if (!category || category.parent_id !== null)
				throw new AccessError(422, "CATEGORY_UNAVAILABLE");
		}
		await tx`
			update app.buyer_profile
			set birth_day = ${input.day}, birth_month = ${input.month}, birth_year = ${input.year},
				gender = ${input.gender}, favourite_category_ids = ${input.categories}::uuid[],
				details_revision = details_revision + 1, updated_at = clock_timestamp()
			where user_id = ${principal.id}
		`;
		const response = formatProfileDetails(
			await ensureBuyerProfile(tx, principal, false),
		);
		// The audit row names which fields are set, never their values.
		return saveIdempotency(
			tx,
			principal.id,
			"buyer.profile_details.update",
			key,
			hash,
			principal.id,
			"Updated buyer profile details",
			response,
			{
				fields_set: Object.entries(response.completion.fields)
					.filter(
						([field, set]) =>
							set && !["main_address", "whatsapp"].includes(field),
					)
					.map(([field]) => field),
			},
		);
	});
}

async function updateConsent(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
) {
	const key = mutationKey(request);
	const raw = object(await readBody(request), [
		"channel",
		"granted",
		"policy_version",
	]);
	if (
		!CONSENT_CHANNELS.includes(raw.channel as ConsentChannel) ||
		typeof raw.granted !== "boolean"
	)
		throw invalid();
	const channel = raw.channel as ConsentChannel;
	const granted = raw.granted;
	// A grant names the policy version the buyer was shown; a withdrawal is never blocked by a policy change.
	if (granted && raw.policy_version !== MARKETING_POLICY_VERSION) {
		if (typeof raw.policy_version !== "string") throw invalid();
		throw new AccessError(409, "CONSENT_POLICY_CHANGED");
	}
	if (
		!granted &&
		raw.policy_version !== undefined &&
		typeof raw.policy_version !== "string"
	)
		throw invalid();
	const hash = await intentHash(identity, "buyer.marketing_consent.update", {
		channel,
		granted,
	});
	return identity.sql.begin(async (tx) => {
		const prior = await checkIdempotency<MarketingConsentResponse>(
			tx,
			principal.id,
			"buyer.marketing_consent.update",
			key,
			hash,
		);
		if (prior) return prior;
		// The profile row lock serialises this buyer's consent writes; the partial unique index backs it.
		const row = await ensureBuyerProfile(tx, principal, true);
		const [active] = await tx<{ id: string; policy_version: string }[]>`
			select id, policy_version from app.marketing_consent
			where user_id = ${principal.id} and channel = ${channel} and withdrawn_at is null
			for update
		`;
		let changed = false;
		if (granted) {
			if (!(await consentContacts(tx, row))[channel])
				throw new AccessError(422, "CONTACT_REQUIRED");
			if (active?.policy_version !== MARKETING_POLICY_VERSION) {
				if (active)
					await tx`update app.marketing_consent set withdrawn_at = clock_timestamp() where id = ${active.id}`;
				await tx`
					insert into app.marketing_consent (user_id, channel, policy_version, source)
					values (${principal.id}, ${channel}, ${MARKETING_POLICY_VERSION}, 'account')
				`;
				changed = true;
			}
		} else if (active) {
			await tx`update app.marketing_consent set withdrawn_at = clock_timestamp() where id = ${active.id}`;
			changed = true;
		}
		const response = await readConsents(tx, row);
		return saveIdempotency(
			tx,
			principal.id,
			"buyer.marketing_consent.update",
			key,
			hash,
			principal.id,
			granted ? "Granted promo consent" : "Withdrew promo consent",
			response,
			{
				channel,
				granted,
				policy_version: MARKETING_POLICY_VERSION,
				changed,
				source: "account",
			},
		);
	});
}

// Aggregate counts only: no buyer id, name, contact, birthday or row leaves this function, and nothing is exported.
export async function readBuyerSegments(
	identity: LocalAuth,
	principal: Principal,
): Promise<BuyerSegmentsResponse> {
	return identity.sql.begin(async (tx) => {
		await assertCurrentOwner(tx, principal, false, [
			"owner",
			"ecommerce_admin",
		]);
		const [total] = await tx<{ n: number; at: string }[]>`
			select count(*)::int as n, clock_timestamp() as at from app.buyer_profile
			where birth_month is not null or gender is not null or cardinality(favourite_category_ids) > 0
		`;
		const months = await tx<{ month: number; count: number }[]>`
			select birth_month::int as month, count(*)::int as count from app.buyer_profile
			where birth_month is not null group by birth_month
		`;
		const categories = await tx<
			{ category_id: string; name: string; count: number }[]
		>`
			select c.id as category_id, c.name, count(*)::int as count
			from app.buyer_profile p cross join lateral unnest(p.favourite_category_ids) as f(category_id)
			join app.category c on c.id = f.category_id
			group by c.id, c.name order by count(*) desc, c.name limit 50
		`;
		// Opted in = an active consent and a contact it may cover (see consentContacts).
		const channels = await tx<{ channel: ConsentChannel; count: number }[]>`
			select m.channel, count(*)::int as count
			from app.marketing_consent m join app.buyer_profile p on p.user_id = m.user_id
			join app.auth_user u on u.id = m.user_id
			where m.withdrawn_at is null
				and ((m.channel = 'whatsapp' and p.phone is not null)
					or (m.channel = 'email' and u.email_verified and lower(u.email) = lower(p.email)))
			group by m.channel
		`;
		return {
			as_of: iso(total.at) as string,
			profiles: total.n,
			birth_months: Array.from({ length: 12 }, (_, index) => ({
				month: index + 1,
				count: months.find((row) => row.month === index + 1)?.count ?? 0,
			})),
			favourite_categories: categories.map((row) => ({
				...row,
				category_id: String(row.category_id),
			})),
			consent_channels: CONSENT_CHANNELS.map((channel) => ({
				channel,
				count: channels.find((row) => row.channel === channel)?.count ?? 0,
			})),
			programs: PROFILE_PROGRAMS,
		};
	});
}

export async function handleProfileCompletion(
	request: Request,
	identity: LocalAuth,
) {
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
		if (url.search) throw invalid();
		const route = [
			"/api/v1/me/profile-details",
			"/api/v1/me/marketing-consents",
			"/api/v1/admin/buyer-segments",
		].indexOf(url.pathname);
		if (
			route < 0 ||
			(route === 2 && request.method !== "GET") ||
			!["GET", "POST"].includes(request.method)
		) {
			throw new AccessError(404, "NOT_FOUND");
		}
		const principal = await getPrincipal(request, identity);
		if (route === 2)
			return privateJson(await readBuyerSegments(identity, principal));
		if (request.method === "POST") {
			return privateJson(
				route === 0
					? await updateDetails(request, identity, principal)
					: await updateConsent(request, identity, principal),
				201,
			);
		}
		const body = await identity.sql.begin(async (tx) => {
			const row = await ensureBuyerProfile(tx, principal, false);
			return route === 0 ? formatProfileDetails(row) : readConsents(tx, row);
		});
		return privateJson(body);
	} catch (error) {
		return problem(error);
	}
}
