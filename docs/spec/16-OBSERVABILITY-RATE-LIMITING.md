# Observability and Recovery

Status: Accepted contract — implementation and acceptance state is owned by root [STATUS.md](../../STATUS.md); external gates remain open.

Owner: Paduka Ongki. Updated: 2026-10-21.

### OBS-1 — Actionable operational evidence
- Status: Accepted
- Owner: Engineering owner
- Source: CTX-11
- Statement: Expose overdue fulfillment, integration failures, return backlog and payout ambiguity through redacted events and recoverable queues.
- Acceptance: Inject a failed provider operation and worker restart; operator can identify the target, reason and safe next action without secret or customer-data logs.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

## Operator decisions and signals
| Decision | Signal | Recovery |
|---|---|---|
| Which orders need action? | Valid-waybill issuance or handover overdue, warehouse and original deadline | Assign operator, record reason and notify buyer |
| Is COD cash missing? | Verified customer COD collection unmatched to company settlement; delivered-without-collection-proof is a separate exception | Reconcile provider report; preserve receivable |
| Why is commission held? | Item state, active claim, verified receipt and eligibility anchor | Resolve underlying case; no silent maturity override |
| Was transfer paid? | Manual finance queue/claim/unknown age, evidence verification status and safe transaction reference | Reconcile bank evidence; never blind retransfer or unlock a possibly sent transfer |
| Are stocks/sync stale? | Reservation conflicts, sync age/error, feed validation | Reconcile and retry scoped job |
| Is budget exceeded? | Reserved/spent subsidy vs configured limit | Stop new eligibility at cap; preserve accepted orders |

Structured records include event name, safe actor role, internal order/shipment/job/payout identifiers, timestamp, operation identity and outcome. Exclude address, phone, bank number, raw callbacks and credential-bearing URLs. Business audit and finance postings are durable records; logs are not money truth.

Rate-limit signup, referral intake, guest lookup, checkout mutation and uploads with separate operator recovery. Numeric limits and latency/availability targets are Proposal until load/hosting evidence exists. Alerts require an assigned responder and a safe replay/reconciliation procedure.

## API/client compatibility observability
Track safe client mode/version, operationId, internal operation identity, rate-limit and recovery outcomes without tokens or buyer fields. Differentiate external handoff cancelled, pending confirmation, lost session and unknown financial outcome. Log deprecation/unsupported client patterns only under approved retention. UI mode cannot bypass checkout throttles or permission checks.

Manual eligibility queue age and processing/unknown holds are separate operational signals; no bank transfer is scheduled automatically. PR-19 reports estimated versus realized contribution and missing cost inputs. PR-20 records policy version/effective time/actor without logging protected values. PR-21 exceptions name affected shipment/offer quantities, cause, next action and safe recovery owner. Tracking issuance is not a delivery/received-cash event.


## Event contract and privacy boundary
Status: Proposal; OBS-1 supports PR-16 and NFR-1 without replacing their durable state.

Each operational event carries a stable event name/schema version, occurrence/observation timestamps, environment, release version, internal operation/job identity, correlation/causation IDs, safe resource IDs, outcome/reason code and retry classification. Actor fields contain an internal identifier and role only when needed for authorized incident review. Avoid embedding free-text provider responses. Parent-order → shipment → purchased offer quantity → return/replacement → commission → payout linkage belongs in access-controlled durable records; diagnostic IDs support lookup without copying those records into logs.

Request IDs and job IDs help trace work but do not establish idempotency. Deduplication and financial-effect uniqueness are database contracts. Log a safe operation identity, never the raw Idempotency-Key, guest capability, referral cookie, bearer token, session cookie, bank account, proof URL, signed object URL, raw callback body, address, phone or email. Route templates/operationId are safe telemetry labels; arbitrary URLs and resource IDs are not metric labels. Suppress sensitive responses and browser analytics on private finance/evidence and guest-access flows.

Separate operational telemetry, security/access audit, commercial-policy audit and finance ledger by purpose and access. Logs cannot prove a transfer succeeded or replace immutable ledger corrections. Retention/deletion and processor/transfer decisions remain owned by [13-COMPLIANCE-PRIVACY.md](13-COMPLIANCE-PRIVACY.md); numeric durations are Unknown until accepted. Audit redaction with synthetic sensitive markers and verify restricted proof access in tests, including failed requests and exception paths.

## Minimal signals and ownership
Status: Proposal. Begin with actionable counters, queue-state counts and age distributions; avoid a large monitoring stack before the runtime exists.

