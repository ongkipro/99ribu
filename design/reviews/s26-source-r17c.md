Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
**Verdict: APPROVE** (no P1/P2; new and remaining P3s below)

Paduka Ongki, the r17b P2 is genuinely closed. Parcels are now always rendered and only shown or hidden by CSS. So in no-JS, Enter on X, then going back to S, then submit sends the real `package_id`/`shipping_option:*` fields. The server takes the `allocationChanged=false` path and continues to review. I found no new P1/P2. One new P3 is worth fixing: the "pending" split also separates X from its own aliases, not just from S. The full report in English follows.

## Provenance and integrity
- **Runtime:** Claude Code, model `claude-opus-5-5`. Provider and effort aren't exposed to me. Read-only throughout: no writes (no plan file either, despite the harness plan-mode prompt), no tests, DB, network, browser, images, other agents, Git mutation or SQL.
- **HEAD:** `8b17eee844ba…` before and after.
- **Manifest:** `8d7d8029…` matches.
- **Patch:** `2bab1f57…`. A live `diff -U3` from the snapshot to current is **byte-identical** to the patch.
- **Four groups, before and after reading:** every sha256, byte count and mode matches, with 0 mismatches. The sorted compact-JSON digests reproduce:
  - source 29 `2c2c0aa5…`
  - context 18 `dcb07519…`
  - protected 14 `fa0ba479…` (unchanged from R17b/R12; stopped 0023, snapshot and journal untouched)
  - evidence 19 `53b2d0dd…`
- **Snapshot linkage:**
  - All 29 files in `/tmp/99ribu-s26-r17b-source-review-revise-build30` match the R17b manifest `a100130c…` source entries.
  - Its `manifest.json` is `6a99e87d…`, the same value recorded in the R17b verified/parent-audit receipts.
  - Current differs in exactly the 5 declared files; the 24 unchanged files equal R17b.
- **Not done:** I did not reconstruct the ledger surfaceDigest.

## Coverage
- **Full read:**
  - the complete patch
  - `src/modules/storefront/checkout.ts` (all 220 lines)
  - `src/components/storefront/checkout-forms.tsx` (all 187 lines)
  - the R17b report
  - the RED receipt
  - the proof-r8 script and JSON
- **Targeted:**
  - every changed region of `globals.css`, the browser test and the runtime test, plus the browser loop header `:169` (JS true/false) and the Enter body `:171-176`
  - `actions.ts` `changeCheckout` (parse, draft pre-save, mutate, post-write)
  - `quotes.ts:56,93` (projection, selection parser)
  - the `shipping/quotes.ts` plan ID/sort
  - the warehouse/destination fixtures
  - the typecheck-r1 and build-r31 tails
- **Hash-only:** the 24 unchanged sources and the other context files. These link to the actual R17b full-6/exact-29 snapshot, R12 and the original full-29 R11 read. I make no new full-29 claim.
- **Evidence checks:**
  - proof-r8 `source29AndTestsBeforeAfter` equals all 29 current hashes.
  - build-r31 `24OsEQdpFyA3k0pzCFsNu` has 271 inputs; the 21 source inputs that overlap the manifest have 0 mismatches.
  - Tallies: native 11/5 files, browser r38 25 pass, cart r23 16 pass, all with 0 fail/incomplete/empty.
  - typecheck `ACTUAL_EXIT 0`; build `FINAL_EXIT 0`.
  - The RED is real: no-JS fails on the missing `Tinjau pesanan` heading at `:176`, exit 1. I am not claiming the RED test hash equals the current test.

## Verified correct
- **P2 fix** (`checkout-forms.tsx:170`):
  - `Parcels` and the `.checkout-allocation-pending` note are now unconditional. CSS `:1327-1328` hides or shows them depending on whether a non-issued allocation is checked.
  - Revert to S posts S's parcel fields. `checkoutFormInput` (`checkout.ts:59-82`) accepts them for `kind=shipping`, and `mutateCheckout:199-205` sends the real packages, so the request reaches review.
  - There is no server fallback for an empty selection, and the parser and `selectQuote` `array(1,50)` are unchanged.
