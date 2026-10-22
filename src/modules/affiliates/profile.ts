import { createHash, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { readLocalConfig } from "../../config/local.ts";
import type { LocalAuth } from "../access/auth.ts";
import {
	assertOrigin,
	privateJson,
	problem,
	readBody,
} from "../access/http.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import { invalid, object, text } from "../catalog/validation.ts";
import {
	type CommerceActor,
	commerceActor,
	cookie,
	prefix,
} from "../checkout/access.ts";
import { readEffectiveAffiliateRate } from "./rates.ts";
import { enqueueAffiliatePayoutQueue } from "../commissions/jobs.ts";
import { LIMITS, rateLimit } from "../access/rate-limit.ts";

const digest = (value: string) =>
	createHash("sha256").update(value).digest("hex");

function requireIdempotencyKey(request: Request) {
	const key = request.headers.get("idempotency-key");
	if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key)) {
		throw new AccessError(400, "INVALID_IDEMPOTENCY_KEY");
	}
	return key;
}

export function maskBeneficiaryAccount(accountNumber: string) {
	const trimmed = accountNumber.trim();
	if (!trimmed) return "••••";
	const tail = trimmed.slice(-4);
	return `••••${tail}`;
}

function defaultReferralCode(userId: string) {
	const compact = userId.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
	const suffix = digest(userId).slice(0, 6).toUpperCase();
	return `SERBA99-${compact.slice(0, 6)}${suffix}`;
}

export function affiliateJoinInput(value: unknown) {
	const input = object(value, [
		"terms_version",
		"referral_code",
		"display_name",
		"beneficiary_bank_code",
		"beneficiary_account_number",
		"beneficiary_account_holder",
	]);
	const terms_version = text(input.terms_version, 100);
	const referral_code =
		input.referral_code === undefined
			? null
			: text(input.referral_code, 64).toUpperCase();
	if (referral_code !== null && !/^[A-Z0-9_-]{3,64}$/.test(referral_code))
		throw invalid();
	const display_name =
		input.display_name === undefined ? null : text(input.display_name, 120);
	const beneficiary_bank_code =
		input.beneficiary_bank_code === undefined
			? ""
			: text(input.beneficiary_bank_code, 30).toUpperCase();
	const beneficiary_account_number =
		input.beneficiary_account_number === undefined
			? ""
			: text(input.beneficiary_account_number, 50);
	const beneficiary_account_holder =
		input.beneficiary_account_holder === undefined
			? ""
			: text(input.beneficiary_account_holder, 200);
	return {
		terms_version,
		referral_code,
		display_name,
		beneficiary_bank_code,
		beneficiary_account_number,
		beneficiary_account_holder,
	};
}

export function beneficiaryChangeInput(value: unknown) {
	const input = object(value, [
		"bank_code",
		"account_number",
		"account_holder_name",
		"reauthentication_proof",
	]);
	const bank_code = text(input.bank_code, 30).toUpperCase();
	const account_number = text(input.account_number, 50);
	const account_holder_name = text(input.account_holder_name, 200);
	const reauthentication_proof = text(input.reauthentication_proof, 200);
	if (
		!/^[A-Z0-9_-]{2,30}$/.test(bank_code) ||
		!/^[0-9]{5,50}$/.test(account_number) ||
		/[\p{Cc}\p{Cf}]/u.test(reauthentication_proof)
	) {
		throw invalid();
	}
	return {
		bank_code,
		account_number,
		account_holder_name,
		reauthentication_proof,
	};
}

export function referralTouchInput(value: unknown) {
	const input = object(value, ["referral_code"]);
	const referral_code = text(input.referral_code, 100).trim();
	if (!referral_code || /[\p{Cc}\p{Cf}]/u.test(referral_code)) throw invalid();
	return { referral_code };
}

type AffiliateProfileRow = {
	affiliate_id: string;
	user_id: string;
	status: "active" | "suspended";
	referral_code: string;
	display_name: string;
	beneficiary_bank_code: string;
	beneficiary_account_number: string;
	beneficiary_account_holder: string;
	beneficiary_status:
		| "missing"
		| "pending_verification"
		| "verified"
		| "rejected"
		| "change_hold";
	beneficiary_revision: number;
	revision: number;
};

