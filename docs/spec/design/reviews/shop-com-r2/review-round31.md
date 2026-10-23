Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-1920.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-closed-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-privasi-1440.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1920.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: a98ca2f50299cc2a
Images-SHA: 3d46e6ae345f903d
Output-SHA: bf028c9152846762

Paduka Ongki, saya sudah membuka ke-121 slice. Hasilnya **REVISE**: ada satu masalah material dan dua yang kecil. Tidak ada file yang saya ubah; ringkasan review dan rencana perbaikan ada di `/home/ongki/.claude/plans/you-review-a-web-parsed-flask.md`.

**Per section, top to bottom**

- Environment banner | authored | none (99ribu-specific) | at 320/200% the long sentence still renders across 3 lines although `src/app/globals.css:196` (`max-width: 359px`) should swap in "Data contoh: simulasi lokal."; recapture from the current build or fix the rule.
- Header and omnibox | authored | shop.com omnibox (512px pill, soft shadow, 44px purple submit) | none material; the open "Saran pencarian" glass panel (1440/390) and the typing filter ("ru" → Rumah Tangga) match `2026-10-23-omnibox-open-1440`.
- Category pills | authored | shop.com pill row (36px photo circle, 16/20 600) | none; the focus ring is unclipped at 1440 and at 320/200%, and the cut "Rumah T…" at 390 signals the scroll.
- Hero | authored | shop.com value card (36px radius, bottom-left copy, 2-up phone actions) | the gloves tile overlaps the teapot tile's lower edge at 1440/1920; nudge it so each product reads whole. Not blocking.
- Kategori grid | authored | shop.com "Categories ›" (5/2 columns, short tinted tiles) | none; the curated photos show whole, and "& Elektronik" stays bound to its word at every width.
- Terbaru shelf | authored | shop.com department shelf (7 cards at 1440, 2.3 at 390 bleeding to the edge) | none; prices align and the scroll cue is visible.
- Category switcher | authored | shop.com switcher (96/800 label, medallion, edge fade) | the Kecantikan panel shows 3× Gendes + Bright Glow, all on the compliance backlog; the contract says the switcher leaves them out.
- Search / category listing | authored | shop.com Results grid (6 columns at 1024 and up, 2 on phones, 20px media) | the open filter panel pushes the grid to y≈585 at 1440; this is the accepted R4 deviation, no change.
- `/kategori` | authored | the same tile treatment as home | none.
- PDP | authored | shop.com buy box (narrow column, 52px pill, hairline accordions) | the small merchant photo floating in the 740px panel is merchant content; no layout fix.
- Cart | authored | R7 (unboxed line, 20px summary card, 52px checkout pill) | none.
- `/masuk` error | authored | centred card like the help topic cards | none; the alert and the invalid fields read clearly at 390.
- Help | authored | help.shop.app (~720px column, 2-up topic cards, chat card at the end) | none.
- Promo | authored | standard grid | none.
- Placeholder pages | authored | R8 centred empty state | none.
- Footer | authored | shop.com columned footer | at 320/200% the wrapped "Perkakas & / Elektronik" sits flush on "Cari produk", so one link reads as two; restore the 0.5em row gap in the one-column case.
- Mobile dock | authored | shop.com floating dock with a lavender active pill | none.

**Evidence and transfer**

The reference captures I inspected: `56ae2fb…-home-1440-full-01..03`, `44fc7af…-home-390-full-01..02` (the third to fifth 390 home slices were not opened), `c8a1c9a…-search-1440`, `488cca1…-search-390`, `bbf0d8a…-search-filters-390`, `c9edea8…-pdp-1440`, `52a31a5…/2d2dc59…-pdp-390`, the empty cart (`f256…`, `9f3f…`), help (`27b2…`, `6c37…`) and the older home (`95bd…`, `24f5…`).

The transferred principles hold:
- One near-white canvas with white raised surfaces.
- A 20px-radius media rhythm.
- 14/18 titles and 12/16 prices.
- The pill/tile/shelf/switcher order.
- Flat footer columns.

What shop.com does but 99ribu skips (trending stores, editorial collections, ratings, Save/Share) is documented as having no data, which is a sound reason. I found no template signals: no dark hero, no eyebrow pills, no icon-tile card rows, no unsourced stats.

**Why the switcher finding is material**

`src/modules/storefront/department-photos.ts:82` matches `glowing` but not `Glow`, and the Gendes photo hashes are not in `CLAIM_PHOTOS`. So `homeSafe` lets four backlog products into a curated editorial block. Because titles are one line, the three Gendes cards also look like duplicates in the first switcher panel. That hurts brand fit and task clarity, and it breaks a stated contract rule rather than an accepted deviation.

The plan file lists the fix: extend `homeSafe`, add the footer gap, then rebuild, recapture and run a new review round. I'll implement it only if you approve.

Most important change: extend `homeSafe` so the home switcher's Kecantikan panel drops the Gendes and Bright Glow products, as the contract requires.

Verdict: REVISE