import { AccessDenied } from "../../../../../../components/admin/access-denied";
import { financeAccess } from "../../../../../../components/admin/finance-model";
import { PayoutDetailClient } from "../../../../../../components/admin/finance-payouts-client";
import { resolveAdminId } from "@/modules/access/admin-number-page";
import { readStaffAccess } from "../../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Detail Pembayaran Komisi · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; every read and action is re-authorized by the payouts API.
export default async function FinancePayoutDetailPage({
	params,
}: {
	params: Promise<{ payoutNo: string }>;
}) {
	const [{ roles, permissions }, { payoutNo }] = await Promise.all([
		readStaffAccess(),
		params,
	]);
	const access = financeAccess(roles, permissions);
	if (!access.payouts) {
		return (
			<AccessDenied
				title="Detail Pembayaran Komisi"
				heading="Akses pembayaran komisi diperlukan"
			>
				Detail pencairan komisi dapat dibuka oleh Super Admin atau staf keuangan dengan
				verifikasi dua langkah aktif.
			</AccessDenied>
		);
	}
	const payoutId = await resolveAdminId("payout", payoutNo);
	return <PayoutDetailClient key={payoutId} payoutId={payoutId} />;
}
