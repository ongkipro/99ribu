// S-V1 console navigation (redesign plan §4.1, tokophi seller-admin pattern): one nav tree per role
// lens, collapsible groups, exactly one active row. Display only: every item is filtered through
// the same role/grant rules the destination page enforces, so a lens never widens access, and
// every page and API re-checks on the server. No "use client": unit tests and server pages import it.
import {
	Activity,
	ChartColumn,
	ClipboardCheck,
	Eye,
	House,
	Landmark,
	type LucideIcon,
	Megaphone,
	MessageSquare,
	MessagesSquare,
	Package,
	Printer,
	ReceiptText,
	Scale,
	ScrollText,
	Settings,
	Store,
	TicketPercent,
	UserCog,
	UsersRound,
	Wallet,
	Warehouse,
} from "lucide-react";
import type { CanonicalWorkspace } from "./admin-workspaces-client";
import { catalogAccess } from "./catalog-model.ts";
import { consoleAccess } from "./console-access.ts";
import { financeAccess } from "./finance-model.ts";
import { canReadOrders } from "./order-model.ts";
import { returnAccess } from "./return-model.ts";

/** Cookie that remembers the last lens outside the home page (display only; never an authority). */
export const LENS_COOKIE = "admin_lens";

/** Live counts a nav row can carry: dashboard metric keys (src/modules/reporting/shared.ts). */
export type NavBadgeKey = "fulfillments_due" | "support_unassigned";
export type NavCounts = Partial<Record<NavBadgeKey, number>>;
export const NAV_BADGE_LABELS: Record<NavBadgeKey, string> = {
	fulfillments_due: "paket belum diserahkan",
	support_unassigned: "chat belum diklaim",
};

export type NavChild = {
	label: string;
	href: string;
	/** Transition link: shown only while this replacement page is still unbuilt (plan §4.1, S-O1). */
	until?: string;
};
export type NavItem = {
	label: string;
	href: string;
	icon: LucideIcon;
	badge?: NavBadgeKey;
	children?: NavChild[];
};
export type NavSection = { label?: string; items: NavItem[] };

/**
 * The built flag list: pages defined in the nav whose route does not exist yet. A row that opens
 * onto nothing is not shown (tokophi IA rule). The slice that builds a page deletes its line here.
 */
export const UNBUILT_PAGES: ReadonlySet<string> = new Set([
	"/admin/persetujuan", // S-A0
	"/admin/pantauan", // S-O1
	"/admin/pantauan/katalog", // S-O1
	"/admin/pantauan/stok", // S-O1
	"/admin/pantauan/kendala", // S-O1
	"/admin/analitik", // S-A1
	"/admin/pemasaran", // Pemasaran hub, later slice
	"/admin/halaman", // S-C1
	"/admin/media", // S-C1
	"/admin/produk/baru", // S-P1
]);

const HOME: NavItem = { label: "Beranda", href: "/admin", icon: House };

