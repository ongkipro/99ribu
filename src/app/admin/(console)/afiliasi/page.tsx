import { AccessDenied } from "../../../../components/admin/access-denied";
import { AffiliatesListClient } from "../../../../components/admin/affiliates-client";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Afiliasi · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only (spec 17 B14, DEC-018 Q5: owner and finance read the affiliate list and detail; rate writes
// remain owner-only). The affiliate admin API re-checks the role, live session and MFA in the database on every call.
export default async function AdminAffiliatesPage() {
	const { roles } = await readStaffAccess();
	if (!roles.some((role) => role === "owner" || role === "finance")) {
		return (
			<AccessDenied title="Afiliasi" heading="Akses afiliasi diperlukan">
				Daftar mitra afiliasi dan ringkasan komisi hanya dapat dibuka oleh Super
				Admin dan staf Keuangan dengan verifikasi dua langkah (MFA) aktif.
			</AccessDenied>
		);
	}
	return <AffiliatesListClient owner={roles.includes("owner")} />;
}
