Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 32e50184b74f3551
Images-SHA: 6e4defc055f65b59
Output-SHA: 209c0b301d2c1894

Paduka Ongki, saya sudah membuka ke-126 gambar: 20 slice referensi shop.com dan 106 slice render 99ribu. Hasilnya **PASS**, tapi hanya untuk state yang memang ter-render. Option pill di PDP multi-opsi tetap UNVERIFIED karena di katalog belum ada produk dengan lebih dari satu opsi. Tidak ada kode yang saya ubah; ringkasan review saya simpan di file plan. Review lengkapnya di bawah, dalam bahasa Inggris.

---

## Section lines (top to bottom)

**Shared shell**
- Sample-data banner | authored | none (99ribu-specific honesty line) | none needed
- Header + omnibox | authored | shop.com home omnibox: white pill, soft shadow, no border, purple round submit (R2) | At 320/200% the submit button becomes a 68×48 oval. It reads fine as a pill, so no fix needed.
- Department chips | authored | shop.com category pill chips (R3); on `/search` the current chip "Semua produk" has the charcoal edge | none
- Footer | authored | shop.com columned footer reduced to one "Bantuan" column (R9) | At 320/200% the two links sit about 4px apart. Fine as is.
- Mobile dock | authored | shop.com active-icon grey pill, recoloured lavender (R10); verified on Beranda, Keranjang (with badge "1") and Akun | none

**Home**
- Hero and fixed-price card | authored | not copied from shop.com; the yellow Rp99.000 card is the 99ribu anchor | The H1 scale against the card is an accepted round-1 deviation.
- "Pilih kategori" tiles | authored | shop.com department shelf "Women ›" with a chevron pill (R12) | At 768 the two tiles are about 347px empty squares and fill the whole first viewport. Use 4:3 tiles between 701 and 1050px.
- "Mulai dari pilihan ini" shelf | authored | shop.com card rhythm (R5): 4-up at 1440, 2-up at 768/390, the "/ pilihan lengkap" basis stays one phrase | none
- "Sebelum memesan" | authored | text starts on the second card column at 1440 | none

**Search / listing**
- Heading and count | authored | shop.com "Results" heading | none
- Active-filter chip | authored | R3 removable pill | none
- Filter disclosure | authored | R4: one row of four at 1440, 2×2 at 768, stacked at 390; the open toggle uses the charcoal edge; one filled "Terapkan filter" next to an outline "Hapus filter" | none
- Results grid | authored | shop.com search: full width, no sidebar, 5 columns at 1440, 2 at 390 | none
- Stock pill | authored | quiet `#f1eee6` lozenge; wraps cleanly with the 10px radius at 390 | none
- Pagination | authored | centred outline pill plus one note | none

**PDP**
- Task header and breadcrumb | authored | accepted S22 header | none
- Media slot | authored | shop.com 28px media panel; lavender fill instead of white is a recorded deviation | none
- Buy box | authored | shop.com PDP 1440: narrow column, 52px full-width primary, pill quantity | none
- Spesifikasi and accordions | authored | shop.com hairline accordions with a right chevron | none

**Cart (empty)**
- Empty state | authored | shop.com "Your cart is waiting": centred heading, one line, one filled pill (R8) | The lead ends with a one-word line ("keranjang.") at 768 and 1440. Add `text-wrap: pretty`.

**Cart (filled)**
- Line | authored | R7: unboxed line, emphasised line total, basis "1 pilihan lengkap × Rp99.000" | The "Perbarui jumlah" label is smaller than other pill labels. At 390 the pill is about 224px wide and doesn't line up with the quantity pill or the column edge.
- Summary | authored | white 20px raised card, 52px "Lanjut ke checkout" | none

**Help**
- Title and lead | authored | shop.com help centred column | none
- Topic cards | authored | help.shop.app 2-up cards (R11) plus a full-width privacy card | At 320/200% the 24px inline padding leaves 2–3 words per line. Use `clamp()` padding as on the sign-in card.
- Chat card | authored | sentence case; wrapped hours line; chevron now visible at 320 | none
- "Kembali ke katalog" | authored | secondary outline pill | none

**/masuk**
- Sign-in card | authored | centred white raised 20px card | "Batal" is a 52px full-width pill with the same weight as "Masuk". Make it a 44px secondary, the height of the shop.com PDP secondary.
- Error state | authored | rounded error panel with a focus ring, both fields marked invalid; wraps readably at 320/200% | none

**Not found**
- Recovery state | authored | R8 centred state with a single primary action | none

## Evidence and comparison

- **Canvas and surfaces (R1).** On the home, search and cart renders at 1440 and 390, the off-white canvas carries white raised surfaces: omnibox, chips, filter panel, summary and topic cards. This matches the off-white shop.com home reference with its white omnibox and chips.
- **Listing (R4).** `0eda6f57…-search-active-1440-01` shows the filter panel above a full-width 5-column grid. That transfers the chip-row-over-grid hierarchy of `c8a1c9a0…-search-1440` without the left rail, which is correct. `92b4704d…-filters-open-390-01` is the in-flow, non-modal version of the `bbf0d8af…-search-filters-390` sheet: same pill controls, same Apply/Reset pairing.
- **PDP (R6).** `bc2effc7…-pdp-1440-01` matches the proportions of `c9edea82…-pdp-1440`: wide media, narrow buy box, one dominant 52px pill, hairline accordions. Save/Share/Buy now were left out as the contract requires.
- **Empty states and help (R8, R11).** `7cd5a859…-cart-1440-01` and `f630dc19…-notfound-1440-01` follow the centred stack of `f256fbf0…`. `603301b6…-help-1440-01` follows the centred column and 2-up cards of `27b2df7e…`.
- **Imagery.** Every product and category image is a lavender photo slot with a one-line shot brief, sized for the real photo. This is acceptable owner content, not a design failure. There are no stand-in illustrations.
- **Template signals.** None found:
  - no dark hero, no accent word, no eyebrows, no icon-tile card rows, no monospace;
  - no `A · B` labels (the `×` in contents lines is real quantity);
  - no arrow on every button, no unsourced stats;
  - no "resmi" / "terpercaya" claims.
- **Domain fit.** The fixed-price card, the "/ pilihan lengkap" basis and the contents lines tie the layout to 99ribu's business, so it would not fit an unrelated store with only the name swapped.
- **Capture artifacts, not defects.** In the full-page 390 slices the fixed dock sits on the seam between slices (home, search, filters-open, help, cart-filled, masuk). It hides about 55px of content in the evidence only, not in the real page. The 320/200% set uses the tall-viewport method and shows the dock where it really sits.
- **Research gaps (recorded).**
  - No multi-option PDP exists, so the R3/R6 option-pill state is not covered by this acceptance.
  - Category pages could not be captured on shop.com.
  - Checkout and receipt are out of scope.

All five polish items above are optional and don't need another review round.

Most important change: make "Batal" on `/masuk` a smaller secondary so "Masuk" is clearly the one primary action. Everything else is narrow-width text polish.

Verdict: PASS