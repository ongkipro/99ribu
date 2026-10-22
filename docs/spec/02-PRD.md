# Serba 99ribu — Product Requirements

Status: Accepted contract — implementation and acceptance state is owned by root [STATUS.md](../../STATUS.md); external gates remain open.

Owner: Paduka Ongki. Updated: 2026-10-21.

## Overview and authority
Serba 99ribu is a single-company Indonesia ecommerce business with fixed-price physical goods, company-owned national warehouses and affiliate acquisition. This pack translates owner decisions; it is not proof of demand, profitability or working integrations. Domain ownership is owner-reported, not verified in Cloudflare. Next.js/TypeScript/PostgreSQL stack is selected under owner-delegated technical authority; Vultr + Coolify hosting is owner-confirmed (ADR-0005).

## Users and goals
Buyer: discover suitable products, understand split delivery and pay without mandatory registration. Warehouse: pick, pack and hand over assigned shipments. Customer service: resolve delivery and return issues. Finance: reconcile cash, refunds and affiliate obligations. Ecommerce admin: maintain catalog, stock and promotion operations. Affiliate: obtain referral links and understand earned/pending/paid commission. Owner: control policies and permissions.

Current customer behavior and measured traffic are Unknown; no interviews or sales evidence were supplied. Desired outcomes: successful checkout, correct fulfillment, understandable returns and accurate payouts. Conversion, return, failed-delivery, packing-overdue and contribution-margin metrics are tracked; numeric business targets remain owner-held before launch.

## Scope and non-goals
Initial scope includes all owner-approved categories, warehouse stock, guest purchase, prepaid/COD, exchanges/refunds, referral and payouts. Excluded: marketplace sellers, seller settlement, tenant infrastructure, supplier portal, preorder, cross-border checkout and speculative microservices. No reduction of approved features is implied by launch sequencing.

## Requirements
Requirement lifecycle Accepted means owner-approved business behavior, not implementation completion. Detailed canonical domain contracts are linked rather than replaced by prose here.

### PR-1 — Fixed-price catalog
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-2
- Statement: Every published listing shall expose one or more selectable sellable offers (variants), each priced at IDR 99,000. One offer may contain one physical unit, multiple units or a complete mixed-product bundle; component prices are never added to its IDR 99,000 total. Shipping is a checkout component, not launch-page copy.
- Acceptance: Given a listing with two IDR 99,000 options and one option containing two products, When the buyer selects one option and quantity one, Then the merchandise total is IDR 99,000 and its contents are explicit; publishing any differently priced offer is rejected.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration; amended 2026-10-15 by the latest owner instruction for offer composition, physical stock, waybill milestone or manual payout as applicable.

### PR-2 — Warehouse inventory
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-1
- Statement: The system shall manage inventory per physical SKU/component and company warehouse, including reservation, transfer, damage and return quarantine; derive sellable offer availability from complete component quantities without duplicate bundle stock counters.
- Acceptance: Given two different offers sharing the last physical component unit in one warehouse, When two buyers concurrently reserve them, Then only one complete reservation succeeds and stock never becomes negative.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration; amended 2026-10-15 by the latest owner instruction for offer composition, physical stock, waybill milestone or manual payout as applicable.

### PR-3 — Shipping allocation
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-3
- Statement: The system shall choose a stock-feasible allocation prioritizing the lowest total supported shipping charge and disclose every shipment before confirmation.
- Acceptance: Given stock in Pontianak and Malang, When checkout is quoted, Then supported consolidated and split options are compared and the selected total equals the sum of shipment charges.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

### PR-4 — Guest checkout and order composition
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-3
- Statement: The system shall allow guest checkout and create one parent order with immutable item, allocation, shipping and promotion snapshots.
- Acceptance: Given a valid two-warehouse cart, When submitted twice with the same request identity, Then exactly one order is created with the disclosed total and two fulfillment groups.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

### PR-5 — Prepaid and COD payments
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-3
- Statement: The system shall accept Virgo prepaid or supported Mengantar COD, with payment attempts and collection amounts distinct from shipping status.
- Acceptance: Given a split COD order, When shipment collection amounts are generated, Then their sum equals the buyer total and each amount belongs only to its shipment.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

### PR-6 — Packing and handover deadlines
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-6
- Statement: The system shall require a valid issued courier waybill by H+2 from successful prepaid payment or confirmed COD. This is the owner-defined packing milestone, followed by physical preparation and courier handover by the next working day; declared public holidays and major-holiday closures do not count toward shipping H+. Exact cutoff and Sunday handling remain owned timing questions.
- Acceptance: Given an actionable shipment, When a provider-confirmed waybill is issued by H+2, Then the packing milestone is met without claiming courier handover or buyer receipt; issuance timeout or either overdue deadline produces a recoverable exception and buyer notification.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration; amended 2026-10-15 by the latest owner instruction for offer composition, physical stock, waybill milestone or manual payout as applicable.

### PR-7 — Returns exchanges and refunds
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-3
- Statement: The system shall accept eligible return requests within seven days of receipt and resolve approved claims through full related refund or replacement.
- Acceptance: Given an approved faulty-item claim in the window, When resolved, Then the related buyer-paid item/shipping/admin amounts are refunded or a tracked replacement is created, without duplicate commission.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

