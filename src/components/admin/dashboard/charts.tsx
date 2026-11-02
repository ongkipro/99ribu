"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { rupiah } from "@/modules/storefront/format";
import type { CodAgeingData, DashboardSeries, SeriesPoint } from "./types";

// S153 charts (DEC-027 (6)): plain inline SVG, no chart library, no animation, one series per panel,
// purple for the data and neutral for the comparison (dashed). Every chart is followed by a closed
// <details> with the same numbers as a real table. Colours are tokens (Tailwind classes), never hex.
// This module is loaded lazily with next/dynamic from the dashboard.

const compact = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });
const wibDay = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short" });
const wibHour = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const rp = (n: number) => `Rp${compact.format(n)}`;

/** Width of the element in CSS pixels, so text stays at its real size at every breakpoint. */
function useWidth(fallback = 320) {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(fallback);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		const update = () => setWidth(Math.max(240, Math.floor(el.clientWidth)));
		update();
		const observer = new ResizeObserver(update);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	return { ref, width };
}

function ChartFrame({
	title,
	caption,
	children,
	table,
	testId,
}: {
	title: string;
	caption?: ReactNode;
	children: ReactNode;
	table: ReactNode;
	testId: string;
}) {
	return (
		<figure data-testid={testId} className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4">
			<figcaption className="flex flex-col gap-0.5">
				<span className="text-sm font-semibold">{title}</span>
				{caption && <span className="text-xs text-muted-foreground">{caption}</span>}
			</figcaption>
			{children}
			<details className="text-xs text-muted-foreground">
				<summary className="flex min-h-8 cursor-pointer items-center font-medium select-none pointer-coarse:min-h-11">
					Lihat sebagai tabel
				</summary>
				<div className="mt-1 max-h-72 overflow-auto rounded-md border">{table}</div>
			</details>
		</figure>
	);
}

const th = "px-3 py-2 text-left font-medium text-muted-foreground";
const thNum = "px-3 py-2 text-right font-medium text-muted-foreground";
const td = "px-3 py-1.5 text-foreground";
const tdNum = "px-3 py-1.5 text-right tabular-nums text-foreground";

function label(start: string, bucket: "hour" | "day") {
	const d = new Date(start);
	return bucket === "hour" ? wibHour.format(d) : wibDay.format(d);
}

/** One panel: a series as a line (revenue) or bars (orders) with the previous period as a dashed neutral line. */
function SeriesPanel({
	points,
	previous,
	bucket,
	pick,
	kind,
	format,
	axisLabel,
	width,
}: {
	points: SeriesPoint[];
	previous: SeriesPoint[] | null;
	bucket: "hour" | "day";
	pick: (p: SeriesPoint) => number;
	kind: "line" | "bars";
	format: (n: number) => string;
	axisLabel: string;
	width: number;
}) {
	const height = 120;
	const pad = { l: 44, r: 8, t: 8, b: 20 };
	const values = points.map(pick);
	const before = previous?.map(pick) ?? [];
	const max = Math.max(1, ...values, ...before);
	const min = Math.min(0, ...values, ...before);
	const innerW = width - pad.l - pad.r;
	const innerH = height - pad.t - pad.b;
	const n = Math.max(1, points.length);
	const x = (i: number) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
	const y = (v: number) => pad.t + innerH - ((v - min) / (max - min)) * innerH;
	const slot = innerW / n;
	const barW = Math.max(2, Math.min(24, slot * 0.6));
	const line = (vs: number[]) => vs.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
	const ticks = [min, (min + max) / 2, max];
	const xLabels = n <= 2 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];
	return (
		<svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={axisLabel} className="max-w-full">
			{ticks.map((t) => (
				<g key={t}>
					<line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
					<text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-muted-foreground text-xs">
						{format(t)}
					</text>
				</g>
			))}
			{kind === "bars" &&
				values.map((v, i) => (
					<rect
						// biome-ignore lint/suspicious/noArrayIndexKey: buckets are positional and never reorder
						key={i}
						x={pad.l + slot * i + (slot - barW) / 2}
						y={Math.min(y(v), y(0))}
						width={barW}
						height={Math.max(1, Math.abs(y(v) - y(0)))}
						className="fill-primary"
					/>
				))}
			{previous && (
				<path d={line(before)} fill="none" strokeWidth={2} strokeDasharray="4 3" className="stroke-muted-foreground" />
			)}
			{kind === "line" && <path d={line(values)} fill="none" strokeWidth={2} className="stroke-primary" />}
			{kind === "line" && n === 1 && <circle cx={x(0)} cy={y(values[0])} r={3} className="fill-primary" />}
			{xLabels.map((i) => (
				<text
					key={i}
					x={x(i)}
					y={height - 4}
					textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
					className="fill-muted-foreground text-xs"
				>
					{label(points[i].start, bucket)}
				</text>
			))}
		</svg>
	);
}