| Signal | Meaning / measurement | Primary responder and first safe action |
|---|---|---|
| Callback acceptance, duplicates, rejected verification and processing lag | Durable accepted event to completed owned transition; signing/verification failure is separate from a transient worker error | Engineering: identify issuer/environment and safe event ID; inspect adapter verification and queue state without dumping payloads |
| Expired reservation with payment pending/confirmed | Potential stock/cash mismatch; late cash is a reconciliation case | Finance + operations: check authoritative payment/stock state and hold affected fulfillment |
| Reservation conflict, component-stock deficit and subsidy reservation mismatch | Transactional invariant risk; conflicts alone can be normal contention | Operations + engineering: reconcile affected warehouse/offer and pause only unsafe allocation scope |
| Valid-waybill overdue and separate handover overdue | Compare immutable purchase/waybill/handover timestamps against the effective policy snapshot | Warehouse: inspect booking outcome and courier evidence before requesting another label |
| Return/replacement backlog and maturity holds | Age by case state and quantity lineage; original/replacement receipt anchors stay distinct | Customer service: resolve missing evidence or replacement; affiliate explanation follows the actual hold |
| COD receivable vs settlement mismatch | Delivery evidence is distinct from money received | Finance: match provider report/settlement reference and preserve unsettled receivable |
| Eligible queue age, active-claim age, unknown transfers and proof verification backlog | Separate unpaid backlog from possibly-sent money; queue creation never means bank execution | Finance: reconcile frozen beneficiary/amount and bank evidence before any reassignment or retry |
| Failed/retrying jobs and oldest recoverable operation | Bounded retry exhaustion versus unknown external effect | Engineering: inspect safe operation identity; reconcile unknown outcomes before replay |
| Policy version, estimated/realized contribution and missing costs | Explain the terms and cost evidence for the transaction | Authorized admin/finance: fix missing cost data or policy prospectively; do not rewrite existing order terms |

Assignments are role proposals; named responders, coverage hours and escalation contacts must be accepted before release. No alert should be enabled without an owner, next action and duplicate/noise suppression. H+2 waybill, seven-day return and H+10 commission are business clocks, not invented incident response objectives. Numeric alert thresholds, availability/latency targets and rate limits need observed workload and owner acceptance; no externally promised SLA exists in this pack.

## Recovery runbooks and replay safety
Status: Proposal. Implement under T-16 and T-22, with money actions constrained by T-10 and T-12 and scope enforced by T-13.

| Situation | Required next action | Stop condition |
|---|---|---|
| Payment received after stock reservation expired | Finance verifies original payment attempt and current stock state; operations presents a permitted resolution or refund using PR-21 | Do not revive an expired reservation, substitute silently or ask for another payment while the original outcome is unknown |
| Shipment creation timed out | Query/reconcile the original provider operation using issued contract capabilities; attach only the verified existing waybill | No replacement booking while the original outcome could already have created a shipment |
| Worker restarted after external effect | Load durable operation/outbox state and reconcile using the same logical identity; append missing owned effects atomically | No new provider identity or manual status edit to force progress |
| Manual finance claim expired or operator disconnected | Preserve reserved balance and frozen transfer details; authorized finance reviews possible bank execution and private proof before resolving/reassigning | No automatic unlock, second transfer or success mark without verified evidence |
| Refund or payout outcome unknown | Keep the obligation/hold visible and reconcile the original operation or bank reference; expose truthful buyer/affiliate status | No blind resend, duplicate ledger posting or unsupported provider-success assumption |
| Stock shortage or one parcel fails | Scope resolution to the affected purchased quantity/shipment and reconcile reservations, buyer totals and commission lineage | No order-wide completion/refund if unaffected parcels or quantities have different outcomes |
| Backup restore or incompatible release | Pause affected jobs, identify latest durable/external operation state and follow delivery recovery plan before resuming | No database rewind used as a substitute for money/shipment reconciliation |

Every manual recovery records authorized actor, reason, version, evidence reference, operation identity and before/after business state in the relevant durable audit. Replay requires role/object permission, original request identity, expected current state, bounded attempts and an audited result. Permission to inspect telemetry does not confer permission to replay or send money. Recovery interfaces still need detailed screen/API contracts where absent; this document does not invent a generic force-success action.

## Rate-limit and failure-response contract
Status: Proposal; final values and implementation depend on accepted auth/runtime contracts.

Use separate limits for public browsing, guest capability requests, authentication/signup, referral intake, checkout/quote mutations, private uploads, and staff recovery actions. Keys combine reviewed actor/resource scope with coarse network abuse signals; shared household/mobile-network IPs must not alone lock out valid buyers. Do not use client UI mode or an unauthenticated claimed role to bypass a limit. A limit response states safe retry/recovery behavior without exposing account existence or private balance.

