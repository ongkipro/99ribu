Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
# S26 FULL29 source review r11 — CHANGES REQUIRED

Paduka Ongki, the verdict is **CHANGES REQUIRED** because of one P2. Changing a shipping choice now uses radios, and pressing Enter on a radio sends the buyer back to the address step. Their chosen service and package split are lost once they recalculate. No money, stock or order is affected. The rest of the correction holds up, including the parser, the server-side checks and the COD explanation. The full report follows in English.

## Provenance and integrity
- **Runtime:** Claude Code, model `claude-opus-5-5` (Opus 5.5). I can't see the provider or effort setting. I ran no tests, opened no database, wrote nothing (including no plan file), used no network and started no other agents.
- **HEAD:** `8b17eee844ba9715581959fc0821af25ce1b99ef`, unchanged before and after.
- **Inputs:** manifest `618f9502…7dfe5` and patch `46d5ed39…577e1b` match.
- **Six groups, before and after:** source 29, context 85, currentUnion 1041 (948 files + 93 permitted missing), artifacts 564, protected 14, evidence 981. Every one has zero sha/bytes/mode deviations, and every sorted compact-JSON digest matches. The stopped `0023` (`ca52af7b…`), pins and AGENTS.md are unchanged.
- **Delta:** against the r10 manifest, exactly the 5 declared files changed. The before-files in `/tmp/99ribu-s26-r17-nogo-build23/repo` match the r10 hashes. A live `diff -u` against them equals the patch body exactly. The r10 report hash `ad3fc55a…` matches, and its verdict was a bounded APPROVE.
- **C0/C1/C2 archives:** I checked each snapshot file against its own manifest. C0 matched 85/85. C1 matched all 849 "after" files; its 87 non-file or missing entries weren't checked. C2 matched 13/13. I did **not** reconstruct delivery-ledger's native surfaceDigest.

## Coverage
- **Read in full:** all 29 source files, with the Read tool, each one start to finish (the 61 KB checkout browser test in two pages). I also read the whole r10→current patch.
- **Targeted reads outside the 29:**
  - `src/modules/checkout/quotes.ts:94-102`: server-side selection checks the option belongs to the parcel, COD support and rate expiry, and rejects with `SHIPPING_OPTION_UNAVAILABLE`.
  - `routes.ts:52-54`.
  - react-dom `initInput`: during hydration it keeps the DOM's checked state.
- **Receipts read:**
  - browser-r33 (raw and manifest): 23/1 pass, exit 0. The test hash is only recorded after the run, as the brief says.
  - browser-r32: real failure, 22/23.
  - current-proof-r3: native 11/5 and cart 16/1. Its 29 hashes equal the manifest source.
  - build-r24: `noDescendingSpecificity` at `globals.css:1282`.
  - build-r25: TS2339 `Node.remove` at test line 298.
  - build-r26: lint, typecheck, build and `diff --check` all exit 0; 271 inputs unchanged; build ID `kbBErnaYlMX3fTNnJbZys`.
  - radio-diagnostic-full-r1: the missing notice in the COD case.
  - radio-cod-red-r1: the COD-only run sees 1 parcel instead of 2.
- **Not read:** the build23 preflight raw simulation, the 101-object snapshot, renders and design reviews. I'm making no visual, canonical or final claims.

## Findings

**P2 — Enter on a shipping radio sends the buyer back to the address step** (code-traced from the HTML Enter-key submit rule, not executed in a browser)
- **Where:**
  - `src/components/storefront/checkout-frame.tsx:8`: the hidden `navigate=lookup` submit button (`form="checkout-form"`) comes first in the page, so the browser uses it as the default button for Enter.
  - `src/components/storefront/checkout-forms.tsx:98` (service radios) and `:160` (package-split radios): this delta adds these on the shipping step. The `<select>` they replace never triggered Enter-to-submit.
  - `src/modules/storefront/checkout.ts:148`: `navigate=lookup` always resolves to `step='contact'`.
  - `src/app/(storefront)/checkout/actions.ts:59-62`: the draft is then saved with `step:'contact'`.
