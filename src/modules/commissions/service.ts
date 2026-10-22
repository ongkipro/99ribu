import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { assertOrigin, privateJson, problem } from "../access/http.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import { attributeOrderToAffiliate } from "../affiliates/profile.ts";
import { offerCommissionIdr } from "../affiliates/rates.ts";
import { invalid, pageInput } from "../catalog/validation.ts";
import {
	appendFinanceTransaction,
	financeEnvironment,
	reverseFinanceTransaction,
} from "../finance/ledger.ts";
import { resolvePolicy } from "../settings/policies.ts";

const TEN_DAYS_MS = 10 * 86400 * 1000;
const COMMISSION_SOURCE = "affiliate.commission";

async function recognitionFor(tx: TransactionSql, entryId: string) {
	const environment = await financeEnvironment(tx);
	const [row] = await tx<{ id: string; occurred_at: string; reversed: boolean }[]>`
    select t.id, t.occurred_at,
      exists(select 1 from app.finance_transaction r where r.reverses_id = t.id) as reversed
    from app.finance_transaction t
    where t.source = ${COMMISSION_SOURCE} and t.environment = ${environment}
      and t.effect_reference = ${`commission:${entryId}`}
  `;
	return { environment, recognition: row };
}

// Accounting: a matured (eligible) unit commission becomes a company obligation
// to the affiliate. One recognition per entry; later holds keep it, a void
// reverses it, and payout settles affiliate_payable against company_cash.
async function recognizeCommission(
	tx: TransactionSql,
	entry: CommissionEntryRow,
	occurredAt: string,
) {
	const amount = Number(entry.amount_idr);
	if (amount <= 0) return null;
	const { environment, recognition } = await recognitionFor(tx, entry.id);
	if (recognition) return recognition.id;
	const journal = await appendFinanceTransaction(tx, {
		kind: "adjustment",
		source: COMMISSION_SOURCE,
		environment,
		effect_reference: `commission:${entry.id}`,
		order_id: entry.order_id,
		reverses_id: null,
		reason: "Matured affiliate unit commission recognized as payable",
		occurred_at: occurredAt,
		postings: [
			{ account: "commission_expense", side: "debit", amount },
			{ account: "affiliate_payable", side: "credit", amount },
		],
	});
	return journal.id;
}

async function reverseCommissionRecognition(
	tx: TransactionSql,
	entryId: string,
	reason: string,
	occurredAt: string | undefined,
) {
	const { environment, recognition } = await recognitionFor(tx, entryId);
	if (!recognition || recognition.reversed) return null;
	const [clock] = await tx<{ now: string }[]>`
    select greatest(
      coalesce(${occurredAt ?? null}::timestamptz, date_trunc('milliseconds', clock_timestamp())),
      ${recognition.occurred_at}::timestamptz
    )::text as now
  `;
	const reversal = await reverseFinanceTransaction(tx, recognition.id, {
		source: COMMISSION_SOURCE,
		environment,
		effect_reference: `commission-void:${entryId}`,
		reason: reason.slice(0, 500),
		occurred_at: new Date(clock.now).toISOString(),
	});
	return reversal.id;
}

export type CommissionStatus =
	| "pending"
	| "held"
	| "eligible"
	| "allocated"
	| "paid"
	| "void";

export type CommissionEntryRow = {
	id: string;
	order_id: string;
	order_item_id: string;
	fulfillment_item_id: string;
	replacement_link_id: string | null;
	affiliate_id: string;
	basis_points: number;
	merchandise_amount: number;
	amount_idr: number;
	status: CommissionStatus;
	hold_reason: string | null;
	receipt_anchor: string | null;
	available_at: string | null;
	revision: number;
	created_at: string;
	updated_at: string;
};

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