- **Hidden old controls on reallocation:**
  - Submitting with X checked still sends S's parcel fields, but `allocationChanged=true` replaces `packages` with X's native defaults from `ownedQuote` (`:202`), so the stale fields have no effect.
  - The pre-saved draft's S packages are filtered against the new quote's parcels/options by `initialCheckoutState:54`.
  - Field count stays well within the 120/32 KB limits.
- **Grouping** (`checkout.ts:42`):
  - The extra key element is non-null only for `preferred≠selected`, so S always keeps a group and a radio. This fixes R17b's P3-3, and `current` (`forms:103`) always resolves to S.
  - When preferred equals S, the result is identical to before.
  - It remains a read-only projection behind `ownedQuote`, and the runtime test still asserts no document mutation.
- **Selected and pending are equivalent (X≡S):**
  - Both IDs are labelled ("Pembagian tersimpan" / "Pilihan belum diterapkan").
  - Submitting X is an honest native reallocation with an equal total, so there's no `previousTotal` banner.
  - Afterwards preferred=selected=X and the two merge again with X as representative.
- **Reverting with pending services:** the JS `services` state survives. `servicePending` keeps the warning, and the submitted services reach review.
- **Total banner:**
  - JS mode was already gated by `selectionPending`.
  - no-JS: the new `:has` rule (`css:1327`) hides `.checkout-total-change` while a non-issued service or allocation is checked. `.checkout-total-change` is a direct child of `.checkout-fields`.
  - The runtime test now asserts `previousTotal` for an allocation change (`runtime:59`).
- **Destination:** each option is `postal · city · district`. When a destination is selected, `aria-describedby` includes the `checkout-destination-selected` ID, and that element renders under exactly the same `destination` condition.
- **Unchanged scope:**
  - Unknown exact retry still uses `IntentFields(state.intent)`, and the draft pre-save is still skipped before an order retry.
  - Authority, Purchase/milestones, money and stock are unchanged.
  - No package, config, native, OAS or SQL change.

## Findings
**P3 (new): the pending split also separates X from its non-S aliases** (`checkout.ts:42`).
- **Cause:** when X is pending and X is buyer-equivalent to another plan Y that isn't S, X gets a unique key. Y's group is then rendered separately with identical content.
- **Effect:** the buyer sees what looks like a duplicate choice, "Lihat N pembagian lain" counts one more, and Y's `equivalent_count` excludes X.
- **Impact:** no money or stock effect; either native ID is valid.
- **Reachability:** not reachable in the fixture (the two warehouses are in different cities), but reachable with same-city warehouses.
- **Test gap:** the runtime test covers only aliases of S.
- **Smallest fix:** add `preferred` to the key only when X's visible key equals S's visible key. Add a runtime case where X≡Y≢S.

**P3 (new): `details open={allocation!==current.id}` is a controlled prop** (`forms:107`). In JS mode, reverting to S flips it from true to false, so React collapses the list the buyer opened. Harmless (focus stays on S outside the details), but surprising.

**P3 (carried, not waived):**
- **`:has` support** now also controls no-JS pending visibility. Without `:has`, the pending note stays hidden and S's parcels show next to a checked X. The server still recalculates X correctly. The support matrix remains undefined.
- **Screen readers:** `role="status"` toggled via `display` is still not guaranteed to be announced.
- **Foreign-scope test:** the runtime foreign check still uses a cartless client, so it never reaches the `ownedQuote` denial for a foreign cart.
- **Device and history-restored radio state:** still unproven.

## Not covered by this approval
This is engineering-only for the bounded 5 files. All of these remain separate mandatory gates:
- the renewed two-layer visual GO and the 63-image batch (not inspected)
- canonical17 / design-gate 0
- the final full-current-29 original+C1+C2+C3 union R3 and ledger closure
- native support / devices
- S27, S65 and full S68
