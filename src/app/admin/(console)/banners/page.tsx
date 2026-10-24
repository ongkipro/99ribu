import { AccessDenied } from "../../../../components/admin/access-denied";
import { BannersClient } from "../../../../components/admin/banners-client";
import { AdminPage, PageHeader } from "../../../../components/admin/page-blocks";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Banner Beranda · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S110. Navigation gate only; the banner API re-checks owner/ecommerce_admin with MFA and every write
// consumes a fresh reauthentication proof.
export default async function BannersPage() {
	const { roles } = await readStaffAccess();
	if (!roles.some((role) => role === "owner" || role === "ecommerce_admin"))
		return (
			<AccessDenied title="Banner Beranda" heading="Akses konten toko diperlukan">
				Banner beranda dikelola oleh Super Admin atau Admin E-Commerce dengan verifikasi dua langkah (MFA) aktif.
			</AccessDenied>
		);
	return (
		<AdminPage testId="banners-page">
			<PageHeader
				title="Banner Beranda"
				description={
					<>
						Kartu &ldquo;Temukan pilihan&rdquo; di beranda toko. Banner tampil hanya saat aktif dan dalam jadwalnya (WIB), urut
						sesuai daftar ini. Setiap perubahan meminta kata sandi dan tercatat di riwayat.
					</>
				}
				meta={<span>Semua waktu dalam WIB (UTC+7)</span>}
			/>
			<BannersClient />
		</AdminPage>
	);
}
