# UX Flows and Screen Contracts — Serba 99ribu

## Document Control

| Field | Value |
|---|---|
| Owner | Product UX owner |
| Status | Selected contracts; S07 document review, rendered acceptance pending |
| Updated | 2026-10-16 |
| Source | CTX-11 |
| Scope | Guest/buyer, owner, catalog/operations, warehouse, customer service, finance, affiliate |

## Boundary and Context

Proposal: the contracts below translate owner decisions into observable work. [02-PRD.md](02-PRD.md) remains authoritative for commercial rules, [05-DATA-MODEL.md](05-DATA-MODEL.md) for object lifecycle, and [07-IAM-RBAC-ABAC.md](07-IAM-RBAC-ABAC.md) for authorization. The present screens do not establish additional roles, thresholds, guarantees, or provider capabilities. Route names remain implementation details; the selected Next.js stack uses shadcn/ui for the internal admin component source.

Decision context: one company sells physical goods from its own national warehouse network. Buyers can purchase without an account. Orders may have separate warehouse shipments; COD must show per-shipment amounts. Affiliate commission uses first-click attribution, receipt-based eligibility, and automatic eligibility H+10 after verified buyer receipt, a Rp99.000 minimum and initial manual finance transfer, as owned by product requirements.

Unknown: direct audience/device research, actual provider checkout interaction, and future outbound payout capability. Existing bounded pattern research is recorded in the design document. The owner delegated design choices and accepted the recommended Next.js/PostgreSQL stack on 2026-10-15; selected compositions are documented without claiming prototype acceptance. No product interface is implemented or visually verified. S04–S06 verify the local identity API/cookie/worker foundation only. The selected presentation contract is in [10-DESIGN-SYSTEM-WHITELABEL.md](10-DESIGN-SYSTEM-WHITELABEL.md).

## Requirements

### UX-1 — Buyer purchase and recovery

- Status: Accepted
- Owner: Product UX owner
- Source: CTX-11
- Statement: Buyers shall discover and configure a physical product, checkout as a guest, review every shipment and payable amount, distinguish payment from order confirmation, and recover tracking/return access without mandatory account creation.
- Acceptance: Given a two-warehouse cart, when a guest enters a supported destination and selects COD or prepaid, then every package, shipping/subsidy allocation and payable total is visible before confirmation; unavailable routes, changed stock, expired quotes and unknown payment outcomes preserve safe input and offer a valid next step. Given a delivered item, a verified buyer can submit a permitted return claim and follow refund or replacement history.
- Constraints: PR-4, PR-5, PR-7, DATA-1, IAM-1; personal addresses and payment details are not exposed through public order identifiers.
- Evidence: Not executed; requires guest checkout and post-purchase browser scenarios after implementation.
- Change history: 2026-10-15 — initial proposal.

### UX-2 — Scoped operations and exception handling

- Status: Accepted
- Owner: Product UX owner
- Source: CTX-11
- Statement: Authorized staff shall process catalog, stock, warehouse fulfillment, return, and finance work through scope-aware queues, detail histories, and guarded actions with explicit pending, conflict and unknown outcomes.
- Acceptance: Given staff scoped to one warehouse, when they use list, detail, deep link or mutation controls, then only permitted warehouse work is accessible; cross-warehouse access is denied without leaking personal data. Given a stock conflict or provider timeout, then retained data and the next recovery action are visible and the UI does not falsely report a shipment, refund or payout as completed.
- Constraints: PR-6, PR-7, PR-10, DATA-1, IAM-1; controls do not grant authorization; delivery timestamps cannot be freely edited to unlock commission.
- Evidence: Not executed; requires role/scoping and financial-exception browser scenarios after implementation.
- Change history: 2026-10-15 — initial proposal.

### UX-3 — Affiliate commission explanation and payout visibility

- Status: Accepted
- Owner: Product UX owner
- Source: CTX-11
- Statement: Affiliates shall register, obtain a valid referral link, maintain an approved payout destination, and understand each attributed item's commission and payout history without buyer personal information.
- Acceptance: Given a replacement flow, when replacement receipt is verified, then the item report identifies that receipt as the new eligibility anchor and displays the resulting eligibility date and hold explanation. Given a payout threshold not reached, then accumulated eligible funds remain visible; given manual finance transfer processing after automatic eligibility and the Rp99.000 minimum, then allocated funds are in flight rather than simultaneously spendable, and an unknown transfer outcome is not marked paid.
- Constraints: PR-8, PR-9, PR-10, DATA-1, IAM-1; no buyer name, full address, phone, bank data, or cookie identifier in affiliate reports.
- Evidence: Not executed; requires affiliate onboarding, replacement, threshold and payout-state browser scenarios after implementation.
- Change history: 2026-10-15 — initial proposal.

## Actors and First Success

| Actor | Job and scope | First-use path | Observable first success |
|---|---|---|---|
| Guest/buyer | Purchase and resolve own items | Catalog → listing/sellable option → cart → address/shipping → payment choice → confirmation | Confirmed order with shipment breakdown; payment state stated separately |
| Super Admin (owner) | Govern one company; view full order history, finance, cost and stock across its warehouses | Review readiness and exceptions → full history/finance/settings | Readiness gaps and financial discrepancies are visible; controlled changes have scope, effective version and audit history |
| Catalog/operations | Maintain catalog, cost proposals and availability within granted scope; no private finance access by default | Create product/variant → attach category/warehouse data → validate → publish | Eligible product visible with valid price and fulfillment data |
| Warehouse staff | Process assigned warehouse work | Assigned queue → shipment detail → valid waybill issued (packing milestone) → physical handoff | Valid tracking issued by H+2; separate actual handoff with history |
| Customer service | Resolve own authorized case queue | Return request → evidence/order review → permitted decision | Reasoned decision or escalated case with next step |
| Finance | Reconcile provider money and exceptions | Unmatched transaction or payout queue → source/detail → action | Matched record or explicit unresolved discrepancy |
| Affiliate | Promote and understand earned funds | Automatic registration → link → payout destination setup | Valid referral link and explanation of commission lifecycle |

Proposal: empty first-use screens show the next actual setup action. Empty search/filter results show reset controls rather than an onboarding checklist. Numeric traffic, staff volumes and SLAs beyond accepted product policy are unknown.

## Journey and Exception Map

| Journey | Happy path | Exceptions and recovery | Completion |
|---|---|---|---|
| Purchase | Discovery → variant → cart → destination → warehouse/shipping quote → prepaid/COD → confirmed order | Sold-out line; invalid destination; quote stale; COD unavailable; provider timeout; duplicate submit | Authoritative order reference and payment/fulfillment state |
| Prepaid return | Provider handoff → safe return → server-verified result | Back navigation; pending webhook; failed/expired payment; outcome unknown | Paid only after authoritative confirmation; otherwise show pending/retry route |
| COD receipt | Confirmation → cash amounts per package → tracking → delivery | Address clarification; missed delivery; one package fails while another succeeds | Item-level receipt or terminal exception, not premature whole-order completion |
| Return/refund | Secure lookup → eligible items → reason/evidence → decision → return if required → refund | Deadline elapsed; insufficient evidence; partial claim; provider outcome unknown | Refund recorded separately from request approval |
| Replacement | Approved claim → replacement shipment → verified receipt → commission eligibility recalculated | Replacement unavailable; delivery failure; new claim | Replacement history retained; no duplicate commission |
| Affiliate payout | Referral → attributable order → verified receipt → H+10 eligibility → Rp99.000 minimum → finance manual transfer | Return hold; reversal; threshold not met; destination issue; ambiguous transfer outcome | Evidence-backed confirmed manual transfer or explicit actionable exception |

## Screen Inventory and Contracts

Proposal: every material screen inherits the common state and accessibility contracts below. Each row defines its primary job, scoped data and recovery; exact paths are implementation details of the selected architecture. All internal screens belong to one role-scoped admin application; Super Admin is the owner label, not a second application.

| Screen | Actor, data and entry | Actions and completion | Material states/recovery |
|---|---|---|---|
| Catalog/search | Public; published products, categories, query and availability | Search/filter/sort; open product; preserve URL filter and back context | Loading, first catalog empty, no matches, partial result, dependency error with retry |
| Product detail | Public deep link; listing, sellable options/variants, included component quantities, Rp99.000 option price, verified claims, availability | Choose option/quantity; inspect contents; add one parent cart line; restore selected option | Missing media, invalid variant, sold out, stale stock; explain and retain other choices |
| Cart | Buyer-owned cart; backend line identity, purchased-option quantity, subordinate contents and item totals | Change/remove lines; continue checkout | Empty, pending line update, successful lines with partial failure, multi-tab conflict; refresh changed values |
| Checkout | Cart → destination; warehouse allocations, quotes, subsidy, payment eligibility | Review every package and total; confirm authoritative order | Address errors, no route, stale quote/stock, invalid COD combination, submitting, unknown creation outcome; preserve safe input and look up result before retry |
| Payment/confirmation | Verified order reference and selected provider method | Continue permitted payment; view order/tracking | Pending, paid, failed, expired, unknown; redirect return alone never confirms payment |
| Tracking/order detail | Secure guest access or authenticated owner; item/package history | Track each package, view exact COD due, report delivery issue, start eligible claim | Partial delivery, failed delivery, stale carrier data, denied access, refund/replacement timeline |
| Return request/detail | Secure order access; eligible items, paid cost allocation, reason/evidence | Submit claim, add requested evidence, choose offered resolution, track progress | Invalid item/deadline, duplicate active request, upload error, review, rejected reason, approved, return transit, refund pending, replacement receipt |
| Affiliate registration/profile | Public registration then authenticated own identity | Register automatically; obtain referral link; verify/change payout destination | Validation/duplicate, verification pending, destination invalid; preserve non-sensitive fields |
| Affiliate dashboard/report | Own aggregated balances and pseudonymous item references | Filter/open commission detail; copy referral link | No referrals versus no matches; pending/held/eligible/in-flight/paid/reversed; freshness and reason shown |
| Affiliate commission/payout detail | Own item attribution, rate snapshot, receipt timeline, eligibility date, payout status | Inspect explanation/history; resolve permitted destination issue | Replacement resets anchor; active claim holds item; below minimum; transfer unknown or failed; no manual duplicate-payout control |
| Operations readiness | Super Admin; real configuration/catalog/warehouse readiness | Follow missing setup; inspect blocked fulfillment | No warehouse/catalog versus disabled provider; show setup requirement without displaying credentials |
| Product editor | Catalog role; product/variant, category mapping, media rights, specifications, stock linkage | Save draft, validate, publish/unpublish | Validation, conflict, missing shipping/variant fields, sync pending/rejected; retain draft and source error |
| Inventory/transfer | Warehouse-scoped staff; SKU balances and movements | Receive, reasoned adjust, transfer dispatch/receive; inspect history | Reservation conflict, insufficient stock, in-transit discrepancy, quarantine; no silent destructive balance overwrite |
| Fulfillment queue/detail | Assigned warehouse; order items, valid-waybill deadline, delivery address for that job, label/tracking | Pick/pack and issue valid tracking by H+2; record physical handoff separately | Deadline warning, insufficient stock, label request pending/unknown, courier error, reallocation escalation; do not fabricate receipt |
| Return case queue/detail | Authorized CS/warehouse; claim, evidence, original/replacement shipment | Request evidence, reasoned decision, inspection, approved replacement/refund handoff | Conflict, partial return, disputed evidence, replacement unavailable; maintain decision and item history |
| Finance reconciliation | Finance; provider source references, amounts/fees, accounting match status | Match/escalate discrepancies; view refund and payout outcomes | Waiting settlement, unmatched/mismatched, duplicate event, unknown refund/transfer; posted facts corrected through recorded adjustments |
| Company/access/promo settings | Authorized Super Admin or explicitly delegated administrator; users/scopes, default and special rates, subsidy configuration | Preview impact and explicitly save controlled changes | Invalid scope, unsaved edits, version conflict, forbidden action; secrets entered only through separately approved secure operations |

## Common Screen State and Navigation Contract

Proposal: initial loading reserves geometry; refresh retains safe existing data with freshness indication. Error screens offer retry/back and do not erase safe input. Denied or missing objects disclose no buyer data. Mutations show pending and prevent duplicate submissions; conflicts require reload/review rather than silent overwrite. Offline state cannot imply that a financial action completed.

Proposal: search, filters, paging and tabs are URL-addressable where useful; do not encode personal data, tokens or payment details in query strings. Back preserves list filters and context. Unsaved significant edits prompt save/discard/cancel. Secure guest access uses the approved identity contract, never a guessable order number alone. Authentication returns users to the authorized intended destination without losing safe progress.

## Action Specification

All rows are Proposal; server validation is authoritative. A single pending action has a stable operation identity; safe retries recover that operation rather than create duplicates.

| Action | Validation | Pending | Success and next screen | Failure/recovery |
|---|---|---|---|---|
| Add/change/remove cart line | Valid variant, quantity and latest availability | Busy affected line | Authoritative cart total; remain cart/PDP | Preserve other lines; identify conflict and retry affected line |
| Request shipping/requote | Destination and reservable items | Quote loading, order submission waits | Package-level quotes on checkout | Retain address; unsupported coverage or retry; previous quote labeled stale |
| Confirm order | Current stock, quote, COD eligibility, totals and subsidy | Disable repeat confirmation | Reference to order confirmation/payment handoff | Unknown result lookup before retry; map validation to fields |
| Continue payment | Existing unpaid order and valid provider session | Handoff indicator | Provider screen then safe return | Expired or unavailable method; retain order reference; no success claim |
| Submit return/evidence | Own order access, item eligibility, reason and safe file checks | Upload/request progress | Return detail/reference | Preserve text; retry failed attachment; duplicate request opens existing case |
| Register/copy referral | Unique permitted identity; valid referral record | Registration pending | Own affiliate link/profile; copying reports result | Explain errors; manual copy fallback |
| Change payout destination | Authenticated affiliate; accepted destination checks and reauthentication | Verification/change pending | Masked destination with verification status | No payout to unverified replacement; show recovery without full account exposure |
| Save/publish product | Scope, required product/variant and shipping data | Save/publish pending | Version and publication state on detail | Preserve draft; conflict diff/reload; publication not assumed on timeout |
| Adjust/transfer inventory | Scope, available quantity, reason and expected version | Movement pending | Movement reference and updated balance/history | Insufficient stock/version conflict; retain reason; reconcile uncertain operation |
| Issue waybill / record physical handoff | Warehouse scope, complete assigned option contents, valid transition and provider data | Separate operation progress for issuance and handoff | Valid tracking and issued time satisfy packing milestone; handoff has its own actual timestamp | Pending/unknown label is not issued; check existing shipment before retry; no false in-transit state |
| Decide/inspect return | Role, active case, evidence, item scope and decision reason | Decision pending | Case history plus next authorized action | Conflict reload; never imply refund already paid |
| Initiate approved refund | Finance scope, approval, remaining refundable amount and allocation | Refund pending | Refund detail with provider-confirmed outcome | Unknown status lookup; no blind second refund |
| Reconcile finance entry | Role, source references, amounts and unapplied record | Match pending | Match/exception reference on detail | Retain discrepancy; do not edit away posted history |
| Save rates/subsidy/access | Authorized scope, bounds, dates and current version | Explicit save pending | Saved version and audit summary | Preserve edit; show validation/conflict; changes do not rewrite historical orders |
| Record manual affiliate transfer | Finance scope, H+10 eligible commission, Rp99.000 minimum, valid destination, allocated balance and transfer evidence | Awaiting manual transfer, then processing with allocated funds | Paid only after evidence-backed confirmed bank result and recorded actor/reference | Unknown stays processing; reconcile existing transfer before retry; no buyer data exposed |

## Permission and Visibility Matrix

Proposal: IAM remains canonical; UI visibility alone never authorizes an action.

| Object/state | Viewer and scope | Visible/action boundary | Recovery/audit |
|---|---|---|---|
| Buyer order | Verified guest or authenticated buyer owning order | Own packages, payment, return actions | Invalid access denied without existence or PII leakage |
| Warehouse shipment | Assigned warehouse staff | Fulfillment data needed for assigned job; no affiliate bank records | Cross-warehouse deep link and mutation denied; recorded escalation |
| Return case | Authorized CS and assigned inspection staff | Evidence and decision controls according to role | Decision reason and operator recorded; financial execution separately guarded |
| Commission | Owning affiliate | Pseudonymous reference, product/quantity, rate, amount, state, hold reason, dates | No address, phone, buyer identity, or sensitive dispute evidence |
| Refund/payout | Finance and permitted owner | Amount, masked destination, source/result and exception | Audit actor/action/result; unknown status cannot be relabeled success manually |
| Commercial configuration | Authorized owner/admin | Explicit current scope and effective version | Forbidden changes rejected server-side; historical snapshots unchanged |

