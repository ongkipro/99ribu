import { AccessDenied } from "../../../../../components/admin/access-denied";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { SettingsSupportClient } from "../../../../../components/admin/settings-support-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Balasan & Tag CS · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S130 (spec 17 B25). Navigation gate only: the support saved-replies and tags APIs re-check
// owner or customer_service role and MFA on every read, and require canManageSupportTools on write.
export default async function SettingsSupportPage() {
	const { roles, permissions } = await readStaffAccess();
	const allowed = roles.some(
		(r) => r === "owner" || r === "customer_service",
	);
	if (!allowed)
		return (
			<AccessDenied
				title="Balasan & Tag CS"
				heading="Akses layanan pelanggan diperlukan"
			>
				Halaman ini untuk Super Admin atau staf layanan pelanggan dengan
				verifikasi dua langkah (MFA) aktif.
			</AccessDenied>
		);
	const isOwner = roles.includes("owner");
	const canWrite =
		isOwner ||
		(roles.includes("customer_service") &&
			permissions.includes("support.tools.manage"));
	return (
		<AdminPage testId="settings-support-page">
			<PageHeader
				title="Balasan & Tag CS"
				description="Template balasan tersimpan dan tag internal untuk kotak masuk pelanggan. Setiap versi tercatat di log audit."
			/>
			<SettingsSupportClient canWrite={canWrite} />
		</AdminPage>
	);
}
