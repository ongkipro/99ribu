# shop.com parity: chrome, cart, sign-in and help/static slice

Date: 2026-10-29. Reviewer: ShopChrome (worker).

Scope: store header (omnibox row, category pill row, header actions), phone dock, footer, `/keranjang` (empty and filled), `/masuk`, `/bantuan`, `/promo`, placeholder pages (`/tentang`, `/privasi`, `/syarat`, `/kontak`), not-found and error states.

Sources:
- Same-probe captures: `.local/shop-ref/{home,search,cart,category}` (shop.com, 2026-10-28) and `.local/ref99/{home,search,cart,category}` (99ribu build, 2026-10-29), at 390/768/1440.
- Older references: `references/shop-com/2026-10-22-cart`, `2026-10-24-signin`, `2026-10-22-help`, `2026-10-23-footer-*`.
- Owner decisions: `DESIGN.md` (cited `D:<line>`) and `references/shop-com/visual-context.md` (`VC:<line>`).

Pixel numbers marked "ink" come from scanning the PNGs for non-background rows and columns. They are glyph extents, not CSS boxes: a 14/18 line inks about 3px inside its box. Nothing was loaded from shop.com at build time or at runtime; only numbers are transferred.

## How the chrome differs

- **shop.com:** no top header. A 76/96px left rail from 1024px and a bottom bar below. The page starts with a sticky glass omnibox (64px container; sticky wrapper at `top:0`, 96/80/80px tall at 390/768/1440), then the pill row.
- **99ribu:** a top header holding the wordmark (from 701px), the omnibox, the Promo/Cart/Account icons (from 701px) and the pill row (D:19-26), plus the phone dock.
- What carries over is the vertical geometry of the omnibox and pill row, the pill sizes and the footer.

## Header: omnibox row and pill row

| Element | shop.com 390 / 768 / 1440 | 99ribu before 390 / 768 / 1440 | Decision |
|---|---|---|---|
| Omnibox container | 64 tall; 358 / 576 / 512 wide; radius 32 | 64 tall; 358 / 348 / 512 wide | equal at 390/1440. At 768, 348 comes from the three-column header (VC:243): keep. |
| Omnibox → pill circles | container bottom 132 → circles 150: **18** / 132 → 150: **18** / 80 → 96: **16** | 76 → 98: 22 / 80 → 106: 26 / 80 → 106: 26 | **adopt**. Header padding-bottom 16 → 6 (12 at 701-1023), so 18 / 18 / 16. |
| Pill circle | **32** / **32** / 36 | 36 / 36 / 36 | **adopt** 32 up to 1023px, 36 from 1024. The `<a>` keeps its 44px target. |
| Pill label | **14/18 600 -0.2** / 14/18 600 -0.2 / 16/20 600 -0.5 | 16/20 600 -0.5 everywhere | **adopt** 14/18 600 -0.2 up to 1023px; 1440 is already equal. |
| Circle → label | 8 (ink 10) | 8 (ink 10) | equal. |
| Label end → next circle | ink **25** / - / ink **32** | ink 37 / 37 / 36 | **adopt**. Pill end padding 12 → 8; row gap 24 → 16 up to 1023px. Gives 24 / 24 / 32. |
| Header bottom (first content) | hero at 205 / 229 / 148 (no header box) | 150 / 158 / 158 | **adopt** 148 from 701px (16 + 64 + 6 + 44 + 12 pill row). Phones: 142 (12 + 64 + 6 + 44 + 10), 32px circles at 94-126, so the home hero (ShopHome: 8px top padding) starts 24 under them, as shop.com's 390 hero (circles 150-181, hero 205). |
| Pill row scroll/snap/centre | x mandatory, hidden scrollbar, safe centre, 6 fit from 768 | same | equal (VC:210). |
| Sticky omnibox | sticky at every width (wrapper `top:0`) | header scrolls away; dock stays | **keep recorded decision** VC:243 ("Not done: a sticky phone header"). That note assumed shop.com has no sticky search, but the probe now shows one. Flagged to the coordinator; not changed here. |
| Header actions | 56px rail buttons, 24px glyphs (rail only) | 48px round icons, gap 8 | **keep owner decision** VC:248 (48px hit areas; order Promo, Cart, Account, D:21). |
| Wordmark | none on phones; 24px mark in the rail | none on phones; "99rb." from 701px with the reveal | **keep owner decision** D:20, D:25. |
| Omnibox open state | 576 wide, 45dvh, 320ms | same (VC:386-431) | equal; not re-measured (the probe is at rest). |
| Focus / hover | not measurable from the probe | 2px ink ring on pills, 4% hover on actions | keep. |

