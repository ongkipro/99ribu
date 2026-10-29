// S138 buyer account lookup for customer service (spec 17 B29, DEC-018 Q5). A staff member types ONE phone or email
// and gets back the matching buyer account(s): display name, MASKED contact values, and order and support-ticket
// history (ids, numbers, states, times). Nothing else leaves: no address (a full address stays in the existing order
// context screens), no bank, payment-proof, password, token, session or message data. The response is built from the
// closed `LookupResult` type below field by field; no row is ever spread into it.
//
// Who: owner and customer_service with a verified MFA session. The role, session and grant are re-read inside the
// transaction under share locks (the cached principal is not trusted), so a revoked grant stops the next lookup.
//
// Exact match only. The value is normalised (E.164 phone, lower-case NFC email) and compared with `=`; there is no
// LIKE, prefix, suffix, wildcard or list mode, and a suffix or partial value is refused (phone) or simply matches
// nothing (email). An unknown value and an account without history take the same code path: the same queries run
// (with an empty id list when nothing matched), the same audit row is written, and the response has the same shape
// (`accounts: []` with a 200, never a 404). Staff accounts are never returned: a staff email looks like no account.
// Timing is the same number of statements whatever the outcome; no artificial delay is added (best effort).
//
// Budget: LOOKUP_LIMIT per staff user through the persistent limiter (app.auth_rate_limit), counted on the pool before
// the lookup transaction so a refused or rolled-back attempt still counts. A budget refusal is a 429 and writes no
// audit row (the same rule as the other refusals: an authenticated caller must not be able to grow the log by
// hammering a limit).
//
// Audit: every completed lookup writes one `support.customer_lookup` row in the SAME transaction as the read, so a
// lookup that returned data without its row cannot exist. The row records the actor, the lookup KIND (phone|email),
// the number of matches and the matched account ids. The searched phone or email is NOT stored, raw or hashed:
// the matched ids already say whose account was read, and a keyed hash of a value that matched nothing would be a
// permanent pseudonymous identifier of someone who may not be a customer (phone numbers are a small space, so a hash
// is a pointer for anyone holding the key). `subject_id` carries the account id when exactly one account matched.
//
// Order history scope follows the existing order-history rules (spec 07, finance/history.ts): the owner sees every
// order of the account; customer_service needs the `orders.history.read` grant and only sees an order whose every
// parcel (and every replacement parcel) is in one of their assigned warehouses, so `order_access` tells the screen
// which of "all" / "scoped" / "none" applies. Support tickets are company-wide for the support roles (the inbox
// has no warehouse scope either), so tickets are listed whatever the order scope.
import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { assertOrigin, privateJson, problem, readBody } from "../access/http.ts";
import {
	AccessError,
	getPrincipal,
	hasPermission,
	type Principal,
	type Role,
} from "../access/policy.ts";
import { rateLimit } from "../access/rate-limit.ts";
import { invalid, object, text } from "../catalog/validation.ts";
import { normalizePhone } from "../shipping/address.ts";
import { isValidEmail, maskedPhone } from "../storefront/contact.ts";
import { maskedEmail } from "./masking.ts";

export const CUSTOMER_LOOKUP_PATH = "/api/v1/admin/customers/lookup";
export const CUSTOMER_LOOKUP_ACTION = "support.customer_lookup";
/** Lookups per staff user per window: about two a minute, far above a support call, far below enumeration. */
export const LOOKUP_LIMIT = [20, 600_000] as const;
export const MAX_ACCOUNTS = 5;
export const HISTORY_ROWS = 20;

const LOOKUP_ROLES: readonly Role[] = ["owner", "customer_service"];
const STAFF_ROLES = [
	"owner",
	"ecommerce_admin",
	"warehouse",
	"customer_service",
	"finance",
];

export type LookupKind = "phone" | "email";
export type OrderAccess = "all" | "scoped" | "none";
export type LookupOrder = {
	id: string;
	/** Short admin handle for `/admin/pesanan/{admin_no}`. */
	admin_no: number;
	number: string;
	status: string;
	payment_status: string;
	created_at: string;
};
export type LookupTicket = {
	id: string;
	status: string;
	priority: string;
	created_at: string;
	last_message_at: string | null;
};
export type LookupAccount = {
	id: string;
	display_name: string;
	phone_masked: string | null;
	phone_verified: boolean;
	email_masked: string | null;
	email_verified: boolean;
	created_at: string;
	orders: LookupOrder[];
	orders_truncated: boolean;
	tickets: LookupTicket[];
	tickets_truncated: boolean;
};
export type LookupResult = {
	lookup: { kind: LookupKind };
	order_access: OrderAccess;
	accounts: LookupAccount[];
	accounts_truncated: boolean;
};

