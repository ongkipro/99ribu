# Context Record

> This record captures engineering context and candidate applicability. It is not a legal, tax, privacy, security, audit, or certification conclusion.

## Document Control

| Field | Value |
|---|---|
| Owner | Paduka Ongki |
| Status | Draft |
| Reviewed | 2026-10-16 |
| Depth profile | product |
| Decision approvers | Paduka Ongki (business); engineering/design reviews pending |

## Context Facts

| ID | Dimension | Statement | Status | Confidence | Evidence | Owner | Recheck trigger | Evidence kind | Source |
|---|---|---|---|---|---|---|---|---|---|
| CTX-1 | Product | Serba 99ribu is a single-company physical-goods ecommerce business at 99ribu.com; nationwide company-owned warehouses. | Decision | High | Owner conversation through 2026-10-15; stack subsequently selected under explicit engineering delegation. | Paduka Ongki | Owner policy change or implementation gate | human-policy | Owner conversation through 2026-10-15 |
| CTX-2 | Price | Each listing has one or more sellable options/variants, each IDR 99,000 including all disclosed units/bundle components; shipping subsidy is configurable. | Decision | High | Owner conversation through 2026-10-15; stack subsequently selected under explicit engineering delegation. | Paduka Ongki | Owner policy change or implementation gate | human-policy | Owner conversation through 2026-10-15 |
| CTX-3 | Commerce | Virgo prepaid and Mengantar COD; split fulfillment; guest checkout; seven-day return requests. | Decision | High | Owner conversation through 2026-10-15; stack subsequently selected under explicit engineering delegation. | Paduka Ongki | Owner policy change or implementation gate | human-policy | Owner conversation through 2026-10-15 |
| CTX-4 | Affiliate | Automatic registration; first eligible click, seven-day cookie; default 10 percent with affiliate overrides. | Decision | High | Owner conversation through 2026-10-15; stack subsequently selected under explicit engineering delegation. | Paduka Ongki | Owner policy change or implementation gate | human-policy | Owner conversation through 2026-10-15 |
| CTX-5 | Payout | Item commission matures ten days after verified buyer receipt; replacement receipt restarts the clock; automatic eligibility/finance queue at IDR 99,000 eligible balance; manual finance transfer initially, future automation only after provider validation. | Decision | High | Owner conversation through 2026-10-15; stack subsequently selected under explicit engineering delegation. | Paduka Ongki | Owner policy change or implementation gate | human-policy | Owner conversation through 2026-10-15 |
| CTX-6 | Operations | Packing milestone means valid issued waybill by H+2 from prepaid success/confirmed COD; physical preparation and courier handover remain distinct and due next working day. Shipping H+ skips declared national/public holidays and major-holiday closures; exact cutoff and Sunday policy remain pending. | Decision | High | Owner conversation through 2026-10-15; stack subsequently selected under explicit engineering delegation. | Paduka Ongki | Owner policy change or implementation gate | human-policy | Owner conversation through 2026-10-15 |
| CTX-7 | Identity | Owner, ecommerce admin, warehouse, customer service, finance, buyer and affiliate have scoped access. | Decision | High | Owner conversation through 2026-10-15; stack subsequently selected under explicit engineering delegation. | Paduka Ongki | Owner policy change or implementation gate | human-policy | Owner conversation through 2026-10-15 |
| CTX-8 | Privacy | Checkout and payout require buyer contact/address and affiliate beneficiary information; real data is absent from this planning pack. | Decision | High | Owner conversation through 2026-10-15; stack subsequently selected under explicit engineering delegation. | Paduka Ongki | Owner policy change or implementation gate | human-policy | Owner conversation through 2026-10-15 |
| CTX-9 | Stack | Next.js App Router, TypeScript, PostgreSQL, Drizzle, Better Auth and shadcn/ui are selected under the owner’s delegated technical recommendation. | Decision | High | Owner delegated stack selection on 2026-10-15. | Paduka Ongki | Owner policy change or implementation gate | human-policy | Owner delegated selection; ADR-0004; SRC-NEXT-APP, SRC-NEXT-HOST, SRC-DRIZZLE, SRC-BETTER-AUTH |
| CTX-10 | Runtime | Vultr + Coolify is owner-confirmed; processing, backup/support locations, future automated payout provider and provider API contracts are unresolved; manual finance transfer is the accepted initial mode. | Unknown | Unknown | Owner conversation through 2026-10-15; stack subsequently selected under explicit engineering delegation. | Paduka Ongki | Owner policy change or implementation gate | none | No account-issued API/runtime evidence supplied |
| CTX-11 | UI | Buyer storefront, staff admin and affiliate portal require durable responsive interaction contracts. | Decision | High | Owner conversation through 2026-10-15; stack subsequently selected under explicit engineering delegation. | Paduka Ongki | Owner policy change or implementation gate | human-policy | Owner conversation through 2026-10-15 |
| CTX-12 | Scope | No marketplace sellers, supplier settlement or multi-tenancy; proposed initial exclusions include preorder and cross-border checkout. | Proposal | Medium | Owner conversation through 2026-10-15; stack subsequently selected under explicit engineering delegation. | Paduka Ongki | Owner policy change or implementation gate | inference | Owner single-company scope; initial release recommendation |
| CTX-13 | Brand | Purple #5B35D5 with warm yellow #F6C945 accents, white #FFFFFF and charcoal #18181B accepted as brand palette; public storefront is multi-category. | Decision | High | Owner explicitly accepted recommendation and clarified many-category retail | Paduka Ongki | Owner identity or scope change | human-policy | Owner conversation 2026-10-15 |
| CTX-14 | Clients and API | Distinct mobile web-app/WebView shopping composition alongside desktop; shared backend; future Android/iOS clients; first-party OpenAPI requested now. | Decision | High | Owner explicitly requests mobile-specific experience and OpenAPI | Paduka Ongki | Client/channel scope changes | human-policy | Owner conversation 2026-10-15 |