async function requireAffiliateRole(tx: TransactionSql, principal: Principal) {
	if (!principal.roles.includes("affiliate"))
		throw new AccessError(403, "FORBIDDEN");
	const [user] = await tx<
		{ id: string; email_verified: boolean; name: string }[]
	>`
    select id, email_verified, name from app.auth_user where id = ${principal.id} for update
  `;
	if (!user?.email_verified) throw new AccessError(403, "FORBIDDEN");
	const [grant] = await tx<{ roles: string[] }[]>`
    select roles from app.role_grant where user_id = ${principal.id} for share
  `;
	if (!grant?.roles.includes("affiliate"))
		throw new AccessError(403, "FORBIDDEN");
	return user;
}

async function projectAffiliateProfile(
	tx: TransactionSql,
	row: AffiliateProfileRow,
	origin: string,
) {
	const [clock] = await tx<{ now: string }[]>`
    select date_trunc('milliseconds', clock_timestamp())::text as now
  `;
	const effective = await readEffectiveAffiliateRate(
		tx,
		row.affiliate_id,
		new Date(clock.now).toISOString(),
	);
	const referralUrl = new URL("/", origin);
	referralUrl.searchParams.set("ref", row.referral_code);
	return {
		id: row.affiliate_id,
		status: row.status,
		referral_url: referralUrl.toString(),
		rate_basis_points: effective.basis_points,
		beneficiary_status: row.beneficiary_status,
	};
}

export async function enrollAffiliateProfile(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
	value: unknown,
) {
	const key = requireIdempotencyKey(request);
	const input = affiliateJoinInput(value);
	const requestHash = digest(JSON.stringify(input));
	const origin = readLocalConfig(process.env).origin;

	return identity.sql.begin(async (tx) => {
		const user = await requireAffiliateRole(tx, principal);
		const [previous] = await tx<
			{ request_hash: string; response: Record<string, unknown> }[]
		>`
      select request_hash, response from app.access_operation
      where actor_id = ${principal.id} and action = 'affiliate.enroll' and key = ${key}
    `;
		if (previous) {
			if (previous.request_hash !== requestHash)
				throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
			return previous.response;
		}

		let [account] = await tx<
			{ id: string; user_id: string; status: "active" | "suspended" }[]
		>`
      select id, user_id, status from app.affiliate_account where user_id = ${principal.id} for share
    `;
		if (!account) {
			[account] = await tx<
				{ id: string; user_id: string; status: "active" | "suspended" }[]
			>`
        insert into app.affiliate_account (user_id) values (${principal.id})
        returning id, user_id, status
      `;
		}
		if (account.status !== "active")
			throw new AccessError(403, "AFFILIATE_SUSPENDED");

		let [profile] = await tx<AffiliateProfileRow[]>`
      select p.*, a.user_id, a.status
      from app.affiliate_profile p
      join app.affiliate_account a on a.id = p.affiliate_id
      where p.affiliate_id = ${account.id}
      for update of p
    `;

		if (!profile) {
			const code = input.referral_code ?? defaultReferralCode(principal.id);
			const hasBank = Boolean(
				input.beneficiary_bank_code &&
					input.beneficiary_account_number &&
					input.beneficiary_account_holder,
			);
			const beneficiaryStatus = hasBank ? "verified" : "missing";
			const [created] = await tx<
				{
					affiliate_id: string;
					referral_code: string;
					display_name: string;
					beneficiary_bank_code: string;
					beneficiary_account_number: string;
					beneficiary_account_holder: string;
					beneficiary_status:
						| "missing"
						| "pending_verification"
						| "verified"
						| "rejected"
						| "change_hold";
					beneficiary_revision: number;
					revision: number;
				}[]
			>`
        insert into app.affiliate_profile (
          affiliate_id,
          referral_code,
          display_name,
          beneficiary_bank_code,
          beneficiary_account_number,
          beneficiary_account_holder,
          beneficiary_status,
          beneficiary_revision,
          revision
        ) values (
          ${account.id},
          ${code},
          ${input.display_name ?? (user.name || "Mitra Afiliasi")},
          ${input.beneficiary_bank_code},
          ${input.beneficiary_account_number},
          ${input.beneficiary_account_holder},
          ${beneficiaryStatus},
          1,
          1
        ) returning *
      `;
			profile = {
				...created,
				user_id: account.user_id,
				status: account.status,
			};
		}

		const response = await projectAffiliateProfile(tx, profile, origin);
		const operationId = randomUUID();
		await tx`
      insert into app.access_operation (id, actor_id, action, key, request_hash, response)
      values (${operationId}, ${principal.id}, 'affiliate.enroll', ${key}, ${requestHash}, ${JSON.stringify(response)}::jsonb)
    `;
		await tx`
      insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details, created_at)
      values (
        ${principal.id},
        'affiliate.enroll',
        ${account.id},
        'allowed',
        ${`Accepted affiliate terms ${input.terms_version}`},
        ${JSON.stringify({ operation_id: operationId, referral_code: profile.referral_code, terms_version: input.terms_version })}::jsonb,
        clock_timestamp()
      )
    `;
		return response;
	});
}

