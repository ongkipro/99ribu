Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
**Verdict: CHANGES REQUIRED** (satu P2, beberapa P3)

Paduka Ongki, integritasnya bersih: keempat group cocok sebelum dan sesudah dibaca, snapshot cocok dengan R12, dan diff saat ini sama persis dengan patch. Masalahnya ada di alur tanpa JavaScript. Kalau pembeli menekan Enter di pembagian paket lain, lalu memilih kembali pembagian yang sudah terbit, peringatannya memang hilang. Tapi tombolnya justru melempar pembeli ke langkah alamat dengan pesan error umum. Tidak ada dampak ke uang atau stok, tapi koreksi r17b secara eksplisit menjanjikan reset tanpa JS berfungsi. Laporan lengkap dalam bahasa Inggris di bawah.

## Provenance and integrity
- **Runtime:** Claude Code, model `claude-opus-5-5`. Provider and effort are not exposed to me. Strictly read-only: no file writes (including no plan file, despite the harness plan-mode prompt), no tests, DB, network, browser, images, other agents or Git mutations.
- **HEAD:** `8b17eee8…` before and after. Manifest `a100130c…` and patch `f1d3fa2e…` match.
- **Four groups, before and after:** all sha256/bytes/mode match with 0 mismatches and no missing files. Sorted compact-JSON digests reproduce:
  - source 29 `3aafa87d…`
  - context 16 `98aeb365…`
  - protected 14 `fa0ba479…` (stopped 0023/snapshot/journal unchanged, same digest as R12)
  - evidence 16 `7d8ea254…`
- **Snapshot linkage:** all 29 files in `/tmp/99ribu-s26-r17b-nogo-build27` match the R12 manifest `952262ff…` source entries. Current differs from R12 in exactly the 6 declared files; the 23 unchanged files are byte-identical. A live `diff` from snapshot to current equals the patch body (127/127 change lines).
- **Not done:** I did not reconstruct the ledger surfaceDigest.

## Coverage
- **Full-read:**
  - all 6 changed files: `checkout.ts`, `checkout-forms.tsx`, `checkout-frame.tsx`, `globals.css`, the runtime test, and the browser test (two pages)
  - the complete patch
  - the R12 report
- **Targeted:**
  - `quotes.ts` (selectQuote / ownedQuote / projectQuote)
  - `access.ts` authorizeCart
  - `carts.ts:116` (line mutations clear `active_quote_id`)
  - `shipping/quotes.ts` plan/parcel IDs
  - `promotions/allocation.ts` (eligibility uses service and region, not warehouse)
  - `actions.ts:30-60`
  - `checkout/page.tsx`
  - `readCheckout` callers
  - the `shipping-local.json` fixture
  - spec `17-UX:260` (browser support matrix still undefined)
- **Hash-only:** the 23 unchanged sources, linked to the actual full29 R11 read and the bounded R12 review. I am not claiming a new full29 read.

## Findings

**P2: no-JS dead-end when reverting a pending allocation to the issued one.**
- **Code:** `checkout-forms.tsx:170`, with `checkout.ts:197-203`, `quotes.ts:94` and `checkout.ts:211-217`.
- **Scenario (no JS):**
  1. On the shipping step, check allocation X and press Enter. This is the tested `stay` path; `actions.ts` saves the draft with `allocation_id=X`, and the server returns shipping with `intent.allocation_id=X`.
  2. The server render has `allocationChanged=true`, so only the plain `<p>` is rendered. No `Parcels` and no `package_id` inputs are rendered.
  3. The buyer re-checks the issued allocation S. CSS hides the warning, as the correction intends.
  4. The buyer submits "Perbarui pembagian paket".
- **Result:** the post body is `allocation_id=S` with `packages=[]`. `allocationChanged` is false, so the selection POST goes out with an empty array. `selectQuote`'s `array(...,1,50)` rejects it with 400 `INVALID_INPUT`. The buyer lands on the **contact** step with the generic "Periksa isian sebelum melanjutkan." and no field error.
- **Scope and cause:** the server structure predates r17b, but r17b's claimed "resetting the real choice clears the warning" is only half-true here. JS mode is fine, because Parcels re-render on the client.
- **Minimal fix (either):**
  - Server: in the shipping branch, when the submitted allocation equals the selected one and `packages` is empty, use the current `quote.packages` selected options, or return the `stay` shipping state.
  - Form: always render the CSS-gated `.checkout-allocation-pending` plus `Parcels`, since CSS already hides `.checkout-parcels` while a non-issued allocation is checked.
