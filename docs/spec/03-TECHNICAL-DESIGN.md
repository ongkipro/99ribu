# Technical Design

Status: Accepted contract — implementation and acceptance state is owned by root [STATUS.md](../../STATUS.md); external gates remain open.

Owner: Paduka Ongki. Updated: 2026-10-21.

### TD-1 — Application structure proposal
- Status: Accepted
- Owner: Engineering owner
- Source: CTX-9
- Statement: Use one TypeScript application with Next.js App Router, PostgreSQL/Drizzle and Better Auth; a separately running worker shares domain modules and the database.
- Acceptance: Implementation preserves delegated stack selection, records pinned compatible versions and verifies local and deployed runtime separately.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

## Domain modules and side effects
Catalog, inventory, checkout, fulfillment, returns, affiliates and finance have clear module boundaries within one repository. No separate network service for each module. Server Components render read-heavy pages; small Client Components own necessary interactivity. Server Actions/Route Handlers call the same server-only domain operations; authorization and validation are never delegated to the UI.

Checkout sequence: validate cart and address -> retrieve provider quotes -> allocate stock -> calculate subsidy -> display proposal -> atomically reserve inventory/promo budget and persist snapshots -> create payment attempt or COD confirmation -> produce fulfillment work through an outbox. External calls happen outside database locks. A provider timeout leaves an identifiable attempt for status reconciliation, not a blind second creation.

Inventory allocation must minimize total supported shipping cost across feasible assignments, including consolidation and physical package constraints. Tie-break proposal: fewer packages, then default warehouse. Exact candidate comparison is the baseline; if measured catalog scale requires search limits, expose and approve the optimization ceiling rather than claiming global cheapest. Do not split quantity of one variant across warehouses without buyer-visible quoting. Keep bundles warehouse-complete.

## Provider adapters — no invented API routes
| Provider | Required issued contract | Failure handling |
|---|---|---|
| Virgo | Merchant methods, sandbox, authentication, payment creation/status, callback verification, expiry/refund/reports | Pending attempt; verified status check; refund remains pending until provider confirms |
| Mengantar | Origins, destinations, actual/volumetric quoting, COD reachability, per-shipment collect amount, create/status, delivered proof, pickup and return | Keep fulfillment exception; do not claim booked without provider reference |
| Future payout provider / Virgo candidate | Issued merchant disbursement rights, destination verification, transfer create/status, idempotency and ambiguous-result recovery | No automated outbound integration initially; T-19 verifies capability before enabling it |

Use the reviewed local Mengantar reference described below; it takes precedence over stale private-skill observations. Provider endpoints and authentication must still match the current merchant-issued contract before implementation.

## Durable asynchronous work
Use a transactional outbox and persisted job state. Recommended initial queue: PostgreSQL-backed jobs; verify an established library and runtime fit before choosing one. Do not add Redis solely for an unmeasured need. Workers claim short leases, deduplicate effects, use bounded backoff and expose manual recovery. Expired leases can resume safely.

Receipt processing stores provider event time separately from ingestion time; late events do not arbitrarily postpone maturity. Replacement receipt replaces the eligibility anchor of affected items only. An unresolved replacement or return suppresses maturity. Duplicate and stale events cannot reverse a later valid state without explicit correction handling.

Payout evaluation locks matured eligible entries for one affiliate, checks the inclusive IDR 99,000 threshold, destination and active holds, then atomically creates one queued payout with unique entry allocations and a destination/policy snapshot. Initial mode is manual: finance exclusively claims the payout before transferring externally, then records verified transaction evidence, amount, destination match and reference. No worker sends money. Ambiguous results remain processing/unknown and block release/retransfer until reconciled. Cash shortages create a visible funding hold. Evaluation cadence is a setting, not a promised bank-completion SLA or new payout calendar.

## API compatibility
API-1 is activated by the owner request for future independent Android/iOS clients. First-party HTTP schemas are owned by openapi.yaml; issued provider callback fixtures remain a separate pre-implementation gate. A proposed first-party endpoint is not an upstream provider endpoint. SDK generation/publication follows contract acceptance, not this planning draft.

## Advertising measurement decision — PR-23
Decision: use a typed first-party commerce event contract, shared server domain modules, PostgreSQL transactional outbox and the existing separate worker. Shopify Customer Events are workflow inspiration, not an SDK dependency or permission to copy hosted-checkout scripts. One Next.js application owns the buyer journey. No additional tracking VPS, sGTM service or campaign-management API is required initially.

### Funnel and dispatch contract
| First-party occurrence | Meta | Google browser analytics / Ads | TikTok | Canonical trigger |
|---|---|---|---|---|
| Page / actual selected offer view | PageView / ViewContent | page_view / view_item, analytics if enabled | PageView / ViewContent, current supported names verified before implementation | Visible route/actual offer; never invent a selected first variant |
| Successful cart mutation | AddToCart | add_to_cart; secondary measurement only | AddToCart | Committed mutation identity; two genuine additions of the same offer are two events |
| Actionable checkout entry | InitiateCheckout | begin_checkout; secondary measurement only | InitiateCheckout | Logical checkout visit; rerender is not a new start |
| Accepted contact/address/shipping/method milestone | First-party analytics unless verified standard mapping applies | Semantic analytics; add_shipping_info/add_payment_info only on accepted corresponding state | First-party analytics unless current mapping applies | Explicit accepted versioned state, no typed input or sensitive address in payload |
| Persisted order / COD accepted | Internal order_confirmed | Internal order_confirmed; not Primary revenue | Internal order_confirmed | Idempotent backend creation; do not relabel as Purchase or another checkout start |
| Verified prepaid receipt or COD collection | Purchase through CAPI | Server conversion ingestion; see compatibility gate below | Purchase through Events API | Canonical verified money posting and allocated merchandise value |
| Thank-you/status viewed, help opened, payment failed | Consent-eligible analytics only | Consent-eligible analytics only | Consent-eligible analytics only | Authorized view/error category; never Purchase or automatic Lead |
| Refund / return / replacement | Internal adjustment ledger; adapter capability gate | Explicit supported adjustment of known original conversion only | Internal adjustment ledger; adapter capability gate | Not a negative Purchase or fresh sale; no duplicate sale on free replacement |

Decision: Purchase is server-only initially on all three platforms. Browser Pixels/Google tag measure eligible funnel activity. This avoids reliance on a returning customer, browser storage or an old thank-you revisit to deliver revenue. Optional Meta/TikTok paired browser Purchase is a later proven adapter mode: backend-authorized event envelope, identical event name/source/event_id/value, still eligible consent and verified vendor pairing window; suppress historic revisits. Google browser Purchase remains disabled unless a separately reviewed same-action supplemental-source contract is proven. No GA4 imported purchase becomes a second Primary action for the same revenue.

