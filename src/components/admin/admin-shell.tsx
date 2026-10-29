"use client";

import {
	BadgePercent,
	Boxes,
	Activity,
	ArrowLeftRight,
	Banknote,
	ChevronsUpDown,
	ExternalLink,
	Headset,
	Images,
	Landmark,
	LayoutDashboard,
	LogIn,
	LogOut,
	type LucideIcon,
	MessagesSquare,
	Package,
	PackageOpen,
	Printer,
	ReceiptText,
	ScrollText,
	ShieldCheck,
	Store,
	Tags,
	TicketPercent,
	Truck,
	Undo2,
	TriangleAlert,
	UserRound,
	UserCog,
	UserSearch,
	UsersRound,
	Wallet,
	Warehouse,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarTrigger,
	useSidebar,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CanonicalWorkspace } from "./admin-workspaces-client";
import { catalogAccess } from "./catalog-model";
import { consoleAccess } from "./console-access";
import { canReadOrders } from "./order-model";
import { returnAccess } from "./return-model";
import { financeAccess } from "./finance-model";

export const WORKSPACE_NAV: Record<
	CanonicalWorkspace,
	{ label: string; icon: LucideIcon }
> = {
	owner: { label: "Super Admin", icon: LayoutDashboard },
	ecommerce_admin: { label: "Admin E-Commerce", icon: Store },
	warehouse: { label: "Gudang", icon: Warehouse },
	customer_service: { label: "Layanan Pelanggan", icon: Headset },
	finance: { label: "Keuangan", icon: Wallet },
};

/** Closes the mobile sheet after an in-console navigation. */
function useCloseOnNavigate() {
	const { isMobile, setOpenMobile } = useSidebar();
	return () => {
		if (isMobile) setOpenMobile(false);
	};
}

/**
 * Spec 10: tablet (md–lg) starts as an icon rail; desktop starts expanded; phones get the drawer.
 * First paint is already final (admin review 2026-10-28, finding 1): the server renders the
 * expanded sidebar with `data-rail="auto"`, and the `sidebar-icon` variant (admin.css) draws the
 * 48px rail from the tablet media query alone, so neither width depends on this effect. The effect
 * then sets the same state in React, and sidebar.tsx has no width transition, so nothing moves
 * after hydration or on a later resize. A toggle lasts for the session (state lives in this
 * layout); a reload starts again from the viewport.
 */
function TabletRail() {
	const { setOpen } = useSidebar();
	useEffect(() => {
		const tablet = window.matchMedia(
			"(min-width: 768px) and (max-width: 1023px)",
		);
		const apply = () => setOpen(!tablet.matches);
		apply();
		tablet.addEventListener("change", apply);
		return () => tablet.removeEventListener("change", apply);
	}, [setOpen]);
	return null;
}

function WorkspaceLinks({
	workspaces,
	active,
	current = true,
}: {
	workspaces: CanonicalWorkspace[];
	active: CanonicalWorkspace | null;
	current?: boolean;
}) {
	const close = useCloseOnNavigate();
	return (
		<SidebarMenu
			aria-label="Pilihan Ruang Kerja Peran"
			data-testid="role-workspace-switcher"
		>
			{workspaces.map((ws) => {
				const { label, icon: Icon } = WORKSPACE_NAV[ws];
				const isActive = active === ws;
				return (
					<SidebarMenuItem key={ws}>
						<SidebarMenuButton asChild isActive={isActive} tooltip={label}>
							<Link
								href={`/admin?workspace=${ws}`}
								data-testid={`workspace-tab-${ws}`}
								aria-current={isActive && current ? "page" : undefined}
								onClick={close}
							>
								<Icon aria-hidden="true" />
								<span>{label}</span>
							</Link>
						</SidebarMenuButton>
					</SidebarMenuItem>
				);
			})}
		</SidebarMenu>
	);
}

function ActiveWorkspaceLinks({
	workspaces,
}: {
	workspaces: CanonicalWorkspace[];
}) {
	const pathname = usePathname();
	const requested = useSearchParams().get("workspace");
	// The full work-queue page belongs to its workspace: the item stays active (not "current page").
	const active =
		pathname === "/admin" || pathname === "/admin/antrian"
			? (workspaces.find((ws) => ws === requested) ?? null)
			: null;
	return (
		<WorkspaceLinks
			workspaces={workspaces}
			active={active}
			current={pathname === "/admin"}
		/>
	);
}

type NavItem = { href: string; label: string; icon: LucideIcon; show: boolean };
type NavGroup = { label: string; items: NavItem[] };

/**
 * Spec 17 "Navigation per role": a group with no visible item is not rendered, and a one-item group
 * joins its neighbour (2026-10-24 render-review rule), keeping the label of the larger group.
 */