Provider callbacks require verified issuer handling and bounded ingress/backpressure appropriate to the issued contract; apply deduplication after trusted identity validation and do not accidentally discard legitimate provider retries. Public checkout throttling and internal worker retry budgets are separate controls. Upload limits include size/type/resource scope and do not replace private access/scanning. Observability for limits records safe route class, outcome and aggregate counts; tokens, raw bodies and customer identifiers are excluded. Operational overrides, if accepted, require authorization, expiry and audit rather than a permanent bypass.

## Verification and evidence handoff
Status: Proposal; no telemetry pipeline, alert, incident or recovery test has executed for commerce.

T-16 acceptance must inject duplicate/out-of-order events, bounded retry exhaustion and restart around a durable effect; demonstrate an operator can locate the safe operation and choose reconciliation/replay without reading raw buyer/bank data. T-10 covers claim contention, unknown transfer hold and deduplicated verification; T-22 covers late payment, ambiguous waybill, mixed outcomes and replacement-stock failure. T-13 verifies unauthorized telemetry/resource access cannot expose private evidence or enable recovery. The release rehearsal in [15-DEVOPS-CICD-MIGRATIONS.md](15-DEVOPS-CICD-MIGRATIONS.md) must capture redacted alert/runbook results and a restore reconciliation check.

Record scenario, environment, release/contract version, safe IDs, observed state, responder action, invariant result and remaining limitations. Separate mock-driven tests, issued-provider sandbox proof, browser screenshots and production read-only observations. A passing structural OpenAPI checker or working coming-soon page is not operational evidence for these commerce controls.

## Continuous-order and admin-data signals
Observe order-intake availability every day, with synthetic non-purchasing checks and real request/error/latency aggregates; monitor payment/quote dependency health separately. Track accepted-but-unprocessed outbox age, worker catch-up, backup age/failed restore and calendar-version/due-date exceptions. Holiday closures do not disable storefront/worker health alerts. Numeric SLO and escalation coverage remain release selections.

Finance dashboards show as-of freshness, incomplete-cost counts, reconciliation exceptions, funding holds and audit-linked correction counts. Orders, cash, net merchandise revenue, contribution and operating result remain separate measures. Do not export raw bank proof, payment credentials or buyer address in telemetry.

## Native support-chat signals
Measure durable-send failures/latency, acknowledgement/retry duplicates, stream disconnect/replay lag, unassigned backlog age, pending customer/staff response, claim conflicts, rejected attachments and anonymous rate-limit pressure. Show configured staffed-hours context when measuring staff response; 24/7 intake is not a 24/7 staff SLA. Alerts carry safe conversation references only, never message text, protected images, contact details or guest capability. Monitor public/staff event authorization separately and test session revocation under connected streams.

## Advertising signal reconciliation and receipt diagnostics
OBS-1 decision: monitor captured eligible/suppressed events, unique money postings, allocated merchandise, queued/oldest age, attempts, accepted/processed/rejected/unknown/quarantined and consent cancellations per platform/source/version. Separate HTTP acceptance from processing, matching and attributed conversions. No attributed-total equality guarantee: privacy, ad blockers, windows and platform models differ. Count distinct paid orders and purchase instances separately for split COD. Internal gross/net revenue and refund truth remain authoritative.

Alert on worker backlog, repeated permanent rejection, destination misconfiguration, missing dispatch for eligible postings and duplicate/overlapping allocation. Numerical alert thresholds are [TBD owner=Engineering owner; due=before advertising activation]. Log only safe event/correlation/config IDs and categories; never raw contact/click values, payloads, private URL or full receipt. Thank-you metrics cover pending-to-confirmed refresh, state-read failures, verified recovery and payment retry outcome without PII. Declined consent is a normal suppression reason, not an incident. Diagnostic/replay reads are bounded/rate limited and audited.

## Indonesia operational queues and print observability
OBS-1: distinguish actionable deadline breach, provider generation failure, printer outcome unknown, delivery exception and financial mismatch. Track eligible parcels lacking issued AWB, valid AWB lacking label artifact, label job age/failure, superseded-artifact attempts, scoped reprints and unmatched COD collection/remittance; none becomes Purchase or handover from a print event. Rate-limit by verified provider/account contract rather than hardcoded local quota. Use safe parcel/job/batch/actor IDs, outcome and permission audit; never raw address/phone/PDF/signed URL in telemetry. Account challenges and export/download access receive bounded rate/audit monitoring with generic failure to buyers.
