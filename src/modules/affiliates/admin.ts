// S132 affiliates admin read endpoints (spec 17 B14, DEC-018 Q5):
// - GET /api/v1/admin/affiliates (keyset list)
// - GET /api/v1/admin/affiliates/{affiliateId} (detail with rate version history)
//
// Authority (DEC-018 Q5): owner and finance with a live MFA-verified session, checked cheaply on the cached
// principal first (so unauthorized callers write no audit rows and learn nothing from query parsing) and
// re-checked inside the read transaction against `auth_user`, `auth_session`, `mfa_session` and `role_grant`.
// Rate writes stay owner-only on `POST /api/v1/admin/affiliates/{affiliateId}/rates` (`appendAffiliateRate`).
//
// Privacy boundary:
// - Buyer PII (buyer name, email, phone, shipping address) is NEVER queried or returned; attributed order
//   activity is exposed only as aggregate counts and per-status commission counts/amounts.
// - Affiliate bank account numbers (`beneficiary_account_number`), account holder names and bank codes are
//   NEVER selected here (beneficiary verification belongs to the S131 payout queue); only `beneficiary_status`
//   is returned.
// - Affiliate credentials (password hash, TOTP secret, backup codes, session token, proof digest) are never
//   selected or returned.
import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { assertOrigin, privateJson, problem } from "../access/http.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import { id, invalid } from "../catalog/validation.ts";
import type { CommissionStatus } from "../commissions/service.ts";
import {
	nextPageCursor,
	readPageCursor,
	STAMP_FORMAT,
} from "../finance/page-cursor.ts";
import { resolvePolicy } from "../settings/policies.ts";
import { offerCommissionIdr } from "./rates.ts";

export const ADMIN_AFFILIATES_PATH = "/api/v1/admin/affiliates";
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

const STAFF_ROLES = [
	"owner",
	"ecommerce_admin",
	"warehouse",
	"customer_service",
	"finance",
];
const ALLOWED_READ_ROLES = ["owner", "finance"] as const;
const QUERY_KEYS = ["status", "code", "cursor", "limit"];
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type AffiliateAccountStatus = "active" | "suspended";
export type BeneficiaryStatus =
	| "missing"
	| "pending_verification"
	| "verified"
	| "rejected"
	| "change_hold";

export type AdminAffiliateCommissionSummary = {
	pending_count: number;
	pending_idr: number;
	eligible_count: number;
	eligible_idr: number;
	allocated_count: number;
	allocated_idr: number;
	/** Matured unpaid liability (`eligible` + `allocated`). */
	matured_count: number;
	matured_idr: number;
	paid_count: number;
	paid_idr: number;
	held_count: number;
	held_idr: number;
	void_count: number;
	void_idr: number;
};

export type AdminAffiliateSummary = {
	id: string;
	/** Short admin handle for `/admin/afiliasi/{admin_no}`; the API keeps taking `id`. */
	admin_no: number;
	referral_code: string | null;
	display_name: string;
	status: AffiliateAccountStatus;
	beneficiary_status: BeneficiaryStatus;
	enrolled_at: string;
	/** True when the account is active, email-verified and holds the affiliate role (required by setAffiliateRate). */
	rate_eligible: boolean;
	/** Current `affiliate_account.rate_revision`, passed as `expected_version` to setAffiliateRate. */
	rate_version: number;
	effective_rate_bps: number;
	effective_commission_idr: number;
	rate_source: "override" | "default_policy";
	attributed_orders_count: number;
	commissions: AdminAffiliateCommissionSummary;
};

export type AdminAffiliatePage = {
	data: AdminAffiliateSummary[];
	pagination: { next_cursor: string | null };
};

export type AdminAffiliateRateVersion = {
	id: string;
	affiliate_id: string;
	version: number;
	basis_points: number;
	commission_idr: number;
	effective_at: string;
	created_at: string;
	actor_id: string;
	actor_name: string | null;
	reason: string;
	state: "effective" | "scheduled" | "superseded";
};

export type AdminAffiliateDetail = AdminAffiliateSummary & {
	default_policy_rate_bps: number;
	minimum_payout_idr: number;
	rate_versions: AdminAffiliateRateVersion[];
};

export type AdminAffiliatesQuery = {
	status: AffiliateAccountStatus | null;
	code: string | null;
	cursor: string | null;
	limit: number;
};