- **Failing scenario:** a keyboard user is on "Pengiriman per paket", with or without JS. They tab to a parcel's service radio, pick an alternative and press Enter.
  1. Chromium/Firefox treat Enter on a radio as a form submit and click the hidden lookup button.
  2. The draft is saved, then the server runs the lookup and the page returns to "Alamat penerima".
  3. The draft now stores the contact step.
  4. The next "Hitung ongkir" creates a new quote with default selections, so the chosen service and package split are silently replaced.
- **Impact:** no order, money or stock effect, but it's a keyboard-only regression that silently discards choices.
- **Test gap:** the Enter-key test (`tests/browser/storefront-checkout.test.ts:148-157`) only covers the contact step.
- **Suggested fix:** make the default Enter button match the current step. Render the lookup button only on the contact step, and on shipping/review use a hidden submit that stays on the same step. Then add a JS and no-JS browser test that presses Enter on a radio.

**P3 — Two-origin tests depend on test order**
- **Where:** `tests/browser/storefront-checkout.test.ts:280-319`. These tests depend on the 768px COD order (`:159-188`) holding Malang shirt stock.
- **Evidence:** in the radio-cod-red-r1 receipt, the COD case run alone gets 1 parcel instead of 2.
- **Assessment:** this is test hygiene, not a product regression. The new no-JS radio test at `:280` shares the same dependency. It should get an explicit, self-owned stock precondition.

**P3 — No-JS radio test may not prove a genuine service change**
- **Where:** `tests/browser/storefront-checkout.test.ts:286`.
- **Problem:** `getByRole('radio').last()` may already be the checked one. Only the package-split change is proven to be a real change. The test should pick an unchecked radio first, like the prepaid JS test at `:303` does.

**P3 — Identical package-split labels (existing before this delta)**
- **Where:** `checkout-forms.tsx:160`.
- **Evidence:** the radio-diagnostic accessibility snapshot shows three identical radios: "3 paket · Pontianak, Malang Rp60.000 ongkir".
- **Assessment:** the price is shown and the buyer reviews again before ordering, so there's no hidden price authority. It's non-blocking.

## Verified intact
- **Parser fail-closed** (`checkout.ts:39-62`):
  - Mixed named and legacy fields, orphaned or unknown `shipping_option:*`, duplicate radio values and missing per-parcel choices are all rejected.
  - Duplicate `package_id`s are rejected through the Set check.
  - File values in `package_id` and `shipping_option:*` are rejected, and named fields on a non-shipping kind are rejected.
  - Limits hold: at most 50 parcels and 120 fields. The worst case is 50 + 50 + 18 = 118.
  - Legacy paired hidden fields are still accepted for exact-intent recovery (`IntentFields`, used only by the unknown-result form at `checkout-forms.tsx:130`). The shipping step leaves `packages` out, so the two field styles never mix.
- **Unchanged guarantees:** the public/domain request schemas, server-side money/stock/rate eligibility, the scoped draft write check, the original order/payment retry key, body and version, the order alias scope, and Purchase being created only by the backend.
- **COD explanation:** in `shipping-local.json`, only `test-regular` supports COD, so each COD parcel genuinely has one radio. The revised assertion (`:305`) is correct and does not weaken COD, stock or timeouts.
- **Summary changes:** the expiry label uses server `now`, and the parent-price grouping, note placement, centered payment column and secondary reload button are low risk.

## Residual limits (not executed)
- React keeps the DOM's radio checked state during hydration. A radio state restored by browser history isn't reconciled into `choices` until the user changes it. A submit still sends what's on screen, but the "pending" notice can disagree. Earlier proof showed natural Chromium Back restoring the server state. Firefox, Safari and devices remain unproven.

## Approval scope
None for now. Re-review the bounded fix for the Enter-key P2. Separate work remains, all still required: the final current-union boundary review, canonical PASS / design-gate 0, the two-layer GO, native support, Safari, devices, the S27 receipt, S65 operations and S68.
