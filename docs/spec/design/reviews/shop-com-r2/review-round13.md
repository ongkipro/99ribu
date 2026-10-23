Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/categories-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: d9d5c593fdbf1d8a
Images-SHA: 3169abbd5c94adf8
Output-SHA: b2a5c7110c35c438

Paduka Ongki, I opened all 189 images (the 20 shop.com reference slices and the 169 99ribu renders) and none were blocked. The verdict is **REVISE**. Most of the storefront matches the shop.com transfer, but there is one material problem in the search results and one visible layout gap on the home page at tablet width.

## Section review

**Shell (header, chips, footer, dock), all pages**
- Omnibox and header | authored | shop.com white pill with no border (`95bdbd15…-1440-01`) | No fix needed. At 320/200% the round search button keeps room around its icon and "Cari produk" isn't cut off.
- Department chip row | authored | shop.com chip row (`24f5fb56…-390-01`) | The current chip ("Semua produk", charcoal edge) and the end fade both show. Fix: none material.
- Footer | authored | shop.com columned footer, reduced to one "Bantuan" column | The two links are about 52px apart at 1440, which reads as two separate blocks. Tighten the gap toward the reference's ~30px rhythm.
- Mobile dock | authored | shop.com active grey pill → lavender pill | It turns into a labelled 2×2 grid at 320/200% and sits after the footer without covering content. No fix needed.

**Home**
- Hero and fixed-price card | authored | none; this is 99ribu's own fixed-price anchor | At 1440 a ~450px empty band sits between the short H1 and the card (accepted in round 1). No new fix.
- Pilih kategori tiles | authored | shop.com shelf heading with the "›" pill | They read as categories, not products: lavender card, name first, then photo. Fix: tile names use looser line spacing (≈1.6) than card titles (1.375). Two-line names such as "Kecantikan & / Perawatan Diri" look gappy at 390 and 320. Match the card-title spacing.
- Mulai dari pilihan ini shelf | authored | shop.com shelf | **Fix:** at 768 (`fd8b8d79…-768-03`) the 8-product curated shelf goes 3-up and ends with an empty third slot. A partial row is normal in a long listing, but on a hand-picked home shelf it looks unfinished. Show a multiple of 3 at tablet (6 or 9), or go 4-up.
- Sebelum memesan | authored | none | The text lines up with the second card column at 1440. No fix needed.

**Search / listing**
- Title and count | authored | shop.com "Results" heading | No fix needed.
- Active filter chip and "Filter dan urutan" panel | authored | shop.com filter chip row and filter sheet (`bbf0d8af…`) | Native selects inside pills, one row of four at 1440 and 2×2 at 768. The filled "Terapkan filter" is the only filled action. No fix needed.
- Result grid | authored, with a defect | shop.com search grid (`c8a1c9a0…`) | **Fix (material):** in the "kaos" results at 1440 and 768 (`0eda6f57…-1440-01/02`, `81f1433a…-768-02..05`), 24 cards share the prefix "Paket 2 pcs Kaos Kata Lucu Sindiran". The 2-line limit leaves only 2–3 words that tell them apart ("…Jika Ingin Menghin…", "…Cukup Pesawat Saj…"), and "Isi: 2 pcs" repeats the title. Comparing options is the core task here. Allow 3 lines at every width, as phones already do; the shared row tracks keep prices aligned anyway.
- 320/200% single column | authored, with a defect | none | In one column the 3-line limit still cuts names ("Paket Mobil & Ruangan Wangi Kopi Bali…", "Paket Rumah Bebas Bau Pipis Kucing + 20 Pcs…") and buys no alignment. Lift the limit when the grid is one column.
- Pagination | authored | none | No fix needed.

**PDP (standard and bundle)**
- Media and buy box | authored | shop.com PDP 1440/390 (`c9edea82…`, `52a31a5d…`) | Narrow buy box, full-width 52px "Tambah ke keranjang", quantity pill, accordions between hairlines. "Tambah ke keranjang" is near the top of the bundle page at 1440 (y≈827).
- Bundle contents block | authored, with a content defect | none | Fix: "Paket … 7-in-1", "Pilihan lengkap: Paket 7 barang" and "7 jenis barang dalam pilihan ini" state the same count three times. At 390 this pushes the purchase controls down. Drop the "7 jenis barang" line when the "Pilihan lengkap" line already says it.
- Spesifikasi | authored, but an empty section | none | It's accepted (a tested heading), but it still shows "Spesifikasi tambahan belum tersedia." on both PDPs, above the accordions.
- 320/200% | authored | none | No clipping. Fix: the "Lihat 4 barang lainnya" chevron jumps to the far right edge here but sits next to the label at 390 and 1440. Keep it next to the label.

**Cart**
- Empty state | authored | shop.com empty cart (`f256fbf0…`, `9f3fa1c5…`) | Centred heading, one line of text, one filled pill. No fix needed.
- Filled line and summary | authored | none (signed-in reference not capturable) | Unboxed line, white 20px summary card, full-width checkout pill. Fix: "Perbarui jumlah" uses ~13px text inside a 44px pill, smaller than every other button. At 390 it is also wider than the quantity pill and narrower than the summary pill. Use the standard button text size and set its width to the quantity pill or to full width.

**Categories**
- Tile grid | authored | none (shop.com category pages returned an error) | 4 per row at desktop and tablet, 2 at 390, 1 at 320/200%. The rationale is recorded. The loose name spacing noted on home applies here too.

**Help**
- Title, topic cards, chat card, return action | authored | help.shop.app (`27b2df7e…`, `6c377b87…`) | Centred column, 2-up cards plus a full-width privacy card, one filled chat action. Nothing clips at 320/200%. No fix needed.

**Sign-in and sign-in error**
- Card, fields, alert | authored | none (sign-in is outside the reference set; it uses the storefront card style) | Centred white 20px card. The alert has a visible focus ring and wraps into readable lines at 320/200%. Fix: "Batal" is a full-width pill the same size as "Masuk", so the page appears to offer two equal actions. Make "Batal" a quieter text link or a shorter secondary.

**Not found**
- Recovery state | authored | shop.com empty state | No fix needed.

## Evidence and transfer

- **Matches the references:** off-white canvas with white raised surfaces, the borderless omnibox, white hairline chips, the "›" shelf pills, the narrow PDP buy box with a full-width primary pill, chevron accordions, the centred empty state, and 2-up help cards. All of these match the shop.com images above.
- **Shop.com elements correctly left out:** the left icon rail, discount badges, ratings, Save/Share/Buy now, and the floating desktop search bar.
- **Template signals:** none found. There are no eyebrows, no monospace text, no arrow on every button, and no stat figures.
- **Unsourced claims:** none visible. The earlier "katalog dan foto produk asli" footer claim is gone.
- **Content, not design:** "Paket Kacamata Baca Auto Focus 4 Pcs" lists "2 × Kacamata…", and some tile photos are banners with heavy text. Both come from the owner's catalog.
- **Evidence gaps (not design failures):** the R3/R6 multi-option pills are still UNVERIFIED because no published product has more than one option. The category pages have no reference; the rationale for their design is recorded.
- **Not judged:** whether the PDP photo stays pinned while scrolling at 1440. Full-page captures can't show that.

**Most important change:** let listing titles use 3 lines at every width (and no limit in a one-column grid), so the 24 "Paket 2 pcs Kaos Kata Lucu Sindiran …" cards can be told apart by name.

**Verdict: REVISE**