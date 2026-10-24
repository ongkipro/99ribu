Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/banners-1440.png, docs/spec/design/renders/shop-com-r2-20261022/banners-390.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1440.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-mid-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-home-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/filter-nojs-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-pop-1440-dpr2.png, docs/spec/design/renders/shop-com-r2-20261022/filter-sheet-390.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-appended-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-more-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-skeleton-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-focused-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: d5e6756aede37176
Images-SHA: 1f62537f553ccbf0
Output-SHA: c10c20a30671f41e

Paduka Ongki, semua 115 slice sudah saya buka, termasuk 15 slice referensi shop.com tanpa label: cart, help, dan home 2026-10-22. Hasilnya **PASS**: tidak ada render yang rusak atau terpotong, dan tiap keputusan yang menyimpang dari referensi ada alasannya di visual-context. Catatan yang tersisa tidak menghalangi (non-blocking). Review lengkapnya di bawah, dalam bahasa Inggris.

---

**Section review (top to bottom, then per page)**

| Section | Generic or authored | Look matched | One concrete fix |
|---|---|---|---|
| Env strip + desktop header | authored | shop.com centred white omnibox (ref home 1440) moved into a top header. The 3-column grid keeps the omnibox centred, as the brand-hover slices show. | None needed. "Serba 99ribu." reveals inside the left column without moving the omnibox (brand-hover-mid / brand-hover). |
| Phone header | authored | shop.com 390 full-width omnibox, logo removed (owner override) | None needed. At 320/200% the placeholder truncates to "Cari pr…", which is accepted. |
| Category pills | authored | shop.com photo-circle pills (ref 2026-10-23 home 1440) | None needed. Current state is the lavender fill (category-320 slice 01); focus is a 2px ring, unclipped (pills-focus-320). |
| Hero | authored | shop.com value card with floating product tiles; tiles here are tilted white rounded photos on a lavender/yellow tint | None needed. At 320/200% "Rp99.000" stays on one line and the card grows instead of clipping (hero-320-text200). |
| Kategori grid | authored | shop.com "Categories ›" tinted tiles. The photo sits as a white inset card instead of full-bleed, which the white-ground photos justify. | None needed. At 320/200% it drops to one tile per row and labels never break inside a word. |
| Terbaru shelf | authored (pattern matched) | shop.com 7-up product shelf, 1:1 media in 20px frames, 14/600 one-line title, 12/600 price | Non-blocking: the "Paket Tukang & Bengkel" cover is a washed-out, near-empty frame on a curated surface (home-1440-01, position 3). It reads as a failed image load. |
| Category switcher | authored | shop.com 96px switcher: medallion above the label, grey inactive labels, edge fade | None needed. At 320 the next name peeks in (home-320 slice 03). |
| "Temukan pilihan" banners | authored | shop.com "Discover something you love" 410×520 rail. The caption sits on white below the photo instead of over it (accepted, rounds 48–54). | None needed. Action pills line up at the bottom. At 320/200% the caption and "Lihat paket" fit, with no arrow below 360px. |
| Footer | authored | shop.com columned white footer: brand left, labelled menus right, bottom row | None needed. Headings at 14/500 sit lighter than the 16px links. That matches the reference tokens. |
| Mobile dock | authored | shop.com 390 dock: filled ink active icon, outline inactive, 28px top radius | None needed. At short heights it sits static between the page and the footer (dock-320-text200). That is the documented round-40 rule. |
| Omnibox open | authored | shop.com one glass surface that grows downward, with chip suggestions (owner's chip variant) | None needed. The "kac" and "ru" states show bold matches plus a final "Cari “…”" chip. The few-results state has no empty space below. |
| Listing heading + chip row | authored | shop.com search chip row above the results | None needed. Active chips are filled ink with a joined × and "Hapus semua" (filter-active-1440). |
| Filter dropdown / sheet / no-JS | authored | shadcn Select on whole pixels (dpr2), shop.com 28px bottom sheet, native GET form | None needed. The 2-option sort sheet has no stray separator. |
| Results grid + infinite scroll | authored (pattern matched) | shop.com 6/2-column grid | None needed. The skeleton row reuses the card frame, and "Lihat produk lainnya" is a white hairline pill that keeps the footer reachable. |
| /promo | authored | The standard grid under an H1 and H2 hierarchy | None needed. The empty "Promo ongkir" shows as a plain sentence, not as an empty card. |
| PDP media | authored | shop.com white media panel at about 28px radius | Non-blocking: the product fills only about 25% of the 740px panel (pdp-1440, bundle-open), against about 70% in the reference boot. The fix depends on the backlogged per-item media and crop work, not on layout. |
| PDP buy box + accordions | authored | shop.com narrow buy box: full-width 52px primary, pill quantity, hairline chevron accordions | None needed. At 320/200% the task header wraps cleanly to "Kembali" over the logo and cart. |
| Empty cart | authored | shop.com empty cart: centred heading, one line of text, one filled primary pill | None needed. |
| Filled cart | authored | Unboxed line plus a white rounded summary card with a full-width primary (R7) | None needed. At 390 the quantity pill sits beside "Perbarui jumlah" and "Hapus" gets its own row. |
| Help | authored | help.shop.app centred column with 2-up topic cards (1-up on phones) and support below | None needed. The chat card's purple outline secondary is the recorded owner-component deviation. |

**What I checked against the references**

I compared shop.com's 2026-10-23 home captures (1440 and 390 full), the 2026-10-22 search, filter sheet and PDP captures, and the unlabeled cart, help and home slices with the 99ribu renders. Concrete observations:

- **Hierarchy:**
  - Every storefront page keeps one H1, 20px section headings with "›" links, and a single purple primary per task: "Masuk", "Tambah ke keranjang", "Lanjut ke checkout", "Lihat produk".
  - Banner titles are 18px, under the 20px "Temukan pilihan" heading.
- **Rhythm:**
  - The 1250px container holds across header, hero, grid, shelves, listing, PDP and footer at 1440.
  - Phones bleed shelves and the banner rail to the edge, with the next card peeking: 2.3 cards in a shelf, 85% banner width at 320/200%.
  - No horizontal clipping in any of the 320/200% slices: home, category (all 15 slices), PDP, footer, pills, hero.
- **Imagery:**
  - Every visual is real catalog photography. There are no drawings or generated stand-ins.
  - Curated surfaces (hero, tiles, pills, banners, Terbaru, switcher) carry no percentage, discount or claim overlays.
  - The claim covers in listings (Antabur, Gendes, Bright Glow, "Wajah Glow Up") are the accepted content backlog, not findings.
- **Density:**
  - The 6-column grid at 1440 and 2-column grid at 390 match the reference.
  - One-line titles and the single "Rp99.000" price keep comparison scannable.

**Template signals:**
- No dark hero, no eyebrow pills, no monospace labels, and no unsourced stat figures.
- Arrows appear on only two kinds of control: the hero secondary and the banner/shelf "›" affordances.
- There are no "resmi", "terpercaya" or similar claims in our own copy.
- Repeated cards are justified: help topics and product cards each follow a reference pattern.

**Research and rationale:** the visual-context file records the transfer rationale for each departure from the references: inset tile photos, caption below the banner photo, chip suggestions, anchored dropdown, no logo on phones, and the 1250px cap.

Most important change: Screen curated home covers for legibility as well as claims, because the washed-out "Paket Tukang & Bengkel" cover in the Terbaru shelf reads as a broken image on the most visible product row (non-blocking content curation).

Verdict: PASS

---

This is visual acceptance only. Interaction and accessibility were not tested here. One discrepancy to note: `git status` at session start listed several `design/review-slices/*.png` files as deleted, but all 115 files in your list exist on disk and opened fine.