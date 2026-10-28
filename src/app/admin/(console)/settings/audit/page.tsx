import { AccessDenied } from "../../../../../components/admin/access-denied";
import { AuditLogClient } from "../../../../../components/admin/audit-log-client";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Log Audit · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only (DEC-018 Q4: the owner reads everything, finance reads money actions). The audit API
// re-checks the current role, session and MFA in the database on every page and filters finance in SQL.
export default async function AuditLogPage() {
	const { roles } = await readStaffAccess();
	const scope = roles.includes("owner")
		? "all"
		: roles.includes("finance")
			? "money"
			: null;
	if (!scope)
		return (
			<AccessDenied title="Log Audit" heading="Akses log audit diperlukan">
				Log audit dibuka untuk Super Admin dan, khusus tindakan keuangan, staf
				keuangan. Verifikasi dua langkah harus aktif.
			</AccessDenied>
		);
	return (
		<AdminPage testId="audit-page">
			<PageHeader
				title="Log Audit"
				description={
					scope === "all"
						? "Catatan tindakan staf dan sistem, terbaru di atas. Data pribadi dan rahasia (kode OTP, token, bukti, nomor rekening) tidak ditampilkan. Setiap pembukaan log ini ikut dicatat."
						: "Catatan tindakan keuangan: rekonsiliasi, pembayaran komisi, refund, dan perubahan biaya. Tindakan lain hanya terlihat oleh Super Admin. Setiap pembukaan log ini ikut dicatat."
				}
				meta={<span>Waktu dalam WIB</span>}
			/>
			<AuditLogClient scope={scope} />
		</AdminPage>
	);
}