/** Plan §4.1, one tree per role lens. Parent rows link to their main page; the chevron opens the children. */
export const NAV_BY_LENS: Record<CanonicalWorkspace, NavSection[]> = {
	// Monitor, approver, governor (not an operator). Until S-O1 merges, "Pantauan" keeps the existing
	// operational pages as transition links (plan §4.1 "Transition (for S-V1)").
	owner: [
		{
			items: [
				HOME,
				{ label: "Persetujuan", href: "/admin/persetujuan", icon: ClipboardCheck },
				{
					label: "Pantauan",
					href: "/admin/pantauan",
					icon: Eye,
					children: [
						{ label: "Pesanan", href: "/admin/pesanan" },
						{ label: "Katalog", href: "/admin/pantauan/katalog" },
						{ label: "Produk", href: "/admin/produk", until: "/admin/pantauan/katalog" },
						{ label: "Stok", href: "/admin/pantauan/stok" },
						{ label: "Stok", href: "/admin/produk/inventori", until: "/admin/pantauan/stok" },
						{ label: "Kendala & Retur", href: "/admin/pantauan/kendala" },
						{ label: "Kendala Pengiriman", href: "/admin/pesanan/kendala", until: "/admin/pantauan/kendala" },
						{ label: "Retur", href: "/admin/pesanan/retur", until: "/admin/pantauan/kendala" },
					],
				},
				{
					label: "Keuangan",
					href: "/admin/keuangan",
					icon: Wallet,
					children: [
						{ label: "Laporan Keuangan", href: "/admin/keuangan" },
						{ label: "Rekonsiliasi", href: "/admin/keuangan/rekonsiliasi" },
						{ label: "Komisi Afiliasi", href: "/admin/keuangan/komisi" },
					],
				},
				{ label: "Analitik", href: "/admin/analitik", icon: ChartColumn },
				{ label: "Pemasaran", href: "/admin/pemasaran", icon: Megaphone },
				{
					label: "Pengaturan",
					href: "/admin/pengaturan",
					icon: Settings,
					children: [
						{ label: "Staf & Peran", href: "/admin/pengaturan/staf" },
						{ label: "Kebijakan Komersial", href: "/admin/pengaturan/komersial" },
						{ label: "Pembayaran & COD", href: "/admin/pengaturan/pembayaran" },
						{ label: "Tarif Afiliasi", href: "/admin/afiliasi" },
						{ label: "Gudang", href: "/admin/produk/gudang" },
						{ label: "Integrasi Iklan", href: "/admin/pemasaran/iklan" },
						{ label: "Log Audit", href: "/admin/pengaturan/audit" },
						{ label: "Kesehatan Sistem", href: "/admin/pengaturan/sistem" },
					],
				},
			],
		},
	],
	ecommerce_admin: [
		{
			items: [
				HOME,
				{
					label: "Pesanan",
					href: "/admin/pesanan?tab=perlu_dikirim",
					icon: ReceiptText,
					badge: "fulfillments_due",
					children: [
						{ label: "Semua Pesanan", href: "/admin/pesanan" },
						{ label: "Retur", href: "/admin/pesanan/retur" },
					],
				},
				{
					label: "Produk",
					href: "/admin/produk",
					icon: Package,
					children: [
						{ label: "Tambah Produk", href: "/admin/produk/baru" },
						{ label: "SKU & HPP", href: "/admin/produk/sku" },
						{ label: "Kategori", href: "/admin/produk/kategori" },
						{ label: "Inventori", href: "/admin/produk/inventori" },
						{ label: "Transfer Stok", href: "/admin/produk/inventori/transfer" },
					],
				},
				{
					label: "Promo",
					href: "/admin/promo/ongkir",
					icon: TicketPercent,
					children: [
						{ label: "Banner", href: "/admin/banner" },
						{ label: "Segmen Pembeli", href: "/admin/pelanggan/segmen" },
					],
				},
				{
					label: "Toko Online",
					href: "/admin/halaman",
					icon: Store,
					children: [{ label: "Media", href: "/admin/media" }],
				},
			],
		},
	],
	warehouse: [
		{
			items: [
				HOME,
				{
					label: "Pesanan",
					href: "/admin/pesanan?tab=perlu_dikirim",
					icon: ReceiptText,
					badge: "fulfillments_due",
					children: [
						{ label: "Input Resi", href: "/admin/pesanan/kirim" },
						{ label: "Cetak Label", href: "/admin/pesanan/cetak-label" },
						{ label: "Kendala Pengiriman", href: "/admin/pesanan/kendala" },
						{ label: "Retur", href: "/admin/pesanan/retur" },
					],
				},
				{
					label: "Produk",
					href: "/admin/produk/inventori",
					icon: Package,
					children: [{ label: "Transfer Stok", href: "/admin/produk/inventori/transfer" }],
				},
			],
		},
	],
	customer_service: [
		{
			items: [
				HOME,
				{ label: "Obrolan", href: "/admin/obrolan", icon: MessageSquare, badge: "support_unassigned" },
				{
					label: "Pesanan",
					href: "/admin/pesanan",
					icon: ReceiptText,
					children: [
						{ label: "Kendala Pengiriman", href: "/admin/pesanan/kendala" },
						{ label: "Retur", href: "/admin/pesanan/retur" },
					],
				},
				{ label: "Pelanggan", href: "/admin/pelanggan", icon: UsersRound },
			],
		},
	],
	finance: [
		{
			items: [
				HOME,
				{
					label: "Keuangan",
					href: "/admin/keuangan",
					icon: Wallet,
					children: [
						{ label: "Pembayaran Masuk", href: "/admin/keuangan/pembayaran" },
						{ label: "Setoran COD", href: "/admin/keuangan/cod" },
						{ label: "Rekonsiliasi", href: "/admin/keuangan/rekonsiliasi" },
						{ label: "Pengembalian Dana", href: "/admin/keuangan/refund" },
						{ label: "Komisi Afiliasi", href: "/admin/keuangan/komisi" },
					],
				},
				{ label: "Pesanan", href: "/admin/pesanan", icon: ReceiptText },
			],
		},
	],
};