## Responsive, Accessibility and Content Contract

Decision context CTX-14: mobile shopping is a distinct web-app/WebView experience, not the desktop page reduced or stacked. Proposal: use the mobile contracts below for mobile composition; within each product mode, viewport adaptation preserves accessible reflow and task capability. Verify mobile mode at 320 and 390 CSS pixels, landscape and 200% zoom, and desktop mode at 1280 CSS pixels. Internal operator tables may adapt responsively; this does not substitute for the separate buyer/affiliate mobile experience. Amounts, currency, state, reasons and package totals remain available in every mode.

Proposal: use semantic forms, tables and headings; associated errors and autofill; keyboard-operable filters, media and dialogs; visible focus and predictable focus restoration. Asynchronous totals and status changes use restrained announcements. Do not require hover, dragging, swiping or color recognition. Sticky actions cannot cover errors or focused controls. Buyer-facing copy is Bahasa Indonesia; staff/affiliate terminology must be consistent across notifications and timelines.

Proposal: COD confirmation states exact cash per shipment, courier and available estimate, and offers a minimal share/copy summary for the receiving household. Sharing never includes private tracking credentials or unnecessary personal details. Tracking exceptions show a help route; rescheduling/address correction controls appear only if supported by policy/provider capability.

## Measurement and Privacy

Proposal: critical outcomes are product evaluation, cart change, checkout attempt, confirmed order/payment, delivery exception, return submission, eligible commission and payout outcome. Product/operations owns interpretation; privacy review controls collection. Never send form values, buyer addresses, bank details, referral cookies, tokens or evidence uploads to analytics. Client redirects and clicks are not payment/payout confirmation. Business events need stable deduplication references and consent behavior before implementation.

## Open Gates and Verification Plan

| Item | Status and owner | Gate |
|---|---|---|
| Production/local pattern research and final composition | Existing bounded references and compositions selected under owner delegation; design owner | Rendered prototype review and design gate before visual delivery |
| Authentication and secure guest recovery mechanism | Email/password cookie foundation verified in S04–S06; guest recovery, staff MFA and optional-email account completion remain IAM/frontend owners | S09/S10/S11 establish supported boundaries; S24/S27/S46 verify consuming journeys |
| Provider COD split, payment handoff and refund capabilities; future Virgo outbound/disbursement feasibility | External compatibility unknown; integration owner. Local behavior uses the accepted simulated adapters | Local journeys may be accepted with explicit simulated evidence; real activation requires separate provider acceptance |
| Role names and object coverage against data/IAM | Super Admin owner label and shared role-scoped admin selected; product UX/IAM owner | Enforce object/action scopes and verify denial cases before task acceptance |
| Browser/accessibility evidence for all four UX declarations | Not executed; frontend owner | After implementation, before UX marked verified |

Acceptance scenario set: guest two-warehouse prepaid and COD; one route COD-ineligible; stale quote and concurrent stock loss; payment return before webhook; guest denied order access; warehouse cross-scope denial; partial receipt and return; replacement receipt anchor; affiliate balance below/at threshold; payout timeout and duplicate callback; keyboard/narrow viewport recovery. These are planned scenarios, not executed tests or evidence IDs. Design-choice and recommended-stack decisions are resolved by owner delegation. Provider/policy readiness and rendered browser verification remain independent gates.

## Change Log

| Date | Change | Approval |
|---|---|---|
| 2026-10-15 | Initial buyer, operator and affiliate workflow proposal | Pending owner review |

## Presentation refinement — 2026-10-15 proposal
Storefront emphasizes search and category/attribute discovery because prices are equal. Sorting proposal: relevance, newest and actual popularity only when measured; no manufactured bestseller count. PDP attributes vary by category: skincare ingredients/size/expiry facts, electronics specification/compatibility/warranty, and fashion size/material with clear variant validation.

Operations landing is a role-specific work queue: packing due/overdue, handover pending, delivery exceptions and returns needing action. Finance lands on unmatched settlements/refunds and payout exceptions. Owner reporting can include trend charts only when a specific business question warrants them.

Affiliate landing explains automatic H+10 eligibility, the Rp99.000 minimum and initial manual finance transfer rather than offering a withdrawal flow or promising automatic bank transfers. Item history includes original/replacement receipt lineage, hold reason, eligibility date, commission rate snapshot and transfer outcome. In-flight amounts are not also available balance. Privacy-sensitive dispute details remain hidden.

Prototype review set before visual implementation acceptance: distinct mobile and desktop home, category/search, product detail, two-warehouse checkout including COD, order/return detail and affiliate dashboard with a replacement hold, plus responsive warehouse queue/detail. Follow UI-1 and the researched proposal in the existing design-system document. These are proposed screens for review; no application/prototype code is created by this update.

## Ad-to-purchase journey contract — 2026-10-15
Owner-directed scope refinement: PR-14 experience and PR-15 catalog distribution must work coherently with Meta, Google and TikTok acquisition.

An advertised product/variant links directly to its matching product detail page; a bundle links to exact bundle contents and price. Category campaigns may link to a relevant category. Do not force every campaign through home. Preserve genuine campaign/referral parameters through permitted navigation and checkout, with validation and privacy controls. Changing device/in-app browser can lose attribution and must not be described as guaranteed tracking.

Landing view repeats the advertised product, actual Rp99.000 unit basis, selected variant, stock and applicable promotion terms. Shipping remains additional and is revealed before order confirmation; conditional subsidy is not promoted as unconditional free shipping. Page recovery covers unavailable advertised variant, quote changes, weak network, provider redirect/app return and reload/back behavior.

Acceptance additions: test entry from Meta/Instagram and TikTok in-app browsers plus Chrome/Safari; product/variant deep links, guest progress, keyboard/mobile zoom, provider return and referral/campaign parameter retention. Placement preview plus real browser interaction are required before claiming channel readiness. Tracking failures cannot block checkout. No A/B experiment or conversion improvement is claimed by this planning update.

## Multi-category clarification and benchmark acceptance
Owner confirms a general multi-category ecommerce storefront. Shared shell/navigation covers all departments. Category-specific filters and product facts specialize the journey; no separate niche brand or funnel replaces the storefront. Brand palette is accepted in CTX-13; recommended layout is selected under owner delegation; rendered prototype acceptance remains unexecuted. The canonical benchmark evidence/transfer matrix lives in 10-DESIGN-SYSTEM-WHITELABEL.md.

Prototype review must use at least skincare, electronics, bags/wallets and fashion data, including long names, different media shapes, size/compatibility choices, unavailable variants and mixed-warehouse carts. A successful one-category demo is insufficient. Verify department discovery, product comparison, secure guest purchase, total visibility, return recovery and affiliate hold explanation before UX approval. No prototype/browser result exists yet.


## Distinct Mobile Web-App and WebView Contract — 2026-10-15

Decision context CTX-14: a dedicated mobile shopping experience is required now; future Android/iOS clients are intended, not part of current native-app implementation. The shared backend remains the authority for catalog, inventory, pricing, referral, orders, returns and money. Mobile and desktop present the same business objects and rules through different task composition; neither creates a second source of data or separate financial policy.

### UX-4 — Mobile shopping mode and channel-safe recovery

- Status: Accepted
- Owner: Product UX owner
- Source: CTX-14
- Statement: The mobile shopping mode shall provide task-specific navigation, discovery, product, cart, checkout, order and affiliate surfaces with touch/keyboard-safe controls and recoverable browser/WebView authentication and payment handoffs, while using shared backend contracts.
- Acceptance: Given mobile mode in a browser or supported WebView, when a buyer opens a product deep link, changes category, adds a variant, checks out and returns from external payment, then navigation/history and safe cart/order context remain coherent, every parcel total is reviewable, and payment status is reconciled server-side. Given a virtual keyboard, safe-area inset, narrow layout, cancelled external handoff or lost WebView session, then essential controls remain reachable and the user can recover verified access without submitting a duplicate order. Given an affiliate replacement hold, then the mobile item detail explains its lineage and revised eligibility without buyer PII.
- Constraints: PR-17, PR-18, API-1, UX-1, UX-3, IAM-1; native apps and bridge implementation remain future scope; no PWA, forced SPA or offline checkout requirement is implied.
- Evidence: Not executed; requires distinct mobile/desktop prototype review and browser/WebView integration evidence on selected supported environments.
- Change history: 2026-10-16 — mobile refinement selected under owner delegation; 2026-10-15 initial proposal following owner request; supersedes mobile-as-stacked-desktop composition assumptions, not business policy or accepted brand palette.

### Mode Selection and Shared Contract Boundary

Proposal: product mode is a presentation decision; viewport size, orientation, input and zoom are adaptation signals within that mode. A mobile browser receives the mobile experience by default; an intended WebView entry can select that mode explicitly. Define the exact mode-selection mechanism with architecture and preserve it across navigation. Desktop-window resizing must not erase carts, change accounts or commit actions; device rotation must not reset the journey. If mode changes, resolve the same logical destination and preserve safe in-progress choices. User-agent strings and mode flags never confer identity, warehouse scope, payment permission or eligibility.

Proposal: the shared OpenAPI contract governs client/backend operations and errors. Web and eventual native clients consume the same authoritative resource identities and state transitions; rendering does not require every browser request to become public API traffic. Native navigation, authentication storage, app-link registration and bridge capabilities require a later client-specific design and threat review. No native bridge, biometrics, push, local secure storage, background task or native payment SDK is assumed here.

### Mobile Shell and Screen Contracts

Proposal: bottom navigation has four stable destinations: Home, Categories, Cart and Account. Search is directly available from Home/Categories and relevant lists. Orders and Affiliate are clear Account destinations; role-dependent affiliate entry never exposes staff actions. Selected tab has a text label and state beyond color. Tabs are not duplicated in modal sheets or checkout. Home/category navigation represents the broad store, not a single niche.

| Mobile surface | Purpose and composition | Actions, state and history contract |
|---|---|---|
| Home | Compact brand/search entry, useful subsidy facts, broad department shortcuts, curated mixed-category product groups; bottom tabs | Search, category and product entry preserve home scroll on return. Loading and absent merchandising do not block categories/search. No oversized desktop hero compressed into mobile. |
| Categories | Dedicated department browsing with selected department and subcategories; category-specific facts/filter entry | Department changes update navigable state. Return from a product restores selected category, filters and list position. Empty department differs from failed load. All approved departments stay discoverable. |
| Search/results | Focused query entry, results and removable filter/sort controls; product units retain image/title/variant/price | Submit via keyboard or control; retain query and prior result context. Filters use accessible sheet/disclosure and explicit apply/reset behavior. No-result, stale results and request failure are distinct. |
| Product detail | Task header/back, real media and item/price identity, category-specific facts, selectable variants, shipping/return facts; bounded purchase action region | Variant selection is inline or in an accessible sheet with current price/quantity. Add-to-cart confirms the selected variant and does not falsely confirm purchase. Back restores source list; a direct link has a meaningful store fallback. Product information remains reachable above and below purchase controls. |
| Cart | Dedicated review screen with editable line groups, stock exceptions, subtotal and shipping-not-final indication | Quantity/remove affects the correct line identity. Checkout waits for pending authoritative updates. Empty cart offers store discovery; returning from checkout preserves valid lines and exposes changes. |
| Checkout | Focused step flow: contact/address → delivery groups/services → payment and final review; tabs hidden, explicit progress/back | Preserve safe entered fields between steps. Final review includes all warehouse packages, subsidy, total and per-parcel COD due. A compact total shortcut may open full breakdown, never replace it. Validation returns focus to the invalid field; quote/stock changes require review. |
| Order/return detail | Order summary followed by independent shipment cards/timelines, COD cash due, delivery exceptions, item return/replacement history | Secure guest access and permitted claims use the same rules as desktop. Direct links never expose order PII before access verification. Partial delivery does not falsely complete the whole order. Handoffs and reloads recover this order rather than recreate it. |
| Account/authentication | Guest recovery, buyer sign-in, orders and eligible affiliate entry; no forced registration to shop | Login return destination is validated; preserve safe shopping context. Cancel login returns to the initiating task. Session-expired and denied-access states differ; password managers, paste and accessible verification remain supported. |
| Affiliate | Own balance summary, automatic eligibility/manual-transfer explanation with Rp99.000 minimum, referral link/share, item list and full-screen item/payout detail | Balance states are not collapsed into one available total. Hold reasons, original/replacement receipt, maturity date, rate and transfer outcome remain readable. Filters/back retain report position; copy fallback exists when share is unavailable. No Withdraw button; H+10 eligibility is automatic, while finance transfers manually after the Rp99.000 minimum. Show eligible, awaiting manual transfer, processing and paid distinctly. |

### Touch, Back, Keyboard and Safe Areas

Proposal: controls use adequate touch targets and spacing, semantic button/link behavior and visible keyboard focus. Swiping is optional enhancement with visible alternatives; destructive cart changes remain recoverable. Sheets declare their purpose, retain focus, close accessibly and return focus to their trigger. Nested modal flows are avoided.

Proposal: Back closes an active navigational overlay before returning to the previous screen; meaningful screen and step transitions participate in browser history without duplicate entries. Tab switching restores its prior logical position where safe. Android system Back and iOS navigation behavior require wrapper/browser-specific validation; do not assume JavaScript controls host navigation. A deep-linked screen without an in-app prior entry offers an explicit store/parent destination rather than trapping the user or invoking an unknown external history. Financial submissions are not repeated by Back/Forward or reload.

Proposal: reserve layout space for bottom tabs and purchase actions, including safe-area insets. Do not show tabs, sticky purchase actions and checkout confirmation bars as competing layers. When the virtual keyboard opens, the active field, adjacent error and next action remain visible; move or hide nonessential persistent controls as needed, restore them on dismissal and retain input. Test dynamic browser toolbars, landscape, text enlargement and narrow reflow inside mobile mode. At very narrow widths product units can become one column without reverting to desktop composition.

### WebView Authentication, External Handoff and Return

Proposal: browser cookies and WebView cookies may differ; do not promise automatic account/referral continuity across them. Prefer a supported provider/authentication flow; if embedded login or payment is unsupported, offer an explicit external browser or approved app handoff with a clear explanation and a safe return route. Opening a new context does not carry sessions, tokens or sensitive form data through arbitrary URLs.

Proposal: persist a server-side checkout/order/payment attempt before external payment. Bind approved return context to that attempt using the security-reviewed mechanism; validate allowed destinations and reject untrusted app/link targets. Provider return, app resume, window focus or deep link is a signal to retrieve authoritative status, never proof of payment. Show pending, cancelled, expired, failed and unknown separately, and provide retry/status recovery without making a second order. Authentication returns likewise validate state and access before resuming. Native app/universal-link configuration is future work; current web return remains the dependable fallback.

Proposal: a WebView without native sharing, external-link bridge or app-link support offers copy-link/open-browser guidance where possible. No automatic clipboard, native bridge, host cookie access or guaranteed app reopening is assumed. If the host terminates the WebView or the external context has no session, recover through approved guest-order verification or sign-in; preserve server-side order state. Weak/offline network shows retry/read-only cached presentation only if implemented; stock, checkout, claims and financial mutations always require authoritative online confirmation.

### Mobile Acceptance and Unresolved Gates

Planned scenarios: Home → department → search → PDP → cart → checkout; direct campaign/variant entry; tabs/back/forward/reload and orientation; empty and stale cart; split COD and unsupported route; keyboard covering an address error; large text and 320px reflow; screen reader and touch alternatives; authentication cancelled externally; provider return before webhook; app/browser switch with distinct cookie stores; WebView killed during payment; unknown transfer/receipt state; affiliate replacement detail with long explanation. Compare distinct mobile and desktop compositions with mixed skincare/electronics/bags/fashion data. No prototype or runtime PASS exists.

| Open decision | Owner | Gate |
|---|---|---|
| Exact mobile-mode selection/persistence and logical route mapping | Engineering owner | Before navigation implementation |
| Supported browsers/WebView wrappers and external handoff capabilities | Engineering owner | Before channel readiness claims |
| Login/payment issued provider restrictions, allowed return destinations and recovery mechanism | Integration owner | Before authentication/payment implementation |
| Mobile screen composition and interactive prototype acceptance | Composition selected under owner delegation; rendered prototype not executed | Before visual delivery |
| Native Android/iOS auth, links, navigation and secure storage design | Engineering owner | Before future native-app implementation |

Historical interpretation: earlier references to narrow/wide review meant baseline reflow checks. They do not satisfy the newly requested distinct mobile experience. Current mobile composition is governed by this section; original desktop/operator requirements and commercial rules remain in force.


## Listing and Operational Clarifications — owner decisions 2026-10-15

This section clarifies UX-1 through UX-4. Commercial facts follow owner decisions; existing recommended presentation is selected under owner delegation, while prototype/browser acceptance remains unexecuted.

