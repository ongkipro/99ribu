# Identity and Authorization

Status: Draft — planning only; no application or runtime verification.

Owner: Paduka Ongki. Updated: 2026-10-15.

### IAM-1 — Role and object scope
- Status: Proposal
- Owner: Engineering owner
- Source: CTX-7
- Statement: Authorize every read, mutation, export and job by actor, permission and object scope; guest links prove access only to their order.
- Acceptance: Cross-warehouse, cross-affiliate and cross-buyer direct requests fail; legitimate scoped requests succeed.
- Constraints: None
- Evidence: None; execution pending.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

## Permission matrix
| Role | Allowed scope | Explicit limits |
|---|---|---|
| owner (UI: Super Admin) | Company policies, role grants, integration governance, company-wide order history, stock/cost governance and all reporting | Sensitive writes reauthenticate and audit; read visibility does not bypass transfer evidence/state guards |
| ecommerce_admin | Catalog, inventory operations, fulfillment coordination, allowed promo settings | Cannot grant owner privileges or execute finance-only payouts |
| warehouse | Assigned warehouse stock, pick/pack/handover and return inspection | Cannot inspect other warehouses or edit financial policy |
| customer_service | Necessary buyer/order data, return cases, delivery recovery | Cannot change beneficiary, rates or mark transfers paid |
| finance | Financial order history, reconciliation, approved refunds, exclusive manual payout claim, protected evidence verification and reports; cost/expense writes only with explicit grants | Cannot silently edit receipt proof, historical postings or stock; cannot grant owner privileges |
| buyer | Own orders, verified guest-order access, own return requests | No other customer or staff access |
| affiliate | Own referral, rate, masked sales/commission and payout reports | No buyer contact/address, other affiliate data or own eligibility override |

A user may have buyer and affiliate roles; staff can hold multiple explicit grants. Deny by default, including direct HTTP requests and exports. Warehouse scope is an authorization dimension, not a tenant model.

## Sensitive changes and service identities
Owner/staff MFA is required before launch. Beneficiary changes require reauthentication, notification and payout hold until verified. Automatic affiliate registration never grants staff rights. Signup and referrals are rate limited; suspicious activity can hold a specific payout with visible reason.
Guest order access uses an expiring, unguessable server-verified link or contact verification; order number alone is insufficient. Jobs carry service identity plus explicit target object and record an audit reason. Provider event authentication is separate from human sessions.

## Independent clients and capability proposal
API-1 documents proposed cookie and opaque-bearer transports. Token issuance/refresh/revocation and proof lifecycle require a selected supported authentication implementation before launch; do not treat a bearer header as automatically JWT or trust an unverified user ID. Browser mutations require reviewed CSRF/origin checks. Native/WebView access uses the same role/object rules.

Guest cart capability cannot read an order after creation. Creating guest checkout can return a separate order capability scoped to that new order; lost access recovers through verified contact, not order-number lookup. Cross-order/return/evidence/operation references are denied. Evidence upload grants scope to a case, size, type and expiry and validate content after upload. Beneficiary reauthentication proofs are action-bound, expiring and single-use; adding a proof field does not implement that control.

## Manual payout control
Finance and explicitly authorized owner grants can claim eligible payout work and record/verify an external manual transfer with reason, immutable amount/destination and protected transaction evidence. No buyer, affiliate, warehouse, customer_service or ordinary ecommerce_admin can mark paid, change an allocated destination or release an uncertain transfer. Require current state/version checks, idempotent completion and unique transfer-reference/effect checks. Owner overrides remain audited corrections, never deletion of prior evidence. Verification should use a separate authorized reviewer where staff separation exists; a single authorized finance operator still records the evidence and explicit verification audit.

## Single administration panel and sensitive cost permissions
The UI label Super Admin maps to canonical role `owner`; do not introduce a parallel `super_admin` role or bypass domain guards. Owner sees company-wide order history and finance aggregates. A finance role sees the necessary financial/order records for its job; warehouse users retain warehouse scope, and customer-service users see service facts with cost/margin and bank-proof fields excluded. UI hiding is not authorization: enforce identical field/resource restrictions on direct API reads, exports and background reports.

Component HPP/cost and operating-expense writes require owner or a separately granted finance permission, reauthentication for sensitive corrections, explicit reason, effective time and optimistic version. Ecommerce admins can prepare catalog facts and warehouse staff can record scoped receipts/movements, but neither receives company profit reports or editable accounting costs merely through that role. Owner may delegate these permissions explicitly and audit the grant. An all-orders order list is not permission to export all PII.

Posted money and stock movements cannot be overwritten or deleted through admin. Corrections reference the original record and preserve actor/time/reason. Owner still follows manual-payout claim, immutable destination/amount and verification controls. Prefer a second authorized verifier when staffing permits; the documented initial single-operator fallback remains explicit and audited. No shared root login is implied by company-wide visibility.

API permission vocabulary: `orders.history.read` authorizes scoped administrative order history; owner has company scope and ordinary staff still need an appropriate scoped grant. `finance.summary.read` and `finance.costs.read` are owner or explicitly granted finance capabilities; `finance.costs.write` is owner or explicitly granted finance capability and never implied by general order-history access. Sensitive financial permissions cannot be assigned to ordinary ecommerce_admin/warehouse identities without a separately authorized finance/owner role grant. Backdated cost-version creation is rejected; historical cost corrections use reviewed adjustment records rather than changing effective history.

