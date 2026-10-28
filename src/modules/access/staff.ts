// S137 staff directory and lost-authenticator reset (spec 17 B20, DEC-018 Q2).
//
// Owner only, checked twice: from the cached principal as a cheap refusal (no audit row, so an untrusted caller
// cannot grow the permanent log) and again inside every transaction from the database (current grant, live session,
// two-step flag). Roles are written elsewhere (`replaceStaffGrant`, route admin/role-grants); this module reads
// them and resets a lost TOTP device.
//
// What leaves the server for a user: id, name, email, staff roles, delegated permissions, warehouse scope, whether
// two-step verification is on (yes/no, never the seed, backup codes or a hash), the newest stored session start and
// the grant version. Rows are projected column by column: no `select *`, no session token, no password hash.
import { createHash } from "node:crypto";
import type { LocalAuth } from "./auth.ts";
import { assertCurrentOwner, consumeAccessProof, mfaResetAction } from "./grants.ts";
import { assertOrigin, privateJson, problem, readBody } from "./http.ts";
import { AccessError, getPrincipal, type Principal, staffRoles } from "./policy.ts";
import { invalid } from "../catalog/validation.ts";

export const STAFF_PATH = "/api/v1/admin/staff";
export const STAFF_LOOKUP_PATH = "/api/v1/admin/staff/lookup";
export const STAFF_MFA_RESET_PATH = "/api/v1/admin/staff-mfa-resets";
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

// `owner` is listed and may be demoted, but never granted by the grant endpoint.
const STAFF_ROLE_SET: readonly string[] = ["owner", ...staffRoles];

export type StaffMember = {
	user_id: string;
	name: string;
	email: string;
	/** Staff roles only (owner and the four grantable roles); buyer/affiliate entitlements are not listed. */
	roles: string[];
	permissions: string[];
	warehouses: { id: string; name: string; city: string; active: boolean }[];
	mfa_enabled: boolean;
	/** Start of the newest stored session; null when the account has no stored session (signed out, replaced, reset). */
	last_sign_in_at: string | null;
	/** `role_grant.revision`, the `expected_version` of the next replacement; 0 for an account without a grant. */
	version: number;
};
export type StaffPage = {
	data: StaffMember[];
	pagination: { next_cursor: string | null };
};

type Stored = {
	id: string;
	name: string;
	email: string;
	two_factor_enabled: boolean;
	roles: string[] | null;
	permissions: string[] | null;
	revision: number | null;
	last_session: string | null;
	warehouses: { id: string; name: string; city: string; active: boolean }[];
	k: string;
};

function member(row: Stored): StaffMember {
	return {
		user_id: row.id,
		name: row.name,
		email: row.email,
		roles: (row.roles ?? []).filter((role) => STAFF_ROLE_SET.includes(role)),
		permissions: row.permissions ?? [],
		warehouses: row.warehouses.map((w) => ({ id: w.id, name: w.name, city: w.city, active: w.active })),
		mfa_enabled: row.two_factor_enabled,
		last_sign_in_at: row.last_session ? new Date(row.last_session).toISOString() : null,
		version: row.revision ?? 0,
	};
}

// Ordering key: the first 200 characters of the lower-cased name, then the user id. A prefix is still a total
// order together with the id, and it keeps the opaque cursor bounded whatever a name contains.
const NAME_KEY = 200;
type Position = { k: string; id: string };
function readCursor(value: string | null): Position | null {
	if (value === null) return null;
	if (!/^[A-Za-z0-9_-]{1,1200}$/.test(value)) throw invalid();
	try {
		const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
		if (
			!parsed ||
			typeof parsed !== "object" ||
			Array.isArray(parsed) ||
			Object.keys(parsed).some((key) => key !== "k" && key !== "id")
		)
			throw invalid();
		const { k, id } = parsed as Record<string, unknown>;
		if (typeof k !== "string" || k.length > NAME_KEY || typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id))
			throw invalid();
		return { k, id };
	} catch {
		throw invalid();
	}
}

/** Strict closed query: unknown or repeated parameters are refused, never ignored. */
export function parseStaffQuery(url: URL) {
	for (const key of url.searchParams.keys())
		if (!["cursor", "limit"].includes(key) || url.searchParams.getAll(key).length !== 1) throw invalid();
	const raw = url.searchParams.get("limit");
	const limit = raw === null ? DEFAULT_LIMIT : Number(raw);
	if (!/^\d{1,3}$/.test(raw ?? "1") || limit < 1 || limit > MAX_LIMIT) throw invalid();
	const cursor = url.searchParams.get("cursor");
	readCursor(cursor); // shape only; a cursor is a position, never authority
	return { cursor, limit };
}

