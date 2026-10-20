Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, review r4 selesai. Hasilnya **APPROVE untuk engineering**: tidak ada P1 maupun P2. Ini bukan approval visual atau final.

Sesi ini benar-benar read-only: tidak ada edit, file sementara, plan file, tes, akses DB/provider, maupun agent lain. Brief melarang semua penulisan, termasuk plan file, jadi saya mengikuti larangan itu walaupun sesi berjalan di plan mode. File kosong `/tmp/.r3verify.py` dari r3 masih ada (0 byte); saya tidak menyentuhnya.

---

# S26 C1 engineering source review r4 (read-only)

## 1. Runtime and provenance
- **Runtime:** Claude Code CLI session, in plan mode. No subagents or other agents were used.
- **Model:** `claude-opus-5-5`, as exposed by the session.
- **Provider and reasoning effort:** not available to me.
- **Writes:** none, including temporary files and plan files.

## 2. Binding verification (run before and after the review)
All checks used read-only `python3 -I`, `sha256sum` and `git`.

| Check | Result |
|---|---|
| HEAD | `8b17eee844ba9715581959fc0821af25ce1b99ef`, same before and after |
| Manifest SHA256 | `5ba4c1bd…dd00b9`, same before and after |
| Five map digests (specified recipe) | All match:<br>• source `cfabd083…`<br>• context `de471dfc…`<br>• currentUnion `00e37151…`<br>• protected `481f017b…`<br>• evidence `89375a9a…` |
| On-disk fingerprints | 24 source + 59 context + 134 union + 7 protected + 90 evidence = **314**. sha256, bytes and mode: 0 mismatches before and after. |
| Original archive | End manifest SHA `c4568af8…`. Its objects digest is valid. All 85 snapshot objects hash-match. `originalSource` equals the archive's 21-entry `source` map (`8538db10…`). These 21 differ from current disk, which is expected because the continuation edits them. |
| Previous manifest | r3 manifest is `ea185ae0…`. The changed files I computed are exactly the 5 listed. All 19 unchanged files are byte-identical. |
| r3 report | `design/reviews/s26-source-r3.md` SHA `50c689f1…` matches STATUS. |
| Protected SQL | `0023` is `ca52af7b…`, unchanged. |

## 3. Reading coverage (separate from hash coverage)

**All 24 current source files read in full** (not only a diff):
- `check-tests.ts`, including the full long PR-7 line
- app pages: cart, checkout, order, help; `actions.ts`
- `globals.css`, all 1301 lines
- components: `cart-forms`, `checkout-exit`, `checkout-forms`, `checkout-frame`
- modules: `address.ts`, `browser.ts`, `checkout-draft`, `checkout-order`, `checkout-signals`, `checkout.ts`
- both browser tests (checkout: 271 lines; cart: 267 lines)
- all five `storefront-checkout-*` integration tests

**Context actually read:**
- `AGENTS.md` and STATUS (header, lines 21–62)
- full `s26-source-r3.md` and `s26-preflight-fix-map.md`
- docs17 lines 466–532 (entry/steps, persistence, help, accessibility, milestones, matrix)
- docs10 CO1–CO8 (lines 353–360) and line 604
- docs07:220 and docs09:367 (the exact `checkout_access` bridge)
- docs13 PRIV-1 lines 42–52
- native `orders.ts` status/COD lines, `payments/cod.ts:18–19`
- a grep of the established `run_at` test pattern

**Context only hash-verified, not read:** the remaining context entries, including:
- README, BUILD-LOG, TASKS, ARCHITECTURE
- lean r1–r4, source r1/r2, preflight-r1, visual-context, render-evidence
- `access`, `consent` and `advertising` modules
- `carts`, `quotes`, `expiry`, `routes`, `attempts`
- shipping allocation/quotes/rates
- the fixture JSON and `package*`

## 4. Evidence inspected (I re-executed nothing)

