Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, preflight-nya selesai. Hasilnya **CHANGES REQUIRED** karena ada satu P2. Laporan teknis di bawah dalam bahasa Inggris sesuai permintaan.

# S22/T33/PR-17 — Complete current engineering R3 preflight (source-r6)

**Verdict: CHANGES REQUIRED.** One P2 is verified, and the r6 delta introduced it. Everything else holds. This is not a visual, final-boundary, S22 or SQL verdict.

## Fingerprints (all recomputed by me)
- HEAD is `8b17eee8…`. SHA256 and bytes match in the worktree for **source 24/24, context 52/52 and evidence 96/96**.
- All 3 compact sorted JSON digests match:
  - source `3f111797d3b85ffb1423124e6826a09967fe23826b3771a98fe752f1fb8694cf`
  - context `add37ba991a62b4f1fbd7eb370fe0c664155afbbe58bfc5f58bf1191ffafe2a8`
  - evidence `58b667421bae1680c42078ee1e5943d591c1d825acd040ac3620d1f1034cf911`
- The r6 snapshot matches source 24/24. The r5 snapshot matches the r5 manifest 24/24.
- I regenerated the r5→current diff and it is identical to `/tmp/99ribu-s22-source-r6-delta.diff`.
- The files that differ from r5 are exactly the 7 listed in `changedSinceCompleteSourceR5`. No files were added or removed.
- The source-r5 report's SHA is `47c11b6b…`, which confirms that APPROVE is the r5 baseline.
- Evidence matches the claims:
  - ui-build-r22: `BUILD_ID=sXaNoegPFRDt8vFWAuNDK`, 259 inputs identical, FINAL_EXIT 0.
  - native-r8: 24/6 PASS, `SOURCE24_UNCHANGED=True`.
  - browser-registry-r12: 25/4 PASS with 0 failed, incomplete or empty; it is bound to source digest `3f111797…` and the build ID, and the before/after served assets are unchanged.
  - round11 RED r1: 3 failures retained (UNKNOWN_PACKAGING_IDR, plus the two premature Back URL assertions).

## Coverage
**Read in full:**
- All 24 source, test and registry files.
  - All 16 purchase cases in `storefront-cart.test.ts`, including the new multi-option subflow.
  - The full 1191-line `globals.css`.
  - The two older filter-recovery discovery cases.
- Runtime callers: `checkout/carts.ts`, `storefront/catalog.ts`, `browser.ts`, `cart.ts`, `actions.ts`.
- The authority path: `finance/costs.ts`, all 113 lines (`appendCostVersion`, `financeAuthority`).
- The fixture-value parity sites in `local/commerce.ts` and `local/storefront.ts`.
- Reports: round11, lean-r5, source-r5. The 17-UX association clause at line 150.

**Traced by grep:**
- The callers of `Shell`, `CartForm`, `OfferPicker`, `RestartShopping`, `.danger` and `.cart-advisory`. Shell's signature is unchanged, and the restyled classes are only used by the changed files.

**Not re-read (carried from earlier rounds by identical hash):**
- `salePublication`, `offerAvailability`, `authorizeCart`, the access/handler modules, and `tests/browser/storefront.test.ts` (it is in the registry but not in this manifest).
- I did not open any render images.

## P2 (verified, regression in r6)
**Location:** `src/app/(storefront)/cart/page.tsx:22`, together with `cart-forms.tsx:66,72` and `browser.ts:68`.

**Cause:**
- `reviewId` is passed whenever `publicationChanged` is true.
- But the `review-${line.id}` section at line 21 only renders when `product&&offer`.
- `publicationChanged` is also true in two cases where that section is not rendered:
  - The product was unpublished: `publicProduct` returns null, and `undefined!==line.publication_id`.
  - The product was republished with the line's offer retired.

**Failing scenario:**
1. The cart renders with an editable "Perbarui jumlah" form.
2. The merchant unpublishes the product, or retires that offer and republishes.
3. The buyer submits the stale form.
4. `freezeLines` returns `409 PUBLICATION_REVIEW_REQUIRED` (`carts.ts:55`, before the offer check).
5. The page revalidates and the form now has `reviewId`, so `reviewError=true`.

