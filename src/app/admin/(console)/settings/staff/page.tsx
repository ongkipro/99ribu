import { AccessDenied } from "../../../../../components/admin/access-denied";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { StaffRolesClient } from "../../../../../components/admin/staff-roles-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Staf & Peran · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S137 (spec 17 B20, DEC-018 Q2). Navigation gate only: the staff APIs re-check the owner role, the live session and
// MFA in the database on every read and write.
export default async function StaffRolesPage() {
	const { roles } = await readStaffAccess();
	if (!roles.includes("owner"))
		return (
			<AccessDenied title="Staf & Peran" heading="Akses Super Admin diperlukan">
				Peran, izin, dan cakupan gudang staf hanya diatur oleh Super Admin dengan verifikasi dua langkah (MFA) aktif.
			</AccessDenied>
		);
	return (
		<AdminPage testId="staff-page">
			<PageHeader
				title="Staf & Peran"
				description="Atur peran, izin tambahan, dan cakupan gudang setiap staf, atau reset verifikasi dua langkah yang hilang. Setiap perubahan meminta kata sandi dan kode MFA yang masih berlaku (maksimal 5 menit), mengakhiri semua sesi akun itu, dan tercatat di log audit."
			/>
			<StaffRolesClient />
		</AdminPage>
	);
}
