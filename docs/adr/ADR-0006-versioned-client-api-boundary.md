# ADR-0006: One versioned business API for independent clients

- **Status:** Accepted
- **Date:** 2026-10-15
- **Author:** Engineering owner
- **Owner:** Engineering owner
- **Deciders:** Paduka Ongki
- **Supersedes:** None

## 1. Context
The owner accepted distinct mobile web-app/WebView and desktop shopping experiences plus a future Android/iOS API foundation. Screen composition must differ without duplicating stock, order, affiliate or finance rules. Independent clients cannot be assumed to upgrade with every server deploy.

Decision drivers: Shared business authority; stable sellable identity; explicit client compatibility; future-native readiness; no fake credential continuity.

Non-goals: No Android/iOS binary, native auth implementation, offline checkout, PWA requirement, public production API hostname or ready WebView bridge.

Authority: PR-17, PR-18, API-1, IAM-1, SEC-1. Accepted under the owner’s delegated technical selection on 2026-10-15; version compatibility and runtime confirmation remain implementation gates.

## 2. Considered Options
- **Option A — One domain with a versioned independent-client API:** Keeps money/stock behavior consistent while allowing distinct screens; compatibility and authorization parity need durable tests.
- **Option B — Separate mobile and desktop commerce backends:** Allows independent implementation, but duplicates rules and creates contradictory stock/payout behavior.
- **Option C — Expose current web actions directly as a native protocol:** Avoids a separate contract at first, but ties independently deployed clients to web-internal transport and authentication assumptions.

## 3. Decision
Chosen option: **Versioned first-party API over shared server domain operations**.

Maintain openapi.yaml as the single machine-readable HTTP contract. Independent clients use authorized versioned operations backed by the same domain services as web rendering/actions. Server-rendered web code may call domain operations directly instead of internal HTTP. Desktop/mobile layouts remain separate presentation modules. Native issuance/refresh/revocation, WebView session boundaries, approved deep links and provider return protocols are still design gates; app resume is never payment/receipt proof.

## 4. Consequences
- **Positive:** One commerce authority; explicit API coverage and future-client change management.
- **Negative:** More schema/version discipline, negative authorization checks and handoff recovery requirements.
- **Neutral:** Canonical contracts and evidence remain in their owning documents; no implementation, provider call or deployment is established by this record.

## 5. Confirmation
TEST-18 validates the draft, while future handler parity/role/resource tests and TEST-17 rendered journeys prove actual implementation; do not treat lint as provider or native readiness.

Document checks: the suite traceability checker must resolve this ADR, its canonical [decision index](../../DECISIONS.md) and Technical Design trace link. All runtime confirmation above is prospective.

## 6. More Information
Read [Product requirements](../spec/02-PRD.md), [Technical Design](../spec/03-TECHNICAL-DESIGN.md), [Architecture](../spec/04-SYSTEM-ARCHITECTURE.md), [Data Model](../spec/05-DATA-MODEL.md) and [Execution queue](../../TASKS.md).

Revisit on a changed business invariant, selected runtime/provider, demonstrated scale/ownership need, or failed confirmation scenario. Accepted ADR substance is immutable; a changed decision receives a new numbered ADR and supersession links. Proposed records may be revised until accepted. IDs are provisional until promotion/merge and must be re-scanned against the destination repository.

### Delegated technical selection — 2026-10-15
The owner instructed engineering to perfect and select the recommended stack. The recorded modular application, Next.js/TypeScript/PostgreSQL/Drizzle/Better Auth and shared versioned client boundary are selected. This does not approve native binaries, claim working authentication/providers or authorize live deployment.
