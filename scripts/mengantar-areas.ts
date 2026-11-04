// S95: harvest Mengantar's own area catalogue (kelurahan level, with its `_id`) into a committed dataset, so checkout
// picks a destination from our database and quotes/bookings send Mengantar's exact area id (no name guessing at
// checkout). Read-only: only GET /address/search. One request at a time with a pause; resumable from its log.
//
//   secrets-env run -- node scripts/mengantar-areas.ts harvest   (writes data/shipping/mengantar-harvest.ndjson)
//   secrets-env run -- node scripts/mengantar-areas.ts harvest-extra   (second pass: empty and capped keywords)
//   secrets-env run -- node scripts/mengantar-areas.ts harvest-zip     (third pass: postal-prefix sweep past the 50-row cap)
//   node scripts/mengantar-areas.ts build                        (log → data/shipping/mengantar-areas.json.gz + report)
//   node scripts/mengantar-areas.ts load <target>                 (dataset → app.shipping_area, upsert)
//   node scripts/mengantar-areas.ts resolve-warehouses <target> [--apply]   (warehouse → origin area; dry run first)
//
// The key sits in the URL path; it is never printed (errors carry the status only).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";

const DIR = "data/shipping";
const LOG = `${DIR}/mengantar-harvest.ndjson`;
// The dataset ships gzipped (repo and image); the raw harvest log stays local (.gitignore, .dockerignore).
const OUT = `${DIR}/mengantar-areas.json.gz`;
const PAUSE_MS = 150;
const CAP = 50; // the search answers at most 50 rows (observed 2026-10-30)
const SYLLABLES = ["ba", "be", "bu", "da", "di", "ga", "ja", "ka", "ke", "la", "le", "lu", "ma", "me", "mu", "na", "ng", "pa", "pe", "ra", "re", "ri", "sa", "se", "si", "su", "ta", "te", "ti", "tu", "wa", "ya", "an", "eu", "oe", "co"];

type District = [district: string, city: string, province: string];
type Area = { id: string; province: string; city: string; district: string; subdistrict: string; postal_code: string };
type LogLine = { i: number; keyword: string; status: number; rows: number; areas: Area[] };

const districts = (): District[] => JSON.parse(readFileSync(`${DIR}/indonesia-districts.json`, "utf8")).rows;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function area(row: Record<string, unknown>): Area | null {
	const id = text(row._id);
	if (!/^[0-9a-f]{24}$/.test(id)) return null;
	const result = { id, province: text(row.PROVINCE_NAME), city: text(row.CITY_NAME), district: text(row.DISTRICT_NAME), subdistrict: text(row.SUBDISTRICT_NAME), postal_code: text(row.ZIP_CODE) };
	return result.province && result.city && result.district ? result : null;
}

async function search(keyword: string) {
	const base = process.env.MENGANTAR_BASE_URL?.replace(/\/$/, "");
	const key = process.env.MENGANTAR_API_KEY;
	if (!base || !key) throw new Error("MENGANTAR_BASE_URL and MENGANTAR_API_KEY are required (secrets-env run).");
	for (let attempt = 1; ; attempt++) {
		try {
			const response = await fetch(`${base}/api/public/${key}/address/search?keyword=${encodeURIComponent(keyword)}`, {
				headers: { "x-client-source": "directCall" }, signal: AbortSignal.timeout(15000),
			});
			if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
			const body = (await response.json().catch(() => ({}))) as { data?: unknown };
			const rows = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
			return { status: response.status, rows: rows.length, areas: rows.map(area).filter((a): a is Area => a !== null) };
		} catch (error) {
			if (attempt >= 5) return { status: 0, rows: 0, areas: [], error: error instanceof Error && /^HTTP \d+$/.test(error.message) ? error.message : "network" };
			await sleep(1000 * 2 ** attempt);
		}
	}
}

