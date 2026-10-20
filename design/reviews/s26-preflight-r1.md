Reviewer: Gemini 4 Argon via Antigravity CLI
Codes and line refs grep-verified

# S26 Checkout — Visual & UX Pre-Flight Review (Before Canonical Round 1)

- **Reviewed Tree:** `/home/ongki/Projects/.worktrees/99ribu-foundation` (read-only)
- **T1 Git State:** `HEAD` at `8b17eee` (`92` modified/untracked entries in `git status --short`)
- **Renders Inspected:** All `30` PNG files in `docs/spec/design/renders/s26/*.png` (generated `2026-10-19 20:47:41–20:47:59 +0700`) plus `1` leftover JSON artifact (`contact-text-200-320-overflow.json` from `20:27:42 +0700`)
- **Authority Contracts:**
  - `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md` (`UX-1` lines `23–32`, Action Specification lines `118–120`, `UX-4` line `232`, Dedicated `/checkout` Flow and Milestone Contract lines `466–531`)
  - `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md` (`UI-1` lines `34–43`, Tokens and Component Handoff lines `45–59`, Selected type scale lines `71–85`, `C4` line `159`, `CO1–CO8` lines `299–308`, S26 composition lines `310–324`, `TY1–TY8` lines `327–343`, Iconography and copy lines `383–388`)
  - `design/reviews/s22-round14/content/design/review.md` (accepted S22 visual language + carry-over polish notes)

---

## 1. Complete Render Inventory Inspected (`30` PNGs + `1` JSON)

Every PNG in `docs/spec/design/renders/s26/` was opened and visually inspected:

| Step / Group | Inspected Files (`docs/spec/design/renders/s26/`) |
|---|---|
| Contact / Address (`7` PNGs + `1` JSON) | `contact-390.png`, `contact-768.png`, `contact-1024.png`, `contact-1440.png`, `contact-error-390.png`, `contact-nojs-390.png`, `contact-text-200-320.png` (+ leftover `contact-text-200-320-overflow.json`) |
| Shipping per Package (`8` PNGs) | `shipping-390.png`, `shipping-768.png`, `shipping-1024.png`, `shipping-1440.png`, `shipping-consented-390.png`, `shipping-two-origins-cod-390.png`, `shipping-two-origins-prepaid-390.png`, `shipping-unavailable-390.png` |
| Review & Confirm (`9` PNGs) | `review-390.png`, `review-768.png`, `review-1024.png`, `review-1440.png`, `review-two-origins-cod-390.png`, `review-two-origins-prepaid-390.png`, `cod-unavailable-390.png`, `quote-expired-390.png`, `order-unknown-390.png` |
| Payment / Order Handoff (`6` PNGs) | `payment-390.png`, `payment-768.png`, `payment-1024.png`, `payment-1440.png`, `payment-instructions-390.png`, `payment-nojs-390.png` |

---

## 2. Visual & UX Findings (Strict Reviewer Critique)

### Issue 1 (P1 — Blocker): Unknown-Outcome Screen (`order-unknown-390.png`) Lacks Caution Callout Styling, Alert Icon, Order/Total Context, and Help Section

- **Affected Render:** `order-unknown-390.png`
- **What is wrong visually:**
  1. When the committed order response is aborted in `tests/browser/storefront-checkout.test.ts:118-122`, the client lands in `CheckoutBoundary` (`src/components/storefront/checkout-forms.tsx:13-21`).
  2. `order-unknown-390.png` renders only a bare `<section className="checkout-recovery" role="alert">` with generic heading `<h1>Checkout</h1>` (because `this.props.heading` is `true` at `checkout-forms.tsx:18, 53`), a plain unboxed paragraph `"Balasan belum diterima. Ulangi tindakan yang sama untuk memeriksa hasilnya."`, and a primary `.button` `"Periksa hasil tindakan"`.
  3. It has **no caution callout treatment** (`--warning` / `--warning-surface` with `<Icon name="alert"/>`), **no retained summary or payable total**, and **`<CheckoutHelp/>` disappears completely** (leaving the page nearly empty at `23 KB`).
  4. Even the server-returned `unknown` branch in `CheckoutController` (`checkout-forms.tsx:73`) renders an unstyled `.checkout-recovery` section without `--warning` / `--warning-surface`, `<Icon name="alert"/>`, or the `<Summary>` disclosure.
