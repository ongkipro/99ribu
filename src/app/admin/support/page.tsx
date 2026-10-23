import { headers } from "next/headers";
import { StaffInboxView } from "../../../components/support/StaffInboxView";
import { getLocalAuth } from "../../../modules/access/auth.ts";
import { getPrincipal, hasPermission } from "../../../modules/access/policy.ts";
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
		canOpenOrders: boolean;
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
				// S100 order detail links; the page and API re-check scope.
				canOpenOrders: hasPermission(principal, "orders.history.read"),
			};
		}
	} catch {
		staffUser = null;
	}

	if (!staffUser) {
		return (
			<main className="receipt-shell" id="main">
				<header className="receipt-header">
					<p className="checkout-order-reference">
						<span>Konsol Operasional · 99ribu</span>
						<span>Layanan Pelanggan (CS)</span>
					</p>
					<h1>Antrean Layanan Pelanggan</h1>
					<p className="receipt-lead">
						Kotak masuk percakapan pembeli, eskalasi kendala pengiriman, dan
						tinjauan bukti pengajuan retur.
					</p>
				</header>
				<section className="notice-panel" data-testid="support-access-denied">
					<div className="receipt-parcel-head">
						<h2
							style={{
								margin: 0,
								fontSize: "var(--section-size)",
								lineHeight: "var(--section-leading)",
							}}
						>
							Sesi Operator Diperlukan
						</h2>
						<span className="receipt-badge" data-tone="warning">
							MFA Wajib
						</span>
					</div>
					<p>
						Halaman antrean bantuan hanya dapat diakses oleh staf dengan peran{" "}
						<strong>customer_service</strong> atau <strong>owner</strong> yang
						memiliki sesi MFA aktif. Peran finance, warehouse, dan
						ecommerce_admin biasa tidak memiliki akses ke kotak masuk layanan
						pelanggan.
					</p>
					<div className="notice-actions">
						<a className="button" href="/masuk?next=%2Fadmin%2Fsupport">
							Masuk sebagai staf
						</a>
						<a className="button button-secondary" href="/admin">
							Ke Konsol Operasional
						</a>
						<a className="button button-secondary" href="/bantuan">
							Halaman Bantuan Publik
						</a>
					</div>
				</section>
			</main>
		);
	}

	return <StaffInboxView staffUser={staffUser} />;
}
