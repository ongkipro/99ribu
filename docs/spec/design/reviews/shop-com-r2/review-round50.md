Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/banners-1440.png, docs/spec/design/renders/shop-com-r2-20261022/banners-390.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1440.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-mid-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/dock-home-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/filter-nojs-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-pop-1440-dpr2.png, docs/spec/design/renders/shop-com-r2-20261022/filter-sheet-390.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-appended-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-more-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-skeleton-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-focused-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: a23e036d74da453f
Images-SHA: 25ec366f8d90c541
Output-SHA: be67a57b5934e31a

Semua 114 gambar sudah saya buka. Hasilnya **REVISE**: satu cacat yang kelihatan di rail promo home, satu klaim badge yang masih masuk akal, sisanya lolos atau minor. Review saya tulis dalam bahasa Inggris karena ini output teknis.

---

## Section verdicts (top to bottom)

**Home and shared shell**
- Environment banner | authored | none | No change; the shorter sentence at 320 still fits on one line.
- Header 1440 (wordmark, centred omnibox, Promo/Cart/Akun) | authored | shop.com omnibox pill, with the rail utilities moved into the header | No change. The omnibox is centred, the cart badge and current fill read clearly (`cart-filled-1440`), and the "Serba 99ribu." reveal keeps the field still (`brand-hover-1440`, `brand-hover-mid-1440`).
- Phone header + dock | authored | shop.com 390 header without logo and its icon dock | No change. The filled active icon is correct on home, Kategori and cart (`dock-home-390`, `dock-cart-390`, `category-320-15`).
- Category pills | authored | shop.com photo pills + grid icon | No change. The focus ring is drawn whole at 1440 and at 320/200% (`pills-focus-*`).
- Hero | authored | shop.com "Shop is all about you" card | No change. "Rp99.000" stays whole at 320/200%, and the stacked actions don't clip (`hero-320-text200`).
- Kategori grid | authored | shop.com Categories tiles, with tint in place of full-bleed art | No change. Labels wrap between words and every photo stays inside its tile (`home-categories-1440/390`, `home-320-02`).
- Terbaru shelf | authored | shop.com department shelf (7 cards at 1440, 2.3 on phones with a cut card) | No change. Text-heavy photos are accepted merchant content.
- Category switcher | authored | shop.com trending switcher (96px label, next name cut, medallion) | No change.
- **Promo banner rail | authored layout, weak curation | shop.com "Discover something you love" 410×520 cards | Replace the "Paket campuran" photo and the tee photo; align the action pills to the card bottom.**
- Footer | authored | shop.com columned footer | No change. It drops to 2 columns at 390 and 1 column at 320/200% without clipping.

**Search, listing and filters**
- Heading + filter chip row | authored | shop.com search chips above results | No change. The active chips use an ink fill with a joined ×, plus "Hapus semua" (`filter-active-1440`).
- Dropdown / phone sheet / no-JS form | authored | shadcn Select; shop.com bottom sheet; native GET form | No change. The dropdown edges sit on whole pixels and the check marks the selected row (`filter-pop-1440-dpr2`, `filter-sheet-390-*`, `filter-nojs-390-*`).
- Grid + infinite scroll | authored | shop.com six-column results | No change. The skeleton row uses the card frame, and "Lihat produk lainnya" is the white hairline pill (`listing-skeleton-1440`, `listing-more-1440`).
- Omnibox open state | authored | shop.com chip-variant suggestions | No change this cycle. Page content showing through the glass (the "Semua produk" H1 under the panel corner in `search-focused-390`) is the accepted cosmetic backlog item.

**Product page, cart and promo page**
- PDP | authored | shop.com PDP (narrow buy box, 52px pill, chevron accordions) | The task header wraps at 320/200%: "Kembali" sits on its own row and the wordmark moves left. The breadcrumb "/" also ends a line on its own. Keep the separator with the next crumb.
- Filled cart | authored | no reference (unboxed lines, summary card) | At 390, "Lanjut ke checkout" sits about 1.2 screens down (`cart-filled-390-02`). Consider a sticky summary total + CTA on phones. This is a known gap, not blocking.
- Empty cart | authored | shop.com "Your cart is waiting" | No change. The single filled "Lihat produk" pill is centred.
- /promo page | authored | standard grid | No change. The decisions on bundle overlap and "Belum ada promo ongkir aktif." are accepted.

## Evidence and observations

**1. Promo rail photo (the main defect).** The first card's photo in `banners-1440-01`, `banners-390-01`, `home-390-03` and `home-320-text200-04` is a faded grey collage of a mini chopper: low contrast, ghosting, and a smudged caption line in the frame. In shop.com's rail (`2026-10-23-home-1440-full-03`), the photo itself carries each card. Here the lead card looks like an image that failed to load. This is a curated surface (`BANNER_PHOTOS`, "picked by eye"), so the merchant-photo exemption doesn't cover it.

**2. "80%" badge on the tee photo (plausible, not confirmed).** The third card's photo has a dark round badge reading "80%" at bottom right. It breaks the banner rule "no text or badges" and can read as a discount, which the rail must not imply.

**3. Uneven action pills.** "Kaos dan atasan pria" has a one-line body, so its pill sits about 4px higher than its two neighbours at 1440.

**4. Template signals checked and cleared:**
- No dark or grid hero, no accent word, no eyebrows, no monospace, no `→` on every button.
- "Rp99.000" is the real fixed price, not an unsourced stat.
- The tiles repeat the same card treatment, but shop.com's Categories grid justifies that.

**5. Reference fidelity.** Hierarchy, rhythm and density match the references:
- canvas `#fafafa` with white raised surfaces;
- the 5-column tile grid;
- 7-card shelves at 1440;
- the six-column results grid;
- the PDP split of 738px media panel to 448px buy box.

Imagery is the one principle that didn't carry over: shop.com's editorial rail is photo-led, and our lead banner photo is the weakest image on the page.

**6. Evidence gaps.** These parts of the contract have no image in this list:
- R11 `/bantuan`, so the help screen can't be judged against the help reference (`27b2…`, `6c37…`);
- the empty cart at 1440;
- the not-found and sign-in pages;
- the 768 and 1024 widths, so "4.6 cards at 768" and "6 columns from 1024" can't be checked visually.

This list covers visual acceptance only. Interaction and accessibility evidence are not part of it.

**Most important change:** Replace the washed-out "Paket campuran" banner photo and the badged tee photo with clean, high-contrast item photos, so the editorial rail is carried by its imagery as in the shop.com reference.

**Verdict: REVISE**