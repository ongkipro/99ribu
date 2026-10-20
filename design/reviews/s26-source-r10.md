Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
**APPROVE.** This covers only the bounded S26 source-r9 engineering correction: the three changed files. It is not a visual, canonical16/17, full-union or final acceptance.

## 1. Runtime and provenance
- **Runtime:** Claude Code CLI, model `claude-opus-5-5`. Provider and reasoning effort are not exposed to me.
- **What I ran:** only read-only commands. These were `git rev-parse`, `git status --porcelain` (count only), `sha256sum`, `diff -u`, `cat`/`sed`/`grep`/`tail`, and stdout-only `python3 -I` hashing. I also read the installed React/Next package code.
- **What I did not run:** tests, DB, network, credentials, workers, other agents or Git changes. I opened no images. I wrote no repository, plan or evidence file.
- **One write I must disclose:** a stray `mktemp -d -p /dev/shm` created an empty directory, `/dev/shm/tmp.6WUoo4eg59`. It sits outside the repository and outside every manifest map. I removed it straight away with `rmdir`, and nothing was written into it.

## 2. Binding, checked before and after the review
- **HEAD:** `8b17eee844ba9715581959fc0821af25ce1b99ef`, same before and after.
- **Manifest SHA:** `29192c7d…caac3`, same before and after.
- **Other artifact SHAs:** the R9 report `f1aee5f8…64b7` and the patch `3701274c…768c` both match the brief.
- **How the digests are computed:** sha256 of each map as compact JSON with sorted keys. All six recompute exactly, both before and after.

| Group | Count | Digest | Before | After |
|---|---|---|---|---|
| source | 29 | `41187a186cbe19acfd2ad8c7685dbba1e3f7ddeb4ef070fdc81bc2f0ddd9ba81` | 0 mismatches | 0 |
| context | 83 | `96c8aec3064c257d6b83a2f32b4bd629eaef7e82f826b4ebe088fa60bf948207` | 0 | 0 |
| currentUnion | 1028 | `bd1525a6ef113635e08bb31fde613b305898c75b01d41f265083c8a1b4b0c745` | 0 | 0 |
| artifacts | 564 | `48a5fe8779b3e28cf1c3bd360e64f375c482639861d5386a8829e5a6c6ca3b3f` | 0 | 0 |
| protected | 14 | `fa0ba479cab6e756b935039b712814cd55ff5d635b4868cb52166627c58e5e9c` | 0 | 0 |
| evidence | 653 | `c39460d44c12e0037681f3b2dbd07c95ae3c0f94a07135c203443cf90995923a` | 0 | 0 |

- **Per-entry check:** sha256, bytes and mode for all 2371 entries, before and after. There were 0 mismatches both times.
- **Missing markers:** 92, all in currentUnion only, and every one is actually absent on disk.

## 3. Coverage
**Read in full (3 files):**
- `src/components/storefront/checkout-forms.tsx` (all 178 lines)
- `tests/browser/storefront-checkout.test.ts` (all 320 lines)
- `tsconfig.json`

**The other 26 sources were linked by hash, not reread:**
- Each one is byte-identical in sha256, bytes and mode to the R9 manifest `/tmp/99ribu-s26-source-review-r9-manifest.json` (SHA `bb59a024…a3fd1`).
- Each one also matches `/tmp/99ribu-s26-source-r9-snapshot`.
- The three changed files match the snapshot's R9 versions as their "before" side.
- `diff -u` of the snapshot against current for those three files is identical to the frozen patch. The patch has no other content.
- I relied on `-verified.json`, which says the snapshot was reconstructed in scratch and was not a repository restore. I did not re-derive that reconstruction.

**Targeted reading:**
- the R9 report, `s26-lean-r11` and fix-map line 26
- the docs17:488/869 draft and Back/reload contract
- grep hits for the draft contract in docs07:230, docs09:378 and docs10
- the React 19.3.1 bundled with Next 16.4.1: `initInput` during hydration, `track`, `updateInput` and `updateTextarea`

**Hash-only:** all remaining context, artifacts and evidence.

## 4. Correction trace (observed in code)
**Fresh navigation (`navigate`):** first-sync adoption is unchanged. The delayed-hydration case (`:200`) still runs under `navigate`, because `goto` uses `waitUntil:'commit'`.

