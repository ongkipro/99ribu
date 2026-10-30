"use client";

import { Check, ChevronDown, ExternalLink, LogIn, LogOut, Menu, PanelLeft, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { CanonicalWorkspace } from "./admin-workspaces-client";

// S-V1 port of tokophi `topbar.tsx` (structure only): sticky translucent bar with the phone nav
// sheet, the rail toggle (md+), a slot for the command search (S-N1), the role chip for accounts
// with more than one lens (replaces the "Ruang Kerja" sidebar group; `?workspace=` stays the lens)
// and the avatar menu. No balance chip, store switcher or theme toggle (plan §2.8).

export const WORKSPACE_LABELS: Record<CanonicalWorkspace, string> = {
	owner: "Super Admin",
	ecommerce_admin: "Admin E-Commerce",
	warehouse: "Gudang",
	customer_service: "Layanan Pelanggan",
	finance: "Keuangan",
};

export type ConsoleAccount = { name: string; email: string } | null;

function initials(name: string, email: string) {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const letters = words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0] ?? email).slice(0, 2);
	return letters.toUpperCase();
}

export function Brand({ compact = false }: { compact?: boolean }) {
	return (
		<span className="flex flex-col leading-tight">
			<span className="text-lg font-bold tracking-tight">
				99<span className="text-primary">rb</span>
			</span>
			{!compact && <span className="text-xs font-medium text-muted-foreground">Konsol Operasional</span>}
		</span>
	);
}

