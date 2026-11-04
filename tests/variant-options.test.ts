import assert from "node:assert/strict";
import test from "node:test";
import { optionRows, swatchFor } from "../src/modules/storefront/variant-options.ts";

const tee = ["Putih / S Atau M", "Hitam / 4XL Atau 5XL", "Hitam / S Atau M", "Hitam / 2XL Atau 3XL", "Putih / 2XL Atau 3XL", "Hitam / L Atau XL", "Putih / 4XL Atau 5XL", "Putih / L Atau XL"]
  .map((label, i) => ({ id: `o${i}`, label, available: label !== "Putih / 4XL Atau 5XL" }));

test("colour and size labels become a Warna row and an ordered Ukuran row that keep the other choice", () => {
  const rows = optionRows(tee, "o0") ?? [];
  assert.deepEqual(rows.map((r) => [r.name, r.current]), [["Warna", "Putih"], ["Ukuran", "S Atau M"]]);
  assert.deepEqual(rows[0].values.map((v) => [v.value, v.swatch, v.current]), [["Putih", "#ffffff", true], ["Hitam", "#1a1a1a", false]]);
  assert.deepEqual(rows[1].values.map((v) => v.value), ["S Atau M", "L Atau XL", "2XL Atau 3XL", "4XL Atau 5XL"]);
  // Hitam keeps size S Atau M; 4XL keeps colour Putih, which is out of stock.
  assert.equal(rows[0].values[1].offerId, "o2");
  const big = rows[1].values[3];
  assert.deepEqual([big.offerId, big.available], ["o6", false]);
});

test("a missing combination links to the first offer with that value", () => {
  const rows = optionRows([{ id: "a", label: "Merah / S", available: true }, { id: "b", label: "Biru / M", available: true }], "a") ?? [];
  assert.deepEqual(rows[0].values.map((v) => [v.value, v.offerId]), [["Merah", "a"], ["Biru", "b"]]);
});

test("single dimensions: colours and measures get rows, other labels keep the plain list", () => {
  assert.equal(optionRows([{ id: "a", label: "Hitam", available: true }, { id: "b", label: "Marun", available: true }], "a")?.[0].name, "Warna");
  assert.deepEqual(optionRows(["500GR", "100GR", "1KG"].map((label) => ({ id: label, label, available: true })), "100GR")?.[0].values.map((v) => v.value), ["100GR", "500GR", "1KG"]);
  assert.deepEqual(optionRows(["XL", "M", "S", "XXL", "L"].map((label) => ({ id: label, label, available: true })), "M")?.[0].values.map((v) => v.value), ["S", "M", "L", "XL", "XXL"]);
  assert.equal(optionRows(["Bawang Putih", "Bawang Merah"].map((label) => ({ id: label, label, available: true })), "Bawang Putih"), null);
  assert.equal(optionRows(["Jack 100ml", "Rose 100ml"].map((label) => ({ id: label, label, available: true })), "Jack 100ml"), null);
  assert.equal(optionRows([{ id: "a", label: "Hitam", available: true }], "a"), null);
  assert.equal(optionRows([{ id: "a", label: "Hitam / S", available: true }, { id: "b", label: "Putih", available: true }], "a"), null, "uneven labels keep the plain list");
});

test("colour words count only at the start or after a shade word", () => {
  assert.deepEqual(["Navy Blue", "Dark Grey", "Abumuda x Hitam", "Bumbu Merah", "Strawberry"].map(swatchFor), ["#1f2a4d", "#9e9e9e", "#cfcfcf", null, null]);
});