export function parseLookupQuery(url: URL) {
	for (const key of url.searchParams.keys())
		if (key !== "email" || url.searchParams.getAll(key).length !== 1) throw invalid();
	const email = url.searchParams.get("email")?.trim().toLowerCase() ?? "";
	if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email)) throw invalid();
	return { email };
}

export function listStaff(
	identity: LocalAuth,
	principal: Principal,
	query: { cursor: string | null; limit: number },
): Promise<StaffPage> {
	return identity.sql.begin(async (tx) => {
		await assertCurrentOwner(tx, principal);
		const position = readCursor(query.cursor);
		const rows = await tx<Stored[]>`
			select u.id, u.name, u.email, u.two_factor_enabled, g.roles, g.permissions, g.revision,
				left(lower(u.name), ${NAME_KEY}) as k,
				(select max(s.created_at) from app.auth_session s where s.user_id = u.id) as last_session,
				coalesce((select json_agg(json_build_object('id', w.id, 'name', w.name, 'city', w.city, 'active', w.active) order by w.name, w.id)
					from app.warehouse_membership m join app.warehouse w on w.id = m.warehouse_id where m.user_id = u.id), '[]'::json) as warehouses
			from app.auth_user u join app.role_grant g on g.user_id = u.id
			where g.roles && ${tx.array([...STAFF_ROLE_SET], 1009)}
				and (${position?.k ?? null}::text is null
					or (left(lower(u.name), ${NAME_KEY}), u.id) > (${position?.k ?? null}::text, ${position?.id ?? null}::text))
			order by left(lower(u.name), ${NAME_KEY}), u.id
			limit ${query.limit + 1}
		`;
		const page = rows.slice(0, query.limit);
		return {
			data: page.map(member),
			pagination: {
				next_cursor:
					rows.length > query.limit
						? Buffer.from(JSON.stringify({ k: page[page.length - 1].k, id: page[page.length - 1].id })).toString("base64url")
						: null,
			},
		};
	});
}

/**
 * Exact-email lookup of any account, so the owner can give a registered buyer a staff role. No search by fragment
 * (no enumeration), no listing of non-staff accounts. Every lookup is audited; the audit row records whether an
 * account was found and which one, never the typed address.
 */
export function lookupStaffUser(
	identity: LocalAuth,
	principal: Principal,
	query: { email: string },
): Promise<StaffMember | null> {
	return identity.sql.begin(async (tx) => {
		await assertCurrentOwner(tx, principal);
		const [row] = await tx<Stored[]>`
			select u.id, u.name, u.email, u.two_factor_enabled, g.roles, g.permissions, g.revision,
				left(lower(u.name), ${NAME_KEY}) as k,
				(select max(s.created_at) from app.auth_session s where s.user_id = u.id) as last_session,
				coalesce((select json_agg(json_build_object('id', w.id, 'name', w.name, 'city', w.city, 'active', w.active) order by w.name, w.id)
					from app.warehouse_membership m join app.warehouse w on w.id = m.warehouse_id where m.user_id = u.id), '[]'::json) as warehouses
			from app.auth_user u left join app.role_grant g on g.user_id = u.id
			where u.email = ${query.email}
		`;
		await tx`insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
			values (${principal.id}, 'staff.lookup', ${row?.id ?? null}, 'allowed', 'Looked up an account by email', ${JSON.stringify({ found: Boolean(row) })}::jsonb)`;
		return row ? member(row) : null;
	});
}

/**
 * DEC-018 Q2: the owner resets a staff member's lost authenticator. The TOTP seed and backup codes are deleted, the
 * two-step flag is cleared and every session of the target ends; the person signs in with the password and must
 * enroll again before any staff screen opens (`getPrincipal` answers MFA_REQUIRED). The caller needs a fresh
 * `staff_mfa.reset` proof bound to the target. An owner cannot reset their own device this way (they hold it).
 */
