Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/banners-1440.png, docs/spec/design/renders/shop-com-r2-20261022/banners-390.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1440.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-mid-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-home-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/filter-nojs-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-pop-1440-dpr2.png, docs/spec/design/renders/shop-com-r2-20261022/filter-sheet-390.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-appended-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-more-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-skeleton-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-focused-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: d5e6756aede37176
Images-SHA: 7c11bc74dd3538cf
Output-SHA: f28daa952b326154

Paduka Ongki, saya sudah membuka ke-116 slice: semua render 99ribu dan semua slice referensi shop.com. Verdict saya REVISE, tapi sempit: ada satu state yang diklaim tanpa bukti visual, plus dua catatan kecil. Review lengkap di bawah dalam bahasa Inggris.

## Per-section lines

**Home (top to bottom)**
- Env banner | authored | none | Fine. The 320 short copy ("Data contoh: simulasi lokal.") fits on one line. No fix.
- Desktop header | authored | shop.com 512×64 white omnibox, soft shadow | No fix. The "Serb" clip in `brand-hover-mid-1440` is a mid-transition frame, and `brand-hover-1440` resolves to "Serba 99ribu.".
- Phone header | authored (owner override) | shop.com 390 full-width search | No fix.
- Category pills | authored | shop.com 36px photo-circle pills | No fix. The 320/200% focus ring wraps the whole pill and is not clipped (`pills-focus-320-text200-01`).
- Hero | authored adaptation | shop.com "Shop is all about you" card | At 320/200% the heading is capped by vw at about 40px. The body text is about 32px and runs 6 lines, so the "Semua Rp99.000" headline barely outranks it. Raise the cap to about `min(3.25rem, 16vw)`; "Rp99.000" at weight 800 still fits the 256px measure.
- Kategori grid | authored | shop.com Categories 5×2 tiles | Tint + left label + tilted white photo card is a recorded, justified adaptation for white-ground photos. No fix.
- Terbaru shelf | reference-faithful | shop.com product carousel (7 cards at 1440, 2.3 on phones) | One-line titles are an accepted owner decision. No fix.
- Category switcher | authored transfer | shop.com 96/42px switcher with medallion | Edge fade and faded neighbours match `2026-10-23-home-1440-full-02`. No fix.
- "Temukan pilihan" rail | authored | shop.com "Discover something you love" | Caption below on white and the 20px heading are accepted coordinator decisions. At 390 and at 320/200% the next card peeks. No fix.
- Footer | matched | shop.com columned white footer | No fix.
- Mobile dock | matched | shop.com floating bar, filled active icon | The static short-viewport state is not shown (see Evidence). Recapture it.

**Listing, search, filters**
- Heading + chip row | matched | shop.com chip row (we put the H1 above the chips) | Active chips are filled ink with a joined × and "Hapus semua" (`filter-active-1440`). No fix.
- Desktop dropdown | authored (shadcn Select) | owner brief | Whole-pixel placement, a separator after "Semua pilihan", the check on the selected item (`filter-pop-1440-dpr2`). No fix.
- Phone sheet | matched | shop.com 28px-radius bottom sheet with 40% scrim | No fix.
- No-JS form | authored | none | No fix. The native selects are intentionally kept.
- Grid, skeleton and "Lihat produk lainnya" | matched | shop.com 6-column, 2-column grid | The skeleton reuses the card frame, and the white hairline pill leaves the footer reachable. No fix.

**Other pages**
- PDP | matched | shop.com narrow buy box, 52px primary, chevron accordions | Within the 740px white panel, the merchant photo occupies roughly a quarter of the area (`pdp-1440-01`). The shop.com boot fills about 70% of its panel. The fix is to trim uniform near-white borders when the image variants are generated. A fixed-inset crop is not the answer: that cut merchant text in round 30. Non-blocking.
- Bundle PDP (open) | matched | none | The empty canvas under the media is the documented sticky-capture artifact. No fix.
- Empty cart | matched | shop.com centred empty cart with one primary action | No fix.
- Filled cart | authored | none (no reference) | Unboxed line, white 20px summary card, 52px CTA. No fix.
- Help | matched | help.shop.app ~720px column with 2-up cards | Two secondary-button styles share the page: a purple outline inside chat, a white pill for "Kembali". This is the accepted CustomerChatView deviation; it should move to R3 when that component's owner gets to it.
- Promo | authored | none | No fix.
- Omnibox open | matched | shop.com one growing glass surface with chips | The pills ghosting through the glass are in the accepted backlog. No fix.

## Evidence and observations

**Images.** I opened all 116 listed images: the renders plus the shop.com reference slices `f256…`, `9f3f…`, `27b2…`, `6c37…`, `95bd…`, `24f5…` and the dated `2026-10-22-*` and `2026-10-23-*` slices.

**Blocking: the static-dock state is not in its render.**
- `236d9279e969a940-dock-320-text200-01.png` is cited as "scrolled to the dock: static after the page content". The slice shows only the banner card at 200%, with no dock anywhere in frame.
- The other 320/200% captures show the dock at the end of the page (`home-320-text200-07`, `category-320-text200-15`) or overlapping the footer's "99ribu" heading (`footer-320-text200-02`). Those match fixed mode in a tall full-page viewport, not the static mode that sits between `main` and the footer.
- So the static short-viewport composition has no visual proof yet.

**No template signals.**
- No dark hero, accent-coloured headline word, eyebrow labels, icon-tile card rows, monospace, separator-glyph labels or unsourced stats.
- The UI copy makes no "resmi" or "terpercaya" claims. Merchant-photo claims are explicitly out of scope.
- The page is clearly about this business: the fixed price Rp99.000, "pilihan lengkap" bundles with contents lists, and the transfer/VA/QRIS/COD line in the hero.

**Transfer against the references.**
- Hierarchy, rhythm and density follow the 2026-10-23 home captures: pills, then hero card, then a tiled category grid, then a shelf, then the giant switcher, then the photo rail, then the columned footer.
- The card frame, the chip system and the PDP buy-box order also match.
- Each deviation is recorded with a reason: tinted tiles because the photos are white-ground, caption below the banner, logo-less phone header, a pill quantity input instead of a stepper.
- The research is documented. Category, checkout and receipt pages had no inspectable reference, and they keep their accepted S26/S27 compositions.

Most important change: recapture the 320/200% short-viewport page with the static dock actually in frame (between the last `main` section and the footer), so that responsive state has visual proof.

Verdict: REVISE

(Narrow: the only blocker is the missing proof for that one state. The hero heading cap at 320/200% and the PDP photo fill are non-blocking. Everything else holds against the contract and the references.)