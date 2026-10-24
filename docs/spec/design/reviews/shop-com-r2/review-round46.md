Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/banners-1440.png, docs/spec/design/renders/shop-com-r2-20261022/banners-390.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1440.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-mid-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/dock-home-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/filter-nojs-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-pop-1440-dpr2.png, docs/spec/design/renders/shop-com-r2-20261022/filter-sheet-390.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-appended-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-more-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-skeleton-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-focused-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: fb15ac33b0d32495
Images-SHA: e2c47d986898c7e0
Output-SHA: 8aa6eb24a3e33249

Paduka Ongki, saya sudah membuka ke-115 render. Hasilnya **REVISE**. Ada tiga cacat yang terlihat jelas, rinciannya di bawah. Review ini cuma visual, tidak ada file repo yang saya ubah.

**Section lines (home, top to bottom, then other pages)**

- Env banner "Data contoh…" | authored | none | No change. It shortens properly at 320.
- Header (wordmark, centred omnibox, Promo/Cart/Account) | authored | shop.com omnibox pill, R2 | At 320/200%, scale the submit arrow with the field text and keep the button a circle. Right now it is a tall purple capsule with a ~12px arrow next to a ~40px search icon (`f9ad8c3bad0b98a7-home-320-text200-01`, `90075c5f3ef47823-category-320-text200-01`). It reads as a broken control.
- Wordmark reveal | authored | owner brief | No change. "Serba 99ribu." keeps the omnibox fixed (`c22573c4…`, `5dce9521…`).
- Category pills | authored | shop.com pills, R3 | No change. The focus ring is unclipped at 1440 and at 320/200 (`60c6b1bb…`, `59c9acdb…`).
- Omnibox open | authored | shop.com open state, chip variant | No change needed. One glass surface, no inner pill. The "kac" and "ru" bold matches and the "Cari "…"" chip read clearly.
- Hero | familiar but justified | shop.com value card | No change. The heading stays "Semua / Rp99.000" at every width. The photos are the curated six, not repeats of the tiles.
- Kategori grid | authored | shop.com "Categories ›" tiles | No change. Tint plus a dark label plus a tilted photo card works on white-ground photos. Labels wrap between words.
- Terbaru shelf | familiar but justified | shop.com product carousel | No change. The cut card at 390 cues the scroll.
- Category switcher | authored | shop.com switcher | No change. The medallion above the name keeps the name legible.
- **Promo banner "Paket hemat"** | generic | shop.com "Discover" rail, loosely | Rename it to match its destination ("Paket campuran") and use photos that are not department picks. Two problems:
  - "hemat" is a saving claim with no visible source. Round 21 dropped that exact wording, and `/promo` titles the same content "Paket campuran" (`b651564a…`).
  - The three photos are the Dapur knives, Perkakas pliers and Fashion Pria T-shirt already shown in the Kategori grid one screen up. The knives also appear in the Terbaru/listing grid. The banner reads as a third repeat of the category tiles, not as a bundle offer (`047b8bc5…`, `e2c982bd…`, `894181cd…-02`).
- Footer | familiar but justified | shop.com columned footer, R9 | No change. It drops to one column at 320/200%.
- Mobile dock | authored | shop.com bar | No change. On `/cari` no tab is active because there is no search tab. Acceptable.
- Search/listing (chips, grid, skeleton, "Lihat produk lainnya") | familiar but justified | shop.com search | Give "Lihat produk lainnya" the R3 white hairline pill. It is currently purple-outlined, a treatment that appears nowhere else in the storefront chips (`1c2f076a…`).
- Filter dropdown and sheet | authored | owner brief (shadcn Select, bottom sheet) | Drop the separator after "Paling sesuai" in the Urutkan sheet. That separator only makes sense after an "all" choice, and sort has none (`fe9e5b79…-02`). Desktop placement and the active chip with its joined × are clean (`c87e94a1…`, `cc9e42a2…`).
- No-JS filter | authored | R4 | No change (`7af5e50b…`).
- **PDP buy box** | familiar but justified | shop.com PDP | Hide "Spesifikasi" when it is empty, or fold it into the accordion list. Right now the heading plus "Spesifikasi tambahan belum tersedia." sits between the CTA and the hairline accordions with no divider or chevron. It breaks the accordion rhythm and adds nothing (`bc2effc7…`, `5246c805…-02`, `b6b3ad67…-03`).
- PDP media | familiar but justified | shop.com white media panel | Not counted against this gate: a 4-item bundle shows only the saving-box photo, which is known owner/feature scope. The empty canvas under the media is the sticky-capture artifact already explained.
- Cart (filled) | authored | R7 | Optional: "Perbarui jumlah" uses the same purple-outline variant as the listing button. Unify it with the secondary pill if that variant is not intentional.
- Promo page | familiar but justified | R12 | No change beyond the banner naming above.
- Category 320/200% | authored | R5 one-column fallback | No change. Full titles show and the chip row clips with a fade. The claim photos are on the accepted backlog.

**How the renders compare to the shop.com references**

I opened the reference captures in the set: home 1440/390 (2026-10-23 and the shelf variant), search 1440/390, the filter sheet, PDP 1440/390/scrolled, empty cart 1440/390, and help 1440/390.

- **Hierarchy and rhythm carry over well.** The off-white canvas with raised white surfaces, the 20px card frames, the 14/600 one-line titles, the centred omnibox and the pill row match. Home order follows the 2026-10-23 composition: pills, value card, Categories ›, shelf, switcher, editorial, footer.
- **Imagery.** Merchant photos with text are accepted content. Where 99ribu curates imagery itself (hero, tiles, pills), it is cleaner than the catalog. The banner is the one curated spot that falls short: shop.com's editorial cards are full-bleed lifestyle photos with the caption overlaid, while ours are three equal white product squares that repeat the tiles.
- **Density at 320/200%** holds everywhere except the omnibox submit button.

**Evidence gaps.** These are missing from the list, not visual defects:
- No 99ribu `/bantuan` render, even though the help reference is included, so R11 is not re-verified here.
- No empty cart at 1440 (only the 390 dock-cart shot), and no `/promo` at 390.
- `dock-320-text200` shows the top of the page, so it does not show the dock (it is static under the short-viewport rule).

Most important change: rename the home "Paket hemat" banner to match its destination and fill it with bundle photos that are not the department picks, so it stops making an unsourced saving claim and stops repeating the category grid.

Verdict: REVISE