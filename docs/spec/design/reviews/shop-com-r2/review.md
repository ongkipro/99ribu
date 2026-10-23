Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/categories-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 5e041aada37c68b8
Images-SHA: f1251f5979e9f573
Output-SHA: 14c63cc43dbde15c

Paduka Ongki, saya sudah membuka ke-186 slice. Tidak ada gambar yang gagal dibuka. Rinciannya: 7 set referensi shop.com dan semua render 99ribu untuk home, search, filter, PDP, PDP bundle, cart, kategori, help, masuk dan notfound, di lebar 320 (teks 200%), 390, 768 dan 1440. Saya tidak mengubah file source apa pun; ringkasan review saya simpan di file plan. Review lengkapnya dalam bahasa Inggris di bawah.

### Section lines (top to bottom)

**Shared shell**
- Env banner | authored | none (99ribu-specific) | none; wraps cleanly to 2–3 lines at 390/320.
- Header + omnibox | authored | shop.com home omnibox (white pill, round purple submit) | none. The icon stays clear inside the button at 320/200% (`f9ad…-home-320-text200-01`).
- Department chip row | authored | shop.com chip row | none. The current chip has a charcoal edge on `/search` ("Semua produk"), the end fade shows at 1440/768/390, and nothing is clipped.
- Footer | authored | shop.com columned footer, reduced to one "Bantuan" column | none.
- Mobile dock | authored | shop.com active-icon pill | none. The lavender pill is correct on Beranda, Kategori, Keranjang (with badge) and Akun, and the dock drops to a labelled 2×2 at 320/200%.

**Home** (`894181cd…`, `b2fa7d09…`, `fd8b8d79…`, `f9ad8c3b…`)
- Hero + fixed-price card | authored | none | none. The small H1 against an empty left half at 1440 is the accepted round-1 hero.
- Pilih kategori tiles | authored | shop.com department shelf, one photo per department | **Fix:** remove the inset white inner frame. At 390 the camera and saver products fill only about 40% of a frame that sits inside the lavender card. The card-in-card wastes the photo area and weakens the shelf compared with the shop.com mosaic.
- Mulai dari pilihan ini shelf | authored | shop.com search card (white 1:1 media, 20px radius, 600 title) | none. Prices align per row at 1440, 768 shows 3×2 with no orphan, and 390 is 2-up.
- Sebelum memesan | authored | none | **Fix (content):** "Periksa … ketentuan pengembalian sebelum menyelesaikan pesanan" tells buyers to check return terms, but `/help` says "Ketentuan pengembalian belum diterbitkan." Reword it until the owner publishes the terms.

**Search / listing** (`71b3b511…`, `0eda6f57…`, `41a37444…`, `e539555a…`, `0e1bd073…`, `7554e96f…`, `81f1433a…`, `92b4704d…`)
- Heading + count | authored | shop.com "Results" heading | none.
- Active filter chip | authored | shop.com chip | none.
- Filter disclosure | authored, adapted | shop.com filter sheet turned into an in-flow panel | none. It is one row of four at 1440 and 2×2 at 768, stacked at 390 with "Terapkan filter" visible above the dock. Native selects are an accepted deviation.
- Results grid | authored | shop.com 6-column grid, transferred as 5 columns | none. The "Paket 2 pcs Kaos Kata Lucu Sindiran …" names keep their distinguishing words at 390 and 768, and prices align by subgrid.
- Pagination | authored | none | none.

**PDP and PDP bundle** (`bc2effc7…`, `5246c805…`, `00c6b847…`, `b6b3ad67…`, `a85e3ab9…`, `46d89c1d…`, `9b34ad0a…`, `3135d8d9…`, `b1bab246…`, `43cc1a8d…`)
- Task header + breadcrumb | authored (S22) | none | none.
- Media panel | matched to shop.com PDP 1440 (white panel, about 24px radius) | none. Sticky behaviour can't be judged from full-page shots.
- Buy box | matched to the shop.com buy box order (title, price, contents, stock, quantity pill, 52px primary) | none. "Tambah ke keranjang" is inside the first 900px at 1440 on the 7-item bundle.
- Extra-contents disclosure | authored | accordion chevron pattern | none. "Lihat 4 barang lainnya ⌄" and "Sembunyikan barang lainnya ⌃" both render, and the chevron stays with its label at 320/200%.
- Spesifikasi | generic placeholder | none | "Spesifikasi tambahan belum tersedia." sits in the purchase column on every PDP. This is an accepted, test-checked deviation; hide the block when it is empty if the test owner agrees.
- Accordions | matched to shop.com Description/Reviews hairlines | none. The open Deskripsi repeats the 7 contents lines word for word, but that is catalog data, not layout.

