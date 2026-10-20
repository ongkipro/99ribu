**Verdict: APPROVE** for the S21 source/contract scope only. This is implementation-review evidence. It doesn't replace visual acceptance: the latest visual verdict is still REVISE, and the owner still has to decide on the five-round visual cap.

**Reviewer runtime:** Claude Code, model `claude-opus-5-5`, provider Anthropic. My reasoning-effort setting isn't exposed to me, so I'm not stating one.

## Boundary and migration checks
- **Fingerprints:** I checked all 288 `taskOwnedChanges` in `/tmp/99ribu-s21-source-boundary.json` against disk (sha256, byte count and mode). 288 match and 0 differ. That's 252 ALLOWED, 30 PREEXISTING and 6 PROTECTED. `src/app/route.ts` is correctly missing, as recorded.
- **Boundary event:** `REVIEW_REQUIRED`, surface digest `7a42345e…de17`, with 0 failures, 0 out-of-scope, 0 unknown and 0 missing verification.
- **Migrations are unchanged:** `migrations/0000–0013` (14 SQL files), the 14 snapshots and `_journal.json` are listed as pre-existing and unchanged. Their current sha256 hashes match the hashes recorded in the latest `.delivery/runs` ledger events, 29 of 29.

## Invariants checked in the actual code
- **Public reads expose only approved publications** (`src/modules/storefront/catalog.ts:53-70`):
  - The product is read from the immutable published revision via `salePublication`, which takes share locks on the product, head and cost sources (`publication.ts:107-121`).
  - The publication is checked twice: at a clock reading taken before the stock work, and again at a fresh `clock_timestamp()` afterwards.
  - The returned fields match the `StorefrontProduct`/`StorefrontVariant` schemas, which forbid extra properties. No SKU, warehouse, stock item, HPP or cost identifiers are returned, and stock contents show only name and quantity.
- **Stock is checked one warehouse at a time:** `offerAvailability` takes the minimum across components inside a single warehouse, so stock from different warehouses is never combined. With no test namespace it takes no locks and reserves nothing.
- **Strict query parsing** (`catalog.ts:27-52`):
  - Unknown or repeated query keys are rejected, and control characters in `q` are rejected.
  - In search, `\`, `%` and `_` are escaped, so they match literally rather than as wildcards.
  - Cursor dates are checked as real calendar dates with microsecond precision; the test's Feb 30 cursor is rejected.
  - The cursor carries a hash of the normalized filters (sorted attribute keys and values), so it can't be reused with different filters, and it grants no access.
  - Page order (rank, then `created_at desc`, then id) matches the comparison used to resume from a cursor.
  - Each page scans at most `limit*4+1` candidates, and `next_cursor` is returned only when unprocessed candidates remain.
- **Hidden categories stay hidden:** a category, or its parent, appears only when a published product uses it. An unpublished category id or slug returns 404, and that check runs before any attribute rules are read (`catalog.ts:78-81`).
- **Attribute filters** (`catalog.ts:72-73`): `matchingVariant` requires every attribute key, any of the values within a key, and all of them on one actual offer, falling back to product facts. The SSR card uses that same offer (`products.tsx:20`).
- **API adapters:** all three are thin GET handlers (`routes.ts`). Responses go through `privateJson`/`problem`, which set no-store, no-referrer and nosniff. Unknown errors become a redacted `SERVICE_UNAVAILABLE` 503. On the SSR pages, only 400/404 errors become the recovery page; anything else is thrown to `error.tsx`, so failures never show as a fake empty list.
- **Host-only sample curation** (`src/modules/local/storefront.ts`):
  - It is called only from the CLI runtime in `scripts/seed.ts`, using a temporary owner account with MFA that is deleted afterwards.
  - It checks the target, namespace, database name, request origin and forbidden headers.
  - The advisory lock runs on a dedicated connection that is closed in `finally`.
  - TEST-ONLY cost assumptions are added only for pristine version-1 products that have no assumption rows yet.
  - It publishes only when there is no current publication and no blockers, so a stale or edited publication is never republished. It never touches stock, cost or the clock.
- **Other checks:**
  - The Inter font file and its LICENSE are self-hosted under `public/fonts/inter-4.1`.
  - Test bucket cleanup is limited to the exact loopback keys.
  - `STATUS.md` honestly keeps S21 active and pending, not complete.

## Non-blocking notes (none is a reachable S21 regression)
1. **Card can understate stock:** `src/components/storefront/products.tsx:20`. With no filters, the card shows `variants[0]` and says "Stok pilihan belum tersedia" if that one offer is out of stock, even when another offer is available. Option selection belongs to S22; suggested fix there: fall back to the first available offer.
2. **Old filter checkboxes after a category change:** in the no-JS form (`listing.tsx`), switching category while ticked filters from the old category are still submitted is rejected by `catalog.ts:81` with a 400. The user gets a correct recovery page, not wrong data.
3. **Long share locks during search:** `listProducts` holds share locks on up to 160 product/head rows for the whole transaction, which can delay a publisher during a scan. This is a local performance limit, not a correctness bug.
4. **Category names can stay visible:** a category stays listed while its products are temporarily hidden by cost-source invalidation. The contract documents this.
5. **Lock connection's database isn't separately checked:** `storefront.ts:23` checks the database name on `identity.sql` only, not on the separate lock connection. Both are opened with the same `target`, so the risk is low.

Out of scope here: options, cart and checkout (S22 onward), deterministic scoped-job proof (S63), and live provider, rights and asset gates. I edited nothing and ran no tests, builds or database commands; this was read-only file, hash and search inspection.
