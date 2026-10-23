Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/favicon-sheet.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: e2a64b52d0122ab2
Images-SHA: 3678016dde181920
Output-SHA: f861b6f0e462a2c9

Paduka Ongki, semua 123 gambar sudah saya buka satu per satu: 101 render 99ribu dan 22 referensi shop.com. Hampir semua bagian sudah matang dan sesuai kontrak. Ada satu cacat tampilan yang masih kelihatan di render teks besar, jadi verdict-nya REVISE. Reviewnya di bawah dalam bahasa Inggris (output teknis).

---

**Section review (top to bottom)**

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Environment banner | authored | none (local requirement) | none. It shortens correctly to "Data contoh: simulasi lokal." at 320. |
| Header + omnibox (closed) | authored | shop.com omnibox pill (`95bdbd…-1440-01`) | none. The white pill with the round purple submit is centred, and the Promo/Cart/Account icons take a lavender fill on their current page (`b651…promo-1440`, `4567…cart-filled-1440`). |
| Omnibox open / typing | authored | shop.com glass suggestions panel | none. "Saran pencarian" rows, the bold match on "Sa**ru**ng"/"B**ru**sh" and the final "Cari “ru”" row read cleanly (`3e26…typing-1440`). The cut fifth row in `83cc…opening-390` is a mid-transition frame. |
| Category pill row | authored | shop.com photo pills (`56ae…home-1440-full-01`) | none. The current pill gets a lavender fill (`0139…category-1024-01`), and the focus ring is unclipped (`60c6…pills-focus-1440`). |
| Home hero | authored | shop.com "Shop is all about you" card | none. The tilted collage of six non-department product photos sits on the lavender/yellow tint. Copy is bottom-weighted like the reference. "Rp99.000" stays whole at 320/200%. |
| Home "Kategori ›" grid | authored (accepted deviation) | shop.com Categories tiles, re-done as tint plus tilted photo card | none. It shows 10, 9 or 6 tiles in whole rows at 1440, 768 and 390. "& Minuman" keeps the ampersand bound to the next word. |
| "Terbaru ›" shelf | authored | shop.com department shelf | none. 7 whole cards at 1440, about 4.6 at 768 and about 2.3 bleeding at 390, matching the measured reference. |
| Category switcher | authored | shop.com switcher (`56ae…-02`) | Minor: at 1440 "Kecantikan" starts at about x=215 rather than the 95px content edge or the centre, so the strip floats between alignments. Align the first label to the content start (keep the fade outside it), or centre the selection like the reference. |
| Listing (search/category) + filter panel | authored | shop.com search grid + filter sheet | none. Six columns at 1440/1024 and two at 390, with a flat 20px filter panel (selects four across, Apply/Reset pills). At 320/200% the grid becomes one column with full titles. |
| `/kategori` index | authored | same tile system as home | none. All 14 departments show; the grid icon is current. |
| PDP buy box + accordions | authored | shop.com PDP (`c9ed…pdp-1440`) | none. Title, price, contents, stock, quantity pill, full-width 52px "Tambah ke keranjang" and chevron accordions between hairlines. The bundle "Sembunyikan barang lainnya" disclosure works. |
| PDP media panel | authored | shop.com white media panel | Minor: in `bc2e…pdp-1440` the product fills about 25% of a 740px white panel (merchant photo margins), so the page's largest element reads empty next to the reference's filled panel. Consider capping the panel near 34rem on desktop; cropping was rightly dropped because it cut merchant text. |
| Empty cart | authored | shop.com empty cart (`f256…`, `9f3f…`) | none. Centred heading, one line of text and one filled pill. |
| Filled cart | authored | R7 contract (no reference capture possible) | none. Unboxed line, disc-bullet contents, white 20px summary with a 52px checkout pill. At 390 "Hapus" sits on its own row (recorded). |
| Help | authored | help.shop.app (`27b2…`, `6c37…`) | none. 45rem column, top-aligned 2-up topic cards and a white chat card with sentence-case pills. |
| `/masuk` error | authored | no shop.com reference (follows the help card) | none on layout. The focused alert gets a purple focus ring around a red panel; acceptable as a focus indicator. |
| Promo | authored | no shop.com `/offers` capture | none on layout. Bundles come first, then the plain "Belum ada promo ongkir aktif." sentence. |
| Placeholder `/tentang` | authored | shop.com empty-state pattern | none. |
| Footer | authored | shop.com footer (`95bd…`, `24f5…`) | Minor: on phones the 44px link rows make the footer about 700px at 390 and over two screens at 320/200%, while the reference is about 30px per row. The target size is a deliberate accessibility choice, so this is noted, not failed. |
| Mobile dock | authored | shop.com bottom bar with active pill | **Material, see below.** |
| Brand icons | authored | none (own monogram) | none. The "99." reads at 16px (`69da…favicon-sheet`). |

**Finding (material)**
- `59c9acdb10d05d04-pills-focus-320-text200-01.png`: at 320px with 200% text, the first screen shows the logo, the search, one pill, then the two-row, four-tab dock filling the lower ~40% of the 522px frame. No hero or product content is visible.
  - Consequence: an enlarged-text user's first screen is navigation only, which hurts task clarity and responsive behaviour.
  - The round-22 reply says the short-viewport rule makes the dock static "in the page flow right under the header." That ordering is the problem: a static dock should come after the main content, not before it.
  - The same build's tall-viewport capture (`f9ad…home-320-text200-05/06`) shows the dock at the document end. That confirms the bad state only appears in the short-viewport case this frame captures.
  - Fix: under the `max-height: 38rem` rule, render or order the static dock after `main` (or after the footer). Then measure `getBoundingClientRect().top` of the hero at 320×522 with a 32px default font.

**Evidence and reference comparison**
- Inspected all listed slices, including the 16 category-320 slices, the 6 PDP-320 slices (slice 06 is an empty 8px capture strip, not a page defect) and every reference.
- **Hierarchy:**
  - Home order is pills → hero → categories → shelf → switcher → footer, and it maps 1:1 to the reference's loaded sections. Store carousels and editorial sections are correctly skipped for lack of data.
  - The type rhythm matches the measured reference: 14/18 titles, 12/16 prices, 20px section headings and 96/42px switcher labels.
- **Imagery:**
  - 99ribu has no art-directed lifestyle shots, so the tint plus tilted-photo-card substitution is justified and consistent across tiles, pills and medallions.
  - Merchant photos with claims and text (Antabur, Gendes, Bright Glow, "Wajah Glow Up") still appear in category and search listings. These are accepted owner content and stay out of scope here.
- **Density:**
  - Listing grids match shop.com's six columns at desktop and two at phone, with the 8–12px gaps.
  - Accepted deviations stay as recorded: one-line card titles, native selects, the 1250px cap and the medallion placed above the label.
- **Research gaps (rationale, not defects):**
  - No shop.com capture backs `/masuk`, `/promo` or the filled cart.
  - R3/R6 option pills still cannot be verified, because no published product has more than one option.

Most important change: in the short-viewport, enlarged-text state, place the static mobile dock after the main content, so the first screen at 320px/200% shows the page instead of four navigation tabs.

Verdict: REVISE