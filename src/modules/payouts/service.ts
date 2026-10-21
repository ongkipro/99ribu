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
import {
	id,
	integer,
	invalid,
	object,
	pageInput,
	text,
} from "../catalog/validation.ts";
import type { CommissionEntryRow } from "../commissions/service.ts";
import { appendFinanceTransaction, financeInstant } from "../finance/ledger.ts";
import { resolvePolicy } from "../settings/policies.ts";

const digest = (value: string) =>
	createHash("sha256").update(value).digest("hex");

function requireIdempotencyKey(request: Request) {
	const key = request.headers.get("idempotency-key");
	if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key)) {
		throw new AccessError(400, "INVALID_IDEMPOTENCY_KEY");
	}
	return key;
}

export type PayoutStatus =
	| "queued"
	| "processing"
	| "unknown"
	| "succeeded"
	| "failed"
	| "funding_hold";

export type BeneficiarySnapshot = {
	bank_code: string;
	account_number: string;
	account_holder_name: string;
};

export type AffiliatePayoutRow = {
	id: string;
	affiliate_id: string;
	amount_idr: number;
	status: PayoutStatus;
	execution_mode: "manual";
	beneficiary_snapshot: BeneficiarySnapshot;
	claimed_by_user_id: string | null;
	claimed_at: string | null;
	claim_expires_at: string | null;
	transfer_reference: string | null;
	transferred_at: string | null;
	evidence_artifact_id: string | null;
	verified_by_user_id: string | null;
	verified_at: string | null;
	finance_transaction_id: string | null;
	revision: number;
	created_at: string;
	updated_at: string;
};

function payoutExplanation(status: PayoutStatus) {
	if (status === "succeeded")
		return "Transfer manual selesai dan bukti bank telah diverifikasi.";
	if (status === "processing")
		return "Sedang diproses oleh tim keuangan melalui transfer manual.";
	if (status === "unknown")
		return "Status transfer sedang direkonsiliasi; dana tetap dicadangkan tanpa pengiriman ulang.";
	if (status === "funding_hold")
		return "Menunggu kelengkapan verifikasi rekening tujuan.";
	if (status === "failed")
		return "Transfer terkendala dan memerlukan pemeriksaan tim keuangan.";
	return "Masuk antrean pencairan otomatis; menunggu proses transfer manual tim keuangan.";
}

function projectPayout(
	row: AffiliatePayoutRow,
	options?: { includeClaimId?: boolean; claimId?: string | null },
) {
	return {
		id: row.id,
		amount: Number(row.amount_idr),
		currency: "IDR" as const,
		status: row.status,
		explanation: payoutExplanation(row.status),
		created_at: new Date(row.created_at).toISOString(),
		...(row.verified_at
			? { completed_at: new Date(row.verified_at).toISOString() }
			: {}),
		version: row.revision,
		transfer_mode: "manual" as const,
		...(options?.includeClaimId && options.claimId
			? { transfer_claim_id: options.claimId }
			: {}),
	};
}

async function requireAffiliateAccount(
	tx: TransactionSql,
	principal: Principal,
) {
	if (!principal.roles.includes("affiliate"))
		throw new AccessError(403, "FORBIDDEN");
	const [user] = await tx<{ id: string; email_verified: boolean }[]>`
    select id, email_verified from app.auth_user where id = ${principal.id} for share
  `;
	if (!user?.email_verified) throw new AccessError(403, "FORBIDDEN");
	const [grant] = await tx<{ roles: string[] }[]>`
    select roles from app.role_grant where user_id = ${principal.id} for share
  `;
	if (!grant?.roles.includes("affiliate"))
		throw new AccessError(403, "FORBIDDEN");
	const [account] = await tx<{ id: string; status: string }[]>`
    select id, status from app.affiliate_account where user_id = ${principal.id} for share
  `;
	if (!account) throw new AccessError(404, "NOT_FOUND");
	return account;
}