### Money, identity and time
A purchase instance references a verified payment/collection posting, not a browser view, payment attempt or courier status. Prepaid produces one purchase instance for the confirmed order payment; repeated provider receipts reconcile the same posting. COD produces an instance for each distinct verified collection posting, with disjoint quantity/amount allocations. Two collected parcels containing one Rp99.000 offer each generate Rp99.000 + Rp99.000, never Rp198.000 per parcel. A later bank remittance, delivery, affiliate H+10 maturity or free replacement creates no extra Purchase. A new actual additional payment requires its own approved commercial policy.

Decision: ad value is net paid merchandise after any valid merchandise adjustment, excluding shipping, COD/admin/payment fees and shipping subsidy; initial fixed-price units remain Rp99.000. Two offers yield Rp198.000 ad value even when the buyer pays an additional shipping charge. HPP, margin, affiliate commission and provider fees remain internal. BILL-1 owns reconciliation and allocation rounding. Use integer IDR internally, numeric value/currency IDR outbound, real occurrence time retained in UTC, and immutable opaque business-event UUIDs (Google transaction identifiers at most 64 characters). Dashboard labels distinguish purchase instances, distinct paid orders and collected parcels. Platform conversion counts cannot be described as order counts for split COD.

Catalog IDs equal immutable sellable offer identities across page/feed/adapter; bundle components are contents, not separately charged offers or duplicate conversion entries. The backend creates and validates event identity; browser occurrence IDs for funnel mutations are validated/deduped within scope. Retry preserves original identity, event time and payload version. Do not modify time to make an expired event admissible.

### Consent, matching and attribution
PRIV-1 owns purpose/legal review and retention. Initial engineering mode blocks optional advertising until the applicable recorded choice permits it (Basic mode); actual locale policy and notice still require approval before launch. Checkout and guest recovery remain functional when denied. Apply eligibility at capture and dispatch, cancel unsent withdrawn events, and never backfill earlier unconsented behavior after later acceptance. Server CAPI/API is not a consent bypass. Google defaults precede tag config/events and reflect ad_storage, analytics_storage, ad_user_data and ad_personalization; Advanced/cookieless mode requires a separately reviewed policy and implementation.

Keep genuine fbclid-derived _fbc, _fbp, gclid/gbraid/wbraid, ttclid/_ttp and bounded UTM references only as allowed by purpose and expiry. Never fabricate click IDs, equate attribution windows with retention, or overwrite first-eligible-seven-day affiliate attribution. Capture original allowed browser context, not a provider webhook server's IP/user-agent. Proxy trust is explicit. Strip sensitive query parameters/capabilities from source URLs and referrers. Match using actual customer data only; omit unknown email rather than synthesizing one. Stable advertiser-issued visitor/customer identity is distinct from order/click IDs. Normalize/hash real identity using each vendor's verified rules; raw cookie/click IDs are not email hashes. Hashing does not anonymize customer data.

### Adapters and current evidence boundary
Meta: Pixel plus server CAPI, same event_name/event_id if paired; official SDK confirms actual UTC seconds and event identity. SDK main/release v26.0.2 was observed in earlier research, but developer changelog/parameter/dedupe pages returned HTTP429 on 2026-10-16. Pin and reverify supported Graph version, event age, current fields, source classification for delayed COD and test-event behavior before activation; SDK default alone is not proof of the latest API.

Google: one owner per conversion action, initially direct Google tag for eligible funnel activity and a server conversion adapter. New offline ingestion targets Data Manager API v1 rather than assuming eligibility for legacy UploadClickConversions. Decision: use a Data Manager offline-import UPLOAD_CLICKS action (Website / Import from clicks) with eventSource WEB, owned by its operatingAccount, for prepaid and COD. Offline-import names the transport rather than an offline checkout. Reverify exact schema/account compatibility before implementation. Do not select WEBSITE multi-source while omitting its underlying Google-tag Purchase: that route supplements tag conversions. Require a valid documented identifier category, not merely transaction UUID; missing/expired attribution remains an explained gap. Data Manager consent fields adUserData/adPersonalization use CONSENT_GRANTED/CONSENT_DENIED/CONSENT_STATUS_UNSPECIFIED and are not browser Consent Mode syntax. Use a single approved Primary revenue action per intended goal without duplicate GA4 imports; validate count setting against posting-grain purchase instances. Enhanced conversions require actual consent, enabled account settings and accepted terms. Data Manager restatement keeps conversion count; it does not support retraction. An unmatched adjustment may be a new conversion: never send until the original action/transaction match is verified. Unsupported retraction remains a disclosed reporting difference, not a fake negative sale.

TikTok: use current Purchase, not new legacy CompletePayment integration. Events API 2.0 product name and Marketing API endpoint version are separate. Current standard-event and migration pages conflict on Lead/SubmitForm naming; lead mapping is disabled until verified, and merely opening support never qualifies. Same source/event/event_id is required for optional overlap. The official dedupe page states a 48-hour window and has ambiguous cross-channel five-minute wording; do not promise enrichment timing or rely on that window for local idempotency. Verify exact schema, user.phone field, hashing, action-source/context and maximum event age in the current rendered developer reference before coding.

### Durable processing and thank-you boundary
Commit money posting, unique purchase instance and required platform outbox intents atomically. Uniqueness is platform + configured source/action + business event + mapped name. Worker uses claimed leases, bounded retries/backoff/jitter for transient network/429/5xx, respects Retry-After, and quarantines permanent rejection/expired event/invalid destination. Timeout is unknown receipt: resend the same event identity, never create another financial event. Internal processing is idempotent; external delivery is at least once subject to vendor dedupe/acceptance. Per-platform pause/circuit failure cannot block checkout or order receipt. Replay needs reason, permission and original identity/consent/time validity; no arbitrary historical resend.

Thank-you rendering reads authorized backend state with private/no-store caching. Provider return is navigation only, never payment proof. Pending reconciles through bounded polling or the existing verified event channel; background/hidden tabs pause polling and resume with a fresh read. Closing the page does not prevent worker delivery. Optional browser echo contains only the safe eligible envelope, never credentials or customer details. Do not infer delivery from HTTP200: retain per-event accepted/processed/rejected/unknown diagnostics, then reconcile eligible business totals and platform reporting separately from attribution. Account configuration, real test events and campaign spend require their own authorization; none occurs in this Markdown revision.

