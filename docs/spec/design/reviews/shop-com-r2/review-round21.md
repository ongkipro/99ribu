Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-1920.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-closed-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-privasi-1440.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1920.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: bed03d181c73bd84
Images-SHA: 4a8f0a895ba6845a
Output-SHA: 03151a66552b0781

**Verdict: REVISE.** I opened all 122 images. Most of the page is authored and follows the shop.com transfer, but seven defects are visible in the renders, and two of them undo fixes from earlier rounds. Nothing was edited; this was review only.

## Section by section (top to bottom)

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Environment banner | authored | none | No change needed. |
| Header and omnibox | authored | shop.com pill omnibox with soft shadow; suggestions panel grows down without layout shift | At 768, put the cart icon back: `home-768-01` shows only Promo and Akun, the dock is hidden above 700px, so there is no cart entry at tablet. |
| Department pills | authored | shop.com photo-circle pills | The 36px photos can't be read ("Perkakas & Elektronik" is a near-white blob in `home-1440-01`). In `header-cart-items-1440-01`, Pria and Otomotif are empty white circles. Paint the department tint behind every image, and use a contained crop or a cutout. At 768 the row scrolls and Otomotif is cut, although the contract says all six fit at 768. |
| Hero | authored | shop.com value card; 99ribu photos float on the lavender/yellow tint | At 320/200% the price breaks as "Rp99.0 / 00" (`hero-320-text200-01`, `home-320-text200-01`). Make the price unbreakable and let the type scale down instead. |
| "Kategori ›" grid (home) | authored | shop.com Categories tiles (5 / 2 per row) | Names break inside words. At 768: "Kecantika/n", "Kesehata/n", "Peliharaa/n" (`home-768-01/02`). At 320/200%: "Kec/anti/kan", "Oto/moti/f", "Ibu/&/Ana/k" (`home-320-text200-02/03`). Bring back the em-based minimum so enlarged text gives one tile per row, and stack the name above the photo at tablet. Drop `overflow-wrap: anywhere`. |
| "Terbaru ›" shelf | authored | shop.com shelf: cut-off card at the edge, 7 cards at desktop, 2.3 on phones | Titles clamp to one line: "Paket Borongan Solusi…", "Paket Hemat Listrik & …". Almost every name starts with "Paket", so cards can't be told apart. Allow two lines. |
| Category switcher | authored | shop.com 96px switcher with medallion | The 156px opaque white disc hides the middle of the selected name ("Kec◯ikan"); at 320 only "Keca" shows. Make the medallion smaller, or offset it above the label. |
| Second shelf | authored | same as "Terbaru" | Same title clamp fix. |
| Footer | authored | shop.com columned footer (2-column menus on phones) | On the PDP, the "Belanja" menu drops the department links, so the footer differs from every other page. Use one menu set. |
| Listings (search, category, promo) | authored | shop.com 6/4/2-column grid with 20px media | Title clamp is the main problem (see below). On /promo, "Paket hemat" lists the same 24 products as page 1 of "Semua produk". |
| /kategori | authored, but inconsistent | none (shop.com page was not capturable) | It uses lavender tiles with a white inset photo square, while the home grid uses per-department tints with a tilted photo. Kecantikan also has a different photo on each (trimmer vs heel file). Use one tile component and one photo choice. |
| PDP | authored | shop.com buy box, 52px pill button, chevron accordions | Matches the contract. The empty "Spesifikasi" section is an accepted deviation. |
| Cart | authored | 20px white summary card, 52px checkout pill | Matches. |
| Help | authored | help.shop.app centred column with 2-up topic cards | Matches. |
| /masuk error | authored | centred 20px card | Matches. Focus sits on the alert as intended. |
| Placeholder pages | authored | shop.com centred empty state | Matches. |
| Mobile dock | authored | shop.com active pill indicator | Matches (`cart-filled-390-03` shows the active tab and the count badge). |

## Findings, most important first

1. **Card titles truncate to one line, so products can't be compared.** In `category-1024-01`, three cards read "Gendes Sweet Aro…". The 320 capture, where titles are not clamped, shows they are Vanilla, Grape and Coco Pandan (`category-320-text200-05/06`). At 390, search titles cut at about 20 characters ("Paket Borongan Solusi …", `search-390-01`). This is shop.com's one-line rule applied 1:1, but shop.com titles are short and sit under a vendor line. 99ribu names are long and nearly all start with "Paket", and the user's job is to compare options. This brings back the problem rounds 13–15 fixed. Fix: two lines from 701px up, three on phones, and keep the subgrid so prices stay aligned.
2. **Category tile names break inside words** at 768 and at 320/200%, listed above. This undoes the round-10 em-based minimum width. It hurts readability and the 200%-text baseline invariant.
3. **No cart in the header at 768.** Cart, Promo and Akun are visible at 1024 and above. At 768 only Promo and Akun render, and the dock is hidden above 700px, so this is a navigation hole for the main task.
4. **The hero price breaks inside the number at 320/200%.** The builder accepted this, but "Rp99.0 / 00" splits the brand's one claim and reads as a different amount.
5. **Two category tile treatments for the same content** (/kategori vs the home grid), with different photos per department.
6. **Pill imagery.** The photos are illegible at 36px, and some pills render empty with no tint fallback.
7. **/promo content.** "Paket hemat" shows the same products as the catalog, and "hemat" ("saving") has no comparison behind it. The header Promo icon leads to a page with no promotion. Either show the icon only when a shipping promotion is active, or rename the section "Paket campuran".
8. **Minor:**
   - The omnibox splits "Ibu & Anak" into the separate suggestions "Ibu" and "Anak", which are weak queries.
   - At 320/200%, footer links stack with no visible gap between them.

No template signals found: no dark hero, no eyebrow pills, no `A · B` labels, and no placeholder stats. Claims stay plain: "Data contoh", "simulasi lokal".

## Evidence vs references

- **Hierarchy and rhythm:** shop.com home at 1440 and 390 (`56ae2fb…-01/02`, `44fc7af…-01..03`) runs pills → value card → Categories → switcher → shelf. Our `894181…-01` and `b2fa7d…-01..03` follow the same order with about 48px between sections, with justified skips (stores, editorial) and no invented sections.
- **Imagery:** shop.com's category tiles use bespoke colour art. Ours use white-ground product photos on a tint, which the contract justifies. The cost is weak legibility at small sizes (pills) and at 768 (tiles).
- **Density:** the shop.com grid (`c8a1c9…`) carries vendor, title, rating and price. Ours carries title and price only, so the title has to do all the identifying, and one line is not enough.
- **Reference gaps:** the populated cart, checkout, receipt and category pages have no shop.com reference. The multi-option PDP pills are still UNVERIFIED for lack of data, so this review does not cover them.
- **Not counted as defects:** `pills-focus-320-text200-01` shows the dock directly under the pill row, which looks like a capture artifact. The empty pill circles appear in only one of several captures, so they may depend on load timing; the missing tint fallback is real either way.

Most important change: on every listing and shelf, let product titles wrap to two lines (three on phones) instead of one, so customers can tell same-family "Paket …" options apart.

Verdict: REVISE