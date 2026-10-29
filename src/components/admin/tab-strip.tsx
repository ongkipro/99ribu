import { cn } from "cn";
import Link from "next/link";

// S-V1 port of tokophi `tab-strip.tsx`: a list's saved views as one row of links (`?tab=`). It
// scrolls sideways on phones (bleeding to the screen edge) instead of wrapping or squeezing labels.
// A count shows only when the API returns one; no tab ever shows a guessed number.

export type Tab = { key: string; label: string; href: string; count?: number | null };

const count = new Intl.NumberFormat("id-ID");

export function TabStrip({
	label,
	tabs,
	active,
	testId,
	className,
}: {
	/** Accessible name of the tab row, e.g. "Tampilan pesanan". */
	label: string;
	tabs: Tab[];
	active: string;
	testId?: (key: string) => string;
	className?: string;
}) {
	return (
		<nav aria-label={label} className={cn("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}>
			<ul className="flex w-max min-w-full gap-1 border-b">
				{tabs.map((tab) => {
					const current = tab.key === active;
					return (
						<li key={tab.key}>
							<Link
								href={tab.href}
								replace
								scroll={false}
								aria-current={current ? "page" : undefined}
								data-testid={testId?.(tab.key)}
								className={cn(
									"-mb-px inline-flex min-h-10 items-center gap-1.5 border-b-2 px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11",
									current
										? "border-primary text-primary"
										: "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
								)}
							>
								{tab.label}
								{typeof tab.count === "number" && (
									<span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
										{count.format(tab.count)}
									</span>
								)}
							</Link>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