**Cart** (`7cd5a859…`, `40d700da…`, `871c54c7…`, `3b1bae43…`, `4567ff2f…`, `24e17e70…`, `5802a125…`, `ecb1c43a…`)
- Empty state | matched to shop.com empty cart 1440/390 (centred heading, one filled pill) | none. The canvas fills the short page.
- Line | authored (spec requires unboxed lines) | none | **Fix:** at 390, "Perbarui jumlah" stretches full width under the quantity field, as wide as "Lanjut ke checkout". A secondary action carrying that much weight blurs the task hierarchy. Keep it content-width.
- Summary card | matched to the shop.com pill CTA | none. At 320/200% the values wrap right-aligned without clipping.

**Categories** (`65e1c0b3…`, `666bf4a0…`, `3520b888…`, `0a4e6e0d…`)
- Tile grid | authored | shop.com shelves without the mosaic | Same inner-frame fix as the home tiles. The grid is 1-up at 320/200%, the labels share a baseline per row, and "Kategori" is active in the dock.

**Help** (`603301b6…`, `c56a5cb6…`, `799a4b55…`, `11721880…`)
- Topic cards | matched to help.shop.app 1440/390 (centred column, 2-up cards then 1-up) | The short Pengembalian card is top-aligned. Its content is unpublished owner content.
- Chat card | authored | the help "Chat with us" entry | none. Sentence case, muted hours line, one filled action.
- Kembali ke katalog | authored | none | none.

**Sign-in /masuk and error state** (`0ba0553c…`, `e297cb8b…`, `d1f24aee…`, `7c24aca5…`, `ad4b217f…`, `f0b455b1…`, `34b0c10f…`, `f7adea3e…`)
- Card + form | authored | no shop.com reference | **Fix (copy):** "Pesanan tamu dapat dibuka dari halaman Akun" is circular, because this page is the Akun destination (Akun is active in the dock). Name the actual path.
- Error alert | authored | none | none. It wraps in readable lines at 320/200%, the focus ring shows, and the fields carry the error edge.

**Not found** (`f630dc19…`, `a3d7e240…`, `7798c907…`) | matched to the shop.com empty state | none.

### Reference transfer
I compared the renders against the shop.com references in the listed slices: home (`95bdbd15…`, `24f5fb56…`), cart (`f256fbf0…`, `9f3fa1c5…`), help (`27b2df7e…`, `6c377b87…`), and the 2026-10-22 PDP and search slices (`c9edea82…`, `52a31a5d…`, `2d2dc596…`, `c8a1c9a0…`, `488cca11…`, `bbf0d8af…`).
- **Hierarchy:** carried over. The buy box is title → price → choice → quantity → 52px primary, and accordions sit between hairlines.
- **Rhythm and density:** carried over. The canvas is off-white with white raised media, the grid is 5-up instead of shop.com's 6-up, the gap is 12px, and titles are 600 weight.
- **Imagery:** real catalog photos sit on white 1:1 media. Ratings, discount badges and Save/Share/Buy now are correctly left out.
- **Main mismatch:** the department tiles are a framed photo inside a lavender card, not shop.com's full-bleed mosaic. The one-photo-per-department rationale is recorded, but the inset frame isn't required by it.
- **Template signals:** none found. No eyebrows, monospace, `A · B` labels, arrow-on-every-button or unsourced stats. Copy makes no "resmi" or "terpercaya" claims.
- **Evidence gaps (outside the builder's control):** multi-option PDP pills are still UNVERIFIED because the data has no such product, and shop.com category pages couldn't be captured. Both are disclosed.

Most important change: reword the home "Sebelum memesan" line (and keep the "Cara pesan dan pengembalian" links honest) so buyers aren't sent to return terms the help page says aren't published yet.

Verdict: PASS. All images were inspected, the contract and references support the direction, and every remaining item is a non-blocking polish or content fix. This is visual acceptance only, not interaction or accessibility test evidence.