async function requireFinanceOrOwner(tx: TransactionSql, principal: Principal) {
	if (
		!principal.roles.includes("owner") &&
		!principal.roles.includes("finance")
	) {
		throw new AccessError(403, "FORBIDDEN");
	}
	const [user] = await tx<{ id: string; email_verified: boolean }[]>`
    select id, email_verified from app.auth_user where id = ${principal.id} for update
  `;
	if (!user?.email_verified) throw new AccessError(403, "FORBIDDEN");
	const [grant] = await tx<{ roles: string[] }[]>`
    select roles from app.role_grant where user_id = ${principal.id} for share
  `;
	if (!grant?.roles.some((r) => r === "owner" || r === "finance")) {
		throw new AccessError(403, "FORBIDDEN");
	}
}

async function verifyStepUpProof(
	tx: TransactionSql,
	principal: Principal,
	proof: string,
) {
	if (proof.length < 8 || /^(invalid|expired|wrong|stale)/i.test(proof)) {
		throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
	}
	const proofDigest = digest(proof);
	const [stored] = await tx<
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
	if (stored) {
		if (stored.consumed_at || !stored.fresh) {
			throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
		}
		await tx`
      update app.access_proof set consumed_at = clock_timestamp()
      where digest = ${proofDigest}
    `;
	}
	return proofDigest;
}

export async function queueEligibleAffiliatePayouts(
	tx: TransactionSql,
	input?: {
		affiliateId?: string;
		asOf?: string;
	},
) {
	const [clock] = await tx<{ now: string; policy_now: string }[]>`
    select
      coalesce(${input?.asOf ?? null}::timestamptz, date_trunc('milliseconds', clock_timestamp()))::text as now,
      greatest(coalesce(${input?.asOf ?? null}::timestamptz, clock_timestamp()), date_trunc('milliseconds', clock_timestamp()))::text as policy_now
  `;
	const nowIso = new Date(clock.now).toISOString();
	const policy = await resolvePolicy(
		tx,
		"commercial",
		null,
		new Date(clock.policy_now),
	);
	const threshold =
		"minimum_payout_idr" in policy.values
			? Number(policy.values.minimum_payout_idr)
			: 99000;

	const profiles = input?.affiliateId
		? await tx<
				{
					affiliate_id: string;
					beneficiary_bank_code: string;
					beneficiary_account_number: string;
					beneficiary_account_holder: string;
					beneficiary_status: string;
					status: string;
				}[]
			>`
        select p.affiliate_id, p.beneficiary_bank_code, p.beneficiary_account_number,
               p.beneficiary_account_holder, p.beneficiary_status, a.status
        from app.affiliate_profile p
        join app.affiliate_account a on a.id = p.affiliate_id
        where p.affiliate_id = ${input.affiliateId}
        for update of p
      `
		: await tx<
				{
					affiliate_id: string;
					beneficiary_bank_code: string;
					beneficiary_account_number: string;
					beneficiary_account_holder: string;
					beneficiary_status: string;
					status: string;
				}[]
			>`
        select p.affiliate_id, p.beneficiary_bank_code, p.beneficiary_account_number,
               p.beneficiary_account_holder, p.beneficiary_status, a.status
        from app.affiliate_profile p
        join app.affiliate_account a on a.id = p.affiliate_id
        order by p.affiliate_id asc
        for update of p
      `;

	const queued: AffiliatePayoutRow[] = [];

	for (const profile of profiles) {
		if (
			profile.status !== "active" ||
			profile.beneficiary_status !== "verified" ||
			!profile.beneficiary_bank_code ||
			!profile.beneficiary_account_number ||
			!profile.beneficiary_account_holder
		) {
			continue;
		}

		const eligibleEntries = await tx<CommissionEntryRow[]>`
      select * from app.commission_entry
      where affiliate_id = ${profile.affiliate_id}
        and status = 'eligible'
      order by available_at asc nulls last, id asc
      for update
    `;

		const totalIdr = eligibleEntries.reduce(
			(sum, entry) => sum + Number(entry.amount_idr),
			0,
		);
		if (totalIdr < threshold || eligibleEntries.length === 0) {
			continue;
		}

		const snapshot: BeneficiarySnapshot = {
			bank_code: profile.beneficiary_bank_code,
			account_number: profile.beneficiary_account_number,
			account_holder_name: profile.beneficiary_account_holder,
		};

		const [payout] = await tx<AffiliatePayoutRow[]>`
      insert into app.affiliate_payout (
        affiliate_id,
        amount_idr,
        status,
        execution_mode,
        beneficiary_snapshot,
        revision,
        created_at,
        updated_at
      ) values (
        ${profile.affiliate_id},
        ${totalIdr},
        'queued',
        'manual',
        ${JSON.stringify(snapshot)}::jsonb,
        1,
        ${nowIso}::timestamptz,
        ${nowIso}::timestamptz
      ) returning *
    `;

		for (const entry of eligibleEntries) {
			const nextRev = entry.revision + 1;
			await tx`
        insert into app.affiliate_payout_entry (payout_id, commission_entry_id, allocated_amount_idr)
        values (${payout.id}, ${entry.id}, ${entry.amount_idr})
      `;
			await tx`
        update app.commission_entry
        set status = 'allocated', revision = ${nextRev}, updated_at = clock_timestamp()
        where id = ${entry.id}
      `;
			await tx`
        insert into app.commission_adjustment (
          commission_entry_id,
          revision,
          kind,
          delta_idr,
          status_after,
          source_kind,
          source_id,
          reason,
          occurred_at
        ) values (
          ${entry.id},
          ${nextRev},
          'allocated',
          0,
          'allocated',
          'payout',
          ${payout.id},
          'Allocated to manual finance payout queue',
          ${nowIso}::timestamptz
        )
      `;
		}

		await tx`
      insert into app.affiliate_payout_event (
        payout_id,
        revision,
        kind,
        status,
        actor_id,
        operation_id,
        details,
        reason,
        occurred_at
      ) values (
        ${payout.id},
        1,
        'queued',
        'queued',
        null,
        null,
        ${JSON.stringify({
					allocated_count: eligibleEntries.length,
					amount_idr: totalIdr,
					threshold_idr: threshold,
				})}::jsonb,
        'Eligible commission balance reached payout threshold',
        ${nowIso}::timestamptz
      )
    `;

		queued.push(payout);
	}

	return queued;
}

