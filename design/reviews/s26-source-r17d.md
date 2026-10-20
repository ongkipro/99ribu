Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
**Verdict: APPROVE.** Saya tidak menemukan P1/P2. Ada tiga P3 kecil di bawah.

Paduka Ongki, dua koreksi ini bekerja benar:
- **P3 R17c sudah tertutup.** Pilihan pending X yang sama isinya dengan Y (dan beda dari S) sekarang tetap satu pilihan, dengan X sebagai wakilnya. Pemisahan X dari S hanya terjadi kalau X memang sama isinya dengan S.
- **Tombol "Gunakan pembagian ini"** memakai jalur `kind=shipping` yang sudah ada. Validasi native lewat `ownedQuote` tidak berubah, dan Enter tetap menjalankan tombol `stay` di header.

Ada satu hal yang harus saya akui: saya tidak sengaja membuat satu file kosong `/tmp/_x` lewat redirect `diff`. File itu belum saya hapus, karena menghapus juga termasuk menulis. Silakan dihapus. Selain itu tidak ada penulisan lain: tidak ada plan file, test, DB, network, browser, image, agen lain, Git, atau SQL.

Laporan lengkap (English):

## Provenance and integrity
- **Runtime:** Claude Code, `claude-opus-5-5`. Provider and effort are not exposed.
- **HEAD:** `8b17eee844ba9715581959fc0821af25ce1b99ef` before and after.
- **Manifest:** `1abd72ee…ba3b20` matches.
- **Four groups, before and after:** every sha256, byte count and mode matches, with 0 mismatches. The sorted compact-JSON digests reproduce:
  - source 29: `16dd6029…5985`
  - context 18: `300e3bbb…5c79`
  - protected 14: `fa0ba479…e9c` (unchanged; stopped 0023 `ca52af7b…` and its snapshot/journal untouched)
  - evidence 27: `98e693ca…f840`
- **Snapshot:** all 29 R17c source entries in `/tmp/99ribu-s26-r17c-approved-build31` match the R17c manifest `8d7d8029…`. The snapshot's `manifest.json` (`d969fe9a…`, 95 objects) equals the value in the R17c verified receipt.
  - Exactly the 5 declared files differ now; the other 24 are unchanged.
  - The changed lines of a live snapshot-to-current diff are identical to the correction patch.

## Coverage
- **Read in full:**
  - the complete patch
  - the R17c report and its verified/parent-audit receipts
  - the proof-r10 script, text and JSON
  - the browser-r40 script, raw output and receipt
  - the cart-r25 receipts
  - the typecheck-r1, focused-r1 and focused-r2 receipts
  - the browser-r39 receipt, the disclosure RED and the open-observation diagnostic
  - the build-r34 tail
  - the lean r17d notes
- **Read with full control flow:**
  - `checkout.ts:32-56`, covering `checkoutAllocationChoices` and `initialCheckoutState`
  - `checkout.ts:131-206`, covering `readCheckout`, `mutateCheckout` entry, the navigation branch and the shipping branch
  - `checkout-forms.tsx:1-190`, covering `AllocationChoices`, `CheckoutController`, `Parcels`, `IntentFields` and `useDraftSave.submit`
  - `checkout-frame.tsx` (the stay control)
  - `quotes.ts:56,99-107`
  - the button and allocation CSS
  - the changed test regions and the JS/no-JS loop headers
- **Hash-only:** the 24 unchanged sources and the rest of the context. They link through the exact-29 snapshot and the actual R17c/R17b/R12/R11 reviews. I make no new full-29 or native-ledger digest claim.

## Evidence (actual)
- **build34** `7_PPutQlMQVVCP8fkDUUN` (`.next/BUILD_ID` matches):
  - 271 inputs with 0 mismatches now; the 21 inputs that overlap the manifest all match.
  - `git diff --check` exit 0; `FINAL_EXIT 0`.
- **proof-r10:** native 11 tests in 5 files, browser 25 in 1 file, cart 16 in 1 file. All have 0 failed, 0 incomplete and 0 empty.
  - The 29 before/after hashes equal the current source.
  - The browser run binds the test sha `e06adf53…` and the 11 served scripts byte-equal to `.next`. The 4×63 legacy/frozen renders (the 252 prior images) are unchanged.