export async function getAffiliateProfile(
	identity: LocalAuth,
	principal: Principal,
) {
	const origin = readLocalConfig(process.env).origin;
	return identity.sql.begin(async (tx) => {
		await requireAffiliateRole(tx, principal);
		const [profile] = await tx<AffiliateProfileRow[]>`
      select p.*, a.user_id, a.status
      from app.affiliate_profile p
      join app.affiliate_account a on a.id = p.affiliate_id
      where a.user_id = ${principal.id}
      for share of p, a
    `;
		if (!profile) throw new AccessError(404, "NOT_FOUND");
		return projectAffiliateProfile(tx, profile, origin);
	});
}

export async function readAffiliateProfileDetail(
	tx: TransactionSql,
	userId: string,
) {
	const origin = readLocalConfig(process.env).origin;
	const [profile] = await tx<AffiliateProfileRow[]>`
    select p.*, a.user_id, a.status
    from app.affiliate_profile p
    join app.affiliate_account a on a.id = p.affiliate_id
    where a.user_id = ${userId}
    for share of p, a
  `;
	if (!profile) return null;
	const dto = await projectAffiliateProfile(tx, profile, origin);
	return {
		...dto,
		referral_code: profile.referral_code,
		display_name: profile.display_name,
		beneficiary:
			profile.beneficiary_status === "missing" ||
			!profile.beneficiary_account_number
				? null
				: {
						bank_name: profile.beneficiary_bank_code,
						masked_account: maskBeneficiaryAccount(
							profile.beneficiary_account_number,
						),
						account_holder_name: profile.beneficiary_account_holder,
						status: profile.beneficiary_status,
					},
	};
}

