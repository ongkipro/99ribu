Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, review selesai. Saya cuma membaca: tidak ada edit, test, panggilan DB/provider, atau publikasi. Laporan lengkapnya di bawah dalam bahasa Inggris, karena ini output teknis.

---

# S26 C1 Engineering Source Review: original + continuation union (read-only)

## 1. Runtime and provenance
- **Runtime:** Claude Code CLI agent session, no subagents used.
- **Model:** `claude-opus-5-5` (Opus 5.5), as exposed by the session environment.
- **Provider and reasoning effort:** not exposed to me. I am not inferring them.
- **Mode:** plan mode was active, so the session was read-only. Nothing was written, including `design/review.md` and any plan file.

## 2. Verification and reading coverage
**Executed, read-only (Python `-I` and `sha256sum`):**
- **HEAD:** `8b17eee844ba9715581959fc0821af25ce1b99ef`, checked before and after the review.
- **Manifest SHA256:** `c28cfbc8…a9f5`, matches, checked before and after.
- **Five digests:** recomputed with `sha256(json.dumps(map,sort_keys=True,separators=(',',':')))`. All five match:
  - source `2517b4ee…`
  - context `94da6793…`
  - currentUnion `a9aa52cf…`
  - protected `481f017b…`
  - evidence `dfbb73f2…`
- **On-disk fingerprints:** 21 source, 44 context, 86 union, 7 protected and 19 evidence objects. Bytes and sha256 all match, with 0 mismatches before and after.
- **Original end manifest:** all 21 source sha256 values equal the entries in `/tmp/99ribu-s26-c0-end-manifest-r1.json`.

**Read in full (all 21 source objects):**
- `scripts/check-tests.ts`
- cart `page.tsx`
- checkout `actions.ts`
- `checkout/order/[orderId]/page.tsx`
- checkout `page.tsx`
- help `page.tsx`
- `globals.css` (all 1300 lines)
- `cart-forms.tsx`
- `checkout-forms.tsx`
- `checkout-frame.tsx`
- `shipping/address.ts`
- `storefront/browser.ts`
- `checkout-order.ts`
- `checkout-signals.ts`
- `checkout.ts`
- `tests/browser/storefront-cart.test.ts` (all)
- `tests/browser/storefront-checkout.test.ts`
- the four `tests/integration/storefront-checkout-*.test.ts` files

**Context actually read, partly or fully:**
- `AGENTS.md` (system-provided)
- `checkout/access.ts` (full) and `checkout/routes.ts` (full)
- `orders.ts`: `authorizeOrder` and `submitOrder` prefix
- `quotes.ts`: `selectQuote`, `persistQuote`, `createQuote`, `ownedQuote`, `assertQuoteCurrent`, `projectQuote`
- `advertising/funnel.ts`: `recordFunnel` prefix
- `storefront/cart.ts`: `readBrowserCart`
- the migration DDL for `commerce_operation.created_at`, which defaults to `clock_timestamp()`
- STATUS: the current S26 lines (6–39)
- TASKS: the S26/S27/S44/S48 rows, T-31 and TEST-31
- `docs/spec/17` lines 466–532
- `docs/spec/10` CO1–CO8 (lines 353–372)

**Context only hash-checked, not read:** the remaining context objects, including:
- ARCHITECTURE, BUILD-LOG, README
- docs 07 and 09
- the shipping fixture JSON, `next.config.ts`, `package*.json`
- icon/navigation/products/shell
- the auth/handler/http/policy modules
- advertising events/routes
- `carts.ts`, `expiry.ts`
- consent choices/context/receipts/routes
- the payments modules
- shipping allocation/quotes/rates
- catalog, format
- `design/reviews/s26-lean-r1.md`

**Evidence (raw output inspected):**
- `current-functional-r3`: integration T-31 `{"ok":true,"passed":8}` exit 0, and the browser wrapper exit 0.
- `browser-r9`: `passed 12` exit 0. The receipt shows buildID `Kzc23RfzGr6BqOsXRrkoE`, 269 source files, `beforeAfterVerified: true`.
- `native-cart-current-r2`: cart16 `ok`.
- `payment-preread-red-r1`: a real failure (`actual 'error'` vs `expected 'unknown'` at payment test line 24/25), exit 1.
- `payment-preread-green-r1`: 2/2 pass, exit 0.
- `integrity-r1`: 46 immutable files, 23-entry prefix exact, draft stopped and not applied, `executedDDL:false`.

I did not re-run any of these. They are the builder's recorded outputs.

## 3. Engineering verdict: **CHANGES REQUIRED** (one P2, no P1)

### P2-1: A submitted buyer note is silently dropped from the order after a resume or return-to-cart
**Location:**
- `src/modules/storefront/checkout.ts:94` sets `buyer_note:''` whenever the draft is rebuilt from the quote.
- `src/components/storefront/checkout-forms.tsx:102` renders the review note only when `draft.buyer_note` is non-empty.
- `checkout.ts:166` sends the note only when it is truthy.

**Trigger:**
1. A guest enters a note on the contact step and submits. The quote is created; the note is carried only in hidden form fields because the quote has no note field.
2. The guest then uses the CO1 header link "Keranjang" (`checkout-frame.tsx:6`), browser navigation, or a hard reload.
3. The guest returns through "Lanjut ke checkout". `readCheckout` sees the current quote and resumes at the shipping step.
4. "Tinjau pesanan" then "Buat pesanan".

**Derived failing result:** the review step shows no note section and no statement that there is no note. The native order is persisted with `buyer_note = null`. A delivery instruction the buyer already submitted is lost with no signal.

