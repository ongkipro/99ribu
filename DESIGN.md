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

## Changing the design

1. Record the owner decision or the shop.com observation in visual-context.md first, then change tokens/components, then this file.
2. Keep one rule per selector and context, in the area file under `src/app/styles/` that owns the surface (a new area gets its own file and an `@import` in `globals.css` at the right cascade position); put a new value in a token in `01-base-tokens.css` when a literal repeats.
3. Prove a refactor has no visual change by diffing computed styles (every element and its `::before`/`::after`/`::marker`/`::placeholder`, custom properties excluded) and screenshots of the storefront page set at 390/768/1100/1440 before and after, as S111 did, and prove a visual change with fresh renders and the design gate (`design-gate.py . --design docs/spec/design/references/shop-com/visual-context.md --src src`).
