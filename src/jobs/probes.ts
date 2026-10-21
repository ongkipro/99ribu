import { createHash, randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { readLocalConfig } from "../config/local.ts";
import { AccessError } from "../modules/access/policy.ts";
import { id, text } from "../modules/catalog/validation.ts";
import { type DatabaseJob, processDatabaseJob } from "./worker.ts";

const digest = (value: string) =>
	createHash("sha256").update(value).digest("hex");

export type StuckExpiryProbe = {
	job_id: string;
	kind: "inventory.reservation.expire" | "promotion.reservation.expire";
	job_status: "failed" | "unknown";
	last_error: string | null;
	attempts: number;
	max_attempts: number;
	reservation_id: string;
	reservation_status: string;
	expires_at: string;
	clock_namespace: string | null;
};

export type OrphanSeedOperatorProbe = {
	user_id: string;
	namespace: string;
	active_sessions: number;
	mfa_sessions: number;
	pending_deliveries: number;
	created_at: string;
};

export type OperationalProbeSnapshot = {
	environment: "local";
	remote_availability_claim: false;
	observed_at: string;
	backlog: {
		pending: number;
		processing: number;
		unknown: number;
		failed: number;
		completed: number;
		oldest_pending_seconds: number | null;
	};
	dead_letters: {
		id: string;
		kind: string;
		attempts: number;
		max_attempts: number;
		last_error: string | null;
	}[];
	uncertain_jobs: {
		id: string;
		kind: string;
		attempts: number;
		max_attempts: number;
		last_error: string | null;
	}[];
	stuck_expiry_reservations: StuckExpiryProbe[];
	orphan_seed_operators: OrphanSeedOperatorProbe[];
};

function parseSeedNamespace(email: string, name: string): string | null {
	const emailMatch =
		/^([a-z][a-z0-9-]{0,23})\.seed(?:-op)?-[a-z0-9-]+@example\.(?:invalid|test)$/i.exec(
			email,
		);
	if (emailMatch) return emailMatch[1].toLowerCase();
	const prefixMatch =
		/^seed-([a-z][a-z0-9-]{0,23})-[a-z0-9-]+@example\.(?:invalid|test)$/i.exec(
			email,
		);
	if (prefixMatch) return prefixMatch[1].toLowerCase();
	const nameMatch = /\[([a-z][a-z0-9-]{0,23})\]$/.exec(name);
	if (nameMatch && /^seed-[a-z0-9-]+@example\.(?:invalid|test)$/i.test(email))
		return nameMatch[1];
	return null;
}

export async function inspectOperationalProbes(
	sql: Sql | TransactionSql,
	options: { namespace?: string; jobIds?: readonly string[] } = {},
): Promise<OperationalProbeSnapshot> {
	readLocalConfig(process.env);
	if (
		options.namespace !== undefined &&
		!/^[a-z][a-z0-9-]{0,23}$/.test(options.namespace)
	) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const filterIds = options.jobIds?.map((value) => id(value)) ?? null;

	const [counts] = await sql<
		{
			now: string;
			pending: number;
			processing: number;
			unknown: number;
			failed: number;
			completed: number;
			oldest_pending_seconds: number | null;
		}[]
	>`
    select
      clock_timestamp()::text as now,
      count(*) filter (where status='pending')::int as pending,
      count(*) filter (where status='processing')::int as processing,
      count(*) filter (where status='unknown')::int as unknown,
      count(*) filter (where status='failed')::int as failed,
      count(*) filter (where status='completed')::int as completed,
      (max(extract(epoch from (clock_timestamp() - created_at))) filter (where status='pending'))::int as oldest_pending_seconds
    from app.outbox_job
    where (${filterIds === null} or id in ${sql(filterIds?.length ? filterIds : ["00000000-0000-0000-0000-000000000000"])})
  `;

	const deadLetters = await sql<
		{
			id: string;
			kind: string;
			attempts: number;
			max_attempts: number;
			last_error: string | null;
		}[]
	>`
    select id, kind, attempts, max_attempts, last_error
    from app.outbox_job
    where status='failed'
      and (${filterIds === null} or id in ${sql(filterIds?.length ? filterIds : ["00000000-0000-0000-0000-000000000000"])})
    order by created_at desc, id
    limit 100
  `;

	const uncertainJobs = await sql<
		{
			id: string;
			kind: string;
			attempts: number;
			max_attempts: number;
			last_error: string | null;
		}[]
	>`
    select id, kind, attempts, max_attempts, last_error
    from app.outbox_job
    where status='unknown'
      and (${filterIds === null} or id in ${sql(filterIds?.length ? filterIds : ["00000000-0000-0000-0000-000000000000"])})
    order by created_at desc, id
    limit 100
  `;

	const stuckInventory = await sql<StuckExpiryProbe[]>`
    select
      j.id as job_id,
      j.kind as kind,
      j.status as job_status,
      j.last_error,
      j.attempts,
      j.max_attempts,
      r.id as reservation_id,
      r.status as reservation_status,
      r.expires_at::text as expires_at,
      r.clock_namespace
    from app.outbox_job j
    join app.stock_reservation r on r.id::text = j.payload->>'reservationId'
    where j.kind = 'inventory.reservation.expire'
      and j.status in ('failed', 'unknown')
      and r.status = 'active'
      and (${options.namespace ?? null}::text is null or r.clock_namespace = ${options.namespace ?? null})
      and (${filterIds === null} or j.id in ${sql(filterIds?.length ? filterIds : ["00000000-0000-0000-0000-000000000000"])})
    order by j.created_at, j.id
  `;

	const stuckPromotion = await sql<StuckExpiryProbe[]>`
    select
      j.id as job_id,
      j.kind as kind,
      j.status as job_status,
      j.last_error,
      j.attempts,
      j.max_attempts,
      r.id as reservation_id,
      r.status as reservation_status,
      r.expires_at::text as expires_at,
      r.clock_namespace
    from app.outbox_job j
    join app.promotion_reservation r on r.id::text = j.payload->>'reservationId'
    where j.kind = 'promotion.reservation.expire'
      and j.status in ('failed', 'unknown')
      and r.status = 'active'
      and (${options.namespace ?? null}::text is null or r.clock_namespace = ${options.namespace ?? null})
      and (${filterIds === null} or j.id in ${sql(filterIds?.length ? filterIds : ["00000000-0000-0000-0000-000000000000"])})
    order by j.created_at, j.id
  `;

	const orphanCandidates = await sql<
		{
			user_id: string;
			email: string;
			name: string;
			active_sessions: number;
			mfa_sessions: number;
			pending_deliveries: number;
			created_at: string;
		}[]
	>`
    select
      u.id as user_id,
      u.email,
      u.name,
      (select count(*)::int from app.auth_session s where s.user_id = u.id and s.expires_at > clock_timestamp()) as active_sessions,
      (select count(*)::int from app.auth_session s join app.mfa_session m on m.session_id = s.id where s.user_id = u.id and s.expires_at > clock_timestamp()) as mfa_sessions,
      (select count(*)::int from app.local_delivery d where d.recipient = u.email) as pending_deliveries,
      u.created_at::text as created_at
    from app.auth_user u
    where not exists (select 1 from app.local_fixture_principal p where p.user_id = u.id)
      and (
        u.email ~ '^[a-z0-9-]+\.seed(-op)?-[a-z0-9-]+@example\.(invalid|test)$'
        or u.email ~ '^seed-[a-z0-9-]+@example\.(invalid|test)$'
      )
    order by u.created_at, u.id
  `;

	const orphanSeedOperators: OrphanSeedOperatorProbe[] = [];
	for (const row of orphanCandidates) {
		const parsedNamespace = parseSeedNamespace(row.email, row.name);
		if (!parsedNamespace) continue;
		if (
			options.namespace !== undefined &&
			parsedNamespace !== options.namespace
		)
			continue;
		orphanSeedOperators.push({
			user_id: row.user_id,
			namespace: parsedNamespace,
			active_sessions: row.active_sessions,
			mfa_sessions: row.mfa_sessions,
			pending_deliveries: row.pending_deliveries,
			created_at: new Date(row.created_at).toISOString(),
		});
	}

	return {
		environment: "local",
		remote_availability_claim: false,
		observed_at: new Date(counts.now).toISOString(),
		backlog: {
			pending: counts.pending,
			processing: counts.processing,
			unknown: counts.unknown,
			failed: counts.failed,
			completed: counts.completed,
			oldest_pending_seconds: counts.oldest_pending_seconds,
		},
		dead_letters: deadLetters,
		uncertain_jobs: uncertainJobs,
		stuck_expiry_reservations: [...stuckInventory, ...stuckPromotion],
		orphan_seed_operators: orphanSeedOperators,
	};
}

export async function recoverFailedExpiryJob(
	sql: Sql,
	jobId: string,
	reason: string,
	actorId = "operator:recovery",
) {
	readLocalConfig(process.env);
	const targetJobId = id(jobId);
	const cleanReason = text(reason, 500);
	const cleanActor = text(actorId, 200);

	return sql.begin(async (tx) => {
		const [job] = await tx<
			(DatabaseJob & {
				status: string;
				result: Record<string, unknown> | null;
			})[]
		>`
      select id, kind, payload, attempts, max_attempts, status, result
      from app.outbox_job
      where id = ${targetJobId}
      for update
    `;
		if (!job) throw new AccessError(404, "NOT_FOUND");
		if (
			![
				"inventory.reservation.expire",
				"promotion.reservation.expire",
			].includes(job.kind)
		) {
			throw new AccessError(400, "INVALID_EXPIRY_RECOVERY_KIND");
		}

		const reservationId = id(
			(job.payload as Record<string, unknown>)?.reservationId,
		);
		if (job.status === "completed") {
			const [current] =
				job.kind === "inventory.reservation.expire"
					? await tx<
							{ status: string }[]
						>`select status from app.stock_reservation where id = ${reservationId}`
					: await tx<
							{ status: string }[]
						>`select status from app.promotion_reservation where id = ${reservationId}`;
			return {
				job_id: job.id,
				kind: job.kind,
				job_status: "completed" as const,
				reservation_id: reservationId,
				reservation_status: current?.status ?? "unknown",
				replayed: true,
			};
		}

		if (!["failed", "unknown"].includes(job.status)) {
			throw new AccessError(409, "JOB_NOT_IN_FAILED_STATE");
		}

		const resetAttempts = Math.max(
			0,
			Math.min(job.attempts, job.max_attempts) - 1,
		);
		await tx`
      update app.outbox_job
      set status = 'pending',
          attempts = ${resetAttempts},
          last_error = null,
          completed_at = null,
          lease_token = null,
          lease_until = null,
          run_at = clock_timestamp()
      where id = ${job.id}
    `;

		await processDatabaseJob(tx, {
			id: job.id,
			kind: job.kind,
			payload: job.payload,
			attempts: resetAttempts,
			max_attempts: job.max_attempts,
		});

		const [updatedJob] = await tx<
			{ status: string; last_error: string | null; attempts: number }[]
		>`
      select status, last_error, attempts from app.outbox_job where id = ${job.id}
    `;
		const [reservation] =
			job.kind === "inventory.reservation.expire"
				? await tx<
						{ status: string }[]
					>`select status from app.stock_reservation where id = ${reservationId}`
				: await tx<
						{ status: string }[]
					>`select status from app.promotion_reservation where id = ${reservationId}`;

		if (
			!reservation ||
			updatedJob.status !== "completed" ||
			reservation.status === "active"
		) {
			throw new AccessError(409, "EXPIRY_RECOVERY_INCOMPLETE");
		}

		await tx`
      insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
      values (
        ${cleanActor},
        'outbox.expiry_job.recover',
        ${job.id},
        'allowed',
        ${cleanReason},
        ${JSON.stringify({
					job_id: job.id,
					kind: job.kind,
					reservation_id: reservationId,
					reservation_status: reservation.status,
					attempts: updatedJob.attempts,
				})}::jsonb
      )
    `;

		return {
			job_id: job.id,
			kind: job.kind,
			job_status: updatedJob.status as "completed",
			reservation_id: reservationId,
			reservation_status: reservation.status,
			replayed: false,
		};
	});
}

export async function recoverOrphanSeedOperators(
	sql: Sql,
	namespace: string,
	explicitUserIds: readonly string[],
	reason = "Recover namespace-tagged orphan synthetic seed operators after host failure",
	actorId = "operator:recovery",
) {
	readLocalConfig(process.env);
	if (!/^[a-z][a-z0-9-]{0,23}$/.test(namespace))
		throw new AccessError(400, "INVALID_INPUT");
	if (
		!Array.isArray(explicitUserIds) ||
		explicitUserIds.length === 0 ||
		explicitUserIds.length > 50
	) {
		throw new AccessError(400, "EXPLICIT_IDENTITIES_REQUIRED");
	}
	const targetIds = [...new Set(explicitUserIds.map((u) => text(u, 100)))];
	if (targetIds.length !== explicitUserIds.length)
		throw new AccessError(400, "INVALID_INPUT");
	const cleanReason = text(reason, 500);
	const cleanActor = text(actorId, 200);

	return sql.begin(async (tx) => {
		const recovered: string[] = [];
		let revokedSessions = 0;

		for (const userId of targetIds) {
			const [user] = await tx<{ id: string; email: string; name: string }[]>`
        select id, email, name from app.auth_user where id = ${userId} for update
      `;
			if (!user) throw new AccessError(404, "NOT_FOUND");

			const [principal] = await tx`
        select user_id from app.local_fixture_principal where user_id = ${user.id}
      `;
			const userNamespace = parseSeedNamespace(user.email, user.name);
			if (principal || userNamespace !== namespace) {
				throw new AccessError(409, "ORPHAN_SEED_SCOPE_MISMATCH");
			}

			const [sessionCount] = await tx<{ n: number }[]>`
        select count(*)::int as n from app.auth_session where user_id = ${user.id}
      `;
			revokedSessions += sessionCount.n;

			await tx`
        delete from app.outbox_job
        where kind = 'local.notification'
          and payload->>'deliveryId' in (
            select id::text from app.local_delivery where recipient = ${user.email}
          )
      `;
			await tx`delete from app.local_delivery where recipient = ${user.email}`;
			await tx`delete from app.auth_verification where value = ${user.id}`;
			await tx`delete from app.access_operation where actor_id = ${user.id}`;
			await tx`delete from app.auth_rate_limit where key = ${`access-proof:${user.id}`}`;
			await tx`delete from app.auth_user where id = ${user.id}`;
			recovered.push(user.id);
		}

		await tx`
      insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
      values (
        ${cleanActor},
        'local_fixture.orphan_operator.recover',
        ${namespace},
        'allowed',
        ${cleanReason},
        ${JSON.stringify({ namespace, recovered_user_ids: recovered, revoked_sessions: revokedSessions })}::jsonb
      )
    `;

		return {
			namespace,
			recovered_user_ids: recovered,
			revoked_sessions: revokedSessions,
		};
	});
}

export async function recoverUndeliveredSignInSession(
	sql: Sql,
	sessionId: string,
	guestContextToken: string,
	reason = "Revoke undelivered sign-in session after guest-context revocation failure",
	actorId = "operator:recovery",
) {
	readLocalConfig(process.env);
	const targetSessionId = text(sessionId, 100);
	if (
		typeof guestContextToken !== "string" ||
		!/^[A-Za-z0-9_-]{43}$/.test(guestContextToken)
	) {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const cleanReason = text(reason, 500);
	const cleanActor = text(actorId, 200);
	const guestDigest = digest(guestContextToken);

	return sql.begin(async (tx) => {
		const [guest] = await tx<
			{ id: string; revoked_at: string | null; expires_at: string }[]
		>`
      select id, revoked_at::text as revoked_at, expires_at::text as expires_at
      from app.commerce_guest_context
      where digest = ${guestDigest}
      for update
    `;
		if (!guest) throw new AccessError(404, "NOT_FOUND");

		const [session] = await tx<{ id: string; user_id: string }[]>`
      select id, user_id from app.auth_session where id = ${targetSessionId} for update
    `;

		let revoked = false;
		let userId: string | null = null;
		if (session) {
			userId = session.user_id;
			await tx`delete from app.mfa_session where session_id = ${session.id}`;
			await tx`delete from app.auth_session where id = ${session.id}`;
			revoked = true;
		}

		if (guest.revoked_at !== null) {
			await tx`update app.commerce_guest_context set revoked_at = null where id = ${guest.id}`;
		}

		await tx`
      insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details)
      values (
        ${cleanActor},
        'auth.undelivered_session.recover',
        ${targetSessionId},
        'allowed',
        ${cleanReason},
        ${JSON.stringify({
					session_id: targetSessionId,
					user_id: userId,
					session_revoked: revoked,
					guest_context_id: guest.id,
					guest_context_active: true,
				})}::jsonb
      )
    `;

		return {
			session_id: targetSessionId,
			user_id: userId,
			session_revoked: revoked,
			guest_context_id: guest.id,
			guest_context_active: true,
		};
	});
}

const SENSITIVE_KEYS = new Set([
	"password",
	"newpassword",
	"token",
	"session_token",
	"access_token",
	"refresh_token",
	"id_token",
	"secret",
	"cookie",
	"set-cookie",
	"authorization",
	"idempotency-key",
	"x-cart-token",
	"x-order-token",
	"commerce_guest",
	"cart_access",
	"order_access",
	"checkout_access",
	"email",
	"recipient",
	"phone",
	"address",
	"address_line",
	"bank_account",
	"account_number",
	"beneficiary_account",
	"totp",
	"totpuri",
	"backupcodes",
	"backup_codes",
	"url",
	"proof_url",
	"signed_url",
	"raw_body",
	"callback_body",
]);

function scrubSensitiveString(value: string): string {
	return value
		.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED_TOKEN]")
		.replace(/99ribu-[a-z]+\.[a-z_]+=[^\s;]+/gi, "[REDACTED_COOKIE]")
		.replace(/https?:\/\/[^\s"']+/gi, "[REDACTED_URL]")
		.replace(
			/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
			"[REDACTED_EMAIL]",
		)
		.replace(/(?:\+?62|0)8\d{7,12}\b/g, "[REDACTED_PHONE]")
		.replace(/\b\d{10,16}\b/g, "[REDACTED_ACCOUNT]");
}

function redactValue(value: unknown, depth = 0): unknown {
	if (depth > 6) return "[TRUNCATED]";
	if (value === null || value === undefined) return value;
	if (typeof value === "string") return scrubSensitiveString(value);
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value))
		return value.map((item) => redactValue(item, depth + 1));
	if (typeof value === "object") {
		const output: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(
			value as Record<string, unknown>,
		)) {
			const normalized = key.toLowerCase().replace(/[^a-z0-9_-]/g, "");
			if (
				SENSITIVE_KEYS.has(normalized) ||
				SENSITIVE_KEYS.has(key.toLowerCase())
			) {
				output[key] = "[REDACTED]";
			} else {
				output[key] = redactValue(item, depth + 1);
			}
		}
		return output;
	}
	return "[REDACTED]";
}