| Evidence | Actual content |
|---|---|
| ui-build-r13 | Route table, `EXIT 0`, `git diff --check` `EXIT 0`, 271 inputs unchanged, build `W67YzYokNx9HzSFUEmek6`. All 271 inputs match current disk now; all 16 app sources are inside them, hash-identical. |
| current-functional-r13 | Native `{files:5, passed:10, failed:0, incomplete:0, empty:0}`, exit 0. Browser runs via r19. The 8 test/registry hashes equal the current manifest; `beforeAfterUnchanged:true`. |
| browser-r19 | `{files:1, passed:20}`, exit 0. Manifest binds the build ID, 271 sources (`7e37ed46…`), 11 scripts, `beforeAfterVerified:true`. The 20 counted cases match the file's 20 test declarations. |
| cart-current-r8 | 16/16, exit 0 |
| integrity-r4 | Both targets: 140 tables / 23 migrations, 77 TRUNCATE denials, 140 grants, 0 unvalidated constraints. Applied 46, prefix 23 exact, `draftApplied:false`, `executedDDL:false`. |
| Retained FAILs | • functional-r9 → browser-r15 exit 1<br>• full diagnostic: native `OFFER_UNAVAILABLE`<br>• functional-r11 → browser-r17 exit 1<br>• subsidy diagnostic: real `42703` "column merchandise_total does not exist" at old test line 222<br>• ledger shows two `s26-current-functional` FAILs plus `s26-c1-evidence` PASS<br>• no `c1-proof-r4` stdout file exists; only the ledger PASS and its script were inspected |

I did not visually review the 57 screenshots or 4 references.

## 5. Engineering verdict: APPROVE (no P1, no P2)

### Change 1: boundary snapshot and UnknownOrder (`checkout-forms.tsx:12–24, 90–91`)

- **What the snapshot holds:** it is the submit-time `CheckoutState`. It is captured only alongside non-null FormData (`:16`), at `:135` and `:120`.
- **What the boundary renders:** `Summary`, which shows cart lines and quote charges only. No contact or address is ever rendered from the snapshot. That data was already on screen for the same principal, so there is no new disclosure.
- **Scope denial scrubs private fields:**
  - `mutateCheckout` sets `lostScope` and returns `initialCheckoutIntent()`, an unavailable denied view and `blocked` (`checkout.ts:184–186`).
  - The controller tests the `blocked`/denied branch (`:119`) before the unknown branch (`:120`).
  - Runtime test `:125` asserts an empty draft and a null quote.

**Retry lifecycle:**
1. The submitted FormData is retained unchanged.
2. A revision bump remounts `CheckoutController`.
3. A guarded `replayed` effect sends exactly one `startTransition(action(retry))` (`:108`).
4. `recovering` keeps the fieldset and autosave disabled until a non-idle result arrives (`:105, :111`).
5. Order intents skip the draft pre-save (`actions.ts:37`). The same key/body/version reaches the native idempotent create, so there is no duplicate order.

I checked three edge cases:
- **Render exception after a captured success but before the `capture(null)` effect runs:** it replays the same key, which is idempotent.
- **Repeated transport loss:** `submitted` survives, so the retry stays available.
- **Error with nothing captured:** it falls back to a reload link with no inferred success.

The executed proof is the browser case `:176–189`: real native commit, discarded reply, held second activation, explicit retry, `submissions===2`, one order, zero Purchase.

**No-JS:** the boundary is client-only. The server-rendered unknown form still posts the exact hidden intent.

### Change 2: status semantics (order page `:18–21`, CSS `:1291–1294`)
- The icon appears only when the state is paid, closed, expired or unknown.
- Pending has no icon and a neutral tone.
- Paid alone uses the success phase.
- Native amount and attempt reads are unchanged (`checkout-order.ts:49–65`).
- The CSS change is confined to `.checkout-payment-status`, `.checkout-caution` and payment-action alignment. Design tokens are unchanged.

### Change 3: totals, select, Help and pending selection
- **Totals:** the review still renders `QuoteCharges` outside the disclosure (`:150`), and per-parcel subsidy and COD due (`:95`).
- **Button:** shows the native `buyer_total` (`:152`).
- **Option text** is built from native fields only: `shipping_amount · courier_name · service_name`.
- **Help link** is a plain `<a href="#checkout-step">` outside the form (`:156`), so there is no POST. Browser `:138` asserts focus.
- **Pending selection:** allocation and service changes set the summary label to "Perhitungan tersimpan" (`:88, :124, :149`). Browser `:244, :247` covers both.
- **Unchanged:** parser, pricing and ID handling.

