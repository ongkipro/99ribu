import { AccessDenied } from "../../../../../components/admin/access-denied";
import { consoleAccess } from "../../../../../components/admin/console-access";
import { ShippingPromotionsClient } from "../../../../../components/admin/shipping-promotions-client";
import { promotionOptions } from "../../promo/promotion-options";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Voucher · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S177 stage 2A: code-gated shipping promotions. Navigation gate only; the promotion API rechecks the role
// (promotionAuthority), MFA and the actor lock, and refuses marketing writes that would run a voucher.
export default async function VouchersPage() {
	const { roles, permissions } = await readStaffAccess();
	const access = consoleAccess(roles, permissions);
	if (!access.shippingPromo)
		return (
			<AccessDenied title="Voucher" heading="Akses voucher diperlukan">
				Voucher dapat diatur oleh Super Admin dan Admin E-Commerce, dan diusulkan oleh Marketing, dengan verifikasi
				dua langkah aktif.
			</AccessDenied>
		);
	const { services, regions, districts } = await promotionOptions();
	return <ShippingPromotionsClient mode="voucher" canDecide={access.promotionDecide} services={services} regions={regions} districts={districts} />;
}
