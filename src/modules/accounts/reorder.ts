import { randomUUID } from "node:crypto";
import { applySetCookies } from "better-auth/cookies";
import type { LocalAuth } from "../access/auth.ts";
import { assertOrigin } from "../access/http.ts";
import { AccessError, getPrincipal } from "../access/policy.ts";
import { salePublication } from "../catalog/publication.ts";
import { id, invalid } from "../catalog/validation.ts";
import { hasCartStock } from "../checkout/carts.ts";
import { cartUnits, initialCartIntent, mutateBrowserCart, readBrowserCart } from "../storefront/cart.ts";

export type ReorderState = { phase: 'idle' | 'error' | 'partial'; message: string; skipped: { name: string; reason: string }[] };
export type ReorderResult = { state: ReorderState; cookies: string[]; added: number; unknown: boolean };

export function reorderFormInput(data: FormData) {
  for (const key of data.keys()) if (key !== "order_id" && !key.startsWith("$ACTION_")) throw invalid();
  if (data.getAll("order_id").length !== 1) throw invalid();
  return id(data.get("order_id"));
}

// The workspace's verified guest-order link grants the same read/reorder ownership
// as owner_user_id. Never accept a user, publication, quantity or price from the form.
export async function reorderAccountOrder(request: Request, identity: LocalAuth, orderId: string): Promise<ReorderResult> {
  const result: ReorderResult = { state: { phase: "error", message: "Pesanan belum dapat dibeli lagi.", skipped: [] }, cookies: [], added: 0, unknown: false };
  try {
    assertOrigin(request);
    const principal = await getPrincipal(request, identity);
    const lines = await identity.sql.begin(async tx => {
      const [owned] = await tx`select o.id from app.commerce_order o where o.id = ${id(orderId)} and
        (o.owner_user_id = ${principal.id} or exists (select 1 from app.buyer_identity_challenge c
          where c.user_id = ${principal.id} and c.kind = 'guest_order_link' and c.status = 'verified' and c.order_id = o.id))`;
      if (!owned) throw new AccessError(404, "NOT_FOUND");
      return tx<{ product_id: string; offer_id: string; quantity: number; name: string }[]>`
        select product_id, offer_id, quantity, snapshot->>'name' as name from app.order_item where order_id = ${orderId} order by line_id
      `;
    });
    const headers = new Headers(request.headers);
    const cartRequest = () => new Request(request.url, { method: "POST", headers });
    const current = await readBrowserCart(cartRequest(), identity);
    if (current.kind === "unavailable") throw new Error("Cart outcome unavailable");
    if (current.kind === "denied" && current.code !== "NOT_FOUND") {
      result.state.message = "Keranjang belum dapat dibuka. Periksa keranjang sebelum mencoba lagi."; return result;
    }
    const open = current.kind === "ready" && current.cart.state === "open" && Date.parse(current.cart.expires_at) > Date.parse(current.now) ? current : null;
    let cart = open?.cart.id ?? "", version = open ? String(open.cart.version) : "", count = open ? cartUnits(open.cart) : 0;
    const quantities = new Map(open?.cart.lines.map(l => [l.variant_id, l.quantity]) ?? []);
    const generation = randomUUID();
    for (const [index, line] of lines.entries()) {
      const quantity = Math.min(line.quantity, 50 - count);
      if (quantity < 1) { result.state.skipped.push({ name: line.name, reason: "Keranjang sudah mencapai batas 50 pilihan." }); continue; }
      const available = await identity.sql.begin(async tx => {
        const publication = await salePublication(tx, line.product_id, new Date().toISOString());
        if (!publication?.draft.variants.some(v => v.id === line.offer_id && !v.retired)) return { reason: "Pilihan ini sudah tidak dijual." };
        if (!await hasCartStock(tx, { product_id: line.product_id, product_revision: publication.product_revision, offer_id: line.offer_id, quantity: quantity + (quantities.get(line.offer_id) ?? 0) }, open?.namespace ?? null)) return { reason: "Stok pilihan ini tidak mencukupi." };
        return { publication: publication.publication_id };
      });
      if (!available.publication) { result.state.skipped.push({ name: line.name, reason: available.reason ?? "Pilihan ini tidak tersedia." }); continue; }
      const reply = await mutateBrowserCart(cartRequest(), identity, initialCartIntent({ product: line.product_id, variant: line.offer_id, publication: available.publication, quantity: String(quantity), cart, version, generation }));
      result.cookies.push(...reply.cookies); applySetCookies(headers, reply.cookies);
      if (reply.state.phase === "unknown") throw new Error("Cart mutation outcome unknown");
      if (reply.state.phase !== "success") {
        result.state.skipped.push({ name: line.name, reason: reply.state.message });
        if (!["OFFER_UNAVAILABLE", "PUBLICATION_REVIEW_REQUIRED", "NOT_FOUND"].includes(reply.state.code ?? "")) {
          // The cart refused further changes (e.g. a version conflict from another tab): report the rest, never drop it.
          for (const rest of lines.slice(index + 1)) result.state.skipped.push({ name: rest.name, reason: "Belum diproses. Periksa keranjang, lalu coba lagi." });
          break;
        }
        cart = reply.state.intent.cart; version = reply.state.intent.version;
        if (reply.state.count !== null) count = reply.state.count;
        continue;
      }
      result.added += quantity; count = reply.state.count ?? count + quantity;
      quantities.set(line.offer_id, quantity + (quantities.get(line.offer_id) ?? 0));
      cart = reply.state.intent.cart; version = reply.state.intent.version;
      if (quantity < line.quantity) result.state.skipped.push({ name: line.name, reason: "Jumlah dibatasi agar keranjang tidak melebihi 50 pilihan." });
    }
    result.state.phase = result.added ? "partial" : "error";
    result.state.message = result.added ? "Pilihan yang tersedia sudah ditambahkan. Periksa keranjang Anda." : "Tidak ada pilihan yang dapat ditambahkan ke keranjang.";
    return result;
  } catch (error) {
    if (error instanceof AccessError && error.status < 500) {
      result.state.message = error.status === 401 ? "Masuk terlebih dahulu untuk membeli lagi." : error.status === 404 ? "Pesanan tidak ditemukan di akun ini." : "Pesanan belum dapat dibeli lagi. Muat ulang halaman dan coba kembali.";
    } else { result.unknown = true; result.state.message = "Hasil tindakan belum diketahui. Periksa keranjang sebelum mencoba lagi."; }
    return result;
  }
}