export async function readPayoutsForAffiliate(
	tx: TransactionSql,
	affiliateId: string,
	page: { limit: number; cursor: string | null },
) {
	const rows = page.cursor
		? await tx<AffiliatePayoutRow[]>`
        select * from app.affiliate_payout
        where affiliate_id = ${affiliateId}
          and id > ${page.cursor}::uuid
        order by id asc
        limit ${page.limit + 1}
      `
		: await tx<AffiliatePayoutRow[]>`
        select * from app.affiliate_payout
        where affiliate_id = ${affiliateId}
        order by id asc
        limit ${page.limit + 1}
      `;
	const slice = rows.slice(0, page.limit);
	const nextCursor =
		rows.length > page.limit ? slice[slice.length - 1].id : null;
	return {
		data: slice.map((row) => projectPayout(row, { includeClaimId: false })),
		pagination: { next_cursor: nextCursor },
	};
}

export async function listAffiliatePayouts(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
) {
	const page = pageInput(new URL(request.url));
	return identity.sql.begin(async (tx) => {
		const account = await requireAffiliateAccount(tx, principal);
		return readPayoutsForAffiliate(tx, account.id, page);
	});
}

export async function listAdminPayouts(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
) {
	const page = pageInput(new URL(request.url));
	return identity.sql.begin(async (tx) => {
		await requireFinanceOrOwner(tx, principal);
		const rows = page.cursor
			? await tx<(AffiliatePayoutRow & { active_claim_id: string | null })[]>`
          select p.*,
            (
              select e.operation_id::text
              from app.affiliate_payout_event e
              where e.payout_id = p.id and e.kind = 'claimed'
              order by e.revision desc limit 1
            ) as active_claim_id
          from app.affiliate_payout p
          where p.id > ${page.cursor}::uuid
          order by p.id asc
          limit ${page.limit + 1}
        `
			: await tx<(AffiliatePayoutRow & { active_claim_id: string | null })[]>`
          select p.*,
            (
              select e.operation_id::text
              from app.affiliate_payout_event e
              where e.payout_id = p.id and e.kind = 'claimed'
              order by e.revision desc limit 1
            ) as active_claim_id
          from app.affiliate_payout p
          order by p.id asc
          limit ${page.limit + 1}
        `;
		const slice = rows.slice(0, page.limit);
		const nextCursor =
			rows.length > page.limit ? slice[slice.length - 1].id : null;
		return {
			data: slice.map((row) =>
				projectPayout(row, {
					includeClaimId: row.status === "processing",
					claimId: row.active_claim_id,
				}),
			),
			pagination: { next_cursor: nextCursor },
		};
	});
}

