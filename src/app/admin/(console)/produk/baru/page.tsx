import { AccessDenied } from "../../../../../components/admin/access-denied";
import { catalogAccess } from "../../../../../components/admin/catalog-model";
import { ProductCreateClient } from "../../../../../components/admin/product-create-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Tambah Produk · Admin 99ribu",
	robots: { index: false, follow: false },
};

export default async function AdminProductCreatePage() {
	const { roles, permissions } = await readStaffAccess();
	// Mirrors the catalog write authority (owner, ecommerce_admin); the APIs refuse on their own.
	const access = catalogAccess(roles, permissions);
	if (!access.edit)
		return (
			<AccessDenied title="Tambah Produk" heading="Akses ubah katalog diperlukan">
				Produk baru dapat dibuat oleh Super Admin atau Admin E-Commerce. Verifikasi dua langkah (MFA) harus aktif.
			</AccessDenied>
		);
	return <ProductCreateClient costsWrite={access.costsWrite} />;
}
