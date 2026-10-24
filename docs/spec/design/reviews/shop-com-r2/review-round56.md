Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/banners-1440.png, docs/spec/design/renders/shop-com-r2-20261022/banners-390.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1440.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-mid-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-home-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/filter-nojs-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-pop-1440-dpr2.png, docs/spec/design/renders/shop-com-r2-20261022/filter-sheet-390.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-appended-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-more-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-skeleton-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-focused-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 20a0d46044dc8ec3
Images-SHA: 107dc5c975beb418
Output-SHA: 0481a84df0fcbefe

Paduka Ongki, saya sudah buka ke-118 gambar satu per satu dan tidak ada yang mengubah file. Review lengkap tersimpan di `/home/ongki/.claude/plans/you-review-a-web-frolicking-cosmos.md`. Tool ExitPlanMode tidak tersedia di sesi ini, jadi hasilnya saya tulis langsung di sini. Hasilnya **REVISE**: ada satu masalah layout yang nyata di home desktop, plus tiga temuan kecil.

## Section lines

| Section | generic/authored | look matched | one concrete fix |
|---|---|---|---|
| Header + omnibox (1440) | authored | ref omnibox: white pill, soft shadow, 44px purple round submit (`894181…-home-1440-01`) | none |
| Wordmark reveal | authored | owner brief; omnibox stays put (`5dce…`, `c225…`) | none |
| Phone header | authored | ref mobile, no logo (`24f5…-01`); accepted override | none |
| Category pills | authored | ref circle + label (`56ae…-01`); focus ring clear at 320/200 (`59c9…`) | none |
| Omnibox open/typing | authored | glass surface, chips, bold match, "Cari “kac”" (`4c22…`, `440c…`, `3e26…`, `64b8…`) | `/cari` 390: a sliver of the H1 glyph shows under the panel's lower-left radius (`f834…`) |
| Hero | authored | ref hero card (`56ae…-01`); grows at 320/200 without clipping (`46ba…`) | none |
| Kategori › grid | authored | ref Categories 5×2 / 2-col (`56ae…-02`); the tint + tilted photo card is a documented adaptation | none |
| Terbaru shelf | authored | 7 whole cards at 1440, 2.3 cards bleeding on phones | none |
| Category switcher | authored | ref 96px label + medallion | **Kecantikan panel: 5 cards in a 7-slot row; the right ~360px is empty** (`894181…-02`) |
| Banner rail | authored | ref "Discover" rail; action pills aligned at the bottom (`047b…`); next card peeks at 320/200 (`236d…`) | none |
| Footer / dock | authored | ref columned footer (`95bd…`) and floating dock (`8d4a…`) | none |
| Listing + filters | authored | ref `c8a1…`/`488c…`/`bbf0…`; pixel-clean dropdown (`c87e…`); skeleton uses the card frame (`ef09…`) | none |
| PDP | authored | ref `c9ed…`/`52a3…` (white media panel, narrow buy box, 52px CTA, accordions) | ref uses a −/+ stepper, ours is a bare number pill, and the contract records no reason for dropping it |
| Cart | authored | empty state matches ref `f256…`; white summary card | the purple-outline "Perbarui jumlah" differs from the R3 secondary pill |
| Promo | authored | standard grid, honest empty state (`b651…`) | none |
| Help | authored | ref 2-up topic cards (`27b2…`) | **2-up cards have unequal heights** (`603301…`) |

None of the template signals in your list show up: no dark/dotted hero, no accent word in a headline, no eyebrows, no monospace, no stats, no unsourced "resmi" claims. The layout would not fit another business, because the fixed Rp99.000 and the "pilihan lengkap" contents drive the hero, the cards, the PDP and the cart.

## Findings
1. **Switcher panel is short (material).** I checked the code. `src/app/(storefront)/page.tsx:39-41` reads only `limit:'16'` per department, then removes products that fail `homeSafe` and products already in Terbaru. Kecantikan has many claim products, so only 5 survive. The 320 category listing still shows other clean candidates: Body Culture, KDK, Lovaboo, Medinail and Gushiyuta.
2. **Help grid looks ragged.** Pengembalian is about 100px tall next to Ongkir at about 170px. In the reference, cards in the same row share a height. The fix is to stretch the grid items.
3. **Secondary buttons use three treatments:**
   - purple outline: cart, "Kembali ke katalog"
   - white hairline: "Lihat produk lainnya", "Hapus filter"
   - white with shadow: hero
   
   R3 asks for the white hairline pill, so cart and help should move to it.
4. **Cosmetic:** the H1 sliver behind the omnibox at 390. It falls under the glass-opacity backlog.

I did not count accepted items as findings: claim photos, the single photo on bundle PDPs, "Masuk", the phone header without a logo, one-line titles and banner photo taste.

## Reference transfer
- **Hierarchy:** the type scale H1 → 20/600 → 14/600 → 12/600 matches the measured table.
- **Density:** the 1250 container, 16px gaps, 6 columns and 7-card shelves match `c8a1…`/`56ae…-02`, except finding 1.
- **Imagery:** our photos are white-ground merchant shots, so the tint + cut-out approach has a recorded rationale and is applied consistently.
- **Missing rationale:** the PDP stepper only.
- **Research gaps:** category pages and checkout are declared not inspectable on shop.com.

Most important change: Fill every switcher panel to seven cards. Read more than 16 products per department before the `homeSafe` and Terbaru filters, so the desktop home never shows a short shelf.

Verdict: REVISE