- **Test to add:** a no-JS regression test for Enter on X, then re-check S, then submit.

**P3s**
1. **`:has()` now gates the JS-mode stale warning and charge suppression** (`globals.css:1325-1330`). Previously both were conditional JS renders.
   - In browsers without `:has` (for example Firefox before 121), no warning appears, and stored per-parcel charges stay next to a different checked service.
   - The review step remains authoritative and `previousTotal` still notifies. The support matrix is still open at `17-UX:260`.
   - Fix: a React-state data attribute as a JS-mode fallback.
2. **A checked pending allocation can sit hidden inside the collapsed `<details>`** after a reload or no-JS `stay` (`checkout-forms.tsx:103-107`), because only the issued group is shown outside it. Suggest opening the disclosure when `allocation !== current.id`.
3. **Grouping edge case** (`checkout.ts:43`): if a pending draft X and the issued S fall in the same buyer-equivalent group, X becomes the representative and S gets no radio. The buyer then can't clear the warning without submitting. This is hard to reach, since S's stored services must equal X's defaults.
4. **Live region:** the always-mounted `role="status"` warning is toggled with `display`. Screen-reader announcement on toggle isn't guaranteed.
5. **Destination labels:** the option text is now `postal_code · city` (`:164`). It is unique in the fixture, but real kelurahan can share a postcode and city; the hint below the select disambiguates only after a choice is made.
6. **Test gaps:**
   - The runtime foreign check (`runtime :47`) uses a cartless client, so it returns `none` and never reaches the `ownedQuote` denial for a foreign cart.
   - No test covers the case where the pending allocation and the issued one are merged into one group.
   - `previousTotal` is not asserted on an allocation change.
   - No no-JS allocation revert test.
7. **Evidence:**
   - native-r1 is bound to the earlier CSS/forms/browser-test hashes (declared). Its `checkout.ts` and runtime test hashes equal current.
   - build30 matches all 21 non-test sources in its 271 inputs.
   - proof-r6 browser 23 PASS / 2 FAIL and the diagnostic do show the radio hidden inside `details`.
   - The updated test callers (opening the disclosure) are **unproven** until the current proof-r7 is frozen. I am not inferring its result.

## Verified (no defect found)
- **Allocation contents are a private projection:**
  - They come from `ownedQuote` behind authorizeCart (owner/guest + capability).
  - The OAS/native projection, plans, price and stock are untouched; no input mutation, and the test asserts this.
  - Representatives keep real native plan IDs.
  - The selected plan uses `document.selected_plan`, which holds the stored services and total; this is consistent with `selectQuote` cloning from `plans[]`.
- **Grouping key:** shipping total plus per-parcel origin, items, contents, service, alternative fees and amount, order-insensitive. Promotion eligibility doesn't depend on warehouse, so merged plans can't differ in subsidy, given equal visible service names.
- **Unreachable throws:** the `throw` in `checkoutAllocationChoices` can't be hit, because line mutations clear the active quote. Callers catch it anyway.
- **`previousTotal`:** comes from the old native quote GET within the same mutation, is set only when the total changed, and is display-only. It is never a form or authority field. Same-key replay reads the same immutable old row.
- **Service state:** the service radios share parent `services` state; resetting to the issued choice clears `servicePending`, with no latched dirty flag.
- **Data markers:** `data-issued-selected` is presentation-only, and the server ignores it.
- **Enter/stay:** the header `stay` button is unchanged.
- **Retry, financial actions and milestones:**
  - Unknown-result exact retry is unchanged; it uses `IntentFields(state.intent)` and the `actions.ts` pre-save gate.
  - No duplicate financial action is possible.
  - The milestone and Purchase scope is unchanged.
- **Help link:** at 320px / 200% the visible "Bantuan" text matches its accessible name; only the back chevron hides. The `:target`-only "Kembali ke formulir" has a single caller.
- **CTA divider:** removed with no structural change.

## Residual limits
- This approves nothing for visual purposes: no visual GO, canonical17/design-gate 0, or final full29 original+C1+C2+C3 union R3.
- Full S68, Firefox/Safari/devices and history-restored radio state remain unproven.
- No package, config, SQL or transport change is authorized by this review.
