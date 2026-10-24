"use client";

import { cn } from "cn";
import { CircleAlert, ListFilter } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

// S113: the one KPI card of the console. Every card opens its drilldown queue (the exact rows
// behind the number, same SQL fragment) and, when the principal can open it, the screen where
// staff act on it. Count and money cards differ only in value size and the basis badge.
// Tone ranks the grid: "attention" (a non-zero queue someone must work: warning edge + icon),
// "idle" (zero: muted), "neutral" (informational). Descriptions clamp to two lines (the full text
// lives in the page's "Arti setiap angka" disclosure) and hide below md, so the links align.

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
				"flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-3",
				tone === "attention" && "border-l-4 border-l-warning bg-warning-surface",
				// Below md a zero queue is listed in one line under the grid instead (phone = task subset).
				tone === "idle" && "bg-muted/40 max-md:hidden",
				active && "border-primary ring-1 ring-primary",
			)}
		>
			<div className="flex flex-wrap items-start justify-between gap-2">
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
			<div className="mt-auto flex flex-col items-start pt-1">
				<Button
					type="button"
					variant="link"
					size="sm"
					data-testid={`kpi-drilldown-${metricKey}`}
					aria-pressed={active}
					className="h-auto min-h-8 justify-start px-0 text-left whitespace-normal pointer-coarse:min-h-11"
					onClick={onDrilldown}
				>
					<ListFilter data-icon="inline-start" aria-hidden="true" />
					{drilldownLabel}
					<span className="sr-only">: {label}</span>
				</Button>
				{action && (
					<Link
						href={action.href}
						data-testid={`kpi-action-${metricKey}`}
						className="inline-flex min-h-8 items-center text-sm pointer-coarse:min-h-11 font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
					>
						{action.label}
					</Link>
				)}
				{!action && reserveAction && <span aria-hidden="true" className="min-h-8 pointer-coarse:min-h-11" />}
			</div>
		</li>
	);
}

export function KpiGrid({
	children,
	testId,
	money = false,
}: {
	children: ReactNode;
	testId?: string;
	/** Rupiah values need wider cards from md (they never wrap mid-number). */
	money?: boolean;
}) {
	return (
		<ul
			data-testid={testId}
			className={cn(
				"grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-2",
				money && "md:grid-cols-[repeat(auto-fill,minmax(min(100%,12.5rem),1fr))]",
			)}
		>
			{children}
		</ul>
	);
}
