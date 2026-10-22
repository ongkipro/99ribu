import type { TransactionSql } from "postgres";
import { enqueueJob } from "../../jobs/outbox.ts";
import { AccessError } from "../access/policy.ts";
import { id, object } from "../catalog/validation.ts";
import { queueEligibleAffiliatePayouts } from "../payouts/service.ts";
import {
	accrueOrderCommissions,
	type CommissionEntryRow,
	holdUnitCommission,
	matureEligibleCommissions,
	recordReplacementUnitReceiptMaturity,
	recordUnitReceiptMaturity,
	releaseUnitCommissionHold,
	voidUnitCommissionOnRefund,
} from "./service.ts";

export const COMMISSION_JOB_KINDS: readonly string[] = [
	"commission.accrue",
	"commission.receipt",
	"commission.claim",
	"commission.void",
	"commission.mature",
	"affiliate.payout.queue",
];

// Domain hooks below run inside the committing domain transaction, so the
// commission effect is durable exactly when its business fact commits. The
// worker applies it later; a commission conflict never rolls back the fact.
export function enqueueCommissionAccrual(tx: TransactionSql, orderId: string) {
	return enqueueJob(tx, "commission.accrue", `commission.accrue:${orderId}`, {
		orderId,
	});
}

// Skip orders that provably carry no commission: accrual finished without
// attribution. Pending/failed accrual still enqueues; the job accrues first.
async function commissionRelevant(tx: TransactionSql, orderId: string) {
	const [row] = await tx<{ relevant: boolean }[]>`
    select exists(select 1 from app.order_attribution where order_id = ${orderId})
      or exists(select 1 from app.outbox_job where dedup_key = ${`commission.accrue:${orderId}`} and status <> 'completed') as relevant
  `;
	return row.relevant;
}

export async function enqueueCommissionReceipt(
	tx: TransactionSql,
	orderId: string,
	fulfillmentItemId: string,
	receivedAt?: string,
	sourceId?: string,
) {
	if (!(await commissionRelevant(tx, orderId))) return;
	const payload: Record<string, unknown> = { orderId, fulfillmentItemId };
	if (receivedAt !== undefined) payload.receivedAt = receivedAt;
	if (sourceId !== undefined) payload.sourceId = sourceId;
	await enqueueJob(
		tx,
		"commission.receipt",
		`commission.receipt:${fulfillmentItemId}`,
		payload,
	);
}

const CLAIM_EFFECTS = ["held", "released", "refunded", "replaced"];

// One return item reaches each claim state at most once, so the key is stable.
export async function enqueueCommissionClaim(
	tx: TransactionSql,
	orderId: string,
	returnItemId: string,
	claimState: string,
	fulfillmentItemId?: string,
) {
	if (!CLAIM_EFFECTS.includes(claimState)) return;
	if (!(await commissionRelevant(tx, orderId))) return;
	const payload: Record<string, unknown> = {
		orderId,
		returnItemId,
		claimState,
	};
	if (fulfillmentItemId !== undefined)
		payload.fulfillmentItemId = fulfillmentItemId;
	await enqueueJob(
		tx,
		"commission.claim",
		`commission.claim:${returnItemId}:${claimState}`,
		payload,
	);
}

export async function enqueueCommissionVoid(
	tx: TransactionSql,
	orderId: string,
	fulfillmentItemId: string,
) {
	if (!(await commissionRelevant(tx, orderId))) return;
	await enqueueJob(
		tx,
		"commission.void",
		`commission.void:${fulfillmentItemId}`,
		{ orderId, fulfillmentItemId },
	);
}

export async function enqueueAffiliatePayoutQueue(
	tx: TransactionSql,
	affiliateId: string,
	reference: string,
) {
	return enqueueJob(
		tx,
		"affiliate.payout.queue",
		`affiliate.payout.queue:${affiliateId}:${reference}`,
		{ affiliateId },
	);
}

