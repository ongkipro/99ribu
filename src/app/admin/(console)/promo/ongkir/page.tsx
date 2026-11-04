import { AccessDenied } from "../../../../../components/admin/access-denied";
import { type Option, ShippingPromotionsClient } from "../../../../../components/admin/shipping-promotions-client";
import { getLocalAuth } from "../../../../../modules/access/auth";
import { provinceRegion } from "../../../../../modules/checkout/quotes";
import { shippingFixture } from "../../../../../modules/shipping/address";
import { areaTitle, destinationSource } from "../../../../../modules/shipping/destinations";
import { COURIERS } from "../../../../../modules/shipping/mengantar";
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
	// S176: choices follow the destination source. With the real Mengantar catalogue (production or local provider
	// mode): the courier keys rates carry and the provinces of the loaded areas (every shipment carries its province
	// region id). With the TEST-ONLY fixture: its destinations and services. Otherwise both stay unrestricted.
	let services: Option[] = [];
	let regions: Option[] = [];
	try {
		if (destinationSource() === "mengantar") {
			services = Object.entries(COURIERS).map(([id, label]) => ({ id, label }));
			const rows = await getLocalAuth().sql<{ province: string }[]>`select distinct province from app.shipping_area order by province`;
			regions = rows.map((r) => ({ id: provinceRegion(r.province), label: areaTitle(r.province) }));
		} else {
			const fixture = shippingFixture();
			services = fixture.services.map((s) => ({ id: s.id, label: s.name }));
			regions = fixture.destinations.map((d) => ({ id: d.id, label: d.label }));
		}
	} catch {
		// Shipping disabled or no catalogue: the form leaves regions and services unrestricted.
	}
	return <ShippingPromotionsClient services={services} regions={regions} />;
}