/** Strict closed query parser: unknown, repeated or empty parameters return 400 INVALID_INPUT. */
export function parseAdminAffiliatesQuery(url: URL): AdminAffiliatesQuery {
	for (const key of url.searchParams.keys()) {
		if (
			!QUERY_KEYS.includes(key) ||
			url.searchParams.getAll(key).length !== 1
		) {
			throw invalid();
		}
	}
	const get = (name: string) => {
		const value = url.searchParams.get(name);
		if (value === "") throw invalid();
		return value;
	};
	const rawStatus = get("status");
	if (
		rawStatus !== null &&
		rawStatus !== "active" &&
		rawStatus !== "suspended"
	) {
		throw invalid();
	}
	const rawCode = get("code")?.trim() ?? null;
	if (rawCode !== null && !CODE_PATTERN.test(rawCode)) {
		throw invalid();
	}
	const rawLimit = get("limit");
	const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
	if (
		!/^\d{1,3}$/.test(rawLimit ?? "1") ||
		limit < 1 ||
		limit > MAX_LIMIT
	) {
		throw invalid();
	}
	const cursor = get("cursor");
	readPageCursor(cursor);
	return {
		status: rawStatus,
		code: rawCode ? rawCode.toUpperCase() : null,
		cursor,
		limit,
	};
}

async function assertAffiliateAdminRead(
	tx: TransactionSql,
	principal: Principal,
) {
	const [row] = await tx<{ roles: string[] }[]>`
		select g.roles
		from app.role_grant g
		join app.auth_user u on u.id = g.user_id
		join app.auth_session s on s.user_id = u.id
		join app.mfa_session m on m.session_id = s.id
		where u.id = ${principal.id}
			and s.id = ${principal.sessionId}
			and s.expires_at > clock_timestamp()
			and u.email_verified = true
			and u.two_factor_enabled = true
		for share of u, g, s, m
	`;
	if (
		!row?.roles.some((role: string) =>
			(ALLOWED_READ_ROLES as readonly string[]).includes(role),
		)
	) {
		throw new AccessError(403, "FORBIDDEN");
	}
}

function emptyCommissionSummary(): AdminAffiliateCommissionSummary {
	return {
		pending_count: 0,
		pending_idr: 0,
		eligible_count: 0,
		eligible_idr: 0,
		allocated_count: 0,
		allocated_idr: 0,
		matured_count: 0,
		matured_idr: 0,
		paid_count: 0,
		paid_idr: 0,
		held_count: 0,
		held_idr: 0,
		void_count: 0,
		void_idr: 0,
	};
}

type StoredAffiliateRow = {
	id: string;
	admin_no: string;
	status: AffiliateAccountStatus;
	rate_revision: number;
	referral_code: string | null;
	display_name: string;
	beneficiary_status: BeneficiaryStatus;
	enrolled_at: string;
	k: string;
	rate_eligible: boolean;
	override_bps: number | null;
};

type CommissionAggregateRow = {
	affiliate_id: string;
	status: CommissionStatus;
	cnt: number;
	total: number;
};

async function loadSummariesForRows(
	tx: TransactionSql,
	rows: readonly StoredAffiliateRow[],
	defaultBps: number,
): Promise<AdminAffiliateSummary[]> {
	if (rows.length === 0) return [];
	const affiliateIds = rows.map((row) => row.id);
	const orderCounts = await tx<{ affiliate_id: string; cnt: number }[]>`
		select affiliate_id, count(*)::int as cnt
		from app.order_attribution
		where affiliate_id in ${tx(affiliateIds)}
		group by affiliate_id
	`;
	const commissionRows = await tx<CommissionAggregateRow[]>`
		select affiliate_id, status, count(*)::int as cnt, coalesce(sum(amount_idr), 0)::bigint as total
		from app.commission_entry
		where affiliate_id in ${tx(affiliateIds)}
		group by affiliate_id, status
	`;

	const ordersByAffiliate = new Map<string, number>();
	for (const row of orderCounts) {
		ordersByAffiliate.set(row.affiliate_id, Number(row.cnt));
	}

	const commissionsByAffiliate = new Map<
		string,
		AdminAffiliateCommissionSummary
	>();
	for (const row of commissionRows) {
		const summary =
			commissionsByAffiliate.get(row.affiliate_id) ?? emptyCommissionSummary();
		const count = Number(row.cnt);
		const amount = Number(row.total);
		if (row.status === "pending") {
			summary.pending_count = count;
			summary.pending_idr = amount;
		} else if (row.status === "eligible") {
			summary.eligible_count = count;
			summary.eligible_idr = amount;
		} else if (row.status === "allocated") {
			summary.allocated_count = count;
			summary.allocated_idr = amount;
		} else if (row.status === "paid") {
			summary.paid_count = count;
			summary.paid_idr = amount;
		} else if (row.status === "held") {
			summary.held_count = count;
			summary.held_idr = amount;
		} else if (row.status === "void") {
			summary.void_count = count;
			summary.void_idr = amount;
		}
		summary.matured_count = summary.eligible_count + summary.allocated_count;
		summary.matured_idr = summary.eligible_idr + summary.allocated_idr;
		commissionsByAffiliate.set(row.affiliate_id, summary);
	}

	return rows.map((row) => {
		const hasOverride =
			row.override_bps !== null && row.override_bps !== undefined;
		const effectiveBps = hasOverride ? Number(row.override_bps) : defaultBps;
		return {
			id: String(row.id),
			admin_no: Number(row.admin_no),
			referral_code: row.referral_code,
			display_name: row.display_name,
			status: row.status,
			beneficiary_status: row.beneficiary_status,
			enrolled_at: new Date(row.enrolled_at).toISOString(),
			rate_eligible: Boolean(row.rate_eligible),
			rate_version: Number(row.rate_revision),
			effective_rate_bps: effectiveBps,
			effective_commission_idr: offerCommissionIdr(effectiveBps),
			rate_source: hasOverride ? "override" : "default_policy",
			attributed_orders_count: ordersByAffiliate.get(row.id) ?? 0,
			commissions:
				commissionsByAffiliate.get(row.id) ?? emptyCommissionSummary(),
		};
	});
}