/** Settings cards of `/admin/pengaturan` (plan §4.5), in order. */
export const SETTINGS_CARDS: { href: string; label: string; description: string; icon: LucideIcon }[] = [
	{ href: "/admin/pengaturan/staf", label: "Staf & Peran", icon: UserCog, description: "Daftar staf, peran, izin tambahan, cakupan gudang dan reset MFA." },
	{ href: "/admin/pengaturan/komersial", label: "Kebijakan Komersial", icon: Scale, description: "Batas kontribusi minimum dan nilai bawaan, berversi." },
	{ href: "/admin/pengaturan/pembayaran", label: "Pembayaran & COD", icon: Landmark, description: "Biaya COD dan rekening transfer manual, berversi." },
	{ href: "/admin/produk/gudang", label: "Gudang", icon: Warehouse, description: "Daftar gudang, profil penjemputan dan kalender pengiriman." },
	{ href: "/admin/pengaturan/label", label: "Template Label", icon: Printer, description: "Template label pengiriman yang dipakai pusat cetak." },
	{ href: "/admin/pengaturan/balasan-cs", label: "Balasan CS", icon: MessagesSquare, description: "Balasan tersimpan dan tag percakapan pelanggan." },
	{ href: "/admin/pemasaran/iklan", label: "Integrasi Iklan", icon: Megaphone, description: "Tujuan iklan Meta, Google dan TikTok serta diagnostiknya." },
	{ href: "/admin/pengaturan/audit", label: "Log Audit", icon: ScrollText, description: "Jejak tindakan staf yang tidak bisa diubah." },
	{ href: "/admin/pengaturan/sistem", label: "Kesehatan Sistem", icon: Activity, description: "Antrean outbox dan kondisi worker." },
];

type Rule = (roles: readonly string[], permissions: readonly string[]) => boolean;
const any =
	(...wanted: string[]): Rule =>
	(roles) =>
		wanted.some((r) => roles.includes(r));

/**
 * Who may open each page: the same rule as that page's server guard (comment names the guard).
 * A path missing here is never shown.
 */
const PAGE_RULES: Record<string, Rule> = {
	"/admin": () => true,
	"/admin/pesanan": canReadOrders,
	"/admin/pesanan/kirim": (r, p) => consoleAccess(r, p).ship,
	"/admin/pesanan/cetak-label": (r, p) => consoleAccess(r, p).print,
	// Exceptions and returns pages share the return read rule (S133).
	"/admin/pesanan/kendala": (r, p) => returnAccess(r, p).read,
	"/admin/pesanan/retur": (r, p) => returnAccess(r, p).read,
	"/admin/obrolan": (r, p) => consoleAccess(r, p).support,
	// Customer lookup (S138): owner and customer_service.
	"/admin/pelanggan": (r, p) => consoleAccess(r, p).support,
	"/admin/pelanggan/segmen": any("owner", "ecommerce_admin"),
	"/admin/produk": (r, p) => catalogAccess(r, p).read,
	// SKU & HPP: catalog editors, and for non-owners only with the cost read grant (plan §4.1).
	"/admin/produk/sku": (r, p) =>
		catalogAccess(r, p).edit && (r.includes("owner") || p.includes("finance.costs.read")),
	"/admin/produk/kategori": (r, p) => catalogAccess(r, p).edit,
	"/admin/produk/inventori": (r, p) => consoleAccess(r, p).inventory,
	"/admin/produk/inventori/transfer": (r, p) => consoleAccess(r, p).inventory,
	"/admin/produk/gudang": (r, p) => consoleAccess(r, p).inventory,
	"/admin/promo/ongkir": (r, p) => consoleAccess(r, p).shippingPromo,
	"/admin/banner": (r, p) => consoleAccess(r, p).banners,
	// Affiliates (S132, DEC-018 Q5): owner writes rates, finance reads.
	"/admin/afiliasi": any("owner", "finance"),
	"/admin/keuangan": (r, p) => financeAccess(r, p).summaryRead,
	"/admin/keuangan/pembayaran": (r, p) => consoleAccess(r, p).reconcileRead,
	"/admin/keuangan/cod": (r, p) => consoleAccess(r, p).reconcileRead,
	"/admin/keuangan/rekonsiliasi": (r, p) => financeAccess(r, p).reconcileRead,
	"/admin/keuangan/komisi": (r, p) => financeAccess(r, p).payouts,
	"/admin/keuangan/refund": (r, p) => financeAccess(r, p).refundRead,
	"/admin/pengaturan/staf": any("owner"),
	"/admin/pengaturan/sistem": any("owner"),
	"/admin/pengaturan/audit": any("owner", "finance"),
	"/admin/pengaturan/pembayaran": any("owner", "finance"),
	"/admin/pengaturan/komersial": any("owner", "finance"),
	"/admin/pengaturan/label": (r, p) =>
		any("owner", "ecommerce_admin", "warehouse", "finance")(r, p) || p.includes("shipping.labels.read"),
	"/admin/pengaturan/balasan-cs": (r, p) => consoleAccess(r, p).support,
	"/admin/pemasaran/iklan": any("owner"),
};
// The settings index opens when at least one of its cards does.
PAGE_RULES["/admin/pengaturan"] = (r, p) =>
	SETTINGS_CARDS.some((card) => PAGE_RULES[card.href]?.(r, p) ?? false);

