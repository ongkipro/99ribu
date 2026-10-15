# Serba 99ribu — Future Android and iOS Handoff

Status: Future planning reference; native implementation is not started.

Accountable owner: Paduka Ongki. Updated: 2026-10-15.

## Purpose and authority

Preserve the intended path from the dedicated mobile web shopping experience to future Android and iOS applications. This document is an orientation and readiness guide, not a second PRD, architecture specification, API contract or execution queue.

The owner has requested a distinct mobile web-app/WebView experience alongside desktop, plus an OpenAPI foundation for future apps. The native technology, app identifiers, distribution accounts, native capabilities and release date have not been selected. No application binary, wrapper, native bridge or app-store submission exists.

| Concern | Canonical source |
|---|---|
| Accepted client scope and brand decisions | [Context record](CONTEXT-RECORD.md), CTX-13 and CTX-14 |
| Business requirements and acceptance | [PRD](02-PRD.md), especially PR-17 and PR-18 |
| Mobile navigation, screens and recovery | [UX contracts](17-UX-FLOWS-SCREEN-CONTRACTS.md), UX-4 |
| Brand and composition | [Design system](10-DESIGN-SYSTEM-WHITELABEL.md) |
| Client/backend boundary | [Architecture](04-SYSTEM-ARCHITECTURE.md) and [Technical design](03-TECHNICAL-DESIGN.md) |
| First-party HTTP contract and known gaps | [API specification](09-API-SPECIFICATION.md) and [OpenAPI YAML](openapi.yaml) |
| Authentication and permissions | [IAM](07-IAM-RBAC-ABAC.md) |
| Money, returns and affiliate liabilities | [Financial contract](11-BILLING-PAYMENTS.md) |
| Threat controls and personal data | [Security](12-SECURITY-ARCHITECTURE.md) and [Privacy](13-COMPLIANCE-PRIVACY.md) |
| Implementation work | [Root execution queue](../../TASKS.md) |

Once the pack is promoted into a project repository, repository copies become canonical. Do not update a retained staging snapshot as if it were current implementation truth.

## Product direction to preserve

- Serba 99ribu is a single-company, multi-category physical-goods retailer. Mobile discovery must cover the broad catalog, not one niche.
- Mobile and desktop have distinct compositions over the same authoritative catalog, inventory, orders, fulfillment, returns and finance domain.
- The accepted purple/yellow/white/charcoal identity is owned by the design contract. Native navigation conventions may differ between operating systems without changing the brand or business rules.
- Guest shopping, split warehouse delivery, prepaid/COD clarity, return recovery and affiliate explanations remain core journeys.
- Native clients do not calculate authoritative prices, shipping charges, stock allocations, commission maturity or financial outcomes.
- A native app is not inherently a WebView wrapper. A WebView-ready mobile experience does not establish that authentication, payment or app distribution will work in a wrapper.
- Responsive behavior remains necessary within mobile mode for screen sizes, rotation, keyboard, text enlargement and accessibility; it does not replace dedicated mobile composition.

## Current foundation and its limits

The planning pack contains mobile screen contracts and a draft first-party OpenAPI. The OpenAPI has been structurally validated and independently reviewed in a bounded scope; it describes proposed interfaces, not existing deployed handlers.

No Serba 99ribu prototype, production checkout, native authentication lifecycle or provider integration has been verified. The application stack/modular/API direction and Vultr/Coolify Singapore initial plan are selected in the canonical ADRs. Cloudflare routing details, native authentication and implementation remain separate gates. Reinspect repository implementation and current vendor documentation when this work begins.

## Client strategy decision before native work

Compare these approaches against the accepted mobile prototype, operational capacity, verified provider restrictions and actual device needs. Record the chosen approach in the existing architecture/decision artifacts before coding.