async function harvest() {
	const done = new Set(existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as LogLine).i) : []);
	const all = districts();
	for (const [i, [district, city]] of all.entries()) {
		if (done.has(i)) continue;
		const keyword = `${district} ${city}`;
		const result = await search(keyword);
		appendFileSync(LOG, `${JSON.stringify({ i, keyword, ...result })}\n`);
		if (i % 250 === 0) console.log(`${i}/${all.length} ${result.status} rows=${result.rows}`);
		await sleep(PAUSE_MS);
	}
	console.log("harvest complete");
}

// Second pass over the first: a district + city keyword with no rows is retried with the district alone (rows of
// other cities are kept too, they are real areas); a capped answer (50 rows) is completed by searching every postal
// code seen for that district, since the search also matches ZIP_CODE. Logged lines carry `pass: 2`; resumable.
async function harvestExtra() {
	const lines = readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LogLine & { pass?: number });
	const done = new Set(lines.filter((l) => l.pass === 2).map((l) => l.keyword));
	const all = districts();
	const keywords = new Set<string>();
	for (const line of lines.filter((l) => l.pass !== 2)) {
		const [district] = all[line.i] ?? [];
		if (!district) continue;
		if (line.rows === 0) keywords.add(district);
		else if (line.rows >= CAP) for (const a of line.areas) if (norm(a.district) === norm(district) && a.postal_code) keywords.add(a.postal_code);
	}
	// A district whose name (or an alias Mengantar writes in brackets, "MANTASIEK (MONTASIK)") appears in no row so far
	// is searched by its own name too: its district + city keyword may have matched other districts only.
	const known = new Set(lines.flatMap((l) => l.areas.flatMap((a) => aliases(a.district))));
	for (const [district, city] of all) {
		if (aliases(district).some((name) => known.has(name))) continue;
		keywords.add(district);
		// Kepmendagri joins words Mengantar splits ("Gunungputri" vs "GUNUNG PUTRI"); a 6-letter prefix plus the city
		// finds the split spelling, and the space-insensitive aliases then match it.
		keywords.add(`${district.replace(/[^A-Za-z]/g, "").slice(0, 6)} ${city}`);
	}
	let n = 0;
	for (const keyword of keywords) {
		if (done.has(keyword)) continue;
		const result = await search(keyword);
		appendFileSync(LOG, `${JSON.stringify({ i: -1, pass: 2, keyword, ...result })}\n`);
		if (++n % 250 === 0) console.log(`pass 2: ${n}/${keywords.size}`);
		await sleep(PAUSE_MS);
	}
	console.log(`pass 2 complete: ${keywords.size} keywords`);
}

// Third pass (2026-11-05): the search caps every answer at 50 rows, has no paging (limit/page/skip are ignored) and
// matches each keyword token as a substring of any field, ZIP_CODE included. So a 4-digit postal prefix lists every
// area whose code contains it; a capped prefix is split into its ten 5-digit codes, a capped code by each kecamatan
// seen in it, and a capped code + kecamatan by each word of the kelurahan names seen there. Prefixes are every known
// 4-digit prefix plus the unseen siblings under each known 3-digit prefix. Leaves still capped are listed by `build`.
async function harvestZip() {
	const read = () => readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LogLine);
	// Only answered queries count as done; a failed one (status 0 after retries) is asked again on the next run.
	const done = new Map(read().filter((l) => l.status === 200).map((l) => [l.keyword, l]));
	const seen = [...done.values()].flatMap((l) => l.areas);
	let n = 0;
	const run = async (keyword: string) => {
		const cached = done.get(keyword);
		if (cached) return cached;
		const result = await search(keyword);
		const line = { i: -1, pass: 3, keyword, ...result };
		appendFileSync(LOG, `${JSON.stringify(line)}\n`);
		done.set(keyword, line);
		seen.push(...result.areas);
		if (++n % 250 === 0) console.log(`pass 3: ${n} queries`);
		await sleep(PAUSE_MS);
		return line;
	};
	const words = (value: string) => value.toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w.length >= 3);
	const p4 = new Set(seen.map((a) => a.postal_code.slice(0, 4)).filter((p) => /^\d{4}$/.test(p)));
	const prefixes = new Set(p4);
	for (const p of p4) for (let d = 0; d <= 9; d++) prefixes.add(`${p.slice(0, 3)}${d}`);
	for (const prefix of [...prefixes].sort()) {
		if ((await run(prefix)).rows < CAP) continue;
		for (let d = 0; d <= 9; d++) {
			const zip = `${prefix}${d}`;
			if ((await run(zip)).rows < CAP) continue;
			const inZip = () => seen.filter((a) => a.postal_code === zip);
			for (const district of new Set(inZip().map((a) => words(a.district).join(" ")).filter(Boolean))) {
				const keyword = `${zip} ${district}`;
				if ((await run(keyword)).rows < CAP) continue;
				const names = new Set(inZip().filter((a) => words(a.district).join(" ") === district).flatMap((a) => words(a.subdistrict)));
				for (const word of names) {
					if (district.split(" ").includes(word)) continue;
					const leaf = `${keyword} ${word}`;
					// Last resort for a leaf still at the cap (big Aceh gampong codes): common syllables as one more token.
					if ((await run(leaf)).rows >= CAP) for (const syllable of SYLLABLES) await run(`${leaf} ${syllable}`);
				}
			}
		}
	}
	console.log(`pass 3 complete: ${n} new queries`);
}