## Additional owner-approved operational defaults
Owner approval: final discussion instruction to continue and perfect the proposed development-kit documents. These defaults are incorporated through PR-6, PR-8 and BILL-1: no self-purchase commissions; company pays affiliate transfer charges; handover by the next working day after packing; initial return review within two working days after complete evidence; no direct payment surcharge; cancellation before handover; clean fixed-price display by default. Provider prerequisites and exact timing remain open questions. Half-up commission rounding and largest-remainder refund allocation were subsequently adopted as documented defaults in BILL-1; implementation conservation checks remain required.

Claim statuses are separate from requirement lifecycle. Decision rows are human policy reported in this conversation, not verified vendor/runtime facts. CTX-9 was originally a proposal after the framework question; the subsequent explicit delegation of technical selection accepts ADR-0004. Pinning versions and runtime checks remain unexecuted.

## Hosting and visual steering — 2026-10-15
Owner initially suggested Vultr + Coolify + Cloudflare and asked for UI/UX direction. On 2026-10-15 the owner explicitly confirmed Vultr + Coolify as the hosting decision (ADR-0005). Cloudflare integration details and final visual acceptance remain separate gates. Singapore was subsequently confirmed as the primary compute region. The initial Vultr High Performance AMD 4 vCPU/8 GB/180 GB NVMe plan was subsequently accepted after the provider comparison. Provisioning has not been executed.

## Overlay and Capability Decisions

| ID | Capability/overlay | Status | Trigger facts | Selected artifacts | Owner | Reason | Review gate |
|---|---|---|---|---|---|---|---|
| OVR-1 | commerce | Active | CTX-3 | commerce, privacy, security | Engineering owner | Payments refunds commissions | Before implementation |
| OVR-2 | data-analytics | Active | CTX-5 | data-model, observability, privacy | Engineering owner | Commission and financial reporting | Before implementation |
| OVR-3 | external-integration | Active | CTX-3 | architecture, technical-design | Engineering owner | Payment and shipping boundaries | Before implementation |
| OVR-4 | identity | Active | CTX-7 | iam, security | Engineering owner | Role-scoped human access | Before implementation |
| OVR-5 | maintained-deployment | Active | CTX-11 | delivery | Engineering owner | Maintained application | Before implementation |
| OVR-6 | persistence | Active | CTX-3 | data-model | Engineering owner | Transactional state | Before implementation |
| OVR-7 | personal-data | Active | CTX-8 | privacy, security | Engineering owner | Buyer and affiliate data | Before implementation |
| OVR-8 | product-ui | Active | CTX-11 | localized-ui, ux-flows | Engineering owner | Maintained multi-screen experiences | Before implementation |
| OVR-9 | production-service | Active | CTX-11 | observability | Engineering owner | Operator recovery and alerts | Before implementation |
| OVR-10 | mobile-desktop | Active | CTX-14 | technical-design, localized-ui, ux-flows | Engineering owner | Distinct mobile and desktop presentation | Before UI implementation |
| OVR-11 | public-api | Active | CTX-14 | architecture, public-api, security, observability | Engineering owner | First-party API for independent clients | Before client/API implementation |

## Artifact Selection