export function redactDiagnosticLog(entry: Record<string, unknown>): Record<
	string,
	unknown
> & {
	schema_version: 1;
	environment: "local";
	remote_availability_claim: false;
	event: string;
	correlation_id: string;
	causation_id: string;
	observed_at: string;
} {
	readLocalConfig(process.env);
	const correlationId =
		typeof entry.correlation_id === "string" &&
		/^[A-Za-z0-9_.:-]{8,128}$/.test(entry.correlation_id)
			? entry.correlation_id
			: randomUUID();
	const causationId =
		typeof entry.causation_id === "string" &&
		/^[A-Za-z0-9_.:-]{8,128}$/.test(entry.causation_id)
			? entry.causation_id
			: correlationId;
	const event =
		typeof entry.event === "string" &&
		/^[a-z][a-z0-9_.-]{1,80}$/.test(entry.event)
			? entry.event
			: "operational.diagnostic";

	const redacted = redactValue(entry) as Record<string, unknown>;
	return {
		...redacted,
		schema_version: 1 as const,
		environment: "local" as const,
		remote_availability_claim: false as const,
		event,
		correlation_id: correlationId,
		causation_id: causationId,
		observed_at: new Date().toISOString(),
	};
}

export type RateLimitClass =
	| "public_browse"
	| "guest_capability"
	| "auth_signup"
	| "referral_intake"
	| "checkout_mutation"
	| "private_upload"
	| "staff_recovery";

