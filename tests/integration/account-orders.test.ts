import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { accountOrderStage, summarizeAccountOrder } from "../../src/modules/accounts/order-summary.ts";
import { reorderAccountOrder, reorderFormInput } from "../../src/modules/accounts/reorder.ts";
import { challengeVerificationCode, handleAccounts, readBuyerAccountWorkspace } from "../../src/modules/accounts/service.ts";
import { patchProduct } from "../../src/modules/catalog/catalog.ts";
import { withdrawPublication } from "../../src/modules/catalog/publication.ts";
import { commerceActor } from "../../src/modules/checkout/access.ts";
import { createCart } from "../../src/modules/checkout/carts.ts";
import { expireOwnedOrderJob } from "../../src/modules/checkout/expiry.ts";
import { projectOrder } from "../../src/modules/checkout/orders.ts";
import { advanceFixtureClock, readFixtureClock } from "../../src/modules/local/fixtures.ts";
import type { OrderReceipt } from "../../src/modules/orders/receipt.ts";
import { sameOrigin } from "../../src/modules/storefront/format.ts";
import { actor } from "../contract/access-fixture.ts";
import { closeFulfillmentActor } from "./fulfillment-fixture.ts";
import { paymentFixture } from "./payment-fixture.ts";

// Stage policy consumes the real receipt projection, not raw lifecycle strings alone.
// Hold all independent facts constant while varying only the scenario under test.
test("account stages distinguish prepaid pending/confirmed, COD, parcel progress, cancellation, expiry and refunds", async () => {
  const f = await paymentFixture();
  try {
    const placed = await f.order(1);
    const order = await f.identity.sql.begin(tx => projectOrder(tx, placed.order.id));
    const now = order.created_at;
    assert.equal(accountOrderStage(order, now).stage, "unpaid");
    assert.equal(accountOrderStage(order, now).stage_label, "Menunggu pembayaran");
    assert.match(accountOrderStage(order, now).detail ?? "", /Bayar sebelum .* WIB/);
    const paid = { ...order, payment_status: "confirmed" };
    assert.equal(accountOrderStage(paid, now).stage, "processing", "payment is not delivery");
    const cod = { ...order, payment_method: "cod" as const, payment_status: "cod_due" };
    assert.equal(accountOrderStage(cod, now).stage, "processing", "COD is not unpaid prepaid");
    assert.equal(accountOrderStage({ ...cod, payment_status: "confirmed" }, now).stage, "processing");
    const shipped: OrderReceipt["order"] = { ...paid, shipments: paid.shipments.map(s => ({ ...s, status: "handed_over", tracking_number: "SYNTHETIC-RESI", courier_name: "Kurir contoh" })) };
    assert.deepEqual(accountOrderStage(shipped, now), { stage: "shipped", stage_label: "Dikirim", detail: "Kurir contoh · SYNTHETIC-RESI" });
    const delivered: OrderReceipt["order"] = { ...shipped, shipments: shipped.shipments.map(s => ({ ...s, status: "delivered", delivered_at: now })) };
    assert.equal(accountOrderStage(delivered, now).stage, "delivered");
    assert.match(accountOrderStage(delivered, now).detail ?? "", /^Diterima /);
    const partial: OrderReceipt["order"] = { ...shipped, shipments: [...delivered.shipments, ...order.shipments] };
    assert.equal(accountOrderStage(partial, now).stage, "shipped", "one delivered parcel never completes the other parcel");
    assert.equal(accountOrderStage({ ...cod, status: "cancelled" }, now).stage_label, "Dibatalkan");
    assert.equal(accountOrderStage({ ...order, status: "cancelled" }, now).stage_label, "Dibatalkan");
    assert.equal(accountOrderStage(order, order.expires_at).stage_label, "Kedaluwarsa");
    assert.equal(accountOrderStage({ ...order, status: "cancelled" }, order.expires_at).stage_label, "Kedaluwarsa");
    assert.equal(accountOrderStage(order, order.expires_at, true).stage_label, "Pembayaran diperiksa", "an unknown attempt past the deadline is not expired");
    assert.equal(accountOrderStage({ ...order, status: "cancelled" }, order.expires_at, true).stage, "unpaid", "an unknown attempt is never closed");
    assert.equal(accountOrderStage({ ...paid, payment_status: "confirmed" }, now, true).stage, "processing", "a confirmed payment ignores a stale unknown attempt");
    assert.equal(accountOrderStage({ ...delivered, payment_status: "refunded" }, now).stage_label, "Dikembalikan");
    assert.equal(accountOrderStage({ ...delivered, refund_total: order.buyer_total }, now).stage, "closed");
    assert.equal(accountOrderStage({ ...delivered, payment_status: "partially_refunded", refund_total: 1 }, now).stage, "delivered", "partial refund is not a full returned order");
    assert.equal(accountOrderStage({ ...delivered, items: delivered.items.map(i => ({ ...i, returned_quantity: i.quantity })) }, now).stage_label, "Dikembalikan", "all physical units returned is not a completed delivery");
    // The database read follows projectAttempt: a pending attempt whose creation job is unknown is unknown.
    assert.equal((await f.call(placed.client, `/api/v1/orders/${placed.order.id}/payment-attempts`, { method_id: "local-prepaid" })).response.status, 201);
    const rollback = new Error("rollback");
    await assert.rejects(f.identity.sql.begin(async tx => {
      await tx`update app.outbox_job set status = 'unknown', dispatched_at = coalesce(dispatched_at, now()) where id = (select creation_job_id from app.payment_attempt where order_id = ${placed.order.id} order by created_at desc limit 1)`;
      assert.equal((await summarizeAccountOrder(tx, placed.order.id)).stage_label, "Pembayaran diperiksa");
      throw rollback;
    }), e => e === rollback);
  } finally { await f.close(); }
});