export async function accrueOrderCommissions(
	tx: TransactionSql,
	input: {
		orderId: string;
		visitorId?: string | null;
		referralTouchId?: string | null;
		at?: string;
	},
) {
	const attribution = await attributeOrderToAffiliate(tx, input);
	if (!attribution) return [];

	const units = await tx<
		{
			fulfillment_item_id: string;
			order_item_id: string;
			order_id: string;
			unit_index: number;
		}[]
	>`
    select fi.id as fulfillment_item_id, fi.order_item_id, oi.order_id, fi.unit_index
    from app.fulfillment_item fi
    join app.order_item oi on oi.id = fi.order_item_id
    where oi.order_id = ${input.orderId}
    order by oi.id asc, fi.unit_index asc
  `;

	const amountIdr = offerCommissionIdr(attribution.basis_points);
	const created: CommissionEntryRow[] = [];

	for (const unit of units) {
		const [entry] = await tx<CommissionEntryRow[]>`
      insert into app.commission_entry (
        order_id,
        order_item_id,
        fulfillment_item_id,
        affiliate_id,
        basis_points,
        merchandise_amount,
        amount_idr,
        status,
        revision
      ) values (
        ${unit.order_id},
        ${unit.order_item_id},
        ${unit.fulfillment_item_id},
        ${attribution.affiliate_id},
        ${attribution.basis_points},
        99000,
        ${amountIdr},
        'pending',
        1
      ) on conflict (fulfillment_item_id) do nothing returning *
    `;
		if (!entry) {
			const [existing] = await tx<CommissionEntryRow[]>`
      select * from app.commission_entry where fulfillment_item_id = ${unit.fulfillment_item_id}
    `;
			created.push(existing);
			continue;
		}
		await tx`
      insert into app.commission_adjustment (
        commission_entry_id,
        revision,
        kind,
        delta_idr,
        status_after,
        source_kind,
        source_id,
        reason
      ) values (
        ${entry.id},
        1,
        'accrued',
        ${amountIdr},
        'pending',
        'order',
        ${unit.order_id},
        'Accrued unit commission on attributed order'
      )
    `;
		created.push(entry);
	}
	return created;
}

export async function recordUnitReceiptMaturity(
	tx: TransactionSql,
	input: {
		fulfillmentItemId: string;
		receivedAt: string;
		sourceId?: string;
		reason?: string;
	},
) {
	const [entry] = await tx<CommissionEntryRow[]>`
    select * from app.commission_entry
    where fulfillment_item_id = ${input.fulfillmentItemId}
    for update
  `;
	if (!entry) throw new AccessError(404, "COMMISSION_ENTRY_NOT_FOUND");
	if (["void", "allocated", "paid"].includes(entry.status)) {
		throw new AccessError(409, "COMMISSION_STATE_CONFLICT");
	}

	const receivedMs = Date.parse(input.receivedAt);
	if (!Number.isFinite(receivedMs)) throw invalid();
	const receiptIso = new Date(receivedMs).toISOString();
	const availableIso = new Date(receivedMs + TEN_DAYS_MS).toISOString();
	const nextRevision = entry.revision + 1;

	const [updated] = await tx<CommissionEntryRow[]>`
    update app.commission_entry
    set
      receipt_anchor = ${receiptIso}::timestamptz,
      available_at = ${availableIso}::timestamptz,
      revision = ${nextRevision},
      updated_at = clock_timestamp()
    where id = ${entry.id}
    returning *
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
      ${nextRevision},
      'receipt_recorded',
      0,
      ${updated.status},
      'receipt',
      ${input.sourceId ?? input.fulfillmentItemId},
      ${input.reason ?? "Verified buyer receipt recorded; H+10 maturity scheduled"},
      ${receiptIso}::timestamptz
    )
  `;
	return updated;
}

export async function holdUnitCommission(
	tx: TransactionSql,
	input: {
		fulfillmentItemId: string;
		holdReason: string;
		sourceId?: string;
		occurredAt?: string;
	},
) {
	const [entry] = await tx<CommissionEntryRow[]>`
    select * from app.commission_entry
    where fulfillment_item_id = ${input.fulfillmentItemId}
    for update
  `;
	if (!entry) throw new AccessError(404, "COMMISSION_ENTRY_NOT_FOUND");
	if (["void", "allocated", "paid"].includes(entry.status)) {
		throw new AccessError(409, "COMMISSION_STATE_CONFLICT");
	}
	const nextRevision = entry.revision + 1;
	const [updated] = await tx<CommissionEntryRow[]>`
    update app.commission_entry
    set
      status = 'held',
      hold_reason = ${input.holdReason},
      revision = ${nextRevision},
      updated_at = clock_timestamp()
    where id = ${entry.id}
    returning *
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
      ${nextRevision},
      'held',
      0,
      'held',
      'return_claim',
      ${input.sourceId ?? input.fulfillmentItemId},
      ${input.holdReason},
      coalesce(${input.occurredAt ?? null}::timestamptz, clock_timestamp())
    )
  `;
	return updated;
}

