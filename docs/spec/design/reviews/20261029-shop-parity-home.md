# Home (`/`): shop.com parity gap table (2026-10-29)

Sources: `.local/shop-ref/home/measure.json` + `390/768/1440.png` (shop.com, 2026-10-28 21:06Z) and `.local/ref99/home/*` (99ribu build with 392 Berlapak products). Some values come from the PNGs and not from the probe. They are marked "px-read" and were read from glyph and edge rows, with ±2px error. Owner decisions are cited from `DESIGN.md` (D) and `docs/spec/design/references/shop-com/visual-context.md` (VC). Nothing from shop.com is used except numbers.

Decision key: **adopt**; **keep** = keep the owner decision; **n/a** = no 99ribu data or feature behind it.

## Vertical rhythm

| Element | shop.com | 99ribu (before) | Decision |
|---|---|---|---|
| Pill row → hero card top | 24px at 390 (px-read: circle bottom 181 → hero 205); from 768px the hero card starts at the header's bottom edge (y=148 at 1440) | 49px at 390, 49px at 768/1440 (133→182; 141→190) | **adopt**: removed the hero's 8px `margin-top`. In the 06 home block, `.home-main` top padding is 8px on phones and 0 from 701px. With ShopChrome's header (phones end 16px under the circles; 148px from 701px), the hero sits 24px under the circles on phones and directly under the pill row above. This overrides the 24px in the tokens file, so the coordinator can drop it there. |
| Hero bottom → first section heading | 40px at 390 (716→755.4), 40px at 768 (642→680), 38px at 1440 (611→649) (px-read) | 48px | **adopt** 40px (`.home-shelf` margin-top 40, or 28 + 12 padding on home). |
| Heading box | 20px at 390 (18/20), 22px at 768/1440 (20/22) | 44px (link min-height) | **adopt**. The heading is a 22/20px line box. A `::before` hit area on the link keeps the 44px target (11–12px into the gaps). The home sections carry 12px of the 40px as padding, so the hit area stays inside their `content-visibility` paint box. |
| Heading → content | 16px at every width (Categories 1103.2+22 → grid 1141.2) | 16px below a 44px box (60px visually) | **adopt** 16px from a 22px box. |
| Block → next heading | 40px (Trending cards end 1063.2 → Categories 1103.2; shelf end 1967.5 → "Home" 1991.5 is 24px after the 32px-padded row) | 48px | **adopt** 40px; DESIGN.md "48px between home sections (40 on phones)" needs updating (coordinator). |
| Switcher strip | 240px at 1440/768, 132px at 390 (VC l.191). The name's line box ends about 32–37px above the panel shelf (px-read) | 136 + 96 + 24px. The shelf sits 24px below the strip, so the name → shelf distance is about 48px | **adopt**: bottom padding 36px (24px on phones). Top padding is 128px (112px medallion + 8 lift + 8). Panel gap 24/16 is kept. |
| Last section → footer | 1440: rail end 3383.8 → footer 3435.8 = 52px; 390: last row 3321 → footer 3353 = 32px | 64px (`.store-footer` margin-top, 40 on phones) | **n/a here**: the footer is another slice. ShopChrome sets it to 40px (24px on phones). The home's last section adds no bottom margin. |
| Editorial heading above the rail | 1440: 88px-class poster, 800 weight, centred, 2 lines on an 85px pitch (cap 65px, px-read 2636→2701), about 120px under the previous block, about 40px over the 410x520 rail (px-read 2803→2863.8). Not present in the 390/768 captures (stores row instead) | 20/22 600 "Temukan pilihan", 40px under the switcher | **adopt** from 1024px: 88/84 (5.5rem/5.25rem) 800 −1px, centred, balanced, 120px above (108 + 12) and 40px below. **keep** the wording "Temukan pilihan" (VC l.27, round 52) and the 20px heading below 1024px. Card titles (18px) still rank under it. |

## Headings and type

| Element | shop.com | 99ribu | Decision |
|---|---|---|---|
| Hero heading | 64/58 800 −1px (36/38 phone) | same | already matches |
| Section heading | 20/22 600 −1px; 18/20 −0.5px phone | same type, 44px box | box fixed (above) |
| Switcher label | 96/96 800 −1px; 42/42 phone; 64px at 768 | same (64px 701–1023) | already matches |
| Card title / price | 14/18 600 −0.2 / 12/16 600 | same | already matches (product-card slice) |

## Grid and cards

