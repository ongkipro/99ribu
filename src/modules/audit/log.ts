// S135 audit log viewer (spec 17 B26, DEC-018 Q4): a read-only, keyset-paged window over the append-only
// `app.audit_event`. Writers are untouched. Nothing here updates or deletes an audit row.
//
// Who reads what (checked against the database inside the read transaction, not the cached principal):
//   owner   every action;
//   finance only the money actions its grant opens (moneyActionsFor: reconciliation, refund and cost actions need
//           the matching finance.*.read permission, payout actions the role alone), filtered in SQL, so no
//           other row is ever fetched for a finance principal, whatever filters the request carries;
//   others  403 FORBIDDEN, and no audit row is written for the refusal (an untrusted caller must not be able to
//           grow the permanent log; the same rule as the other owner-only routes).
//
// The read itself is audited as `audit.read` in the same transaction, after the page is selected (so a page
// never lists its own read). Its details record WHICH filters were used, the action filter (a pattern-checked string)
// and the scope/page/row count. They never record the actor or object filter values or the period: those are
// opaque ids that point at one person's activity, so echoing them would copy a profile of that person into a
// second log. The filter names still tell a reviewer that someone searched by actor.
import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { assertCurrentOwner } from "../access/grants.ts";
import {
	assertOrigin,
	privateJson,
	problem,
} from "../access/http.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import { invalid } from "../catalog/validation.ts";
import {
	nextPageCursor,
	readPageCursor,
	STAMP_FORMAT,
} from "../finance/page-cursor.ts";
import {
	cleanText,
	moneyActionsFor,
	redactDetails,
	redactSubject,
} from "./redaction.ts";

export const AUDIT_EVENTS_PATH = "/api/v1/admin/audit-events";
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
export type AuditScope = "all" | "money";

export type AuditEventRow = {
	id: string;
	occurred_at: string;
	actor_id: string | null;
	actor_name: string | null;
	action: string;
	subject_id: string | null;
	outcome: "allowed" | "denied";
	reason: string;
	details: Record<string, unknown>;
	/** True when any stored detail, or the subject, was withheld by the allowlist. */
	redacted: boolean;
};

export type AuditEventsResponse = {
	scope: AuditScope;
	data: AuditEventRow[];
	pagination: { next_cursor: string | null };
};

export type AuditQuery = {
	actor: string | null;
	/** Exact action, or a family prefix ending in "." (e.g. `payout.`). */
	action: string | null;
	object: string | null;
	from: string | null;
	to: string | null;
	cursor: string | null;
	limit: number;
};

const FILTERS = ["actor", "action", "object", "from", "to", "cursor", "limit"];
const TOKEN = /^[A-Za-z0-9:_.-]{1,120}$/;
const ACTION = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*\.?$/;
const INSTANT =
	/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?(Z|[+-]\d\d:\d\d)$/;
const STAFF_ROLES = [
	"owner",
	"ecommerce_admin",
	"warehouse",
	"customer_service",
	"finance",
];

// Date.parse rolls Feb 31 over to March and accepts offsets Postgres refuses; only a real calendar date with an
// offset in +-14:00 passes, so a bad value is a 400 here and never reaches the cast.
const OFFSET = /(Z|[+-](0\d|1[0-4]):[0-5]\d)$/;
function instant(value: string | null) {
	if (value === null) return null;
	if (!INSTANT.test(value) || value.startsWith("0000") || !OFFSET.test(value) || Number.isNaN(Date.parse(value)))
		throw invalid();
	const [year, month, day] = value.slice(0, 10).split("-").map(Number);
	const calendar = new Date(Date.UTC(year, month - 1, day));
	if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day)
		throw invalid();
	return value;
}

/** Strict closed query: unknown or repeated parameters are refused, never ignored. */
export function parseAuditQuery(url: URL): AuditQuery {
	for (const key of url.searchParams.keys())
		if (!FILTERS.includes(key) || url.searchParams.getAll(key).length !== 1)
			throw invalid();
	const get = (name: string) => {
		const value = url.searchParams.get(name);
		if (value === "") throw invalid();
		return value;
	};
	const actor = get("actor");
	const object = get("object");
	const action = get("action");
	if (actor !== null && !TOKEN.test(actor)) throw invalid();
	if (object !== null && !TOKEN.test(object)) throw invalid();
	if (action !== null && (action.length > 100 || !ACTION.test(action)))
		throw invalid();
	const from = instant(get("from"));
	const to = instant(get("to"));
	if (from !== null && to !== null && Date.parse(from) >= Date.parse(to))
		throw invalid();
	const raw = get("limit");
	const limit = raw === null ? DEFAULT_LIMIT : Number(raw);
	if (!/^\d{1,3}$/.test(raw ?? "1") || limit < 1 || limit > MAX_LIMIT)
		throw invalid();
	const cursor = get("cursor");
	readPageCursor(cursor); // shape check only; a cursor is a position, never authority
	return { actor, action, object, from, to, cursor, limit };
}

