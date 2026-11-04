# Shipping areas — Mengantar catalogue (reference)

Checkout, warehouse origins and shipping quotes use **Mengantar's own area catalogue** at kelurahan level. Each row keeps Mengantar's `_id`, which is sent as `origin_id`/`destination_id` to the rate estimate, so a quote never depends on matching names. This file explains where the data comes from, how the search API behaves, how to refresh it, and what is known to be missing. Review it whenever Mengantar changes its area data or API.

## Files

| File | In git | What |
|---|---|---|
| `mengantar-areas.json.gz` | yes | The dataset: `{source, harvested_at, count, areas:[{id, province, city, district, subdistrict, postal_code}]}`. Loaded into `app.shipping_area` (migration 0042) with `dataset_version = mengantar-<harvested_at>-<count>`. |
| `mengantar-harvest-report.json` | yes | Coverage report written by `build`: queries, areas, failed queries, capped count, `capped_open` (queries still at the 50-row cap after every split), `spelling_matches`, `missing_districts`. |
| `indonesia-districts.json` | yes | Kepmendagri kecamatan list (district, city, province) used only to drive pass 1 and the coverage check. |
| `mengantar-harvest.ndjson` | no (`.gitignore`) | Raw harvest log, one line per query. It is the resume cache: a rerun skips every keyword already answered. A copy is kept outside the repo in `/data/99ribu-local/shipping/`. |

The script is `scripts/mengantar-areas.ts`; the command registry is in the root `README.md`.

## How Mengantar's area search behaves (verified 2026-11-05, read-only)

- Endpoint: `GET {MENGANTAR_BASE_URL}/api/public/{key}/address/search?keyword=…` (the key is in the path and is never printed).
- **Hard cap of 50 rows** per answer. **No paging**: `limit`, `page`, `skip`, `offset`, `per_page`, `size` are ignored (same 50 ids).
- Each keyword token must match (**AND**) as a **substring of any field**, including `ZIP_CODE`. So `2445` returns codes 24450–24459 (and any code containing 2445), and `24453 PEUREULAK` narrows to one kecamatan inside one code.
- Spelling is Mengantar's own: `SIMEULEU TENGAH` (Kepmendagri: Simeulue Tengah), `BLANK BINTANG` (Blang Bintang), Roman numerals `ILIR BARAT II` (Ilir Barat Dua), slashes `SEI/SUNGAI BEDUK`, a city suffix `BOGOR BARAT - KOTA`, bracketed aliases `PADANG SIDEMPUAN UTARA (PADANGSIDIMPUAN)`.
- New kecamatan from recent splits are usually absent; Mengantar files their kelurahan under the old parent kecamatan (Pekanbaru's Binawidya, Tuahmadani and Kulim sit under `TAMPAN` and others). Checkout therefore also finds a kecamatan by kelurahan name or postal code.

## Harvest passes

1. `harvest`: one query per Kepmendagri kecamatan (`district city`).
2. `harvest-extra`: empty answers retried by district alone; capped answers completed per postal code seen; districts with no match searched by name and by a 6-letter prefix.
3. `harvest-zip` (2026-11-05): postal sweep past the cap. Every known 4-digit prefix plus its unseen siblings; a capped prefix splits into its ten 5-digit codes, a capped code by each kecamatan in it, a capped code + kecamatan by each kelurahan-name word, and a still-capped leaf by common syllables. Failed queries are retried on the next run.

Result on 2026-11-05: 25,959 queries, 0 failed, **82,374 kelurahan** (79,391 before; +2,983). The remaining gap is a few very dense Aceh gampong codes still at the cap after the syllable split (`capped_open`), and 145 Kepmendagri kecamatan with no Mengantar counterpart (`missing_districts`, mostly new kecamatan; see above).

## Refresh procedure (when Mengantar changes, or every few months)

Signals that a refresh is due: buyers report "kecamatan/kelurahan tidak ditemukan", a rate estimate refuses a stored area id, Mengantar announces new areas, or the yearly Kepmendagri update.

```bash
# 1. Read-only harvest (needs MENGANTAR_* in secrets-env; resumable; ~1-2 h for a full run)
secrets-env run -- node scripts/mengantar-areas.ts harvest        # only for a fresh log
secrets-env run -- node scripts/mengantar-areas.ts harvest-extra
secrets-env run -- node scripts/mengantar-areas.ts harvest-zip
# For a true refresh of existing keywords, move the old log aside first (keep a copy in /data/99ribu-local/shipping/).

# 2. Build the dataset and read the report (counts, capped_open, missing_districts)
node scripts/mengantar-areas.ts build

# 3. Local load (upsert; areas missing from a newer dataset stay because quotes and warehouses may name them)
node --env-file=.env.example scripts/mengantar-areas.ts load local
node --env-file=.env.example scripts/mengantar-areas.ts resolve-warehouses local          # dry run
node --env-file=.env.example scripts/mengantar-areas.ts resolve-warehouses local --apply

# 4. Production only with the owner's approval, after an off-host backup and the deploy that ships the dataset
#    (RELEASE.md step 10b): docker exec -w /app <web> node scripts/mengantar-areas.ts load production
#    then resolve-warehouses production (dry run, then --apply).
```

Never call Mengantar's order or booking endpoints from this script; it only uses `/address/search`.

## History

- 2026-10-30: passes 1–2, 79,391 kelurahan (S95), loaded to production 2026-10-31.
- 2026-11-05: pass 3 (postal sweep), 82,374 kelurahan, loaded to `99ribu_local` only; production load pending the owner's approval.