| Element | shop.com | 99ribu | Decision |
|---|---|---|---|
| Category tiles | 175x124 at 390 (2 col), 178x124 at 768 (4 col), 247x124 at 1440 (5 col); gaps 8/8 everywhere | 175x72 / 235x84 (3 col) / 237x112; gaps 8 phone, 16 from 768 | **adopt** 124px height at every width and 8px gaps at every width. D l.79 ("16px from 768px") names product grids and rows, not tiles, so it does not apply. **keep** the columns 2/3/4/5 (VC l.343, round 27: a 178px tile cannot fit a name beside its photo). Photo card 56px on phones and 88px from 768px, sized to fit inside a 124px tile at −6deg. Also applies to `/kategori` (same component, VC l.281); Main was told. |
| Category tile radius / label | 16px; label 14/18 600 phone, 16/22 600 md | same | already matches |
| Shelf cards | 1440: 7 cards 174x250 at 7.7px gap; 768: 172x228 at 16px; 390: 162x218 at 7.8px | 1440: 165x239 at 16px (7 per row; the probe saw 5 or 7 because of data); 768: 4.6 cards at 16; 390: 2.3 at 8 | **keep**: D l.79 / VC l.614 (16px from 768px, home rows included, owner). Flagged: the fresh 1440 probe says 7.7px, against the 2026-10-25 reading of 16px. The owner should decide. With 8px the cards would be 174px wide (+9px). |
| Banner rail | 410x520, gap 10, radius 28 | 410x520, gap 10, radius 28 | already matches (VC round 50) |
| Hero card | 1440: 1268x461 (2.75:1), radius 36, `0 8px 40px rgba(0,0,0,.24)`; 390: 358x~500 (px-read 206→716 = 510) | 1250x455 (2.75:1, 1250 cap), 440 at 701–1279, 500 min on phones, radius 36, same shadow | already matches. **keep** the 1250 cap (D l.19). |

## Controls

| Element | shop.com | 99ribu | Decision |
|---|---|---|---|
| Hero actions | 46/44px pills, 16/20 600, 12px padding; phone 2 columns of 159px | 44px pills, same type; phones stacked full width | **keep** stacked (VC l.379, round 33: "Bantuan belanja" would wrap) |
| Shelf arrows | 42px white circles at 1440/768 | 44px (target floor) | **keep** 44 (D l.135 target floor; D l.22 arrows kept) |
| Hero carousel arrows (32px, 0.3 ink) | store carousel controls | none | **n/a** (no store carousel) |
| Phone dock | 390x56 fixed, 5 × 78x56 | 390x64, 5 tabs + raised Cari | **keep** (D l.26, owner 2026-10-28) |
| Phone header | 52px logo row + 64px omnibox + 40px pill row | omnibox at y 22 (44px), pills, no logo | **keep** (D l.20, phone header without logo) |

## States and behaviour

| State | shop.com | 99ribu | Decision |
|---|---|---|---|
| Heading link hover | not measurable (static capture) | purple | unchanged |
| Focus | not measurable | 3px purple outline (global); tiles get a 2px ink ring | unchanged. The heading link's outline follows its 22px box. The 44px hit area is invisible. |
| Tile hover | art scale 1.05 | photo scale 1.05, off under reduced motion | unchanged |
| Switcher | infinite JS carousel, 300ms medallion | native scroll, tabs, 300ms medallion, reduced-motion off | unchanged (VC l.197 skipped loop) |
| Rail motion | drifts continuously | no autoplay (WCAG 2.2.2) | **keep** (VC l.505) |
| Empty | n/a | "Pilihan sedang disiapkan" section | unchanged; it inherits the 40px rhythm |
| Loading / error | not measurable (server-rendered page) | server-rendered, `content-visibility:auto` below the hero | unchanged |
| Breakpoints | sm/md/lg/xl (640/768/1024/1280) | 641/701/768/1024/1280 | unchanged; the poster heading starts at 1024 (shop.com's lg) |

## Sections shop.com has that 99ribu cannot fill (n/a)

- "Shop is all about you" value card with an app phone mockup: 99ribu's hero card has its own copy and photos (VC hero contract).
- "Trending stores" (store cards 330x502 with merchant rows, follow): there is no store or merchant entity in the catalog.
- Store collection carousels below "Home" (1440, y 2029–2502): no store data behind them.
- Editorial collection cards with brand avatars ("Brand Spotlight", 3-avatar stacks): no brands or follows. 99ribu fills the rail slot with the data-backed "Temukan pilihan" banners (VC round 50).
- Ratings, vendor line and sale price in shelf cards: there are no reviews, vendors or compare-at prices.

## Not measured

- Hover, focus and active colours on shop.com (static probe).
- shop.com's editorial heading box: the probe returned no node for it. Its geometry was read from pixels.
- 99ribu's `/` with fewer than 10 departments: tile rows depend on the data.
