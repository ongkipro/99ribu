import { PaymentsClient } from "../../../../components/admin/payments-client";
import { AccessDenied } from "../../../../components/admin/access-denied";
import { consoleAccess } from "../../../../components/admin/console-access";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pembayaran · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the APIs re-check finance reconciliation authority, owner role and proofs.
export default async function PaymentsPage() {
	const { roles, permissions } = await readStaffAccess();
	const access = consoleAccess(roles, permissions);
	if (!access.reconcileRead)
		return (
			<AccessDenied title="Pembayaran" heading="Akses keuangan diperlukan">
				Halaman ini untuk Super Admin atau staf keuangan dengan izin rekonsiliasi
				dan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	return (
		<div className="flex flex-col gap-6 px-4 py-5 md:px-8 md:py-6">
			<header className="flex flex-col gap-1.5 border-b pb-5">
				<h1 className="text-2xl font-semibold tracking-tight">Pembayaran</h1>
				<p className="max-w-prose text-sm text-muted-foreground">
					Konfirmasi transfer bank manual dari mutasi rekening dan pantau Virtual Account / QRIS AutoLaris. Nominal yang
					berbeda dicatat dan masuk tinjauan, tidak dianggap lunas.
				</p>
			</header>
			<PaymentsClient canManageTerms={roles.includes("owner")} canWrite={access.reconcileWrite} />
		</div>
	);
}