- **Contract Citations:**
  - `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:54` (*"Financial confirmation: Scope, amount, recipient summary, irreversible consequence, explicit action label; unknown result is not success"*) and `:58` (*"Async feedback: Loading, retained stale data, pending mutation, retry, conflict, partial failure and success are distinguishable"*).
  - `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md:476` (*"Timeout / unknown order outcome: Do not claim failure or create a new order automatically; offer status check / safe retry using the same idempotency key"*) and `:491` (*"Disable confirm, keep summary visible ... Timeout / 5xx: unknown-outcome recovery screen; recheck same key before new submit"*).
  - Accepted S22 visual language (`docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:430, 463`; `pdp-unknown-390.png`): unknown-outcome callouts must use the semantic caution surface (`border-left: 3px solid var(--warning); background: var(--warning-surface)`) with `<Icon name="alert"/>`.
- **Responsible Code:**
  - `src/components/storefront/checkout-forms.tsx:18` (`CheckoutBoundary.render()`)
  - `src/components/storefront/checkout-forms.tsx:53` (`<CheckoutBoundary heading href="/checkout">`)
  - `src/components/storefront/checkout-forms.tsx:73` (`if(unknown)return <><section className="checkout-recovery" role="alert">...`)
  - `src/app/globals.css:1289` (`.checkout-recovery`)
- **Minimal Fix (`[PROPOSAL]`):**
  - Style unknown-outcome feedback with the caution callout (`border-left: 3px solid var(--warning); background: var(--warning-surface)` + `<Icon name="alert"/>`), use the explicit heading `"Hasil tindakan belum diketahui"` even when `this.props.heading` is true, and retain `<Summary>` (when available) plus `<CheckoutHelp/>` in `CheckoutBoundary` and the `unknown` branch.

---

### Issue 2 (P1 — Blocker): Callout Role Misuse — Unpaid/COD/Expired Payment Banners and Routine Step Instructions Use Brand/Success Purple (`#f7f5fd` / `var(--purple)`)

- **Affected Renders:**
  - Payment views: `payment-390.png`, `payment-768.png`, `payment-1024.png`, `payment-1440.png`, `payment-instructions-390.png`, `payment-nojs-390.png`
  - Step transitions & lookup: `contact-390.png`, `shipping-390.png`, `shipping-768.png`, `shipping-1024.png`, `shipping-1440.png`, `shipping-two-origins-cod-390.png`, `shipping-two-origins-prepaid-390.png`, `review-390.png`, `review-768.png`, `review-1024.png`, `review-1440.png`, `review-two-origins-cod-390.png`, `review-two-origins-prepaid-390.png`
- **What is wrong visually:**
  1. **Unpaid / COD / Expired status banner on `/checkout/order/[orderId]` (`payment-*.png`):**
     - In `src/app/(storefront)/checkout/order/[orderId]/page.tsx:21`, `.checkout-payment-status` sets `data-phase={paid?'success':attempt?.status==='unknown'?'unknown':'pending'}` and renders `<Icon name={paid?'check':'alert'}/>`.
     - In `src/app/globals.css:1292-1293`, `.checkout-payment-status` defaults to `background: #f7f5fd; border-left: 3px solid var(--purple)` for BOTH `data-phase="success"` and `data-phase="pending"`, and only overrides `[data-phase=unknown]`.
     - As a result, in `payment-390.png`, `payment-768.png`, `payment-1024.png`, `payment-1440.png`, `payment-instructions-390.png`, and `payment-nojs-390.png`, an **unpaid order (`Menunggu pembayaran`) or uncollected COD order (`Pembayaran COD`) renders a warning triangle `<Icon name="alert"/>` inside the brand/success purple box (`#f7f5fd` / `var(--purple)`)**—and if `closed || expired` is true (`Pembayaran tidak tersedia`), `data-phase` is still `'pending'` (purple box!).
  2. **Success checkmark banner on routine step transitions (`shipping-*.png`, `review-*.png`):**
     - Advancing from Step 1 (`Alamat`) to Step 2 (`Pengiriman per paket`) or Step 3 (`Tinjau pesanan`) sets `state.phase='success'` (`src/modules/storefront/checkout.ts:151, 164`) with instructional copy `"Periksa asal paket, layanan dan ongkos kirim."` or `"Periksa seluruh paket dan total sebelum membuat pesanan."`.
     - `src/components/storefront/checkout-forms.tsx:85` renders this as a purple `.checkout-feedback` banner with a **checkmark `<Icon name="check"/>`** at the top of Step 2 and Step 3—making a routine step instruction look like a completed confirmation banner, and duplicating the summary hint (`"Periksa setiap paket sebelum membuat pesanan."` at `checkout-forms.tsx:45`).
     - Notice `shipping-consented-390.png` (captured after a page reload, where `state.message` is empty): Step 2 is much cleaner without that redundant purple checkmark banner.
  3. **Detached top-of-form purple banner after destination lookup (`contact-390.png`):**
     - In `contact-390.png`, clicking `"Cari wilayah"` sets `state.phase='idle'` and `state.message='Pilih tujuan dari hasil pencarian.'` (`src/modules/storefront/checkout.ts:138`), rendering an iconless purple `.checkout-feedback` box at the very top of the form (above `"Tidak perlu membuat akun..."` and `"Nama penerima"`), `340px` above the actual `"Cari wilayah"` / `"Wilayah pengiriman"` controls.
