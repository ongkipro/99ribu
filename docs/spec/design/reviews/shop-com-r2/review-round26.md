Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-1920.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-closed-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-privasi-1440.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1920.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 69a2df41eaa67918
Images-SHA: c181d4139ea4428f
Output-SHA: 57c28e3240539229

Paduka Ongki, saya sudah membuka 121 slice. Ada 30 slice yang ternyata capture referensi shop.com tanpa label, jadi saya pakai sebagai referensi, bukan render 99ribu. Verdict-nya **REVISE**. Hampir semua bagian sudah authored dan sesuai kontrak; yang menahan adalah imagery kategori di home dan satu baris switcher yang terlihat belum terisi penuh. Saya tidak mengubah file apa pun.

## Section review (top to bottom)

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Environment banner | authored | none (99ribu-specific) | none |
| Header (brand, centred omnibox, icon actions) | authored | shop.com omnibox pill + rail actions moved into the header | none at 390/768/1440/1920; at 320/200% the placeholder cuts to "Cari prod..." (`f9ad…-home-320-text200-01`), so let the field drop the leading icon padding there |
| Omnibox open | authored | shop.com glass suggestions panel (`2026-10-23-omnibox-open-1440.png`) | the 1px ink edge around the whole open panel (`440ce…`, `3e26…`, `64b81…`) is heavier than the reference, which uses only a hairline and soft shadow. Put the focus ring on the field row, not the whole surface |
| Category pills | authored | shop.com pill row with thumbnails | the Kecantikan pill shows a barber trimmer (see finding 2) |
| Hero "Semua Rp99.000" | authored | shop.com value card | none. The photos are real catalog images, the copy is concrete, the price stays whole at 320/200% (`46ba…`), and the signed-in variant is correct |
| Kategori grid | authored | shop.com "Categories ›" tiles | the Wanita tile is an unidentifiable orange fragment (finding 2) |
| Terbaru shelf | authored | shop.com department shelf | none. 7 cards at 1440/1920, a cut card at 768, 2.3 cards with edge bleed at 390 |
| Category switcher | authored | shop.com switcher (`2026-10-23-switcher-1440.png`) | the panel at ≥1280 shows 6 cards in a 7-card track, leaving an empty column (finding 1) |
| Listing `/cari`, `/kategori/<slug>` | authored | shop.com Results grid (6 / 4 / 2 columns) | owner-accepted one-line titles make three cards read "Gendes Sweet Aro…" at 1024 (`0139…-01`). I'm noting it as a known risk, not a finding |
| `/kategori` index | authored | shop.com Categories | same Wanita imagery problem; Muslim and Hobi tiles are fine |
| PDP | authored | shop.com PDP buy box + accordions | none new. The empty "Spesifikasi" section is an accepted deviation; the bundle disclosure and "Sembunyikan barang lainnya" work |
| Cart | authored | R7 summary card | none. Lines have no boxes, the summary pill is 52px, and the current state on the header cart icon is right |
| Help | authored | help.shop.app 2-up topic cards | none |
| `/masuk` error | authored | centred raised card | none. The alert takes focus, fields are marked invalid, and the copy is neutral |
| Promo | authored | standard grid | none |
| Placeholder pages | authored | centred empty state | none |
| Footer | authored | shop.com columned footer | the simulation note leaves "lokal." alone on the last line at 390/768/1440 (`f9d9…`). Widen the note or drop its max-width |
| Mobile dock | authored | shop.com active-pill indicator | none. At 320/200% the dock sits in the page flow (static), as recorded |

## Findings

1. **Switcher panel leaves an empty column at ≥1280** (`894181cd…-home-1440-01/02`, `778cfa27…-home-1920-01`). The Kecantikan panel has 6 cards in a 7-card track, so the row ends in a blank slot under the long "Ruma…" label. Every other shelf on the page fills 7, and the shop.com switcher shelf fills 7. The cause is the round-26 performance trim to six cards. **Consequence:** the row looks unfinished and breaks the shelf rhythm. **Fix:** render 7 cards (or 8 with a scroll cue) at ≥1280, still lazy.

2. **Department imagery breaks the round-26 "curated, product clearly visible" claim.**
   - **Wanita:** the tile on home 1440/1920 (`c6d3…`) and on `/kategori` (`65e1…`) shows only an orange corner on white. No product can be recognised.
   - **Kecantikan:** its curated photo is a barber hair trimmer. The same trimmer appears as the Kecantikan pill, the Kecantikan tile, the biggest hero photo, the switcher medallion and the first switcher card. That is five times in the first two screens at 1440.
   - **Consequence:** the beauty department reads as men's grooming, the home repeats one photo, and Wanita gives the buyer nothing to recognise.
   - **Fix:** re-pick the Wanita and Kecantikan photos in `src/modules/storefront/department-photos.ts`, and keep the hero from leading with a photo already used for a department.

3. **Evidence hygiene (not a design defect).** 30 slices are shop.com references mixed into the render list without labels. The next gate run should list them separately as references.

Template signals: none found. There is no dark hero, no eyebrow pills, no accent word in the headline, no 3–4 icon-card rows, no monospace text and no arrow on every button. There are also no unsourced trust claims ("resmi", "terpercaya" and the like). The pages are clearly a fixed-price Indonesian multi-category store.

## Reference transfer

- **Hierarchy, rhythm and density** match the references.
  - The flat near-white canvas, the 20px white media frames with one soft shadow, and the 14/600 one-line titles with 12/600 prices all match `2026-10-22-search-1440.png`.
  - Section titles use "Title ›" with roughly 48px between sections.
  - The home order (pills → hero → Kategori → shelf → switcher) follows `2026-10-23-home-1440-full.png`, minus the store and editorial sections the catalog has no data for. That omission is documented and justified.
- **Imagery** is where the transfer is weaker. shop.com tiles use art made for each category, while ours crop seller product shots. That is accepted in the contract, but it is exactly why the curated picks have to be checked by eye, and Wanita and Kecantikan fail that check.
- **Research:** the transfer rationale is recorded for every section. The only gap is the evidence labelling above.

This is visual acceptance only, not interaction or accessibility test evidence.

Most important change: re-pick the Wanita and Kecantikan department photos so every tile shows a recognisable, category-appropriate product and the trimmer no longer repeats across the home, then fill the ≥1280 switcher panel to 7 cards.

Verdict: REVISE