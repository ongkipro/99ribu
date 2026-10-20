Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
**CHANGES REQUIRED** (engineering only). I found one P2: it comes from reading the code and how browsers restore forms, and I didn't run it. No P1. I wrote no files, including the plan file, because the brief forbids writes. Everything else in the brief's correction list holds up.

## 1. Runtime and provenance
- **Runtime:** Claude Code CLI, model `claude-opus-5-5`. The provider and reasoning effort aren't exposed to me.
- **What I ran:** only read-only commands: `git rev-parse/show/diff`, `sha256sum`, `diff/grep/cat/tail`, and stdout-only Python `-I` hashing.
- **What I did not run:** tests, DB, network, workers, other agents, Git changes or writes. I made no visual, canonical or final claims.

## 2. Binding, checked before and after the review
Each group digest is the sha256 of its map as compact JSON with sorted keys. Each one matched the manifest both times.

| Item | Value | Before | After |
|---|---|---|---|
| HEAD | `8b17eee844ba9715581959fc0821af25ce1b99ef` | ✓ | ✓ |
| Manifest SHA | `bb59a024…a3fd1` | ✓ | ✓ |
| source (29) | `9b74b02386053511feff6b1c0c0f0e6023fd05dc2458da75dbbe717dc21e23a3` | 0 mismatches | 0 |
| context (81) | `a90d399e9130be5da69ded71303b8710b989aaaa43b0a687d206ada7fefee974` | 0 | 0 |
| currentUnion (1026) | `b13334b2dece586b9fb40847dace324a53429483ddc4734dc1f18718b555a5d3` | 0 | 0 |
| artifacts (564) | `48a5fe8779b3e28cf1c3bd360e64f375c482639861d5386a8829e5a6c6ca3b3f` | 0 | 0 |
| protected (14) | `50949604c3d6b952f20d6526d171c4868fba6032c39cdcc76fc4817191474fff` | 0 | 0 |
| evidence (431) | `600919d53f0d59a6b983793d414e0937ef944655f30dda86949b205b5c618405` | 0 | 0 |

- **Per-entry check:** sha256, bytes and mode for all 2145 entries, before and after: **0 mismatches** both times.
- **Missing markers:** 92, all in currentUnion only, and every one is actually absent on disk.

