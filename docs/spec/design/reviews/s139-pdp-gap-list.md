# S139 PDP precision pass: gap list (2026-10-25)

Owner request (2026-10-25): the public product page "is not precise and perfect enough, make it like shop.com". shop.com is the structural reference only (layout, hierarchy, component behaviour); no brand, assets or copy are taken.

Inputs: shop.com captures `docs/spec/design/references/shop-com/2026-10-24-pdp/{390,1440}.png` and `2026-10-22-pdp-*.png`, the research pack `~/Documents/work/research/shop-com-99ribu-ui-ux/` (05 PDP notes, `05-product-pdp-{1440,390}-{top,mid}.png`), the "Product page (observed 2026-10-24)" contract in `visual-context.md`, and the pre-S139 renders `docs/spec/design/renders/pdp-header/` and `s111-phase2/`. shop.com was not re-inspected live in this pass; the captures above were used.

Constraints kept: guest cart (ADR-0007; shop.com's signed-in cart is not copied), fixed-price complete offers, server-rendered HTML first, no new dependency, no invented ratings, reviews, delivery dates or trust badges (storefront-ux claim rule), button vocabulary unchanged ("Tambah ke keranjang").

## Gaps found and fixed

| # | Area | Gap (before) | shop.com structure | Fix (S139) |
|---|---|---|---|---|
| 1 | Offer selector | Radio pills plus a separate "Lihat pilihan" submit and a "Pilih opsi, lalu tekan Lihat pilihan…" hint: three steps to switch an option. Single offer rendered as "Pilihan lengkap: X" in another style. | Label row "Color Black" (name 600 + value 400), swatches switch at once. | Options are links to their `?offer=` URL (server HTML, no JS needed, `from` kept, URL replaced so Back still returns to the list), `aria-current` on the current one, text "Belum tersedia" on unavailable ones. One label row "Pilihan lengkap <value>" for every product; the pill list only when there is a choice to make (or the requested offer is unknown). |
| 2 | Gallery | Thumbnails rendered only after hydration, so at ≥1051px the photo column shrank by 64px after load (layout shift); no-JS visitors had no thumbnails. | 48px thumbnail strip beside the photo row. | Thumbnails are server-rendered links to `#foto-N` (work without JS), so the strip holds its column from first paint; JS adds row-only smooth scrolling and the current ring. |
| 3 | Gallery position (phones/tablets) | No indication of how many photos a bundle has where the strip is hidden (≤1050px). | Peeking next card only. | Peek kept, plus a small "N / M" counter on the photo after hydration (aria-hidden; slides keep "N dari M"). |
| 4 | Price hierarchy | Price hidden when the requested offer was unknown (invalid `?offer=`), so the title block jumped. | Title, rating, price always together. | Price always shown (every complete offer is Rp99.000); category, title and price form one group (8px inside). |
| 5 | Spacing rhythm | Uniform 16px grid gap patched with -12/+8px margins. | Groups 24px apart, 16px inside a group. | Buy box gap 24px between groups (head, selector, contents, purchase, sections), negative/positive margin patches removed. |
| 6 | Breadcrumb wrap | At 320/200% the line could end with a bare "/" (review round 41 note). | n/a | Separator bound to the crumb after it. |
| 7 | Stock state | Unavailable stock line used the same ink as available. | n/a | Unavailable line uses the warning colour beside its icon and text (not colour alone). |
| 8 | Sticky phone purchase | On phones the primary action sits below the first screen (photo, title, options, contents); nothing to act on until scrolling. | shop.com has none; Indonesian marketplace norm is a bottom buy bar. | Phone-only buy bar above the dock (price + "Tambah ke keranjang"), shown only while the main button is out of view. It is a second submit of the same form (shares quantity, pending lock and labels), aria-hidden and out of the tab order (keyboard/screen-reader users keep the one main button), hidden on short screens, wraps at enlarged text; after its result the purchase region scrolls into view so the feedback is seen. |
| 9 | Description | Long text collapsed inside a closed accordion; short text open. | Description section open with a grey "Read more" pill. | Deskripsi always open, long text clamped to 8 lines with a "Baca selengkapnya" / "Tampilkan lebih sedikit" pill (native `details`, full text stays in the HTML). |
| 10 | Shipping / payment info | One paragraph in a closed "Ongkir dan pengiriman" accordion; payment methods not on the PDP. | "Delivery & Returns" open with icon rows. | "Pengiriman dan pembayaran" open with three icon rows, all from existing verified copy: ongkir from address and package before confirmation; holidays not counted; transfer, VA/QRIS or COD (COD availability checked at checkout, COD fee) from the checkout method labels. |
| 11 | Related products | Nothing after the buy box; dead end below the accordions. | "More from store" / "You might also like" rows. | "Lainnya di <kategori> ›" shelf (same category, newest, current product excluded, at least 2 items), the home shelf component, streamed in its own Suspense boundary so it never delays the buy box. |
| 12 | Title wrap | Ragged last line on long titles. | n/a | `text-wrap: pretty`. |

## Checked and kept

- Columns (1fr / up to 464px buy box, 56px gap), sticky media from 701px, 28px photo cards, 1:1 photos (merchant photos are square with text; round 30), thumbnails 48px, quantity pill, 52px primary pill with highlight and glow, 52px accordions, field labels 12/16 600, title 24/28 600 -1px, price 16/22 600: already match the 2026-10-24 contract.
- Tap targets ≥44px (crumbs, pills, thumbnails 48, steppers, accordions, read-more), visible focus (global purple ring), keyboard order (selector links, stepper, submit, sections).
- Error / pending / unknown cart states (`cart-feedback`, `cart-form-error`, retry) and the out-of-stock path (disabled action, advisory with a link to an available option or category) are unchanged and still pass S22.

## Deferred (with reason)

- **Ratings and reviews:** no review data exists; shop.com's rating row and Reviews section are not imitated (no invented ratings, no empty placeholder).
- **Photo zoom / lightbox:** sources stop at 1080px and the panel already shows them near full size; a modal viewer adds client code for little gain. Revisit with higher-resolution media.
- **Recently viewed:** needs per-visitor storage and a privacy decision; no data contract today.
- **Merchant/warehouse row, "Buy now", Save/Share:** no data or feature behind them (recorded deviations in visual-context.md); warehouse origin is not exposed by the public product reader.
- **Delivery estimate (ETA):** no authoritative per-address estimate before checkout; not invented.
- **`loading.tsx` skeleton for client navigation:** a streamed boundary above the page would turn the 308 canonical redirect and the `/404` redirect into client-side redirects after the shell is sent. Kept server-complete.

## Superseded globals.css rules (for the coordinator to delete when folding `product.css`)

`src/app/(storefront)/produk/[slug]/product.css` refines the globals block; these globals selectors now match nothing: `.product-detail .offer-single strong`, `.product-detail .offer-picker fieldset`, `.product-detail .offer-picker legend`, `.product-detail .offer-picker label`, `.product-detail .offer-picker label:has(:checked)`, `.product-detail .offer-picker input`, `.product-detail .offer-picker .button`, `.product-detail .gallery-thumbs button`, `.product-detail .gallery-thumbs button[aria-current]`, and the `.offer-picker legend` / `.offer-single` parts of the field-label `:is()` list.

## Evidence

Renders: `docs/spec/design/renders/s139/` (default, bundle, multi, oos, unavailable, long at 390 touch / 768 / 1440; 320 at 200% text; buy bar; option switch; thumbnail focus). Executable: `tests/browser/storefront-pdp.test.ts` (overflow ≤1px and zero console/page errors per capture).

Independent visual review (`visual-review.py --reviewer claude`, fresh invocation per round, run in a scratch copy so the S27 `design/review.md` baseline stays byte-identical): round 1 REVISE, round 2 REVISE, round 3 PASS; outputs archived in `design/reviews/s139/review-r{1,2,3}.md`. Gate: `python3 design-gate.py . --design docs/spec/design/reviews/s139-pdp-gap-list.md --review design/reviews/s139/review-r3.md --src "src/app/(storefront)/produk"` → `PASS: 0 failing check(s)`.

Open polish from review 3 (not blocking): cart feedback renders above the quantity and primary (shared `CartMutations` layout, also on `/keranjang`; moving it under the primary is a shared-component change); the sample photo-slot label sits at the top of the slot (fixture products only); the clamp ends with the browser ellipsis rather than a fade.

## Reference evidence

Accepted project captures of shop.com (structural reference only; brand, imagery and copy are not transferred):

- `docs/spec/design/references/shop-com/2026-10-24-pdp/1440.png`: thumbnail strip beside one photo card, narrow buy box (merchant row, title 24/28, rating, price, "Color Black" label row with swatches, quantity pill, 52px "Add to cart", accordions). Transferred: column split, label row "name + value", option pills switching at once, groups 24px apart, open sections.
- `docs/spec/design/references/shop-com/2026-10-24-pdp/390.png`: bleeding photo row with the next card peeking, buy box in the same order below. Transferred: peek row, order; not transferred: merchant/rating/swatches (no data).
- `docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png`: accordions between hairlines with the chevron right. Transferred unchanged.
- `docs/spec/design/references/shop-com/2026-10-21-pdp-1440-mid.png` (copied from the research pack, screenshot 05 "pdp 1440 mid"): Description open with a grey full-width "Read more" pill; "Delivery & Returns" open with icon rows; secondary grey pills. Transferred: open Deskripsi with the clamped text and the grey "Baca selengkapnya" pill; icon rows for shipping/payment.

## Render critique

Author: Claude Code (claude-opus-5-5), the builder; not an independent review.

Renders (fresh, `tests/browser/storefront-pdp.test.ts`, production build): `docs/spec/design/renders/s139/default-390.png`, `docs/spec/design/renders/s139/default-768.png`, `docs/spec/design/renders/s139/default-1440.png`, `docs/spec/design/renders/s139/bundle-390.png`, `docs/spec/design/renders/s139/bundle-1440.png`, `docs/spec/design/renders/s139/multi-1440.png`, `docs/spec/design/renders/s139/oos-390.png`, `docs/spec/design/renders/s139/unavailable-768.png`, `docs/spec/design/renders/s139/long-320-text200.png`, `docs/spec/design/renders/s139/oos-1440.png`, `docs/spec/design/renders/s139/buy-bar-390.png`, `docs/spec/design/renders/s139/buy-bar-added-390.png`, `docs/spec/design/renders/s139/gallery-thumb-focus-1440.png`.

- Buy box (1440, `bundle-1440`): category, title and price read as one block; "Pilihan lengkap Paket 7 barang" mirrors shop.com's "Color Black"; groups sit on a steady 24px rhythm down to the 52px primary. Matches the reference hierarchy.
- Gallery (1440, `gallery-thumb-focus-1440`): strip present from first paint, current ring ink 2px, keyboard focus shows the purple ring around the thumbnail. Matches.
- Options (`multi-1440`): current pill ink-edged, the other white with hairline; no submit step. Matches shop.com behaviour.
- Sections (`bundle-1440`, `default-768`): Deskripsi open, clamped with the grey pill; shipping/payment rows with muted 20px icons. Matches the research capture's Description / Delivery pattern; copy is existing verified text.
- Related (`bundle-1440`, `default-768`): home shelf rhythm, 7 cards at 1440, cut card at 768. Matches the shelf contract.
- Phones (`default-390`, `buy-bar-390`): peek row with "1 / 2"; the buy bar sits flush above the dock, the dock's rounded corners show the bar. After a bar add (`buy-bar-added-390`) the feedback is in view and the bar is hidden.
- Enlarged text (`long-320-text200`): the buy bar stays off when the root text is above 20px (review 1: wrapped, it covered a third of the screen); the main button remains. Policy-row and step icons size in rem, so they grow with the text.
- States: out of stock (`oos-390`, `oos-1440`) shows the warning-coloured stock line, a disabled primary, disabled quantity steps (review 1) and the way out; unknown offer (`unavailable-768`) keeps the price, shows the option as a pill and says "Pilih opsi di atas untuk melihat isi dan stoknya." (review 1: the old line said nothing could be added).
- Shipping/payment rows use subject icons: truck (ongkir), clock (holidays), wallet (payment) (review 1: the payment row reused the stock checkmark). Stock line now 24px under the contents (review 1).
- Not changed after review 1: related card titles stay one line (owner override 2026-10-24, DESIGN.md "Product card title"); the sample photo slot label position is the shared fixture slot (sample products only, not catalog products).
- Known artifact: full-page phone captures paint the fixed dock at the first screen, mid-page; the bar is hidden in those captures and has its own viewport capture.
- Remaining owner content: the bundle description repeats the contents list (owner content, recorded since round 31); merchant photo claims remain under DEC-013.
- Review 2 fixes: out of stock says it once (the stock line), the way out is a secondary pill ("Lihat pilihan tersedia" / "Cari produk tersedia") instead of a 12px link, and the label row no longer appends "· Belum tersedia"; the unknown-offer state keeps only the callout (no second hint); the stock line after "Lihat N barang lainnya" sits on the 24px rhythm (the 44px summary carries the space); render captures load and decode lazy photos before a full-page shot (the 320/200% related card was blank in the capture); fixture option names no longer repeat the field label.
- Not changed after review 2, owner decision: the phone PDP keeps the shared store header and category rail (owner call 2026-10-24, "mirip sama halaman lain yang ada searchnya"), so the title starts lower on the first phone screen than on shop.com; the buy bar covers the first-screen title only while the main button is below the fold. Raise with the owner if the first phone screen should show the title. The clamp ellipsis after a sentence period ("lengkap....") is the browser's line-clamp marker.
