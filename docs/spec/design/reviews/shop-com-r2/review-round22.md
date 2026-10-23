Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-1920.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-closed-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-privasi-1440.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1920.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 07075b40f125a296
Images-SHA: 6294ef99ff9c7f61
Output-SHA: 6bfcffea0b4d7bc9

Paduka Ongki, saya sudah buka semua 121 screenshot di `design/review-slices/`. Itu termasuk capture referensi shop.com yang ada di daftar: cart, help, home 2026-10-22/23, PDP, search, dan sheet filter. Hasilnya **REVISE**. Arahnya sudah benar dan didukung riset, tapi masih ada beberapa render yang rusak di layar sempit dengan teks besar, plus satu masalah konten.

## Per section (atas ke bawah)

| Section | generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Env banner | authored | none (local-only) | No fix |
| Header + omnibox | authored | shop.com omnibox pill (closed), glass suggestion surface (open) | The 1px ink edge on the open surface is heavier than shop.com's border-free shadow. It is in the contract, so it stays, but consider ring-only |
| Category pills | authored | shop.com pill row | At 36px, ad-style product photos turn into noise. "Perkakas & Elektronik" is an almost empty grey circle. Pick a photo that is not mostly white, or fall back to tint + icon |
| Hero | authored | shop.com value hero (2.75:1, 36px radius, floating product tiles) | At 320/200% the "Cara belanja" arrow stays about 10px and sits **outside** the left edge of the white pill, while the label wraps to two lines. Size the icon in em and keep it inside the pill |
| Kategori grid | authored | shop.com Categories tinted tiles, 5 per row | At 768 there are 4 columns × 10 tiles, so the last row has 2 empty slots. Cap the tile count to a full row (8) or use 5 columns |
| Terbaru shelf | authored | shop.com dept shelf, 7 cards at desktop, 2.3 at phone | No fix. Prices align and the phone bleed is right |
| Category switcher | authored | shop.com switcher (96/800 label, medallion) | At 320/200% the selected label is clipped to "Kecan" and the medallion is pinned off-centre at the screen edge. Clamp the label size and centre the selected tab |
| Listing /cari, /kategori/x | authored | shop.com Results grid, 6 → 2 columns | At 1024 the filter panel puts 3 selects on one row and leaves **"Urutan" alone** on a full-width row. Round 1 fixed this and it is back. Make it 2×2 or 4-up |
| /kategori index | authored | same tiles | 12 tiles in 5 columns leaves 3 empty slots. Fine for a full index |
| PDP | authored | shop.com buy box (narrow column, 52px primary, chevron accordions) | No material fix. The empty "Spesifikasi" is an accepted deviation |
| Cart | authored | R7 unboxed line + white summary card | No fix |
| Help | authored | help.shop.app 2-up topic cards, centred column | No fix. The return text is owner content |
| /masuk | authored | centred raised card | No fix. Focus moves to the alert and the alert wraps cleanly |
| Promo | **generic (content)** | none | "Paket campuran" shows the same 24 products in the same order as /cari. It includes "Paket 2 Kaos Distro Pria", which contradicts its own line "Beberapa barang berbeda…". Filter to offers with ≥2 distinct items, or hide the Promo icon |
| Placeholder pages | authored | R8 centred empty state | No fix |
| Footer | authored | shop.com columned footer | No fix |
| Mobile dock | authored | shop.com active grey pill → lavender | Needs a check: in `pills-focus-320-text200` the two-row fixed dock covers about 30% of the viewport, even though the short-viewport static rule is supposed to apply |

## Concrete observations
- **Broken rendering** in `46ba9739fa0fcda0-hero-320-text200-01.png` and `f9ad8c3bad0b98a7-home-320-text200-02.png`: the arrow icon sits outside the left edge of the "Cara belanja" pill. Broken rendering at any width is always a finding.
- **Clipped switcher** in `f9ad8c3bad0b98a7-home-320-text200-04.png`: the label is cut at "Kecan" and the medallion is at x≈275 while the label starts at x≈20.
- **Orphan "Urutan" filter** in `0139e2640ad95cb7-category-1024-01.png`. Compare with the 1440 and 1920 searches, where all four selects fit in one row.
- **768 grid gap** in `fd8b8d79ef3ae725-home-768-02.png`: "Ibu & Anak" and "Wanita" are followed by two empty slots.
- **Promo duplicates the catalog**: the grid in `b651564a511c4665-promo-1440-01.png` is identical to `71b3b51172f2be14-search-1440-01.png`.
- **Template signals: none found.** There is no dark hero, no accent word, no eyebrow, no monospace, no `A · B` labels and no unsourced stats. The fixed price is the only number, and it is the business rule.

## Comparison with the references
The rhythm and hierarchy carry over correctly from these references:
- `2026-10-23-home-1440-full`: pills, then value card, then Categories, then switcher, then shelf.
- `2026-10-22-search-1440`: 6 columns with 1:1 media at a 20px radius, a 14/600 title and a 12/600 price.
- `2026-10-22-pdp-1440`.

The skipped sections (trending stores, editorial, ratings, badges) are justified because the data does not exist, so nothing is fake.

There are two visible mismatches with reasons on record:
- **Category tiles:** shop.com uses full-colour art. 99ribu uses a white tilted photo clipped at the tile end, because the catalog photos are white-ground shots. The reason is acceptable, but at 1440 the "Wanita" and "Otomotif" photos are cropped until you can't tell what they are.
- **One-line titles:** almost every listing title reads "Paket X & …". This is a recorded owner decision, so I am not counting it as a blocker.

The research and transfer rationale are complete. The cart-with-lines PDP and the multi-option PDP still lack evidence, but that is a data limitation, not a design failure.

I saved the fix plan, with the verification steps, at `/home/ongki/.claude/plans/you-review-a-web-witty-flame.md`. I haven't edited any code. This is visual acceptance only, not interaction or accessibility evidence.

Most important change: Fix the 320px/200%-text rendering of the hero "Cara belanja" pill (icon outside the pill) and the category switcher (selected name clipped, medallion off-centre), because those are visibly broken renders on the primary mobile path.

Verdict: REVISE