function visibleGroups(groups: NavGroup[]): NavGroup[] {
	const out: NavGroup[] = [];
	for (const group of groups) {
		const items = group.items.filter((item) => item.show);
		if (items.length === 0) continue;
		const prev = out.at(-1);
		if (prev && (items.length === 1 || prev.items.length === 1)) {
			if (prev.items.length === 1 && items.length > 1) prev.label = group.label;
			prev.items.push(...items);
		} else out.push({ label: group.label, items });
	}
	return out;
}

/** Grouped tool links: active on the screen and its detail pages, current only on the exact page. */
function ToolGroups({ groups }: { groups: NavGroup[] }) {
	const pathname = usePathname();
	const close = useCloseOnNavigate();
	const matches = (href: string) =>
		pathname === href || pathname.startsWith(`${href}/`);
	// Longest matching href wins across groups (Stok Gudang vs Transfer Stok).
	const active = groups
		.flatMap((group) => group.items)
		.filter((item) => matches(item.href))
		.reduce<string | null>(
			(best, item) =>
				best && best.length >= item.href.length ? best : item.href,
			null,
		);
	return groups.map((group) => (
		<SidebarGroup key={group.label}>
			<SidebarGroupLabel>{group.label}</SidebarGroupLabel>
			<SidebarGroupContent>
				<SidebarMenu>
					{group.items.map(({ href, label, icon: Icon }) => (
						<SidebarMenuItem key={href}>
							<SidebarMenuButton
								asChild
								isActive={href === active}
								tooltip={label}
							>
								<Link
									href={href}
									aria-current={pathname === href ? "page" : undefined}
									onClick={close}
								>
									<Icon aria-hidden="true" />
									<span>{label}</span>
								</Link>
							</SidebarMenuButton>
						</SidebarMenuItem>
					))}
				</SidebarMenu>
			</SidebarGroupContent>
		</SidebarGroup>
	));
}

export type ConsoleAccount = { name: string; email: string } | null;

function initials(name: string, email: string) {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const letters =
		words.length > 1
			? `${words[0][0]}${words[words.length - 1][0]}`
			: (words[0] ?? email).slice(0, 2);
	return letters.toUpperCase();
}

// Profil and Keamanan akun (S129) stay hidden until their pages exist, like every unbuilt screen.
const ACCOUNT_PAGES: NavItem[] = [
	{ href: "/admin/akun/profil", label: "Profil", icon: UserRound, show: true },
	{
		href: "/admin/akun/keamanan",
		label: "Keamanan akun",
		icon: ShieldCheck,
		show: true,
	},
];

/** Spec 17 account menu (replaces the session bar): sidebar footer, the last block of the Sheet on phones. */
function AccountMenu({ account }: { account: ConsoleAccount }) {
	const { isMobile } = useSidebar();
	const [signOut, setSignOut] = useState<"idle" | "pending" | "failed">("idle");
	if (!account)
		return (
			// Signed-out preview (local/test only; the production profile redirects to /masuk in the layout).
			<SidebarMenu data-testid="admin-account">
				<SidebarMenuItem>
					<p className="px-2 pb-1 text-xs text-muted-foreground sidebar-icon:sr-only">
						Pratinjau tanpa sesi staf.
					</p>
					<SidebarMenuButton asChild tooltip="Masuk sebagai staf">
						{/* Full document navigation: the storefront must not inherit the console stylesheet. */}
						<a href="/masuk?next=%2Fadmin">
							<LogIn aria-hidden="true" />
							<span>Masuk sebagai staf</span>
						</a>
					</SidebarMenuButton>
				</SidebarMenuItem>
				<SidebarMenuItem>
					<SidebarMenuButton asChild tooltip="Lihat Toko">
						<a href="/">
							<ExternalLink aria-hidden="true" />
							<span>Lihat Toko</span>
						</a>
					</SidebarMenuButton>
				</SidebarMenuItem>
			</SidebarMenu>
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
		<SidebarMenu data-testid="admin-account">
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							tooltip={account.email}
							aria-label={`Menu akun ${name}`}
						>
							<span
								aria-hidden="true"
								className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground"
							>
								{initials(account.name, account.email)}
							</span>
							<span className="grid min-w-0 flex-1 leading-tight sidebar-icon:hidden">
								<span className="truncate font-medium">{name}</span>
								<span className="truncate text-xs text-muted-foreground">
									{account.email}
								</span>
							</span>
							<ChevronsUpDown
								aria-hidden="true"
								className="ml-auto sidebar-icon:hidden"
							/>
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						side={isMobile ? "top" : "right"}
						align="end"
						sideOffset={6}
						className="min-w-56"
					>
						<DropdownMenuLabel className="grid font-normal">
							<span className="truncate font-medium text-foreground">
								{name}
							</span>
							<span className="truncate text-xs">{account.email}</span>
						</DropdownMenuLabel>
						<DropdownMenuSeparator />
						{ACCOUNT_PAGES.filter((item) => item.show).map(
							({ href, label, icon: Icon }) => (
								<DropdownMenuItem key={href} asChild>
									<Link href={href}>
										<Icon aria-hidden="true" />
										{label}
									</Link>
								</DropdownMenuItem>
							),
						)}
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
			</SidebarMenuItem>
		</SidebarMenu>
	);
}