**Reload, history and missing type:** these now take the `else` branch, `setDraft({...state.intent.draft})` (`checkout-forms.tsx:119`).
- During hydration, React 19.3 keeps the live DOM value. It does not overwrite the value or replay a change event (`initInput(..., isHydrating=true)` followed by `track`).
- The new object reference forces the controller to re-render. On that commit, `updateInput` and `updateTextarea` compare against the live `element.value` and overwrite the restored stale text.
- Passing the same object reference would have bailed out of the render, which is why the copy matters.
- `draftSave.changed()` is never called on this path, so nothing is autosaved.

**Unchanged behaviour:**
- The query, allocation and dirty resets are retained. The `synchronized` state-reference guard still prevents repeats.
- The draft-metadata layout effect (`:57`) is declared before `:111`, so it still runs first.
- Later action replies reach the `else` branch exactly as before.

**Retry boundary:** remounting gives `synchronized=null`.
- Under `navigate`, the disabled fieldset still excludes the fields from FormData, so nothing is adopted.
- Under `reload`/`back_forward`, the `else` branch writes values identical to the `useState` initials. There is no regression.

**Exact retry and native writes:** the unknown-outcome form has no ref, and the exact-retry body and native draft CAS are untouched. The diff adds no native financial, security or API logic.

## 5. Proof receipts (read only; I re-ran nothing)
**RED diagnostics:**
- **red-r1:** fails at `115:114` with `back_forward` expected and `undefined` received. That is the clock harness issue, as disclosed.
- **red-r2:** fails at `115:308`, the stale-value precondition: expected "Isian Lokal", got "Terkini". So Chromium Back did not restore the stale value.
- **fixture-red-r1:** fails at `125:145`. I mapped that column to the third-page `winner` `toHaveValue`; it received "Penerima Isian Lokal". This is a genuine RED of the modeled mechanism. It is not a natural Chromium or Firefox reproduction, and I don't relabel it as one.
- **Limit:** the receipt does not hash the pre-fix component that was under test at the time.

**Fixture faithfulness:**
- It holds the real JS chunks, asserts native `reload`, and changes only `.value`, with no events.
- It then waits for the actual entry POST, `load`, and any pending autosave.
- It proves the result on a third page that reads the native persisted draft.
- It uses no fake timers, navigation or domain logic. I judge that it closes the scoped invariant.

**Build and test receipts:**
- **build-r23:** `FINAL_EXIT 0`. All 271 inputs match disk now, including both changed client and config files. `BUILD_ID` on disk is `6UDfvpBN54wQ8ikiw12Nk`.
- **browser-r31:** 22 passed, 0 failed, 0 incomplete, 0 empty. All 11 served chunks match `.next`.
- **functional-r25:** integration 10/5. All 8 test inputs match disk now.
- **cart-r17:** 16/16 on the same build. The cart test SHA `a4a67cba…3688` matches disk.
- **tsconfig-r2:** confirms parsing ran on clones, the only compiler-mutation key was `compileOnSave`, compiler options and include globs are unchanged, 66 historical files were removed and 458 active files kept. Its `currentSha256` (`beddd455…`) equals disk, and the key is absent.

**Provenance limit (kept as stated):** the native PR-3 (nine) and PR-4 (eleven) runs and the seed (two) are earlier executions. There are no per-command hashed receipts for them after the client-form and tsconfig changes.

## 6. Findings
**No P1 or P2.**

**P3s (non-blocking; I don't infer any waiver from them):**
1. **Typing during the pre-hydration window of a reload/Back load is replaced** (inferred). The field reverts visibly to the stored draft and nothing is persisted. This is consistent with the docs17:488 rule and the "Muat ulang akan membuka draf tersimpan" copy. A missing navigation entry falls back to the same safe path.
2. **The fixture only exercises the text input** (inferred). Restored textarea, select and radio values are covered by my reading of React's `updateTextarea`/`updateInput`/select update code, not by execution.
3. **Carried over:** the `beforeunload` prompt on the "tanpa menyimpan" link, pre-hydration service/allocation choices still outside adoption, and the S65 scan ceiling at `checkout-draft.ts:67`.

## 7. Still pending
These are not waived and are separate from this approval:
- the final full-current-29 union R3
- canonical16 is still REVISE, and canonical17 needs code PASS plus a two-layer visual GO verified by the supervisor
- full68 acceptance, native chat, Safari/devices, the S27 receipt and S65 operations
- the S26 boundary, then stop for the supervisor commit before S27
