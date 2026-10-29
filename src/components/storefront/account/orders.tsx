"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { reorderOrder } from "@/app/(storefront)/akun/actions";
import type { AccountOrder } from "@/modules/accounts/order-summary";
import type { ReorderState } from "@/modules/accounts/reorder";
import { rupiah } from "@/modules/storefront/format";
import { Icon } from "../ui/icon";
import { CatalogImage } from "../ui/media";
import { accountOrderDate, countAccountOrders, filterAccountOrders, ORDER_FILTERS, type OrderFilter } from "./order-filters";

const initialReorder: ReorderState = { phase: "idle", message: "", skipped: [] };
// Status reads from shape and text, not colour alone: one outline icon per stage before the label.
const STAGE_ICON: Record<AccountOrder["stage"], "clock" | "info" | "truck" | "check" | "close"> = {
	unpaid: "clock",
	processing: "info",
	shipped: "truck",
	delivered: "check",
	closed: "close",
};

function OrderCard({ order }: { order: AccountOrder }) {
	const submitting = useRef(false);
	const [state, action, pending] = useActionState(async (previous: ReorderState, data: FormData) => {
		try {
			return await reorderOrder(previous, data);
		} finally {
			submitting.current = false;
		}
	}, initialReorder);
	const messageId = `reorder-message-${order.id}`;
	return (
		<li className="account-order" data-testid={`buyer-order-row-${order.id}`}>
			<div className="account-order-top">
				<div>
					<h3 className="account-order-number">{order.number}</h3>
					<time className="account-meta" dateTime={order.created_at}>{accountOrderDate(order.created_at)}</time>
				</div>
				<span className="account-order-badge" data-stage={order.stage}><Icon name={STAGE_ICON[order.stage]} size={16} />{order.stage_label}</span>
			</div>
			{order.detail && <p className="account-order-detail">{order.detail}</p>}
			<ul className="account-order-items" aria-label="Isi pesanan">
				{order.items.slice(0, 4).map((item, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: Frozen order lines have no public ID and never change position.
					<li className="account-order-item" key={`${index}-${item.name}-${item.variant_label}`}>
						{item.thumbnail ? (
							<CatalogImage className="account-order-photo" src={item.thumbnail.url} width={item.thumbnail.width} height={item.thumbnail.height} sizes="64px" max={128} loading="lazy" alt={`${item.name}, ${item.variant_label}, ${item.quantity} pilihan lengkap`} />
						) : (
							<span className="account-order-photo account-order-placeholder" role="img" aria-label={`${item.name}, ${item.variant_label}, ${item.quantity} pilihan lengkap`}><Icon name="cart" /></span>
						)}
					</li>
				))}
				{order.items.length > 4 && <li className="account-order-overflow" aria-label={`${order.items.length - 4} produk lainnya`}>+{order.items.length - 4}</li>}
			</ul>
			<div className="account-order-bottom">
				<p className="account-order-total"><span className="account-meta">{order.units} pilihan lengkap · {order.payment_label}</span><strong>{rupiah(order.buyer_total)}</strong></p>
				<div className="account-actions">
					<Link className="button button-secondary" href={`/pesanan/${order.id}`}>Lihat pesanan</Link>
					{order.can_reorder && (
						<form action={action} className="account-reorder-form" onSubmit={(event) => {
							if (submitting.current || pending) event.preventDefault();
							else submitting.current = true;
						}}>
							<input type="hidden" name="order_id" value={order.id} />
							<button className="button" type="submit" disabled={pending} aria-describedby={state.message ? messageId : undefined} aria-label={`Beli lagi pesanan ${order.number}`}>{pending ? "Menambahkan…" : "Beli lagi"}</button>
						</form>
					)}
				</div>
			</div>
			{state.message && <div className="account-reorder-message" id={messageId} role="alert"><p>{state.message}</p>{state.skipped.length > 0 && <ul>{state.skipped.map((item) => <li key={`${item.name}-${item.reason}`}>{item.name}: {item.reason}</li>)}</ul>}{state.phase === "partial" && <Link href="/keranjang">Buka keranjang</Link>}</div>}
		</li>
	);
}

export function AccountOrders({ orders }: { orders: AccountOrder[] }) {
	const [filter, setFilter] = useState<OrderFilter>("all");
	const [query, setQuery] = useState("");
	const counts = countAccountOrders(orders);
	const visible = filterAccountOrders(orders, filter, query);
	const activeLabel = ORDER_FILTERS.find((item) => item.value === filter)?.label;
	return (
		<section id="account-orders-heading" className="account-section" aria-labelledby="account-orders-title" data-testid="account-orders-section">
			<h2 id="account-orders-title">Riwayat pesanan</h2>
			{orders.length === 0 ? (
				<div className="account-empty"><p>Belum ada pesanan di akun ini.</p><Link className="button" href="/">Lihat produk</Link></div>
			) : (
				<>
					<fieldset className="account-filter-rail">
						<legend className="sr-only">Filter status pesanan</legend>
						{ORDER_FILTERS.map((item) => <button className="account-chip" type="button" key={item.value} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label} <span>({counts[item.value]})</span></button>)}
					</fieldset>
					<label className="account-search" htmlFor="account-order-search">Cari nomor pesanan<input id="account-order-search" type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Contoh: 99-AB12CD34" autoComplete="off" /></label>
					<p className="account-meta" role="status" aria-live="polite" aria-atomic="true">{activeLabel}: {visible.length} pesanan{query.trim() ? ` untuk “${query.trim()}”` : ""}.</p>
					{visible.length > 0 ? <ul className="account-order-list" data-testid="buyer-orders-list">{visible.map((order) => <OrderCard key={order.id} order={order} />)}</ul> : <div className="account-empty"><p>Tidak ada pesanan yang cocok dengan filter ini.</p><button className="button button-secondary" type="button" onClick={() => { setFilter("all"); setQuery(""); }}>Hapus filter</button></div>}
				</>
			)}
		</section>
	);
}
