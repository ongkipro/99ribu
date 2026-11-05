# S177 stage 2B — store voucher (merchandise discount): design

Status: **design, not built** (2026-11-05), revised after a separate-agent R4 review the same day (verdict "sound with changes"; findings F1–F11 folded in below). Owner decisions 1–13 in `S177.md` apply (10–13 answer this design's §8 questions; decision 11 changes stacking for store vouchers). `TASKS.md` row S177 owns scope; `STATUS.md` owns state. Impact evidence: two read-only sweeps on 2026-11-05 (order money model + DB guards; downstream consumers), summarised in §2.

## 1. What the buyer and staff get

- Buyer: types a store-voucher code exactly like a shipping voucher. The summary shows `Voucher KODE −Rp…` under Produk, before shipping. Same refusal reasons as stage 2A.
- Staff (Pemasaran → Voucher): a voucher has a **jenis**: "Potongan ongkir" (stage 2A) or "Potongan harga produk" (new). Fixed rupiah, or percentage with a required maximum ≥ % × minimum purchase (decision 1). Same proposal → approval flow, term lock after first run, budget, per-buyer limit, period, payment-method filter, kecamatan/courier filters.

## 2. Why the discount must be frozen per unit (impact map)

The order header is not where money is read. Almost every downstream path rebuilds merchandise from `order_item.unit_price` **per unit**, and Postgres triggers require the totals to match exactly:

| Area | Today reads | Source |
|---|---|---|
| Order seal | `Σ unit_price = o.merchandise_amount`, parcel `cod_due`, COD fee, reservation match | `seal_commerce_order` (`0044:199`) |
| Quote guard | `Σ cart_line = merchandise_amount`, every promotion has positive `shipments`, `buyer_total` formula | `guard_checkout_quote` (`0044:130`), `checkout_quote_value_check` |
| COD fee | `ceil((parcel merch + net shipping) × bps)` | `projectPackages`, `submitOrder:138`, `guard_checkout_quote_payment` (`0046`) |
| COD collection / waybill / manual booking | `Σ unit_price + buyer_shipping + payment_charge` | `finance/receipt-units.ts:10`, `fulfillment/local.ts:15`, `cod_*_collection_basis` (`0032`), `waybill_current_request_basis` |
| Prepaid receipt | `o.merchandise_amount`, `shipping − subsidy` | `finance/receipts.ts:22`, `guard_finance_part` |
| Returns / refunds / recovery refunds / exception cancellations | `merchandise_amount = unit_price`; caps vs receipt | `returns/{policy,cases,occurrences,financial-basis}.ts`, `assert_unit_merchandise` (`0044:42`), `recovery_refund_eligible_units` (`0032:508`), `assert_exception_refund_proposal` (`0032:691`), `assert_exception_application` (`0032:758`) |
| Affiliate commission | `offerCommissionIdr(bps, unit_price)` | `commissions/service.ts:153-181`, `affiliates/rates.ts:28` |
| Ad Purchase value | `unit_price × qty` per item | `advertising/events.ts:53-57`, `assert_commerce_event` (`0044:301`), `purchase_*_payload` |
| Contribution floor at checkout | per-unit contribution minus subsidy only | `checkShippingBenefit` (`shipping/contribution.ts`), `assert_attributed_checkout_cost` (`0044:326`) |
| Partial cancellation | unit `subsidy_amount` intervals per shipment | `cancelledPromotionAmounts` (`promotions/reservations.ts:31`), `exception_promotion_unit_shares` (`0023:2234`) |
| Receipt API, dashboards, diagnostics | `Σ unit_price × qty` | `orders/receipt.ts:266`, `reporting/dashboard.ts:240,557`, `advertising/diagnostics.ts:395` |

An order-level discount number alone would be rejected by the seal trigger and, if forced, missed by refunds, COD, commission, ad values and receipts. So, like the shipping subsidy (`fulfillment_item.subsidy_amount`), the discount is **frozen per unit** at order creation.

## 3. Money model

Per unit *u*: `price_u` = frozen `order_item.unit_price` (unchanged), `discount_u` = frozen voucher share, `net_u = price_u − discount_u`, with **`1 ≤ net_u ≤ price_u`** (R4 F1).

1. **Gross stays gross.** `merchandise_amount` on quote, order and parcel keeps meaning `Σ price`. New columns carry the discount: `checkout_quote.merchandise_discount`, `commerce_order.merchandise_discount`, `order_shipment.merchandise_discount`, `fulfillment_item.merchandise_discount` (all `bigint not null default 0`).
2. **Buyer total.** `buyer_total = merchandise_amount − merchandise_discount + shipping_amount − subsidy_amount` (both value checks and both guards). `amount_due = buyer_total + payment_charge_amount` as now.
3. **Every unit keeps at least Rp1 (F1).** The benefit is capped at `M − n` (M = gross merchandise, n = units). With `net_u ≥ 1`, every existing `≥ 1` rule keeps holding unchanged: `economic_receipt_money_check`, `payment_attempt.expected_amount ≥ 1`, `commerce_event_value_check`, `purchase_allocation_value_check`, both `*_adjustment_value_check`s, `refund_allocation.amount ≥ 1`, TikTok `price > 0`, `offerCommissionIdr` input 1..99000. A Rp1 offer gets no discount.
4. **Allocation (deterministic, integer; F4).** This is a new rule, not `commerce_parcel_line_money` (that one weights by quantity inside a parcel):
   - Order → lines: weight `w_line = q × (price − 1)`, W = Σ w = M − n ≥ D. Largest remainder; ties by `line_id` ascending. Then `D_line ≤ w_line`.
   - Line → units: the line's units are ordered by **(parcel_id, unit_index, fulfillment_item id)**, the order `submitOrder` creates them in; each gets `floor(D_line / q)` and the first `D_line mod q` get +1. Then `discount_u ≤ price − 1`.
   - Parcel discount = Σ its units. TS (`promotions/allocation.ts`) and an SQL twin used by `seal_commerce_order` and the reservation guard must produce identical rows; a property test checks parity on random carts.
5. **Downstream rows store the net.** Rows describing money the buyer paid or gets back keep the column name `merchandise_amount` but hold **net** merchandise: `economic_receipt`, `return_item`, `refund_allocation`, `recovery_refund_allocation`, `purchase_allocation` / `commerce_event`, `commission_entry.merchandise_amount` (commission base). Readers that only sum the column (finance summary, dashboard revenue, refund adjustments' `retained_merchandise`, reporting queue) become correct unchanged. Readers that compare with `unit_price` switch to `unit_price − fulfillment_item.merchandise_discount`: `assert_unit_merchandise`, `guard_return_item` (`0032:455`), `recovery_refund_eligible_units`, `assert_exception_refund_proposal`, `assert_exception_application`, `assert_commerce_event`, `returns/financial-basis.ts:41`. The order-level AOV (`dashboard.ts:557`) stays gross and is labelled so; `advertising/diagnostics.ts` labels change from gross to net. (Alternative rejected: a parallel discount column on every downstream row — about twice the code, every reader would subtract.)
6. **COD.** Parcel fee base and `cod_due` use `merchandise − discount + buyer_shipping`; `collectionUnitTotals`, `waybillRequestBasis` and the SQL bases sum `net_u`. The label prints the frozen `cod_due`.
7. **Manual-bank code / COD fee spread to units.** Weight becomes `net_u + buyer_shipping_u` (`orders.ts:137`); since `net_u ≥ 1`, no weight is zero (F7).
8. **DEC-029 fees.** The buyer-borne AutoLaris fee is computed on `amount_due`, already after the discount; nothing else changes.
9. **Commission (decision 6; F6).** Accrual base `net_u` per unit. The checkout estimate becomes per unit group: each `financial_sources` line stores at most two groups `{count, net_idr, commission_idr}` (units of a line differ by at most Rp1), read by `assert_attributed_checkout_cost`, `checkShippingBenefit` and `realized-contribution.ts:463`.
10. **Ad Purchase value (F10).** Value = Σ `net_u`. Meta/TikTok need an integer price per content and Σ contents = value, so contents are grouped per (offer, `net_u`) — at most two per line; `content_ids` stays de-duplicated. The same grouping goes into `purchase_signal_payload` and `purchase_receipt_payload`, which `guard_commerce_event` compares with the stored payload.
11. **Refunds.** A returned or cancelled-after-payment unit refunds `net_u + buyer_shipping_u + payment_charge_u`. Payment fees stay non-refundable (DEC-029). Caps against `economic_receipt.amount` hold because both sides are net.
12. **Budget and usage.** Reservation and movement rows are reused. `promotion_reservation` gains `discount_amount`; its check becomes `subsidy_amount + discount_amount > 0`, `subsidy_amount ≤ shipping_amount`, `discount_amount ≤ merchandise_amount − units`. New `promotion_line_allocation(reservation_id, promotion_id, line_id, amount)` for merchandise rules; `readPromotionReservation` and the reserved-vs-quote comparison (`orders.ts:121`) include it. `expected_promotion_allocations` (`0012:288`) skips merchandise rules; a merchandise oracle checks line allocations. Unpaid expiry releases; first handover consumes; staff unit cancellation releases the cancelled units' share (`exception_promotion_unit_shares` gains a unit branch over `fulfillment_item.merchandise_discount`; with one voucher per order the interval method reduces to Σ of the cancelled units). A return after delivery does not restore budget or the buyer's use (Q3).
13. **Stacking (decisions 4 and 11; F11).** One code per order. A **store voucher stacks** with the automatic shipping promotions (decision 11): the order carries the merchandise allocation and the automatic shipping allocations together, so a unit may have both `subsidy_amount` and `merchandise_discount` and the reservation holds both kinds. A **shipping voucher** still does not stack (decision 4): the checkout compares the final `amount_due` of the voucher against the automatic promotions and keeps the lower, otherwise `STACKING_CONFLICT`. Minimum-purchase rules of automatic promotions keep reading gross merchandise. Partial cancellation releases each kind by its own unit amounts (shipping by `subsidy_amount` intervals per shipment as today, merchandise by `merchandise_discount`).

## 4. Promotion configuration and quote document

- `promotion_version.target text not null default 'shipping' check (target in ('shipping','merchandise'))`; `merchandise` requires a `code`. `target` is a locked term (decision 8).
- Percentage merchandise rules require `maximum_per_order > 0` and `≥ ceil(% × minimum_merchandise)`.
- Filters on a merchandise rule are **order-level eligibility**: payment method, minimum purchase (gross merchandise), destination (`prov-*` / `dist-*` of the delivery address), courier service (every parcel's service listed).
- Benefit: `min(fixed value or round(M × bps / 10000), maximum_per_order, M − n)`.
- **Quote document (F8):** a merchandise entry in `document.promotions[]` is `{promotion_id, version_id, target:'merchandise', amount, lines:[{line_id, amount}]}` (no `shipments`); each parcel in `document.selected_plan` gains `merchandise_discount` (Σ of its units under §3.4). `guard_checkout_quote` branches on `target`: shipping entries keep the positive-`shipments` and subsidy rules; merchandise entries must have positive `lines` summing to `amount` and add into `merchandise_discount`, not `subsidy_amount`. `guard_checkout_quote_payment` uses the parcel's `merchandise_discount` in the COD base. `seal_commerce_order` stops requiring `subsidy_amount > 0` when the reservation is a merchandise one and compares `promotion_line_allocation` instead of shipment arrays.

## 5. Surfaces to change

- **Migration `0051_store_voucher` (expand only; production has 0 orders, all new columns default 0).** Columns of §3.1, §3.12, §4. CREATE OR REPLACE, each diffed against its latest definition (`0012`, `0023`, `0032`, `0044`, `0046`, `0047`):
  - checkout/order: `guard_checkout_quote`, `guard_checkout_quote_payment`, `guard_commerce_order`, `seal_commerce_order`, `assert_attributed_checkout_cost`;
  - promotions: `guard_promotion_reservation`, `expected_promotion_allocations` + merchandise oracle, `exception_promotion_unit_shares`, `exception_promotion_release_basis`;
  - collection/receipts: `guard_finance_part`, `cod_current_collection_basis`, `cod_operation_collection_basis`, `waybill_current_request_basis`;
  - returns/refunds: `assert_unit_merchandise`, `guard_return_item`, `guard_refund_allocation`, `recovery_refund_eligible_units`, `assert_exception_refund_proposal`, `assert_exception_application` (adjustment-intent guards unchanged, values become net);
  - ads: `purchase_signal_payload`, `purchase_receipt_payload`, `assert_commerce_event`.
  - No value check needs widening (§3.3).
- **TypeScript:** `promotions/{allocation,configuration,reservations}.ts`, `checkout/{quotes,orders}.ts`, `payments/methods.ts`, `payments/cod*.ts`, `finance/{receipts,receipt-units,realized-contribution}.ts`, `fulfillment/{local,manual}.ts`, `returns/{policy,cases,occurrences,financial-basis,refunds}.ts`, `checkout/exceptions/{refunds,collection}.ts`, `commissions/service.ts`, `affiliates/rates.ts`, `advertising/{events,worker,diagnostics}.ts`, `advertising/{meta,tiktok,google}/*` (content grouping), `shipping/contribution.ts`, `orders/receipt.ts`, `reporting/dashboard.ts`.
- **Buyer UI:** checkout summary (voucher row under Produk), payment page, order page charges block, receipt. Item lines keep the frozen price.
- **Admin UI:** voucher form (jenis, cap rule), approval panel with the margin preview (§6), order detail "Diskon voucher" row.
- **Contract:** `docs/spec/openapi.yaml` (`target`, `merchandise_discount_total`, `QuoteVoucher.target`), PR-11 samples.
- **Decisions (F9):** DEC-025 says COD fee base, unit refunds, commissions and Purchase signals use the frozen unit price. Moving them to the net (price minus the frozen voucher share) amends DEC-025 beyond decision 6. Recorded as a DEC-025 amendment in `DECISIONS.md` (owner Q4, 2026-11-05).

## 6. Margin floor (DEC-025 minimum contribution; F5)

A store voucher lowers every unit's contribution. Two existing guards check the Rp9.900 floor per order: `checkShippingBenefit` (TS, all orders; refuses with `PROMOTIONAL_CONTRIBUTION_REVIEW_REQUIRED`) and `assert_attributed_checkout_cost` (DB, affiliate-attributed orders; raises). Without a change, a merchandise voucher on a thin-margin product would be refused at checkout, and for attributed orders by the database.

Recommended: the **approval is the owner exception**. The approval panel shows, at the voucher's maximum benefit and minimum purchase, how many published offers fall below the floor and the worst one; approving records that preview in the audit entry and stores `floor_exception=true` on the approved version. Both guards then accept a below-floor unit whose shortfall comes only from that approved voucher's discount. For consistency stage 2A shipping vouchers get the same rule (today they hit the per-order refusal). Realized contribution reports the real result.

## 7. Tests (done-when)

- Unit: allocation sums exactly, ties deterministic, `1 ≤ net_u`, TS ↔ SQL parity on random carts; percentage cap rule; ad content grouping keeps integer prices and exact sums; per-unit commission groups.
- Integration (`--case=vouchers` grows): apply → quote and order freeze the discount per unit; seal refuses a tampered unit share; COD fee and `cod_due` after discount; manual-bank code spread; prepaid and COD receipts net; return refund = net; recovery refund and exception cancellation caps; commission on net; Purchase value net (Meta/TikTok/Google payloads); partial cancel releases unit shares; expiry releases; handover consumes; last-quota race; shipping-voucher stacking choice by `amount_due`; store voucher stacked with an automatic shipping promotion (unit carries both, partial cancel releases both kinds); affiliate-attributed order with an approved below-floor voucher; finance summary on a subsidised and a discounted order (closes the PR-19 fixture gap).
- Browser: checkout row at 390/1440, no-JS apply, order page and receipt rows, admin form + approval preview.
- R4 review by a separate agent on the final surface; deploy only on the owner's word after a backup.

## 8. Open questions for the owner

Answered by the owner 2026-11-05 (recorded as S177 decisions 10–13):

- **Q1 Margin floor → approval is the owner exception** for both voucher kinds (§6).
- **Q2 Stacking → a store voucher may stack with the automatic shipping promotions** (Shopee-style; §3.13). A shipping voucher still competes with them.
- **Q3 Returns → a return does not restore budget or the buyer's use.**
- **Q4 Net basis → refunds, COD amount, affiliate commission and ad Purchase value use the price after the voucher** (DEC-025 amendment recorded).

## 9. Order of work

1. Migration + allocation + oracles + promotion config (unit + migration tests).
2. Quote/order/seal + COD + manual-bank (integration).
3. Receipts, refunds, recovery, exception cancellations, commissions, ad events, cancellation release (integration).
4. Buyer and admin UI (browser) and OpenAPI.
5. Docs (BUILD-LOG, ARCHITECTURE money flow, STATUS, TASKS row, DECISIONS amendment), R4 review on the final surface, then the deploy request.