## Desktop/mobile rendering and first-party API seam
PR-17 introduces separate desktop and mobile shopping presentation using shared domain operations and identities. Use distinct layout/screen modules under one application initially; responsive behavior still handles size/orientation/zoom inside each mode. Exact URL/mode selection and hydration strategy are Proposal, not automatically a separate hostname or duplicate Next.js application.

PR-18 activates API-1. Route Handlers expose versioned JSON for independent consumers; web server components can call shared domain functions directly rather than make unnecessary internal HTTP round-trips. API and server-rendered flows enforce the same validation/transactions. Design app/native lifecycle separately when selected; WebView does not imply PWA, offline checkout or a ready native bridge.

Define product URLs once logically and map them to each client presentation. Validate allowed post-auth/payment returns; server persists attempts and reconciles return/resume, which is never payment proof. Browser/WebView cookies are separate contexts; no credential is passed in arbitrary query strings to fake continuity. Native authentication and link associations are future gates.

## Listing contents, stock and operational recovery
Product is the listing; Variant is its selectable sellable offer with a permanent catalog ID and price IDR 99,000. Every offer resolves to explicit physical StockItem quantities, including quantity-two multipacks and mixed bundles. Never charge its components separately or recursively nest bundles. Inventory-only components need not be individually sellable. Reserve all required component stock atomically in one warehouse; compute offer availability from components, not an independent duplicate bundle stock counter. Freeze the selected option and contents at checkout; later catalog edits cannot change an order.

Waybill issuance is the PR-6 packing milestone only after the provider confirms a usable carrier/tracking reference. A local draft label, failed creation attempt or arbitrary staff timestamp cannot satisfy it. Record issued_at separately from physical preparation and handover evidence. Reconciliation recovers timeouts using the same operation identity; replacing a cancelled waybill does not reset the original deadline or mark handed_over.

PR-21 owns recovery: no silent substitutions after stock discrepancies; a late prepaid success must be reconciled and stock reacquired atomically or refunded; failed/refused COD keeps receivable/stock/commission states distinct; partially delivered orders resolve affected shipments/quantities independently. Replacement stock failure presents a supported alternative only with buyer consent, otherwise the approved refund path. Reissue or cancel tracking only after checking handover state.