/** The exact value to compare: E.164 phone, or trimmed lower-case NFC email. Anything else is a 400/422. */
export function parseLookup(body: unknown): { kind: LookupKind; value: string } {
	const input = object(body, ["kind", "value"]);
	if (input.kind !== "phone" && input.kind !== "email") throw invalid();
	const raw = text(input.value, 254);
	if (input.kind === "phone") return { kind: "phone", value: normalizePhone(raw) };
	const value = raw.normalize("NFC").toLowerCase();
	if (!isValidEmail(value)) throw invalid();
	return { kind: "email", value };
}

type Authority = { access: OrderAccess; warehouseIds: string[] };

async function authority(
	tx: TransactionSql,
	principal: Principal,
): Promise<Authority> {
	const [grant] = await tx<
		{ roles: Role[]; permissions: Principal["permissions"]; verified_at: string }[]
	>`select g.roles, g.permissions, m.verified_at
		from app.role_grant g
		join app.auth_user u on u.id = g.user_id
		join app.auth_session s on s.user_id = u.id
		join app.mfa_session m on m.session_id = s.id
		where u.id = ${principal.id} and s.id = ${principal.sessionId}
			and s.expires_at > clock_timestamp() and u.email_verified and u.two_factor_enabled
		for share of g, s, m`;
	if (!grant?.roles.some((role) => LOOKUP_ROLES.includes(role)))
		throw new AccessError(403, "FORBIDDEN");
	const warehouses = await tx<{ id: string }[]>`
		select w.id from app.warehouse_membership m join app.warehouse w on w.id = m.warehouse_id
		where m.user_id = ${principal.id} and w.active order by w.id for share of w`;
	const current: Principal = {
		...principal,
		roles: grant.roles,
		permissions: grant.permissions,
		mfaAt: new Date(grant.verified_at),
		warehouseIds: warehouses.map((row) => row.id),
	};
	const access: OrderAccess = current.roles.includes("owner")
		? "all"
		: hasPermission(current, "orders.history.read")
			? "scoped"
			: "none";
	return { access, warehouseIds: current.warehouseIds };
}

type AccountRow = {
	id: string;
	display_name: string;
	phone: string | null;
	phone_verified: boolean;
	email: string | null;
	email_verified: boolean;
	created_at: string;
};
type OrderRow = {
	owner_user_id: string;
	id: string;
	admin_no: string;
	number: string;
	status: string;
	payment_status: string;
	created_at: string;
	rn: string;
};
type TicketRow = {
	buyer_user_id: string;
	id: string;
	status: string;
	priority: string;
	created_at: string;
	last_public_message_at: string | null;
	rn: string;
};

const iso = (value: string | Date) => new Date(value).toISOString();

