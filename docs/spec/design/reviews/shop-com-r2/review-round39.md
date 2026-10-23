Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/favicon-sheet.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 66082d3e044d2a5f
Images-SHA: 8eef73026eca1f1b
Output-SHA: a9da8aaaa757fc57

Paduka Ongki, saya sudah buka ke-122 gambar: render 99ribu dan potongan referensi shop.com. Hasilnya **REVISE**, dengan satu masalah utama di keranjang 390. Review lengkapnya ada di bawah dalam bahasa Inggris.

## Section lines (top to bottom)

- **Environment banner** | authored | none | none. The 320 short form works.
- **Header + omnibox** | authored | shop.com white pill, round purple submit, glass suggestion panel | none material. At 1440 the open list stops at "Summerspring" (6 of 13) with no scroll cue, the same as the reference.
- **Category pills** | authored | shop.com photo-circle pill row | none. The focus ring is unclipped at 1440 and at 320/200%.
- **Hero** | authored | shop.com value card (copy bottom-left, floating tiles) | none. At 320/200% it grows instead of clipping, and "Rp99.000" stays whole.
- **Kategori grid** | authored | shop.com "Categories ›" short tiles | none. Rows are whole at 1440 (10) and 768 (9). The tint plus tilted photo card suits white-ground photos.
- **Terbaru shelf** | authored | shop.com department shelf | none. It shows 7 cards at 1440 and a cut card at 768/390.
- **Category switcher** | authored | shop.com 96px label with medallion | none. The medallion sits above the label instead of overlapping it, a recorded deviation.
- **Search / category listing** | authored | shop.com 6-column grid with 20px media | none.
- **PDP / bundle PDP** | authored | shop.com narrow buy box, 52px primary, hairline accordions | none new. The small product inside a 740px panel comes from merchant photo margins, accepted in round 30.
- **Empty cart** | authored | shop.com centred empty state with one primary pill | none.
- **Filled cart 390** | authored | none (no reference capturable) | **Put the quantity pill and "Perbarui jumlah" on one row, and "Hapus" beside them.**
- **Filled cart 1440** | authored | R7 summary card | none. The gap between line and summary is the accepted 1.7fr/1fr layout.
- **Help 390** | authored | help.shop.app topic cards, 1-up on phones | Add a `help-1440` capture; the 2-up desktop layout has no render in this set.
- **/masuk error** | authored | R8 centred card | none.
- **/promo** | authored | standard product grid | Apply `homeSafe` to the curated "Paket campuran" pick.
- **/kategori, placeholder page, footer, dock, favicon** | authored | match R8, R9, R10 and the shop.com footer and dock | Optional: a 0.75em gap in the Legal row at 320/200%.

## Template signals

None found. There is no dark hero, accent word in the headline, eyebrow pill, monospace label, `A // B` label, arrow on every button, or unsourced stat figure. Claims on merchant photos are accepted owner content, and they are correctly kept off the home page, hero and switcher.

## Comparison with the reference

- **Hierarchy:** the home order follows the shop.com 2026-10-23 captures. The skipped sections (stores, editorial, wordmark) have documented reasons.
- **Rhythm:** the 20px media radius, 8/16px gaps and 14/12 card type match the reference.
- **Imagery:** real catalog photos replace the reference images, and the tinted tile with a photo card is a sound adaptation.
- **Density:** the phone footer is about twice as tall as shop.com's because of the 44px link targets. That is a deliberate accessibility choice, not a defect.
- **Research:** the transfer reasoning is documented per item (R1–R12 and rounds 21–38).

## Findings

1. **Filled cart at 390** (`24e17e70eb60dbc5-cart-filled-390-01`): the quantity pill, the full-width "Perbarui jumlah" pill and "× Hapus" stack on three rows, although the first two fit side by side (112px + about 170px is less than 358px).
   - With only one item in the cart, "Lanjut ke checkout" falls below the first screen, so the page's only job is out of view.
   - Rounds 33–35 reported this row as "unchanged", but it was never recorded as an accepted decision.
2. **/promo** (`b651564a511c4665-promo-1440-01`, `55b8f570905a5c50-promo-390-01`): the curated "Paket campuran" list shows "Paket Detox & Imun Alami". Since round 34, `homeSafe` keeps that product off every other curated surface, so the rule is inconsistent. If they want it kept, that's for the owner or coordinator to decide.
3. **Evidence gap:** `help-1440` is missing.

Most important change: on the 390 filled cart, put the quantity pill and "Perbarui jumlah" on one row (and "Hapus" beside them) so "Lanjut ke checkout" is not pushed below the first screen.
Verdict: REVISE

This review is saved at `/home/ongki/.claude/plans/you-review-a-web-effervescent-summit.md`. I didn't change any repository files.