function RoleChip({ workspaces, lens }: { workspaces: CanonicalWorkspace[]; lens: CanonicalWorkspace }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="sm" className="min-w-0 gap-1.5" aria-label={`Ruang kerja: ${WORKSPACE_LABELS[lens]}. Ganti ruang kerja`}>
					<span className="truncate">{WORKSPACE_LABELS[lens]}</span>
					<ChevronDown data-icon="inline-end" aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-52" data-testid="role-workspace-switcher">
				<DropdownMenuLabel>Ruang kerja</DropdownMenuLabel>
				{workspaces.map((ws) => (
					<DropdownMenuItem key={ws} asChild>
						<Link href={`/admin?workspace=${ws}`} data-testid={`workspace-tab-${ws}`} aria-current={ws === lens ? "true" : undefined}>
							<span className="flex-1">{WORKSPACE_LABELS[ws]}</span>
							{ws === lens && <Check aria-hidden="true" className="text-primary" />}
						</Link>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function AccountMenu({ account, roles }: { account: ConsoleAccount; roles: CanonicalWorkspace[] }) {
	const [signOut, setSignOut] = useState<"idle" | "pending" | "failed">("idle");
	if (!account)
		return (
			// Signed-out preview (local/test only; production redirects to /masuk in the layout).
			<div data-testid="admin-account" className="flex items-center gap-2">
				<p className="hidden text-xs text-muted-foreground lg:block">Pratinjau tanpa sesi staf.</p>
				<Button asChild size="sm">
					{/* Full document navigation: the storefront must not inherit the console stylesheet. */}
					<a href="/masuk?next=%2Fadmin">
						<LogIn data-icon="inline-start" aria-hidden="true" />
						Masuk sebagai staf
					</a>
				</Button>
				<Button asChild size="sm" variant="ghost">
					<a href="/">
						<ExternalLink data-icon="inline-start" aria-hidden="true" />
						Lihat Toko
					</a>
				</Button>
			</div>
		);
	const name = account.name || account.email;
	async function endSession() {
		setSignOut("pending");
		const response = await fetch("/api/auth/sign-out", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		}).catch(() => null);
		if (response?.ok) window.location.assign("/masuk?next=%2Fadmin");
		else setSignOut("failed");
	}
	return (
		<div data-testid="admin-account">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" className="gap-2 pr-2 pl-1.5" aria-label={`Menu akun ${name}`}>
						<span
							aria-hidden="true"
							className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
						>
							{initials(account.name, account.email)}
						</span>
						<span className="hidden max-w-32 truncate text-sm font-medium sm:inline">{name.split(" ")[0]}</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" sideOffset={6} className="min-w-60">
					<DropdownMenuLabel className="grid gap-1 font-normal">
						<span className="truncate font-medium text-foreground">{name}</span>
						<span className="truncate text-xs">{account.email}</span>
						{roles.length > 0 && (
							<span className="flex flex-wrap gap-1 pt-0.5">
								{roles.map((role) => (
									<Badge key={role} variant="secondary">
										{WORKSPACE_LABELS[role]}
									</Badge>
								))}
							</span>
						)}
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem asChild>
						<Link href="/admin/akun/profil">
							<UserRound aria-hidden="true" />
							Profil
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						<Link href="/admin/akun/keamanan">
							<ShieldCheck aria-hidden="true" />
							Keamanan
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem asChild>
						{/* Full document navigation: the storefront must not inherit the console stylesheet. */}
						<a href="/">
							<ExternalLink aria-hidden="true" />
							Lihat Toko
						</a>
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						data-testid="sign-out-button"
						variant="destructive"
						disabled={signOut === "pending"}
						onSelect={(event) => {
							// Keep the menu open so a failure stays next to the action.
							event.preventDefault();
							void endSession();
						}}
					>
						<LogOut aria-hidden="true" />
						{signOut === "pending" ? "Sedang keluar…" : "Keluar"}
					</DropdownMenuItem>
					{/* Inside the menu: a modal menu hides everything outside it from assistive tech. */}
					{signOut === "failed" && (
						<p role="alert" className="px-2 py-1.5 text-xs text-destructive">
							Gagal keluar. Coba lagi.
						</p>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

export function Topbar({
	account,
	roles,
	workspaces,
	lens,
	rail,
	onToggleRail,
	mobileNav,
	search,
}: {
	account: ConsoleAccount;
	roles: CanonicalWorkspace[];
	workspaces: CanonicalWorkspace[];
	lens: CanonicalWorkspace;
	/** Effective rail state once known on the client (null before mount). */
	rail: boolean | null;
	onToggleRail: () => void;
	/** The nav for the phone sheet; receives the close callback for in-console links. */
	mobileNav: (close: () => void) => ReactNode;
	/** Command search slot (S-N1). */
	search?: ReactNode;
}) {
	const [sheet, setSheet] = useState(false);
	return (
		<header
			data-slot="admin-topbar"
			className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md sm:px-6"
		>
			{/* Controlled so a nav tap closes the sheet instead of leaving it over the new page. */}
			<Sheet open={sheet} onOpenChange={setSheet}>
				<SheetTrigger asChild>
					<Button variant="ghost" size="icon" className="md:hidden" aria-label="Buka menu navigasi">
						<Menu aria-hidden="true" />
					</Button>
				</SheetTrigger>
				<SheetContent side="left" className="w-72 gap-0 p-0">
					<SheetTitle className="sr-only">Menu navigasi</SheetTitle>
					<div className="flex h-16 shrink-0 items-center border-b px-5">
						<Brand />
					</div>
					<div className="flex-1 overflow-y-auto py-4">{mobileNav(() => setSheet(false))}</div>
				</SheetContent>
			</Sheet>
			<Button
				variant="ghost"
				size="icon"
				className="max-md:hidden"
				onClick={onToggleRail}
				aria-label={rail === null ? "Ubah lebar navigasi" : rail ? "Lebarkan navigasi" : "Ciutkan navigasi"}
			>
				<PanelLeft aria-hidden="true" />
			</Button>
			<span className="md:hidden">
				<Brand compact />
			</span>
			<div data-slot="command-search" className="flex min-w-0 flex-1 items-center">
				{search}
			</div>
			<div className="flex shrink-0 items-center gap-1 sm:gap-2">
				{/* S-V1 plan (role chip): only a multi-role account switches lenses; the owner (every workspace, one role) has none. */}
				{roles.length > 1 && <RoleChip workspaces={workspaces} lens={lens} />}
				<AccountMenu account={account} roles={roles} />
			</div>
		</header>
	);
}