| Approach | Potential fit | Evidence required before selection |
|---|---|---|
| Mobile web inside a native shell | Reuse accepted shopping composition where host integrations are limited | Real login/payment handoff, cookies, links, uploads, navigation, accessibility and current store acceptance requirements |
| Cross-platform native client | Shared client implementation with native navigation and selected device integrations | Platform support, maintainability, accessible controls, provider compatibility, build/release capacity and secure storage |
| Separate platform-native clients | Deep operating-system integration justified by specific user jobs | Evidence that benefits justify two client implementations and their ongoing maintenance |

No framework/package is selected here. Do not install a native toolchain solely because this reference exists. Do not assume store acceptance for a thin wrapper or assume a web implementation can be mechanically converted into a native one.

## Proposed shopping journey

Use UX-4 as the behavioral owner. The current proposed mobile destinations are Home, Categories, Cart and Account, with Search readily available and Orders/Affiliate accessible from Account. Reevaluate operating-system conventions in the native design review rather than imposing identical controls everywhere.

The future app must preserve these logical journeys:

1. Campaign/product link → exact product/variant → cart → address → per-package delivery → payment/final review → authoritative order status.
2. Category/search → product → back to preserved filters and list position.
3. Guest order recovery or sign-in → owned order → parcel tracking → eligible return/replacement/refund history.
4. Affiliate link/profile → item/quantity commission explanation → original/replacement receipt lineage → automatic eligibility and manual-transfer payout history.

Changes to these journeys must update the canonical UX/PRD instead of establishing app-only financial rules.

## Authentication and session design gate

Select and document a supported identity flow before implementing app login. The draft bearer transport does not specify token issuance, refresh, rotation, expiry or revocation.

Required design outcomes:

- Use an operating-system-appropriate secure authentication flow and secure credential storage selected from current official guidance.
- Treat browser, WebView and native session contexts as distinct; do not assume cookies or affiliate touches migrate automatically.
- Preserve safe shopping context through login cancellation, expiry, logout and device changes. Define guest-cart merge behavior explicitly before enabling it.
- Recover guest order access through verified contact or an approved scoped capability. An order number, referral identifier or device flag is not authorization.
- Keep app/client credentials separate from server/provider secrets. Never embed merchant API secrets in a binary or JavaScript bridge.
- Define action-bound reauthentication for beneficiary changes and other sensitive operations.
- Document whether account/session management and future account deletion requirements affect the app; confirm current platform rules at release planning.

## Payments, external handoffs and deep links

Persist the server-side order/payment attempt before opening a payment destination. Maintain a dependable web fallback if an external app cannot be opened or cannot return to the native client.

Before enabling app links, decide verified domains, allowed routes, return binding, expiry and state validation. App identifiers, URL schemes and association files remain unallocated until actual project/account ownership is verified.

Required recovery cases include external browser cancellation, provider return before callback, app termination during payment, expired session, duplicate return, unavailable payment app and a link opened on another device.

A return link, resume event, screen reload or native bridge message is never payment confirmation. Retrieve backend status and reconcile an unknown attempt before offering another payment. COD state and collection remain separate from order placement. Affiliate maturity is unrelated to the payment-return screen.

## API compatibility and client generation

The first-party OpenAPI owns wire schemas. Future clients may generate types/SDKs only after the relevant contract/auth choices are accepted; generation does not prove endpoint correctness.

Before release:

- Verify implemented handlers against the accepted contract, including permissions, idempotency, money, pagination and errors.
- Keep immutable catalog/resource IDs identical across website, app, feeds and advertising events.
- Define supported API/client versions, compatibility/deprecation periods and safe unsupported-client handling.
- Specify how clients tolerate additive response fields and handle new states; do not repurpose a field or assume apps update with every server deployment.
- Preserve stable operation identity across retries, Back, reload and app resume. Do not repeat an ambiguous financial side effect.
- Keep independently validated affiliate attribution and advertising attribution separate. Cross-device/native attribution requires its own design; web cookies alone do not provide it.
- Keep queued/unknown refund or payout outcomes visible rather than displaying false completion.

## Optional capabilities requiring a demonstrated job

