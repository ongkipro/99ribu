Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, review selesai. Hasilnya **CHANGES REQUIRED**: ada dua P2 dan tidak ada P1. Saya tidak mengubah apa pun, tidak menjalankan tes, DB, atau provider, dan tidak memanggil agent lain. Saya juga tidak menulis file plan: Paduka minta laporan hanya ke stdout, jadi itu yang saya ikuti meski harness sedang plan mode. Laporan teknisnya di bawah dalam bahasa Inggris.

---

# S26 C1 engineering source review r2 (read-only)

## 1. Runtime and provenance
- **Runtime:** Claude Code CLI session in plan mode (read-only). No subagents or other agents were used.
- **Model:** `claude-opus-5-5` (Opus 5.5), as exposed by the session environment.
- **Provider and reasoning effort:** not exposed to me, so I am not stating them.
- **Writes:** none. `design/review.md` was not touched and no plan file was written.

## 2. Verification and reading coverage

**Integrity checks I actually ran** (`sha256sum`, `git rev-parse`, Python `-I`, read-only), once before the review and once after:

| Check | Result |
|---|---|
| HEAD | `8b17eee844ba9715581959fc0821af25ce1b99ef` both times |
| Manifest SHA256 | `c465afe3…a9f5` both times |
| Five digests (`sha256(json.dumps(map,sort_keys=True,separators=(',',':')))`) | All match: source `5feb3a49…`, context `ab06a4ac…`, currentUnion `db408f1a…`, protected `481f017b…`, evidence `97f585d3…` |
| On-disk fingerprints | 24 source, 51 context, 104 union, 7 protected, 44 evidence. sha256, bytes and mode all match, 0 mismatches |
| Original archive | `/tmp/99ribu-s26-c0-end-manifest-r1.json`: its `objectsDigest` and `sourceDigest` both recompute correctly. `manifest.originalSource` equals the archive's `source` map. All 21 original source files and all 85 objects in snapshot `/tmp/99ribu-s26-c0-end-snapshot-r1` match. The archived bytes are intact. |
| Post-review total | 251 objects (230 current + 21 original), 0 mismatches |

**Build and test receipts bound to current bytes (checked by me):**
- All 271 inputs of build-r10 still match current disk.
- All 8 test/registry inputs of functional-r7 match current disk.
- The 16 app source objects in this review are among those 271 inputs. The other 8 are tests/registry files bound by functional-r7.

**All 24 source objects were read in full:**
- `scripts/check-tests.ts`
- `cart/page.tsx`, `checkout/actions.ts`, `checkout/order/[orderId]/page.tsx`, `checkout/page.tsx`, `help/page.tsx`
- `globals.css` (all 1300 lines)
- `cart-forms.tsx`, `checkout-exit.tsx`, `checkout-forms.tsx`, `checkout-frame.tsx`
- `shipping/address.ts`, `storefront/browser.ts`, `checkout-draft.ts`, `checkout-order.ts`, `checkout-signals.ts`, `checkout.ts`
- both browser tests (cart in full)
- all five `storefront-checkout-*` integration tests

I also diffed every original file against the archive. The changed files are:
- `check-tests` (adds the draft test to the selector)
- cart page
- frame
- checkout page
- `actions.ts`, `checkout.ts`, `checkout-forms.tsx`
- `globals.css` (+1 line, −1 line)
- cart and checkout browser tests

The other 8 original source files are byte-identical to the archive: `checkout-order.ts`, `checkout-signals.ts`, `address.ts`, `browser.ts`, help, order page, `cart-forms`, and the four older integration tests.

`address.ts` is untracked and was already present in the original archive. I could not diff it against its pre-S26 baseline (`80e4f5d…`), because those bytes are not in any manifest. I checked by reading only that the current validators are intact; I did not diff them.