// Normalised names for the coverage check only: Mengantar writes "BOGOR BARAT - KOTA", Kepmendagri "Bogor Barat".
const norm = (value: string) => value.toLocaleLowerCase("id-ID").replace(/\s*-\s*kota$/, "").replace(/[^a-z0-9]+/g, " ").trim();
// Spacing-insensitive names plus the bracketed alias and the name outside the brackets.
const flat = (value: string) => value.toLocaleLowerCase("id-ID").replace(/[^a-z0-9]+/g, "");
function distance(a: string, b: string) {
	let row = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		row = next;
	}
	return row[b.length];
}
// Kepmendagri writes numbers as words ("Ilir Barat Dua"), Mengantar as Roman numerals ("ILIR BARAT II"); Mengantar also
// joins alternatives with a slash ("SEI/SUNGAI BEDUK").
const ROMAN: Record<string, string> = { satu: "i", dua: "ii", tiga: "iii", empat: "iv", lima: "v" };
const roman = (value: string) => value.replace(/\b(satu|dua|tiga|empat|lima)$/, (word) => ROMAN[word]);
const aliases = (value: string) => {
	const lower = value.toLocaleLowerCase("id-ID").replace(/\s*-\s*kota$/, "");
	const names = [lower, lower.replace(/\(.*?\)/g, ""), ...[...lower.matchAll(/\((.*?)\)/g)].map((m) => m[1])];
	const slashed = names.flatMap((name) => { const m = /^(.*?)(\S+)\/(\S+)(.*)$/.exec(name); return m ? [`${m[1]}${m[2]}${m[4]}`, `${m[1]}${m[3]}${m[4]}`] : []; });
	return [...new Set([...names, ...slashed].flatMap((name) => [flat(name), flat(roman(name.trim()))]))].filter(Boolean);
};

