Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/favicon-sheet.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: a299bdd9c97d700f
Images-SHA: 1cbc996813e5f4ac
Output-SHA: aab8919bc6e17021

Paduka Ongki, saya sudah membuka dan memeriksa ke-123 gambar di `design/review-slices/`. Ini review visual saja, tidak ada file yang diubah. Hasilnya **PASS**, dengan dua catatan kecil di lebar 320px dengan teks 200%. Detail review di bawah dalam bahasa Inggris.

## Section review (top to bottom)

| Section | Verdict | Look matched | One concrete fix |
|---|---|---|---|
| Environment banner | authored | none (99ribu-specific) | none; the short "Data contoh: simulasi lokal." form at 320 keeps it on one line |
| Header (brand, centred omnibox, Promo → Cart → Account) | authored | shop.com omnibox pill and rail actions, moved into a header | none; omnibox is centred at 1440/1024/768, and the cart badge sits on the icon (`header-cart-items-1440`) |
| Omnibox open/typing | authored | shop.com glass suggestion panel | none; 576px panel over a blurred page, "Saran pencarian" caption, bold "ru" match plus a "Cari “ru”" row (`omnibox-typing-1440`) |
| Category pill row | authored | shop.com photo-circle pills | none; centred at 1440, scrolls with an end fade at 768/390, ink focus ring unclipped at 320/200% |
| Hero | authored | shop.com "Shop is all about you" value card | none; "Rp99.000" stays whole at 320/200%. The secondary button wraps to two lines with the arrow on line 1, as accepted in round 34 |
| "Kategori ›" grid | authored, deliberate deviation | shop.com Categories tiles, redone as pastel tint plus a tilted white photo card | none; the white-ground photo rationale is recorded. 5×2 at 1440, 3×3 at 768, 2-up at 390, 1-up at 320/200% |
| "Terbaru" shelf | authored | shop.com department shelf | none (owner decision); see the title-truncation note below |
| Category switcher | authored | shop.com trending-categories switcher | none; 96px "Kecantikan" with the next name greyed and faded, medallion above the selected name (recorded deviation) |
| Search / category listing | authored | shop.com search results (6 columns, 20px media, 14/600 title, 12/600 price) | none; the 6-column card rhythm matches `2026-10-22-search-1440` almost exactly |
| Filter panel | authored | R4 in-flow panel (shop.com uses a modal sheet; recorded deviation) | none; one row of four at 1440/1024, closed pill on phones |
| PDP buy box and accordions | authored | shop.com PDP: narrow buy box, 52px primary, hairline accordions with chevrons | at 320/200% the breadcrumb ends line 1 with a hanging "Semua produk /". Keep each separator with the crumb after it |
| PDP bundle (contents disclosure open) | authored | same | none; "Sembunyikan barang lainnya" with an inline chevron, CTA stays in the first screen |
| Cart, empty | authored | shop.com empty cart (heading, one line, one filled pill) | none |
| Cart, filled | authored | R7: unboxed line plus white summary card | none; the 1440 gap and the separate "Hapus" row at 390 are accepted |
| Help | authored | help.shop.app: centred column, 2-up topic cards, support at the end | none; the short "Pengembalian" card is top-aligned, not stretched |
| `/masuk` error | authored | R8 centred card | none; focus ring sits on the alert and fields have the 2px error edge |
| Promo | authored | standard grid | none |
| Placeholder (`/tentang`) | authored | R8 centred recovery state | none |
| Footer | authored | shop.com columned footer | at 320/200% the Legal row's wrapped "Syarat dan / ketentuan" sits only about 10px further from "Kebijakan privasi" than its own line break. Give the Legal list the same enlarged-text 0.5em gap the menus already have |
| Mobile dock | authored | shop.com active-pill indicator | none; lavender pill plus purple label on the current tab |
| Brand icons | authored | none (own monogram) | none; the "99." reads clearly at 16px on both white and grey |

## Evidence and comparison

**Canvas, cards and grids (R1, R4, R5).** The `#fafafa` canvas with white raised media matches the shop.com captures. On search at 1440, our six columns of about 193px with a 20px radius line up with shop.com's six columns of 198px. Price and title sizes are the same. Badges, ratings, vendor line and favourite button are correctly dropped because we have no data for them.

**Home order.** The sequence pills → hero → Kategori → shelf → switcher → footer follows shop.com's order in `2026-10-23-home-1440-full`. It skips "Trending stores", the store carousels and "Discover", which the brief's section map records as having no data. Spacing between sections is a steady ~48px, as in the reference.

**Category tiles.** This is the largest visual departure from the reference. shop.com uses saturated full-bleed tiles with a centred white label; ours use a pastel tint, a dark left label and a tilted photo card. The reason (white-ground merchant photos would put a white label on white) is recorded and holds. The tiles still read as categories, not product cards.

**Switcher.** Size, grey neighbouring names and edge fade match the reference. The medallion sits above the name instead of overlapping it, and that is recorded.

**Empty cart and help.** Both follow their references: a centred heading/line/one filled pill for the cart, and a centred column of 2-up white cards for help. Our phone footer links sit 44px apart versus shop.com's ~30px; that is the deliberate tap-target size.

**Template signals checked.** I found none of these:
- no eyebrow labels, no accent-coloured headline word, no "A · B" labels;
- no row of icon-tile cards and no arrow on every button (only the hero secondary has one);
- no unsourced stats.

The page fits only a fixed-price store; swapping the name would not make it fit another business.

**Accepted items I observed but did not count against the verdict:**
- **Merchant photo claims** ("TERBUKTI AMPUH", before/after, "WAJAH GLOW UP"). These still show in `/kategori/kecantikan` and search listings but are kept out of home, switcher and promo, as decided.
- **One-line card titles.** On `/promo` and the "Terbaru" shelf every title starts with "Paket" and gets cut off before the word that tells products apart ("Paket Borongan Solusi Ru…"). This is the cost of the owner's one-line rule; I'm noting it, not counting it.
- **Plain PDP photos.** The regular PDP photo at 1440 fills only about a quarter of its 740px white panel, because the merchant image has wide white margins and the crop was deliberately removed in round 30.
- **Sticky PDP media.** Full-page shots show an empty left column under the media. That is the full-page capture of a sticky element, not a layout gap.

**Not in this image set, so not judged:**
- the R3/R6 option pills on a multi-option product (no such product exists in the data; still unverified);
- the round-37 wordmark hover renders (`brand-*`), which the brief cites but the image list does not include;
- checkout and receipt.

**Most important change:** keep each PDP breadcrumb separator with the crumb after it, so "/" never ends a line at 320px with 200% text.

**Verdict: PASS**

This is visual acceptance only, not interaction or accessibility test evidence. I also saved a short summary at `/home/ongki/.claude/plans/you-review-a-web-tender-puppy.md`.