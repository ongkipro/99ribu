// Read-only queries for the affiliate dashboard (S158). Every query is scoped by affiliate_id and selects
// no buyer, address, phone, bank or visitor column.
import type { TransactionSql } from "postgres";
import {
	type BalanceDetailInput,
	type CommissionRowInput,
	type CommissionState,
	classifyVoid,
	type SummaryInput,
} from "./dashboard-view.ts";

export const COMMISSION_PAGE_SIZE = 20;

export async function readBalanceDetail(
	tx: TransactionSql,
	affiliateId: string,
): Promise<BalanceDetailInput> {
	const [row] = await tx<
		{
			pending_next_at: string | null;
			pending_awaiting_receipt: string;
			held_reasons: string[] | null;
		}[]
	>`
    select
      min(available_at) filter (where status = 'pending' and available_at is not null) as pending_next_at,
      count(*) filter (where status = 'pending' and available_at is null) as pending_awaiting_receipt,
      array_agg(distinct hold_reason) filter (where status = 'held' and hold_reason is not null) as held_reasons
    from app.commission_entry
    where affiliate_id = ${affiliateId}
  `;
	// A transfer date is the payout's verified completion, not when a commission row was last touched.
	const [paid] = await tx<{ at: string | null }[]>`
    select max(verified_at) at from app.affiliate_payout
    where affiliate_id = ${affiliateId} and status = 'succeeded' and verified_at is not null
  `;
	return {
		pending_next_at: row.pending_next_at
			? new Date(row.pending_next_at).toISOString()
			: null,
		pending_awaiting_receipt: Number(row.pending_awaiting_receipt),
		paid_last_at: paid.at ? new Date(paid.at).toISOString() : null,
		held_reasons: row.held_reasons ?? [],
	};
}

// Clicks are first touches only: a visitor who already holds an active referral is not recorded again
// (PR-8, first click within 7 days), so this counts new referred visitors, not page loads.
export async function readPeriodSummary(
	tx: TransactionSql,
	affiliateId: string,
	range: { from: string | null; to: string },
): Promise<SummaryInput> {
	const [clicks] = await tx<{ n: string }[]>`
    select count(*) n from app.referral_touch
    where affiliate_id = ${affiliateId}
      and (${range.from}::timestamptz is null or touched_at >= ${range.from}::timestamptz)
      and touched_at < ${range.to}::timestamptz
  `;
	const [orders] = await tx<{ n: string }[]>`
    select count(*) n from app.order_attribution
    where affiliate_id = ${affiliateId}
      and (${range.from}::timestamptz is null or attributed_at >= ${range.from}::timestamptz)
      and attributed_at < ${range.to}::timestamptz
  `;
	const [units] = await tx<
		{ units: string; estimate: string; paid: string; reversed: string }[]
	>`
    select count(*) filter (where status <> 'void') units,
      coalesce(sum(amount_idr) filter (where status <> 'void'), 0) estimate,
      coalesce(sum(amount_idr) filter (where status = 'paid'), 0) paid,
      count(*) filter (where status = 'void') reversed
    from app.commission_entry
    where affiliate_id = ${affiliateId}
      and (${range.from}::timestamptz is null or created_at >= ${range.from}::timestamptz)
      and created_at < ${range.to}::timestamptz
  `;
	return {
		clicks: Number(clicks.n),
		orders: Number(orders.n),
		units: Number(units.units),
		estimate_idr: Number(units.estimate),
		paid_idr: Number(units.paid),
		reversed_units: Number(units.reversed),
	};
}

const CURSOR =
	/^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)(?:\.\d{1,6})?([+-])(\d\d)(?::(\d\d))?\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// A cursor is data from the URL. It must be a real calendar timestamp and a real UUID; anything else is
