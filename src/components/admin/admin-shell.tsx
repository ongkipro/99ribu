"use client";

import {
	ExternalLink,
	Headset,
	LayoutDashboard,
	type LucideIcon,
	MessagesSquare,
	Package,
	Printer,
	Store,
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

function ToolLinks({
	canCatalog,
	canPrint,
	canSupport,
}: {
	canCatalog: boolean;
	canPrint: boolean;
	canSupport: boolean;
}) {
	const pathname = usePathname();
	const close = useCloseOnNavigate();
	const onPrintCenter = pathname === "/admin/print-center";
	const onCatalog = pathname.startsWith("/admin/catalog");
	return (
		<SidebarMenu>
			{canCatalog && (
				<SidebarMenuItem>
					<SidebarMenuButton asChild isActive={onCatalog} tooltip="Katalog">
						<Link
							href="/admin/catalog"
							aria-current={pathname === "/admin/catalog" ? "page" : undefined}
							onClick={close}
						>
							<Package aria-hidden="true" />
							<span>Katalog</span>
						</Link>
					</SidebarMenuButton>
				</SidebarMenuItem>
			)}
			{canPrint && (
				<SidebarMenuItem>
					<SidebarMenuButton
						asChild
						isActive={onPrintCenter}
						tooltip="Pusat Cetak Label"
					>
						<Link
							href="/admin/print-center"
							aria-current={onPrintCenter ? "page" : undefined}
							onClick={close}
						>
							<Printer aria-hidden="true" />
							<span>Pusat Cetak Label</span>
						</Link>
					</SidebarMenuButton>
				</SidebarMenuItem>
			)}
			{canSupport && (
				<SidebarMenuItem>
					<SidebarMenuButton asChild tooltip="Kotak Masuk Pelanggan">
						{/* Full document navigation: /admin/support is outside the console stylesheet scope. */}
						<a href="/admin/support">
							<MessagesSquare aria-hidden="true" />
							<span>Kotak Masuk Pelanggan</span>
						</a>
					</SidebarMenuButton>
				</SidebarMenuItem>
			)}
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
	);
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
	const canPrint = roles.includes("owner") || roles.includes("warehouse");
	const canCatalog = catalogAccess(roles, permissions).read;
	const canSupport =
		roles.includes("owner") || roles.includes("customer_service");

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
							<SidebarGroup>
								<SidebarGroupLabel>Alat</SidebarGroupLabel>
								<SidebarGroupContent>
									<ToolLinks
										canCatalog={canCatalog}
										canPrint={canPrint}
										canSupport={canSupport}
									/>
								</SidebarGroupContent>
							</SidebarGroup>
						</nav>
					</SidebarContent>
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