| Artifact | Decision | Reason | Owner | Review gate |
|---|---|---|---|---|
| brd | Not applicable for current evidence | No active trigger | Paduka Ongki | Activate when the document-map trigger is observed |
| prd | Selected | required baseline for product profile | Paduka Ongki | Re-run selection when context changes |
| technical-design | Selected | active capability/overlay: external-integration | Paduka Ongki | Re-run selection when context changes |
| architecture | Selected | active capability/overlay: external-integration | Paduka Ongki | Re-run selection when context changes |
| data-model | Selected | active capability/overlay: persistence; active capability/overlay: data-analytics | Paduka Ongki | Re-run selection when context changes |
| multi-tenant | Not applicable for current evidence | No active trigger | Paduka Ongki | Activate when the document-map trigger is observed |
| iam | Selected | active capability/overlay: identity | Paduka Ongki | Re-run selection when context changes |
| custom-domain | Not applicable for current evidence | No active trigger | Paduka Ongki | Activate when the document-map trigger is observed |
| public-api | Selected | CTX-14 independent future clients and requested machine-readable contract | Engineering owner | Before API implementation and client release |
| localized-ui | Selected | active capability/overlay: product-ui | Paduka Ongki | Re-run selection when context changes |
| commerce | Selected | active capability/overlay: commerce | Paduka Ongki | Re-run selection when context changes |
| security | Selected | active capability/overlay: identity; active capability/overlay: commerce; active capability/overlay: personal-data | Paduka Ongki | Re-run selection when context changes |
| privacy | Selected | active capability/overlay: commerce; active capability/overlay: personal-data; active capability/overlay: data-analytics | Paduka Ongki | Re-run selection when context changes |
| high-availability | Not applicable for current evidence | No active trigger | Paduka Ongki | Activate when the document-map trigger is observed |
| delivery | Selected | active capability/overlay: maintained-deployment | Paduka Ongki | Re-run selection when context changes |
| observability | Selected | active capability/overlay: production-service; active capability/overlay: data-analytics | Paduka Ongki | Re-run selection when context changes |
| ux-flows | Selected | active capability/overlay: product-ui | Paduka Ongki | Re-run selection when context changes |

## Jurisdiction Decisions

| ID | Territory | Trigger facts | Authority/source | Source status | Publication date | Effective date | Retrieved date | Decision | Qualified owner | Engineering impact | Next review |
|---|---|---|---|---|---|---|---|---|---|---|---|
| JUR-0 | Indonesia candidate | CTX-1, CTX-8 | Current official authority review pending | unknown | Unknown | Unknown | Unknown | Unknown | Privacy owner | PRIV-1, SEC-1 | Before launch or processor/entity change |

## Sector Decisions

| ID | Sector | Trigger facts | Decision | Qualified owner | Official source/status | Next review |
|---|---|---|---|---|---|---|
| JUR-SECTOR-0 | Ecommerce candidate | CTX-3 | Unknown | Privacy owner | Official applicability review pending; status=unknown | Before launch or product category change |

## Cross-Border Transfer Records

| ID | Trigger facts | Exporter role/location | Importer role/location | Data subjects/categories | Purpose | Storage/remote access | Mechanism review | Safeguards | Onward transfers | Retention/deletion | Evidence | Owner | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| XFER-0 | CTX-8, CTX-10 | Company role/location pending | Provider roles/locations pending | Buyer/staff/affiliate data | Fulfillment, payment, notifications, operations | Unknown | Not assessed | Pending vendor review | Unknown | PRIV-1 decision pending | No processor contracts supplied | Privacy owner | Unknown |

## Locale Contracts

| ID | Locale | Fallback | Regional rules | Accessibility | Test evidence | Owner | Status |
|---|---|---|---|---|---|---|---|
| LOC-0 | id-ID proposed | English technical fallback proposed | IDR; display Asia/Jakarta, preserve warehouse calendar zones; UTC timestamps | NFR-2 proposal | TEST-17 | Design owner | Proposal |

## Approval Gate

- [ ] Repository and runtime facts are verified.
- [ ] Unknowns have an owner and a concrete recheck trigger.
- [ ] Active overlays have non-unknown triggering `CTX-*` facts.
- [ ] Jurisdiction and sector candidates have qualified review.
- [ ] Transfer and locale records have downstream requirements and tests.
- [ ] Selected and omitted artifacts have been reviewed.

## Owner amendments and delegated defaults — 2026-10-15
Decision: catalog option contents may be single-item, multipack or mixed bundle at one IDR 99,000 price. A listing can expose multiple options each at that price. Accepted delegated recommendations: internal department/category/subcategory tree mapped separately to Google taxonomy; warehouse-complete bundles; contribution-margin review; recovery rules; versioned prospective configuration; deterministic half-up money rounding and conserved partial-refund allocation. Decision: payout minimum is IDR 99,000 inclusive and transfers are manual initially; no recurring payout calendar. Decision: packing milestone is valid waybill issuance, not courier handover or buyer receipt. These amendments supersede conflicting earlier payout/packing wording. Provider capabilities, exact H+2 cutoff, tax and margin limits remain owned gates. Sources: latest owner instruction; PR-1, PR-6, PR-10, PR-19, PR-20, PR-21.

