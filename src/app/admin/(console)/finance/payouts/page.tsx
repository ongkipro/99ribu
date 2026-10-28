import { AccessDenied } from "../../../../../components/admin/access-denied";
import {
	financeAccess,
	PAYOUT_STATUSES,
} from "../../../../../components/admin/finance-model";
import { PayoutsListClient } from "../../../../../components/admin/finance-payouts-client";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pembayaran Komisi · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the payouts API re-checks owner/finance role and MFA on every call.
export default async function FinancePayoutsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const [{ roles, permissions }, query] = await Promise.all([
		readStaffAccess(),
		searchParams,
	]);
	const access = financeAccess(roles, permissions);
	if (!access.payouts) {
		return (
			<AccessDenied
				title="Pembayaran Komisi"
				heading="Akses pembayaran komisi diperlukan"
			>
				Halaman ini untuk Super Admin atau staf keuangan dengan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	}
	const status =
		PAYOUT_STATUSES.find((value) => value === query.status) ?? null;

	return (
		<AdminPage testId="payouts-screen">
			<PageHeader
				title="Pembayaran Komisi"
				description="Antrean pencairan komisi afiliasi manual. Klaim pencairan secara eksklusif, unggah bukti transfer bank, lalu verifikasi referensi mutasi untuk memposting jurnal kas."
			/>
			<PayoutsListClient initialStatus={status} />
		</AdminPage>
	);
}
