# Implementation Tasks

Status: Local slices `S01`–`S67` are implemented and verified PASS in the disposable local environment. Follow-up slices `S69`–`S79` (opened 2026-10-21 after the follow-up audit) are implemented and verified locally (2026-10-22, see STATUS); `S80` (production catalog dataset/import, DEC-005, opened 2026-10-22) and `S81` (live catalog: initial stock/HPP, publication withdrawal, catalog-only storefront, opened 2026-10-22) are in progress; they reopened the terminal gate `S68`, which awaits its final independent review. This is the sole repository execution queue; current checkpoint and verification evidence is owned by root `STATUS.md` and `BUILD-LOG.md`. External live-provider, physical carrier/printer hardware, and production deployment gates remain explicitly separate per `CTX-18`, and `T-19` remains deferred external candidate research.

Use the [ordered slice map](#execution-semantics--current-localhost-handoff) for precise local sequencing and the read-only development-task.py helper for per-slice implementation/review prompts.

### T-1 — Fixed-price catalog
- **Status:** Local slices S14 (inactive versioned catalog), S16 (publication/cost guard), S20 (frozen order snapshots), S21–S22 (public discovery/PDP), and S49 (admin catalog/publication workspace) implemented and verified PASS (`--case=PR-1`, `--case=PR-17`, `--case=T-34` PASS). External live-provider/production gates remain separate per CTX-18.
- **Primary requirement:** PR-1
- **Constraints:** DATA-1, IAM-1, SEC-1, NFR-1
- **Risk Level:** R2
- **Allowed Paths:** src/modules/catalog/**, tests/integration/**, migrations/**, src/app/api/v1/**, tests/contract/**, src/db/**, scripts/check-tests.ts, docs/spec/scripts/check-openapi-contract.py, src/storage/**, src/config/local.ts, src/app/media/**, src/modules/local/berlapak.ts, src/modules/local/berlapak-dataset.ts, src/modules/local/seed-runtime.ts, scripts/catalog.ts, data/catalog/**, package.json, README.md
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
- **Status:** Local slices S15 (warehouse movements, reservations, expiry, and transfers), S20/S29 (checkout reservation and per-parcel handover consumption), and S49 (admin warehouse stock forms) implemented and verified PASS (`--case=PR-2`, `--case=T-34` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slices S19 (address normalization, rate adapter, and complete-offer warehouse allocation) and S20/S26 (buyer cart/quote HTTP and checkout UI) implemented and verified PASS (`--case=PR-3`, `--case=PR-4`, `--case=T-31` PASS). External live carrier gates remain separate per CTX-18.
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
- **Status:** Local slices S20 (guest cart, publication/cost guard recheck, authoritative totals, idempotent order submit, and reservation expiry) and S26 (dedicated buyer checkout UI under T-31) implemented and verified PASS (`--case=PR-4`, `--case=T-31` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slices S24 (prepaid simulator callback/reconciliation) and S28 (split COD eligibility, per-parcel due, and atomic collection/posting/economic outbox) implemented and verified PASS (`--case=PR-5` integration & browser PASS). External live payment-gateway/carrier gates remain separate per CTX-18.
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
- **Status:** Local slices S29 (TEST-ONLY calendar deadlines, valid-waybill packing, preparation, and handover transitions) and S50 (assigned fulfillment queue UI) implemented and verified PASS (`--case=PR-6`, `--case=T-34` integration & browser PASS). External live carrier/production calendar gates remain separate per CTX-18.
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
- **Status:** Local slices S31 (quantity-scoped returns/inspection and refund confirmation) and S32 (replacement lineage, stock reservation, and receipt anchors), plus consuming buyer/staff/finance UI slices (S47, S50, S51), implemented and verified PASS (`--case=PR-7` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slices S35 (affiliate identity/profile, beneficiary-change control, and 7-day non-extending referral attribution) and S38 (affiliate enrollment/profile/link and beneficiary correction UI) implemented and verified PASS (`--case=PR-8` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slices S36 (quantity commission accrual/hold/release and receipt-based H+10 maturity) and S39 (affiliate balances, commission detail, holds, and maturity explanations UI) implemented and verified PASS (`--case=PR-9` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slices S37 (automatic IDR 99,000 eligibility queue and finance manual-transfer claim/proof/verification) and S40 (affiliate payout progress/history and finance evidence visibility boundary UI) implemented and verified PASS (`--case=PR-10` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slices S17 (subsidy/cap/budget rules with versioned quote snapshots) and S19/S20 (quote/order integration) implemented and verified PASS (`--case=PR-11`, `--case=PR-4` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slices S23 (immutable ledger primitives and order-history), S28/S29 (collected-receipt and fulfillment), S30 (COD receivable/settlement, fees, adjustments, and reconciliation), S34 (actual contribution, HPP lineage, and period-close reporting), and S51 (finance reconciliation workspace UI) implemented and verified PASS (`--case=PR-12` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slice S09 (canonical role grants, warehouse/object predicates, MFA, field projection, and audit boundary) and all consuming domain/admin handlers (`S49`–`S53` under `T-34`) implemented and verified PASS (`--case=PR-13` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slice S07 (document-only UX/IAM/data contract review) and all consuming affiliate (`S38`–`S40`) and buyer (`S21`–`S22`, `S26`–`S27`, `S46`–`S48`, `S61`) UI slices implemented and verified PASS (`--case=PR-14`, `--case=PR-8`, `--case=PR-9`, `--case=PR-10`, `--case=T-35` PASS). External physical-device/live-provider gates remain separate per CTX-18.
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
- **Status:** Local slice S56 (local catalog exports/feeds and storefront indexability/metadata parity) implemented and verified PASS (`--case=PR-15` integration & browser PASS). External live catalog upload/search-console gates remain separate per CTX-18.
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
- **Status:** Local slices S12 (durable job claim/lease/retry/dead-letter and unknown-operation reconciliation) and S63 (rate/upload/storage limits, redacted logs, correlation, and operational failure/recovery probes) implemented and verified PASS (`--case=PR-16` integration & browser PASS). External remote monitoring/production gates remain separate per CTX-18.
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
- **Status:** Local slice S08 (36 prototype checks, visual/design gates) and consuming responsive storefront/checkout/chat/account UI slices (`S21`–`S22`, `S26`–`S27`, `S44`, `S46`–`S48`, `S61`) implemented and verified PASS (`--case=PR-17`, `--case=T-33`, `design-gate.py` exit 0). External physical-device/Safari/WebView gates remain separate per CTX-18.
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
- **Status:** Local slices S10 (auth/visitor/guest transport and common errors/idempotency) and S64 (bidirectional operation-by-operation OpenAPI, handler, schema, and IAM parity audit across all 175 paths / 209 operations) implemented and verified PASS (`--case=PR-18` & `check-openapi-contract.py` PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slices S16 (prospective HPP/cost completeness and publication-review guard) and S34 (actual contribution, unknown-cost display, historical HPP/expense lineage, and period-close reporting) implemented and verified PASS (`--case=PR-19` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slice S13 (versioned commercial/calendar/settings snapshots and authorized change audit) and all consuming domain/UI slices (S16, S20, S29, S32, S35–S37, S52) implemented and verified PASS (`--case=PR-20` integration & browser PASS). External production activation gates remain separate per CTX-18.
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
- **Status:** Local slice S33 (late payment, stock loss, COD refusal, mixed delivery, and ambiguous external exception recovery across migrations 0023–0024 and `/api/v1/admin/exceptions/**` + `/api/v1/orders/{orderId}/exceptions/**`) implemented and verified PASS (`--case=PR-21` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slices S41–S43 (durable native support conversations/messages, guest recovery, staff claim/handoff, private image quarantine, internal notes, scoped search, context cards, saved replies, tags, and notification preferences) implemented and verified PASS (`--case=PR-22` & `--case=T-24` integration PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slices S44–S45 (responsive mobile/desktop storefront customer chat, private viewer, composer recovery, and CS staff inbox/assignment/notes/templates/oversight UI) implemented and verified PASS (`--case=PR-22` & `--case=T-25` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slices S25 and S28 (canonical commerce signals, visitor/consent context, prepaid and per-parcel COD Purchase outbox, and canonical local sink) plus consuming vendor adapters S57–S60 implemented and verified PASS (`--case=T-26` & `--case=PR-23` integration & browser PASS). External live ad-account gates remain separate per CTX-18.
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
- **Status:** Local slice S57 (Meta Pixel and server CAPI adapter contract and local sink with disabled live dispatch) implemented and verified PASS (`--case=T-27` integration PASS). External live Meta Test Events/account gates remain separate per CTX-18.
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
- **Status:** Local slice S58 (Google tag and Data Manager UPLOAD_CLICKS conversion adapter and local adjustment sink) implemented and verified PASS (`--case=T-28` integration PASS). External live Google Tag Assistant/ingestion gates remain separate per CTX-18.
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
- **Status:** Local slice S59 (TikTok Pixel and Events API adapter mapping and local sink) implemented and verified PASS (`--case=T-29` integration PASS). External live TikTok Test Events/account gates remain separate per CTX-18.
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
- **Status:** Local slice S60 (private advertising diagnostics, pause/replay/settings controls, and money-versus-signal reconciliation UI/API) implemented and verified PASS (`--case=T-30` & `--case=PR-23` integration & browser PASS). External live ad-platform gates remain separate per CTX-18.
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
- **Status:** Local slice S26 (responsive dedicated checkout UI and shipping/payment recovery) and S65–S68 assembled localhost readiness implemented and verified PASS (`--case=T-31` & `--case=localhost-readiness` integration & browser PASS, `design-gate.py` exit 0). External physical-device/live-provider gates remain separate per CTX-18.
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
- **Status:** Local slices S27 (core private receipt and returning status) and S48 (complete receipt support/actions, split COD, returns, and unknown/recovery views) implemented and verified PASS (`--case=T-32` & `--case=PR-24` integration & browser PASS, `design-gate.py` exit 0). External live-provider/production gates remain separate per CTX-18.
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
- Ref: `npm run test:integration -- --case=T-32` and `npm run test:browser -- --case=T-32` (implemented in S27; S48 completes full returns/chat/split-COD integration)
- Expected: Execute all TY1–TY8 and document 17 thank-you scenarios: pending/paid/failed/expired/unknown prepaid, COD accepted/partial collected, independent parcel/refund and guest recovery. Test390/768/1024/1440,320reflow,200percenttext, keyboard and mobile browser. Reload/Back/blocked tags/no returning buyer never duplicate or suppress backend Purchase; denied access leaks no receipt. Record independent rendered evidence. S27 integration (`2/2`) and browser (`3/3`, 20 renders, canonical visual review round 3 PASS, `design-gate` 0) pass on build `JNOqIXXXob_-4ypmlAvn7`.


### T-33 — Implement responsive storefront discovery, cart and journey continuity
- **Status:** Local slices S21 (public home/category/search/filter), S22 (PDP/offer selection/cart), and S61 (mobile shell, URL/history/drafts/scroll/referral continuity across the complete public journey) implemented and verified PASS (`--case=T-33` & `--case=PR-17` integration & browser PASS, `design-gate.py` exit 0). External physical-device/in-app browser gates remain separate per CTX-18.
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
- **Status:** Local slices S49–S53 (admin catalog publication/cost, warehouse stock forms, fulfillment/return/exception queues, finance reconciliation/refund/payout workspace, access/settings controls, KPI definitions, token-bound drilldowns, bulk previews, and bounded CSV exports) implemented and verified PASS (`--case=T-34` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slices S46–S47 (buyer Account/profile/address book/default address, verified contact change, guest-order linking, order list/detail, parcel timeline, and return/exchange evidence/case UI) implemented and verified PASS (`--case=T-35` & `--case=PR-14` integration & browser PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local slice S54 (template capability, scoped shipping-label job/batch/artifact generation, and private download/print audit) implemented and verified PASS (`--case=T-36` & `--case=PR-25` integration PASS). External live carrier/booking gates remain separate per CTX-18.
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
- **Status:** Local slice S55 (99ribu label print center with template/fallback disclosure and 100x150mm/A4 local preview/reprint) implemented and verified PASS (`--case=T-37` & `--case=PR-25` integration & browser PASS). External physical printer/scanner/carrier approval gates remain separate per CTX-18.
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
- **Status:** Local slices S11 (principal/warehouse seed and deterministic clock/inbox), S18 (catalog/stock/cost translation), and S62 (all 14 executable scenario mappings and full rerunnable seed through actual schema) implemented and verified PASS (`--case=T-38` integration PASS & `check-localhost-fixtures.py` PASS). External live-provider/production gates remain separate per CTX-18.
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
- **Status:** Local checkpoint re-verified 2026-10-24 (S68 terminal gate over S01–S81 and S90–S93): integration all-current 500/500, browser all-current 65/65, `localhost-readiness` 5/5 + 1/1 with `pg_dump`/`pg_restore` rehearsal, PR-18 5/5; evidence and the ledger boundary note in STATUS.md. External provider, hardware and hosting gates remain open (S82–S89, S94–S98); the parent is not marked fully complete.
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
| S69 | T-38 | S62 | Import the local Berlapak snapshot (`/data/99ribu-berlapak-data`) into the catalog and create dummy orders through actual writers and checkout handlers. | 26 bundles + ready-stock multipacks published at IDR 99,000 with private HPP; trust-boundary validation of data/image paths; rerun and concurrent order creation idempotent (`--case=seed-berlapak`). |
| S70 | T-22 | S33 | Register recovery refund creation/callback jobs in the worker and add host reconcile/simulation commands. | Prepaid and COD rails post one `refund_payable`/`company_cash` journal; replay and lost-ack converge without duplicates (`recovery-refund-worker` in `--case=PR-21`). |
| S71 | T-22 | S70 | Add owner-audited recovery for terminally failed recovery callbacks and a retry action for failed bank outcomes. | Failed callback without result can be re-armed exactly once per audited owner action; failed refund retries with a new attempt; no double posting; DB guards still refuse other transitions. |
| S72 | T-32 | S48 | Serve guest receipts from the `__Host-99ribu_order` capability only and remove query-string tokens. | No `?token=` accepted or emitted; recovered guest reaches the receipt by cookie on the built browser; prepaid payment-attempt view still authorised; spec 09 parity. |
| S73 | T-34 | S53 | Close audit-trail gaps for support classification, payout evidence registration, advertising replay and saved-reply/tag versions. | Each mutation writes an audit/version row in its own transaction with subject and reason; failed replay leaves a trace; prior versions remain readable. |
| S74 | T-25 | S45 | Load newest support messages with backward paging and refresh assignment versions after concurrent changes. | Customer and staff views show the latest messages and page older ones; buyer reply no longer causes repeated `VERSION_CONFLICT`; built-browser proof. |
| S75 | T-18 | S64 | Align the order `status` contract with the database lifecycle. | `openapi.yaml`, history filters and parity tests list only reachable statuses; contract check and `--case=PR-18` pass. |
| S76 | T-16 | S63 | Delete expired, unreferenced guest contexts through a bounded worker cleanup. | Migration relaxes the delete guard only for expired rows without references; referenced or live rows still refused; cleanup idempotent and bounded. |
| S77 | T-39 | S67 | Harden shared-database test isolation for outbox- and catalog-dependent suites. | Order-dependent tests target their own jobs/fixtures; `--case=all-current` integration and browser suites pass on a non-empty database. |
| S78 | T-16 | S71,S76 | Replace duplicated worker job-kind lists with one registry (kind → handler, error code, seal policy) that also builds the selector. | Every registered kind is dispatchable and selectable from one definition; unknown kinds refused; existing worker/integration suites unchanged; a test fails if a kind is enqueued anywhere without registration. |
| S79 | T-38 | S69 | Move the host fixture runtime from `tests/integration/commerce-fixture-runtime.ts` into `src/modules/local/` so operational scripts never import test files. | `scripts/seed.ts` imports only `src/`; seed/berlapak commands and fixture suites unchanged (`--case=seed-commerce`, `--case=seed-berlapak`). |
| S80 | T-1 | S16,S69 | Turn the Berlapak snapshot into committed production catalog content (DEC-005): a deterministic local generator writes a sanitized dataset plus content-hashed photos, and one idempotent import command loads categories, physical SKU identities, IDR 99,000 offers/bundle contents, photos (storage module, served by hash) and guarded publication through the real catalog/publication services. No stock, cost or order rows. | `npm run catalog:dataset` twice leaves `git status --short data/catalog` unchanged after the first run; `npm run test:integration -- --case=PR-1` passes `catalog-import` (second run 0 new catalog rows, changed dataset adds a new revision and keeps the old one, admin-edited drafts preserved, 0 stock/cost/order rows, no supplier names in dataset or DB public fields, photo resolvable by hash, malformed dataset refused before any write). |
| S81 | T-1 | S80,S77 | Make the DEC-005 catalog the live public catalog (owner decision 2026-10-22): an operator command loads initial stock and component HPP for the imported `B99_*` items from the raw snapshot at run time (not committed) plus S69 default offer assumptions, through the real inventory/finance services; publication stays the guarded import rerun. Add an immutable, audited publication withdrawal (`publication_withdrawal`, migration 0029) honoured by every public/sale reader; the storefront home, categories, search and header merchandise only current publications (no demo SKUs/slugs); a local-only command withdraws non-catalog publications; browser runs withdraw the publications their synthetic principals made. | `npm run test:integration -- --case=PR-1` passes `catalog-import` (initial stock: one receive movement and one HPP version per item plus default assumptions per offer, rerun and changed snapshot add none and report drift, stale snapshot or missing import refused before any write; import rerun publishes; withdrawal is versioned, idempotent, audited, DB-immutable, refused for a non-head publication and hides the product from every public reader until an ordinary republish; teardown withdraws only the run's synthetic non-catalog publications; `catalog withdraw` dry-run writes nothing); `npm run test:browser -- --case=PR-17` passes (`storefront-http` on its own seeded namespace) and its run ends with the teardown summary. |
| S90 | T-1 | S81 | Bind every DEC-005 catalog offer to its Berlapak origin warehouse (DEC-006, owner decision 2026-10-23, "bypass by kecamatan"): expand-only migration `0030_warehouse_origin` (nullable `app.warehouse.province`, `district`, unique hashed `origin_key`); dataset `99ribu.catalog/v2` with per-offer origin keys and a warehouse list of generic `Gudang <Kecamatan>[ n], <Kota>` names plus province/city/district only; `catalog:import` creates/reuses origin warehouses idempotently and binds offers through ordinary revisions; `catalog:initial-stock` receives each item into its origin warehouse; read-only/audited `catalog:rehome` transition moves stock already held in one import warehouse by warehouse transfers; simulated rates band by origin vs destination kecamatan/city/province. | `npm run catalog:dataset` twice leaves `git status --short data/catalog` unchanged after the first run and reports 49 warehouses; `npm run test:integration -- --case=PR-1` passes `catalog-import` (generator: offer origin = hash of its supplier warehouse, generic kecamatan names numbered per kecamatan, no supplier name, supplier warehouse name/id or `address_id` in the dataset, split/unknown/orphan bindings refused; import creates the origin warehouse once with an audit row, reuses it on rerun, refuses a stored origin with a different location before any write, every offer's default warehouse is its origin; initial stock lands in the origin warehouse and is never received when the item already has stock history elsewhere; transition dry run writes nothing, apply moves available units by received transfers, keeps quarantined/reserved units, converges on rerun, and the next import rebinds every importer-owned offer with a new revision while history keeps the old binding; `rehome` CLI dry run exits 0; storefront (null clock namespace) quotes of a published bundle succeed from a city-only legacy warehouse and from its origin; a raw bundle mixing supplier warehouses is skipped); `--case=PR-3` passes rate banding (same kecamatan < same city < same province < inter-province; city-only for rows without district; fixture quote amounts unchanged); `--case=PR-4`, `--case=PR-17`, `--case=seed-berlapak` and `--case=seed-foundation` stay green; `python3 docs/spec/scripts/check-openapi-contract.py` PASS. |
| S91 | T-6 | S90 | Manual consignment fulfillment (DEC-007) on the existing fulfillment/shipping/COD/settlement domain, no parallel order model: expand-only migration `0031_manual_fulfillment` adds versioned private `warehouse_pickup_profile` revisions (street address, PIC name, PIC phone, optional pinpoint; readiness computed), an immutable manual dispatch record per parcel (optional Berlapak purchase reference, frozen shipped unit set) and `manual_tracking` versions (courier code, normalized resi from 99ribu's Mengantar account, reason), new fulfillment event kinds for manual resi entry and resi correction (existing `handover` consumes stock with the frozen unit set) and a widened tracking format; per-warehouse fulfillment mode (`manual_dashboard` unless profile complete AND the Mengantar API flag, which stays off); admin work queue "Perlu dipesan kurir" for paid prepaid and confirmed COD parcels in manual mode: operator books in the Mengantar dashboard, records optional Berlapak purchase reference, enters courier + resi (marks shipped) → buyer order page shows courier + resi; audited resi correction with reason; resi deadline from the warehouse calendar where configured; delivery tracking seam: a `TrackingAdapter` reading the account's own order tracking (simulated locally; live Mengantar = gated S98) polled by a registered worker job for shipped manual parcels, mapping provider statuses (picked up / in transit / delivered / failed) onto the existing shipment/delivery states so delivered records the buyer receipt (H+10 commission maturity and return window start), plus an audited operator fallback (reason + evidence) sharing one idempotent monotonic status history; idempotency keys + expected versions; owner/ecommerce_admin/warehouse scoped to its warehouses (pickup profile owner/ecommerce_admin only); finance records Mengantar COD settlement statements from the dashboard (reference, evidence, per-parcel collected amounts, Mengantar shipping charge and COD fee deductions, net) posting through the existing S28 COD collection receipt + S30 settlement reconciliation journals with mismatches flagged and no seller payable (OD-12); shadcn console UI and OpenAPI parity. The local carrier simulator stays the automated stand-in; a parcel's path is pinned by its first action. | `npm run test:integration -- --case=manual-fulfillment` passes: queue membership by mode (manual-mode parcel listed, simulator-booked parcel absent, shipped parcel leaves the queue, unpaid/unconfirmed orders absent), resi entry → shipped with stock consumed once and buyer order/receipt projection showing courier + resi, optional purchase reference stored without PII, resi correction requires reason and keeps every version + audit, invalid resi/courier refused, idempotent replay and stale `expected_version` 409, warehouse role scoped to its warehouses (other warehouse 404, finance/CS 403), manual resi refused after a booking and booking refused after a manual resi, pickup profile readiness and mode switching (complete profile + flag off stays manual; pure mode function covers flag on), pickup PII absent from public/buyer responses, audit details and captured logs; tracking: the simulated adapter's delivered status records buyer receipts for exactly the frozen shipped units once (replayed poll writes nothing), starts commission maturity and the return window, in-transit/failed show on the buyer order page without a receipt, a regression (delivered → in transit) is ignored, adapter failure leaves state unchanged with bounded retries, the operator fallback requires authority + reason + evidence and is audited, an automated observation after an operator-recorded delivery does not duplicate it; `--case=cod-remittance` passes: an exact Mengantar statement posts one COD receipt per parcel and one balanced settlement cash/fee/match set, a parcel amount mismatch opens a COD recovery case, gross ≠ net + deductions is `SETTLEMENT_TOTAL_MISMATCH`, a duplicate statement reference replays, a non-shipped/non-COD parcel is refused, finance-only with fresh reauthentication; `--case=PR-5`, `--case=PR-6`, `--case=PR-12`, `--case=PR-18`, `--case=T-34` stay green; `python3 docs/spec/scripts/check-openapi-contract.py` PASS; `npm run check` PASS; rendered admin queue/dialog and buyer order page evidence at 390 and 1440 px. |
| S92 | T-5 | S91 | Payment methods and manual bank transfer (DEC-008 (1)(4)(5)) plus buyer COD fee (DEC-009): payment adapter seam (`manual_bank`, `autolaris` placeholder disabled, existing local simulation for tests); owner-configured, versioned, reauthenticated bank accounts; unique code 1–999 added to the total per open manual-bank payment and recorded as a separate buyer-paid payment component (spec 11), instructions on the receipt page, 24-hour window cancelling the order and releasing holds through the existing order-expiry job; finance reconciliation queue confirming with evidence (bank reference, time, amount, proof) through the existing receipt/settlement journals, mismatch flagged; versioned `cod_fee_bps` policy (333) frozen per quote, per-parcel fee ceil(base × bps / 10000) disclosed as "Biaya COD (3,33%)" on checkout/quote/receipt/order, included in parcel COD due, recorded as a separate receipt component, excluded from Purchase and commission, refunded by frozen unit share; DEC-007 remittance expectation includes the fee. | `npm run test:integration -- --case=PR-5` passes new cases: fee math and ceiling rounding per parcel (including split COD), policy version change affects only new quotes, quote/order freeze, ledger keeps merchandise/shipping/COD fee separate and Purchase stays merchandise-only, refund of one unit refunds its frozen fee share and a full return conserves the original payment, manual-bank unique code unique among open payments, added to the transfer, never posted as merchandise/shipping or Purchase, and refunded by unit share (full refund returns the whole code), unpaid order cancelled with stock released once after 24 hours, confirmation requires finance authority + reauthentication + evidence, wrong amount flagged not confirmed, expiry releases stock once; `--case=cod-remittance`, `--case=PR-7`, `--case=PR-12`, `--case=PR-18` stay green; OpenAPI parity PASS; rendered checkout/receipt/order and finance queue evidence. |
| S93 | T-5 | S92 | AutoLaris payment adapter on a local simulated contract (DEC-008 (2)(3)): Create Payment request/response mapping (`reff_id` persisted before the call, `trx_id`, VA/QR/payment_code/url, `admin`, `total`), channels from a simulated `list_payment`, store-absorbed admin fee posted as payment cost, bounded idempotent advice polling job (only an explicit settlement status pays; pending/unknown/generic statuses do not), callback endpoint that only records raw events for discovery, audited owner/finance manual confirmation with reason and fresh reauthentication; timeouts reconcile via advice before retry; no live call, credential or network access. | `npm run test:integration -- --case=PR-5` passes AutoLaris simulated cases: one payment per `reff_id` across timeout/lost response, advice `02` keeps pending and an unknown status never pays, explicit settlement status pays once (duplicate advice replays), callback rows never change payment state, manual confirmation needs authority + reason + reauthentication and is audited, admin fee recorded as store cost and absent from buyer total and Purchase, live adapter refuses to start without the production gate; `--case=PR-18` and OpenAPI parity PASS. |
| S68 | T-39 | S67,S69,S70,S71,S72,S73,S74,S75,S76,S77,S78,S79,S80,S81,S90,S91,S92,S93 | Review final local slice evidence, residual findings, reproducible runbook and handoff state. | Every accepted local slice has current proof and final independent review; startup/resume reproducible; external provider/hardware/hosting gaps remain separate. |
<!-- development-slices:end -->

## Production migration slices (Vultr + Coolify) — gated, post-local

Added 2026-10-22 (planning only; owner goal: the DEC-005 Berlapak catalog and its photos appear on the live server exactly as locally, without dumping the local database). These rows sit **outside** the `development-slices` table on purpose: that table is the CTX-18 local queue whose terminal gate S68 must transitively require every row, and production work must not hold local acceptance hostage. `development-task.py check` therefore does not parse them and `prompt S82` is unavailable until the checker learns a second (production) table — a small follow-up in `docs/spec/scripts/`, not done here. Parents reuse existing T-ids so requirements, risk and constraints stay traceable. Runbook and owner decisions: `RELEASE.md` "Production migration (Vultr + Coolify)".

Gate legend: **CODE** = repository work verifiable on this host against a disposable local target, still needs an owner go-ahead for implementation scope (no server, DNS, provider or credential action). **DEPLOY** = touches the Vultr/Coolify server, DNS, off-host storage or production data; needs explicit owner deploy authorization for that exact step, per RELEASE.md. Every row starts only after S68 passes. Commands named below that do not exist yet (`production` targets, `staff:bootstrap-owner`, `warehouse:create`) are prospective until their slice implements and registers them in README.

| Slice | Parent | After | Gate | Delivery | Done when |
|---|---|---|---|---|---|
| S82 | T-23 | S68 | CODE | Production runtime profile `APP_ENV=production` beside the unchanged `local`/`test` reader: exact `https://` `APP_ORIGIN` from env (no path/credentials; optional second admin host only if the owner picks one); `BETTER_AUTH_URL` must equal it; `BETTER_AUTH_SECRET` from env (≥32 random bytes, never a file under `.local/auth`, never logged); `trustedOrigins` = the configured origin(s) only; `useSecureCookies: true`; client IP derived only from the one trusted reverse proxy (Coolify proxy or Cloudflare, per owner decision) instead of the fixed `x-99ribu-local-ip` stamp; listener `0.0.0.0:<PORT>` inside the container only; `LOCAL_TAILNET_ORIGIN`, every `src/modules/local/*` command, `/api/v1/admin/local-fixture-command`, fixture/login/dummy-account commands and simulated worker commands refuse to run; no adapter may be `simulated` — unissued providers are `disabled` and the checkout entry points stay closed until their provider gates pass. Modules that only need the origin read it from a profile-neutral accessor instead of `readLocalConfig`. Audit 2026-10-23: `public/prototypes/` must not be served in production (exclude from the image or gate the path). | `npm run check` passes with new `tests/config.test.ts` cases that reject: `http://` or loopback/tailnet origin, missing/short secret, `BETTER_AUTH_URL` ≠ origin, extra trusted origin, any `*_ADAPTER=simulated`, `LOCAL_TAILNET_ORIGIN` set, and that `npm run fixture -- <any> production` and the `local-fixture-command` route refuse under the production profile; `NODE_ENV=production APP_ENV=production npm run build` succeeds with a dummy non-secret test env; local `npm run test:integration -- --case=all-current` and `npm run test:browser -- --case=all-current` stay green (local profile unchanged). |
| S83 | T-23 | S82 | CODE | `production` database target: `connectDatabase`, `scripts/migrate.ts`, worker and health accept it and connect over TCP on the private Docker network with SCRAM password auth from env (no public port, TLS optional on the internal network), `application_name` and the same pool/statement-timeout limits; roles mirror `src/db/bootstrap.sql` in a reviewed `src/db/bootstrap-production.sql` run once by the Postgres superuser: `99ribu_production_owner` and `99ribu_production_app` (LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE), database `99ribu_production` owned by the owner role, `REVOKE CONNECT … FROM PUBLIC` on it, `postgres` and `template1`, `REVOKE CREATE ON SCHEMA public FROM PUBLIC`; migrate keeps granting only DML to the app role; the superuser is never used by web/worker. Same PostgreSQL major (18) as local. Migrations take a Postgres advisory lock so two starting containers cannot race. Audit 2026-10-23: one expand migration adds `'production'` to the `environment IN ('local','test')` CHECKs on the money tables (19 found: manual bank, COD, AutoLaris, settlements …); pool size/`idle_in_transaction_session_timeout`/`lock_timeout` set explicitly; health check reuses the app pool. | On a disposable local `postgres:18.6` container with TCP + SCRAM: bootstrap script applies once (second run fails loudly, nothing half-created), `npm run db:migrate -- production` applies `0000`–`0034` (re-run: no-op), and a new `tests/database.test.ts` case connected as the app role is refused `CREATE TABLE`, `TRUNCATE` on a finance table and `CONNECT` to `postgres`; two concurrent migrate runs both exit 0 with one applying. |
| S84 | T-16 | S83 | CODE | Container image and Coolify topology: pinned `Dockerfile` (Node `24.21.0` per `.node-version`, `npm ci`, `next build`, non-root fixed uid, `HEALTHCHECK` hitting `/api/health` with a binary present in the final stage); two Coolify Applications from the same image — **web** (start = `db:migrate -- production` then `next start`; a failed migration exits so the health check never turns green and Coolify keeps the previous container) and **worker** (`scripts/worker.ts production`, no HTTP, own heartbeat surfaced by an operator probe); one persistent volume mounted at the app's `.local/catalog-media` and `.local/artifacts` with ownership/mode matching `privateDirectory` (uid = runtime uid, 0700 dirs, 0600 files) and shared read-write by web and worker; no host port published (proxy only); rolling updates require graceful SIGTERM in both processes. `/api/health` and `check-health.ts` use the selected profile. | `docker build` succeeds on this host; `docker run` of web + worker against the S83 rehearsal DB with a production env behind a local TLS proxy reaches `readiness=ready status=200` via the health script, `/media/catalog/<sha256>.webp` from the mounted volume returns 200 `image/webp`, killing the worker with SIGTERM finishes its transaction (S12 lease test still green), a deliberately failing migration leaves the container unhealthy, and the image contains no `.local/`, `.env*`, `data/catalog/berlapak/` outside the intended copy, raw snapshot or test fixtures (`docker run --rm <image> find / -name '*.key'` etc. reported). |
| S85 | T-16 | S84 | CODE, then DEPLOY | Backups that cover database **and** media/artifacts together: Coolify scheduled backup of the Postgres resource to an off-host S3-compatible target (retention per owner) plus `pg_dumpall --globals-only` for roles; a scheduled task that archives the `.local/catalog-media` + `.local/artifacts` volume to the same off-host target with a manifest of SHA-256 names; a documented restore drill into a **disposable** database/volume (never the live one) that reuses the S67 `pg_restore` + creating-XID reseal procedure. Credentials for the target live only in Coolify, never in the repo. Audit 2026-10-23: the restore drill must also escrow and restore `BETTER_AUTH_SECRET` (it encrypts staff TOTP secrets; a DB restore without it locks staff MFA). | CODE part: restore drill script/procedure rehearsed locally — dump of the S83 rehearsal DB + media archive restore into a fresh disposable Postgres/volume, then the S87 verification queries return the expected counts and every restored photo hashes to its file name; recorded in `OBSERVABILITY.md`. DEPLOY part (authorised separately): first scheduled backup and media archive visible in the off-host bucket, and one restore drill from that bucket into a disposable target passes the same checks; date/duration recorded in `RELEASE.md` `Backup-Proof`. |
| S86 | T-13 | S83 | CODE | Real staff accounts instead of local dummies: a one-time, audited `staff:bootstrap-owner -- production` operator command that creates the first owner from an operator-typed real email + password (never echoed), refuses when any owner exists, and leaves the account unable to use `/api/v1/admin/*` until TOTP enrolment is verified (`MFA_REQUIRED`); further staff via the existing owner role-grant flow (fresh password + MFA proof). Production needs real verification/password-reset delivery (only synthetic `.test`/`.invalid` recipients are accepted today): either an issued email provider adapter behind the T-26 notification gate, or an owner-chosen operator-assisted verification path — open owner decision. No `@99ribu.test`/`@example.invalid` principal may exist in production. | New integration case on the S83 rehearsal DB: bootstrap creates exactly one owner and one audit row; a second run exits non-zero with no write; that owner gets `MFA_REQUIRED` on `GET /api/v1/admin/warehouses` until TOTP is verified, then 200; `npm run fixture -- login production` exits non-zero; `select count(*) from app.auth_user where email ~* '@(99ribu\.test|example\.invalid)$'` returns 0 after the run. |
| S87 | T-1 | S84,S86 | CODE | Production catalog load path (DEC-005 / S81 / DEC-006 on a real target): the dataset's origin warehouses are created by `catalog:import` (no `warehouse:create` step for the catalog; S90); `catalog:import`, `catalog:initial-stock` and `catalog:withdraw` accept `production` and act as a named, MFA-verified real owner (operator-supplied session or audited system operator) instead of the synthetic `@example.invalid` seed operator and `local-fixture-command` route; the raw Berlapak snapshot is read from an operator-uploaded, read-only path outside the repository and image (`BERLAPAK_DATA_DIR`), its digest must equal the dataset's `source_snapshot`, and it is removed from the server after a successful load unless the owner keeps it; import runs with the production `APP_ORIGIN` because image URLs embed the origin. Verification SQL ships as a read-only script. | On the S83/S84 rehearsal stack: `catalog:import` → `catalog:initial-stock` → `catalog:import` → `catalog:withdraw` (dry run) gives exactly 12 `app.category` rows, 49 `app.warehouse` rows with `origin_key` (every `B99_*_OFFER` default warehouse is its dataset origin), 368 `app.stock_item` with `sku like 'B99\_%'`, 392 `app.offer` with `sku like 'B99\_%\_OFFER'`, 708 `*.webp` files in `.local/catalog-media` each hashing to its name and matching `data/catalog/berlapak/manifest.json`, one `receive` stock movement and one `component_cost_version` per received stock item (counts equal the initial-stock summary), the published-product count equals the import summary, withdraw dry run reports 0 candidates; repeating the four commands writes 0 rows; a mismatched snapshot is refused before any write. |
| S88 | T-39 | S85,S87 | DEPLOY | Server rehearsal before any public DNS: on the owner-chosen target (staging host, or the production host reachable only through its Coolify-generated or protected hostname), provision Postgres + roles (S83), deploy web + worker (S84), configure backups (S85), bootstrap the owner and staff (S86), run the catalog load (S87), then rehearse: one restore drill from off-host backup into a disposable target, one Coolify rollback to the previous retained image (expand-only migration compatibility checked first), and worker restart catch-up. Coolify control-plane ports closed at the Vultr firewall once its own domain works. | Recorded in `RELEASE.md`/`OBSERVABILITY.md` with date and operator: S87 counts on the server DB; `/api/health` 200; worker heartbeat fresh; storefront home, a category, one PDP (photo from `/media/catalog/…`) and the admin catalog list at 390 and 1440 px visually match the local build of the same commit (screenshots side by side); owner sign-in requires TOTP; restore drill PASS with elapsed time; rollback to previous image returns health 200 and rolling forward again succeeds; no `simulated` adapter and no dummy account present. |
| S89 | T-39 | S88 | DEPLOY | Production go-live: final pre-cutover off-host backup, DNS/TLS cutover on the owner-chosen domain (Cloudflare proxy or Tunnel per owner decision; private/admin/checkout/order-capability responses never cached), external uptime check, read-only smoke, and the release record (`Release-ID`, `Base`, `Rollback-Ref` = the deployed commit's predecessor image, backup reference). Checkout and outbound provider effects stay closed until their own provider gates; this slice launches only what the owner's launch-mode decision allows. | Public origin serves `/api/health` 200 over HTTPS with Secure host-only session cookies; public catalog counts on the live site equal S87; an external monitor reports the origin up for the first 24 h; `RELEASE.md` records the release fields and a successful post-cutover backup; owner confirms the live storefront and admin catalog match local. |

## Provider integration slices — gated (DEC-007, DEC-008)

Added 2026-10-23 (planning only). Like the production table, these rows sit **outside** the `development-slices` table on purpose: each needs an issued provider contract, credentials or a live/sandbox call that local acceptance must not wait for, so `development-task.py check` does not parse them and S68 does not depend on them. Every row is **GATED**: it starts only with explicit owner authorization for that provider step, the issued merchant documentation recorded with retrieval date, and secrets supplied through the secret store (never the repository). Contract facts in the `mengantar-api` skill and AutoLaris docs are hypotheses until one sandbox call is recorded.

| Slice | Parent | After | Gate | Delivery | Done when |
|---|---|---|---|---|---|
| S94 | T-6 | S91 | GATED (Mengantar contract + sandbox key) | Mengantar API booking path for warehouses whose S91 pickup profile is complete: register the warehouse's pickup address on 99ribu's Mengantar account (street, PIC name, PIC phone; pinpoint only for instant/same-day, per the issued `PickupAddressInput` contract) and book shipments through a server-only adapter behind the existing booking seam (shipment booking → issued resi → handover), COD on 99ribu's account; credential-bearing URLs redacted from logs; serialized/batched order creation if the issued contract confirms per-courier concurrency limits; wallet-unpaid draft state handled; the `mengantar_api` flag turns on per warehouse only after a recorded sandbox booking. Manual dashboard booking stays available for every other warehouse. | Sandbox: one pickup address registered and one non-COD booking issues a resi; sanitized request/response evidence recorded; a warehouse with an incomplete profile or flag off stays in the manual queue; a parcel with a manual resi is never booked; adapter tests for unsupported route, timeout (no duplicate booking), insufficient wallet draft state and redaction pass. |
| S95 | T-3 | S91 | GATED (Mengantar contract + sandbox key) | Live Mengantar rate estimate adapter replacing simulated "cek ongkir" per origin kecamatan → destination: map DEC-006 kecamatan to the provider area id, honour `unsupported`/`unsupported_cod` route flags (hide courier / hide COD), bounded timeout and cached quotes with the same frozen-quote contract; simulated rates remain the test default. | Sandbox Jakarta→Jakarta non-COD estimate returns ≥1 courier with both route flags (bounded smoke per the skill); quote freezing, split-parcel and COD-hiding integration cases pass against a recorded fixture; no credential in client bundles or logs. |
| S96 | T-2 | S91 | GATED (Berlapak data access agreement) | Berlapak stock sync: periodic, idempotent import of seller stock for origin warehouses through audited inventory movements (never overwriting history), drift report, and a stop-sell when the seller's stock is below reserved demand. | A replayed sync writes nothing new; a decrease below reservations flags the offer instead of overselling; movements are audited; no supplier identity enters public data. |
| S98 | T-6 | S91 | GATED (Mengantar contract + sandbox key) | Live Mengantar tracking adapter behind the S91 `TrackingAdapter` seam, reading the order tracking of 99ribu's own Mengantar account (every resi is ours, DEC-007): confirm the tracking endpoint/status vocabulary from the issued contract and a sandbox call, map provider statuses onto the S91 states with bounded polling and redacted credential URLs; unknown statuses change nothing; the operator fallback stays. | Recorded sandbox evidence of the tracking response; one test resi moves through in transit → delivered and records buyer receipts once; unknown provider statuses map to no state change; no credential in logs. |
| S97 | T-5 | S93 | GATED (AutoLaris account, static IP, owner authorization) | AutoLaris live onboarding: Vultr static egress IP(s) whitelisted (≤5), API key in the secret store, `list_payment` from the live account, callback discovery (store raw callbacks, compare with advice) to close the open contract questions (payload/signature/source IP/retry, `expired` timezone, advice status list, `reff_id` rules), then a bounded live smoke with a minimal amount and manual reconciliation. | Live `list_payment` and one minimal VA or QRIS payment reconciled by advice and the AutoLaris dashboard; callback evidence documented; open questions answered or kept as explicit gates in spec 11; no order marked paid from a callback. |

## Launch readiness slices — post-S68 (admin, data, storefront)

Added 2026-10-23 from the independent admin/DB readiness audit, the repo screening and the architecture rewrite (ARCHITECTURE.md "Known differences"). Like the production tables, these rows sit outside the CTX-18 local queue so they do not hold S68 hostage; each starts after S68 passes and is CODE (local, verifiable on this host). Money-path rows need an R4 independent review. Owner authorized S82–S87 on 2026-10-23; these rows run in parallel where their file surfaces are disjoint.

| Slice | Parent | After | Gate | Delivery | Done when |
|---|---|---|---|---|---|
| S99 | T-6 | S68 | CODE (R4) | Manual consignment queue usable for booking: rows expose recipient, items to pick, COD amount due, the buyer's quoted courier/service (pre-filled in "Catat resi"), parcel weight and destination area; ordered by packing deadline then age; keyset paging ("Muat lebih banyak"); `ecommerce_admin` company-wide or copy that states the membership rule. | A seeded queue of >100 parcels pages completely in deadline order; dialog pre-fills the buyer's courier; COD due equals `order_shipment`; scope/denial tests pass; renders 390/768/1440. |
| S100 | T-13 | S68 | CODE | Order detail and search for staff (`/admin/orders/[id]`, search by order number/resi/phone suffix) linked from the dashboard queues, the manual queue and the support inbox (which today shows raw UUIDs). | CS finds an order by number and sees resi/tracking/payment state; links resolve from all three entry points; role denial tests pass. |
| S101 | T-22 | S68 | CODE (R4) | Return/refund/replacement decision screens over the existing return APIs, and a warehouse calendar form (policy `warehouse_calendar`) next to the pickup profile, plus a bulk "apply default calendar to origin warehouses" owner action (audited). | A return can be decided end to end in the UI; every live offer's warehouse has a current calendar so resi deadlines compute; audit rows written. |
| S102 | T-21 | S68 | CODE | Inventory receive/adjust/transfer screens, shipping promotions (staff role grants moved to S137 on 2026-10-25) and product content editing (title, description, photo order, alt text) over the existing APIs, with a DEC-013 "Perlu tinjauan klaim" flag/filter (reusing `hasClaimTerm`) and the Google product category shown read-only. | Each operation works in the UI with reauth/audit as the API requires; claim filter lists the DEC-013 items; staff edits are preserved by `catalog:import`. |
| S103 | T-20 | S68 | CODE | Dashboard truth and KPIs: active-order and fulfillment counts exclude terminal states; add orders by payment method, parcels awaiting manual booking, transfers near the 24 h deadline, pending AutoLaris payments, COD outstanding vs remitted, low stock per origin warehouse (quarantine-aware); one IDR formatter and WIB time handling across admin (payments `datetime-local` → `+07:00`). | KPI integration tests with seeded states; definitions match counts; renders 390/768/1440. |
| S104 | T-16 | S68 | CODE | Database hot paths and hygiene: indexes for `inventory_balance(stock_item_id, warehouse_id)`, outbox due/lease scans, support inbox keyset paging, print queue; declare the two hand-written 0019 objects in `schema.ts`; admin category lists show only categories with a current draft/live product (old immutable rows hidden); transfer unique codes not reused within ~72 h. | EXPLAIN before/after recorded; `drizzle-kit` snapshot has no drift; category picker lists the 14 departments; code-reuse test passes. |
| S105 | T-16 | S68 | CODE (R4) | Retention jobs for unbounded tables (completed outbox jobs, access operations, auth sessions/verifications/rate limits, MFA sessions, visitor/funnel/ad events, raw provider events) with documented windows; ledger tables keep everything. | Each job is bounded, idempotent and tested; nothing referenced by money/audit history is deleted. |
| S106 | T-15 | S68 | CODE | Catalog feed route `/api/v1/catalog/feeds/{channel}` (OpenAPI + parity) emitting `google_product_category`/`product_type` from stored data (persist the Google category per product at import instead of reading the dataset file at runtime), paged without the 50-item cap, public-safe fields only. | Feed validates for all 392 products; OpenAPI parity passes; a staff-created product gets its department default. |
| S107 | T-14 | S68 | CODE | Storefront backlog: cart line layout at 390px, per-item thumbnails for bundle PDPs, support inbox moved into the console shell (no hard-coded origin, noindex), duplicated IDR/sha256/compare helpers consolidated (simulator signature helpers only with R4 review). Owner additions 2026-10-24: omnibox open state like shop.com (bare input, single glass surface, chip suggestions, content-sized height), logo reveal "Serba 99ribu." with the dot, and category/search infinite scroll (no load-more text; crawlable next link kept; Back restores position). | Design gate PASS after recapture; browser suite green; no duplicate helper definitions outside their module. |
| S108 | T-6 | S68 | CODE (R4, migration) | Delivery re-attempt after a failed attempt (owner decision pending): expand migration relaxing the tracking guard so `failed` → `in_transit`/`out_for_delivery` can follow while `delivered`/`returned` stay terminal. | Starts only after the owner approves the migration. |
| S109 | T-13 | S68 | CODE (R4) | Access policy gaps found in the S103 review: an `ecommerce_admin` (or any scoped role) with zero warehouse assignments must see nothing in warehouse-scoped queues instead of the unscoped set; enforce `finance.summary.read` on money metrics as OpenAPI already states; give the local `cs@` dummy account the origin-warehouse scope so customer service can find orders (spec 07 scoping) and check its dashboard effect; seed a fixture that resolves a delivery exception so the S103 terminal-state test owns its data. | Denial tests for zero-assignment roles and missing `finance.summary.read`; `cs@` finds a seeded order; S103 test passes on a freshly reset test database. |
| S110 | T-1 | S68 | CODE (migration) | Admin-managed home promo banners (owner request 2026-10-24): expand-only table for banners (title, optional subtitle, image via the existing private/catalog media storage with alt text, internal link target validated as a storefront path, starts_at/ends_at in WIB, position, active, audited create/revise/retire like other versioned content), an admin screen to upload/order/schedule/retire banners with preview, and the storefront banner carousel (already built from a `banners` array) reading the current banners instead of the data-backed defaults. No external links or third-party tracking pixels in banners. | Owner/ecommerce_admin manage banners with reauth/audit; scheduling honours WIB windows; storefront shows only current banners and hides the section when none; image upload limits/type checks; tests for scheduling, permissions and the public projection; design gate PASS after recapture. |
| S111 | T-17 | S107 | CODE | Storefront freeze and component architecture (owner request 2026-10-24): after the current storefront round passes, reorganize `src/components/storefront/` into shared primitives (button, chip, popover/sheet, card, carousel, icon set with filled/outline variants) and section components without visual change; one token module; write `DESIGN.md` (storefront design system: tokens, components, interaction rules, accessibility), tidy `docs/spec/design/references/shop-com/visual-context.md` into the observed visual contract, update ARCHITECTURE.md storefront section. | No visual diff on the recaptured design-gate set (gate PASS); browser suite green; no unused component or CSS selector; docs link-checked. |
| S112 | T-14 | S111 | CODE | Sign-in UX (owner request 2026-10-24): observe shop.com's sign-in flow first (page vs modal); keep the dedicated `/masuk` page (staff TOTP, password managers, `?next=` deep links, no-JS) and, if it fits, also open it as an intercepting-route modal/sheet from storefront pages so shoppers keep context; buyer and staff states, errors, rate-limit and lockout copy, accessibility (focus trap, return focus, labelled fields, autocomplete hints). | Both entry paths sign in and return to `?next=`; TOTP step works in modal and page; browser tests for modal + page + no-JS; design gate PASS. |
| S113 | T-13 | S100 | CODE | Admin console consolidation (owner request 2026-10-24): one data source per screen (shared query/API layer so KPI cards, tables and drilldowns read the same projection — extends the S103 pattern), tidy admin components on shadcn blocks (sidebar, data-table with filters/paging/bulk actions, KPI cards, forms/dialogs, empty/loading/error/denied states), then build the remaining screens of S100–S110 on that base. | Every admin KPI equals its drilldown count (tests); shared data-table used by all list screens; admin design review PASS at 390/768/1440. |
| S114 | T-16 | S113 | CODE (R2–R4 per step) | Backend structure tidy from the 2026-10-24 review (/tmp report summarized in BUILD-LOG): move the shared kernel (validators, digest/mac/cookie, mutationKey/intentHash) out of catalog/checkout into access/ by import-only codemods; break the 3 import cycles; one idempotency-key parser and one `access_operation` check/save helper; one HMAC signer for simulators (verification differences are a separate R4 change); one PG-conflict→409 mapper preserving per-handler code lists; split reporting/service.ts and support/service.ts into files by concern without logic changes; separate simulator commands from the production worker loop; retire test-only exports from production modules; finally one mechanical `biome format` commit when no other branch is open. | Each step proves no behaviour change with its listed selectors (T-34, PR-22, PR-5, …); money-path steps get an R4 review; no new import cycles (import-graph check in CI). |
| S115 | T-5 | S83 | CODE (R4, design) | Production settlement path for manual bank transfer and AutoLaris advice: today confirmation flows through `payments/local.ts:settleLocalOperation` and `local_*` tables that migration 0035 keeps local/test-only, so production money posting depends on the `PRODUCTION_MONEY_PATH_GATED` gate. Design and implement the production writer (or rename/scope the tables) with an ADR/DEC before go-live. | Decision recorded; production confirmation posts through a production-allowed path with ledger parity tests; R4 review PASS. |
| S116 | T-13 | S105 | OWNER (PRIV-1) | Approve the S105 retention windows in `src/jobs/retention.ts` (outbox done 30 d, replay-only `access_operation` 90 d, sessions 30 d after expiry, verification 7 d, rate limit 1 d, unreferenced visitor history 90 d after expiry); today they are engineering defaults. | Owner decision recorded in DECISIONS.md; registry matches it; retention tests updated. |
| S117 | T-5 | S105 | OWNER, then CODE | Manual-bank unique-code hold: codes stay reserved 72 h after the order deadline (late transfers never match a newer order), capping throughput at ~225 manual-bank orders/day before `409 MANUAL_BANK_BUSY`, and abandoned guest orders hold a code for the whole window (cheaper pool exhaustion). Decide: keep, shorten the hold for never-paid orders, or widen the code range. | Decision recorded; capacity and abuse limit tested at the chosen setting. |
| S118 | T-14 | S112 | CODE (R4) | Guest order recovery by order number: `guest-order-access/challenges` accepts only the order UUID, so a buyer holding only `99-XXXX…` cannot recover access. Accept the order number with enumeration-safe responses (uniform reply, rate limit per contact and IP) and wire `/pesanan` lookup to it. | Lookup by number works; unknown/known numbers are indistinguishable; R4 review PASS. |
| S119 | T-13 | — | OWNER (IAM) | Verified support contact replacement: guests cannot rebind a verified contact (no password session; refused since the 2026-10-24 step-up fix), and signed-in users' verified contact is not stored (ARCHITECTURE Known differences #13). Decide whether to add a challenge-to-old-contact path for guests and a stored user-side binding. | Decision recorded; chosen path implemented with negative tests, or the refusal documented as final. |
| S120 | T-13 | S118 | CODE (R4) | Signed-in guest-order link challenge (`/api/v1/me/guest-order-link-challenges`) still answers 404 for an unknown order and 403 `ORDER_CONTACT_MISMATCH` for a wrong contact (S118 R4 review finding 5, pre-existing): give it the same uniform decoy behaviour as the public path. | Unknown/mismatched link requests are indistinguishable from matched ones; R4 review PASS. |
| S121 | T-16 | — | CODE | Browser suites that seed reservations (e.g. `consignment-payments` S91) fail while a LOCAL worker is running, because the worker expires the fixture's reservations on the synced business clock (observed 2026-10-24: 1 parcel instead of 2; green with the worker stopped). Make the suites own their jobs (namespace-scoped job filter in the local worker, or the runner refusing to start while a LOCAL worker holds the lease). | `test:browser -- --case=all-current` green with the LOCAL worker running. |
| S122 | T-16 | — | CODE | Follow-ups from the 2026-10-24 integration. (a) Shared test-database growth: several suites slowed to ~30 s (sitemap: 2.8 s on a fresh DB; return-http and replacement-http), so they now carry explicit budgets. Add a bounded cleanup or a periodic reset of the test DB for test-created rows. (b) Flaky runs that passed on rerun: `support-chat` claim step and the staff TOTP sign-in, once each in a full run; `consignment-payments` once after the S113 merge. (c) Admin Lows from design review round 4: AutoLaris channel hidden at 768–1279; mobile card select-all lacks indeterminate state and selected highlight; product stock card name misaligned at 390; tables without a pinned action still clip behind the fade at 768; the repeated non-adjacent "Pengiriman: Dikemas" line. (e) Admin mobile re-review PASS (2026-10-25) Lows:
  - one `OrderNumberLink` (drop the fulfillment `OrderLink`);
  - a 44px plain-text order number for gudang so the amount aligns;
  - one payment cue cell (COD badge plus amount, muted "Prabayar") in print center;
  - COD settlement status `stack: "aside"`;
  - hide catalog `p_` ids at 768/1440 (ARCHITECTURE says staff never see them);
  - "Arti setiap angka" on the shared `Disclosure`;
  - the same load-more count line in print center;
  - the orders skeleton amount slot;
  - full-width phone actions ("Simpan ketentuan", inbox tools);
  - one label/value style in order detail;
  - optionally the buyer address only in the "Catat resi" sheet, which halves the manual card. (d) Confirm that the local COD orders with `payment_status=confirmed` and `status=pending` (96) are fixture-only, because the real COD path sets `cod_due`. | (a) The suites run under 10 s on a long-lived test DB, or the reset is documented in README. (b) Each flake is root-caused or tracked. (c) The admin re-review stays PASS with the Lows fixed. (d) A query shows no such rows outside fixtures. |
| S123 | T-14 | S112 | CODE (R4 review: auth) | Buyer registration. Owner decision 2026-10-25: the goal is that buyers register, so the S112 sign-in modal stays. Add "Daftar" in the modal and on `/masuk` (per DEC-015 and the 2026-10-25 sign-up decision: name, email and WhatsApp number; the password is set through the emailed link; consent), a uniform "check your email" reply for new and existing emails (no enumeration), a verification landing, `?next=` kept through verification, and a no-JS post path. After checkout, the receipt offers guests "Simpan pesanan ini ke akun", reusing the existing guest-order link flow (S120 oracle not widened). `/akun` signed-out promotes Daftar. | Sign-up works in the modal, on the page and without JS; an existing email gets the same reply; a verified buyer signs in and links the order; browser tests pass; design gate PASS; independent security review PASS. |
| S124 | T-16 | S86 | OWNER + CODE | Production email delivery for sign-up verification, password reset and the existing-account notice. Owner decision 2026-10-25: verification by email (not WhatsApp/SMS OTP). The provider still needs choosing before go-live. Production keeps answering `NOTIFICATION_DISABLED` on sign-up and reset until the adapter, sender domain (SPF/DKIM/DMARC) and credentials are configured. | The owner picks the provider; the adapter passes a sandbox send; production sign-up and reset are enabled only after that evidence. |
| S125 | T-13 | S123,S120 | CODE (R4: privacy/IAM, migration) | Guest orders surface in the buyer's account per DEC-016. Expand-only table for pending order claims (order, account, match basis, state, decided_by, audited); claim creation at order commit on a verified-email match with no observable difference in the checkout reply; `/akun` "Pesanan menunggu konfirmasi" (summary only) with confirm/reject; admin order detail "Klaim akun" approve/reject for the WhatsApp path (CS/owner, audited); auto-confirm on sign-in in the browser holding the order access cookie; optional phone on the account profile (unverified, never auto-matched). The invoice email to the contact address uses S124 delivery (local simulated). S120's uniform decoy must land first or together. | Matching, privacy (summary only before confirmation), each confirmation path and rejection are covered by integration and browser tests; no checkout-reply difference between account and non-account emails; independent R4 review PASS; design gate PASS. |
| S126 | T-14 | S123 | CODE (migration, R4 privacy review) | Buyer profile completion per DEC-017. Expand-only `buyer_profile` (address reference, phone, birth day/month, optional year, gender enum incl. undisclosed, favourite category ids) and `marketing_consent` (channel, granted/withdrawn at, policy version, source). `/akun` "Lengkapi profil" card with progress and per-field reasons, profile edit and delete, separate WhatsApp/email promo opt-ins. The checkout prefills from the profile address. Admin gets read-only segment counts (birthday month, favourite category, opted-in channel) with no raw contact export without permission. Birthday voucher and category promos are recorded as programs; the doorprize shows "segera" only. | Fields optional and editable/deletable; consent per channel recorded and withdrawable; checkout prefill works; browser + integration tests; design gate PASS; independent privacy/R4 review PASS. |
| S127 | T-21 | — | OWNER | Doorprize/undian legal basis: obtain the Kemensos undian berhadiah permit (or choose a non-lottery format) before any doorprize entry mechanics, prize promise or draw is built or advertised. Also: birthday voucher terms (value, validity, one per year) and category promo cadence. | Permit or chosen format recorded in DECISIONS; terms recorded before S126 copy goes live. |
| S128 | T-34 | S113 | CODE (R2) | Admin console navigation IA per spec 17 "Admin console — information architecture" (2026-10-25). Sidebar groups: Ruang Kerja / Operasional / Katalog & Stok / Pemasaran / Keuangan / Pengaturan, with per-role visibility from the same grants pages enforce. An account menu (Profil, Keamanan akun, Lihat Toko, Keluar) replaces `session-bar.tsx`. Pengaturan group shell. Signed-out production requests redirect to `/masuk?next=` (the preview stays local/test). Items for unbuilt screens stay hidden until their slice merges. | A per-role browser test asserts the visible item set for all five roles and a multi-role user; signed-out production profile redirects; renders 390/768/1440; admin design review PASS. |
| S129 | T-13 | S128 | CODE (R4: auth) | Staff profile and account security (`/admin/account`, `/admin/account/security`). Read-only profile from `getCurrentUser`. Fix the `terminateOwnSessions` contract drift (OpenAPI `current|all_other` + proof vs code `others|all` without proof). Add change-password, MFA status/backup-code regeneration and a session list behind `handleAuth` with budgets. Staff cannot disable MFA. | Password change revokes other sessions; wrong current password is rate-limited; `all_other` without proof is 403; staff MFA disable is refused; OpenAPI parity passes; independent security review PASS; renders. |
| S130 | T-21 | S128 | CODE (R3) | Settings hub. Move payment terms (kind `payment`) out of `/admin/payments` and ad destinations off the owner dashboard. Add commercial policy (kind `commercial`), label template governance (`createShippingLabelTemplate`, `appendShippingLabelTemplateVersion`), and CS saved replies and tags management. Each page shows version history. | Each policy saves a new version with the owner reauth proof and lists its history; a stale version returns a conflict with the draft kept; existing orders keep their applied policy (test); renders 390/768/1440; admin review PASS. |
| S131 | T-12 | S128 | CODE (R4: money) | Finance workbench: reconciliation list/detail/decisions (`listReconciliationItems`, `getReconciliationItem`, `reconcileFinanceItem`, `getReconciliationMatch`, `getSettlementSource`); affiliate payout queue claim → evidence → verify → reconcile; refund outcomes (`getAdminRefund`, `reconcileRefundStatus`) plus a new refund list API; finance summary page over `getAdminFinanceSummary`. | Every action works in the UI with its `finance.reconcile`/`payout.*`/`finance.refund` proof; an unknown outcome is never shown as paid and offers no duplicate; missing inputs show "incomplete", never zero; OpenAPI parity; R4 review PASS; renders. |
| S132 | T-9 | S131 | CODE (R3) | Affiliates admin: affiliate list/detail API (OpenAPI + parity, no buyer PII) and a rate version UI over `setAffiliateRate`. | Owner sets a prospective rate with reauth; list and detail expose no buyer contact/address; non-permitted roles 403; renders. |
| S133 | T-22 | S128 | CODE (R4: recovery refund) | Commerce exception workbench (`/admin/exceptions`) over `listCommerceExceptions`, `getCommerceException`, `reportStockDiscrepancy`, `decideCommerceException`, `recordExceptionIntake`, `queueRecoveryRefund`, `getRecoveryRefund`, `reconcileRecoveryRefund`, `retryRecoveryRefund`; correct the stale "proposal only" OpenAPI description. | Each decision, intake and recovery-refund path works in the UI with scope checks; unknown outcomes stay unresolved without a duplicate; R4 review PASS; renders. |
| S134 | T-1 | S128,S101 | CODE (R3: cost writes) | Catalog master data: physical SKUs, HPP and offer cost-assumption versions (`createComponentCostVersion`, `createOfferCostAssumptionVersion`, `getProductContributionReview`), categories (`listCatalogCategories`, `createCatalogCategories`), warehouses list/detail with the pickup profile and the S101 calendar. | HPP writes require `finance.costs.write`; backdated versions are refused; lists respect warehouse scope; renders. |
| S135 | T-13 | S128 | CODE (R3: privacy) | Audit log viewer: read API over `app.audit_event` (OpenAPI + parity), keyset paging, filters by actor/action/object/period, redacted details. | Non-permitted roles 403; no secret, OTP or proof material in returned details (test); the read itself is audited; renders. |
| S136 | T-16 | S128 | CODE (R2) | System health page: read-only API over outbox/job registry states (due, leased, failed, dead) and the last retention runs; owner only. | Counts equal a direct SQL count in a test; non-owner 403; renders. |
| S137 | T-13 | S128 | CODE (R4: IAM) | Staff & roles (moved out of S102): staff list and user lookup API (OpenAPI + parity); replace roles/grants/warehouse scope through `grantStaffRoles` with the `staff_roles.replace` proof. | Owner lists and edits staff with reauth; non-owner 403; removing the last owner is refused; audit row written; security review PASS; renders. |
| S138 | T-13 | S128 | CODE (R4: privacy) | Buyer account lookup for CS (`/admin/customers`, spec 17 B29) per DEC-018: lookup API by phone or email (OpenAPI + parity) returning name, masked contact and order/ticket history; the full address only through the order context; every lookup audited. | CS and owner can look up; other roles 403; contacts masked and no address in the response (test); an audit row per lookup; privacy review PASS; renders 390/768/1440. |
| S139 | T-33 | S22,S107 | CODE (R2) | PDP precision pass (owner request 2026-10-25): audit the product page against the shop.com PDP structure (structural reference only; guest cart per ADR-0007 stays) and fix gallery, price/discount hierarchy, offer selector, sticky mobile buy bar, stock/shipping/COD info, sections, spacing/type rhythm, keyboard and edge states. | Gap list in `docs/spec/design/reviews/`; PDP browser cases pass; renders 390 touch/768/1440 for default, bundle, multi-offer, out-of-stock, unavailable offer and long title with 0 overflow and 0 console errors; design review PASS. Local PASS 2026-10-25 (merged): link-based offer pills, server-rendered gallery thumbnails, 24px buy-box rhythm, open Deskripsi with clamp and shipping/payment rows, related category shelf, phone buy bar; storefront-pdp 7/7, T-33 browser 20/20 + integration 24/24, PR-17 31/31, design gate PASS (`design/reviews/s139/review-r3.md`). Deferred: ratings (no data), zoom (sources ≤1080 px), recently viewed (privacy decision), ETA (no pre-checkout source). |
| S140 | T-22 | S101 | CODE (R4: resi deadlines) + OWNER | Production warehouse calendars (DEC-018 Q2): accept real, owner-approved calendar values instead of `TEST-ONLY` only — validator `src/modules/settings/policies.ts` (`valuesFor`), consumer `src/modules/fulfillment/calendar.ts`, `settings/calendars.ts`, the calendar panel and the OpenAPI `approval` enum. The owner supplies the approved holiday/working-day source. | Owner writes a production calendar with reauth; non-owner 403; resi deadlines compute from it (test); TEST-ONLY values stay refused in production; R4 review PASS. |
| S141 | T-31 | S123,S126 | CODE (R2) | Checkout floating labels (owner request 2026-10-25, Shopify checkout form pattern): each text field shows its label inside the field; on focus the label stays in place; once a value is typed (or autofilled/prefilled) the label shrinks to the top inside the field. Native `<label for>` stays the accessible name (no placeholder-only labels); CSS-first (`:placeholder-shown` with a blank placeholder, `:autofill`), no JS dependency; errors, hints and `aria-describedby` unchanged; selects/textarea get the same treatment; applies to checkout contact/address forms first, then other storefront forms using the same field component. | Label inside at rest and on focus, shrinks on input, autofill and server prefill; keyboard and screen-reader names unchanged; 200% text and 320 px without clipping; no-JS works; checkout browser cases (T-31/T-33) pass; renders 390 touch/768/1440. |
| S142 | T-31 | S123,S126 | CODE (R3 privacy) + OWNER | Post-order email capture (owner request 2026-10-25). Recommendation (pending owner confirmation): keep guest checkout without email; the WhatsApp number stays the required order contact. On the receipt page after the order is placed, offer an optional "Kirim invoice ke email" field (transactional: sends this order's invoice/receipt link only, no marketing), a separate unticked promo checkbox recorded as marketing consent per S126 rules (policy version, withdrawable), and the existing "Simpan pesanan ini ke akun" (S123/S125). Email is verified by the link it receives before any promo is sent. Production sending depends on S124 (provider). | Order placement never requires email; invoice email is opt-in and scoped to that order; promo consent is separate, unticked and audited; unverified email receives no promo; no enumeration via the receipt; renders; R3 privacy review PASS. |

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