**Context actually read:**
- `AGENTS.md`
- STATUS lines 6–49 (current S26)
- TASKS T-31, TEST-31 and the S26/S27 rows
- docs17 lines 466–532, plus the keyboard rule at line 496
- docs17 lines 618, 732, 760, 770 (principal changes and drafts)
- docs13 PRIV-1 and its retention lines
- docs10 CO1 (line 353)
- `design/reviews/s26-source-r1.md` (full)
- `checkout/access.ts` (full)
- excerpts: `carts.ts` (`cartClock`, cart lifetime `createCart:80–90`), `config/local.ts` (`privateDirectory`), `access/http.ts` (`assertOrigin`), `catalog/validation.ts` (`invalid` = 400, `object`, `id`)

**Context only hash-checked:** ARCHITECTURE, BUILD-LOG (one grep line excepted), README, docs07, docs09 (grep only), the rest of docs10, `s26-lean-r1`/`r2`, `s26-render-evidence`, the fixture JSON, `next.config`, `package*`, icon/navigation/products/shell, auth/handler/policy, advertising, checkout expiry/orders/quotes/routes, consent, local fixtures, payments, shipping allocation/quotes/rates, storefront cart/catalog/format, `storage/private.ts`, `checkout-fixture.ts`.

This time I did not re-read `quotes.ts`/`orders.ts`. My replay and idempotency claims rely on the r1 reading plus the executed integration evidence.

**Raw evidence inspected:**

| Evidence | What it shows |
|---|---|
| `current-functional-r7` | `{"ok":true,"files":5,"passed":9,...}` exit 0; browser wrapper exit 0 |
| `browser-r13` | `passed 15` exit 0. Manifest: build `-Q6Et1PoeCj7Fow1A4di5`, 271 inputs, 11 served scripts, `beforeAfterVerified: true` |
| `cart-current-r5` | 16/16, unchanged cart test SHA `a4a67cba…` |
| `native-cart-current-r3` | Real FAIL 8/16 |
| `cart-diagnostic-r2` | Native "Jumlah itu belum tersedia" on a retained foreign fixture |
| `native-cart-current-r4` | 16/16 |
| `draft-resume-red-r1` | Real assertion failure: `''` vs the saved note |
| `draft-resume-red-r2` | Fixture-namespace error; a test defect, not product proof |
| `draft-resume-green-r1` / `r2` | Pass |
| `draft-scope-red-r1` | Private fields still visible with the denied status, exit 1 |
| `ui-build-r10` | Exit 0, `git diff --check` 0, 271 inputs unchanged |
| `integrity-r2` | 46 applied files, prefix-23 exact, 140/23 on both targets, `draftApplied:false`, `executedDDL:false` |

I re-executed none of these.

**Filesystem observation (metadata only, contents not read):** `.local/artifacts/checkout-drafts/` currently holds **11** files. They are mode 0600, 487–672 bytes, with mtimes 21:44–21:54 today. They come from browser sessions that the tests signed out.

## 3. Engineering verdict: **CHANGES REQUIRED** (two P2s, no P1)

### P2-1: Pressing Enter in a contact field exits checkout to `/cart`
**Where:**
- `checkout-frame.tsx:7` renders `<CheckoutExit/>` in the header, before `<main>`.
- `checkout-exit.tsx:6` makes it `type="submit" form="checkout-form" name="navigate" value="cart"`.
- The form starts at `checkout-forms.tsx:128`.

**Trigger:** on the contact step, press Enter in Nama penerima, Nomor HP, Email or "Cari wilayah", with JS on or off. The mobile Search/Go key in the `type=search` field does the same.

**Result (inferred, not executed):**
1. HTML implicit submission clicks the form's *default button*. That is the first submit button in tree order whose form owner is the form, so the header "Keranjang" button wins.
2. The form submits with `navigate=cart`.
3. `actions.ts:37–44` saves the draft and calls `redirect('/cart')`.

The buyer is taken out of the task without asking. A user pressing Enter in "Cari wilayah" expects a lookup and lands on the cart instead.

The draft is preserved, so no data is lost. Still, this breaks docs17:496 ("only explicit confirm/appropriate form submission commits") and the CO1 expectation of a predictable task shell. In r1, pressing Enter only ran the lookup (P3). The correction made this worse.

