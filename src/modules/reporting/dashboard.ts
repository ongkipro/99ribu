import type { LocalAuth } from "../access/auth.ts";
import { AccessError, getPrincipal } from "../access/policy.ts";
import { digest } from "../checkout/access.ts";
import {
	averageOf,
	bucketCodAgeing,
	type Comparison,
	computeComparison,
	isPeriodPreset,
	MIN_RATE_SAMPLE,
	previousPeriod,
	rateOf,
	resolvePeriodPreset,
	seriesBuckets,
} from "./metric-math.ts";
import {
	COMPARABLE_METRICS,
	LOW_STOCK_THRESHOLD,
	METRIC_ACTION_HREF,
	METRIC_QUEUE_MAP,
	type MetricKey,
	MONEY_METRICS,
	PAYMENT_CHANNEL_LABELS,
	resolveAuthorizedWarehouses,
	resolveDateRange,
	resolveWorkspace,
	SNAPSHOT_METRICS,
	STALE_AFTER_HOURS,
	TRANSFER_DEADLINE_WARNING_HOURS,
	WORKSPACE_METRICS,
} from "./shared.ts";
import {
	automatedWarehouseIds,
	codOutcomes,
	codReceivableSource,
	deliveredOrders,
	exceptionsSource,
	fulfillmentsSource,
	lowStockPositions,
	ordersSource,
	PAYMENT_QUEUE_METRICS,
	reconciliationSource,
	returnsSource,
	supportSource,
} from "./sources.ts";
import { signTokenPayload } from "./tokens.ts";

// Money metrics are company-wide for owner/finance: a requested warehouse_id narrows the counts,
// never the money (the definitions say so).
async function computeMoneyMetrics(
	identity: LocalAuth,
	from: string,
	to: string,
): Promise<
	Record<
		| "cod_receivable"
		| "cod_remitted"
		| "refund_liability"
		| "affiliate_liability"
		| "estimated_contribution"
		| "realized_contribution"
		| "net_merchandise_revenue",
		{
			complete: boolean;
			amount: number | null;
			financial_basis: "actual" | "estimated" | "mixed" | "unknown";
		}
	>