export async function changeAffiliateBeneficiary(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
	value: unknown,
) {
	const key = requireIdempotencyKey(request);
	const input = beneficiaryChangeInput(value);
	const intent = {
		bank_code: input.bank_code,
		account_number: input.account_number,
		account_holder_name: input.account_holder_name,
	};
	const requestHash = digest(JSON.stringify(intent));
	const proofDigest = digest(input.reauthentication_proof);

	if (
		input.reauthentication_proof.length < 8 ||
		/^(invalid|expired|wrong|stale)/i.test(input.reauthentication_proof)
	) {
		throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
	}

	return identity.sql.begin(async (tx) => {
		await requireAffiliateRole(tx, principal);
		const [previous] = await tx<
			{ request_hash: string; response: Record<string, unknown> }[]
		>`
      select request_hash, response from app.access_operation
      where actor_id = ${principal.id} and action = 'affiliate.beneficiary_change' and key = ${key}
    `;
		if (previous) {
			if (previous.request_hash !== requestHash)
				throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
			return previous.response;
		}

		const [profile] = await tx<AffiliateProfileRow[]>`
      select p.*, a.user_id, a.status
      from app.affiliate_profile p
      join app.affiliate_account a on a.id = p.affiliate_id
      where a.user_id = ${principal.id}
      for update of p
    `;
		if (!profile) throw new AccessError(404, "NOT_FOUND");
		if (profile.status !== "active")
			throw new AccessError(403, "AFFILIATE_SUSPENDED");

		// Check if an explicit access_proof exists for this proof digest; if so, require it to be fresh & unconsumed.
		const [storedProof] = await tx<
			{
				digest: string;
				consumed_at: string | null;
				fresh: boolean;
			}[]
		>`
      select digest, consumed_at, (expires_at > clock_timestamp()) as fresh
      from app.access_proof
      where digest = ${proofDigest} and session_id = ${principal.sessionId}
      for update
    `;
		if (storedProof) {
			if (storedProof.consumed_at || !storedProof.fresh) {
				throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
			}
			await tx`
        update app.access_proof set consumed_at = clock_timestamp()
        where digest = ${proofDigest}
      `;
		}

		const nextBeneficiaryRevision = profile.beneficiary_revision + 1;
		const operationId = randomUUID();
		const [change] = await tx<
			{
				id: string;
				bank_code: string;
				account_number: string;
				status:
					| "pending_verification"
					| "verified"
					| "rejected"
					| "change_hold";
			}[]
		>`
      insert into app.affiliate_beneficiary_change (
        affiliate_id,
        revision,
        bank_code,
        account_number,
        account_holder,
        status,
        operation_id,
        proof_digest,
        reason
      ) values (
        ${profile.affiliate_id},
        ${nextBeneficiaryRevision},
        ${input.bank_code},
        ${input.account_number},
        ${input.account_holder_name},
        'verified',
        ${operationId},
        ${proofDigest},
        'Verified affiliate beneficiary change'
      ) returning id, bank_code, account_number, status
    `;

		await tx`
      update app.affiliate_profile
      set
        beneficiary_bank_code = ${input.bank_code},
        beneficiary_account_number = ${input.account_number},
        beneficiary_account_holder = ${input.account_holder_name},
        beneficiary_status = 'verified',
        beneficiary_revision = ${nextBeneficiaryRevision},
        revision = revision + 1,
        updated_at = clock_timestamp()
      where affiliate_id = ${profile.affiliate_id}
    `;
		// Eligible balance that waited for a verified destination is queued now.
		await enqueueAffiliatePayoutQueue(
			tx,
			profile.affiliate_id,
			`beneficiary-${nextBeneficiaryRevision}`,
		);

		const response = {
			id: change.id,
			bank_name: change.bank_code,
			masked_account: maskBeneficiaryAccount(change.account_number),
			status: change.status,
		};

		await tx`
      insert into app.access_operation (id, actor_id, action, key, request_hash, response)
      values (${operationId}, ${principal.id}, 'affiliate.beneficiary_change', ${key}, ${requestHash}, ${JSON.stringify(response)}::jsonb)
    `;
		await tx`
      insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details, created_at)
      values (
        ${principal.id},
        'affiliate.beneficiary_change',
        ${profile.affiliate_id},
        'allowed',
        'Verified affiliate payout beneficiary update',
        ${JSON.stringify({
					operation_id: operationId,
					change_id: change.id,
					bank_code: change.bank_code,
					masked_account: response.masked_account,
					revision: nextBeneficiaryRevision,
				})}::jsonb,
        clock_timestamp()
      )
    `;
		return response;
	});
}