export async function resetStaffMfa(
	request: Request,
	principal: Principal,
	identity: LocalAuth,
	body: Record<string, unknown>,
) {
	if (!principal.roles.includes("owner")) throw new AccessError(403, "FORBIDDEN");
	const key = request.headers.get("idempotency-key");
	if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400, "INVALID_IDEMPOTENCY_KEY");
	if (
		Object.keys(body).some((field) => !["user_id", "reason", "reauthentication_proof"].includes(field)) ||
		typeof body.user_id !== "string" ||
		!/^[A-Za-z0-9_-]{1,100}$/.test(body.user_id) ||
		typeof body.reason !== "string" ||
		!body.reason.trim() ||
		body.reason.length > 500 ||
		typeof body.reauthentication_proof !== "string" ||
		!body.reauthentication_proof.length ||
		body.reauthentication_proof.length > 100
	)
		throw new AccessError(400, "INVALID_INPUT");
	if (body.user_id === principal.id) throw new AccessError(403, "FORBIDDEN");
	const target = body.user_id;
	const reason = body.reason.trim();
	const proof = body.reauthentication_proof;
	const requestHash = createHash("sha256").update(JSON.stringify({ user_id: target, reason })).digest("hex");
	return identity.sql.begin(async (tx) => {
		// Same lock order as replaceStaffGrant: both users by id, then every owner grant by id. A reset of an owner and
		// an owner stepping down queue behind each other instead of both reading a stale owner set.
		const lockIds = [principal.id, target].sort();
		const users = await tx<{ id: string; two_factor_enabled: boolean }[]>`
			select id, two_factor_enabled from app.auth_user where id in ${tx(lockIds)} order by id for update`;
		if (users.length !== 2) throw new AccessError(404, "NOT_FOUND");
		await tx`select user_id from app.role_grant where 'owner'=any(roles) order by user_id for update`;
		await assertCurrentOwner(tx, principal);
		const [previous] = await tx`select request_hash, response from app.access_operation
			where actor_id=${principal.id} and action=${mfaResetAction} and key=${key}`;
		if (previous) {
			if (previous.request_hash !== requestHash) throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
			return previous.response;
		}
		const [grant] = await tx<{ roles: string[] }[]>`select roles from app.role_grant where user_id=${target}`;
		if (!grant?.roles.some((role) => STAFF_ROLE_SET.includes(role))) throw new AccessError(404, "NOT_FOUND");
		await consumeAccessProof(tx, principal, mfaResetAction, target, proof);
		const had = users.find((user) => user.id === target)?.two_factor_enabled ?? false;
		await tx`delete from app.auth_two_factor where user_id=${target}`;
		await tx`update app.auth_user set two_factor_enabled=false, updated_at=clock_timestamp() where id=${target}`;
		// The old session could have been MFA-verified with the lost device; every session of the target ends.
		await tx`delete from app.auth_session where user_id=${target}`;
		const response = { user_id: target, mfa_enabled: false };
		await tx`insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
			values (${principal.id}, ${mfaResetAction}, ${target}, 'allowed', ${reason}, ${JSON.stringify({ previous_mfa_enabled: had })}::jsonb)`;
		await tx`insert into app.access_operation (actor_id, action, key, request_hash, response)
			values (${principal.id}, ${mfaResetAction}, ${key}, ${requestHash}, ${JSON.stringify(response)}::jsonb)`;
		return response;
	});
}

export async function handleStaff(request: Request, identity: LocalAuth) {
	try {
		assertOrigin(request);
		if (["authorization", "x-cart-token", "x-order-token"].some((name) => request.headers.has(name)))
			throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
		const url = new URL(request.url);
		const route =
			request.method === "GET" && url.pathname === STAFF_PATH
				? "list"
				: request.method === "GET" && url.pathname === STAFF_LOOKUP_PATH
					? "lookup"
					: request.method === "POST" && url.pathname === STAFF_MFA_RESET_PATH
						? "reset"
						: null;
		if (!route) throw new AccessError(404, "NOT_FOUND");
		if (route === "reset" && url.search) throw new AccessError(400, "INVALID_INPUT");
		const principal = await getPrincipal(request, identity);
		// Cheap refusal before anything is parsed; the transactions re-check the grant, session and MFA in the database.
		if (!principal.roles.includes("owner")) throw new AccessError(403, "FORBIDDEN");
		if (route === "list") return privateJson(await listStaff(identity, principal, parseStaffQuery(url)));
		if (route === "lookup") {
			const found = await lookupStaffUser(identity, principal, parseLookupQuery(url));
			if (!found) throw new AccessError(404, "NOT_FOUND");
			return privateJson(found);
		}
		const body = await readBody(request);
		try {
			return privateJson(await resetStaffMfa(request, principal, identity, body), 201);
		} catch (error) {
			if (error instanceof AccessError)
				await identity.sql`insert into app.audit_event (actor_id, action, outcome, reason)
					values (${principal.id}, ${mfaResetAction}, 'denied', ${error.code})`;
			throw error;
		}
	} catch (error) {
		return problem(error);
	}
}
