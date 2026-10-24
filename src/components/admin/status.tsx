"use client";

import { AlarmClock, CircleAlert, CircleCheck, CircleMinus, CircleX, Clock, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

// S113: one status badge (icon + text, never wraps), one order-number link and one overdue flag
// for every console screen. Tone, not colour alone, carries the meaning (icon and wording too).

export type StatusTone = "open" | "problem" | "done" | "closed" | "success" | "danger";
const TONE: Record<StatusTone, { icon: LucideIcon; variant: "secondary" | "warning" | "outline" | "success" | "destructive" }> = {
	open: { icon: Clock, variant: "secondary" },
	problem: { icon: CircleAlert, variant: "warning" },
	done: { icon: CircleCheck, variant: "outline" },
	/** Terminal without success (cancelled, rejected). */
	closed: { icon: CircleMinus, variant: "outline" },
	success: { icon: CircleCheck, variant: "success" },
	danger: { icon: CircleX, variant: "destructive" },
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
		<Badge variant={variant} data-testid={testId} className="whitespace-nowrap" {...rest}>
			<Icon aria-hidden="true" />
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
 * The printed order number, linked to the staff order detail (by id) or to the order search by
 * number when only the number is known. Plain text without the orders grant; the page re-checks.
 */
export function OrderNumberLink({
	number,
	orderId,
	enabled,
	label,
}: {
	number: string;
	orderId?: string | null;
	enabled: boolean;
	/** Accessible name when the visible number needs context. */
	label?: string;
}) {
	if (!enabled) return <span className="font-mono font-medium break-all">{number}</span>;
	const href = orderId
		? `/admin/orders/${orderId}`
		: `/admin/orders?${new URLSearchParams({ jenis: "nomor", cari: number })}`;
	return (
		<Link
			href={href}
			aria-label={label}
			className="font-mono font-medium break-all text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
		>
			{number}
		</Link>
	);
}
