import type { TransactionSql } from "postgres";
import { salePublication } from "../catalog/publication.ts";
import { projectOrder } from "../checkout/orders.ts";
import type { OrderReceipt } from "../orders/receipt.ts";
import { sameOrigin, wibDate, wibDateTime } from "../storefront/format.ts";

export type OrderStage = 'unpaid' | 'processing' | 'shipped' | 'delivered' | 'closed';
export type AccountOrderItem = { name: string; variant_label: string; quantity: number; thumbnail: { url: string; width: number; height: number } | null };
export type AccountOrder = {
  id: string; number: string; created_at: string;
  stage: OrderStage; stage_label: string;
  detail: string | null;
  buyer_total: number; units: number; payment_label: string;
  items: AccountOrderItem[];
  can_reorder: boolean;
};

type ProjectedOrder = OrderReceipt["order"];

// Fulfillment, payment and refunds are separate facts: paying (including COD collection)
// never means delivered. Only original parcels determine the delivery stage.
// An unknown prepaid attempt may already have moved money: it never reads as expired, cancelled or unpaid.
export function accountOrderStage(order: ProjectedOrder, now: string, paymentUnknown = false): Pick<AccountOrder, "stage" | "stage_label" | "detail"> {
  const originals = order.shipments.filter(s => s.kind === "original");
  const active = originals.filter(s => s.status !== "cancelled");
  if (order.payment_status === "refunded" || (order.refund_total > 0 && order.refund_total >= order.buyer_total) ||
    (order.items.some(i => i.quantity > i.cancelled_quantity) && order.items.every(i => i.returned_quantity >= i.quantity - i.cancelled_quantity))) {
    return { stage: "closed", stage_label: "Dikembalikan", detail: null };
  }
  if (paymentUnknown && order.payment_method === "prepaid" && !["confirmed", "partially_refunded"].includes(order.payment_status)) {
    return { stage: "unpaid", stage_label: "Pembayaran diperiksa", detail: "Kami sedang memastikan status pembayaran. Jangan bayar ulang." };
  }
  if (order.status === "cancelled") return { stage: "closed", stage_label: order.payment_method === "prepaid" && !["confirmed", "partially_refunded"].includes(order.payment_status) && Date.parse(order.expires_at) <= Date.parse(now) ? "Kedaluwarsa" : "Dibatalkan", detail: null };
  if (order.payment_method === "prepaid" && !["confirmed", "partially_refunded"].includes(order.payment_status) && !order.refund_total) {
    if (order.payment_status === "expired" || Date.parse(order.expires_at) <= Date.parse(now)) return { stage: "closed", stage_label: "Kedaluwarsa", detail: null };
    return { stage: "unpaid", stage_label: "Menunggu pembayaran", detail: `Bayar sebelum ${wibDateTime(order.expires_at)}` };
  }
  if (active.length && active.every(s => s.status === "delivered")) {
    const delivered = active.flatMap(s => "delivered_at" in s && s.delivered_at ? [s.delivered_at] : []).sort().at(-1);
    return { stage: "delivered", stage_label: "Selesai", detail: delivered ? `Diterima ${wibDate(delivered)}` : null };
  }
  const sent = active.find(s => ["handed_over", "partially_delivered", "delivered", "in_transit"].includes(s.status));
  if (sent) return { stage: "shipped", stage_label: "Dikirim", detail: "tracking_number" in sent && sent.tracking_number ? `${sent.courier_name} · ${sent.tracking_number}` : sent.courier_name };
  return { stage: "processing", stage_label: "Diproses", detail: null };
}

export async function summarizeAccountOrder(tx: TransactionSql, orderId: string): Promise<AccountOrder> {
  const order = await projectOrder(tx, orderId);
  const [clock] = await tx<{ now: string }[]>`select app.reservation_clock(clock_namespace)::text as now from app.commerce_order where id = ${orderId}`;
  // Same latest attempt as the receipt (receipt.ts) and the same unknown rule as projectAttempt
  // (attempts.ts): an unknown attempt or an unknown creation job, unless the attempt is confirmed.
  const [attempt] = await tx<{ status: string }[]>`select case when a.status = 'confirmed' then 'confirmed'
      when a.status = 'unknown' or j.status = 'unknown' then 'unknown' else a.status end as status
    from app.payment_attempt a join app.outbox_job j on j.id = a.creation_job_id where a.order_id = ${orderId}
    order by a.created_at desc, (a.status in ('confirmed','pending','unknown')) desc, a.id desc limit 1`;
  const frozen = await tx<{ item_id: string; product_id: string; offer_id: string; thumbnail: AccountOrderItem["thumbnail"] }[]>`
    select i.id as item_id, i.product_id, i.offer_id, r.images->0 as thumbnail
    from app.order_item i join app.product_revision r on r.product_id = i.product_id and r.revision = i.product_revision
    where i.order_id = ${orderId}
  `;
  let canReorder = false;
  for (const productId of new Set(frozen.map(i => i.product_id))) {
    const current = await salePublication(tx, productId, new Date().toISOString());
    if (current?.draft.variants.some(v => !v.retired && frozen.some(i => i.product_id === productId && i.offer_id === v.id))) { canReorder = true; break; }
  }
  return {
    id: order.id, number: order.number, created_at: order.created_at,
    ...accountOrderStage(order, clock.now, attempt?.status === "unknown"), buyer_total: order.amount_due,
    units: order.items.reduce((n, item) => n + item.quantity, 0), payment_label: order.payment_channel_label,
    items: order.items.map(item => {
      const image = frozen.find(i => i.item_id === item.id)?.thumbnail;
      return { name: item.name, variant_label: item.variant_label, quantity: item.quantity,
        thumbnail: image ? { url: sameOrigin(image.url), width: image.width, height: image.height } : null };
    }), can_reorder: canReorder,
  };
}