const DEFAULT_LIMITS: Record<
	RateLimitClass,
	{ max: number; windowMs: number }
> = {
	public_browse: { max: 120, windowMs: 60000 },
	guest_capability: { max: 20, windowMs: 60000 },
	auth_signup: { max: 3, windowMs: 60000 },
	referral_intake: { max: 15, windowMs: 60000 },
	checkout_mutation: { max: 20, windowMs: 60000 },
	private_upload: { max: 5, windowMs: 60000 },
	staff_recovery: { max: 10, windowMs: 60000 },
};

function matchesMagicBytes(mimeType: string, bytes: Uint8Array): boolean {
	if (mimeType === "image/png") {
		return (
			bytes.length >= 8 &&
			bytes[0] === 0x89 &&
			bytes[1] === 0x50 &&
			bytes[2] === 0x4e &&
			bytes[3] === 0x47 &&
			bytes[4] === 0x0d &&
			bytes[5] === 0x0a &&
			bytes[6] === 0x1a &&
			bytes[7] === 0x0a
		);
	}
	if (mimeType === "image/jpeg") {
		return (
			bytes.length >= 3 &&
			bytes[0] === 0xff &&
			bytes[1] === 0xd8 &&
			bytes[2] === 0xff
		);
	}
	if (mimeType === "image/webp") {
		return (
			bytes.length >= 12 &&
			bytes[0] === 0x52 &&
			bytes[1] === 0x49 &&
			bytes[2] === 0x46 &&
			bytes[3] === 0x46 &&
			bytes[8] === 0x57 &&
			bytes[9] === 0x45 &&
			bytes[10] === 0x42 &&
			bytes[11] === 0x50
		);
	}
	if (mimeType === "application/pdf") {
		return (
			bytes.length >= 5 &&
			bytes[0] === 0x25 &&
			bytes[1] === 0x50 &&
			bytes[2] === 0x44 &&
			bytes[3] === 0x46 &&
			bytes[4] === 0x2d
		);
	}
	return false;
}

