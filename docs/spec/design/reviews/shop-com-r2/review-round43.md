Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/banners-1440.png, docs/spec/design/renders/shop-com-r2-20261022/banners-390.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1440.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-mid-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/dock-home-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/filter-nojs-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-pop-1440-dpr2.png, docs/spec/design/renders/shop-com-r2-20261022/filter-sheet-390.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-appended-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-more-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-skeleton-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-focused-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: bf5c30f7e2c1f0fc
Images-SHA: 29358533d88032e6
Output-SHA: c4344b3453a45d84

Paduka Ongki, saya sudah buka ke-115 gambar. Hasilnya **REVISE**: komposisinya sudah sesuai kontrak, tapi ada satu render yang rusak dan satu section yang kosongnya terlalu besar. Detail review di bawah dalam bahasa Inggris. Saya juga simpan ringkasannya di `/home/ongki/.claude/plans/you-review-a-web-distributed-coral.md`. Belum ada perubahan apa pun di repo.

## Section-by-section

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Env banner + header (brand, omnibox, Promo→Cart→Account) | authored | shop.com 512px white omnibox pill with purple round submit; centred | none needed |
| Brand hover reveal | authored | owner brief (shop.com has none) | none; the "a" clipped mid-transition in `brand-hover-mid` is a transient frame |
| Category pills | authored | shop.com pill row (photo circle + 16/600 label + grid link) | none; focus ring is whole and unclipped at 1440 and 320/200% |
| Hero | authored | shop.com "Shop is all about you" card: left copy, floating product tiles | none; 320/200% grows without clipping and keeps "Rp99.000" on one line |
| Kategori grid | authored | shop.com "Categories ›" tiles, re-drawn as tint + tilted photo card | none |
| Terbaru shelf | authored | shop.com department shelf (1:1 frame, 14/600 one-line title, 12/600 price) | none (merchant photo text is accepted content) |
| Category switcher | authored | shop.com 96/800 switcher with medallion | none |
| **Promo banner** | **generic orphan** | shop.com "Discover something you love" rail, but only one card | **When there is one banner, render it full container width, or hide the section; fix the 320 clipping** |
| Footer | authored | shop.com columned white band | none |
| Mobile dock | authored | shop.com icon-only dock, filled active icon | none |
| Listing heading + filter chips | authored | shop.com chip row above "Results", filled active chips | cap chip width at the viewport and ellipsize the value at 320/200% |
| Filter dropdown / phone sheet | authored | shadcn Select (owner brief) / shop.com 28px bottom sheet | remove the second (purple) focus ring on options |
| Result grid + infinite scroll | authored | shop.com six-column grid; skeleton row uses the card frame | make "Lihat produk lainnya" the white hairline secondary pill |
| No-JS filter form | authored | R4 native `details` panel | none |
| PDP media | authored | shop.com white ~28px media panel | sticky media column from 1024px |
| PDP buy box | authored | shop.com narrow buy box, 52px pill primary | drop the empty "Spesifikasi" block |
| PDP accordions | authored | shop.com hairline + right chevron | none |
| Cart lines + summary | authored | R7 unboxed lines, white 20px summary card | make "Perbarui jumlah" the white secondary pill |
| Empty cart | authored | shop.com centred heading, line, single primary pill | none |
| `/promo` page | authored | standard grid | none (bundle overlap is an accepted decision) |
| Omnibox open / typing | authored | shop.com one glass surface + chip variant (owner) | none; no inner pill, bold match, "Cari "…"" chip at the end |

## Findings (most severe first)

1. **Promo banner is clipped at 320/200%** (`f9ad8c3bad0b98a7-home-320-text200-04.png`).
   - The card keeps a fixed size, so the caption overflows upward. "Paket hemat" and the first line of the body sit above the card's top edge and are cut off.
   - The visible text ("pilihan lengkap, tetap Rp99.000.") lies on top of the "PREMIUM QUALITY" seal.
   - This is broken rendering, so it blocks acceptance. The card should grow with its content, and at narrow or enlarged text the caption should sit below the photo.

2. **The single promo banner leaves a dead row at 1440** (`047b8bc560694513-banners-1440-01.png`, `894181cd6f0102a7-home-1440-02.png`).
   - One 410×520 card sits left-aligned, with about 840px of empty canvas beside it. The shop.com rail it copies shows 4+ cards running off the edge, so one card reads as an orphan and breaks the page rhythm.
   - The image is a single floor-drain strainer. It is the same photo as the Rumah Tangga tile and pill, so it appears a third time on the page.
   - It also carries a "PREMIUM QUALITY" seal while the copy says "Beberapa barang berbeda dalam satu pilihan". The picture contradicts the message, and an unsourced quality seal shows up on a curated surface.
   - Fix: render one banner as a container-wide horizontal card, or hide the section. Use an image that shows several bundle items.

3. **Double focus ring in the filter dropdown** (`c87e94a18e75a0fd-filter-pop-1440-dpr2-01.png`). "Semua pilihan" shows the ink inset ring plus a purple global outline, and the outer ring touches the popover edges. The contract specifies the inset ink ring only.

4. **Empty left column on the bundle PDP** (`46d89c1d6a760cb4-pdp-bundle-open-1440-01.png`). The media panel ends at about 935px while the buy column runs to about 2200px, leaving the left half blank for over 1200px. A sticky media column from 1024px would keep the product in view.

5. **Empty "Spesifikasi" block** ("Spesifikasi tambahan belum tersedia.") appears on the PDP at 1440, 390 and 320. It is filler between the main action and the accordions; hide it when empty.

6. **Filter chip cut by the viewport at 320/200%** (`90075c5f3ef47823-category-320-text200-01.png`). The "Urutkan: Paling se…" chip is wider than the screen and is cut mid-word.

7. **Three secondary button styles.** "Lihat produk lainnya" (`1c2f076ac3cfbae7-listing-more-1440-01.png`) and "Perbarui jumlah" (`4567ff2f4faf9334-cart-filled-1440-01.png`) use a purple-outline pill. The hero secondary and the R3 chips use a white pill with a hairline or soft shadow.

8. **Evidence gap.** `236d9279e969a940-dock-320-text200-01.png` shows only the header and hero, with no dock. The dock at 320/200% is only evidenced by category slice 15.

## Reference transfer
- **Home order and rhythm:** pills → hero → Kategori → shelf → switcher → banners → footer. This follows shop.com's sequence, with "Trending stores" correctly dropped (single merchant).
- **Hero:** it replaces shop.com's video and phone mock-up with real product tiles on the purple/yellow tint. That transfer is justified: no stock imagery, and our own photos are used.
- **Listing:** it matches the six-column shop.com grid, the 1:1 frames with 20px radius and the 14/600 one-line title. It also drops badges, ratings and the struck price, which is consistent with the fixed-price rule.
- **PDP:** it matches the narrow buy box, the 52px primary and the hairline accordions. Thumbnails are absent because there is only one photo.
- **Help page:** not in this image set (help-390/1440 were "reviewed earlier"), so it was not judged this round.
- **No template signals found:** no dark hero, no eyebrows, no monospace, and no arrow on every button (only the hero secondary and the submit have one).

Most important change: make the Promo banner section fit its content. Let the card grow so the caption is never clipped at 320/200%, and when there is only one banner, render it container-wide with an image of several bundle items, or hide the section.

Verdict: REVISE