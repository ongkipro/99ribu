import { AccessDenied } from "../../../../../components/admin/access-denied";
import {
	ADMIN_REFUND_STATUSES,
	financeAccess,
} from "../../../../../components/admin/finance-model";
import { RefundsListClient } from "../../../../../components/admin/finance-refunds-client";
import { canReadOrders } from "../../../../../components/admin/order-model";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pengembalian Dana · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the refunds API re-checks finance.refunds.read/write and MFA on every call.
export default async function FinanceRefundsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const [{ roles, permissions }, query] = await Promise.all([
		readStaffAccess(),
		searchParams,
	]);
	const access = financeAccess(roles, permissions);
	if (!access.refundRead) {
		return (
			<AccessDenied title="Pengembalian Dana" heading="Akses pengembalian dana diperlukan">
				Halaman ini untuk Super Admin atau staf keuangan dengan izin baca refund
				(finance.refunds.read) dan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	}
	const status =
		ADMIN_REFUND_STATUSES.find((value) => value === query.status) ?? null;

	return (
		<AdminPage testId="refunds-screen">
			<PageHeader
				title="Pengembalian Dana"
				description="Kewajiban pengembalian dana dari klaim retur yang disetujui. Rekonsiliasi hasil pengiriman dana yang tertahan atau coba ulang kegagalan yang terbukti tanpa dana keluar."
			/>
			<RefundsListClient
				access={access}
				canOrders={canReadOrders(roles, permissions)}
				initialStatus={status}
			/>
		</AdminPage>
	);
}