test("account workspace keeps frozen thumbnails and verified guest ownership; reorder refuses strangers and skips withdrawn stock", async () => {
  const f = await paymentFixture();
  const buyer = await actor(f.identity, "buyer", []), stranger = await actor(f.identity, "buyer", []);
  try {
    const placed = await f.order(1);
    const [contact] = await f.identity.sql`select q.document->'contact'->>'phone' as phone from app.commerce_order o join app.checkout_quote q on q.id=o.quote_id where o.id=${placed.order.id}`;
    const call = async (path: string, body: Record<string, unknown>) => {
      const request = buyer.browser.request(path, body); request.headers.set("idempotency-key", randomUUID());
      const response = await handleAccounts(request, f.identity); assert.equal(response.status, 201); return response.json();
    };
    const challenge = await call("/api/v1/me/guest-order-link-challenges", { order_id: placed.order.id, contact: contact.phone });
    await call(`/api/v1/me/guest-order-link-challenges/${challenge.challenge_id}/verifications`, { code: await challengeVerificationCode(f.identity, challenge.challenge_id) });
    const original = await f.identity.sql.begin(tx => summarizeAccountOrder(tx, placed.order.id));
    assert.equal(original.can_reorder, true); assert.equal(original.units, 1);
    assert.deepEqual(original.items[0].thumbnail, { url: "/fixtures/shirt.svg", width: 480, height: 600 });
    const patch = f.request(); patch.headers.set("idempotency-key", randomUUID());
    await patchProduct(patch, f.identity, f.principal, f.seeded.products["fixture-offer-shirt"], { expected_version: 1, reason: "Synthetic new photo must not rewrite a receipt", images: [{ url: "http://127.0.0.1:3099/fixtures/cream.svg", alt: "Changed", width: 300, height: 300 }] });
    const workspace = await readBuyerAccountWorkspace(buyer.browser.request("/akun"), f.identity);
    assert.equal(workspace.authenticated, true); assert.deepEqual(workspace.orders.map(o => o.id), [placed.order.id]);
    assert.deepEqual(workspace.orders[0].items, original.items);
    assert.equal(workspace.orders[0].buyer_total, placed.order.amount_due);
    const refused = await reorderAccountOrder(stranger.browser.request("/akun", {}), f.identity, placed.order.id);
    assert.equal(refused.added, 0); assert.equal(refused.state.phase, "error"); assert.match(refused.state.message, /tidak ditemukan/);
    assert.equal((await f.identity.sql`select count(*)::int n from app.cart where owner_user_id=${stranger.id}`)[0].n, 0);
    const added = await reorderAccountOrder(buyer.browser.request("/akun", {}), f.identity, placed.order.id);
    assert.equal(added.added, 1); assert.equal(added.unknown, false); assert.deepEqual(added.state.skipped, []);
    const [line] = await f.identity.sql`select l.quantity,l.unit_price from app.cart_line l join app.cart c on c.id=l.cart_id where c.owner_user_id=${buyer.id}`;
    assert.deepEqual(line, { quantity: 1, unit_price: 99000 });
    const withdraw = f.request(); withdraw.headers.set("idempotency-key", randomUUID());
    await withdrawPublication(withdraw, f.identity, f.principal, f.seeded.products["fixture-offer-shirt"], { expected_publication_version: 1, reason: "Synthetic withdrawn reorder choice" });
    const skipped = await reorderAccountOrder(buyer.browser.request("/akun", {}), f.identity, placed.order.id);
    assert.equal(skipped.added, 0); assert.equal(skipped.state.phase, "error"); assert.equal(skipped.state.skipped.length, 1); assert.match(skipped.state.skipped[0].reason, /tidak dijual/);
    assert.equal((await f.identity.sql.begin(tx => summarizeAccountOrder(tx, placed.order.id))).can_reorder, false);
    assert.equal(sameOrigin("https://images.example.test/a.webp"), "https://images.example.test/a.webp");
    const data = new FormData(); data.set("order_id", placed.order.id); assert.equal(reorderFormInput(data), placed.order.id);
    data.append("order_id", placed.order.id); assert.throws(() => reorderFormInput(data));
  } finally { await closeFulfillmentActor(f.identity, buyer); await closeFulfillmentActor(f.identity, stranger); await f.close(); }
});