### Catalog and Sellable-Option Contract

Shared department → category → subcategory navigation supports all approved physical categories. Buyer taxonomy uses concise labels while listings maintain separate Google catalog mapping. Category-specific attributes drive filters and product facts, without separate stores or competing brands. Missing/inapplicable attributes are not fabricated.

A listing has one or more sellable options/variants, each priced exactly Rp99.000. An option contains one or more declared physical product/SKU quantities, including predefined bundles. Choosing one of two variants costs Rp99.000; buying both costs Rp198.000. An option containing two products or a multi-product bundle still costs Rp99.000 total. This is fixed contents/option selection, not custom bundle assembly.

| Surface | Required behavior | Recovery and accessibility |
|---|---|---|
| Discovery card | Listing name, representative complete contents, Rp99.000 per selected option and explicit option/bundle cue where needed | Quick add only when option identity is complete; otherwise accessible chooser/PDP |
| Option selection | Labeled variant controls, selected state, relevant media/contents; every choice costs Rp99.000 | URL-addressable valid option; invalid/sold-out deep link explained without silent replacement; keyboard/text labels accompany swatches |
| Bundle contents | Each included product/SKU identity, thumbnail and quantity; one bundle total Rp99.000 | Long lists expand without obscuring count/total; no component purchase controls or separate Rp99.000 charges |
| Quantity/cart | Quantity means complete selected options; one parent line with subordinate contents | Two bundle units cost Rp198.000, component quantities multiply correctly, cart unit count is two regardless of piece count. Remove/change acts on parent |
| Checkout/order | Parent option identity, immutable contents snapshot, complete warehouse allocation and payable breakdown | All bundle components must be together in one warehouse. National sums of incomplete warehouse component balances do not establish availability |
| Return/replacement | Claim identifies affected option quantity and relevant components/evidence | Default refund is for the whole purchased option, returning available received components without demanding an originally missing item; component replacement preserves the whole option lineage. Never invent component purchase/refund prices or unlock commission before affected receipt |

### Catalog Margin and Configuration Review

PR-19: Product editor previews contribution margin per option: full component HPP, packing, payment/COD fees, actual affiliate-rate scenario, subsidy and expected return costs. Label assumptions, missing data and estimated versus realized margin. Missing required inputs and contributions below the platform-configured floor route to publication review; only an authorized operator can record an exception. No minimum margin amount is invented. Finance can compare expected and realized contribution and trace discrepancies.

PR-20: Settings preview scope, version, effective time and impact on new transactions. Commission rates, minimum payout, subsidies, fulfillment calendars and return terms use canonical configuration ownership. Existing orders retain their applied prices, contents, commission rates, subsidy allocation and terms. Configuration edits must not silently recalculate historical obligations; authorized corrections require audit history.

### Packing and Exception States

Packing completion means a valid tracking waybill actually issued by H+2 after payment success or confirmed COD; the shipping clock excludes declared public holidays and major-holiday closures, while exact weekday/cutoff and calendar-version treatment remain the operational-policy gate. A pending/failed label request or internal draft number does not satisfy it. Display trigger, deadline and actual issuance separately from the next-working-day physical-handover deadline and actual collection timestamp. Buyer tracking describes issued tracking as preparation; only actual handover implies departure. Issuance never starts affiliate eligibility.

PR-21 defines the cross-domain exception requirements reflected below.

| Exception | Buyer-facing state and recovery | Operator/finance and affiliate consequences |
|---|---|---|
| Physical stock gap during pick/pack | Explain affected option and permitted delay/cancellation choice; preserve unaffected lines | Block incomplete bundle dispatch; seek a complete warehouse allocation, requote/review material changes, or authorize refund. Record allocation and deadline breach; no fabricated tracking/receipt |
| Payment after order expiry | Payment received, order under review; original reference and no duplicate-payment instruction | Reconcile late payment, recheck complete inventory/quote before fulfillment or authorize refund. Never silently revive expired reservations or mature commission from payment alone |
| COD refused/returned to sender | Delivery exception for affected package; help and permitted rescheduling | No buyer receipt or H+10 accrual for refused quantities; reconcile collection, return transit and fees without inventing buyer penalties |
| Partial delivery / one failed shipment | Per-package/per-option quantities, COD due and next action; whole order remains partial | Unaffected verified receipt matures independently; hold unresolved/returned quantities, avoid duplicate payment/replacement commissions |
| Replacement option/component unavailable | Explain unavailable replacement and offered refund or explicitly agreed alternative | No silent variant/component substitution; record decision, refund allocation and stock action. Hold/reverse affected original commission as appropriate pending resolution |

### Affiliate Transfer Visibility

Eligibility is automatic H+10 after verified buyer receipt. An affected purchased-option quantity uses actual replacement receipt as its new H+10 anchor; component replacement preserves the whole offer lineage and resets that affected offer quantity only. Unrelated purchased options/quantities keep their anchors. One selected option supplies one Rp99.000 commission basis, never one basis per physical component. Claims/reversals are explained per item/quantity. Eligible balance below Rp99.000 accumulates. At/above Rp99.000 with a valid destination, funds enter finance's manual-transfer queue without affiliate withdrawal requests.

Views distinguish eligible, awaiting manual transfer, processing and paid, with permitted amounts, masked destination, timestamps and reference. Eligible and queued balances cannot be added twice; processing allocations cannot fund another transfer. Finance records actor and evidence-backed confirmed outcome before paid; uncertain results stay processing pending reconciliation. No instant payout, automatic bank transfer, settlement date or unsupported provider feature is promised. Future Virgo outbound capability is a validation task, not an implemented action.

### Added Acceptance Scenarios

Planned, not executed: one listing/one physical unit; two alternative Rp99.000 variants; one Rp99.000 option containing two units; multi-SKU Rp99.000 bundle; two bundles at Rp198.000; incomplete individual warehouses despite misleading national component stock; unavailable option deep link; long contents at 320px/200% zoom; late successful payment after expiry; stock gap after reservation; refused COD alongside successful package; replacement unavailable; affected versus unaffected H+10 anchors; balance Rp98.999 versus Rp99.000; uncertain manual transfer reconciled without duplicate allocation; valid versus pending waybill at H+2; separate collection timestamp. Browser, role, privacy and financial checks must execute after implementation before calling these verified.


## Super Admin, Order History and Financial Governance — owner delegation 2026-10-15

This extends UX-2 and the existing screen/action contracts; it introduces no competing role system or additional requirement IDs. One role-scoped admin application serves one company. **Super Admin** is the owner role with company-wide order, warehouse, finance, settings and audit visibility; catalog/operations, warehouse, customer service and finance are permission-scoped workspaces in that application. Server-side IAM determines both row access and action access. Finance information is private to finance and Super Admin unless an explicit narrower permission grants access. Warehouse staff use existing warehouse-scoped fulfillment/shipment history, showing assigned items/shipments and attributable operational facts only. Warehouse grants do not authorize GET /admin/orders, full order detail or whole-order financial totals; other warehouses and company-wide HPP/profit/bank details remain inaccessible. Whole-order history is reserved for appropriate owner/ecommerce_admin/customer_service/finance grants with private fields redacted.

### History, Finance and Settings Screen Contracts

| Existing screen / extension | Entry, scope and decision-critical data | Actions and completion | States and recovery |
|---|---|---|---|
| Operations readiness / Super Admin overview | Owner sign-in; company readiness, packing/collection exceptions, reconciliation discrepancies and source freshness | Open the relevant queue, full order history, finance or settings; setup completion derives from canonical records | First-use checklist differs from zero exceptions; failed finance source is unavailable/stale, never zero revenue; retry individual source without hiding other queues |
| Tracking/order detail / internal full order history | Orders navigation and cross-links from shipment, refund or payout; all historical orders for Super Admin, permission-scoped records for ecommerce_admin/customer_service/finance; warehouse role uses its separate fulfillment/shipment history instead; filter by reference, date, warehouse and independent payment/fulfillment/return states | Search and open list-detail; inspect items/contents, amounts, original snapshots, package events, refunds and linked commission/payout history; enter only authorized case actions | No orders versus no filter matches; loading/stale, denied, missing and partial provider timeline distinct; clear filters or retry; Back restores filters, page and position; fulfilled/cancelled/refunded orders remain searchable |
| Product editor / HPP and margin review | Catalog or authorized cost editor; SKU component HPP, packing and fee/subsidy/commission assumptions, warehouse applicability, current version/effective time | Preview option-level contribution; save prospective cost version; request/review publication exception under existing PR-19 ownership; display original order cost basis on history | Missing HPP is unknown rather than zero; below-floor contribution routes to authorized review; version conflict preserves draft for compare/reload; save timeout checks resulting version before retry |
| Inventory/transfer / stock history | Assigned warehouse ledger; Super Admin may review across company warehouses; available/reserved/in-transit balances and movement source | Record receipt, dispatch/receive transfer, or reasoned adjustment; inspect linked order and movement history; completion is movement reference plus derived balance | Reservation/version conflict or negative balance rejected; unknown movement looked up before retry; transit discrepancy stays unresolved; corrections reference original movement and never delete it |
| Finance reconciliation / owner financial view | Finance or Super Admin; provider references, expected/received/settled money, recorded costs and expenses, refunds, commission liabilities and manual payout allocations | Compare source lines and candidate matches; record permitted matches/adjustments and evidence; inspect estimated versus actual contribution and source completeness; financial actions keep existing guarded refund/payout flow | Unmatched, mismatch, awaiting settlement, duplicate, partial source, missing cost, pending mutation and unknown transfer are distinct; retain unresolved amount and last source sync; reconcile existing operation before retry; no paid label from an uncertain outcome |
| Company/access/promo settings / commercial and calendar configuration | Super Admin, or explicitly delegated scope; versioned HPP-related defaults, margin floor, subsidy, commissions, warehouse calendar and user scopes | Review current values → draft change → preview effective scope/date/impact → explicit save with reason; show audit and previous versions without rewriting transactions | Unconfigured values block dependent publication/action rather than silently default to zero; validation, forbidden scope, stale version and unsaved changes retain safe input; reload/compare on conflict; save result recovered by version |

Initial financial view is operational reconciliation and contribution reporting, not an assumed complete statutory accounting system. Profit values are derived, never editable facts: estimated contribution uses disclosed assumptions; actual/recorded contribution uses recorded cost and money outcomes with completeness and settlement state. Refunds, COD fees, subsidies, commission and later cost corrections remain linked to the originating order; incomplete actual data is labeled incomplete, never silently treated as finalized profit. Super Admin can inspect and authorize allowed corrections but cannot erase posted history.

### Guarded Configuration and History Actions

| Action | Guard and review | Pending/success | Failure/recovery and audit |
|---|---|---|---|
| Save HPP/cost version | Cost-edit permission, component/warehouse scope, explicit effective time and version; preview contribution impact | Pending locks only this save; resulting version and effective scope shown | Retain draft on validation/conflict; unknown result lookup before retry; actor, old/new values and reason recorded; original order snapshots retained |
| Record cost/expense correction | Finance/Super Admin permission; source reference, amount and reason; financial confirmation includes impact | New linked adjustment reference, with report recomputed from recorded facts | Posted entry is never overwritten; reconcile uncertain save, avoid duplicate correction, preserve original/source audit |
| Change stock | Assigned warehouse mutation permission and expected version; reason/direction and quantity reviewed | Append-only movement ID; balance derived from movements | Reject insufficient stock/conflict; retain reason, recover uncertain operation by identity; no direct edit-balance field |
| Change access or commercial policy | Super Admin/delegated action scope, current version, prospective impact and effective time reviewed | Explicit saved version and audit summary | Denied actions rejected server-side; safe draft retained; previous orders keep applied policies; current session permissions re-evaluated after role changes |

### Continuous Intake and Shipping Dates

The shop accepts orders 24/7, throughout months and holidays, subject to authoritative stock/payment/provider availability. A public holiday does not close checkout or make a pending payment successful. Packing/waybill and physical-handover deadlines use the separately governed shipping calendar that excludes declared public holidays and major-holiday closures; show trigger, deadline, applicable calendar/version and actual event separately. Remaining weekday/cutoff, closure source and initial calendar entries require policy clarification before promising exact dates. Do not automatically apply shipping exclusions to receipt-based H+10 affiliate eligibility or return windows.

### Planned Governance Acceptance — not executed

Exercise Super Admin retrieval of completed/cancelled/refunded orders; warehouse cross-scope deep links/mutations and whole-order history endpoints denied; assigned warehouse fulfillment history excludes whole-order totals and other warehouses; operational role blocked from private finance data; first-use versus filtered-zero history; HPP change affects prospective estimates while old order snapshots remain unchanged; missing costs show incomplete profit; posted cost correction keeps the original and appends a linked entry; stock adjustment keeps movement history; concurrent configuration edit preserves the draft; unknown refund/payout remains unresolved without a duplicate; order placed during a declared holiday remains accepted with a separately calculated shipping deadline. Prototype, browser, authorization and financial regression evidence must execute after implementation. Owner delegation resolves design choice approval, not these acceptance checks.


## Website-Native Support Conversation and CS Inbox — PR-22

PR-22 owns website-native buyer ↔ company CS messaging; T-24/T-25 own implementation and verification. This extends buyer recovery and UX-2 scoped work without replacing order/return/finance contracts. WhatsApp and seller-to-buyer marketplace messaging are outside this flow. Visitors can contact support without an order, purchase or forced account registration. Product context is optional. Linking an order requires verified own-order access; a typed order number alone never grants order history or PII.

### Chat Screen and State Contracts

| Surface | Entry, actor and primary job | Actions and completion | States and recovery |
|---|---|---|---|
| Buyer conversation list | Support navigation; own buyer/guest session only; own public conversation activity, status, safe preview and participant unread | Start presales conversation; open thread; filter own list metadata by safe title/context/status; retain list position on Back | First-use empty offers start; filtered-zero offers reset; loading/stale/offline/expired session distinct; never expose staff-note metadata or another principal's list |
| Desktop support panel / dedicated page | Public storefront/product/cart/checkout; panel starts with list or current thread and expand control | Open/close, choose thread, expand to dedicated list/thread page; keep draft, thread and history position | Panel yields to checkout controls/errors/totals; close restores focus; expansion must not create another conversation or submit a draft |
| Mobile inbox and thread | Support entry → full-screen list → full-screen own thread; task header, history and bounded composer | Back closes image/search/context view, then returns to list, then initiating shopping page; open direct authorized thread with safe support-list fallback | Restore shopping scroll, cart and safe draft; resize/orientation retains logical thread; no accidental send on Back/keyboard dismissal |
| Product/order context cards | Optional product selection or independently verified own-order access; safe identity/variant/status summary | Preview/remove chosen context, explicitly Send context, open permitted linked detail | Opening a PDP/order chat never auto-sends; unavailable product or revoked order access produces safe unavailable card; linking/relinking audited, never changes ownership; no bank proof/cost fields |
| Public reply and message search | Own authorized thread; public-message IDs and sanitized excerpts only | Reply to message, cancel reply, search own thread, navigate result and jump to message | Redacted/deleted/unavailable original shows tombstone; rejected cross-thread/note references never quote content; empty/failed/stale search distinct; preserve scroll and return-to-latest |
| Private attachment and image viewer | Participant-scoped composer, validated image and authorized retrieval | Preview/remove, upload, inspect scan result, send ready attachment; open readonly image, zoom/reset/close | Upload progress/error, scan pending/rejected, expiry/revocation and reduced-network states explicit; retry/replace retains safe text; no public image URL or cross-thread access |
| Personal archive/mute controls | Buyer own list/thread menu; current participant preference separate from CS status | Archive/unarchive; switch active/archived list; mute/unmute attention alerts with labeled current state | Save pending/failed/conflict preserves thread and previous confirmed setting; archived-empty differs from filtered-zero; new public message resurfaces thread; mute keeps unread/history and never resolves or reassigns CS work |
| In-app notification center | Header/support notification entry; current principal's generic support notifications and seen/dismissed state | Open authorized thread; mark notification seen; dismiss notification; restore list context | Loading/empty/stale/revoked target and failed mutation distinct; notification seen/dismiss never advances chat-read or deletes history; access loss opens safe unavailable/recovery; mute suppresses attention alert without losing unread or message access |
| CS inbox and conversation detail | Explicit support grant; permitted unassigned/assigned threads, per-agent unread, status, assignee, last public activity | Filter/search, exclusive claim, reply, waiting_customer/resolved, versioned handoff; inspect authorized order/return context | Competing claim shows current assignee; lost claim disables outgoing reply with reason, retains safe draft; handoff preserves history; delayed resolve cannot hide newer buyer message |
| CS queue aids and notes | Permitted inbox; internal tags/priority, saved replies and separate private note action | Filter by queue/status/assignee/tag/priority; insert/edit saved reply draft; add internal note via explicit staff-only composer | Template insert never auto-sends; missing permission disables management with reason; tags/priority/notes remain staff-private; note send cannot be mistaken for customer reply |
| Super Admin oversight | Canonical owner support visibility/audit and permitted assignment governance | Inspect history/audit; versioned takeover/handoff; manage support grants through IAM | Owner still claims before reply; ordinary finance/warehouse/ecommerce_admin roles denied; support access does not grant financial mutations or attachment/order access beyond current scope |

