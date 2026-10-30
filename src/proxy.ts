import { type NextRequest, NextResponse } from "next/server.js";
import { CONSOLE_PATH_HEADER } from "./modules/access/return-to.ts";

// S-U1 (redesign plan §4.2): admin page routes moved from English to Indonesian slugs. Every old page path answers
// 308 to its new path; the rest of the path (detail number, sub-page) and the query string are kept. /api/v1 is not
// matched here and keeps its English paths. Order matters: a longer old prefix precedes the prefix it extends.
export const LEGACY_ADMIN_ROUTES: readonly (readonly [string, string])[] = [
	["/admin/queue", "/admin/antrian"],
	["/admin/orders", "/admin/pesanan"],
	["/admin/fulfillment", "/admin/pesanan/kirim"],
	["/admin/print-center", "/admin/pesanan/cetak-label"],
	["/admin/exceptions", "/admin/pesanan/kendala"],
	["/admin/returns", "/admin/pesanan/retur"],
	["/admin/support", "/admin/obrolan"],
	["/admin/customers", "/admin/pelanggan"],
	["/admin/buyer-segments", "/admin/pelanggan/segmen"],
	["/admin/catalog/categories", "/admin/produk/kategori"],
	["/admin/catalog/stock-items", "/admin/produk/sku"],
	["/admin/catalog", "/admin/produk"],
	["/admin/inventory/transfers", "/admin/produk/inventori/transfer"],
	["/admin/inventory", "/admin/produk/inventori"],
	["/admin/warehouses", "/admin/produk/gudang"],
	["/admin/promotions/shipping", "/admin/promo/ongkir"],
	["/admin/banners", "/admin/banner"],
	["/admin/affiliates", "/admin/afiliasi"],
	["/admin/finance/summary", "/admin/keuangan"],
	["/admin/payments", "/admin/keuangan/pembayaran"],
	["/admin/cod-settlements", "/admin/keuangan/cod"],
	["/admin/finance/reconciliation", "/admin/keuangan/rekonsiliasi"],
	["/admin/finance/refunds", "/admin/keuangan/refund"],
	["/admin/finance/payouts", "/admin/keuangan/komisi"],
	["/admin/settings/staff", "/admin/pengaturan/staf"],
	["/admin/settings/commercial", "/admin/pengaturan/komersial"],
	["/admin/settings/payment", "/admin/pengaturan/pembayaran"],
	["/admin/settings/label-templates", "/admin/pengaturan/label"],
	["/admin/settings/advertising", "/admin/pemasaran/iklan"],
	["/admin/settings/support", "/admin/pengaturan/balasan-cs"],
	["/admin/settings/audit", "/admin/pengaturan/audit"],
	["/admin/settings/system", "/admin/pengaturan/sistem"],
	["/admin/account/security", "/admin/akun/keamanan"],
	["/admin/account", "/admin/akun/profil"],
];

/** The new path for an old admin page path (segment-exact prefix match), or null when the path is not an old one. */
export function legacyAdminPath(pathname: string): string | null {
	for (const [from, to] of LEGACY_ADMIN_ROUTES)
		if (pathname === from || pathname.startsWith(`${from}/`)) return to + pathname.slice(from.length);
	return null;
}

// S128: layouts cannot see the request path, so the console layout reads it from this header to send a
// signed-out production request to /portal?next=<path>. The value is always overwritten here (a client copy
// never survives) and is still validated as a console path before use. No auth decision is made here.
export function proxy(request: NextRequest) {
	const moved = legacyAdminPath(request.nextUrl.pathname);
	if (moved) {
		const url = request.nextUrl.clone();
		url.pathname = moved;
		return NextResponse.redirect(url, 308);
	}
	const headers = new Headers(request.headers);
	headers.set(
		CONSOLE_PATH_HEADER,
		request.nextUrl.pathname + request.nextUrl.search,
	);
	return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
