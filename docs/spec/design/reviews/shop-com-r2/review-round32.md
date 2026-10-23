Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/category-1024.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/footer-390.png, docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png, docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-1920.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-closed-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-privasi-1440.png, docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/promo-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1920.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 041ae6889ca16885
Images-SHA: 2ce087a33dc14736
Output-SHA: ddd84fee97917d0d

Saya sudah membuka ke-118 gambar, termasuk capture referensi shop.com. Ini hanya review read-only, tidak ada file proyek yang diubah. Hasilnya REVISE karena satu temuan material: tombol utama hero di beranda. Detail lengkap ada di `/home/ongki/.claude/plans/you-review-a-web-crispy-hoare.md`.

## Section lines

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Env banner | authored | none (99ribu-specific) | none; the short 320 form "Data contoh: simulasi lokal." fits one line |
| Header + omnibox | authored | shop.com omnibox (white pill, round purple submit, glass suggestion panel) | none material; "Cari prod..." truncation at 320/200% is the accepted single-line field |
| Category pill row | authored | shop.com pills | none material; focus ring clears the gutter at 320/200%, current pill underlined on `/kategori/kecantikan` |
| Hero | composition authored, actions not | shop.com "Shop is all about you" card | make "Lihat produk" the filled primary for every visitor; rename "Cara belanja" |
| Kategori grid | authored | shop.com Categories (5/3/2 columns) | none; the curated tilted photo cards match across home, `/kategori` and the pills |
| Terbaru shelf | authored | shop.com department shelf | none; 7 whole cards at 1440, 4.6 at 768, 2.3 with bleed on phones |
| Category switcher | authored | shop.com switcher | below 1024px, use the 42px phone scale (or about 64px) so a readable second name peeks in |
| Listing (search/kategori) | authored | shop.com Results grid (6/4/2 columns) | none material; the filter panel and claim photos are accepted deviations |
| PDP | authored | shop.com buy box + chevron accordions | none in layout; one photo for a multi-item bundle is on the accepted backlog |
| Cart | authored | R7 contract | none |
| Help | authored | help.shop.app centred column with 2-up cards | covered by the "Cara belanja" label fix |
| /masuk error | authored | centred raised card | none; the alert takes focus (purple ring), invalid fields get an error edge, "Batal" is a quiet action |
| Promo | authored | shop.com section rhythm | none |
| Placeholder pages | authored | shop.com centred empty state | none |
| Footer | authored | shop.com footer columns | none; 2 columns on phones and 1 column at 320/200% render cleanly |
| Mobile dock | authored | shop.com active pill, recoloured lavender | none |

## Findings

1. **The hero's main button works against the buyer's task.**
   - **What's on screen:** the heading and body sell price and payment methods ("Semua Rp99.000", "Bayar transfer, VA/QRIS, atau COD"), but the only filled button is "Masuk".
   - **Why the reference doesn't apply:** shop.com's "Sign in" fits its own copy ("All your carts… in one spot"). The 99ribu `/masuk` card itself says "Belanja tetap bisa tanpa akun", so sign-in is optional here.
   - **Consequence:** the strongest button on the page leads to an optional step instead of to products.
   - **Evidence:** `a8d673abbe3c074a-hero-1440-01`, `4945012a13379fb6-hero-390-01`, `894181cd6f0102a7-home-1440-01` and `f0b455b1e4cd9679-masuk-error-390-02`.
   - **Fix:** make "Lihat produk" (to `/cari`) the primary for every visitor. Sign-in stays in the header and the dock.

2. **"Cara belanja" promises a page that doesn't exist.**
   - **What's on screen:** the hero secondary button and the footer link both say "Cara belanja" and go to `/bantuan`. That page (`603301b60cad0c85-help-1440-01`) has no ordering steps, only Ongkir, Pengembalian (not yet published), Privasi and chat.
   - **Precedent:** in round 4 the builder renamed that page's heading to "Bantuan belanja" for exactly this reason.
   - **Fix:** label the links to match where they go, for example "Bantuan belanja".

3. **The switcher looks broken at 768.**
   - **What's on screen:** in `fd8b8d79ef3ae725-home-768-02`, the 96px "Kecantikan" fills the row. The next tab shows only as a thin grey bar at the fade edge, which reads as a rendering glitch rather than a cue that the row scrolls.
   - **Fix:** use the phone label size or an intermediate one below 1024px.

**Accepted deviations I saw but did not reopen:**
- Claim photos still lead the first screen of `/kategori/kecantikan` and `/cari`: the Antabur before/after, "Wajah Glow Up" and Korset Pelangsing.
- `bc2effc755f453fb-pdp-1440-01`: the 4-item bundle PDP shows only the saving-box photo.
- The PDP's empty "Spesifikasi" section.
- The ~270px gap in the 1440 cart.

## Reference transfer

| Principle | Assessment | Images |
|---|---|---|
| Hierarchy | Matches: 64/800 hero heading, 20/600 section headings with a chevron, one-line 14/600 card titles | `56ae2fb14286102a-2026-10-23-home-1440-full-01/02` |
| Rhythm | Matches: sections about 48px apart, shelf density and switcher geometry | `56ae2fb14286102a-2026-10-23-home-1440-full-01/02` |
| Imagery | Justified deviation: shop.com uses full-bleed art tiles, we use a tint plus a framed product photo because our photos are on white backgrounds | `56ae2fb14286102a-2026-10-23-home-1440-full-02`, `65e1c0b38c6b3e91-categories-1440-01`, `c6d3322bc7bb7f8a-home-categories-1440-01` |
| Density | Matches shop.com: 6 listing columns at 1440 and 2 on phones | `c8a1c9a03f2c268b-2026-10-22-search-1440-01`, `488cca110d71e931-2026-10-22-search-390-01` |

No template signals: no eyebrow pills, no monospace labels, no accent-coloured headline word, no rows of icon-tile cards. The research and the transfer rationale are documented per section.

Most important change: make "Lihat produk" the hero's filled primary action for every visitor, because the hero copy sells price and checkout and buying needs no account.
Verdict: REVISE