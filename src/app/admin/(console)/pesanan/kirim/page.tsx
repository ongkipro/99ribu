import { ManualFulfillmentClient } from "../../../../../components/admin/manual-fulfillment-client";
import { AccessDenied } from "../../../../../components/admin/access-denied";
import { canReadOrders } from "../../../../../components/admin/order-model";
import { readStaffAccess } from "../../staff-roles";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pengiriman Manual · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; every API call re-checks role, MFA and warehouse scope.
export default async function ManualFulfillmentPage() {
	const { roles, permissions } = await readStaffAccess();
	const allowed = roles.some((r) => ["owner", "ecommerce_admin", "warehouse"].includes(r));
	if (!allowed)
		return (
			<AccessDenied title="Pengiriman Manual" heading="Akses pengiriman diperlukan">
				Halaman ini untuk Super Admin, Admin E-Commerce dan staf gudang dengan
				verifikasi dua langkah aktif. Staf gudang hanya melihat gudang yang ditugaskan.
			</AccessDenied>
		);
	return (
		<AdminPage>
			<PageHeader
				title="Pengiriman Manual"
				description={
					<>
						Pesan kurir di dashboard Mengantar 99ribu dengan penjemputan di gudang
						seller Berlapak, lalu catat kurir dan resi agar pembeli bisa melacak paketnya.
					</>
				}
			/>
			<ManualFulfillmentClient
				canManageProfiles={roles.some((r) => ["owner", "ecommerce_admin"].includes(r))}
				canManageCalendars={roles.includes("owner")}
				canViewOrders={canReadOrders(roles, permissions)}
			/>
		</AdminPage>
	);
}
