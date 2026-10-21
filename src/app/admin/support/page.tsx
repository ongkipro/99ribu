import { headers } from "next/headers";
import { StaffInboxView } from "../../../components/support/StaffInboxView";
import { getLocalAuth } from "../../../modules/access/auth.ts";
import { getPrincipal } from "../../../modules/access/policy.ts";
import { canManageSupportTools } from "../../../modules/support/service.ts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Antrean Layanan Pelanggan (CS Inbox)" };

export default async function AdminSupportPage() {
	const reqHeaders = await headers();
	const identity = getLocalAuth();
	let staffUser: {
		id: string;
		roles: string[];
		canManageTools: boolean;
	} | null = null;
	try {
		const request = new Request("http://localhost:3099/admin/support", {
			headers: new Headers(reqHeaders),
		});
		const principal = await getPrincipal(request, identity);
		if (
			principal.roles.includes("owner") ||
			principal.roles.includes("customer_service")
		) {
			staffUser = {
				id: principal.id,
				roles: [...principal.roles],
				canManageTools: canManageSupportTools(principal),
			};
		}
	} catch {
		staffUser = null;
	}

	if (!staffUser) {
		return (
			<main
				id="main"
				className="wrap"
				style={{ paddingBlock: "40px", maxWidth: "42rem" }}
			>
				<h1>Akses Ditolak</h1>
				<p style={{ marginTop: "12px", lineHeight: 1.7, color: "#5b5b63" }}>
					Halaman antrean bantuan hanya dapat diakses oleh staf dengan peran{" "}
					<strong>customer_service</strong> atau <strong>owner</strong> yang
					memiliki sesi MFA aktif. Peran finance, warehouse, dan ecommerce_admin
					biasa tidak memiliki akses ke kotak masuk layanan pelanggan.
				</p>
			</main>
		);
	}

	return <StaffInboxView staffUser={staffUser} />;
}
