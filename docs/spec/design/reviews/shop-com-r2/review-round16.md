Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/categories-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: e19fb16f247d4820
Images-SHA: 9d415d85789692c9
Output-SHA: bb2e087933d927f4

Paduka Ongki, saya sudah buka semua 176 slice; 26 di antaranya referensi shop.com. Saya juga buka dua referensi home 2026-10-23 versi full. Hasilnya **REVISE**, karena ada dua render yang rusak. Selebihnya sudah rapi dan sesuai kontrak. Ringkasannya juga saya simpan di file plan.

### Per section (top to bottom)

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Env banner + header (omnibox, chips) | authored | R1/R2/R3, shop.com home pill omnibox and chip row | On cart pages the omnibox gets narrower when the "1" badge appears (`4567ff2f…-cart-filled-1440-01` vs `894181cd…-home-1440-01`). Give the utilities a fixed width. |
| Home hero + fixed-price card | authored | shop.com value card, with 99ribu's Rp99.000 anchor | None. The H1 being smaller than the card price is an accepted deviation. |
| Home "Kategori ›" tiles | authored at 1440/390/320; **broken at 768** | shop.com "Categories ›" tinted tiles | At 768 names break letter by letter: "Kec/anti/kan", "Ru/ma/h", "Ho/bi, Luk/is" (`fd8b8d79…-home-768-01/02`). Stack the name above the photo below about 1050px, or set a minimum column width so tablets get 3 per row. |
| Home "Terbaru ›" + department shelves | authored at 1440/768; **broken at 320/200%**; weak at 390 | shop.com Beauty shelf (single scrolling row, 1:1 media, regular-weight titles) | At 320/200% the cards overlap: "Rp99.00Rp99.00R", "BoronganHemat", "KacamataKaos Distr" (`f9ad8c3b…-home-320-text200-04/05/06`). Cause: `grid-auto-columns: 42%` (about 121px) is narrower than the doubled price (about 150px). At 390 there is about 50px of dead space between a 3-line title and its price, because the 5-line track is sized by cards that are off screen. |
| Search / listing (filters, chip, grid) | authored | R4/R5, shop.com search 1440/390 without the rail | None: 5-column/3-column/2-column/1-column grids, prices aligned per row, the 768 2×2 filter panel and the removable chip all hold. |
| Search filters open 390 | authored | non-modal adaptation of shop.com's filter sheet | None. |
| PDP + bundle (closed/open) | authored | R6, shop.com PDP 1440/390 (narrow buy box, 52px pill, chevron accordions between hairlines) | The cart lists bundle items with hollow circle bullets, the PDP with filled discs. Pick one. The empty band under the media at 1440 is a full-page capture of the sticky media, not a defect. |
| Cart empty | authored | R8, shop.com empty cart (one filled pill) | None. |
| Cart filled | authored | R7 (unboxed line, white summary card, 52px checkout pill) | Same bullet inconsistency as the PDP. |
| `/categories` | authored at 1440/390/320; **broken at 768** | same tiles as home | Same word-breaking defect (`3520b888…-categories-768-01/02`). |
| Help + chat card | authored | R11, shop.com help (centred column, 2-up topic cards, support at the end) | None. Chat wraps cleanly at 320/200%. |
| `/masuk` + error | authored | centred 20px card; the alert takes focus | None. The clipped email value is normal input scrolling. |
| Not found | authored | R8 | None. |
| Footer + dock | authored | R9/R10 (one link column; lavender pill on the active tab) | None. |

### Template signals
None found that matter. There's no dark hero, eyebrow labels, gradient word, monospace, `A · B` labels, arrows on every button or unsourced stats. The footer note no longer makes claims. Pills and the lavender tile tint come straight from the shop.com observations and the R3/R12 contract. With the name swapped, the page would still read as a fixed-price commerce catalog, not a generic template.

### Reference fidelity
- **Matches:** the off-white canvas with white raised surfaces, the flat 48px section rhythm, the heading-as-link "Kategori ›" pattern, the scrolling product shelf, quiet card hover, the narrow buy box and the centred empty and help columns. Skipping Trending stores, the marquee and editorial collections is justified because there's no data for them.
- **Mismatch:** shop.com tiles keep the photo sharing space with the name at every width. 99ribu's fixed 64px photo beside the name doesn't survive a 131px tile.
- **Gaps:** option pills (R3/R6) are still unverified because the data has no multi-option product. That's recorded and isn't a design failure.

### Root causes (`src/app/globals.css`)
- **Tiles (lines 4115–4159):** 5 columns from tablet up makes each tile about 131px. After 28px padding, the 64px photo and an 8px gap, the name gets about 31px, and `overflow-wrap: anywhere` breaks the words.
- **Shelf (lines 4225–4229):** on phones the columns are a fixed 42% with no single-column fallback, unlike the listing grid.

Most important change: fix the category tiles so names never break at 768 (stack the name above the photo or require a wider column), and widen the shelf columns with text size so prices stop colliding at 320/200%.

Verdict: REVISE

Kalau Paduka setuju, temuan ini saya serahkan ke builder. Setelah diperbaiki perlu capture ulang dan satu ronde review lagi.