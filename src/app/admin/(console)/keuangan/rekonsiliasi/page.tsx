import { AccessDenied } from "../../../../../components/admin/access-denied";
import {
	financeAccess,
	RECONCILIATION_PROVIDERS,
	RECONCILIATION_STATUSES,
} from "../../../../../components/admin/finance-model";
import { ReconciliationListClient } from "../../../../../components/admin/finance-reconciliation-client";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Rekonsiliasi Keuangan · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the reconciliation API re-checks finance.reconciliation.read/write and MFA on every call.
export default async function FinanceReconciliationPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const [{ roles, permissions }, query] = await Promise.all([
		readStaffAccess(),
		searchParams,
	]);
	const access = financeAccess(roles, permissions);
	if (!access.reconcileRead) {
		return (
			<AccessDenied
				title="Rekonsiliasi Keuangan"
				heading="Akses rekonsiliasi keuangan diperlukan"
			>
				Halaman ini untuk Super Admin atau staf keuangan dengan izin baca rekonsiliasi
				(finance.reconciliation.read) dan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	}
	const status =
		RECONCILIATION_STATUSES.find((value) => value === query.status) ?? null;
	const provider =
		RECONCILIATION_PROVIDERS.find((value) => value === query.provider) ?? null;
	const reference =
		typeof query.reference === "string" && query.reference.trim()
			? query.reference.trim()
			: null;

	return (
		<AdminPage testId="reconciliation-screen">
			<PageHeader
				title="Rekonsiliasi Keuangan"
				description="Pencairan pembayaran prabayar dan setoran COD Mengantar. Cocokkan piutang pesanan, lepas kecocokan yang keliru, atau eskalasi mutasi yang memerlukan tinjauan."
			/>
			<ReconciliationListClient
				access={access}
				initialStatus={status}
				initialProvider={provider}
				initialReference={reference}
			/>
		</AdminPage>
	);
}
