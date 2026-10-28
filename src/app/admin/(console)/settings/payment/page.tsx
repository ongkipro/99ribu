import { AccessDenied } from "../../../../../components/admin/access-denied";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { SettingsPaymentClient } from "../../../../../components/admin/settings-payment-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pembayaran & Biaya COD · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S130 (spec 17 B21, DEC-018 Q3). Navigation gate only: the policy-versions API re-checks the role,
// live session and MFA on every read and requires owner + single-use payment_policy.version proof on write.
export default async function SettingsPaymentPage() {
	const { roles } = await readStaffAccess();
	const allowed = roles.some((r) => r === "owner" || r === "finance");
	if (!allowed)
		return (
			<AccessDenied
				title="Pembayaran & Biaya COD"
				heading="Akses kebijakan pembayaran diperlukan"
			>
				Halaman ini untuk Super Admin atau staf keuangan dengan verifikasi dua
				langkah (MFA) aktif.
			</AccessDenied>
		);
	return (
		<AdminPage testId="settings-payment-page">
			<PageHeader
				title="Pembayaran & Biaya COD"
				description="Atur biaya layanan COD yang ditanggung pembeli dan daftar rekening bank untuk transfer manual. Setiap perubahan menambah versi baru dengan autentikasi ulang Super Admin; pesanan yang sudah dibuat tetap memakai ketentuan saat pesanan dibuat."
				meta={<span>Waktu dalam WIB</span>}
			/>
			<SettingsPaymentClient canWrite={roles.includes("owner")} />
		</AdminPage>
	);
}
