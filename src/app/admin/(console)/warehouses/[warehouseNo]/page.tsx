import { AccessDenied } from "../../../../../components/admin/access-denied";
import { WarehouseDetailClient } from "../../../../../components/admin/warehouses-client";
import { resolveAdminId } from "@/modules/access/admin-number-page";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Detail Gudang · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only. The warehouse, pickup-profile (owner/ecommerce_admin) and calendar (owner) APIs each
// re-check role, MFA and membership; a warehouse outside the caller's scope answers 404.
export default async function WarehouseDetailPage({ params }: { params: Promise<{ warehouseNo: string }> }) {
	const [{ roles }, { warehouseNo }] = await Promise.all([readStaffAccess(), params]);
	if (!roles.some((role) => ["owner", "ecommerce_admin", "warehouse"].includes(role)))
		return (
			<AccessDenied title="Detail Gudang" heading="Akses gudang diperlukan">
				Detail gudang dapat dibuka oleh Super Admin, Admin E-Commerce dan staf gudang dengan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	const warehouseId = await resolveAdminId("warehouse", warehouseNo);
	return (
		<WarehouseDetailClient
			key={warehouseId}
			warehouseId={warehouseId}
			profileAccess={roles.some((role) => role === "owner" || role === "ecommerce_admin")}
			owner={roles.includes("owner")}
		/>
	);
}
