import { AccessDenied } from "../../../../../../components/admin/access-denied";
import { financeAccess } from "../../../../../../components/admin/finance-model";
import { ReconciliationDetailClient } from "../../../../../../components/admin/finance-reconciliation-client";
import { canReadOrders } from "../../../../../../components/admin/order-model";
import { resolveAdminId } from "@/modules/access/admin-number-page";
import { readStaffAccess } from "../../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Detail Rekonsiliasi · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; every read and decision is re-authorized by the reconciliation API.
export default async function FinanceReconciliationDetailPage({
	params,
}: {
	params: Promise<{ itemNo: string }>;
}) {
	const [{ roles, permissions }, { itemNo }] = await Promise.all([
		readStaffAccess(),
		params,
	]);
	const access = financeAccess(roles, permissions);
	if (!access.reconcileRead) {
		return (
			<AccessDenied
				title="Detail Rekonsiliasi"
				heading="Akses rekonsiliasi keuangan diperlukan"
			>
				Detail rekonsiliasi dapat dibuka oleh Super Admin atau staf keuangan dengan izin baca
				rekonsiliasi (finance.reconciliation.read) dan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	}
	const itemId = await resolveAdminId("reconciliation", itemNo);
	return (
		<ReconciliationDetailClient
			key={itemId}
			itemId={itemId}
			access={access}
			canOrders={canReadOrders(roles, permissions)}
		/>
	);
}