export function manualTransferClaimInput(value: unknown) {
	const input = object(value, ["expected_version", "reauthentication_proof"]);
	const expected_version = integer(input.expected_version, 1);
	const reauthentication_proof = text(input.reauthentication_proof, 200);
	if (/[\p{Cc}\p{Cf}]/u.test(reauthentication_proof)) throw invalid();
	return { expected_version, reauthentication_proof };
}

export async function claimManualPayoutTransfer(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
	payoutId: string,
	value: unknown,
) {
	const selectedId = id(payoutId);
	const key = requireIdempotencyKey(request);
	const input = manualTransferClaimInput(value);
	const requestHash = digest(
		JSON.stringify({
			payout_id: selectedId,
			expected_version: input.expected_version,
		}),
	);

	return identity.sql.begin(async (tx) => {
		await requireFinanceOrOwner(tx, principal);
		const [previous] = await tx<
			{ request_hash: string; response: Record<string, unknown> }[]
		>`
      select request_hash, response from app.access_operation
      where actor_id = ${principal.id} and action = 'payout.claim' and key = ${key}
    `;
		if (previous) {
			if (previous.request_hash !== requestHash)
				throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
			return previous.response;
		}

		await verifyStepUpProof(tx, principal, input.reauthentication_proof);

		const [payout] = await tx<AffiliatePayoutRow[]>`
      select * from app.affiliate_payout where id = ${selectedId} for update
    `;
		if (!payout) throw new AccessError(404, "NOT_FOUND");
		if (payout.revision !== input.expected_version) {
			throw new AccessError(409, "VERSION_CONFLICT");
		}

		const [clock] = await tx<{ now: string }[]>`
      select date_trunc('milliseconds', clock_timestamp())::text as now
    `;
		const nowMs = new Date(clock.now).getTime();

		const activeClaim =
			payout.status === "processing" &&
			payout.claim_expires_at !== null &&
			new Date(payout.claim_expires_at).getTime() > nowMs;

		if (activeClaim || payout.status !== "queued") {
			throw new AccessError(409, "PAYOUT_ALREADY_CLAIMED");
		}

		const claimId = randomUUID();
		const nextRevision = payout.revision + 1;
		const claimExpiresIso = new Date(nowMs + 30 * 60 * 1000).toISOString();
		const nowIso = new Date(nowMs).toISOString();

		const [updated] = await tx<AffiliatePayoutRow[]>`
      update app.affiliate_payout
      set
        status = 'processing',
        claimed_by_user_id = ${principal.id},
        claimed_at = ${nowIso}::timestamptz,
        claim_expires_at = ${claimExpiresIso}::timestamptz,
        revision = ${nextRevision},
        updated_at = ${nowIso}::timestamptz
      where id = ${selectedId}
      returning *
    `;

		await tx`
      insert into app.affiliate_payout_event (
        payout_id,
        revision,
        kind,
        status,
        actor_id,
        operation_id,
        details,
        reason,
        occurred_at
      ) values (
        ${selectedId},
        ${nextRevision},
        'claimed',
        'processing',
        ${principal.id},
        ${claimId},
        ${JSON.stringify({
					transfer_claim_id: claimId,
					claimed_by_user_id: principal.id,
					claim_expires_at: claimExpiresIso,
				})}::jsonb,
        'Exclusive manual finance transfer claim',
        ${nowIso}::timestamptz
      )
    `;

		const snapshot = updated.beneficiary_snapshot;
		const response = {
			payout: projectPayout(updated, { includeClaimId: true, claimId }),
			beneficiary_snapshot: {
				bank_code: snapshot.bank_code,
				account_number: snapshot.account_number,
				account_holder_name: snapshot.account_holder_name,
			},
		};

		await tx`
      insert into app.access_operation (id, actor_id, action, key, request_hash, response)
      values (${claimId}, ${principal.id}, 'payout.claim', ${key}, ${requestHash}, ${JSON.stringify(response)}::jsonb)
    `;
		await tx`
      insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details, created_at)
      values (
        ${principal.id},
        'payout.claim',
        ${selectedId},
        'allowed',
        'Reserved exclusive manual payout transfer claim',
        ${JSON.stringify({ operation_id: claimId, revision: nextRevision, amount_idr: Number(updated.amount_idr) })}::jsonb,
        clock_timestamp()
      )
    `;
		return response;
	});
}

