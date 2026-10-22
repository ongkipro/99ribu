# 99ribu Repository Instructions

Adopted at repository root on 2026-10-16. This repository contains canonical documents and the local application implementation. Current acceptance state, open gaps and the next action live only in `STATUS.md`; historical checkpoint narrative lives in `docs/history/`.

## Authority and startup

Read root `STATUS.md`, then the selected S01+ slice in the sole root `TASKS.md`, its parent task, and linked canonical contracts under `docs/spec/`. Root `PRD.md` points to `docs/spec/02-PRD.md`; do not create another PRD or queue. Root `DECISIONS.md` is the sole decision index after the 2026-10-16 promotion reconciliation. `ARCHITECTURE.md` records actual implementation; selected design remains in `docs/spec/04-SYSTEM-ARCHITECTURE.md` and ADRs.

`STATUS.md` owns workflow state and the next action. `.delivery/` owns tool-written execution evidence; its projections do not override STATUS. `BUILD-LOG.md` contains durable verified changes, not a second progress queue. `RELEASE.md` owns the delivery boundary; `OBSERVABILITY.md` owns executable health/recovery probes when defined.

## Implementation scope

Build the complete authorized localhost application with real PostgreSQL, migrations, authentication, domain transactions and worker persistence. Simulate external payment, shipping, advertising, notification and transfer effects at adapters; do not replace business invariants with a second fake implementation. Preserve fixed-price complete offers, physical component stock, immutable money postings, scoped access and separate payment/collection/delivery/printing states.

Use consistent functional SVG icons; never use emoji/emoticons as interface icons or decoration. Write concrete, concise Indonesian UI copy without generic AI filler, exaggerated claims or ornamental headings. Keep selected Inter/purple/yellow and mobile composition; UI completion requires rendered browser evidence and applicable independent design review. Physical carrier/label approval and live-provider acceptance remain separate gates.

## Bounded execution

The optional `python3 docs/spec/scripts/development-task.py prompt S01` helper only prints a task prompt; it executes no implementation or checks. Confirm the helper exists and read its output before using it. Slices remain in `TASKS.md` and never become another backlog.

Before a slice, verify the actual Git root/HEAD and inspect all dirty paths. Declare exact repository-relative globs and protected paths in `delivery-ledger start`; directory labels such as `src/app/` are not recursive globs. Never accept overlapping dirty work automatically. Review the exact overlap and obtain required authorization before changing another task's work. Declare the actual worker/model/provider/reasoning provenance; never invent it.

Use the executed command registry in README and the current evidence in STATUS. PR-7 selects 29 explicit native runtime files and two built browser entries; it excludes historical rollback candidates and separately gated isolated upgrade executors. Other implemented selectors retain their existing domain ownership. Required skipped/TODO/empty tests and unavailable dependencies must fail. Prefer `delivery-ledger record --check NAME --command '<actual command>'` for executable evidence. Record changed behavior, commands/results and unresolved gaps; run `check-boundary` against the final surface. Every R3/R4 slice requires a real separate-agent review bound to the current surface; self-review under another name is invalid. Recheck and review after material changes. Finish the run before any separately authorized commit.

## Stop and resume

On interruption or a failed check, record the active slice, actual dirty surface, evidence/run reference, failure, exact next command and state to resume in STATUS. Preserve work; do not reset, clean, silently retry ambiguous financial effects or mark partial work complete. Missing external credentials do not block authorized simulated journeys. Missing local auth, persistence or browser proof remains an implementation gap.

No credential access, real customer data, live external calls/transfers/messages, deployment, DNS changes, commit or push is authorized by these instructions. Follow the user's specific authorization gates. Prospective npm scripts are not working commands until implemented and executed.


## Specialist routing

Use full-stack-development to carry the selected slice across layers. Load only affected owners: postgres-drizzle for transactions/migrations; better-auth-security and application-security for identity/access; nextjs-development for installed framework behavior; openapi-spec for wire parity; testing-engineering for meaningful behavioral proof. Visible work reuses accepted storefront-ux or admin-product-ux contracts, then design-taste or admin-dashboard plus ui-validation. Current official provider documents gate real adapters; simulated local boundaries do not authorize guessed vendor protocols. Skills guide implementation, while repository requirements and the user's authorization retain authority.


## Terminal completion and evidence freshness

S68 must depend on every accepted local slice and each predecessor must have current executed proof. Duplicate task fields are errors, not overrides. Use the root README registry for exact commands; never mark a slice complete from prompt generation or the bootstrap rehearsal. A material code/schema/config change reopens the affected checks and their downstream consumers before local acceptance can remain PASS.


<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
