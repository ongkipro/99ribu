Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-1920.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-closed-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-privasi-1440.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1920.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 3a37eab660f6c35e
Images-SHA: bb4f8b511f4c57b8
Output-SHA: 273f2ae59a394674

Paduka Ongki, saya sudah buka dan cek ke-120 gambar, termasuk referensi shop.com (empty cart, help, home 10-22/10-23, PDP, search, filter sheet). Hasilnya REVISE: ada satu masalah komposisi yang jelas, dua masalah gambar/konten, dan beberapa poles kecil. Tidak ada file repo yang saya ubah.

## Per section (top to bottom)

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Environment banner | authored | none (99ribu-only) | None needed. It wraps cleanly to 3 lines at 320/200%. |
| Header and omnibox | authored | shop.com glass omnibox pill with a round purple submit (`omnibox-suggestions-1440`, `omnibox-typing-1440`) | Fine. At 320/200% the placeholder truncates to "Cari prod…", which was accepted in round 26. |
| Category pills | authored | shop.com pill row with photo circles and a grid link (`2026-10-23-home-1440-full-01`) | The current state (ink ring plus underline in `category-1024-01`, focus ring in `pills-focus-1440`) is clear. No fix. |
| Home hero | authored | shop.com "Shop is all about you" card: copy at bottom-left, floating tiles, Sign in plus secondary pill | Fine at 1440/768/390/320. "Rp99.000" stays whole and the signed-in state reads "Lihat produk". |
| Kategori grid | authored | shop.com "Categories ›" grid (5/2 columns) in a pastel tint with a tilted photo card instead of full-bleed art | Deviation justified (photos on white ground). No fix. |
| Terbaru shelf | authored | shop.com department shelf: 7 cards at 1440, 2.3 cards with bleed on phone | At 1440/1920 no cut card shows at rest, so the row looks finished. The scroll cue depends on hover arrows. Optional. |
| **Category switcher** | authored, but the composition is broken | shop.com wordmark switcher | **The left half is empty when the page loads** (see Finding 1). |
| Switcher panel shelf | authored | shop.com Beauty shelf | Fine. |
| Footer | authored | shop.com columned footer (same rhythm and headings) | At 320/200% a wrapped link ("Perkakas & / Elektronik") looks like two links because the gap between links ≈ the leading. Increase the link gap at enlarged text. |
| Mobile dock | authored | shop.com bottom bar with the active-pill indicator | Fine. |
| Listing (`/cari`, `/kategori/…`) | authored | shop.com Results grid (6 columns at desktop, 2 on phone, 20px media radius) | Content: product claims are visible (Finding 3). Layout is fine. |
| Filter panel | authored | partly matches the shop.com chip row and sheet. Native selects are an accepted deviation. | `/kategori/kecantikan` shows "Kecantikan" three times (current pill, "Kategori: Kecantikan ×" chip, Kategori select). Hide the chip on the category route, because the route itself is the filter. |
| `/kategori` index | authored | the same tile component as home | Fine. |
| PDP | authored | shop.com buy box (52px primary, accordions, pill quantity) | **The product photo fills only ~25% of the media panel** (Finding 2). |
| PDP bundle open | authored | shop.com Description accordion | The "Deskripsi" list repeats the "Isi yang diterima" list. This is owner content and is already flagged. |
| Cart filled | authored | shop.com summary card and pill | Fine. The 1440 line thumbnail has the same small-product problem as the PDP. |
| Help | authored | help.shop.app: centred column, 2-up topic cards, chat at the bottom | Fine. |
| `/masuk` error | authored | centred 20px card | Fine. Focus lands on the alert (purple ring is visible). |
| Promo | authored | standard grid | Fine. The order "Paket campuran" → "Promo ongkir" makes sense. |
| Placeholder pages | authored | shop.com centred empty state | Fine. |

## Findings

1. **The switcher opens with an empty left half (material, builder-owned).** Visible in `home-1440-01` (bottom), `home-1920-01` and `home-768-02`.
   - At 1440 the selected "Kecantikan" is centred, but there is roughly 460px of blank space to its left, and only "Pria" appears, cut off on the right.
   - In the shop.com reference (`2026-10-23-home-1440-full-02`) the selected name has neighbours on both sides ("supplies" | **Beauty** | "Women") because the row loops.
   - Consequence: the 96px label, the loudest type on the page, sits off balance. The block reads as a broken or half-loaded carousel, and the round-28 claim "first/last centre with neighbours visible" does not hold for the first tab.
   - Fix: on the initial load, align the first tab to the gutter (start) and centre only after the user switches. Alternative: render the last 1–2 department names before the first as `aria-hidden`, non-focusable labels.

2. **PDP and cart media are mostly empty white panels (material, fixable in CSS).**
   - In `pdp-1440-01` the power-saver product is about 180px wide inside a ~740px panel. `pdp-390-01` and `pdp-320` look the same, and so does the cart thumbnail in `cart-filled-1440`.
   - The reference boot (`2026-10-22-pdp-1440`) fills about 65% of its panel.
   - Consequence: the strongest purchase cue on the page is a small low-resolution object, and the buy box carries all the visual weight.
   - Fix: give the PDP and cart media the same treatment the tiles already use (cover plus a modest crop scale for photos with large white margins), or pick a larger source width. Do not upscale past the source.

3. **Unsourced claims are visible in listings (content; owner/catalog decision).**
   - `category-1024-01` and `category-320-04` show the Antabur photo ("Kinclong dalam 14 hari", BEFORE/AFTER, "TERBUKTI AMPUH").
   - Names on `/cari` and `/kategori` include "Paket Korset Pelangsing", "Paket Wajah Tirus", "Shampoo Ginseng Anti Botak" and "Wajah Glow Up".
   - Round 28 removed these from home only. They are still first-screen content on the Kecantikan listing.
   - This needs the owner's call: replace the content, or apply the same filter to the listing defaults.

4. **Minor polish:**
   - Footer link gap at 320/200% (see the table above).
   - The redundant category chip on category routes.
   - The one-line "Paket …" titles truncate to near-identical prefixes on `/cari`, e.g. "Paket Perkakas Rumah & D…". This is an accepted owner decision, noted only because of its cost.

## Reference transfer

- **Matches the references:** hierarchy, pill and chip system, omnibox glass, card rhythm (1:1 media at 20px radius, 14/12 type), help column, empty states and footer rhythm all hold against the inspected references.
- **Accepted deviations, rationale on file:** pastel tiles instead of saturated art; native selects; no stores or editorial sections, because the data does not exist.
- **Not transferred:** the switcher's loop. The removal was justified as YAGNI, but the replacement does not keep the composition balanced.
- **Research gap:** category pages had no shop.com reference, so `/kategori/<slug>` was judged against the search reference only.
- **Render artifacts, not defects:** the dock sitting inside the page at 320/200% (short-viewport rule) and labels split across slice boundaries.

**Most important change:** On first load, align the category switcher's first tab to the gutter instead of centring it beside a ~460px empty band, or show the preceding department names as looped neighbours.

**Verdict: REVISE**

This is visual acceptance only, not interaction or accessibility test evidence.