import Link from "next/link";
import type { BuyerReturnList, BuyerReturnSummary } from "@/modules/accounts/returns";
import { rupiah } from "@/modules/storefront/format";

// Buyer words for the case states (the per-state sentence comes from the server as `explanation`).
export const RETURN_STATUS_LABEL: Record<string, string> = {
	requested: "Diajukan",
	reviewing: "Diperiksa",
	approved: "Disetujui",
	rejected: "Belum disetujui",
	awaiting_goods: "Menunggu barang",
	inspecting: "Barang diperiksa",
	refunding: "Dana diproses",
	replacing: "Penggantian disiapkan",
	resolved: "Selesai",
};
const RESOLUTION_LABEL: Record<string, string> = { refund: "Pengembalian dana", replacement: "Penggantian barang" };
const date = (value: string) => new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeZone: "Asia/Jakarta" }).format(new Date(value));

function ReturnCard({ item }: { item: BuyerReturnSummary }) {
	return (
		<li className="account-return" data-testid={`buyer-return-row-${item.id}`}>
			<div className="account-order-top">
				<div>
					<h3 className="account-order-number">Pesanan {item.order_number}</h3>
					<time className="account-meta" dateTime={item.created_at}>Diajukan {date(item.created_at)}</time>
				</div>
				<span className="account-order-badge" data-stage={item.status === "resolved" ? "delivered" : item.status === "rejected" ? "closed" : "processing"}>{RETURN_STATUS_LABEL[item.status] ?? item.status}</span>
			</div>
			<p className="account-meta">{RESOLUTION_LABEL[item.requested_resolution] ?? "Retur"} · {item.items.length} barang{item.product_names.length ? `: ${item.product_names.join(", ")}` : ""}</p>
			<p className="account-order-detail">{item.explanation}</p>
			{item.refund_amount !== undefined && <p className="account-meta">Dana dikembalikan: <strong>{rupiah(item.refund_amount)}</strong></p>}
			<div className="account-actions">
				<Link className="button button-secondary" href={`/pesanan/${item.order_id}`}>Lihat pesanan</Link>
			</div>
		</li>
	);
}

export function AccountReturns({ returns, paged = false }: { returns: BuyerReturnList | null; paged?: boolean }) {
	return (
		<section className="account-section" aria-labelledby="account-returns-title" data-testid="account-returns-section">
			<h2 id="account-returns-title">Pengembalian dan penggantian</h2>
			{returns === null ? (
				<p className="checkout-hint">Daftar pengembalian gagal dimuat. Muat ulang halaman untuk mencoba lagi.</p>
			) : returns.data.length === 0 && !paged ? (
				<div className="account-empty">
					<p>Belum ada pengajuan pengembalian atau penggantian.</p>
					<Link className="button button-secondary" href="/akun/pesanan">Buka pesanan</Link>
				</div>
			) : (
				<>
					<ul className="account-order-list" data-testid="buyer-returns-list">{returns.data.map((item) => <ReturnCard key={item.id} item={item} />)}</ul>
					{returns.pagination.next_cursor && (
						<p><Link className="button button-secondary" href={`/akun/pengembalian?kursor=${returns.pagination.next_cursor}`} data-testid="buyer-returns-more">Muat lebih banyak</Link></p>
					)}
					{paged && <p><Link className="button button-secondary" href="/akun/pengembalian">Kembali ke pengajuan terbaru</Link></p>}
				</>
			)}
			<p className="checkout-hint">Butuh bantuan untuk pengajuan ini? <Link href="/bantuan">Hubungi kami</Link>.</p>
		</section>
	);
}