export async function voidUnitCommissionOnRefund(
	tx: TransactionSql,
	input: {
		fulfillmentItemId: string;
		refundId?: string;
		reason?: string;
		occurredAt?: string;
	},
) {
	const [entry] = await tx<CommissionEntryRow[]>`
    select * from app.commission_entry
    where fulfillment_item_id = ${input.fulfillmentItemId}
    for update
  `;
	if (!entry) throw new AccessError(404, "COMMISSION_ENTRY_NOT_FOUND");
	if (entry.status === "void") return entry;
	if (["allocated", "paid"].includes(entry.status)) {
		throw new AccessError(409, "COMMISSION_ALREADY_ALLOCATED");
	}
	const reason = input.reason ?? "Unit refunded; commission voided";
	const nextRevision = entry.revision + 1;
	const [updated] = await tx<CommissionEntryRow[]>`
    update app.commission_entry
    set
      status = 'void',
      hold_reason = ${reason},
      revision = ${nextRevision},
      updated_at = clock_timestamp()
    where id = ${entry.id}
    returning *
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
      ${nextRevision},
      'voided',
      ${-Number(entry.amount_idr)},
      'void',
      'refund',
      ${input.refundId ?? input.fulfillmentItemId},
      ${reason},
      coalesce(${input.occurredAt ?? null}::timestamptz, clock_timestamp())
    )
  `;
	await reverseCommissionRecognition(tx, entry.id, reason, input.occurredAt);
	return updated;
}

export async function releaseUnitCommissionHold(
	tx: TransactionSql,
	input: {
		fulfillmentItemId: string;
		sourceId?: string;
		reason?: string;
		occurredAt?: string;
	},
) {
	const [entry] = await tx<CommissionEntryRow[]>`
    select * from app.commission_entry
    where fulfillment_item_id = ${input.fulfillmentItemId}
    for update
  `;
	if (!entry) throw new AccessError(404, "COMMISSION_ENTRY_NOT_FOUND");
	if (entry.status !== "held") return entry;
	const nextRevision = entry.revision + 1;
	const [updated] = await tx<CommissionEntryRow[]>`
    update app.commission_entry
    set
      status = 'pending',
      hold_reason = null,
      revision = ${nextRevision},
      updated_at = clock_timestamp()
    where id = ${entry.id}
    returning *
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
      ${nextRevision},
      'released',
      0,
      'pending',
      'return_claim',
      ${input.sourceId ?? input.fulfillmentItemId},
      ${input.reason ?? "Return claim closed without refund; maturity resumes"},
      coalesce(${input.occurredAt ?? null}::timestamptz, clock_timestamp())
    )
  `;
	return updated;
}

export async function recordReplacementUnitReceiptMaturity(
	tx: TransactionSql,
	input: {
		fulfillmentItemId: string;
		replacementLinkId?: string | null;
		receivedAt: string;
		sourceId?: string;
		reason?: string;
	},
) {
	const [entry] = await tx<CommissionEntryRow[]>`
    select * from app.commission_entry
    where fulfillment_item_id = ${input.fulfillmentItemId}
    for update
  `;
	if (!entry) throw new AccessError(404, "COMMISSION_ENTRY_NOT_FOUND");
	if (["void", "allocated", "paid"].includes(entry.status)) {
		throw new AccessError(409, "COMMISSION_STATE_CONFLICT");
	}
	const receivedMs = Date.parse(input.receivedAt);
	if (!Number.isFinite(receivedMs)) throw invalid();
	const receiptIso = new Date(receivedMs).toISOString();
	const availableIso = new Date(receivedMs + TEN_DAYS_MS).toISOString();
	const nextRevision = entry.revision + 1;

	const [updated] = await tx<CommissionEntryRow[]>`
    update app.commission_entry
    set
      replacement_link_id = coalesce(${input.replacementLinkId ?? null}::uuid, replacement_link_id),
      status = 'pending',
      hold_reason = null,
      receipt_anchor = ${receiptIso}::timestamptz,
      available_at = ${availableIso}::timestamptz,
      revision = ${nextRevision},
      updated_at = clock_timestamp()
    where id = ${entry.id}
    returning *
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
      ${nextRevision},
      'replacement_reanchored',
      0,
      'pending',
      'replacement_receipt',
      ${input.sourceId ?? input.replacementLinkId ?? input.fulfillmentItemId},
      ${input.reason ?? "Replacement receipt recorded; H+10 maturity re-anchored without duplicate commission"},
      ${receiptIso}::timestamptz
    )
  `;
	return updated;
}

