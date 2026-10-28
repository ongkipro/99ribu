import { createHash, createHmac, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { LocalAuth } from "./auth.ts";
import {
	AccessError,
	hasPermission,
	permissions,
	type Principal,
	staffRoles,
} from "./policy.ts";
import { financeAuthority } from "../finance/costs.ts";

const action = "staff_roles.replace";
// S137: `staff_mfa.reset` is the owner's lost-authenticator reset (DEC-018 Q2); its proof subject is the target user.
export const mfaResetAction = "staff_mfa.reset";
const digest = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const validId = (value: unknown): value is string =>
	typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const list = (value: unknown): value is string[] =>
	Array.isArray(value) &&
	value.length <= 50 &&
	value.every((v) => typeof v === "string") &&
	new Set(value).size === value.length;

export async function assertCurrentOwner(
	tx: TransactionSql,
	principal: Principal,
	freshMfa = false,
	allowedRoles: readonly string[] = ["owner"],
) {
	const [owner] =
		await tx`select g.roles from app.role_grant g join app.auth_user u on u.id=g.user_id
    join app.auth_session s on s.user_id=u.id join app.mfa_session m on m.session_id=s.id
    where u.id=${principal.id} and s.id=${principal.sessionId} and s.expires_at>clock_timestamp() and u.two_factor_enabled
    and (not ${freshMfa} or m.verified_at>clock_timestamp()-interval '5 minutes') for share of g,s,m`;
	if (!owner?.roles.some((role: string) => allowedRoles.includes(role)))
		throw new AccessError(403, "FORBIDDEN");
}

export async function consumeAccessProof(
	tx: TransactionSql,
	principal: Principal,
	purpose: string,
	subjectId: string,
	proof: string,
) {
	const [stored] =
		await tx`update app.access_proof set consumed_at=clock_timestamp() where digest=${digest(proof)}
    and session_id=${principal.sessionId} and action=${purpose} and subject_id=${subjectId} and expires_at>clock_timestamp()
    and consumed_at is null returning digest,expires_at>clock_timestamp() as fresh`;
	// RETURNING checks wall time after any row-lock wait; the caller rolls back stale consumption.
	if (!stored?.fresh) throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
}

// Reviewed proof purposes. Finance purposes need both explicit finance grants; payout
// purposes follow manual payout claim/verify authority (owner or finance); self purposes
// bind the caller's own affiliate account or user id and reauthenticate by password
// (affiliates and buyers are not required to enroll MFA).
const financePurposes: Record<string, "reconciliation" | "refunds"> = {
	"finance.reconcile": "reconciliation",
	"finance.refund": "refunds",
	"finance.recovery_refund": "refunds",
};
const payoutPurposes = ["payout.claim", "payout.verify"];
// session.terminate_others (S129) binds the caller's own user id like support.contact_rebind; staff keep their
// MFA-verified session (getPrincipal) and add the password.
const selfPurposes = ["affiliate.beneficiary_change", "support.contact_rebind", "session.terminate_others"];
// S110: storefront content purposes are owner or ecommerce_admin with fresh MFA; one fixed company subject.
const contentPurposes: Record<string, string> = {
	"home_banner.write": "home-banners",
};
const ownerPurposes = [
	action,
	mfaResetAction,
	"company_policy.version",
	"payment_policy.version",
	"shipping_label_template.version",
	"warehouse_calendar.version",
	"warehouse_calendar.default_apply",
	"catalog_publication.exception",
	"affiliate_rate.version",
];
const uuidSubjectPurposes = [
	"warehouse_calendar.version",
	"catalog_publication.exception",
	"affiliate_rate.version",
	"affiliate.beneficiary_change",
	...Object.keys(financePurposes),
	...payoutPurposes,
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function issueAccessProof(
	request: Request,
	principal: Principal,
	identity: LocalAuth,
	body: Record<string, unknown>,
) {
	const requested = typeof body.action === "string" ? body.action : "";
	const financePurpose = Object.hasOwn(financePurposes, requested)
		? financePurposes[requested]
		: null;
	const payoutPurpose = payoutPurposes.includes(requested),
		selfPurpose = selfPurposes.includes(requested);
	const contentPurpose = Object.hasOwn(contentPurposes, requested);
	const authorized = selfPurpose
		? requested === "affiliate.beneficiary_change"
			? principal.roles.includes("affiliate")
			: body.subject_id === principal.id
		: Boolean(principal.mfaAt) &&
			(financePurpose
				? hasPermission(principal, `finance.${financePurpose}.read`) &&
					hasPermission(principal, `finance.${financePurpose}.write`)
				: payoutPurpose
					? principal.roles.some(
							(role) => role === "owner" || role === "finance",
						)
					: contentPurpose
						? principal.roles.some(
								(role) => role === "owner" || role === "ecommerce_admin",
							)
						: principal.roles.includes("owner"));
	if (!authorized) throw new AccessError(403, "FORBIDDEN");
	const key = request.headers.get("idempotency-key");
	if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key))
		throw new AccessError(400, "INVALID_IDEMPOTENCY_KEY");
	if (
		Object.keys(body).some(
			(key) => !["password", "action", "subject_id"].includes(key),
		) ||
		typeof body.action !== "string" ||
		![
			...ownerPurposes,
			...Object.keys(financePurposes),
			...payoutPurposes,
			...selfPurposes,
			...Object.keys(contentPurposes),
		].includes(body.action) ||
		!validId(body.subject_id) ||
		typeof body.password !== "string" ||
		body.password.length > 128
	)
		throw new AccessError(400, "INVALID_INPUT");
	if (
		(body.action === "company_policy.version" &&
			body.subject_id !== "company-commercial") ||
		(body.action === "payment_policy.version" &&
			body.subject_id !== "company-payment") ||
		(body.action === "shipping_label_template.version" &&
			body.subject_id !== "shipping-label-templates") ||
		(Object.hasOwn(contentPurposes, body.action) &&
			body.subject_id !== contentPurposes[body.action]) ||
		(body.action === "warehouse_calendar.default_apply" &&
			body.subject_id !== "origin-warehouses") ||
		(uuidSubjectPurposes.includes(body.action) && !uuid.test(body.subject_id))
	)
		throw new AccessError(400, "INVALID_INPUT");
	const proofAction = body.action;
	const subjectId = uuidSubjectPurposes.includes(proofAction)
		? body.subject_id.toLowerCase()
		: body.subject_id;
	const now = Date.now();
	const [rate] =
		await identity.sql`insert into app.auth_rate_limit (id,key,count,last_request)
    values (${randomUUID()},${`access-proof:${principal.id}`},1,${now}) on conflict (key) do update set
    count=case when app.auth_rate_limit.last_request<${now - 60000} then 1 else app.auth_rate_limit.count+1 end,
    last_request=case when app.auth_rate_limit.last_request<${now - 60000} then ${now} else app.auth_rate_limit.last_request end returning count,last_request`;
	if (rate.count > 5)
		throw new AccessError(
			429,
			"RATE_LIMITED",
			Math.max(1, Math.ceil((Number(rate.last_request) + 60000 - now) / 1000)),
		);
	if (
		!selfPurpose &&
		(!principal.mfaAt || now - principal.mfaAt.getTime() > 300000)
	)
		throw new AccessError(403, "FRESH_MFA_REQUIRED");
	try {
		await identity.auth.api.verifyPassword({
			headers: request.headers,
			body: { password: body.password },
		});
	} catch {
		throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
	}
	// Purpose-separated keyed derivation makes a lost response recoverable without
	// persisting plaintext proof. The session/action/target/key remain bound.
	const proof = createHmac("sha256", (await identity.auth.$context).secret)
		.update(
			JSON.stringify([
				"99ribu-access-proof-v1",
				principal.sessionId,
				proofAction,
				subjectId,
				key,
			]),
		)
		.digest("base64url");
	return identity.sql.begin(async (tx) => {
		const [currentUser] =
			await tx`select id,email_verified from app.auth_user where id=${principal.id} for update`;
		if (!currentUser?.email_verified) throw new AccessError(403, "FORBIDDEN");
		if (financePurpose) {
			await financeAuthority(
				tx,
				principal,
				`finance.${financePurpose}.read`,
				true,
			);
			await financeAuthority(
				tx,
				principal,
				`finance.${financePurpose}.write`,
				true,
			);
		} else if (payoutPurpose)
			await assertCurrentOwner(tx, principal, true, ["owner", "finance"]);
		else if (contentPurpose)
			await assertCurrentOwner(tx, principal, true, [
				"owner",
				"ecommerce_admin",
			]);
		else if (proofAction === "affiliate.beneficiary_change") {
			// The subject is the caller's own current affiliate account, never another affiliate's.
			const [own] =
				await tx`select a.id from app.affiliate_account a join app.role_grant g on g.user_id=a.user_id
        where a.id=${subjectId} and a.user_id=${principal.id} and 'affiliate'=any(g.roles) for share of a,g`;
			if (!own) throw new AccessError(403, "FORBIDDEN");
		} else if (
			proofAction !== "support.contact_rebind" &&
			proofAction !== "session.terminate_others"
		)
			await assertCurrentOwner(tx, principal, true);
		// Preserve the established per-session issuance identity across reviewed purposes.
		const operationAction = `staff_roles.proof:${principal.sessionId}`;
		const requestHash = digest(JSON.stringify([proofAction, subjectId]));
		const [previous] =
			await tx`select request_hash from app.access_operation where actor_id=${principal.id} and action=${operationAction} and key=${key}`;
		if (previous && previous.request_hash !== requestHash)
			throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
		if (!previous) {
			const expiresAt = new Date(now + 300000).toISOString();
			await tx`insert into app.access_proof (digest,session_id,action,subject_id,expires_at)
        values (${digest(proof)},${principal.sessionId},${proofAction},${subjectId},${expiresAt})`;
			await tx`insert into app.access_operation (actor_id,action,key,request_hash,response)
        values (${principal.id},${operationAction},${key},${requestHash},'{}'::jsonb)`;
		}
		const [stored] =
			await tx`select expires_at,consumed_at from app.access_proof where digest=${digest(proof)}`;
		if (
			!stored ||
			stored.consumed_at ||
			new Date(stored.expires_at).getTime() <= now
		)
			throw new AccessError(409, "PROOF_NO_LONGER_VALID");
		return { proof, expires_at: new Date(stored.expires_at).toISOString() };
	});
}