**Snapshots** (I hashed each file against its own manifest; aggregate fields alone weren't enough):
- **Original:** 85/85 match. Its `objectsDigest` and `sourceDigest` recompute exactly.
- **C1:** 849/849 retained files match, and there are 87 deletions. The deleted list equals exactly the objects that are no longer files after C1. All 24 copied C1 sources match.
- **C2:** 13/13 match.
- **C1/C2 `surfaceDigest`:** I couldn't reproduce the algorithm behind this aggregate. All the per-file hashes match.

**Archives:**
- round15: 239 artifact entries (238 objects plus the manifest).
- round16: 325 artifact entries (324 objects plus the manifest).
- Both manifest SHAs equal the values in `c3-proof-r1`, and all 564 artifacts match.

## 3. Coverage
**Read in full: all 29 sources.**
- **Code:**
  - `checkout-forms.tsx`, `checkout-frame.tsx`, `checkout-exit.tsx`
  - the checkout, order, cart and help pages, plus checkout `actions.ts`
  - `cart-forms.tsx`
  - `checkout.ts`, `checkout-draft.ts`, `checkout-order.ts`, `checkout-signals.ts`, `browser.ts`
  - `local/commerce.ts`, `address.ts`, `rates.ts`
  - all 1321 lines of `globals.css`
  - `check-tests.ts` and `tsconfig.json`
- **Fixtures:** both fixture JSON files.
- **Tests:** both browser tests and all five integration tests.

**Diffs and independent checks:**
- **Diff against baseline:** I compared everything against branch `wip/snapshot-20261020-s26`. The other 15 sources are byte-identical to it.
- **Fixture JSON:** walking the JSON against the baseline gives exactly 25 display-only differences (20 in shipping, 5 in commerce). Both baseline SHAs match the starting SHAs in the label proofs. I found no ID, version, rate, postcode, COD rule or `TEST-ONLY` change.
- **tsconfig.json:** before = `d76c59…`, after = `107ed4…`. All 66 removed inputs are under `design/reviews/`, and none of the 458 retained inputs are.

**Targeted reading:**
- **Prior reviews and notes:** source-r8, the round16 fix map, lean-r10 and the debugging consultation.
- **Specs:** docs07:230, docs09:378, docs10:353/372, plus a grep of docs13 and docs17 for draft rules.
- **Code paths I traced:** the caller traces, the server-side draft compare-and-swap (CAS) path, and the order recovery/retry path.

**Hash-only:** the remaining context, artifacts and evidence. I opened no images.

**Proof receipts I read (I re-ran nothing):**
- **Build (build-r22):** `FINAL_EXIT 0`, buildID `wQ2aIfGfYEzT5P7EiP5Sw`. All 271 build inputs match disk now, and so does `.next/BUILD_ID`.
- **Browser (browser-r30):** 22/22 pass; all 11 served chunks match disk.
- **Functional (functional-r24):** native 10/5; all 8 test inputs match.
- **Cart (cart-r16):** 16/16; the cart test SHA matches.
- **Native c2 run (`c2-native-r1`):** PR-3 9, PR-4 11, seed 2. Its manifest records only commands and exit codes, not input hashes. So the claim that only `checkout-forms.tsx` changed since that run rests on `c3-proof`, not on my own hashing.
- **Integrity (integrity-r8):** 140/23 on both targets, all 46 applied files, the 23-entry prefix intact, no DDL.
- **RED runs:** delayed-hydration r1 and r2 both genuinely FAIL with `""`. `header-geometry-green-r1` is genuinely a FAIL, as disclosed.

## 4. Finding: P2 (inferred, not executed)

**Browser-restored stale values are silently autosaved over a newer stored draft.**

**Where:** `src/components/storefront/checkout-forms.tsx:111-118`, together with `checkout-draft.ts:105,110` and `checkout-forms.tsx:145`.

**Invariant broken:**
- The S26 brief: "conflicting draft … without overwriting winner".
- docs10:372: a competing draft must not be adopted.
- docs07:230 and docs09:378: "fences preserve newer progress across … competing tabs".
- The page's own conflict copy says "Muat ulang akan membuka draf tersimpan."

**Mechanism:**
- On first sync, the new effect adopts *any* difference between what is in the page's fields and the server draft, then calls `draftSave.changed()`.
- It can't tell user typing apart from the browser restoring earlier form values. Browsers restore field values (except `autocomplete=off` and hidden inputs) on reload in Firefox, and on back/forward history loads when the page isn't kept in the browser's back/forward page cache. Next serves dynamic pages as `no-store`, and Firefox also skips that cache when there's a `beforeunload` listener (`:62`).
- The restored page gets a fresh `draft_writer` and the current `draft_revision`, so the server's CAS accepts the write (`checkout-draft.ts:105`).
- The write also resets the stored progress step to `contact` (`:110`).

**Scenario:**
1. Tab B saves "Penerima Contoh Terkini".
2. Tab A, holding "Penerima Isian Lokal", shows the conflict.
3. In tab A the buyer clicks "Kembali ke keranjang tanpa menyimpan isian ini" and accepts the leave-page prompt.
4. The buyer presses browser Back (or presses F5 in Firefox while the conflict is showing).
5. The browser restores "Penerima Isian Lokal" before hydration.
6. About 400 ms later the autosave writes it, replacing B's winning draft with input the buyer explicitly discarded, and dropping B's shipping/review progress.

Before C3 this restored text was only visual (the next rerender erased it). No money, order or authorization effect is reachable, because quotes and orders re-validate. But the draft-fence contract the slice owns is broken.

**Minimum fix:** in the first-sync branch, adopt and autosave only when `performance.getEntriesByType('navigation')[0]?.type==='navigate'`. For `reload` and `back_forward`, re-sync to the stored draft with `setDraft({...state.intent.draft})`. The new object forces the controlled commit to overwrite the restored DOM values. Keep everything else unchanged.

**Check (RED before the fix, GREEN after):**
- Extend the competing-drafts browser case: discard link → `other.goBack()` → wait longer than the autosave delay.
- Assert the stored draft still holds the winner (third page or DB), and that the restored page shows the winner without "Draf tersimpan.".
- Playwright's Chromium launch flags are expected to disable the back/forward page cache. The RED itself has to confirm that.
- Keep the 22nd delayed-hydration case green.
- If a correct RED cannot reproduce this in Chromium goBack or Firefox reload, the finding is refuted and the source can be re-reviewed.

## 5. P3 (non-blocking)
- **Undisclosed tsconfig change.** `tsconfig.json` also gained a top-level `"compileOnSave": false` beyond the declared `design/reviews` exclusion. It's IDE-only: `compilerOptions`, include globs and the input set are unchanged. Only the disclosure needs correcting.
- **"Without saving" still shows a leave-page prompt.** Both conflict links fire the native `beforeunload` confirmation, because `unsaved` stays true (`:59`, `:43`). The tests accept the dialog. The copy says "tanpa menyimpan", yet the browser still asks.
- **Earlier pre-hydration choices are still reset.** Service and allocation selects changed before hydration are still reset visibly on rerender, because they're outside the adopted draft keys. That matches the declared scope.
- **Carried over:** the per-write scan ceiling in `checkout-draft.ts:67` (owned by S65).

## 6. Verified sound in code
- **Error mapping:** `COD_UNAVAILABLE` → `payment_method` and `NO_SUPPORTED_ROUTE` → `destination_id`, both using existing native codes and only when the outcome is neither unknown nor a lost scope (`checkout.ts:186`). Each gets a field link (`:142`). The stale-quote case shows a "Hitung ongkir" link.
- **Pages and Help:**
  - The expired/closed prepaid order page shows "Lihat produk" (`page.tsx:27`).
  - Help shows only the cart question on empty/expired pages.
  - The 320px Help link is an SVG with accessible name "Bantuan" and a 44px minimum width.
- **Visual corrections:** the shared caution style on total change, and the summary parcel order using the stable first-appearance order.
- **Draft safety and retry:** the draft metadata layout effect runs before the controller's effect. The state-reference guard is correct. The disabled fieldset prevents adoption during boundary retry. The unknown-outcome form has no ref, so it never adopts.
- **Protected areas:** exact retry key, body and note, cookie aliasing, consent, and no Purchase are all unchanged.

## 7. Pending
These items are not waived and are separate from this review:
- a fresh separate R3 after the fix
- canonical16 is still REVISE, and canonical17 has its own preflight and gate
- the final current-union R3
- native chat, Safari/device testing, the full S27 receipt, S65 operations, and the full68 acceptance
