import { ManualFulfillmentClient } from "../../../../components/admin/manual-fulfillment-client";
import { AccessDenied } from "../../../../components/admin/access-denied";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pengiriman Manual · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; every API call re-checks role, MFA and warehouse scope.
export default async function ManualFulfillmentPage() {
	const { roles } = await readStaffAccess();
	const allowed = roles.some((r) => ["owner", "ecommerce_admin", "warehouse"].includes(r));
	if (!allowed)
		return (
			<AccessDenied title="Pengiriman Manual" heading="Akses pengiriman diperlukan">
				Halaman ini untuk Super Admin, Admin E-Commerce dan staf gudang dengan
				verifikasi dua langkah aktif. Staf gudang hanya melihat gudang yang ditugaskan.
			</AccessDenied>
		);
	return (
		<div className="flex flex-col gap-6 px-4 py-5 md:px-8 md:py-6">
			<header className="flex flex-col gap-1.5 border-b pb-5">
				<h1 className="text-2xl font-semibold tracking-tight">Pengiriman Manual</h1>
				<p className="max-w-prose text-sm text-muted-foreground">
					Pesan kurir di dashboard Mengantar 99ribu dengan penjemputan di gudang
					seller Berlapak, lalu catat kurir dan resi agar pembeli bisa melacak paketnya.
				</p>
			</header>
			<ManualFulfillmentClient
				canManageProfiles={roles.some((r) => ["owner", "ecommerce_admin"].includes(r))}
			/>
		</div>
	);
}