### Changes 4–5: proof
- `run_at` is set only on this scenario's job, guarded by `status='unknown'` (`:147`). This is the same pattern as native `advertising-worker.test.ts:26` and `storefront-checkout-payment.test.ts:34`. There is no global drain.
- The failed status comes from a real `simulateCollection` plus `ingestProviderEvent` path.
- The expiry fixture is created in `before` (`:31`) and closed exactly once: its test sets the variable to `undefined` first (`:266`).
- The subsidy check now reads the native quote endpoint (`:232`) for the exact active quote ID.
- No assertions were weakened.

### Invariants rechecked (unchanged source)
- The `checkout_access` alias is exact-path and same-value, with duplicate or conflicting rejection (`checkout-order.ts:29–44`).
- Units are integer 99,000.
- Two-origin quantity sums are 4 with distinct origins, and COD sums equal the total (browser `:249–251`).
- Draft CAS and prune stay as approved in r3.
- Milestones: consent wall-time, opaque dedupe, no backfill, no typed fields, no Purchase.
- There is no financial GET or reconnect path.

## 6. Non-blocking P3s (new, inferred from code, not executed)

1. **The explicit-unknown summary is labeled as the request amount but shows the freshly read quote.**
   - **Where:** `checkout-forms.tsx:88, :120` reading `checkout.ts:183–186`.
   - **Order-intent case:** the order submit gets a transport/5xx unknown while another tab has requoted. The UI shows "Total permintaan" with the new quote's total and "Ringkasan sebelum permintaan dikirim", even though that is a post-request read.
   - **Boundary case:** a quote or shipping intent shows the previous calculation as "Total permintaan".
   - **Impact:** none on money. A retry either recovers the original order or returns `QUOTE_SUPERSEDED`.
   - **Smallest fix:** use the recovery label only when `quote.id===state.intent.quote && state.intent.kind==='order'`; otherwise label it as the latest calculation.
2. **A reloaded pending service selection loses its pending label.**
   - **Mechanism:**
     1. JS autosave stores the changed `packages` (`checkout-draft.ts:108–111`).
     2. Reload restores them into the select `defaultValue` (`checkout.ts:34`, `checkout-forms.tsx:95`).
     3. `dirty` starts `false` (`:103`).
   - **Effect:** the summary reads "Total perhitungan" and the parcel amounts belong to the stored option, not the visibly selected one.
   - **Impact:** review re-prices through the native endpoint, so there is no money effect. A pending allocation change is already covered by `allocationChanged`.
   - **Fix:** derive the initial pending flag from `intent.packages` versus `quote.packages[].selected_option_id`.
3. **A COD order past `pending` renders the closed/caution tone.**
   - **Where:** `order/[orderId]/page.tsx:18, :21`; `closed = order.status !== 'pending'`, while COD stays `pending` only until fulfillment moves it on.
   - **Ownership:** S27 owns the full status view.
4. **Carried from r3, still unchanged and disclosed:**
   - the SR-reachable lookup control outside contact (`checkout-frame.tsx:8`, live against the unknown form `id`)
   - prune failure blocking progression
   - per-write directory scan cost
   - fail-closed corrupt progress
   - task exits that depend on draft save
   - fsync and locks

## 7. S26 and parent status (separate from this verdict)
- Source-r1/r2 FAILs and REDs and the T2 Gemini NO-GO stay intact.
- The r3 APPROVE is historical for the 5 changed files; this review supplies the renewed engineering coverage only.
- **Still pending:**
  - canonical S26 visual rounds 15–19 (now unblocked by this engineering PASS, per the owner decision)
  - `design-gate` exit 0
  - the final original+C1 union-bound R3 closure
  - the ledger acceptance
- **Parent gates, not waived:** native support chat, Safari and physical devices, scheduled physical retention, PRIV-1 launch retention.
- S27 has not started. S33 stays paused, stopped and unapplied.