export function AdminShell({
	workspaces,
	roles,
	permissions,
	account,
	children,
}: {
	workspaces: CanonicalWorkspace[];
	roles: CanonicalWorkspace[];
	permissions: string[];
	account: ConsoleAccount;
	children: React.ReactNode;
}) {
	// null until TabletRail decides on the client (first paint follows the viewport in CSS).
	const [open, setOpen] = useState<boolean | null>(null);
	// Same grants the destination pages enforce server-side; this only hides dead ends.
	// Spec 17 groups and order; a screen that is not built yet has no item until its slice merges.
	const access = consoleAccess(roles, permissions);
	const fin = financeAccess(roles, permissions);
	const groups = visibleGroups([
		{
			label: "Operasional",
			items: [
				{
					href: "/admin/pesanan",
					label: "Pesanan",
					icon: ReceiptText,
					show: canReadOrders(roles, permissions),
				},
				{
					href: "/admin/pesanan/kirim",
					label: "Pengiriman Manual",
					icon: Truck,
					show: access.ship,
				},
				{
					href: "/admin/pesanan/cetak-label",
					label: "Pusat Cetak Label",
					icon: Printer,
					show: access.print,
				},
				{
					href: "/admin/pesanan/kendala",
					label: "Masalah Pengiriman",
					icon: TriangleAlert,
					// Same rule as the exceptions page guard (S133).
					show: returnAccess(roles, permissions).read,
				},
				{
					href: "/admin/pesanan/retur",
					label: "Retur & Penggantian",
					icon: Undo2,
					show: returnAccess(roles, permissions).read,
				},
				{
					href: "/admin/obrolan",
					label: "Kotak Masuk Pelanggan",
					icon: MessagesSquare,
					show: access.support,
				},
				{
					href: "/admin/pelanggan",
					label: "Akun Pembeli",
					icon: UserSearch,
					// Same rule as the customer lookup page guard (S138): owner and customer_service.
					show: access.support,
				},
			],
		},
		{
			label: "Katalog & Stok",
			items: [
				{
					href: "/admin/produk",
					label: "Produk",
					icon: Package,
					show: catalogAccess(roles, permissions).read,
				},
				{
					href: "/admin/produk/sku",
					label: "SKU Fisik",
					icon: Boxes,
					show: catalogAccess(roles, permissions).edit,
				},
				{
					href: "/admin/produk/kategori",
					label: "Kategori",
					icon: Tags,
					show: catalogAccess(roles, permissions).edit,
				},
				{
					href: "/admin/produk/inventori",
					label: "Stok Gudang",
					icon: PackageOpen,
					show: access.inventory,
				},
				{
					href: "/admin/produk/inventori/transfer",
					label: "Transfer Stok",
					icon: ArrowLeftRight,
					show: access.inventory,
				},
				{
					href: "/admin/produk/gudang",
					label: "Daftar Gudang",
					icon: Warehouse,
					// Same rule as the warehouses page guard (S134).
					show: access.inventory,
				},
			],
		},
		{
			label: "Pemasaran",
			items: [
				{
					href: "/admin/promo/ongkir",
					label: "Promo Ongkir",
					icon: TicketPercent,
					show: access.shippingPromo,
				},
				{
					href: "/admin/banner",
					label: "Banner Beranda",
					icon: Images,
					show: access.banners,
				},
				{
					href: "/admin/pelanggan/segmen",
					label: "Segmen Pembeli",
					icon: UsersRound,
					// Same rule as the buyer-segments page guard (S126).
					show: roles.some((r) => r === "owner" || r === "ecommerce_admin"),
				},
				{
					href: "/admin/afiliasi",
					label: "Afiliasi",
					icon: BadgePercent,
					// Same rule as the affiliates page guard (S132, DEC-018 Q5): owner writes rates, finance reads.
					show: roles.some((r) => r === "owner" || r === "finance"),
				},
			],
		},
		{
			label: "Keuangan",
			items: [
				{
					href: "/admin/keuangan/pembayaran",
					label: "Pembayaran Masuk",
					icon: Landmark,
					show: access.reconcileRead,
				},
				{
					href: "/admin/keuangan/cod",
					label: "Setoran COD",
					icon: Banknote,
					show: access.reconcileRead,
				},
				{
					href: "/admin/keuangan/rekonsiliasi",
					label: "Rekonsiliasi",
					icon: ArrowLeftRight,
					show: fin.reconcileRead,
				},
				{
					href: "/admin/keuangan/komisi",
					label: "Pembayaran Komisi",
					icon: Wallet,
					show: fin.payouts,
				},
				{
					href: "/admin/keuangan/refund",
					label: "Pengembalian Dana",
					icon: Undo2,
					show: fin.refundRead,
				},
				{
					href: "/admin/keuangan",
					label: "Laporan Keuangan",
					icon: ReceiptText,
					show: fin.summaryRead,
				},
			],
		},
		// S130/S137 add the remaining settings items; an empty group is not rendered.
		{
			label: "Pengaturan",
			items: [
				{
					href: "/admin/pengaturan/audit",
					label: "Log Audit",
					icon: ScrollText,
					// Same rule as the audit page guard (S135, DEC-018 Q4): owner, and finance for money actions.
					show: roles.some((r) => r === "owner" || r === "finance"),
				},
				{
					href: "/admin/pengaturan/sistem",
					label: "Kesehatan Sistem",
					icon: Activity,
					// Same rule as the system health page guard (S136): owner only.
					show: roles.includes("owner"),
				},
				{
					href: "/admin/pengaturan/staf",
					label: "Staf & Peran",
					icon: UserCog,
					// Same rule as the staff page guard (S137): owner only.
					show: roles.includes("owner"),
				},
				{
					href: "/admin/pengaturan/pembayaran",
					label: "Pembayaran & Biaya COD",
					icon: Landmark,
					// Same rule as the payment settings page guard (S130, DEC-018 Q3): owner writes, finance reads.
					show: roles.some((r) => r === "owner" || r === "finance"),
				},
				{
					href: "/admin/pengaturan/komersial",
					label: "Kebijakan Komersial",
					icon: ReceiptText,
					// Same rule as the commercial settings page guard (S130, DEC-018 Q3).
					show: roles.some((r) => r === "owner" || r === "finance"),
				},
				{
					href: "/admin/pengaturan/label",
					label: "Template Label",
					icon: Printer,
					// Same rule as the label templates page guard (S130): read for the roles that print or reconcile.
					show:
						roles.some((r) => r === "owner" || r === "ecommerce_admin" || r === "warehouse" || r === "finance") ||
						permissions.includes("shipping.labels.read"),
				},
				{
					href: "/admin/pemasaran/iklan",
					label: "Integrasi Iklan",
					icon: Activity,
					// Same rule as the advertising settings page guard (S130): owner only, as the diagnostics API.
					show: roles.includes("owner"),
				},
				{
					href: "/admin/pengaturan/balasan-cs",
					label: "Balasan & Tag CS",
					icon: MessagesSquare,
					// Same rule as the support settings page guard (S130).
					show: access.support,
				},
			],
		},
	]);

	return (
		<TooltipProvider>
			<SidebarProvider
				open={open ?? true}
				onOpenChange={setOpen}
				data-rail={open === null ? "auto" : undefined}
			>
				<TabletRail />
				<Sidebar collapsible="icon">
					<SidebarHeader className="border-b border-sidebar-border px-4 py-3 sidebar-icon:px-1 sidebar-icon:py-3">
						<p className="flex flex-col sidebar-icon:items-center">
							<span className="text-lg font-bold tracking-tight sidebar-icon:text-sm">
								99<span className="text-primary">rb</span>
							</span>
							<span className="text-xs font-medium text-muted-foreground sidebar-icon:sr-only">
								Konsol Operasional
							</span>
						</p>
					</SidebarHeader>
					<SidebarContent>
						<nav aria-label="Navigasi Operator" className="flex flex-col gap-2">
							<SidebarGroup>
								<SidebarGroupLabel>Ruang Kerja</SidebarGroupLabel>
								<SidebarGroupContent>
									<Suspense
										fallback={
											<WorkspaceLinks workspaces={workspaces} active={null} />
										}
									>
										<ActiveWorkspaceLinks workspaces={workspaces} />
									</Suspense>
								</SidebarGroupContent>
							</SidebarGroup>
							<ToolGroups groups={groups} />
						</nav>
					</SidebarContent>
					<SidebarFooter className="border-t border-sidebar-border">
						<AccountMenu account={account} />
					</SidebarFooter>
				</Sidebar>
				<SidebarInset id="main" className="min-w-0">
					<div className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background px-4">
						<SidebarTrigger />
						<Separator orientation="vertical" className="h-5 md:hidden" />
						<span className="truncate text-sm font-semibold md:hidden">
							99<span className="text-primary">rb</span> Konsol Operasional
						</span>
					</div>
					{children}
				</SidebarInset>
			</SidebarProvider>
		</TooltipProvider>
	);
}