function build() {
	const lines = readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LogLine);
	const byId = new Map<string, Area>();
	for (const line of lines) for (const a of line.areas) byId.set(a.id, a);
	const areas = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
	const known = new Set(areas.flatMap((a) => aliases(a.district)));
	const all = districts();
	const failed = lines.filter((l) => l.status !== 200).map((l) => l.keyword);
	const capped = lines.filter((l) => l.rows >= CAP).map((l) => l.keyword);
	// Exact (spacing-insensitive) names first; else Mengantar's own spelling in the same city counts when it differs by a
	// few letters ("Simeulue Tengah" / "SIMEULEU TENGAH", "Blang Bintang" / "BLANK BINTANG") or contains the other name.
	const byCity = new Map<string, string[]>();
	for (const a of areas) { const city = flat(a.city.replace(/\s*-\s*kota$/i, "")); byCity.set(city, [...new Set([...(byCity.get(city) ?? []), ...aliases(a.district)])]); }
	const close = (a: string, b: string) => a.includes(b) || b.includes(a) || distance(a, b) <= Math.max(2, Math.floor(Math.min(a.length, b.length) / 5));
	const unmatched = all.filter(([district]) => !aliases(district).some((name) => known.has(name)));
	const missing = unmatched.filter(([district, city]) => !(byCity.get(flat(city)) ?? []).some((name) => aliases(district).some((own) => close(own, name)))).map(([d, c, p]) => `${d}, ${c}, ${p}`);
	writeFileSync(OUT, gzipSync(`${JSON.stringify({ source: "Mengantar GET /address/search (read-only), keyword = Kepmendagri district + city", harvested_at: new Date().toISOString().slice(0, 10), count: areas.length, areas })}\n`, { level: 9 }));
	// Passes 1-2 are superseded by the postal sweep (pass 3), whose own capped leaves are the remaining gap.
	const sweep = lines.filter((l) => (l as LogLine & { pass?: number }).pass === 3);
	const answered = sweep.map((l) => l.keyword);
	const open = sweep.filter((l) => l.rows >= CAP && !answered.some((k) => k !== l.keyword && (k.startsWith(`${l.keyword} `) || (/^\d{4}$/.test(l.keyword) && /^\d{5}$/.test(k) && k.startsWith(l.keyword))))).map((l) => l.keyword);
	writeFileSync(`${DIR}/mengantar-harvest-report.json`, `${JSON.stringify({ queries: lines.length, of: all.length, areas: areas.length, failed, capped: capped.length, capped_open: open, spelling_matches: unmatched.length - missing.length, missing_districts: missing }, null, 1)}\n`);
	console.log(`queries ${lines.length}/${all.length}, areas ${areas.length}, failed ${failed.length}, capped ${capped.length} (open ${open.length}), spelling matches ${unmatched.length - missing.length}, districts without a match ${missing.length}`);
}

// Upsert the dataset into app.shipping_area. Areas missing from a newer dataset stay (warehouses and stored quotes
// may name them; the foreign key is RESTRICT), so a load never breaks history.
async function load(target: "local" | "test" | "production") {
	const { connectDatabase } = await import("../src/db/client.ts");
	const { sql } = connectDatabase(target);
	const data = JSON.parse(gunzipSync(readFileSync(OUT)).toString("utf8")) as { harvested_at: string; count: number; areas: Area[] };
	const version = `mengantar-${data.harvested_at}-${data.count}`;
	for (const a of data.areas) {
		if (!/^[0-9a-f]{24}$/.test(a.id) || !/^(\d{5})?$/.test(a.postal_code) || ![a.province, a.city, a.district].every((v) => v.length >= 1 && v.length <= 100) || a.subdistrict.length > 100) {
			throw new Error(`Malformed area ${a.id}`);
		}
	}
	try {
		const changed = await sql.begin(async (tx) => {
			let n = 0;
			for (let i = 0; i < data.areas.length; i += 1000) {
				const rows = data.areas.slice(i, i + 1000).map((a) => ({ id: a.id, province: a.province, city: a.city, district: a.district, subdistrict: a.subdistrict, postal_code: a.postal_code, dataset_version: version }));
				const result = await tx`insert into app.shipping_area ${tx(rows)} on conflict (id) do update set province=excluded.province, city=excluded.city, district=excluded.district,
					subdistrict=excluded.subdistrict, postal_code=excluded.postal_code, dataset_version=excluded.dataset_version
					where (app.shipping_area.province, app.shipping_area.city, app.shipping_area.district, app.shipping_area.subdistrict, app.shipping_area.postal_code, app.shipping_area.dataset_version)
					is distinct from (excluded.province, excluded.city, excluded.district, excluded.subdistrict, excluded.postal_code, excluded.dataset_version)`;
				n += result.count;
			}
			return n;
		});
		const [total] = await sql`select count(*)::int n from app.shipping_area`;
		console.log(`dataset ${version}: ${data.areas.length} areas, ${changed} inserted or updated, ${total.n} in ${target}`);
	} finally { await sql.end(); }
}

