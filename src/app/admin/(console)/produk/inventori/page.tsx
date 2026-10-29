import { AccessDenied } from "../../../../../components/admin/access-denied";
import { InventoryClient } from "../../../../../components/admin/inventory-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Stok Gudang · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the inventory API rechecks role, MFA and warehouse scope on every call.
export default async function InventoryPage() {
	const { roles } = await readStaffAccess();
	const editor = roles.includes("owner") || roles.includes("ecommerce_admin");
	if (!editor && !roles.includes("warehouse"))
		return (
			<AccessDenied title="Stok Gudang" heading="Akses gudang diperlukan">
				Stok gudang dapat dibuka oleh Super Admin, Admin E-Commerce dan staf gudang dengan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	// Transfers start from owner/ecommerce_admin; a new SKU is picked from the SKU dictionary, which
	// is readable by catalog editors only.
	return <InventoryClient canTransfer={editor} canReceiveNew={editor} />;
}
