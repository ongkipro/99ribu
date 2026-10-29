import { AccessDenied } from "../../../../../components/admin/access-denied";
import { WarehousesClient } from "../../../../../components/admin/warehouses-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Gudang · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only (spec 17 B11). The warehouse API re-checks role, MFA and membership on every call;
// every role except the owner sees only the warehouses it is assigned to.
export default async function WarehousesPage() {
	const { roles } = await readStaffAccess();
	if (!roles.some((role) => ["owner", "ecommerce_admin", "warehouse"].includes(role)))
		return (
			<AccessDenied title="Gudang" heading="Akses gudang diperlukan">
				Daftar gudang dapat dibuka oleh Super Admin, Admin E-Commerce dan staf gudang dengan verifikasi dua langkah aktif. Selain Super Admin, hanya gudang yang ditugaskan yang terlihat.
			</AccessDenied>
		);
	return <WarehousesClient all={roles.includes("owner")} />;
}
