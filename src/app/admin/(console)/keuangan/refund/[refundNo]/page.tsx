import { AccessDenied } from "../../../../../../components/admin/access-denied";
import { financeAccess } from "../../../../../../components/admin/finance-model";
import { RefundDetailClient } from "../../../../../../components/admin/finance-refunds-client";
import { canReadOrders } from "../../../../../../components/admin/order-model";
import { resolveAdminId } from "@/modules/access/admin-number-page";
import { readStaffAccess } from "../../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Detail Pengembalian Dana · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; every read and reconciliation is re-authorized by the refunds API.
export default async function FinanceRefundDetailPage({
	params,
}: {
	params: Promise<{ refundNo: string }>;
}) {
	const [{ roles, permissions }, { refundNo }] = await Promise.all([
		readStaffAccess(),
		params,
	]);
	const access = financeAccess(roles, permissions);
	if (!access.refundRead) {
		return (
			<AccessDenied title="Detail Pengembalian Dana" heading="Akses pengembalian dana diperlukan">
				Detail refund dapat dibuka oleh Super Admin atau staf keuangan dengan izin baca refund
				(finance.refunds.read) dan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	}
	const refundId = await resolveAdminId("refund", refundNo);
	return (
		<RefundDetailClient
			key={refundId}
			refundId={refundId}
			access={access}
			canOrders={canReadOrders(roles, permissions)}
		/>
	);
}
