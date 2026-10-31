import assert from "node:assert/strict";
import { test } from "node:test";
import { SINGLE_RANK_BASE, singleRows } from "../src/modules/local/berlapak-singles.ts";

const place = { warehouse_id: "a".repeat(24), warehouse_name: "Gudang A", province: "JAWA TIMUR", city: "KEDIRI", district: "PARE" };
const record = (extra: Record<string, unknown>) => ({
  _id: "b".repeat(24), berlapak_catalog_no: 7, slug: "Kaos Polos!", name: "Kaos Polos", description: "Bahan katun",
  pricing_berlapak: { hpp_price: 40000 }, inventory: { is_ready_stock: true, total_stock: 5, weight_gram: 300 },
  variants_summary: { has_variants: false, variants: [] }, assets: { folder_slug: null, gallery_images: [{ index: 1, remote_url: "https://x/1.png" }] },
  warehouse_and_location: place, distributor_and_seller: { seller_name: "Toko A", distributor_address: { address_id: "c".repeat(24), name: "Alamat Distributor", district: "BANGIL" } },
  category_and_google_catalog: { suggested_category_code: "CAT-04", suggested_subcategory_name: "Kaos" }, ...extra,
});

test("a product new to 99ribu gets the base rank, its own folder and fetchable photos", () => {
  const out = singleRows({ generated_at: "2026-10-30T17:02:43.765Z", products: [record({})] }, [], () => false);
  const row = out.rows[0] as Record<string, any>;
  assert.equal(row.rank, SINGLE_RANK_BASE + 7);
  assert.equal(row.assets.folder_slug, "007-kaos-polos");
  assert.equal(row.pricing.hpp_price, 40000);
  assert.equal(row.strategy_99ribu.recommended_bundle_qty, 1);
  assert.equal(row.allow_unstocked, true);
  assert.deepEqual(out.photos, [{ folder: "007-kaos-polos", file: "img-01.webp", url: "https://x/1.png" }]);
  assert.equal(out.snapshot, "singles 2026-10-30T17:02:43.765Z");
  assert.deepEqual(out.legacyRanks, []);
});

test("a product already in the legacy snapshot keeps its rank, folder and legacy variant photos", () => {
  const legacy = [{ _id: "b".repeat(24), rank: 42, assets: { folder_slug: "042-kaos" },
    variants_summary: { variants: [{ _id: "v1", image_local_path: "images/042-kaos/var-01.webp" }] } }];
  const product = record({ assets: { folder_slug: "042-kaos", gallery_images: [{ index: 1, remote_url: "https://x/1.png" }] },
    variants_summary: { has_variants: true, variants: [{ _id: "v1", name: "Hitam", hpp_price: 40000, stock: 2, image_remote_url: "https://x/v1.png" },
      { _id: "v2", name: "Putih", hpp_price: 40000, stock: 0, image_remote_url: "https://x/v2.png" }] } });
  const out = singleRows({ generated_at: "t", products: [product] }, legacy, (folder) => folder === "042-kaos");
  const row = out.rows[0] as Record<string, any>;
  assert.equal(row.rank, 42);
  assert.deepEqual(out.legacyRanks, [42]);
  assert.deepEqual(row.variants_summary.variants.map((v: any) => v.image_local_path), ["images/042-kaos/var-01.webp", "images/042-kaos/var-102.webp"]);
  // Gallery photos already on disk are not fetched; only the new variant's photo is.
  assert.deepEqual(out.photos, [{ folder: "042-kaos", file: "var-102.webp", url: "https://x/v2.png" }]);
});

test("a product without a supplier warehouse ships from the distributor address; a duplicate rank is invalid", () => {
  const product = record({ warehouse_and_location: { district: "BANGIL" }, inventory: { is_ready_stock: false, total_stock: 0, weight_gram: 300 } });
  const out = singleRows({ generated_at: "t", products: [product, product] }, [], () => false);
  const row = out.rows[0] as Record<string, any>;
  assert.equal(row.warehouse_and_shipping.warehouse_id, "c".repeat(24));
  assert.equal(row.warehouse_and_shipping.district, "BANGIL");
  assert.equal((out.rows[1] as Record<string, unknown>).rank, 0);
});
