Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/favicon-sheet.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 55f524e2392e1035
Images-SHA: e1e371a1413c23a8
Output-SHA: 44623148014fc4f5

Paduka, saya sudah membuka semua 125 render di `design/review-slices/` dan semuanya bisa diperiksa. Hasilnya **PASS**. Ada beberapa catatan kecil, tapi tidak ada yang menahan. Ini penilaian visual saja, tidak menguji interaksi atau aksesibilitas. Detailnya dalam bahasa Inggris di bawah.

## Section by section (top to bottom)

| Section | Generic/authored | Look matched | One concrete fix |
|---|---|---|---|
| Environment banner | authored | none (local-sim notice) | none; at 320/200% it shortens to "Data contoh: simulasi lokal." as specified |
| Header + omnibox (closed) | authored | shop.com omnibox pill (soft shadow, round purple submit) | none; the cart badge sits on the icon and Promo takes the current fill on `/promo` (`b651…promo-1440`) |
| Omnibox open / typing | authored | shop.com glass panel with suggestion chips | none required; it shows 6 chips while the recorded list has 13 (`440c…`, `64b8…`), so either note the cap in the contract or confirm it is intended |
| Department pill row | authored | shop.com photo pill chips + grid link | none; current pill has the lavender fill (`0139…category-1024`), focus ring is unclipped at 1440 and at 320/200% (`60c6…`, `59c9…`) |
| Hero | authored | shop.com "Shop is all about you" card (photos float on a tint, copy bottom-left, 2 actions) | none; at 320/200% the price stays whole and the actions stack (`46ba…`) |
| Home "Kategori ›" grid | authored | shop.com Categories tinted tiles | none at home (10/9/6 tiles, whole rows) |
| "Terbaru" shelf | authored | shop.com department shelf (7 at 1440, cut card at 768/390) | none |
| Category switcher | authored | shop.com large-label switcher with medallion | none; the medallion sits above the label instead of over it, a recorded legibility deviation |
| Search / category listing | authored | shop.com Results grid (6 columns, 20px media, 14/600 title, 12/600 price) | none; the open filter panel with native selects is a recorded R4 deviation |
| `/kategori` index | authored | same tiles as home | fill the empty 5th slot in row 3 at 1440 (14 tiles in 5 columns), or let the last row span/centre |
| PDP | authored | shop.com narrow buy box, 52px primary, chevron accordions | none required; see the media note below |
| Cart (empty / filled) | authored | shop.com centred empty state; R7 summary card | none |
| `/masuk` error | authored | storefront raised card + pill actions | none; the alert takes focus, wraps cleanly and has the error edge |
| Help | authored | help.shop.app centred column, 2-up topic cards | none |
| Placeholder page | authored | shop.com empty/recovery pattern | none |
| Footer | authored | shop.com columned footer | none; 44px phone targets make the 390 footer ~700px tall, which is the accepted target rule |
| Mobile dock | authored | shop.com active pill on the icon | none |
| Favicon set | authored | none (own "99." monogram) | none; it still reads as "99." at 16px |

## Observations behind the verdict

- **Template signals:** none found.
  - No dark or grid hero, no eyebrow pills, no mono labels, no stat figures.
  - Only the hero secondary carries an arrow.
  - No unsourced trust claims in UI copy.
  - The page could not be swapped to another business. The fixed Rp99.000 rule shows in the hero, the PDP price basis, the cart line and the footer.
- **Hierarchy and rhythm vs references:**
  - `8941…home-1440` keeps shop.com's order: pills → hero card → Categories → shelf → switcher (`56ae…2026-10-23-home-1440-full`).
  - Categories tiles use our department tint with a dark label, because our photos are white-ground shots. This matches the recorded reason.
  - The shelf rhythm matches: 7 cards at 1440; at 390, 2.3 cards that bleed to the screen edge.
- **Listing:**
  - `71b3…search-1440` matches the reference grid density (`c8a1…`).
  - One-line titles are cut off with an ellipsis ("Paket Barber & Gro…"). This is the owner's 1:1 decision.
  - Prices line up across each row.
  - At 320/200% (`9007…-02..13`) titles show in full in one column with nothing clipped.
- **PDP:**
  - `bc2e…pdp-1440` matches the reference buy-box order (`c9ed…`).
  - The bundle-open shot (`46d8…`) shows the "Sembunyikan barang lainnya" disclosure and the sticky media.
  - Visible issue: in `bc2e…`, the merchant photo fills about 25% of the 740px white panel, so the largest element is mostly empty. This follows from the owner's round-30 no-crop decision, so it is not counted as a defect.
- **Responsive:**
  - Nothing is broken or clipped at any width I inspected.
  - At 320/200% the omnibox placeholder truncates to "Cari prod…". This is an accepted single-line field.
  - In the 320/390 slices the dock appears at the end of the page. That comes from the tall-viewport capture method, not the layout.
- **Content:**
  - Claim imagery is visible on listing photos ("TERBUKTI AMPUH", "WAJAH GLOW UP", "Whitening", "Pelangsing" in `0139…`, `71b3…`).
  - It is out of scope under the accepted merchant-content decision and already on the owner's BPOM backlog.
  - None of it appears in the curated hero, tiles, pills or switcher.
- **Research and transfer rationale:**
  - The references are present and I inspected them: shop.com cart, help, home 2026-10-22 and 10-23, PDP 1440/390, and search with filters.
  - The R1–R12 transfer table and the round logs explain each deviation.
- **Open evidence gaps (not render defects):**
  - Multi-option PDP option pills are UNVERIFIED because no published product has more than one option.
  - There is no shop.com category-page reference.

Most important change: On `/kategori` at ≥1280px, fix the incomplete last row of 14 tiles (empty fifth slot) so the index uses the same whole-row grid as home. Everything else matches the contract.

Verdict: PASS