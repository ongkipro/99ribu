import { AccessDenied } from "../../../../components/admin/access-denied";
import { financeAccess } from "../../../../components/admin/finance-model";
import { FinanceSummaryClient } from "../../../../components/admin/finance-summary-client";
import { AdminPage, PageHeader } from "../../../../components/admin/page-blocks";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Laporan Keuangan · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the finance summary and dashboard APIs re-check finance.summary.read and MFA on every call.
export default async function FinanceSummaryPage() {
	const { roles, permissions } = await readStaffAccess();
	const access = financeAccess(roles, permissions);
	if (!access.summaryRead) {
		return (
			<AccessDenied
				title="Laporan Keuangan"
				heading="Akses laporan keuangan diperlukan"
			>
				Halaman ini untuk Super Admin atau staf keuangan dengan izin baca ringkasan keuangan
				(finance.summary.read) dan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	}
	return (
		<AdminPage testId="finance-summary-screen">
			<PageHeader
				title="Laporan Keuangan"
				description="Posisi kas terekonsiliasi, piutang, kewajiban, pendapatan bersih barang dagangan, HPP diakui, dan kontribusi margin pada rentang periode maksimal 366 hari."
			/>
			<FinanceSummaryClient />
		</AdminPage>
	);
}