**Result:**
- The `role=alert` error is suppressed.
- The global feedback is also suppressed, because the line is still active so `lostTarget` is false.
- The button's `aria-describedby` points at an element that doesn't exist.
- Only the static "tidak lagi dijual" paragraph remains, so a screen-reader user gets no announcement that the submit failed.
- In r5 this case announced the error, so r6 breaks the invariant that every error stays visible and associated (17-UX:150).
- The browser registry doesn't cover this path.

**Smallest fix:**
- Change to `reviewId={product&&offer&&publicationChanged?`review-${line.id}`:undefined}`.
- Add one browser assertion: retire the offer, submit the stale update, then check that `.cart-form-error[role=alert]` is visible and the `describedby` target exists.

## Invariants verified
- **Error priority in CartControls:**
  - Unknown/bootstrap intent still takes priority (exact key, body, version, quantity).
  - Retained drafts apply only to the visible quantity input, and the source-r4 hidden-quantity fix (`base` for `quantity=false`) is unchanged.
  - The notice shows only when there is no error or unknown state.
  - A matching review error is hidden only when `reviewId` is present. Every other error stays visible as `role=alert` and is associated with the input, or with the button when `quantity=false`.
- **Closed cart:**
  - It renders static records with no forms, and `activeLines=[]`.
  - A stale submit after expiry gets the global alert `CART_EXPIRED`.
  - The test submits the old form, reloads, then asserts static history, count 0, no checkout note and no quote warning.
- **Option selection:**
  - A single valid option shows as a static fact, and the invalid state keeps GET recovery.
  - Multiple options use native `required` radios plus explicit "Lihat pilihan", with no auto-navigation.
  - Keyboard Space selection is tested at 390, 1440 and no-JS 390.
- **Sample copy guard:**
  - It is narrow and exact-string, and React escaping is unchanged.
  - The authored description "Dua opsi kaos…" is asserted as visible.
- **Multi-option fixture:**
  - It is owned, reuses `S22_MULTI_`, and uses `patchProduct`.
  - `appendCostVersion` runs only when no prior row exists, with `expected_version:0` re-checked under a row lock (VERSION_CONFLICT otherwise).
  - Values are identical to the established TEST-ONLY fixtures, it requires owner+MFA `financeAuthority`, and it writes an audit row.
  - No HPP is overwritten and the profit gate isn't bypassed. Publish stays canonical, and `originalQuantity` comes from the real saved cart.
- **Back cases:** they now wait on the variant identity in the form before asserting the URL.
- **Native boundary:** the writer, schema and API are untouched; the native callers are identical to r5.

## Nonblocking polish / later scope
1. Test line 118 asserts the URL right after clicking a native GET submit. It passes in all 3 contexts; `await expect(page).toHaveURL(...)` would be more robust.
2. `globals.css:1128` is now redundant with line 1127 (lean deletion).
3. In the invalid single-option state, `.offer-picker` and `.offer-single` each add a 24px top margin, giving 48px. That's for visual review.
4. A vanished line shows a disabled "Setujui isi terbaru" label. This predates r6; the same `product&&offer` condition could gate the label and `quantity`.
5. `--error` is indented with spaces instead of tabs (trivial).
6. Still pending: canonical round12, design-gate 0, final current-union R3, the S26/S27 map, and S61. S33 `ca52af7b` and the 3 consumed executor permissions are untouched. No full-68 acceptance.

## Disclosure
- Runtime: Claude Code, model `claude-opus-5-5`. Provider and reasoning effort aren't exposed to me.
- Forced plan-mode scratch: `/home/ongki/.claude/plans/perform-a-real-separate-luminous-planet.md`, holding a summary of this report.
- I made no repo edits and ran no tests, build, server, DB, network calls or secret reads. I opened no images, did no Git publication and wrote nothing to the ledger.
CROSS_CLI_EXIT=0