This is inference from the code paths. No test covers it. The browser milestone test at line 155 does reload into the shipping step but never checks the note.

**Accepted invariants broken:**
- docs17:503: "Switching step… using browser Back preserves safe fields/selection."
- CO1: "Returning to cart preserves the safe checkout draft."
- docs17 Payment/review: "inspect full breakdown… explicitly confirm".

This goes beyond the declared "unsubmitted text" gap, because this note was already submitted.

**Smallest correction:** keep the optional note editable, or at least explicitly shown as "Tidak ada catatan", on the review step. The order wire already accepts `buyer_note` independently of the quote hash, so no schema, OAS or native change is needed.

**Check to add:** a browser case that enters a note, reaches shipping, goes to `/cart`, comes back, and asserts on review that the note is visible or editable (or explicitly absent) before submit. Then assert the stored `commerce_order.buyer_note`.

Full draft durability across reloads stays a separate parent gap (see section 4).

### Refuted candidates
- **Allocation-change retry produces a different body after an unknown result.** Refuted: `persistQuote` inserts a new child quote and the parent quote is immutable. On retry, `GET intent.quote` still reports the parent's old `selected_allocation_id`, so `allocationChanged` stays true and the packages are recomputed from the same parent plan. The body hash is identical and `priorOperation` replays it (`quotes.ts:67-77`, `92-107`).
- **Order replay after commit fails at the quote pre-read.** Refuted: `ownedQuote` only authorizes the cart and does not require it to be open. In `submitOrder`, `priorOperation` runs before `assertQuoteCurrent`. Executed proof: runtime test lines 52–60.
- **Recovery mints a new grant.** Refuted: `capability()` is a deterministic MAC over (order, guest, `issued_at`), so the same token is re-derived. Replay is scoped to the actor (`priorOperation`), and recovery requires the submitted cart's own cart proof (`checkout-order.ts:90-95`).
- **Stale alias survives revocation or works for another guest.** Refuted: `authorizeOrder:147` requires the browser transport guest to equal `access.guest_id`, and `lockActor` rejects revoked guests. Executed: runtime test lines 87–91.
- **Duplicate or conflicting cookie at the order UI.** Refuted: `checkoutOrderRequest:40-42` denies a conflicting `order_access` and a native-only cookie, and `cookie()` rejects duplicates. Executed: lines 78–81.
- **Milestone backfill or wall-clock issues.** Refuted:
  - `commerce_operation.created_at` defaults to `clock_timestamp()`, so it is wall time.
  - `checkout-signals.ts:36` rejects consent receipts that became effective after acceptance.
  - `recordFunnel:55-57` re-checks the current receipt and a ±5-minute wall window.
  - Business clocks are untouched.
- **Payment pre-read outage rotates the key.** Refuted: a non-AccessError keeps the key (`checkout-order.ts:80-82`). The RED-then-GREEN evidence is real.
- **No-JS financial GET.** Refuted: payment success redirects to a read-only GET, and reads create no attempt. Executed: runtime line 76 and browser test line 102.

## 4. Slice and parent assessment (separate from source approval)
| Gap | Contract | Assessment |
|---|---|---|
| Draft/note durability across hard reload and return-to-cart (unsubmitted contact text; the submitted note in P2-1) | CO1, docs17:503, TEST-31 "guest draft" | **Blocks the S26 slice.** STATUS:26 declares CO1–CO8 and docs17:466–532 as the S26 behavior owners, and nothing in it depends on chat or other slices. The owner would have to reschedule it explicitly to lift this. |
| Native help chat (CO8 / docs17 Help) | CO8, S44 (T-25) | **Blocks only the parent T-31 / TEST-31.** S44 depends on S43 and is downstream, so S26 cannot build it. The current factual FAQ, policy links and "Kembali ke checkout" control are an acceptable interim slice surface. Parent acceptance must wait for S44 integration. |
| Safari / physical device evidence | TEST-31, docs17 matrix | **Blocks only parent acceptance.** Only installed Chromium was run. Record it as unavailable, not as passed. |
| S27 private receipt/status | S27 / T-32 | Out of S26 by owner order; it follows S26 closure. Not a gap in S26. |

**Still pending (this review approves none of them):** the P2-1 correction and its fresh proof, canonical S26 visual review and design-gate, final current-union R3, and ledger closure. The S21/S22 visual rounds do not apply to S26.

## 5. Non-blocking P3 observations
- `checkout-forms.tsx:93`: on the contact step, the first submit button in tree order is "Cari wilayah", so pressing Enter in name/phone/email runs a lookup instead of advancing. It doesn't save anything, but it is surprising for keyboard users. Consider putting the primary action first in tree order, or giving lookup a separate form.
- `checkout-order.ts:38`: the pathname check compares the URL built by `storefrontRequest`, not the actual incoming path. The real protection is the browser's cookie Path scoping. This is harmless, but it shouldn't be described as a server-side path guard.
- `checkout-order.ts:60`: a 404 on the attempt read turns the whole payment view into "denied". A transient missing attempt would show an access message instead of an "unavailable" status.
- `checkout-signals.ts:38`: the dedupe key includes `consent.id`. Withdrawing and re-granting consent records a second `checkout_started` for the same cart revision. Contact and shipping are protected by the effective-time check.
- `changeCheckout:28`: every non-navigation submit, including order submits, first runs a deduplicated `started` capture. This is an extra transaction per submit with no correctness impact.

No full-page visual approval or S26/T-31 completion is implied.