- **Contract Citations:**
  - `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:58` (*"Async feedback: Loading, retained stale data, pending mutation, retry, conflict, partial failure and success are distinguishable"*).
  - `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:328` (*"A success icon/headline appears only for the fact actually confirmed; order acceptance does not imply paid, dispatched or delivered"*) and `:333` (*"TY1 Outcome first: ... Pending/unknown states show neutral progress/recovery, not a green paid check"*).
  - `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md:522` (*"Pending payment: Show payment instructions, expiry time if applicable, and explicit 'Check status' action; do not show paid badge"*).
- **Responsible Code:**
  - `src/app/(storefront)/checkout/order/[orderId]/page.tsx:21`
  - `src/app/globals.css:1255-1258, 1292-1293`
  - `src/components/storefront/checkout-forms.tsx:85`
  - `src/modules/storefront/checkout.ts:138, 151, 164`
- **Minimal Fix (`[PROPOSAL]`):**
  - On `/checkout/order/[orderId]`, give `data-phase="pending"` a neutral or caution surface (`--warning` / `--warning-surface` or neutral `#f7f7f9` with `--line`), reserve `#f7f5fd` + `var(--purple)` + `<Icon name="check"/>` strictly for `data-phase="success"` (`paid === true`), and map `closed || expired` to an explicit `data-phase="closed"` / error or caution treatment.
  - On `/checkout`, do not set `state.message` to generic step instructions on normal step progression (`checkout.ts:151, 164`)—the `<h2>` heading (`Pengiriman per paket`, `Tinjau pesanan`) and `<ol className="checkout-progress">` already announce the step. Place lookup status (`checkout.ts:138`) inline near `#checkout-destination_id` (or in `#checkout-destination-hint`) rather than as a top-of-page banner.

---

### Issue 3 (P1 — Blocker): Duplicate Restated Copy & Triple/Five-Times Repeated Totals on `/checkout` (Especially Step 3 `Tinjau pesanan` and Unsubsidized Parcels)

