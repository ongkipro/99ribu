import { ShieldAlert } from "lucide-react";
import { canReadOrders } from "../../../../components/admin/order-model";
import { PrintCenterClient } from "../../../../components/admin/print-center-client";
import { Button } from "../../../../components/ui/button";
import { getLocalAuth } from "../../../../modules/access/auth";
import { readPrintCenterWorkspace } from "../../../../modules/documents/labels";
import { storefrontRequest } from "../../../../modules/storefront/browser";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pusat Cetak Label Pengiriman · Admin 99ribu",
	robots: { index: false, follow: false },
};

export default async function AdminPrintCenterPage() {
	const req = await storefrontRequest("GET", "/admin/print-center");
	const workspace = await readPrintCenterWorkspace(req, getLocalAuth());
	const staff = await readStaffAccess();

	if (!workspace.authorized) {
		return (
			<div className="flex flex-col gap-6 px-4 py-5 md:px-8 md:py-6">
				<header className="flex flex-col gap-1.5 border-b pb-5">
					<h1
						data-testid="print-center-heading"
						className="text-2xl font-semibold tracking-tight"
					>
						Pusat Cetak Label Pengiriman
					</h1>
					<p className="max-w-prose text-sm text-muted-foreground">
						Cetak label pengiriman Thermal 100×150 mm atau A4 tanpa mengubah
						status pengemasan atau serah terima kurir secara otomatis.
					</p>
				</header>
				<section
					data-testid="print-center-denied"
					aria-labelledby="print-center-denied-heading"
					className="flex max-w-2xl flex-col gap-3 rounded-lg border border-warning/40 bg-warning-surface p-5"
				>
					<div className="flex flex-wrap items-center gap-2">
						<ShieldAlert aria-hidden="true" className="size-5 text-warning" />
						<h2
							id="print-center-denied-heading"
							className="text-base font-semibold"
						>
							Sesi Operator Gudang Diperlukan
						</h2>
					</div>
					<p className="text-sm leading-relaxed">
						Masuk sebagai staf gudang atau Super Admin dengan verifikasi dua
						langkah (MFA) aktif. Staf gudang hanya dapat mencetak label untuk
						gudang yang ditugaskan.
					</p>
					<p className="text-xs text-muted-foreground">
						Kode akses: {workspace.code}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button asChild>
							<a href="/masuk?next=%2Fadmin%2Fprint-center">
								Masuk sebagai staf
							</a>
						</Button>
						<Button asChild variant="outline" className="bg-background">
							<a href="/admin?workspace=warehouse">Ke Ruang Kerja Gudang</a>
						</Button>
						<Button asChild variant="outline" className="bg-background">
							{/* Full document navigation: the storefront must not inherit the console stylesheet. */}
							<a href="/">Kembali ke Toko</a>
						</Button>
					</div>
				</section>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6 px-4 py-5 md:px-8 md:py-6">
			<header className="flex flex-col gap-1.5 border-b pb-5">
				<h1
					data-testid="print-center-heading"
					className="text-2xl font-semibold tracking-tight"
				>
					Pusat Cetak Label Pengiriman
				</h1>
				<p className="max-w-prose text-sm text-muted-foreground">
					Buat dan cetak label Thermal 100×150 mm atau A4. Mencetak label tidak
					mengubah status pengemasan atau serah terima kurir.
				</p>
			</header>
			<PrintCenterClient
				initialTemplates={workspace.templates}
				initialShipments={workspace.shipments}
				initialArtifacts={workspace.artifacts}
				initialAttempts={workspace.attempts}
				initialNextCursor={workspace.next_cursor}
				canOrders={canReadOrders(staff.roles, staff.permissions)}
			/>
		</div>
	);
}