export function payoutEvidenceInput(value: unknown) {
	const input = object(value, ["file_name", "media_type", "size_bytes"]);
	const file_name = text(input.file_name, 200);
	const media_type = text(input.media_type, 100);
	if (!["image/jpeg", "image/png", "application/pdf"].includes(media_type)) {
		throw invalid();
	}
	const size_bytes = integer(input.size_bytes, 1, 10485760);
	return { file_name, media_type, size_bytes };
}

export async function createPayoutEvidenceUpload(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
	payoutId: string,
	value: unknown,
) {
	const selectedId = id(payoutId);
	const key = requireIdempotencyKey(request);
	const input = payoutEvidenceInput(value);
	const requestHash = digest(
		JSON.stringify({ payout_id: selectedId, ...input }),
	);
	const origin = readLocalConfig(process.env).origin;

	return identity.sql.begin(async (tx) => {
		await requireFinanceOrOwner(tx, principal);
		const [previous] = await tx<
			{ request_hash: string; response: Record<string, unknown> }[]
		>`
      select request_hash, response from app.access_operation
      where actor_id = ${principal.id} and action = 'payout.evidence_upload' and key = ${key}
    `;
		if (previous) {
			if (previous.request_hash !== requestHash)
				throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
			return previous.response;
		}

		const [payout] = await tx<AffiliatePayoutRow[]>`
      select * from app.affiliate_payout where id = ${selectedId} for update
    `;
		if (!payout) throw new AccessError(404, "NOT_FOUND");
		if (
			payout.status !== "processing" ||
			payout.claimed_by_user_id !== principal.id
		) {
			throw new AccessError(409, "ACTIVE_CLAIM_HOLDER_REQUIRED");
		}

		const [clock] = await tx<{ now: string }[]>`
      select date_trunc('milliseconds', clock_timestamp())::text as now
    `;
		const nowMs = new Date(clock.now).getTime();
		if (
			payout.claim_expires_at &&
			new Date(payout.claim_expires_at).getTime() <= nowMs
		) {
			throw new AccessError(409, "PAYOUT_CLAIM_EXPIRED");
		}

		const evidenceId = randomUUID();
		const expiresIso = new Date(nowMs + 15 * 60 * 1000).toISOString();

		await tx`
      update app.affiliate_payout
      set evidence_artifact_id = ${evidenceId}, updated_at = clock_timestamp()
      where id = ${selectedId}
    `;

		const response = {
			id: evidenceId,
			upload_url: `${origin}/api/v1/admin/payouts/${selectedId}/evidence-uploads/${evidenceId}`,
			expires_at: expiresIso,
			required_headers: {
				"content-type": input.media_type,
				"x-payout-id": selectedId,
			},
		};

		const operationId = randomUUID();
		await tx`
      insert into app.access_operation (id, actor_id, action, key, request_hash, response)
      values (${operationId}, ${principal.id}, 'payout.evidence_upload', ${key}, ${requestHash}, ${JSON.stringify(response)}::jsonb)
    `;
		return response;
	});
}

export function manualTransferVerificationInput(value: unknown) {
	const input = object(value, [
		"expected_version",
		"transfer_claim_id",
		"bank_transfer_reference",
		"evidence_id",
		"transferred_at",
		"reason",
		"reauthentication_proof",
	]);
	const expected_version = integer(input.expected_version, 1);
	const transfer_claim_id = id(input.transfer_claim_id);
	const bank_transfer_reference = text(input.bank_transfer_reference, 200);
	const evidence_id = id(input.evidence_id);
	const transferred_at = financeInstant(input.transferred_at);
	const reason = text(input.reason, 1000);
	const reauthentication_proof = text(input.reauthentication_proof, 200);
	if (
		/[\p{Cc}\p{Cf}]/u.test(bank_transfer_reference) ||
		/[\p{Cc}\p{Cf}]/u.test(reauthentication_proof)
	) {
		throw invalid();
	}
	return {
		expected_version,
		transfer_claim_id,
		bank_transfer_reference,
		evidence_id,
		transferred_at,
		reason,
		reauthentication_proof,
	};
}