async function scopeOf(
	tx: TransactionSql,
	principal: Principal,
): Promise<{ scope: AuditScope; actions: readonly string[] }> {
	try {
		await assertCurrentOwner(tx, principal, false, ["owner"]);
		return { scope: "all", actions: [] };
	} catch (error) {
		if (!(error instanceof AccessError) || error.status !== 403) throw error;
	}
	await assertCurrentOwner(tx, principal, false, ["finance"]);
	// The finance grant's permissions are read here, in the same transaction and under the row lock above, so a
	// revoked permission stops the read at once; the cached principal is not trusted for this.
	const [grant] = await tx<{ permissions: string[] }[]>`
		select permissions from app.role_grant where user_id = ${principal.id}`;
	return { scope: "money", actions: moneyActionsFor(grant?.permissions ?? []) };
}

type Stored = {
	id: string;
	actor_id: string | null;
	actor_name: string | null;
	action: string;
	subject_id: string | null;
	outcome: "allowed" | "denied";
	reason: string;
	details: unknown;
	created_at: string;
	k: string;
};

export function readAuditEvents(
	identity: LocalAuth,
	principal: Principal,
	query: AuditQuery,
): Promise<AuditEventsResponse> {
	return identity.sql.begin(async (tx) => {
		const { scope, actions } = await scopeOf(tx, principal);
		const position = readPageCursor(query.cursor);
		const prefix = query.action?.endsWith(".") ? query.action : null;
		const exact = prefix === null ? query.action : null;
		const money = scope === "money";
		const rows = await tx<Stored[]>`
			select a.id, a.actor_id, staff.name as actor_name, a.action, a.subject_id, a.outcome, a.reason, a.details,
				a.created_at, to_char(a.created_at at time zone 'UTC', ${STAMP_FORMAT}) as k
			from app.audit_event a
			left join lateral (
				select u.name from app.auth_user u join app.role_grant g on g.user_id = u.id
				where u.id = a.actor_id and exists (
					select 1 from unnest(g.roles) r where r in ${tx(STAFF_ROLES)}
				) limit 1
			) staff on true
			where (${query.actor}::text is null or a.actor_id = ${query.actor})
				and (${exact}::text is null or a.action = ${exact})
				and (${prefix}::text is null or starts_with(a.action, ${prefix}))
				and (${query.object}::text is null or a.subject_id = ${query.object})
				and (${query.from}::timestamptz is null or a.created_at >= ${query.from})
				and (${query.to}::timestamptz is null or a.created_at < ${query.to})
				and (not ${money}::boolean or a.action = any(${tx.array([...actions], 1009)}))
				and (${position?.t ?? null}::timestamptz is null
					or (a.created_at, a.id) < (${position?.t ?? null}::timestamptz, ${position?.id ?? null}::uuid))
			order by a.created_at desc, a.id desc
			limit ${query.limit + 1}
		`;
		const page = rows.slice(0, query.limit);
		const filters = (
			[
				["actor", query.actor],
				["action", query.action],
				["object", query.object],
				["period", query.from ?? query.to],
			] as const
		)
			.filter(([, value]) => value !== null)
			.map(([name]) => name);
		await tx`
			insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
			values (${principal.id}, 'audit.read', null, 'allowed', 'Read the audit trail',
				${JSON.stringify({
					scope,
					filters,
					action_filter: query.action,
					page: query.cursor === null ? "first" : "next",
					returned: page.length,
				})}::jsonb)
		`;
		return {
			scope,
			data: page.map((row) => {
				const details = redactDetails(row.action, row.details);
				const subject = redactSubject(row.action, row.subject_id);
				return {
					id: String(row.id),
					occurred_at: new Date(row.created_at).toISOString(),
					actor_id: row.actor_id,
					actor_name: row.actor_name,
					action: row.action,
					subject_id: subject.subject,
					outcome: row.outcome,
					reason: cleanText(row.reason, 300),
					details: details.details,
					redacted: details.redacted || subject.redacted,
				};
			}),
			pagination: {
				next_cursor: nextPageCursor(
					rows.map((row) => ({ k: row.k, id: String(row.id) })),
					query.limit,
				),
			},
		};
	});
}

export async function handleAuditLog(request: Request, identity: LocalAuth) {
	try {
		assertOrigin(request);
		if (
			["authorization", "x-cart-token", "x-order-token"].some((name) =>
				request.headers.has(name),
			)
		)
			throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
		const url = new URL(request.url);
		if (request.method !== "GET" || url.pathname !== AUDIT_EVENTS_PATH)
			throw new AccessError(404, "NOT_FOUND");
		const principal = await getPrincipal(request, identity);
		// Cheap refusal before parsing: an unauthorised caller learns nothing about the filters either. The read
		// transaction re-checks the current grant, session and MFA in the database.
		if (!principal.roles.some((role) => role === "owner" || role === "finance"))
			throw new AccessError(403, "FORBIDDEN");
		return privateJson(
			await readAuditEvents(identity, principal, parseAuditQuery(url)),
		);
	} catch (error) {
		return problem(error);
	}
}
