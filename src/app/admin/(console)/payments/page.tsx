import { PaymentsClient } from "../../../../components/admin/payments-client";
import { AccessDenied } from "../../../../components/admin/access-denied";
import { consoleAccess } from "../../../../components/admin/console-access";
import { canReadOrders } from "../../../../components/admin/order-model";
import { readStaffAccess } from "../staff-roles";
import { AdminPage, PageHeader } from "../../../../components/admin/page-blocks";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pembayaran Masuk · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the APIs re-check finance reconciliation authority, owner role and proofs.
export default async function PaymentsPage() {
	const { roles, permissions } = await readStaffAccess();
	const access = consoleAccess(roles, permissions);
	if (!access.reconcileRead)
		return (
			<AccessDenied title="Pembayaran Masuk" heading="Akses keuangan diperlukan">
				Halaman ini untuk Super Admin atau staf keuangan dengan izin rekonsiliasi
				dan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	return (
		<AdminPage>
			<PageHeader
				title="Pembayaran Masuk"
				description={
					<>
						Konfirmasi transfer bank manual dari mutasi rekening dan pantau Virtual Account / QRIS AutoLaris. Nominal yang
						berbeda dicatat dan masuk tinjauan, tidak dianggap lunas.
					</>
				}
			/>
			<PaymentsClient
				canWrite={access.reconcileWrite}
				canOrders={canReadOrders(roles, permissions)}
			/>
		</AdminPage>
	);
}
