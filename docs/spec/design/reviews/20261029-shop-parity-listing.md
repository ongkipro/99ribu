# shop.com parity: listing slice (`/cari`, `/kategori/<slug>`, product card)

Date: 2026-10-29. Reviewer: ShopListing (worker).

Sources: `.local/shop-ref/search/measure.json` (shop.com `/search/results?query=tote%20bag`, 2026-10-28), `.local/ref99/search/measure.json` (`/cari?q=tas`) and `.local/ref99/category/measure.json` (`/kategori/kecantikan`), all three at 390/768/1440, plus the PNG pairs. Older captures: `references/shop-com/2026-10-24-search`, `-filter-dropdown`, `-filters-sheet`. Owner decisions: `DESIGN.md` (lines cited as `D:<n>`) and `references/shop-com/visual-context.md` (`VC:<n>`).

shop.com's category capture (`/categories/women`) shows the "We looked everywhere!" empty state, not a listing, so the `/kategori/<slug>` rows use the search page numbers. Everything below came from the JSON or the screenshots. Nothing was loaded from shop.com at build time or at runtime.

## How the two pages are built

- shop.com: no top header (a 96px left rail at 1440; a bottom bar at 390/768), so the chip rail starts at y=12 (390) and y=24 (768/1440). Then comes the small h2 "Results", the grid, a "Related searches" tile row and more results, all loaded by infinite scroll. There is no footer while results remain (the footer appears after all 60 cards at 390).
- 99ribu: a store header (150px on phones, 158px from 701px) with the omnibox and the category pills, then the h1 page title, the chip rail, the grid, the "Lihat produk lainnya" button after three automatic loads, then the footer. The h1 replaces "Results" on purpose: the page has no other visible title, and the search term or category name is what the buyer needs to see.

## Vertical rhythm

Distances are from the measured y values (card top = h3 y − card width − 8).

| Element | shop.com 390 / 768 / 1440 | 99ribu before 390 / 768 / 1440 | Decision |
|---|---|---|---|
| Content start under the chrome | 12 / 24 / 24 (top edge, no header) | 24 / 40 / 40 under the header | **adopt 24** at every width (`.listing-main` padding-top 40 → 24 from 701px; phones unchanged at 24). The header itself belongs to the CHROME slice. |
| Rail → heading | 12+40 → 84: 32 / 32 / 32 | n/a (heading above rail) | keep order: 99ribu puts the page title first, then the filters that act on it (an h1 cannot follow its own controls). Not adopted. |
| Heading → grid | 20h, top 84 → grid 120: 16 / 22h, 96 → 142: 24 / 24 | rail bottom 268 → grid 292: 24 / 300 → 324: 24 / 24 | **adopt** 16 on phones (rail margin-bottom 16 → 8: 8 rail padding + 8); 24 kept at 768/1440 (it already matches). |
| Row pitch (card + row gap) | 259 / 264 / 290 | 231 / 240 / 263 | follows from the card width (below); the row gap matches (8 / 16 / 16). |
| Grid → "Related searches" | 24 (996 → 1020 at 1440) | n/a | not applicable: no search-suggestion data behind a related-searches block. |
| Last row → footer | no footer while results remain; 390 shows it 28px after the last card | 1440: 64 to the "Lihat produk lainnya"/pagination block, footer `margin-top` 64 (40 on phones) | keep owner decision D:78 ("64px before the footer (40 on phones)") and VC:467 (footer stays reachable after three loads). |

## Headings

| Element | shop.com | 99ribu | Decision |
|---|---|---|---|
| Results heading | h2 18/20 600 −0.5px (390), 20/22 600 −1px (768/1440), x = grid x + 8 | h1 28/30 800 −1px (phones), 36/38 800 −1px (from 701px) | keep owner decision D:61 (page heading 36/38 800, phones 28/30, "category, search"). Box: shop 22px high vs ours 38px. Not adopted: changing it is a site-wide `h1` token decision (01-base-tokens.css, coordinator). Flagged. |
| "Related searches" h2 | 20/22 600 −1px | none | not applicable (no data). |
| Card title | 14/18 600 −0.2px, one line | 14/18 600 −0.2px, one line, ellipsis | already equal (D:18). |
| Card vendor line, rating row | 12/16 vendor, 12/16 500 rating | none | not applicable (single merchant, no reviews; VC header: no data behind them). |
| Card price | 12/16 600 (captionBold) | 12/16 **400** | keep owner decision. Commit `eb870b0` (2026-10-25 15:57, "card prices regular weight") is newer than `45edd7e` (13:32, "card price weight 600"), and the DESIGN.md PDP row records "card prices 12/16 400 (owner)". DESIGN.md:17 and :70 still read 600, which is stale, so the coordinator should reconcile. The CSS comment that claimed 600 is corrected. |

## Grid and card

