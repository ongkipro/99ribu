import type { LocalAuth } from "../access/auth.ts";
import { AccessError, getPrincipal } from "../access/policy.ts";
import { digest } from "../checkout/access.ts";
import {
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
	TRANSFER_DEADLINE_WARNING_HOURS,
	WORKSPACE_METRICS,
} from "./shared.ts";
import {
	automatedWarehouseIds,
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
    select coalesce(sum(s.cod_due), 0)::text as amount
    from app.order_shipment s
    join app.commerce_order o on o.id = s.order_id
    where o.payment_method = 'cod'
      and exists (select 1 from app.fulfillment f where f.shipment_id = s.id and f.handover_at is not null)
      and not exists (select 1 from app.economic_receipt r where r.shipment_id = s.id and r.kind = 'cod')
      and not exists (select 1 from app.cod_remittance_line l where l.shipment_id = s.id)
      and not exists (select 1 from app.local_cod_operation c where c.shipment_id = s.id and c.status in ('collected', 'refused'))
  `;

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
           oi.unit_price,
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
	]);
	for (const key of url.searchParams.keys()) {
		if (!allowedParams.has(key) || url.searchParams.getAll(key).length !== 1) {
			throw new AccessError(400, "INVALID_INPUT");
		}
	}

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
	const filterExpiresAt = new Date(
		Date.parse(asOf) + 30 * 60_000,
	).toISOString();

	const allowedKeys = WORKSPACE_METRICS[workspace];
	const sql = identity.sql;
	type Counted = {
		count: number;
		breakdown: { key: string; label: string; count: number }[] | null;
	};
	// Cards are SQL counts over the same fragments the drilldown pages list; rows are only
	// materialized for the drilldown.
	// S113: every count is a count over the exact fragment its drilldown lists (ordersSource,
	// fulfillmentsSource, lowStockPositions, or the queue rows themselves); no card restates a filter.
	const countOf = async (
		fragment: ReturnType<typeof ordersSource>,
	): Promise<number> =>
		Number((await sql<{ n: number }[]>`select count(*)::int as n ${fragment}`)[0].n);
	const countFor = async (key: MetricKey): Promise<Counted> => {
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
		if (key === "orders_pending" || PAYMENT_QUEUE_METRICS.has(key))
			return {
				count: await countOf(ordersSource(sql, warehouseIds, from, to, key, asOf)),
				breakdown: null,
			};
		if (key === "fulfillments_due" || key === "manual_booking_pending") {
			if (warehouseIds.length === 0) return { count: 0, breakdown: null };
			const ids =
				key === "manual_booking_pending"
					? await automatedWarehouseIds(identity)
					: [];
			return {
				count: await countOf(
					fulfillmentsSource(sql, warehouseIds, from, to, key, ids),
				),
				breakdown: null,
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
		const source =
			key === "delivery_exceptions"
				? exceptionsSource(sql, warehouseIds, from, to, key)
				: key === "returns_pending"
					? returnsSource(sql, warehouseIds, from, to, key)
					: key === "support_unassigned"
						? supportSource(sql, from, to, key)
						: key === "finance_unmatched"
							? reconciliationSource(sql, from, to, key)
							: null;
		if (!source) throw new Error(`count metric without a source fragment: ${key}`);
		return { count: await countOf(source), breakdown: null };
	};

	const needsMoney = allowedKeys.some((k) => MONEY_METRICS.has(k));
	const moneyValues = needsMoney
		? await computeMoneyMetrics(identity, from, to)
		: null;

	// Each text states exactly what its query counts (S103).
	const definitions: Record<MetricKey, string> = {
		orders_pending:
			"Pesanan yang dibuat dalam periode dan masih berstatus menunggu atau diproses. Pesanan dibatalkan atau selesai tidak dihitung.",
		orders_by_payment_method:
			"Pesanan yang dibuat dalam periode (semua status kecuali draf checkout), dirinci per metode bayar: COD, transfer manual, dan VA/QRIS AutoLaris.",
		fulfillments_due:
			"Paket gudang yang dibuat dalam periode dan belum diserahkan ke kurir, termasuk paket bermasalah.",
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
	};

	const metrics = [];
	for (const key of allowedKeys) {
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
		};

		if (!isMoney) {
			const counted = await countFor(key);
			metrics.push({
				...common,
				count: counted.count,
				basis: SNAPSHOT_METRICS.has(key)
					? ("snapshot" as const)
					: ("event_period" as const),
				complete: true,
				kind: "count" as const,
				amount: null,
				currency: null,
				financial_basis: "not_applicable" as const,
				breakdown: counted.breakdown,
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
			});
		}
	}

	return {
		workspace,
		warehouse_ids: warehouseIds,
		from,
		to,
		timezone: "Asia/Jakarta",
		as_of: asOf,
		metrics,
	};
}
