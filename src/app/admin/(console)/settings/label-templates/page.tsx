import { AccessDenied } from "../../../../../components/admin/access-denied";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { SettingsLabelTemplatesClient } from "../../../../../components/admin/settings-label-templates-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Template Label · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S130 (spec 17 B23, DEC-018 Q3). Navigation gate only: the shipping-label-templates API re-checks
// the role/permission and MFA on every read, and requires owner on every write.
export default async function SettingsLabelTemplatesPage() {
	const { roles, permissions } = await readStaffAccess();
	const allowed =
		roles.some(
			(r) =>
				r === "owner" ||
				r === "ecommerce_admin" ||
				r === "warehouse" ||
				r === "finance",
		) || permissions.includes("shipping.labels.read");
	if (!allowed)
		return (
			<AccessDenied
				title="Template Label"
				heading="Akses template label diperlukan"
			>
				Halaman ini untuk Super Admin, admin e-commerce, staf gudang, atau staf
				keuangan dengan verifikasi dua langkah (MFA) aktif.
			</AccessDenied>
		);
	return (
		<AdminPage testId="settings-label-templates-page">
			<PageHeader
				title="Template Label"
				description="Kelola template label pengiriman termal dan A4, mode privasi nomor telepon penerima, dan tata kelola merek mitra. Penambahan atau perubahan versi template memerlukan Super Admin dengan autentikasi ulang; staf keuangan, e-commerce, dan gudang dapat meninjau versi aktif dan riwayatnya."
				meta={<span>Waktu dalam WIB</span>}
			/>
			<SettingsLabelTemplatesClient canWrite={roles.includes("owner")} />
		</AdminPage>
	);
}
