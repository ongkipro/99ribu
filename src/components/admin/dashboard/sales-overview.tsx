"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { rupiah } from "@/modules/storefront/format";
import type { Comparison } from "../../../modules/reporting/metric-math.ts";
import { ORDER_STATUS, PAYMENT_STATUS } from "../order-model";
import { REASON } from "../return-model";
import { DeltaChip } from "./delta-chip";
import { formatRate } from "./format";

// Owner overview (2026-11-14): what was sold in the period, first. One row of headline numbers (largest
// = value, then the change against the previous period when it is switched on), then the breakdowns as
// plain ranked lists with a proportional bar. Numbers come from the dashboard snapshot (`sales`, the
// average order value and net revenue cards), so every figure here equals a card or its drilldown.

export interface SalesBlock {
	orders: number;
	units: number;
	gross_merchandise: number;
	shipping: number;
	discount: number;
	by_status: { key: string; count: number }[];
	by_payment_status: { key: string; count: number }[];
	top_products: {
		admin_no: number | null;
		name: string;
		units: number;
		amount: number;
	}[];
	return_reasons: { key: string; count: number }[];
}

interface Headline {
	key: string;
	label: string;
	value: string;
	note?: string;
	comparison?: Comparison | null;
	lowerIsBetter?: boolean;
}

const count = new Intl.NumberFormat("id-ID");

export function SalesOverview({
	sales,
	periodLabel,
	headlines,
	children,
}: {
	sales: SalesBlock;
	periodLabel: string;
	headlines: Headline[];
	/** The trend chart, rendered between the headline row and the breakdowns. */
	children?: ReactNode;
}) {
	const statusTotal = sales.by_status.reduce((n, r) => n + r.count, 0);
	const returnTotal = sales.return_reasons.reduce((n, r) => n + r.count, 0);
	return (
		<section
			aria-labelledby="sales-heading"
			data-testid="sales-overview"
			className="flex flex-col gap-4"
		>
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<h2 id="sales-heading" className="text-base font-semibold">
					Penjualan
				</h2>
				<p className="text-xs text-muted-foreground">
					{periodLabel} · waktu WIB · pesanan dibatalkan tidak dihitung
				</p>
			</div>
			<dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border bg-border min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
				{headlines.map((h) => (
					<div
						key={h.key}
						data-testid={`sales-headline-${h.key}`}
						className="flex min-w-0 flex-col gap-1 bg-card p-4"
					>
						<dt className="truncate text-xs font-medium text-muted-foreground">
							{h.label}
						</dt>
						<dd className="text-xl leading-tight font-semibold tracking-tight break-words tabular-nums sm:text-2xl">
							{h.value}
						</dd>
						<dd className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
							{h.comparison ? (
								<DeltaChip
									metricKey={h.key}
									comparison={h.comparison}
									lowerIsBetter={h.lowerIsBetter}
								/>
							) : null}
							{h.note ? <span>{h.note}</span> : null}
						</dd>
					</div>
				))}
			</dl>
			{children}
			<div className="grid gap-4 lg:grid-cols-3">
				<RankedList
					testId="sales-by-status"
					title="Status pesanan"
					caption={`${count.format(statusTotal)} pesanan dibuat, termasuk yang dibatalkan`}
					rows={sales.by_status.map((r) => ({
						key: r.key,
						label: ORDER_STATUS[r.key] ?? r.key,
						value: r.count,
						display: count.format(r.count),
					}))}
					total={statusTotal}
					href="/admin/pesanan"
					hrefLabel="Buka Pesanan"
					extra={
						<ul className="flex flex-wrap gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
							{sales.by_payment_status.map((r) => (
								<li key={r.key}>
									{PAYMENT_STATUS[r.key] ?? r.key}{" "}
									<span className="font-medium text-foreground tabular-nums">
										{count.format(r.count)}
									</span>
								</li>
							))}
						</ul>
					}
				/>
				<RankedList
					testId="sales-top-products"
					title="Produk terlaris"
					caption="Nilai barang, lima teratas"
					rows={sales.top_products.map((t, i) => ({
						key: `${t.admin_no ?? i}`,
						label: t.name,
						href: t.admin_no ? `/admin/produk/${t.admin_no}` : undefined,
						value: t.amount,
						display: rupiah(t.amount),
						note: `${count.format(t.units)} terjual`,
					}))}
					total={sales.top_products[0]?.amount ?? 0}
					empty="Belum ada penjualan pada periode ini."
					href="/admin/produk"
					hrefLabel="Buka Produk"
				/>
				<RankedList
					testId="sales-return-reasons"
					title="Alasan retur"
					caption={`${count.format(returnTotal)} barang diajukan retur${sales.units ? ` · ${formatRate(returnTotal / sales.units)} dari barang terjual` : ""}`}
					rows={sales.return_reasons.map((r) => ({
						key: r.key,
						label: REASON[r.key] ?? r.key,
						value: r.count,
						display: count.format(r.count),
					}))}
					total={returnTotal}
					empty="Tidak ada retur pada periode ini."
					href="/admin/pesanan/retur"
					hrefLabel="Buka Retur"
				/>
			</div>
		</section>
	);
}

function RankedList({
	testId,
	title,
	caption,
	rows,
	total,
	empty = "Tidak ada data pada periode ini.",
	href,
	hrefLabel,
	extra,
}: {
	testId: string;
	title: string;
	caption: string;
	rows: {
		key: string;
		label: string;
		href?: string;
		value: number;
		display: string;
		note?: string;
	}[];
	total: number;
	empty?: string;
	href: string;
	hrefLabel: string;
	extra?: ReactNode;
}) {
	return (
		<figure
			data-testid={testId}
			className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4"
		>
			<figcaption className="flex items-start justify-between gap-3">
				<span className="flex min-w-0 flex-col gap-0.5">
					<span className="text-sm font-semibold">{title}</span>
					<span className="text-xs text-muted-foreground">{caption}</span>
				</span>
				<Link
					href={href}
					className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
				>
					{hrefLabel}
				</Link>
			</figcaption>
			{rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">{empty}</p>
			) : (
				<ol className="flex flex-col gap-2.5">
					{rows.map((r) => (
						<li key={r.key} className="flex flex-col gap-1">
							<div className="flex items-baseline justify-between gap-3 text-sm">
								{r.href ? (
									<Link
										href={r.href}
										className="min-w-0 truncate hover:underline"
									>
										{r.label}
									</Link>
								) : (
									<span className="min-w-0 truncate">{r.label}</span>
								)}
								<span className="shrink-0 font-medium tabular-nums">
									{r.display}
								</span>
							</div>
							<div className="flex items-center gap-2">
								<div
									className="h-1.5 flex-1 rounded-full bg-muted"
									aria-hidden="true"
								>
									<div
										className="h-full rounded-full bg-primary"
										style={{
											width: `${total > 0 ? Math.max(2, (r.value / total) * 100) : 0}%`,
										}}
									/>
								</div>
								{r.note ? (
									<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
										{r.note}
									</span>
								) : null}
							</div>
						</li>
					))}
				</ol>
			)}
			{extra}
		</figure>
	);
}