export async function matureEligibleCommissions(
	tx: TransactionSql,
	input?: {
		affiliateId?: string;
		entryId?: string;
		asOf?: string;
	},
) {
	const [clock] = await tx<{ now: string }[]>`
    select coalesce(${input?.asOf ?? null}::timestamptz, date_trunc('milliseconds', clock_timestamp()))::text as now
  `;
	const asOfIso = new Date(clock.now).toISOString();

	const candidates = input?.affiliateId || input?.entryId
		? await tx<CommissionEntryRow[]>`
        select * from app.commission_entry
        where (${input.affiliateId ?? null}::uuid is null or affiliate_id = ${input.affiliateId ?? null}::uuid)
          and (${input.entryId ?? null}::uuid is null or id = ${input.entryId ?? null}::uuid)
          and status = 'pending'
          and hold_reason is null
          and receipt_anchor is not null
          and available_at is not null
          and available_at <= ${asOfIso}::timestamptz
        order by available_at asc, id asc
        for update
      `
		: await tx<CommissionEntryRow[]>`
        select * from app.commission_entry
        where status = 'pending'
          and hold_reason is null
          and receipt_anchor is not null
          and available_at is not null
          and available_at <= ${asOfIso}::timestamptz
        order by available_at asc, id asc
        for update
      `;

	const matured: CommissionEntryRow[] = [];
	for (const row of candidates) {
		const nextRevision = row.revision + 1;
		const [updated] = await tx<CommissionEntryRow[]>`
      update app.commission_entry
      set
        status = 'eligible',
        revision = ${nextRevision},
        updated_at = clock_timestamp()
      where id = ${row.id}
      returning *
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
        ${row.id},
        ${nextRevision},
        'matured',
        0,
        'eligible',
        'maturity_clock',
        ${row.id},
        'H+10 receipt maturity window completed',
        ${asOfIso}::timestamptz
      )
    `;
		await recognizeCommission(tx, updated, asOfIso);
		matured.push(updated);
	}
	return matured;
}

export async function readCommissionBalanceForAffiliate(
	tx: TransactionSql,
	affiliateId: string,
) {
	const rows = await tx<{ status: CommissionStatus; total: number }[]>`
    select status, coalesce(sum(amount_idr), 0)::bigint as total
    from app.commission_entry
    where affiliate_id = ${affiliateId}
    group by status
  `;
	const bucket = new Map<CommissionStatus, number>();
	for (const row of rows) {
		bucket.set(row.status, Number(row.total));
	}
	const [clock] = await tx<{ now: string }[]>`
    select date_trunc('milliseconds', clock_timestamp())::text as now
  `;
	const policy = await resolvePolicy(
		tx,
		"commercial",
		null,
		new Date(clock.now),
	);
	const minimumPayout =
		"minimum_payout_idr" in policy.values
			? Number(policy.values.minimum_payout_idr)
			: 99000;

	return {
		pending: bucket.get("pending") ?? 0,
		held: bucket.get("held") ?? 0,
		eligible: bucket.get("eligible") ?? 0,
		allocated: bucket.get("allocated") ?? 0,
		paid: bucket.get("paid") ?? 0,
		currency: "IDR" as const,
		minimum_payout: minimumPayout,
		eligibility_automatic: true as const,
		transfer_mode: "manual" as const,
	};
}

export async function getAffiliateCommissionBalance(
	identity: LocalAuth,
	principal: Principal,
) {
	return identity.sql.begin(async (tx) => {
		const account = await requireAffiliateAccount(tx, principal);
		return readCommissionBalanceForAffiliate(tx, account.id);
	});
}