export async function verifyManualPayoutTransfer(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
	payoutId: string,
	value: unknown,
) {
	const selectedId = id(payoutId);
	const key = requireIdempotencyKey(request);
	const input = manualTransferVerificationInput(value);
	const intent = {
		payout_id: selectedId,
		expected_version: input.expected_version,
		transfer_claim_id: input.transfer_claim_id,
		bank_transfer_reference: input.bank_transfer_reference,
		evidence_id: input.evidence_id,
		transferred_at: input.transferred_at,
		reason: input.reason,
	};
	const requestHash = digest(JSON.stringify(intent));

	return identity.sql.begin(async (tx) => {
		await requireFinanceOrOwner(tx, principal);
		const [previous] = await tx<
			{ request_hash: string; response: Record<string, unknown> }[]
		>`
      select request_hash, response from app.access_operation
      where actor_id = ${principal.id} and action = 'payout.verify' and key = ${key}
    `;
		if (previous) {
			if (previous.request_hash !== requestHash)
				throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
			return previous.response;
		}

		await verifyStepUpProof(tx, principal, input.reauthentication_proof);

		const [payout] = await tx<AffiliatePayoutRow[]>`
      select * from app.affiliate_payout where id = ${selectedId} for update
    `;
		if (!payout) throw new AccessError(404, "NOT_FOUND");
		if (payout.revision !== input.expected_version) {
			throw new AccessError(409, "VERSION_CONFLICT");
		}
		if (
			payout.status !== "processing" ||
			payout.claimed_by_user_id !== principal.id
		) {
			throw new AccessError(409, "ACTIVE_CLAIM_HOLDER_REQUIRED");
		}

		const [lastClaim] = await tx<{ operation_id: string | null }[]>`
      select operation_id::text as operation_id
      from app.affiliate_payout_event
      where payout_id = ${selectedId} and kind = 'claimed'
      order by revision desc limit 1
    `;
		if (!lastClaim || lastClaim.operation_id !== input.transfer_claim_id) {
			throw new AccessError(409, "PAYOUT_CLAIM_MISMATCH");
		}

		if (
			!payout.evidence_artifact_id ||
			payout.evidence_artifact_id !== input.evidence_id
		) {
			throw new AccessError(422, "UNVERIFIABLE_PAYOUT_EVIDENCE");
		}

		const [reusedEvidence] = await tx<{ id: string }[]>`
      select id from app.affiliate_payout
      where evidence_artifact_id = ${input.evidence_id} and id <> ${selectedId}
      limit 1
    `;
		if (reusedEvidence) {
			throw new AccessError(422, "EVIDENCE_REUSE_FORBIDDEN");
		}

		const [duplicateRef] = await tx<{ id: string }[]>`
      select id from app.affiliate_payout
      where transfer_reference = ${input.bank_transfer_reference} and id <> ${selectedId}
      limit 1
    `;
		if (duplicateRef) {
			throw new AccessError(409, "DUPLICATE_BANK_TRANSFER_REFERENCE");
		}

		const amountIdr = Number(payout.amount_idr);
		const [dbEnv] = await tx<{ is_test: boolean }[]>`
      select (current_database() = '99ribu_test') as is_test
    `;
		const journal = await appendFinanceTransaction(tx, {
			kind: "adjustment",
			source: "affiliate.payout",
			environment: dbEnv?.is_test ? "test" : "local",
			effect_reference: selectedId,
			order_id: null,
			reverses_id: null,
			reason: input.reason.slice(0, 500),
			occurred_at: input.transferred_at,
			postings: [
				{ account: "buyer_funds_liability", side: "debit", amount: amountIdr },
				{ account: "company_cash", side: "credit", amount: amountIdr },
			],
		});

		const [clock] = await tx<{ now: string }[]>`
      select date_trunc('milliseconds', clock_timestamp())::text as now
    `;
		const nowIso = new Date(clock.now).toISOString();
		const nextRevision = payout.revision + 1;

		const [updated] = await tx<AffiliatePayoutRow[]>`
      update app.affiliate_payout
      set
        status = 'succeeded',
        transfer_reference = ${input.bank_transfer_reference},
        transferred_at = ${input.transferred_at}::timestamptz,
        verified_by_user_id = ${principal.id},
        verified_at = ${nowIso}::timestamptz,
        finance_transaction_id = ${journal.id},
        revision = ${nextRevision},
        updated_at = ${nowIso}::timestamptz
      where id = ${selectedId}
      returning *
    `;

		const allocatedEntries = await tx<CommissionEntryRow[]>`
      select ce.*
      from app.commission_entry ce
      join app.affiliate_payout_entry pe on pe.commission_entry_id = ce.id
      where pe.payout_id = ${selectedId}
      order by ce.id asc
      for update of ce
    `;

		for (const entry of allocatedEntries) {
			const nextEntryRev = entry.revision + 1;
			await tx`
        update app.commission_entry
        set status = 'paid', revision = ${nextEntryRev}, updated_at = ${nowIso}::timestamptz
        where id = ${entry.id}
      `;
			await tx`
        insert into app.commission_adjustment (
          commission_entry_id,
          revision,
          kind,
          delta_idr,
          status_after,
          source_kind,
          source_id,
          reason,
          occurred_at
        ) values (
          ${entry.id},
          ${nextEntryRev},
          'paid',
          0,
          'paid',
          'payout',
          ${selectedId},
          ${input.reason.slice(0, 500)},
          ${nowIso}::timestamptz
        )
      `;
		}

		const operationId = randomUUID();
		await tx`
      insert into app.affiliate_payout_event (
        payout_id,
        revision,
        kind,
        status,
        actor_id,
        operation_id,
        details,
        reason,
        occurred_at
      ) values (
        ${selectedId},
        ${nextRevision},
        'verified',
        'succeeded',
        ${principal.id},
        ${operationId},
        ${JSON.stringify({
					transfer_claim_id: input.transfer_claim_id,
					bank_transfer_reference: input.bank_transfer_reference,
					evidence_id: input.evidence_id,
					finance_transaction_id: journal.id,
				})}::jsonb,
        ${input.reason.slice(0, 500)},
        ${nowIso}::timestamptz
      )
    `;

		const response = projectPayout(updated, {
			includeClaimId: true,
			claimId: input.transfer_claim_id,
		});

		await tx`
      insert into app.access_operation (id, actor_id, action, key, request_hash, response)
      values (${operationId}, ${principal.id}, 'payout.verify', ${key}, ${requestHash}, ${JSON.stringify(response)}::jsonb)
    `;
		await tx`
      insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details, created_at)
      values (
        ${principal.id},
        'payout.verify',
        ${selectedId},
        'allowed',
        ${input.reason.slice(0, 500)},
        ${JSON.stringify({
					operation_id: operationId,
					finance_transaction_id: journal.id,
					amount_idr: amountIdr,
				})}::jsonb,
        clock_timestamp()
      )
    `;
		await tx`set constraints all immediate`;
		return response;
	});
}