No test presses Enter: every browser case uses `click`/`fill`.

**Smallest correction:** make sure the checkout form's default button is never an exit. The default should be the step's own action, or a no-op navigate to the same step. For example, put a non-exit submit control first in tree order. Note that relying on `display:none` default buttons is inconsistent across engines.

**Check:** a browser case pressing Enter in name, phone and search fields with JS on and off. Assert the URL stays `/checkout`, the expected step and lookup result appear, and no redirect to `/cart` happens.

### P2-2: Draft files holding raw contact data are never physically deleted after sign-out, session expiry or cart expiry
**Where:** physical deletion happens only in three places:
- `checkout-draft.ts:67–68`: a logically expired file, but only when it is read through an open, unexpired cart.
- `checkout-draft.ts:92`: `clearCheckoutDraft`.
- `actions.ts:56`: the best-effort clear after a committed order.

`checkout.ts:104` reads the draft only when `cart.state==='open'&&!expired`. The file name is an HMAC over the session (users) or guest context (guests) and the cart.

**Triggers:**
- A guest fills in contact details (an autosave writes the file), then signs out, the guest context expires, or the 7-day cart expires.
- A user's session ends.
- The post-order clear fails.

**Result:** the file holding name, phone, email, address and note in plaintext can never be reached by any code path again. It stays on disk indefinitely. Its `expires_at` (at most 24 hours of wall time) is logical only.

**Observed:** 11 such files from signed-out test sessions exist now. Their persistence beyond 24 hours is inferred from the code, not observed.

This conflicts with:
- docs17:760 ("Confirmed sign-out clears private view, caches and scoped drafts")
- docs17:770 ("session/principal changes invalidate… drafts")
- docs13 PRIV-1 ("deletion/retention tests… across primary storage")

These files also sit outside any data inventory, and a deletion request cannot locate them by buyer.

The brief says no purge is claimed, and I do not infer a waiver. Moving this to a parent PRIV-1 gate would need an explicit recorded owner decision.

**Smallest correction:** a bounded, state-free sweep, for example on the POST write path. Remove `*.json` and `*.tmp` files under `checkout-drafts` whose mtime is older than 24 hours plus a small margin. Every file's logical life is already at most `updated_at` + 24 hours, so this is safe. Optionally also clear the session's drafts on sign-out.

**Check:** an integration case that writes a draft, signs out, and ages the file mtime or wall time. Assert the next write removes the orphan and any stale `.tmp` file.

### Refuted or verified candidates
- **The draft gates the exact unknown order retry.** Refuted. `actions.ts:37` skips the pre-save when `kind==='order'` without `navigate`. The post-write is skipped for `unknown`. The retry body/key/version come from the exact intent. Executed proof: runtime test lines 52–57 and browser discarded-reply case.
- **Native quote/selection succeeds but the later cache write fails.** Safe. `actions.ts:65` keeps the success and appends a "Draf belum tersimpan" message. On reload, `progress.quote` no longer matches, so the user restores at the contact step with the pre-saved fields.
- **Draft read fails inside `fresh()` after a native quote succeeds.** Safe. `acceptedQuote` throws 503, the state becomes `unknown`, and the exact idempotent replay is kept. For submitted carts, `fresh()` does not read the draft, so a committed order cannot be misclassified as denied.
- **Stale or reordered writers.**
  - The same writer uses a sequence fence: stale writes are discarded.
  - A different writer must match the current revision, otherwise conflict.
  - Writes are serialized by an advisory lock after `lockActor` and `authorizeCart`, in the same lock order as native code.
  - Writes are atomic: temp file with `O_EXCL`/`O_NOFOLLOW`, fsync, rename, parent fsync. Reads enforce `O_NOFOLLOW`, 0600, current uid, one link, at most 32 KiB.
  - Executed proof: draft test lines 22–26 and the browser conflict case.