- **focused-r2:** 3 tests passed (JS and no-JS Enter, prepaid two-origin apply) on build34 with the exact 29 files.
- **typecheck-r1:** `ACTUAL_EXIT 0` with the exact 29 files.
- **The failures are real:**
  - browser39 had 23 pass and 2 fail; focused-r1 had 1 pass and 2 fail. Both failed in `check` on an invisible radio after the summary was clicked.
  - The observation diagnostic shows BEFORE `open:true` with the issued radio checked, then AFTER `open:false`.
  - The corrected diagnosis is consistent with this: the stale local allocation on first mount made the disclosure open by default, so the summary click closed it. I am not claiming the RED test input equals the current test, and I did not verify the intermediate source.

## Verified correct
- **Projection (`checkout.ts:33-48`):** `selected_plan` (which is always in `plans`, `quotes.ts:56,99`) is evaluated first, so `issuedKey` is set before any comparison.
  - The extra key element is non-null only when the plan is the pending one (not S) and its visible key equals the issued key.
  - **X≢S and Y≡X:** they form one group. X becomes the representative (`plan.id===preferred`), and `equivalent_count` is accumulated.
  - **X≡S:** S and X stay as two native IDs with the stored/pending labels. Other aliases of S merge into S's group.
  - S is always the representative of its group, so `current` (`forms:103`) always resolves.
  - The projection is a read-only view behind the `ownedQuote` authority.
- **Runtime test (`runtime:47`):** it discriminates. The old key would have given `allocations.length+1` groups; the new key gives `allocations.length`. It also asserts the alias is not shown, the count is at least 2, S is present, and the input is not mutated.
- **Apply button (`forms:106`):** it is an unnamed `type=submit` outside the `<label>`.
  - JS: the `FormData(form, submitter)` body carries the checked radio `allocation_id`, because `IntentFields` omits `allocation_id`/`packages` in the shipping step. With no `navigate`, the request goes to the shipping branch.
  - That branch sees `allocationChanged`, replaces the packages from the owned native plan, and returns 409 `SHIPPING_OPTION_UNAVAILABLE` for an unknown ID (`checkout.ts:200-205`).
  - It sits inside `fieldset.checkout-controls disabled={busy}`, so the pending guard applies.
  - The header stay control (`checkout-frame.tsx:8`) is still first in tree order, so it remains the implicit Enter action. Both Enter tests pass.
  - CSS specificity is correct: `(0,2,0)` beats `.button`, and the issued option never shows its button.
  - The existing primary button still works, and the review step still only confirms the order.
- **Disclosure:**
  - `key={quote.id}` resets it on a new quote. The initial value comes from accepted `state.intent.allocation_id !== quote.selected_allocation_id`, which is the value the layout effect will sync local allocation to.
  - `onToggle` only calls `setOpen(currentTarget.open)`; there is no financial or analytics effect.
  - Server and client render the same initial `useState` value, so there is no hydration mismatch.
- **No-JS:** the server-rendered open state follows the pending intent, and native `<details>` works without JS.
- **Unchanged:** no change to native plans, stock, money, OAS, packages, config or SQL.

## Findings (P3, none blocking)
1. **Pending choice can be hidden (`forms:107`):** if a JS user checks pending X and then closes the disclosure, X and its nearby apply button are hidden inside the closed `<details>`. The warning, the pending note and the primary "Perbarui pembagian paket" remain visible, so the action stays reachable. No fix required. Optional: append "(1 pilihan belum diterapkan)" to the summary.
2. **Cart runner not bound:** the cart-r25 receipt runs `/tmp/99ribu-s26-cart-regression-r1.mjs`, which is not hash-bound in this manifest's evidence set. Only the result receipts are bound. Bind it next time.
3. **Carried, not waived and not relabelled as tested:** the `:has` fallback (without it the apply button never appears and the primary still works), screen-reader/live-region behaviour, foreign scope, devices, history radio state and native support.

## Boundary
This approves bounded 5-file engineering only. It is not visual, canonical-17 or design-gate approval, and not the final original+C1+C2+C3 union review or ledger closure. Still required:
- a renewed supervising-verified two-layer GO and an actual canonical/gate PASS
- the final full-current-29 union R3
- native support and device proof
- S27, S65 and full S68