// Map every active warehouse to a Mengantar area of its own kecamatan (same district, city and province names after
// normalisation). lazy: the lowest postal code / kelurahan of that kecamatan; rates are priced per kecamatan, and S94
// pickup registration replaces it with the exact kelurahan of the street address. Dry run unless --apply.
const place = (value: string | null) => (value ?? "").toLocaleLowerCase("id-ID").replace(/^(kota|kabupaten|kab\.?)\s+/, "").replace(/\s*-\s*kota$/, "").replace(/[^a-z0-9]+/g, " ").trim();
const provinceName = (value: string | null) => place(value).replace(/^daerah istimewa\s+/, "di ").replace(/\s*\(.*\)$/, "").replace(/^nanggroe aceh darussalam.*/, "aceh");
async function resolveWarehouses(target: "local" | "test" | "production", apply: boolean) {
	const { connectDatabase } = await import("../src/db/client.ts");
	const { sql } = connectDatabase(target);
	try {
		const warehouses = await sql<{ id: string; name: string; province: string | null; city: string; district: string | null; provider_area_id: string | null }[]>`
			select id, name, province, city, district, provider_area_id from app.warehouse where active order by admin_no`;
		const areas = await sql<{ id: string; province: string; city: string; district: string; subdistrict: string; postal_code: string }[]>`select id, province, city, district, subdistrict, postal_code from app.shipping_area`;
		type Row = (typeof areas)[number];
		const byKey = new Map<string, Row[]>();
		for (const a of areas) {
			const key = `${place(a.district)}|${place(a.city)}|${provinceName(a.province)}`;
			byKey.set(key, [...(byKey.get(key) ?? []), a]);
		}
		let unmatched = 0;
		for (const w of warehouses) {
			const candidates = (byKey.get(`${place(w.district)}|${place(w.city)}|${provinceName(w.province)}`) ?? []).sort((a, b) => a.postal_code.localeCompare(b.postal_code) || a.subdistrict.localeCompare(b.subdistrict) || a.id.localeCompare(b.id));
			const chosen = candidates[0];
			console.log(`${chosen ? (chosen.id === w.provider_area_id ? "same " : "set  ") : "NONE "} ${w.province} / ${w.city} / ${w.district}${chosen ? ` -> ${chosen.subdistrict}, ${chosen.district} ${chosen.postal_code} (${chosen.id})` : ""}`);
			if (!chosen) { unmatched++; continue; }
			// Only while the location is still the one matched: a warehouse moved meanwhile keeps its cleared area.
			if (apply && chosen.id !== w.provider_area_id) await sql`update app.warehouse set provider_area_id=${chosen.id} where id=${w.id} and province is not distinct from ${w.province} and city=${w.city} and district is not distinct from ${w.district}`;
		}
		console.log(`${warehouses.length} active warehouses, ${unmatched} without a matching area${apply ? ", applied" : " (dry run; add --apply)"}`);
	} finally { await sql.end(); }
}

const [command, target, flag] = process.argv.slice(2);
const targets = ["local", "test", "production"] as const;
const isTarget = (value: string | undefined): value is (typeof targets)[number] => targets.includes(value as never);
if (command === "harvest") await harvest();
else if (command === "harvest-extra") await harvestExtra();
else if (command === "harvest-zip") await harvestZip();
else if (command === "build") build();
else if (command === "load" && isTarget(target) && flag === undefined) await load(target);
else if (command === "resolve-warehouses" && isTarget(target) && (flag === undefined || flag === "--apply")) await resolveWarehouses(target, flag === "--apply");
else throw new Error("usage: node scripts/mengantar-areas.ts harvest | harvest-extra | harvest-zip | build | load <local|test|production> | resolve-warehouses <target> [--apply]");