### PR-8 — Affiliate referral
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-4
- Statement: The system shall register affiliates automatically and attribute checkout to the first eligible referral within a non-extending seven-day cookie window, excluding self-purchases.
- Acceptance: Given valid referral A followed by B before expiry, When checkout occurs, Then A is retained; after expiry a new referral can start a new window.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

### PR-9 — Commission accrual and maturity
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-5
- Statement: The system shall snapshot the affiliate-specific rate or default 10 percent per attributed item and mature commission ten days after verified buyer receipt, using replacement receipt after an exchange.
- Acceptance: Given an exchanged attributed item, When the original H+10 passes, Then it remains held; ten days after verified replacement receipt it can mature if no unresolved claim exists.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

### PR-10 — Affiliate payout eligibility and manual execution
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-5
- Statement: The system shall automatically identify affiliate balances at or above the default minimum IDR 99,000 after PR-9 maturity (future owner-versioned threshold changes follow PR-20), place them in the finance payout queue, and support manual transfer of the entire allocated eligible balance. No fixed monthly/date-5/date-20 schedule or affiliate withdrawal request applies. Automated external transfers are future capability-gated work.
- Acceptance: Given ten matured default commissions totaling IDR 99,000 and concurrent processors, When eligibility is evaluated, Then exactly one queued payout owns the balance; only authorized finance can claim and record a verified manual transfer, and an ambiguous outcome cannot cause a duplicate payment.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration; amended 2026-10-15 by the latest owner instruction for offer composition, physical stock, waybill milestone or manual payout as applicable.

### PR-11 — Shipping subsidy configuration
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-2
- Statement: The system shall let authorized staff configure shipping subsidy eligibility, cap, minimum spend, period, customer quota, budget and stacking, at parent-order level.
- Acceptance: Given a two-shipment order, When the subsidy applies, Then package allocations sum to one allowed order subsidy and concurrent orders cannot exceed its reserved budget.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

### PR-12 — Finance reconciliation
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-3
- Statement: The system shall provide role-scoped order history and finance reporting for owner (displayed as Super Admin) and finance staff, recording provider receivables, settlements, versioned costs, shipping, subsidies, refund liabilities and affiliate liabilities independently of gross sales; contribution, operating result and cash must be distinguished, with incomplete costs explicit.
- Acceptance: Given a COD delivered event without settlement, When reports refresh, Then it appears as a receivable, not received cash; payout timing remains governed by commission policy.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

### PR-13 — Role-scoped administration
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-7
- Statement: The system shall enforce owner, ecommerce_admin, warehouse, customer_service, finance, buyer and affiliate permissions on the server.
- Acceptance: Given warehouse staff scoped to Malang, When they query or mutate Pontianak fulfillment, Then access is denied even through a direct request.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

### PR-14 — Buyer and affiliate experience contracts
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-11
- Statement: The system shall provide recoverable buyer, admin and affiliate journeys, including item-level exchange reasons, receipt date, maturity date and payout history without buyer PII in affiliate views.
- Acceptance: Given a partial exchange, When the affiliate reads the order report, Then the affected item explains its hold and revised date while other eligible items remain separate.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

### PR-15 — Catalog distribution
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-2
- Statement: The system shall export consistent price, availability and permanent sellable IDs with internal taxonomy mapped to Google taxonomy and report synchronization failures.
- Acceptance: Given a variant with a changed slug, When feed and event payloads are generated, Then its permanent catalog ID is unchanged; invalid required product data is reported before export.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

### PR-16 — Operational reliability
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-3
- Statement: The system shall accept orders 24 hours a day, seven days a week, including public/major holidays, subject to truthful stock/provider availability, and durably process provider events and scheduled work with deduplication, bounded retries, reconciliation and auditable recovery. Warehouse closures do not close the storefront.
- Acceptance: Given repeated or out-of-order provider events and a worker restart, When reprocessed, Then no duplicate stock, refund, commission or payout effect occurs.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

## Quality constraints

### NFR-1 — Financial and inventory correctness
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-3
- Statement: Money shall use integer IDR and exact arithmetic; concurrent transitions shall not oversell or duplicate money movements.
- Acceptance: Run race, replay, partial-refund and ambiguous-payout scenarios; all conservation invariants hold.
- Constraints: DATA-1, BILL-1
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

### NFR-2 — Accessible responsive interaction
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-11
- Statement: Critical journeys shall support keyboard use, labeled errors, focus recovery and narrow/wide layouts.
- Acceptance: Browser checks at 390px and 1440px plus keyboard-only checkout and return submission show no lost essential actions.
- Constraints: UI-1, UX-1
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

## Return policy boundary
Accepted core reasons are wrong product/variant sent, damage on arrival, and manufacturing defect. Recommended extensions are materially not as described, incomplete contents, expired product or broken mandatory seal. Owner-delegated recommendation: include these extensions and exclude simple change-of-mind or buyer-selected wrong size when the delivered item matches the accurately disclosed selection. These exclusions never remove wrong-item/defect/not-as-described rights. Seven days is the claim-submission window, not arrival back at warehouse. Replacement commissions restart from replacement receipt under PR-9; the replacement receives a fresh seven-day claim window from verified receipt under the owner-delegated recommendation. Initial review target is two working days after complete evidence; physical inspection and external refund completion have separate status/deadline reporting.

