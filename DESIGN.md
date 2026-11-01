# 99ribu storefront design system

The public storefront (home, `/kategori`, `/kategori/<slug>`, `/cari`, `/produk/<slug>`, `/keranjang`, `/bantuan`, `/masuk`, `/promo`, placeholders) as implemented. Checkout, receipt, account and admin reuse the shared tokens but keep their own accepted compositions (`docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md`).

Sources, in order of authority:

1. Owner decisions recorded in `docs/spec/design/references/shop-com/visual-context.md` (the observed visual contract: shop.com measurements, what 99ribu ships instead, every override, and the render evidence the design gate reviews). When this file and that one disagree, that one wins and this file is corrected.
2. `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md` and `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md` (canonical design and screen contracts).
3. The code: `src/app/globals.css` imports the ordered area files in `src/app/styles/` (tokens in `01-base-tokens.css`, then cart, checkout, receipt, sign-in, interaction and type, header and search, product card, home and footer, listing, promo banners, product page (12a, then 12b with the S123 sign-in, contact-suggestion and receipt account rules at their original cascade position, then 12c), account; later files override earlier ones), components in `src/components/storefront/`.

Direction: shop.com's layout, spacing, type rhythm, component patterns and interaction behaviour, transferred 1:1 where it fits; never its name, logo, copy, imagery or trademarks. 99ribu keeps its `99rb.` wordmark, Inter, purple `#5b35d5`, warm yellow `#f6c945`, Indonesian copy and a distinct phone composition (T-17).

## UX concept

The storefront sells one thing: complete options at one fixed price (Rp99.000). Every surface serves that promise.

1. **Contents before price.** Price is the same everywhere, so cards stay quiet (one-line title, regular-weight price) and the PDP and cart lead with what is inside each option ("Isi yang diterima", "Isi saat ditambahkan").
2. **Browse like a feed, decide like a form.** Discovery surfaces (home, category, search) are photo-led feeds of shelves, curation cards and grids that keep loading; decision surfaces (PDP buy box, cart, checkout) are calm single columns with one primary purple pill.
3. **Every card is a real link to a real list.** Curation cards, highlight cards, banners and shelf titles open a listing URL that shows the same products (no decorative dead ends, no invented claims such as "terlaris" without data).
4. **Server HTML first.** Every page works without JavaScript (GET forms, real links, `rel="next"`); islands only add speed (infinite scroll, arrows, popovers, cart pending states).
5. **One purple action per view.** Purple is reserved for the primary action and the current place; secondary actions are white or 4%-grey hairline pills.
6. **Phone is its own composition.** Dock with the raised Cari action, bleeding shelves, bottom sheets for filters, the PDP buy bar; desktop gets hover arrows and sticky rails.
7. **Honest states.** Stock, publication changes, expired carts and unknown results are said plainly with the next step; nothing is reserved or promised that the system does not do.

## Owner overrides (current)

These are decisions, not findings. Details and dates are in visual-context.md.

