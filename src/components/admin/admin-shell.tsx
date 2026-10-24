"use client";

import {
	Banknote,
	ExternalLink,
	Headset,
	Landmark,
	LayoutDashboard,
	type LucideIcon,
	MessagesSquare,
	Package,
	Printer,
	ReceiptText,
	Store,
	Truck,
	Wallet,
	Warehouse,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
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

/** Spec 10: tablet (md–lg) starts as an icon rail; desktop starts expanded. */
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
}: {
	workspaces: CanonicalWorkspace[];
	active: CanonicalWorkspace | null;
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
								aria-current={isActive ? "page" : undefined}
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
	const active =
		pathname === "/admin"
			? (workspaces.find((ws) => ws === requested) ?? null)
			: null;
	return <WorkspaceLinks workspaces={workspaces} active={active} />;
}

type NavItem = { href: string; label: string; icon: LucideIcon; show: boolean };
type NavGroup = { label: string; items: NavItem[] };

/** Grouped tool links (S113): active on the screen and its detail pages, current only on the exact page. */
function ToolGroups({ groups }: { groups: NavGroup[] }) {
	const pathname = usePathname();
	const close = useCloseOnNavigate();
	return groups.map((group) => {
		const items = group.items.filter((item) => item.show);
		if (items.length === 0) return null;
		return (
			<SidebarGroup key={group.label}>
				<SidebarGroupLabel>{group.label}</SidebarGroupLabel>
				<SidebarGroupContent>
					<SidebarMenu>
						{items.map(({ href, label, icon: Icon }) => (
							<SidebarMenuItem key={href}>
								<SidebarMenuButton
									asChild
									isActive={pathname === href || pathname.startsWith(`${href}/`)}
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
		);
	});
}

export function AdminShell({
	workspaces,
	roles,
	permissions,
	children,
}: {
	workspaces: CanonicalWorkspace[];
	roles: CanonicalWorkspace[];
	permissions: string[];
	children: React.ReactNode;
}) {
	// Same grants the destination pages enforce server-side; this only hides dead ends.
	const access = consoleAccess(roles, permissions);
	const canCatalog = catalogAccess(roles, permissions).read;
	const canOrders = canReadOrders(roles, permissions);
	const groups: NavGroup[] = [
		{
			label: "Operasional",
			items: [
				{ href: "/admin/orders", label: "Pesanan", icon: ReceiptText, show: canOrders },
				{ href: "/admin/fulfillment", label: "Pengiriman Manual", icon: Truck, show: access.ship },
				{ href: "/admin/print-center", label: "Pusat Cetak Label", icon: Printer, show: access.print },
				{ href: "/admin/support", label: "Kotak Masuk Pelanggan", icon: MessagesSquare, show: access.support },
			],
		},
		{
			label: "Katalog",
			items: [{ href: "/admin/catalog", label: "Katalog", icon: Package, show: canCatalog }],
		},
		{
			label: "Keuangan",
			items: [
				{ href: "/admin/payments", label: "Pembayaran", icon: Landmark, show: access.reconcileRead },
				{ href: "/admin/cod-settlements", label: "Setoran COD", icon: Banknote, show: access.reconcileRead },
			],
		},
	];

	return (
		<TooltipProvider>
			<SidebarProvider>
				<TabletRail />
				<Sidebar collapsible="icon">
					<SidebarHeader className="border-b border-sidebar-border px-4 py-3 group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:py-3">
						<p className="flex flex-col group-data-[collapsible=icon]:items-center">
							<span className="text-lg font-bold tracking-tight group-data-[collapsible=icon]:text-sm">
								99<span className="text-primary">rb</span>
							</span>
							<span className="text-xs font-medium text-muted-foreground group-data-[collapsible=icon]:sr-only">
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
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton asChild tooltip="Lihat Toko">
									{/* Full document navigation: the storefront must not inherit the console stylesheet. */}
									<a href="/">
										<ExternalLink aria-hidden="true" />
										<span>Lihat Toko</span>
									</a>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarFooter>
				</Sidebar>
				<SidebarInset id="main" className="min-w-0">
					<div className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
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
