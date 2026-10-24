import { AccessDenied } from "../../../../../components/admin/access-denied";
import { type Option, ShippingPromotionsClient } from "../../../../../components/admin/shipping-promotions-client";
import { shippingFixture } from "../../../../../modules/shipping/address";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Promo Ongkir · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the promotion API rechecks owner/ecommerce_admin, MFA and the actor lock.
export default async function ShippingPromotionsPage() {
	const { roles } = await readStaffAccess();
	if (!roles.includes("owner") && !roles.includes("ecommerce_admin"))
		return (
			<AccessDenied title="Promo Ongkir" heading="Akses promo diperlukan">
				Promo ongkir dapat diatur oleh Super Admin dan Admin E-Commerce dengan verifikasi dua langkah aktif.
			</AccessDenied>
		);
	// Region and service choices come from the local shipping adapter (TEST-ONLY destinations and
	// services). Without it the form leaves both unrestricted (all regions and services).
	let services: Option[] = [];
	let regions: Option[] = [];
	try {
		const fixture = shippingFixture();
		services = fixture.services.map((s) => ({ id: s.id, label: s.name }));
		regions = fixture.destinations.map((d) => ({ id: d.id, label: d.label }));
	} catch {
		// Production profile: no local fixture.
	}
	return <ShippingPromotionsClient services={services} regions={regions} />;
}
