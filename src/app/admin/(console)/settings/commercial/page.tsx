import { AccessDenied } from "../../../../../components/admin/access-denied";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { SettingsCommercialClient } from "../../../../../components/admin/settings-commercial-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Kebijakan Komersial · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S130 (spec 17 B22, DEC-018 Q3). Navigation gate only: the policy-versions API re-checks the role,
// live session and MFA on every read and requires owner + single-use company_policy.version proof on write.
export default async function SettingsCommercialPage() {
	const { roles } = await readStaffAccess();
	const allowed = roles.some((r) => r === "owner" || r === "finance");
	if (!allowed)
		return (
			<AccessDenied
				title="Kebijakan Komersial"
				heading="Akses kebijakan komersial diperlukan"
			>
				Halaman ini untuk Super Admin atau staf keuangan dengan verifikasi dua
				langkah (MFA) aktif.
			</AccessDenied>
		);
	return (
		<AdminPage testId="settings-commercial-page">
			<PageHeader
				title="Kebijakan Komersial"
				description="Atur tarif komisi afiliasi bawaan, batas minimum pencairan komisi, dan lantai kontribusi margin untuk publikasi katalog. Harga penawaran lengkap tetap Rp99.000; perubahan kebijakan berlaku ke depan dengan autentikasi ulang Super Admin."
				meta={<span>Waktu dalam WIB</span>}
			/>
			<SettingsCommercialClient canWrite={roles.includes("owner")} />
		</AdminPage>
	);
}
