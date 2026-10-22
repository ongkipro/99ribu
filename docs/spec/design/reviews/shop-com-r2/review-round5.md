Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 28e4c326d4804ab5
Images-SHA: 1b32d3fb5f6db775
Output-SHA: afaefd097e062137

Paduka Ongki, saya sudah membuka ke-126 gambar, termasuk 21 slice referensi shop.com yang tidak berlabel. Hampir semuanya lolos. Yang tersisa cuma beberapa cacat kecil di lebar 320px dengan teks 200%, plus dua state yang belum ada render-nya. Review di bawah dalam bahasa Inggris karena ini output teknis.

## Section verdicts (top to bottom)

**Shared shell (header, department chips, footer, dock)**
- Header and omnibox | authored | shop.com white pill omnibox, no border, soft shadow, round purple submit (`95bdbd…-1440-01`, `24f5fb…-390-01`) | none needed. At 320/200% the submit grows into a 68px pill and the icon is no longer clipped.
- Department chips | authored | shop.com category pill row, without the avatar thumbnails | none. "Semua produk" gets the charcoal current-page edge on `/search`; Busana and Perawatan stay neutral.
- Footer | authored | shop.com columned footer reduced to one "Bantuan" column (R9) | none. At 320/200% the two links are only ~4px apart visually, but the targets don't touch.
- Mobile dock | authored | shop.com floating rounded dock with the active icon in a pill (R10). Lavender pill, purple label, badge on Keranjang | none. At 320/200% it is a 2×2 static block after the footer and covers nothing.

**Home** (`894181…-1440`, `b2fa7d…-390-01..03`, `fd8b8d…-768-01..03`, `f9ad8c…-320-text200-01..07`)
- Hero ("Pilihan lengkap. Harga tetap.") and fixed-price card | authored | no shop.com equivalent; it is 99ribu's own fixed-price anchor, a yellow card holding "Rp99.000" and "Dua pilihan Rp198.000 sebelum ongkir" | the H1 (~28px) is still visually lighter than the card price at 1440. This was declined in an earlier round, so it is not reopened here.
- Pilih kategori | authored | shop.com "Women ›" shelf heading with a white chevron pill (R12). Tiles are labelled photo slots with a brief ("Foto kaos terlipat dan tampak depan.") | none. At 320/200% the brief wraps to 5 lines inside a ~136px tile; this is legible owner-content placement.
- Mulai dari pilihan ini | authored | shop.com shelf. 4-up at 1440, 2-up at 768/390, 1-up at 320; "/ pilihan lengkap" drops as one phrase | none.
- Sebelum memesan | authored | not from the reference; text starts on the shelf's second column at 1440 | none.

**Search / listing** (`71b3b5…`, `41a374…`, `e53955…`, `0e1bd0…`, `0eda6f…`, `7554e9…`, `81f143…`, `92b470…`)
- Heading and count | authored | shop.com "Results" heading at 18/600, with the price basis added | none.
- Active filter chip | authored | shop.com dropdown chip row as a removable white pill: "Isi pilihan: Paket barang yang sama ×" | none.
- Filter panel | authored | the shop.com filter sheet's white 24–28px panel and pill fields, kept as an in-flow `details` (R4). One row of four at 1440, 2×2 at 768, stacked at 390 | "Hapus filter" is a bare underlined link, while R4 and the shop.com sheet show Reset as a pill. It works, but the Apply/Reset pair is lopsided. Optional.
- Results grid | authored | shop.com full-width grid with 1:1 media at 20px radius. 5 columns at 1440, 3 at 768, 2 at 390; prices align per row; the stock note is a quiet 10px-radius pill | none. With 4 results at 1440 there is one empty column; that is correct auto-fill behaviour.
- Pagination ("Halaman berikutnya" plus the recheck note) | authored | secondary outline pill | none.

**PDP** (`bc2eff…`, `5246c8…`, `00c6b8…`, `b6b3ad…`; refs `c9edea…`, `52a31a…`, `2d2dc5…`)
- Media panel | authored | shop.com white ~28px media panel; here a lavender photo slot with the caption below | none. Full width at 390; ~344px at 768.
- Buy box | authored | shop.com narrow buy box: title, price, pill quantity, full-width 52px primary. "Save/Share/Buy now" and ratings are correctly excluded | none at 390/768/1440. At 320/200% "Tambah ke keranjang" wraps to two lines inside the pill without clipping.
- Spesifikasi and accordions | authored | shop.com hairline accordions with right-hand chevrons | the empty "Spesifikasi tambahan belum tersedia." block is still dead space above the accordions. It is kept because it is a tested heading.
- Option pills (R3/R6) | UNVERIFIED | no multi-option product in the data, so no render exists | needs a capture once a multi-option product exists.

