# ADR-0008: Open the production money path and the AutoLaris channel (S97 step C)

- **Status:** Accepted (2026-11-09, owner: "ya, bank manual (opsional - setup di super admin), qris + va autolaris, COD")
- **Date:** 2026-11-09
- **Author:** Engineering (pi session, model `cc/claude-sonnet-5-5`)
- **Deciders:** Paduka Ongki (owner); R4 independent review required before any code
- **Supersedes:** None
- **Consulted / Informed:** Evidence from one live QRIS payment (BUILD-LOG 2026-11-09); AutoLaris reference repository `~/Projects/autolaris-payment-gateway`

## 1. Context

Production takes orders only by manual bank transfer and COD. S97 step B (deployed, inactive) taught `classifyAdvice` the one observed live settled shape (`rc 00` + `ket PAID`, no amount, no payment time). Opening AutoLaris in production still fails closed in four places, found by reading the code on 2026-11-09:

1. **Order entry.** `submitOrder` (`src/modules/checkout/orders.ts:79`) throws `CHECKOUT_CLOSED` when the profile is `production` (OD-7: no issued provider). The route `POST /api/v1/orders` is the only caller.
2. **Money environment.** `financeEnvironment` (`src/modules/finance/ledger.ts:15`) throws `PRODUCTION_MONEY_PATH_GATED` on database `99ribu_production`. Eight modules call it: ledger, manual-bank, cod-remittance, autolaris-payments, payouts, fulfillment/manual (parcel receipt and tracking), commissions, payments/autolaris.
3. **AutoLaris client and profile.** `autolarisClientFor` throws `AUTOLARIS_LIVE_GATED` for any target other than `local`/`test`; `readProductionConfig` refuses every `AUTOLARIS_*` variable; `offeredChannels()` returns only `manual-bank` and `cod` in production.
4. **Schema.** Migration `0035` already allows `environment='production'` on the eight real-flow money tables (`autolaris_payment`, `cod_remittance`, `economic_receipt`, `finance_transaction`, `local_cod_operation`, `local_parcel_receipt`, `local_payment_operation`, `local_settlement_operation`). **Eleven simulator stores stay `local`/`test`** (`local_autolaris_transaction`, `local_waybill_*`, `local_refund_*`, `local_recovery_*`, `local_replacement_*`, `local_parcel_outcome`, `local_tracking_observation`). No migration is needed for the AutoLaris payment path itself.

Two facts corrected from an earlier statement in the same session: the schema is **not** a blocker for the payment path (19 tables was the wrong count; 8 already allow production), and `financeEnvironment` is shared with the refund, payout, commission and tracking paths, which this decision must not open by accident.

Also unresolved: the production callback table (`app.autolaris_callback`) has not been read by the agent (no host access); the callback never moves payment state, so its content informs discovery only. VA settlement shape, the `expired` timezone and the duplicate `reff_id` rule are unobserved.

**Decision drivers:** buyers can pay by QRIS/VA without manual transfer checks; no order is marked paid from anything but an observed, exact advice; a late or mismatched payment never ships goods; each gate opens separately and can be closed again without a migration; the money environment must not open refunds, payouts or commissions as a side effect.

**Non-goals:** Mengantar booking and tracking (S94/S98, deferred by the owner); callback-driven settlement; VA until its shape is observed; any change to COD or manual bank behaviour; opening the simulator stores.

## 2. Considered Options

- **Option A, open everything at once (flip `financeEnvironment` and the profile).** Good: smallest diff. Bad: opens payouts, commissions, refunds and parcel tracking to production on the same switch, none of which has live evidence; one mistake affects every money path; no staged rollback.
- **Option B, staged, per-capability gates, QRIS only first.** Replace the single throw with an explicit allow-list of money capabilities (`payments`, later `cod`, `payouts`...) read from the production profile, each default closed. Open only `payments` and `autolaris`, and offer only `QRIS` in the first release. Good: blast radius is one channel; every other money path stays shut; rollback is an environment variable. Bad: a new profile setting and tests for every capability.
- **Option C, a separate production database or schema for AutoLaris.** Good: isolation. Bad: duplicates ledger and receipts; orders already live in `99ribu_production`; contradicts ADR-0003 (one immutable ledger). Rejected.

## 3. Decision (proposed)

Choose **Option B**, delivered in five reviewed steps, each its own R4 slice or sub-step with its own deploy and rollback. Nothing in a later step starts before the earlier step is deployed, healthy and verified.