## Risks and Open Questions
| Topic | Status and impact | Owner and gate |
|---|---|---|
| Stack and hosting | Vultr + Coolify accepted (ADR-0005); Next.js/TypeScript/PostgreSQL stack selected under owner delegation; Singapore and initial High Performance AMD 4 vCPU/8 GB/180 GB NVMe accepted; production operating budget/setup remain unresolved; compatible software versions are pinned during local foundation T-23 and do not require a server purchase | [TBD owner=Paduka Ongki; due=before production provisioning] |
| Payout execution | Manual finance transfer is the accepted first release; implement exclusive claim, verified destination, frozen allocations, evidence verification and unknown-outcome reconciliation. Virgo merchant disbursement API remains Unknown; T-19 gates future automation only | [TBD owner=Engineering owner; due=before manual payout activation; issued outbound contract before automated payout implementation] |
| Virgo contract | No Virgo-named merchant API documentation found in bounded local filename search; owner will supply missing contract for methods, sandbox, event authentication, expiry, refunds and reconciliation | [TBD owner=Engineering owner; due=before payment implementation] |
| Mengantar contract | Local reviewed reference available (SRC-MENGANTAR-LOCAL); confirm current 99ribu account scope, multi-origin COD/receipt/reconciliation and unsupported return automation before adapter release | [TBD owner=Engineering owner; due=before shipping implementation] |
| Liquidity | H+10 payouts do not depend on provider settlement; insufficient cash holds payout with explanation and alert, never marks paid | [TBD owner=Finance owner; due=before payout activation] |
| Replacement return window | Fresh seven-day claim window after replacement receipt adopted under delegated recommendation; maintain affected-quantity lineage | [TBD owner=Paduka Ongki; due=before return implementation] |
| Financial rounding/allocation | Half-up commission rounding and proportional largest-remainder refund allocation adopted under delegated recommendation; quantity-level conservation examples required before implementation | [TBD owner=Finance owner; due=before financial implementation] |
| Timing definition | Order intake is 24/7; shipping H+ skips public/major holidays. Exact cutoff and Sunday policy remain pending. Existing 7 x 24h return/referral and 10 x 24h maturity recommendations are independent of shipping holidays | [TBD owner=Paduka Ongki; due=before timing implementation] |
| Tax and product obligations | Tax invoice/treatment, product registrations, labeling, guarantees and payout tax treatment require qualified review | [TBD owner=Finance owner; due=before launch] |
| Visual direction | Brand palette and existing recommended direction selected under owner delegation; use selected self-hosted Inter with system fallback and typographic identity until actual graphical assets exist. Prototype/browser evidence still required; document approval does not prove rendered behavior | [TBD owner=Design owner; due=before visual implementation] |
| Launch sizing | SKU count, warehouse count, demand and budget unknown; no invented capacity or revenue targets | [TBD owner=Paduka Ongki; due=before capacity acceptance] |

## Release acceptance
Business contracts accepted here remain separate from stack, visual and provider approval. Release requires behavioral/race tests, sandbox contract evidence, rendered browser journeys, finance reconciliation and an observed backup restore. No release, deploy, DNS mutation, commit or push is performed in this planning task.

## Planning handoff gates — 2026-10-15
Document checks can complete while the decisions above remain open. Application stack and modular/API direction are now selected under owner delegation (ADR-0001, ADR-0004, ADR-0006); hosting is Vultr + Coolify (ADR-0005). Pin compatible stable versions and preserve remaining setup gates before repository initialization. Then initialize from this staged pack and establish shared auth/data and executable test scripts before the domain delivery order in TASKS.md. Provider-dependent implementation requires issued provider contracts; visual implementation requires accepted compositions/prototypes. Tax, liquidity, capacity and operational timing retain their named gates above. Future Virgo outbound automation is optional follow-up and does not delay initial manual payout implementation.

This handoff does not accept unresolved proposals, complete implementation tasks or establish launch readiness. TASKS.md remains the sole execution queue.

Remaining document work, in dependency order:
1. Application stack/modular/API direction and hosting selection are complete. Next prepare repository initialization, pinned versions and foundation task T-23; future native authentication remains separate.
2. Before production calendar activation, finish Sunday handling and the H+2 cutoff; local clock implementation uses an explicit TEST-ONLY versioned policy; shipping holiday exclusion is accepted. Preserve actual event anchors, separate receipt/referral windows from shipping calendars, and do not derive business timezone from Singapore hosting.
3. Before real provider adapters, obtain issuer-provided Virgo and Mengantar integration contracts; CTX-18 owned local simulators do not depend on merchant access. Record supported methods, authentication, replay/idempotency, ambiguous outcomes and sandbox acceptance; public documentation alone cannot close this gate.
4. Implement the delegated mobile/desktop and admin/affiliate direction through prototypes, then rendered verification. Existing design choices are selected; original logo/product photography and screen evidence are not fabricated.
5. Before financial activation and launch, verify quantity-level allocation examples, actual cost/margin floor, funding controls, tax/product obligations, launch sizing and off-host backup/restore targets. Preserve the accepted rounding, replacement-window and manual-payout policies; remaining work is detailed acceptance and verification.