// A pending anchored entry gets one maturity job per revision, due at H+10.
// The worker also claims it early when the order's fixture clock is due.
async function scheduleMaturity(
	tx: TransactionSql,
	orderId: string,
	entry: CommissionEntryRow,
) {
	if (entry.status !== "pending" || entry.hold_reason || !entry.available_at)
		return null;
	const jobId = await enqueueJob(
		tx,
		"commission.mature",
		`commission.mature:${entry.id}:${entry.revision}`,
		{ orderId, commissionEntryId: entry.id },
	);
	await tx`update app.outbox_job set run_at = ${entry.available_at}::timestamptz where id = ${jobId} and status = 'pending'`;
	return jobId;
}

async function entryFor(tx: TransactionSql, fulfillmentItemId: string) {
	const [entry] = await tx<CommissionEntryRow[]>`
    select * from app.commission_entry where fulfillment_item_id = ${fulfillmentItemId}
  `;
	return entry;
}

type CommissionJobResult = Record<string, unknown> & {
	deferMs?: number;
};

export async function processCommissionJob(
	tx: TransactionSql,
	job: { id: string; kind: string; payload: unknown },
): Promise<CommissionJobResult> {
	if (job.kind === "affiliate.payout.queue") {
		const input = object(job.payload, ["affiliateId"]);
		const queued = await queueEligibleAffiliatePayouts(tx, {
			affiliateId: id(input.affiliateId),
		});
		return { outcome: "queued", payouts: queued.map((p) => p.id) };
	}
	const input = object(job.payload, [
		"orderId",
		"fulfillmentItemId",
		"returnItemId",
		"claimState",
		"commissionEntryId",
		"receivedAt",
		"sourceId",
		"reason",
	]);
	const orderId = id(input.orderId);
	const [order] = await tx<
		{ created_at: string; clock_namespace: string | null; now: string }[]
	>`
    select created_at, clock_namespace, app.reservation_clock(clock_namespace) as now
    from app.commerce_order where id = ${orderId}
  `;
	if (!order) throw new AccessError(400, "INVALID_COMMISSION_JOB");
	const now = new Date(order.now).toISOString();
	// Attribution and rate are evaluated at the sale instant, never at job time.
	const accrued = await accrueOrderCommissions(tx, {
		orderId,
	});
	if (job.kind === "commission.accrue") {
		return {
			outcome: accrued.length ? "accrued" : "unattributed",
			entries: accrued.length,
		};
	}

	if (job.kind === "commission.mature") {
		const entryId = id(input.commissionEntryId);
		const [entry] = await tx<CommissionEntryRow[]>`
      select * from app.commission_entry where id = ${entryId} and order_id = ${orderId} for update
    `;
		if (!entry) throw new AccessError(400, "INVALID_COMMISSION_JOB");
		if (entry.status !== "pending" || entry.hold_reason || !entry.available_at)
			return { outcome: "skipped", status: entry.status };
		const wait = new Date(entry.available_at).getTime() - Date.parse(now);
		if (wait > 0) return { deferMs: wait };
		const matured = await matureEligibleCommissions(tx, {
			entryId,
			asOf: now,
		});
		const queued = await queueEligibleAffiliatePayouts(tx, {
			affiliateId: entry.affiliate_id,
		});
		return {
			outcome: matured.length ? "matured" : "skipped",
			payouts: queued.map((p) => p.id),
		};
	}

	if (job.kind === "commission.receipt" || job.kind === "commission.void") {
		const fulfillmentItemId = id(input.fulfillmentItemId);
		const entry = await entryFor(tx, fulfillmentItemId);
		if (!entry) return { outcome: "no_commission" };
		if (job.kind === "commission.void") {
			const voided = await voidUnitCommissionOnRefund(tx, {
				fulfillmentItemId,
				reason: "Unit dibatalkan; komisi dibatalkan",
				occurredAt: now,
			});
			return { outcome: "voided", status: voided.status };
		}
		if (["void", "allocated", "paid"].includes(entry.status))
			return { outcome: "skipped", status: entry.status };
		let receivedAt = input.receivedAt ? String(input.receivedAt) : undefined;
		let sourceId = input.sourceId ? String(input.sourceId) : undefined;
		if (!receivedAt || !sourceId) {
			const [receipt] = await tx<{ source_id: string; received_at: string }[]>`
        select source_id, received_at from app.buyer_receipt where fulfillment_item_id = ${fulfillmentItemId}
      `;
			if (receipt) {
				receivedAt = new Date(receipt.received_at).toISOString();
				sourceId = receipt.source_id;
			}
		}
		if (!receivedAt) throw new AccessError(400, "INVALID_COMMISSION_JOB");
		const updated = await recordUnitReceiptMaturity(tx, {
			fulfillmentItemId,
			receivedAt,
			sourceId,
		});
		await scheduleMaturity(tx, orderId, updated);
		return { outcome: "anchored", available_at: updated.available_at };
	}

	if (job.kind === "commission.claim") {
		const returnItemId = id(input.returnItemId);
		const claimState = String(input.claimState);
		if (!CLAIM_EFFECTS.includes(claimState))
			throw new AccessError(400, "INVALID_COMMISSION_JOB");
		let fulfillmentItemId: string | null = input.fulfillmentItemId
			? id(input.fulfillmentItemId)
			: null;
		if (!fulfillmentItemId) {
			const [item] = await tx<{ fulfillment_item_id: string }[]>`
        select r.fulfillment_item_id from app.return_item r join app.return_case c on c.id = r.case_id
        where r.id = ${returnItemId} and c.order_id = ${orderId}
      `;
			if (item) fulfillmentItemId = item.fulfillment_item_id;
		}
		if (!fulfillmentItemId) throw new AccessError(400, "INVALID_COMMISSION_JOB");
		const entry = await entryFor(tx, fulfillmentItemId);
		if (!entry) return { outcome: "no_commission" };
		if (entry.status === "void") return { outcome: "skipped", status: "void" };
		if (claimState === "held") {
			if (entry.status === "held")
				return { outcome: "skipped", status: "held" };
			// allocated/paid raise COMMISSION_STATE_CONFLICT: a late claim after
			// payout needs a visible finance correction, never silent rewrite.
			const held = await holdUnitCommission(tx, {
				fulfillmentItemId,
				holdReason: "Retur pembeli sedang diproses",
				sourceId: returnItemId,
				occurredAt: now,
			});
			return { outcome: "held", status: held.status };
		}
		if (claimState === "released") {
			const released = await releaseUnitCommissionHold(tx, {
				fulfillmentItemId,
				sourceId: returnItemId,
				occurredAt: now,
			});
			await scheduleMaturity(tx, orderId, released);
			return { outcome: "released", status: released.status };
		}
		if (claimState === "refunded") {
			const [refund] = await tx<{ refund_id: string }[]>`
        select a.refund_id from app.refund_allocation a join app.refund r on r.id = a.refund_id
        where a.return_item_id = ${returnItemId} and r.status = 'succeeded' limit 1
      `;
			const voided = await voidUnitCommissionOnRefund(tx, {
				fulfillmentItemId,
				refundId: refund?.refund_id ?? returnItemId,
				reason: "Unit direfund; komisi dibatalkan",
				occurredAt: now,
			});
			return { outcome: "voided", status: voided.status };
		}
		const [replacement] = await tx<
			{ id: string; source_id: string; received_at: string }[]
		>`
      select link.id, receipt.source_id, receipt.received_at
      from app.replacement_link link
      join app.replacement_buyer_receipt receipt on receipt.replacement_link_id = link.id
      where link.return_item_id = ${returnItemId}
      order by receipt.received_at desc, link.id desc limit 1
    `;
		if (!replacement) return { outcome: "skipped", status: entry.status };
		const reanchored = await recordReplacementUnitReceiptMaturity(tx, {
			fulfillmentItemId,
			replacementLinkId: replacement.id,
			receivedAt: new Date(replacement.received_at).toISOString(),
			sourceId: replacement.source_id,
		});
		await scheduleMaturity(tx, orderId, reanchored);
		return { outcome: "reanchored", available_at: reanchored.available_at };
	}
	throw new AccessError(400, "INVALID_COMMISSION_JOB");
}
