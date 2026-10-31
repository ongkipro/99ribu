import { AccessDenied } from "../../../../components/admin/access-denied";
import { StaticPagesClient } from "../../../../components/admin/static-pages-client";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Halaman Toko · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S-C1. Navigation gate only; the static-pages API re-checks owner/ecommerce_admin with MFA.
export default async function StaticPagesPage() {
	const { roles } = await readStaffAccess();
	if (!roles.some((role) => role === "owner" || role === "ecommerce_admin"))
		return (
			<AccessDenied title="Halaman Toko" heading="Akses konten toko diperlukan">
				Halaman toko dikelola oleh Super Admin atau Admin E-Commerce dengan verifikasi dua langkah (MFA) aktif.
			</AccessDenied>
		);
	return <StaticPagesClient />;
}
