Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/favicon-sheet.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 266288a931094df8
Images-SHA: 1f7649f8ee62a4ef
Output-SHA: e689bf948c66fde2

Paduka Ongki, saya sudah buka semua 117 slice: render 99ribu dan referensi shop.com. Saya tidak ubah kode apa pun, karena tugasnya hanya review. Hasilnya **PASS**; tiga catatan di bawah sifatnya polish dan tidak memblokir.

## Section-by-section

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Environment banner | authored | none (99ribu-specific) | none; the 320 short form "Data contoh: simulasi lokal." holds |
| Header (brand, omnibox, Promo → Cart → Account) | authored | shop.com omnibox pill + rail icons moved to the header | none at 1440/768; the cart badge sits clear of the omnibox (`abf0c092…header-cart-items-1440`) |
| Omnibox open/suggestions | authored | shop.com glass suggestions panel (`2026-10-23-omnibox-open`) | drop generic or English suggestions: "Alat" alone, and "Brush" as the only match for "ru" (`3e26481a…typing-1440`) |
| Category pills | authored | shop.com photo pills (`95bdbd15…1440-01` row) | none; the focus ring is unclipped at 1440 and at 320/200%, and the current lavender fill shows on `/kategori/kecantikan` at 1024 |
| Hero | authored | shop.com "Shop is all about you" card | none; the photos are curated products on the brand tint, at 320/200% the price stays whole and the arrow stays inline |
| "Kategori ›" grid | authored | shop.com "Categories ›" tinted tiles | none; 5/3/2/1 columns, names wrap between words, photo cards stay inside the tiles |
| "Terbaru ›" shelf | authored | shop.com department shelf | none; 7 whole cards at 1440 (matches the reference), a cut card at 768 and 390 |
| Category switcher | authored | shop.com 96px switcher | tighten the ~20px gap between the medallion and the 96px label at 1440 so they read as one unit |
| Search / category listing | authored | shop.com Results grid + filter row | none; 6 columns at 1024/1440, 2 on phones, 1 at 320/200% with full titles |
| PDP (simple and bundle) | authored | shop.com PDP buy box + hairline accordions | none; order is title → price → contents → stock → qty → 52px CTA, and the CTA sits in the first 1440 screen even with 7 items |
| Cart (filled) | authored | R7 summary card | none; unboxed line, summary card, full-width checkout pill |
| Promo | authored | none (99ribu-specific) | apply `homeSafe` to this curated list ("Paket Detox & Imun Alami" is the 3rd tile, although home excludes it) |
| `/masuk` error | authored | shop.com centred card / empty-state rhythm | none; the alert gets focus with a visible ring, fields show an error edge, "Batal" stays quiet |
| Placeholder `/tentang` | authored | shop.com centred empty state | none |
| Footer | authored | shop.com columned footer (`2026-10-23-home-1440-full-03`) | none; one column at 320/200%, no touching links |
| Mobile dock | authored | shop.com bottom bar with an active pill | none; the active state shows in fill, colour and weight |
| Brand icons | authored | none | none; the "99." still reads at 16px |

## Observations and reference comparison

- **Hierarchy and rhythm.** Home at 1440 (`894181cd…home-1440-01`) follows the reference order: pills → value card → Categories → shelf → switcher (`56ae2fb1…full-01/02`). The skipped sections (stores, marquee, editorial) are justified by missing data, and the section spacing matches the reference's flat rhythm.
- **Imagery.** The hero, tiles, pills and medallions use only curated product photos. The merchant-text photos (HYPER STRIKE, Bubuk, "Kinclong dalam 14 hari") appear only in listings, the shelf and promo, which the accepted decisions put out of scope. No drawings or generated images stand in for photos.
- **Density.** Cards are a 20px frame with a 14/18 600 title and a 12/16 price, as measured on the reference search (`c8a1c9a0…search-1440`). The filter panel open at ≥701px pushes results to about y=586. That is accepted R4, but it is the biggest density gap against shop.com's single chip row.
- **Responsive.** I saw no broken or clipped rendering at 320/200%. Hero photo tiles bleeding off the side edges is intended. The dock sitting in flow under the pills (`59c9acdb…pills-focus-320`) is the documented short-viewport rule.
- **Template signals checked.** None found: no dark or grid hero, no eyebrow pills, no icon-tile card rows, no decorative mono labels, and no unsourced stats or "resmi"/"terpercaya" claims in the chrome. Category tiles and product cards look visibly different.
- **Not visually provable from static renders.**
  - Sticky PDP media: the empty band left of the open "Deskripsi" in `46d89c1d…bundle-open-1440-01` comes from the full-page screenshot.
  - Multi-option pills (R3/R6): there is no data to render them, so they stay UNVERIFIED.
- **Research and transfer.** Every contract item ties to an inspected reference capture. The deviations (medallion above the label, contain → cover, 1250px cap, native selects) each have a written reason. No missing rationale found.

Most important change: replace the generic single-word omnibox suggestions ("Alat", "Brush") with specific two-word product types, because those suggestions are the first thing a buyer sees after tapping search.

Verdict: PASS