## Diagram TD-D1 — Checkout reservation and provider effects
Owner: Engineering owner. Status: Proposal; transaction and retry contract to be implemented and tested.
Trace: [PR-1 through PR-5, PR-11, PR-16, PR-20, PR-21](02-PRD.md), [DATA-1](05-DATA-MODEL.md#data-1--transactional-invariants), [BILL-1](11-BILLING-PAYMENTS.md#bill-1--money-lifecycle).

```mermaid
sequenceDiagram
    actor Buyer
    participant Web as Trusted checkout
    participant Provider as Provider adapters
    participant DB as PostgreSQL
    participant Worker as Durable worker
    Buyer->>Web: Request cart and destination quote
    Web->>Provider: Retrieve supported shipping and payment options
    Provider-->>Web: Quotes and capability results
    Web-->>Buyer: Offer totals and warehouse shipment proposal
    Buyer->>Web: Confirm quote with idempotency key
    Web->>DB: Begin transaction and revalidate quote and stock
    Note over Web,DB: Reserve complete offer components per warehouse; reserve subsidy budget
    Web->>DB: Persist order, policy snapshots, attempt and outbox
    Web->>DB: Commit transaction
    Web-->>Buyer: Persisted order and pending payment or COD status
    Worker->>DB: Claim committed job with short lease
    Worker->>Provider: Execute payment or fulfillment operation
    Note over Worker,Provider: Outside DB locks; stable operation identity
    alt Provider outcome known
        Provider-->>Worker: Verified reference and status
        Worker->>DB: Deduplicate effect and persist guarded transition
    else Timeout or ambiguous outcome
        Worker->>DB: Persist pending reconciliation; do not recreate blindly
        Worker->>Provider: Reconcile through issued status contract
    end
    Provider->>Web: Callback with provider event identity
    Web->>DB: Verify, deduplicate and apply guarded event
    Note over Web,DB: Fulfillment starts only after prepaid confirmation or valid COD acceptance
```

A quote is not a stock guarantee. The confirmation transaction atomically checks warehouse-local composition and reservations; failures return a new buyer-visible proposal. Payment and shipment operations use issued provider contracts, not invented routes. Expired reservations plus late prepaid success follow PR-21: reacquire stock atomically or issue a reconciled refund; never silently oversell. Job completion and provider callbacks converge on the same idempotent business effect.

## Diagram TD-D2 — Waybill and actual delivery lifecycle
Owner: Engineering owner. Fulfillment owner contributes business milestone review. Status: Owner business milestones accepted; detailed guarded transitions proposed.
Trace: [PR-6, PR-7, PR-9, PR-21](02-PRD.md), [Shipment state ownership](05-DATA-MODEL.md#state-ownership).

```mermaid
flowchart TD
    Confirmed[Confirmed fulfillment basis] --> Clock[Original H+2 deadline anchor]
    Clock --> Attempt[Request carrier waybill]
    Attempt --> Valid{Usable provider reference?}
    Valid -->|No or unknown| Exception[Exception and reconciliation]
    Exception -->|Confirmed not created| Attempt
    Exception -->|Existing valid waybill found| Packed
    Valid -->|Confirmed| Packed[Packed: valid waybill issued]
    Packed --> Preparation[Physical preparation recorded separately]
    Preparation --> Handover[Actual courier handover evidence]
    Handover --> Transit[In transit]
    Transit --> Receipt[Actual buyer receipt evidence]
    Receipt --> Anchor[Quantity-level affiliate H+10 anchor]
    Packed -->|Cancelled before handover| Reissue[Checked reissue or cancel]
    Reissue --> Attempt
    Transit -->|Failed or refused| Recovery[Shipment exception recovery]
```

Packed means a provider-confirmed usable waybill issued within the original PR-6 H+2 window; neither a local label draft nor handover alone changes that definition. Physical preparation, courier handover and actual buyer receipt have separate evidence and timestamps. Reissued tracking retains the original deadline. Receipt stores event time and ingestion time separately; late callbacks do not restart a known valid clock. Approved replacements establish a new receipt anchor for affected quantities only. Fulfillment confirmation and deadline origins follow PR-6's prepaid/COD rules, not an invented timestamp in this diagram.

## Architecture decision trace links
The sole decision index is [DECISIONS.md](../../DECISIONS.md). This table declares the same IDs for suite traceability only; decision content/status is owned by each full ADR and indexed once. Proposed architecture is not implied owner approval or implementation.

| ID | Owner | Status | Canonical record | Confirmation trace |
|---|---|---|---|---|
| ADR-0001 | Engineering owner | Accepted | [Full record](../adr/ADR-0001-modular-application-boundary.md) | See record confirmation; all runtime checks remain prospective |
| ADR-0002 | Engineering owner | Accepted | [Full record](../adr/ADR-0002-sellable-offers-physical-inventory.md) | See record confirmation; all runtime checks remain prospective |
| ADR-0003 | Engineering owner | Accepted | [Full record](../adr/ADR-0003-immutable-financial-postings.md) | See record confirmation; all runtime checks remain prospective |
| ADR-0004 | Engineering owner | Accepted | [Full record](../adr/ADR-0004-typescript-next-postgres-stack.md) | See record confirmation; all runtime checks remain prospective |
| ADR-0005 | Engineering owner | Accepted | [Full record](../adr/ADR-0005-vultr-coolify-cloudflare-hosting.md) | See record confirmation; all runtime checks remain prospective |
| ADR-0006 | Engineering owner | Accepted | [Full record](../adr/ADR-0006-versioned-client-api-boundary.md) | See record confirmation; all runtime checks remain prospective |
| ADR-0007 | Engineering owner | Accepted | [Full record](../adr/ADR-0007-guest-commerce-capabilities.md) | S20 actual guest/browser/header runtime and bound R3 confirmation; see root ledger/status |

## Selected operational boundaries — 2026-10-15
Public storefront and checkout accept orders continuously; business calendars only affect warehouse processing promises. Web and worker share PostgreSQL domain transactions and durable outbox records. A worker outage leaves committed work recoverable and visible; unavailable payment/quote providers yield truthful pending/unavailable responses rather than fake acceptance. Health/restart/alert and restore checks are owned by DEL-1 and OBS-1.

Admin order history, inventory, cost review, finance and settings share one application and canonical order/ledger identities. Server-side read services enforce role and warehouse scope, use bounded cursor pagination and distinguish aggregates as-of time from transaction detail. Historical order views link shipments, payments, refunds, commissions and payout references without granting ordinary staff access to protected banking evidence. Cost/settings writes and inventory movements are version checked, audited and idempotent.

## Local provider handoff — 2026-10-15
Observed: local Mengantar reference exists at /home/ongki/Projects/mengantar-documentation/ (SRC-MENGANTAR-LOCAL). Read docs/01-api-reference.md, docs/02-couriers-and-rules.md and docs/10-verification-checklist.md before writing the adapter. The repository reports a 2026-09-25 read-only courier-estimate check; no fresh 99ribu merchant verification was performed here. Reuse its address/origin identity, quoting, batch/create, tracking, label and webhook contracts; confirm current account scope, COD amount mapping, wallet funding and provider-specific courier names. An unpaid shipment without a usable waybill does not satisfy PR-6. Partial batch outcomes retain references; unknown creates are reconciled before retry. Local webhook documentation is not proof of active sandbox callbacks or verified actual receipt.

Unknown: no Virgo-named merchant API document was found in the bounded Projects/Documents documentation filename search. Public sources in sources.json are discovery/context only. Obtain the owner-provided merchant API contract for methods, auth, callbacks, status/expiry, refunds, settlement and sandbox before implementing Virgo. Do not invent routes or use consumer-wallet transfer documentation for disbursement. Do not read credentials just to complete this planning handoff.

Warehouse operators use scoped fulfillment/shipment history rather than whole-order history endpoints; whole-order totals remain available only to an authorized whole-order role. Payment expiry and unpaid-stock reservation TTL are not extended automatically by shipping holidays. Closure days affect processing deadlines, not the authenticity or timestamp of payment/delivery evidence.

## Native website chat — selected initial architecture
PR-22 uses the same server domain, PostgreSQL persistence and transactional outbox as commerce. Send/create/claim/state transitions use authenticated HTTP mutations with actor-scoped idempotency and object authorization. Recommend SSE for server-to-browser committed public-message/unread updates, with bounded cursor-based history/polling fallback. No separate WebSocket fleet or Redis is justified for the initial 8 GB host; reevaluate after measured connection/load limits. This is transport design, not a tested connection-count guarantee.

Keep message commit independent of the stream connection. A lost acknowledgement retries the same client_message_id; duplicate stream delivery deduplicates by message/sequence. Cursor resume rechecks current participant scope, has bounded replay and falls back to paged resync for stale cursors. CS staff-note events are separate private channels, never entries filtered out of a public stream. Authorization is checked on connection and periodically/reconnect; session revocation/claim changes terminate unauthorized access. A stream disconnect is not a read receipt.

Prefer same-origin browser API ingress for each storefront/admin host, with explicit backend/session routing and CSRF/origin checks; shared business modules do not imply broadly shared cookies or permissive credentialed CORS. Select the exact guest session issuance/recovery and cross-host auth transport at implementation. For SSE, prove proxy buffering/timeouts/heartbeat and multi-tab limits against the actual Coolify/Next setup, then test cursor recovery and instance restart. MDN SSE and Next.js self-hosting guidance inspected 2026-10-15: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events and https://nextjs.org/docs/app/guides/self-hosting.

Do not publish raw message bodies, bank details or guest capabilities to telemetry/ad attribution. Uploads are private conversation-scoped assets, validated and scanned before message association. Agent inbox assignment/status is durable; queued delivery and off-hours messaging remain visible even if no agent is online.

## Chat completeness handoff — Markdown scope
The expanded PR-22 adds typed context cards, reply references, scoped message search, participant preferences/in-app notifications and staff templates/internal classification. Keep these within the support module; PostgreSQL-backed bounded search is the initial recommendation, not a new search cluster. Search/quote/card projections reauthorize and apply redaction at retrieval. Public message events, private staff metadata and per-participant preferences have independent projections/cursors. Outbox notifications deduplicate per recipient/message; notification seen is not read. Core event replay remains durable; optional typing/presence is ephemeral and expires on missing heartbeat.

The existing OAS core is unchanged by this Markdown-only task. T-24 expands the API contract and negative/schema checks before corresponding handlers, and T-25 implements only the aligned contract. Do not let an optimistic UI invent unsupported message fields or notification endpoints. Guest bootstrap/recovery, supervisor template governance and cross-host session ingress must be implemented and verified before exposing those flows.

## Parcel label generation and99ribu identity — PR-25
Decision: prefer a provider-supported 99ribu sender/brand configuration or explicitly approved branded template. Persist original carrier AWB and provider label identity; each parcel has its own artifact and COD collection allocation. Provider credential URLs never reach clients. Do not add an invented masking flag, replace the carrier AWB with an internal order number, or assume registering a dropshipper grants permission to remove provider branding.

Evidence boundary: local Mengantar docs01 section10 describes single-order thermal tokens, while docs03/07/09 use A6/A4 shorthand and the curl heading mentions single/multiple; docs04 describes single-order asynchronous flow. The notes disagree on format/response vocabulary. Local verification notes reference public docs; current docs endpoint could not be read through web tooling on 2026-10-16. Whitelisting, quota, endpoint/field/status names, link expiry and branded/masked options require the current issued99ribu contract. No local example is copied as a verified wire integration.

Flow: scoped eligible parcel → verify issued non-void AWB/current snapshot and available template/format → persist idempotent generation job → provider request or approved local rendering → reconcile asynchronous result → validate PDF/page count/parcel mapping → private preview/download → explicit print dialog → operator physical check → separate pickup/handover evidence. A readable AWB does not prove PDF readiness; PDF ready/print dialog open does not prove paper printed. Provider booking, label rendering, print attempts and physical preparation are separate transitions; preserve the existing PR-6 waybill milestone without making printing its new anchor.

For batch printing freeze selected explicit parcel IDs, warehouse, current shipment revisions and stable page ordering. Default one parcel per thermal page, with parent order reference and parcel position within the order; do not confuse batch page position with package position. Exclude void/cancelled/superseded AWBs and nonready jobs, list reasons, and require review before continuing eligible subset. Poll/read retry never creates another booking. Retry generation uses its stable identity and reconciles unknown outcomes; reprint normally reuses the same validated artifact/AWB. If artifact link expires, regenerate/retrieve through the verified safe method, not another paid shipment. A changed address/service/amount invalidates old artifact; any rebooking requires its separate domain authorization and cancellation reconciliation.

If approved full masking is unavailable, present99ribu identity through an original carrier label plus separate non-obstructing99ribu sticker/packing slip. The UI must identify this fallback and keep full masking unresolved, not silently declare the requested template active. No PDF crop/overlay obscures required fields. A later fully custom render needs issued barcode symbology/data/routing requirements and carrier acceptance before release. Preserve genuine sender/warehouse/return details;99ribu brand is not a fake address or fictitious courier.

Downloads proxy private artifacts through an authorized bounded server route with no-store behavior; validate upstream host, redirects, MIME, file signature/size/page limits and safe template assets. Do not accept arbitrary fetch URLs. Store no customer PDF in public buckets, analytics or ordinary logs. Stale scope/session checks apply on every generation/read/download. A physical print/scanner test is mandatory; browser screenshot or PDF existence is insufficient proof of usable shipping labels.


Evidence update 2026-10-16: official Mengantar help publicly describes recipient-data privacy masking (name/phone; a separate update also mentions address except city/province). That is not evidence of 99ribu logo replacement or a brand-template API. Model recipient privacy mode separately from commercial brand mode, and enable it only through a verified carrier/provider-supported workflow; never locally censor required delivery fields based on the word masking alone. JNE published section4.4 requires complete/correct sender and recipient data; confirm approved provider exceptions for enabled services. Public return-address guidance also has geographic/carrier restrictions; do not assume all warehouses may redirect RTS to any address.

## Localhost execution profile — CTX-18
Decision: local mode exercises the same server domain modules, PostgreSQL constraints/transactions, actual auth sessions/authorization, worker/outbox and buyer/operator UI intended for release. Replace only external effects with deterministic owned payment/shipping/label/advertising/notification adapters. No mock role header, trusted buyer_id or disabled permission check may substitute for real auth; no in-memory inventory/money repository may substitute for PostgreSQL. Actual Better Auth sign-in protocol is selected/pinned and validated during T-23; synthetic fixture role declarations are seed intent, not bearer credentials.

A local simulation advances explicit scenario/clock state: payment pending/success/failure/expiry/unknown and callback duplication/order; shipping quote/no route/COD unsupported, funding unpaid, AWB pending, delivery/return versus actual collection; label job pending/failure/expired/reprint; ads receipt/rejection/retry/consent; service notification attempted/sent/failed. These are first-party domain test events, not guessed Virgo/Mengantar wire payloads or production signatures. Use a local test inbox for real auth verification logic if supported, never SMS/WhatsApp/email to real recipients. Keep test controls in a local-only CLI/test harness, disabled in non-local builds; do not expose a public mark-paid/simulate endpoint.

Configuration must positively identify APP_ENV=local and every external adapter as simulated; reject mixed live destinations/credentials rather than silently falling back. Outbound provider/money/shipment/ads/notification dispatch is disabled by default and guarded independently in worker/senders. Allow only local adapter services for this profile; external browser pixels/scripts are not loaded to satisfy local analytics. Browser funnel events write to a local diagnostic sink with the real consent and event-grain rules. Test logs distinguish captured/suppressed/queued/simulated accepted; they never claim actual attribution.

Simulation uses dependency-injected clock/event delivery, stable IDs and deterministic scenarios, not wall-clock sleeps or arbitrary client state overrides. Test money/stock race/replay against the real DB, and stop/restart the real worker to prove catch-up. Free replacements, failed COD, refunds and later settlement remain distinct even in mock mode. A test advance-clock does not change host/system time or overwrite historical receipt anchors.

Every generated local label is conspicuously marked TEST — NOT FOR SHIPPING and uses synthetic AWB/test barcode data. Its preview/reprint/scope behavior can be accepted locally; real barcode/courier/brand-template approval and actual hardware output remain separate later gates. Do not present a mock99ribu template as provider-approved masking. Preserve immutable original PDF/snapshot references and local access controls.


## S12 implemented PostgreSQL job primitives

The existing native transactional outbox now supplies short fenced leases, dispatch markers, bounded safe retries/dead-letter and conservative unknown reconciliation. This checkpoint adds no queue service/package or live adapter. Local notification effect/completion remains atomic; outside-transaction adapters register on the shared worker and must validate their own business receipts. An expired lease before dispatch can retry; after dispatch it becomes unknown, including at the retry cap. Authoritative no-effect lookup must also establish the original attempt cannot later apply. Unknown cannot be re-created blindly. S12 process/DB proof covers primitives with controlled adapters; stock/refund/commission/payout and provider-event acceptance remains its domain slices and S63/S68.


## S19 trusted shipping contract

S19 shipping domain implementation uses actual published immutable offers and current SQL physical stock/cost sources. Only external destination/rate responses are simulated with explicit TEST-ONLY provenance. No issued merchant Mengantar endpoint/flag/tariff is assumed from historical skill notes. S20 owns real cart authority, persisted buyer quotes and HTTP. Read-only rate timeouts are safe to retry without stock/money/shipment side effects.

Compare feasible allocations of indivisible complete offer units, including consolidation and split parcels. Use conservative explicitly declared TEST-ONLY upright stacking (max length/width, summed height, actual weight and volumetric weight) and per-service package limits. Optimize supported gross shipping charge, then fewer parcels, more default-warehouse units, stable allocation identity. Bound exact search and unit expansion; if the search ceiling is reached, fail explicit review instead of claiming an unproven cheapest result. No greedy whole-cart allocation may silently violate shared component capacities.

## S21 public discovery implementation

Next server pages and three anonymous versioned catalog GET adapters share `src/modules/storefront/catalog.ts`. They read frozen current publication revisions, validate prospective financial sources again after locks/availability work, and calculate complete-offer stock per actual active warehouse. Public variants omit internal SKUs, stock-item IDs, warehouse IDs and cost sources. Availability is advisory; the actual S20 quote/submit guard remains authoritative. No new persistence or provider protocol is introduced.

Public discovery is request-fresh/no-store. Rank/newest keyset cursors preserve PostgreSQL microseconds and bind normalized query/filter state; a cursor is never authority. Source validation is bounded to four times the requested1–40 products, so a page can be empty with continuation after invalidation. There is no fabricated total count. S63 owns throughput measurement of this explicit scan ceiling before any caching/index change.

The host-only `fixture storefront` command extends the existing actual temporary owner/MFA seed runtime and creates four separately identified sample products through catalog/cost/publication writers. Existing original fixtures, unknown HPP, stock, clocks, operator changes and historical publications remain intact. Home merchandising selects those four local sample identities; search includes ordinary current published products without a namespace/tenant shortcut.

Category metadata has the same structural published-tree visibility in API filtering, SSR headings, slug routes and local merchandising. An unpublished department cannot leak its name/rules through a guessed category filter. The public cursor parser rejects normalized-invalid dates and year zero before PostgreSQL casts. Category/filter state is kept in public URLs; no private tokens are added.


## S23 financial primitive implementation contract

Use immutable transaction headers, ordered positive debit/credit postings and immutable economic receipts in the same PostgreSQL transaction. A deferred database constraint requires balanced nonempty journals; only the transaction creating a header may add its postings/receipt. Corrections append a linked full reversal, never change prior entries. Receipt ingestion is an internal trusted adapter boundary, not a client endpoint. S24/S28 validate durable provider/simulator event authenticity before calling it and own order/payment transitions. An accepted collection creates provider receivable against buyer-funds liability; it does not assert bank settlement or recognized revenue/COGS. S30/S34 own settlement and recognition.

The implementation uses PostgreSQL18's [deferred constraint triggers](https://www.postgresql.org/docs/18/sql-createtrigger.html) and [server transaction identity](https://www.postgresql.org/docs/18/functions-info.html#FUNCTIONS-PG-SNAPSHOT). Constraints run on both headers and inserted parts so forcing an early constraint check cannot permit a later unbalanced insert. This was exercised with actual SQL before application.


## S24 prepaid implementation contract — before code

Reuse issued TEST-ONLY local-prepaid method identity from the owned checkout quote. Payment attempts are authorized through current order session/HttpOnly capability, use frozen totals and actor-independent order/key retry identity after authorization, and never accept client totals/status/provider routing. Creation commits a durable provider-creation intent before worker dispatch. The local provider effect commits independently of business receipt processing; response loss becomes unknown and reconciles the same identity instead of creating another charge. Signed/verified simulator events remain separate immutable delivery identities; one economic effect maps to one S23 receipt regardless of callback count.

Trusted callback processing takes the existing business clock/order lock order, atomically records receipt/postings and valid funding state, and protects timely funded reservations from ordinary unfunded expiry. Original deadlines remain unchanged. A late receipt after release or conflicting/incorrect allocation records durable recovery and genuine received-funds liability without authorizing unavailable inventory. Pending/unknown attempts never authorize shipment or Purchase. S25 owns economic advertising outbox, S27 final confirmation/retention and S28 COD collection. No public provider webhook/protocol or external request is invented for this local simulator.


S24 source review refinement: the original expiry instant is exclusive. Only verified collection with `occurred_at < original expires_at` may fund a still-owned order; equality is expired, regardless of worker ordering. Simulator collection and expiry serialize through the existing business clock/warehouse/order locks. An unresolved original creation intent or actual signed timely unprocessed collection defers expiry. Verified terminal late collection removes creation uncertainty and records recovery with actual cancellation/release, even if the creation acknowledgement is still unknown. No callback may ignore an expiry deferral.


## S25 implementation contract — before code

Implement the existing visitor-session, consent receipt GET/POST and allowed funnel POST contracts in the same Next.js/SQL runtime. Anonymous activation requires a server-issued opaque first-party bootstrap context; request IDs alone never recover or authorize another visitor. Reuse verified current commerce/account context when present. HttpOnly visitor capability is purpose-bound and cannot authorize commerce or staff resources. Principal changes require a fresh visitor context; never merge account/guest histories by contact or arbitrary IDs.

The fixed localhost profile uses a clearly named TEST-ONLY privacy policy and explicit bounded visitor/consent lifetime; these are development controls, not owner approval of legal/vendor activation. Consent defaults to unspecified/denied, is immutable by revision, checks its current effective/expiry state at capture and dispatch, and withdrawal cancels unsent optional deliveries. Missing or invalid optional tracking context cannot prevent ordinary checkout. No raw contact, chat/address, capability or HPP enters funnel/event diagnostics.

A canonical Purchase joins S24 accepted funding, exact original merchandise allocations and per-platform outbox identity in the existing caller transaction. Recovery/late/unallocated receipts never create Purchase. Receipt rollback leaves neither Purchase nor outbox; duplicate provider events and thank-you reloads reuse the original receipt/event identity. Preserve occurrence time; no historical backfill merely because consent is later granted. Affiliate attribution stays separate. Real provider schemas, destination activation and browser Pixels remain S57–S60 owners; S25 may exercise only explicit database-local delivery/suppression/recovery.


S25 concrete localhost defaults: `local-privacy-v1` is TEST-ONLY; inactive anonymous visitor nonce expires in10 minutes, active visitor and each consent receipt expire within24 hours. An anonymous browser channel may accompany a newly issued guest cart, but never grants it access; an authenticated visitor binds to the exact verified account session. Shared-device account changes require fresh visitor bootstrap, without merging stored choices or order histories. Public bootstrap uses120/minute per fixed local source, while activated purpose operations use60/minute per visitor; these are real persisted limits, not disabled test modes. Exact live retention, notice and vendor activation remain the pending owner/privacy gate.


## S28 COD architecture

S28 uses automatic server confirmation inside valid final COD checkout, followed by independent signed local provider source commits and atomic database callback processing. Original order, parcel, fulfillment occurrence and economic receipt identities remain authoritative. Confirmation protects original holds and freezes actionability without claiming money; accepted per-parcel collection joins the existing receivable/liability journal and canonical Purchase/outbox. Private collection reads reuse exact current order authority. Business state and recovery policy are owned by11; persisted relations/seals by05 and exact wire schemas by the existing OpenAPI. No real Mengantar protocol is inferred.


## S29 calendar implementation boundary

The initial trusted fulfillment calendar consumer resolves the actual immutable S13 warehouse policy at the original actionable instant. PostgreSQL computes warehouse-local dates, operational weekdays, closure exclusions and IANA timezone conversion. H+1/H+2 count eligible dates strictly after the anchor's local date. The selected TEST-ONLY cutoff is the operational deadline time on the counted date; it never pauses intake or shifts an after-cutoff order to another date. Existing snapshots retain their exact policy ID and values after a later version is published.

The frozen set of consecutive yearly policy versions must cover the anchor and every counted date. A next-year version must be explicitly published and effective by that year's local start; every used version ID and value snapshot is retained. Missing or insufficient coverage raises CALENDAR_COVERAGE_MISSING; no next-year holiday/weekend assumptions are permitted. The later fulfillment orchestration must persist this as a recoverable configuration exception and explain any audited reschedule. The initial calendar and rolled-back business proofs are retained alongside the applied fulfillment model and independent app-role/runtime proof. Scoped HTTP adapters and host worker commands are now mounted in source. Approved0019 is applied to isolated test/local; native12 and built-browser1 runtime checks pass. Final S29 acceptance remains pending affected regressions and independent combined review.

S29 selected fulfillment lifecycle: one durable fulfillment per original parcel is initialized with actionable COD/prepaid acceptance, including a recoverable calendar exception when no covered policy exists. Intake is never blocked by missing operational configuration. Physical preparation changes the parent order to processing once; later parcel work does not fabricate delivery or payment. Every booking uses its original durable creation identity and signed independent local acknowledgement/issued/rejected evidence. At most one non-failed booking exists per original parcel. An authenticated terminal rejection allows an explicitly reasoned, audited new booking while every failed booking/source remains immutable. Unknown, queued, acknowledged or issued effects cannot be replaced; original-identity reconciliation is required. An acknowledgement carries no tracking number; only issued evidence appends the packing milestone and the next eligible-date handover deadline from the original issuance time. Late processing never resets either source instant. Staff packing confirmation and physical handover remain separate scoped versioned commands.

Handover consumes only that parcel's original physical component/lot quantities. The aggregate checkout stock hold becomes consumed only after all original parcels are handed over; earlier parcel movements are retained with their handover cause. The parent shipping-promotion benefit/quota commits once on first physical handover, retaining immutable per-parcel subsidy allocations; campaign budget commitment is separate from carrier expense and money postings. Existing actionable stock/subsidy deadlines remain immutable. Fulfillment notices persist through the durable worker and become available under the original private order authority; available is not read or external-message delivery. Deadlines append immutable snapshots, and explicit scoped rescheduling retains original anchors/previous due observations with a buyer explanation.

Rescheduling separates the private audit reason from required buyer_explanation. Only the explicit buyer explanation enters the durable customer notice; internal operational notes are not copied into buyer projections.

A reschedule supersedes only earlier deadline snapshots when recorded before their due instant. It never supersedes the deadline it creates. Missed packing/handover notices use the earliest non-superseded snapshot for the same due instant, preserving one observation and retaining earlier misses after later rescheduling. Exhausted creation jobs can retry their original booking after trusted host reconciliation fences stale creators and proves authoritative source absence; an existing source is reconciled without a new effect.

S32 uses deferred physical/head/provider-result seals and exact original outbox identity/completion guards in applied0022. Source preparation holds the order/case/head before a SHARE fence on its leased creation job; absence recovery takes UPDATE on that exact job and uses plain domain reads, avoiding a reverse head lock. Callback effects and completed result commit together. Attributed quote/initial-order native checks derive real-time rate/cost and per-unit owner bounds separately from simulated business clocks. Actual candidate/application gates preceded installation; all46 applied SQL/snapshot files and prefix23 are immutable. STATUS/the ledger own runtime evidence and acceptance; no additional DDL or executor invocation follows from this design.


## S33 selected exception recovery boundary — implementation pending

PR-21 extends the existing modular application and transactional outbox. Reuse signed payment/COD/waybill/receipt sources and their original durable identities; a timeout is not proof of no effect. Persist an exception only when it owns an operator decision, unresolved obligation or physical recovery. Queue membership/age may be derived from that durable case and its source; do not duplicate a second payment or shipment state machine.

A verified late or mismatched collection first remains the existing immutable buyer-funds liability. It never revives an expired order/stock hold. Finance may authorize compensation against that exact original collection after current source/capacity checks; the refund obligation, bounded allocation and creation job commit together. Creation acknowledgement, bank-result observation, callback completion and actual cash remain separate states. Unknown results retain the same operation and obligation; only a proven zero-effect failure permits an explicitly authorized next attempt.

Signed COD refusal establishes zero collection for that observation. It does not establish returned physical goods, free stock, buyer delivery or a refund. A physical returned/failed parcel observation must retain original shipment/unit/source identity. Assigned warehouse intake records actual identified components in quarantine; another delivered parcel and its receipt history are untouched. Later authenticated money observations still require accounting even after an operational refusal/cancellation; they must not disappear behind an ineligible business status.

Stock discrepancy stops the affected complete purchased offers before handover. Preserve original frozen commercial composition and monetary totals. Replenishment can recover an existing eligible intent; cancellation/reduction or a changed buyer promise needs an explicit authorized buyer choice and scoped staff decision. No silent substitution, automatic new sale, fabricated receipt or reused expired hold is allowed. Unavailable replacement stock reuses S32's same-intent wait/reserve path; an alternative refund must retain its original financial entitlement and cancel only an eligible unbooked physical intent with no ambiguous external effect.

Source registration, native guards, current authorization, exact versions, actor-scoped idempotency and immutable audit/results must agree. New native SQL requires the separate exact candidate/application gates and never edits applied0000–0022. This section selects the S33 implementation contract; no new schema, endpoint or runtime acceptance follows from the document. STATUS owns current execution.

The internal decision/choice writers now separate CS proposal authority from owning-buyer consent. Each writes one exact versioned case event and one finalized operation/audit response. Accepting a cancellation/refund proposal retains its exact proposal identity in awaiting_source for later guarded execution; it does not cancel units or queue a transfer. Accepted waiting consumes the proposal and returns to the appropriate stock/return/source task; decline escalates without executing a remedy. The final staff application and cancellation/compensation writers remain unfinished and must have an explicit action contract before adapter promotion. No existing proposal action may silently acquire monetary or physical effects.

The staged S33 original stock-report writer has a separate reinspection case/version reference alongside the original fulfillment version. It serializes on the original order and exact case/reservation/balances, verifies the complete original component set, snapshots actual server quantities and rechecks current warehouse authority. Reports preserve holds and create no physical loss. New original dispatch is fenced while any complete-unit investigation is active; an existing authentic waybill operation can still acknowledge its original facts. New native stock/dispatch branches remain source-only; STATUS owns executable acceptance.

S33 C2 freezes original COD financial unit membership on the existing local source operation. Source creation derives current collectible original units, while replay reuses the original operation's stored amount. Receipt posting uses the frozen source basis; refund eligibility and Purchase grouping use receipt-funded units. This avoids repricing an original parcel or using another surviving unit's money. Signed event shape/identity, consent, platform delivery and matching rules remain unchanged. Late qualified COD money records recovery with no Purchase or physical activation; unexpected money without funded units remains unallocated. Parent cancellation/history/native runtime integration is still required before this source can execute.

S33 C3 stages a shared original-unit shipping-subsidy release primitive. Original campaign allocations and each original unit subsidy remain immutable. Within each original parcel, sort campaigns by their original UUID and units by original line UUID/unit index/UUID; intersect their cumulative integer intervals. This partitions every original campaign and unit amount exactly, including stacked campaigns and integer remainders, without repricing surviving units. Only original cancellations from the exact final staff operation release those shares; cancelling a physical replacement releases no original subsidy.

Before first physical handover, a partial release reduces reserved budget while retaining the campaign's one held buyer use until its entire remaining benefit is released. Normal consume/release resolves only the remaining hold. After first handover, release unused subsidy only for undispatched original units and retain the committed buyer use. This budget effect creates no receipt, cash transfer, Purchase or new sale. Existing proposal/choice actions retain their non-execution contract. The final staff apply action, cancellation/stock/parent effects and native runtime seals remain incomplete; the staged primitive is not reachable through an issued action or API.

Historical S33 C3 definitions passed an exactly reviewed definition-only preflight on a fresh owned socket cluster: original STOP remains intact,160 relations/53 functions were defined and fully rolled back, and shared installed targets remained unchanged. This validates definitions only. The final staff action, physical cancellation/stock, source/refund/job/cash and full native/runtime business gates remain pending; source/consent primitives do not acquire execution authority from a definition result.


C4 original cancellation separates source acknowledgement, terminal carrier effect and business application. Creation/reconciliation uses shipping.cancel.create; signed facts register shipping.cancel.callback, consumed through the normal database-worker transaction. The original creation-job fence precedes parent-order/fulfillment locks. Issued-source cancellation waits for its original first issuance callback when needed, retaining original time/deadline without inline completion. Recovery selects only persisted original/cancellation callback IDs, preserves attempts and leaves exhausted no-effect creation failed. Final native carrier/action/stock/refund/job seals and explicit staff apply remain pending behind the stopped draft.

C4 now contains an internal explicit CS application writer. It locks existing cancellation-creation jobs before the original order, rechecks current staff scope and exact saved buyer consent, and separates pending carrier reconciliation from final per-occurrence retirement. It locks promotion budgets before stock, validates the latest complete warehouse count at current balance revisions, releases only exact held components and posts only the reported loss. Handed goods retain consumed stock until real intake. Original funded units are requalified under shared original-source capacity before exposing finance follow-up. The native authority/input/event, absent-request, per-unit cancellation and exact stock/application definitions are staged, not compiled or executed. Existing parent/reservation/dispatch, physical-source/intake/refund/cash/ACL closures, mounted API and actual transactional scenarios remain incomplete.

An exhausted cancellation creation may become internal not_created only when its exact fenced job has exhausted ten attempts and the authoritative source remains absent. This is no provider failure or successful cancellation. A current explicit CS application records escalation retaining the original consent and frozen exhausted job. A later explicit application may create a fresh carrier intent after that historical absence proof; no background loop resets attempts or silently repeats effects.

C4 original parent/dispatch integration is now staged. An exact original-unit retirement appends one parent event without changing frozen purchase totals. If surviving original units are all actually received, derive partially_completed; if the final receipt arrives later, its real callback appends that completion event once. COD collection and preparation keep their distinct original causes/revisions. Remaining original dispatch ignores already retired investigation units, rejects an empty surviving scope, and rechecks current warehouse authority after waits. Preparation picks current surviving allocations; handover and post-handover history use the issued booking's frozen membership. These new native/business branches remain stopped/unexecuted; complete replacement/source/intake/refund/cash/ACL/native/API/race/built closure remains pending.


Current C4 definition evidence: exact r21 PASS1 created165 relations/88 distinct functions from SQL546145... inside a fresh owned rollback transaction; no business path was invoked. The owned project is stopped/data retained, both installed140/23 targets and protected migration prefix remain unchanged, and the one invocation permission is consumed. STATUS and BUILD-LOG retain exact source/executor/result bindings; business/native completeness and full S33 acceptance remain pending.


Replacement stock reservation excludes retired occurrences. An accepted booking freezes surviving unit membership because links cannot be appended after initiation and retirement cannot occur after booking. Source creation, handover and actual receipts use that same scope. Exact CS application appends one per-parcel cancellation image keyed by its canonical minimum exception-unit UUID; partial retirement preserves milestones, complete unbooked retirement cancels the head. Original return-claim finance continuation stays unresolved until its own actual remedy. Current source is staged after the historical r21 definition checkpoint; corrected r23 source review and new native/business/transport acceptance remain pending.


Replacement stock-case production now follows the actual reserve savepoint failure and its persisted stock_wait. One immutable shipment source retains the first case/consent across retries. Complete active same-intent stock can resolve an eligible wait, including later preparation after accepted continue_waiting; pending proposal, decline/escalation, accepted cancellation/refund, retirement and recovery obligation cannot be overwritten. Actual r24 approves bounded source only at SQL66cc0...; new native/business/transport/full acceptance remains pending.


Accepted replacement retirement now appends an exact replacement_cancelled return event for each affected physical parcel and holds only its selected original replacing claims. Preserve original inspection and active claim identity. Completed physical or financial outcomes cannot rewind, and an already linked held claim cannot create a second replacement branch. Actual source and deferred native history/application guards are staged; successful recovery bank/claim/mixed completion remains pending. Actual r25b approves bounded partial source only at SQL9be368...; full native/business/transport acceptance remains pending.
