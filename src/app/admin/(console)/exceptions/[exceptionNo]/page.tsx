import { AccessDenied } from "../../../../../components/admin/access-denied";
import { ExceptionDetailClient } from "../../../../../components/admin/exception-detail-client";
import { canReadOrders } from "../../../../../components/admin/order-model";
import { returnAccess } from "../../../../../components/admin/return-model";
import { resolveAdminId } from "@/modules/access/admin-number-page";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Detail Kasus Pengiriman · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; every read and action is re-authorized by the exceptions API.
export default async function ExceptionDetailPage({ params }: { params: Promise<{ exceptionNo: string }> }) {
	const [{ roles, permissions }, { exceptionNo }] = await Promise.all([readStaffAccess(), params]);
	const access = returnAccess(roles, permissions);
	if (!access.read)
		return (
			<AccessDenied title="Detail Kasus Pengiriman" heading="Akses kasus pengiriman diperlukan">
				Detail kasus dapat dibuka oleh Super Admin, Layanan Pelanggan, staf gudang dan staf keuangan
				dengan izin baca refund. Verifikasi dua langkah harus aktif.
			</AccessDenied>
		);
	const exceptionId = await resolveAdminId("exception", exceptionNo);
	return <ExceptionDetailClient key={exceptionId} exceptionId={exceptionId} access={access} canOrders={canReadOrders(roles, permissions)} />;
}
