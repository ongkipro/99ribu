import { CodSettlementsClient } from "../../../../components/admin/cod-settlements-client";
import { AccessDenied } from "../../../../components/admin/access-denied";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Setoran COD Mengantar · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the API re-checks finance reconciliation authority and proof.
export default async function CodSettlementsPage() {
	const { roles, permissions } = await readStaffAccess();
	const allowed = roles.includes("owner") || (roles.includes("finance") && permissions.includes("finance.reconciliation.read"));
	if (!allowed)
		return (
			<AccessDenied title="Setoran COD Mengantar" heading="Akses rekonsiliasi keuangan diperlukan">
				Halaman ini untuk Super Admin atau staf keuangan dengan izin rekonsiliasi
				dan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	return (
		<div className="flex flex-col gap-6 px-4 py-5 md:px-8 md:py-6">
			<header className="flex flex-col gap-1.5 border-b pb-5">
				<h1 className="text-2xl font-semibold tracking-tight">Setoran COD Mengantar</h1>
				<p className="max-w-prose text-sm text-muted-foreground">
					Catat laporan saldo COD dari dashboard Mengantar. Penerimaan per paket dan
					dana masuk dicocokkan otomatis; selisih ditandai untuk ditinjau.
				</p>
			</header>
			<CodSettlementsClient />
		</div>
	);
}