## Phone dock

| Element | shop.com | 99ribu | Decision |
|---|---|---|---|
| Bar height | 56 (home/search), 74 with the cart page's sign-in row | 64 + safe area | **keep owner decision** D:26 / VC:516 (S144: "64px … plus the owner's prominent search"). Flagged: the probe reads 56, not 64. |
| Tabs | 5 equal (78 wide at 390), icon only, no pill | 5 equal, 60x44 lavender pill on the active tab, raised Cari disc | **keep owner decision** D:26. |
| Radius / shadow | 28 top radius, 2% ring, 0 -4px 24px 12% | same | equal. |

## Footer

| Element | shop.com 390 / 768 / 1440 | 99ribu before 390 / 768 / 1440 | Decision |
|---|---|---|---|
| Last content → footer | ink **29** / **41** / **41** (search); 46 (home 1440) | ink 54 / 89 / 89 (search); 48 / 72 / 72 (home) | **adopt**. `margin-top` 64 → 40 from 701px and 40 → 24 on phones. This replaces the "64px before the footer (40 on phones)" rhythm rule in D:78 (a system default, not an owner override). |
| Band | white, no top border | white, no border | equal. |
| Padding top | 32 / 48 / 48 | 32 / 48 / 48 | equal. |
| Padding bottom | ≈20 at 1440 (bottom row ink ends 21 above the edge) | 32 | **adopt** 24 from 701px (4px scale); phones keep 24. |
| Column heading | 14/18 500 black | 14/18 500 | equal. |
| Heading → first link | ink 34 (box gap 16, VC:271) | ink 28 (box gap 10) | **adopt**. Heading margin-bottom 4 → 10 from 701px, giving a 16px box gap. Phones (44px links) already ink 35 vs 34: unchanged. |
| Link pitch | 30 | 30 (44 on phones) | equal; phones keep the 44 floor (D:80). |
| Column boxes | **184** wide each, no gap (cart 1440 repeater: 4 × 183.7); visible text gap ≈ 88 | max-content columns, 48 gap (visible 48) | **adopt** 184px column boxes, no column gap, from 701px. Columns stay max-content, so a longer department name widens its column. |
| Columns at 390 | 2 columns at x 17 / 207, 40 row gap | 2 at 16 / 207, 40 row gap | equal. |
| Brand → menus (stacked, 701-1023) | tagline → heading box ≈48 | 40 | **adopt** a 48 row gap at 701-1023px. |
| QR, app badges, social, language | present | absent | **not applicable**: no app, social accounts or second language (VC:273). |
| Copyright row | 14/18 tertiary | 14/18 `--muted` | equal. |

## Cart `/keranjang`

shop.com's cart was captured signed out and empty both times (2026-10-22 and 2026-10-28). No shop.com cart with items exists in the evidence.