1. **Capability gate (code, inactive).** `financeEnvironment` keeps refusing production unless the production profile lists the caller's capability. Add `MONEY_CAPABILITIES` to `readProductionConfig` (default empty, parsed and validated, never echoed). Add the capability argument to the eight call sites; only `payments` is wired in this step. Tests: every capability closed by default, `payments` open alone leaves refunds, payouts, commissions and tracking closed.
2. **Production AutoLaris client (code, inactive).** Allow `AUTOLARIS_API_KEY` and `AUTOLARIS_BASE_URL` in the production profile only when `MONEY_CAPABILITIES` includes `payments`; `autolarisClientFor('production')` returns `liveAutolaris` bound to `https://api-h2h.autolaris.com` through an origin-bound fetch. The key stays a server secret (never in logs, errors or the client bundle; `AUTOLARIS_WEBHOOK_SECRET` is not read until a callback contract exists).
3. **Order entry for AutoLaris only.** Replace the blanket `CHECKOUT_CLOSED` by a check that the order's payment channel is offered in production. Manual bank and COD behave as today. `offeredChannels()` adds `autolaris-qris` only when step 1 and 2 are active.
4. **Production rehearsal on the owner's own order, then enable.** With the capability on, the owner places one real order with a minimal total and pays it; the advice poll settles it once, the receipt and ledger posting match, and the order moves to paid with nothing shipped automatically. Only then the channel stays on for buyers.
5. **Observe, then widen.** Collect the first real callbacks and a VA payment as evidence; add VA only after its settled shape is observed. Each widening is a new slice.

Affected modules: `config/runtime.ts`, `finance/ledger.ts` and its eight callers, `payments/autolaris.ts`, `payments/methods.ts`, `checkout/orders.ts`, `storefront/checkout-order.ts`, `compose.production.yaml`/Coolify env, tests (`config`, `autolaris-payments`, `autolaris-stand-in`, `payment-fees`, a new capability test).

### Owner decisions recorded 2026-11-09 (amend the steps above)

- **A. Channels.** All three production channels open, not QRIS only: **manual bank transfer** (optional, switched on in Super Admin with its account setup), **AutoLaris QRIS and VA**, and **COD**. Each channel stays an independent switch; the capability gate (step 1) still keeps refunds, payouts, commissions and tracking closed.
- **B. Provider events.** Production settles AutoLaris only from the server's own `advice` poll and records the result as an internal, server-built event. No externally supplied event payload and no HMAC signing key are used in production; callbacks stay evidence only.
- **Risk accepted knowingly.** Checkout has never taken an order in production (`CHECKOUT_CLOSED` since S82), so manual bank and COD have no live history either. Mitigation: per-channel switch, step 4 rehearsal on the owner's own minimal order for each channel (one QRIS, one VA, one manual bank, one COD), and nothing ships automatically.
- **VA caveat.** The VA settled shape has not been observed. VA settles only on the same exact pair (`rc 00` + `ket PAID`); any other answer is `unknown` and the manual confirmation path remains. The VA rehearsal in step 4 is the first observation and must be recorded before VA stays on for buyers.
- **Code facts found while scoping (2026-11-09).** `payments/local.ts:profile()` refuses any target but `local`/`test` and requires the database name `99ribu_<target>`; 88 sites type the money target as `'local'|'test'`; `manual-bank` confirmation also calls `financeEnvironment`, so manual bank cannot confirm in production today either. These are in scope of step 1-2.

## 4. Consequences

- **Positive:** QRIS checkout without manual transfer review; each step can be shipped inactive and proven before it takes effect; rollback of the channel is clearing one environment variable, no migration; payouts, commissions, refunds and tracking cannot be opened by this change.
- **Negative:** the 8-caller refactor touches money code and needs a full suite plus independent review; the first release offers QRIS only; the advice carries no payment time, so a payment first read after the deadline goes to recovery (an S33 exception for finance) rather than confirming; amount is verified at creation only, not in advice.
- **Neutral:** callbacks remain evidence only; the owner's static egress IP (`149.28.129.53`) must stay the sender; a changed server IP breaks payments.

## 5. Confirmation

- Capability matrix test (`tests/config.test.ts` extension): each capability refuses production by default; with only `payments` set, `financeEnvironment('refunds'|'payouts'|'commissions'|'tracking')` still throws `PRODUCTION_MONEY_PATH_GATED`.
- `autolarisClientFor('production')` throws without the capability and without a key; refuses a non-`https://api-h2h.autolaris.com` origin; never includes the key in an error.
- Profile test: `AUTOLARIS_*` refused without the capability, accepted with it; `AUTOLARIS_WEBHOOK_SECRET` stays refused.
- Integration (`autolaris-payments`, `autolaris-stand-in`): the existing cases plus an unknown ket, wrong rc and a late payment (recovery) against the production-profile client.
- Release evidence: step 4 rehearsal recorded in BUILD-LOG (order number, amount, advice reads, receipt, ledger posting, nothing shipped); R4 independent review bound to each step's final surface; full `all-current` before each deploy; off-host backup before each deploy.

