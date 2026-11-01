import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { HubCard } from "./admin-nav";

/** Card grid shared by the admin hub pages (Pengaturan, Pemasaran, Pantauan). */
export function HubCards({ cards, label }: { cards: HubCard[]; label: string }) {
	return (
		<ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={label}>
			{cards.map(({ href, label: name, description, icon: Icon }) => (
				<li key={href}>
					<Link
						href={href}
						className="group flex h-full items-start gap-3 rounded-lg border bg-card p-5 outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
					>
						<span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
							<Icon className="size-[18px]" />
						</span>
						<span className="flex min-w-0 flex-1 flex-col gap-1">
							<span className="text-sm font-semibold">{name}</span>
							<span className="text-sm text-muted-foreground">{description}</span>
						</span>
						<ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
					</Link>
				</li>
			))}
		</ul>
	);
}