| Element | shop.com 390 / 768 / 1440 | 99ribu before 390 / 768 / 1440 | Decision |
|---|---|---|---|
| Empty heading | **18/20 600 -0.5** / **20/22 600 -1** / 20/22 600 -1 | 28/30 800 -1 / 36/38 800 -1 / 36/38 800 -1 | **adopt** for every page-level empty/recovery state (`main.empty-state h1`): `--title-size/-leading` 600 at -1px, -0.5px on phones. The global page h1 (D:61) is unchanged elsewhere. |
| Empty heading y | 274 / 320 / 360 (viewport 844/900) | 214 / 225 / 225 | **adopt**. `main.empty-state` top padding 212 from 1024px (148 + 212 = 360), 172 at 701-1023 (148 + 172 = 320), 132 on phones (142 + 132 = 274). Bottom padding 48 (64 on phones). |
| Heading → lead | ink 12 (390), ink 21 (1440): box ≈12 | 16 | **adopt** 12. |
| Lead | 16/22, `rgba(0,0,0,.56)` | 16/22 `--muted` (14 on phones) | **adopt** 16/22 on phones too. Colour stays `--muted` (D:40, 4.84:1; shop.com's 0.56 black is `--caption`, the captions role). |
| Lead → action | ink 27 at 1440: ≈24 | 40 (16 gap + 24 margin) | **adopt** 24 (12 gap + 12 margin). |
| Action pill | 44 tall, padding 12, 16/20 600, brand fill, full radius | 48 tall, padding 12/20 | **adopt** 44 tall, padding 12px 16px (the 44px floor holds). |
| Last action → footer | 484 → 572: 88 | 411 → 542: 131 | **adopt** (follows from 48 bottom padding + 40 footer margin). |
| Suggestion shelf | none. The "184x189 4-card row" in the probe is the footer's four link columns (sample text "Learn more…"), not products. | none | **not applicable**: shop.com shows no product row on the empty cart. |
| Filled cart rows, quantity pill, summary | not captured (no shop.com cart with items) | Dawn rows, 40px quantity pill, 52px checkout pill | **keep owner decision** D:122 (cart page, owner 2026-10-28). Not measurable. |
| Summary primary pill | 52 (shop.com primary pills, PDP/sign-in) | 52 | equal. |

## Sign-in `/masuk`

| Element | shop.com (2026-10-24, shop.app) | 99ribu | Decision |
|---|---|---|---|
| Column | 344, centred | 344 | equal. |
| Top offset | ~90 desktop / 16 phones from the viewport top (page without store chrome) | 56 / 24 under the store header | **keep**. `/masuk` renders in the store shell (D:128). Not comparable. |
| Mark → heading | 32px mark, 24 gap | 2rem mark, 24 | equal. |
| Heading | 32/35.2 800 -0.5; phones 28/30.8 | 2rem/2.2rem 800 -0.5; phones 1.75/1.925rem | equal. |
| Lead | 16/22, 8 under the heading | 16/22 `--muted`, 8 | equal. |
| Field | 52 pill, 1px ink edge, 4% fill, two soft shadows, 24 under the lead | same | equal. |
| Field label | placeholder only | visible 12/16 600 label | **keep** (WCAG 3.3.2, D:140). |
| Primary | 52 pill 16/22 500, highlight + glow, 16 under the field | 52 pill 16/20 600, the same highlight/glow | **keep** 600 (one button role, D:68). |
| Footnote | 12/16 muted, underlined links, 16 under | same | equal. |
| Error | 12/16 under the field, red edge | 14/20 under the field, error edge, takes focus | **keep** (05-sign-in contract, D:128). |
| Focus | none visible on the field | ink edge + 3px ring | **keep** (WCAG 2.4.7). |
| No-JS | blank page | form posts to `/masuk/kirim` | keep. |

## Help and static pages

| Element | shop.com (help.shop.app, 2026-10-22) | 99ribu | Decision |
|---|---|---|---|
| Column | single centred column | 720 (45rem) | keep (VC R11). |
| Content start under the chrome | 24 (listing probe, same chrome) | 32 (`/bantuan`), 40/24 (`/promo`) | **adopt** 24 at every width for `/bantuan` and `/promo`, the same as the listings (ShopListing set `.listing-main` to 24). |
| Topic cards | grey `#f2f4f5`, radius 12, h2 20/28 550, p 14/18 | white, radius 20, 2-up, h2 18/20 600, p 16/22 | **keep** D:81 (20px cards) and D:65-66. help.shop.app is a separate product with its own type scale. |
| Placeholder pages | n/a | `main.empty-state`: heading + one secondary pill | follow the empty-state rows above (20/22 600 heading, 44 pill, same position). |

## Not-found and error states

| Element | shop.com (`/categories/women`, unknown slug) | 99ribu | Decision |
|---|---|---|---|
| Heading | 64/58 800 poster (36/38 on phones), under a product illustration | 36/38 800 page h1 | **adopt** the cart empty-state numbers (20/22 600) for every `main.empty-state`, so all recovery states look the same. The poster heading is **not applicable**: it pairs with an illustration we do not have, and copying the illustration is ruled out. |
| Lead → actions | omnibox + three 44px secondary pills | one 44px pill (+ a text link on the error page) | spacing as in the cart rows. |
| Loading skeletons | not captured | no route `loading.tsx` in this slice | **not applicable**. |

## Not measured

Hover and press timings, the omnibox open animation, dock press scale and footer link hover: the probe captures rest states only. The 768 footer column positions vary on shop.com (17/233/425/583, not a fixed 184 pitch), so the 184px box comes from the 1440 cart probe.