### Identity, Privacy and Durable Delivery

Anonymous chat access is an unguessable server-verified capability bound to the guest's HttpOnly session; never put the capability in a URL, analytics, browser-visible message text or logs. Chat authorization is separate from guest cart/order capability. A guest can continue shopping and checkout without an account. Cross-device or lost-session recovery uses verified contact or sign-in with an approved conversation-linking flow; an unverified contact value or conversation ID does not recover history.

Validate message bounds: text at most 4,000 characters; require nonblank text or at least one ready attachment. Allow at most three JPEG/PNG/WebP images, each at most 5 MiB, with server content validation, private storage and scanning. Persist accepted messages durably before reporting sent. Initial realtime delivery uses POST sends plus SSE changes, with cursor-based polling fallback and reconnection; transport connectivity never substitutes for sent/read evidence. Do not promise online/typing presence without a real heartbeat-backed implementation. Sender pending/failed states remain local until authoritative acceptance; retry with the same client message ID recovers the original effect. Reconnection resumes from an authoritative event/message cursor, deduplicates replay and restores history without gaps or duplicate messages. Participant read state advances only on evidenced visibility/read action; connection, delivery or notification alone is not a read receipt. Unread counters are per participant. Public receipts identify reader_side (customer/staff); only counterparty acknowledgement marks a sender message read. Customer read-by-CS uses the acknowledged staff aggregate; each agent inbox uses that agent’s own marker, so another agent reading never clears it. Read positions advance monotonically across concurrent tabs and never exceed authorized committed public messages. Unknown result must resolve the existing send before creating another.

Customer REST responses, stream events, notifications, search results and attachment views exclude internal staff notes. Staff notes use an explicit staff-only action, storage/projection boundary and separate public event sequencing so customer cursors/streams do not disclose note-event existence; a clearly labeled separate staff-note composer prevents accidental customer delivery. Notes never alter customer-visible sequence, counts, preview, ordering or public updated time. Private image access is scoped to the conversation participant, short-lived where applicable, validated server-side and subject to upload safety rules; preview and image metadata must not expose credentials or unrelated customer data. Plain text and validated safe links are the baseline; never render submitted HTML or execute scripts.

### Assignment, Scope and Business Actions

CS may inspect permitted unassigned and assigned conversation queues; outgoing staff replies require the active exclusive claim. Owner takeover uses an audited version-checked handoff rather than bypassing the claim. Claim and handoff are version-checked mutations with exclusive ownership, current assignee display, actor/time/reason audit and conflict recovery. Conversation states are `open`, `waiting_customer`, `resolved`; accepted new buyer messages reopen resolved conversations. Staff resolve/wait actions record the actor and version; a delayed concurrent resolve cannot hide a newer buyer message. Handoff preserves the full authorized conversation and unread state.

Super Admin maps to `owner`, with support visibility and audit; finance, warehouse and ordinary ecommerce_admin do not automatically receive support access. A support escalation may reference an authorized order or return, but neither a chat message nor assignment authorizes refunds, payouts, beneficiary changes, stock changes or access to private financial proof. Those actions stay in their guarded domain workflows and append their own audit.

### Navigation, Composer and History Behavior

Desktop uses a bounded support panel with expand-to-dedicated conversation navigation; dedicated mode keeps a conversation list alongside the active thread. Mobile uses full-screen inbox and thread routes with explicit Back. Support navigation stores the initiating safe logical destination and scroll, never credentials in a URL. Switching thread, expanding panel, Back, refresh and orientation retain the correct authorized thread and safe draft; logout/session expiry clears private presentation state before another principal can see it.

The multiline composer uses Enter for newline on desktop and mobile, with a visible Send button. Desktop may provide a displayed Ctrl/Cmd+Enter shortcut; guard IME composition and repeated key events. Mobile keyboard Enter never sends. Show remaining text/attachment capacity and validation beside the composer. A draft contains text, public reply ID and proposed safe context, namespaced by principal/conversation/session; keep it in memory or session-scoped storage only, never a shared local-storage bucket. Clear on confirmed send, explicit discard, logout or expiry. Do not persist images, raw capability or private provider/order evidence in draft storage. On unknown acknowledgement retain the pending message and resolve its existing client ID before retry or editing as a new message.

Opening product/order chat prepares a visible contextual draft only. Send context is explicit; a context-only submission uses an associated nonblank visible description so it satisfies the text-or-attachment rule. Server validates product identity and independently verified order binding; UI card links carry logical identifiers only. The order card exposes minimum authorized facts and never performs refund, payout or inventory changes. Reply stores an authorized public-message reference; the server supplies a bounded escaped quote. Quoting staff notes or other conversations is rejected. Redaction/deletion replaces quote preview with a tombstone, not a retained copy of removed private content.

Thread search scopes to that participant’s public authorized thread and paginates results; no URL contains query text or a capability. Selecting a result loads its surrounding authorized history and anchors the matched message without duplicating pages. An absent/removed match explains unavailability and offers previous result/latest. Clear search restores previous reading context. Staff internal-note search, if offered, uses a separate private view; it never blends with customer message results.

History loads older pages upward with stable message identity and retained visual anchor. Show a new/unread separator at the participant’s entry read boundary. Auto-scroll only when already at latest and actively reading; otherwise show a new-message count and Jump to latest. Loading/replay/search jumps do not automatically mark unread history read. No new message steals composer focus or forces scroll from the message being examined. Show local sending, durable sent, evidenced counterparty-read, failed and reconnecting independently; staff-note events and socket heartbeats do not mark messages read.

Image sending supports local preview/removal, progress, validation/scan pending, ready and rejection, with explicit retry or replacement. A ready attachment is sent only after intended Send. Reduced-network mode may defer image retrieval until opened while keeping text/status available. Offline retains safe draft and unsent state; reconnection refreshes authoritative state but never silently submits draft or failed messages. The readonly private image viewer has labeled zoom-in/out/reset/close controls, Escape and focus restoration; no swipe/pinch/drag-only task. Expired retrieval offers authorized refresh rather than public download fallback.

### Staff Workbench and Internal Aids

Wide CS layout uses three panes: permitted queue/list, thread, collapsible authorized customer/product/order context. Compact uses list-detail; mobile supports queue triage → thread → context, keeping filters and selection on Back. Queue filters cover unassigned/mine/permitted assigned, open/waiting_customer/resolved, unread, internal tag and priority. Queue badge/unread state is agent-specific; selected totals identify their filter scope. An assigned conversation retains the current agent’s unread state during another agent’s read and after handoff/reopening.

Saved replies are manually chosen into an editable public draft and require explicit Send; placeholders must resolve or be visibly corrected before submission. Authorized support managers govern shared template/tag definitions with audit; CS may apply only granted internal tags/priority. These internal aids are private metadata with separate projection/versioning, never customer stream events or customer ordering changes. Staff-note editor and public composer remain distinctly labeled and separated; template insertion, tags, claim and handoff do not send customer messages. No finance secret, beneficiary record or accounting cost enters the support context pane by default.

### Availability, Notifications, Mobile and Accessibility

Message intake is 24/7, subject to truthful service availability. Staffed hours/timezone and away labels are configurable separately from shipping holidays and checkout intake. Show staffed/away status without an invented response SLA, fake typing/online badge or implied agent presence. Connection failure is a separate state. In-app notifications and participant badge counts are the initial channel, with private preview policy and no note leakage. Browser push is optional later and requires an explicit user preference/permission action; never request notification permission on initial page load or make chat depend on it.

Reserve safe-area/document space for header, composer and keyboard. Resize, rotation, landscape, dynamic browser toolbars, 320 CSS-pixel reflow and 200% text enlargement preserve messages, focused input, errors and Send. Touch controls target 44 CSS pixels; hover, swipe and dragging remain optional. Desktop panel/support badge/mobile entry never covers checkout confirmation, payment recovery, cart purchase controls or errors. Closing/reopening restores focus and safe shopping state.

Use semantic message history and a restrained ARIA log/live region: announce genuinely new relevant messages briefly, not every loaded historical page, reconnection replay, search jump or delivery-status tick. Offer keyboard navigation to search/results/context/viewer, visible focus and meaningful sender/time/status labels. Arrival never steals focus; image/dialog dismissal restores its trigger (or a meaningful thread heading if removed). Status and unread do not rely on color alone. Support no-motion preferences and text alternatives for contextual images.

### Planned Chat Acceptance — not executed

| Scenario | Required observable result |
|---|---|
| Guest starts from PDP without account/order; opens cart then returns | Own conversation and optional preview exist; no auto-send; shopping/cart/scroll preserved; checkout remains guest-accessible |
| Context-only send, forged order number, revoked order link | Context send has visible nonblank description; unverified order never exposes facts; revoked card offers safe unavailable state |
| Panel → dedicated page; mobile inbox → thread → image → Back; rotate/refresh | Same thread, correctly namespaced safe draft and reading/list/shopping position restored; no extra conversation or send |
| Two principals on one browser; logout/expiry and verified recovery | No old draft/history leaks; verified ownership linking required; contact/order/conversation number alone cannot recover |
| Whitespace-only message, image-only send, three valid images, fourth/oversized/disguised/rejected image | Text-or-ready-attachment and declared bounds enforced; safe preview and explicit upload/send states; failed image never appears delivered |
| Connection loss after commit, duplicate send/replay, stale cursor, offline draft | Same client ID persists once; history resync has no gaps/duplicates; draft is not silently sent on reconnect |
| Read receipt races across buyer tabs and two CS agents | Monotonic bounded marker; only counterparty read marks sent message read; one agent does not clear another agent’s unread |
| Older-history page/new arrivals/search jump/reply original redaction | Reading anchor retained, new-message separator and Jump to latest work; quote becomes tombstone; no history announcement flood |
| Scoped thread search and cross-thread/note reply reference | Only authorized public results/quote accepted; no internal-note existence, free-text query or capability leaked through URLs/events |
| Competing claims, handoff, new buyer message against stale resolve | One active claimant replies; draft retained on conflict; owner takeover audited; new message reopens and cannot be hidden by stale resolve |
| Saved reply, unresolved placeholder, private note/tag/priority | Template remains editable draft; explicit Send required; notes/internal aids never enter customer payload, preview, unread or ordering |
| In-app badge and optional browser notification preference | Correct per-participant counts; no checkout overlap or unsolicited permission-on-load; no sensitive note/financial preview |
| Keyboard/IME/mobile Enter, 320px, 200% text, image viewer, screen reader | Enter newline and explicit Send; IME never sends; controls/validation visible; 44px touch target goal; Escape/focus recovery and minimal new-message announcements |
| Unauthorized finance/warehouse/ecommerce_admin and financial request in chat | Access denied unless support role granted; no refund/payout/stock mutation from chat; escalation keeps original domain guards |

These are Markdown acceptance contracts, not executed UI tests. The selected scope includes the complete standard text/image support flow above; voice/video, AI and WhatsApp are optional later additions. No new marketplace screenshot/reference, rendered UI, browser or runtime PASS is claimed.

### Mobile Chat Delivery Matrix — planned acceptance
| Environment or interruption | Required observable result |
|---|---|
| 320px, 390px and 430px portrait; 768px tablet; wide desktop | List/thread remain distinct where needed; no horizontal page scroll, clipped composer/status or overlapping shop purchase controls; text/card/image content wraps safely. |
| iOS Safari and Android Chrome with keyboard shown/hidden | Active input, explicit Send, image/reply previews and validation remain reachable as browser bars and visual viewport change; keyboard dismissal never sends or discards text. |
| Rotation, browser Back/forward and panel expansion | Same thread/draft and reading anchor return; close viewer/search/context before leaving the thread; leaving restores the initiating shopping/list context. |
| Camera/gallery chooser cancelled, permission unavailable, unsupported HEIC/other file | Existing text/reply survives; supported image types/size are stated; rejection gives a clear replace/select-supported-file action. No unsolicited camera permission or silent file conversion is assumed. |
| Slow upload, app backgrounded and mobile OS terminates page | No failed/unready image is sent; local draft recovery is limited honestly to the surviving session/tab. Previously committed messages recover from the server after authorized session recovery; cross-device draft recovery is not promised. |
| Airplane mode, reconnect, guest-session expiry or sign-in as another user | Safe unsent state and deliberate retry; unknown commits are reconciled; expired/wrong-principal presentation clears or locks before showing history. No delayed automatic send to a newly selected thread. |
| Long history, search jump, incoming messages during upward scroll | Older-page prepend retains visual anchor; matched original can load without duplicate rows; new arrivals offer Jump to latest and do not mark unseen messages read. |
| Screen reader, 200% text and keyboard-only image/menu actions | Named sender/time/status and context/reply controls; essential buttons target 44 CSS px as project convention; no gesture-only action, focus theft or announcement replay flood. |
| Customer notification tap after thread redaction or access revocation | Generic notification cannot recover removed content; authorized thread opens or a safe unavailable/recovery view appears; notification seen never claims a message was read. |

The matrix requires rendered browser evidence on supported release versions, with physical mobile checks where platform-specific keyboard/camera/background behavior matters. Responsive desktop emulation alone cannot establish physical iPhone/Android behavior. WebView behavior is checked only against a specifically selected supported wrapper; no native app or bridge exists by writing this contract.

Shared design defaults are backed by current accessibility/notification guidance inspected 2026-10-15: W3C status messages (https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), W3C target-size minimum (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), and MDN Notifications API (https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API). The 44px controls are the project's usability target, not a claim that WCAG AA universally requires 44px. Browser notification permission is user-initiated and optional; no background/push delivery guarantee is inferred. These are textual technical references, not new inspected marketplace visual evidence.

### Final chat preference and search acceptance
Given an archived muted conversation, when a new public reply arrives, then the thread resurfaces with unread visible while attention alerts remain muted; neither preference closes the CS queue. Archive/mute writes are actor-scoped and versioned/recoverable; a timeout rechecks the confirmed setting rather than applying it twice. Public message/assignment/read state and private participant preference remain separate.

Given a notification center item, when it is seen or dismissed without opening visible thread messages, then the conversation read marker does not advance. When its target has expired/revoked/redacted, show a safe unavailable target and navigation back, without exposing a preview or restoring deleted content. Both list and notification controls are keyboard/touch accessible on mobile and preserve return position.

Search scope for this baseline: the conversation list filters safe own-thread metadata (title/context/status). Message-body search operates within the selected authorized public conversation. CS queue search follows permitted public scope; internal-note search remains a distinct staff-only view. Cross-thread customer message-body search is not an implied feature.

## Shared typography and component acceptance — 2026-10-16
UI-1/Design System is the canonical owner for selected Inter variable, system fallback and the shared type/spacing/shape scale. Use the selected 16/24 reading/composer text, supporting metadata scale and 44px touch controls across buyer, CS, staff and affiliate tasks. Narrow admin views change composition rather than compressing financial facts into tiny text. Continue to distinguish payment/shipping/commission with explicit state/source, independent of typography or color.

Planned acceptance: load the selected font and block its asset to exercise fallback; long Indonesian product names, order references, Rp99.000 versus larger totals, negative contribution and unread/chat status remain distinguishable without clipped controls. Check visible focused errors, two-line rows, 320px/200% text, safe-area keyboard composer and image viewer. Compare font wrapping before/after load and observe layout shift; the font choice is not a measured performance or conversion claim. Reference-specific scale is applied through the canonical design document, not duplicated tokens in each screen.


## Dedicated `/checkout` Flow and Milestone Contract — 2026-10-16

This refines UX-1/UX-4 and C4/CO1–CO8 in the design system. Shopify-like focus and inspected Tokophi source guide composition only; 99ribu retains guest checkout, exact Rp99.000 complete-offer units, authoritative inventory/quotes, multi-warehouse parcels, verified provider capabilities and independent payment/fulfillment state. No application code, provider order or rendered/browser result is established here.

### Entry, Steps and Forms

