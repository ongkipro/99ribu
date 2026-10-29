"use client";

import {
	AlarmClock,
	CircleCheck,
	CircleDotDashed,
	CircleMinus,
	CircleX,
	Clock,
	type LucideIcon,
	TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { adminPath } from "@/modules/access/admin-paths";
import { wibDateTime } from "@/modules/storefront/format";

// S113: one status badge (icon + text, never wraps), one order-number link and one overdue flag
// for every console screen. Tone, not colour alone, carries the meaning (icon and wording too).

/**
 * The console's six status kinds plus a plain label; each has its own icon or shape, its wording and
 * its colour (text >= 4.5:1 on its surface):
 * - open: pending or waiting (clock, neutral grey surface);
 * - progress: work under way (dashed circle, purple);
 * - done / success: finished well (check, green);
 * - problem: uncertain or needs a look, e.g. "Hasil belum pasti" (warning triangle, amber);
 * - danger: failed or retries exhausted (x circle, red);
 * - closed: terminal without success, e.g. cancelled or switched off (minus circle, outline);
 * - neutral: a plain label such as a role (no icon, outline).
 */
export type StatusTone = "open" | "progress" | "problem" | "done" | "closed" | "success" | "danger" | "neutral";
type BadgeVariant = "muted" | "secondary" | "warning" | "outline" | "success" | "destructive";
const TONE: Record<StatusTone, { icon: LucideIcon | null; variant: BadgeVariant }> = {
	open: { icon: Clock, variant: "muted" },
	progress: { icon: CircleDotDashed, variant: "secondary" },
	problem: { icon: TriangleAlert, variant: "warning" },
	done: { icon: CircleCheck, variant: "success" },
	closed: { icon: CircleMinus, variant: "outline" },
	success: { icon: CircleCheck, variant: "success" },
	danger: { icon: CircleX, variant: "destructive" },
	neutral: { icon: null, variant: "outline" },
};

export function StatusBadge({
	tone,
	children,
	testId,
	...rest
}: {
	tone: StatusTone;
	children: ReactNode;
	testId?: string;
	"data-status"?: string;
}) {
	const { icon: Icon, variant } = TONE[tone];
	return (
		<Badge variant={variant} data-testid={testId} data-tone={tone} className="whitespace-nowrap" {...rest}>
			{Icon && <Icon aria-hidden="true" />}
			{children}
		</Badge>
	);
}

/** Current time after mount (null during SSR/hydration so server and client markup agree). */
export function useNow(refreshMs = 60_000) {
	const [now, setNow] = useState<number | null>(null);
	useEffect(() => {
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), refreshMs);
		return () => clearInterval(timer);
	}, [refreshMs]);
	return now;
}

export const isOverdue = (deadline: string | null | undefined, now: number | null) =>
	!!deadline && now !== null && Date.parse(deadline) < now;

/** Past-due marker beside a deadline (transfers, packing/handover, print). */
export function OverdueBadge({ testId }: { testId?: string }) {
	return (
		<Badge variant="destructive" data-testid={testId} className="whitespace-nowrap">
			<AlarmClock aria-hidden="true" />
			Lewat batas
		</Badge>
	);
}

/**
 * A deadline as staff read it: the WIB time, then "Lewat batas" right after it on the same
 * wrapped line once it has passed (the one overdue placement of the console). `done` rows
 * (handed over, confirmed) never show the badge.
 */
export function Deadline({
	iso,
	done = false,
	prefix,
	testId,
	overdueTestId,
	className,
}: {
	/** e.g. right-aligned in a stacked row's labelled value */
	className?: string;
	iso: string;
	done?: boolean;
	/** e.g. "Batas" */
	prefix?: string;
	testId?: string;
	overdueTestId?: string;
}) {
	const now = useNow();
	return (
		<span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 tabular-nums", className)}>
			<span data-testid={testId}>
				{prefix && `${prefix} `}
				{wibDateTime(iso)}
			</span>
			{!done && isOverdue(iso, now) && <OverdueBadge testId={overdueTestId} />}
		</span>
	);
}

/** Deadline groups of a work list (manual fulfillment, print center), in their list order. */
export const DEADLINE_GROUPS = {
	overdue: "Lewat batas",
	today: "Hari ini",
	later: "Berikutnya",
	none: "Tanpa batas",
	done: "Sudah diserahkan",
} as const;
const wibDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" });
/** Group of a row by its deadline in WIB; null before mount (no clock yet, so no headers). */
export function deadlineGroup(
	deadline: string | null | undefined,
	now: number | null,
	done = false,
): keyof typeof DEADLINE_GROUPS | null {
	if (now === null) return null;
	if (done) return "done";
	if (!deadline) return "none";
	if (Date.parse(deadline) < now) return "overdue";
	return wibDay.format(new Date(deadline)) === wibDay.format(new Date(now)) ? "today" : "later";
}

/**
 * The printed order number, linked to the staff order detail (by admin number) or to the order search by
 * number when only the number is known. Plain text without the orders grant; the page re-checks.
 */
export function OrderNumberLink({
	number,
	adminNo,
	enabled,
	label,
}: {
	number: string;
	/** The order's `admin_no` from the read model; absent when the row carries none. */
	adminNo?: number | null;
	enabled: boolean;
	/** Accessible name when the visible number needs context. */
	label?: string;
}) {
	if (!enabled) return <span className="font-mono font-medium break-all">{number}</span>;
	const href =
		adminNo != null
			? adminPath("order", adminNo)
			: `/admin/pesanan?${new URLSearchParams({ jenis: "nomor", cari: number })}`;
	return (
		<Link
			href={href}
			aria-label={label}
			className="font-mono font-medium break-all text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
		>
			{number}
		</Link>
	);
}
