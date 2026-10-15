# Serba 99ribu — AI terminal development handoff

Owner: Paduka Ongki. Updated: 2026-10-16.

Current target: complete application behavior on localhost, including a production build served locally with a separate worker. Auth, PostgreSQL, stock/money transactions, chat and UI must be real; only external payment/shipping/ads/notification effects are simulated. Application implementation has not started. This repository pack is the canonical planning handoff, not a running store or production acceptance. Documentation was promoted on 2026-10-16; root STATUS records actual progress.

## Start here

1. Read this entrypoint and [current product gates](02-PRD.md#risks-and-open-questions).
2. Use the [sole task queue and S01–S68 map](../../TASKS.md#execution-semantics--current-localhost-handoff). Existing 39 task IDs remain stable; T-19 future automatic payout is deferred. Each slice has an exact prerequisite checkpoint, deliverable and proof. All remain planned.
3. Review [promotion, runtime and evidence contracts](15-DEVOPS-CICD-MIGRATIONS.md) before implementing the application. The inspected project-init importer requires explicit root-contract/ADR/link reconciliation; document15 now specifies the exact S01 sequence using a pinned generator and existing-repository promotion.
4. For a selected slice, read its primary requirement and affected data/IAM/API/UX contracts. Do not load every document or start unrelated tasks.
5. Use repository-root [STATUS](../../STATUS.md), [TASKS](../../TASKS.md) and [README](../../README.md). The former Documents copy is a retained nonauthoritative snapshot.

The 2026-10-16 request authorizes documentation promotion and the initial GitHub commit/push. It does not initialize the application, access credentials, create orders or deploy. The separate deployed coming-soon site is not evidence for this application.

## Generate one implementation or review instruction

These existing commands are read-only. Run them from `docs/spec/` in this repository:

```bash
python3 scripts/development-task.py list
python3 scripts/development-task.py check
python3 scripts/development-task.py prompt S01
python3 scripts/development-task.py review S01
```

Replace S01 with the selected slice. The helper reads TASKS.md and the canonical fixture, validates dependency order/coverage, and prints the parent's requirement, risk, candidate edit paths, predecessor proofs, delivery outcome, test expectations and review/handoff instructions. It never executes coding commands, selects a model, grants approval or marks a task complete.

Alternatively, invoke `python3 docs/spec/scripts/development-task.py ...` from the actual repository root/worktree. It resolves the root TASKS.md automatically. Use `--help` for syntax. Actual npm/database/browser commands are created and executed during S02–S06; old `--case` examples in task TEST records are prospective selection intent and must be replaced with installed-runner-native commands. Zero selected tests or skipped required services must fail.

## Historical bootstrap rehearsal

Before promotion, `python3 scripts/check-bootstrap-handoff.py` was executed successfully from the staged pack. Do not run this staging-only rehearsal against the canonical repository.

This check creates only a disposable temporary Git worktree, promotes the real pack there using the installed tool, and verifies file hashes, source preservation, expected no-install/BLOCKED status and ledger operation without a commit. It does not scaffold the application or install dependencies. Keep the pack unchanged during the test. It is staging-only and rejects a promoted docs/spec directory; after promotion retain its result as historical handoff proof.

The development-task.py helper remains read-only. Its checker now requires S68 to cover every accepted local slice and rejects duplicate task fields; invalid edits cannot silently bypass the terminal gate.

## Delivery checkpoints

| Slices | Outcome |
|---|---|
| S01–S13 | Promotion/root contracts, pinned tools, PostgreSQL/auth, worker/test harness, accepted composition, scoped access and policy versions |
| S14–S22 | Catalog/component stock, early cost/publication guard, subsidy/allocation, guest order and responsive discovery/PDP/cart |
| S23–S27 | Prepaid simulation, real finance postings, consent/Purchase authority, checkout and private receipt; first buyer vertical slice |
| S28–S34 | Split COD, holiday-aware fulfillment, reconciliation, returns/replacements, exception recovery and actual contribution |
| S35–S40 | Referral/maturity/manual payout plus complete affiliate profile, balances and payout-history UI |
| S41–S48 | Durable chat/customer and CS interfaces, buyer account/address/claim flow, complete receipt recovery |
| S49–S55 | Catalog/warehouse/finance/settings workspaces, scoped reports/exports and private TEST label print center |
| S56–S64 | Local feeds, three advertising adapters/diagnostics, mobile continuity, all 14 scenarios, operational/security proof and API parity |
| S65–S68 | Built-server localhost regression, responsive/browser review, restart and isolated restore, final local handoff |

The table summarizes TASKS.md; it is not an editable second queue. Exact slice prerequisites and Done-when remain there. A local checkpoint can pass while the parent still has a separate merchant, physical-label or remote-production acceptance gate. Never flatten those states into a generic completed label.

## Repository contract material

These retained templates were adopted at repository root on 2026-10-16. Their content is historical input; the actual root contracts own current state:

| Material | Purpose after adoption |
|---|---|
| [AGENTS.md](handoff/root/AGENTS.md) | Small-context startup, canonical owners, bounded implementation, specialist routing and independent review |
| [README.md](handoff/root/README.md) | Actual installed versions and one executed command registry |
| [STATUS.md](handoff/root/STATUS.md) | Sole workflow state: active slice, predecessor evidence, dirty baseline, blocker and exact resume action |
| [BUILD-LOG.md](handoff/root/BUILD-LOG.md) | Durable verified changes, checks and limitations |
| [ARCHITECTURE.md](handoff/root/ARCHITECTURE.md) | Shape actually built, distinguished from selected design |
| [RELEASE.md](handoff/root/RELEASE.md) | Local artifact/acceptance/restore boundary and separate external release gates |
| [OBSERVABILITY.md](handoff/root/OBSERVABILITY.md) | Actual configured health, backlog, reconciliation and recovery probes |

The promotion reconciled these templates at root, retained one root decision index, relocated all six ADRs to `docs/adr/`, and repaired Markdown links. See [promotion manifest](promotion-manifest.json) for the original inventory and reconciliation hashes. `.delivery/` remains tool-written. S01 is partial because the native application scaffold has not run.

## Canonical specifications

| Fact | Owner |
|---|---|
| Owner decisions, observed evidence and open assumptions | [Context](CONTEXT-RECORD.md), [decision index](../../DECISIONS.md) |
| Product behavior, acceptance and open policy gates | [PRD](02-PRD.md) |
| Domain flows and selected application boundaries | [Technical design](03-TECHNICAL-DESIGN.md), [architecture](04-SYSTEM-ARCHITECTURE.md) |
| Entities, versioning, stock and historical snapshots | [Data model](05-DATA-MODEL.md) |
| Roles, guest access and field/object boundaries | [IAM](07-IAM-RBAC-ABAC.md) |
| First-party wire schemas and implementation gaps | [API notes](09-API-SPECIFICATION.md), [OpenAPI](openapi.yaml) |
| Inter/purple/yellow components and responsive presentation | [Design system](10-DESIGN-SYSTEM-WHITELABEL.md) |
| Receipts, ledger, refunds, commission and manual payout | [Billing](11-BILLING-PAYMENTS.md) |
| Trust boundaries, privacy and retention gates | [Security](12-SECURITY-ARCHITECTURE.md), [privacy](13-COMPLIANCE-PRIVACY.md) |
| Local run/migration/restore and future release | [Delivery](15-DEVOPS-CICD-MIGRATIONS.md) |
| Signals, limits and operator recovery | [Observability](16-OBSERVABILITY-RATE-LIMITING.md) |
| Buyer/affiliate/staff screens, states and browser acceptance | [UX flows](17-UX-FLOWS-SCREEN-CONTRACTS.md) |
| Synthetic inputs and expected adverse scenarios | [Fixture](fixtures/localhost-commerce.json) |
| Inspected source provenance | [Source ledger](sources.json) |

[Future native mobile work](FUTURE-MOBILE-APPS.md) remains a later handoff. No extra PRD, tenancy/seller layer or separate super-admin application is introduced.

## Audit corrections in this revision

- Fixed staging-to-repository assumptions that would lose the root decision index or break task/ADR links.
- Assigned explicit API-handler and frontend ownership, including desktop/tablet discovery, affiliate surfaces and operational forms.
- Removed semantic prerequisite traps: early catalog publication/cost checks precede checkout, and atomic ledger primitives precede payment callbacks. Stock races are owned by inventory, not the earlier catalog-only checkpoint.
- Applied local-checkpoint semantics across the whole dependency graph; TEST-ONLY calendars exercise unresolved Sunday/cutoff choices without inventing a production policy.
- Added private original receipt contents/address and versioned offer editing to the API contract, with historical snapshot and identity protection.
- Required real built-server execution, scoped cache/auth/stream tests, nonempty test selection, independent review and reproducible restart/restore evidence.

## Executed planning verification — 2026-10-16

- Suite traceability: planning and ready structural stages PASS;31 Markdown files,155 declarations,39 tasks,zero findings.
- Bootstrap handoff rehearsal: PASS;76 files promoted byte-identically in a disposable orphan worktree, source/README sentinels preserved, expected no-install/BLOCKED state and ledger integrity verified without a commit. This does not complete S01 on the real target.
- Development map/helper: PASS;39 parents,68 ordered slices,14 scenario owners;19 deliberately invalid plans rejected.
- OpenAPI checker: PASS;135 paths,157 operations,210 schemas,3,753 structural/schema assertions.
- Source-ledger audit: PASS;56 records,zero findings as of2026-10-16.
- Cached Redocly2.64.0: exit0; two advisory warnings for draft license metadata and localhost server.
- Independent review: semantic coverage and final money-ordering corrections reviewed; all 68 implementation and 68 review prompts generated; helper check/list/prompt/review and invalid selectors tested in staging and a temporary promoted-layout copy. Source hashes stayed unchanged during that read-only audit.
- Synthetic fixture checker: PASS;8 users,4 offers,3 orders,14 scenario contracts;12 invalid data mutations rejected.

The list above records pre-promotion planning/tool/fixture checks. The word ready above is the suite validator's structural stage, not application readiness. No ecommerce handler, PostgreSQL migration, login, browser UI, provider or production-mode app has been executed. Bootstrap --plan exited0; the application repository was not created. The additional promotion rehearsal used only a disposable temporary repository. Root-contract material retains this executed planning history separately from future application evidence.

Recheck from `docs/spec/`:

```bash
python3 scripts/development-task.py check
python3 scripts/check-openapi-contract.py
python3 scripts/check-localhost-fixtures.py
python3 /data/ai/codex/skills/development-spec-suite/scripts/check-traceability.py . --tasks ../../TASKS.md --stage ready
python3 /data/ai/codex/skills/development-spec-suite/scripts/audit-sources.py sources.json --as-of 2026-10-16
npx --no-install @redocly/cli@2.64.0 lint openapi.yaml --extends recommended --format summary
```

The Python OAS checker uses the already available YAML/JSON-schema environment; pure task/fixture checkers use Python's standard library. Cached Redocly is used here; an unavailable cache is a tooling gap, not a passing lint or permission to silently alter global tools. Revalidate paths and actual dependencies after promotion.

## Remaining gates

The next implementation slice is the remaining native-scaffold portion of S01; documentation promotion is complete. Within foundation, pin supported versions, settle the supported identity/recovery transport, verify actual worktree/bootstrap behavior and execute real commands. Owner Sunday/cutoff policy, merchant-issued interfaces, real advertising destinations/consent activation, physical label acceptance, tax/privacy operational decisions and remote hosting/recovery remain their named later gates. The complete local simulator milestone can proceed without live-provider credentials, while accurately recording those limits.
