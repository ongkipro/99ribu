import { AccessDenied } from "../../../../../components/admin/access-denied";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { SystemHealthClient } from "../../../../../components/admin/system-health-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Kesehatan Sistem · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S136. Navigation gate only; the health API re-checks the owner role with MFA on every read.
export default async function SystemHealthPage() {
	const { roles } = await readStaffAccess();
	if (!roles.includes("owner"))
		return (
			<AccessDenied title="Kesehatan Sistem" heading="Akses Super Admin diperlukan">
				Kesehatan sistem hanya dibuka untuk Super Admin dengan verifikasi dua langkah (MFA) aktif.
			</AccessDenied>
		);
	return (
		<AdminPage testId="system-health-page">
			<PageHeader
				title="Kesehatan Sistem"
				description="Jumlah pekerjaan latar belakang (antrean outbox) per jenis dan keadaan, serta tugas pembersihan data. Halaman ini hanya membaca; isi pekerjaan tidak ditampilkan."
			/>
			<SystemHealthClient />
		</AdminPage>
	);
}
