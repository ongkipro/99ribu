import assert from "node:assert/strict";
import test from "node:test";
import { compactArea, groupDistricts, rankDistricts, searchTerms } from "../src/modules/shipping/area-search.ts";
import { areaTitle } from "../src/modules/shipping/destinations.ts";

// Mengantar-shaped rows: capitals, its own punctuation, several kelurahan per kecamatan.
const rows = [
	{ id: "a3", province: "JAWA TENGAH", city: "SEMARANG", district: "SEMARANG TENGAH", subdistrict: "SEKAYU", postal_code: "50132" },
	{ id: "a1", province: "JAWA TENGAH", city: "SEMARANG", district: "SEMARANG TENGAH", subdistrict: "PENDRIKAN KIDUL", postal_code: "50131" },
	{ id: "a2", province: "JAWA TENGAH", city: "SEMARANG", district: "SEMARANG TENGAH", subdistrict: "PENDRIKAN LOR", postal_code: "50131" },
	{ id: "b1", province: "JAWA TENGAH", city: "SEMARANG", district: "SEMARANG BARAT", subdistrict: "KEMBANGARUM", postal_code: "50183" },
	{ id: "c1", province: "JAWA BARAT", city: "BOGOR", district: "BOGOR BARAT - KOTA", subdistrict: "MENTENG", postal_code: "16111" },
	{ id: "d1", province: "NANGGROE ACEH DARUSSALAM (NAD)", city: "SIMEULUE", district: "SIMEULEU TENGAH", subdistrict: "KAMPUNG AIE", postal_code: "23891" },
	{ id: "e1", province: "DKI JAKARTA", city: "JAKARTA SELATAN", district: "TEBET", subdistrict: "TEBET BARAT", postal_code: "12810" },
	{ id: "f1", province: "KALIMANTAN SELATAN", city: "KOTABARU", district: "PULAU LAUT UTARA", subdistrict: "KOTA BARU", postal_code: "72113" },
	{ id: "g1", province: "SUMATERA BARAT", city: "DHARMASRAYA", district: "KOTO BARU", subdistrict: "KOTO BARU", postal_code: "27681" },
	// A kecamatan split by Kepmendagri (Binawidya) whose kelurahan Mengantar still files under the old parent (Tampan).
	{ id: "h1", province: "RIAU", city: "PEKANBARU", district: "TAMPAN", subdistrict: "SIMPANG BARU", postal_code: "28293" },
	{ id: "h2", province: "RIAU", city: "PEKANBARU", district: "TAMPAN", subdistrict: "SIDOMULYO BARAT", postal_code: "28294" },
	// Synthetic: another kecamatan with a kelurahan whose name starts like the kecamatan "TEBET".
	{ id: "k1", province: "DKI JAKARTA", city: "JAKARTA SELATAN", district: "PANCORAN", subdistrict: "TEBET DALAM", postal_code: "12780" },
];
const entries = groupDistricts(rows);
const names = (query: string, limit = 8) => rankDistricts(entries, query, limit).map((e) => e.district);

test("compactArea drops case, spaces, punctuation and accents", () => {
	assert.equal(compactArea("BOGOR BARAT - KOTA"), "bogorbaratkota");
	assert.equal(compactArea("Nanggroe Aceh Darussalam (NAD)"), "nanggroeacehdarussalamnad");
	assert.equal(compactArea("Pàsar  Minggu"), "pasarminggu");
});

test("searchTerms ignores administrative filler unless nothing else was typed", () => {
	assert.deepEqual(searchTerms("Kec. Semarang Tengah, Kota Semarang"), { whole: "kecsemarangtengahkotasemarang", words: ["semarang", "tengah", "semarang"] });
	assert.deepEqual(searchTerms("kota").words, ["kota"]);
	assert.equal(searchTerms("a b c d e f g h").words.length, 6, "at most six words filter a search");
});

test("groupDistricts makes one kecamatan per province/city/district with its smallest id, area count and sorted postal codes", () => {
	const semarang = entries.find((e) => e.district === "SEMARANG TENGAH");
	assert.ok(semarang);
	assert.deepEqual([semarang.id, semarang.areas, semarang.postal_codes], ["a1", 3, ["50131", "50132"]]);
	assert.equal(entries.length, 9);
});

test("rankDistricts is forgiving of case, spacing and punctuation and ranks the exact kecamatan first", () => {
	// "tengah" is also in the province "Jawa Tengah", but once a kecamatan name matches, word-scattered matches drop out.
	assert.deepEqual(names("semarang tengah"), ["SEMARANG TENGAH"]);
	assert.deepEqual(names("semarang jawa tengah"), ["SEMARANG BARAT", "SEMARANG TENGAH"], "no name match: every word match stays");
	assert.deepEqual(names("SEMARANGTENGAH"), ["SEMARANG TENGAH"]);
	assert.deepEqual(names("  semarang,tengah "), ["SEMARANG TENGAH"]);
	assert.deepEqual(names("semarang"), ["SEMARANG BARAT", "SEMARANG TENGAH"], "city matches list every kecamatan of the city");
	assert.deepEqual(names("bogor barat"), ["BOGOR BARAT - KOTA"]);
	assert.deepEqual(names("Bogor Barat - Kota"), ["BOGOR BARAT - KOTA"], "Mengantar's suffix typed in full still matches");
	assert.deepEqual(names("simeuleu tengah"), ["SIMEULEU TENGAH"]);
	assert.deepEqual(names("aceh"), ["SIMEULEU TENGAH"], "province words match");
	assert.deepEqual(names("kec tebet"), ["TEBET"], "the filler word does not filter, and \"kec\" asks for the kecamatan named Tebet");
});