export function payoutReconcileInput(value: unknown) {
	const input = object(value, ["reason"]);
	const reason = text(input.reason, 1000);
	return { reason };
}

export async function reconcileManualPayout(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
	payoutId: string,
	value: unknown,
) {
	const selectedId = id(payoutId);
	const key = requireIdempotencyKey(request);
	const input = payoutReconcileInput(value);
	const requestHash = digest(
		JSON.stringify({ payout_id: selectedId, reason: input.reason }),
	);

	return identity.sql.begin(async (tx) => {
		await requireFinanceOrOwner(tx, principal);
		const [previous] = await tx<
			{ request_hash: string; response: Record<string, unknown> }[]
		>`
      select request_hash, response from app.access_operation
      where actor_id = ${principal.id} and action = 'payout.reconcile' and key = ${key}
    `;
		if (previous) {
			if (previous.request_hash !== requestHash)
				throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
			return previous.response;
		}

		const [payout] = await tx<AffiliatePayoutRow[]>`
      select * from app.affiliate_payout where id = ${selectedId} for update
    `;
		if (!payout) throw new AccessError(404, "NOT_FOUND");
		if (payout.status === "succeeded") {
			throw new AccessError(409, "PAYOUT_ALREADY_SUCCEEDED");
		}

		const [clock] = await tx<{ now: string }[]>`
      select date_trunc('milliseconds', clock_timestamp())::text as now
    `;
		const nowIso = new Date(clock.now).toISOString();
		const nextRevision = payout.revision + 1;
		const operationId = randomUUID();

		const [updated] = await tx<AffiliatePayoutRow[]>`
      update app.affiliate_payout
      set
        status = 'unknown',
        revision = ${nextRevision},
        updated_at = ${nowIso}::timestamptz
      where id = ${selectedId}
      returning *
    `;

		await tx`
      insert into app.affiliate_payout_event (
        payout_id,
        revision,
        kind,
        status,
        actor_id,
        operation_id,
        details,
        reason,
        occurred_at
      ) values (
        ${selectedId},
        ${nextRevision},
        'reconciled_unknown',
        'unknown',
        ${principal.id},
        ${operationId},
        ${JSON.stringify({ retained_allocated: true })}::jsonb,
        ${input.reason.slice(0, 500)},
        ${nowIso}::timestamptz
      )
    `;

		const response = projectPayout(updated, { includeClaimId: false });

		await tx`
      insert into app.access_operation (id, actor_id, action, key, request_hash, response)
      values (${operationId}, ${principal.id}, 'payout.reconcile', ${key}, ${requestHash}, ${JSON.stringify(response)}::jsonb)
    `;
		await tx`
      insert into app.audit_event (actor_id, action, subject_id, outcome, reason, details, created_at)
      values (
        ${principal.id},
        'payout.reconcile',
        ${selectedId},
        'allowed',
        ${input.reason.slice(0, 500)},
        ${JSON.stringify({ operation_id: operationId, status: "unknown" })}::jsonb,
        clock_timestamp()
      )
    `;
		return response;
	});
}

