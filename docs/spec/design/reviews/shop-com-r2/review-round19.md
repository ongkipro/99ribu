Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/categories-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 2c6e90990e8a085a
Images-SHA: df3f0cf0b84ca7ba
Output-SHA: 233fba51d499194a

Paduka Ongki, saya sudah membuka ke-185 slice: referensi shop.com dan render 99ribu di 320 dengan teks 200%, 390, 768 dan 1440. Hasilnya **REVISE**. Hampir semua sudah sesuai kontrak, tinggal satu masalah gambar yang material di tile kategori. Saya tidak mengubah file apa pun, hanya menulis ringkasan review di file plan.

## Per section, top to bottom

**Shared shell**
- Environment banner | authored | none (a 99ribu disclosure) | at 390 "lokal." drops alone onto a second line; shorten the copy or allow a balanced wrap (`text-wrap: balance`).
- Header and omnibox | authored | shop.com white pill with soft shadow and round purple submit | none needed. At 320/200% the icon has clear space inside the button and "Cari produk" is not truncated.
- Department chip row | authored | shop.com chip row (scroll plus end fade) | none. The current chip has the charcoal edge, and "Keca…" behind the fade reads as scrolling, not clipping.
- Footer | authored | R9 single column | none.
- Mobile dock | authored | shop.com active pill (R10) | none. It is labelled 2×2 at 320/200% and flows after the footer.

**Home**
- Value row (H1 plus yellow price card) | authored | R2 value card, adapted | none. The small H1 against the card is a recorded accepted deviation.
- "Kategori ›" tiles | authored, but the imagery fails at ≤1050px | shop.com "Categories ›" tinted tiles | see the main finding below.
- "Terbaru ›" and department shelves | authored | shop.com Beauty shelf: one row, cut card, regular titles, price at 600 | at 320/200% the chevron of a long shelf heading ("Kecantikan & Perawatan Diri ›") sits at the far right edge, detached from the title. "Kategori ›" and "Terbaru ›" keep it inline. Use the inline chevron everywhere.

**Search and listing (default, active, filters open)**
- Title and count | authored | shop.com "Results" | none.
- Removable filter chip and filter disclosure | authored | R4. Native selects are an accepted deviation | none. The 2×2 layout at 768 and one row at 1440 both hold.
- Result grid | authored | shop.com 1:1 white media with 20px radius and regular titles | at 1440 the 24-per-page result leaves the last row at 4/5. This is minor and optional (25 per page, or accept it). Prices align per row at every width, and the near-identical "Paket 2 pcs Kaos Kata Lucu Sindiran …" titles keep their distinguishing words.

**PDP (simple, bundle, bundle opened)**
- Media panel | authored | shop.com white 28px panel | none. On phones it spans the full content width.
- Buy box | authored | shop.com narrow buy box with a 52px pill | none. "Lihat 4 barang lainnya" flips to "Sembunyikan barang lainnya", and "Tambah ke keranjang" is inside the first screen at 1440.
- "Spesifikasi" plus accordions | authored | shop.com hairline accordions | none. The empty "Spesifikasi" section is an accepted, test-checked deviation.

**Cart (empty and filled)**
- Empty state | authored | shop.com centred empty cart with a single primary pill | none.
- Line and summary | authored | R7: unboxed line, white 20px summary card, 52px checkout pill | none. At 320/200% the label/value rows stack without clipping.

**Categories page** | authored layout, imagery fails | no shop.com reference was capturable (recorded) | see the main finding below.

**Help** | authored | help.shop.app ~720px column with 2-up topic cards | at 320/200% the 24px card padding plus the 16px gutter leave about 230px of text. The "Ongkir dan pengiriman" body runs to 11 lines of 2–3 words. Use `clamp()` inline padding, as `/masuk` already does.

**Sign-in (default and error)** | authored | R2 card treatment | none. The alert holds focus, both fields show the error edge, and the message wraps readably at 320/200%.

**Not found** | authored | R8 centred recovery | none.

## Main finding (material)

**Category tile photos are nearly invisible at ≤1050px**, on both home and `/categories`. Each photo is a small contain-fitted thumbnail centred in a wide white strip:
- `0a4e6e0de3938837-categories-320-text200-02.png`: the "Perkakas, Lem & Elektronik Rumah" plug is about 20px, white on white.
- `666bf4a073b7caba-categories-390-01.png`: the same tile shows the same problem.
- `fd8b8d79ef3ae725-home-768-01/02`: the photos are about 40px inside 100px strips.

The result:
- The tiles read as text cards with an empty slot.
- The tinted tiles with a product image, which were the point of transferring shop.com's category tiles, are lost.
- On `/categories`, these tiles are the page's only content.

Round 19 kept the 64px strip to keep the home page short, which is fine. But the strip should be filled with the photo (cover), not show a contain-fitted thumbnail on white. `/categories` has no height constraint, so it can use the 4:3 photo.

## Reference transfer

Hierarchy, rhythm and density match the references:
- shop.com 20px/600 shelf titles with "›" → "Terbaru ›" and the department shelves.
- shop.com's 7-up shelf with a cut card → 6.5 cards visible at 1440.
- shop.com search's chip row above a full-width grid → R4.
- shop.com PDP's narrow buy box with a full-width primary and hairline accordions → R6.
- The centred empty cart and the help card column match.

Excluded on purpose, with recorded rationale:
- trending stores, store carousels, editorial collections and the wordmark marquee (no data, or decoration);
- the desktop icon rail and the floating bottom omnibox.

No template signals were found: no eyebrow pills, gradient accent words, icon-tile card rows, monospace labels, unsourced stats or "resmi" claims, and no `→` on every button.

Gaps not counted as design failures (all recorded):
- The multi-option PDP state is UNVERIFIED because no published product has more than one option.
- shop.com category pages could not be captured.
- Two kinds of owner content: Pengembalian copy is not published yet, and some product photos do not match their contents (for example "Paket Hemat Listrik & Pipa" shows only the plug).

Most important change: below 1050px, make the category tile photo fill its strip (`object-fit: cover`, no white inset) on home, and give `/categories` the larger 4:3 photo, so the tiles show recognisable products.

Verdict: REVISE

Kalau Paduka mau lanjut, fix-nya kecil dan ada di CSS tile kategori plus padding kartu help. Setelah itu perlu capture ulang home/categories di 320/390/768 dan menjalankan lagi test baseline 200% di `storefront-http`.