These priorities organize existing gates and tasks, not a second execution queue. Owner selection of the initial server does not resolve commercial demand or load-test acceptance.

## Review history
2026-10-15: Initial cross-domain planning draft. Earlier seller H+2, affiliate monthly/date-5/date-20, H+3, minimum IDR 100,000 and immediate automated-bank-transfer policies are retired alternatives. Current packing milestone is waybill issuance; external transfer is manual initially.

### PR-17 — Distinct mobile shopping experience
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-14
- Statement: Provide dedicated mobile web-app/WebView navigation and screen composition for the multidepartment store, with desktop composition preserved and one backend/business policy.
- Acceptance: Given a mobile buyer, When browsing departments, selecting variants, checking out and returning from payment, Then mobile-specific navigation and recovery work without duplicate orders or lost context; desktop has its own accepted composition.
- Constraints: IAM-1, SEC-1, DATA-1
- Evidence: TEST-33; planned mobile acceptance, no runtime proof.
- Changed at: 2026-10-16
- Change history: Added following owner mobile/WebView and OpenAPI instruction; refined 2026-10-16 under owner direction for app-like mobile navigation, discovery, touch/keyboard behavior and recoverable state.

### PR-18 — First-party client API contract
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-14
- Statement: Maintain a versioned OpenAPI contract for desktop/mobile and future independent clients with explicit inputs, errors, security, idempotency and resource identity.
- Acceptance: Given the staged OpenAPI, When linted and reviewed against accepted policies, Then references resolve, operations are unique and critical authorization/retry contracts are explicit; implementation parity is verified later.
- Constraints: IAM-1, SEC-1, DATA-1
- Evidence: None; contract planning only.
- Changed at: 2026-10-15
- Change history: Added following owner mobile/WebView and OpenAPI instruction.

## Client/API scope and readiness update
Mobile is a distinct shopping composition, not solely stacked desktop. Its own small-screen reflow and accessibility remain required. Future Android/iOS clients motivate the first-party API but native binaries, bridge, push and app-store publication are future work. OpenAPI endpoints are proposed design, not reverse-engineered existing routes or provider endpoints. Exact native authentication issuance/refresh, supported WebView wrappers, return links, provider callbacks, remaining admin/read APIs and financial policy gates block declaring a complete production API.

### PR-19 — Contribution-margin review
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-2
- Statement: The system shall show versioned estimated contribution per sellable offer, including component HPP, packaging, provider/COD fees, applicable affiliate commission, allocated subsidy and explicit return/failed-delivery assumptions; missing costs cannot be treated as zero. Negative or below-configured-floor offers require an audited owner publication/promotion exception.
- Acceptance: Given an offer with missing HPP or contribution below its configured floor, When publication or promotion is requested, Then the admin sees the unknown/low-margin reason and cannot silently approve it; actual posted costs remain distinguishable from estimates.
- Constraints: DATA-1, BILL-1, IAM-1
- Evidence: None; planning only, runtime acceptance pending.
- Changed at: 2026-10-15
- Change history: Added under the owner's instruction to adopt and perfect the recommendations.

### PR-20 — Versioned platform configuration
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-7
- Statement: The system shall scope and version configurable policies with effective time, actor and reason, preserve order/commission/payout snapshots, and restrict sensitive changes to authorized roles. The IDR 99,000 sellable price is a brand invariant rather than an ordinary admin price setting.
- Acceptance: Given an order and queued manual payout created under version A, When authorized staff activate version B, Then the original commercial terms and claimed payout amount/destination remain unchanged and new applicable work uses B with audit history.
- Constraints: DATA-1, IAM-1, SEC-1
- Evidence: None; planning only, runtime acceptance pending.
- Changed at: 2026-10-15
- Change history: Added under the owner's instruction to adopt and perfect the recommendations.

### PR-21 — Commerce exception recovery
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-3
- Statement: The system shall expose recoverable item/shipment-scoped workflows for stock discrepancy, late payment after expiry, failed/refused COD, partial delivery, waybill creation ambiguity and unavailable replacement stock, preserving stock, buyer consent, refund and commission correctness.
- Acceptance: Given a two-shipment order with one delivered and one failed, When staff resolve the failed shipment, Then the delivered offer retains its valid receipt/commission history, affected quantities follow an explicit recovery/refund path, and replay creates no duplicate shipment, cash or stock effect.
- Constraints: DATA-1, BILL-1, IAM-1, SEC-1
- Evidence: None; planning only, runtime acceptance pending.
- Changed at: 2026-10-15
- Change history: Added under the owner's instruction to adopt and perfect the recommendations.

## Catalog, configuration and recovery defaults — owner-delegated
Use an internal department/category/subcategory hierarchy with stable IDs and separate Google taxonomy mapping; do not force buyer navigation to mirror provider taxonomy. Category-specific typed attributes drive filters and product details. Initial departments cover beauty/personal care, electronics, fashion/accessories and future approved physical categories; labels are not an assertion of present inventory. Google mapping, prohibited/unsupported products and actual identifiers require current catalog export validation.

