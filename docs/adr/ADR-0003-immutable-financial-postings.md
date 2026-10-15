# ADR-0003: Preserve financial history with immutable postings and allocations

- **Status:** Accepted
- **Date:** 2026-10-15
- **Author:** Engineering owner
- **Owner:** Engineering owner
- **Deciders:** Paduka Ongki
- **Supersedes:** None

## 1. Context
The owner requires full related refunds, quantity-scoped affiliate commissions and initially manual transfers. Delivered COD is not received cash; eligible commission is not a paid transfer. Mutable totals or deletable payout history can hide duplicate transfers and incorrect partial returns.

Decision drivers: Money conservation; traceable correction; manual-transfer accountability; no duplicate balance ownership; settlement-independent eligibility.

Non-goals: No automated outbound transfer, consumer-wallet API assumptions, automatic success from receipt upload or accounting/tax certification.

Authority: PR-7, PR-9, PR-10, PR-12, DATA-1, BILL-1, IAM-1. Accepted scope follows existing owner-approved requirements; this ADR is not runtime verification.

## 2. Considered Options
- **Option A — Immutable postings and explicit allocations:** Supports replay protection and explanations, at the cost of explicit corrections and reconciliation.
- **Option B — Editable order/balance totals:** Quick to implement initially, but loses causal history and cannot safely allocate concurrent partial refunds or payouts.
- **Option C — Provider wallet as the sole financial truth:** Reduces local bookkeeping, but cannot represent all company liabilities, manual transfers, bundle entitlements and COD receivables.

## 3. Decision
Chosen option: **Append-only financial postings with transactional allocations**.

Persist balanced finance postings and immutable commercial/payout snapshots. Reserve eligible commission portions once when a payout is queued; default minimum is IDR 99,000 inclusive after H+10 actual buyer receipt and relevant holds. Finance claims the payout, transfers externally in the initial manual mode, and verifies matching amount/destination/bank evidence before success postings. Corrections append reversing/adjusting entries. Unknown outcomes remain reserved until reconciliation; restoring a database or editing a status cannot undo a real transfer. This records existing owner-delegated finance/data controls, not a new automated payout service.

## 4. Consequences
- **Positive:** Auditable corrections; reproducible affiliate reports; no hidden duplicate money movement.
- **Negative:** More reconciliation states and operator work; manual evidence still requires human verification and restricted access.
- **Neutral:** Canonical contracts and evidence remain in their owning documents; no implementation, provider call or deployment is established by this record.

## 5. Confirmation
TEST-7, TEST-9, TEST-10 and TEST-12 must prove conserved partial refunds, threshold examples, exclusive claims, duplicate evidence handling and safe unknown-transfer recovery.

Document checks: the suite traceability checker must resolve this ADR, its canonical [decision index](../../DECISIONS.md) and Technical Design trace link. All runtime confirmation above is prospective.

## 6. More Information
Read [Product requirements](../spec/02-PRD.md), [Technical Design](../spec/03-TECHNICAL-DESIGN.md), [Architecture](../spec/04-SYSTEM-ARCHITECTURE.md), [Data Model](../spec/05-DATA-MODEL.md) and [Execution queue](../../TASKS.md).

Revisit on a changed business invariant, selected runtime/provider, demonstrated scale/ownership need, or failed confirmation scenario. Accepted ADR substance is immutable; a changed decision receives a new numbered ADR and supersession links. Proposed records may be revised until accepted. IDs are provisional until promotion/merge and must be re-scanned against the destination repository.