**Cart, empty** (`7cd5a8…`, `40d700…`, `871c54…`, `3b1bae…`; refs `f256fb…`, `9f3fa1…`)
- Empty state | authored | shop.com centred heading, one line and one filled pill. The 3D cart image is correctly not copied | none. The canvas fills the page, and the bottom slices (`871c54…-02`, `40d700…-02`) show only canvas or dock.

**Cart, filled** (`4567ff…`, `24e17e…`, `5802a1…`, `ecb1c4…`)
- Line | authored | unboxed with dividers (spec rule). Emphasised total with the "1 pilihan lengkap × Rp99.000" basis, pill quantity, "Perbarui jumlah" outline pill, quiet "Hapus" | none. The ~270px gap at 1440 is the accepted 1.7fr/1fr layout.
- Summary | authored | white 20px card with a soft shadow and a full-width 52px "Lanjut ke checkout" (R7) | none. At 320/200% the right-aligned values wrap ("Dihitung saat / checkout") but stay inside the card.

**Help** (`603301…`, `c56a5c…`, `799a4b…`, `11721880…`; refs `27b2df…`, `6c377b…`)
- Title and lead | authored | help.shop.app centred ~720px column | at 320/200% the H1 word "pengembalian" ends ~6px from the right edge, against a 16px left gutter. It is not clipped, but the gutter is broken. Also, the "Cara pesan" part of the title still promises ordering steps the page doesn't contain.
- Topic cards | authored | help.shop.app 2-up topic cards, 1-up on mobile, plus a full-width privacy card | none.
- Chat card | authored | the reference's "Need more help? / Chat with us", turned into a white card with one filled pill and one outline pill | **at 320/200% the "Lampirkan konteks…" chevron renders at about 7×3px.** That is smaller than the ~12px chevron at 1440 (checked with enlarged crops). The round-4 claim that it is "sized in em" and scales with text does not hold.
- Kembali ke katalog | authored | secondary pill | none.

**Masuk** (`0ba055…`, `e297cb…`, `d1f24a…`, `7c24ac…`; error: `ad4b21…`, `f0b455…`, `34b0c1…`, `f7adea…`)
- Sign-in card | authored | the centred white raised card from the help and cart reference family. 48px inputs at 12px radius, 52px pills, neutral buyer copy ("Konsol Operasional" is gone) | none at 390/768/1440.
- Error alert | authored | rounded alert with a focus ring, 2px error edges on both fields, and a scaling icon | at 320/200% the 28px card padding, the alert padding and the icon squeeze the message into a ~140px column. "Email atau kata sandi tidak cocok. Periksa kembali lalu coba lagi." becomes 8 lines of one or two words each. Reduce the card's inline padding at narrow widths.

**Not found** (`f630dc…`, `a3d7e2…`, `7798c9…`)
- Recovery state | authored | matches the shop.com empty cart: heading, one line, one filled "Kembali ke katalog" pill | none.

## Template signals checked

- None found:
  - no dark or textured hero;
  - no eyebrow pills;
  - no accent-coloured headline word;
  - no icon-tile card rows;
  - no monospace;
  - no `A // B` or `01 /` labels;
  - no arrows on every button;
  - no unsourced stats;
  - no "resmi" or "terpercaya" claims.
- The page couldn't be swapped onto an unrelated business: the price basis runs through every card, the summary and the hero.
- Photos: every slot is labelled and sized as the real photo will be, with a one-line shot brief ("Foto seluruh isi: 2 Krim contoh, tampak depan."). No drawings stand in for photos, so this is owner content, not a design failure.

## Reference transfer

The transfer holds:
- **Hierarchy:** the near-white canvas with white raised surfaces matches `95bdbd…-1440-01`.
- **Rhythm:** the 5-column full-width grid matches `c8a1c9…`, with the sidebar removed as R4 specifies.
- **Density:** the narrow buy box beside a large media panel matches `c9edea…`.
- **Empty states:** the centred empty cart matches `f256fb…`.
- **Help:** the 2-up topic cards match `27b2df…`.

Deliberate omissions are justified in the contract: the desktop rail, the floating bottom omnibox, the modal filter sheet with Done/Reset, discount badges, ratings and Buy now.

Two decisions are contract-supported rather than reference-matched:
- Native `<select>`s replace the shop.com choice pills because they are tested no-JS controls.
- The cards use 16px titles instead of shop.com's 14px.

Evidence notes:
- Several 390 slices (`b2fa7d…-01/02`, `92b470…-01/02`) put the fixed dock over the seam between slices. This hides the "Mulai dari pilihan ini" heading and the end of the filter panel. It is a capture artifact, but those elements have no clean 390 evidence.

Research and rationale are present. The gaps are that the option-pill state (R3/R6) and category pages still have no render.

Most important change: fix the narrow-width scaling at 320px/200% text — make the help-chat disclosure chevron actually scale with the text, cut the sign-in card's inline padding so the error alert isn't squeezed into one-word lines, and keep the help H1 inside the gutter.

Verdict: REVISE