A product listing groups selectable offers/variants. Each offer has its own ID and exact IDR 99,000 price, explicit component list/quantities and warehouse-local availability. Product A x1, Product A x2, and Product A x1 plus B x1 can each be distinct offers costing IDR 99,000. Selecting two offers costs IDR 198,000; components are not extra charged cart lines. Bundles must be complete in one warehouse. No silent substitution or custom-priced add-ons. Bundle return/commission entitlement is the selected offer quantity, with component replacement tracked under its original lineage; BILL-1 owns the financial examples.

Configuration defaults: owner controls affiliate defaults/overrides, policy windows, payout threshold/mode, margin floor and sensitive overrides; scoped ecommerce admins configure approved merchandising/subsidy rules; warehouse calendars/default priority are scoped operational settings. Changes apply prospectively with explicit effective time and snapshots. Current default payout threshold IDR 99,000 does not rewrite past allocated payouts. Fixed retail price, financial history and verified event evidence are not editable configuration. API-driven payouts remain disabled until T-19 and an explicit activation decision. Exact H+2 calendar arithmetic, acceptable margin floors, tax and issued provider contracts remain pending gates.

### Category structure and product facts
Department/category/subcategory are navigation levels; product attributes specialize each leaf rather than creating separate storefront themes. Launch departments/categories activate only when approved real products exist.

| Department family | Example category coverage | Required category-specific product facts |
|---|---|---|
| Beauty and personal care | Skincare, body care, personal-care tools | Contents/volume, ingredients where applicable, batch/expiry and relevant disclosed usage facts |
| Electronics and accessories | Small electronics, device accessories | Compatibility, power/connector, specifications, included accessories and actual warranty terms |
| Fashion and accessories | Clothing, bags, wallets, accessories | Material, dimensions/size, color and size guide where relevant |
| Home and daily living | Home tools, storage, household goods | Material, capacity/dimensions and included quantities |
| Other approved physical departments | Sports/hobbies, stationery, other approved physical categories | Category-specific attributes and actual product obligations reviewed before publication |

These are recommended navigation families, not claims of current stock, product registration or universal legality. A product receives one primary internal leaf and reviewed external taxonomy mapping; collections/tags may cross departments without duplicate catalog IDs. Do not create empty public departments or a price-range filter for an all-IDR-99,000 catalog. Filters use actual published attributes; a complete bundle shows its own title, primary category and all included components.

## Continuous intake and shipping calendar contract — 2026-10-15
Decision: storefront, cart, checkout and order intake remain available every day and at every hour as an operating policy, including national and major holidays. This does not promise 100-percent measured uptime or 24/7 warehouse/customer-service staffing. Stock, unsupported shipping reachability and provider outages remain real boundaries with visible recovery; never show paid/confirmed solely because intake is open.

Decision: shipping H+ counts eligible operational dates, skipping declared public/national holidays and major-holiday closures. Keep successful prepaid payment or confirmed COD as the immutable actionable event. Count H+1 and H+2 on eligible dates after that event's local date; consecutive closures add no counted days. Orders received during a holiday remain in the queue and start consuming eligible H+ dates when operations resume. Waybill issuance, physical preparation, handover and courier transit remain separate milestones. Provider transit estimates do not establish the shop's processing calendar.

Recommendation awaiting timing confirmation: Asia/Jakarta for business display, explicit warehouse IANA timezone, no additional intraday intake cutoff, and end-of-day on the second eligible date for valid-waybill issuance. Sunday handling remains a direct owner clarification; production calendar activation waits for that decision. Under CTX-18, local code and deterministic tests may use an explicit versioned TEST-ONLY Sunday/cutoff policy without recording it as the owner's operational choice. The seven-day return/referral and H+10 receipt-maturity policies keep their existing anchors and are not extended by shipping holidays; exact duration recommendations remain in the timing gate. Calendar closures are versioned with source/year, scope, publisher/approver and effective time. Snapshot calendar version and due timestamps per shipment. A later closure correction requires an audited reschedule and buyer explanation, never silent removal of an existing overdue event.

## Admin management and financial truth — 2026-10-15
Decision under owner-delegated recommendation: use one role-scoped administration application with Owner displayed as Super Admin. Owner can inspect company-wide order history, stock, costs, contribution and financial obligations; finance performs reconciliation and authorized money operations, warehouse users manage assigned physical stock movements, and ecommerce admins manage catalog/merchandising within permissions. This is one company, not multiple tenants or competing finance systems. IAM-1 owns exact access boundaries.

HPP/component purchase cost, packaging/variable-cost assumptions, stock receipts/count corrections, subsidy budgets and margin floors are administered with actor/reason/effective versions. Ordinary ecommerce-admin/warehouse screens never expose private bank evidence or broad financial-cost editing by default. Stock is corrected through movements and counted evidence, not by changing a free-form available-stock number. Profit is derived; no editable profit or manual arbitrary order-total field. Current HPP/settings changes affect prospective valuation/quotes and cannot rewrite historical order snapshots, realized postings or affiliate allocations. Historical corrections append linked adjustments. Unknown cost stays unknown. BILL-1 distinguishes estimated contribution, actual contribution, operating expenses and received cash.

