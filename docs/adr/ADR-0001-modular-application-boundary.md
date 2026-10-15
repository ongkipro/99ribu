# ADR-0001: One modular application with shared web and worker domains

- **Status:** Accepted
- **Date:** 2026-10-15
- **Author:** Engineering owner
- **Owner:** Engineering owner
- **Deciders:** Paduka Ongki
- **Supersedes:** None

## 1. Context
Catalog, stock, checkout, fulfillment, returns, affiliate and finance must enforce the same money and inventory invariants. The business is one company, not a marketplace. A web process and asynchronous work need different execution lifecycles without separate authorities. No ecommerce repository or implementation exists yet.

Decision drivers: Small-team operability; atomic stock/money boundaries; no duplicate policies across clients; safe async recovery; simple deployment.

Non-goals: No microservice fleet, marketplace/seller settlement, Redis requirement or approved queue library.

Authority: TD-1, ARCH-1, DATA-1, PR-16. Accepted under the owner’s delegated technical selection on 2026-10-15; version compatibility and runtime confirmation remain implementation gates.

## 2. Considered Options
- **Option A — Modular application with separate processes:** Shares invariants and transactions with fewer network failure modes. Module boundaries require review and can erode without discipline.
- **Option B — Independent microservices from the start:** Allows independent ownership and scaling, but introduces distributed stock/payment consistency, deployment and monitoring work without evidence of need.
- **Option C — Synchronous web-only application:** Simpler process count, but cannot make committed callback/reconciliation work depend on a buyer request staying alive.

## 3. Decision
Chosen option: **One modular application with web and worker entrypoints**.

Use one source repository with server-only domain modules and a transactional persistence boundary. Web actions/API handlers and background jobs invoke the same domain operations. Deploy web and worker as separate processes where needed; process separation does not imply microservices. This application boundary is selected under delegated technical authority; repository initialization and runtime verification remain pending.

## 4. Consequences
- **Positive:** One domain implementation; smaller initial operational footprint; future extraction can follow measured boundaries.
- **Negative:** A shared release and database couple modules; worker capacity and long jobs still need isolation and recovery.
- **Neutral:** Canonical contracts and evidence remain in their owning documents; no implementation, provider call or deployment is established by this record.

## 5. Confirmation
TEST-16 and TEST-4 must prove durable replay, concurrent checkout and shared validation; review imports so client code cannot invoke server-only provider/finance modules.

Document checks: the suite traceability checker must resolve this ADR, its canonical [decision index](../../DECISIONS.md) and Technical Design trace link. All runtime confirmation above is prospective.

## 6. More Information
Read [Product requirements](../spec/02-PRD.md), [Technical Design](../spec/03-TECHNICAL-DESIGN.md), [Architecture](../spec/04-SYSTEM-ARCHITECTURE.md), [Data Model](../spec/05-DATA-MODEL.md) and [Execution queue](../../TASKS.md).

Revisit on a changed business invariant, selected runtime/provider, demonstrated scale/ownership need, or failed confirmation scenario. Accepted ADR substance is immutable; a changed decision receives a new numbered ADR and supersession links. Proposed records may be revised until accepted. IDs are provisional until promotion/merge and must be re-scanned against the destination repository.

### Delegated technical selection — 2026-10-15
The owner instructed engineering to perfect and select the recommended stack. The recorded modular application, Next.js/TypeScript/PostgreSQL/Drizzle/Better Auth and shared versioned client boundary are selected. This does not approve native binaries, claim working authentication/providers or authorize live deployment.
