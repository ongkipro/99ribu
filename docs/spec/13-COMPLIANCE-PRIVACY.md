# Privacy and Applicability

Status: Accepted contract — implementation and acceptance state is owned by root [STATUS.md](../../STATUS.md); external gates remain open.

Owner: Paduka Ongki. Updated: 2026-10-21.

### PRIV-1 — Personal-data inventory and minimization
- Status: Accepted
- Owner: Privacy owner
- Source: CTX-8
- Statement: Inventory and restrict buyer, affiliate, staff and return evidence processing; approve retention and processor locations before launch.
- Acceptance: Affiliate reports contain no buyer PII; deletion/retention tests follow approved rules across primary storage, logs and backups.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

## Data-purpose inventory
| Data | Purpose | Access | Retention decision |
|---|---|---|---|
| Buyer contact/address | Delivery, order access and support | Scoped fulfillment/CS; providers as needed | Owner-approved fulfillment and record retention pending |
| Affiliate beneficiary references | Verification and transfer | Affiliate owner, restricted finance, payout provider | Financial retention decision pending |
| Referral cookie and order attribution | Seven-day first-touch acquisition | Server; affiliate sees only own masked report | Cookie expiry follows policy; financial attribution retained separately under approved retention |
| Manual transfer evidence and references | Verify affiliate payout; reconcile external bank outcome | Restricted finance/authorized owner; affiliate receives only sanitized payout status/reference | Financial evidence retention decision pending; private storage, never public links |
| Return evidence | Evaluate claim | Assigned CS/inspection | Private storage expiry pending |
| Staff audit and finance postings | Security, reconciliation and accountability | Restricted owner/finance/security | Approved statutory/operational retention pending |

A short referral cookie lifetime is not the same as financial-record retention. Account deletion cannot silently erase legitimate obligations or evidence. Avoid DOB, identity documents or additional profiling unless the verified provider/legal purpose requires them. Never place raw personal/payment data in source fixtures, this pack or ordinary observability events.

## Applicability and launch review
Indonesia commerce is the owner-selected market. Exact entity, privacy controller/processor roles, age eligibility, notices/consent, tax treatment, product registrations, skincare labeling/claims and electronics guarantees require current official-source review by qualified owners before launch. This document asserts no legal certification or product approval. Do not call skincare sales a healthcare service solely by category.
Hosting, object storage, logs, email/WhatsApp, backups and support locations remain Unknown. Cross-border access/processing cannot be marked absent merely because buyers are Indonesian. Review XFER-0 in the context record when vendors are selected. Record actual processor terms and subprocessors before activation.

## Advertising activation boundary
Pixel/CAPI/Events API/enhanced-conversion activation requires actual consent/notice policy and provider customer-data terms appropriate to the selected market. Do not grant or deny all consent globally by reflex. Hashing real first-party data is not anonymization or independent permission to send it. Omit unavailable identities instead of creating synthetic emails. Restrict advertising field retention and collection separately from financial records; tags cannot block checkout.

## Native support-chat privacy
PR-22 adds customer/guest conversation text, optional product/order links, support identity, read positions, attachments, assignment history and staff notes. Purpose is customer support and claim handling, not advertising enrichment. Access is the customer participant plus permitted CS/owner, with staff notes excluded from customer delivery and ordinary finance/warehouse roles excluded. Do not request card details, passwords, identity documents or banking secrets through ordinary chat.

Before launch the privacy owner approves concrete retention for resolved support conversations/attachments, access recovery, abuse evidence and audit. Reference required return/finance evidence into the existing protected case workflow rather than retaining every chat image indefinitely or granting a finance proof role through chat. Deletion/anonymization propagates to primary files, derived indexes, notifications and backups under approved policy, preserving legitimate restricted evidence where required. Host/storage/support processing locations and notices remain part of existing applicability review; no new messaging processor or WhatsApp activation is assumed.

Expanded chat retention includes safe quote references/context snapshots, search excerpts/indexes, participant archive/mute, in-app notifications and template-use audits. Deleting/redacting a message must also remove sensitive copied quotes/previews/index entries under the approved policy. Archive means personal list organization, not deletion or retention consent. Message-body text and search queries do not enter ordinary analytics. Per-tab drafts expire with the session and are cleared on principal change; there is no assumed cross-device draft sync or raw-image browser persistence. Optional browser push adds endpoint/subscription processing only after its own notice/retention review and opt-in; core in-app chat remains usable without it.

## Advertising purpose and thank-you data inventory
PRIV-1 decision: inventory Meta, Google and TikTok as separate optional advertising processors/destinations with actual contract, transfer location, purpose and retention review before activation; no blanket compliance claim follows from hashing or Consent Mode. Separate essential order service, analytics, ad matching/personalization and marketing subscriptions. Account/checkout completion cannot require optional ad consent or email subscriptions.

A consent receipt controls capture and dispatch. Withdrawal cancels unsent optional events and purges unnecessary matching/click data according to the approved policy; already transmitted data follows applicable vendor deletion/rights procedures. No historical backfill of behavior captured without consent. Exact ad-touch, identity payload, diagnostics and consent-audit retention periods remain [TBD owner=Privacy owner; due=before advertising activation]. Do not inherit affiliate seven-day expiry or financial retention automatically. Unsupported vendor deletion/adjustment is an owned launch question.

Allowlisted payload includes offer IDs, bounded quantities, merchandise value/currency and permitted matching identifiers. Exclude street address, contact form contents, chat/images/notes, bank evidence, capabilities, HPP/profit and staff data. Hashes remain personal data. Thank-you details stay private; clipboard/share actions are explicit and minimize disclosed content.

## Indonesia buyer and fulfillment-document minimization
PRIV-1: address book is optional authenticated convenience; guest checkout retains only necessary service data under its approved policy. Optional RT/RW/landmark helps delivery where useful; no required KTP, birth date, gender or location tracking. Marketing subscriptions are separate from essential order/service notifications and never prechecked. Available channels must match actual configured delivery capability.

Labels expose only carrier-required sender/recipient/routing/COD data and permitted brand identity. Screen masking is not applied blindly to a physical shipping label that requires complete recipient facts. Do not print HPP, affiliate/customer financial identity, internal notes or staff access URLs. Separate minimal packing slip from internal pick list. Export/PDF/artifact/challenge retention and deletion schedules remain [TBD owner=Privacy owner; due=before account/export/label activation]; expired download URL does not by itself delete stored PDF. Preserve legally required order evidence while removing unnecessary reusable profile/address data through the approved rights process.


S25 local implementation does not settle the pending live retention/legal decisions above. Use a plainly labeled TEST-ONLY policy with explicit short bounded development lifetimes and no default optional grants. Capture and dispatch consult the current consent revision/expiry; revocation purges unnecessary optional payload references and prevents unsent delivery. Real matching/click payload and vendor activation remain separately gated. Operational money/Purchase allocation identity may be retained independently, without treating it as permission to send advertising. Provider-facing matching fields must not be synthesized from unavailable identity.


S25 concrete localhost defaults: `local-privacy-v1` is TEST-ONLY; inactive anonymous visitor nonce expires in10 minutes, active visitor and each consent receipt expire within24 hours. An anonymous browser channel may accompany a newly issued guest cart, but never grants it access; an authenticated visitor binds to the exact verified account session. Shared-device account changes require fresh visitor bootstrap, without merging stored choices or order histories. Public bootstrap uses120/minute per fixed local source, while activated purpose operations use60/minute per visitor; these are real persisted limits, not disabled test modes. Exact live retention, notice and vendor activation remain the pending owner/privacy gate.