- **The `buyer_note` P2 from r1.**
  - Fixed: the raw note is restored from the draft (`checkout.ts:104`).
  - Review-step editing is in `checkout-forms.tsx:143`, with explicit empty-note copy and no duplicate hidden field (`omit` at line 120).
  - Invalid review input resets the action to quote/contact (`checkout.ts:156`, draft test line 27).
  - A cross-session resume with no draft now shows the note as empty and editable, not silently dropped.
  - Executed proof: RED-then-GREEN, plus the browser note asserted in the DB as `'SYNTHETIC final note Ring once'`.
- **Revoked autosave keeps private data visible.** Fixed. `denied` triggers `setDenied`, which shows the recovery branch. Executed proof: browser test line 104, after the real RED.
- **Order alias, capability and cookies.** `checkout-order.ts` is byte-identical to the archive. The executed proof is unchanged: runtime test lines 69–91 and payment pre-read RED-then-GREEN. No S27 receipt was built.
- **Cart fixture change weakens the test.** Refuted. The diff only replaces the global first-available search with an owned namespace created through the existing owner/MFA/seed/curation writers, and adds exact-ID fetches. Name assertions are kept and 16 cases are preserved. The failure is reproduced as a real native stock shortfall on a retained foreign fixture.

## 4. Non-blocking P3 observations
- **A broken derivative file blocks checkout.** `checkout-draft.ts:41,45` with `checkout.ts:104–105`: a corrupt or format-mismatched file throws `invalid()` (400), which surfaces as **"denied"**. A bad directory mode surfaces as "unavailable". Either one blocks that session/cart's whole checkout until the cart expires. Suggest treating an unreadable draft as empty (quarantine or unlink) rather than as a session denial.
- **Header exit stays put when the save fails.** `actions.ts:39–44`: the exit does not navigate if the pre-save returns unavailable or conflict. The message explains it, but the cart/home exit depends on the cache.
- **Conflict handling is one-shot.** On conflict, the client (`checkout-forms.tsx:37`) and the post-write (`actions.ts:63`) adopt the other writer's revision. The next explicit submit then overwrites silently. Without JS, the stale-revision submit stays blocked until reload. Behavior is inconsistent between JS and no-JS, though not silent loss.
- **Denied pre-save returns the raw intent.** `actions.ts:41` sends the full submitted intent back, while `mutateCheckout`'s lost-scope path scrubs it (`checkout.ts:185`). Nothing is displayed, but it is inconsistent.
- **Whitespace-only note.** `checkout-forms.tsx:143` shows no "Tidak ada catatan" hint for a note of only spaces, yet the wire omits it.
- **Extra locking work.** Every nonfinancial submit now runs up to four transactions taking `FOR UPDATE` on the guest/user and cart rows, plus two fsync'd writes. A GET render also takes those row locks (`checkout-draft.ts:56–60`).
- **Unchanged P3s from r1** (`checkout-order.ts:38`, `:60`; `checkout-signals.ts:38`) still apply. The r1 Enter-key P3 is superseded by P2-1.

## 5. Slice and parent assessment (separate from this verdict)

| Item | Assessment |
|---|---|
| Draft durability (r1 blocker) | Implemented, with executed proof. It still needs P2-1 and P2-2 fixed and fresh proof. |
| Physical retention | Slice-level P2 (above). This review did not find it waived. |
| Native support chat (CO8/S44) | Blocks the parent T-31/TEST-31 only, after downstream S43/S44. The current FAQ and "Kembali ke checkout" are an acceptable interim surface. |
| Safari / physical devices | Unavailable. Blocks parent acceptance only; record it as not run. |
| S27 full receipt | Correctly not built; it follows S26 closure. |

**Still pending, none approved here:** the P2 corrections with fresh executed proof and a re-review; canonical S26 visual review and `design-gate` 0; final current original+C1 union-bound R3; ledger closure. The 14 global visual rounds and the S21/S22 archives do not approve S26. This review grants no visual, S26 or parent acceptance.