- **Affected Renders:** `review-390.png`, `review-768.png`, `review-1024.png`, `review-1440.png`, `review-two-origins-cod-390.png`, `review-two-origins-prepaid-390.png`, `shipping-390.png`, `shipping-768.png`, `shipping-1024.png`, `shipping-1440.png`, `contact-390.png`, `contact-768.png`, `contact-nojs-390.png`, `quote-expired-390.png`
- **What is wrong visually:**
  1. **Total printed 5 times on desktop (`review-1024.png`, `review-1440.png`) and 4 times on mobile (`review-390.png`, `review-768.png`), with 3 consecutive `Total` lines at the bottom of the left column:**
     - In `review-1024.png` and `review-1440.png`, `Rp225.000` appears in:
       1. Right `<Summary>` header (`Rp225.000`)
       2. Right `<Summary>` `<QuoteCharges>` (`Total Rp225.000`)
       3. Left `Tinjau pesanan` `<QuoteCharges>` (`Total Rp225.000` at `checkout-forms.tsx:102`)
       4. Left `.checkout-actions > p` (`Total Rp225.000` at `checkout-forms.tsx:103`)
       5. Left `.checkout-actions > button` (`Buat pesanan · Rp225.000` at `checkout-forms.tsx:103`)
     - Visually, at the bottom of the `Tinjau pesanan` column in all `review-*.png` renders, the reader sees `<QuoteCharges>` `Total Rp210.000` -> `Ubah pengiriman` -> `Total Rp210.000` -> `[ Buat pesanan · Rp210.000 ]`. The `<p>Total Rp210.000</p>` directly above `[ Buat pesanan · Rp210.000 ]` is 100% redundant with both `<QuoteCharges>` above it and the button label below it.
  2. **Duplicate shipping fee rows inside every unsubsidized parcel card (`shipping-*.png`, `review-*.png`):**
     - In `src/components/storefront/checkout-forms.tsx:49`, every `<fieldset className="checkout-parcel">` renders:
       `<div><dt>Ongkir paket</dt><dd>{rupiah(parcel.shipping_amount)}</dd></div>`
       followed by `{parcel.subsidy_amount>0&&...}`
       followed by `<div><dt>Ongkir yang dibayar</dt><dd>{rupiah(parcel.buyer_shipping_amount)}</dd></div>`.
     - When `parcel.subsidy_amount === 0` (which is true in every single S26 render), every parcel card prints two consecutive lines with the exact same amount:
       `Ongkir paket: Rp12.000`
       `Ongkir yang dibayar: Rp12.000`
  3. **Restated summary status line above primary CTA on Step 1 & Step 2 (`contact-*.png`, `shipping-*.png`):**
     - On Step 1 (`contact-390.png`, `contact-768.png`, `contact-nojs-390.png`, `quote-expired-390.png`), the top `<Summary>` bar shows `Produk · ongkir belum dihitung / Rp198.000` (or `Perhitungan tersimpan / Rp225.000`), and `.checkout-actions > p` (`checkout-forms.tsx:103`) repeats the exact same text (`Produk Rp198.000 · ongkir belum dihitung` or `Perhitungan tersimpan Rp225.000`) above `"Lanjut ke pengiriman"`.
- **Contract Citations:**
  - `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:386` (*"Product copy must be concise, factual Bahasa Indonesia tied to the current task, result or recovery action. Avoid generic AI filler, vague promises, inflated praise, repetitive headings and unsupported urgency"*).
  - S22 Rounds 11–14 precedent (`docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:423, 429`; `design/reviews/s22-round14/content/design/review.md:31`): duplicate restated price/status sentences above an action button that already states the fact were repeatedly flagged as REVISE.
- **Responsible Code:**
  - `src/components/storefront/checkout-forms.tsx:49` (`Parcels` `<dl className="checkout-charges">`)
  - `src/components/storefront/checkout-forms.tsx:102-103` (`<QuoteCharges quote={quote}/>` + `.checkout-actions > p` + `.checkout-actions > button`)
- **Minimal Fix (`[PROPOSAL]`):**
  - In `Parcels` (`checkout-forms.tsx:49`), show `Ongkir paket` + `Subsidi paket` + `Ongkir yang dibayar` when `parcel.subsidy_amount > 0`, or a single `Ongkir yang dibayar` (or `Ongkir paket`) row when `parcel.subsidy_amount === 0`.
  - In `.checkout-actions` (`checkout-forms.tsx:103`), omit `<p>Total {rupiah(quote.buyer_total)}</p>` on the `review` step (where `<QuoteCharges>` and the button label `Buat pesanan · Rp...` already show the exact total immediately above and inside the button).

---

### Issue 4 (P2 — High REVISE Risk): Always-Visible `"Kembali ke checkout"` Submit Button Inside Inline `Bantuan checkout` Section on `/checkout`

- **Affected Renders:** All `23` `/checkout` renders (`contact-*`, `shipping-*`, `review-*`, `cod-unavailable-390.png`, `quote-expired-390.png`, `shipping-unavailable-390.png`)
- **What is wrong visually and behaviorally:**
  1. At the bottom of every `/checkout` screen, directly beneath the primary purple submit button, `CheckoutController` (`src/components/storefront/checkout-forms.tsx:106`) renders `<CheckoutHelp><button className="button secondary" type="submit" form="checkout-form" name="navigate" value={state.step}>Kembali ke checkout</button></CheckoutHelp>`.
  2. Because `Bantuan checkout` (`#checkout-help`) is rendered inline on the same `/checkout` page, a user scrolling past the primary CTA sees a bordered `.button.secondary` labeled **`"Kembali ke checkout"`** while already on `/checkout`.
  3. Worse, because it is `type="submit" form="checkout-form" name="navigate" value={state.step}`, clicking `"Kembali ke checkout"` triggers a full form `POST` (`changeCheckout`) instead of simply returning focus/scroll to the active step heading or `#checkout-form`.