const pathOf = (href: string) => href.split("?")[0];

/** True when the page is built and the principal's roles and grants open it. */
export function canOpen(href: string, roles: readonly string[], permissions: readonly string[]) {
	const path = pathOf(href);
	return !UNBUILT_PAGES.has(path) && (PAGE_RULES[path]?.(roles, permissions) ?? false);
}

/**
 * The visible tree for one lens. Children the principal cannot open are dropped; a parent whose own
 * page cannot be opened links to its first visible child; a parent with neither is dropped. Lenses
 * without the settings group get a plain "Pengaturan" row when the index has a card for them, so
 * pages such as Log Audit (finance) or Balasan CS stay reachable.
 */
export function navFor(
	lens: CanonicalWorkspace,
	roles: readonly string[],
	permissions: readonly string[],
): NavSection[] {
	const open = (href: string) => canOpen(href, roles, permissions);
	const sections: NavSection[] = [];
	for (const section of NAV_BY_LENS[lens]) {
		const items: NavItem[] = [];
		for (const item of section.items) {
			const children = (item.children ?? []).filter(
				(child) => (!child.until || UNBUILT_PAGES.has(child.until)) && open(child.href),
			);
			const own = open(item.href);
			if (!own && children.length === 0) continue;
			items.push({
				...item,
				href: own ? item.href : children[0].href,
				children: children.length > 0 ? children : undefined,
			});
		}
		if (items.length > 0) sections.push({ ...section, items });
	}
	const hasSettings = sections.some((s) => s.items.some((i) => pathOf(i.href) === "/admin/pengaturan"));
	if (!hasSettings && open("/admin/pengaturan"))
		sections.push({ items: [{ label: "Pengaturan", href: "/admin/pengaturan", icon: Settings }] });
	return sections;
}

/**
 * The one active href (port of tokophi `activeChildHref`, across the whole tree): the longest
 * matching path wins; a link with a query matches only when the URL carries it and then beats the
 * plain link of the same path (Pesanan `?tab=perlu_dikirim` vs Semua Pesanan); a child beats its
 * parent on a tie. Beranda matches only itself and the full work-queue page.
 */
export function activeHref(sections: NavSection[], pathname: string, search: URLSearchParams): string | null {
	// Children before their parent: on an equal score the first candidate keeps the highlight.
	const candidates = sections.flatMap((s) => s.items.flatMap((i) => [...(i.children ?? []).map((c) => c.href), i.href]));
	let best: string | null = null;
	let bestScore = -1;
	for (const href of candidates) {
		const [path, query = ""] = href.split("?");
		const pathMatch =
			path === "/admin"
				? pathname === "/admin" || pathname === "/admin/antrian"
				: pathname === path || pathname.startsWith(`${path}/`);
		if (!pathMatch) continue;
		const want = [...new URLSearchParams(query)];
		if (want.some(([key, value]) => search.get(key) !== value)) continue;
		const score = path.length * 100 + want.length;
		if (score > bestScore) {
			bestScore = score;
			best = href;
		}
	}
	return best;
}

/** A parent row lights up only when none of its children holds the same active link. */
export const parentActive = (item: NavItem, active: string | null) =>
	item.href === active && !(item.children ?? []).some((c) => c.href === active);

/** Rows the renderer highlights for one active href: always at most one. */
export function highlightedRows(sections: NavSection[], active: string | null) {
	return sections.flatMap((s) =>
		s.items.flatMap((i) => [
			...(parentActive(i, active) ? [i.label] : []),
			...(i.children ?? []).filter((c) => c.href === active).map((c) => `${i.label} > ${c.label}`),
		]),
	);
}