function Legend({ compare }: { compare: boolean }) {
	return (
		<ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
			<li className="flex items-center gap-1.5">
				<svg width="18" height="6" aria-hidden="true">
					<line x1="0" x2="18" y1="3" y2="3" strokeWidth={2} className="stroke-primary" />
				</svg>
				Periode ini
			</li>
			{compare && (
				<li className="flex items-center gap-1.5">
					<svg width="18" height="6" aria-hidden="true">
						<line x1="0" x2="18" y1="3" y2="3" strokeWidth={2} strokeDasharray="4 3" className="stroke-muted-foreground" />
					</svg>
					Periode sebelumnya
				</li>
			)}
		</ul>
	);
}

/** (a) Owner home: net merchandise revenue and orders per day (per hour up to two days). */
export function RevenueTrendChart({ series }: { series: DashboardSeries }) {
	const { ref, width } = useWidth();
	const { points, previous, bucket } = series;
	const unit = bucket === "hour" ? "jam" : "hari";
	return (
		<ChartFrame
			testId="chart-revenue-trend"
			title="Pendapatan bersih dan pesanan"
			caption={`Per ${unit}, waktu WIB. Pendapatan bersih barang = penerimaan terverifikasi dikurangi refund selesai.`}
			table={
				<table className="w-full text-xs">
					<caption className="sr-only">Pendapatan bersih dan pesanan per {unit}</caption>
					<thead>
						<tr className="border-b">
							<th scope="col" className={th}>{bucket === "hour" ? "Jam" : "Tanggal"}</th>
							<th scope="col" className={thNum}>Pendapatan bersih</th>
							<th scope="col" className={thNum}>Pesanan</th>
							{previous && <th scope="col" className={thNum}>Pendapatan sebelumnya</th>}
							{previous && <th scope="col" className={thNum}>Pesanan sebelumnya</th>}
						</tr>
					</thead>
					<tbody>
						{points.map((p, i) => (
							<tr key={p.start} className="border-b last:border-b-0">
								<th scope="row" className={`${td} text-left font-normal`}>{label(p.start, bucket)}</th>
								<td className={tdNum}>{rupiah(p.revenue)}</td>
								<td className={tdNum}>{p.orders}</td>
								{previous && <td className={tdNum}>{rupiah(previous[i]?.revenue ?? 0)}</td>}
								{previous && <td className={tdNum}>{previous[i]?.orders ?? 0}</td>}
							</tr>
						))}
					</tbody>
				</table>
			}
		>
			<Legend compare={previous !== null} />
			<div ref={ref} className="flex min-w-0 flex-col gap-1">
				<p className="text-xs font-medium">Pendapatan bersih</p>
				<SeriesPanel points={points} previous={previous} bucket={bucket} pick={(p) => p.revenue} kind="line" format={rp} width={width} axisLabel={`Grafik garis pendapatan bersih per ${unit}; tabel tersedia di bawah`} />
				<p className="mt-1 text-xs font-medium">Pesanan</p>
				<SeriesPanel points={points} previous={previous} bucket={bucket} pick={(p) => p.orders} kind="bars" format={(n) => compact.format(n)} width={width} axisLabel={`Grafik batang jumlah pesanan per ${unit}; tabel tersedia di bawah`} />
			</div>
		</ChartFrame>
	);
}

