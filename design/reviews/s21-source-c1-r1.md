Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, review-nya selesai. Hasilnya **CHANGES REQUIRED**, karena ada dua temuan P2. Ini source preflight saja, bukan closure final dan bukan izin eksekusi. Saya tidak mengubah file apa pun selain plan file plan-mode (`~/.claude/plans/perform-a-real-independent-starry-lovelace.md`). Saya juga tidak menjalankan test, browser, DB, migration, atau executor apa pun. Semua evidence yang saya sebut di bawah hanya saya baca, tidak saya jalankan ulang.

## Verdict: CHANGES REQUIRED (bounded S21 source preflight)

### Coverage I verified
- **Repo:** Git root is `99ribu-foundation` and HEAD is `8b17eee`, matching manifest `baseHead`.
- **Manifest objects:** all 59 checked against disk with **0 mismatches** (bytes, mode, sha256).
  - 57 are files.
  - 2 are intentionally missing, and both are confirmed absent: `src/app/(storefront)/not-found.tsx` and `src/app/route.ts`.
- **Digests:** I recomputed both as sha256 of sorted-key compact JSON, and both match:
  - `objectsDigest` `81502d9a…140d`
  - `evidenceDigest` `38aaf577…8c9267`
- **Evidence and child files:** all 19 evidence files match. `childCandidate` `de7ebe21…fe1d` (5800 B) matches.
- **Boundary r1:**
  - `REVIEW_REQUIRED`, 411 task changes, digest `8ec95d18…365a`.
  - Failures 0, missingVerification 0.
  - The only out-of-scope / accepted expansion is `src/app/not-found.tsx`.
- **Stopped SQL:** `migrations/0023_commerce_exceptions.sql` is `ca52af7b…54dc` / 524260 B, matching the manifest. I did not review or execute it.
- **Source I read in full:**
  - `storefront/catalog.ts`, `routes.ts`, `local/storefront.ts`
  - all storefront pages, the root `not-found` and `layout`, and the 3 API routes
  - 5 components
  - `seed.ts`, `commerce-fixture-runtime.ts`, the PR-17 registry in `check-tests.ts`
  - `storefront.test.ts`, `storefront-contract.test.ts`, `storefront-http.test.ts`, `tests/browser/storefront.test.ts`
  - the child candidate test
- **Helpers checked:** `salePublication`, `offerAvailability`, `assertOrigin`, `text`/`id`.
- **Docs read:**
  - S21 sections of 17 (rows 87/228/229/626, §798–804)
  - 03 §245
  - `ARCHITECTURE.md:185`
  - TASKS T-33 and S21/S22
- **Not covered:** the large unrelated sections of the other manifest documents (only skimmed as context), `globals.css` beyond its `:root` token wiring, and the remaining multi-domain HTTP test files in the manifest.

### P2-1: an empty page that still has a next page is shown as "no matches"
- **Where:** `src/components/storefront/listing.tsx:31-32`, caused by `src/modules/storefront/catalog.ts:96-103`.
- **Root cause:** the `offer_kind`, `availability` and `attributes` filters and source validation run in JS after a SQL scan capped at 4×limit.
- **Failing scenario:**
  - A filter like `availability=available` is applied.
  - The first 4×limit candidates don't match.
  - The page comes back with `data=[]` plus a `next_cursor` (03 §245 accepts that).
  - The UI shows "Belum ada produk yang sesuai / Coba kata lain atau hapus filter" right next to "Halaman berikutnya".
  - This conflicts with 17 rows 87/229, where "no matches" and "partial result" must be distinct states.
- **Minimal correction:**
  - When products are empty and `next` exists, render a separate continuation state with page-scoped copy and the next link as the main action.
  - Leave the backend unchanged.
  - Add one check: limit=1 with more than 4 non-matching candidates gives empty data plus a cursor plus the distinct state.

### P2-2: changing category while a facet is checked shows a false "invalid filter" error
- **Where:** `listing.tsx:22-29` with `search/page.tsx:14-16`, and `catalog.ts:35` / `catalog.ts:81`.
- **Failing scenario:**
  - The category select and the `filter.<key>` checkboxes are in one native form.
  - In category A, the buyer checks `size=M`, then picks category B or "Semua kategori" and applies.
  - The server rejects it with 400 and the page says "Ada parameter filter yang belum didukung".
  - This breaks 17 row 228 (changing department updates navigable state) and row 626 (the applied query stays truthful).
  - The current fixtures have no attribute definitions, so the existing tests never hit this.
- **Minimal correction:**
  - Keep the strict server grammar.
  - Split the category control from the facet form: changing category resets attributes, and the facet form carries a hidden `category_id`.
  - Add one test using an attributed category.

### 404 workaround: acceptable for bounded localhost
- **Constant target, no open redirect:** the redirect target is always `/404`, with no user input reflected.
- **Validation before DB:** slug and UUID are validated before any DB call.
- **No existence leak:** an unpublished product and a missing one end up the same.
- **Failures are not hidden:** DB failures are rethrown to the error boundary and are not turned into 404 or a false empty state. Categories only redirect on 400.
- **API unchanged:** REST keeps its direct JSON 404.
- **No framework changes:** no proxy, renderer, upgrade or experimental flag was added.
- **Test coverage:** the dedicated test checks the initial 307 vs direct 404, the final URL, the heading, that no tab is marked current, and footer help navigation.
- **Evidence:** the retained blank-body diagnostic (`status 404, text ""`) supports the workaround. I did not open the upstream issue link (no external calls).
- **Known gaps in coverage:**
  - The browser test covers a malformed product ID but not a well-formed missing UUID. That case goes through the same redirect code path.
  - The original URL is lost (the address bar shows `/404`). This is documented.

### Nonblocking, or belongs to a later task
- Category visibility comes from `publication_head`, not `salePublication`. A category whose product needs review stays visible and shows an empty department.
- `available_filters` only comes from the current page.
- Click-ID/UTM params on `/search` and `/category` fail closed. The landing handling for T-26 must deal with this.
- `sampleUrl` hardcodes `127.0.0.1:3099`.
- `/category/x?category_id=y` silently overrides the param.
- Unfiltered available-offer preference stays with S22, as agreed; not a defect here.

### Child candidate (not integrated, not final)
- The 7 pure cases are correct against the current `matchingVariant` and `catalogQuery`: one-offer conjunction, variant attributes shadowing product facts, OR within a key, unavailable-only, and fail-closed parsing.
- Two things to fix when integrating:
  - Line 63 contains a literal invisible U+200B. Write it as `'\u200B'`.
  - The file is not yet in the PR-17 list in `check-tests.ts:60`. Without registering it, the registered command never runs it.
- I read the child's 7/7 pass and biome logs. I did not run them.

### Remaining gates
1. Fix both P2s, then get a new review.
2. Child completion handoff, then integration, registration and a parent run.
3. Final docs and a new digest-bound boundary.
4. Final digest-bound R3 approval.

**Provenance:** model `claude-opus-5-5` (Opus 5.5) from the system context, provider Anthropic via Claude Code. Reasoning level is not exposed. I did not do any visual inspection of renders.

CROSS_CLI_EXIT=0
