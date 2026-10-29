import { AccountSecurityClient } from "../../../../../components/admin/account-security-client";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Keamanan akun · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S129 (spec 17 B2). Navigation only; /api/auth/account-security, change-password, backup-code regeneration and
// /api/v1/me/session-terminations re-check the verified staff session and own-account scope on every call.
export default function AccountSecurityPage() {
	return (
		<AdminPage testId="account-security-page">
			<PageHeader
				back={{ href: "/admin/account", label: "Profil" }}
				title="Keamanan akun"
				description="Kata sandi, verifikasi dua langkah, dan perangkat yang masuk ke akun Anda. Setiap perubahan tercatat di log audit."
			/>
			<AccountSecurityClient />
		</AdminPage>
	);
}