Whole-order history API access is limited to appropriately granted owner/ecommerce_admin/customer_service/finance identities with field-level restrictions. Warehouse identities use their assigned fulfillment/shipment resources instead; do not expose whole-order totals or unrelated warehouse lines through a filtered whole-order response. `orders.history.read` alone never overrides this allowed-role boundary.

## Native chat permissions and guest isolation
Buyers read/write only their conversations; a guest's server-verified support session authorizes only its own thread set. Reject arbitrary conversation IDs, client-supplied sender/role, order-number-only links and cross-thread attachment IDs on HTTP, stream, background notifications and recovery. Guest support access is separate from guest-order capability; linking an order requires verified authorization to that order. Sensitive capabilities never appear in query strings, analytics or event payloads.

customer_service can list permitted unassigned/assigned support inboxes and read necessary conversation/customer context; outgoing replies require the active exclusive claim. Version-checked handoff/assignment avoids two agents replying under stale ownership. owner (UI Super Admin) has company oversight and audited takeover/assignment, but still follows message/idempotency/evidence controls. Finance, warehouse, ecommerce_admin and affiliate roles do not automatically gain conversation or internal-note access; assign explicit CS role/scope where needed.

Staff notes use separate staff-only read/write endpoints and channels; no customer serializer, history endpoint, read marker, notification or stream includes them or a public sequence gap revealing their presence. Staff replies identify an authorized agent and are distinguishable from any clearly labelled automatic availability acknowledgement. UI availability alone is not authorization, and a chat reply is never a financial-state command.

Chat read acknowledgements are actor-bound; caller cannot submit another participant's marker. Public reader_side identifies only customer versus staff; private per-agent unread state stays staff scoped. Read positions cannot exceed the actor's authorized committed visible sequence and do not reveal independent note identifiers or note activity through public metadata.

## Expanded chat permission rules
Reply/search/card/notification access inherits the exact conversation and visible-message scope on every request; a known reply/message ID or search cursor is not authority. Guest ownership must be proven independently of a matching email/phone or conversation/order number; recovery/linking verifies both the former support identity and destination identity with generic failure and audit. Staff-note search/quotes remain separate from public message APIs.

Only owner or explicitly authorized CS supervisors manage shared saved replies, tags, priority policy and abusive-thread restrictions; scoped CS agents may use templates and update permitted internal classification without granting themselves administrative rights. Template insertion is manual; safe context placeholders cannot access another customer or private financial fields. Agent reassignment does not transfer unrestricted customer/order permissions.

Archive/mute belongs to the authenticated participant only and never changes shared resolution/assignment. In-app notifications expose generic attention state; opening rechecks conversation access and cannot grant access after logout/revocation. Notification seen does not advance message-read markers. Presence/typing, if later enabled, is transient and conversation-scoped; it reveals no guest identifier or unrelated browsing activity.

## Advertising and post-checkout authorization refinement
IAM-1 decision: owner governs destination activation, versioned conversion mapping and replay/pause; secret values stay in the deployment secret store. Ecommerce admin may receive explicit redacted diagnostic-read permission; no new marketing role is necessary. CS/warehouse/affiliate cannot edit trackers, view raw identity matches or replay conversions. Finance reads reconciliation under existing grants; that does not confer configuration rights. Record actor/reason/version for changes and replay, with authorization checked server-side.

Thank-you/order-status reads require the current owner principal or verified scoped guest session; order reference alone never authorizes access. No capability, phone or email in shareable URLs. Guest recovery follows existing challenge expiry/rate/replay rules. Every detail, status refresh, payment retry and context-chat action rechecks access. Browser-provided paid flags, totals, IDs or provider returns cannot authorize Purchase or change money state.

## Buyer account, scoped exports and shipping-label permissions
Buyer profile/addresses/preferences are own-principal resources. Contact change requires authenticated reauthentication, new-contact verification and a supported old-contact notice/recovery path; a typed phone alone is not identity. Guest-order linking verifies both authenticated principal and order access, with one-time scope and audit. Contact edits cannot silently change previous order owner, ship-to snapshot or payout beneficiary. Staff cannot impersonate buyers or view every address book simply through CS order access.

Define resource permissions `shipping.labels.read`, `shipping.labels.generate`, `shipping.labels.print` for owner and explicitly granted warehouse/ecommerce_admin staff within permitted warehouse/parcel scope; template activation remains owner/integration governance. CS receives only necessary tracking facts, not bulk private PDFs by default. Finance/affiliate/buyer cannot read warehouse labels by role alone. Export permission is separate from list-read: allowlisted role-specific columns and warehouse/date/filter scope are enforced again when executing and downloading. Warehouse exports contain assigned jobs only and no whole-order financial totals. Owner scope still requires audit, reason for sensitive reprints/exports and private access; broad list access does not imply blanket customer-data export.

Bulk actions authorize every selected record at execution, check revision/preconditions and return per-record outcomes without revealing forbidden details. A mixed valid/invalid selection cannot bypass financial/warehouse restrictions. Reprint creates an audit attempt; it cannot bypass voided/superseded artifact checks. No bulk mark-paid, mass receipt creation or overwrite-ledger shortcut is introduced.
