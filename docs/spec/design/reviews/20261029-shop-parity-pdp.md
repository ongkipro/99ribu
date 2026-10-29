# Shop parity, product page (`/produk/[slug]`), 2026-10-29

Slice: PDP (ShopPDP). Inputs: the same probe on both sites. shop.com: `.local/shop-ref/pdp/{measure.json,390,768,1440.png}` (Cascade Tote). 99ribu: `.local/ref99/pdp/…` (Paket Mobil & Ruangan Kopi Bali Summerspring, real catalog). Pixel rows and colours were sampled from the PNGs with PIL; JSON fields are cited as `y/h`. Only numbers are transferred. No shop.com asset, copy, class name or markup is used.

Owner decisions that win: DESIGN.md lines 19 (1250px cap), 27 (phone top bar and buy bar), 63 (title 500), 64 (PDP spacing, price 20/24, no Save/Share), 79 (card grids), 125 (PDP composition); visual-context.md 555 (square photos, round 30: no crop; DEC-020 "Beli sekarang"; text option pills); BUILD-LOG 2026-10-25 (two-column 54px action row, 5/3/2 related grid).

## Vertical rhythm

| Element | shop.com measured | 99ribu before | Decision |
|---|---|---|---|
| Gap under the header (desktop) | no top header (side rail); photo card at y=32 | 32px under the store header | keep (DESIGN 64: 32/24/16) |
| Phone: photo → title | photo row 68–448, h1 y=464 (16px) | photo 0–390, breadcrumb, h1 y=442 | keep (DESIGN 27: full-width photo from the top edge, breadcrumb DEC-019) |
| Breadcrumb → title | no breadcrumb | 8px | keep (DESIGN 85) |
| Title → price | 28px title, rating row, price line ~148 (≈36px, includes a rating) | 12px | keep (DESIGN 64; no rating data) |
| Field label → control | label text 213, swatches 232 (8px); "Quantity" → pill 8px | 8px | already matches |
| Quantity pill → action row | pill ends 352, "Add to cart" starts 376: **24px** | 16px (pill 378–422, action 438) | **adopt**: `.purchase-region .cart-mutation` gap 24px |
| Action row → first section header | 32px (Save row ends 558, "Description" header 590); without Save the row would be 24px + the 8px used on the header | 8px (actions end 492, Deskripsi header ≈500) | **adopt**: `.product-sections` margin-top +8px (24px buy-box gap + 8 = 32px) |
| Section → section | hairline, 52px header, body + 16px bottom padding | same | already matches |
| Last section → related heading | 1440: 88px after the store card (no equivalent); 390: 56px | 64px desktop, 48px phone | keep (DESIGN 78: 64 before the next section, 40-48 phone); the store card has no 99ribu equivalent |
| Related heading → grid | 1440: h2 1758 (22px) → grid 1804: **24px**; 390: h2 2174 (20px) → grid 2210: **16px** | h2 box 44px (link target) + 16px: 60px from heading top (1163 → 1223) | **adopt**: heading line box = text (44px link target overhangs with negative block margin, same technique as the breadcrumb), margin 24px desktop/tablet, 16px phone |
| Related grid → footer | grid ends about 41px above the footer | footer margin 64/40 | adopted by ShopChrome (footer margin 40px from 701px, 24px on phones; header 10px shorter from 701px); not edited here |

## Headings and type

| Element | shop.com | 99ribu before | Decision |
|---|---|---|---|
| h1 | 24/28 600 -1px | 24/28 500 -1px | keep 500 (DESIGN 63) |
| Price | 16/22 600 | 20/24 600 -0.5px | keep (DESIGN 64; test `storefront-cart` asserts 20px) |
| Section headers (Deskripsi, Pengiriman…, Pengembalian, Isi yang diterima) | 18/20 600 -0.5px, 52px box, at 390, 768 **and 1440** | 20/22 600 -1px desktop (18/20 phones via token) | **adopt**: 18/20 -0.5px at every width (`--subtitle-*`, `--tracking-body`) |
| Related heading | 1440/768: 20/22 600 -1px; 390: 18/20 -0.5px | same | already matches |
| Body text in sections | 14/18 400 -0.2px | description 14/18; policy rows 14/20 | **adopt** 14/18 on the policy rows |
| Field labels | 12/16 600 + 400 value | same | already matches |

## Grid, cards, media

