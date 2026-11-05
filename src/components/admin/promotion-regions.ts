// S177 leftovers: region ids of the promotion form, client side. checkout/quotes.ts owns `provinceRegion` and
// `districtRegion` but is server-only (node:crypto, database), so the picker mirrors its slug here;
// tests/promotion-regions.test.ts pins both against quotes.ts.
export type RegionOption = { id: string; label: string };

/** The API accepts at most 100 region ids per promotion (configuration.ts `unique`). */
export const MAX_REGION_IDS = 100;

const slug = (value: string) =>
	value
		.normalize("NFKC")
		.toLocaleLowerCase("id-ID")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

export const districtRegionId = (province: string, city: string, district: string) =>
	`dist-${[province, city, district].map(slug).join("--")}`.slice(0, 100);

// A slug back to words: the original capitals and punctuation are gone, so this is a readable approximation.
const words = (value: string) =>
	value
		.split("-")
		.filter(Boolean)
		.map((w) => w.charAt(0).toLocaleUpperCase("id-ID") + w.slice(1))
		.join(" ")
		.replace(/^Dki\b/, "DKI")
		.replace(/^Di\b/, "DI");

/** Label for a stored region id: a known option, else a `dist-` id read back as "Kecamatan, Kota, Provinsi", else the raw id. */
export function regionLabel(id: string, options: readonly RegionOption[] = []): string {
	const known = options.find((o) => o.id === id);
	if (known) return known.label;
	const parts = id.startsWith("dist-") ? id.slice(5).split("--") : [];
	if (parts.length !== 3 || parts.some((p) => !p)) return id;
	const [province, city, district] = parts;
	const provinceLabel = options.find((o) => o.id === `prov-${province.slice(0, 90)}`)?.label ?? words(province);
	return `${words(district)}, ${words(city)}, ${provinceLabel}`;
}