export function lookupBuyerAccounts(
	identity: LocalAuth,
	principal: Principal,
	query: { kind: LookupKind; value: string },
): Promise<LookupResult> {
	return identity.sql.begin(async (tx) => {
		const { access, warehouseIds } = await authority(tx, principal);
		const byContact =
			query.kind === "phone"
				? tx`p.phone = ${query.value}`
				: tx`(u.email = ${query.value} or p.email = ${query.value})`;
		// One more than the cap so truncation is known. Staff accounts are excluded (their contact is not a buyer's).
		const found = await tx<AccountRow[]>`
			select u.id, coalesce(p.display_name, u.name) as display_name, p.phone,
				p.phone_verified_at is not null as phone_verified, coalesce(p.email, u.email) as email,
				u.email_verified and (p.email is null or lower(p.email) = lower(u.email)) as email_verified, u.created_at
			from app.auth_user u left join app.buyer_profile p on p.user_id = u.id
			where ${byContact}
				and not exists (
					select 1 from app.role_grant g where g.user_id = u.id and g.roles && ${tx.array(STAFF_ROLES, 1009)}::text[]
				)
			order by (p.phone_verified_at is not null) desc, u.created_at, u.id
			limit ${MAX_ACCOUNTS + 1}`;
		const accounts = found.slice(0, MAX_ACCOUNTS);
		const ids = accounts.map((row) => row.id);
		const scoped = access === "scoped";
		const everything = access === "all";
		// Same statements for a miss: an empty id list matches nothing. The scope below is spec 07 / finance/history.ts:
		// every parcel, and every replacement parcel of a return, inside the caller's warehouses.
		const orders = await tx<OrderRow[]>`
			select * from (
				select o.owner_user_id, o.id, o.admin_no, o.number, o.status, o.payment_status, o.created_at,
					row_number() over (partition by o.owner_user_id order by o.created_at desc, o.id desc) as rn
				from app.commerce_order o
				where o.owner_user_id = any(${ids}::text[]) and o.revision > 0
					and (${everything} or (${scoped}
						and exists (select 1 from app.order_shipment s where s.order_id = o.id)
						and not exists (
							select 1 from app.order_shipment s
							where s.order_id = o.id and not (s.warehouse_id = any(${warehouseIds}::uuid[])))
						and not exists (
							select 1 from app.replacement_shipment r join app.return_case c on c.id = r.case_id
							where c.order_id = o.id and not (r.warehouse_id = any(${warehouseIds}::uuid[])))))
			) ranked where rn <= ${HISTORY_ROWS + 1}
			order by owner_user_id, rn`;
		const tickets = await tx<TicketRow[]>`
			select * from (
				select c.buyer_user_id, c.id, c.status, c.priority, c.created_at, c.last_public_message_at,
					row_number() over (partition by c.buyer_user_id order by c.created_at desc, c.id desc) as rn
				from app.support_conversation c
				where c.buyer_user_id = any(${ids}::text[])
			) ranked where rn <= ${HISTORY_ROWS + 1}
			order by buyer_user_id, rn`;
		await tx`
			insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
			values (${principal.id}, ${CUSTOMER_LOOKUP_ACTION}, ${accounts.length === 1 ? accounts[0].id : null},
				'allowed', 'Looked up a buyer account',
				${JSON.stringify({ kind: query.kind, matches: accounts.length, account_ids: ids })}::jsonb)`;
		return {
			lookup: { kind: query.kind },
			order_access: access,
			accounts_truncated: found.length > MAX_ACCOUNTS,
			accounts: accounts.map((row): LookupAccount => {
				const own = orders.filter((order) => order.owner_user_id === row.id);
				const mine = tickets.filter((ticket) => ticket.buyer_user_id === row.id);
				return {
					id: row.id,
					display_name: row.display_name,
					phone_masked: row.phone ? maskedPhone(row.phone) : null,
					phone_verified: row.phone_verified,
					email_masked: maskedEmail(row.email),
					email_verified: row.email_verified,
					created_at: iso(row.created_at),
					orders: own.slice(0, HISTORY_ROWS).map((order) => ({
						id: order.id,
						admin_no: Number(order.admin_no),
						number: order.number,
						status: order.status,
						payment_status: order.payment_status,
						created_at: iso(order.created_at),
					})),
					orders_truncated: own.length > HISTORY_ROWS,
					tickets: mine.slice(0, HISTORY_ROWS).map((ticket) => ({
						id: ticket.id,
						status: ticket.status,
						priority: ticket.priority,
						created_at: iso(ticket.created_at),
						last_message_at: ticket.last_public_message_at
							? iso(ticket.last_public_message_at)
							: null,
					})),
					tickets_truncated: mine.length > HISTORY_ROWS,
				};
			}),
		};
	});
}

export async function handleCustomerLookup(
	request: Request,
	identity: LocalAuth,
) {
	try {
		assertOrigin(request);
		if (
			["authorization", "x-cart-token", "x-order-token"].some((name) =>
				request.headers.has(name),
			)
		)
			throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
		const url = new URL(request.url);
		if (url.pathname !== CUSTOMER_LOOKUP_PATH || url.search !== "")
			throw new AccessError(404, "NOT_FOUND");
		if (request.method !== "POST") throw new AccessError(404, "NOT_FOUND");
		const principal = await getPrincipal(request, identity);
		// Cheap refusal before the body is read: another role learns nothing about the accepted input either.
		if (!principal.roles.some((role) => LOOKUP_ROLES.includes(role)))
			throw new AccessError(403, "FORBIDDEN");
		const query = parseLookup(await readBody(request));
		await rateLimit(
			identity.sql,
			`customer-lookup:${principal.id}`,
			LOOKUP_LIMIT,
		);
		return privateJson(await lookupBuyerAccounts(identity, principal, query));
	} catch (error) {
		return problem(error);
	}
}
