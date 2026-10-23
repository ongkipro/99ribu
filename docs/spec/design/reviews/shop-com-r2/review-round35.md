Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/favicon-sheet.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-1920.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-closed-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-privasi-1440.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1920.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: d29d26fb2248210d
Images-SHA: d5373444242303a1
Output-SHA: 904648fad7b3ffba

Paduka Ongki, saya sudah membuka ke-122 gambar. Hasilnya **REVISE**: ada dua masalah material. Keduanya sudah saya cek ke source, bukan cuma ditebak dari gambar. Selama plan mode saya tidak mengubah file apa pun selain file plan.

## Per section (atas ke bawah)

```
Env banner | authored | none (99ribu-specific) | none; the <360px short form "Data contoh: simulasi lokal." reads cleanly at 320/200%
Header + omnibox | authored | shop.com pill omnibox (no logo collage) | none; centred pill, 44px purple submit, glass suggestions panel with "Saran pencarian" (omnibox-suggestions-1440/390, typing "ru" → "Rumah Tangga")
Category pills | authored | shop.com photo-circle pill row | none; 5 pills + grid link centred at 1440, scrolls with fade at 768/390, focus ring unclipped at 320/200% (pills-focus-320)
Hero | authored | shop.com "Shop is all about you" card | none; curated photos on the lavender/yellow tint, "Rp99.000" stays on one line at 320/200%, signed-in primary "Lihat produk"
Kategori grid | authored | shop.com "Categories ›" tinted tiles | none; 5×2 at 1440, 3×3 at 768, 2-up at 390, 1-up at 320/200%; one photo per department matches pills and switcher
Terbaru shelf | authored | shop.com department shelf | none; 7 cards at 1440/1920, cut card at 768/390, one-line titles, prices aligned
Category switcher | authored | shop.com 96px switcher with medallion | remove the Marlov "Whitening" card from the Kecantikan panel (see finding 1)
Footer | authored | shop.com columned footer | optional: phone link rows are 44px, about 1.5× shop.com's 30px rhythm (footer-390 is about 700px tall); accepted for touch targets, so not material
Listing /cari and /kategori/<slug> | authored | shop.com Results grid + filter row | none on layout: 6 columns at 1024+, 2 on phones, filter selects 4-up; claim photos in the first row are accepted backlog
PDP / bundle | authored | shop.com narrow buy box + accordions | minor: on pdp-1440 the photo of a 4-item bundle fills about 25% of the 740px panel (merchant photo with wide margins; accepted, flagged)
Cart | authored | R7 summary card | none material; the isolated "Hapus" row at 390 is a known open item
Help | authored | help.shop.app centred column + 2-up topic cards | none; chat card matches the topic cards, single filled action
/masuk error | authored | shop.com empty-state card language | none; focus moved to the alert (visible ring), invalid fields marked, "Batal" quiet
Promo | authored | storefront grid | none on layout; "Paket Detox & Imun Alami" shows here (promo overlap is accepted, the product name is in the compliance backlog)
Placeholder pages | authored | shop.com empty cart | none; centred heading, one sentence, one secondary pill
Favicon sheet | authored | none | none; "99." readable at 16px, yellow dot matches the wordmark
```

## Material findings

1. **A claim photo still appears on home, contradicting round 34.**
   - **Where:** `home-1440-02` and `home-1920-01`. The Kecantikan switcher panel shows "Marlov Deodorant Ant…", and its photo reads "Antiperspirant Deodorant **Whitening**".
   - **Why it slipped through:** round 34 says Marlov is excluded, but `CLAIM_WORDS` in `src/modules/storefront/department-photos.ts:84` only matches product names. The stored name is "Marlov Deodorant Anti Prespirant RollOn", with no "whitening" in it. The photo hash is also not in `CLAIM_PHOTOS`.
   - **Consequence:** the curated home section, which is supposed to be the clean showcase, carries an unsourced whitening claim.
   - **Fix:** add the Marlov photo's hash to `CLAIM_PHOTOS`, the same way the five existing entries are listed.

2. **The renders are older than the current CSS.**
   - `src/app/globals.css` was modified at 21:35:24. Every render in `docs/spec/design/renders/shop-com-r2-20261022/` is from 21:31–21:32.
   - So these images don't prove what the current build looks like. The capture needs to run again from a fresh build.

## Reference comparison

I compared against the reference images in the list:

- **Home** (`56ae2fb…-home-1440-full`, `44fc7af5…-home-390-full`):
  - Order carries over correctly: pills → value card → Categories › → department shelf → switcher.
  - The section rhythm (about 48px) and the one-line 14/18 card titles match.
  - Skipping trending stores and editorial collections is justified because there is no store or editorial data.
  - The switcher differs on purpose: the medallion sits above the label instead of overlapping it, and the row starts at the left instead of looping. This is recorded with a reason.
- **Search** (`c8a1c9a…-search-1440`, `488cca…-search-390`):
  - The 6-up grid, 20px media radius and 12/16 price carry over.
  - Native selects in an in-flow panel instead of chips and a modal sheet is a recorded deviation (tested no-JS controls).
- **PDP** (`c9edea…-pdp-1440`, `52a31a…-pdp-390`):
  - Narrow buy box, full-width 52px primary and hairline accordions match.
  - The reference shows the product filling its media panel; ours often doesn't because of merchant photo margins. That is a content limit, not a layout one.
- **Help** (`27b2df…`, `6c377b…`): centred column with 2-up/1-up cards transferred faithfully.

I found none of the template signals from the checklist (dark hero, accent word, eyebrows, icon-tile cards, mono labels). The research and transfer rationale are documented per section.

Most important change: add the Marlov whitening photo hash to `CLAIM_PHOTOS`, then rebuild and capture again so the evidence is newer than `globals.css`.

Verdict: REVISE