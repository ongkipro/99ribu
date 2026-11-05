import { AccessDenied } from "../../../../../components/admin/access-denied";
import { consoleAccess } from "../../../../../components/admin/console-access";
import { ShippingPromotionsClient } from "../../../../../components/admin/shipping-promotions-client";
import { readStaffAccess } from "../../staff-roles";
import { promotionOptions } from "../promotion-options";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Promo Ongkir · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the promotion API rechecks the role (promotionAuthority), MFA and the actor lock.
export default async function ShippingPromotionsPage() {
	const { roles, permissions } = await readStaffAccess();
	const access = consoleAccess(roles, permissions);
	if (!access.shippingPromo)
		return (
			<AccessDenied title="Promo Ongkir" heading="Akses promo diperlukan">
				Promo ongkir dapat diatur oleh Super Admin dan Admin E-Commerce, dan diusulkan oleh Marketing, dengan
				verifikasi dua langkah aktif.
			</AccessDenied>
		);
	const { services, regions, districts } = await promotionOptions();
	return <ShippingPromotionsClient mode="automatic" canDecide={access.promotionDecide} services={services} regions={regions} districts={districts} />;
}