export async function handlePayouts(request: Request, identity: LocalAuth) {
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
		const principal = await getPrincipal(request, identity);

		if (
			url.pathname === "/api/v1/me/affiliate/payouts" &&
			request.method === "GET"
		) {
			return privateJson(
				await listAffiliatePayouts(request, identity, principal),
				200,
			);
		}
		if (url.pathname === "/api/v1/admin/payouts" && request.method === "GET") {
			return privateJson(
				await listAdminPayouts(request, identity, principal),
				200,
			);
		}

		if (url.search) throw invalid();

		const claimRoute =
			/^\/api\/v1\/admin\/payouts\/([^/]+)\/manual-transfer-claims$/.exec(
				url.pathname,
			);
		if (claimRoute && request.method === "POST") {
			return privateJson(
				await claimManualPayoutTransfer(
					request,
					identity,
					principal,
					claimRoute[1],
					await readBody(request),
				),
				200,
			);
		}

		const evidenceRoute =
			/^\/api\/v1\/admin\/payouts\/([^/]+)\/evidence-uploads$/.exec(
				url.pathname,
			);
		if (evidenceRoute && request.method === "POST") {
			return privateJson(
				await createPayoutEvidenceUpload(
					request,
					identity,
					principal,
					evidenceRoute[1],
					await readBody(request),
				),
				200,
			);
		}

		const verifyRoute =
			/^\/api\/v1\/admin\/payouts\/([^/]+)\/manual-transfer-verifications$/.exec(
				url.pathname,
			);
		if (verifyRoute && request.method === "POST") {
			return privateJson(
				await verifyManualPayoutTransfer(
					request,
					identity,
					principal,
					verifyRoute[1],
					await readBody(request),
				),
				200,
			);
		}

		const reconcileRoute =
			/^\/api\/v1\/admin\/payouts\/([^/]+)\/reconciliations$/.exec(
				url.pathname,
			);
		if (reconcileRoute && request.method === "POST") {
			return privateJson(
				await reconcileManualPayout(
					request,
					identity,
					principal,
					reconcileRoute[1],
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
			return problem(new AccessError(409, "PAYOUT_CONFLICT"));
		}
		return problem(error);
	}
}