| Element | shop.com | 99ribu before | Decision |
|---|---|---|---|
| Columns at 1440 | media 112–900, gap **40px**, buy box 940–1404 (**464px**) | media 95–825, gap 56px, buy box 881–1345 (464px) | **adopt**: gap 40px from 1051px (buy box stays 29rem = 464px, media gains 16px) |
| Columns at 768 | media 192px portrait card, buy box 268–732 (464px) | half/half (352 + 32 + 352) | keep: a 192px column would shrink 99ribu's square photos to ~190px (square photos: visual-context 555) |
| Photo card | 588×736 (4:5), radius 20px (corner sampled: 20px), **background rgb(239,239,239)**, product contained, no shadow | square, radius 20px, white, `0 2px 8px` shadow, `object-fit: contain` | **adopt the frame**: `#efefef` behind the contained photo, no shadow (gallery photos only). Keep square and `contain` (round 30: merchant photos carry text, never cropped). Valid because the photo is untouched; the grey only shows where a photo is not square or has transparent edges. The sample-product slot keeps white behind its caption. |
| Thumbnail rail | 48×48, radius 8, white, 6px apart, beside the photo | same (48, 8, 6) | already matches |
| Phone gallery | swipe row of 312px cards with 4px padding, peek | one full-width square per view from y=0, "N / M" | keep (DESIGN 27) |
| Related grid 1440 | 5 cols, 228px cards, 32px column gap | 5 cols, 224.4px, 31.6px (1250 cap) | already matches (cap: DESIGN 19) |
| Related grid 768 | 2 cols, 360px, 16px | 3 cols, 234.7px, 16.3px | keep 3 (BUILD-LOG 2026-10-25 owner review "related 5/3/2-column grid") |
| Related grid 390 | 2 cols, **171×247**, **16px** both ways | 2 cols, 175×223, **8px** | **adopt** 16px both ways (cards become 171px wide; height follows 99ribu's one-line title and price, no rating row) |
| Card internals | rating, merchant line | title 14/18 600, price 12/16 | keep (no ratings; DESIGN 18) |

## Controls

| Element | shop.com | 99ribu before | Decision |
|---|---|---|---|
| Option controls | 40px colour swatches, 8px gaps | 44px text pills, 8px gaps | keep (44px tap floor; text pills, visual-context 555) |
| Quantity pill | 102×40, 1px rgba(0,0,0,.1), white | 140×44 (44×42 steps) | keep 44px (tap floor) |
| Add to cart | 52px pill, full width; Buy now 54px below it, 8px gap | two 54px pills side by side, 8px gap | keep (BUILD-LOG 2026-10-25 DEC-020 two-column row) |
| Action label at ≥701px | 16/20 600 -0.5px | 16/20 at 1440; 14px at ≤1050 | keep (172px tablet pills need 14px for one line) |
| Save / Share | 44px pills | none | keep (DESIGN 64) |
| Accordion chevron | 16px box (glyph 10×6) | 16px | already matches |
| Accordion hairline | 1px rgb(237,239,241) on #fbfbfb (≈ hairline ink at 6%) | 1px rgba(24,59,78,.12) | **adopt**: `color-mix(var(--hairline) 60%)` = rgba(5,41,77,.06) |
| Delivery rows | 16px icon box (12px glyph), text at +28px (12px gap), 30px pitch (14/18 + 12) | 20px icon, 12px gap, 14/20 + 12 = 32px pitch | **adopt**: 16px icon (1rem, scales with text), 14/18 lines, icon centred on the first line |
| Delivery pills ("Return policy" etc.) | grey 40px pills | one "Ketentuan pengembalian" link | not applicable (no extra policy pages) |
| "Baca selengkapnya" | grey pill (description short in this capture: not shown) | grey 44px pill | could not be measured on this capture; keep |

## States, behaviour, breakpoints

| Item | shop.com | 99ribu | Decision |
|---|---|---|---|
| Sticky media | sticky at top 32 (1440), 92 (768) | sticky at 32 desktop | already matches |
| Hover / focus / active | not readable from the probe (static capture) | existing rings, 150ms colour transitions | could not be measured; keep |
| Empty / loading / error | not in capture | server-rendered states (unknown offer, out of stock, cart errors) | not applicable |
| Phone floating product bar / buy bar | none (site dock) | DEC-019/DEC-020 bars | keep (DESIGN 27) |
| Breakpoints | md/lg | 700 / 1050 | keep (DESIGN 96) |
| Reviews, store card, Save/Share | present | absent | not applicable (no data; owner removed) |

## Summary

Adopted (9): quantity → actions 24px; actions → first section 32px; section headers 18/20 -0.5px at every width; section body 14/18 on delivery rows; desktop column gap 40px; grey photo frame without shadow; related heading 24/16px to grid with a text-height line box; phone related grid 16px gaps; accordion hairline at 6%; delivery icon 16px.
Kept as owner decisions: title 500, price 20/24, square contained photos, tablet half/half columns, 3-column tablet related grid, side-by-side 54px action pills, text option pills, 44px quantity pill, no Save/Share, phone bars, breadcrumb.
Not measurable: hover/focus timings, read-more pill (absent in this capture), empty/loading states.
