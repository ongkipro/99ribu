Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, review r5 selesai. Hasilnya **CHANGES REQUIRED**, karena ada satu P2 baru di dropdown pembagian paket. N1, N2 dan dua P3 dari r4 sudah benar terkoreksi. Sesi ini read-only penuh: tidak ada file, tes, DB, provider, agent lain, maupun Git yang disentuh. Plan file juga tidak saya buat walaupun sesi berjalan di plan mode, karena brief melarang semua penulisan.

---

# S26 C1 engineering source review r5 (read-only)

## 1. Runtime and provenance
- **Runtime:** Claude Code CLI session, in plan mode. I used no subagents or other agents.
- **Model:** `claude-opus-5-5`.
- **Provider and reasoning effort:** not available to me.
- **Writes:** none, including temporary and plan files.

## 2. Binding verification (run before and after the review, read-only `python3 -I`, `sha256sum` and `git`)

| Check | Before | After |
|---|---|---|
| HEAD | `8b17eee844ba9715581959fc0821af25ce1b99ef` | same |
| Manifest SHA256 | `c36274c7…7553a5` | same |
| Five map digests (specified recipe) | all match (source `8872afc6…`, context `73c58650…`, currentUnion `cc344729…`, protected `481f017b…`, evidence `190fc885…`) | same |
| Fingerprints: 24 + 62 + 138 + 7 + 112 = **343** | sha256, bytes and mode (stored as decimal, 436 = 0o664): 0 mismatches | 0 mismatches |
| Original archive | objects and source digests valid; all 85/85 snapshot objects match by hash; `originalSource` equals the archive's 21-entry source digest `8538db10…` | same |
| Changed since r4 | computed from the r4 manifest: exactly the 5 listed files; the other 19 are byte-identical | same |

## 3. Reading coverage

**All 24 source files read in full this session:**
- `check-tests.ts`
- app pages: cart, checkout, order, help; `actions.ts`
- all 1306 lines of `globals.css`
- components: `cart-forms`, `checkout-exit`, `checkout-forms`, `checkout-frame`
- modules: `address`, `browser`, `checkout-draft`, `checkout-order`, `checkout-signals`, `checkout`
- both browser tests (checkout 274 lines, cart 268 lines)
- all five `storefront-checkout-*` integration tests

**Context I actually read:**
- AGENTS.md and STATUS lines 1–40
- docs10 CO1–CO8 (lines 350–362) and the S26 render-critique notes
- docs17 lines 466–530
- full `s26-source-r4.md`, `s26-preflight-r2.md`, `s26-preflight-fix-map.md` and `s26-lean-r5.md`
- native `checkout/quotes.ts:56` and `:85–108` (projection and `selectQuote`), `shipping/quotes.ts:64–80`, and a grep of the `routes.ts` selection route

**Context only hash-verified, not read this round:** the rest of the 62 entries. That includes:
- README, BUILD-LOG, TASKS, ARCHITECTURE
- docs07, docs09, docs13
- lean r1–r4, source r1–r3, preflight-r1, visual-context, render-evidence
- the access, consent, advertising, payments, carts, expiry, orders, allocation and rates modules
- fixtures and `package*`

## 4. Evidence inspected (nothing re-executed)

| Evidence | What it actually shows |
|---|---|
| ui-build-r15 | Route table, `EXIT 0`, `git diff --check` `EXIT 0`, `FINAL_EXIT 0`, build `76dc9usEDX8dT03WHLStS`. All 271 manifest inputs match current disk now, and all 16 app sources are inside them. `.next/BUILD_ID` on disk is the same build. |
| ui-build-r14 | Real `EXIT 1`: 3 `noDescendingSpecificity` warnings. Current CSS `:1301–1302` sits after the base rules; there is no waiver. |
| current-functional-r14 | Native `{files:5, passed:10, failed:0, incomplete:0, empty:0}`, exit 0. 8 test inputs, `beforeAfterUnchanged:true`. |
| browser-r20 | `{files:1, passed:20}`, exit 0. Manifest binds the build ID, 271 sources (`2c228249…`, same digest as build-r15), 11 scripts and `beforeAfterVerified:true`. The test file has exactly 20 test declarations. |
| cart-current-r9 | 16/16, exit 0. |
| integrity-r5 | Both targets: 140 tables / 23 migrations, 77 TRUNCATE denials, 140 grants, 0 unvalidated constraints. Applied 46, both prefixes exact, `draftApplied:false`, `executedDDL:false`. `0023` on disk is `ca52af7b…`. |
| Ledger for this run | The FAIL records remain: source-review, draft-resume, current-functional, affected-cart, draft-scope, implicit-enter, draft-retention, visual-preflight and ui-build. Later PASS records follow them. |
| c1-proof-r5 | Only its ledger `s26-c1-evidence` PASS is inspected. I did not read its script or output. |
| Round log | Still 14 entries. No canonical S26 round has been called. |

I did not inspect any images. The browser case `:247–251` is the durable pending-service regression; I checked its assertions in the source.

## 5. Verdict: **CHANGES REQUIRED** (one P2, no P1)

### P2: the allocation option shows a stale fee for the current allocation after a service selection

This is inferred from the code; no test exercised it.

- **Where:**
  - `checkout-forms.tsx:148` renders `rupiah(p.shipping_total)` first.
  - `p` comes from `quote.allocation_options`, which is built from `d.plans` (`checkout/quotes.ts:56`).
  - `selectQuote` (`checkout/quotes.ts:99–107`) re-prices only a cloned `selected_plan` and leaves `document.plans` unchanged.
  - Each plan's stored total is the cheapest-service default (`shipping/quotes.ts:68–69`).
