"use client";

import { cn } from "cn";
import { ArrowDownRight, ArrowUpRight, ChevronRight, CircleAlert, ListFilter, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

// S113: the one KPI card of the console. Every card opens its drilldown queue (the exact rows
// behind the number, same SQL fragment) and, when the principal can open it, the screen where
// staff act on it. Count and money cards differ only in value size and the basis badge.
// Tone ranks the grid: "attention" (a non-zero queue someone must work: amber border, icon and
// amber label; no edge stripe or tinted fill),
// "idle" (zero: muted), "neutral" (informational). Descriptions clamp to two lines (the full text
// lives in the page's "Arti setiap angka" disclosure) and hide below md, so the links align.
// Phones (admin mobile pass): the whole card is the drilldown target (a chevron marks it) and
// only the action link takes its own line, so the grid stays short.

export function KpiCard({
	metricKey,
	label,
	value,
	unit,
	badge,
	description,
	breakdown,
	active,
	money = false,
	muted = false,
	tone = "neutral",
	reserveAction = false,
	drilldownLabel,
	onDrilldown,
	action,
}: {
	metricKey: string;
	label: string;
	value: ReactNode;
	unit?: string;
	badge?: ReactNode;
	description?: ReactNode;
	breakdown?: string | null;
	active: boolean;
	money?: boolean;
	/** Value not complete: shown in the warning tone instead of a number. */
	muted?: boolean;
	tone?: "attention" | "neutral" | "idle";
	/** Keep the action line's height when this card has none, so drilldown links align in a row. */
	reserveAction?: boolean;
	drilldownLabel: string;
	onDrilldown: () => void;
	action?: { href: string; label: string } | null;
}) {
	return (
		<li
			data-testid={`kpi-card-${metricKey}`}
			data-tone={tone}
			className={cn(
				"relative flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4",
				tone === "attention" && "border-warning/50",
				// Below md a zero queue is listed in one line under the grid instead (phone = task subset).
				tone === "idle" && "bg-muted/40 max-md:hidden",
				active && "border-primary ring-1 ring-primary",
			)}
		>
			<div className="flex flex-wrap items-start justify-between gap-2 max-md:flex-nowrap">
				<h3
					className={cn(
						"flex items-center gap-1 text-xs font-medium",
						tone === "attention" ? "text-warning" : "text-muted-foreground",
					)}
				>
					{tone === "attention" && <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />}
					{label}
				</h3>
				{badge}
				<ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground md:hidden" />
			</div>
			<p
				data-testid={`kpi-value-${metricKey}`}
				className={cn(
					"font-semibold tabular-nums break-words",
					money ? "text-xl whitespace-nowrap md:text-2xl" : "text-xl",
					tone === "idle" && "text-muted-foreground",
					muted && "text-base text-warning",
				)}
			>
				{value}
				{unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
			</p>
			{description && (
				<p className="hidden text-xs leading-relaxed text-muted-foreground md:line-clamp-2">
					{description}
				</p>
			)}
			{breakdown && (
				<p
					data-testid={`kpi-breakdown-${metricKey}`}
					className="line-clamp-2 text-xs text-muted-foreground tabular-nums"
				>
					{breakdown}
				</p>
			)}
			<div className="mt-auto flex flex-col items-start md:pt-1">
				<Button
					type="button"
					variant="link"
					size="sm"
					data-testid={`kpi-drilldown-${metricKey}`}
					aria-pressed={active}
					className="h-auto min-h-8 justify-start px-0 text-left whitespace-normal pointer-coarse:min-h-11 has-data-[icon=inline-start]:pl-0 max-md:absolute max-md:inset-0 max-md:min-h-0 max-md:rounded-lg pointer-coarse:max-md:min-h-0"
					onClick={onDrilldown}
				>
					<ListFilter data-icon="inline-start" aria-hidden="true" className="max-md:hidden" />
					<span className="max-md:sr-only">{drilldownLabel}</span>
					<span className="sr-only">: {label}</span>
				</Button>
				{action && (
					<Link
						href={action.href}
						data-testid={`kpi-action-${metricKey}`}
						className="relative z-10 inline-flex min-h-8 items-center text-sm pointer-coarse:min-h-11 font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
					>
						{action.label}
					</Link>
				)}
				{!action && reserveAction && <span aria-hidden="true" className="min-h-8 pointer-coarse:min-h-11 max-md:hidden" />}
			</div>
		</li>
	);
}

export function KpiGrid({
	children,
	testId,
	money = false,
	className,
}: {
	children: ReactNode;
	testId?: string;
	className?: string;
	/** Rupiah values need wider cards from md (they never wrap mid-number). */
	money?: boolean;
}) {
	return (
		<ul
			data-testid={testId}
			className={cn(
				"grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-2",
				money && "md:grid-cols-[repeat(auto-fill,minmax(min(100%,12.5rem),1fr))]",
				className,
			)}
		>
			{children}
		</ul>
	);
}

// S-V1 port of tokophi `dashboard/kpi-tile.tsx` (S-H1 builds the money strip on it).
// Rhythm, multiples of 4: 20px card padding, 12px between groups (header / figure / footnote), 8px
// to a graphic that restates the figure, 4px inside a group (figure and caption). Hierarchy: value
// 24/700/tabular, label 12/500 muted, caption 12/400 muted at 75%.

/** `null >= 0` is true in JavaScript: no delta is "nothing to compare", never a rise. */
export function deltaUp(delta: number | null): boolean | null {
	return delta === null ? null : delta >= 0;
}

const PILL_TONE = {
	neutral: "bg-muted text-muted-foreground",
	good: "bg-success-surface text-success",
	warning: "bg-warning-surface text-warning",
	bad: "bg-error-surface text-error",
} as const;
export type PillTone = keyof typeof PILL_TONE;

/** A small rounded verdict pill; every caller pairs the tone with a glyph and a word (WCAG 1.4.1). */
export const pillClass = (tone: PillTone) =>
	cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", PILL_TONE[tone]);

const percent = new Intl.NumberFormat("id-ID", {
	style: "percent",
	maximumFractionDigits: 1,
	signDisplay: "exceptZero",
});

/**
 * Signed change against the previous period ("+6,4%", "-6,4%"); `delta` is a fraction (0.064).
 * `null` means no previous period: a neutral dash, no arrow and no green.
 */
export function DeltaBadge({ delta }: { delta: number | null }) {
	const up = deltaUp(delta);
	return (
		<span className={cn(pillClass(up === null ? "neutral" : up ? "good" : "bad"), "tabular-nums")}>
			{up === null ? null : up ? (
				<ArrowUpRight aria-hidden="true" className="size-3" />
			) : (
				<ArrowDownRight aria-hidden="true" className="size-3" />
			)}
			{delta === null ? "—" : percent.format(delta)}
			<span className="sr-only">{up === null ? " tidak ada pembanding" : up ? " naik" : " turun"}</span>
		</span>
	);
}

export function KpiTile({
	icon: Icon,
	label,
	badge,
	value,
	caption,
	aside,
	href,
	testId,
	children,
}: {
	icon: LucideIcon;
	label: string;
	/** Right of the header: `<DeltaBadge>` or a worded pill built on `pillClass`. */
	badge?: ReactNode;
	/** Money that is not complete passes "Belum lengkap", never Rp 0. */
	value: ReactNode;
	/** What the figure is measured against. */
	caption?: ReactNode;
	/** Right of the figure, baseline-aligned (a sparkline). */
	aside?: ReactNode;
	/** The list behind the number; the whole tile becomes the link. */
	href?: string;
	testId?: string;
	/** Below the figure group (a bar restating the figure, a footnote). */
	children?: ReactNode;
}) {
	const body = (
		<>
			<div className="flex items-center justify-between gap-2">
				<span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
					<Icon aria-hidden="true" className="size-3.5 shrink-0" />
					<span className="truncate">{label}</span>
				</span>
				{badge}
			</div>
			<div className="mt-3 flex items-end justify-between gap-3">
				<div className="min-w-0">
					<div className="text-2xl leading-none font-bold tracking-tight tabular-nums">{value}</div>
					{caption ? <div className="mt-1 text-xs text-muted-foreground/75">{caption}</div> : null}
				</div>
				{aside}
			</div>
			{children}
		</>
	);
	const frame = "flex flex-col rounded-lg border bg-card p-5";
	return href ? (
		<Link
			href={href}
			data-testid={testId}
			className={cn(frame, "outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring")}
		>
			{body}
		</Link>
	) : (
		<div data-testid={testId} className={frame}>
			{body}
		</div>
	);
}