- Product card price: 12/16 at weight **400**, full ink (owner 2026-10-25 15:57, commit `eb870b0`; this replaces the 13:32 call for 600, and shop.com's 600 is not followed).
- Product card title: one line with an ellipsis, 14/18 weight 600 (shop.com `line-clamp-1`).
- Content width capped at **1250px**, centred (shop.com is wider).
- Phone header has **no logo**; the omnibox takes the width, home is the dock's first tab.
- Header actions order: Promo, Cart, Account; Promo shows only when `/promo` has content.
- Desktop shelf arrows kept (shop.com's desktop carousel control).
- Current category pill: soft lavender fill `rgba(91,53,213,.08)`, no underline (round 35).
- Home banners (owner 2026-10-29, supersedes rounds 50-53): "Temukan pilihan" rail of shop.com curation cards, 410×520 (362 at ≤1210px, 265 on phones), the photo full-bleed under a top scrim and a bottom gradient, title and subtitle at the bottom, three fanned product thumbnails from the banner's department.
- Category and search listings (owner 2026-10-30): pages hold 30 cards; five rows show first (10 cards on phones in two columns, 15 at three, 20 at four, 30 at six), each scroll to the end shows five more rows from the cards already loaded, and the next page is fetched only when they run out (three automatic pages, then "Lihat produk lainnya"). Hidden cards' lazy photos are not fetched. Without JavaScript every card and `rel="next"` stay.
- PDP "Lainnya di <kategori>" (owner 2026-10-30): at most 25 cards; two rows first, then one more row each time the end of the grid enters the viewport, five at most; the heading links to the category for the rest.
- Phone PDP buy bar (owner 2026-10-30): the main buttons count as out of view under the dock too, so the bar is up on the first screen when the dock covers them.
- Home order (owner 2026-10-29): hero, Kategori grid, three department highlight cards, the category switcher (always seven cards, filled from the newest), "Temukan pilihan" banners, then "Terbaru" as a grid of four rows per width with "Lihat produk lainnya" (the first press reveals the rows already loaded, later presses load the next page; never the whole catalog).
- Header is not sticky (owner 2026-10-29).
- Wordmark reveal: "99rb." grows into "Serba 99ribu." on hover/focus from 1024px with a fine pointer.
- Phone dock (owner 2026-10-28, supersedes the icon-only four-tab dock, then icon-only again the same day): five icon-only tabs, Beranda, Kategori, **Cari**, Keranjang, Akun (the names stay as visually hidden text). Cari is the raised primary action (52px purple disc, 14px above the bar, white ring; a yellow ring while on `/cari`). Active tab: filled ink icon on a fully rounded lavender pill (60x44). Cari opens a full-screen search sheet (native modal dialog with catalog suggestions and departments; a real `/cari` link without JavaScript). The header omnibox stays on every page except the phone product page.
- Phone product page (owner 2026-10-28, marketplace pattern): the header with its search steps aside; a floating bar sits over the full-width square photo: back on the left; share, cart (unit count badge) and a "more" popover (Beranda, Kategori, Cari produk, Chat bantuan, Akun) on the right; it turns solid white and shows the product name after a 240px scroll (`components/storefront/product-bar.tsx`, `Shell`'s `productBar` prop). Once the in-page buy buttons scroll out, the dock hides and a sticky bar takes the bottom edge: chat icon, add-to-cart icon (outlined, name for assistive tech only) and the wide purple "Beli sekarang" (add, then checkout). Both bars are phone only (up to 700px).

## Storefront typography, color and spacing (shop.com-aligned, 2026-10-25)

Measured live on shop.app on 2026-10-25 (Chromium, 1440px) and applied in S143 to every public page: home, `/kategori`, `/cari`, the PDP, `/keranjang`, checkout, receipts, `/masuk`, `/akun`, help/static pages, header, footer and dock. Admin keeps its own Tailwind tokens. All tokens live in `:root` in `src/app/styles/01-base-tokens.css`; use the token, not the literal.

**Font.** shop.com sets GT Standard Web (Grilli Type, variable 300–900, a commercial licence), so it is not copied or hotlinked. 99ribu keeps the self-hosted Inter 4.1 variable (SIL OFL, `public/fonts/inter-4.1/`, 44KB Latin subset preloaded) and matches shop.com's sizes, line heights, weights and tracking; no font dependency is added.

### Color

| Token | Value | Use | Contrast (canvas / white) |
|---|---|---|---|
| `--ink` / `--ink-hover` | `#121212` / `#282828` | Text, filled active chips, dark pills ("Beli sekarang", chip clear), focus edges, last breadcrumb. Owner 2026-10-30: never pure `#000`; shop.com's own near-black `rgb(18,18,18)` and its `rgb(40,40,40)` for hover | 18.3 / 18.8:1 |
| `--muted` | `#707070` | Secondary UI text, inactive labels, help lead (the solid grey shop.com's `rgba(0,0,0,.56)` gives on white) | 4.83 / 4.95:1 |
| `--caption` | `#707070` | Captions 12/16 500: breadcrumb, omnibox caption, text on light tints (readonly field, receipt step tags, affiliate figures) | 4.83 / 4.95:1 |
| `--canvas` | `#fcfcfc` (oklch .988 0 0) | Storefront page background (`:root:has(body > .store-header)`) | — |
| `--surface` | `#fff` | Cards, popovers, sheets, footer, checkout and receipt frames | — |
| `--purple` / `--purple-hover` | `#5b35d5` / `#4823b6` | Brand: primary pills, prose links, focus outline, accents (7.0:1 on canvas) | — |
| `--yellow` | `#f6c945` | Wordmark dot, hero tint | — |
| `--line` | `rgba(0,0,0,.1)` | Dividers (checkout, receipt, account, cart), as shop.com's 1px lines | — |
| `--hairline` | `rgba(5,41,77,.1)` | shop.com's 1px/0.5px edge on white: chips, card frames, popovers, help cards, secondary pills | — |
| `--field-border` | `#858585` | Form-field boundary (3.7:1 on white; shop.com's 20% black edge is 1.5:1 and is not followed); the dock's inactive icons and labels use `--muted` | — |
| `--error`, `--error-surface` / `--warning`, `--warning-surface` | `#8b241d`, `#fff4f2` / `#9c3f0a`, `#fff5ed` | Error and warning text, edges and surfaces | — |
| `--tint-rose` … `--tint-slate` | `#fde8ec`, `#fdf0d5`, `#e2f3e5`, `#e2ecfb`, `#ede7fd`, `#ddf3ef`, `#ececef` | Department tints (pill circles, category tiles, banner cutouts), chosen by `departmentTint` in `sections/category-pills.tsx` | — |

Neutral greys are shop.com's: 4% black fill (`#f5f5f5` solid), `#efefef`, `#3f3f3f`; the earlier violet-tinted greys were replaced on 2026-10-30, while purple tints that mark brand states stay. `--muted` keeps 4.5:1 down to the 4% fill (4.54:1 on `#f5f5f5`); darker fills use `--ink`. Icons take `currentColor`. Disabled controls keep their own greys.

### Type scale

Body on storefront, checkout and receipt shells is 16/22 at -0.5px (`body:has(> .store-header, > .checkout-header, > .receipt-shell)`); text without its own role inherits the 22/16 ratio. Tracking follows size: -1px from 20px, -0.5px at 16–18px, -0.2px at 12–14px (`--tracking-tight/-body/-small`).

| Role | Token | Size/leading, weight, tracking |
|---|---|---|
| Home hero heading | `--hero-size/-leading` | 64/58 800 -1px (phones 36/38) |
| Page heading (global `h1`: category, search, cart, help, checkout, receipt, account) | `--page-size/-leading` | 36/38 800 -1px (phones 28/30) |
| Category/search section heading (`.listing-main h2`, `.categories-main h2`) | `--heading-size/-leading` | 24/26 600 -1px (phones 18/20) |
| PDP title | `--heading-size` | 24/28 **500** -1px (owner 2026-10-25: medium, so the 600 price leads; shop.com uses 600) |
| PDP spacing | — | 32px under the store header (24 tablet, 16 phone), gallery sticky at 32px; breadcrumb → title 8px; title → price 12px; price 20/24 600 -0.5px (owner 2026-10-25; shop.com 16/22); no Simpan/Bagikan row under the actions (owner 2026-10-28; the phone bar keeps its Bagikan icon); card prices 12/16 400 (owner); photo width follows the viewport height (`100svh − 12.5rem` desktop, `65svh` ≤760px tablet); desktop thumbnail rail centred on the photo, capped at the photo height and scrolling when there are many photos (the current thumbnail kept in view) |
| Section heading (global `h2`, `.shelf-heading`) | `--title-size/-leading` | 20/22 600 -1px (phones 18/20 -0.5px); PDP section headers (Deskripsi, Isi yang diterima, Pengiriman, Pengembalian) are 18/20 600 -0.5px at every width (shop.com 18/20 at 1440 too, 2026-10-29) |
| Phone title, sheet title, card headline | `--subtitle-size/-leading` | 18/20 600 -0.5px |
| Body, inputs, PDP price, card headings (global `h3`) | `--body-size/-leading` | 16/22 400 (headings and price 600) -0.5px |
| Buttons, category pill label | `--body-size` | 16/20 600 -0.5px |
| Card title, chips, secondary text | `--small-size/-leading` | 14/18 600 (text 400) -0.2px; 14/20 in running text |
| Card price | `--caption-size/-leading` | 12/16 **400** -0.2px, ink (owner; shop.com captionBold is 600) |
| Field labels, captions, breadcrumb | `--caption-size/-leading` | 12/16 600 (labels) or 500 (captions, `--caption`) -0.2px |
| Switcher label | literal | 96/96 800 -1px (phones 42/42) |

Weights in use: 400, 500, 600, 800 (the wordmark keeps its own 850–900).

### Spacing and radii

- Spacing is a 4px scale: 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, then 40/48/56/64 for section rhythm. Groups: 8px inside a group, 16px between related groups, 24px between buy-box groups (shop.com: quantity pill → actions 24px, actions → first section 32px), 40px between home sections (shop.com measures 38–40px at every width; was 48px, 2026-10-29), 40px before the footer from 701px and 24px on phones (shop.com about 41/29; was 64/40). A section heading's visible box is 22px (20px on phones) with 16px to its content; the link keeps a 44px hit area as a pseudo-element. Off-scale values left on purpose: shop.com's 10px banner-rail gap, omnibox field geometry, badge insets, and the receipt's ≤22rem first-screen compression (S27).
- Card grids: 16px gaps from 768px and 8px on phones on listings and search; home product shelves (`.shelf-row`) use **8px** gaps at every width (owner 2026-10-29, matching shop.com's 7.7px 1440 measure). The PDP related grid keeps 32px column gaps on desktop (S139) and 16px on phones (shop.com 171×247 cards). Row gaps stay small because each card spans four subgrid rows, so the row gap repeats inside the card. Home category tiles are 124px tall with 8px gaps from 768px (shop.com 247×124); `/kategori` uses the same tile. Listings start 24px under the header (was 40px).
- Footer: menu columns at least 184px wide, 14/18 headings at 500 with 16px to the first link, 14/18 400 -0.2px links on a 30px pitch (44px targets on phones), 24px bottom padding; re-measured on shop.com 2026-10-25 and 2026-10-29.
- Radii: 8px thumbnails and small boxes (checkout choices, receipt code box, status panels); 12px fields; 20px cards and photos (product frames, PDP photos, help cards, cart and checkout summaries, receipt and account cards); 28px hero cards, banners, popovers and sheets; 32px omnibox; 36px home hero; 9999px pills and buttons.

### Breadcrumb

PDP (and any page that needs one): `<nav class="breadcrumb" aria-label="Lokasi halaman">` with an `<ol>` of real links, "Beranda" (`/`) then the category (`/kategori/<slug>`), 12/16 500 in `--caption`, the last crumb in ink, a 14px chevron (`Icon name="forward"`, aria-hidden) kept with the crumb after it; each link keeps a 44px target while the row takes one 16px line. The product title (`h1`) sits 8px below. The visible trail matches the `BreadcrumbList` JSON-LD (Beranda → category → product). Mobile and desktop are the same; on phones the category rail is hidden on the PDP (DEC-019), so the breadcrumb carries the category.

### Shape, elevation, motion

- Radius: the scale under "Spacing and radii" above; filter rows 16px.
- Shadows: resting surface `0 2px 8px rgba(0,0,0,.06)` (cards, chips, secondary pills, desktop filter popover); shelf and gallery arrows `0 4px 24px rgba(0,0,0,.12)`; hero and phone filter sheet `0 8px 40px rgba(0,0,0,.24)`; omnibox open `0 12px 64px rgba(0,0,0,.24)`; PDP primary pill: inner highlights plus `0 4px 24px rgba(91,53,213,.24)`.
- Motion: CSS only, transform/opacity/colour. Controls 150ms `cubic-bezier(.4,0,.2,1)` on colour, background, border and shadow (no lifts). Omnibox and wordmark 240-320ms `cubic-bezier(.2,0,0,1)`. Photo hover scale 1.05-1.08 (150-300ms ease-out). Everything is off under `prefers-reduced-motion: reduce`.

### Layout

- Container `.wrap`: `min(1250px, 100% - 2 × gutter)`.
- Breakpoints in use: ≤700px phone composition (dock, no header actions, bleeding shelves) / ≥701px header grid; 1023/1024 (gutter, grid columns); 1050 (PDP columns); 1279/1280 (shelf 7 cards, category grid 5 columns); 1440 (gutter).
- Product grid: 6 columns from 1024px, 4 from 768, 3 from 701, 2 on phones; gaps as in "Spacing and radii". Shelves: 7 cards from 1280, 4.6 from 701, 2.3 on phones bleeding to the screen edge.

## Components

`src/components/storefront/`:

| Path | Role |
|---|---|
| `ui/icon.tsx` | The icon set: `Icon` (outline, Lucide geometry, 2px stroke, `size` attribute) and `FilledIcon` (filled variants of home/category/cart/user for the active dock tab). Every storefront glyph comes from here; no inline SVG in pages. |
| `ui/brand.tsx` | `Wordmark` ("99rb." inside a `.brand` element) and `SiteNotice` (skip link + local-simulation notice), shared by the shell and the checkout frame. |
| `ui/media.tsx` | `CatalogImage` (a catalog `<img>` with srcset candidates from Next's image optimizer; plain server-rendered markup) and `optimizedUrl`. |
| `ui/product-card.tsx` | `ProductGrid` (cards as a grid or a shelf row), `Media` (photo or the photo slot), naming helpers. The card: square 20px frame with the hairline overlay, one-line title, price. |
| `ui/shelf-arrows.tsx` | Carousel arrows for any `.shelf-row`/`.banner-row` (hydration-only, disabled at the ends, one view per press). |
| `sections/` | Page sections: `home-hero`, `hero-video`, `category-grid`, `category-highlights` (three department cards: cover, name link, three product tiles), `category-switcher` (tabs), `promo-banners` (`BannerCard` curation card with fanned thumbnails; also the admin banner preview), `category-collections` (category feed cards: title with round arrow, one shelf), `category-pills` (header pill row), `search-box` (omnibox combobox), `dock` (phone dock: five icon-only tabs plus the Cari search sheet, a modal dialog), `filter-chips` (chip rail + popover/sheet), `filter-panel` (no-JS form), `listing` (listing page: category header with breadcrumb, collections, chips, grid), `listing-more` (infinite scroll; `auto` pages before the button, `reveal` for a CSS-capped first page), `catalog-listing` (server data for `/cari` and `/kategori/<slug>`, including the collections), `product-gallery` (PDP photo row, thumbnails, arrows). |
| top level | Page chrome and flows: `shell`, `navigation` (product links, task Back), `checkout-*`, `cart-forms`, `order-receipt`, `offer-picker`, `sign-in-panel` (server: session state and role redirect), `sign-in-form` (client form, also posts without JS), `sign-in-modal` (the `<dialog>` for the intercepted `/masuk`), `sign-up-form` (S123: `AuthForms` holds the Masuk/Daftar mode, the sign-up form, the check-email state and `ResendForm`), `sign-in-copy` (failure copy and `/masuk` URLs for both sides), `order-account` (S123 receipt cards: save to account, link order), `sign-out-button`, `buyer-account-client`, `placeholder-page`, `json-ld`. |

Buttons, chips and fields are CSS roles, not components: `.button` (primary purple pill), `.button.secondary` / `.button-secondary` (white hairline pill in storefront shells), `.filter-chip`, the field look (below). Add a component only when a second caller exists.

## Blocks

Page compositions, top to bottom. A block is a section that can be reused on another page with the same markup and CSS; blocks reuse the components above and add no new tokens.

| Page | Blocks |
|---|---|
| Home `/` | Hero card (video/photos, sign-in state) → Kategori grid (tiles with tint and photo) → Department highlights (3) → Category switcher (large names over a 7-card shelf) → "Temukan pilihan" curation banners → "Terbaru" grid (4 rows, "Lihat produk lainnya") |
| Kategori `/kategori` | Page heading and lead → Category grid (every department) → Subcategory links → next-page link |
| Category `/kategori/<slug>` | Category header (title, lead, breadcrumb) → Collections (feed cards, clean URL only) → "Semua produk" → Filter chips → Product grid with infinite scroll and `rel="next"` |
| Search `/cari` | Title ("Hasil untuk …") → Filter chips (with the category chip) → Product grid → empty state with a recovery link |
| Product `/produk/<slug>` | Breadcrumb → Gallery (thumbnail rail, photo row) beside the buy box (title, price, option pills, contents, stock, quantity pill, add/"Beli sekarang") → Spesifikasi → accordions (Deskripsi, Isi yang diterima, Pengiriman dan pembayaran, Pengembalian) → "Lainnya di <kategori>" shelf; phone product bar and buy bar |
| Cart `/keranjang` | Heading row → feedback region → Store card (lines, summary, checkout) → "Mungkin Anda suka" rail; empty, denied, expired and submitted states each with one recovery action |
| Checkout, receipt, account, sign-in, help, static pages | Their own accepted compositions (rules below and `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md`), sharing the shell, tokens, fields and pills |

Shared chrome on every storefront page: skip link → header (wordmark, omnibox, Promo/Cart/Account) → category pill row → main → footer (wordmark note, three link columns, legal row) → phone dock.

Reusable block patterns (one CSS rule set each): **section heading link** (`.shelf-heading`: 20/22 title with a forward chevron, 44px hit area); **shelf** (`ProductGrid shelf` + `ShelfArrows`); **feed card** (`.collection-card`, `.highlight-card`, `.cart-card`, `.cart-rail`: white, hairline, 28–36px radius, small shadow); **curation banner** (`BannerCard`); **pill action** (`.button`, `.button.secondary`, the 44px grey cart pill); **empty state** (`.empty-state`: h1/h2, one sentence, one action).

## Interaction rules

- Links: running prose keeps its underline (WCAG 1.4.1); standalone storefront links change colour on hover, no underline. Admin keeps hover underlines.
- Current page: `aria-current="page"` plus the lavender fill (header icons, pills, "Semua kategori"); dock tabs show the filled icon in ink on a lavender pill with the label at 600, and Cari a yellow ring; only one dock tab is current (a `/cari?category_id=` listing marks Kategori, not Cari).
- Fields: 1px `--field-border`, 12px radius, 44px minimum; focus shows an ink edge plus a 3px soft ring at the same width (no shift); invalid adds the error edge. Selects carry one custom chevron.
- Floating labels (owner request 2026-10-25, S141; `.checkout-field` in `styles/03-checkout.css`, used by checkout contact/address fields and the order-link fields on the receipt): the `<label for>` sits inside its control, in the same grid cell, at 16/22 400 `--muted` at rest and on focus (it does not move on focus; ink while focused, `--error` when invalid); once the control has a value (typed, autofilled, server-prefilled, restored) it shrinks to 12/16 500 at the top of the field (the control is 56px with 24px top padding). CSS only: text controls carry `placeholder=" "` so `:placeholder-shown` means empty, `:autofill`/`:-webkit-autofill` and a non-empty select option count as filled; selects hide their empty "Pilih ..." option text while the label shows, and a textarea gets a white strip under the shrunk label so long text does not run through it. Sizes are rem and the label wraps (`overflow-wrap: anywhere`); when the field is narrower than 13em (a container query on the field, so it follows the text size: 320px at 200% text) the label falls back to a plain 16/22 500 label above the control, so a wrapped shrunk label never overlaps the value and nothing clips. Errors, hints and `aria-describedby` stay below the control; the blank placeholder is never the accessible name. Sign-in, sign-up, profile and the filters keep their own field looks (they do not use `.checkout-field`).
- Checkout summary (S143 polish 2026-10-27): the disclosure title ("Ringkasan pesanan" / "Lihat ringkasan") is 16/22 400; each line's contents use filled bullets at a 20px inset, the same as the cart's list (a list nested in the summary's lists would otherwise show hollow circles).
- Cart page (owner 2026-10-29, shop.com cart; supersedes the 2026-10-28 Dawn table; `keranjang/page.tsx`, `cart-forms.tsx`, `styles/02-cart.css`): a heading row ("Keranjang", "Lanjut belanja"), then one white store card (36px radius, 28px on phones; hairline; small shadow; 20px padding): the purple "99" mark with "99ribu" and "Rp99.000 per pilihan lengkap"; each line an 80px photo (20px radius) beside the 2-line 14/18 600 name link, the option caption, the "Isi saat ditambahkan" list (three items, the rest folded) and the right-aligned line total; below, the 44px grey quantity pill, the "Perbarui jumlah" pill (purple once the quantity is unsaved) and "Hapus" (on phones the actions take the full row). The card closes with a hairline, "Estimasi total (N pilihan)" with the 18px amount, the caption advisory (shipping and adjustments at checkout, no stock held) and the 52px full-width "Lanjut ke checkout". From 1055px the layout is 3fr / 2fr with a sticky "Mungkin Anda suka" rail (five newest available products not in the cart, claim products excluded; 80px photo, name, option, price, a grey "Tambah ke keranjang" pill using the PDP's add mutation); 761–1054px the rail sits under the card; hidden on phones. Not built (no source): save for later, compare price, order note, shipping progress bar.
- Account page (owner 2026-10-28): restrained Dawn-aligned cards and shop.com tokens; signed-out account actions beside guest lookup from 701px (collapsed lookup below the actions on phones); signed in, three short pages under the identity header and one underlined tab row (owner 2026-10-28, Shopify customer accounts pattern): `/akun` opens `/akun/pesanan`; `/akun/profil` holds Data diri as a read-only summary with "Ubah" opening the form, Alamat, and Data tambahan (opsional); `/akun/pengaturan` holds Promo & notifikasi and Keamanan; tabs share the width on phones, no rail and no sticky chips; the identity header is as wide as the content (56rem); feedback appears under the tabs; optional fields read "Belum diisi" as quiet text and "Terisi" as a badge; disclosures use one chevron; consent rows are 44px with the destination contact in the state line and no policy id on screen (the version stays on the record); order cards show WIB dates, text status badges, lazy thumbnails, filter/search and guarded “Beli lagi”; no version badge or completeness meter.
- Filters (shop.com 2026-10-24): a scrolling chip rail (8px gaps, 4px on phones, bleeding to the screen edge on phones, edges fading only toward the side that still scrolls). Each chip opens a 300px popover 5px under it, left-aligned to the chip and kept inside the content column (owner 2026-10-25) on desktop (whole pixels, 16px inside the viewport, above it near the bottom) or a bottom sheet with title and close on phones (40% scrim). Rows are 44px with a radio on the right (a check box for multi-choice facets); choosing a row applies at once (a GET link, owner decision); "Atur ulang" clears the filter, "Selesai" closes. Focus starts on the selected row, arrows/Home/End/typeahead move, Escape and light dismiss close and focus returns to the chip. Without JS, the native GET form in `<noscript>` replaces the rail.
- Product page (shop.com 2026-10-24, S139 2026-10-25): media column (48px server-rendered thumbnail links from 1051px, a scroll-snap row of square 20px photo cards with hover arrows from 701px, sticky from 701px; phones (owner 2026-10-28): one full-width square photo per view from the top edge under a floating back / share / cart / menu bar, with a "N / M" counter) beside a buy box in shop.com's order, groups 24px apart: breadcrumb ("Beranda › <kategori>"), title, price; "Pilihan lengkap <value>" with option pills that are links (switch at once); contents, stock, quantity pill (native number field between minus/plus), 52px primary pill; Spesifikasi; 52px accordions (20/22 600 -1px): open Deskripsi (with "Isi yang diterima" closed under it) (cut at 8 lines with a bottom fade and "Baca selengkapnya", not a line-clamp ellipsis that printed "lengkap...."; "- item" and "1.item" lines render as real lists with a 20px/24px hanging inset via `modules/storefront/description.ts`, and the cut only shows when the text surely passes 8 lines) and "Pengiriman dan pembayaran" icon rows, closed Pengembalian; then the "Lainnya di <kategori>" shelf. Phones replace the dock with a buy bar (chat, add-to-cart icon, "Beli sekarang") while the main button is out of view. PDP-only rules live in `src/app/(storefront)/produk/[slug]/product.css` on top of the globals block.
- Omnibox: one glass surface grows down over the page on focus (no layout shift); combobox with listbox options; Escape/blur/outside click close; works as a plain GET form without JS.
- Carousels: native scroll and snap, hidden scrollbars, arrows only on hover-capable desktop, no autoplay (WCAG 2.2.2).
- Sign-in (shop.com 2026-10-24, S112): one centred 344px column (wordmark, 32/35 800 heading, 16/22 muted lead, labelled 52px pill fields with the 4% ink fill, the 52px primary pill, a 12/16 footnote). Errors sit under the fields (14/20, error edge on the field) and take focus. `/masuk` is the page; storefront links open the same content as a modal (`@modal/(.)masuk`): a native `<dialog>` centred from 701px, a bottom sheet on phones, focus kept inside, Escape/close/scrim go back and focus returns to the opener. Without JS the form posts to `/masuk/kirim` and comes back with the step or error in the URL.
- Sign-up (owner decisions 2026-10-25, S123): the same column and modal with a "Masuk / Daftar" pill switch (real links `/masuk` and `/masuk?langkah=daftar`, `aria-current`; with JS the form swaps in place). Nama, Email, Nomor WhatsApp, consent footnote; no password: a new and a registered email both land on "Cek email Anda untuk verifikasi" (60 s resend cooldown) and the emailed link opens `/masuk/atur-sandi` ("Buat kata sandi", 44px show/hide toggle, live hint), which activates the account and signs in back to `next`. Errors name their cause. Receipts show "Simpan pesanan ini ke akun" to the guest holding the order (email, name and phone pre-filled) and "Hubungkan pesanan ini ke akun" to a signed-in buyer who does not own it. Without JS the forms post to `/masuk/kirim` (`step=signup|resend|reset`).
- Contact inputs (owner 2026-10-25, every storefront form with a phone or email): phones keep digits only, a pasted `+62…`/`62…` shows as `08…` (`inputmode="numeric"`, `autocomplete="tel"`, a `pattern` for no-JS) and are stored `+62…`; a WhatsApp number must be a mobile number (08); emails are trimmed with a lowercased domain on blur, and a common-domain typo gets a one-tap "Maksud Anda …?" fix under the field (never a block). Rules: `src/modules/storefront/contact.ts`; inputs: `ui/contact-fields.tsx`.
- Category page (owner 2026-10-29, shop.com curation page): a header of the title and the breadcrumb "Semua kategori › <Kategori>" only (owner 2026-10-30: no lead line; centred with 40/16/36px rhythm and a 14px breadcrumb from 701px, left-aligned with 20px rhythm and a 12px breadcrumb on phones); on the clean URL only, feed cards two per row from 1025px ("Baru masuk", then "Paket campuran" when there are four bundles, otherwise "Jelajahi <next department>"; 28px radius, hairline, small shadow and medium on hover, 24px padding, 24/26 title with a 36px round arrow on a 4% fill, a shelf of four cards per view, 2.6 on phones; a lone last card spans the row with eight per view); then "Semua produk", the chips and the grid. Search keeps the plain left-aligned title.
- Listings: the first page is server HTML with a crawlable `rel="next"`; the next pages append automatically three times, then "Lihat produk lainnya" keeps the footer reachable.

## Accessibility

- Targets at least 44px (chips, pills, dock tabs, omnibox chips, arrows).
- Contrast: body and labels ≥4.5:1; large text and icons ≥3:1 (inactive switcher labels `#858585`; inactive dock icons and labels `--muted`, 4.8:1; Cari's label `--purple`, 7.2:1).
- Focus is always visible: a 3px purple outline globally, 2px ink rings on pills and tiles, an inset ink ring on dropdown items.
- Names: icon-only links carry `aria-label` (e.g. "Keranjang, N pilihan"); decorative images are `alt=""` and `aria-hidden`; tests depend on these names, so keep them.
- Patterns: WAI-ARIA combobox (omnibox), tabs with roving tabindex (switcher), popover dialogs (filters), modal dialogs (sign-in, the dock's search sheet), carousels with `aria-roledescription`.
- Forms: visible labels, `autocomplete` hints (`name`, `username`, `current-password`, `new-password`, `one-time-code`), `aria-invalid` plus `aria-describedby` on the field an error names.
- Everything works at 320px with 200% text: chips wrap inside their pill, grids drop to one column, the dock becomes static at short heights.
- Reduced motion disables every animation and transition listed above.

## Dashboard system direction (proposed 2026-11-02): staff console, buyer account, affiliate

Status: **proposed**, not accepted by the owner (DEC-026). Brief: [`design/brief.md`](design/brief.md). Size and surface contract for the console: [`design/admin-contract.json`](design/admin-contract.json). Evidence: storefront tokens `src/app/styles/01-base-tokens.css`, console tokens `src/app/admin/(console)/admin.css`, spec 10 (`docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md`), the shop.com measurements in `docs/spec/design/references/shop-com/visual-context.md`, a code audit of `/akun` and `/afiliasi`, and market research (section "References"). shop.com has no public seller or admin console, so what transfers is its visual language, not its screens.

**Direction in one line:** shop.com's calm neutral language (white surfaces on `#fcfcfc`, hairlines, charcoal ink, one purple action per view) applied to three dashboards that share one set of tokens, statuses, money rules and states, while each keeps the shell that fits its job.

### Three surfaces, one system

| | Console (staff) | Account (buyer) | Partner (affiliate) |
|---|---|---|---|
| Routes | `/admin/**` | `/akun/**` | `/afiliasi` |
| Job | Operate the store: see what needs action, act, reconcile | Follow orders, fix details, get help | See earnings honestly, share a link, get paid |
| Shell | Sidebar (256 px, tablet rail 64 px) and 64 px header; per-role nav | Storefront header and footer; tab row Pesanan, Profil, Pengaturan | Storefront header and footer; section anchors or tabs |
| Controls | 36 px (44 px on coarse pointers), 8 px radius, 48 px table rows | 44 px, storefront pill buttons, 12 px fields | same as Account |
| Component source | shadcn/ui (`radix-vega`) + Tailwind v4, `admin.css` | storefront CSS (`13-account.css`) and native HTML, server-first | storefront CSS (move out of `04-receipt-support.css`) and native HTML |
| Density | Compact for mouse, comfortable for touch | Comfortable, one column on phones | Comfortable, one column on phones |

Shared by all three: neutral canvas, ink `#121212`, hairline `rgba(0,0,0,.1)`, purple `#5b35d5` reserved for the primary action and the current place, Inter, functional SVG icons (no emoji), flat surfaces, and the rules below. The portals (Account, Partner) are **not** migrated onto shadcn: they are public-facing, server-first pages that should not load the console's CSS or client bundles. They share **tokens**, not a component library (owner decision O-2).

### Rules shared by all three surfaces

- **Status** is icon plus Indonesian text plus tone, never colour alone (`components/admin/status.tsx` tones: open, progress, problem, done, closed, danger, neutral). Portals use the same tone names and the same wording for the same state.
- **Money** is whole rupiah, `Rp` with dot thousands (`id-ID`), tabular numerals, right-aligned in tables. An unknown amount shows "—" or "Belum lengkap", never Rp0. An amount that can still be reversed carries the words "Estimasi, bisa berubah" or its maturity date; the word "valid" is not used for anything reversible. Distinct balance states are never summed into one number (spec 17 line 694).
- **Time** is shown in WIB with the zone stated next to a period.
- **States:** a skeleton that matches the final geometry; first-run, filtered-empty, denied and error are four different messages; an error names the cause and the recovery and keeps what was typed; a toast never carries an error.
- **Copy:** concrete Indonesian sentence case, no filler, no guarantee of earnings, no invented urgency or scarcity.
- **Privacy:** no buyer name, address, phone or bank data in affiliate views (UX-3); no HPP or seller amounts on buyer or affiliate surfaces (DEC-007); guest orders stay summary-only until a claim is confirmed (DEC-016).
- **Evidence:** a visible change is done only with rendered proof at 390, 768 and 1440 px (console also 1366 and 1536).

### Console token alignment (admin tokens move to the storefront neutrals)

| Token | Console today | Direction |
|---|---|---|
| Canvas | violet-tinted `oklch(.991 .001 286)` | `#fcfcfc`; surfaces `#fff` |
| Ink | `#18181b` | `#121212` (no `#000`, owner 2026-10-30) |
| Muted text | `oklch(.474 …)`, darker than `#707070` | keep: it holds 4.5:1 on the 4% fill; never lighten |
| Border | `#d8d8df` | hairline `rgba(0,0,0,.1)`; field border `#858585` (already equal) |
| Sidebar and neutral fills | blue-violet greys | neutral `#f5f5f5` and `#efefef` (the storefront dropped violet greys on 2026-10-30) |
| Purple | `#5b35d5` | unchanged; current nav item `rgba(91,53,213,.08)` with `aria-current` |
| Radius | 8 px base, scale 4/6/8/12 | keep; buttons are not pills in the console; full radius only for avatars and status dots |
| Page title | `text-2xl font-bold`, 24 px / 700 (measured) | keep; spec 10 line 78 says 28/36 weight 600, owner decision O-1 whether to amend the spec to the measured value |
| Body, table, form text | 14 px; meta 12 px; inputs 16 px on phones | keep (contract roles) |
| Controls | 36 px (buttons 32/36/40), 44 px on `pointer: coarse` | keep; above the dotuiux 24 px floor |
| Table | head 40 px, rows about 48 px, cell padding 8 px | keep; add sticky header and sort (S150) |
| Motion | none defined | 150 ms `cubic-bezier(.4,0,.2,1)` on colour, background, border, shadow; no hover lift; off under reduced motion |
| Dark mode | none | none (spec 10 light-only; plan decision D6 open) |

The console already measures to the house contract (buttons 32/36, input 36, header 64, sidebar 256, table head 40, radii 6 and 8, no shadow outside overlays, title 24/700; baseline 2026-11-02 in `BUILD-LOG.md`). The only literal colour in console code is `tint: "#efeafd"` in `banners-client.tsx`.

### Account and Partner token cleanups (from the code audit)

| Finding | Direction |
|---|---|
| Affiliate uses hard-coded `#f4f0ff` and `#d9d0fb` and many inline `style={{…}}` | Use the purple tint token and named classes; no inline styles in pages |
| Buyer defines local `--account-info #153d72` and `--account-success #19582c` | Use the shared tone tokens for info and success |
| Buyer and affiliate cards use 20 px radius and 24 px padding for data blocks | Data blocks (balances, order lists, tables) use 12 px radius and a hairline; pills stay for buttons and chips |
| `--muted` means text colour in the storefront and surface colour in the console (`01-base-tokens.css:296` documents the workaround) | Add `--text-muted` and `--surface-muted` aliases in both token files and migrate usage gradually (S159); no big-bang rename |
| Affiliate has no tab or section nav; buyer has tabs | Affiliate gets the same tab-row pattern as Account |

### Console dashboard, tables and forms

- **Dashboard order:** header with scope and period (and compare when allowed); Perlu tindakan (attention tiles ranked by count, each opening its exact filtered queue, items older than 24 h marked by text and icon); money strip (basis badge on every figure, delta chip only for event-period metrics, "—" and "Belum lengkap" when an input is missing); work-queue tabs over a table. Charts only with a tabular alternative, one series each, purple plus neutral, comparison as a dashed neutral line. Metric policy D2 blocks acceptance (`docs/spec/02-PRD.md` line 449).
- **Tables:** one `DataTable` behaviour: sticky 40 px header, 48 px rows, neutral 4% hover (no lift), numeric and money columns right-aligned with tabular numerals, sortable columns with an arrow icon and `aria-sort`, server-side keyset sort from a short allow-list with an id tie-breaker, sort and filters in the URL (never private contact searches), selection on the current page only, a card list below `md`, distinct states, "N dari M" in the footer.
- **Forms and editing:** sectioned blocks, one sticky action bar with a single purple "Simpan perubahan", a dirty guard, a reason and `expected_version` for versioned changes, whole-rupiah fields with live floor and ceiling hints (Rp1 to Rp99.000, DEC-025), the offer editor as a table on desktop and cards on a phone, polite live-region announcements and focus on failure.

### Console component stack: shadcn/ui and Tailwind v4

Facts [verified 2026-11-02 with `shadcn info --json`]: `components.json` style `radix-vega`, base `radix`, RSC on, Tailwind v4 (4.3.3, no config file), CSS file `src/app/admin/(console)/admin.css`, CSS variables on, icons `lucide`, aliases `@/components/ui`, preset values neutral and Inter with default radius, CLI `shadcn` 4.23.0 and `radix-ui` 1.8.1 in `package.json`. No `@tanstack/react-table` is installed.

- **Installed (15):** alert, badge, button, dialog, dropdown-menu, empty, field, input, label, separator, sheet, skeleton, table, textarea, tooltip.
- **Custom (not shadcn):** admin sidebar (`data-slot=admin-sidebar`, not the shadcn Sidebar), `DataTable`, `KpiCard`, `FormField`, `SegmentedControl`, `StatusBadge`, `PageHeader`. Keep them; do not replace working primitives for resemblance.
- **Selection ladder** (shadcn-ui skill): native element, then an installed component, then a composition, then a new registry item after `view` and `add --dry-run`, then an installed dependency, then a minimum custom component, then a new dependency only with a reason. A native `<select>` and `<input type="date">` remain the default.
- **Candidates, dry-run only (nothing installed):**
  - No overwrite of existing files: checkbox, select, popover, tabs, switch, breadcrumb, spinner, toggle-group (with toggle), chart (adds `recharts` 3.8.0).
  - Overwrites existing files, so review each with `--diff` and merge by hand, never `--overwrite` without approval: command (also input-group; overwrites button, input, textarea, dialog), calendar (adds `react-day-picker`, `date-fns`; overwrites button), pagination (overwrites button), alert-dialog (overwrites button).
  - Not wanted: sonner (adds `next-themes`; the console is light-only and errors never go in a toast).
- **Planned use:** S150 checkbox (row selection); S151 alert-dialog (retire an offer); S152 popover and command (pick an existing SKU); S153 chart (lazy-loaded client leaf), with native date inputs before any calendar.
- **Rules for every added or changed component** (shadcn-ui skill §5): `className` sets layout only; semantic tokens only (`bg-primary`, `text-muted-foreground`), no raw palette classes; `flex flex-col gap-*` rather than `space-y-*`; forms use `FieldGroup` and `Field` with `data-invalid` and `aria-invalid`; every Dialog or Sheet has a Title; a loading button is `Spinner` plus `disabled`; icons from `lucide` with `data-icon`; shadows only on overlays; heights and radii are set once in the owned primitives (contract roles), never per call (`h-7`, `text-[13px]`).
- **Tailwind v4:** tokens are `oklch()` variables on `:root`, exposed through `@theme inline`; `--radius` is the seed of the radius scale; no `hsl(var(--x))` wrapper; arbitrary values only for a contract role; `tabular-nums` for money.
- **MCP:** the shadcn MCP server is an optional convenience (`shadcn mcp init --client claude` writes a project `.mcp.json`; pin `shadcn@4.23.0`). Adding it is a repository configuration change that needs the owner's approval, so it is **not enabled**. The CLI (`info`, `docs`, `search`, `view`, `add --dry-run`, `--diff`) and Context7 are the working path.
- **Measuring:** `design/admin-contract.json` plus the Playwright baseline. `admin-geometry.mjs` and `dotuiux check` cannot sign in, so signed-in pages are reported **not checked** by those two tools until a sign-in option exists (owner decision O-5: add one to the dotfiles scripts, or keep the Playwright check).

### Account (buyer) and Partner (affiliate): screen direction

Contracts are in spec 17 "Admin wave 4", W4-6 and W4-7. Summary of what the market research and the audit imply:

- **Buyer:** keep the six order filters (Semua, Belum bayar, Diproses, Dikirim, Selesai, Ditutup) and add a Pengembalian entry; show the courier and a copyable resi in the order list; show the exact payment deadline and a copyable VA number; make COD terms explicit before checkout; add an address book with add, edit and delete; add a "Data dan privasi" area (see, correct, delete my data, with the reason when deletion is refused). Policy items that need the owner first: an auto-confirm period for "pesanan diterima", COD refusal wording.
- **Partner:** Ringkasan with a period filter (7 hari, 30 hari, bulan ini), clicks, orders and the five balance states kept separate; per-unit commission table with filters and paging, each reversal showing a plain reason (pesanan dibatalkan, barang diretur, COD tidak diterima, tidak terkirim, klik di luar masa atribusi); Tautan dan kode with a copy button, QR and a share sheet; Penarikan with the minimum and schedule stated, a beneficiary form that re-asks the password, and history; Bantuan with the reversal rules. No "Tarik" button (finance transfers manually, PR-10) and no earnings promises.

### Won't do

1. Dark mode or a theme toggle without a product need.
2. Storefront pill buttons, 20-28 px card radii, photo shelves, hero type or the phone dock inside the console.
3. Decorative charts, invented KPIs, fake or placeholder numbers.
4. Emoji or emoticons as icons; functional SVG icons only.
5. Lighter-than-AA grey text to look quieter.
6. Gamified coins, streaks, spin-to-win, shaming leaderboards, countdowns and "sampai 70%" style claims.
7. A "valid" label on an amount that can still be reversed; silent fees or tax deductions; pre-ticked marketing consent.
8. A second component library or a second set of tokens for the portals.

### References (dotuiux step 2) and how far they are trusted

| Source | What was taken | Trust |
|---|---|---|
| shop.com storefront, measured in the repo | neutrals, hairlines, one purple action, pill filters | measured by the owner's earlier work |
| Seller-admin pattern accepted 2026-10-29 (plan D1) | shell, per-role nav, tabs, list to detail to create | accepted |
| AdsBookCMS (`~/Documents/work/research/99ribu-vs-adsbookcms-comparison-2026-11-02.md`) | dashboard comparison, URL-held filters, confirm hook | patterns only, never code |
| shadcn docs and CLI (`shadcn info`, `add --dry-run`) | component set, install effects | verified locally |
| https://www.ui-skills.com/ (4 pages read) | generic rules paraphrased in the shared rules above: status never by colour alone, tabular numerals, visible labels, loading and empty and error states, one accent, one depth strategy, motion under 300 ms | low weight, reference only: its `robots.txt` says `ai-train=no, use=reference` and disallows some agents by name, no licence is stated, it has nothing on tables or data grids; nothing was copied |
| Indonesian buyer research | tab vocabulary, resi copy, payment deadline, COD terms, auto-confirm, data rights | medium on conventions, low on every number; search summaries only, no official help page was read |
| Indonesian affiliate research | the Involve Asia status lifecycle (official help page) and payout and tax patterns | medium on lifecycle, low on platform numbers; official Shopee, Tokopedia and Lazada pages were not read |

Numbers from the research (auto-confirm days, COD fee percentages, payout minimums, tax rates, statute article numbers) are **not** carried into any spec as rules.

### Owner decisions (2026-11-02: "jadi 5 point di atas kerjakan asal semua base on research")

Recorded in `DECISIONS.md` DEC-026 (direction) and DEC-027 (metric policy). The owner accepted the recommended answers on the condition that they rest on research; the research summary is `~/Documents/work/research/99ribu-indonesia-ecommerce-admin-needs-2026-11-02.md` (non-authoritative, mostly secondary sources).

- **O-1 accepted:** the console keeps its measured 24 px / weight 700 page title; spec 10 was amended accordingly.
- **O-2 accepted:** the buyer account and the affiliate dashboard share tokens, status wording and money rules with the console, not its component library.
- **O-3 accepted:** data blocks in the portals use a 12 px radius (S159).
- **O-4 split:** accepted as design rules: reason text for a reversed commission, "Estimasi, bisa berubah", maturity dates beside amounts, COD terms stated before checkout, deletion request creating a support case. **Still open, no rule written:** any number or legal wording (auto-confirm period, COD refusal consequences, affiliate minimum and schedule beyond PR-10, tax note, return window, statute citations), because the research found no official source or found conflicting ones; each needs the owner, an accountant or a lawyer.
- **O-5 accepted:** keep the Playwright check; the dotfiles scripts are not changed.
- **D4 accepted:** Admin E-Commerce keeps product creation; HPP is entered only with `finance.costs.write`.
- **D6 accepted:** no dark mode.
- **D2 and D3 accepted:** metric policy v1 and chart list in DEC-027.

## Tokens

Storefront tokens: `src/app/styles/01-base-tokens.css`. Console tokens: `src/app/admin/(console)/admin.css` (Tailwind v4 and shadcn variables). The "Console token alignment" and "Account and Partner token cleanups" tables above are the target until the owner accepts or changes them. The console size contract is `design/admin-contract.json`.

## Allow

No `allow:` line is needed yet. The dotuiux `target-size` floor is 24 px (WCAG 2.5.8) and cannot be overridden; console controls are 36 px for mouse and keyboard and 44 px under `pointer: coarse` (spec 10 line 100), so they pass. A stylistic warning that this direction chooses on purpose is recorded here as `allow: <rule> — <reason>`.

## Changing the design

1. Record the owner decision or the shop.com observation in visual-context.md first, then change tokens/components, then this file.
2. Keep one rule per selector and context, in the area file under `src/app/styles/` that owns the surface (a new area gets its own file and an `@import` in `globals.css` at the right cascade position); put a new value in a token in `01-base-tokens.css` when a literal repeats.
3. Prove a refactor has no visual change by diffing computed styles (every element and its `::before`/`::after`/`::marker`/`::placeholder`, custom properties excluded) and screenshots of the storefront page set at 390/768/1100/1440 before and after, as S111 did, and prove a visual change with fresh renders and the design gate (`design-gate.py . --design docs/spec/design/references/shop-com/visual-context.md --src src`).
