# ADR-0007: Browser BFF and separate guest commerce capabilities

- **Status:** Accepted
- **Date:** 2026-10-16
- **Author:** Engineering owner
- **Deciders:** Engineering under Paduka Ongki's delegated technical selection
- **Supersedes:** None

## 1. Context

ADR-0006 and API-1 accept one versioned business API with separate cart/order guest scopes and permit reviewed HttpOnly browser transport. S20 must implement actual anonymous ownership and committed-result recovery before buyer screens. An idempotency key, order number, typed contact or referral cookie cannot become authentication. Browser credentials must stay outside JavaScript storage, URLs and advertising payloads. General native account bearer issuance remains outside this decision.

Drivers: scoped ownership; independent cart/order authority; current authorization on retries; shared-device isolation; safe unknown-result recovery; real PostgreSQL/auth; no extra dependency.

## 2. Considered Options

- **Header credentials for every client:** Simple wire contract and useful for independent API clients, but browser JavaScript must handle long-lived private credentials across navigation and account changes.
- **HttpOnly browser BFF cookies with separate scoped header transport:** Keeps browser credentials out of JavaScript storage and supports the accepted independent-client boundary. Requires purpose-specific cookie handling, a guest-context bootstrap and explicit identity-transition revocation.
- **Use one anonymous identity or idempotency key for every resource:** Fewer transports, but creates excessive order/cart authority and turns retry metadata into a credential.

## 3. Decision

Implement HttpOnly browser transport by default, with explicit header mode for scoped guest API capabilities. Account-owned commerce uses the actual verified Better Auth session. Each resource checks its current owner; staff account sessions retain actual MFA rules.

Anonymous cart creation first establishes a random server-issued HttpOnly guest context with a safe401 GUEST_CONTEXT_REQUIRED response and no cart mutation. Retry with that context creates the cart under an actor-scoped idempotency key. Losing the bootstrap response creates no orphan business effect. Keys never authenticate an existing context.

Cart and order capabilities use independent purpose-separated server MACs, with only digests and issuance/expiry metadata persisted. Browser responses deliver no plaintext capability fields; native/header mode receives only its scoped credential. An order cookie uses a fixed name with an order-specific API path, preserving multiple guest orders without a large universal cookie header. Browser order access additionally binds the current creating guest context; cart credentials never authorize GET Order.

Guest order submission/result recovery requires the original guest context plus its cart credential. Account submission/recovery requires the current owning session. Committed retries recheck authorization before returning the stored result, derive credentials without storing plaintext and cannot create a second order. Loss of all original credentials is a separate verified-contact recovery gate, not an idempotency-key bypass.

Successful login/logout revokes the previous browser guest context and clears root commerce cookies. Existing order-path cookies then have no authority. No guest order/account linking is inferred from a typed phone/email. Header capabilities remain resource-specific and are revoked with their creating guest context on explicit identity transition. Initial credential expiry is seven real days; business quote/reservation clocks are separate and retries do not extend them.

## 4. Consequences

Positive: narrow credentials; browser navigation without token storage; explicit current-owner/retry checks; purpose-separated future-client API; shared-device isolation.

Negative: the first anonymous cart request needs a transparent retry after guest-context bootstrap. Lost-all-credential recovery requires the later verified-contact flow. Server key rotation must deliberately invalidate or migrate outstanding capability/retry derivations.

Neutral: Cookie Secure=false is confined to the existing fixed HTTP loopback profile. Remote HTTPS/native account authentication and live provider activation remain separately gated. No native binary or bearer session is implemented here.

## 5. Confirmation

S20 must run real PostgreSQL and built-browser proof for guest/account cart isolation, bootstrap/retry, HttpOnly/no plaintext browser credentials, header purpose isolation, expired/revoked credentials, login/logout shared-device denial and one committed order under duplicate/concurrent submit. OpenAPI must document actual transports/responses; scoped headers/cookies never enter saved logs or advertising events. Actual independent R3 approval is required before acceptance of this proposed record and S20.

## 6. More Information

Refines [ADR-0006](ADR-0006-versioned-client-api-boundary.md). The sole index is [DECISIONS.md](../../DECISIONS.md). Canonical IAM/wire/data details remain in documents07/09/05; TASKS S20 owns execution. S20 confirmed the local implementation; provider/native-account/remote release acceptance remains separate.


### Runtime confirmation — 2026-10-16

Confirmed under existing owner-delegated engineering selection by S20 RUN-20261016T053426Z-4c2a6f07, final digest321739e1385f21be7074b7abaad9aa305cb04435f2cb71179bbdd90beb9de33d. Native11/built-browser1/static30/affectednative85 and actual separate combined54-path R3 approval/ledger PASS establish the scoped localhost behavior. Original declaration/review failures remain visible; S63 owns the nonblocking failed-revocation orphan-session recovery. No native account bearer, external provider or remote deployment is confirmed.
