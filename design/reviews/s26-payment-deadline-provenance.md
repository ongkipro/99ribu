# S26 payment deadline provenance

The displayed deadline is a persisted native local value. It is not currently a live Virgo/provider-issued value.

- `src/modules/checkout/orders.ts:79` selects a30-minute local order lifetime from the native cart clock; `commerce_order.expires_at` is persisted in the order transaction.
- `projectOrder` in the same file projects that stored timestamp as ISO. `readCheckoutPayment` reads the authorized private order through the existing native handler.
- `src/modules/payments/attempts.ts:35` creates the local payment attempt with the same stored `order.expires_at`; attempt projection reads the persisted expiry. Creating or refreshing the UI does not extend it.
- `src/app/(storefront)/checkout/order/[orderId]/page.tsx` formats the persisted `order.expires_at` for Asia/Jakarta. Its method copy explicitly says pembayaran simulasi. The UI does not compute a fresh deadline on render.

The current native payment regression asserts both the view/order timestamp and stored order/attempt equality. The current browser regression additionally compares visible Batas pembayaran text with its actual owned database order expiry. Executed results belong to STATUS/.delivery and the current proof receipts; this source trace is not live-provider acceptance. Existing late confirmed-payment and duplicate/unknown recovery checks remain in the registered matrix.
