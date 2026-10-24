Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/banners-1440.png, docs/spec/design/renders/shop-com-r2-20261022/banners-390.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1440.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-mid-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/dock-home-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/filter-nojs-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-pop-1440-dpr2.png, docs/spec/design/renders/shop-com-r2-20261022/filter-sheet-390.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-appended-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-more-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-skeleton-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-focused-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 9de9d6246d016636
Images-SHA: bfbc7e3437aee054
Output-SHA: cc26f8eef72cdcff

Paduka Ongki, semua 115 slice sudah saya buka. Hasilnya **REVISE**, karena ada render yang terpotong di 320px dengan teks 200% dan ada dua penyimpangan dari kontrak. Review lengkapnya dalam bahasa Inggris di bawah. Belum ada kode yang saya ubah; catatannya saya simpan di file plan.

## Section verdicts (top to bottom)

**Home**
- Env banner + phone header/omnibox | authored | shop.com omnibox (white pill, soft shadow, round purple submit) | none needed; at 320/200% the "Cari pr..." truncation is the accepted single-line field.
- Category pills | authored | shop.com pill row (photo circle + 16/600 label, grid link at the end) | none.
- Hero "Semua Rp99.000" | authored | shop.com value card (radius, shadow, Sign-in-style primary) | none. It is built from the brand's own product photos, the price is the claim the hero carries, and at 320/200% the card grows instead of clipping.
- "Kategori ›" grid | authored | shop.com tinted category tiles (5 per row at 1440, 2 on phones) | none. The tinted tiles with a dark label are a justified deviation, because the product photos have white grounds.
- "Terbaru" shelf | authored | shop.com product carousel (7 whole cards, 2.3 on phones with edge bleed) | none.
- Category switcher | authored | shop.com switcher (96/800 label, medallion, edge fade) | none.
- **Promo banner** | generic in placement | shop.com "Discover something you love" rail card | **Fix:** at 320/200% the card clips its own caption and CTA. At 1440 a single 410px card sits left with about 840px of empty canvas. Either lay out a lone banner across the container, as round 45 already describes, or hide the rail when there is only one card.
- Footer | authored | shop.com columned footer (brand left, labelled navs, 2-col on phones) | none.
- Dock | authored | shop.com floating bar (filled active icon) | none.

**Listing (search/category/promo)**
- Chip row + active chips | authored | shop.com filter chips (filled chip when a value is set, joined × to remove) | none.
- **Desktop dropdown** | mostly authored | shadcn Select | **Fix:** the focused row shows a purple outer ring *and* an ink inset ring. Keep only the inset ring, and make the hairline after "Semua pilihan" visible.
- Phone sheet / no-JS form | authored | shop.com bottom sheet; native `<details>` form | none.
- Grid, skeleton, "Lihat produk lainnya" | authored | shop.com 6-col / 2-col results grid | none.

**PDP**
- Task header, breadcrumb, media panel, buy box, accordions | authored | shop.com PDP (narrow buy box, 52px pill primary, chevron accordions) | none. A bundle showing one photo is accepted owner content.

**Cart**
- Lines, quantity pill, summary card | authored | contract R7 | **Minor fix:** "Perbarui jumlah" is a purple-outline pill. Every other secondary pill uses the white hairline (R3).
- Empty cart | authored | shop.com centred empty state with one filled primary | none.

## Evidence and observations

- **Banner clipped at 320/200%** (`f9ad8c3bad0b98a7-home-320-text200-04.png`, `-05.png`): "berbeda dalam" is cut at the card's right edge (about x=246), and the dark "Lihat paket campuran" pill runs past the card and gets cut. This directly contradicts the contract's "caption is never clipped at 320/200%". Clipped rendering is a finding at any width.
- **Lone banner at 1440** (`047b8bc560694513-banners-1440-01.png`, `894181cd6f0102a7-home-1440-02.png`): the reference rail (`56ae2fb14286102a-…-1440-full-03`) works because it is full-bleed with many cards. With one card, the "Promo" section reads like an unfinished rail. Its gold trimmer and power-saver photos are also the same images as the "Paket Barber & Groom…" and "Paket Hemat Listrik" cards just above, so the banner adds no new imagery. It sits fine at 390 (`e2c982bd80b7f52c`).
- **Dropdown focus** (`c87e94a18e75a0fd-filter-pop-1440-dpr2-01.png`): "Semua pilihan" has a 2px purple outer ring plus an ink inset. Review 44 recorded "only the inset ink ring". Focus is also on "Semua pilihan" while the check mark is on "Paket campuran", but the contract says focus starts on the selected item. That may just be the capture moment, so check it in the browser. I can't see a separator between the "all" choice and "Satuan".
- **Matches confirmed:**
  - Omnibox: open, few and typing states (`440ce9a4…`, `4c228efb…`, `3e26481a…`, `64b81812…`) show one glass surface with no inner pill, and the typed match in bold.
  - Brand reveal (`5dce9521…`, `c22573c4…`): "Serba 99ribu." with the omnibox staying put.
  - Category tiles (`c6d3322b…`, `fed7132d…`): whole rows, clean curated photos.
  - Skeleton (`ef0970d0…`): uses the card's own frame.
  - Pill focus ring (`60c6b1bb…`, `59c9acdb…`): not clipped at 320/200%.
  - Dock (`8d4a9a8d…`, `0bc881c0…`): filled active icon; hidden while search has focus (`f834dc97…`).
  - PDP (`bc2effc7…`, `5246c805…`, `b6b3ad67…`): matches the reference buy-box rhythm (`c9edea82…`). No buy-now, Save or Share buttons were copied, which is correct.
- **Transfer vs. reference:** hierarchy, spacing rhythm and density follow shop.com closely. The imagery gap (white-ground merchant shots instead of lifestyle photos) is handled with tints and curated picks, and the contract justifies that. The listing grids carry the claim-heavy merchant photos (Antabur, Gendes, "Wajah Glow Up"), but those are the accepted compliance backlog and outside this gate.
- **Research gap:** help references (`27b2df7e…`, `6c377b87…`) are in the set, but there is **no 99ribu `/bantuan` render**, so R11 can't be confirmed from these images. Two other references, the shop.com empty cart (`f256fbf0…`, `9f3fa1c5…`) and the home at 1440 (`95bdbd15…`), do have matching 99ribu renders.

Most important change: Fix the promo banner card so its caption and "Lihat paket campuran" pill fit inside the card at 320px with 200% text, and give a lone banner a layout that doesn't leave most of the 1440 row empty.

Verdict: REVISE