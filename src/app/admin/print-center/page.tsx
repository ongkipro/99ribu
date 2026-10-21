import { PrintCenterClient } from "../../../components/admin/print-center-client";
import { getLocalAuth } from "../../../modules/access/auth";
import { readPrintCenterWorkspace } from "../../../modules/documents/labels";
import { storefrontRequest } from "../../../modules/storefront/browser";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pusat Cetak Label Pengiriman · Admin 99ribu",
	robots: { index: false, follow: false },
};

export default async function AdminPrintCenterPage() {
	const req = await storefrontRequest("GET", "/admin/print-center");
	const workspace = await readPrintCenterWorkspace(req, getLocalAuth());

	if (!workspace.authorized) {
		return (
			<main className="receipt-shell" id="main">
				<section className="receipt-card" data-testid="print-center-denied">
					<h1>Pusat Cetak Label Pengiriman Gudang</h1>
					<p>
						Halaman ini memerlukan sesi operator gudang atau pemilik dengan MFA
						terverifikasi ({workspace.code}).
					</p>
				</section>
			</main>
		);
	}

	return (
		<main className="receipt-shell" id="main">
			<header className="receipt-header">
				<p className="checkout-order-reference">
					<span>Operasional Gudang 99ribu</span>
					<span>Operator: {workspace.principal.id}</span>
				</p>
				<h1>Pusat Cetak Label Pengiriman</h1>
				<p className="receipt-lead">
					Cetak label pengiriman Thermal 100×150 mm atau A4. Pencetakan label
					tidak mengubah status pengemasan atau serah terima kurir secara
					otomatis.
				</p>
			</header>
			<PrintCenterClient
				initialTemplates={workspace.templates}
				initialShipments={workspace.shipments}
				initialArtifacts={workspace.artifacts}
				initialAttempts={workspace.attempts}
			/>
		</main>
	);
}