### PR-22 — Native website buyer and customer-service chat
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-15
- Statement: Provide private website-native buyer/guest-to-CS conversations with durable message history, unread/read state, safe image attachments, typed product/order context cards, reply-to and authorized history search; CS manages the inbox, exclusive assignment and resolution in the internal admin. Customers can submit messages 24/7 while staffed response hours are shown truthfully.
- Acceptance: Given a verified conversation participant and two CS agents, When a message send is retried after connection loss and both agents claim the thread, Then one message persists, one claim wins, reconnection restores ordered history and only the claimant can send a staff reply. Given another buyer or a forged order/attachment reference, When history, stream, upload or context linking is requested, Then access is denied. Given an internal staff note, When the buyer reads history or events, Then the note and its existence are not exposed.
- Constraints: DATA-1, IAM-1, SEC-1, PRIV-1, UX-1, UX-2, API-1, PR-16
- Evidence: None; document/schema planning only.
- Changed at: 2026-10-15
- Change history: Added after owner clarified website-native ecommerce chat; expanded 2026-10-15 under the explicit Markdown completeness request for marketplace-style features, UI/UX and mobile requirements.

## Native chat scope and defaults
Chat is between the customer and Serba 99ribu CS, not buyer/seller marketplace messaging. Customers enter from a storefront chat button, product detail or their verified order detail; staff use the CS inbox in the same role-scoped admin. No WhatsApp dependency, phone-number handoff or external messaging provider is required. The chosen public/internal host layout remains a deployment contract, not a new chat subdomain.

Allow presales chat without forced account creation or purchase, using a server-issued opaque browser-session guest capability. Guest checkout remains unchanged. Losing the guest session does not permit recovery by conversation/order number alone; verified contact or sign-in is required, and unverified old threads cannot be auto-merged into a new account. Product links grant no order access. Order context requires existing verified buyer/guest order authorization; linking/relinking is audited and never transfers conversation ownership.

Initial message scope: plain text up to 4,000 characters, or up to three validated private JPEG/PNG/WebP images of at most 5 MiB each; reject empty/whitespace-only messages without an attachment. No arbitrary HTML, executable uploads, remote URL fetching, voice/video, AI agent or WhatsApp synchronization is included. Rate limits, private image validation/scan and explicit abuse handling protect anonymous intake without silently requiring every shopper to register. Exact staffing/response target and approved retention duration remain launch inputs.

Conversation state is open, waiting_customer or resolved. A new accepted customer message reopens a resolved thread; assignment follows the current versioned rule, never a stale claim. Exclusive CS claim/handoff guards outgoing replies; internal notes are separate private staff records. A message is sent only after durable commit; read means a participant's monotonic acknowledged read position, not merely an open socket. No fake typing/online status. Message contents do not authorize refunds, paid status, inventory changes or other financial mutations. Escalation links to existing authorized case workflows.

## Complete website-chat feature baseline — PR-22
Owner direction 2026-10-15: complete the Markdown requirements, including marketplace-style customer experience and dedicated mobile behavior. The following extends PR-22; it is required scope for T-24/T-25 unless explicitly labelled optional. It is not a second task queue or a claim of API/UI implementation.