- **Contract Citations:**
  - `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:102` (*"Use one clear primary action per local task; secondary actions remain available with explicit labels"*).
  - `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:307` (*"CO8 Help and recovery: Explicit Help opens native support in a dedicated task view/panel preserving safe draft and return destination"*).
  - `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md:118` (*"Every screen must expose one primary action for the current step and keep destructive or secondary actions visually subordinate"*).
- **Responsible Code:**
  - `src/components/storefront/checkout-forms.tsx:106`
  - `src/components/storefront/checkout-frame.tsx:12-19`
  - `src/app/globals.css:1280-1285`

---

### Issue 5 (P2 — High REVISE Risk): `320px` / `200%` Text Reflow Crushes Summary Subtitle into a 5-Line Single-Word Column (`contact-text-200-320.png`) + Leftover `contact-text-200-320-overflow.json`

- **Affected Render & Directory File:**
  - `docs/spec/design/renders/s26/contact-text-200-320.png`
  - `docs/spec/design/renders/s26/contact-text-200-320-overflow.json`
- **What is wrong visually:**
  1. **Crushed 5-line vertical text column in `.checkout-summary summary` (`contact-text-200-320.png`):**
     - In `contact-text-200-320.png`, the open summary toggle header renders:
       `Tutup / ringkasan / Produk / · / ongkir / belum / dihitung` in a narrow ~80px column on the left while `Rp198.000 ^` sits to its right.
     - Why: at `@media(max-width:22rem)` (`src/app/globals.css:1300`), `.checkout-summary summary` sets `flex-wrap: wrap`, and `.checkout-summary-lines > li > div` sets `flex-basis: 100%`, **but `.checkout-summary summary > span:first-child` (`globals.css:1222`) does NOT have `flex-basis: 100%`**. Thus `span:first-child`, `<strong>Rp198.000</strong>`, and `.summary-chevron` remain on a single flex row at 320px/200%, squeezing `"Produk · ongkir belum dihitung"` into one word per line.
  2. **Stale failure artifact left in render folder (`contact-text-200-320-overflow.json`):**
     - `docs/spec/design/renders/s26/contact-text-200-320-overflow.json` (timestamp `20:27:42`, recording `"overflow": 218`) is still present in `docs/spec/design/renders/s26/` from an earlier failed run before `globals.css` was patched at `20:47`. Leaving `-overflow.json` inside `docs/spec/design/renders/s26/` pollutes the canonical evidence directory.
- **Contract Citations:**
  - `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:114` (*"Verify keyboard-only flows, screen-reader labels and announcements, contrast, 200% zoom, 320 CSS-pixel reflow"*) and `:366` (*"MW6 Continuity: ... No horizontal page overflow or zoom suppression"*).
- **Responsible Code:**
  - `src/app/globals.css:1220-1225, 1300`
  - `docs/spec/design/renders/s26/contact-text-200-320-overflow.json`
- **Minimal Fix (`[PROPOSAL]`):**
  - Add `.checkout-summary summary>span:first-child {flex-basis:100%}` (or `flex: 1 1 10rem`) inside `@media(max-width:22rem)` at `src/app/globals.css:1300`, and delete `docs/spec/design/renders/s26/contact-text-200-320-overflow.json`.

---

### Issue 6 (P2 — Polish / Layout): Unintended `:focus-visible` Purple Outline on `"Catatan pengiriman (opsional)"` in `contact-1024.png` and `contact-1440.png`

- **Affected Renders:** `contact-1024.png`, `contact-1440.png`
- **What is wrong visually:**
  - Both desktop/tablet baseline captures (`contact-1024.png` and `contact-1440.png`) show a bright `3px solid var(--purple)` focus ring around the optional `"Catatan pengiriman (opsional)"` textarea, whereas `contact-390.png` and `contact-768.png` do not.
  - Cause: `contact(f.page, method)` in `tests/browser/storefront-checkout.test.ts:67-71` fills `#checkout-buyer_note` last, then calls `f.page.locator('input[name=payment_method][value=prepaid]').check()`. Because `prepaid` is already checked by default, `.check()` does not click or move focus at `1024px` and `1440px`, leaving `:focus-visible` on the textarea during `capture()`.
