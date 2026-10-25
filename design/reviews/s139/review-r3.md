Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s139/bundle-1440.png, docs/spec/design/renders/s139/bundle-390.png, docs/spec/design/renders/s139/buy-bar-390.png, docs/spec/design/renders/s139/buy-bar-added-390.png, docs/spec/design/renders/s139/default-1440.png, docs/spec/design/renders/s139/default-390.png, docs/spec/design/renders/s139/default-768.png, docs/spec/design/renders/s139/gallery-thumb-focus-1440.png, docs/spec/design/renders/s139/long-320-text200.png, docs/spec/design/renders/s139/multi-1440.png, docs/spec/design/renders/s139/oos-1440.png, docs/spec/design/renders/s139/oos-390.png, docs/spec/design/renders/s139/unavailable-768.png
References: docs/spec/design/references/shop-com/2026-10-21-pdp-1440-mid.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-24-pdp/1440.png, docs/spec/design/references/shop-com/2026-10-24-pdp/390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: d07fe06b99523eb8
Images-SHA: 73f54562c28d7942
Output-SHA: b41bbba109f6f091

Paduka Ongki, saya sudah buka dan periksa ke-37 gambar satu per satu. Tidak ada kode yang saya ubah. Review lengkapnya di bawah, dalam bahasa Inggris karena ini artefak teknis.

## Section review (top to bottom)

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Demo notice + store header + category rail | Authored (shared store shell) | None. shop.com uses a left rail. The owner decided on 2026-10-24 to keep the shared header | Keep. It's an owner decision, not a PDP defect |
| "‹ Katalog" back link + breadcrumb "Semua produk / Rumah Tangga" | Redundant wayfinding | None. shop.com shows neither above the product | Show only one of them. Keep the breadcrumb and show the `from` back link only when a list context exists. That saves about 40px of the first phone screen, where the title already starts low (`default-390-01`, `oos-390-01`) |
| Gallery at 1440 (48px thumbnail strip + 28px card) | Authored transfer | shop.com `2026-10-22-pdp-1440`, `8a19d07a…-1440` | Keep. In `gallery-thumb-focus-1440` the ink "current" ring (thumb 3) and the purple focus ring (thumb 4) are clearly different |
| Gallery on phone/tablet (peek + "1 / 4" counter) | Authored | shop.com `17a56990…-390` peek row | Keep. The counter pill doesn't cover any product |
| Sample photo slot (`multi-1440`, `oos-1440`, `buy-bar-390`) | Labelled slot (fixture only) | n/a | Move "Foto belum tersedia" and the shot brief to the centre of the slot. At 1440 the 12px label sits at the top of a 730px white card and looks like a photo that failed to load |
| Buy box head (category, title, price) | Authored | shop.com title → rating → price group | Keep. The 24/28 title and 16/22 price match the reference. The price stays visible in `unavailable-768` |
| Option label row + pills | Authored | shop.com "Size Toddler 4" / "Color Black" (`d70f14f6…`, `8a19d07a…`) | Keep. The single-option "Pilihan lengkap Paket 10 pcs" uses the same row as the multi-option product (`multi-1440`) |
| "Isi yang diterima" + "Lihat 4 barang lainnya" | Authored. Specific to the fixed-price bundle, not in shop.com | None | Keep. This is the most useful content for the 99ribu bundle |
| Stock line | Authored | None | Keep. In `oos-1440` and `oos-390` the warning colour comes with an icon and text |
| Quantity + 52px primary + helper | Matches the reference | shop.com quantity pill + "Add to cart" | Out of stock: hide or collapse the disabled stepper so the only visible action is "Cari produk tersedia" (`oos-390-02`) |
| Cart feedback after add (`buy-bar-added-390`) | Partly generic | None | The "Keranjang diperbarui" callout sits between the stock line and the quantity, so the stepper and button drop about 150px. "Lihat keranjang" then ends up separated from it, below the button. Put the callout, with the link inside it, after the primary button |
| Deskripsi clamp + grey pill | Matches the reference | shop.com `2026-10-21-pdp-1440-mid` "Read more" | shop.com fades the last line out. Here the cut ends as "lengkap...." (`long-320-text200-03`). A fade mask instead of the ellipsis fixes it |
| Pengiriman dan pembayaran (3 icon rows) | Authored transfer | shop.com "Delivery & Returns" icon rows | Keep. The copy comes from verified checkout terms with no ETA, and the truck, clock and wallet icons each match their subject |
| Pengembalian accordion | Matches the reference | shop.com hairline accordion with the chevron on the right | Keep |
| "Lainnya di <kategori> ›" shelf | Authored, reuses the home shelf | shop.com "more from" rows | Keep. Truncated one-line titles are the owner's 2026-10-24 call. The shelf correctly disappears in `oos-1440` and `multi-1440` (fewer than 2 items) |
| Phone buy bar (`buy-bar-390`) | A justified deviation from shop.com (local marketplace norm) | None | Keep. It covers the first-screen title only while the main button is below the fold; the owner already acknowledged this. The wayfinding fix above reduces it |
| Footer | Shared | n/a | Keep. The grey strip under the footer in full-page 390/320 captures is padding for the dock, which covers it in a real viewport |

## Evidence and comparison

- **Hierarchy (1440):** `bundle-1440-01`, `default-1440-01` and `multi-1440-01` all follow the shop.com column split, about 665px photo card to a 464px buy box. The vertical order also matches: title, price, label row, quantity, primary, open sections. The 24px gap between groups is consistent from the label row down to the primary button.
- **Rhythm and density:** at 1440 the buy box runs to y≈1380 while the photo ends at y≈915. That is expected for sticky media in a full-page capture, not an empty column in a real viewport.
- **Imagery:** product photos come from the merchant, many with text baked in. Faint artifacts at the bottom of the bundle photo, and the bundle description repeating its contents with raw "- 1 pcs" lines, are owner content and already on record. No drawings or generated images stand in for photos.
- **Enlarged text (`long-320-text200-01…07`):** nothing is clipped or overflows horizontally. The breadcrumb wraps with "/" attached to the next crumb, policy icons scale with the text, and the buy bar stays off.
- **States:** the unknown offer (`unavailable-768-01`) keeps the price and the option pill and shows one callout. The out-of-stock state shows "Stok pilihan belum tersedia" once, with a secondary escape pill.
- **Template signals:** none found. No dark hero, eyebrow pill, gradient word, monospace, decorative arrows, sourceless stats, or claims like "resmi" or "terpercaya". The arrow on search submit is a functional icon. Inter, purple and the yellow logo dot match the accepted brand.
- **Research and transfer rationale:** present. Each reference image is mapped in the direction to what was taken and what was not (rating, merchant row, Buy now/Save/Share), with reasons tied to data availability and the claim rule.

The open items are polish and don't change the verdict: cart feedback placement, duplicate wayfinding, the fixture photo slot label, the clamp marker, and the stepper when out of stock.

Most important change: render the add-to-cart confirmation, with "Lihat keranjang" inside it, after the primary button so the controls don't jump and the next action stays next to the message.

Verdict: PASS

This is visual acceptance only, not interaction or accessibility test evidence.