Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/banners-1440.png, docs/spec/design/renders/shop-com-r2-20261022/banners-390.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1440.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-mid-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/dock-home-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/filter-nojs-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-pop-1440-dpr2.png, docs/spec/design/renders/shop-com-r2-20261022/filter-sheet-390.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-appended-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-more-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-skeleton-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-focused-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 7fb1f8304c8abc3f
Images-SHA: b946029224e086ca
Output-SHA: c4e211c0829c858b

Paduka Ongki, saya sudah buka ke-114 gambar. Hasilnya **REVISE**: tiga masalah material plus beberapa yang kecil, rinciannya di bawah. Review di bawah ini dalam bahasa Inggris karena merupakan output teknis.

## Section verdicts (top to bottom)

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Environment strip | authored (functional) | none | None needed; the 320 short form "Data contoh: simulasi lokal." holds. |
| Header 1440 (wordmark, omnibox, Promo/Cart/Account) | authored | shop.com omnibox pill + rail utilities moved to the header | None. Reveal states are clean, and the omnibox stays centred in `c22573c4…brand-hover-1440` and `5dce9521…brand-hover-mid`. |
| Phone header (search only, no wordmark) | generic | shop.com 10-24 (claimed, not in set) | Add the 10-24 capture, or bring the wordmark back. The refs in this set show a wordmark above the search (`24f5fb56…-390-01`, `44fc7af5…-390-full-01`). |
| Category pills | authored | shop.com pills (`95bdbd15…-1440-01`) | None. The current lavender fill and focus ring read clearly (`60c6b1bb…`, `59c9acdb…`). |
| Omnibox open | authored | shop.com glass omnibox | Raise the panel opacity or blur over the pill row. In `440ce9a4…-1440` and `caf493d3…-opening-1440`, blurred pills show as grey ghost chips beside "Sarung". |
| Hero | authored | shop.com tilted-card hero collage (`56ae2fb1…-01`) | None. At 320/200% it grows without clipping, and "Rp99.000" stays whole. |
| Kategori grid | authored | shop.com Categories tiles, adapted to white-ground photos | None. Two rows at 1440, two columns at 390, one column at 320/200%. |
| Terbaru shelf | authored | shop.com product carousel (`56ae2fb1…-02`) | None. Seven cards at 1440 and a cut card on phones. |
| Category switcher | authored | shop.com switcher (big label + medallion) | None. |
| **Promo banner** | **generic** | **none (it misses the "Discover something you love" rail card)** | **Keep the 410×520 photo-led card even when it is the only banner, or re-pick photos that hold up at about 730px.** |
| Footer | authored | shop.com columned footer | At 320/200%, give the Legal links the same gap as the other menus (details below). |
| Phone dock | authored | shop.com dock, but without the active pill shown in the refs | Re-observe, or add the grey active pill seen in `24f5fb56…-390-01` and `44fc7af5…-390-full-01`. |
| Listing header + filter chips | authored | shop.com chip row (`c8a1c9a0…-search-1440`) | None. The filled active chips with joined × buttons and "Hapus semua" are clear (`cc9e42a2…`). |
| Filter dropdown / sheet / no-JS form | authored | shadcn Select; shop.com bottom sheet (`bbf0d8af…`) | None. The dropdown lines up with the chip edge, and the sheet has 16px insets. |
| Listing grid / skeleton / "Lihat produk lainnya" | authored | shop.com 6-col grid + skeleton | None. |
| **PDP media** | **generic** | **partial (the reference shows a thumbnail strip and the product fills the panel)** | **For a bundle, show one photo per item (or a strip). One small item photo in a 740px panel does not show what the bundle contains.** |
| PDP buy box + accordions | authored | shop.com buy box (`c9edea82…-pdp-1440`) | None. Full-width 52px primary, pill quantity, chevron accordions. |
| Cart (filled) | authored | R7 contract | Use the same multi-item media for bundle line thumbnails. |
| Empty cart 390 | authored | shop.com empty cart (`9f3fa1c5…-390-01`) | None. Centred heading, text and one primary pill. |
| /promo | authored | standard grid | None. |

## Findings and consequences

**1. The promo banner is the weakest section on the home page.** Seen in `047b8bc5…-banners-1440-01`, `894181cd…-home-1440-02` and `e2c982bd…-banners-390-01`.
- **Stretched layout:** at 1440 the single banner fills the 1250px container. The left ~58% is a photo mosaic. The right ~42% is a mostly empty white caption panel.
- **Weak photos:**
  - The top car photo is visibly upscaled and soft.
  - The bottom-right tile (the chopper) is washed-out grey, has faint text and is almost blank.
  - All three are white-ground cutouts. The reference rail cards (`56ae2fb1…-03`) are full-bleed lifestyle photos with the caption overlaid.