| Element | shop.com 390 / 768 / 1440 | 99ribu 390 / 768 / 1440 | Decision |
|---|---|---|---|
| Columns | 2 / 4 / 6 | 2 / 4 / 6 | equal. |
| Card box (w × h) | 183×251 / 188×248 / 214×274; the card has 4px side padding (390) or 8px (768+), so the column gap is the padding (8 / 16) | 175×223 / 172×224 / 195×247; grid gap 8 / 16 / 16 | Column gap equal. Card width differs only because 99ribu's container is the 1250px cap (D:19) with a 16/32/48 gutter, while shop.com is full-bleed minus a 96px rail: **keep owner decision** D:19, D:95. |
| Card height − width (text block) | 68 / 60 / 60 (vendor + title + rating + price) | 48 / 52 / 52 (8 + 18 + 2 + 16 + subgrid rest) | not applicable: the vendor and rating rows have no data. |
| Row gap | 8 / 16 / 16 | 8 / 16 / 16 | equal (D:79). |
| Photo frame | square, 20 radius, white, `0 2px 8px rgba(0,0,0,.06)`, 0.5px `rgba(5,41,77,.1)` inner edge, cover | same (`.product-frame`, `::after`) | equal (VC:219, VC:225). |
| Hover | photo scale 1.05 on card hover | scale 1.05, 300ms ease-out, off under reduced motion | equal. |
| Media → title → price | 8 / 0 (vendor) / 2 | 8 / — / 2 | equal. |
| Text inset | 4px | 4px | equal. |
| No-photo state | not observed | `.photo-slot` "Foto belum tersedia", `#55515f` on `#f4f3f8` = 6.97:1 (contrast.py) | keep. |
| Unavailable note | not observed | "Stok pilihan belum tersedia" chip | keep (real data). |
| Sale badge ("10% off"), store logo badge | present on some cards | none | not applicable (no compare-at price; contract forbids invented discounts). |
| PDP "Lainnya di <kategori>" grid | n/a | same card markup; 5 columns at 224×276, gaps 32/16 (1440); 3 at 235×287 (768); 2 at 175×223 (390) | read-only check: same card geometry; the column gap is S139's 32px (PDP slice, D:79). |

## Controls

| Element | shop.com | 99ribu | Decision |
|---|---|---|---|
| Chip | 40px tall, 1px hairline, `0 2px 8px` shadow, 14/16 600 −0.2px, 8/8/8/16 padding, 4px gap, 15px chevron | 44px tall, same type, border and shadow; 6/8/6/16 padding | keep the 44px target floor (VC:538). |
| Chip gaps | 8 (768/1440), 4 (390) | 8 / 4 | equal. |
| Rail position | centred above the content at 768/1440 (x 597–918 at 1440), left at 390 | left-aligned with the content | keep: shop.com centres the rail between a left rail and the viewport edge; 99ribu aligns it to the title it filters. Visual-only change, not adopted. |
| All-filters icon pill, "On sale" toggle | 40px round icon, toggle chip | none | not applicable (no sale data; 99ribu's facets are chips). |
| Popover / sheet | 300px popover, 28 radius, 44px rows | same (S111 phase 2a) | equal, no change. |
| Load-more | none: infinite scroll, no cap, no footer | 3 automatic loads, then "Lihat produk lainnya" 44px hairline pill; crawlable `rel="next"` hidden by CSS while JS runs | keep owner decision VC:467. |
| Loading row | about 80px loading row | skeleton row (frame and two lines, one row of columns) | keep (same role, measured). |
| Error | not observed | "Produk berikutnya belum dapat dimuat." + "Coba lagi" | keep. |

## States

| State | shop.com | 99ribu | Decision |
|---|---|---|---|
| No results | not captured (the search had results) | `.empty-state`: h2 "Belum ada produk yang sesuai", one muted line, a primary pill "Lihat semua produk"; 64px block padding (40 on phones) | keep (VC:63 empty-cart pattern). |
| Invalid filter | n/a | "Filter belum bisa digunakan" recovery page with "Hapus filter" | keep. |
| Focus | not measured | global 3px purple outline on the card link; chips get the ink ring | keep (D:137). |
| No JS | n/a | GET form in `<noscript>`, visible "Halaman berikutnya" | keep. |

## Breakpoints

shop.com moves to 2/4/6 columns at its sm/md/lg breakpoints. 99ribu uses 2 (≤700, auto-fill 8rem), 3 (701–767), 4 (768–1023) and 6 (≥1024). The 701–767 three-column band has no shop.com capture, so it is not measured. Kept.

## Not measurable here

- Hover timing on shop.com cards (static capture).
- shop.com's loading-row height, which was observed in 2026-10-24 notes only.
- shop.com category listing (blocked page; the capture is its empty state).
- The 701–767px band.

## Adopted (implemented in `src/app/styles/10-listing.css`)

1. `.listing-main` padding-top: 40 → **24** at 768 and 1440. Phones were already 24. shop.com's content starts 24px from its top edge at 768/1440.
2. Phone chip rail margin-bottom: 16 → **8**, so the gap from the chip row to the grid is 16px (shop.com's 390 "Results" → grid distance is 16).
3. Price weight comment in `08-product-card-header.css` corrected to the shipped owner decision (400). No visual change.

## Kept as owner decisions

36/38 page h1 (D:61), 1250px cap and card width (D:19), 44px chips (VC:538), 12/16 400 card price (eb870b0), three automatic loads plus the button and the footer (VC:467), the PDP related grid's 32px gap (D:79). The footer gap is now the CHROME slice's change (ShopChrome, 2026-10-29: `margin-top` 64 → 40 from 701px, 40 → 24 on phones, after shop.com's ~41px last row → footer); this slice does not override it.

## Expected numbers after the rebuild

These include ShopChrome's header change (158 → 148 from 701px; phones stay 150).

- 1440 `/cari?q=tas`: h1 y 198 → **172**, chips y 256 → **230**, first card top 324 → **298** (first h3 y 527 → **501**); `/kategori/kecantikan` the same.
- 768: h1 y **172**, chips **230**, first h3 y 504 → **478**.
- 390: h1 y 174 (unchanged), chips 224 (unchanged), first h3 y 475 → **467**.
- The listing's `div.empty-state` keeps its own h2 and copy; only ShopChrome's shared gap, lead and pill rules reach it.
