"use client";

import { cn } from "cn";
import { ListFilter } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

// S113: the one KPI card of the console. Every card opens its drilldown queue (the exact rows
// behind the number, same SQL fragment) and, when the principal can open it, the screen where
// staff act on it. Count and money cards differ only in value size and the basis badge.

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
	drilldownLabel: string;
	onDrilldown: () => void;
	action?: { href: string; label: string } | null;
}) {
	return (
		<li
			data-testid={`kpi-card-${metricKey}`}
			className={cn(
				"flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card p-3",
				active && "border-primary ring-1 ring-primary",
			)}
		>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
				{badge}
			</div>
			<p
				data-testid={`kpi-value-${metricKey}`}
				className={cn(
					"font-semibold tabular-nums break-words",
					money ? "text-2xl" : "text-xl",
					muted && "text-base text-warning",
				)}
			>
				{value}
				{unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
			</p>
			{description && (
				<p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
			)}
			{breakdown && (
				<p
					data-testid={`kpi-breakdown-${metricKey}`}
					className="text-xs text-muted-foreground tabular-nums"
				>
					{breakdown}
				</p>
			)}
			<div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
				<Button
					type="button"
					variant="link"
					size="sm"
					data-testid={`kpi-drilldown-${metricKey}`}
					aria-pressed={active}
					className="h-auto min-h-8 px-0"
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
						className="inline-flex min-h-8 items-center text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
					>
						{action.label}
					</Link>
				)}
			</div>
		</li>
	);
}

export function KpiGrid({ children, testId }: { children: ReactNode; testId?: string }) {
	return (
		<ul
			data-testid={testId}
			className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,11.5rem),1fr))] gap-2"
		>
			{children}
		</ul>
	);
}