- **Contract Citations:**
  - `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:103` (*"Inputs retain persistent labels, help/error association, entered safe values and visible focus"*).
  - `src/components/storefront/checkout-forms.tsx:31` (*"Only a server validation result requests autofocus; initial entry never does."*).
- **Responsible Code:**
  - `tests/browser/storefront-checkout.test.ts:67-71, 77-83`

---

### Issue 7 (P2 — Layout / Proportion): Desktop `/checkout/order/[orderId]` (`payment-1024.png`, `payment-1440.png`) Leaves ~40% of the Shell Empty and Stretches the Primary Button to `640px` Above a `145px` Secondary Button

- **Affected Renders:** `payment-1024.png`, `payment-1440.png` (and button width disparity on `payment-390.png`, `payment-nojs-390.png`)
- **What is wrong visually:**
  1. `.checkout-wrap` is `max-width: 1128px` (`src/app/globals.css:1211`), so `.checkout-header` and `.checkout-footer` span the full `1080px` content width. However, `.checkout-payment` (`globals.css:1290`) is capped at `max-width: 40rem` (`640px`) left-aligned with no right column, leaving ~`440px` of empty white canvas on the right at `1024px` and `1440px`.
  2. Inside `.checkout-payment`, `.checkout-payment-action` (`globals.css:1295`) is `display: grid` without `justify-items: start`, so `"Siapkan instruksi pembayaran"` stretches across the full `640px` width, while `"Perbarui status"` immediately below it (`.checkout-status-refresh`, `globals.css:1297`) has `justify-self: start` (`145px` wide).
- **Contract Citations:**
  - `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:316` (*"The order-specific private checkout payment view stays compact: exact order reference, authoritative amount/method, persisted instruction/status and explicit refresh/retry"*) and `:190` (*"Shortened unnecessarily stretched desktop summary"*).
- **Responsible Code:**
  - `src/app/globals.css:1290, 1295, 1297`

---

### Issue 8 (P2 — Alignment / Copy Polish): Fieldset `<legend>` Left Outset (`.checkout-methods`, `.checkout-parcel`) and Truncated English Simulation Labels in `<select>`

- **Affected Renders:**
  - Legend alignment: `contact-390.png`, `contact-768.png`, `contact-1024.png`, `contact-1440.png`, `shipping-*.png`, `review-*.png`
  - Truncated English `<select>` / synthetic strings: `shipping-390.png`, `shipping-consented-390.png`, `shipping-two-origins-cod-390.png`, `shipping-two-origins-prepaid-390.png`, `contact-390.png`, `cod-unavailable-390.png`, `shipping-unavailable-390.png`
- **What is wrong visually:**
  1. **Fieldset `<legend>` hangs `12px` left of inner card content:**
     - `.checkout-methods` (`src/app/globals.css:1259`) and `.checkout-parcel` (`globals.css:1267`) have `padding: 16px`, while their `<legend>` (`globals.css:1260, 1268`) has `padding-inline: 4px` and no `margin-left`. In every render, `"Preferensi pembayaran"` and `"Paket 1 · dari Malang"` sit `12px` to the left of the inner text axis, crowding the top-left rounded corner (`border-radius: 6px`). Compare S22 Round 14 `design/reviews/s22-round14/content/design/review.md:20` on `<legend>` left-axis alignment.
  2. **Truncated `<select>` labels & raw `SYNTHETIC` / `[s26-xxxxxx]` tokens in renders:**
     - On `390px` shipping renders (`shipping-390.png`, `shipping-consented-390.png`, `shipping-two-origins-cod-390.png`, `shipping-two-origins-prepaid-390.png`), `<select name="shipping_option_id">` (`checkout-forms.tsx:49`) concatenates `"Local shipping simulation · Economy simulation · Rp12.000"`, which truncates mid-word at `390px` as **`"Local shipping simulation · Economy si"`** (hiding the price `Rp12.000` completely!).
     - Across all renders, stock contents display raw test hashes (`"2 × SYNTHETIC cream [s26-13eb1e3a]"`), and destinations display `"SYNTHETIC district A, Malang, SYNTHETIC Jawa Timur 00001"`. While `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:319` notes that `SYNTHETIC` labels come from the local fixture, the mid-word truncation of `"Local shipping simulation · Economy si"` in `shipping-390.png` hides the option's shipping price on mobile.
