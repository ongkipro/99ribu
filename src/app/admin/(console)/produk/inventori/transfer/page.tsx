import { AccessDenied } from "../../../../../../components/admin/access-denied";
import { TransfersClient } from "../../../../../../components/admin/transfers-client";
import { readStaffAccess } from "../../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Transfer Stok · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the transfer API rechecks source/destination scope on every call.
export default async function TransfersPage() {
	const { roles } = await readStaffAccess();
	if (!roles.some((r) => r === "owner" || r === "ecommerce_admin" || r === "warehouse"))
		return (
			<AccessDenied title="Transfer Stok" heading="Akses gudang diperlukan">
				Transfer stok dapat dibuka oleh Super Admin, Admin E-Commerce dan staf gudang dengan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	return <TransfersClient owner={roles.includes("owner")} />;
}
