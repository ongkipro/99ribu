import type { Option } from "../../../../components/admin/shipping-promotions-client";
import { getLocalAuth } from "../../../../modules/access/auth";
import { provinceRegion } from "../../../../modules/checkout/quotes";
import { shippingFixture } from "../../../../modules/shipping/address";
import { areaTitle, destinationSource } from "../../../../modules/shipping/destinations";
import { COURIERS } from "../../../../modules/shipping/mengantar";

// S176: choices follow the destination source. With the real Mengantar catalogue (production or local provider
// mode): the courier keys rates carry and the provinces of the loaded areas (every shipment carries its province
// region id). With the TEST-ONLY fixture: its destinations and services. Otherwise both stay unrestricted.
// Shared by Promo Ongkir and Voucher (S177).
// `districts`: the form also offers kecamatan (S177), only over the real catalogue.
export async function promotionOptions(): Promise<{ services: Option[]; regions: Option[]; districts: boolean }> {
	try {
		if (destinationSource() === "mengantar") {
			const rows = await getLocalAuth().sql<{ province: string }[]>`select distinct province from app.shipping_area order by province`;
			return {
				services: Object.entries(COURIERS).map(([id, label]) => ({ id, label })),
				regions: rows.map((r) => ({ id: provinceRegion(r.province), label: areaTitle(r.province) })),
				districts: true,
			};
		}
		const fixture = shippingFixture();
		return {
			services: fixture.services.map((s) => ({ id: s.id, label: s.name })),
			regions: fixture.destinations.map((d) => ({ id: d.id, label: d.label })),
			districts: false,
		};
	} catch {
		// Shipping disabled or no catalogue: the form leaves regions and services unrestricted.
		return { services: [], regions: [], districts: false };
	}
}
