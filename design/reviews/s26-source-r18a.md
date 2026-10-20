Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, review r18a selesai. Saya tidak menulis apa pun, tidak menjalankan tes, DB, browser, atau agent. Laporan teknisnya dalam bahasa Inggris, sesuai brief:

---

# S26 r18a — independent engineering review (two source files, two docs)

## Integrity checks (all re-run after the review)
- **Manifest:** SHA256 `49430c28…cfc9d5` matches.
- **Groups:** each group's digest equals `sha256(json.dumps(group, sort_keys=True, separators=(',',':')))`. All entries match on bytes, mode and SHA, both before and after the review.
  - source 29 → `b55da6fe…0e53`
  - context 14 → `bfd8eb81…b21f`
  - protected 14 → `bcb5f613…be51`
  - baseline 4 → `82730b57…7627`
- **HEAD:** `8b17eee8` at the worktree root. `.next/BUILD_ID` is `fn4mc5lbQ8Q1sCs2Yh835`, which matches build 41.
- **Canonical17 archive:**
  - `design/reviews/s26-round17/manifest.json` SHA `4acf4c2d…b488b432` equals the round17 receipt.
  - All 344 entries re-hash correctly.
  - Against its `sources/current/`, 27 of the 29 sources are identical. Only `checkout-forms.tsx` and `storefront-checkout.test.ts` differ.
  - The baselines for those two files are byte-identical to the archived copies.
- **Doc baselines:** the README (98352 B, `5cec83d5…`) and ARCHITECTURE (58497 B, `3380e997…`) reconstructions exactly match the `taskOwnedChanges[].after` values in the pre-edit boundary `/tmp/99ribu-s26-owner-go-blocked-boundary-r1.json` (SHA `eb4dee5d…`, as recorded in provenance). This confirms the reconstruction even though it is not an original saved copy.
- **Patch:** I rebuilt the unified diff in memory from baseline to current for all four files. It is identical to `/tmp/99ribu-s26-source-review-r18a.patch`. Changed lines: tsx 4 (±2), test 5 (+4/−1), README 2, ARCHITECTURE 2. Nothing else is in the delta.

## What the money fields actually mean
- **Plan total:** `quotes.ts:105` sets `plan.shipping_total` to the sum of per-parcel `shipping_amount`, i.e. the gross carrier tariff.
- **Subsidy and net:** `projectPackages` (`quotes.ts:46-52`) adds `subsidy_amount` per parcel and computes `buyer_shipping_amount = shipping_amount − subsidy`.
- **Chooser data:** `checkoutAllocationChoices` (`checkout.ts:32-48`) passes through the plan's gross `shipping_total` and the per-parcel gross `shipping_amount`.
- **Result:** the new label "Tarif" plus the hint "Tarif belum dikurangi subsidi" (`checkout-forms.tsx:128,130`) describe the data correctly. The parcel card (`:98`) is unchanged: Tarif paket tersimpan (gross), Subsidi (−), Ongkir tersimpan (net).
- **Untouched:** no computation, plan, ID, grouping, keyboard, autosave, control or OAS path changed. The single primary action is still `:195`, and financial confirmation is still explicit.

## Test delta (`storefront-checkout.test.ts:293-295`)
- It reads the current authorized quote and asserts `subsidy_total === 3000` and gross ≠ net on `packages[0]`.
- It asserts the exact text of the checked option heading, built from `rupiah()` in the same `format.ts` the component uses, plus the hint text.
- It asserts the saved tariff and net values on the first parcel card.
- The later checks are still there: final native total, order equality, expiry, and no Purchase event.
- Locators are sound:
  - `span>strong` with `.first()` resolves to the heading before the origin rows.
  - The `input:checked` filter is scoped to the "Pembagian paket" group.
  - The first `.checkout-parcel` corresponds to `quote.packages[0]`.

## Findings
- **P1:** none.
- **P2:** none.
- **P3 (not blocking, no change required by this brief):**
  1. **Summary uses "Ongkir" for the gross amount.** `checkout-forms.tsx:82` labels the gross `shipping_total` as "Ongkir N paket" in the summary, while the card uses "Ongkir tersimpan" for net. The explicit "Subsidi ongkir −" line that follows makes it coherent. This is pre-existing and outside the delta; it is a terminology note for the visual round.
  2. **Hint always renders.** The "Tarif belum dikurangi subsidi" hint shows even when no subsidy applies. It is accurate but adds a little noise.
  3. **Loose substring match.** The `toContainText(rupiah(...))` card checks match substrings; a theoretical prefix collision is negligible here.
  4. **Chooser must render for the test to pass.** The new assertions require `allocation_options.length > 1` (`:192`) in the subsidized fixture. If that isn't the case, the test fails loudly rather than passing falsely. Only the runtime proof can confirm it.

## Coverage
- **Read in full:** the delta; `AllocationChoices` (`checkout-forms.tsx:102-131`); the parcel card and summary charges (`:82,98`); the primary action (`:195`); `checkoutAllocationChoices` (`checkout.ts:32-48`); `projectPackages`/`projectQuote` (`quotes.ts:46-57`) and the gross sum (`:105`); the complete subsidized test (`storefront-checkout.test.ts:284-301`).
- **Hash-only:** the other 27 sources, context, protected files and the 344 archive objects.
- **Not done:**
  - I ran no tests, build, DB or browser.
  - I did not read proof-r15 or any changing output (`/tmp/99ribu-s26-source-review-r18a.txt` was not opened).
  - Build 41's lint, typecheck and build results are claimed by the brief; I did not re-execute them.

## Gates not covered by this review
- The parent still has to audit the actual terminal results of proof-r15.
- Canonical18 still needs fresh renders and a two-layer GO.
- Design-gate exit 0 is still required.
- The final full29 original/C1/C2/C3 union R3 is still required.

**Runtime/model:** Claude Code, claude-opus-5-5. Provider and effort are not exposed.

Verdict: APPROVE
