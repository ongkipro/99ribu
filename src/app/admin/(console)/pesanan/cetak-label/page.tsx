import { ShieldAlert } from "lucide-react";
import { canReadOrders } from "../../../../../components/admin/order-model";
import { PrintCenterClient } from "../../../../../components/admin/print-center-client";
import { Button } from "../../../../../components/ui/button";
import { getLocalAuth } from "../../../../../modules/access/auth";
import { readPrintCenterWorkspace } from "../../../../../modules/documents/labels";
import { storefrontRequest } from "../../../../../modules/storefront/browser";
import { readStaffAccess } from "../../staff-roles";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pusat Cetak Label Pengiriman · Admin 99ribu",
	robots: { index: false, follow: false },
};

export default async function AdminPrintCenterPage() {
	const req = await storefrontRequest("GET", "/admin/pesanan/cetak-label");
	const workspace = await readPrintCenterWorkspace(req, getLocalAuth());
	const staff = await readStaffAccess();

	if (!workspace.authorized) {
		return (
			<AdminPage>
				<PageHeader
					titleTestId="print-center-heading"
					title="Pusat Cetak Label Pengiriman"
					description={
						<>
							Cetak label pengiriman Thermal 100×150 mm atau A4 tanpa mengubah
							status pengemasan atau serah terima kurir secara otomatis.
						</>
					}
				/>
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
							<a href="/portal?next=%2Fadmin%2Fpesanan%2Fcetak-label">
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
			</AdminPage>
		);
	}

	return (
		<AdminPage>
			<PageHeader
				titleTestId="print-center-heading"
				title="Pusat Cetak Label Pengiriman"
				description={
					<>
						Buat dan cetak label Thermal 100×150 mm atau A4. Mencetak label tidak
						mengubah status pengemasan atau serah terima kurir.
					</>
				}
			/>
			<PrintCenterClient
				initialTemplates={workspace.templates}
				initialShipments={workspace.shipments}
				initialArtifacts={workspace.artifacts}
				initialAttempts={workspace.attempts}
				initialNextCursor={workspace.next_cursor}
				canOrders={canReadOrders(staff.roles, staff.permissions)}
			/>
		</AdminPage>
	);
}