## Continuous commerce and admin governance — owner direction 2026-10-15
Decision: accept orders 24 hours a day, every day, including public holidays and major holidays. Shipping processing uses its own versioned calendar and excludes holidays; this is not a 100-percent uptime guarantee or round-the-clock warehouse staffing promise. Sunday handling and exact cutoff remain owned timing questions. Receipt-based return/referral/maturity windows are not extended by shipping closures.

Decision: engineering selects the recommended stack and existing product-first visual direction under delegated authority. Owner is displayed as Super Admin in the same role-scoped administration application, not as a second system or a new incompatible role value. HPP, stock and commercial inputs are administered; order history and finance reporting are visible company-wide to owner. Profits are calculated from immutable transaction/cost evidence; changing current settings cannot silently rewrite history. Virgo/Mengantar adapters use local provider documentation where present, with missing Virgo merchant documentation supplied by the owner later.

### CTX-15 — Website-native support conversations
- Owner: Paduka Ongki
- Status: Decision
- Evidence kind: human-policy
- Source: Owner clarification 2026-10-15: ecommerce/marketplace-style chat inside the website, distinct from WhatsApp.
- Statement: Native buyer/guest-to-CS conversations belong to the storefront and role-scoped staff inbox, with owner oversight; PR-22 owns behavior. Engineering recommends durable private messaging, safe attachments and verified order context.
- Recheck trigger: Channel, staffing, guest identity, retention or third-party processor changes.

## Typography and shared component amendment — 2026-10-16
Decision: Paduka Ongki instructed implementation of the reviewed design recommendations in the 99ribu Markdown pack. Inter variable is selected as the primary family across storefront/chat/admin/affiliate, with platform system sans as fallback, superseding the earlier system-only selection. The Design System owns type sizes/weights, spacing, shape/elevation, table density and component states. CTX-13 purple/warm-yellow palette remains unchanged; source Mengantar colors are excluded. Official Inter family/license and Next font guidance were inspected; exact asset revision, implementation and rendered font/fallback evidence remain pending.

### CTX-16 — Advertising signals and post-checkout experience
- Owner: Paduka Ongki
- Status: Decision
- Evidence kind: human-policy
- Source: Owner instructions 2026-10-16: complete Meta, Google and TikTok tracking, Shopify/Tokophi-inspired checkout, responsive mobile/tablet/desktop and researched thank-you page in the Markdown pack.
- Statement: Engineering shall specify consent-aware cross-platform signals and an authoritative post-checkout experience. PR-23 owns measurement; PR-24 owns thank-you/order-status behavior. This authorizes document updates, not account configuration, campaign spend, credentials or production activation.
- Recheck trigger: Conversion semantics, provider capability, consent policy or buyer workflow changes.


Mobile refinement decision — 2026-10-16: under the existing CTX-14 mobile requirement, Paduka Ongki requested improvement of mobile UX as a web-app in the Markdown pack. Engineering selected the refined UX-4 behavior and MW1–MW7 composition, preserving shared backend, Inter/purple, guest checkout and independent commerce states. Install/PWA/native/push/offline transactions are not implied. T-33 provides the implementation/acceptance boundary; no rendered 99ribu result exists.

### CTX-17 — Indonesia operations, buyer accounts and 99ribu shipping labels
- Owner: Paduka Ongki
- Status: Decision
- Evidence kind: human-policy
- Source: Owner instruction 2026-10-16: complete recommended dashboard/buyer requirements using existing cases/research, focus Indonesia, and use 99ribu branded/masked waybill labels despite Mengantar fulfillment.
- Statement: Refine existing role-scoped admin and buyer contracts for Indonesia. Require 99ribu identity on shipping documents while preserving actual carrier operational data; PR-25 owns label behavior. Custom/masked provider template availability is Unknown until verified per carrier/account. No credential/live access is authorized by this document work.
- Recheck trigger: Carrier template permission, provider/account capability, contact verification or fulfillment process changes.

### CTX-18 — Localhost is the current delivery target
- Owner: Paduka Ongki
- Status: Decision
- Evidence kind: human-policy
- Source: Owner clarification 2026-10-16: production intent means localhost first; continue perfecting development preparation.
- Statement: The current milestone is a complete locally runnable and testable commerce application using real local persistence/auth/domain behavior with synthetic fixtures and simulated external adapters. Remote hosting, live merchant/advertising configuration, real shipments/money, production release and credentials are outside this milestone. This update completes planning/contract/fixture preparation; it does not initialize an application repository or claim runtime delivery.
- Recheck trigger: Explicit application implementation scope, external sandbox/provider access or production deployment request.
