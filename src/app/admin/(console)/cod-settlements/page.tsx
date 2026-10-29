import { CodSettlementsClient } from "../../../../components/admin/cod-settlements-client";
import { AccessDenied } from "../../../../components/admin/access-denied";
import { consoleAccess } from "../../../../components/admin/console-access";
import { readStaffAccess } from "../staff-roles";
import { AdminPage, PageHeader } from "../../../../components/admin/page-blocks";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Setoran COD Mengantar · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the API re-checks finance reconciliation authority and proof.
export default async function CodSettlementsPage() {
	const { roles, permissions } = await readStaffAccess();
	const access = consoleAccess(roles, permissions);
	if (!access.reconcileRead)
		return (
			<AccessDenied title="Setoran COD Mengantar" heading="Akses rekonsiliasi keuangan diperlukan">
				Halaman ini untuk Super Admin atau staf keuangan dengan izin rekonsiliasi
				dan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	return (
		<AdminPage>
			<PageHeader
				title="Setoran COD Mengantar"
				description={
					<>
						Catat laporan saldo COD dari dasbor Mengantar. Penerimaan per paket dan
						dana masuk dicocokkan otomatis; selisih ditandai untuk ditinjau.
					</>
				}
			/>
			<CodSettlementsClient canWrite={access.reconcileWrite} />
		</AdminPage>
	);
}