export async function readCommissionsForAffiliate(
	tx: TransactionSql,
	affiliateId: string,
	page: { limit: number; cursor: string | null },
) {
	const rows = page.cursor
		? await tx<
				{
					id: string;
					fulfillment_item_id: string;
					replacement_link_id: string | null;
					basis_points: number;
					amount_idr: number;
					status: CommissionStatus;
					hold_reason: string | null;
					receipt_anchor: string | null;
					available_at: string | null;
					product_id: string;
					product_name: string;
				}[]
			>`
        select
          ce.id,
          ce.fulfillment_item_id,
          ce.replacement_link_id,
          ce.basis_points,
          ce.amount_idr,
          ce.status,
          ce.hold_reason,
          ce.receipt_anchor,
          ce.available_at,
          oi.product_id,
          coalesce(oi.snapshot->>'name', oi.snapshot->>'product_name', 'Produk 99ribu') as product_name
        from app.commission_entry ce
        join app.order_item oi on oi.id = ce.order_item_id
        where ce.affiliate_id = ${affiliateId}
          and ce.id > ${page.cursor}::uuid
        order by ce.id asc
        limit ${page.limit + 1}
      `
		: await tx<
				{
					id: string;
					fulfillment_item_id: string;
					replacement_link_id: string | null;
					basis_points: number;
					amount_idr: number;
					status: CommissionStatus;
					hold_reason: string | null;
					receipt_anchor: string | null;
					available_at: string | null;
					product_id: string;
					product_name: string;
				}[]
			>`
        select
          ce.id,
          ce.fulfillment_item_id,
          ce.replacement_link_id,
          ce.basis_points,
          ce.amount_idr,
          ce.status,
          ce.hold_reason,
          ce.receipt_anchor,
          ce.available_at,
          oi.product_id,
          coalesce(oi.snapshot->>'name', oi.snapshot->>'product_name', 'Produk 99ribu') as product_name
        from app.commission_entry ce
        join app.order_item oi on oi.id = ce.order_item_id
        where ce.affiliate_id = ${affiliateId}
        order by ce.id asc
        limit ${page.limit + 1}
      `;

	const slice = rows.slice(0, page.limit);
	const nextCursor =
		rows.length > page.limit ? slice[slice.length - 1].id : null;
	const data = slice.map((row) => ({
		id: row.id,
		sale_reference: `SALE-${row.id.replace(/-/g, "").slice(0, 10).toUpperCase()}`,
		catalog_id: row.product_id,
		product_name: row.product_name,
		quantity: 1,
		rate_basis_points: row.basis_points,
		amount: Number(row.amount_idr),
		status: row.status,
		...(row.hold_reason ? { hold_reason: row.hold_reason } : {}),
		...(row.receipt_anchor
			? {
					receipt_kind: row.replacement_link_id
						? ("replacement" as const)
						: ("original" as const),
					received_at: new Date(row.receipt_anchor).toISOString(),
				}
			: {}),
		...(row.available_at
			? { eligible_at: new Date(row.available_at).toISOString() }
			: {}),
		fulfillment_item_id: row.fulfillment_item_id,
	}));

	return {
		data,
		pagination: { next_cursor: nextCursor },
	};
}

export async function listAffiliateCommissions(
	request: Request,
	identity: LocalAuth,
	principal: Principal,
) {
	const page = pageInput(new URL(request.url));
	return identity.sql.begin(async (tx) => {
		const account = await requireAffiliateAccount(tx, principal);
		return readCommissionsForAffiliate(tx, account.id, page);
	});
}

export async function handleCommissions(request: Request, identity: LocalAuth) {
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
			url.pathname === "/api/v1/me/affiliate/balance" &&
			request.method === "GET"
		) {
			if (url.search) throw invalid();
			return privateJson(
				await getAffiliateCommissionBalance(identity, principal),
				200,
			);
		}
		if (
			url.pathname === "/api/v1/me/affiliate/commissions" &&
			request.method === "GET"
		) {
			return privateJson(
				await listAffiliateCommissions(request, identity, principal),
				200,
			);
		}
		throw new AccessError(404, "NOT_FOUND");
	} catch (error) {
		return problem(error);
	}
}
