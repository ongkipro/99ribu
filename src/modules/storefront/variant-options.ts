// Product page variant rows. Catalogue offers carry only a label ("Putih / S Atau M"); the picker splits it on
// " / " into dimensions and names a dimension "Warna" when every value names a colour, "Ukuran" when every value is
// a clothing size, a shoe size or a measure (100ml, 10x10cm), else "Varian". Each value links to the offer that keeps
// the buyer's other choices, or to the first offer with that value when that combination does not exist.

export type OfferChoice = { id: string; label: string; available: boolean };
export type OptionValue = { value: string; offerId: string; current: boolean; available: boolean; swatch: string | null };
export type OptionRow = { name: "Warna" | "Ukuran" | "Varian"; current: string | null; values: OptionValue[] };

// Base colour words seen in the catalogue (Indonesian and English), mapped to a representative swatch colour.
const COLOURS: Record<string, string> = {
  hitam: "#1a1a1a", black: "#1a1a1a", putih: "#ffffff", puith: "#ffffff", white: "#ffffff", ivory: "#f8f4e6",
  merah: "#d32f2f", red: "#d32f2f", maroon: "#7b1e2b", marun: "#7b1e2b", burgundy: "#6d1a36", ruby: "#9b111e",
  biru: "#1e63c6", blue: "#1e63c6", navy: "#1f2a4d", dongker: "#1f2a4d", denim: "#3b5b8a", birulangit: "#7cb9e8", birudenim: "#3b5b8a",
  hijau: "#2e7d32", green: "#2e7d32", army: "#4b5320", olive: "#708238", sage: "#9caf88", hijausage: "#9caf88", hijautua: "#1b5e20", tosca: "#1aa3a3", seafoam: "#71d9b5",
  kuning: "#f2c200", yellow: "#f2c200", mustard: "#d4a017", gold: "#c9a227",
  abu: "#9e9e9e", grey: "#9e9e9e", gray: "#9e9e9e", silver: "#c0c0c0",
  coklat: "#6d4c41", cokelat: "#6d4c41", coklattua: "#4e342e", brown: "#6d4c41", mocca: "#a47864", moccakombi: "#a47864", coklatkombi: "#6d4c41",
  karamel: "#b5651d", mahogani: "#5d2a1a", chestnut: "#954535", tan: "#d2b48c", khaki: "#c3b091", beige: "#e8dcc4",
  cream: "#f3e5c8", krem: "#f3e5c8", kombicream: "#f3e5c8", putihkombi: "#ffffff", hitamkombi: "#1a1a1a",
  pink: "#f06292", pinkdusty: "#d8a1a6", kombipink: "#f06292", salem: "#fa8072", peach: "#ffcba4", terracotta: "#c8553d",
  abumuda: "#cfcfcf", kopi: "#4b3621", bluish: "#8fa9c9", bata: "#b5532a",
  ungu: "#7b1fa2", purple: "#7b1fa2", iris: "#5a4fcf", orange: "#f57c00", oranye: "#f57c00", kombisage: "#9caf88",
};
const SIZE_ORDER = ["xs", "s", "m", "l", "xl", "xxl", "2xl", "xxxl", "3xl", "4xl", "5xl"];
const SIZE_TOKEN = "(?:xs|s|m|l|xl|xxl|xxxl|[2-5]xl)";
const CLOTHING = new RegExp(`^${SIZE_TOKEN}(?: atau ${SIZE_TOKEN})?$`);
const SHOE = /^(?:[2-4]\d|50)$/;
const MEASURE = /^(?:isi )?(\d+(?:[.,]\d+)?)(?:\s*x\s*\d+(?:[.,]\d+)?)?\s*(ml|l|liter|g|gr|gram|kg|cm|mm|m|meter|pcs)$/;
const UNIT: Record<string, number> = { ml: 1, l: 1000, liter: 1000, g: 1, gr: 1, gram: 1, kg: 1000, mm: 0.1, cm: 1, m: 100, meter: 100, pcs: 1 };

// A colour value starts with a colour word ("Hitam", "Navy Blue") or a shade word before one ("Dark Grey");
// "Bawang Putih" or "Bumbu Merah" are flavours, not colours.
const SHADES = new Set(["light", "dark", "dusty", "steel", "tni", "mineral", "almond", "golden", "brownish", "grape", "misty"]);
const words = (value: string) => value.toLowerCase().split(/[^a-z]+/).filter(Boolean);
export function swatchFor(value: string): string | null {
  const w = words(value);
  if (COLOURS[w[0]]) return COLOURS[w[0]];
  if (SHADES.has(w[0])) for (const word of w.slice(1)) if (COLOURS[word]) return COLOURS[word];
  return null;
}
const isSize = (value: string) => { const v = value.trim().toLowerCase(); return CLOTHING.test(v) || SHOE.test(v) || MEASURE.test(v); };
function sizeRank(value: string): number {
  const v = value.trim().toLowerCase();
  if (CLOTHING.test(v)) return SIZE_ORDER.indexOf(v.split(" ")[0]);
  if (SHOE.test(v)) return 100 + Number(v);
  const m = MEASURE.exec(v);
  return m ? 1000 + Number(m[1].replace(",", ".")) * UNIT[m[2]] : Number.MAX_SAFE_INTEGER;
}

export function optionRows(choices: OfferChoice[], selected: string): OptionRow[] | null {
  const split = choices.map((c) => ({ ...c, parts: c.label.split(" / ").map((p) => p.trim()) }));
  const width = split[0]?.parts.length ?? 0;
  if (choices.length < 2 || width === 0 || split.some((c) => c.parts.length !== width || c.parts.some((p) => !p))) return null;
  const current = split.find((c) => c.id === selected) ?? null;
  const rows: OptionRow[] = [];
  for (let i = 0; i < width; i++) {
    const distinct = [...new Set(split.map((c) => c.parts[i]))];
    const name = distinct.every((v) => swatchFor(v)) ? "Warna" : distinct.every(isSize) ? "Ukuran" : "Varian";
    if (name === "Ukuran") distinct.sort((a, b) => sizeRank(a) - sizeRank(b));
    rows.push({ name, current: current?.parts[i] ?? null, values: distinct.map((value) => {
      const withValue = split.filter((c) => c.parts[i] === value);
      const target = withValue.find((c) => current && c.parts.every((p, j) => j === i || p === current.parts[j])) ?? withValue[0];
      return { value, offerId: target.id, current: current?.parts[i] === value, available: target.available, swatch: name === "Warna" ? swatchFor(value) : null };
    }) });
  }
  // A single dimension that is neither colour nor size reads as the plain list, as before.
  return rows.every((r) => r.name === "Varian") ? null : rows;
}