export async function checkUploadAndRateLimits(
	sql: Sql | TransactionSql,
	input: {
		routeClass: RateLimitClass;
		scopeKey: string;
		max?: number;
		windowMs?: number;
		nowMs?: number;
		correlationId?: string;
		upload?: {
			bytes: Uint8Array;
			mimeType: string;
			maxBytes?: number;
		};
	},
) {
	readLocalConfig(process.env);
	if (!Object.hasOwn(DEFAULT_LIMITS, input.routeClass)) {
		throw new AccessError(400, "INVALID_RATE_LIMIT_CLASS");
	}
	const scope = text(input.scopeKey, 120);
	if (!/^[A-Za-z0-9_.:-]+$/.test(scope))
		throw new AccessError(400, "INVALID_INPUT");

	const defaults = DEFAULT_LIMITS[input.routeClass];
	const max = input.max ?? defaults.max;
	const windowMs = input.windowMs ?? defaults.windowMs;
	const now = input.nowMs ?? Date.now();
	if (
		!Number.isSafeInteger(max) ||
		max < 1 ||
		max > 10000 ||
		!Number.isSafeInteger(windowMs) ||
		windowMs < 1000
	) {
		throw new AccessError(400, "INVALID_INPUT");
	}

	if (input.upload) {
		const maxBytes = input.upload.maxBytes ?? 2 * 1024 * 1024;
		if (
			!Number.isSafeInteger(maxBytes) ||
			maxBytes < 1 ||
			maxBytes > 10 * 1024 * 1024
		) {
			throw new AccessError(500, "INVALID_UPLOAD_LIMIT");
		}
		const { bytes, mimeType } = input.upload;
		if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
			throw new AccessError(400, "INVALID_INPUT");
		}
		if (bytes.byteLength > maxBytes) {
			throw new AccessError(413, "BODY_TOO_LARGE");
		}
		if (
			!["image/png", "image/jpeg", "image/webp", "application/pdf"].includes(
				mimeType,
			)
		) {
			throw new AccessError(415, "UNSUPPORTED_MEDIA_TYPE");
		}
		if (!matchesMagicBytes(mimeType, bytes)) {
			throw new AccessError(400, "INVALID_UPLOAD_CONTENT");
		}
	}

	const bucketKey = `probe:${input.routeClass}:${scope}`;
	const [rate] = await sql<{ count: number; last_request: string | number }[]>`
    insert into app.auth_rate_limit (id, key, count, last_request)
    values (${randomUUID()}, ${bucketKey}, 1, ${now})
    on conflict (key) do update set
      count = case when app.auth_rate_limit.last_request < ${now - windowMs} then 1 else app.auth_rate_limit.count + 1 end,
      last_request = case when app.auth_rate_limit.last_request < ${now - windowMs} then ${now} else app.auth_rate_limit.last_request end
    returning count, last_request
  `;

	const retryAfter = Math.max(
		1,
		Math.ceil((Number(rate.last_request) + windowMs - now) / 1000),
	);
	if (rate.count > max) {
		throw new AccessError(429, "RATE_LIMITED", retryAfter);
	}

	return redactDiagnosticLog({
		event: `rate_limit.${input.routeClass}.allowed`,
		correlation_id: input.correlationId ?? randomUUID(),
		route_class: input.routeClass,
		bucket_count: rate.count,
		bucket_max: max,
		upload_bytes: input.upload?.bytes.byteLength ?? null,
		upload_mime: input.upload?.mimeType ?? null,
	});
}
