// S160 / spec 17 W4-8: "Duplikat" makes a DRAFT copy through the ordinary create API. The body carries the
// name, category, description, photos and every offer with the same component references and prices.
// Nothing else is copied: no stock (stock movements belong to the shared SKU), no HPP or cost version
// (cost versions belong to the shared SKU and offer assumptions start unknown), no published state, no facts.
// Offer SKUs must be unique, so each copy gets a new one.

import type { CatalogProduct } from "./catalog-model.ts";

export const COPY_SUFFIX = " (salinan)";
const NAME_MAX = 200;
const SKU_MAX = 100;
const TAG_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Six random characters of the SKU alphabet, e.g. "K7QX2M". */
export function newCopyTag(random: () => number = Math.random): string {
	return Array.from({ length: 6 }, () => TAG_ALPHABET[Math.floor(random() * TAG_ALPHABET.length)]).join("");
}

const COPY_TAIL = / \(salinan(?: (\d+))?\)$/;
/**
 * "X" becomes "X (salinan)", a copy of that "X (salinan 2)", and so on: the suffix never stacks. Cut by code point
 * (the name limit counts characters), so the stem never ends in half a surrogate pair.
 */
export function copyName(name: string): string {
	const tail = COPY_TAIL.exec(name);
	const stem = tail ? name.slice(0, tail.index) : name;
	const suffix = tail ? ` (salinan ${Number(tail[1] ?? 1) + 1})` : COPY_SUFFIX;
	return `${Array.from(stem).slice(0, NAME_MAX - Array.from(suffix).length).join("")}${suffix}`;
}
export const copySku = (sku: string, tag: string) => {
	const suffix = `-C${tag}`;
	return `${sku.slice(0, SKU_MAX - suffix.length)}${suffix}`;
};

/** Body of POST /api/v1/admin/products for the copy. `product` is the admin GET (active offers only). */
export function duplicateBody(product: CatalogProduct, tag: string) {
	return {
		name: copyName(product.name),
		description: product.description,
		category_id: product.category_id,
		images: product.images.map(({ url, alt, width, height }) => ({ url, alt, width, height })),
		variants: product.variants.map((v) => ({
			sku: copySku(v.sku, tag),
			label: v.label,
			attributes: v.attributes.map(({ key, label, values }) => ({ key, label, values })),
			price: v.price,
			offer_kind: v.offer_kind,
			weight_grams: v.weight_grams,
			length_mm: v.length_mm,
			width_mm: v.width_mm,
			height_mm: v.height_mm,
			default_warehouse_id: v.default_warehouse_id,
			contents: v.contents.map(({ stock_item_id, name, quantity }) => ({ stock_item_id, name, quantity })),
			...(v.image ? { image: { url: v.image.url, alt: v.image.alt, width: v.image.width, height: v.image.height } } : {}),
		})),
	};
}
