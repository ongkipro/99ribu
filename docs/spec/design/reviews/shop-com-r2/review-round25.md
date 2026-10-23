Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-1920.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-closed-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-privasi-1440.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1920.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 2f725a7ecc40a240
Images-SHA: a15a94597aa56bc0
Output-SHA: 3bca7202659d1601

Paduka Ongki, saya sudah buka ke-120 gambar (render 99ribu dan slice referensi shop.com). Verdict-nya **REVISE**. Hampir semua bagian sudah authored dan cocok dengan referensi. Masalah utamanya ada di foto kategori: yang tampil potongan teks banner, bukan produk.

## Section review (top to bottom)

```
Env banner ("Data contoh…") | authored | none (own simulation notice) | none; concise, no claim
Header + omnibox | authored | shop.com omnibox pill + round purple submit (2026-10-22/23 home refs) | none; centred at 1440/1920, suggestion glass panel matches ref, cart badge sits on icon
Department pill row | authored | shop.com thumbnail chips (95bdbd…-1440-01, 24f5fb…-390-01) | "Perkakas & Elektronik" and "Rumah Tangga" circles read as near-white blanks at 36px; pick a product-dominant photo or fall back to a tint plus initial/icon
Hero | authored | shop.com "Shop is all about you" value card with floating product cards | top-left tile (jigsaw) is almost white and reads as empty; drop tiles whose photo is mostly white ground
Kategori grid (home, /kategori) | authored layout, failing imagery | shop.com Categories tiles (56ae2f…-02, 44fc7a…-02) | tiles show cropped ad text, not products; fix below
Terbaru shelf | authored | shop.com department shelf (7 whole cards at 1440, cut card at 390/768) | none
Category switcher | authored | shop.com Beauty/Women switcher | none at 1440/390; medallion is small but legible
Search/category listing | authored | shop.com search grid, 6-up at 1440, 2-up at 390 | open filter panel at ≥1024 leaves one product row in the first 900px (accepted R4 deviation, noted only)
PDP (single and bundle) | authored | shop.com PDP buy box, 52px pill, chevron accordions | none in builder scope; one photo for a 4–7-item bundle is owner content
Cart (filled) | authored | R7 summary card | none
Help | authored | help.shop.app 720px column, 2-up topic cards | none; matches ref rhythm closely
/masuk error | authored | R8 centred card | none; alert, invalid edges and full-width pill read correctly
Promo | authored | standard grid | none
Placeholder pages | authored | shop.com centred empty state | none
Footer | authored | shop.com columned footer | none; phone 48px link pitch (vs ref ~30px) is the 44px target rule, acceptable
Mobile dock | authored | shop.com bottom bar with active pill | at 320/200% the in-flow two-row dock sits between pill row and hero (59c9ac…-320-01), so the first screen has no content (previously declined, still visible)
```

## Findings

1. **Department tile imagery shows banner typography instead of products (material).**
   - Where it shows: `65e1c0…-categories-1440-01`, `894181…-home-1440-01`, `c6d332…-home-categories-1440-01`, `fed713…-home-categories-390-01`, `f9ad8c…-home-320-text200-02/03`.
   - What the tiles show:
     - Otomotif: "ghilang Bau / trak Tumbuhan / murni Udara".
     - Ibu & Anak: "Capybara Multifungsi".
     - Wanita: "Bentuk Tubuh Lebih Rapi dalam Sekejap" over a pale shapewear shape you can't recognise.
     - Rumah Tangga: "…BASMI WC & SALURAN…".
     - Hobi: "…SIRI… Aroma…".
   - The round-24 response says the 1.6× cover crop pushes banner text and white margins out of the card. The renders show it doesn't.
   - Why it matters:
     - Brand fit and task clarity: this is the main category navigation, and it reads as cut-up ads.
     - Reference fidelity: shop.com tiles carry one clean object on a solid colour (`56ae2f…-02`).
   - The same root cause leaves the header pill circles blank (Perkakas) and makes the hero's first tile empty.

2. **Home category block on phones (minor).** At 390 the 10 tiles take about one full screen (`b2fa7d…-02`). At 320/200% they stack one per row, about 2.5 screens before "Terbaru". The shop.com phone ref uses short 2-up tiles. Showing six tiles plus the "Kategori ›" link on ≤700px would keep the shelf near the second screen. The round-19 decision did this, and round 21's "top 10" later superseded it.

3. **/kategori at 1440 (minor).** 12 tiles at 5-up leave a two-tile orphan row. This is acceptable for a full index, so it's noted only.

No template signals: no dark or dot-grid hero, no eyebrows, no monospace labels, no `A · B` labels, no unsourced trust claims in the UI. "Terbukti ampuh" appears only inside a merchant product photo, which is owner content.

## Reference comparison

- **What matches:**
  - Hierarchy, rhythm and density follow the 2026-10-22/23 refs: centred omnibox and pill row, floating-card value hero, `Title ›` shelves with a cut card, 1:1 20px media cards with 14/12 type, help's 720px 2-up cards, and the four-column footer.
  - The written research covers every transfer and every deviation: native selects, 1250px cap, no rail, the switcher medallion above the label, and one-line titles as an owner call. I found no unsupported composition.
- **The one mismatch: imagery.**
  - shop.com tiles and pills use curated cutouts.
  - 99ribu picks "newest product photo" automatically, and many merchant photos are text-heavy ad banners.
  - The contract already allows a name-only tile when no photo exists. The selection rule needs a quality gate:
    - an owner-chosen tile photo per department, or
    - the name-only fallback, when no clean product shot is available.
  - Image analysis isn't required for either path.

Most important change: replace auto-picked department photos in tiles, pills and the hero with a curated, product-dominant photo per department (owner-selectable), falling back to the name-only tinted tile until one is set.

Verdict: REVISE

This is visual acceptance only, not interaction or accessibility test evidence. I made no code changes; the short summary is in `/home/ongki/.claude/plans/you-review-a-web-abstract-candle.md`.