export async function replaceStaffGrant(
	request: Request,
	principal: Principal,
	identity: LocalAuth,
	body: Record<string, unknown>,
) {
	if (!principal.roles.includes("owner"))
		throw new AccessError(403, "FORBIDDEN");
	const key = request.headers.get("idempotency-key");
	if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key))
		throw new AccessError(400, "INVALID_IDEMPOTENCY_KEY");
	if (
		Object.keys(body).some(
			(field) =>
				![
					"user_id",
					"roles",
					"warehouse_ids",
					"permissions",
					"expected_version",
					"reason",
					"reauthentication_proof",
				].includes(field),
		) ||
		!validId(body.user_id) ||
		!list(body.roles) ||
		body.roles.some((role) => !(staffRoles as readonly string[]).includes(role)) ||
		!list(body.warehouse_ids) ||
		body.warehouse_ids.some(
			(id) =>
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
					id,
				),
		) ||
		!list(body.permissions) ||
		body.permissions.some(
			(permission) =>
				!permissions.includes(permission as (typeof permissions)[number]),
		) ||
		!Number.isSafeInteger(body.expected_version) ||
		Number(body.expected_version) < 0 ||
		typeof body.reason !== "string" ||
		!body.reason.trim() ||
		body.reason.length > 500 ||
		typeof body.reauthentication_proof !== "string" ||
		!body.reauthentication_proof.length ||
		body.reauthentication_proof.length > 100
	)
		throw new AccessError(400, "INVALID_INPUT");
	if (
		(body.roles.includes("warehouse") && !body.warehouse_ids.length) ||
		(body.permissions.some((permission) => permission.startsWith("finance.")) &&
			!body.roles.includes("finance"))
	)
		throw new AccessError(403, "FORBIDDEN");
	const change = {
		user_id: body.user_id,
		roles: [...body.roles].sort(),
		warehouse_ids: [...body.warehouse_ids].sort(),
		permissions: [...body.permissions].sort(),
		expected_version: Number(body.expected_version),
		reason: body.reason.trim(),
	};
	const requestHash = digest(JSON.stringify(change));
	const reauthenticationProof = body.reauthentication_proof;
	return identity.sql.begin(async (tx) => {
		// Lock actor/subject in stable order. Every grant writer uses this boundary;
		// concurrent replacement/revocation cannot authorize from a stale grant. The target may be the actor
		// (an owner stepping down), so the lock set is de-duplicated.
		const lockIds = [...new Set([principal.id, change.user_id])].sort();
		const users =
			await tx`select id from app.auth_user where id in ${tx(lockIds)} order by id for update`;
		if (users.length !== lockIds.length) throw new AccessError(404, "NOT_FOUND");
		// S137: every owner grant row is locked, in id order, before any owner is read or demoted. Two owners
		// stepping down (or removing each other) at the same time queue here, so the second one counts the owners
		// that remain AFTER the first commit; the last owner can never be removed.
		await tx`select user_id from app.role_grant where 'owner'=any(roles) order by user_id for update`;
		await assertCurrentOwner(tx, principal);
		const [previous] =
			await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action=${action} and key=${key}`;
		if (previous) {
			if (previous.request_hash !== requestHash)
				throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
			return previous.response;
		}
		const [current] =
			await tx`select id,roles,revision from app.role_grant where user_id=${change.user_id}`;
		if (current?.roles.includes("owner")) {
			const [{ remaining }] =
				await tx`select count(*)::int as remaining from app.role_grant g join app.auth_user u on u.id=g.user_id
        where 'owner'=any(g.roles) and g.user_id<>${change.user_id} and u.two_factor_enabled`;
			if (remaining < 1) throw new AccessError(409, "LAST_OWNER");
		}
		if ((current?.revision ?? 0) !== change.expected_version)
			throw new AccessError(409, "VERSION_CONFLICT");
		if (change.warehouse_ids.length) {
			const active =
				await tx`select id from app.warehouse where id in ${tx(change.warehouse_ids)} and active for share`;
			if (active.length !== change.warehouse_ids.length)
				throw new AccessError(400, "INVALID_WAREHOUSE_SCOPE");
		}
		await consumeAccessProof(
			tx,
			principal,
			action,
			change.user_id,
			reauthenticationProof,
		);
		const retained = (current?.roles ?? ["buyer"]).filter((role: string) =>
			["buyer", "affiliate"].includes(role),
		);
		// An owner who is removed or steps down keeps an ordinary account, like any other staff member.
		if (current?.roles.includes("owner")) retained.push("buyer");
		const nextRoles = [...new Set([...retained, ...change.roles])].sort();
		const [saved] =
			await tx`insert into app.role_grant (user_id,roles,permissions) values (${change.user_id},${nextRoles},${change.permissions})
      on conflict (user_id) do update set roles=excluded.roles, permissions=excluded.permissions,revision=app.role_grant.revision+1 returning id,revision`;
		await tx`delete from app.warehouse_membership where user_id=${change.user_id}`;
		for (const warehouseId of change.warehouse_ids)
			await tx`insert into app.warehouse_membership (user_id,warehouse_id) values (${change.user_id},${warehouseId})`;
		// Privilege changes invalidate every existing subject session, including MFA.
		await tx`delete from app.auth_session where user_id=${change.user_id}`;
		const response = {
			id: saved.id,
			user_id: change.user_id,
			roles: nextRoles,
			warehouse_ids: change.warehouse_ids,
			permissions: change.permissions,
			version: saved.revision,
		};
		// previous_roles makes an owner demotion visible in the trail; the replay response stays the public shape.
		await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},${action},${change.user_id},'allowed',${change.reason},${JSON.stringify({ ...response, previous_roles: current?.roles ?? [] })}::jsonb)`;
		await tx`insert into app.access_operation (actor_id,action,key,request_hash,response)
      values (${principal.id},${action},${key},${requestHash},${JSON.stringify(response)}::jsonb)`;
		return response;
	});
}
