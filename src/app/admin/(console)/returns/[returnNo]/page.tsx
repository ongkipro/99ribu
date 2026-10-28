import { AccessDenied } from "../../../../../components/admin/access-denied";
import { canReadOrders } from "../../../../../components/admin/order-model";
import { ReturnDetailClient } from "../../../../../components/admin/return-detail-client";
import { returnAccess } from "../../../../../components/admin/return-model";
import { resolveAdminId } from "@/modules/access/admin-number-page";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Detail Retur · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; every read and action is re-authorized by the returns API.
export default async function ReturnDetailPage({ params }: { params: Promise<{ returnNo: string }> }) {
	const [{ roles, permissions }, { returnNo }] = await Promise.all([readStaffAccess(), params]);
	const access = returnAccess(roles, permissions);
	if (!access.read)
		return (
			<AccessDenied title="Detail Retur" heading="Akses retur diperlukan">
				Detail retur dapat dibuka oleh Super Admin, Layanan Pelanggan, staf gudang dan staf
				keuangan dengan izin baca refund. Verifikasi dua langkah harus aktif.
			</AccessDenied>
		);
	const returnId = await resolveAdminId("return", returnNo);
	return <ReturnDetailClient key={returnId} caseId={returnId} access={access} canOrders={canReadOrders(roles, permissions)} />;
}
