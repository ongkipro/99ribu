Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/banners-1440.png, docs/spec/design/renders/shop-com-r2-20261022/banners-390.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1440.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-mid-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/dock-home-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/filter-nojs-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-pop-1440-dpr2.png, docs/spec/design/renders/shop-com-r2-20261022/filter-sheet-390.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-appended-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-more-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-skeleton-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-focused-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 776e83a703378884
Images-SHA: 8b321f893d239d78
Output-SHA: 4dcb859d07f53eee

Paduka Ongki, saya sudah membuka semua 116 gambar, termasuk referensi shop.com. Hasilnya **REVISE**: ada 3 masalah desain yang nyata (banner promo di home, kolom foto PDP, dan bagian Spesifikasi PDP yang kosong) plus 3 masalah kecil di filter. Review lengkap di bawah dalam bahasa Inggris. Ringkasan rencana perbaikannya saya simpan di `/home/ongki/.claude/plans/you-review-a-web-snoopy-ember.md`. Belum ada file repo yang diubah.

## Section review (top to bottom)

**Home**
- Env banner + header (brand, centred omnibox, Promo/Cart/Account) | authored | shop.com omnibox pill + icon actions | none needed. `home-1440-01`: the omnibox is centred and the icons sit on the right. The phone header has no logo, as observed on shop.com.
- Category pills | authored | shop.com pill row (`2026-10-23-home-1440-full-01`) | none. `pills-focus-1440` and `pills-focus-320-text200` show the 2px ink ring around the whole pill, not clipped.
- Hero "Semua Rp99.000" | authored | shop.com "Shop is all about you" card | none. Real product tiles sit on the brand tint. At 320/200% the price stays on one line and the actions stack (`hero-320-text200`).
- "Kategori ›" grid | authored | shop.com Categories tiles, changed for white-ground photos | none. It shows 5×2 at 1440, 2 columns at 390 and 1 column at 320/200%. No label breaks inside a word.
- "Terbaru" shelf | authored | shop.com product carousel | none. Square frames and one-line titles are accepted owner decisions. The cut card at the phone edge signals the scroll.
- Category switcher | authored | shop.com 96px switcher | none. The medallion sits above "Kecantikan" and the next name fades at the edge (`home-1440-01`/`-02`).
- **Promo banner | generic | none (it does not match shop.com's 410×520 photo cards) | rebuild as a photo-led card with a visible action.** In `banners-1440` a 1250×410 lavender slab is about 60% empty tint, with a 24px caption at the left and one floor drain on the right.
  - The photo contradicts the copy: "Beberapa barang berbeda" sits next to one item.
  - It is the same photo as the Rumah Tangga tile.
  - It carries a "PREMIUM QUALITY" seal, an unsourced claim on a curated surface.
  - Nothing shows that the banner is a link.
  - At 390 (`banners-390`, `home-390-03`) it reads as a second, weaker hero.
- Footer | authored | shop.com column footer | none. It shows three menus plus a Legal row. At 320/200% the menus stack into one column with no clipping (`footer-320-text200-01/02`).
- Phone dock | authored | shop.com 2026-10-24 bar | none. The active icon is filled and the inactive ones are outlined. The cart badge is clear in `cart-filled-390-03`.

**Listing, search and promo**
- H1 + filter chip row | authored | shop.com chip row (`2026-10-22-search-1440`) | **chip labels must match.**
  - In `filter-active-1440` the chip reads "Ketersediaan: Tersedia" but the removable chip reads "Stok: Tersedia".
  - At 320/200% (`category-320-text200-01`) "Urutkan: Paling se…" is cut at the screen edge with no end fade. Reuse the pill row's fade.
- Grid, skeleton and "Lihat produk lainnya" | authored | shop.com 6/2-column grid | none. The skeleton uses the card frame (`listing-skeleton-1440`). The button keeps the footer reachable (`listing-more-1440`).
- **Desktop filter dropdown | authored | shadcn Select | the focused item shows two rings.** In `filter-pop-1440-dpr2` "Semua pilihan" has the purple global focus ring plus the ink inset ring, and the purple ring touches the panel edge. Keep only the inset ink ring.
- Phone sheet and no-JS form | authored | shop.com bottom sheet | none (`filter-sheet-390`, `filter-nojs-390`).
- `/promo` | authored | standard grid | none. "Belum ada promo ongkir aktif." is a plain sentence.
- Omnibox open, few, typing and phone | authored | shop.com chip-variant panel | none. The panel grows to its content: two chips plus "Cari “kac”" in `omnibox-few-1440`, and the matched text is bold (`omnibox-typing-1440`).
- Wordmark reveal | authored | owner brief | none. The mid-frame clipping of "Serb a" in `brand-hover-mid-1440` is a 240ms transition frame. The end state `brand-hover-1440` is clean.

**PDP**
- Task header + breadcrumb | authored | none (intended deviation) | none.
- **Media panel | authored | shop.com 28px white media panel | make the media sticky from 701px.**
  - In `pdp-bundle-open-1440` the buy box grows to about 1400px. The media stops at about 935px and leaves roughly 650px of empty canvas on the left.
  - In `pdp-1440` the merchant photo fills only about 25% of the panel. That is accepted merchant content.
- Buy box (H1, price + basis, contents, stock, quantity pill, 52px primary) | authored | shop.com buy box | none.
- **"Spesifikasi / Spesifikasi tambahan belum tersedia." | generic | none | hide it when there is no data.** On every PDP (1440, 390, 320) an empty placeholder sits between the primary action and the accordions.
- Accordions | authored | shop.com hairline accordions | none. Repeated contents under "Deskripsi" are accepted owner content.

**Cart**
- Filled cart at 1440 and 390 | authored | follows R7 | none. Lines are unboxed, the summary sits in a 20px card and "Lanjut ke checkout" is 52px.
- Empty cart (`dock-cart-390`) | authored | shop.com `2026-10-22-cart` empty state | none. It is centred with one filled primary.

## Evidence and transfer
Every listed image was opened, including the 20 shop.com reference images: cart, help, home 10-22/10-23, PDP, search and the filter sheet.

- **What carries over:** the near-white canvas, the borderless pill omnibox, the photo pills, the switcher, the 1:1 card rhythm, the narrow PDP buy box and the hairline accordions.
- **What does not:**
  - **Banner:** this is the one section that fails to transfer. Shop.com's "Discover something you love" leads with photography (`2026-10-23-home-1440-full-03`), but our lone banner is mostly an empty tint field.
  - **PDP media:** shop.com fills the media column with a thumbnail rail. Ours shows one photo, which makes the missing sticky behaviour more visible.
- **Help page:** no 99ribu help render was in this set ("reviewed earlier"), so the help reference had nothing to compare against this round.
- **Spec contradiction:** contract R5 still says the "/ pilihan lengkap" basis stays on cards, but the cards show only "Rp99.000" per the round-21 card contract. Reconcile the R5 text.
- **Merchant claims:** claims inside listing photos are accepted owner content and were not counted. The "PREMIUM QUALITY" seal is counted because it is on a curated home surface.

Most important change: Rebuild the home Promo banner as a photo-led card with a seal-free multi-item bundle photo (not the Rumah Tangga tile photo), a caption that fills the card, and a visible "Lihat paket" action.
Verdict: REVISE