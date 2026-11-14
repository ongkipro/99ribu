"use client";

import { cn } from "cn";
import Link from "next/link";
import type { ReactNode } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	NAV_BADGE_LABELS,
	type NavCounts,
	type NavItem,
	type NavSection,
	parentActive,
} from "./admin-nav";

// Sidebar tree (owner 2026-11-14: "model sidebar tree", no dropdowns): section labels, every row and
// child always visible, children indented under a left guide line, exactly one active row (`active`,
// computed by activeHref). In the tablet icon rail (`rail:` variant, admin.css) only the parent icons
// show, with a tooltip once `tooltips` is on; a parent whose child is active carries the highlight there
// (`data-inside`), since the child is hidden.

const count = new Intl.NumberFormat("id-ID");

function Row({
	item,
	active,
	counts,
	tooltips,
	onNavigate,
}: {
	item: NavItem;
	active: string | null;
	counts: NavCounts;
	tooltips: boolean;
	onNavigate?: () => void;
}) {
	const children = item.children ?? [];
	const isActive = parentActive(item, active);
	const childActive = !isActive && children.some((c) => c.href === active);
	const inside = isActive || childActive;
	const badge = item.badge ? (counts[item.badge] ?? 0) : 0;
	const Icon = item.icon;
	let link: ReactNode = (
		<Link
			href={item.href}
			onClick={onNavigate}
			aria-current={isActive ? "page" : undefined}
			data-slot="nav-link"
			data-active={isActive || undefined}
			data-inside={childActive || undefined}
			className={cn(
				"group relative flex min-h-9 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11",
				"rail:justify-center rail:px-0",
				isActive
					? "bg-primary/10 text-primary"
					: inside
						? // The rail hides the children, so the parent carries the highlight of its active child.
							"text-foreground hover:bg-muted rail:bg-primary/10 rail:text-primary"
						: "text-muted-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<Icon
				aria-hidden="true"
				className={cn(
					"size-[18px] shrink-0",
					isActive || inside
						? "text-primary"
						: "text-muted-foreground group-hover:text-foreground",
				)}
			/>
			<span className="min-w-0 flex-1 truncate rail:sr-only">{item.label}</span>
			{badge > 0 && (
				// Hidden at zero: a badge means there is work here. Ink on yellow (plan §3: fill only).
				<span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-highlight px-1.5 text-[11px] font-semibold text-highlight-foreground tabular-nums rail:absolute rail:top-0.5 rail:right-1 rail:h-4 rail:min-w-4 rail:px-1 rail:text-[10px]">
					{count.format(badge)}
					{item.badge && (
						<span className="sr-only"> {NAV_BADGE_LABELS[item.badge]}</span>
					)}
				</span>
			)}
		</Link>
	);
	if (tooltips)
		link = (
			<Tooltip>
				<TooltipTrigger asChild>{link}</TooltipTrigger>
				<TooltipContent side="right">{item.label}</TooltipContent>
			</Tooltip>
		);
	if (children.length === 0) return <li data-nav-row={item.label}>{link}</li>;
	return (
		<li data-nav-row={item.label}>
			{link}
			<ul
				aria-label={item.label}
				className="mt-0.5 ml-[21px] flex flex-col gap-0.5 border-l pl-2.5 rail:hidden"
			>
				{children.map((child) => {
					const childActive = child.href === active;
					return (
						<li key={child.href}>
							<Link
								href={child.href}
								onClick={onNavigate}
								aria-current={childActive ? "page" : undefined}
								data-slot="nav-link"
								data-active={childActive || undefined}
								className={cn(
									"flex min-h-8 items-center rounded-lg px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11",
									childActive
										? "bg-primary/10 font-medium text-primary"
										: "text-muted-foreground hover:bg-muted hover:text-foreground",
								)}
							>
								{child.label}
							</Link>
						</li>
					);
				})}
			</ul>
		</li>
	);
}

export function NavLinks({
	sections,
	active,
	counts,
	tooltips = false,
	onNavigate,
}: {
	sections: NavSection[];
	active: string | null;
	counts: NavCounts;
	tooltips?: boolean;
	onNavigate?: () => void;
}) {
	return (
		<nav
			aria-label="Navigasi Operator"
			className="flex flex-col gap-5 px-3 rail:gap-2 rail:px-2"
		>
			{sections.map((section, index) => (
				<div key={section.label ?? index} className="flex flex-col gap-1">
					{section.label && (
						<p className="px-3 pb-1 text-xs font-medium text-muted-foreground rail:sr-only">
							{section.label}
						</p>
					)}
					<ul className="flex flex-col gap-0.5">
						{section.items.map((item) => (
							<Row
								key={item.href}
								item={item}
								active={active}
								counts={counts}
								tooltips={tooltips}
								onNavigate={onNavigate}
							/>
						))}
					</ul>
				</div>
			))}
		</nav>
	);
}
