Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-1920.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-closed-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-privasi-1440.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1920.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: d9af75a24f5bd6f0
Images-SHA: 8ab2b2fb932ced51
Output-SHA: 3bf60f56d5eed5de

Saya sudah membuka ke-121 gambar. Semuanya bisa dibaca, jadi review ini terverifikasi, bukan UNVERIFIED. Hasilnya **REVISE**, karena satu cacat render yang terlihat di kategori. Detailnya di bawah (bahasa Inggris, karena ini artefak desain).

---

## Section-by-section

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Env banner + header (brand, centred omnibox, cart/promo/account icons) | authored | shop.com omnibox pill + round submit; icon actions from the rail | none needed; the cart badge sits on the icon (`abf0c092…header-cart-items-1440-01`) |
| Department pills row | authored | shop.com pill row (photo circle + 16/600 label + grid link) | 768 cuts "O…" at the edge with no visible fade. Add the same end fade the shelves use, or accept the cut word as the cue |
| Hero | authored | shop.com "Shop is all about you" card (bottom-left heading, white tiles floating on a tint) | 320/200%: "Cara belanja" wraps to two lines and the arrow is pushed far left (`46ba9739…-01`). Let the secondary take the full row, or drop the icon at that size |
| Kategori grid (home and `/kategori`) | authored | shop.com "Categories ›" tiles, translated to a tint plus a tilted product card because the photos are on white grounds (a justified change) | **Labels collide with the photo card below 1050px.** At 768 "Kecantikan" runs under the photo, and "Perkakas / & / Elektronik" and "Makanan / & / Kesehatan" leave "&" alone on a line (`fd8b8d79…home-768-01/02`). At 320/200% "Kecantikan" touches the photo, and "&" is orphaned again (`f9ad8c3b…-02/03`). Reserve the label column (photo ≤40% with the label max-width set to the rest), and keep "& X" together with a non-breaking space |
| Terbaru shelf | authored | shop.com department shelf (1:1 white media, 14/600 one-line title, 12/600 price, about 7 visible, cut card at the edge) | none |
| Category switcher | authored | shop.com 96/800 label strip with a medallion above the selected name (the move above is a recorded legibility deviation) | none; 768 and 320 both keep the selected name whole |
| Listing (search / category) | authored | shop.com Results grid: 6 columns at 1024+, 2 on phones, 20px media | the open filter panel still pushes the first row about 250px down at 1024–1920; accepted R4 deviation, noted only |
| Product cards: titles | authored | shop.com `line-clamp-1` | at 1024, three neighbours read "Gendes Sweet Aro…" and can't be told apart (`0139e264…-01`). This is the owner's accepted call, so it is noted here, not counted |
| PDP | authored | shop.com narrow buy box, 52px pill, accordions between hairlines | the bundle PDP media shows only one item from a 4–7 item bundle, small inside a 740px white panel (`bc2effc7…pdp-1440-01`), and the layout has no slot for the other items' photos. Add a thumbnail strip with a one-line shot brief per item, as shop.com does |
| Cart | authored | R7: unboxed line plus a white summary card and a 52px checkout pill | none; the ~270px gap at 1440 is an accepted deviation |
| Help | authored | help.shop.app centred column with 2-up topic cards and support at the end | none |
| `/masuk` error | authored | centred card, focused alert, pill actions | none |
| Promo | authored | — (no reference) | the page opens on an empty state ("Belum ada promo ongkir aktif.") above the only real content. Put "Paket campuran" first, or hide the empty shipping section |
| Placeholder pages | authored | shop.com centred empty state | none |
| Footer | authored | shop.com columned footer (labelled navs, bottom legal row) | none; 320/200% stacks cleanly |
| Mobile dock | authored | shop.com active grey pill → lavender pill | none |

## Evidence and observations

- References inspected: `56ae2fb1…home-1440-full-01..03`, `44fc7af5…home-390-full-01..05`, `95bdbd15…`, `24f5fb56…` (home), `c9edea82`/`52a31a5d`/`2d2dc596` (PDP), `c8a1c9a0`/`488cca11`/`bbf0d8af` (search), `f256fbf0`/`9f3fa1c5` (empty cart), `27b2df7e`/`6c377b87` (help).
- **Transfer holds.** The hierarchy, rhythm and density map onto the references in order: pills → hero card → "Kategori ›" → shelf → large-label switcher → footer. Specific matches:
  - The 1440 shelf shows 7 cards with 1:1 white media and one-line titles, the same as the shop.com Beauty shelf.
  - The switcher's 96px grey/black labels with a medallion read as the shop.com strip.
  - The help column matches help.shop.app.
  - The vendor rows, ratings, store carousels and editorial block are absent, and that is correct: the documented single-merchant data has nothing to fill them.
  - Nothing would fit an unrelated business with the name swapped: the fixed price "Rp99.000" anchors the hero, the cards and the footer.
- **Template signals:** none found. There is no dark hero, no accent word, no eyebrow pills, no icon-tile card rows, no mono labels and no `A · B` labels. The arrow appears only on "Cara belanja" and the submit button.
- **Content/claims finding (owner content, still visible):**
  - Catalog photos carry baked-in, unsourced claims: "TERBUKTI AMPUH", "Kinclong dalam 14 hari" with BEFORE/AFTER (`0139e264…-01`, `90075c5f…-04`), and "Bentuk Tubuh Lebih Rapi dalam Sekejap!" (search).
  - The names include "Anti Botak" and "Pelangsing".
  - These sit in the home switcher and the listings. Flag them to the catalog owner; the layout cannot fix them.
- **Image quality:** single-column cards at 320/200% render visibly soft (Gendes, Aloe Vera, Bright Glow in `90075c5f…-05..07`). The cause is probably the q60 / ≤384w srcset scaled to about 288 CSS px at that size. Check that the sizes hint covers the one-column case.
- **Unchanged evidence gaps:**
  - Multi-option PDP pills (R3/R6): no data exists to render them.
  - Category pages have no shop.com reference.

**Most important change:** Give category tile labels their own reserved width below 1050px, so names never run under the tilted photo and "&" never sits alone on a line, at 768 and at 320/200% text.

**Verdict: REVISE**