test("rankDistricts also finds a kecamatan by kelurahan or postal code, after name matches", () => {
	assert.deepEqual(names("tebet barat"), ["TEBET"]);
	assert.deepEqual(names("50132"), ["SEMARANG TENGAH"]);
	assert.deepEqual(names("koto baru"), ["KOTO BARU"]);
	// "kota" is filler for filtering, but the whole phrase still ranks the city Kotabaru above the "Koto Baru" kecamatan.
	// "baru" is also inside the city "Pekanbaru", so Tampan matches by word too; Kotabaru still leads, and the two
	// equal-relevance matches follow A-Z (Koto Baru, Tampan).
	assert.deepEqual(names("kota baru"), ["PULAU LAUT UTARA", "KOTO BARU", "TAMPAN"]);
});

test("rankDistricts orders by relevance, then A-Z within a relevance level (owner 2026-11-06)", () => {
	const row = (id: string, district: string, city: string) => ({ id, province: "JAWA BARAT", city, district, subdistrict: `${district} KEL`, postal_code: "40000" });
	const sample = groupDistricts([row("a1", "SUKAU", "LAMPUNG BARAT"), row("a2", "SUKRA", "INDRAMAYU"), row("a3", "SUKUN", "MALANG"), row("a4", "SUKABUMI", "SUKABUMI"), row("a5", "SUKADANA", "CIAMIS"), row("a6", "PASUKAN", "GARUT"), row("a7", "SUKABUMI", "BANDAR LAMPUNG")]);
	const order = (query: string) => rankDistricts(sample, query, 20).map((e) => `${e.district}/${e.city}`);
	// Starts-with names A-Z (same name: by city), then names that only contain the text.
	assert.deepEqual(order("suk"), ["SUKABUMI/BANDAR LAMPUNG", "SUKABUMI/SUKABUMI", "SUKADANA/CIAMIS", "SUKAU/LAMPUNG BARAT", "SUKRA/INDRAMAYU", "SUKUN/MALANG", "PASUKAN/GARUT"]);
	// An exact name still comes first.
	assert.deepEqual(order("sukun")[0], "SUKUN/MALANG");
});

test("rankDistricts needs two letters, honours the limit and never matches across names", () => {
	assert.deepEqual(names("s"), []);
	assert.deepEqual(names("-- ,"), []);
	assert.equal(names("jawa", 1).length, 1);
	assert.deepEqual(names("tengahjawa"), [], "a word may not span kecamatan and province");
	assert.deepEqual(names("tidak ada"), []);
});

test("areaTitle reads Mengantar capitals as names", () => {
	assert.equal(areaTitle("SEMARANG TENGAH"), "Semarang Tengah");
	assert.equal(areaTitle("BOGOR BARAT - KOTA"), "Bogor Barat - Kota");
	assert.equal(areaTitle("DKI JAKARTA"), "DKI Jakarta");
	assert.equal(areaTitle("NANGGROE ACEH DARUSSALAM (NAD)"), "Nanggroe Aceh Darussalam (NAD)");
	assert.equal(areaTitle("NUSA TENGGARA TIMUR (NTT)"), "Nusa Tenggara Timur (NTT)");
});

test("a kelurahan name or postal code finds the kecamatan holding it and names the kelurahan", () => {
	const [simpang] = rankDistricts(entries, "simpang baru", 8);
	assert.deepEqual([simpang.district, simpang.match?.id, simpang.match?.kind], ["TAMPAN", "h1", "kelurahan"]);
	const [pendrikan] = rankDistricts(entries, "Pendrikan Lor", 8);
	assert.deepEqual([pendrikan.district, pendrikan.match?.id], ["SEMARANG TENGAH", "a2"]);
	const [shared] = rankDistricts(entries, "50131", 8);
	assert.deepEqual([shared.district, shared.match?.kind, shared.match?.single], ["SEMARANG TENGAH", "postcode", false], "two kelurahan share 50131: not chosen for the buyer");
	const [own] = rankDistricts(entries, "28294", 8);
	assert.deepEqual([own.district, own.match?.id, own.match?.single], ["TAMPAN", "h2", true]);
	assert.equal(rankDistricts(entries, "tampan", 8)[0].match, null, "a kecamatan-name match carries no kelurahan");
});

test("kecamatan-name matches rank before kelurahan matches, which are kept", () => {
	assert.deepEqual(names("tebet"), ["TEBET", "PANCORAN"]);
	assert.equal(rankDistricts(entries, "tebet", 8)[1].match?.subdistrict, "TEBET DALAM");
	assert.deepEqual(names("2829"), ["TAMPAN"], "a postal-code prefix finds its kecamatan once");
});

test("only a full, unique postal code or a unique kelurahan name preselects a kelurahan", () => {
	const match = (query: string, district: string) => rankDistricts(entries, query, 8).find((e) => e.district === district)?.match;
	// A partial code finds the kecamatan but never picks a kelurahan for the buyer.
	assert.equal(match("2829", "TAMPAN")?.single, false);
	assert.equal(match("28293", "TAMPAN")?.single, true);
	// 50131 is shared by two kelurahan of Semarang Tengah: the buyer chooses.
	assert.equal(match("50131", "SEMARANG TENGAH")?.single, false);
	// "pendrikan" fits two kelurahan; "pendrikan lor" only one.
	assert.equal(match("pendrikan", "SEMARANG TENGAH")?.single, false);
	assert.equal(match("pendrikan lor", "SEMARANG TENGAH")?.single, true);
});

test("filler words do not hide an exact kecamatan name", () => {
	assert.deepEqual(names("kec tebet")[0], "TEBET");
	assert.deepEqual(names("kecamatan semarang tengah")[0], "SEMARANG TENGAH");
});
