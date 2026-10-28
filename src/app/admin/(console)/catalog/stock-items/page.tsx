import { AccessDenied } from "../../../../../components/admin/access-denied";
import { catalogAccess } from "../../../../../components/admin/catalog-model";
import { StockItemsClient } from "../../../../../components/admin/stock-items-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "SKU Fisik · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only (spec 17 B9). The SKU dictionary API admits owner and ecommerce_admin; the HPP routes
// re-check finance.costs.read/write on every call and refuse the rest, whatever this page shows.
export default async function StockItemsPage() {
	const { roles, permissions } = await readStaffAccess();
	const access = catalogAccess(roles, permissions);
	if (!access.edit)
		return (
			<AccessDenied title="SKU Fisik" heading="Akses katalog diperlukan">
				Daftar SKU fisik dapat dibuka oleh Super Admin dan Admin E-Commerce dengan verifikasi dua langkah aktif. Staf keuangan mengatur HPP dari detail produk.
			</AccessDenied>
		);
	return <StockItemsClient costs={access.costs} costsWrite={access.costsWrite} />;
}