> {
	const sql = identity.sql;

	// 1. COD outstanding (balance snapshot, any order date): frozen COD due (cod_due) of parcels
	// handed to the courier that have no collection outcome yet (no COD receipt, no Mengantar
	// statement line, no collected/refused COD operation). Unshipped and cancelled parcels owe nothing.
	// Limitation: a parcel returned to sender stays here until an outcome is recorded (RTS handling
	// of manual parcels is the DEC-007 (6) follow-up).
	const [codRow] = await sql<{ amount: string }[]>`
    select coalesce(sum(s.cod_due), 0)::text as amount ${codReceivableSource(sql)}`;

	// 1b. COD remitted: per-parcel collected amounts on Mengantar COD statements dated in the period
	// (gross, before Mengantar's shipping/COD-fee deductions), as finance recorded them (S91).
	const [remittedRow] = await sql<{ amount: string }[]>`
    select coalesce(sum(l.amount), 0)::text as amount
    from app.cod_remittance_line l
    join app.cod_remittance r on r.id = l.remittance_id
    where r.statement_at >= ${from}::timestamptz
      and r.statement_at <= ${to}::timestamptz
  `;

	// 2. Refund liability: pending/approved refunds + recovery refunds not yet completed
	const [refundRow] = await sql<{ amount: string }[]>`
    select (
      coalesce((
        select sum(r.amount) from app.refund r
        where r.created_at >= ${from}::timestamptz and r.created_at <= ${to}::timestamptz
          and r.status not in ('completed', 'cancelled', 'rejected')
      ), 0) +
      coalesce((
        select sum(rr.amount) from app.recovery_refund rr
        where rr.created_at >= ${from}::timestamptz and rr.created_at <= ${to}::timestamptz
          and rr.status not in ('completed', 'cancelled', 'rejected')
      ), 0)
    )::text as amount
  `;

	// 3. Affiliate liability: unpaid commission entries + active payouts
	const [affiliateRow] = await sql<{ amount: string }[]>`
    select coalesce(sum(ce.amount_idr), 0)::text as amount
    from app.commission_entry ce
    where ce.created_at >= ${from}::timestamptz
      and ce.created_at <= ${to}::timestamptz
      and ce.status in ('pending', 'available', 'claimed')
  `;

	// 4. Net merchandise revenue: verified economic receipts minus confirmed refund allocations
	const [revenueRow] = await sql<{ gross: string; refunded: string }[]>`
    select
      coalesce((
        select sum(er.merchandise_amount)
        from app.economic_receipt er
        where er.occurred_at >= ${from}::timestamptz
          and er.occurred_at <= ${to}::timestamptz
      ), 0)::text as gross,
      (
        coalesce((
          select sum(ra.merchandise_amount)
          from app.refund_allocation ra
          join app.refund r on r.id = ra.refund_id
          where r.created_at >= ${from}::timestamptz
            and r.created_at <= ${to}::timestamptz
            and r.status = 'completed'
        ), 0) +
        coalesce((
          select sum(rra.merchandise_amount)
          from app.recovery_refund_allocation rra
          join app.recovery_refund rr on rr.id = rra.refund_id
          where rr.created_at >= ${from}::timestamptz
            and rr.created_at <= ${to}::timestamptz
            and rr.status = 'completed'
        ), 0)
      )::text as refunded
  `;
	const netMerchandiseRevenue = Math.max(
		0,
		Number(revenueRow.gross) - Number(revenueRow.refunded),
	);

	// 5. Contribution metrics: check if any order_item in the window lacks a known component cost version or offer cost assumption!
	// Let's also check if any stock_item exists without a component_cost_version when orders exist, or if any offer lacks cost assumptions.
	const orderItems = await sql<
		{
			item_id: string;
			quantity: number;
			unit_price: number;
			offer_id: string;
			publication_id: string;
			subsidy_amount: string;
			has_pub_cost: boolean;
			pub_unit_cost: string | null;
			has_offer_assumption: boolean;
			assumption_cost: string | null;
		}[]
	>`
    select oi.id as item_id,
           oi.quantity,
           -- S177 2B: revenue per item is net of its frozen store-voucher shares (spread back per unit).
           oi.unit_price - (select coalesce(sum(f.merchandise_discount),0) from app.fulfillment_item f where f.order_item_id = oi.id)::numeric / oi.quantity as unit_price,
           oi.offer_id,
           oi.publication_id,
           o.subsidy_amount::text as subsidy_amount,
           exists (
             select 1 from app.publication_component_cost pcc
             where pcc.publication_id = oi.publication_id and pcc.offer_id = oi.offer_id
           ) as has_pub_cost,
           (
             select sum(pcc.quantity * ccv.unit_cost)::text
             from app.publication_component_cost pcc
             join app.component_cost_version ccv on ccv.id = pcc.cost_version_id
             where pcc.publication_id = oi.publication_id and pcc.offer_id = oi.offer_id
           ) as pub_unit_cost,
           exists (
             select 1 from app.offer_cost_assumption_version oca
             where oca.offer_id = oi.offer_id
               and oca.effective_at <= ${to}::timestamptz
           ) as has_offer_assumption,
           (
             select (oca.packaging_idr + oca.provider_fee_idr + oca.returns_reserve_idr)::text
             from app.offer_cost_assumption_version oca
             where oca.offer_id = oi.offer_id
               and oca.effective_at <= ${to}::timestamptz
             order by oca.revision desc
             limit 1
           ) as assumption_cost
    from app.order_item oi
    join app.commerce_order o on o.id = oi.order_id
    where o.created_at >= ${from}::timestamptz
      and o.created_at <= ${to}::timestamptz
  `;

	// Check if any component_cost_version existed as of the end of the window `to`
	const [costCoverage] = await sql<{ count: string }[]>`
    select count(*)::text as count
    from app.component_cost_version ccv
    where ccv.effective_at <= ${to}::timestamptz
  `;

	const hasMissingCostSource =
		Number(costCoverage.count) === 0 ||
		orderItems.some(
			(item) =>
				!item.has_pub_cost ||
				item.pub_unit_cost === null ||
				!item.has_offer_assumption,
		);

	let estimatedContribution: {
		complete: boolean;
		amount: number | null;
		financial_basis: "actual" | "estimated" | "mixed" | "unknown";
	};
	let realizedContribution: {
		complete: boolean;
		amount: number | null;
		financial_basis: "actual" | "estimated" | "mixed" | "unknown";
	};

	if (hasMissingCostSource) {
		estimatedContribution = {
			complete: false,
			amount: null,
			financial_basis: "unknown",
		};
		realizedContribution = {
			complete: false,
			amount: null,
			financial_basis: "unknown",
		};
	} else {
		let estTotal = 0;
		for (const item of orderItems) {
			const revenue = Number(item.quantity) * Number(item.unit_price);
			const unitCost =
				Number(item.pub_unit_cost ?? 0) + Number(item.assumption_cost ?? 0);
			estTotal += revenue - Number(item.quantity) * unitCost;
		}
		estimatedContribution = {
			complete: true,
			amount: estTotal,
			financial_basis: "estimated",
		};
		realizedContribution = {
			complete: true,
			amount: netMerchandiseRevenue === 0 ? 0 : estTotal,
			financial_basis: "actual",
		};
	}

	return {
		cod_receivable: {
			complete: true,
			amount: Math.max(0, Number(codRow.amount)),
			financial_basis: "actual",
		},
		cod_remitted: {
			complete: true,
			amount: Math.max(0, Number(remittedRow.amount)),
			financial_basis: "actual",
		},
		refund_liability: {
			complete: true,
			amount: Math.max(0, Number(refundRow.amount)),
			financial_basis: "actual",
		},
		affiliate_liability: {
			complete: true,
			amount: Math.max(0, Number(affiliateRow.amount)),
			financial_basis: "actual",
		},
		estimated_contribution: estimatedContribution,
		realized_contribution: realizedContribution,
		net_merchandise_revenue: {
			complete: true,
			amount: netMerchandiseRevenue,
			financial_basis: "actual",
		},
	};
}