async function currentPolicyDefaults(tx: TransactionSql) {
	const [clock] = await tx<{ now: string }[]>`
		select date_trunc('milliseconds', clock_timestamp())::text as now
	`;
	const nowIso = new Date(clock.now).toISOString();
	const policy = await resolvePolicy(tx, "commercial", null, new Date(nowIso));
	if (!("default_commission_bps" in policy.values)) {
		throw new AccessError(503, "POLICY_INVALID");
	}
	const defaultBps = Number(policy.values.default_commission_bps);
	const minimumPayoutIdr =
		"minimum_payout_idr" in policy.values
			? Number(policy.values.minimum_payout_idr)
			: 99000;
	return { nowIso, defaultBps, minimumPayoutIdr };
}

export function listAdminAffiliates(
	identity: LocalAuth,
	principal: Principal,
	query: AdminAffiliatesQuery,
): Promise<AdminAffiliatePage> {
	return identity.sql.begin(async (tx: TransactionSql) => {
		await assertAffiliateAdminRead(tx, principal);
		const { nowIso, defaultBps } = await currentPolicyDefaults(tx);
		const position = readPageCursor(query.cursor);
		const rows = await tx<StoredAffiliateRow[]>`
			select
				a.id,
				a.admin_no,
				a.status,
				a.rate_revision,
				p.referral_code,
				coalesce(nullif(trim(p.display_name), ''), nullif(trim(u.name), ''), 'Mitra Afiliasi') as display_name,
				coalesce(p.beneficiary_status, 'missing') as beneficiary_status,
				coalesce(p.enrolled_at, a.created_at) as enrolled_at,
				to_char(coalesce(p.enrolled_at, a.created_at) at time zone 'UTC', ${STAMP_FORMAT}) as k,
				(a.status = 'active' and u.email_verified = true and coalesce('affiliate' = any(g.roles), false)) as rate_eligible,
				ov.basis_points as override_bps
			from app.affiliate_account a
			join app.auth_user u on u.id = a.user_id
			left join app.affiliate_profile p on p.affiliate_id = a.id
			left join app.role_grant g on g.user_id = a.user_id
			left join lateral (
				select v.basis_points
				from app.affiliate_rate_version v
				where v.affiliate_id = a.id
					and v.effective_at <= ${nowIso}::timestamptz
				order by v.effective_at desc, v.revision desc
				limit 1
			) ov on true
			where (${query.status}::text is null or a.status = ${query.status})
				and (${query.code}::text is null or (p.referral_code is not null and starts_with(upper(p.referral_code), ${query.code})))
				and (${position?.t ?? null}::timestamptz is null
					or (coalesce(p.enrolled_at, a.created_at), a.id) < (${position?.t ?? null}::timestamptz, ${position?.id ?? null}::uuid))
			order by coalesce(p.enrolled_at, a.created_at) desc, a.id desc
			limit ${query.limit + 1}
		`;
		const page = rows.slice(0, query.limit);
		const data = await loadSummariesForRows(tx, page, defaultBps);
		return {
			data,
			pagination: {
				next_cursor: nextPageCursor(
					rows.map((row: StoredAffiliateRow) => ({ k: row.k, id: String(row.id) })),
					query.limit,
				),
			},
		};
	});
}

type StoredRateVersionRow = {
	id: string;
	affiliate_id: string;
	revision: number;
	basis_points: number;
	effective_at: string;
	created_at: string;
	actor_id: string;
	actor_name: string | null;
	reason: string;
};