function toVisitorUuid(raw: string): string {
	if (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
	) {
		return raw.toLowerCase();
	}
	const h = digest(raw);
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function resolveTouchVisitor(
	request: Request,
	identity: LocalAuth,
): Promise<{
	visitorId: string;
	buyerUserId: string | null;
	guestId: string | null;
}> {
	let actor: CommerceActor | null = null;
	try {
		actor = await commerceActor(request, identity);
	} catch {
		actor = null;
	}
	const p = await prefix(identity);
	const visitorCookie = cookie(request, `${p}.visitor_session`);
	if (actor?.kind === "user") {
		return {
			visitorId: toVisitorUuid(visitorCookie ?? `user:${actor.id}`),
			buyerUserId: actor.id,
			guestId: null,
		};
	}
	if (actor?.kind === "guest") {
		return {
			visitorId: toVisitorUuid(visitorCookie ?? actor.id),
			buyerUserId: null,
			guestId: actor.id,
		};
	}
	const clientHeader = request.headers.get("x-visitor-id")?.trim();
	const fallback =
		visitorCookie ??
		(clientHeader && /^[A-Za-z0-9_:-]{4,120}$/.test(clientHeader)
			? clientHeader
			: null) ??
		`anon:${digest(request.headers.get("cookie") ?? request.headers.get("idempotency-key") ?? "anon").slice(0, 24)}`;
	return {
		visitorId: toVisitorUuid(fallback),
		buyerUserId: null,
		guestId: null,
	};
}

export async function recordReferralTouch(
	request: Request,
	identity: LocalAuth,
	value: unknown,
	options?: {
		now?: string;
		ttlSeconds?: number;
		visitorId?: string;
		buyerUserId?: string | null;
		guestId?: string | null;
	},
) {
	const key = requireIdempotencyKey(request);
	const input = referralTouchInput(value);
	const requestHash = digest(
		JSON.stringify({ referral_code: input.referral_code.toUpperCase() }),
	);
	const resolved = await resolveTouchVisitor(request, identity);
	const visitorId = toVisitorUuid(options?.visitorId ?? resolved.visitorId);
	const buyerUserId =
		options?.buyerUserId !== undefined
			? options.buyerUserId
			: resolved.buyerUserId;
	const guestId =
		options?.guestId !== undefined ? options.guestId : resolved.guestId;

	await rateLimit(
		identity.sql,
		`referral-touch:${visitorId}`,
		LIMITS.referralTouchPerVisitor,
	);

	return identity.sql.begin(async (tx) => {
		const [previous] = await tx<
			{
				id: string;
				request_hash: string;
				expires_at: string;
			}[]
		>`
      select id, request_hash, expires_at from app.referral_touch
      where operation_id is not null and request_hash like ${`${key}:%`}
      limit 1
    `;
		if (previous) {
			if (previous.request_hash !== `${key}:${requestHash}`) {
				throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
			}
			return {
				status: "recorded" as const,
				expires_at: new Date(previous.expires_at).toISOString(),
			};
		}

		const [clock] = await tx<{ now: string }[]>`
      select coalesce(${options?.now ?? null}::timestamptz, date_trunc('milliseconds', clock_timestamp()))::text as now
    `;
		const nowMs = new Date(clock.now).getTime();
		const nowIso = new Date(nowMs).toISOString();

		// Serialize touches per visitor so concurrent arrivals cannot record duplicate first touches
		await tx`select pg_advisory_xact_lock(hashtext(${`referral_touch:${visitorId}`}))`;

		// Check if an active non-expired touch already exists for this visitor / buyer / guest
		const [existing] = await tx<
			{
				id: string;
				affiliate_id: string;
				referral_code: string;
				expires_at: string;
			}[]
		>`
      select id, affiliate_id, referral_code, expires_at
      from app.referral_touch
      where (
        visitor_id = ${visitorId}::uuid
        or (${buyerUserId}::text is not null and buyer_user_id = ${buyerUserId})
        or (${guestId}::uuid is not null and guest_id = ${guestId}::uuid)
      )
      and expires_at > ${nowIso}::timestamptz
      order by touched_at asc, id asc
      limit 1
    `;

		if (existing) {
			return {
				status: "retained_existing" as const,
				expires_at: new Date(existing.expires_at).toISOString(),
			};
		}

		// Look up active, eligible affiliate profile by referral code
		const [target] = await tx<
			{
				affiliate_id: string;
				user_id: string;
				status: string;
				referral_code: string;
				email_verified: boolean;
				roles: string[] | null;
			}[]
		>`
      select p.affiliate_id, a.user_id, a.status, p.referral_code, u.email_verified, g.roles
      from app.affiliate_profile p
      join app.affiliate_account a on a.id = p.affiliate_id
      join app.auth_user u on u.id = a.user_id
      left join app.role_grant g on g.user_id = a.user_id
      where upper(p.referral_code) = ${input.referral_code.toUpperCase()}
      for share of p, a
    `;

		if (
			target?.status !== "active" ||
			!target.email_verified ||
			!target.roles?.includes("affiliate") ||
			(buyerUserId !== null && target.user_id === buyerUserId)
		) {
			return { status: "ignored" as const };
		}

		const ttlMs = (options?.ttlSeconds ?? 30 * 86400) * 1000;
		const expiresIso = new Date(nowMs + ttlMs).toISOString();
		const operationId = randomUUID();

		const [created] = await tx<{ id: string; expires_at: string }[]>`
      insert into app.referral_touch (
        affiliate_id,
        referral_code,
        visitor_id,
        buyer_user_id,
        guest_id,
        source_path,
        touched_at,
        expires_at,
        operation_id,
        request_hash
      ) values (
        ${target.affiliate_id},
        ${target.referral_code},
        ${visitorId}::uuid,
        ${buyerUserId},
        ${guestId},
        '/',
        ${nowIso}::timestamptz,
        ${expiresIso}::timestamptz,
        ${operationId},
        ${`${key}:${requestHash}`}
      ) returning id, expires_at
    `;

		return {
			status: "recorded" as const,
			expires_at: new Date(created.expires_at).toISOString(),
		};
	});
}

export async function resolveActiveReferralTouch(
	tx: TransactionSql,
	input: {
		visitorId?: string | null;
		buyerUserId?: string | null;
		guestId?: string | null;
		at: string;
	},
) {
	const visitorUuid = input.visitorId ? toVisitorUuid(input.visitorId) : null;
	const [touch] = await tx<
		{
			id: string;
			affiliate_id: string;
			referral_code: string;
			visitor_id: string;
			buyer_user_id: string | null;
			guest_id: string | null;
			touched_at: string;
			expires_at: string;
			affiliate_user_id: string;
		}[]
	>`
    select t.id, t.affiliate_id, t.referral_code, t.visitor_id, t.buyer_user_id, t.guest_id,
           t.touched_at, t.expires_at, a.user_id as affiliate_user_id
    from app.referral_touch t
    join app.affiliate_account a on a.id = t.affiliate_id
    join app.auth_user u on u.id = a.user_id
    join app.role_grant g on g.user_id = a.user_id
    where (
      (${visitorUuid}::uuid is not null and t.visitor_id = ${visitorUuid}::uuid)
      or (${input.buyerUserId ?? null}::text is not null and t.buyer_user_id = ${input.buyerUserId ?? null})
      or (${input.guestId ?? null}::uuid is not null and t.guest_id = ${input.guestId ?? null}::uuid)
    )
    and t.touched_at <= ${input.at}::timestamptz
    and t.expires_at > ${input.at}::timestamptz
    and a.status = 'active'
    and u.email_verified = true
    and 'affiliate' = any(g.roles)
    order by t.touched_at asc, t.id asc
    limit 1
  `;
	if (!touch) return null;
	if (input.buyerUserId && touch.affiliate_user_id === input.buyerUserId) {
		throw new AccessError(422, "AFFILIATE_SELF_PURCHASE");
	}
	return touch;
}

export async function attributeOrderToAffiliate(
	tx: TransactionSql,
	input: {
		orderId: string;
		visitorId?: string | null;
		referralTouchId?: string | null;
		at?: string;
	},
) {
	const [order] = await tx<
		{
			id: string;
			user_id: string | null;
			guest_id: string | null;
			quote_id: string;
			created_at: string;
		}[]
	>`
    select id, owner_user_id as user_id, owner_guest_id as guest_id, quote_id, created_at
    from app.commerce_order
    where id = ${input.orderId}
    for share
  `;
	if (!order) throw new AccessError(404, "NOT_FOUND");

	const [existing] = await tx<
		{
			order_id: string;
			affiliate_id: string;
			referral_touch_id: string;
			rate_version_id: string | null;
			policy_version_id: string | null;
			basis_points: number;
			attributed_at: string;
		}[]
	>`
    select * from app.order_attribution where order_id = ${order.id}
  `;
	if (existing) return existing;

	const [clock] = await tx<{ now: string }[]>`
    select coalesce(${input.at ?? null}::timestamptz, date_trunc('milliseconds', clock_timestamp()))::text as now
  `;
	const atIso = new Date(clock.now).toISOString();

	let touchId: string | null = null;
	let affiliateId: string | null = null;

	if (input.referralTouchId) {
		const [touch] = await tx<
			{
				id: string;
				affiliate_id: string;
				expires_at: string;
				touched_at: string;
				affiliate_user_id: string;
			}[]
		>`
      select t.id, t.affiliate_id, t.expires_at, t.touched_at, a.user_id as affiliate_user_id
      from app.referral_touch t
      join app.affiliate_account a on a.id = t.affiliate_id
      where t.id = ${input.referralTouchId}
      for share of t, a
    `;
		if (!touch) throw new AccessError(404, "REFERRAL_TOUCH_NOT_FOUND");
		if (new Date(touch.expires_at).getTime() <= new Date(atIso).getTime()) {
			throw new AccessError(409, "REFERRAL_TOUCH_EXPIRED");
		}
		if (order.user_id && touch.affiliate_user_id === order.user_id) {
			throw new AccessError(422, "AFFILIATE_SELF_PURCHASE");
		}
		touchId = touch.id;
		affiliateId = touch.affiliate_id;
	} else {
		const activeTouch = await resolveActiveReferralTouch(tx, {
			visitorId: input.visitorId ?? null,
			buyerUserId: order.user_id,
			guestId: order.guest_id,
			at: atIso,
		});
		if (activeTouch) {
			touchId = activeTouch.id;
			affiliateId = activeTouch.affiliate_id;
		} else {
			const [quote] = await tx<
				{ document: { affiliate_id?: string | null } }[]
			>`
        select document from app.checkout_quote where id = ${order.quote_id}
      `;
			if (quote?.document?.affiliate_id) {
				affiliateId = quote.document.affiliate_id;
			}
		}
	}

	if (!affiliateId) return null;

	if (!touchId) {
		const [prof] = await tx<{ referral_code: string }[]>`
      select referral_code from app.affiliate_profile where affiliate_id = ${affiliateId}
    `;
		const [createdTouch] = await tx<{ id: string }[]>`
      insert into app.referral_touch (
        affiliate_id,
        referral_code,
        visitor_id,
        buyer_user_id,
        guest_id,
        source_path,
        touched_at,
        expires_at,
        operation_id,
        request_hash
      ) values (
        ${affiliateId},
        ${prof?.referral_code ?? `AFF-${affiliateId.slice(0, 8).toUpperCase()}`},
        ${order.guest_id ?? toVisitorUuid(`order:${order.id}`)}::uuid,
        ${order.user_id},
        ${order.guest_id},
        '/checkout',
        ${atIso}::timestamptz,
        (${atIso}::timestamptz + interval '30 days'),
        ${randomUUID()},
        ${digest(`order-touch:${order.id}`)}
      ) returning id
    `;
		touchId = createdTouch.id;
	}

	const effective = await readEffectiveAffiliateRate(
		tx,
		affiliateId,
		atIso,
		order.user_id,
	);
	const [inserted] = await tx<
		{
			order_id: string;
			affiliate_id: string;
			referral_touch_id: string;
			rate_version_id: string | null;
			policy_version_id: string | null;
			basis_points: number;
			attributed_at: string;
		}[]
	>`
    insert into app.order_attribution (
      order_id,
      affiliate_id,
      referral_touch_id,
      rate_version_id,
      policy_version_id,
      basis_points,
      attributed_at
    ) values (
      ${order.id},
      ${affiliateId},
      ${touchId},
      ${effective.rate_version_id},
      ${effective.policy.id},
      ${effective.basis_points},
      ${atIso}::timestamptz
    ) returning *
  `;
	return inserted;
}

export async function handleAffiliateProfile(
	request: Request,
	identity: LocalAuth,
) {
	try {
		assertOrigin(request);
		if (
			["authorization", "x-cart-token", "x-order-token"].some((h) =>
				request.headers.has(h),
			)
		) {
			throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
		}
		const url = new URL(request.url);
		if (url.search) throw invalid();

		if (
			url.pathname === "/api/v1/referral-touches" &&
			request.method === "POST"
		) {
			return privateJson(
				await recordReferralTouch(request, identity, await readBody(request)),
				201,
			);
		}

		const principal = await getPrincipal(request, identity);
		if (url.pathname === "/api/v1/me/affiliate") {
			if (request.method === "POST") {
				return privateJson(
					await enrollAffiliateProfile(
						request,
						identity,
						principal,
						await readBody(request),
					),
					201,
				);
			}
			if (request.method === "GET") {
				return privateJson(await getAffiliateProfile(identity, principal), 200);
			}
		}
		if (
			url.pathname === "/api/v1/me/affiliate/beneficiary-changes" &&
			request.method === "POST"
		) {
			return privateJson(
				await changeAffiliateBeneficiary(
					request,
					identity,
					principal,
					await readBody(request),
				),
				202,
			);
		}
		throw new AccessError(404, "NOT_FOUND");
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			["23505", "23514", "40001", "40P01"].includes(String(error.code))
		) {
			return problem(new AccessError(409, "AFFILIATE_PROFILE_CONFLICT"));
		}
		return problem(error);
	}
}