- **Trigger:**
  1. Two-origin cart where `allocation_options.length > 1`.
  2. On the shipping step, choose a non-default (more expensive) service.
  3. Click Tinjau pesanan, then on review click Ubah pengiriman.
  4. `navigate=shipping` keeps the same quote (`checkout.ts:140`).
- **Result:**
  - The closed allocation select for the current allocation reads, for example, `Rp35.000 · 2 paket · …`.
  - The parcel rows and the summary "Ongkir 2 paket" show the real selected total, for example Rp38.000.
- **Invariant broken:** the brief describes N1 as the authoritative shipping amount, and the preflight's N2 standard rejects two contradicting fees on screen. Final review still re-prices, so no wrong amount can be confirmed.
- **Coverage gap:** browser20 never returns from review to shipping after a non-default service, so neither the tests nor the renders can show this.
- **Smallest fix (UI only, no change to native, OAS or pricing):** at `:148` use `p.id===quote.selected_allocation_id?quote.shipping_total:p.shipping_total`. Both values are native.
- **Check to add:** in the two-origin prepaid case, after the existing review, click Ubah pengiriman. Then assert that the selected allocation option text starts with `rupiah(quote.shipping_total)` from the native quote endpoint, and that the parcel rows agree.

### Changes confirmed correct (from code)

**N1:** only the order of native fields changed. No new fee, option ID or allocation logic was added. The P2 above is about the data source, not the reordering.

**N2:**
- The `choices` map is UI-only.
- `selected` uses local choice, then restored `intent.packages`, then native `selected_option_id`.
- A pending parcel replaces its charge rows with a nearby `role=status` explanation.
- Untouched editable rows say "tersimpan", including in the HTML without JavaScript.
- Review mode keeps the native shipping, subsidy and COD rows plus `QuoteCharges` and the confirm amount.
- The select is still a native `<select name="shipping_option_id">`, and the parser and API are unchanged.

**R4 P3, pending restore:**
- `initialCheckoutState:34` filters restored packages to the same quote's parcels and options, so a stale ID cannot reach the select.
- `servicePending` (`:124`) keeps the summary on "Perhitungan tersimpan" after reload.
- The `Parcels` key `${quote.id}:${state.intent.key}` remounts the choices on each accepted server intent.
- The select value is captured before the state updater runs.

I traced these lifecycle paths:
- **Autosave/CAS:** shipping-step `changedSelection` stores the step as shipping.
- **Revert:** the parcel stops showing pending, but the summary stays "stored", which is conservative.
- **Allocation change:** `Parcels` unmounts, and when it remounts, its choices reset.
- **Return to shipping from review:** sends `packages:[]`, so the native selection shows.
- **Final:** native `selectQuote` produces a new priced quote, and the browser test asserts `selected_option_id===chosen` and the order total equals the quote total.

**R4 P3, request-basis label:** recovery now always says "Perhitungan terakhir yang tersedia"; there is no request-amount claim. The exact FormData, key and version path is unchanged (`checkout.ts:185`, `actions.ts:37`).

**Other changes:**
- The allocation acknowledgement is shortened to "Pembagian paket diperbarui." (`checkout.ts:174`).
- The total change uses existing warning roles with `role=status` (`globals.css:1244`).
- Known expiry is stated from native `expires_at` and the reservation clock (`order page :18, :21`).
- Disabled state uses existing neutral values placed after the base rules.
- The `matchMedia` change listener is removed on cleanup (`:86`).
- A wrapped destination text supplements the select (`:143`).
- No font or token was added.

**Preserved invariants (unchanged source rechecked):**
- one native cart, quote, order and payment attempt
- exact-path alias with duplicate and conflict denial (`checkout-order.ts:36–47`)
- integer 99,000 units, COD dues per parcel
- no financial GET, reconnect or automatic attempt
- consent wall-time, opaque dedupe, no backfill, no typed fields, no UI Purchase
- the draft is still operational only

## 6. Non-blocking P3s

1. **Re-quote resets services without a notice.** Going back to contact and then Lanjut ke pengiriman always creates a new quote (`checkout.ts:159–161`), so earlier or pending service choices reset to the defaults with no message. The amounts shown are native and review is mandatory. This existed before this round.
2. **Conservative "stored" label.** A cross-tab stale `intent.packages`, or a reverted choice, keeps the summary on "stored" (`:124`, sticky `dirty`). No money effect.
3. **Unlabeled allocation amount.** The amount is gross before subsidy and no longer says "ongkir". This is copy for the preflight to judge.
4. **Carried from r4:** COD orders past pending show the caution tone (S27).
5. **Carried from r3/r4:** SR lookup control outside contact, fail-closed progress handling, prune coupling/scan/fsync/locks, draft conflicts and cache-dependent exits.

## 7. Status (separate from this verdict)
- Source-r4 APPROVE is historical for the 5 changed files.
- Preflight-r2 NO-GO and all earlier FAILs are retained.
- This is not visual acceptance, a design-gate result or final R3 approval.
- Canonical rounds 15–19 stay blocked until this P2 is fixed and re-reviewed.
- Parent gates are not waived: native support chat, Safari and physical devices, scheduled physical retention, and launch retention policy.
- S27 has not started. S33 stays paused, stopped and unapplied.