export function getAdminAffiliate(
	identity: LocalAuth,
	principal: Principal,
	affiliateId: string,
): Promise<AdminAffiliateDetail> {
	const selected = id(affiliateId);
	return identity.sql.begin(async (tx: TransactionSql) => {
		await assertAffiliateAdminRead(tx, principal);
		const { nowIso, defaultBps, minimumPayoutIdr } =
			await currentPolicyDefaults(tx);
		const [row] = await tx<StoredAffiliateRow[]>`
			select
				a.id,
				a.admin_no,
				a.status,
				a.rate_revision,
				p.referral_code,
				coalesce(nullif(trim(p.display_name), ''), nullif(trim(u.name), ''), 'Mitra Afiliasi') as display_name,
				coalesce(p.beneficiary_status, 'missing') as beneficiary_status,
				coalesce(p.enrolled_at, a.created_at) as enrolled_at,
				to_char(coalesce(p.enrolled_at, a.created_at) at time zone 'UTC', ${STAMP_FORMAT}) as k,
				(a.status = 'active' and u.email_verified = true and coalesce('affiliate' = any(g.roles), false)) as rate_eligible,
				ov.basis_points as override_bps
			from app.affiliate_account a
			join app.auth_user u on u.id = a.user_id
			left join app.affiliate_profile p on p.affiliate_id = a.id
			left join app.role_grant g on g.user_id = a.user_id
			left join lateral (
				select v.basis_points
				from app.affiliate_rate_version v
				where v.affiliate_id = a.id
					and v.effective_at <= ${nowIso}::timestamptz
				order by v.effective_at desc, v.revision desc
				limit 1
			) ov on true
			where a.id = ${selected}
			for share of a
		`;
		if (!row) throw new AccessError(404, "NOT_FOUND");
		const [summary] = await loadSummariesForRows(tx, [row], defaultBps);
		const versions = await tx<StoredRateVersionRow[]>`
			select
				v.id,
				v.affiliate_id,
				v.revision,
				v.basis_points,
				v.effective_at,
				v.created_at,
				v.actor_id,
				staff.name as actor_name,
				v.reason
			from app.affiliate_rate_version v
			left join lateral (
				select u.name
				from app.auth_user u
				join app.role_grant g on g.user_id = u.id
				where u.id = v.actor_id
					and exists (
						select 1 from unnest(g.roles) r where r in ${tx(STAFF_ROLES)}
					)
				limit 1
			) staff on true
			where v.affiliate_id = ${selected}
			order by v.revision desc
		`;
		const nowMs = Date.parse(nowIso);
		let foundEffective = false;
		const rateVersions: AdminAffiliateRateVersion[] = versions.map((v: StoredRateVersionRow) => {
			const effectiveMs = Date.parse(v.effective_at);
			let state: "effective" | "scheduled" | "superseded";
			if (effectiveMs > nowMs) {
				state = "scheduled";
			} else if (!foundEffective) {
				foundEffective = true;
				state = "effective";
			} else {
				state = "superseded";
			}
			const bps = Number(v.basis_points);
			return {
				id: String(v.id),
				affiliate_id: String(v.affiliate_id),
				version: Number(v.revision),
				basis_points: bps,
				commission_idr: offerCommissionIdr(bps),
				effective_at: new Date(v.effective_at).toISOString(),
				created_at: new Date(v.created_at).toISOString(),
				actor_id: v.actor_id,
				actor_name: v.actor_name,
				reason: v.reason,
				state,
			};
		});
		return {
			...summary,
			default_policy_rate_bps: defaultBps,
			minimum_payout_idr: minimumPayoutIdr,
			rate_versions: rateVersions,
		};
	});
}

export async function handleAdminAffiliates(
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
		const isList =
			request.method === "GET" && url.pathname === ADMIN_AFFILIATES_PATH;
		const detailMatch =
			request.method === "GET"
				? /^\/api\/v1\/admin\/affiliates\/([^/]+)$/.exec(url.pathname)
				: null;
		if (!isList && !detailMatch) {
			throw new AccessError(404, "NOT_FOUND");
		}
		const principal = await getPrincipal(request, identity);
		// Cheap refusal before parsing query/path; the read transaction re-checks the grant, session and MFA in DB.
		if (
			!principal.roles.some((role) =>
				(ALLOWED_READ_ROLES as readonly string[]).includes(role),
			)
		) {
			throw new AccessError(403, "FORBIDDEN");
		}
		if (isList) {
			return privateJson(
				await listAdminAffiliates(
					identity,
					principal,
					parseAdminAffiliatesQuery(url),
				),
				200,
			);
		}
		if (url.search) throw invalid();
		return privateJson(
			await getAdminAffiliate(identity, principal, detailMatch?.[1] ?? ""),
			200,
		);
	} catch (error) {
		return problem(error);
	}
}
