import { AccessDenied } from "../../../../../components/admin/access-denied";
import { AffiliateDetailClient } from "../../../../../components/admin/affiliates-client";
import { resolveAdminId } from "@/modules/access/admin-number-page";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Detail Afiliasi · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only (spec 17 B14, DEC-018 Q5). The affiliate detail API re-checks owner/finance role, live session
// and MFA in the database; rate writes on POST /api/v1/admin/affiliates/{affiliateId}/rates remain owner-only with
// fresh MFA and a single-use affiliate_rate.version proof.
export default async function AdminAffiliateDetailPage({
	params,
}: {
	params: Promise<{ affiliateNo: string }>;
}) {
	const [{ roles }, { affiliateNo }] = await Promise.all([
		readStaffAccess(),
		params,
	]);
	if (!roles.some((role) => role === "owner" || role === "finance")) {
		return (
			<AccessDenied title="Detail Afiliasi" heading="Akses afiliasi diperlukan">
				Detail mitra afiliasi dan riwayat tarif komisi hanya dapat dibuka oleh
				Super Admin dan staf Keuangan dengan verifikasi dua langkah (MFA) aktif.
			</AccessDenied>
		);
	}
	const affiliateId = await resolveAdminId("affiliate", affiliateNo);
	return (
		<AffiliateDetailClient
			key={affiliateId}
			affiliateId={affiliateId}
			owner={roles.includes("owner")}
		/>
	);
}