test("reorder carries cart revisions across lines, skips one withdrawn offer, caps at 50 and reports nothing addable", async () => {
  const f = await paymentFixture(); const buyer = await actor(f.identity, "buyer", []);
  let orderId: string | null = null;
  try {
    assert.equal((await f.client.auth("/sign-in/email", { email: buyer.email, password: buyer.password })).status, 200);
    await f.move("fixture-malang:fixture-shirt", "receive", 100);
    await f.move("fixture-malang:fixture-cream", "receive", 200);
    const input = { lines: [f.line("fixture-offer-shirt", 2), f.line("fixture-offer-cream-pack", 1)] };
    const request = f.client.request("/api/v1/carts", input), principal = await commerceActor(request, f.identity); assert.ok(principal);
    const created = await f.identity.sql.begin(tx => createCart(tx, request, f.identity, principal, input, { clock_namespace: f.namespace }));
    const quote = await f.client.call("/api/v1/checkout/quotes", { cart_id: created.cart.id, address: f.address, contact: f.contact(), payment_method: "prepaid" }, { version: 1 }); assert.equal(quote.response.status, 201);
    const placed = await f.client.call("/api/v1/orders", { quote_id: quote.payload.id }, { version: 1 }); assert.equal(placed.response.status, 201); orderId = placed.payload.order.id;
    assert.ok(orderId);
    const first = await reorderAccountOrder(f.client.request("/akun", {}), f.identity, orderId);
    assert.equal(first.added, 3); assert.deepEqual(first.state.skipped, []);
    let cart = (await f.client.call("/api/v1/carts/current")).payload;
    assert.equal(cart.lines.length, 2); assert.equal(cart.merchandise_total, 297000); assert.equal(cart.version, 3);
    const withdraw = f.request(); withdraw.headers.set("idempotency-key", randomUUID());
    await withdrawPublication(withdraw, f.identity, f.principal, f.seeded.products["fixture-offer-cream-pack"], { expected_publication_version: 1, reason: "Synthetic partial reorder" });
    const partial = await reorderAccountOrder(f.client.request("/akun", {}), f.identity, orderId);
    assert.equal(partial.added, 2); assert.equal(partial.state.skipped.length, 1); assert.match(partial.state.skipped[0].reason, /tidak dijual/);
    const fresh = await f.client.call("/api/v1/carts", { lines: [f.line("fixture-offer-shirt", 49)] }); assert.equal(fresh.response.status, 201);
    const capped = await reorderAccountOrder(f.client.request("/akun", {}), f.identity, orderId);
    assert.equal(capped.added, 1); assert.ok(capped.state.skipped.length >= 1);
    cart = (await f.client.call("/api/v1/carts/current")).payload;
    assert.equal(cart.lines.reduce((n: number, l: { quantity: number }) => n + l.quantity, 0), 50); assert.equal(cart.merchandise_total, 4950000);
    const full = await reorderAccountOrder(f.client.request("/akun", {}), f.identity, orderId);
    assert.equal(full.added, 0); assert.equal(full.state.phase, "error"); assert.match(full.state.message, /Tidak ada pilihan/);
    // Remove all free physical supply through the real inventory mutation path.
    const empty = await f.client.call("/api/v1/carts", { lines: [] }); assert.equal(empty.response.status, 201);
    const positions = await f.identity.sql<{ id: string; available: number }[]>`select id,on_hand-reserved-quarantined as available from app.inventory_balance where stock_item_id=${f.seeded.stocks["fixture-shirt"]}`;
    for (const position of positions) if (position.available > 0) { const key = Object.keys(f.seeded.positions).find(key => f.seeded.positions[key] === position.id); assert.ok(key); await f.move(key, "quarantine", position.available); }
    const out = await reorderAccountOrder(f.client.request("/akun", {}), f.identity, orderId);
    assert.equal(out.added, 0); assert.ok(out.state.skipped.some(s => /Stok/.test(s.reason)));
  } finally {
    if (orderId) { const clock = await readFixtureClock("test", f.namespace); await advanceFixtureClock("test", f.namespace, 1860, clock.version); const [job] = await f.identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${orderId}`; if (job) await f.identity.sql.begin(tx => expireOwnedOrderJob(tx, { id: job.id, kind: job.kind, payload: job.payload })); }
    await closeFulfillmentActor(f.identity, buyer); await f.close();
  }
});