/** (b) Finance lens: COD receivable ageing. */
export function CodAgeingChart({ ageing }: { ageing: CodAgeingData }) {
	const { ref, width } = useWidth();
	const max = Math.max(1, ...ageing.buckets.map((b) => b.amount));
	const rowH = 28;
	const labelW = 76;
	const barArea = Math.max(80, width - labelW - 96);
	return (
		<ChartFrame
			testId="chart-cod-ageing"
			title="Umur piutang COD"
			caption="Hari sejak paket diserahkan ke kurir. Batas kelompok hari adalah pilihan tampilan, bukan aturan atau tenggat."
			table={
				<table className="w-full text-xs">
					<caption className="sr-only">Piutang COD menurut umur</caption>
					<thead>
						<tr className="border-b">
							<th scope="col" className={th}>Umur</th>
							<th scope="col" className={thNum}>Paket</th>
							<th scope="col" className={thNum}>Piutang COD</th>
						</tr>
					</thead>
					<tbody>
						{ageing.buckets.map((b) => (
							<tr key={b.label} className="border-b">
								<th scope="row" className={`${td} text-left font-normal`}>{b.label}</th>
								<td className={tdNum}>{b.parcels}</td>
								<td className={tdNum}>{rupiah(b.amount)}</td>
							</tr>
						))}
						<tr>
							<th scope="row" className={`${td} text-left`}>Total</th>
							<td className={tdNum}>{ageing.buckets.reduce((n, b) => n + b.parcels, 0)}</td>
							<td className={`${tdNum} font-semibold`}>{rupiah(ageing.total)}</td>
						</tr>
					</tbody>
				</table>
			}
		>
			<div ref={ref} className="min-w-0">
				<svg width={width} height={ageing.buckets.length * rowH} viewBox={`0 0 ${width} ${ageing.buckets.length * rowH}`} role="img" aria-label="Grafik batang piutang COD menurut umur; tabel tersedia di bawah" className="max-w-full">
					{ageing.buckets.map((b, i) => (
						<g key={b.label}>
							<text x={0} y={i * rowH + 17} className="fill-muted-foreground text-xs">{b.label}</text>
							<rect x={labelW} y={i * rowH + 5} width={Math.max(b.amount > 0 ? 2 : 0, (b.amount / max) * barArea)} height={18} className="fill-primary" />
							<text x={labelW + (b.amount / max) * barArea + 6} y={i * rowH + 18} className="fill-foreground text-xs">{rp(b.amount)}</text>
						</g>
					))}
				</svg>
			</div>
		</ChartFrame>
	);
}

/** (c) Orders by payment method, from the card's own breakdown. */
export function PaymentMethodChart({ breakdown }: { breakdown: { key: string; label: string; count: number }[] }) {
	const { ref, width } = useWidth();
	const max = Math.max(1, ...breakdown.map((b) => b.count));
	const total = breakdown.reduce((n, b) => n + b.count, 0);
	const rowH = 28;
	const labelW = 120;
	const barArea = Math.max(60, width - labelW - 48);
	return (
		<ChartFrame
			testId="chart-payment-method"
			title="Pesanan per metode bayar"
			caption="Pesanan yang dibuat dalam periode, semua status kecuali draf checkout."
			table={
				<table className="w-full text-xs">
					<caption className="sr-only">Pesanan per metode bayar</caption>
					<thead>
						<tr className="border-b">
							<th scope="col" className={th}>Metode</th>
							<th scope="col" className={thNum}>Pesanan</th>
						</tr>
					</thead>
					<tbody>
						{breakdown.map((b) => (
							<tr key={b.key} className="border-b last:border-b-0">
								<th scope="row" className={`${td} text-left font-normal`}>{b.label}</th>
								<td className={tdNum}>{b.count}</td>
							</tr>
						))}
					</tbody>
				</table>
			}
		>
			<div ref={ref} className="min-w-0">
				<svg width={width} height={breakdown.length * rowH} viewBox={`0 0 ${width} ${breakdown.length * rowH}`} role="img" aria-label={`Grafik batang pesanan per metode bayar, total ${total}; tabel tersedia di bawah`} className="max-w-full">
					{breakdown.map((b, i) => (
						<g key={b.key}>
							<text x={0} y={i * rowH + 17} className="fill-muted-foreground text-xs">{b.label}</text>
							<rect x={labelW} y={i * rowH + 5} width={Math.max(b.count > 0 ? 2 : 0, (b.count / max) * barArea)} height={18} className="fill-primary" />
							<text x={labelW + (b.count / max) * barArea + 6} y={i * rowH + 18} className="fill-foreground text-xs tabular-nums">{b.count}</text>
						</g>
					))}
				</svg>
			</div>
		</ChartFrame>
	);
}