- **Contract Citations:**
  - `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md:77` (*"wrap rather than truncate an essential action"*), `:116` (*"buyer-facing content is Bahasa Indonesia"*), and `:386` (*"Product copy must be concise, factual Bahasa Indonesia"*).
  - `design/reviews/s22-round14/content/design/review.md:20` (legend alignment with inner controls).
- **Responsible Code:**
  - `src/app/globals.css:1259-1260, 1267-1268`
  - `src/components/storefront/checkout-forms.tsx:49` (`{o.courier_name} · {o.service_name} · {rupiah(o.shipping_amount)}`)

---

## 3. Required Contract States with NO Render Yet in `docs/spec/design/renders/s26/`

Cross-checking `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md` (lines `466–531`), `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md` (`CO1–CO8`, lines `299–324`), and `TASKS.md` (`S26`, line `851`) against `docs/spec/design/renders/s26/`:

1. **Pending / In-Flight Submit State (`17-UX:474, 489–491`, `TASKS.md:851`):**
   - `tests/browser/storefront-checkout.test.ts:121` asserts `Menyimpan pesanan…` is disabled during double-submit protection, **but does not capture a screenshot** (`review-pending-390.png` or `contact-pending-390.png`). S22 visual review required explicit rendered proof of the pending state in viewport.
2. **Checkout Empty / Expired / Cart-Conflict / Denied Entry Recovery (`17-UX:473`, `src/app/(storefront)/checkout/page.tsx:15`, `src/components/storefront/checkout-forms.tsx:72, 74, 75`):**
   - No render exists for empty cart on `/checkout` (`Keranjang masih kosong`), cart/stock conflict or expired cart on `/checkout` (`Keranjang perlu diperiksa`), or denied session (`Sesi belanja perlu diperiksa`).
3. **Allocation Plan Changed State (`allocationChanged === true`, `17-UX:481, 490`, `src/components/storefront/checkout-forms.tsx:101, 103`):**
   - When a buyer changes `#checkout-allocation` (`Pembagian paket`), `checkout-forms.tsx:101` hides `<Parcels>` and shows `"Perbarui pembagian untuk melihat isi dan layanan setiap paket baru."` with button `"Perbarui pembagian paket"`. This state has no render.
4. **Shipping Subsidy > 0 (`parcel.subsidy_amount > 0` / `quote.subsidy_total > 0`, `17-UX:482`, `CO5` at `10-DESIGN-SYSTEM-WHITELABEL.md:304`):**
   - Every captured render has `subsidy_amount = 0` and `subsidy_total = 0`; the `Subsidi paket` (`checkout-forms.tsx:49`) and `Subsidi ongkir` (`checkout-forms.tsx:39`, `order/[orderId]/page.tsx:22`) rows are unrendered in `s26/`.
5. **Two-Origins Desktop Layout (`1440px`, `10-DESIGN-SYSTEM-WHITELABEL.md:323`):**
   - `10-DESIGN-SYSTEM-WHITELABEL.md:323` plans *"representative single-offer, bundle and two-warehouse prepaid/COD checkout at 390/768/1024/1440 CSS pixels"*, but `shipping-two-origins-*` and `review-two-origins-*` are captured only at `390px`.
6. **Payment Handoff Recovery States (`src/app/(storefront)/checkout/order/[orderId]/page.tsx:17-26`):**
   - No render exists for payment-attempt `unknown` (`Status pembayaran sedang diperiksa`), payment-attempt `failed` (`Percobaan pembayaran gagal`), expired/closed order (`Pembayaran tidak tersedia`), or denied order access recovery (`Akses pesanan perlu diperiksa` / `"Pulihkan akses pesanan"`).

---

## 4. Pre-Flight Verdict

NO-GO — Fix Issues 1–5 (unknown-outcome screen lacking caution callout/summary/help in `order-unknown-390.png`, purple success/brand callout role misuse on unpaid `payment-*.png` and routine step transitions `shipping-*.png`/`review-*.png`, five-times repeated totals and duplicate unsubsidized parcel shipping rows on `review-*.png`/`shipping-*.png`, always-visible `"Kembali ke checkout"` submit button inside inline help, and `320px/200%` summary header text crush + leftover `contact-text-200-320-overflow.json`), address Issues 6–8 (focus artifact in `contact-1024/1440.png`, stretched `640px` button on `payment-1024/1440.png`, truncated `<select>` price on `shipping-390.png`), and add missing state renders (especially in-flight pending submit) before invoking canonical visual review Round 1.
