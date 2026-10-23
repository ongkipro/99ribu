Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/favicon-sheet.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-1920.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-closed-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-privasi-1440.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1920.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: e6ef91812aa7af65
Images-SHA: 80fa2cd636dbfe99
Output-SHA: 0497fc6fe1329558

**Verdict: REVISE.** Paduka Ongki, saya sudah membuka ke-122 render. Layout-nya sudah setara PASS di semua lebar. Satu-satunya yang menahan PASS: kurasi home masih meloloskan dua produk berklaim, padahal keputusan yang sudah diterima bilang kurasi home harus bebas klaim. Saya belum mengubah file apa pun selain file plan.

## Per section, top to bottom

| Section | Generic or authored | Look matched | One concrete fix |
|---|---|---|---|
| Environment banner | authored | none (99ribu-only) | none; the short "Data contoh: simulasi lokal." at 320 reads well |
| Header + omnibox | authored | shop.com omnibox: pill, 44px purple submit, glass "Saran pencarian" panel (`440ce9a4…`, `3e26481a…`, `64b81812…`) | none; centred at 1440/1920, icons Promo → Cart → Account, badge on the cart icon |
| Category pills | authored | shop.com pills with photo circles and a grid link (`95bdbd15…`) | at 768 add a stronger end cue: "Otomotif" fades out with no other sign the row scrolls (`fd8b8d79…-01`) |
| Hero | authored | shop.com "Shop is all about you" card: big two-line heading, filled primary plus white secondary; floating product tiles replace the device mockup | at 320/200% "Bantuan belanja" breaks into two lines with the arrow detached on the left (`46ba9739…`, `f9ad8c3b…-02`); let the label shrink or drop the icon at that size |
| Kategori grid | authored | shop.com "Categories ›" (10 tiles, 5/2 columns). Pastel tint plus a tilted photo card instead of full-bleed art, which is justified because the photos have white grounds | none on home (whole rows at 1440/768/390) |
| Terbaru shelf | authored | shop.com department shelf: 7 whole cards at 1440/1920, a cut card at 768/390, one-line titles, 12/600 price | **remove "Paket Detox & Imun Alami"**, a health/immunity claim in the name on the first home shelf (`894181cd…-01`, `56ae…` vs ours) |
| Category switcher | authored | shop.com "supplies **Beauty** Women" strip: 96px/800 label, inactive grey, medallion above the label (recorded deviation) | **remove the Marlov "Antiperspirant Deodorant Whitening" photo** from the Kecantikan panel (`894181cd…-02`, `778cfa27…-01`). Round 31 already excluded Gendes and Bright Glow for whitening text; this one slipped through |
| Listing (search / category) | authored | shop.com search grid (`c8a1c9a0…`, `488cca11…`): 6/4/2 columns, 20px white media, filter pill above the grid | none in this round. Ellipsised one-line titles ("Paket Perkakas Rumah & D…") are the accepted owner decision; the claims in the Kecantikan first screen are accepted backlog |
| Filter panel | authored | shop.com filter chips/sheet transferred as a native-select panel (R4 deviation) | none; one row of 4 at 1024/1440/1920, an outline "Hapus filter" pill beside the filled "Terapkan filter" |
| PDP | authored | shop.com PDP (`c9edea82…`): white 24px media panel, narrow buy box, 52px primary, hairline accordions with chevrons | none in builder scope. A bundle showing one item's photo stays owner/feature scope; the empty band beside the media in the full-page shot is a capture artifact (the media is sticky) |
| Cart | authored | R7: unboxed line, white summary card, 52px checkout | at 390 the quantity pill, the full-width "Perbarui jumlah" and "Hapus" stack into three rows (`24e17e70…-01`); put "Hapus" beside the quantity row |
| Help | authored | help.shop.app (`27b2df7e…`, `6c377b87…`): 45rem column, 2-up topic cards, support card at the end | none |
| `/masuk` error | authored | R8 centred card | none; the alert wraps, invalid fields have an edge, "Batal" is a quiet text action |
| Promo | authored | standard grid; "Paket campuran" before "Promo ongkir" | none (the overlap with the newest rows is accepted) |
| Placeholder pages | authored | R8 centred empty state | none |
| `/kategori` index | authored | same tiles as home | at 1440 the 12 tiles end on a 2-of-5 row (`65e1c0b3…`); acceptable for an index, so cosmetic only |
| Footer | authored | shop.com footer: brand block left, labelled menus right, bottom legal row; QR, app badges and social are correctly skipped | none |
| Mobile dock | authored | shop.com active-pill indicator, lavender `#efeafd` pill | none; Beranda/Kategori/Keranjang/Akun each mark their page |
| Favicon sheet | authored | none (brand) | none; the "99." monogram stays legible at 16px |

No template signals: no dark hero, no eyebrow pills, no icon-tile card rows, no `A · B` labels, no arrow on every button, no monospace figures, no unsourced stat figures. Nothing is clipped or broken at any width, including 320/200%. The dock overlap in `59c9acdb…` comes from the documented short-viewport rule (`max-height: 38rem`, dock becomes static), not a defect.

## Evidence and transfer
- **Rhythm:** it follows the 2026-10-23 shop.com home captures (`56ae2fb1…`, `44fc7af5…`): pills, then hero card, then "Categories ›", then shelf, then switcher, then footer. The sections shop.com has that we skip (trending stores, store carousels, editorial "Discover something you love") have no matching data, and the contract records them as skipped.
- **Density:** 7 cards per desktop shelf and 6 listing columns match shop.com's measured counts. The 1250px content cap is the owner's override of shop.com's wider pages.
- **Imagery:** the tinted category tiles differ from shop.com's saturated full-bleed tiles. The contract justifies this: our product photos have white grounds, so a white label would sit on white.
- **Gaps that remain:** multi-option PDP pills are still unverified by data (no published multi-option product), and there is no reference capture for shop.com category pages.

## Proposed fix (needs your approval)
1. Extend `homeSafe` to match "whitening", "detox" and "imun" in product names, and add the Marlov photo hash to the photo list.
2. Recapture home at 390/768/1440/1920 with `shots-r2.mjs`.

This is visual acceptance only, not interaction or accessibility test evidence.

Most important change: keep the curated home merchandising (Terbaru shelf and switcher panels) free of claim content by extending `homeSafe` to whitening and detox/immunity terms.

Verdict: REVISE