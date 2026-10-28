import { isIP } from "node:net";
import type { Sql, TransactionSql } from "postgres";
import type { LocalAuth } from "./auth.ts";
import { AccessError, isStaff, type Principal } from "./policy.ts";

// S129: the signed-in user's own security state and the audit trail of its changes. Nothing here accepts a
// user id from the caller; every query is bound to the principal, so one account can never read or end
// another account's sessions. No response carries a session token, a TOTP seed or a backup code.

type Db = Sql | TransactionSql;

export type AuthAuditAction =
	| "auth.password.change"
	| "auth.sessions.terminate"
	| "auth.backup_codes.regenerate";

/** One `app.audit_event` row about the actor's own account. `reason` is a short code, never user input. */
export async function recordAuthAudit(
	sql: Db,
	event: {
		actorId: string;
		action: AuthAuditAction;
		outcome: "allowed" | "denied";
		reason: string;
		details?: Record<string, string | number | boolean | null>;
	},
) {
	await sql`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
		values (${event.actorId},${event.action},${event.actorId},${event.outcome},${event.reason},${JSON.stringify(event.details ?? {})}::jsonb)`;
}

export type OwnSession = {
	current: boolean;
	signed_in_at: string;
	expires_at: string;
	user_agent: string | null;
	ip_hint: string | null;
};

export type AccountSecurity = {
	two_factor: {
		enabled: boolean;
		/** Staff cannot turn two-step verification off; buyers have no such switch here either. */
		mandatory: boolean;
		/** When this session passed two-step verification; null if it has not. */
		verified_at: string | null;
		/** Unused backup codes; null when two-step verification is off or the count cannot be read. */
		backup_codes_remaining: number | null;
	};
	sessions: OwnSession[];
};

/** Coarse address for recognising a device: the last IPv4 octet / the IPv6 interface part is dropped. */
export function ipHint(address: string | null): string | null {
	if (!address) return null;
	const kind = isIP(address);
	if (kind === 4) return address.replace(/\.\d{1,3}$/, ".x");
	if (kind === 6) return `${address.split(":").slice(0, 3).join(":")}::x`;
	return null;
}

function userAgentLabel(value: string | null): string | null {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are removed from a header value
	const cleaned = value?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160);
	return cleaned || null;
}

async function remainingBackupCodes(identity: LocalAuth, userId: string): Promise<number | null> {
	try {
		const result = await identity.auth.api.viewBackupCodes({ body: { userId } });
		return Array.isArray(result.backupCodes) ? result.backupCodes.length : null;
	} catch {
		return null;
	}
}

export async function readAccountSecurity(identity: LocalAuth, principal: Principal): Promise<AccountSecurity> {
	const [user] = await identity.sql<{ two_factor_enabled: boolean }[]>`
		select two_factor_enabled from app.auth_user where id=${principal.id}`;
	if (!user) throw new AccessError(401, "UNAUTHENTICATED");
	const rows = await identity.sql<
		{ id: string; created_at: string; expires_at: string; ip_address: string | null; user_agent: string | null }[]
	>`select id, created_at, expires_at, ip_address, user_agent from app.auth_session
		where user_id=${principal.id} and expires_at>clock_timestamp()
		order by (id=${principal.sessionId}) desc, created_at desc limit 50`;
	return {
		two_factor: {
			enabled: user.two_factor_enabled,
			mandatory: isStaff(principal),
			verified_at: principal.mfaAt ? principal.mfaAt.toISOString() : null,
			backup_codes_remaining: user.two_factor_enabled ? await remainingBackupCodes(identity, principal.id) : null,
		},
		sessions: rows.map((row) => ({
			current: row.id === principal.sessionId,
			signed_in_at: new Date(row.created_at).toISOString(),
			expires_at: new Date(row.expires_at).toISOString(),
			user_agent: userAgentLabel(row.user_agent),
			ip_hint: ipHint(row.ip_address),
		})),
	};
}

/**
 * After Better Auth's change-password (revokeOtherSessions) the user's sessions were all replaced by one new
 * session. Carry over this session's two-step verification (never newer than it was) and write the audit row
 * in one transaction. Throws when the new session cannot be found, which handleAuth turns into a refusal so
 * no session cookie for an unverified session reaches the browser.
 */
export async function recordPasswordChange(identity: LocalAuth, principal: Principal, newToken: unknown) {
	if (typeof newToken !== "string" || !newToken) throw new AccessError(503, "SESSION_REPLACEMENT_FAILED");
	await identity.sql.begin(async (tx) => {
		const [replacement] = await tx<{ id: string }[]>`
			select id from app.auth_session where token=${newToken} and user_id=${principal.id}`;
		if (!replacement) throw new AccessError(503, "SESSION_REPLACEMENT_FAILED");
		if (principal.mfaAt) {
			await tx`insert into app.mfa_session (session_id, verified_at) values (${replacement.id}, ${principal.mfaAt.toISOString()}::timestamptz)
				on conflict (session_id) do update set verified_at=excluded.verified_at`;
		}
		await recordAuthAudit(tx, {
			actorId: principal.id,
			action: "auth.password.change",
			outcome: "allowed",
			reason: "own_password_changed",
			details: { other_sessions_revoked: true },
		});
	});
}

export type OwnProfile = {
	name: string;
	email: string;
	roles: string[];
	permissions: string[];
	/** Warehouses the user is assigned to; an owner sees every warehouse without assignments. */
	warehouses: { name: string; city: string }[];
};

/** Read-only profile: the same principal as getCurrentUser plus name, email and assigned warehouse names. */
export async function readOwnProfile(identity: LocalAuth, principal: Principal): Promise<OwnProfile> {
	const [user] = await identity.sql<{ name: string; email: string }[]>`
		select name, email from app.auth_user where id=${principal.id}`;
	if (!user) throw new AccessError(401, "UNAUTHENTICATED");
	const warehouses = await identity.sql<{ name: string; city: string }[]>`
		select w.name, w.city from app.warehouse_membership m join app.warehouse w on w.id=m.warehouse_id
		where m.user_id=${principal.id} and w.active order by w.name`;
	return {
		name: user.name,
		email: user.email,
		roles: principal.roles.filter((role) => role !== "buyer" && role !== "affiliate"),
		permissions: [...principal.permissions],
		warehouses: warehouses.map((row) => ({ name: row.name, city: row.city })),
	};
}
