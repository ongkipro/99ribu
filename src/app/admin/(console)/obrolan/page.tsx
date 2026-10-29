import { AccessDenied } from "../../../../components/admin/access-denied";
import { StaffInboxView } from "../../../../components/support/StaffInboxView";
import { getLocalAuth } from "../../../../modules/access/auth";
import { getPrincipal, hasPermission } from "../../../../modules/access/policy";
import { storefrontRequest } from "../../../../modules/storefront/browser";
import { canManageSupportTools } from "../../../../modules/support/service";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Kotak Masuk Pelanggan · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; every support API re-checks role, MFA and claim.
export default async function AdminSupportPage() {
	let staffUser: {
		id: string;
		roles: string[];
		canManageTools: boolean;
		canOpenOrders: boolean;
	} | null = null;
	try {
		const principal = await getPrincipal(
			await storefrontRequest("GET", "/admin/obrolan"),
			getLocalAuth(),
		);
		if (
			principal.roles.includes("owner") ||
			principal.roles.includes("customer_service")
		) {
			staffUser = {
				id: principal.id,
				roles: [...principal.roles],
				canManageTools: canManageSupportTools(principal),
				// S100 order detail links; the page and API re-check scope.
				canOpenOrders: hasPermission(principal, "orders.history.read"),
			};
		}
	} catch {
		staffUser = null;
	}

	if (!staffUser)
		return (
			<AccessDenied
				title="Kotak Masuk Pelanggan"
				heading="Akses layanan pelanggan diperlukan"
			>
				Halaman ini untuk Super Admin atau staf layanan pelanggan dengan
				verifikasi dua langkah aktif. Peran keuangan, gudang, dan admin
				e-commerce tidak membuka kotak masuk pelanggan.
			</AccessDenied>
		);

	return <StaffInboxView staffUser={staffUser} />;
}
