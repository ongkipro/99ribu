import { AccessDenied } from "../../../../components/admin/access-denied";
import { canReadOrders, readOrderFilters, readOrderTab, tabFilters } from "../../../../components/admin/order-model";
import { OrderSearchClient, type SearchKind } from "../../../../components/admin/orders-client";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pesanan · Admin 99ribu",
	robots: { index: false, follow: false },
};

const KINDS: SearchKind[] = ["nomor", "resi", "hp"];

// Navigation gate only; the API re-checks role, permission, MFA and whole-order warehouse scope.
export default async function AdminOrdersPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const [{ roles, permissions }, params] = await Promise.all([readStaffAccess(), searchParams]);
	if (!canReadOrders(roles, permissions))
		return (
			<AccessDenied title="Pesanan" heading="Akses riwayat pesanan diperlukan">
				Riwayat pesanan dapat dibuka oleh Super Admin, serta Admin E-Commerce, Layanan
				Pelanggan dan Keuangan yang memiliki izin baca riwayat pesanan. Staf gudang
				memakai antrean pengiriman gudangnya. Verifikasi dua langkah (MFA) harus aktif.
			</AccessDenied>
		);
	const one = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : "");
	const kind = one("jenis") as SearchKind;
	const filters = readOrderFilters(one);
	const tab = readOrderTab(one("tab"), filters);
	// Keyed by tab: a tab link remounts the list with that tab's filters.
	return (
		<OrderSearchClient
			key={tab}
			tab={tab}
			initialKind={KINDS.includes(kind) ? kind : "nomor"}
			// A phone suffix never arrives through the URL (see searchQuery).
			initialTerm={kind === "hp" ? "" : one("cari").slice(0, 100)}
			initialFilters={tabFilters(tab, filters)}
			companyWide={roles.includes("owner")}
		/>
	);
}
