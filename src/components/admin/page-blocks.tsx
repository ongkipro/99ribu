import { cn } from "cn";
import { ArrowLeft, ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

// Admin mobile pass: the page-level blocks every console screen shares, so a phone sees one
// header, one detail section, one disclosure and one sticky action bar on every screen.
// Server-safe (no hooks): server pages and client screens both use them.

/** Page frame: phone gutters 16px, desktop 32px. */
export function AdminPage({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
	return (
		<div data-testid={testId} className={cn("flex flex-col gap-4 px-4 py-4 md:gap-6 md:px-8 md:py-6", className)}>
			{children}
		</div>
	);
}

/** The one page title block: optional back link, title, badges, description and actions. */
export function PageHeader({
	title,
	titleTestId,
	mono = false,
	back,
	badge,
	description,
	meta,
	actions,
}: {
	title: ReactNode;
	titleTestId?: string;
	/** Order numbers and other codes. */
	mono?: boolean;
	back?: { href: string; label: string };
	badge?: ReactNode;
	description?: ReactNode;
	/** Small facts under the description (time zone, data age, status badges). */
	meta?: ReactNode;
	/** One or two controls; full width on phones. */
	actions?: ReactNode;
}) {
	return (
		<header className="flex flex-col gap-3 border-b pb-4 md:flex-row md:flex-wrap md:items-end md:justify-between md:gap-4 md:pb-5">
			<div className="flex min-w-0 flex-col gap-1.5">
				{back && (
					<Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
						<Link href={back.href}>
							<ArrowLeft data-icon="inline-start" aria-hidden="true" />
							{back.label}
						</Link>
					</Button>
				)}
				{badge}
				<h1
					data-testid={titleTestId}
					className={cn("text-xl font-semibold tracking-tight md:text-2xl", mono && "font-mono break-all")}
				>
					{title}
				</h1>
				{description && <div className="max-w-prose text-sm text-muted-foreground">{description}</div>}
				{meta && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{meta}</div>}
			</div>
			{actions && (
				<div className="flex flex-wrap items-end gap-2 max-md:*:flex-1">{actions}</div>
			)}
		</header>
	);
}

/** A detail section as a card: heading, optional one-line description, content. */
export function DetailSection({
	id,
	title,
	description,
	testId,
	className,
	children,
}: {
	id: string;
	title: ReactNode;
	description?: ReactNode;
	testId?: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section
			aria-labelledby={id}
			data-testid={testId}
			className={cn("flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 md:p-5", className)}
		>
			<div className="flex flex-col gap-0.5">
				<h2
					id={id}
					tabIndex={-1}
					className="text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{title}
				</h2>
				{description && <p className="text-xs text-muted-foreground">{description}</p>}
			</div>
			{children}
		</section>
	);
}

/**
 * A collapsible card section (money, diagnostics, queue rules, pickup profiles). The summary is a
 * 44px target on touch; it holds no heading (summary is a button), so the title names the
 * surrounding section instead.
 */
export function Disclosure({
	id,
	title,
	description,
	open,
	testId,
	children,
}: {
	id: string;
	title: ReactNode;
	/** Shown from md; phones keep the summary to one line. */
	description?: ReactNode;
	open?: boolean;
	testId?: string;
	children: ReactNode;
}) {
	return (
		<section aria-labelledby={id} data-testid={testId}>
			<details open={open} className="group rounded-lg border bg-card">
				<summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3 rounded-lg p-4 outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 md:p-5 [&::-webkit-details-marker]:hidden">
					<span className="flex min-w-0 flex-col gap-1">
						<span id={id} className="text-base font-semibold">
							{title}
						</span>
						{description && <span className="hidden text-sm text-muted-foreground md:block">{description}</span>}
					</span>
					<ChevronDown
						aria-hidden="true"
						className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
					/>
				</summary>
				<div className="flex flex-col gap-4 px-4 pb-4 md:px-5 md:pb-5">{children}</div>
			</details>
		</section>
	);
}

/**
 * Sticky bottom bar on phones (bulk actions, the screen's one primary action), inline from md.
 * Fixed to the viewport with the bottom safe-area inset; admin.css pads the page so the last
 * content clears it and reserves its height as scroll padding for focused controls.
 */
export const stickyBarClass =
	"max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-30 max-md:rounded-none max-md:border-x-0 max-md:border-b-0 max-md:border-t max-md:px-4 max-md:pt-2 max-md:pb-[max(0.5rem,env(safe-area-inset-bottom))] max-md:shadow-[0_-4px_12px_rgb(0_0_0/0.06)]";

export function StickyActions({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<div
			data-sticky-bar=""
			className={cn("flex flex-wrap items-center gap-2 max-md:bg-background max-md:*:flex-1", stickyBarClass, className)}
		>
			{children}
		</div>
	);
}
