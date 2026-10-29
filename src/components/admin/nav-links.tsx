"use client";

import { cn } from "cn";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_BADGE_LABELS, type NavCounts, type NavItem, type NavSection, parentActive } from "./admin-nav";

// S-V1 port of tokophi `nav-links.tsx`: collapsible groups (parent row = link to the main page,
// separate chevron button), children indented under a left border, auto-expanded while the active
// row is inside, exactly one active row (`active`, computed by activeHref). In the tablet icon rail
// (`rail:` variant, admin.css) only the parent icons show, with a tooltip once `tooltips` is on.

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
	const inside = isActive || children.some((c) => c.href === active);
	const [open, setOpen] = useState<boolean | null>(null);
	const expanded = children.length > 0 && (open ?? inside);
	const badge = item.badge ? (counts[item.badge] ?? 0) : 0;
	const Icon = item.icon;
	let link: ReactNode = (
		<Link
			href={item.href}
			onClick={onNavigate}
			aria-current={isActive ? "page" : undefined}
			data-slot="nav-link"
			data-active={isActive || undefined}
			className={cn(
				"group relative flex min-h-9 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11",
				"rail:justify-center rail:px-0",
				isActive
					? "bg-primary/10 text-primary"
					: inside
						? "text-foreground hover:bg-muted"
						: "text-muted-foreground hover:bg-muted hover:text-foreground",
			)}
		>
			<Icon
				aria-hidden="true"
				className={cn("size-[18px] shrink-0", isActive || inside ? "text-primary" : "text-muted-foreground group-hover:text-foreground")}
			/>
			<span className="min-w-0 flex-1 truncate rail:sr-only">{item.label}</span>
			{badge > 0 && (
				// Hidden at zero: a badge means there is work here. Ink on yellow (plan §3: fill only).
				<span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-highlight px-1.5 text-[11px] font-semibold text-highlight-foreground tabular-nums rail:absolute rail:top-0.5 rail:right-1 rail:h-4 rail:min-w-4 rail:px-1 rail:text-[10px]">
					{count.format(badge)}
					{item.badge && <span className="sr-only"> {NAV_BADGE_LABELS[item.badge]}</span>}
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
			<div className="flex items-center">
				{link}
				<button
					type="button"
					onClick={() => setOpen(!expanded)}
					aria-expanded={expanded}
					aria-label={`${expanded ? "Tutup" : "Buka"} ${item.label}`}
					data-slot="nav-toggle"
					className="ml-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11 rail:hidden"
				>
					<ChevronRight aria-hidden="true" className={cn("size-4 transition-transform motion-reduce:transition-none", expanded && "rotate-90")} />
				</button>
			</div>
			{expanded && (
				<ul className="mt-0.5 ml-[26px] flex flex-col gap-0.5 border-l pl-3 rail:hidden">
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
			)}
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
		<nav aria-label="Navigasi Operator" className="flex flex-col gap-4 px-3 rail:px-2">
			{sections.map((section, index) => (
				<div key={section.label ?? index} className="flex flex-col gap-1">
					{section.label && (
						<p className="px-3 pt-1 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase rail:sr-only">
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
