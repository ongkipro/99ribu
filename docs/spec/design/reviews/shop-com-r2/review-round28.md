Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-1920.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-closed-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-privasi-1440.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1920.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: c06b5beea08fec78
Images-SHA: 1cb1d07ae5f071fb
Output-SHA: 6b739c468b92d4a7

Paduka Ongki, saya sudah buka dan cek ke-121 gambar di `design/review-slices/`. Hasilnya **REVISE**. Mayoritas section sudah authored dan cocok dengan referensinya, tapi ada empat temuan yang belum beres plus satu catatan konten bundle. Detail review di bawah dalam bahasa Inggris.

## Section by section

| Section | generic or authored | look matched | one concrete fix |
|---|---|---|---|
| Env banner + header (brand, centred omnibox, cart/promo/account) | authored | shop.com omnibox pill + rail actions (`omnibox-closed-1440`, `header-cart-items-1440`) | On `/promo`, give the tag icon the same lavender current fill the cart gets on `/keranjang` (`b651564a…-promo-1440`). |
| Omnibox open/typing | authored | shop.com glass suggestions panel: blurred pills show through, "Saran pencarian" caption, 40px rows | none |
| Category pills | authored | shop.com pill row (36px photo circles, grid link, 2px ink focus ring with offset in `pills-focus-1440`) | none |
| Hero card | authored | shop.com value card ("Semua / Rp99.000", 64/800, filled + white pill). It holds at 320/200%: price stays whole, CTAs stack | none |
| "Kategori ›" grid | authored | shop.com Categories grid (5 / 3 / 2 / 1 columns, tinted tiles) | The tilted photo cards are cut off by the bottom edge of the tile at every width (Pria, Makanan, Kecantikan in `c6d3322b…`, `fed7132d…`, `home-768-02`). Round 26 says the art "sits fully inside the tile": inset the cards or update the contract. |
| "Terbaru ›" shelf | authored | shop.com department shelf (7 cards at 1440, 4.6 at 768, 2.3 at 390, bleeds on phones) | none on layout. See the claims finding. |
| Category switcher | authored | shop.com 96/800 switcher with a medallion | At 768 only "Kecantikan" shows, plus a grey sliver at the edge (`fd8b8d79…-home-768-02`). At 1440/1920 the third label stops at a hard vertical edge ("Ruma▌"), and the selected label sits at the left with empty space before it. shop.com centres the selected label with readable neighbours on both sides ("supplies **Beauty** Women"). Centre the active tab on first render and use a soft mask instead of a hard cut, so the block reads as a set of tabs rather than a giant heading. |
| Listing (search/category) | authored | shop.com Results grid (6 / 4 / 2 columns), 20px media, chip/filter row | none on layout. The one-line titles make three "Gendes Sweet Aro…" cards look identical at 1024, but this is a recorded owner decision and isn't counted. |
| Filter panel | authored | R4 in-flow panel with native selects (accepted deviation) | none |
| PDP | authored | shop.com PDP: narrow buy box, 52px pill, chevron accordions, full-width media on phones | A bundle shows one photo: "Paket Hemat Listrik & Pipa" is 3× pipe cleaner + 1× saver, but only the saver is pictured. Needs a per-item thumbnail strip, which is new scope. |
| Cart (filled) | authored | R7: unboxed line, white summary card with a hairline, full-width checkout pill | none |
| Help | authored | help.shop.app: centred column, 2-up topic cards, chat at the bottom | none |
| `/masuk` error | authored | centred card, rounded error panel with focus ring, 52px pill | none |
| Promo | authored | standard grid, then the plain "Belum ada promo ongkir aktif." line | header current state (see the header row) |
| Placeholders | authored | R8 centred single column | none |
| Footer | authored | shop.com columned footer without QR/app badges; one column at 320/200% | none |
| Mobile dock | authored | shop.com active-pill indicator plus labels; 2×2 static under the short-viewport rule | none |

## Findings
1. **Switcher neighbours (hierarchy / reference fidelity).** At 768 the tab strip looks like a single word. At 1440/1920 the right neighbour stops at a hard edge. The reference centres the active label with faded neighbours on both sides.
2. **Unsourced claims (content).** Merchant imagery and names show "TERBUKTI AMPUH" with before/after photos, "Kinclong dalam 14 hari" (Antabur, in the first Kecantikan switcher panel on the home page at 1440/1920), "Anti Botak", "Korset Pelangsing" ("Bentuk Tubuh Lebih Rapi dalam Sekejap!") and "Meniruskan" (search, `category-1024`, `category-320`). None has a visible source. This was flagged to the owner in round 27 and is still visible on the landing page.
3. **Tile art overflow (contract mismatch).** The tile photo cards are cut off by the tile edge, contrary to the round-26 text.
4. **Promo icon current state (consistency).** The cart icon shows its current-page fill on `/keranjang`; the Promo icon shows nothing on `/promo`.

## Reference transfer
I compared the renders with the shop.com captures included in the image set (`56ae2fb1…-home-1440-full-01..03`, `44fc7af5…-home-390-full-01..05`, `95bdbd15…`, `24f5fb56…`, `c8a1c9a0…`, `488cca11…`, `bbf0d8af…`, `c9edea82…`, `52a31a5d…`, `2d2dc596…`, `f256fbf0…`, `9f3fa1c5…`, `27b2df7e…`, `6c377b87…`). The hierarchy, rhythm and density match these well:
- the pill row comes before the value card, then the tinted category grid, then the shelf, then the switcher;
- the 20px white media cards are the same;
- the help column and topic cards are the same.

The skipped sections (trending stores, editorial collections, store carousels) are justified in the contract because the shop has a single seller and no editorial content. The palette, the 99rb wordmark and the Indonesian copy keep the 99ribu brand. I found none of the template signals the brief lists.

**Not verified:** multi-option PDP option pills (no catalog data for them). Category pages also have no shop.com reference, as already noted in the contract.

Most important change: Keep products whose photos or names make unsourced claims out of home merchandising (switcher panels, Terbaru) until the owner supplies clean imagery, and centre the switcher's active tab so its neighbours stay readable at 768 and up.

Verdict: REVISE