| Capability | Decision boundary |
|---|---|
| Push notifications | Select meaningful events, user controls, permission timing, delivery provider and privacy/retention before enabling |
| Native share | Share approved public product/referral summaries; exclude order access credentials and buyer information |
| Camera/photo picker | Limit to product-specific support/return evidence; define permissions, type/size checks and private upload lifecycle |
| Biometrics | A convenience over the approved authentication/reauthentication model, not a replacement for server authorization |
| Cached browsing | Optional; label freshness. Stock, shipping quotes, checkout and financial mutations still require authoritative online confirmation |
| Native analytics/ads attribution | Activate under approved policy/provider terms; deduplicate cross-client events and reconcile backend outcomes |

These are candidates, not accepted scope. Do not add infrastructure or dependencies for them before a concrete task activates them.

## Readiness stages

These stages describe decision order, not a competing task checklist. Add actionable implementation work only to TASKS.md after scope acceptance.

| Stage | Evidence needed to advance |
|---|---|
| Mobile experience | Accepted distinct mobile/desktop prototype with representative categories, split shipping and guest recovery |
| Backend/API | Working scoped handlers, stock/money race tests, actual auth lifecycle, issued payment/logistics/payout contracts |
| Native strategy | Recorded client approach and supported OS/device matrix with justified native capabilities |
| Native pilot | Real-device happy/error/recovery flows, accessibility and provider diagnostics; no production-readiness claim from emulators alone |
| Distribution | Verified account/identifier ownership, signing/recovery process, current store/privacy requirements, support and rollback/update plan |
| Public release | Owner-approved release scope, fresh implementation evidence and operational support readiness |

## Required future verification scenarios

The future task owner must define runnable checks and collect fresh scoped evidence for:

- Mixed-category discovery, long names, image shapes, unavailable variants and text enlargement.
- System Back, gestures, rotation, keyboard/safe-area behavior, navigation restoration and deep-link fallback.
- Concurrent stock loss, expired quote, split COD collection amounts and changed subsidy eligibility.
- Provider handoff cancellation, delayed confirmation, killed app, expired session and repeated callbacks/returns.
- Guest access denial, other-user resource references and warehouse/affiliate scope violations.
- Return of only one fulfilled quantity, replacement receipt lineage and correct commission eligibility explanation.
- Payout threshold, in-flight balance exclusion, ambiguous transfer recovery and refund status visibility.
- Logout/account change on a shared device with no previous-user data exposure.
- Slow/offline recovery without duplicate order or misleading success; actual supported-device performance.

These scenarios have not been executed. Native security, accessibility, performance, attribution and store approval remain unverified.

## Resume instructions for a future development session

1. Read repository instructions/status and inspect the actual code before using this planning snapshot.
2. Follow the canonical references above and preserve accepted IDs and decisions.
3. Identify the requested native lane and actual supported provider/auth constraints.
4. Resolve material client/auth/distribution decisions with Paduka Ongki; do not repeat already accepted business-policy questions.
5. Update the existing architecture, IAM, API, UX and sole task queue proportionally. Do not create another PRD or API spec.
6. Implement the authorized scope, verify with actual devices/runtime and record evidence in repository-owned delivery artifacts.
7. Obtain the applicable authorization before credentials, provisioning, production changes or app publication. This reference authorizes none of those actions on its own.

## Open decisions

| Decision | Owner | Due gate |
|---|---|---|
| Native client approach/framework | Paduka Ongki | Before native repository/toolchain initialization |
| OS/device support and native feature scope | Product owner | Before native prototype acceptance |
| Auth lifecycle, guest-cart merge and secure storage | Engineering owner | Before client authentication implementation |
| Payment/provider return and app-link protocol | Integration owner | Before native checkout implementation |
| Signing, store accounts, app identifiers and recovery | Release owner | Before distribution setup |
| Notifications, attribution and data retention | Privacy owner | Before those capabilities activate |
| API/client compatibility support policy | Engineering owner | Before an independently distributed client release |

Change history: 2026-10-15 — created at the owner's request as a future-mobile handoff reference. No new native implementation scope, vendor capability or completed verification is asserted.
