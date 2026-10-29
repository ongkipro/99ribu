"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { activeHref, LENS_COOKIE, type NavBadgeKey, type NavCounts, navFor } from "./admin-nav";
import type { CanonicalWorkspace } from "./admin-workspaces-client";
import { NavLinks } from "./nav-links";
import { Brand, type ConsoleAccount, Topbar } from "./topbar";

export type { ConsoleAccount } from "./topbar";

const TABLET = "(min-width: 768px) and (max-width: 1023px)";
const EMPTY = new URLSearchParams();

/**
 * Spec 10 widths, final on the first paint (open P2 from the 2026-10-28 re-review): admin.css sizes
 * the sidebar from `data-rail` alone ("auto" = rail at 768-1023px, full from 1024px), so no width
 * depends on an effect and nothing transitions. A toggle sets "collapsed"/"expanded" for the session.
 */
type Rail = "auto" | "collapsed" | "expanded";

function useTablet() {
	const [tablet, setTablet] = useState<boolean | null>(null);
	useEffect(() => {
		const query = window.matchMedia(TABLET);
		const apply = () => setTablet(query.matches);
		apply();
		query.addEventListener("change", apply);
		return () => query.removeEventListener("change", apply);
	}, []);
	return tablet;
}

/** Live nav counts for the lens, from the role-scoped dashboard API (hidden at zero, silent on failure). */
function useNavCounts(lens: CanonicalWorkspace, keys: NavBadgeKey[], signedIn: boolean) {
	const [counts, setCounts] = useState<NavCounts>({});
	const wanted = keys.join(",");
	useEffect(() => {
		setCounts({});
		if (!signedIn || !wanted) return;
		const controller = new AbortController();
		const q = new URLSearchParams({ workspace: lens, window: "30d" });
		fetch(`/api/v1/admin/dashboard?${q}`, { credentials: "include", cache: "no-store", signal: controller.signal })
			.then((res) => (res.ok ? res.json() : null))
			.then((body: { metrics?: { key: string; count: number | null }[] } | null) => {
				const next: NavCounts = {};
				for (const m of body?.metrics ?? [])
					if (wanted.split(",").includes(m.key) && typeof m.count === "number") next[m.key as NavBadgeKey] = m.count;
				setCounts(next);
			})
			.catch(() => {});
		return () => controller.abort();
	}, [lens, wanted, signedIn]);
	return counts;
}

function Shell({
	workspaces,
	roles,
	permissions,
	account,
	storedLens,
	search,
	children,
}: {
	workspaces: CanonicalWorkspace[];
	roles: CanonicalWorkspace[];
	permissions: string[];
	account: ConsoleAccount;
	storedLens: string | null;
	search: URLSearchParams;
	children: ReactNode;
}) {
	const pathname = usePathname();
	const valid = (ws: string | null | undefined) => workspaces.find((w) => w === ws) ?? null;
	// The home and the full queue page carry the lens in `?workspace=`; elsewhere the last one holds.
	const requested = pathname === "/admin" || pathname === "/admin/antrian" ? valid(search.get("workspace")) : null;
	const [remembered, setRemembered] = useState(() => valid(storedLens));
	const lens: CanonicalWorkspace = requested ?? remembered ?? roles[0] ?? workspaces[0] ?? "owner";
	useEffect(() => {
		if (!requested || requested === remembered) return;
		setRemembered(requested);
		// biome-ignore lint/suspicious/noDocumentCookie: a display preference read by the layout on the next document load
		document.cookie = `${LENS_COOKIE}=${requested}; path=/admin; max-age=31536000; samesite=lax`;
	}, [requested, remembered]);

	const sections = useMemo(() => navFor(lens, roles, permissions), [lens, roles, permissions]);
	const active = activeHref(sections, pathname, search);
	const badgeKeys = useMemo(
		() => [...new Set(sections.flatMap((s) => s.items.flatMap((i) => (i.badge ? [i.badge] : []))))],
		[sections],
	);
	const counts = useNavCounts(lens, badgeKeys, account !== null && roles.length > 0);

	const [rail, setRail] = useState<Rail>("auto");
	const tablet = useTablet();
	const railOn = rail === "auto" ? tablet : rail === "collapsed";

	return (
		<div className="flex min-h-svh w-full">
			<aside
				data-slot="admin-sidebar"
				data-rail={rail}
				aria-label="Sidebar konsol"
				className="sticky top-0 hidden h-svh shrink-0 flex-col border-r bg-card md:flex"
			>
				<div className="flex h-16 shrink-0 items-center border-b px-5 rail:justify-center rail:px-0">
					<span className="rail:hidden">
						<Brand />
					</span>
					<span className="hidden rail:inline">
						<Brand compact />
					</span>
				</div>
				<div className="flex-1 overflow-y-auto py-4">
					<NavLinks sections={sections} active={active} counts={counts} tooltips={railOn === true} />
				</div>
			</aside>
			<div className="flex min-w-0 flex-1 flex-col">
				<Topbar
					account={account}
					roles={roles}
					workspaces={workspaces}
					lens={lens}
					rail={railOn}
					onToggleRail={() => setRail(railOn ? "expanded" : "collapsed")}
					mobileNav={(close) => <NavLinks sections={sections} active={active} counts={counts} onNavigate={close} />}
				/>
				<main id="main" data-slot="admin-main" className="min-w-0 flex-1">
					{children}
				</main>
			</div>
		</div>
	);
}

function ShellWithSearch(props: Omit<Parameters<typeof Shell>[0], "search">) {
	return <Shell {...props} search={useSearchParams()} />;
}

export function AdminShell(props: {
	workspaces: CanonicalWorkspace[];
	roles: CanonicalWorkspace[];
	permissions: string[];
	account: ConsoleAccount;
	/** Last lens from the `admin_lens` cookie (validated against `workspaces` here). */
	storedLens: string | null;
	children: ReactNode;
}) {
	return (
		<TooltipProvider>
			<Suspense fallback={<Shell {...props} search={EMPTY} />}>
				<ShellWithSearch {...props} />
			</Suspense>
		</TooltipProvider>
	);
}