## 6. More Information

- Live evidence: BUILD-LOG 2026-11-09 (`/data/tmp/99ribu/autolaris-discovery/`); reference repository note in `docs/reference/h2h-api.md`.
- Open before step 4: whether AutoLaris sends callbacks to the sent `callback_url` (contents never moves state); the VA shape; the `expired` timezone; duplicate `reff_id` behaviour. Step 4 does not require them because settlement comes only from advice.
- Revisit when: AutoLaris publishes a settled status list or a payment timestamp in advice; a second payment provider is added.

### Dated note 2026-11-09 (probe evidence, owner-approved)

Two unpaid QRIS `submit` probes (Rp9.900) on the production AutoLaris account: payload and digits-only reference accepted with the area ids from AutoLaris' published examples (3517100 to 3518010); `submit` bills `grand_total` with the fee inside it (so DEC-029 holds unchanged and `create_payment`, which adds the fee on top, is not used); `payment_info.expired` is Jakarta time; a REPEATED reference creates a new order, so production reconciliation never replays (money-critical, not precautionary). Open: the settled `advice` shape for `submit` and VA; the owner's own paid rehearsal (step 4) closes them.

### Dated note 2026-11-10 (step 3a)

`cod` is refused at startup until its collection and remittance path is wired, so the owner decision A ("three channels") is met for manual bank and AutoLaris only; COD follows as its own step. Order entry is per channel and closed by default. The rollback property claimed in section 4 ("rollback of the channel is clearing one environment variable") holds for NEW orders only: clearing a capability strands orders already placed on that channel until step 3b separates "stop new orders" from "emergency stop".

### Dated note 2026-11-10 (step 3b: drain vs emergency stop)

Two switches, with two different consequences, and the operator must choose the right one:

- **Drain (normal way to close a channel):** move the capability from `MONEY_CAPABILITIES` to `MONEY_DRAIN`. The channel takes no new order and is no longer offered, but every order already placed on it is served to the end: the worker still polls AutoLaris advice, finance can still confirm, and a buyer of such an order may still open its payment, including a fresh AutoLaris bill after an earlier attempt on that same order failed (deliberate: the buyer ordered while the channel was open and must be able to pay that order). Remove the capability from `MONEY_DRAIN` only after every open order on it is settled or expired.
- **Emergency stop (both lists empty, e.g. a leaked key):** nothing is served. Advice is not read, so a bill a buyer already paid at AutoLaris is NOT recognised; after the deadline and the 30-minute final window the order is cancelled and its stock released, and that money has no trace in this system. Every emergency stop therefore REQUIRES a manual reconciliation of the AutoLaris dashboard against the orders cancelled during the stop (refund or re-issue outside the system). Use it only when serving is itself unsafe.

### Dated note 2026-11-10 (opening VA payments: owner runbook)

Deployed state before opening: production offers Virtual Account only (QRIS off until a scannable image exists), an AutoLaris order lives 2 hours (DEC-031), at most 2 open AutoLaris orders per buyer. Opening is an owner action in this order:

1. **Super Admin → Pengaturan → Pembayaran:** choose who bears the AutoLaris admin fee (Pembeli or Platform), check the fee table (BCA Rp6.500, other VA Rp3.000 as starting values), switch on "Virtual Account / QRIS (AutoLaris)". Bank manual only if its accounts are filled in.
2. **Coolify `99ribu-app` environment, all four together, then redeploy:** `MONEY_CAPABILITIES=payments`, `AUTOLARIS_API_KEY` (the official key), `AUTOLARIS_ORDER_ORIGIN_ID=3517100`, `AUTOLARIS_ORDER_DESTINATION_ID=3518010` (the payment-only placeholders proven by the 2026-11-09 probes). A partial set fails startup on purpose.
3. **One real paid order by the owner, by VA**, before any buyer is told: it proves `payment_info.va` (only seen in the provider's documentation so far, the probes were QRIS) and the settled `advice` shape for a `submit` transaction. If the instruction is not shown, the attempt fails without money moving; close with drain (step 3b note) and report.
4. Check after that payment: the order shows "Pembayaran terkonfirmasi", Keuangan → Pembayaran Masuk lists it as settled, and the AutoLaris dashboard shows the same transaction and total.

Review note: the 3b independent review (Argon) raised the emergency-stop stranding as High; its consequence is real and is documented above as the operating cost of an emergency stop. Several mechanisms in that review did not exist in the code (named functions such as `leaseNextJob`, `createPaymentProviderAdapter`, the error text "Missing job adapter", a claim that unregistered job kinds are claimed and burned); leased jobs are claimed only for registered kinds (`src/jobs/leases.ts` `runLeasedJob`), and expiry waits on attempts in `pending` or `unknown`. Those parts were rejected after checking the source.