- **Split card:** the card's hairline edge shows only around the caption half. The card reads as a loose photo slab next to a bordered text box.
- **Consequence:** this is the only editorial block on the home page. It reads as a placeholder and weakens the visual close of the page before the footer.
- **At 320/200%** the mosaic shrinks to about 90px-tall tiles (`f9ad8c3b…-04`). The caption fits, but the photos say nothing at that size.

**2. Two contract claims conflict with the reference images in this set.**
- The "Mobile header and dock (observed)" section says shop.com has no mobile logo and no active pill.
- Both 390 refs in the set show the "shop" wordmark above the omnibox and a grey pill behind the active Home icon: `24f5fb56…-390-01` (10-22) and `44fc7af5…-390-full-01` (10-23).
- The 10-24 observation those claims rely on has no capture in this set.
- **Consequence:** on 99ribu phone pages (`8d4a9a8d…-dock-home-390`, `30a6fdeb…-listing-first-390`) the brand mark appears nowhere above the fold. That costs brand fit on the main entry width, and right now it rests on evidence that isn't in the set.

**3. Bundle media misrepresents what the bundle contains.**
- `bc2effc7…-pdp-1440-01`: "Paket Hemat Listrik & Pipa Anti Mampet" (3× pipe cleaner + 1× energy saver) shows only the energy saver. The product fills about a quarter of the 740px panel and looks soft. The same single photo appears in the cart line (`4567ff2f…`) and on the listing cards.
- The user's job is to compare options and their contents. The photo actively contradicts the "Isi yang diterima" list.
- Round 27 flagged this as new feature scope, but it is **not** in the accepted-decisions list. It stays open as a task-clarity finding until the owner decides.

**4. Minor issues.**
- **Footer at 320/200%** (`b6b3ad67…-05`, `f9ad8c3b…-06`, `90075c5f…-15`): "Kebijakan privasi / Syarat dan / ketentuan" stack with a 44px pitch, close to the 34px line pitch inside the wrapped name. The other menus use a 52px pitch. Two links can read as three.
- **Search-focused 390** (`f834dc97…`): a fragment of the "Semua produk" H1 glyph shows under the lower-left edge of the open panel.
- **Omnibox suggestions:** "Summerspring" (a brand) is one of the six suggestions shown. It is the accepted round-38 list, but it is the only brand word there.

**Out of scope (accepted):** claim-bearing merchant photos in listings ("WAJAH GLOW UP", "TERBUKTI AMPUH", Bright Glow swatches), duplicate photos across products (the Gushiyuta and Wajah Tirus cards share one photo), the duplicated item list in the bundle description, and the sticky-media gap in `46d89c1d…-bundle-open-1440-01`.

## Transfer check against the references

- **Rhythm and density match well:**
  - The 6-column grid with 20px media frames and 14/12 type matches `c8a1c9a0…`.
  - The chip row and bottom sheet match `bbf0d8af…`.
  - The PDP buy-box order and 52px primary match `c9edea82…`.
  - The empty cart matches `9f3fa1c5…`.
  - The switcher and the 7-card shelf match `56ae2fb1…-02`.
  - The columned footer matches `95bdbd15…`.
- **Imagery is where the transfer breaks.** The references rely on full-bleed, art-directed photos (category tiles, store carousels, editorial rail). The 99ribu catalog has white-ground merchant cutouts. The tinted tiles and the hero's floating cards adapt to that well. The promo banner and the PDP media don't: they copy the reference layout while dropping the photo quality that layout depends on.
- **Gaps in the evidence:**
  - There is no 99ribu `/bantuan` render, although the help refs (`27b2df7e…`, `6c377b87…`) are in the set, so R11 can't be checked here.
  - There is no 1440 empty-cart render.
  - The 10-24 shop.com observations behind the dock and phone-header claims have no captures in the set.

Most important change: Rebuild the home promo banner as the photo-led 410×520 rail card the reference uses (or re-pick photos that stay sharp and fill the frame at the rendered size), so the only editorial section stops reading as a placeholder.
Verdict: REVISE

This is visual acceptance only, not interaction or accessibility testing. I edited nothing except my plan file (`~/.claude/plans/you-review-a-web-adaptive-lightning.md`).