# Security Architecture

Status: Accepted contract — implementation and acceptance state is owned by root [STATUS.md](../../STATUS.md); external gates remain open.

Owner: Paduka Ongki. Updated: 2026-10-21.

### SEC-1 — Commerce trust controls
- Status: Accepted
- Owner: Engineering owner
- Source: CTX-8
- Statement: Verify provider events and authorization, protect beneficiary changes and prevent duplicate financial effects.
- Acceptance: Forged callbacks, another-user access, concurrent payout and malicious return uploads fail safely without exposing sensitive values.
- Constraints: None
- Evidence: Implementation and local acceptance evidence is tracked in root [STATUS.md](../../STATUS.md); external gates remain open.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

## Threat and control inventory
| Reachable boundary | Required control | Evidence needed |
|---|---|---|
| Browser price/stock/rate manipulation | Recalculate and validate server-side; immutable snapshots | Tampered checkout and rate tests |
| Provider callback replay/forgery/order reversal | Issued verification contract, event identity, transition guards and reconciliation | Forged, replayed and out-of-order fixtures |
| Stock/promo/payout races | Transactional allocation and unique effect keys | Concurrent requests/workers |
| Affiliate self-referral and cookie tampering | Server-verifiable attribution, defined self-purchase exclusion, reviewable risk flags | Forged and self-attribution fixtures; no unexplained PII collection |
| Guest lookup and staff privilege escalation | IAM-1, opaque verified guest access, MFA for privileged roles | Negative authorization tests |
| Return uploads | Type/size validation, private storage, authorized retrieval, malware strategy before release | Rejected executable/oversized upload and unauthorized download |
| Outbound provider/network access | Fixed trusted provider destinations, timeouts, redacted logs | No caller-controlled URLs or secret-bearing logs |
| Payout destination change | Reauthentication, notice, verified destination, active payout hold | Account takeover and concurrent-change tests |

Credentials are server-only and never included in client bundles, URLs visible to clients, logs or documents. If an issued provider contract embeds secrets in paths, redact at HTTP/log boundaries. Development credentials are obtained only via secrets-env after required authorization. No credential access is part of this task.
Sensitive money corrections and override actions require a reason, actor and immutable audit event. Ordinary ecommerce admins cannot manually assert payout success. Initial manual transfers require finance authorization, exclusive claim, matching immutable amount/destination, protected transfer evidence and audited verification. Evidence uploads use the same private retrieval, type/size validation and malicious-content controls as other sensitive evidence; a filename or screenshot upload alone cannot authorize paid state. Uncertain transfers remain locked against duplicate sending.

## Mobile/WebView and independent API threats
Mode flags, device user agents and native app IDs never grant permissions. Validate allowed origins and return destinations; reject caller-supplied arbitrary redirects and unsupported schemes. Do not leak cart/order capabilities in URLs, referers, notifications or analytics. An app resume/deep link is not a trusted payment/receipt event. Token/reauth/session lifecycle and future bridge messaging need threat review before app enablement. Provider event verification remains server-only.

## Native chat trust boundaries
PR-22 threat cases: another customer's history/event cursor, guessed conversation/attachment IDs, forged order-context links, staff-note leakage, guest-session theft, stored XSS, untrusted remote image URLs, oversized or disguised files, anonymous spam, stale-agent replies and cross-origin socket/session abuse. Enforce IAM-1 on every read/write/upload/stream and after reconnect; text-only escaping and safe link rendering; bounded body/page/event/rate limits; private detected-type/size/scanned attachments; actor-bound idempotency and exclusive versioned assignment. No rendering of arbitrary HTML or server fetching of user-provided URLs.

CSRF/origin protection applies to browser mutations; streaming is authenticated and no-store, with bounded lifetime and renewed authorization. Revoke access on session/role loss, prevent capability values in URLs/logs and keep staff notes on independent private serializers/event channels. Customer events/read receipts contain no staff-note identifiers/counts. Abuse controls must still show truthful submission failure/retry; retained unsent text must not be sent later without the intended action. Chat attachments/messages cannot establish payment/refund success or bypass financial workflow guards.

Expanded PR-22 cases: forged cross-thread reply references, search result/cursor enumeration, stale quoted secrets after redaction, order/card access after role loss, private tags/notes leaked through notification counts, saved-reply placeholder injection and stale draft sends after customer switch. Validate same-thread public targets, derive context cards server-side, bound search/cursors and redact queries in logs, propagate visibility/redaction to excerpts, isolate staff-note indexes, preview templates before send and clear session/principal-scoped drafts on identity change. Private-only metadata changes cannot bump public updated_at/events/badges.

Notification bodies are generic; no customer text, thumbnail, order number, capability or private URL on browser/OS notification previews. Push is optional and requires a supported secure-context implementation and user-initiated permission; denial is not an error that blocks chat. No remote URL fetching for cards/link previews. Rich cards use controlled typed rendering, not user HTML. Staff restrictions require an authorized reason/audit and cannot delete evidence or suppress unrelated customers.

## Advertising and receipt-screen threat boundary
SEC-1 decision: reject forged purchase events/amounts, cross-order receipt enumeration, forged proxy IP, unsafe redirect/referrer leakage and untrusted browser pixel configuration. Only verified provider/reconciliation evidence can create money postings. Browser collection endpoints accept bounded allowlisted funnel events, never authoritative Purchase; rate-limit and scope replay identities. Secrets and complete provider responses stay server-side; outbound vendor hosts/endpoints are allowlisted and versioned. Disable automatic form scraping/automatic advanced matching until field allowlisting and consent behavior are verified; exclude checkout inputs, chat, bank/refund details and staff pages.

Private order/thank-you responses use no-store caching and noindex metadata; no service-worker cache for private receipt/API state. Restrict referrer policy and strip sensitive URLs before analytics. Public rendering of a reference/QR/payment instruction is not authorization to log or transmit it. A failed tracker cannot throw away the order confirmation or trigger financial retry.

## Profile, exports and printable-document boundary
SEC-1 decision: protect profile/contact/address operations against IDOR, account takeover and enumeration; challenge endpoints are rate-limited, single-use and action/principal bound. Normalization of Indonesian phone for routing/matching never replaces possession verification. CS cannot use a phone match to attach another person's order. Revocation and cross-principal browser restoration clear private view/draft state.

Exports and label PDFs contain operational PII: private storage, server authorization on every fetch, bounded download lifetimes and no-store responses. Prevent spreadsheet formula execution in CSV exports, unsafe template HTML/assets, arbitrary remote PDF fetch/redirect and oversized/malformed artifacts. No public label QR may contain an access capability; internal parcel code reveals no order details without staff authorization. No decorative overlay touches barcode quiet zones or required operational fields. Print-job success claims are distinguished from hardware feedback and physical checks.

## Local simulation must preserve security controls
Local synthetic mode does not disable authorization, input validation, CSRF/origin controls, private-file ownership, idempotency, audit or money invariants. Do not accept client-controlled role/paid/collected/receipt flags for convenience. Test scenarios inject at owned adapter boundaries using local-only harness permissions, with no production-accessible control route. Production startup/build must reject local scenario hooks or simulated evidence being used as real provider proof. Mock artifacts are test-watermarked and namespaced. Loopback services and browser scope are still verified; local logs must not collect existing device/session secrets.