| Checkout surface/state | Data and required behavior | Action and recovery |
|---|---|---|
| Entry and loading | Own cart/session; safe existing contact/address draft, complete offer contents, freshness; focused header and cart/help links | Restore safe draft; missing/expired access offers guest recovery without account mandate; empty cart returns to discovery; source failure offers retry, never invented zero total |
| Contact/address | Recipient name, reachable phone, complete street address and canonical destination IDs/hierarchy; optional email and optional delivery note; labels/autofill/input modes | Validate before advancing; preserve safe fields on error; show adjacent actionable errors and focus first invalid field. Do not imply phone must have WhatsApp or email is required for guest purchase. |
| Destination dependency | Source-defined province/city/district/subdistrict/postcode relations or searchable canonical destination with derived hierarchy; parent-child IDs valid together | Loading, no matches and failure differ; change parent clears stale child IDs/services/quotes; preserve unrelated text; retry failed dependent lookup; free text never authorizes a route |
| Shipping allocation | Server-proposed complete-warehouse options, parcel origins/items, actual supported services, estimate, fee, subsidy and COD reachability | Review/select service per parcel; no route or incomplete bundle explains affected options; reallocation/requote materially changing charges requires review; holiday processing dates separate from provider transit estimate |
| Payment/review | Only issued/configured Virgo methods or supported COD; known fees, all parcels, offer contents, total/subsidy and each COD collect amount | Choose verified method, inspect full breakdown, correct prior step, explicitly confirm; COD-ineligible parcel blocks unsupported combined choice and offers supported alternative; no invented on-site card capture or express wallet |
| Promo/benefit | Optional actual active rule and eligibility/cap/budget; accepted subsidy allocated visibly | Apply/remove only if supported policy exists; pending/expired/ineligible/error states retain form; benefits never claimed from a placeholder voucher or unknown quote |
| Confirm pending | Frozen quote/policy/contents references, authoritative allocation and operation identity; final total reviewed | Prevent duplicate confirmation while pending; version/stock/quote changes show old/new impact and require review; successful order result returns existing reference; unknown result looks up original operation before retry |
| Payment handoff/return | Persisted order/payment attempt; safe allowed return destination; no capability in URL | Cancel/back/reload/resume retains original order; retrieve server state; pending/expired/failed/unknown distinct; redirect return never marks paid; existing unpaid order retries permitted payment without duplicate order |
| Order confirmed | Authoritative order plus separate payment/parcel state and verified tracking/recovery route | COD acceptance states per-parcel cash due, not collected; prepaid confirmation may still show payment pending. Final paid/collected evidence is a separate backend transition |

Desktop shows readable form left and package summary right; mobile follows Contact/address → Shipping → Payment/review with explicit step Back. Tablet portrait/enlarged text stacks; landscape permits two columns only with sufficient readable width. A collapsed mobile summary keeps the current known total available, labeling shipping/fees not yet final rather than presenting zero as final. Expanded summary and final review expose every package and charge; collapsing cannot bypass final review. No confirmation action is inside the summary-toggle control.

### Persistence, Help and Recoverable Failure

Safe checkout progress is scoped to the current cart/checkout/principal session; never put address, contact, proof, session capability or payment token in navigable URLs or analytics. Guest checkout does not require sign-in. Changing contact does not silently transfer old-order/conversation ownership. Switching step, rotating, resizing or using browser Back preserves safe fields/selection and reconciles authoritative freshness; browser navigation/reload never repeats a financial mutation. Session expiry clears private displayed state and offers approved verification rather than exposing an old draft to another principal.

Revalidate stock, complete bundle allocation, quotes, subsidy budget and method availability at confirmation. Expired/changed quotes retain destination and safe form values; display revised affected parcel/totals and require renewed confirmation. Offline/unreachable dependencies preserve safe text and explain retry; never silently submit when reconnected or imply reservations remain held. A partial provider response marks affected package data unavailable and cannot make the whole checkout appear ready. Long-running/pending/unknown operations recover by stable identity rather than issuing another payment/order.

Help is an explicit native-chat action preserving safe checkout draft and a safe return route. Opening chat sends nothing automatically; product/order context requires its normal explicit Send and verified access. Chat overlays cannot cover final money controls, totals, validation or provider-recovery instructions. Return from support restores the correct checkout step and verifies quote/stock freshness. Compact factual policy links remain accessible; category navigation/campaign footer are absent from this task shell.

### Accessibility and Device Contract

Use one checkout heading, labeled step progress, keyboard-operable summary disclosure with expanded state, semantic forms/radio groups and consistent action labels. Enter in an address multiline field creates a newline; only explicit confirm/appropriate form submission commits. Announce meaningful changed totals/validation without stealing focus on refresh. Keep keyboard focus visible, 44 CSS-pixel touch-target goal, 320px reflow and 200% text. Virtual keyboard, orientation and dynamic browser chrome preserve active field/error/next action; sticky summary is disabled when viewport space is inadequate. No persistent bottom tabs, chat launcher and payment bar may overlap. No browser or physical-device accessibility conformance is claimed before execution.

### Checkout Tracking Milestones

The following are first-party semantic milestones, not presumed Shopify SDK events or automatic Meta standard-event mappings. Reference the existing advertising/consent owner for wire names, dedupe and dispatch; never transmit typed values, destination IDs that expose sensitive address, URLs with capabilities or native-chat contents. A validation milestone proves validated form state, not identity/contact ownership.

| Milestone | Trigger and stable scope | Excluded interpretation |
|---|---|---|
| Checkout started | Checkout flow entered with an actionable cart; identify checkout and logical visit/attempt; rerender does not generate a new action | Not a pay-button click or Purchase |
| Contact validated | Required contact form successfully validated and explicitly advanced; version/fingerprint dedupes unchanged repeat | Not every keystroke, phone verification or marketing consent |
| Address validated | Canonical destination hierarchy and required address accepted for current checkout version | Not merely selecting an unvalidated suggestion or guaranteed carrier coverage |
| Shipping selection accepted | Supported parcel service/allocation selection accepted with current quote; record safe parcel counts/value basis | Not quote-loading or a shipping-cost guess |
| Payment method accepted | Valid available method selected/accepted for current review; no card data collected | Not successful payment or merely rendering method options |
| Authoritative order confirmed | Backend persists the order/accepted COD or prepaid attempt and returns/reconciles its existing operation | Not thank-you-page load or cash received |
| Prepaid paid / COD collected | Backend-authoritative payment or actual COD collection evidence; canonical monetary allocations and event IDs | Only this governed outcome may become Purchase; no extra Purchase on delivery/reload/refund/replacement/settlement |