| Capability | Required behavior and limits | Completion criterion |
|---|---|---|
| Conversation list and entry | Storefront support entry, buyer conversation list, PDP context and verified order entry; each thread has last public message, time, status, own unread and safe context summary. Starting/reopening preserves existing relevant threads and prevents duplicate create retries. | Guest/buyer can return to authorized history without duplicate threads; no other customer preview appears. |
| Public messages and replies | Text/image messages keep stable identities and server sequence. Reply-to references one visible committed public message in the same thread, with a bounded safe quote and jump-to-message. Sent content is not silently edited; corrections are new messages. | Cross-thread/note/uncommitted reply references fail; redacted/expired quoted content becomes a neutral tombstone, not a retained secret. |
| Product and order cards | Buyer explicitly previews/sends a published product/selected offer card or a verified own-order card. Product facts distinguish sent-time snapshot from current price/availability. Orders show only support-relevant authorized facts. | Merely opening chat does not send a card. Deleted/unavailable product has a readable fallback; opening order detail rechecks authorization. A card neither reserves stock nor changes an order. |
| Search and history | Search customer's own public messages within an authorized thread and return bounded results; CS searches only permitted public threads. Match opens the target while preserving query/return position. Internal-note search is a distinct staff-only surface. | No-result, expired/redacted result and permission-loss recovery are clear; queries cannot enumerate customers or disclose staff notes. |
| Composer and drafts | Bounded multiline text, reply/context preview and image preview/remove; explicit Send; preserve thread-specific draft and original client_message_id for uncertain sends. Public reply and internal-note drafts are visibly separate. | Changing thread or principal never sends another person's draft; offline/failed state offers deliberate retry and never silently auto-sends after reconnect. |
| Message and connection status | Distinguish local draft, sending, durably sent, read by the counterparty, failed and unknown outcome. Reconnect/resync deduplicates both HTTP retries and replayed events. | A timeout does not mean failed commit; same-ID retry reconciles the original message. Own read, socket open or another agent's personal read does not counterfeit the wrong receipt. |
| Private images | Preview/remove before sending; validate actual type, size, scan state and conversation ownership; support progress, retry, rejection and authorized accessible image viewer. | At most three JPEG/PNG/WebP images of 5 MiB each; a removed/rejected/unready image cannot be sent. Screenshot images never prove payment/refund success. |
| Notification and unread | Required in-app inbox badge/notification center, per-participant unread and deduplication. Seen notification is separate from read message. Optional sound is user-controlled and never the only signal. | Tapping notification opens only an authorized thread; stale notifications recover safely. No message/order/image content is exposed through public/lockscreen previews. |
| Personal archive and mute | Customer can archive/unarchive or mute/unmute their own thread list without deleting shared history or changing the CS queue. New customer-visible message resurfaces an archived thread; mute affects attention alerts, not access, unread or delivery. | Customer's preference never closes/reassigns support work or hides a message from staff. Muted unread remains visible on opening the list. |
| CS work queue | Unassigned, mine, waiting-customer and resolved views; authorized search/filter by status, assignee, internal tag/priority and age. Claim, release, handoff and resolution are version checked and auditable. | Two agents cannot own the same active reply claim. A new buyer message reopens the thread without losing history; resolution does not mutate order/refund status. |
| CS productivity | Shared versioned saved replies inserted manually as editable draft; internal tags/priority, separate notes and authorized product/order/return escalation links. Owner governs templates/access; CS uses granted tools. | Template insertion never auto-sends or leaks another customer's placeholders. Internal metadata never appears in public events/counts/timestamps. |
| Mobile and accessibility | Dedicated list/thread composition, clear Back, safe-area/keyboard-aware composer, stable history scroll, image preview/viewer, accessible actions and recoverable loading/errors. | Required mobile matrix in UX contracts passes; chat does not cover checkout controls or steal focus on incoming messages. |
| Availability and abuse recovery | 24/7 durable message intake, configured CS staffed hours, honest away/unavailable state and rate-limited abuse handling. | No invented immediate response or online agent. Restrictions show a recoverable explanation without deleting existing legitimate history. |

Optional enhancements: genuine heartbeat-backed online/typing state and browser push after explicit user opt-in. These are not required to send/read messages; absence/denial/unsupported browser must leave core chat working. Voice/video, WhatsApp synchronization and automated AI replies are separate future scope, not implicit marketplace requirements.

## Chat acceptance examples — required, not executed
- Given a buyer on a product page with an unsent general-chat draft, When chat is opened and a product card is previewed, Then no message/card is sent until explicit Send and the draft remains tied to its original thread.
- Given a message linked to an order, When another logged-in customer opens its conversation, quote, card, search result or notification, Then no history or order facts are disclosed.
- Given a buyer scrolling old messages, When a reply arrives and earlier history is loaded, Then scroll remains anchored, a new-message control appears and no focus or keyboard is stolen.
- Given intermittent mobile connectivity and an image upload, When the server committed a send but the response was lost, Then retry reconciles one message and preserves input/image recovery without silently sending a second payload.
- Given a CS saved reply with unavailable order placeholders, When inserted, Then unresolved placeholders are flagged before Send; it cannot inherit a prior customer's values.
- Given a resolved or archived/muted thread, When a new public message arrives, Then support status, personal list visibility and notification preference follow their separate rules without losing history.
- Given an internal note/tag/priority change, When the customer refreshes history, search, notification badge or stream, Then private activity is absent from public payloads and public update counters.
- Given text enlargement, on-screen keyboard, rotation, browser Back or device/session switching, When the mobile buyer navigates list/thread/image/recovery, Then essential actions remain reachable and the correct principal's draft/history are preserved or safely locked.

Wire-coverage boundary: the existing OpenAPI covers the previously defined core chat. The additional Markdown features require the explicit API delta in 09-API-SPECIFICATION.md during T-24; no handler can assume unspecified wire fields already exist.

### Conversation continuity and explicit context
Recommended thread selection: a product entry offers the customer's existing general/presales conversation; a verified order entry offers its relevant authorized order conversation. Show existing/reopen choices rather than generating a new thread on every product view. Explicit start/create is idempotent and concurrent starts for the same principal/context must converge on one logical active conversation. A thread always belongs to its customer principal; changing its current primary context does not rewrite older product/order cards or message ownership. Every sent order card retains its own verified resource reference and is reauthorized when opened.

Context-only send includes a safe nonblank description visible in the preview; it does not bypass the existing nonblank-text-or-ready-image rule. Reply quote/context can be removed before sending without altering the original message or order. Primary message sent/read state stays attached to the committed message, not the changing product's stock or card preview.

