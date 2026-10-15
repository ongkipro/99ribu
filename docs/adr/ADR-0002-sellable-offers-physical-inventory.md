# ADR-0002: Derive sellable offer availability from physical component stock

- **Status:** Accepted
- **Date:** 2026-10-15
- **Author:** Engineering owner
- **Owner:** Engineering owner
- **Deciders:** Paduka Ongki
- **Supersedes:** None

## 1. Context
The owner confirmed each selected listing option costs IDR 99,000, whether it contains one item, a same-item multipack or a mixed bundle. Different offers may consume the same physical stock; bundles must be complete in one warehouse. Independent stock counters would permit overselling shared components.

Decision drivers: Exact selected-offer price; physical stock conservation; explicit contents; warehouse-complete availability; stable catalog identities.

Non-goals: No recursive or custom-priced bundles, cross-warehouse bundle assembly, unrequested separate component charges or marketplace inventory.

Authority: PR-1, PR-2, PR-3, DATA-1, BILL-1. Accepted scope follows existing owner-approved requirements; this ADR is not runtime verification.

## 2. Considered Options
- **Option A — Derived offer availability from shared components:** Prevents duplicated stock and represents unit/multipack/bundle offers consistently; reservation must coordinate shared component demand.
- **Option B — Independent inventory per sellable variant:** Simple for unit-only products, but the same physical component can be counted in multiple bundle/variant pools.
- **Option C — Separate charged cart lines for every component:** Simplifies component stock lookup, but changes the agreed IDR 99,000 offer into multiple charges and duplicate commissions.

## 3. Decision
Chosen option: **Listing offers backed by physical component quantities**.

Product is the listing, Variant is a selectable sellable offer, and StockItem is the physical SKU. Each offer composition references positive StockItem quantities; repeated components are aggregated before availability/reservation. Inventory is warehouse/physical-SKU/lot scoped. Derive complete-offer availability and reserve all components atomically in one warehouse. Freeze sold composition and price in order/fulfillment lineage. The accepted scope records the owner-approved model already in PR-1/PR-2; it does not approve a framework or claim an implemented schema.

## 4. Consequences
- **Positive:** One physical inventory truth; clear offer-level checkout and commission; complete bundle delivery.
- **Negative:** Availability needs composition-aware queries and multi-row reservation; returns inspect physical components while refund entitlement stays offer-level.
- **Neutral:** Canonical contracts and evidence remain in their owning documents; no implementation, provider call or deployment is established by this record.

## 5. Confirmation
TEST-1 and TEST-2 must exercise shared last-component races, multipack quantity, unavailable split component stock and IDR 99,000 totals; TEST-7/TEST-9 prove affected-offer replacement/refund lineage.

Document checks: the suite traceability checker must resolve this ADR, its canonical [decision index](../../DECISIONS.md) and Technical Design trace link. All runtime confirmation above is prospective.

## 6. More Information
Read [Product requirements](../spec/02-PRD.md), [Technical Design](../spec/03-TECHNICAL-DESIGN.md), [Architecture](../spec/04-SYSTEM-ARCHITECTURE.md), [Data Model](../spec/05-DATA-MODEL.md) and [Execution queue](../../TASKS.md).

Revisit on a changed business invariant, selected runtime/provider, demonstrated scale/ownership need, or failed confirmation scenario. Accepted ADR substance is immutable; a changed decision receives a new numbered ADR and supersession links. Proposed records may be revised until accepted. IDs are provisional until promotion/merge and must be re-scanned against the destination repository.