Shopify references inspected 2026-10-16 distinguish [checkout start](https://shopify.dev/docs/api/web-pixels-api/standard-events/checkout_started), [shipping information submission](https://shopify.dev/docs/api/web-pixels-api/standard-events/checkout_shipping_info_submitted) and [payment information submission](https://shopify.dev/docs/api/web-pixels-api/standard-events/payment_info_submitted). Their exact emission frequency is platform-specific; the first-party contract above remains authoritative for 99ribu.

### Planned Checkout Acceptance Matrix — not executed

| Scenario | Viewport/environment | Required result |
|---|---|---|
| Guest one option, multipack, mixed bundle and two offer units | 390 / 1440 CSS px | Each complete offer Rp99.000; two offer units Rp198.000 before disclosed charges; no component double-charge or required account/email |
| Two warehouses prepaid and COD, one route unsupported | 390 / 768 / 1024 / 1440 | Package origins, contents, shipping/subsidy and individual COD due readable; invalid combined method blocked with recovery |
| Tablet portrait/landscape and enlarged text | 768 / 1024, orientation, 200% text | Stack/two-column changes preserve form, selected service, focus and all totals; no user-agent authorization or reset |
| Destination parent change/loading/failure/no result | Mobile/desktop keyboard and touch | Child IDs/quotes invalidated, unrelated fields retained; correct focus and retry; no mismatched route |
| Quote expiry, stock loss, budget or method change | All target widths | Explicit revised affected totals/options; preserved draft; confirmation requires review, never silent substitution |
| Double submit, timeout after backend commit, offline/reconnect | Mobile/desktop | One order/attempt; existing-result lookup; no silent reconnect submit or false paid state |
| Payment external return before webhook, Back/reload/cancel | Safari/Chrome; physical iOS/mobile browser when available | Original order survives; authoritative pending/failed/paid state; no URL capability or duplicate Purchase |
| Collapsed summary, long multi-parcel cart, short viewport | 320 reflow / 390 / 768 / 1440 | Known total stays available; unknown shipping labeled; full package review reachable; sticky region never traps totals/focus |
| Explicit support entry and policy/cart navigation | All widths | Safe checkout step/draft restored, no auto-message or floating chat obstruction; quote freshness rechecked |
| Keyboard, screen reader, virtual keyboard and orientation | 320 reflow, 200% text, Safari/Chrome | Visible label/error/focus, operable summary, adequate target size and no covered action |
| Tracking step retry/reload and successful/failed payment | Integration/browser fixtures | Milestones follow validated semantic transitions once per relevant scope; no input/PII leakage; Purchase only confirmed backend money outcome |

All checks are planned. Tokophi local source and official written Shopify references inform the contract; no deployed Tokophi checkout interaction, actual iOS device, provider transaction, 99ribu screenshot or browser PASS is claimed.


## Thank-You Receipt and Returning Order Status Contract — 2026-10-16

Refines UX-1/UX-4, the existing Payment/confirmation and Tracking/order detail screens, and TY1–TY8 in the design system. The initial thank-you result and later order-status visits read the same canonical order/payment/parcel/return resources. Route names are implementation details; every entry verifies current buyer/guest access before fetching/displaying facts. Do not duplicate an order, reserve stock again or create a payment because this page loaded.

### Entry, Content and Primary Actions

Initial entry follows authoritative order creation/reconciled confirmation or a validated payment return. Read current order state server-side; provider query flags, browser storage, receipt headings and a successful redirect cannot establish payment. Direct revisit, refresh, browser Back/Forward and external WebView return recover the existing order. Unknown reference/out-of-scope access uses the same privacy-preserving response; approved verified-contact/sign-in recovery supports guests without requiring account creation. Capabilities/contact/address/payment credentials never appear in the navigable URL, clipboard share, page metadata or analytics. Anonymous/unverified viewers receive no order amounts, contents or contact details.

Content order is outcome/reference → action required → receipt → parcels → permitted contact/delivery details → help/policies. Desktop uses main outcome/timelines and receipt summary; tablet adapts by actual space; mobile stacks with immediately reachable action and total. Show frozen purchased offer contents and quantities, merchandise subtotal, each parcel shipping/subsidy, approved fees/tax, total charge, payment outcome, confirmed refund and outstanding due without conflating them. Quantity refers to Rp99.000 offer units, not bundle component pieces. No bank evidence, financial-cost/profit or affiliate identity leaks into the buyer receipt. Receipt/invoice wording distinguishes an order acknowledgement from verified payment evidence and any tax invoice whose applicability remains a finance gate.

| Authoritative state | Required buyer wording/visible facts | Primary and safe secondary action | Invalid inference prevented |
|---|---|---|---|
| Order recorded; prepaid pending | Order reference, payment awaiting confirmation, payable amount and issued expiry if known | Continue existing valid payment; Check status; Help | Order placed is not paid; no new order from retry |
| Prepaid paid | Payment confirmed with supported confirmation time/reference; fulfillment still separately pending/preparing | View package status; inspect receipt; Help | Paid is not shipped/delivered |
| Prepaid failed/cancelled | Existing order and failed/cancelled attempt; only permitted retry and current eligibility | Retry permitted payment on same order or choose supported alternative; Help | Cancelled browser handoff is not confirmed cancellation/refund |
| Prepaid expired | Exact expired attempt/reservation facts and current order state | Revalidate permitted attempt/stock/quote before retry; explain changed totals or approved refund path | No silent revival of reservation or second order/payment |
| Provider/backend outcome unknown or unavailable | Last known safe state, refresh time, checking/recovery explanation | Check original attempt status, bounded retry/read refresh; Help | No paid checkmark or blind second payment; stale data labeled |
| COD accepted, not collected | Order accepted; each parcel's exact cash due, courier/service if verified and separate shipment progress | View packages; copy privacy-safe household cash summary explicitly; Help | Accepted, waybill issued or delivered status alone is not actual collection |
| COD partially collected / split outcome | Collected amounts/quantities by evidence-backed parcel allocation; remaining due, refused/failed parcel and next step | Inspect affected package; Help/resolution under existing policy | No whole-order collected/complete label while unresolved; no double due/duplicate charge |
| Partially dispatched/delivered | Each parcel's actual preparation/handover/tracking/receipt; overall partial status and unresolved parcels | Track selected parcel; permitted delivery issue/claim | Tracking issuance is not departure; one receipt does not complete others |
| All delivered | Actual supported receipt facts per parcel; payment still independently accurate | Review delivery/return terms; eligible claim; Help | Delivery cannot manufacture cash collection or end an active refund |
| Return/replacement active | Affected option quantity/components, case state and original/replacement lineage; permitted next evidence/action | View case; add requested evidence or inspect replacement parcel | Replacement is not a new sale; unaffected quantities retain their history |
| Refund pending/failed/unknown | Approved/requested versus actually confirmed amount/method distinguished; current reference | View refund status; Help; reconcile existing action | Claim approved is not money refunded; no new payment request to resolve refund |
| Partial/full refund confirmed or order cancelled | Actual refund allocation, original total and retained history; unaffected parcels/items stay accurate | View receipt/case and permitted next step | Never erase original receipt or apply full refunded/ cancelled state to unaffected quantities |

### Calendar, Contact, Notifications and Support

Display processing deadline only from approved warehouse calendar/version, preserving the original payment/COD anchor. Public/major holiday closures affect processing, not ability to view orders or send support messages. Label provider delivery estimates as estimates and actual handover separately; no promised 24/7 warehouse staffing, guaranteed arrival or automatic pickup. Existing return/referral/maturity windows are not extended by shipping holidays. Dates/timezone and source freshness stay legible.

Show only verified session-authorized contact/address facts, with masking where appropriate. Optional email/account setup and marketing preference are secondary; neither can gate receipt, guest tracking, claim access or payment recovery. Notification status is factual: queued/sent/failed only when recorded; never say an email/SMS/WhatsApp receipt was sent merely because an address/phone exists. No WhatsApp dependency. Native support opens by explicit action with optional reviewed order context; Send context remains explicit and order linking verified. Return from chat restores order/scroll context and refreshes authoritative state.

Shipping/address edits, cancellation or refunds appear only where existing policy/state/provider capability allows; thank-you is not a new unrestricted editing surface. Financial mutations retain their guarded domain flow. No automatic order repeat, paid upsell, forced subscription, prechecked marketing consent or invented promotional reward distracts from outstanding payment/recovery.

### Read/Refresh, Accessibility and Session Recovery

Loading reserves outcome/receipt geometry without displaying fabricated order facts. Background refresh retains safe prior data with freshness; bounded polling/backoff and explicit Check status recover pending states. Offline shows stale last-confirmed facts and disables authoritative mutations; reconnect never silently pays, submits a claim or creates an order. Revoke/expiry clears private content before recovery. Read errors do not lose the server order. Focus stays stable during refresh; announce only meaningful state changes, not every poll.

At 390/768/1024/1440 CSS pixels plus 320px reflow and 200% text, outcome, total and next action remain reachable. Virtual keyboard, orientation, short landscape viewport and safe-area insets cannot cover verification errors/support composer/action. Target 44px touch controls, semantic headings/lists/timelines, readable time labels, text/icon status beyond color and keyboard-operable receipt/item disclosures. Desktop sticky summary becomes normal flow if it cannot fit. A single state-appropriate primary action avoids competing bars; modal/image/help dismissal returns focus to its trigger or meaningful heading. No auto-scroll, confetti or focus jump is required for success.

### Tracking Contract and Reconciliation

| Event/milestone | Trigger and ownership | Required guard |
|---|---|---|
| Thank-you/status view | Authorized initial result/revisit actually displayed, recorded as first-party view with safe route/state enums | View identity distinct from conversion; no order capability, contact, address, payment details or raw private URL sent |
| Status changed | Authoritative state revision observed and rendered | Dedupe repeated polling by resource/version; no Purchase from frontend state watcher |
| Continue payment / Check status / Track parcel / View case | Explicit permitted UI action | Click records intent only; no money, delivery or refund completion inferred |
| Support opened / Context sent | Explicit open versus explicit validated Send separately | No message body, context-private facts or automatic Lead/Purchase mapping |
| Receipt copy/download, if supported | Explicit own-authorized action on available artifact | Private no-store retrieval; no invented invoice/notification delivery proof |
| Purchase browser companion (optional later Meta/TikTok mode; initially disabled) | Backend-approved eligible monetary event, ID, amount, currency and allocation provided through authorized server contract; consent permits | Initial mode disabled; later Meta/TikTok only after adapter verification, Google excluded pending its separate contract. Share same event_name/event_id as server, emit only permitted fresh companion once; no new ID from reload/route/visibility; if approval/window absent omit browser leg |
| Purchase server | Verified prepaid payment or actual COD collection, independent of thank-you/browser availability | Transactional outbox, permanent business-effect identity, nonoverlapping allocation; refund/delivery/replacement/settlement never creates another Purchase |

PR-23 and the Technical Design govern Meta/Google/TikTok mappings, consent, identifiers, dispatch/expiry and diagnostics. Initial Purchase dispatch is server-only on all three platforms; Google browser Purchase remains disabled unless its separate compatible multi-source contract is accepted. a thank-you view cannot override it. Shopify [checkout_completed](https://shopify.dev/docs/api/web-pixels-api/standard-events/checkout_completed), inspected 2026-10-16, can be absent when its expected page fails to load; it is written platform context, not 99ribu's payment authority or installed SDK. Verify conversion delivery even when the buyer closes the tab before return; reconcile partial COD sums, refunded amounts and missing/duplicate events against backend truth rather than counting receipt page visits.

### Planned Thank-You Acceptance — not executed

| Scenario | Required observable result |
|---|---|
| Paid prepaid vs pending before webhook; browser closed before return | Accurate distinct headings/actions; server money event persists regardless of page visit; no page-load Purchase |
| Failed/expired/unknown payment and timeout/repeated Check status | Same order/attempt recovery; no blind recharge; revised quote/reservation reviewed if necessary |
| COD accepted, one parcel collected and another refused; all delivered without collection proof | Exact per-parcel due/collected/exception; no premature whole-order paid or double-counted Purchase |
| Partial/full refund, approved-but-pending refund and replacement | Original frozen receipt retained; actual refund/status independent; unaffected item/package preserved; no new Purchase |
| Direct link, wrong buyer, lost guest session, cross-device verified recovery | No unauthenticated order facts; verified recovery without forced account/email; no URL secrets |
| Two offers, mixed bundle, two warehouses and long receipt | Rp99.000 offer basis and conserved totals; all contents/fees/COD allocations accessible; no component double charge |
| Holiday order, pending waybill, actual handover and receipt | Truthful calendar/estimate/actual event; no fabricated shipping promise or reset anchor |
| Native help/context, optional email/marketing and notification failure | Explicit context send and safe return; receipt never gated; notification failure shown honestly |
| Refresh/Back/multi-tab/offline/reconnect/status revision | Server truth preserved; private state clears on expiry; no duplicate mutation/event or polling announcement spam |
| 390/768/1024/1440; 320 reflow/200% text; Safari/Chrome/physical iOS when available | Visible receipt/total/action; keyboard/focus/touch-safe disclosures and no overlay obstruction |
| Ads denied consent, stale browser companion, repeated receipt view and failed provider send | Omit prohibited/stale companion; server outbox follows consent/retry policy; permanent effect IDs and diagnostics distinguish source receipt from attributed outcome |

No scenarios executed. Shopify written research is cited; Tokophi checkout captures at 390/768/1440 are 404/error pages and not visual checkout/thank-you evidence. Only its bounded local checkout source informs transferable composition. Browser/provider/account tests, screenshots and design gate remain future implementation evidence.

## Corrected Tokophi live-store reference — 2026-10-16
Observed: the owner identified https://batik-nusantara.tokophi.id as the built storefront. Anonymous browser navigation of its /checkout resolved to https://batiknusantara.tokophi.id/checkout. The correct checkout shell was captured and visually inspected at 390/768/1440 CSS pixels in design/refs/tokophi-store-checkout-20261016/ (ref.json plus screenshots). This supersedes the earlier lack of live checkout-shell evidence; the unrelated tokophi.com/checkout 404 captures remain excluded.

The inspected state is empty cart, not a populated checkout or thank-you page. Mobile 390 and tablet 768 display a compact identity/cart header, stacked layout, summary disclosure with visible total and an explicit empty-cart shopping recovery. Desktop 1440 displays the same focused shell with main content left and recessed neutral order-summary zone right. Inter is recorded as the computed family; this alone does not prove font-network or fallback behavior. These observations support CO1–CO4 and existing type selection. Summary disclosure interaction, populated forms, valid shipping/payment, private receipt and actual conversion delivery were not tested. Reference blue stays excluded; 99ribu retains purple/yellow. For 99ribu empty-cart recovery, do not imply a payable zero-order; absent shipping is not a final zero quote and optional voucher controls need not distract from shopping recovery.


## Mobile Web-App Refinement — selected 2026-10-16
Decision: refine PR-17/UX-4 across the buyer journey; retain existing chat, CO1–CO8 checkout and TY1–TY8 receipt contracts as their canonical detail. The job is fast multidepartment discovery and a recoverable purchase on a phone. This is a browser-first experience with meaningful links, shared Next.js/backend identity and server-rendered initial content; installability, a native wrapper or a full SPA is not required. Exact technical mode detection remains an implementation gate and never changes business/access rules.

### Navigation and State Ownership
Four labeled shopping destinations remain Home, Categories, Cart and Account, with current destination semantics and an authoritative cart badge counting offer units, not bundle components. Account exposes Orders, Support conversations and authorized Affiliate entry without forcing guest registration. Contextual support also exists on PDP/checkout/order screens. A generic unread indicator never reveals message contents; chat unread and cart quantity are distinct. No fifth unstable promotion tab or staff/admin controls in buyer navigation.

Shopping tabs apply to discovery, lists, cart and account. PDP uses task Back and its purchase region in place of bottom tabs; checkout uses step navigation; chat uses thread navigation/composer; thank-you/order task uses its next action. Only one persistent bottom region owns a task at a time. Returning from these tasks restores the source destination, filters and scroll. A tab tap changes destination; reselecting the active tab is non-destructive and does not silently clear filters, scroll position or form. An explicit return-to-top control can be added if useful. Browser Back closes a history-backed sheet, then returns through screen/step history; it does not submit or cancel an order. Direct links provide a labeled parent/store fallback.

Public category/search/sort/filter/variant state uses canonical shareable URLs where appropriate. Never put private drafts, address, phone, capabilities or chat search text in URLs. Cart/order state is server-authoritative. Keep harmless list position, selected category and public filter draft within the correct tab/history entry; sensitive form/chat draft storage follows existing principal-scoped privacy rules. Sign-in, expired session, switch principal or restored browser session rechecks access and clears unauthorized private presentation. Do not promise local storage durability or automatically merge guest/customer data.

### Discovery, Product and Cart Behavior
| Surface | Selected mobile refinement | Recovery and decision guard |
|---|---|---|
| Home | Compact identity and reachable search; category discovery early; concise genuine Rp99.000 proposition; useful product groups with real imagery | No full-screen fashion hero/carousel before discovery; missing merchandising leaves search/categories usable; no invented sales counts |
| Categories | Clear department → category/subcategory hierarchy with selected context; full labels readable | Switching category never silently preserves incompatible filters; Back restores prior list/category state |
| Search | Dedicated search entry with clear/submit/cancel, retained query and usable keyboard Search action; suggestions only from actual data | Debounced/cancelled requests cannot overwrite newer results; loading, no matches and failed request differ; no invented personal search history |
| Results/filter | Compact category/query context, Sort and Filter controls, count of active filters, removable selections; one purposeful sheet | Filter edits are draft until Apply; Cancel discards only unapplied edits; Reset changes draft then Apply commits. Search is not held hostage by a failed optional facet. Keep prior results while updating with clear status; stale response cannot replace current query |
| Product grid | Two readable columns at normal phone width; one column when text/available width requires. Image/title/option facts and Rp99.000 per offer visible | No horizontal page overflow or clipped distinguishing option; real bundle contents indicated. Results use explicit Load more with retained anchor and a retry, not forced endless scroll; Back restores already loaded results |
| PDP media | Real media first with visible image position and accessible next/previous alternatives; image viewer closes back to same item | Swipe optional; no gesture-only zoom/navigation, autoplay media or motion required; image aspect space reserved to avoid moving controls |
| Variant/quantity | Visible selected offer, included physical contents, option availability and quantity before purchase. Long selection uses a labeled accessible sheet | Never auto-select another option on stock loss; quick add only when option is unambiguous and required facts known; sheet selection updates the real product state |
| PDP purchase region | Selected offer price, availability and explicit Add to cart in one bounded bottom region; secondary help in task content | Pending mutation prevents repeated action; success confirms exact offer/quantity and gives View cart without forced navigation. Unknown result reconciles same mutation; unavailable option offers a real alternative |
| Cart | Full task review grouped by offer identity, option contents and stock exception; quantity/remove and visible subtotal/shipping-not-final | Pending quantity updates disable checkout until reconciled. Removal uses explicit action; confirmation or a supported Undo preserves the exact line and revalidates stock, never gestures alone. Empty cart offers discovery and no payable zero-order |
| Orders/account | Guest-safe entry, list/detail, readable status and exact next step; support and affiliate destinations where authorized | Independent payment/parcel/refund states; no forced registration, withdrawn permissions or stale links leaking history |

Equal prices make useful category/attribute/availability information more important than price sorting. Do not add meaningless price sliders or fake popularity. Preserve selected catalog feed/offer identity in product cards, mutations and analytics. Native chat, holiday-aware processing, COD breakdown and guest recovery retain their existing rules.

### Sheets, Keyboard, Chrome and Feedback
Use bottom sheets for bounded selections such as filters/variants; full-screen task views for long forms, multi-step checkout and message history. Each sheet has a heading, labeled close, visible action and focus restoration; background is inert while modal, body scroll is locked only for its lifetime, and browser history is reconciled on close/Back. Dismissal cannot discard a committed operation. Drag-to-dismiss is optional with an accessible close alternative; avoid nested sheets. Native system permission prompts never substitute for product explanation.

Use layout-based dynamic viewport sizing with safe fallback and CSS env(safe-area-inset-*) padding where supported; browser bars can expand/collapse without hiding last content. Reserve document space for the actual task action region. Keyboard opening leaves input, associated error and next action visible; hide nonessential shopping chrome, keep required composer/actions usable, and restore without resetting draft or scroll. Prefer normal flow when short landscape or enlarged text cannot support a sticky region. Do not infer keyboard state from user-agent or promise one viewport API works in every embedded browser.

Keep input/body text at the selected 16px baseline, meaningful input type/inputmode/autocomplete and paste/password-manager support. Phone/postcode are text/tel values, not arithmetic quantities that strip leading zeros. No disabled browser zoom. House touch target goal is 44 CSS px with adequate spacing; swipe/hover/long-press never the only action. Announce cart changes, validation and committed outcomes once with restrained status messages; keep focus stable through background refresh. Error messages explain the next action near the affected control; temporary toast cannot be the sole record of a failed order/payment.

Reserve skeleton geometry for unknown content; never fabricate stock, totals or success. Distinguish first loading, refreshing existing data, empty, no matches, partial failure, denied and offline. Offline keeps only safe currently displayed facts labeled stale; no persistent private cache is implied. Retry is deliberate, scoped and idempotent; reconnect cannot automatically submit cart/payment/chat or replay Purchase. A small connection notice must not obscure the current primary action. Optional decorative movement respects reduced motion; no artificial transitions delaying cart/checkout.

### App Features and Performance Boundary
Decision: app-like mobile usability is required now; install/PWA, browser push, native biometrics and offline transactions are not added by this refinement. If installability is authorized later, use an actual manifest/icons/supported-browser install path and a dismissible contextual invitation after demonstrated use, never before checkout; installation cannot gate shopping. No generic service-worker caching of private orders, checkout or financial responses. Existing security and privacy boundaries apply in browser, standalone display and any future wrapper.

Server-render product/category identity and useful initial content. Load interactive code where required, reserve product image dimensions and defer below-fold media; avoid shipping operator UI to buyer routes. Retain existing Core Web Vitals goals without claiming they pass. Consent-aware tracking follows PR-23 actual occurrences; navigation, sheet opens, cart badge rerenders and page resumes never fabricate checkout/order/Purchase events. Measure funnel failure categories without form/chat/identity leakage. Ads in-app browsers must have explicit supported external-payment/recovery behavior rather than silently assuming shared cookies.

### Planned Mobile Web-App Acceptance — TEST-33
| Scenario | Required result |
|---|---|
| Home → category/filter → product → Back; Load more and tab round-trip | Same public query/selections, loaded items and reading anchor restored; no stale fetch replacing newer state |
| Search submit/clear/cancel; failed suggestions/facets; no result | Search remains operable; clear and cancel differ; errors/no matches have purposeful recovery |
| Filter draft/apply/reset/cancel; sheet Back/close/orientation | Applied query remains truthful, draft behavior predictable, focus restored and scroll lock released |
| PDP direct variant link, missing/sold-out option, image viewer, two genuine repeated cart additions | Actual selected offer and contents; usable alternative; distinct committed mutations and accurate cart count |
| Cart quantity rapid changes/removal/retry and stock loss | Latest authoritative amount wins; no negative/duplicate line; checkout waits for known state |
| Keyboard, dynamic browser bars, notch/safe area, short landscape and 200% text | One usable bottom region; field/error/action visible, no clipped totals or hidden final content |
| 320/360/390/430 phone,768/1024 tablet,1440 desktop | Readable reflow and distinct accepted composition; no horizontal document overflow, reset or role/state changes |
| Guest/session expiry, sign-in cancelled, different principal, payment app/tab return | Safe recovery, no private draft leakage, duplicate order or assumed cookie continuity |
| Slow/partial/offline/reconnect, blocked font/script/tracker | Truthful state and retained safe context; no silent send, fake success or advertising dependency |
| Keyboard/screen reader, touch alternatives, reduced motion | Named controls and current tab, visible focus, reachable disclosures and no gesture-only action |
| Chrome Android, Safari iOS, Meta/Instagram and TikTok in-app browsers where available | Actual tested support recorded; unsupported handoff has explicit external-browser recovery; no wrapper-wide claim from one browser |

No prototype/browser/physical-device acceptance is executed by this Markdown update. Existing reference captures establish only their observed live states. Record macro layout renders and later refinement renders under the Design System gate before declaring mobile UI ready.

## Indonesia Admin Workspaces and Buyer Account Completion — 2026-10-16
Decision under CTX-17: complete PR-13/PR-14 using real operational cases rather than generic dashboard decoration. Official Mengantar status guidance documents incomplete address, absent recipient, COD refusal and amount-confirmation states; its order-history guidance supports filtering by date/status/ticket. Formulir's official help documents unavailable label output when shipping funding is unpaid. These establish relevant failure categories, not their prevalence in 99ribu or a universal API mapping. Shopify provides reference patterns for private account/profile/address management and printed documents. No measured local conversion/RTS percentage is invented.

### Role Home, Navigation and Work Ownership
| Role | Home priority and authorized navigation | Next action / prohibited shortcut |
|---|---|---|
| Owner / Super Admin | Company exceptions/readiness, full order history, catalog, stock/warehouses, fulfillment, returns, CS, finance, affiliate liabilities, configuration/access/audit | Resolve owner decisions through scoped workflows; full visibility never bypasses transfer proof or immutable history |
| Ecommerce admin | Catalog blockers and fulfillment coordination; permitted orders, product publication, inventory operations, promotion/subsidy settings | Correct catalog/stock/quote exceptions; no default profit/HPP/bank evidence or payout execution |
| Warehouse | Assigned deadline-first shipments; pick/physical preparation, issued waybill, labels, handover, stock/transfers/quarantine and assigned inspection | Process own warehouse/package only; no whole-order totals or global buyer history |
| Customer service | Existing unassigned/mine conversations plus delivery-exception/return queues | Claim/respond, record clarification and escalate provider/finance work; no refund execution, collected/paid override or beneficiary editing |
| Finance | Unmatched settlement, receivables, approved refund work and exclusive manual affiliate payout queue | Reconcile amounts/evidence and guarded money actions; costs require explicit grants; no editing previous receipt/posting to force a match |
| Buyer | Own unresolved orders and recent history, returns, support, profile, saved addresses, notification/security tools; authorized affiliate entry | Resume real next action; neither account creation nor optional email/marketing gates existing guest access |

One internal application renders only granted groups; source roles remain unchanged. A multi-role operator can choose an authorized workspace, with explicit scope and preserved context; changing workspace grants no extra permissions. Company settings/access/audit remain owner-scoped, not a second Super Admin site. Product labels are Bahasa Indonesia, currency IDR; timestamps show relevant business/warehouse timezone and as-of freshness, not Singapore-server timezone by accident.

### Metrics That Lead to Work
Each metric declares snapshot versus event-period basis, scope/warehouse, period/timezone, data completeness and as-of timestamp. Selecting it opens its exact filtered queue with matching time basis. Unavailable or partly synchronized data is labeled, never zero. No same-named card may use a different filter than its drilldown.

| Metric | Definition and decision supported |
|---|---|
| Orders accepted | Distinct persisted parent orders created in period, with payment-method/cancellation breakdown; not offer units, parcels or advertising purchase instances |
| Issuance overdue | Actionable parcels past original snapshotted valid-waybill deadline without issued valid AWB; separate from handover overdue |
| Handover overdue | Parcels past the separate physical-handover deadline lacking actual evidence; printing cannot clear it |
| Open delivery exceptions | Distinct current unresolved parcel/case, with reason/operator/next action; unknown provider status goes to review |
| COD receivables | Verified customer collection owed by provider but not settled to company; separately show in-transit expected COD, which is not realized collection or cash |
| Refund outstanding | Approved remaining refundable obligation; execution pending versus outcome unknown, net of confirmed allocated refunds |
| Affiliate payable | Matured unallocated liability separately from reserved queued/processing payout allocations; sum without counting the same allocation twice |
| Contribution | Estimated frozen-cost contribution and posted actual contribution shown separately; missing HPP/fees produce incomplete estimate, never zero cost or claimed profit; overhead and cash separate |
| Inventory | Physical component available/reserved/in-transit/quarantine by warehouse; complete-offer availability derived, not a duplicate bundle stock counter |

Owner/finance may view authorized analytical trends; warehouse/CS homes prioritize exceptions and queues. Use temporal line/column trends or ranked bars only when useful, with accessible tabular values; no pie/gauge row required. No committed uptime, forecast, margin or response target is fabricated to fill a KPI.

### Queue, Detail, Bulk and Export Contract
Orders retain completed/cancelled/refunded history; filters include safe reference, creation period, independent payment/fulfillment/return state, warehouse and method. Fulfillment rows prioritize parcel/order reference, warehouse, carrier/service, issuance/artifact/print/handover state, next deadline and exception. Inventory uses physical SKU/warehouse balances and movement type/date/reference/actor. Finance prioritizes source/reference, amount/difference, match/execution state and age. CS keeps existing claim/status/unread/tag/priority contracts. Full detail shows immutable purchased-offer/parcel snapshots, permitted private fields and chronological evidence, with payments, shipping and return cases independent.

Lists are server-paginated with bounded page sizes and deterministic cursor/order. Public-safe filters and selection context survive Back; private contact searches are not put in a shareable URL. Distinguish no initial setup/data, filtered zero, denied, stale/partial sync, conflict and source failure. Pending mutations show affected rows; stale versions require explicit review, not last-write-wins. Returning from detail restores the same filtered queue and reading anchor.

Initially bulk selection means explicit selected rows on the current page; display count/scope and clear/review on filter change. Allowed actions are approved existing operational actions and label generation/download/printing within scope. Preview eligible/excluded/conflicting rows before execution, reauthorize/version-check each, show succeeded/failed/unknown separately and retry only original unresolved operation identities. No bulk mark-paid, collected, delivered or handover merely because labels printed. Print batch does not create an arbitrary new carrier batch booking.

CSV exports require separate field/scope permission and a bounded explicit dataset/filter/time snapshot. Start with bounded synchronous export; only introduce durable export jobs if measured volume exceeds the agreed safe limit. Oversized export asks to narrow or uses an explicitly implemented job, never silently truncates. Private downloads recheck permission, expire and audit actor/scope/count; escape spreadsheet formulas and exclude secrets/private evidence by default. Warehouse exports exclude whole-order financial data. Per-format limit remains [TBD owner=Engineering owner; due=before export implementation].

### Documented Delivery Cases and Recovery
| Case | Required workflow |
|---|---|
| Incomplete/stale address | CS verifies scope, records missing clarification and permitted provider action; saved-address edit does not rewrite issued shipment |
| Recipient absent/unreachable | Explain affected parcel/last attempt, ask customer to confirm availability/contact via native support, record follow-up and responsible operator |
| COD refused / amount disputed | Display original frozen amount and provider reason, investigate duplicate/unrecognized parcel; never silently alter amount or mark paid |
| Amount confirmation / delivery without collection proof | Finance/CS exception remains open until authentic evidence; no Purchase or payout funded by an assumed collection |
| Missing funding or label artifact | Distinguish shipping wallet/funding eligibility from buyer prepaid payment; show blocked state/recovery, not an empty PDF or another booking |
| Redelivery/RTS | Show request/status only when current service permits; manual assisted escalation otherwise. Do not promise automatic redelivery or unrestricted return-address changes |

Local public provider descriptions may be ambiguous, including return-versus-outbound delivery wording. Normalize by carrier/event context and issued schema; preserve raw safe status in staff detail. Never map every text containing Delivered to successful buyer receipt or COD collection. Provider-side re-delivery/claim window differs from99ribu buyer return policy.

### Buyer Account Screens and Safe Continuity
| Surface | Content and action contract | Material recovery |
|---|---|---|
| Entry/home | Guest shows sign-in benefits and verified guest tracking/help; signed-in buyer sees own next-action orders, returns, messages and profile/address/preferences/security | Preserve safe cart/return destination; no cached prior buyer details, forced email or account to shop |
| Profile | One full-name field supports single-word names; account contact/verification separate from recipient details; versioned explicit Save | Missing optional email accepted; conflict keeps input and reviews newer state; no KTP, birth date, gender, bank wallet fields |
| Contact/security | Existing verified identity, approved sign-in/session/sign-out controls and pending contact change | Reauthenticate, verify new contact and activate atomically; collision does not merge accounts; lost old channel follows supported recovery; no invented SMS/WhatsApp delivery |
| Addresses | Own optional address list, Add/Edit/Delete, explicit default and recipient contact | Canonical province→kabupaten/kota→kecamatan→kelurahan/desa/postcode plus street/building/house; optional RT/RW/patokan. Invalid parent clears dependent ID/quote; stale provider mapping requires review. Deletion/default change affects future checkout only |
| Orders | Bounded own history and filters including cancelled/completed/refunded; detail uses TY/private order contracts | Payment, parcels, COD due/collected and return/refund independent. Any Repeat order action rebuilds current cart after stock/quote review, never copies a paid order blindly |
| Return/detail | Own eligible quantity/case, requested/approved/confirmed refund distinction and safe evidence | No duplicate active claim; affected replacement lineage and deadlines retained; no unrestricted edit/cancel shortcut |
| Guest linking | Optional reviewed link to authenticated account after proving current account and specific guest-order access | Explicit selected record(s), one-time proof, idempotent result; no merge by identical contact, success-page access or order number; support identity linked independently |
| Notifications/privacy | Existing in-app attention plus configured essential service/security channels, separate optional marketing; verified privacy-request route | Missing verified channel disabled with explanation; no automatic push; muted/seen notice does not change chat read or hide orders; deletion request respects required evidence retention |

Profile/address contact is not payment beneficiary or login ownership. Editing reusable details never rewrites immutable order snapshots, live label address or historical proof. Session/principal changes clear private displayed/draft state; shared devices and revoked notification links must not expose previous orders. Account security method, session revocation capability and contact-delivery channels remain explicit auth implementation gates; the Shopify email-code pattern is inspiration, not selected 99ribu sign-in behavior.

### Label Print Center — PR-25
Entry from eligible assigned fulfillment/detail opens parcel-specific preview or a scoped print batch. Show carrier/service, parent/parcel reference, exact active AWB, source/template version, brand mode, physical stock format, COD collection per parcel, artifact readiness and previous print attempts. Separate actions Generate label, Download/Preview, Print and reasoned Reprint. Disable or explain no AWB, unpaid shipping funding, unsupported format, missing brand approval, generating/failed/unknown, expired download, superseded/void shipment and lost scope.

Preview chooses approved 99ribu template when verified; otherwise original carrier label plus clearly identified separate99ribu sticker/packing slip. Brand masking and provider-supported recipient-privacy masking are separate settings/capability states. Print UI never silently censors delivery details. A batch displays explicit eligible/excluded rows and exact stable page-to-parcel mapping. Operator confirms the right paper/scale and physical package match; dialog open or download is recorded only as attempted. Reprint reuses active AWB/artifact; another parcel cannot borrow that label. Changed shipment data invalidates stale artifacts and prevents printing an old label.

Preferred stock is 100×150mm thermal when enabled/supported; ISO A6 is 105×148mm and is a separate format, not a synonym. A4 sheets have explicit per-label placement/cut boundaries and consistent order. Monochrome99ribu identity is sufficient on thermal; source brand palette remains for screen. Protect barcode clear space, keep carrier/service/routing and authorized recipient/return information readable, and show exact COD amount rather than parent total. Internal pick list, buyer packing slip and carrier label are distinct; no HPP, affiliate data or staff notes on outer package. Any QR/code used for staff package matching requires authenticated access and must not expose an order capability publicly.

### Acceptance and Evidence Boundary
T-34 covers role navigation/metric-to-queue consistency, missing source, warehouse cross-scope, stale row, mixed bulk outcomes, exports and responsive detail. T-35 covers shared-device buyers, single-word name/no email, default-address deletion, stale region/postcode, contact collision/recovery, order snapshot preservation, guest-link replay/cross-order attempts and revoked notifications. T-36/T-37 cover async job restart/timeouts, no-AWB/funding block, expired artifact, void/replaced label, per-parcelCOD, reprint without charge and forbidden download. Physical printer/scanner/carrier acceptance remains required; no dashboard/account/label runtime or visual acceptance is claimed.


## S07 Contract Review and Identity Recovery — 2026-10-16

Observed: reviewed the existing screen/action/state/permission sections against PR-13/PR-14, DATA-1, IAM-1, the selected Inter/purple visual contract and the actual S04–S06 auth implementation. The seven canonical roles remain owner, ecommerce_admin, warehouse, customer_service, finance, buyer and affiliate; guest access is an expiring object capability, not an eighth staff role. Super Admin is the owner display name in one scoped administration application. No new business entity or second dashboard is introduced by this review.

Observed: purchase, return/replacement, affiliate maturity/transfer, stock movements, fulfillment, native chat and print contracts already specify pending, success and recoverable failure. Preserve their authoritative quantities and independent states: offer quantity versus physical components; paid versus COD collection versus settlement; issued AWB versus printed label versus physical handoff; verified receipt versus return/replacement eligibility. Partial replacement keeps the affected commission on hold with its own revised receipt anchor; unaffected eligible items remain separate. Warehouse screens use assigned shipment resources, never whole-order financial projections. Affiliate screens expose only own pseudonymous commission/payout records.

### Identity Screen and Action Completion

Decision under the existing delegated UX scope: the following interaction contract fills the identity entry/recovery gap. IAM and the supported auth implementation remain authoritative; these rows define future UI behavior, not implemented screens or new auth endpoints.

| Entry/action | Validation and permission | Pending and success | Denial, failure and next action |
|---|---|---|---|
| Account sign-in from Account or an authorized private destination | Current supported identity method; destination allowlisted to this application and reauthorized after sign-in; password-manager/paste support | Only the submitted form is pending; read the server session before navigating to the permitted destination | Generic invalid-credential response; retain safe identity field but never persist password/token. A denied staff destination offers own account/home without revealing the requested object |
| Create an email/password account | Current foundation requires a synthetic email in localhost and a 12–128-character password; one full-name field | Generic request acknowledgment; verification is pending, not a signed-in account. Successful verification leads to explicit sign-in | Existing account and new-account request responses do not disclose existence. Invalid/expired verification offers an explicit resend/sign-in route; rate-limit errors wait rather than auto-resend |
| Request/reset password | Current supported verified identity; server validates expiring single-use proof and password policy | Request acknowledgment does not claim external delivery. Successful reset revokes earlier sessions and returns to sign-in | Invalid/expired/replayed link clears its proof and offers a new request. Unknown network result checks session/sign-in state before repeating; never store the password in draft persistence or analytics |
| Sign out / session expires during a private task | Current authoritative cookie session; no user ID supplied as authority | Confirmed sign-out clears private view, caches and scoped drafts; public browsing can continue | Network failure does not claim server revocation. Clear displayed private state and offer explicit retry. Expired sessions require sign-in then revalidation of object/version before resuming any mutation |
| Staff MFA or sensitive reauthentication | Required staff grant, permitted object and supported fresh proof; changing workspace is not proof | Challenge completion returns to the original permitted action for explicit review and submit; never auto-executes refund, transfer, access grant or stock correction | Missing/expired challenge blocks the sensitive action, explains recovery without private fields and preserves only safe non-secret input. S09 owns MFA enforcement/proof lifecycle |
| Account contact change / optional-email account | Own principal, supported current/new-contact verification, collision and replay checks | Activate verified contact atomically and notify through implemented service channels; preserve historical order ownership/snapshots | Matching phone/email never merges identities. Missing supported recovery is an explicit feature gate; no fabricated SMS/WhatsApp delivery, email alias or successful contact state |

Observed implementation limit: S04 supports verified email/password only, current-session sign-out and reset-driven revocation. It does not implement phone-only account identity, staff MFA, native bearer issuance, contact changes or a safe device/session-list UI. Keep these controls absent from operational UI until their server contracts exist; no placeholder control may report success. The existing optional-email profile/account requirement remains in scope: S46 must implement a supported verified identity/recovery path for that case, including deterministic local delivery, and prove it before TEST-35 passes. Guest checkout remains account-free with optional email regardless of account-method readiness. S09 owns staff MFA, S10 owns reviewed transports, and S11 owns synthetic challenge/inbox fixtures; none of these gaps is closed by a prototype.

### Shared Mutation, Focus and Session Rules

Decision: preserve the existing per-action matrix with these explicit mechanics. A valid action remains submit-capable so validation can explain missing fields; while its request is pending, prevent duplicate submission and expose a textual status. A known business prohibition (unavailable COD, denied scope, issued/void label) may disable the action with its reason visible. On validation failure, associate errors with controls, announce a short summary and focus the first invalid field. For version conflicts, keep safe input and show the newer authoritative record for review; do not silently overwrite. For uncertain external effects, retrieve the original operation state; a button retry must not create a second operation.

Decision: session/principal changes invalidate private cached rows, account/address/order data, chat drafts, exports and preview URLs. Preserve only public shopping selections where safe; reauthorize any restored private route and never expose the previous user's form while auth is loading. Timeout on a mutation does not mean it failed: after reauthentication, recover its existing operation identity before permitting another attempt. Browser Back restores safe filters/reading position, never revives a revoked capability or private cache.

| Control | Required interaction contract |
|---|---|
| Modal dialog or mobile sheet | Labeled dialog; focus enters it, remains within while modal, Escape closes a reversible view, and close restores invoker focus. If that row disappeared, focus the next row or queue heading/empty state. Confirmations initially focus the least destructive choice |
| Filters, summary and nested detail | Native disclosure/select/checkbox controls where sufficient; disclose expanded state. Preserve real form labels, result count and reset path; no hover-only or gesture-only operation |
| Queue/table | Semantic table with header associations; normal Tab order for actions. No editable-grid keyboard model unless an implemented cell-editing job needs it. Mobile transformation preserves labels, state, amount and next action |
| Navigation and workspace | Links for navigation, buttons for actions; current-page indication and visible focus. A workspace choice changes presentation, not server authorization |
| Icons and feedback | Consistent functional SVG, accessible action names and text status; decorative SVG hidden from assistive technology. No emoji/emoticons, icon fonts, decorative sparkles or generic success claims. Indonesian copy names the actual result or next recovery step |

### Review Result and Downstream Gates

Observed document review result: buyer, affiliate and operator primary actions have an entry, scoped source object, validation, pending, success, denial and recovery through the existing matrices plus identity rows above. Fixed offer-price/component accounting, immutable history, role/warehouse isolation and selected mobile composition remain consistent with product/data/IAM owners. This closes the document-only TEST-14 review when structural checks and bound review pass; PR-14/UX runtime evidence remains unexecuted.

S08 must render the accepted prototype set at390/768/1440, including a recovery state and bottom-control ownership, before accepting presentation. Use synthetic facts clearly identified as prototype data; never report a placed order, sent chat, verified contact or paid transfer from local component state. S09/S10/S11 resolve identity/transport/fixture prerequisites. S21/S22/S26/S27/S48 own buyer purchase/receipt rendering, S38–S40 affiliate receipt/hold/transfer visibility, S44/S45 chat and S46/S47 account and S49–S55 operations/print consumers. S46 must prove the no-email account case; the export size limit remains owned by its existing export gate. Physical label and external-provider approvals remain separate from local acceptance.


## S08 Prototype Interaction Evidence — 2026-10-16

Observed: isolated static fixtures now exercise nine composition views through the built loopback server. The prototype command in README passed36 checks at390/768/1440 plus320px/200% text. Query/filters and browser Back preserve public context; keyboard dialogs wrap/restore focus; checkout validation and expired-quote review retain safe input; two parcel totals remain113000+117000=230000. Pending payment return never marks paid, failed chat leaves the draft unsent, and warehouse filtered-zero/detail distinguish a printed label from physical handover.

Observed fixes: mobile icon-only navigation needed explicit accessible names; native modal focus needed bounded Tab wrapping; the initial mobile purchase region obscured contents, so it now remains in normal reading order; tablet checkout uses a full-width form/summary layout instead of compressed columns. Review-driven changes add explicit estimate/disclosure, independent parcel timelines, masked review contact, mobile Cart, waiting-for-manual-transfer balance and retained warehouse history. The canonical design document owns screenshots, visual critique and the independent visual gate. The viewport-height keyboard proxy is not physical-device keyboard/IME evidence.

Limits: prototype fixture interactions use in-memory examples only, explicitly disclose no business commit and cannot count as auth, stock, payment, chat persistence or PR-14/PR-17 production UI acceptance. New frontend work must replace these fixtures with the accepted authoritative domain flows and rerun rendered acceptance. Account without email, staff MFA, verified guest recovery, publication/asset rights and external-provider/native-host behavior retain their previously named owners.


S09 backend checkpoint: session-bound staff TOTP/recovery, owner reauthentication and role replacement now have real handlers/tests. No MFA enrollment/recovery screen or admin grant editor has been rendered. The S52 UI must handle MFA_REQUIRED, FRESH_MFA_REQUIRED, stale version, replay conflict and session revocation, preserve intended action only within its authorized scope and never log/display raw proof or recovery material outside its dedicated enrollment/recovery flow. S46 still owns optional-email buyer account completion.

## S21 discovery runtime boundary

Home/category/search render actual source-approved catalog data. Native search and GET filter forms remain usable without JavaScript; mobile filter details collapse while desktop expands after enhancement. Query/category/offer kind/stock/sort and repeated `filter.<key>` checkbox fields are public URL state. SSR normalizes checkbox fields into the same validated API attributes object; ambiguous simultaneous attributes/checkbox grammars fail. Pagination resets after a new filter and retains all normalized context on continuation. Back/reload restore the server-derived selection. Counts explicitly describe the current page.

Empty results preserve query and reset access; invalid filters have recovery distinct from unavailable service. Local sample photographs are labeled slots with item-specific briefs; genuine product-photo rights remain required before live publication. Read-only product detail enables catalog drill-down. Actual offer selection/add/cart recovery is S22; cart/account pages currently disclose their unavailable state and cannot claim an empty saved cart, order or completed account flow. Bottom shopping navigation occupies one safe-area region; text enlargement permits a one-column product layout.

S21 visual follow-up: mobile shopping destinations are Beranda/Kategori/Keranjang/Akun; header cart/account duplication is removed on phones. The home includes actual published department entries, factual photo-shot briefs, selected title/price scale and shopping/return help. Filter state is visible/removable outside collapsed mobile details. A full product comparison unit is one link/focus target. Enlarged tab labels stay whole inside their measured targets; cart's longer label receives more space. Read-only product, pending cart/account, category index, help and not-found screens have bounded render proof without claiming their later purchase/account workflows.

## S30 reconciliation workflow contract (backend slice; later screen owner retained)

Finance receives a pending/partially matched/mismatched/exception item from an authenticated remittance observation. Inspect original source time/net, signed statement gross/fee completeness, original receivable candidates, current match/reversal history and unmatched remainder. Review exact proposed matching effects before fresh reauthentication and commit. A stale version, changed current match, missing source detail or excess original allocation is a recoverable conflict; retain the user's references/reason and reload current evidence. Success shows the committed match/correction identity and current remainder; unknown response recovers the same operation, not a new cash transfer. Guarded unmatch reverses an incorrect matching classification while preserving actual bank movement/fees and retaining its audit history. Escalation retains the discrepancy for later resolution. Zero net does not hide unmatched gross/fees. No new dashboard layout, mobile composition or visual acceptance is claimed by this domain workflow.


## S31 domain prerequisites for later return/refund screens

S31 backend delivery is accepted; this adds no accepted visual composition. S47 buyer/S50 staff/S51 finance surfaces consume the same original unit/case/refund truth. Show the verified-receipt claim deadline per unit; a shipping holiday affects dispatch H+, not the seven elapsed-day claim window. A timely claim may remain under inspection beyond that deadline. Do not infer received goods from payment, label or physical handover.

Select complete purchased offer units and show original refundable shipping shares. For an incomplete/wrong bundle, unavailable originally missing contents do not prevent the approved full related refund. Inspection records known original components separately from unidentified wrong goods in quarantine; neither adds sellable stock automatically. Warehouse views contain only assigned physical work; buyer/order/finance scope does not follow an arbitrary deep link.

Distinguish approved obligation, awaiting destination, queued, processing, unknown, known failed and verified succeeded. A COD destination is never guessed or accepted as bank-verified from text/screenshot. Show the retained original matching/refund history and safe recovery action. Private images/evidence need real validated ownership/upload recovery under S47; unimplemented evidence routes cannot display upload success. Existing guest expiry and later verified recovery remain visible separate work.


## S33 exception workflow contract — backend contract, later screen owners retained

Primary jobs are assigned warehouse physical investigation/intake, assigned CS buyer-choice coordination, and finance original-source compensation. Owner can inspect the complete audit trail. These are case/parcel decisions triggered by actual persisted discrepancies or authenticated sources, not a new generic dashboard. Market/device/visual assumptions stay with the existing Indonesian mobile/desktop contracts. S50/S51 and S47 consume this domain; no new rendered composition or visual acceptance is claimed.

Operational list/detail shows only permitted affected reference, original/replacement physical origin, complete selected offer quantities, authenticated observation, current uncertainty/next action and reason/history. Warehouse views omit whole-order totals and bank/contact/proof fields. Finance detail separately shows original collection, frozen refundable allocation, already pending/confirmed obligations and safe original cash outcome. A misleading empty queue cannot hide unavailable source data; distinguish no cases, filtered zero, unavailable, stale/conflicted, denied and pending mutation.

For reinspection, submit the exact case ID/version together with the original fulfillment and balance versions. A stale count or implicit new report cannot overwrite a newer proposal/consent. Without an accepted remedy, positive reinspection returns to awaiting_stock and clears an unanswered proposal; a fresh all-zero count can resolve only this stock investigation. Actual same-case accepted cancellation/refund consent instead retains its exact proposal and awaiting_source through either count; the warehouse count cannot open dispatch or rescind that choice. Resolution creates no stock, cash or promise change. Active investigation blocks new packing/booking/handover for the containing original parcel; existing authenticated waybill acknowledgements remain facts, and a new send waits. No fulfilled/unaffected parcel is retired by this hold.

For stock discrepancy, stop the affected unhanded complete offers, record actual source/component facts and attempt an eligible same-intent recovery without substitution. If the remedy reduces/cancels the buyer promise, show the exact affected units and proposed consequence for an authenticated owned buyer choice, then a scoped staff decision. Another delivered parcel keeps its receipt/history. For unavailable replacement stock, display the existing wait/reserve state; an explicitly selected refund can retire only an eligible unbooked zero-charge physical intent and uses the original monetary capacity.

For COD refusal, explain the original frozen amount and authenticated zero-money observation; do not label cash refunded or goods returned. Returned-to-sender intake is a separate warehouse task with actual components/quarantine evidence and duplicate protection. Mixed outcomes retain distinct per-parcel/unit facts. For late/unallocated paid money, show the original payment under review and finance obligation without promising restored stock or a new order.

Before a monetary action, finance reviews exact original source/capacity, selected amount derived by the server, pending allocations and intended rail, then supplies fresh subject-bound proof. Pending acknowledgement is distinct from confirmed success. Unknown outcomes display original operation/recovery status and prohibit a second send. A known zero-effect failure supports an explicit authorized retry with the original obligation/history retained. Lost responses recover the saved operation, not a new checkout, shipment or transfer. Preserve entered safe reason/selection across validation/version conflicts; refresh actual evidence before resubmitting. Expired guest authority uses existing supported recovery only; later S46 UI cannot be simulated as a completed verification.

Acceptance must exercise a two-parcel order with one unaffected delivered parcel; genuine late collection after stock expiry/reallocation; signed COD refusal with no money/restock; actual quarantine intake; unavailable replacement stock; and source/cash acknowledgement loss. Verify current authority, replay/conflict and original money/quantity/receipt conservation through real handlers/database/worker and built browser transport. S33 has not implemented these new paths yet; STATUS owns current evidence.

The internal proposal/choice checkpoint distinguishes saved consent from execution. Show accept/decline only in awaiting_buyer and submit the exact current case version/proposal. After accepting cancellation/refund, awaiting_source retains that proposal for a separate guarded staff action and explains that agreement is saved, with execution pending. Accepted waiting clears it and resumes the applicable stock/return/source task; decline clears it and escalates. A retained proposal outside awaiting_buyer is historical/next-action context, not another actionable consent form. The final staff application contract/writer is still pending; do not show cancellation, refund or fulfillment completion from this checkpoint. Complete known component intake alone supports a complete-unit quarantine fact; partial/unidentified goods remain visibly incomplete in the later intake workspace. No rendered UI acceptance is claimed.

For partial COD cancellation, distinguish the original order total from the remaining amount collectible before funding and the immutable amount actually collected afterward. Label a fully retired unpaid parcel as cancelled rather than requesting a zero payment; unresolved real money remains under reconciliation. Show which complete original units the buyer's accepted remedy affects and preserve unaffected parcel receipts/commission history. Refunding a funded unit uses its original source; an unpaid cancelled unit cannot borrow another unit's receipt. A later receipt/Purchase reflects only the original source's frozen funded units. C2 currently stages these domain/projection contracts; S47/S50/S51 still own rendered transport and workflow acceptance.


A saved buyer acceptance enables a later explicit staff application with current case version/proposal and a safe reason; clients supply no amount, stock result or carrier-completion claim. Queued/acknowledged/unknown cancellation remains pending and blocks a replacement proposal or dispatch. Confirmed label cancellation alone does not mean buyer units were cancelled, stock restored or money refunded. A surviving-unit reissue retains original prices, first issuance and deadlines and presents the current confirmed label. C4 source/policy work is staged; application transport and rendered acceptance remain pending.

Current-label presentation must hide the historical AWB while carrier cancellation is pending or confirmed, and while a new booking has not issued its own label. Use distinct pending-cancellation and cancelled-booking states; neither confirms unit cancellation, money refund or restored stock. An actual failed carrier cancellation leaves the still-issued original label available. The first issuance timestamp remains history/SLA data. Reissue must preserve that anchor while displaying only current accepted tracking. The backend projection is staged and its pure state cases execute; S47/S50/S52 still own rendered buyer/operations/printing proof.

The internal application contract now distinguishes saved acceptance, carrier work, physical retirement and finance follow-up. While a carrier request is pending, retain the accepted proposal and show a source wait without reporting cancelled goods, released stock or sent money. If its creation genuinely exhausted ten attempts with no source, escalate for CS review and preserve that request history; an explicit subsequent action uses the current case version and retained original acceptance. A provider refusal remains a different source fact. Retiring a funded unit leads to finance follow-up, while unpaid consumed goods can still require physical intake. A zero-charge replacement retirement cannot display a second purchased amount. These are backend/screen requirements; no new rendered interface or browser acceptance exists yet.

For original partial cancellation, retain the purchased line quantity/subtotal and show a separate cancelled quantity and exact occurrence marker. Assigned warehouse picks contain surviving unhanded components; handed parcel history preserves what actually left the warehouse. When the final surviving original receipt arrives after retirement, the parent can become partially_completed without another staff apply. A completely retired parcel cannot display a fabricated delivered timestamp. Actual historical receipts remain visible independently of commercial cancellation. Replacement occurrence cancellation uses its own marker and no new purchased amount. These backend/projection contracts do not claim a new rendered UI or browser acceptance.


Current C4 definition evidence: exact r21 PASS1 created165 relations/88 distinct functions from SQL546145... inside a fresh owned rollback transaction; no business path was invoked. The owned project is stopped/data retained, both installed140/23 targets and protected migration prefix remain unchanged, and the one invocation permission is consumed. STATUS and BUILD-LOG retain exact source/executor/result bindings; business/native completeness and full S33 acceptance remain pending.


Replacement history retains every occurrence with a server-owned cancelled flag. Assigned warehouse actions operate on surviving complete units; all-retired unbooked parcels are cancelled, while partial retirement retains actual milestones and only actual surviving receipts establish delivery. Keep any pending original return-claim financial remedy distinct from physical delivery; retirement cannot silently resolve it. Current source is staged after the historical r21 definition checkpoint; corrected r23 source review and new native/business/transport acceptance remain pending.


A repeated replacement stock wait keeps the original case and buyer choice. Actual complete stock can end an eligible waiting state; it cannot silently replace a pending proposal or accepted cancellation/refund. Keep the original return-claim financial remedy distinct from physical stock recovery. Actual r24 approves bounded source only at SQL66cc0...; new native/business/transport/full acceptance remains pending.


When a replacement is cancelled, its original claim remains held for follow-up and the buyer explanation must identify the recorded cancellation without promising a paid refund or ongoing replacement preparation. Other actual received/refunded units retain their own outcomes. Render and verify this conditional copy with the eventual native scenario; current source/compatibility checks do not establish browser acceptance. Actual r25b approves bounded partial source only at SQL9be368...; full native/business/transport acceptance remains pending.


### S26 milestone integration selection — current proof in STATUS

Consume the existing consent/funnel owners; no new event schema, visitor bootstrap, consent grant or ad SDK. Checkout entry uses a hydrated first-party POST, never an SSR/prefetch GET; a no-JavaScript buyer's first explicit step POST records entry before advancing. Current authorized open nonempty cart/version and existing current visitor/purpose consent gate capture. Contact/address milestones follow a native quote accepted for the current cart; shipping/payment-method milestones follow explicitly accepted parcel selection and full-review entry. Native order_placed and financial Purchase remain their existing native owners; the UI emits neither.

Dedupe entry per visitor/current consent/cart/version and step acceptance per visitor/current consent/cart/actual quote using opaque server HMAC identities. Native current scope/quote is rechecked before capture, and an existing durable funnel intake suppresses repeat timestamp/key conflicts. Values, contact/address/destination, notes, payment credentials and navigable URLs never enter the event body. Optional measurement failure cannot cancel checkout or retry money; retain a sanitized capture-unavailable diagnostic. Draft durability is implemented in the S26 correction below, with current executed evidence owned by STATUS. Full native support chat remains a downstream parent requirement; physical-device evidence is unavailable. Current integration tests do not waive these or establish S26/full T-31 acceptance. Independent review must assess their scheduling against the slice and parent contracts.


S26 source-r1 draft correction (current source/checkpoint evidence in STATUS; independent closure pending): submitted and safe in-progress checkout fields must survive task exit/reload for the same current cart/principal session. Use a bounded mutable derivative draft file under the existing owner-only private artifact root, with a server-derived opaque scope key binding cookie prefix/current actor/current user session and exact cart. Every read/write rechecks native cart/session authority; expiry/revocation or a new principal cannot recover another session's draft. Atomic writes and revision/writer/sequence fences preserve newer progress across delayed autosaves and competing tabs. Raw contact/address/note/query and issued selection IDs may be retained only as necessary progress; no prices, paid state, capability, operation key or marketing attribution enters the record. Quotes/orders/stock/payment remain native authoritative resources. No migration or public REST operation is introduced; scoped Next frontend actions consume existing native authority and return only typed progress acknowledgements. Input autosave is operational, never an order/quote/payment/Purchase action. Explicit no-JavaScript step/task-exit submits persist fields before navigation. Current-session reauthorization, source failure, saved/pending/conflict and expiry behavior require executed regression and independent review. Existing source-r1 P2/full-parent gates stay open until actual correction proof.

Draft retention boundary: progress has finite logical expiry bounded by remaining native cart lifetime and24 wall-clock hours. Expired owned reads and known native order commits clear their progress. Authorized open-cart draft writes also perform a physical sweep of at most32 recognized draft/temporary files older than24 hours plus a five-minute margin, respecting active native writer locks and local/test isolation. This covers signed-out or otherwise unreachable abandoned files; the next eligible write is the cleanup trigger, not a promise of an idle-time timer. Scheduled cleanup/supervision and approved launch retention remain operational/privacy parent gates. This store inherits docs13 buyer contact/address classification and the current cart/principal-session access rule; it is not a separate marketing or financial dataset. Browser storage contains no draft or authority. The interface promises durable input only after a save acknowledgement or successful explicit step/task-exit submit; an offline or terminated page cannot promise unsent text recovery.

Implicit Enter selection: a non-exit rendered default form control precedes header exits in tree order. On contact/address it performs only destination lookup; on shipping/review it preserves the current step and submitted issued selections without creating a quote or order. Name/phone/search Enter remains in checkout and preserves fields; it cannot implicitly select the cart/home exit or commit an order. The visible primary button advances the accepted step explicitly. Actual JS-on/off browser proof is recorded in STATUS.