### PR-23 — Cross-platform advertising signal integrity
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-16
- Statement: The system shall measure the storefront funnel and report eligible verified prepaid receipts and actual COD collections to Meta, Google and TikTok through consent-aware, deduplicated adapters and a durable outbox. Page visits, order placement, delivery and bank settlement alone shall not create Purchase. Advertising attribution shall remain separate from affiliate credit.
- Acceptance: Given a prepaid success with a duplicate callback and a split COD order with two distinct collections, When callbacks, worker retries and thank-you reloads occur, Then one prepaid purchase instance and two non-overlapping COD purchase instances exist internally; eligible platform deliveries reuse their original identities, merchandise value is allocated once, and declined consent suppresses advertising without blocking commerce. A refused uncollected COD parcel creates no Purchase.
- Constraints: DATA-1, BILL-1, SEC-1, PRIV-1, IAM-1, OBS-1, API-1
- Evidence: TEST-26, TEST-27, TEST-28, TEST-29, TEST-30; execution pending.
- Changed at: 2026-10-16
- Change history: Owner-authorized researched Markdown expansion; actual platform/API/account compatibility remains a pre-implementation gate.

### PR-24 — Thank-you and recoverable order-status experience
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-16
- Statement: After authoritative order creation or reconciled payment return, the system shall present a private responsive thank-you/order-status experience with distinct order, payment and parcel states, disclosed totals and context-appropriate recovery/help. It shall not require account creation, optional email, marketing consent or advertising delivery to show the buyer's authorized result.
- Acceptance: Given an accepted guest COD order or prepaid return preceding its webhook, When the buyer opens, reloads or resumes the result on mobile/tablet/desktop, Then COD states the per-parcel cash still due, prepaid shows its authoritative pending status until verified, and neither page load nor duplicate return creates another order/payment/Purchase. Expired or unauthorized access reveals no private order details and offers verified recovery.
- Constraints: PR-4, PR-5, PR-6, PR-17, PR-21, PR-22, PR-23, IAM-1, UX-1, UI-1, PRIV-1
- Evidence: TEST-32; execution pending.
- Changed at: 2026-10-16
- Change history: Added researched thank-you and ongoing status contract; screen composition is owned by documents 10 and 17.

### PR-25 — 99ribu-branded carrier-safe label printing
- Status: Accepted
- Owner: Paduka Ongki
- Source: CTX-17
- Statement: The system shall provide scoped single/batch preview, download, printing and audited reprinting of 99ribu-branded parcel labels using issued Mengantar/carrier shipment data. Requested masking concerns commercial presentation, not removal or alteration of required carrier barcode/AWB, routing, sender/recipient, return routing or COD data. Label printing shall not create another shipment, collect payment or mark physical handover.
- Acceptance: Given two warehouse parcels with distinct issued AWBs, When eligible warehouse staff print a supported approved 99ribu template and reprint after an ambiguous printer outcome, Then each page maps to its original parcel/AWB and exact COD amount, reprint creates no new waybill/charge, and out-of-scope parcels are denied. If branding capability is unverified, the UI exposes the approval gate and an original label plus separate 99ribu branding fallback rather than claiming full masking succeeded.
- Constraints: PR-3, PR-5, PR-6, DATA-1, IAM-1, API-1, SEC-1, PRIV-1, UX-2, UI-1
- Evidence: TEST-36, TEST-37; execution pending.
- Changed at: 2026-10-16
- Change history: Added requested 99ribu label identity and provider-safe printing boundary; actual per-carrier template approval remains unresolved.

## Indonesia dashboard and buyer completion amendment — 2026-10-16
Decision under CTX-17: PR-13/PR-14 now include the detailed role-home/work-queue and buyer Account contracts in documents10/17, with own profile, optional reusable address book, verified contact changes and guest-order linking. Use Bahasa Indonesia product labels, id-ID/IDR and explicit business/warehouse timezone. Do not collect KTP/NIK, bank/payment credentials or demographic profile data merely to browse/buy. Guest checkout remains available; optional account tools do not become purchase prerequisites. T-34/T-35 implement these surfaces and wire changes only after API-1 synchronization.

### Additional owned implementation gates
| Gate | Owner and deadline | Required evidence |
|---|---|---|
|99ribu masked label support | [TBD owner=Integration owner; due=before branded label activation] | Carrier/account-specific template permissions, issued field/barcode specification, actual accepted sample and original-label fallback; public docs do not establish masking API |
| Buyer identity/contact recovery | [TBD owner=Engineering owner; due=before account implementation] | Supported Better Auth identity model, genuine delivery/verification channel and change/recovery procedures; no invented SMS/WhatsApp capability |
| Label hardware and format | [TBD owner=Operations owner; due=before label release] | Actual printer/stock size, PDF rendering/scanning and carrier acceptance per enabled service;100x150mm is not ISO A6 |
| Admin metric policy | [TBD owner=Finance owner; due=before dashboard acceptance] | Snapshot period/timezone, cost completeness and estimated versus posted contribution rules consistent with ledger |


## Current delivery target amendment —2026-10-16
CTX-18 sets localhost as the next milestone. Existing production/merchant/hardware requirements remain later gates. Local development uses actual auth, PostgreSQL and domain/worker behavior with synthetic fixtures and simulated external effects; no secrets, live accounts or hosting are required to prove the local journey. First close wire/fixture contracts, then foundation T-23 and scenario work T-38, followed by incremental feature slices and assembled local acceptance T-39. Prospective npm commands become executable only during implementation. No application implementation or deployment is claimed by this planning update. Earlier merchant-contract and production-budget gates do not block the local foundation or owned simulator work; they still block their actual external activation.