// treated as "no cursor" (first page) so a hand-edited link can never reach the ::timestamptz or ::uuid cast.
export function parseCommissionCursor(raw: string | null) {
	const m = raw ? CURSOR.exec(raw) : null;
	if (!m) return null;
	const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
	const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
	const real =
		probe.getUTCFullYear() === y &&
		probe.getUTCMonth() === mo - 1 &&
		probe.getUTCDate() === d &&
		h < 24 &&
		mi < 60 &&
		se < 60 &&
		Number(m[8]) <= 15 &&
		Number(m[9] ?? 0) < 60;
	if (!real) return null;
	return { at: raw?.slice(0, raw.indexOf("|")) as string, id: m[10] };
}

// Keyset on (created_at desc, id desc). The cursor carries created_at as text so microseconds survive.
export async function readCommissionPage(
	tx: TransactionSql,
	affiliateId: string,
	filter: {
		status: CommissionState | null;
		range: { from: string | null; to: string };
		cursor: string | null;
	},
	pageSize = COMMISSION_PAGE_SIZE,
) {
	const cursor = parseCommissionCursor(filter.cursor);
	const rows = await tx<
		{
			id: string;
			product_name: string;
			basis_points: number;
			amount_idr: string;
			status: CommissionState;
			hold_reason: string | null;
			receipt_anchor: string | null;
			available_at: string | null;
			replacement_link_id: string | null;
			created_at: string;
			created_text: string;
			void_refund: boolean | null;
			void_exception_kind: string | null;
		}[]
	>`
    select ce.id, ce.basis_points, ce.amount_idr, ce.status, ce.hold_reason, ce.receipt_anchor,
      ce.available_at, ce.replacement_link_id, ce.created_at, ce.created_at::text as created_text,
      coalesce(oi.snapshot->>'name', oi.snapshot->>'product_name', 'Produk 99ribu') as product_name,
      adj.is_refund as void_refund, adj.exception_kind as void_exception_kind
    from app.commission_entry ce
    join app.order_item oi on oi.id = ce.order_item_id
    left join lateral (
      -- Facts about the unit's latest void adjustment. A cancellation names the unit itself as its source, and
      -- only an exception recorded at or before that void can explain it, so an older refusal never labels a
      -- later, different void.
      select exists (select 1 from app.refund r where r.id = a.source_id) as is_refund,
        case when a.source_id = ce.fulfillment_item_id then (
          select x.kind
          from app.exception_cancellation ec
          join app.commerce_exception x on x.id = ec.exception_id
          where ec.fulfillment_item_id = ce.fulfillment_item_id
            and ec.replacement_link_id is null
            and ec.occurred_at <= a.occurred_at
          order by ec.occurred_at desc limit 1
        ) end as exception_kind
      from app.commission_adjustment a
      where a.commission_entry_id = ce.id and a.kind = 'voided'
      order by a.revision desc limit 1
    ) adj on ce.status = 'void'
    where ce.affiliate_id = ${affiliateId}
      ${filter.status ? tx`and ce.status = ${filter.status}` : tx``}
      ${filter.range.from ? tx`and ce.created_at >= ${filter.range.from}::timestamptz` : tx``}
      and ce.created_at < ${filter.range.to}::timestamptz
      ${cursor ? tx`and (ce.created_at, ce.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : tx``}
    order by ce.created_at desc, ce.id desc
    limit ${pageSize + 1}
  `;
	const page = rows.slice(0, pageSize);
	const last = page[page.length - 1];
	const data: CommissionRowInput[] = page.map((row) => ({
		id: row.id,
		product_name: row.product_name,
		basis_points: row.basis_points,
		amount_idr: Number(row.amount_idr),
		status: row.status,
		hold_reason: row.hold_reason,
		receipt_anchor: row.receipt_anchor
			? new Date(row.receipt_anchor).toISOString()
			: null,
		available_at: row.available_at
			? new Date(row.available_at).toISOString()
			: null,
		replacement: row.replacement_link_id !== null,
		void_basis: row.status === "void" ? classifyVoid(row.void_refund, row.void_exception_kind) : null,
		created_at: new Date(row.created_at).toISOString(),
	}));
	return {
		data,
		nextCursor:
			rows.length > pageSize && last
				? `${last.created_text}|${last.id}`
				: null,
	};
}
