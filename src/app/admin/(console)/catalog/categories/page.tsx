import { AccessDenied } from "../../../../../components/admin/access-denied";
import { catalogAccess } from "../../../../../components/admin/catalog-model";
import { CategoriesClient } from "../../../../../components/admin/categories-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Kategori · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only (spec 17 B10: owner and ecommerce_admin). The category API re-checks role, MFA and
// scope on every call; creating is owner/ecommerce_admin there as well.
export default async function CategoriesPage() {
	const { roles, permissions } = await readStaffAccess();
	if (!catalogAccess(roles, permissions).edit)
		return (
			<AccessDenied title="Kategori" heading="Akses katalog diperlukan">
				Kategori dapat dikelola oleh Super Admin dan Admin E-Commerce dengan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	return <CategoriesClient />;
}
