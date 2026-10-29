import { AccessDenied } from "../../../../../components/admin/access-denied";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { SettingsAdvertisingClient } from "../../../../../components/admin/settings-advertising-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Integrasi Iklan · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S130 (spec 17 B24). Navigation gate only: the advertising destinations API re-checks the owner
// role and MFA on every request and never returns secret credentials.
export default async function SettingsAdvertisingPage() {
	const { roles } = await readStaffAccess();
	if (!roles.includes("owner"))
		return (
			<AccessDenied
				title="Integrasi Iklan"
				heading="Akses integrasi iklan diperlukan"
			>
				Halaman ini untuk Super Admin dengan verifikasi dua langkah (MFA) aktif.
			</AccessDenied>
		);
	return (
		<AdminPage testId="settings-advertising-page">
			<PageHeader
				title="Integrasi Iklan"
				description="Tujuan sinyal Meta, Google Ads, dan TikTok: rekonsiliasi, jeda pengiriman, dan kirim ulang kejadian terverifikasi."
			/>
			<SettingsAdvertisingClient canWrite={roles.includes("owner")} />
		</AdminPage>
	);
}
