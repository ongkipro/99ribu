# Implementation Tasks

Status: Application foundation implementation is underway. Planning/document work exists with individual status below; document-review closure does not complete runtime acceptance. This is the sole repository execution queue. The documentation pack was promoted on 2026-10-16; S01–S02 foundation code exists; current review/checkpoint evidence is owned by root STATUS. The application scaffold and configuration/startup tests now exist; the planning-only OpenAPI checker exists under docs/spec/scripts/. Stack selection is recorded; application initialization and the foundation task T-23 are prerequisites for domain code tasks. TEST commands below are prospective contracts for scripts to be created during setup, not commands claimed to pass today. Frontend tasks below remain planned contracts; execution follows visual/experience acceptance and repository setup.

Use the [ordered slice map](#execution-semantics--current-localhost-handoff) for precise local sequencing and the read-only development-task.py helper for per-slice implementation/review prompts.

### T-1 — Fixed-price catalog
- **Status:** S14 inactive versioned catalog accepted with independent review (ledger RUN-20261015T233509Z-895c010c). Publication and full PR-1 acceptance depend on S16.
- **Primary requirement:** PR-1
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R2
- **Allowed Paths:** src/modules/catalog/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**, scripts/check-tests.ts, docs/spec/scripts/check-openapi-contract.py
- **Depends On:** T-23
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Done when:** Execute TEST-1; observed output satisfies PR-1 acceptance, including its failure case.

### TEST-1 — Fixed-price catalog acceptance procedure
- Target: PR-1
- Ref: npm run test:integration -- --case=PR-1; npm run test:browser -- --case=PR-1 (S14 inactive catalog selectors; full publication acceptance follows S16)
- Expected: S14 real PostgreSQL inactive draft checks cover complete unit/multipack/bundle definitions, fixed integer IDR99000, role/warehouse denial, retry, simultaneous stale-editor conflict, retirement and immutable old definitions. S16 publication/cost guard and later order snapshots complete the remaining PR-1 acceptance. Record actual selector counts/results in the ledger.

### T-2 — Warehouse inventory
- **Status:** S15 native14/built-browser1 accepted with independent R3 approval and ledger RUN-20261015T235629Z-9c7beb1b PASS.
- **Primary requirement:** PR-2
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/inventory/**, src/jobs/worker.ts, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**, scripts/check-tests.ts, docs/spec/scripts/check-openapi-contract.py
- **Depends On:** T-1
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Done when:** Execute TEST-2; observed output satisfies PR-2 acceptance, including its failure case.

### TEST-2 — Warehouse inventory acceptance procedure
- Target: PR-2
- Ref: npm run test:integration -- --case=PR-2; npm run test:browser -- --case=PR-2 (implemented S15 inventory/reservation/expiry/transfer selector; final review required)
- Expected: native14 and browser1 cover physical constraints/movements/scope/stale editors, two real offers competing for the last shared component, cart aggregation/rollback, FIFO/expiry, idempotent release, atomic worker crash/restart, scenario-aware finite retry/backoff and explicit lot-scoped transfer dispatch/partial/zero/damaged/expired receipt/cancel. Real receiver contention credits one winner only; role replacement/relogin cannot recover a result outside current warehouse scope. Final39-path R3 approval and ledger PASS are recorded for S15. Inventory UI and actual checkout consumption remain their consuming slices.

### T-3 — Shipping allocation
- **Status:** S19 trusted shipping/domain primitives accepted after independent review; native9/static30/build and affectednative42 pass; buyer cart/quote HTTP remains S20.
- **Primary requirement:** PR-3
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/shipping/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**, scripts/check-tests.ts, docs/spec/fixtures/shipping-local.json
- **Depends On:** T-2
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Done when:** Execute TEST-3; observed output satisfies PR-3 acceptance, including its failure case.

### TEST-3 — Shipping allocation acceptance procedure
- Target: PR-3
- Ref: npm run test:integration -- --case=PR-3 (implemented S19 trusted shipping/address/rate/contribution primitives; no browser selector until actual buyer quote wiring)
- Expected: PR-3 Given/When/Then scenario and meaningful negative/replay/race cases pass in a local disposable environment. No result exists yet.

### T-4 — Guest checkout and order composition
- **Status:** S20 domain checkpoint accepted after actual combined54-path independent review; native11/browser1/affectednative85/static30/build pass. Dedicated buyer checkout UI remains T-31.
- **Primary requirement:** PR-4
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/checkout/**, src/modules/access/handler.ts, src/jobs/worker.ts, src/modules/shipping/address.ts, src/modules/shipping/rates.ts, src/modules/shipping/quotes.ts, scripts/check-tests.ts, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**
- **Depends On:** T-3, T-11, T-13
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Done when:** Execute TEST-4; observed output satisfies PR-4 acceptance, including its failure case.

### TEST-4 — Guest checkout and order composition acceptance procedure
- Target: PR-4
- Ref: npm run test:integration -- --case=PR-4 (implemented S20; built-browser selector in README)
- Expected: Real guest/account ownership, current publication/finance/rate guards, authoritative integer totals, duplicate/concurrent submit, positive-subsidy stock race, immutable complete-unit/lot lineage and worker rollback/expiry pass in isolated PostgreSQL; built-browser transport evidence is separate from S26 checkout UI. S20 native11/browser1 passed; final independent review remains pending.

### T-5 — Prepaid and COD payments
- **Status:** S24/S28 local payment checkpoints accepted. Combined native24/browser2, affected regressions and final actual independent APPROVE across37 paths pass; S28 ledger PASS/chain verified. Live provider compatibility and later fulfillment/recovery milestones retain their own gates.
- **Primary requirement:** PR-5
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/payments/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**
- **Depends On:** T-4, T-12
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Done when:** Execute TEST-5; observed output satisfies PR-5 acceptance, including its failure case.

### TEST-5 — Prepaid and COD payments acceptance procedure
- Target: PR-5
- Ref: npm run test:integration -- --case=PR-5 (planned repository script; create and document at setup)
- Expected: PR-5 Given/When/Then scenario and meaningful negative/replay/race cases pass in a local disposable environment. No result exists yet.

### T-6 — Packing and handover deadlines
- **Status:** S29 accepted: native12/browser1/build/readiness and affected regressions pass; actual final independent APPROVE verified52 combined paths/40 immutable migration files and original journal prefix. RUN-20261016T160027Z-32424464 PASS/chain verified. Current96tables/20migrations; no live provider or visual acceptance inferred.
- **Primary requirement:** PR-6
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/fulfillment/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**
- **Depends On:** T-4, T-5
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Done when:** Execute TEST-6; observed output satisfies PR-6 acceptance, including its failure case.

### TEST-6 — Packing and handover deadlines acceptance procedure
- Target: PR-6
- Ref: npm run test:integration -- --case=PR-6; npm run test:browser -- --case=PR-6 (accepted S29 native12/browser1 plus affected regressions and final independent combined review)
- Expected: PR-6 valid-waybill H+2 milestone, failed/ambiguous label issuance, separate physical preparation/handover and no premature delivered status cases pass in a local disposable environment. No result exists yet.

### T-7 — Returns exchanges and refunds
- **Status:** S31 and S32 backend checkpoints accepted. S32 RUN-20261018T205142Z-dc0042f9 finished PASS after actual separate full73 original/C1/C2 semantic review, final documentation/boundary approval and verified ledger. Native67/29, built2/2, closed buyer/staff schemas, isolated upgrade1, foundation25/5/static30/OAS5959, affected native130/built11 and installed integrity pass. All46 applied files/prefix23 are immutable; original/C1 failures remain preserved. Parent return/evidence/UI and full PR-7 acceptance remain open under their later owners.
- **Primary requirement:** PR-7
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/returns/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**
- **Depends On:** T-5, T-6
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Done when:** Execute TEST-7; observed output satisfies PR-7 acceptance, including its failure case.

### TEST-7 — Returns exchanges and refunds acceptance procedure
- Target: PR-7
- Ref: npm run test:integration -- --case=PR-7 (implemented S31/S32 runtime checkpoint; excludes historical schema candidates and separately gated isolated upgrades)
- Expected: The29 explicit native runtime files and two built browser entries must pass with actual current negative/replay/race evidence; isolated upgrade and bound full S32 review remain separate gates. Actual native67/29, built2/2 and separately approved isolated upgrade1 pass; final full original/C1/C2 R3 acceptance and remaining parent/UI dependencies stay open.

### T-8 — Affiliate referral
- **Status:** Planned; not started.
- **Primary requirement:** PR-8
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/affiliates/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/app/**, src/components/**, tests/browser/**, src/db/**
- **Depends On:** T-13
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **UI ownership:** Implement the affiliate surfaces assigned in the S01+ slice map, including permitted identity/beneficiary, commission and payout views. Browser proof is required; domain integration alone does not complete the task.
- **Done when:** Execute TEST-8; observed output satisfies PR-8 acceptance, including its failure case.

### TEST-8 — Affiliate referral acceptance procedure
- Target: PR-8
- Ref: npm run test:integration -- --case=PR-8 (planned repository script; create and document at setup)
- Expected: PR-8 Given/When/Then scenario and meaningful negative/replay/race cases pass in a local disposable environment. No result exists yet.

### T-9 — Commission accrual and maturity
- **Status:** Planned; not started.
- **Primary requirement:** PR-9
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/commissions/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/app/**, src/components/**, tests/browser/**, src/db/**
- **Depends On:** T-7, T-8
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **UI ownership:** Implement the affiliate surfaces assigned in the S01+ slice map, including permitted identity/beneficiary, commission and payout views. Browser proof is required; domain integration alone does not complete the task.
- **Done when:** Execute TEST-9; observed output satisfies PR-9 acceptance, including its failure case.

### TEST-9 — Commission accrual and maturity acceptance procedure
- Target: PR-9
- Ref: npm run test:integration -- --case=PR-9 (planned repository script; create and document at setup)
- Expected: PR-9 Given/When/Then scenario and meaningful negative/replay/race cases pass in a local disposable environment. No result exists yet.

### T-10 — Affiliate eligibility queue and manual transfers
- **Status:** Planned; not started.
- **Primary requirement:** PR-10
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/payouts/**, src/modules/finance/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/app/**, src/components/**, tests/browser/**, src/db/**
- **Depends On:** T-9, T-12, T-16
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Auto eligibility/queue only; manual transfer initially; minimum IDR 99,000 inclusive; no affiliate withdrawal request, no silent paid status or duplicate external sending.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **UI ownership:** Implement the affiliate surfaces assigned in the S01+ slice map, including permitted identity/beneficiary, commission and payout views. Browser proof is required; domain integration alone does not complete the task.
- **Done when:** Execute TEST-10; observed output satisfies PR-10 acceptance, including its failure case.

### TEST-10 — Affiliate eligibility and manual transfer acceptance procedure
- Target: PR-10
- Ref: npm run test:integration -- --case=PR-10 (planned repository script; create and document at setup)
- Expected: PR-10 inclusive IDR 99,000 queue threshold, ten default matured commissions, exclusive finance claim, authorized evidence verification, no auto bank call, ambiguous-transfer hold and duplicate-completion cases pass in a local disposable environment. No result exists yet.

### T-11 — Shipping subsidy configuration
- **Status:** S17 accepted after actual independent review; native12/browser1/static30/build and affected regressions pass. Quote/order integration remains S19/S20.
- **Primary requirement:** PR-11
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/promotions/**, src/jobs/worker.ts, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**, scripts/check-tests.ts, docs/spec/scripts/check-openapi-contract.py
- **Depends On:** T-1
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Done when:** Execute TEST-11; observed output satisfies PR-11 acceptance, including its failure case.

### TEST-11 — Shipping subsidy configuration acceptance procedure
- Target: PR-11
- Ref: npm run test:integration -- --case=PR-11 (planned repository script; create and document at setup)
- Expected: PR-11 Given/When/Then scenario and meaningful negative/replay/race cases pass in a local disposable environment. No result exists yet.

### T-12 — Finance reconciliation
- **Status:** S23 primitives/history, S28/S29 collected-receipt/fulfillment and S30 settlement/reconciliation are accepted. S30 closes in RUN-20261016T194052Z-6dfa4b01 after actual combined56-file final APPROVE, native34/15 and built2/2 plus affected regressions and105/21/42 integrity. Original S30/C1 failures remain covered and retained. S34 completes later financial reporting/actual HPP and period-close acceptance; the whole parent is not complete.
- **Primary requirement:** PR-12
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/finance/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**
- **Depends On:** T-4, T-13
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Entry checkpoints:** S23 establishes atomic financial primitives before T-5 callbacks; S30 completes collected-COD and settlement reconciliation after fulfillment.
- **Done when:** Execute TEST-12; observed output satisfies PR-12 acceptance, including its failure case.

### TEST-12 — Finance reconciliation acceptance procedure
- Target: PR-12
- Ref: npm run test:integration -- --case=PR-12 (S23 primitive/history checkpoint; S30/S34 complete reporting)
- Expected: PR-12 Given/When/Then scenario and meaningful negative/replay/race cases pass in a local disposable environment. S23 has primitive/history evidence only; later settlement/reporting and complete PR-12 acceptance remain required.

### T-13 — Role-scoped administration
- **Status:** S09 access checkpoint accepted with separate bound review; domain handlers and full PR-13 fulfillment acceptance remain owned by their later slices.
- **Primary requirement:** PR-13
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/access/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**, scripts/check-tests.ts, scripts/migrate.ts, tests/runner.test.ts, package.json, docs/spec/openapi.yaml
- **Depends On:** T-23
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Done when:** Execute TEST-13; observed output satisfies PR-13 acceptance, including its failure case.

### TEST-13 — Role-scoped administration acceptance procedure
- Target: PR-13
- Ref: `npm run test:integration -- --case=PR-13` and `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-13` (implemented S09 access checkpoint; consuming fulfillment/domain handlers still require their own cases)
- Expected: S09 verifies five real access scenario groups and one built-browser probe, including role/object predicates, MFA, replay and concurrent revocation. Full PR-13 fulfillment query/mutation acceptance remains required when the consuming fulfillment handlers exist; this checkpoint does not claim those handlers.

### T-14 — Buyer and affiliate experience contracts
- **Status:** Complete for document-only TEST-14; S07 structural checks and separate bound review passed. PR-14 runtime acceptance remains assigned to the consuming UI/domain slices.
- **Primary requirement:** PR-14
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R2
- **Allowed Paths:** docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md, docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md
- **Depends On:** None
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Done when:** Execute TEST-14 as a document review; all required screen/action/state/permission contracts resolve and remaining design gates are owned. This subtask does not complete PR-14 or prove runtime behavior; execute the assigned T-8/T-9/T-10 affiliate and T-33/T-35 buyer UI slices after visual acceptance.

### TEST-14 — Buyer and affiliate experience contracts acceptance procedure
- Target: PR-14
- Ref: Review 17-UX-FLOWS-SCREEN-CONTRACTS.md against 02-PRD.md, 05-DATA-MODEL.md and 07-IAM-RBAC-ABAC.md; run the suite traceability checker after edits.
- Expected: Every primary journey identifies entry, permissions, data, validation, pending, success, failure/recovery and next action. This checks documents only; PR-14 rendered acceptance remains unexecuted and requires the explicit T-8/T-9/T-10 affiliate UI slices and T-33/T-35 buyer surfaces below.

### T-15 — Catalog distribution
- **Status:** Planned; not started.
- **Primary requirement:** PR-15
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R2
- **Allowed Paths:** src/modules/catalog/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**, src/app/**, tests/browser/**
- **Depends On:** T-1
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Done when:** Execute TEST-15; observed output satisfies PR-15 acceptance, including its failure case.

### TEST-15 — Catalog distribution acceptance procedure
- Target: PR-15
- Ref: npm run test:integration -- --case=PR-15 (planned repository script; create and document at setup)
- Expected: PR-15 Given/When/Then scenario and meaningful negative/replay/race cases pass in a local disposable environment. No result exists yet.

### T-16 — Operational reliability
- **Status:** S12 corrected durable job/reconciliation checkpoint accepted after final independent review; full economic acceptance remains domain and assembled-localhost slices.
- **Primary requirement:** PR-16
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/jobs/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**, src/jobs/**, src/modules/access/**, scripts/**, docs/spec/03-TECHNICAL-DESIGN.md, docs/spec/05-DATA-MODEL.md, docs/spec/15-DEVOPS-CICD-MIGRATIONS.md
- **Depends On:** T-13
- **Canonical Contract Owners:** 02-PRD.md plus affected 03/05/07/09/11 domain contracts; use 10/17 for visible surfaces.
- **Accepted Invariants:** Preserve owner policies and linked acceptance; no seller settlement or tenant infrastructure.
- **Reopen Conditions:** Stack/API/visual choice changes required behavior or scope.
- **Non-Scope:** Production writes, credentials, commit/push, unrelated modules.
- **Escalation Conditions:** Destructive migration, unverified provider contract, insufficient payout recovery guarantees.
- **Done when:** Execute TEST-16; observed output satisfies PR-16 acceptance, including its failure case.

### TEST-16 — Operational reliability acceptance procedure
- Target: PR-16
- Ref: npm run test:integration -- --case=PR-16 (implemented S12 primitive checkpoint; root README owns coverage)
- Expected: S12 eleven primitive checks prove real claim/retry/lease/crash/reconciliation behavior. Full PR-16 duplicate stock/refund/commission/payout effects still require the consuming domain and assembled-localhost evidence; the primitive checkpoint does not close those scenarios.

### TEST-17 — Locale and rendered interaction procedure
- Target: NFR-2
- Ref: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:prototype` for S08 composition fixtures; consuming runtime slices use the executable README registry as their domain coverage is implemented.
- Expected: Indonesian content/IDR formatting, keyboard recovery, multi-packet cash amounts and accessible error/hold states work in rendered 390/768/1440 journeys. S08 has 36 passing prototype checks; actual device/IME/safe-area and real persisted commerce acceptance remain separate downstream evidence.

### T-17 — Define distinct mobile and desktop shopping composition
- **Status:** S08 bounded prototype checks36, independent visual/design gates and separately bound final review passed. Actual device and persisted-commerce acceptance belongs to the consuming UI slices.
- **Primary requirement:** PR-17
- **Constraints:** UX-4, UI-1, API-1, IAM-1
- **Risk Level:** R2
- **Allowed Paths:** docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md, docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md, docs/spec/design/**, public/**, design/**, package.json
- **Depends On:** T-14
- **Canonical Contract Owners:** UX-4 and existing Design System; PR-17 owns behavior.
- **Accepted Invariants:** Different composition, shared backend/rules; multi-category, guest checkout and per-parcel COD clarity.
- **Reopen Conditions:** Client mode, supported wrapper or payment/auth flow changes.
- **Non-Scope:** Native binaries, bridge, offline checkout, live publication.
- **Escalation Conditions:** Unverified host/payment/auth capabilities or changed business rules.
- **Done when:** Review distinct mobile/desktop prototypes with mixed-category tasks, keyboard/safe-area/back and external-return recovery; record observations before frontend tasks are released. Document validation alone does not complete rendered acceptance.

### T-18 — Maintain first-party OpenAPI and client contract
- **Status:** S10 selected local transport/handler checkpoint accepted after independent review; complete business API acceptance remains S64 and domain slices.
- **Primary requirement:** PR-18
- **Constraints:** API-1, IAM-1, SEC-1, DATA-1
- **Risk Level:** R3
- **Allowed Paths:** docs/spec/openapi.yaml, docs/spec/09-API-SPECIFICATION.md, docs/spec/scripts/check-openapi-contract.py, docs/spec/07-IAM-RBAC-ABAC.md, docs/spec/05-DATA-MODEL.md, docs/spec/12-SECURITY-ARCHITECTURE.md, tests/contract/**, src/modules/access/**, src/app/api/v1/**, src/db/schema.ts, migrations/**, scripts/check-tests.ts, tests/integration/access.test.ts, tests/integration/access-http.test.ts, AGENTS.md
- **Depends On:** T-13
- **Canonical Contract Owners:** API-1 for wire schemas, IAM-1 for access, PR-18 for capability.
- **Accepted Invariants:** No manual affiliate withdrawal, no provider-secret client calls, no arbitrary receipt/payout success, one domain authority.
- **Reopen Conditions:** Auth/provider/client or business policy changes.
- **Non-Scope:** New business-domain handlers, SDK publication, credentials and native binaries. S10 may align existing access handlers and shared transport boundaries with API-1.
- **Escalation Conditions:** Proposed schema conflicts with issued provider or approved IAM contracts.
- **Done when:** Execute TEST-18, resolve independent contract findings and record owned gaps; S10 additionally proves selected implemented-handler parity; remaining domain parity belongs to its implementation slices.

### TEST-18 — Validate first-party OpenAPI planning contract
- Target: PR-18
- Ref: From the canonical spec directory: npx --no-install @redocly/cli@2.64.0 lint openapi.yaml --extends recommended --format summary; python3 scripts/check-openapi-contract.py
- Expected: Zero structural errors, documented advisory warnings, reference/security/idempotency invariants and schema examples pass. This is planning proof only, not working endpoint evidence.

### T-19 — Validate Virgo outbound merchant payout capability
- **Status:** Deferred candidate research; initial public check complete, issued-contract and sandbox validation pending.
- **Primary requirement:** PR-10
- **Constraints:** DATA-1, BILL-1, IAM-1, SEC-1
- **Risk Level:** R3
- **Allowed Paths:** docs/spec/03-TECHNICAL-DESIGN.md, docs/spec/11-BILLING-PAYMENTS.md, docs/spec/sources.json
- **Depends On:** T-10
- **Canonical Contract Owners:** 02-PRD.md and the applicable domain artifact.
- **Accepted Invariants:** Revalidate current official Virgo partner documentation and account rights; record evidence for or against merchant disbursement, allowed business beneficiary rails, funding/fees/limits, authentication, duplicate control, status/webhooks and ambiguous/failed sandbox cases. Mark unsupported or Unknown if unavailable. No guessed endpoints, live transfers or consumer-wallet assumptions. This task does not block initial manual payouts.
- **Reopen Conditions:** Owner policy or issued provider contract changes.
- **Non-Scope:** Production writes, credential access, live transfers, commit/push, unrelated modules.
- **Escalation Conditions:** Unverified money effect, changed buyer promise or destructive migration.
- **Done when:** Execute TEST-19; record the scoped result without claiming runtime completion from document checks.

### TEST-19 — Validate Virgo outbound merchant payout capability acceptance procedure
- Target: PR-10
- Ref: Review issuer-provided contracts against the checklist in 11-BILLING-PAYMENTS.md and record evidence; sandbox probes only after sandbox scope/access is authorized.
- Expected: Receiving API, consumer-wallet transfer and merchant disbursement are classified separately; only issued capability and passing sandbox recovery evidence can release a future automation task.

### T-20 — Implement contribution-margin review
- **Status:** S16 prospective costs/publication accepted with native9/browser1, independent37-path R3 approval and ledger RUN-20261016T012341Z-3b3defab PASS. S34 actual contribution reporting remains pending.
- **Primary requirement:** PR-19
- **Constraints:** DATA-1, BILL-1, IAM-1, SEC-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/catalog/**, src/modules/finance/**, src/modules/settings/policies.ts, src/modules/access/grants.ts, tests/integration/**, src/app/api/v1/**, tests/contract/**, src/db/**, migrations/**, scripts/check-tests.ts, docs/spec/scripts/check-openapi-contract.py
- **Depends On:** T-1, T-13
- **Canonical Contract Owners:** 02-PRD.md and the applicable domain artifact.
- **Accepted Invariants:** Preserve exact IDR 99,000 offer price, explicit cost assumptions and unknown costs; floor and exceptions are owner-controlled.
- **Reopen Conditions:** Owner policy or issued provider contract changes.
- **Non-Scope:** Production writes, credential access, live transfers, commit/push, unrelated modules.
- **Escalation Conditions:** Unverified money effect, changed buyer promise or destructive migration.
- **Entry checkpoints:** S16 supplies cost/publication guards before checkout; S34 requires T-12 financial postings for actual contribution reporting. Neither checkpoint completes the other.
- **Done when:** Execute TEST-20; record the scoped result without claiming runtime completion from document checks.

### TEST-20 — Implement contribution-margin review acceptance procedure
- Target: PR-19
- Ref: npm run test:integration -- --case=PR-19; PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-19 (implemented S16 prospective checkpoint; S34 realized reporting remains pending)
- Expected: Missing HPP blocks automatic approval, low/negative margin needs authorized reason, affiliate/subsidy costs are included, and estimated versus realized contribution remains explicit.

### T-21 — Implement versioned platform configuration
- **Status:** S13 policy version/snapshot checkpoint accepted with independent review; S16 optional margin-floor/proof consumer extension in progress. Actual order/commission/payout snapshot consumers remain their domain slices.
- **Primary requirement:** PR-20
- **Constraints:** DATA-1, BILL-1, IAM-1, SEC-1, API-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/settings/**, src/modules/checkout/**, src/modules/commissions/**, src/modules/payouts/**, tests/integration/**, src/app/api/v1/**, tests/contract/**, src/db/**, src/modules/access/**, migrations/**, scripts/check-tests.ts, docs/spec/openapi.yaml, docs/spec/scripts/check-openapi-contract.py, docs/spec/05-DATA-MODEL.md, docs/spec/07-IAM-RBAC-ABAC.md, docs/spec/09-API-SPECIFICATION.md, docs/spec/15-DEVOPS-CICD-MIGRATIONS.md
- **Depends On:** T-13
- **Canonical Contract Owners:** 02-PRD.md and the applicable domain artifact.
- **Accepted Invariants:** Immutable commercial snapshots, prospective effective times, role scope and audited changes; fixed IDR 99,000 price remains an invariant.
- **Reopen Conditions:** Owner policy or issued provider contract changes.
- **Non-Scope:** Production writes, credential access, live transfers, commit/push, unrelated modules.
- **Escalation Conditions:** Unverified money effect, changed buyer promise or destructive migration.
- **Done when:** Execute TEST-21; record the scoped result without claiming runtime completion from document checks.

### TEST-21 — Implement versioned platform configuration acceptance procedure
- Target: PR-20
- Ref: npm run test:integration -- --case=PR-20 (implemented S13 policy checkpoint; built browser selector is in root README)
- Expected: Policy change affects applicable new work only, unauthorized settings changes fail, and order terms/claimed payout destination and amount never silently change.

### T-22 — Implement commerce exception recovery
- **Status:** S33 PAUSED by owner at C4 source checkpoint RUN-20261018T235927Z-e5e2309a; incomplete run closes FAIL for the S21→S22→S26→S27 handoff. Current stopped SQLca52af7b.../524260bytes/140 declarations139 distinct names adds unreviewed/uncompiled/unexecuted recovery-return/mixed native consequences; actual source-r1 PASS17/OAS6374/installed integrity is source-only. STATUS owns exact frozen inputs and later S33 resume. Historical progress follows.  Original/replacement retirement, survivor stock, held original claims, original-source obligations, buyer COD recipient acceptance and signed local bank evidence are staged. Actual independent r27 approves corrected bounded source and one definition-only invocation: PASS1 defines165relations/124functions then fully rolls back/stops the fresh owned project; both140/23 targets/all46/prefix23 remain intact. All r13/r21/r27 invocation permissions are consumed. Current-r2 static30/serial29 and corrected r3 static30/focused12/OAS6374 are limited source/compatibility proof. Subsequent unmounted preparation/callback/mixed-claim source corrects two actual r28 P2s; current-r4 static30/serial24/OAS6374/integrity PASS and actual bounded r29b source APPROVE. R29 retracted its cross-case uniqueness P2 after omitted native scope constraints were verified; original reports remain. Subsequent native bank/source framework is staged at stopped/uncompiled SQL24abb77c... with source-only17/OAS6374/integrity PASS and actual bounded r30 engineering source APPROVE. Native recovery-return/retry/mixed/runtime remain incomplete. STATUS owns the next action; BUILD-LOG/ledger retain failures and exact gates. No exception API/proof issuer/PR-21 selector, business/runtime/full localhost acceptance is claimed.
- **Primary requirement:** PR-21
- **Constraints:** DATA-1, BILL-1, IAM-1, SEC-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/checkout/**, src/modules/fulfillment/**, src/modules/returns/**, src/modules/finance/**, src/modules/promotions/reservations.ts, tests/integration/**, src/app/api/v1/**, tests/contract/**, src/db/**
- **Depends On:** T-5, T-6, T-7, T-12, T-16
- **Canonical Contract Owners:** 02-PRD.md and the applicable domain artifact.
- **Accepted Invariants:** No silent substitutions; reconcile late payments and ambiguous labels; partial failures affect only the correct shipment/offer lineage.
- **Reopen Conditions:** Owner policy or issued provider contract changes.
- **Non-Scope:** Production writes, credential access, live transfers, commit/push, unrelated modules.
- **Escalation Conditions:** Unverified money effect, changed buyer promise or destructive migration.
- **Done when:** Execute TEST-22; record the scoped result without claiming runtime completion from document checks.

### TEST-22 — Implement commerce exception recovery acceptance procedure
- Target: PR-21
- Ref: npm run test:integration -- --case=PR-21 (planned script; create at setup)
- Expected: Stock gap, late paid expired order, COD refusal, mixed delivery results, ambiguous waybill and replacement-stock failure scenarios conserve stock/money and show truthful recovery.

## Delivery order after foundational decisions
Preserve all approved scope. Start with T-23 for repository/shared auth/data and real test scripts, then catalog/physical inventory and cost review, allocation/checkout, payment and finance, valid-waybill packing/physical handover, returns and exception recovery, affiliate maturity and manual payout. Build accepted mobile/desktop surfaces around the same domain contracts. Versioned settings and audit enter before affected policy mutations. T-19 is future outbound-API validation; it is not permission to automate transfers or a dependency of initial manual payout release. Provider sandbox, transactional, rendered UX and restore checks remain separate release gates.

### T-23 — Initialize selected application and identity foundation
- **Status:** Complete for the local foundation; S01–S06 and TEST-23 checks passed with separate bound review. Domain, staff grants/MFA and full localhost milestone remain their subsequent tasks.
- **Primary requirement:** TD-1
- **Constraints:** TD-1, ARCH-1, IAM-1, DATA-1, SEC-1, NFR-1
- **Risk Level:** R3
- **Allowed Paths:** package.json, package-lock.json, tsconfig.json, next.config.*, drizzle.config.ts, .node-version, .npmrc, src/config/**, src/storage/**, Dockerfile, compose.yaml, src/app/**, src/db/**, src/modules/access/**, src/jobs/**, migrations/**, tests/**, docs/spec/**, docs/adr/**, TASKS.md, DECISIONS.md, AGENTS.md, README.md, STATUS.md, BUILD-LOG.md, ARCHITECTURE.md, RELEASE.md, OBSERVABILITY.md, scripts/**, .gitignore, .env.example, eslint.config.*, postcss.config.*, src/modules/integrations/**
- **Depends On:** None
- **Canonical Contract Owners:** ADR-0001, ADR-0004, ADR-0006, IAM-1 and DATA-1; documentation promotion is complete. Preserve canonical repository contracts; do not repeat import from staging.
- **Accepted Invariants:** One company/domain authority; PostgreSQL stock/money transactions; server-only provider/secrets; canonical owner role displayed as Super Admin; no invented provider methods.
- **Reopen Conditions:** Selected stable package versions cannot satisfy auth/runtime contracts, or a destination repository already has divergent canonical docs.
- **Non-Scope:** Production provisioning/deploy, credentials, native clients, live provider calls, completed commerce UI or commit/push.
- **Escalation Conditions:** Existing project conflicts, destructive database changes, or required provider access unavailable.
- **Done when:** Execute TEST-23; actual pinned-version setup, disposable database, authentication/deny-by-default and project check scripts pass before dependent domain tasks start.

### TEST-23 — Foundation and identity acceptance procedure
- Target: TD-1
- Ref: After authorized repository initialization, run npm run typecheck, npm run lint, npm run build and npm run test:integration -- --case=foundation, then the built-server foundation browser command and health probe in README. These commands now exist; later case names remain prospective.
- Expected: Installed versions and lockfile are recorded; fresh local PostgreSQL migrations apply; public health responds without exposing secrets; unauthenticated private reads/mutations fail; signed-in user without staff grants is denied; web/worker share durable persistence without a provider call. S01–S06 executed foundation evidence and separate review are recorded in BUILD-LOG and the ledger; this does not establish complete application acceptance.

## Amendments to existing acceptance procedures — 2026-10-15
TEST-6 must cover accepted holiday exclusion, consecutive closures, orders during closures and original deadline anchors. Local calendar tests use an explicit versioned TEST-ONLY Sunday/cutoff policy; production activation requires the owner-confirmed policy. TEST-12 covers company order-history linkage, cash versus COD receivable, incomplete actual/estimated costs and expense/ledger conservation. TEST-13 covers owner (Super Admin) visibility, field-level denial for ordinary staff, explicit finance read/write grants and direct-request/export scope. TEST-16 covers every-day order intake and durable provider-degradation/restart recovery. TEST-20/TEST-21 cover HPP version changes after sale, immutable historical estimates, actual-cost adjustment lineage, unknown margin and fixed IDR 99,000 price. Their existing primary requirements and task completion checks remain unchanged.

Before exposing new admin history/cost/finance screens, preserve API-1 operation/schema parity and the UX-2 state/access contracts; no free-form profit, historical-order or available-stock overwrites. This amendment strengthens existing tasks rather than introducing a second backlog.

### T-24 — Implement durable native support chat and staff inbox API
- **Status:** Planned; not started.
- **Primary requirement:** PR-22
- **Constraints:** DATA-1, IAM-1, SEC-1, PRIV-1, API-1, UX-1, UX-2, PR-16
- **Risk Level:** R3
- **Allowed Paths:** src/modules/support/**, src/app/api/**, src/db/**, src/jobs/**, migrations/**, tests/integration/**, docs/spec/openapi.yaml, docs/spec/09-API-SPECIFICATION.md, src/app/api/v1/**, tests/contract/**
- **Depends On:** T-23, T-13, T-4
- **Canonical Contract Owners:** PR-22, API-1, IAM-1 and the native chat sections of data/security/UX contracts.
- **Accepted Invariants:** Private participant scope, verified order context, no public staff notes, durable idempotent message writes, exclusive agent claim, truthful delivery/read and 24/7 intake versus staffed hours.
- **Visual Contract:** Storefront chat and CS inbox preserve selected product/admin composition; narrow and wide layouts retain accessible composer/history/recovery without hiding checkout controls.
- **Reopen Conditions:** Guest identity, staffing, retention, transport or attachment scope changes.
- **Non-Scope:** WhatsApp, seller marketplace messaging, voice/video, AI agent, financial mutations from messages, production deployment or credentials.
- **Escalation Conditions:** Unresolved identity/retention boundary, leaked internal notes/customer data, or unavailable private upload verification.
- **Done when:** Execute TEST-24; PR-22 functional, access, race/recovery and applicable rendered acceptance pass with synthetic data.

### TEST-24 — Native website chat acceptance procedure
- Target: PR-22
- Ref: npm run test:integration -- --case=PR-22 (prospective repository script; define during implementation)
- Expected: Owner/buyer/guest/CS authorized flows work; cross-customer/order/attachment/cursor attempts fail; send retry persists once; one claim wins; private notes never reach buyer; reconnect/restart restores correct ordered history and unread/read state; off-hours message acceptance is truthful. UI task adds keyboard/focus/mobile composer and independent render review; no runtime result exists yet.

### T-25 — Implement storefront chat and CS inbox interfaces
- **Status:** Planned; not started.
- **Primary requirement:** PR-22
- **Constraints:** DATA-1, IAM-1, SEC-1, PRIV-1, API-1, UX-1, UX-2, PR-16
- **Risk Level:** R3
- **Allowed Paths:** src/app/**, src/components/**, src/modules/storefront/**, src/modules/local/storefront.ts, scripts/seed.ts, scripts/check-tests.ts, tests/integration/commerce-fixture-runtime.ts, tests/integration/storefront*.ts, tests/integration/*http*.ts, tests/auth-http.test.ts, tests/smoke.test.ts, tests/browser/**, design/**, public/**, docs/spec/openapi.yaml, docs/spec/scripts/check-openapi-contract.py, docs/spec/03-TECHNICAL-DESIGN.md, docs/spec/05-DATA-MODEL.md, docs/spec/07-IAM-RBAC-ABAC.md, docs/spec/09-API-SPECIFICATION.md, docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md, docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md, docs/spec/design/renders/s21/**, AGENTS.md, README.md, STATUS.md, TASKS.md, BUILD-LOG.md, ARCHITECTURE.md
- **Depends On:** T-24, T-14, T-17
- **Canonical Contract Owners:** PR-22, API-1, IAM-1 and the native chat sections of data/security/UX contracts.
- **Accepted Invariants:** Private participant scope, verified order context, no public staff notes, durable idempotent message writes, exclusive agent claim, truthful delivery/read and 24/7 intake versus staffed hours.
- **Visual Contract:** Storefront chat and CS inbox preserve selected product/admin composition; narrow and wide layouts retain accessible composer/history/recovery without hiding checkout controls.
- **Reopen Conditions:** Guest identity, staffing, retention, transport or attachment scope changes.
- **Non-Scope:** WhatsApp, seller marketplace messaging, voice/video, AI agent, financial mutations from messages, production deployment or credentials.
- **Escalation Conditions:** Unresolved identity/retention boundary, leaked internal notes/customer data, or unavailable private upload verification.
- **Done when:** Execute TEST-25; PR-22 functional, access, race/recovery and applicable rendered acceptance pass with synthetic data.

### TEST-25 — Native website chat acceptance procedure
- Target: PR-22
- Ref: npm run test:browser -- --case=PR-22 --project=mobile --project=desktop (prospective repository script; define during implementation)
- Expected: Owner/buyer/guest/CS authorized flows work; cross-customer/order/attachment/cursor attempts fail; send retry persists once; one claim wins; private notes never reach buyer; reconnect/restart restores correct ordered history and unread/read state; off-hours message acceptance is truthful. UI task adds keyboard/focus/mobile composer and independent render review; no runtime result exists yet.

## Expanded PR-22 completion boundary — Markdown-only update
T-24 includes the complete PR-22 feature matrix: same-thread reply references, public scoped search, safe typed product/order cards, guest bootstrap/verified recovery, participant archive/mute, generic in-app notifications, saved-reply/template permissions and private tags/priority. First expand openapi.yaml and the API checker against the explicit Markdown delta, then implement handlers/storage/jobs; the earlier core OAS PASS does not cover missing wire features. Preserve original idempotency/claims/read/notes guarantees. Optional presence/typing and browser push are not dependencies of core chat acceptance.

TEST-24 additionally covers forbidden reply/note/quote/search/card references, redaction propagation, notification dedup/seen-versus-read, template placeholders, per-participant preference isolation, a muted incoming message, archived-thread resurface and session-loss/recovery without automatic identity merging.

T-25 implements buyer conversation list/thread, desktop panel/dedicated view, mobile back/keyboard/safe-area behavior, context/reply previews, scoped search/jump, composer drafts, image preview/viewer, new-message/scroll anchoring, in-app notification preferences and CS queue/productivity screens as specified in UX-1/UX-2 and the expanded chat screen contracts. TEST-25 executes that document's mobile/browser/state matrix, including 320px reflow, text enlargement, focus/read announcements, slow/offline/reconnect, background/foreground, cross-thread draft isolation and checkout overlap.

These additions refine the existing two chat tasks, not a second queue. Detailed implementation may split work into further atomic tasks without changing PR-22 scope; no code/runtime/UI evidence is produced by this document-only revision.

## Shared visual implementation amendment — 2026-10-16
When T-14/T-17 contracts are prototyped and T-25 or other frontend tasks implement shared UI, preserve the Design System's selected self-hosted Inter, system fallback, type/spacing/shape defaults, role-appropriate density and semantic component states. Record the pinned font source/license when adopting local assets; no font CDN request from the browser is required. Verification includes actual loaded/blocked font behavior, long labels and financial values, touch/coarse-pointer rows, 320px/200% text, focus and safe-area layout; document checks alone do not complete those tasks. This adds no competing visual queue or application source.


### T-26 — Implement canonical commerce signals, consent and outbox
- **Status:** S25/S28 canonical local signal checkpoints accepted: prepaid and per-parcel COD Purchase/allocation, consent and actual canonical local sink. Combined native17/browser2 and final independent APPROVE pass; ledger PASS/chain verified. Vendor mappings remain S57–S60.
- **Primary requirement:** PR-23
- **Constraints:** DATA-1, IAM-1, SEC-1, PRIV-1, BILL-1, API-1, UX-1, UI-1, OBS-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/advertising/**, src/modules/consent/**, migrations/**, tests/integration/**, src/app/api/v1/**, tests/contract/**, src/db/**
- **Depends On:** T-23, T-4, T-5
- **Canonical Contract Owners:** Documents02/03/05/07/09/10/11/12/13/15/16/17; existing openapi.yaml must be expanded before new wire handlers.
- **Accepted Invariants:** Authorized private access; verified money truth; disjoint merchandise allocation; consent at capture/dispatch; durable identity and safe recovery; selected Inter/purple responsive design.
- **Visual Contract:** Checkout CO1–CO8 and thank-you TY1–TY8 apply where relevant; no giant empty success panel, obstructed money controls or missing mobile totals.
- **Reopen Conditions:** Conversion grain, provider schema/account/source, privacy policy or payment workflow changes.
- **Non-Scope:** Credentials, live accounts/events, campaign budgets, production deployment, commit/push and unrelated code.
- **Escalation Conditions:** Unsupported provider schema, unresolved identity/retention rules, leaked data or ambiguous money evidence.
- **Done when:** Execute TEST-26; all expected cases pass with synthetic data and required authorized provider/browser evidence is separately recorded. Document lint alone is insufficient.

### TEST-26 — Implement canonical commerce signals, consent and outbox acceptance
- Target: PR-23
- Ref: npm run test:integration -- --case=T-26 (executed S25 first-party/prepaid checkpoint; COD remains S28)
- Expected: Duplicate callbacks and races produce one purchase instance per economic receipt; distinct COD collections allocate merchandise once. Consent decline/withdrawal suppresses dispatch; restart/lease/timeout retries preserve ID/time. Verify repeated genuine same-offer cart additions remain distinct; advertising payloads contain only approved consent-eligible matching fields and no raw contact or sensitive commerce/chat data; logs contain no raw PII/matching data. S25 native12/browser1 and final independent review pass; distinct COD collections remain S28.


### T-27 — Implement Meta Pixel and server CAPI adapter
- **Status:** Planned; not started.
- **Primary requirement:** PR-23
- **Constraints:** DATA-1, IAM-1, SEC-1, PRIV-1, BILL-1, API-1, UX-1, UI-1, OBS-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/advertising/meta/**, src/components/analytics/**, tests/integration/**, src/app/api/v1/**, tests/contract/**
- **Depends On:** T-26
- **Canonical Contract Owners:** Documents02/03/05/07/09/10/11/12/13/15/16/17; existing openapi.yaml must be expanded before new wire handlers.
- **Accepted Invariants:** Authorized private access; verified money truth; disjoint merchandise allocation; consent at capture/dispatch; durable identity and safe recovery; selected Inter/purple responsive design.
- **Visual Contract:** Checkout CO1–CO8 and thank-you TY1–TY8 apply where relevant; no giant empty success panel, obstructed money controls or missing mobile totals.
- **Reopen Conditions:** Conversion grain, provider schema/account/source, privacy policy or payment workflow changes.
- **Non-Scope:** Credentials, live accounts/events, campaign budgets, production deployment, commit/push and unrelated code.
- **Escalation Conditions:** Unsupported provider schema, unresolved identity/retention rules, leaked data or ambiguous money evidence.
- **Done when:** Execute TEST-27; all expected cases pass with synthetic data and required authorized provider/browser evidence is separately recorded. Document lint alone is insufficient.

### TEST-27 — Implement Meta Pixel and server CAPI adapter acceptance
- Target: PR-23
- Ref: npm run test:integration -- --case=T-27 (prospective repository script; create during implementation)
- Expected: Current Graph version/fields/source/age limits are pinned from official docs. Synthetic and authorized Test Events verify server-only prepaid/COD Purchase, consent, catalog ID/value and retry identity. Any optional browser pairing proves identical name/source/ID and suppresses historical revisits; no page-load Purchase. No runtime result exists yet.


### T-28 — Implement Google tag and Data Manager conversion adapter
- **Status:** Planned; not started.
- **Primary requirement:** PR-23
- **Constraints:** DATA-1, IAM-1, SEC-1, PRIV-1, BILL-1, API-1, UX-1, UI-1, OBS-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/advertising/google/**, src/components/analytics/**, tests/integration/**, src/app/api/v1/**, tests/contract/**
- **Depends On:** T-26
- **Canonical Contract Owners:** Documents02/03/05/07/09/10/11/12/13/15/16/17; existing openapi.yaml must be expanded before new wire handlers.
- **Accepted Invariants:** Authorized private access; verified money truth; disjoint merchandise allocation; consent at capture/dispatch; durable identity and safe recovery; selected Inter/purple responsive design.
- **Visual Contract:** Checkout CO1–CO8 and thank-you TY1–TY8 apply where relevant; no giant empty success panel, obstructed money controls or missing mobile totals.
- **Reopen Conditions:** Conversion grain, provider schema/account/source, privacy policy or payment workflow changes.
- **Non-Scope:** Credentials, live accounts/events, campaign budgets, production deployment, commit/push and unrelated code.
- **Escalation Conditions:** Unsupported provider schema, unresolved identity/retention rules, leaked data or ambiguous money evidence.
- **Done when:** Execute TEST-28; all expected cases pass with synthetic data and required authorized provider/browser evidence is separately recorded. Document lint alone is insufficient.

### TEST-28 — Implement Google tag and Data Manager conversion adapter acceptance
- Target: PR-23
- Ref: npm run test:integration -- --case=T-28 (prospective repository script; create during implementation)
- Expected: One approved UPLOAD_CLICKS Purchase action is owned by the server; compatible WEB/identifier/consent payload validates. Browser tag only owns eligible funnel signals. No duplicate GA4 Primary purchase. Known-original restatement sends retained value; unmatched adjustments blocked and non-retractable count disclosed. Tag Assistant/authorized ingestion diagnostics distinguish validation, acceptance and attribution. No runtime result exists yet.


### T-29 — Implement TikTok Pixel and Events API adapter
- **Status:** Planned; not started.
- **Primary requirement:** PR-23
- **Constraints:** DATA-1, IAM-1, SEC-1, PRIV-1, BILL-1, API-1, UX-1, UI-1, OBS-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/advertising/tiktok/**, src/components/analytics/**, tests/integration/**, src/app/api/v1/**, tests/contract/**
- **Depends On:** T-26
- **Canonical Contract Owners:** Documents02/03/05/07/09/10/11/12/13/15/16/17; existing openapi.yaml must be expanded before new wire handlers.
- **Accepted Invariants:** Authorized private access; verified money truth; disjoint merchandise allocation; consent at capture/dispatch; durable identity and safe recovery; selected Inter/purple responsive design.
- **Visual Contract:** Checkout CO1–CO8 and thank-you TY1–TY8 apply where relevant; no giant empty success panel, obstructed money controls or missing mobile totals.
- **Reopen Conditions:** Conversion grain, provider schema/account/source, privacy policy or payment workflow changes.
- **Non-Scope:** Credentials, live accounts/events, campaign budgets, production deployment, commit/push and unrelated code.
- **Escalation Conditions:** Unsupported provider schema, unresolved identity/retention rules, leaked data or ambiguous money evidence.
- **Done when:** Execute TEST-29; all expected cases pass with synthetic data and required authorized provider/browser evidence is separately recorded. Document lint alone is insufficient.

### TEST-29 — Implement TikTok Pixel and Events API adapter acceptance
- Target: PR-23
- Ref: npm run test:integration -- --case=T-29 (prospective repository script; create during implementation)
- Expected: Verify current endpoint/payload and Purchase name; do not copy stale phone_number or uncertain Lead mapping. Authorized Test Events verify server-only money outcome, original occurrence time/catalog value and retry identity. Optional pairing tests same event/source/ID and no historical page echo; no promise of ambiguous five-minute enrichment. No runtime result exists yet.


### T-30 — Implement advertising diagnostics and reconciliation
- **Status:** Planned; not started.
- **Primary requirement:** PR-23
- **Constraints:** DATA-1, IAM-1, SEC-1, PRIV-1, BILL-1, API-1, UX-1, UI-1, OBS-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/advertising/**, src/app/**, src/components/**, tests/integration/**, tests/browser/**, src/app/api/v1/**, tests/contract/**, src/db/**
- **Depends On:** T-27, T-28, T-29
- **Canonical Contract Owners:** Documents02/03/05/07/09/10/11/12/13/15/16/17; existing openapi.yaml must be expanded before new wire handlers.
- **Accepted Invariants:** Authorized private access; verified money truth; disjoint merchandise allocation; consent at capture/dispatch; durable identity and safe recovery; selected Inter/purple responsive design.
- **Visual Contract:** Checkout CO1–CO8 and thank-you TY1–TY8 apply where relevant; no giant empty success panel, obstructed money controls or missing mobile totals.
- **Reopen Conditions:** Conversion grain, provider schema/account/source, privacy policy or payment workflow changes.
- **Non-Scope:** Credentials, live accounts/events, campaign budgets, production deployment, commit/push and unrelated code.
- **Escalation Conditions:** Unsupported provider schema, unresolved identity/retention rules, leaked data or ambiguous money evidence.
- **Done when:** Execute TEST-30; all expected cases pass with synthetic data and required authorized provider/browser evidence is separately recorded. Document lint alone is insufficient.

### TEST-30 — Implement advertising diagnostics and reconciliation acceptance
- Target: PR-23
- Ref: npm run test:integration -- --case=T-30 (prospective repository script; create during implementation)
- Expected: Owner can inspect redacted destination status, pause and controlled replay; other roles are denied mutation. Eligible/suppressed/queued/accepted/processed/attributed remain distinct; counts label purchase instances versus unique orders. Refund/net differences and missing identity are visible; provider outages leave checkout operational. No runtime result exists yet.


### T-31 — Implement responsive dedicated checkout
- **Status:** S26 IMPLEMENTING C3 RUN-20261019T180526Z-628997c1. Canonical17 REVISE/log17; build41 layer1 REVISE, F1/F2 corrected. Current42 e54G_i1yjfJDmhuKVI5r1 lint/typegen/type/build/diff0, native11/browser25/cart16 PASS; separate R18b bounded four-source/two-doc APPROVE/all63 verified. Fresh64/199/4refs packetSHA1665e43c…8d9dd frozen; new layer1 simulation plus requested T2/conductor verified GO pending before unspent18. Design-gate/final full29 union/ledger pending. No S27 before CLOSED PASS and conductor commit.
- **Primary requirement:** PR-4
- **Constraints:** DATA-1, IAM-1, SEC-1, PRIV-1, BILL-1, API-1, UX-1, UI-1, OBS-1
- **Risk Level:** R3
- **Allowed Paths:** src/app/**, src/components/**, src/modules/storefront/**, src/modules/local/storefront.ts, scripts/seed.ts, scripts/check-tests.ts, tests/integration/commerce-fixture-runtime.ts, tests/integration/storefront*.ts, tests/integration/*http*.ts, tests/auth-http.test.ts, tests/smoke.test.ts, tests/browser/**, design/**, public/**, docs/spec/openapi.yaml, docs/spec/scripts/check-openapi-contract.py, docs/spec/03-TECHNICAL-DESIGN.md, docs/spec/05-DATA-MODEL.md, docs/spec/07-IAM-RBAC-ABAC.md, docs/spec/09-API-SPECIFICATION.md, docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md, docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md, docs/spec/design/renders/s21/**, AGENTS.md, README.md, STATUS.md, TASKS.md, BUILD-LOG.md, ARCHITECTURE.md
- **Depends On:** T-4, T-5, T-14, T-17, T-26
- **Canonical Contract Owners:** Documents02/03/05/07/09/10/11/12/13/15/16/17; existing openapi.yaml must be expanded before new wire handlers.
- **Accepted Invariants:** Authorized private access; verified money truth; disjoint merchandise allocation; consent at capture/dispatch; durable identity and safe recovery; selected Inter/purple responsive design.
- **Visual Contract:** Checkout CO1–CO8 and thank-you TY1–TY8 apply where relevant; no giant empty success panel, obstructed money controls or missing mobile totals.
- **Reopen Conditions:** Conversion grain, provider schema/account/source, privacy policy or payment workflow changes.
- **Non-Scope:** Credentials, live accounts/events, campaign budgets, production deployment, commit/push and unrelated code.
- **Escalation Conditions:** Unsupported provider schema, unresolved identity/retention rules, leaked data or ambiguous money evidence.
- **Done when:** Execute TEST-31; all expected cases pass with synthetic data and required authorized provider/browser evidence is separately recorded. Document lint alone is insufficient.

### TEST-31 — Implement responsive dedicated checkout acceptance
- Target: PR-4
- Ref: npm run test:browser -- --case=T-31 (implemented explicit selector; first registered run FAIL, not accepted)
- Expected: Execute the full checkout matrix in document 17 on390/768/1024/1440 plus320px reflow/200percent text, Safari/Chrome and available physical mobile. Prove guest draft/address/quote/multi-parcel/review/help/unknown-result recovery; one mutation on double-submit and no duplicate Purchase. Record rendered evidence before UI completion. Current native11/browser25/affected-cart16 and64 build-specific renders are executed at S26 C3; independent source/visual/final acceptance and downstream parent gates remain pending.


### T-32 — Implement private thank-you and ongoing order-status experience
- **Status:** Planned; not started.
- **Primary requirement:** PR-24
- **Constraints:** DATA-1, IAM-1, SEC-1, PRIV-1, BILL-1, API-1, UX-1, UI-1, OBS-1
- **Risk Level:** R3
- **Allowed Paths:** src/app/**, src/modules/orders/**, src/components/**, tests/integration/**, tests/browser/**, design/**, public/**
- **Depends On:** T-31, T-26, T-25
- **Canonical Contract Owners:** Documents02/03/05/07/09/10/11/12/13/15/16/17; existing openapi.yaml must be expanded before new wire handlers.
- **Accepted Invariants:** Authorized private access; verified money truth; disjoint merchandise allocation; consent at capture/dispatch; durable identity and safe recovery; selected Inter/purple responsive design.
- **Visual Contract:** Checkout CO1–CO8 and thank-you TY1–TY8 apply where relevant; no giant empty success panel, obstructed money controls or missing mobile totals.
- **Reopen Conditions:** Conversion grain, provider schema/account/source, privacy policy or payment workflow changes.
- **Non-Scope:** Credentials, live accounts/events, campaign budgets, production deployment, commit/push and unrelated code.
- **Escalation Conditions:** Unsupported provider schema, unresolved identity/retention rules, leaked data or ambiguous money evidence.
- **Done when:** Execute TEST-32; all expected cases pass with synthetic data and required authorized provider/browser evidence is separately recorded. Document lint alone is insufficient.

### TEST-32 — Implement private thank-you and ongoing order-status experience acceptance
- Target: PR-24
- Ref: npm run test:browser -- --case=T-32 (prospective repository script; create during implementation)
- Expected: Execute all TY1–TY8 and document 17 thank-you scenarios: pending/paid/failed/expired/unknown prepaid, COD accepted/partial collected, independent parcel/refund and guest recovery. Test390/768/1024/1440,320reflow,200percenttext, keyboard and mobile browser. Reload/Back/blocked tags/no returning buyer never duplicate or suppress backend Purchase; denied access leaks no receipt. Record independent rendered evidence. No runtime result exists yet.


### T-33 — Implement responsive storefront discovery, cart and journey continuity
- **Status:** S21 accepted PASS RUN-20261019T052015Z-1c033194/a73b85ee and S22 accepted PASS RUN-20261019T060755Z-017dd011/a7deca92 after source/build/native/browser, verified preflight, actual canonical14 PASS/all88 image report/archive136/design-gate0/final current-union R3 and VERIFIED ledger closure. Prior failures and P3 notes retained. S61/fullT-33/full68 remain incomplete. S26 now owns the next checkout slice in its separate run.
- **Primary requirement:** PR-17
- **Constraints:** UX-4, UX-1, UI-1, IAM-1, SEC-1, PRIV-1, DATA-1, PR-23
- **Risk Level:** R3
- **Allowed Paths:** src/app/**, src/proxy.ts, src/components/**, src/modules/storefront/**, src/modules/checkout/carts.ts, src/modules/local/storefront.ts, scripts/seed.ts, scripts/check-tests.ts, tests/integration/commerce-fixture-runtime.ts, tests/integration/storefront*.ts, tests/integration/*http*.ts, tests/auth-http.test.ts, tests/smoke.test.ts, tests/browser/**, design/**, public/**, docs/spec/openapi.yaml, docs/spec/scripts/check-openapi-contract.py, docs/spec/03-TECHNICAL-DESIGN.md, docs/spec/05-DATA-MODEL.md, docs/spec/07-IAM-RBAC-ABAC.md, docs/spec/09-API-SPECIFICATION.md, docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md, docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md, docs/spec/design/renders/s21/**, AGENTS.md, README.md, STATUS.md, TASKS.md, BUILD-LOG.md, ARCHITECTURE.md
- **Depends On:** T-1, T-4, T-14, T-17, T-23
- **Canonical Contract Owners:** UX-4 mobile refinement and Design System MW1–MW7; checkout T-31, thank-you T-32 and chat T-25 retain their detailed scope.
- **S22 required dependency:** Exact src/modules/checkout/carts.ts owns latest complete-offer availability on every add/change (17-UX:117). Reuse existing inventory readers inside the writer, preserve actor/publication/idempotent replay/version/outbox and stock-as-advisory semantics; reopen current S20 compatibility proof and require full R3 review. src/proxy.ts is declared for a native acknowledged guest-cookie context before first cart commit if framework retrieval confirms it is needed; it must reuse existing cookie authority and preserve safe no-JS/unknown recovery. No other checkout/auth/data/money source is widened by this dependency.
- **Accepted Invariants:** Four labeled shopping tabs; task-specific single bottom region; actual offer identity; server cart truth; safe Back/draft/scroll; no guest registration mandate or raw private URL state.
- **Visual Contract:** MW1–MW7, existing Inter/purple/open product grouping, distinct mobile and preserved desktop/tablet composition.
- **Reopen Conditions:** Mode selection, browser support, privacy or commerce policy changes.
- **Non-Scope:** Native binaries/bridge, PWA installation, push, offline transactions, live publication, unrelated admin work.
- **Escalation Conditions:** Unsupported handoff, leaked private state, false mutation recovery or unresolved accessibility failure.
- **Done when:** Execute TEST-33 with all applicable mobile matrix scenarios and record independent browser/render evidence; document validation alone does not complete UI acceptance.

### TEST-33 — Mobile shopping journey and app-like behavior
- Target: PR-17
- Ref: npm run test:browser -- --case=T-33 (prospective repository script; create during implementation)
- Expected: Document17 mobile-web-app matrix passes for meaningful navigation/search/filter/variant/cart/history, touch/keyboard/zoom, safe-area, slow/offline/error, session and browser handoff cases. Observe phone/tablet/desktop and tested mobile browsers; distinguish unavailable physical/in-app environments. No runtime result exists yet.

T-17 prototype acceptance now includes MW1–MW7 and the refined UX-4 matrix. T-25/T-31/T-32 integrate the shared task-chrome/history/keyboard rules; T-33 owns shared shopping navigation and discovery/PDP/cart continuity without duplicating their feature queues.


### T-34 — Implement role-specific admin workspaces and operational reporting
- **Status:** Planned; not started.
- **Primary requirement:** PR-13
- **Constraints:** DATA-1, IAM-1, API-1, SEC-1, PRIV-1, UX-1, UX-2, UI-1, BILL-1, OBS-1
- **Risk Level:** R3
- **Allowed Paths:** src/app/**, src/components/**, src/modules/reporting/**, tests/integration/**, tests/browser/**
- **Depends On:** T-13, T-12, T-20, T-21, T-25
- **Canonical Contract Owners:** Documents02/03/05/07/09/10/17; expand existing OpenAPI/checker before new wire implementation.
- **Accepted Invariants:** Indonesia buyer/operator workflow, scoped access and private output; immutable financial/order snapshots; truthful payment/collection/waybill/printing/handover separation; source-backed capability gates.
- **Visual Contract:** Existing Inter/purple plus document10 operator/account/print composition and document17 detailed screens; actual print output monochrome and carrier-safe.
- **Reopen Conditions:** Provider/template, identity/channel, role scope, metric policy or physical format changes.
- **Non-Scope:** Live accounts/orders, credentials, shipment purchase, production changes, native binaries, commit/push and unrelated features.
- **Escalation Conditions:** Unknown provider/template authority, unsafe PII exposure, ambiguous money/booking outcome or unreadable physical label.
- **Done when:** Execute TEST-34; expected integration/UI/physical checks pass as applicable and evidence is recorded. No document-lint-only completion.

### TEST-34 — Implement role-specific admin workspaces and operational reporting acceptance
- Target: PR-13
- Ref: npm run test:browser -- --case=T-34 (prospective repository script; create during implementation)
- Expected: Owner/warehouse/CS/finance/ecommerce_admin homes match their grants and primary queues; KPI definitions and queue drilldowns conserve counts/amounts and distinguish missing sources from zero. Verify warehouse cannot access whole-order totals, every selected bulk row is authorized/versioned, stale/mixed results reconcile safely, and CSV formula/private-field restrictions hold. Responsive keyboard/320px/200%text and independent rendered evidence required. No runtime result exists yet.


### T-35 — Implement buyer Account, addresses and verified continuity
- **Status:** Planned; not started.
- **Primary requirement:** PR-14
- **Constraints:** DATA-1, IAM-1, API-1, SEC-1, PRIV-1, UX-1, UX-2, UI-1, BILL-1, OBS-1
- **Risk Level:** R3
- **Allowed Paths:** src/app/**, src/components/**, src/modules/accounts/**, migrations/**, tests/integration/**, tests/browser/**, src/app/api/v1/**, tests/contract/**, src/db/**
- **Depends On:** T-23, T-4, T-7, T-25
- **Canonical Contract Owners:** Documents02/03/05/07/09/10/17; expand existing OpenAPI/checker before new wire implementation.
- **Accepted Invariants:** Indonesia buyer/operator workflow, scoped access and private output; immutable financial/order snapshots; truthful payment/collection/waybill/printing/handover separation; source-backed capability gates.
- **Visual Contract:** Existing Inter/purple plus document10 operator/account/print composition and document17 detailed screens; actual print output monochrome and carrier-safe.
- **Reopen Conditions:** Provider/template, identity/channel, role scope, metric policy or physical format changes.
- **Non-Scope:** Live accounts/orders, credentials, shipment purchase, production changes, native binaries, commit/push and unrelated features.
- **Escalation Conditions:** Unknown provider/template authority, unsafe PII exposure, ambiguous money/booking outcome or unreadable physical label.
- **Done when:** Execute TEST-35; expected integration/UI/physical checks pass as applicable and evidence is recorded. No document-lint-only completion.

### TEST-35 — Implement buyer Account, addresses and verified continuity acceptance
- Target: PR-14
- Ref: npm run test:browser -- --case=T-35 (prospective repository script; create during implementation)
- Expected: Guest purchase/tracking remains available. Own profile/address/default/contact/notification flows pass single-word-name/no-email, stale destination/postcode, default deletion and concurrency cases. Edits do not rewrite original order/label. Verify shared-device isolation, contact collision/new-contact verification, approved lost-channel recovery, scoped guest-link replay/cross-order denial and revoked links. Actual auth method/channels and OAS delta are accepted before handlers; mobile/desktop render evidence required. No runtime result exists yet.


### T-36 — Implement scoped shipping-label jobs and private artifacts
- **Status:** Planned; not started.
- **Primary requirement:** PR-25
- **Constraints:** DATA-1, IAM-1, API-1, SEC-1, PRIV-1, UX-1, UX-2, UI-1, BILL-1, OBS-1
- **Risk Level:** R3
- **Allowed Paths:** src/modules/shipping/**, src/modules/documents/**, migrations/**, tests/integration/**, src/app/api/v1/**, tests/contract/**, src/db/**
- **Depends On:** T-3, T-6, T-13, T-23
- **Canonical Contract Owners:** Documents02/03/05/07/09/10/17; expand existing OpenAPI/checker before new wire implementation.
- **Accepted Invariants:** Indonesia buyer/operator workflow, scoped access and private output; immutable financial/order snapshots; truthful payment/collection/waybill/printing/handover separation; source-backed capability gates.
- **Visual Contract:** Existing Inter/purple plus document10 operator/account/print composition and document17 detailed screens; actual print output monochrome and carrier-safe.
- **Reopen Conditions:** Provider/template, identity/channel, role scope, metric policy or physical format changes.
- **Non-Scope:** Live accounts/orders, credentials, shipment purchase, production changes, native binaries, commit/push and unrelated features.
- **Escalation Conditions:** Unknown provider/template authority, unsafe PII exposure, ambiguous money/booking outcome or unreadable physical label.
- **Done when:** Execute TEST-36; expected integration/UI/physical checks pass as applicable and evidence is recorded. No document-lint-only completion.

### TEST-36 — Implement scoped shipping-label jobs and private artifacts acceptance
- Target: PR-25
- Ref: npm run test:integration -- --case=T-36 (prospective repository script; create during implementation)
- Expected: Current issued provider label contract/capabilities are recorded; retry/restart/unknown generation uses one job and original AWB, never new booking/charge. Verify per-parcel COD/recipient/template/format snapshots, partial batches, expired links, invalid PDF/remote host and scope rechecks. Changed/void/superseded parcels block old artifacts. Privacy mode and brand mode remain separate; unverified full masking is disclosed with original-label/separate-brand fallback. No runtime result exists yet.


### T-37 — Implement 99ribu label print center and physical acceptance
- **Status:** Planned; not started.
- **Primary requirement:** PR-25
- **Constraints:** DATA-1, IAM-1, API-1, SEC-1, PRIV-1, UX-1, UX-2, UI-1, BILL-1, OBS-1
- **Risk Level:** R3
- **Allowed Paths:** src/app/**, src/components/**, src/modules/storefront/**, src/modules/local/storefront.ts, scripts/seed.ts, scripts/check-tests.ts, tests/integration/commerce-fixture-runtime.ts, tests/integration/storefront*.ts, tests/integration/*http*.ts, tests/auth-http.test.ts, tests/smoke.test.ts, tests/browser/**, design/**, public/**, docs/spec/openapi.yaml, docs/spec/scripts/check-openapi-contract.py, docs/spec/03-TECHNICAL-DESIGN.md, docs/spec/05-DATA-MODEL.md, docs/spec/07-IAM-RBAC-ABAC.md, docs/spec/09-API-SPECIFICATION.md, docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md, docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md, docs/spec/design/renders/s21/**, AGENTS.md, README.md, STATUS.md, TASKS.md, BUILD-LOG.md, ARCHITECTURE.md
- **Depends On:** T-36, T-34
- **Canonical Contract Owners:** Documents02/03/05/07/09/10/17; expand existing OpenAPI/checker before new wire implementation.
- **Accepted Invariants:** Indonesia buyer/operator workflow, scoped access and private output; immutable financial/order snapshots; truthful payment/collection/waybill/printing/handover separation; source-backed capability gates.
- **Visual Contract:** Existing Inter/purple plus document10 operator/account/print composition and document17 detailed screens; actual print output monochrome and carrier-safe.
- **Reopen Conditions:** Provider/template, identity/channel, role scope, metric policy or physical format changes.
- **Non-Scope:** Live accounts/orders, credentials, shipment purchase, production changes, native binaries, commit/push and unrelated features.
- **Escalation Conditions:** Unknown provider/template authority, unsafe PII exposure, ambiguous money/booking outcome or unreadable physical label.
- **Done when:** Execute TEST-37; expected integration/UI/physical checks pass as applicable and evidence is recorded. No document-lint-only completion.

### TEST-37 — Implement 99ribu label print center and physical acceptance acceptance
- Target: PR-25
- Ref: npm run test:browser -- --case=T-37 (prospective repository script; create during implementation)
- Expected: Preview/download/print/reprint distinguish artifact state, print attempt and physical result. Warehouse isolation, explicit batch/page mapping, non-obstructing brand, active AWB/COD fields and changed/replaced label guards pass. Test exact100x150mm versus105x148mm A6 and supported A4 on actual stock/printer; decode barcode and obtain enabled carrier/template acceptance using authorized test material. Reprint never books/charges/marks handover. Record rendered and physical/scanner evidence; unsupported full masking stays unresolved. No runtime result exists yet.

### T-38 — Implement local synthetic seed and deterministic provider scenarios
- **Status:** S11 principal/warehouse seed and deterministic clock/inbox checkpoint accepted after independent review; S18 catalog/stock/cost translation accepted after corrected independent review; provider scenarios remain their domain slices.
- **Primary requirement:** TD-1
- **Constraints:** CTX-18, DATA-1, IAM-1, SEC-1, BILL-1, API-1
- **Risk Level:** R3
- **Allowed Paths:** docs/spec/fixtures/**, public/fixtures/**, scripts/**, src/modules/**, src/jobs/**, src/db/schema.ts, migrations/**, tests/**, package.json, README.md, docs/spec/05-DATA-MODEL.md, docs/spec/15-DEVOPS-CICD-MIGRATIONS.md
- **Depends On:** T-23
- **Canonical Contract Owners:** DATA-1 synthetic fixture section and Technical Design local execution profile; DEL-1 local proof matrix.
- **Accepted Invariants:** Synthetic-only positive local target, real auth/PostgreSQL/domain/worker; external adapters only faked; deterministic clock/events; stable identity; no destructive reset or production credential.
- **Reopen Conditions:** Actual schema/auth/runtime or scenario contract changes.
- **Non-Scope:** Production seed/data import, real providers/money/shipments/ads, destructive reset and deployment.
- **Escalation Conditions:** Ambiguous environment/DB, unintended external effect, secret/data exposure or invariant bypass.
- **Done when:** Execute TEST-38; namespace-safe seed and deterministic adapter scenarios drive actual local persistence and negative/replay/restart checks. The existing fixture validator alone does not complete this task.

### TEST-38 — Local fixture, seed and scenario acceptance
- Target: TD-1
- Ref: python3 docs/spec/scripts/check-localhost-fixtures.py; npm run test:integration -- --case=T-38 (second command prospective; implement during foundation)
- Expected: Standalone fixture rejects its invalid mutations. Actual seed rerun preserves intended identities without wiping rows; real DB/auth/core scenarios pass with no external dispatch. All14 scenario contracts have runnable owned cases, including separate real PostgreSQL races. First command currently checks input only, not application behavior.

### T-39 — Prove assembled localhost readiness and recovery
- **Status:** Planned; not started.
- **Primary requirement:** PR-16
- **Constraints:** CTX-18, DEL-1, SEC-1, DATA-1, NFR-1, NFR-2, UX-4, API-1
- **Risk Level:** R3
- **Allowed Paths:** tests/**, scripts/**, README.md, STATUS.md, BUILD-LOG.md, design/**, public/**
- **Depends On:** T-1, T-2, T-3, T-4, T-5, T-6, T-7, T-8, T-9, T-10, T-11, T-12, T-13, T-14, T-15, T-16, T-17, T-18, T-20, T-21, T-22, T-23, T-24, T-25, T-26, T-27, T-28, T-29, T-30, T-31, T-32, T-33, T-34, T-35, T-36, T-37, T-38
- **Canonical Contract Owners:** DEL-1 localhost proof matrix; each feature retains its own requirement and separate provider/production gates.
- **Accepted Invariants:** Complete local journey uses actual DB/auth/worker/UI, synthetic data and faked external boundaries; local pass never claims merchant/hardware/production acceptance.
- **Visual Contract:** Selected mobile/tablet/desktop and task-safe checkout/chat/receipt/operator compositions; TEST label watermark.
- **Reopen Conditions:** Schema, runtime, failure recovery, identity or supported browser changes.
- **Non-Scope:** Production readiness declaration, live providers, provisioning/deployment and real bank/shipment/campaign action.
- **Escalation Conditions:** Missing local feature acceptance, lost invariant after restore, privacy failure or any unexpected external request.
- **Done when:** Execute TEST-39 and all applicable local proof-matrix rows; record runnable startup/check commands and browser/integration/restore evidence. List remaining external gates separately; do not mark their parent tasks fully complete from a local checkpoint.

### TEST-39 — Assembled localhost acceptance
- Target: PR-16
- Ref: npm run test:integration -- --case=localhost-readiness; npm run test:browser -- --case=localhost-readiness (prospective scripts; implement during foundation)
- Expected: All approved domains have local success/failure/access/replay evidence, web/worker restart and isolated restore preserve stock/money/order/job invariants, target browser flows are exercised, and instrumented integration dispatch confirms no external provider calls. Missing physical/in-app environments remain explicit unverified items, not fabricated PASS.


Local dependency semantics for every task, including T-39: under CTX-18, dependency tasks must reach their documented applicable local checkpoint, not complete separate live-provider, physical-carrier, hosting or production gates. Record each checkpoint's actual evidence and remaining external acceptance in its task; leave the parent final status open until its full Done-when is satisfied. T-19 future automatic payout capability is excluded from the local milestone. This is a local integration acceptance gate, not permission to relabel unfinished parent tasks complete.


## Execution semantics — current localhost handoff

The S01+ table below is the ordered decomposition of these same 39 parents, not another backlog. Existing T/PR/TEST IDs remain stable. Foundation checkpoints are recorded in STATUS; later slices remain planned and complete application acceptance is not claimed. Root STATUS.md will own active slice, local checkpoint evidence, blockers and next action; parent Status fields are summaries reconciled from that evidence, never an independent tracker.

`Depends On` records parent-level dependency families. For interleaved parents (foundation, seed, finance, UI), the table's `After` fields identify the exact prerequisite checkpoints for a slice; do not require every later slice or live acceptance of its parent to finish first. Follow table order by default; parallel work requires disjoint declared files AND semantic ownership. A slice can start only after its listed predecessor proofs pass, plus the accepted UI/contract inputs it consumes. Mark the parent complete only when every applicable slice and its full Done-when pass. A local checkpoint may pass while external acceptance remains open. T-19 is deferred and has no local implementation slice.

S68 is the terminal local gate and must transitively depend on every accepted local slice. Table position alone is not an executable dependency, and a schema-valid plan is not completed evidence. Duplicate parent fields are invalid, including repeated Primary requirement, Allowed Paths or Done when.

Each slice inherits exactly one parent's primary requirement, risk, constraints and canonical contracts. Allowed Paths are maximum candidate surfaces, not permission to edit every file matched: resolve the smallest actual file/glob list before starting a ledger run. Domain tasks own their applicable HTTP handlers, schema migrations, UI consumers and contract tests; T-18 owns contract governance/parity, not all handlers. Update a task's bounded path list before a necessary new path; do not silently expand scope. Each slice may update TASKS/STATUS/BUILD-LOG evidence and the affected canonical contract in the same reviewed boundary.

The root README registry owns executable commands. S06 supports only `--case=foundation` for the Node-native integration/browser file selection. Other historical `npm ... --case=...` references above remain prospective until their owning slices implement and verify them. An unknown filter, zero selected tests, skipped required database or unimplemented script fails the checkpoint. Do not add a custom test framework to preserve a placeholder flag.

Per slice: read contract and current code -> declare boundary -> implement -> focused static/behavioral check -> public boundary plus persisted-state proof -> rendered interaction/design evidence if visible -> separate review for R3/R4 or protected/expanded changes -> fix and rerun affected checks -> record exact result -> advance. A financial/inventory test must observe real PostgreSQL, not just an adapter returning success. No commit/deploy is part of this sequence. Independent review records actual identity and final content scope; a model name alone is not a review.

The map is a delivery plan, not a claim that every row fits one context window. If necessary, split a row into a–c steps inside its existing parent without changing its acceptance; record the resumable step in STATUS. Choose scope before execution rather than attempting the entire pack in one unbounded run.

<!-- development-slices:start -->
| Slice | Parent | After | Delivery | Required proof |
|---|---|---|---|---|
| S01 | T-23 | - | Resume document15 S01: documentation promotion/root reconciliation is complete; inspect the existing repository and use a feature worktree for the pinned native scaffold. Preserve contracts and do not repeat promotion. | Plan inspected; authorized promotion inventory matches; one root queue/index and no competing workflow state. No app runtime claim. |
| S02 | T-23 | S01 | Pin supported runtime/package/database/auth/test versions; select smallest directory layout and loopback APP_ENV local profile. | Lockfile and actual version record; environment validation rejects remote/live/mixed targets; no secret values in evidence. |
| S03 | T-23 | S02 | Establish isolated PostgreSQL, reviewed initial schema/migration path and private artifact storage. | Empty database migration plus reconnect succeeds; separate test namespace; invalid/private access denied; no in-memory persistence substitute. |
| S04 | T-23 | S03 | Implement supported Better Auth login/session/recovery, synthetic local delivery inbox and deny-by-default. | Real session issuance/revocation; CSRF/expiry/unauthenticated/no-staff/cross-principal negative tests; optional buyer email remains optional for checkout. |
| S05 | T-23 | S03 | Establish separate worker, transactional outbox seam and guarded external adapter selection. | Web and worker share DB; queued synthetic event survives restart; absent/mixed provider config fails closed. |
| S06 | T-23 | S04,S05 | Implement actual type/lint/build/integration/browser commands and record runner selection/filtering. | Commands execute; intended test count nonzero; missing DB, unknown selector and required skipped test fail; built-server smoke has exact startup command. |
| S07 | T-14 | S01 | Review existing buyer, affiliate and operator screen/action contracts against data, IAM and accepted visual tokens. | Each implemented action has validation, pending, success, denial and recovery; unresolved changes stay owned. Document review only. |
| S08 | T-17 | S07,S06 | Render bounded mobile/tablet/desktop composition prototypes from accepted contracts and reference evidence. | Review 390/768/1440 views, keyboard/safe-area/Back and competing bottom regions; observed prototype notes; no commerce behavior claim. |
| S09 | T-13 | S04 | Implement canonical role grants, warehouse/object predicates, field projection and audit boundary. | All seven roles and guest tested through public handlers; cross-warehouse/object/export/finance access denied without leaking fields. |
| S10 | T-18 | S09,S06 | Align auth/visitor/guest transport and common errors/idempotency with OAS; register domain operation ownership. | Contract checker passes; initial handler request/response/denial parity; unsupported transport is explicit, not invented. |
| S11 | T-38 | S03,S04,S09 | Implement namespaced principal/warehouse seed and deterministic clock/local inbox harness. | Rerun retains identities without wiping other rows; actor isolation; clock advances without host changes; synthetic data only. |
| S12 | T-16 | S05,S09 | Implement durable claim/lease/retry/dead-letter and unknown-operation reconciliation primitives. | Two workers, expired lease, crash before/after commit and restart converge; no blind replay of an unknown money/shipment effect. |
| S13 | T-21 | S09,S03 | Implement versioned commercial/calendar/settings snapshots and authorized change audit. | Stale concurrent write conflicts; old order/policy facts immutable; TEST-ONLY calendar clearly separate from production activation. |
| S14 | T-1 | S03,S09,S10 | Implement inactive catalog, taxonomy, stable offer IDs, variant/bundle contents and versioned edit handlers. | All offer kinds enforce integer IDR99000; invalid contents rejected; edit preserves published identities/order snapshots; inventory races belong to S15. |
| S15 | T-2 | S14,S12,S11 | Implement warehouse movements, reservations, release and component availability. | Real PostgreSQL competing reservations permit one winner; no negative available stock; idempotent movement/release and warehouse denials. |
| S16 | T-20 | S14,S13 | Implement prospective HPP/cost completeness and publication-review guard before checkout. | Unknown cost remains unknown; authorized review/override follows PR-19; changing cost preserves historical version; seed cannot bypass publication. |
| S17 | T-11 | S14,S13,S15,S16 | Implement subsidy/cap/budget rules with versioned quote snapshots. | Concurrent reservations preserve cap/budget and integer allocation; expired/released reservation restores only its own allocation. |
| S18 | T-38 | S11,S15,S16 | Translate synthetic catalog/stock/cost fixtures through actual schema and guarded publication. | Rerunnable seed and missing-cost fixture; no unreviewed published offer; input checker pass remains distinct from DB proof. |
| S19 | T-3 | S15,S17,S12 | Implement address normalization, rate adapter and complete-offer warehouse allocation. | One offer never splits contents across warehouses; multiple parcels conserve quantities; unavailable/expired quote and provider timeout recover.  Actual allocated subsidy must pass current PR-19 financial/bounded owner-exception checks before benefits are exposed. |
| S20 | T-4 | S19,S09,S10,S16 | Implement guest cart, publication/cost guard recheck, authoritative totals, idempotent order submit and reservation expiry. | Same request recovers same order; different body/key conflict; stale quote requires review; optional email; no paid flag from browser. |
| S21 | T-33 | S08,S14,S18,S20 | Build public home/category/search/filter composition for mobile, tablet and desktop. | Browser exercises populated/empty/error search, URL filters and Back; genuine assets/alt; distinct responsive layout and visual review. |
| S22 | T-33 | S21,S15,S20 | Build PDP/offer selection/contents/cart and stock/quote conflict recovery; for unfiltered cards prefer an available offer before an unavailable first variant (S21 source-review follow-up). | One bundle totals 99000; two offers 198000; invalid variant/add denied; real browser cart persistence and accessible errors. |
| S23 | T-12 | S20,S09,S12 | Implement immutable ledger primitives and atomic economic-receipt/posting transaction before payment callbacks. | Balanced integer postings, duplicate receipt prevention, order-history scope and rollback on partial failure; actual PostgreSQL, no arbitrary client journal write. |
| S24 | T-5 | S23,S11,S10 | Implement prepaid attempts and payment simulator callback/reconciliation using the atomic receipt/posting transaction. Persist individual provider events separately from economic-effect/receipt deduplication. | Duplicate/out-of-order and timeout-after-commit create one receipt with balanced postings; late/expired receipt records durable recovery without authorizing unavailable stock; no external request. |
| S25 | T-26 | S24,S12,S10 | Implement consent/visitor context, canonical funnel milestones and join server economic Purchase outbox to the receipt transaction. | Rerun S24 crash tests: rollback leaves neither receipt nor outbox; commit preserves original eligible intent. Consent denies dispatch; no duplicate or browser-authored Purchase. |
| S26 | T-31 | S08,S22,S24,S25 | Build dedicated checkout form and responsive summary with shipping/payment recovery. | Real guest order at 390/768/1440; server validation/no-JS form baseline; stale totals, double submit, timeout and retry verified. |
| S27 | T-32 | S26,S24,S25 | Build core private receipt and returning status page for first buyer vertical slice. | Build-backed browser order/payment/receipt success plus pending; original contents/address visible only with valid scope; reload emits no Purchase.  Retain confirmed-purchase stock and promotion commitments before their quote deadlines; never expire paid ownership silently. |
| S28 | T-5 | S23,S24,S19,S25 | Implement split COD eligibility, per-parcel due and atomic collection/posting/economic outbox using S23/S25 primitives. | Collection/posts/outbox commit together; refusal/settlement distinct; parcel amounts conserve order total; prepaid/COD cannot mix inside initial order. |
| S29 | T-6 | S28,S13,S12 | Implement TEST-ONLY calendar deadlines, valid-waybill packing, preparation and handover transitions. | Holidays/consecutive closures/local midnight/late replay tested; acknowledged/unknown booking is not issued AWB; no fake receipt. |
| S30 | T-12 | S28,S29 | Add COD receivable/settlement, fees, adjustments and reconciliation; preserve S28 original collection postings, never create them retrospectively. | Collected merchandise is recognized once; later remittance/refusal creates no Purchase; correction lineage and finance permissions hold. |
| S31 | T-7 | S29,S30 | Implement quantity-scoped returns/inspection and refund confirmation with atomic posting/allocation/linked adjustment intent. | Unauthorized/duplicate/out-of-window denied; normal partial-order refund keeps whole purchased offers; retained amount and ledger conserved. |
| S32 | T-7 | S31,S15 | Implement replacement lineage, stock reservation and receipt anchors. | No new charge/Purchase for replacement; unavailable replacement has recovery; only affected quantity receives new receipt anchor. Effective affiliate override versions must feed current quote/order contribution and owner bounds; reverify S19/S20 rather than assuming the default commission. |
| S33 | T-22 | S32,S12,S30 | Implement late payment, stock loss, COD refusal and ambiguous external exception recovery. | Real stored outcomes converge without silent revival, oversell, duplicate refund or new operation identity after timeout. |
| S34 | T-20 | S16,S30,S31 | Implement actual contribution, unknown-cost display and historical HPP/expense explanations. | Historical estimates immutable; actual adjustments linked; missing cost never treated as zero profit; scoped reports reconcile ledger. |
| S35 | T-8 | S09,S13,S20 | Implement affiliate identity/profile, beneficiary-change control and first eligible referral. | Seven-day non-extending attribution; self/ineligible rules per contract; beneficiary change re-verifies without altering frozen payouts. |
| S36 | T-9 | S35,S32,S30 | Implement quantity commission accrual/hold/release and receipt-based H+10. | Replacement-affiliate-hold scenario; only affected quantity resets; duplicate events and refund corrections conserve obligations. |
| S37 | T-10 | S36,S30,S12 | Implement automatic eligibility queue and finance manual-transfer claim/proof/verification. | Inclusive 99000 threshold; two finance claims one winner; expired/unknown outcome remains held; no bank transfer API. |
| S38 | T-8 | S35,S08 | Build affiliate enrollment/profile/link and beneficiary correction UI. | Signed-in affiliate sees own data only; validation/pending/reverification/recovery rendered; no unauthorized bank details in artifacts. |
| S39 | T-9 | S36,S38 | Build affiliate balances, commission detail, holds and maturity explanations. | Browser distinguishes pending/held/eligible amounts and quantities; replacement/refund narrative follows stored lineage. |
| S40 | T-10 | S37,S39 | Build affiliate payout progress/history and finance evidence visibility boundary. | Affiliate sees own safe statuses with no withdrawal button; internal proof/other beneficiary cannot leak. |
| S41 | T-24 | S20,S09,S12 | Implement durable conversation/messages, guest recovery and staff claim/handoff. | Unknown send/retry gives one message; two-agent claim race; cross-thread/cursor/order context denied; no staff-note leakage. |
| S42 | T-24 | S41 | Implement private image quarantine/validation, staff notes, ordered history/read markers and stream. | Rejected file never delivered; notes absent from customer stream/search/counts; reconnect, revocation and bounded fallback tested. |
| S43 | T-24 | S42,S13 | Implement scoped message search/context cards/saved replies/tags and notification preferences. | Customer search stays in owned scope; verified context; archive/mute/per-agent unread preserve messages and privacy. |
| S44 | T-25 | S43,S08 | Build mobile/dedicated/desktop customer chat, private viewer and recovery. | Actual keyboard/IME/Back/scroll/reconnect and failed-draft states; one bottom composer region; shared-device isolation. |
| S45 | T-25 | S43,S08 | Build staff inbox, assignment/handoff, private notes, templates and owner oversight. | Two actor browsers exercise claim/conflict and public/internal distinction; queue/filter/empty/error and accessible shortcuts. |
| S46 | T-35 | S09,S20,S44 | Build account/profile/address book/default address, verified contact change and guest-order linking. | Mononym/optional email; address/book version conflicts; both guest and account proof; logout clears private state. |
| S47 | T-35 | S46,S32,S44 | Build buyer order list/detail, parcel timeline and return/exchange evidence/case UI. | Own-order receipt and claim flow; partial parcel/replacement/refund truthful; denied object and private upload recovery. |
| S48 | T-32 | S27,S47,S44,S28 | Complete receipt support/actions, split COD, returns and unknown/recovery views. | Full TY contract on built browser; no premature paid/delivered status, unsafe token exposure or repeated Purchase. |
| S49 | T-34 | S09,S16,S15,S08 | Build admin catalog publication/cost and warehouse stock receive/adjust/transfer forms. | Direct request and browser permissions agree; stale edits conflict; movement audit and publication guard remain authoritative.  Reject needless owner exception requests once financial blockers no longer exist; preserve truthful exception audit/UX (S16 reviewer Low). |
| S50 | T-34 | S49,S29,S32,S33 | Build assigned fulfillment, return inspection/decision and exception queues. | Warehouse cannot see whole-order money; exact action state/claim/conflict verified; physical handover not label printing. |
| S51 | T-34 | S50,S30,S34,S37 | Build finance reconciliation/refund/manual payout and owner order-history workspace. | Real synthetic journal/cost/receivable drilldown; claimed payout proof flow and role/field denial; no free-form historical overwrite. |
| S52 | T-34 | S51,S13,S45 | Build access/settings controls and role home exceptions with staff-safe operations. | Owner-only grants/settings; changed policy prospective; CS and warehouse homes use scoped work, not shared finance totals. |
| S53 | T-34 | S52 | Complete KPI definitions, token-bound drilldowns, bulk previews, responsive tables and bounded export. | Metric and queue scope/date/basis match; mismatched token 409; export/bulk denies unauthorized rows; mobile task access works. |
| S54 | T-36 | S29,S09,S12 | Implement template capability, label job/batch/artifact generation and scoped download/print audit. | Unpaid funding/void/superseded blocks; expired artifact reuses active AWB; private TEST PDF; no new shipment/charge. |
| S55 | T-37 | S54,S53 | Build 99ribu print center with template/fallback disclosure and 100x150mm/A4 local preview. | Browser preview/download/reprint with same AWB; access and dimensions checked; physical scanner/carrier approval explicitly pending. |
| S56 | T-15 | S14,S16,S22 | Implement local catalog exports/feeds and storefront indexability/metadata parity. | Stable serialized offer IDs, published-only products, exact price/availability, valid local feed; no external catalog upload/indexing claim. |
| S57 | T-27 | S25,S28,S31 | Implement Meta adapter contract and local sink with disabled real dispatch. | Local matching/dedupe/original timestamp/value/consent tests; current issued vendor schema limitations explicit; no live Pixel call. |
| S58 | T-28 | S25,S28,S31 | Implement Google offline-clicks adapter mapping and local adjustment sink. | Owned action/identifier validation; browser Purchase off; original transaction/restated retained value correct; no fake retraction semantics. |
| S59 | T-29 | S25,S28,S31 | Implement TikTok adapter mapping and local sink. | Local event identity/value/matching/consent/retry preserved; unverified vendor fields stay gated; no live Pixel call. |
| S60 | T-30 | S57,S58,S59,S53 | Build private platform diagnostics, replay/pause/settings and money-versus-signal reconciliation. | Owner controls/version conflict; redacted errors; no consent/age bypass; split-COD/refund differences explained. |
| S61 | T-33 | S48,S47,S55 | Finish mobile shell, URL/history/drafts/scroll continuity across complete public journey. | Browser Back/refresh/offline/unknown/keyboard and selected breakpoints; one contextual bottom region; no account data cross-session. Close the verified button audit: explicit Load more retains loaded results/anchor/retry and Back; category reset retains its category and follows draft Reset then Apply semantics (17-UX:626/627). Audit items2/3 already have S22 fixes; PDP source Back is S22. Close S22 source-r2 carry: announce known errors even when the affected line disappears, define expired/submitted cart badge behavior, and prove consent-aware campaign/referral continuity across navigation. Exercise short viewport/IME and available Safari/WebView on the completed journey; current S22 Chromium-only proof does not close these. |
| S62 | T-38 | S33,S40,S45,S47,S55,S60,S61 | Complete all 14 executable scenario mappings and full rerunnable seed through actual schema. | Each fixture case executes its mapped real handler/DB path; all required counts nonzero; namespace cleanup is bounded and explicit. |
| S63 | T-16 | S62,S56 | Complete rate limits, upload/storage limits, redacted logs, correlation and operator failure probes. | Abuse/denial/retry/restart and worker backlog observable locally; no private data in public/cache/logs; no remote availability claim.  Include a failed inventory/promotion-expiry job whose reservation remains active; alert/probe and operator recovery preserve physical stock. Also inspect namespace-tagged orphan synthetic seed operators after uncatchable host failure; recovery targets explicit identities. Cover a successful auth operation followed by failed guest-context revocation:503 must not claim a completed identity transition; inspect/revoke the exact undelivered sign-in session and recover safely. |
| S64 | T-18 | S63,S60 | Audit operation-by-operation OAS/handler/schema/IAM parity across implemented local scope. | Every current operation classified and tested, or explicitly outside local scope with owned reason; no stub200 or missing required handler. |
| S65 | T-39 | S64 | Produce pinned production-mode artifact and start loopback built web plus separate worker. | NODE_ENV production with APP_ENV local; locked build and asset/auth/private cache/stream smoke; no outgoing external dispatch. |
| S66 | T-39 | S65 | Run assembled mobile/tablet/desktop buyer/affiliate/staff regression and visual/security review. | Real success/failure/denial paths with persisted assertions; actual browser/viewport evidence; missing Safari/device proof disclosed. |
| S67 | T-39 | S66 | Rehearse independent web/worker restart and isolated database/private-artifact backup restore. | Restored stock/money/commission/job/access invariants hold; original target untouched; unknown operations do not duplicate. Restored journals must reject new historical parts even on a fresh PostgreSQL cluster; verify/reseal database-local creating-XID guard metadata before reopening app writes. |
| S68 | T-39 | S67 | Review final local slice evidence, residual findings, reproducible runbook and handoff state. | Every accepted local slice has current proof and final independent review; startup/resume reproducible; external provider/hardware/hosting gaps remain separate. |
<!-- development-slices:end -->

## Fixture-to-implementation ownership

T-38 owns harness/seed; each feature parent owns the behavior. Required proof is stored through the actual ledger run plus safe test/browser artifacts linked from root STATUS/BUILD-LOG; a scenario name alone is not evidence. The scenario fixture remains at its canonical promoted path. S62 aggregates these cases without reimplementing business rules.

<!-- scenario-owners:start -->
| Scenario | Owner slice | Required persisted observation |
|---|---|---|
| prepaid-success-duplicate | S25 | One receipt and one eligible economic Purchase after duplicate event and receipt reload. |
| payment-timeout-after-commit | S24 | Original attempt resolves; no second operation/charge. |
| late-payment-stock-loss | S33 | Expired stock not revived; original receipt plus guarded compensation/recovery. |
| split-cod-refusal | S30 | Parcel cash conserved; one 99000 merchandise instance; no Purchase from refusal or settlement. |
| last-component-race | S15 | Two real database transactions compete; one reservation and nonnegative availability. |
| label-funding-pending | S54 | No valid AWB/PDF/print success and no new booking while funding unresolved. |
| label-expired-reprint | S55 | Refreshed private artifact keeps same active AWB and TEST watermark. |
| ads-consent-denied | S25 | Money committed; all external vendor dispatch suppressed. |
| ads-delivery-timeout | S60 | Same platform event identity/original timestamp retained after lost response. |
| chat-unknown-send | S41 | One public message and scoped recovery without internal note leakage. |
| shared-device-and-guest-link | S46 | Revoked/private state inaccessible; unproven guest order cannot be linked. |
| replacement-affiliate-hold | S37 | Only affected quantity maturity resets and no automatic bank transfer. |
| worker-crash-catchup | S12 | Durable committed work caught up using original identity. |
| holiday-calendar-boundaries | S29 | Explicit TEST-ONLY policy/clock respects closures and immutable anchor. |
<!-- scenario-owners:end -->

## Per-slice prompts and audit commands

The read-only helper parses this table and parent contracts, never another editable plan. From repository root use `python3 docs/spec/scripts/development-task.py list`, `python3 docs/spec/scripts/development-task.py check`, `python3 docs/spec/scripts/development-task.py prompt S01` or `python3 docs/spec/scripts/development-task.py review S01`. Generated prompts neither authorize implementation nor execute shell commands. They require current STATUS and predecessor evidence, the actual repository paths and approved scope.

For a resumed session: read STATUS, recheck dirty files and latest evidence, generate only the active slice prompt, reproduce the last unresolved check and continue from its actual state. For independent review use the review prompt on the final implementation surface, report severity/file/evidence/reproduction and verify repairs before proceeding. Never create completed EVID records from these planning commands.