export async function getDashboardSnapshot(
	request: Request,
	identity: LocalAuth,
) {
	const url = new URL(request.url);
	if (
		["authorization", "x-cart-token", "x-order-token"].some((h) =>
			request.headers.has(h),
		)
	) {
		throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
	}
	const allowedParams = new Set([
		"workspace",
		"warehouse_id",
		"from",
		"to",
		"window",
		"as_of",
		"metric",
		"compare",
		"fields",
	]);
	for (const key of url.searchParams.keys()) {
		if (!allowedParams.has(key) || url.searchParams.getAll(key).length !== 1) {
			throw new AccessError(400, "INVALID_INPUT");
		}
	}
	// compare=previous: the previous period of equal length (DEC-027 (1)); no other value exists.
	const compareParam = url.searchParams.get("compare");
	if (compareParam !== null && compareParam !== "previous") {
		throw new AccessError(400, "INVALID_INPUT");
	}

	// fields=counts: the navigation badge poll. Counts only, so it skips money, rates, the series, the
	// ageing and the comparison (each costs queries the badge never shows).
	const fieldsParam = url.searchParams.get("fields");
	if (fieldsParam !== null && fieldsParam !== "counts") {
		throw new AccessError(400, "INVALID_INPUT");
	}
	const countsOnly = fieldsParam === "counts";

	const principal = await getPrincipal(request, identity);
	const workspace = resolveWorkspace(
		principal,
		url.searchParams.get("workspace"),
	);
	const requestedMetric = url.searchParams.get("metric") as MetricKey | null;
	if (requestedMetric) {
		if (!WORKSPACE_METRICS[workspace].includes(requestedMetric)) {
			throw new AccessError(403, "FORBIDDEN");
		}
	}

	const requestedWarehouseId = url.searchParams.get("warehouse_id");
	const warehouseIds = await resolveAuthorizedWarehouses(
		identity,
		principal,
		workspace,
		requestedWarehouseId,
	);

	const [clock] = await identity.sql<
		{ now: string }[]
	>`select clock_timestamp() as now`;
	const rawAsOf = url.searchParams.get("as_of");
	const asOf = rawAsOf
		? new Date(Date.parse(rawAsOf)).toISOString()
		: new Date(clock.now).toISOString();
	if (Number.isNaN(Date.parse(asOf)))
		throw new AccessError(400, "INVALID_INPUT");

	const { from, to } = resolveDateRange(url, asOf);
	// A preset shifts back by whole WIB days; any other range by its own length.
	const rawWindow = url.searchParams.get("window") ?? "30d";
	const explicitRange = url.searchParams.has("from");
	const previous = compareParam && !countsOnly
		? previousPeriod(
				from,
				to,
				!explicitRange && isPeriodPreset(rawWindow)
					? resolvePeriodPreset(rawWindow, Date.parse(asOf)).shiftMs
					: undefined,
			)
		: null;
	const filterExpiresAt = new Date(
		Date.parse(asOf) + 30 * 60_000,
	).toISOString();

	const allowedKeys = WORKSPACE_METRICS[workspace];
	// Metrics the counts mode leaves out: money, the average (money-derived) and the two-query rates.
	const skippedInCounts = (key: MetricKey) =>
		MONEY_METRICS.has(key) || key === "average_order_value" || key === "cod_failed_rate" || key === "return_rate";
	const sql = identity.sql;
	type Counted = {
		count: number;
		breakdown: { key: string; label: string; count: number }[] | null;
		/** Rate metrics: what `count` is divided by. */
		denominator?: number;
		/** Rate metrics with a minimum sample: the denominator is below it, so no percentage is shown. */
		low_sample?: boolean;
		/** Oldest unclaimed chat: seconds the oldest one has waited (null with none). */
		age_seconds?: number | null;
		/** Rows of `count` older than STALE_AFTER_HOURS, where the queue has a date for them. */
		stale_count?: number | null;
	};
	// Cards are SQL counts over the same fragments the drilldown pages list; rows are only
	// materialized for the drilldown.
	// S113: every count is a count over the exact fragment its drilldown lists (ordersSource,
	// fulfillmentsSource, lowStockPositions, or the queue rows themselves); no card restates a filter.
	// S153: `stale` is a FILTER aggregate over the same fragment, so the overdue marker can never
	// disagree with the rows behind the tile.
	const staleBefore = new Date(
		Date.parse(asOf) - STALE_AFTER_HOURS * 3_600_000,
	).toISOString();
	const countOf = async (
		fragment: ReturnType<typeof ordersSource>,
		// A boolean over the fragment's own columns: the rows staff must still act on and that are
		// older than the marker. Rows waiting for the buyer are never in it.
		staleWhere?: ReturnType<typeof ordersSource>,
	): Promise<{ n: number; stale: number | null }> => {
		const [row] = staleWhere
			? await sql<{ n: number; stale: number }[]>`select count(*)::int as n,
          (count(*) filter (where ${staleWhere}))::int as stale ${fragment}`
			: await sql<{ n: number }[]>`select count(*)::int as n ${fragment}`;
		return { n: Number(row.n), stale: "stale" in row ? Number(row.stale) : null };
	};
	const countFor = async (
		key: MetricKey,
		range: { from: string; to: string } = { from, to },
	): Promise<Counted> => {
		const { from, to } = range;
		if (key === "orders_by_payment_method") {
			const groups = await sql<{ channel: string; placed: number }[]>`
        select coalesce(o.payment_channel, case when o.payment_method = 'cod' then 'cod' else 'local-prepaid' end) as channel,
               count(*)::int as placed
        ${ordersSource(sql, warehouseIds, from, to, key, asOf)}
        group by 1
      `;
			const placed = new Map(groups.map((g) => [g.channel, g.placed]));
			return {
				count: groups.reduce((n, g) => n + g.placed, 0),
				// The three launch methods always show (0 included); the local simulation only when present.
				breakdown: Object.entries(PAYMENT_CHANNEL_LABELS)
					.filter(([k]) => k !== "local-prepaid" || placed.has(k))
					.map(([k, label]) => ({ key: k, label, count: placed.get(k) ?? 0 })),
			};
		}
		if (key === "orders_pending" || key === "average_order_value" || PAYMENT_QUEUE_METRICS.has(key)) {
			const c = await countOf(
				ordersSource(sql, warehouseIds, from, to, key, asOf),
				// "More than 24 hours" counts what staff must act on: a prepaid order still awaiting the
				// BUYER's payment is waiting on the buyer, not on staff.
				key === "orders_pending"
					? sql`o.created_at < ${staleBefore}::timestamptz and not (o.payment_method = 'prepaid' and o.payment_status = 'pending')`
					: undefined,
			);
			return { count: c.n, breakdown: null, stale_count: c.stale };
		}
		if (
			key === "fulfillments_due" ||
			key === "manual_booking_pending" ||
			key === "fulfillments_overdue"
		) {
			if (warehouseIds.length === 0) return { count: 0, breakdown: null };
			const ids =
				key === "manual_booking_pending"
					? await automatedWarehouseIds(identity)
					: [];
			const c = await countOf(
				fulfillmentsSource(sql, warehouseIds, from, to, key, ids, asOf),
			);
			// No stale marker: the overdue chip (fulfillments_overdue) is the one deadline marker.
			return { count: c.n, breakdown: null };
		}
		if (key === "cod_failed_rate") {
			// Numerator = the failed COD parcels its drilldown lists; denominator = all COD parcels with an outcome.
			if (warehouseIds.length === 0) return { count: 0, breakdown: null, denominator: 0 };
			const [denominator] = await sql<{ n: number }[]>`
        select count(*)::int as n from (${codOutcomes(sql, warehouseIds, from, to)}) co`;
			return {
				count: (await countOf(fulfillmentsSource(sql, warehouseIds, from, to, key, [], asOf))).n,
				breakdown: null,
				denominator: Number(denominator.n),
			};
		}
		if (key === "return_rate") {
			const [denominator] = await deliveredOrders(sql, warehouseIds, from, to);
			const n = Number(denominator.n);
			return {
				count: (await countOf(returnsSource(sql, warehouseIds, from, to, key))).n,
				breakdown: null,
				denominator: n,
				low_sample: n > 0 && n < MIN_RATE_SAMPLE,
			};
		}
		if (key === "oldest_unclaimed_chat_age") {
			const [row] = await sql<{ n: number; oldest: string | null }[]>`
        select count(*)::int as n, min(c.created_at) as oldest ${supportSource(sql, from, to, key)}`;
			return {
				count: Number(row.n),
				breakdown: null,
				age_seconds: row.oldest
					? Math.max(0, Math.floor((Date.parse(asOf) - new Date(row.oldest).getTime()) / 1000))
					: null,
			};
		}
		if (key === "stock_alerts") {
			if (warehouseIds.length === 0) return { count: 0, breakdown: [] };
			// Per origin warehouse with at least one alert, most alerts first.
			const perWarehouse = await sql<
				{ id: string; name: string; n: number }[]
			>`
        select w.id::text as id, w.name, count(*)::int as n
        from (${lowStockPositions(sql, warehouseIds)}) p join app.warehouse w on w.id = p.warehouse_id
        group by w.id, w.name
        order by n desc, w.name
      `;
			return {
				count: perWarehouse.reduce((n, w) => n + w.n, 0),
				breakdown: perWarehouse.map((w) => ({
					key: w.id,
					label: w.name,
					count: w.n,
				})),
			};
		}
		const staleWhere =
			key === "delivery_exceptions"
				? sql`e.occurred_at < ${staleBefore}::timestamptz`
				: key === "returns_pending"
					? sql`rc.created_at < ${staleBefore}::timestamptz`
					: key === "support_unassigned"
						? // Only chats that need a staff reply: not those waiting for the buyer.
							sql`c.created_at < ${staleBefore}::timestamptz and c.status = 'open'`
						: undefined;
		const source =
			key === "delivery_exceptions" || key === "cod_problems_open"
				? exceptionsSource(sql, warehouseIds, from, to, key)
				: key === "returns_pending"
					? returnsSource(sql, warehouseIds, from, to, key)
					: key === "support_unassigned"
						? supportSource(sql, from, to, key)
						: key === "finance_unmatched"
							? reconciliationSource(sql, from, to, key)
							: null;
		if (!source) throw new Error(`count metric without a source fragment: ${key}`);
		const c = await countOf(source, staleWhere);
		return { count: c.n, breakdown: null, stale_count: c.stale };
	};

	const needsMoney =
		!countsOnly && allowedKeys.some((k) => MONEY_METRICS.has(k));
	const moneyValues = needsMoney
		? await computeMoneyMetrics(identity, from, to)
		: null;
	const previousMoney =
		needsMoney && previous
			? await computeMoneyMetrics(identity, previous.from, previous.to)
			: null;
	// Average order value (DEC-027 (4)): one population. Numerator and denominator are the same orders,
	// the ones the orders drilldown lists (placed in the period, not cancelled, not a draft), dated by
	// their creation. The numerator is their merchandise at the frozen item prices (quantity x unit
	// price, no shipping), so a COD order that is not paid yet and a prepaid order awaiting payment
	// count like every other order and the figure is an estimate (Estimasi), never Aktual: payment and
	// refunds are not subtracted. It cannot go negative, so nothing is clamped.
	const averageOrder = async (range: { from: string; to: string }) => {
		const [row] = await sql<{ n: number; total: string }[]>`
      select count(*)::int as n, coalesce(sum(m.merchandise), 0)::text as total from (
        select (select sum(oi.quantity * oi.unit_price) from app.order_item oi where oi.order_id = o.id) as merchandise
        ${ordersSource(sql, warehouseIds, range.from, range.to, "average_order_value", asOf)}
      ) m`;
		return { orders: Number(row.n), average: averageOf(Number(row.total), Number(row.n)) };
	};
	// The previous period's value of a comparable metric, in the metric's own unit.
	const valueIn = async (
		key: MetricKey,
		range: { from: string; to: string },
		money: typeof moneyValues,
	): Promise<{ value: number | null; complete: boolean }> => {
		if (key === "average_order_value") {
			return { value: (await averageOrder(range)).average, complete: true };
		}
		if (key === "cod_failed_rate" || key === "return_rate") {
			const c = await countFor(key, range);
			return {
				value: rateOf(c.count, c.denominator ?? 0, key === "return_rate" ? MIN_RATE_SAMPLE : 1),
				complete: true,
			};
		}
		if (key === "orders_by_payment_method") {
			return { value: (await countFor(key, range)).count, complete: true };
		}
		const m = money?.[key as keyof NonNullable<typeof moneyValues>];
		return { value: m?.complete ? (m.amount ?? 0) : null, complete: m?.complete ?? false };
	};

	// Each text states exactly what its query counts (S103).
	const definitions: Record<MetricKey, string> = {
		orders_pending:
			"Pesanan yang dibuat dalam periode dan masih berstatus menunggu atau diproses. Pesanan dibatalkan atau selesai tidak dihitung. Penanda lebih dari 24 jam tidak menghitung pesanan prabayar yang masih menunggu pembayaran pembeli.",
		orders_by_payment_method:
			"Pesanan yang dibuat dalam periode (semua status kecuali draf checkout), dirinci per metode bayar: COD, transfer manual, dan VA/QRIS AutoLaris.",
		fulfillments_due:
			"Semua paket gudang saat ini yang belum diserahkan ke kurir, termasuk paket bermasalah, dari hari apa pun dibuatnya. Antrean kerja yang berjalan, tanpa filter periode; paket yang lewat batas ada di dalamnya.",
		manual_booking_pending:
			"Paket di antrean Pengiriman Manual \"Perlu dipesan kurir\" saat ini: belum ada resi, belum dipesan lewat sistem, dan masih ada unit aktif.",
		delivery_exceptions:
			"Kendala pengiriman yang tercatat dalam periode dan belum selesai.",
		returns_pending:
			"Pengajuan retur atau penukaran yang dibuat dalam periode dan belum ditolak atau selesai.",
		stock_alerts: `Posisi stok (gudang dan SKU) saat ini dengan stok tersedia paling banyak ${LOW_STOCK_THRESHOLD} unit. Tersedia = stok fisik dikurangi stok dipesan dan karantina, tanpa lot kedaluwarsa, sama seperti ketersediaan katalog.`,
		support_unassigned:
			"Percakapan terbuka atau menunggu pembeli yang dibuat dalam periode dan belum punya staf penanggung jawab.",
		finance_unmatched:
			"Mutasi penyelesaian pembayaran/COD yang dibuat dalam periode dan belum cocok (masih disiapkan, menunggu, cocok sebagian, tidak cocok, atau bermasalah).",
		transfers_near_deadline: `Transfer bank manual yang masih terbuka di antrean Pembayaran (belum dikonfirmasi keuangan) dengan batas bayar tinggal ${TRANSFER_DEADLINE_WARNING_HOURS} jam atau kurang, atau sudah lewat. Seluruh perusahaan, tanpa filter gudang.`,
		autolaris_pending:
			"Pesanan dengan pembayaran VA/QRIS AutoLaris yang masih terbuka di antrean Pembayaran (belum lunas, gagal, atau kedaluwarsa). Seluruh perusahaan, tanpa filter gudang.",
		cod_receivable:
			"COD belum disetor, saldo saat ini untuk seluruh perusahaan (tanpa filter periode dan gudang): tagihan COD paket yang sudah diserahkan ke kurir tetapi belum punya hasil penagihan atau laporan setoran Mengantar. Paket yang diretur ke pengirim tetap terhitung sampai hasilnya dicatat.",
		cod_remitted:
			"COD sudah disetor untuk seluruh perusahaan (tanpa filter gudang): nilai COD per paket pada laporan setoran Mengantar bertanggal dalam periode, sebelum potongan ongkir dan biaya COD Mengantar.",
		refund_liability:
			"Kewajiban pengembalian dana pelanggan yang masih berjalan dalam Rupiah (IDR).",
		affiliate_liability:
			"Kewajiban komisi afiliasi tertunda atau siap cair dalam Rupiah (IDR).",
		estimated_contribution:
			"Estimasi kontribusi margin berdasarkan sumber biaya komponen dan asumsi penawaran yang lengkap.",
		realized_contribution:
			"Kontribusi terealisasi setelah penerimaan kas terverifikasi dan biaya komponen lengkap.",
		net_merchandise_revenue:
			"Pendapatan bersih barang dagangan (penerimaan terverifikasi dikurangi alokasi refund selesai).",
		fulfillments_overdue:
			"Paket gudang yang belum diserahkan ke kurir dan sudah melewati batas yang berlaku: batas serah kurir setelah paket dikemas, batas kemas sebelumnya. Saat ini, tanpa filter periode. Paket tanpa batas dari kalender tidak dihitung.",
		cod_failed_rate:
			"Paket COD yang ditolak pembeli, gagal diantar, atau dikembalikan ke pengirim dibagi semua paket COD yang sudah selesai (diterima atau dikembalikan) dalam periode. Setiap paket dihitung sekali menurut kejadian akhirnya: gagal yang kemudian berhasil diantar dihitung berhasil, dan tanggalnya adalah tanggal kejadian akhir itu. Angka di kartu adalah pembilang (paket gagal); penyebut tertulis di bawahnya. Kosong bila belum ada paket COD yang selesai.",
		return_rate:
			`Pengajuan retur atau penukaran yang dibuat dalam periode dibagi pesanan yang diterima pembeli dalam periode yang sama. Pengajuan bisa berasal dari pesanan yang diterima sebelum periode, jadi pada periode pendek angkanya bisa melebihi 100% (angka tetap ditampilkan apa adanya). Di bawah ${MIN_RATE_SAMPLE} pesanan diterima persentase tidak ditampilkan (sampel terlalu kecil); jumlah dan penyebutnya tetap tampil. Kosong bila belum ada pesanan diterima.`,
		average_order_value:
			"Estimasi. Nilai barang pada pesanan yang dibuat dalam periode (jumlah x harga beku per item, tanpa ongkir) dibagi jumlah pesanan yang sama; pesanan dibatalkan dan draf checkout tidak ikut. Pesanan COD yang belum diterima dan pesanan prabayar yang belum dibayar ikut dihitung, dan refund belum dikurangkan, jadi ini nilai pesanan yang dibuat, bukan pendapatan. Seluruh perusahaan, tanpa filter gudang.",
		cod_problems_open:
			"Kasus COD ditolak pembeli atau gagal diantar yang masih terbuka di antrean Kendala pengiriman, saat ini dan tanpa filter periode. Rasio COD gagal di kartu terpisah adalah angka periode.",
		oldest_unclaimed_chat_age:
			"Lama percakapan terbuka tertua yang menunggu balasan staf dan belum punya staf penanggung jawab, dihitung dari waktu percakapan dibuat. Percakapan yang menunggu balasan pembeli tidak dihitung. Saat ini, tanpa filter periode.",
	};

	const metrics = [];
	for (const key of allowedKeys) {
		if (countsOnly && skippedInCounts(key)) continue;
		const queueKey = METRIC_QUEUE_MAP[key];
		const isMoney = MONEY_METRICS.has(key);
		const tokenPayload = {
			v: 1,
			actor_id: principal.id,
			workspace,
			warehouse_hash: digest(JSON.stringify(warehouseIds)),
			requested_warehouse_id: requestedWarehouseId,
			from,
			to,
			as_of: asOf,
			metric_key: key,
			queue_key: queueKey,
			exp: filterExpiresAt,
		};
		const queueFilterToken = await signTokenPayload(identity, tokenPayload);
		const common = {
			key,
			queue_key: queueKey,
			definition: definitions[key],
			as_of: asOf,
			action_href: METRIC_ACTION_HREF[key] ?? null,
			queue_filter_token: queueFilterToken,
			filter_version: 1,
			filter_expires_at: filterExpiresAt,
			// Filled below where the metric has them; null is "not part of this metric", never zero.
			denominator: null as number | null,
			rate: null as number | null,
			low_sample: false as boolean,
			age_seconds: null as number | null,
			stale_count: null as number | null,
		};

		// Previous-period comparison: only for event-period metrics whose past value is stable
		// (COMPARABLE_METRICS); snapshot metrics and open backlogs never carry one.
		const compareWith = async (
			current: { value: number | null; complete: boolean },
		): Promise<Comparison | null> => {
			if (!previous || !COMPARABLE_METRICS.has(key)) return null;
			const before = await valueIn(key, previous, previousMoney);
			return computeComparison(
				key === "cod_failed_rate" || key === "return_rate" ? "points" : "percent",
				current.value,
				before.value,
				{ current: current.complete, previous: before.complete },
			);
		};

		if (key === "average_order_value") {
			const a = await averageOrder({ from, to });
			metrics.push({
				...common,
				count: null,
				basis: "event_period" as const,
				complete: true,
				kind: "money" as const,
				amount: a.average,
				currency: "IDR" as const,
				financial_basis: "estimated" as const,
				breakdown: null,
				denominator: a.orders,
				comparison: await compareWith({ value: a.average, complete: true }),
			});
		} else if (!isMoney) {
			const counted = await countFor(key);
			const isRate = key === "cod_failed_rate" || key === "return_rate";
			const rate = isRate
				? rateOf(counted.count, counted.denominator ?? 0, key === "return_rate" ? MIN_RATE_SAMPLE : 1)
				: null;
			metrics.push({
				...common,
				count: counted.count,
				basis: SNAPSHOT_METRICS.has(key)
					? ("snapshot" as const)
					: ("event_period" as const),
				complete: true,
				kind: isRate
					? ("rate" as const)
					: key === "oldest_unclaimed_chat_age"
						? ("duration" as const)
						: ("count" as const),
				amount: null,
				currency: null,
				financial_basis: "not_applicable" as const,
				breakdown: counted.breakdown,
				denominator: counted.denominator ?? null,
				rate,
				low_sample: counted.low_sample ?? false,
				age_seconds: counted.age_seconds ?? null,
				stale_count: counted.stale_count ?? null,
				comparison: await compareWith({
					value: isRate ? rate : counted.count,
					complete: true,
				}),
			});
		} else {
			const m = moneyValues?.[key as keyof NonNullable<typeof moneyValues>];
			const complete = m?.complete ?? false;
			metrics.push({
				...common,
				count: null,
				basis:
					key === "cod_receivable"
						? ("snapshot" as const)
						: ("event_period" as const),
				complete,
				kind: "money" as const,
				amount: complete ? (m?.amount ?? 0) : null,
				currency: "IDR" as const,
				financial_basis: m?.financial_basis ?? "unknown",
				breakdown: null,
				comparison: await compareWith({
					value: complete ? (m?.amount ?? 0) : null,
					complete,
				}),
			});
		}
	}

	// Chart data (DEC-027 (6)): the owner home trend and the finance COD ageing. Both come from the
	// same sources as the cards (economic_receipt, refund allocations, the cod_receivable fragment),
	// so each chart's total equals its card.
	const asOfMs = Date.parse(asOf);
	const buckets = seriesBuckets(Date.parse(from), Math.min(Date.parse(to), asOfMs));
	const seriesFor = async (shiftMs: number) => {
		const startSec = (buckets.starts[0] ?? 0) / 1000 - shiftMs / 1000;
		const stepSec = buckets.stepMs / 1000;
		const lo = new Date(Date.parse(from) - shiftMs).toISOString();
		const hi = new Date(Date.parse(to) - shiftMs).toISOString();
		const idx = (col: ReturnType<typeof ordersSource>) =>
			sql`floor((extract(epoch from ${col}) - ${startSec}::double precision) / ${stepSec}::double precision)::int`;
		const rows = await sql<{ i: number; revenue: string; orders: number }[]>`
      select i, sum(revenue)::text as revenue, sum(orders)::int as orders from (
        select ${idx(sql`er.occurred_at`)} as i, er.merchandise_amount as revenue, 0 as orders
        from app.economic_receipt er
        where er.occurred_at >= ${lo}::timestamptz and er.occurred_at <= ${hi}::timestamptz
        union all
        select ${idx(sql`r.created_at`)}, -ra.merchandise_amount, 0
        from app.refund_allocation ra join app.refund r on r.id = ra.refund_id
        where r.status = 'completed' and r.created_at >= ${lo}::timestamptz and r.created_at <= ${hi}::timestamptz
        union all
        select ${idx(sql`rr.created_at`)}, -rra.merchandise_amount, 0
        from app.recovery_refund_allocation rra join app.recovery_refund rr on rr.id = rra.refund_id
        where rr.status = 'completed' and rr.created_at >= ${lo}::timestamptz and rr.created_at <= ${hi}::timestamptz
        union all
        select ${idx(sql`o.created_at`)}, 0, 1
        ${ordersSource(sql, [], lo, hi, "average_order_value", asOf)}
      ) x group by i`;
		const byIndex = new Map(rows.map((r) => [r.i, r]));
		return buckets.starts.map((start, i) => ({
			start: new Date(start).toISOString(),
			revenue: Number(byIndex.get(i)?.revenue ?? 0),
			orders: Number(byIndex.get(i)?.orders ?? 0),
		}));
	};
	const series =
		!countsOnly && workspace === "owner" && allowedKeys.includes("net_merchandise_revenue")
			? {
					bucket: buckets.unit,
					points: await seriesFor(0),
					previous: previous
						? await seriesFor(Date.parse(from) - Date.parse(previous.from))
						: null,
				}
			: null;
	// Owner sales overview (2026-11-14): gross merchandise of placed orders, the order mix by status, the best
	// sellers and the return reasons in the same period. Orders count as in average_order_value (not cancelled,
	// not draft); company-wide like the money cards. Names come from the frozen order snapshot.
	const sales =
		!countsOnly && workspace === "owner" && allowedKeys.includes("average_order_value")
			? await (async () => {
					const [totals] = await sql<{ orders: number; units: number; gross: string; shipping: string; discount: string }[]>`
            select count(distinct o.id)::int as orders,
                   coalesce(sum(i.quantity), 0)::int as units,
                   coalesce(sum(i.quantity * i.unit_price), 0)::text as gross,
                   (select coalesce(sum(x.shipping_amount), 0) from app.commerce_order x
                     where x.created_at >= ${from}::timestamptz and x.created_at <= ${to}::timestamptz
                       and x.status not in ('preparing', 'cancelled'))::text as shipping,
                   (select coalesce(sum(x.merchandise_discount), 0) from app.commerce_order x
                     where x.created_at >= ${from}::timestamptz and x.created_at <= ${to}::timestamptz
                       and x.status not in ('preparing', 'cancelled'))::text as discount
            from app.commerce_order o join app.order_item i on i.order_id = o.id
            where o.created_at >= ${from}::timestamptz and o.created_at <= ${to}::timestamptz
              and o.status not in ('preparing', 'cancelled')`;
					const byStatus = await sql<{ key: string; count: number }[]>`
            select o.status as key, count(*)::int as count from app.commerce_order o
            where o.created_at >= ${from}::timestamptz and o.created_at <= ${to}::timestamptz and o.status <> 'preparing'
            group by 1 order by 2 desc`;
					const byPayment = await sql<{ key: string; count: number }[]>`
            select o.payment_status as key, count(*)::int as count from app.commerce_order o
            where o.created_at >= ${from}::timestamptz and o.created_at <= ${to}::timestamptz and o.status <> 'preparing'
            group by 1 order by 2 desc`;
					const top = await sql<{ admin_no: number | null; name: string; units: number; amount: string }[]>`
            select p.admin_no, max(i.snapshot->>'name') as name, sum(i.quantity)::int as units,
                   sum(i.quantity * i.unit_price)::text as amount
            from app.order_item i join app.commerce_order o on o.id = i.order_id join app.product p on p.id = i.product_id
            where o.created_at >= ${from}::timestamptz and o.created_at <= ${to}::timestamptz
              and o.status not in ('preparing', 'cancelled')
            group by p.id, p.admin_no order by sum(i.quantity * i.unit_price) desc, p.admin_no limit 5`;
					const reasons = await sql<{ key: string; count: number }[]>`
            select ri.reason as key, count(*)::int as count
            from app.return_item ri join app.return_case rc on rc.id = ri.case_id
            where rc.created_at >= ${from}::timestamptz and rc.created_at <= ${to}::timestamptz
            group by 1 order by 2 desc`;
					return {
						orders: totals.orders,
						units: totals.units,
						gross_merchandise: Number(totals.gross),
						shipping: Number(totals.shipping),
						discount: Number(totals.discount),
						by_status: byStatus,
						by_payment_status: byPayment,
						top_products: top.map((t) => ({ admin_no: t.admin_no, name: t.name, units: t.units, amount: Number(t.amount) })),
						return_reasons: reasons,
					};
				})()
			: null;
	const codAgeing =
		!countsOnly && workspace === "finance" && allowedKeys.includes("cod_receivable")
			? await (async () => {
					const rows = await sql<{ age_days: number; amount: string; parcels: number }[]>`
            select greatest(0, floor(extract(epoch from (${asOf}::timestamptz - f.handover_at)) / 86400))::int as age_days,
                   sum(s.cod_due)::text as amount, count(*)::int as parcels
            ${codReceivableSource(sql)}
            group by 1`;
					const bucketsOut = bucketCodAgeing(
						rows.map((r) => ({
							age_days: r.age_days,
							amount: Number(r.amount),
							parcels: r.parcels,
						})),
					);
					return {
						// The bucket edges are a display choice; no rule or deadline reads them.
						edges_are_display_choice: true as const,
						buckets: bucketsOut,
						total: bucketsOut.reduce((n, b) => n + b.amount, 0),
					};
				})()
			: null;

	return {
		workspace,
		warehouse_ids: warehouseIds,
		from,
		to,
		timezone: "Asia/Jakarta",
		as_of: asOf,
		// Set only with compare=previous: the equal-length period the deltas are measured against.
		comparison_period: previous,
		series,
		cod_ageing: codAgeing,
		sales,
		metrics,
	};
}
