import Link from "next/link";
import { redirect } from "next/navigation";
import {
	CheckoutFrame,
	CheckoutHelp,
} from "../../../../components/storefront/checkout-frame";
import { Icon } from "../../../../components/storefront/icon";
import {
	OrderReceiptCopyCode,
	OrderReceiptObserver,
	OrderReceiptPaymentForm,
	OrderReceiptSummary,
} from "../../../../components/storefront/order-receipt";
import { getLocalAuth } from "../../../../modules/access/auth";
import { id } from "../../../../modules/catalog/validation";
import {
	type OrderReceipt,
	orderReceiptPath,
	type ReceiptCollection,
	type ReceiptRefund,
	readOrderContinuityExtras,
	readOrderReceipt,
} from "../../../../modules/orders/receipt";
import { storefrontRequest } from "../../../../modules/storefront/browser";
import { initialCheckoutPayment } from "../../../../modules/storefront/checkout-order";
import { rupiah } from "../../../../modules/storefront/format";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Tanda terima & status pesanan",
	robots: { index: false, follow: false },
	referrer: "same-origin" as const,
};

const wibFormat = new Intl.DateTimeFormat("id-ID", {
	timeZone: "Asia/Jakarta",
	dateStyle: "medium",
	timeStyle: "short",
});
const formatWib = (iso: string) => wibFormat.format(new Date(iso));
const formatWibNode = (iso: string) => {
	const [d, t] = formatWib(iso).split(", ");
	return t ? (
		<>
			{d}, <span className="receipt-nowrap">{t} WIB</span>
		</>
	) : (
		<span className="receipt-nowrap">{d} WIB</span>
	);
};

// DEC-007 delivery tracking of a manually booked parcel (courier feed or audited operator record).
const TRACKING_STATUS_LABELS: Record<string, string> = {
	picked_up: "Diambil kurir",
	in_transit: "Dalam perjalanan",
	delivered: "Terkirim",
	failed: "Pengantaran gagal, kurir akan mencoba lagi",
};

function offerKindLabel(kind: string) {
	return kind === "multipack"
		? "Multipack"
		: kind === "bundle"
			? "Bundel"
			: "Satuan";
}

function collectionStatusLabel(
	status: ReceiptCollection["status"],
	parcelStatus?: string,
) {
	if (status === "verified") return "Sudah dibayar ke kurir";
	if (status === "unknown") return "Sedang direkonsiliasi";
	if (status === "refunded") return "Telah dikembalikan";
	if (
		parcelStatus === "failed" ||
		parcelStatus === "returned" ||
		parcelStatus === "cancelled"
	)
		return "Ditolak atau dibatalkan";
	return "Menunggu pembayaran ke kurir";
}

function refundStatusLabel(status: ReceiptRefund["status"]) {
	return status === "succeeded"
		? "Terkonfirmasi"
		: status === "awaiting_destination"
			? "Menunggu verifikasi tujuan"
			: status === "pending"
				? "Sedang diproses"
				: status === "unknown"
					? "Sedang diperiksa"
					: "Perlu pemeriksaan keuangan";
}

function parcelStatusLabel(status: string) {
	const labels: Record<string, string> = {
		unbooked: "Menunggu giliran gudang",
		ready: "Siap disiapkan gudang",
		picking: "Sedang disiapkan gudang",
		packed: "Sudah dikemas",
		booking_pending: "Menunggu nomor resi kurir",
		booking_unknown: "Penerbitan resi sedang diperiksa",
		booking_failed: "Penerbitan resi tertunda",
		booking_cancellation_pending: "Pembatalan resi sedang diproses",
		booking_cancelled: "Resi dibatalkan",
		booked: "Resi pengiriman diterbitkan",
		handed_over: "Diserahkan ke kurir",
		in_transit: "Dalam pengiriman kurir",
		partially_delivered: "Sebagian unit diterima",
		delivered: "Diterima lengkap",
		failed: "Pengiriman terkendala",
		returned: "Dikembalikan ke gudang",
		cancelled: "Pengiriman dibatalkan",
		awaiting_stock: "Menunggu stok pengganti",
	};
	return labels[status] ?? "Status sedang diperbarui";
}

function parcelTone(
	status: string,
	orderCancelled: boolean,
): "neutral" | "active" | "warning" | "error" {
	if (
		orderCancelled ||
		status === "cancelled" ||
		status === "booking_cancelled"
	)
		return "neutral";
	if (status === "delivered") return "active";
	if (
		[
			"booking_unknown",
			"booking_failed",
			"booking_cancellation_pending",
			"partially_delivered",
			"awaiting_stock",
		].includes(status)
	)
		return "warning";
	if (["failed", "returned"].includes(status)) return "error";
	return "neutral";
}

type StepState = "done" | "current" | "pending" | "cancelled";

function parcelTimeline(
	parcel: OrderReceipt["order"]["shipments"][number],
	orderCancelled: boolean,
	codVerified: boolean,
	awaitingPrepaid: boolean,
	orderCreatedAt: string,
	issuedAt: string | null,
	handedOverAt: string | null,
	deliveredAt: string | null,
): { label: string; detail: string; state: StepState; tag: string | null }[] {
	const s = codVerified && !orderCancelled ? "delivered" : parcel.status;
	const cancelled =
		s === "cancelled" || s === "booking_cancelled" || orderCancelled;
	const warehouseDone = [
		"packed",
		"booked",
		"handed_over",
		"in_transit",
		"partially_delivered",
		"delivered",
	].includes(s);
	const warehouseActive = [
		"ready",
		"picking",
		"booking_pending",
		"booking_unknown",
		"booking_failed",
		"awaiting_stock",
	].includes(s);
	const carrierDone = [
		"handed_over",
		"in_transit",
		"partially_delivered",
		"delivered",
	].includes(s);
	const delivered = s === "delivered";
	const totalUnits = parcel.items.reduce((n, i) => n + i.quantity, 0);
	const activeUnits = parcel.items
		.filter((i) => !i.cancelled)
		.reduce((n, i) => n + i.quantity, 0);
	const receivedUnits =
		codVerified && parcel.received_quantity === 0
			? activeUnits || totalUnits
			: parcel.received_quantity;
	const courierLabel = `${parcel.courier_name ?? "Kurir simulasi"} (${parcel.service_name ?? "Layanan pengiriman"})`;
	const step2Time = issuedAt ?? orderCreatedAt;
	const step3Time = handedOverAt ?? issuedAt ?? deliveredAt ?? orderCreatedAt;
	const step4Time = deliveredAt ?? handedOverAt ?? issuedAt ?? orderCreatedAt;
	const step2State: StepState = cancelled
		? "cancelled"
		: warehouseDone
			? "done"
			: awaitingPrepaid
				? "pending"
				: "current";
	const step3State: StepState = cancelled
		? "cancelled"
		: delivered
			? "done"
			: carrierDone
				? "current"
				: "pending";
	const step4State: StepState = cancelled
		? "cancelled"
		: delivered
			? "done"
			: receivedUnits > 0
				? "current"
				: "pending";
	if (cancelled) {
		return [
			{
				label: "Pesanan tercatat",
				detail: `${formatWib(orderCreatedAt)} WIB`,
				state: "done",
				tag: null,
			},
			{
				label: "Penyiapan gudang dihentikan",
				detail:
					"Tidak dijadwalkan ke kurir karena batas waktu pembayaran berakhir",
				state: "cancelled",
				tag: null,
			},
		];
	}
	if (!warehouseDone && !carrierDone && !delivered && receivedUnits === 0) {
		return [
			{
				label: "Pesanan tercatat",
				detail: `${formatWib(orderCreatedAt)} WIB`,
				state: "done",
				tag: null,
			},
			{
				label: "Menunggu resi & pengiriman kurir",
				detail: awaitingPrepaid
					? "Menunggu konfirmasi pembayaran sebelum penyiapan gudang"
					: warehouseActive
						? `${parcelStatusLabel(s)} · resi muncul setelah diserahkan ke kurir`
						: "Disiapkan di gudang asal · resi muncul setelah diserahkan ke kurir",
				state: step2State,
				tag: null,
			},
		];
	}
	return [
		{
			label: "Pesanan tercatat",
			detail: `${formatWib(orderCreatedAt)} WIB`,
			state: "done",
			tag: null,
		},
		{
			label: "Penyiapan & resi gudang",
			detail: warehouseDone
				? `${formatWib(step2Time)} WIB · Dikemas & resi diterbitkan`
				: awaitingPrepaid
					? "Menunggu konfirmasi pembayaran · resi menyusul"
					: warehouseActive
						? `${parcelStatusLabel(s)} · resi menyusul`
						: "Menunggu giliran gudang · resi menyusul",
			state: step2State,
			tag: warehouseDone
				? null
				: awaitingPrepaid
					? "Belum dibayar"
					: "Saat ini",
		},
		{
			label: "Pengiriman kurir",
			detail: delivered
				? `${formatWib(step3Time)} WIB · Diserahkan ke ${courierLabel}`
				: carrierDone
					? `${formatWib(step3Time)} WIB · Paket bersama ${courierLabel}`
					: "Menunggu serah terima kurir",
			state: step3State,
			tag: carrierDone && !delivered ? "Saat ini" : null,
		},
		{
			label: "Penerimaan paket",
			detail: delivered
				? `${formatWib(step4Time)} WIB · Diterima lengkap (${receivedUnits} unit)${codVerified ? " · COD dibayar ke kurir" : ""}`
				: receivedUnits > 0
					? `Diterima ${receivedUnits} dari ${activeUnits || totalUnits} unit`
					: "Menunggu paket tiba",
			state: step4State,
			tag: receivedUnits > 0 && !delivered ? "Saat ini" : null,
		},
	];
}

function renderSummaryItem(item: OrderReceipt["order"]["items"][number]) {
	const contents = item.contents as {
		stock_item_id: string;
		name: string;
		quantity: number;
	}[];
	const kindLabel = offerKindLabel(item.offer_kind);
	const metaPrefix =
		item.variant_label.trim().toLowerCase() === kindLabel.toLowerCase()
			? item.variant_label
			: `${item.variant_label} · ${kindLabel}`;
	const showContents = kindLabel !== "Satuan" || contents.length > 1;
	return (
		<li key={item.id}>
			<div className="checkout-summary-parent">
				<strong>{item.name}</strong>
				<strong>{rupiah(item.subtotal)}</strong>
			</div>
			<span>
				{metaPrefix} ·{" "}
				<span className="receipt-nowrap">
					{item.quantity} × {rupiah(item.unit_price)}
				</span>
			</span>
			{(item.cancelled_quantity > 0 ||
				item.returned_quantity > 0 ||
				item.refunded_quantity > 0 ||
				item.return_pending_quantity > 0 ||
				item.received_quantity > 0) && (
				<p className="checkout-hint">
					Unit: {item.received_quantity} diterima
					{item.cancelled_quantity > 0
						? ` · ${item.cancelled_quantity} dibatalkan`
						: ""}
					{item.return_pending_quantity > 0
						? ` · ${item.return_pending_quantity} retur berjalan`
						: ""}
					{item.returned_quantity > 0
						? ` · ${item.returned_quantity} diretur`
						: ""}
					{item.refunded_quantity > 0
						? ` · ${item.refunded_quantity} dana kembali`
						: ""}
				</p>
			)}
			{showContents && (
				<>
					<p className="checkout-content-label">Isi pilihan ({kindLabel})</p>
					<ul className="checkout-contents">
						{contents.map((c) => (
							<li key={c.stock_item_id}>
								{c.quantity} × {c.name}
							</li>
						))}
					</ul>
				</>
			)}
		</li>
	);
}

export default async function OrderReceiptPage({
	params,
}: {
	params: Promise<{ orderId: string }>;
}) {
	let orderId: string;
	try {
		orderId = id((await params).orderId);
	} catch {
		redirect("/404");
	}
	const path = orderReceiptPath(orderId),
		view = await readOrderReceipt(
			await storefrontRequest("GET", path),
			getLocalAuth(),
			orderId,
		);
	if (view.kind !== "ready") {
		return (
			<CheckoutFrame back="catalog" payment>
				<section className="checkout-recovery">
					<h1>
						{view.kind === "unavailable"
							? "Tanda terima belum dapat dimuat"
							: "Akses pesanan perlu diperiksa"}
					</h1>
					<p>
						{view.kind === "unavailable"
							? "Data tanda terima belum tersedia saat ini. Muat ulang halaman untuk memeriksa status yang tersimpan."
							: "Tanda terima pesanan bersifat pribadi dan hanya terbuka melalui sesi pemilik atau akses tamu yang sah. Nomor pesanan saja tidak membuka rincian."}
					</p>
					{view.kind === "denied" ? (
						<OrderReceiptPaymentForm
							initial={initialCheckoutPayment(orderId)}
							recover
						/>
					) : (
						<a className="button" href={path}>
							Muat ulang tanda terima
						</a>
					)}
					<Link className="detail-help" href="/keranjang">
						Periksa sesi belanja
					</Link>
					<CheckoutHelp
						context={view.kind === "denied" ? "receipt-recovery" : "receipt"}
					/>
				</section>
			</CheckoutFrame>
		);
	}
	const extras = await readOrderContinuityExtras(getLocalAuth(), orderId);
	const { receipt, attempt, attemptUnavailable, shouldObserve } = view,
		{ order, collections, refunds, ship_to, payment_state } = receipt;
	const cod = order.payment_method === "cod",
		paid =
			payment_state === "confirmed" || payment_state === "partially_refunded",
		refunded = payment_state === "refunded",
		partialCod = cod && order.payment_status === "partially_collected",
		unknown = payment_state === "unknown";
	const closed = order.status === "cancelled",
		expired =
			!cod &&
			!paid &&
			!refunded &&
			(payment_state === "expired" ||
				closed ||
				Date.parse(order.expires_at) <= Date.parse(receipt.as_of) ||
				(attempt?.status === "expired" && order.status !== "pending"));
	const awaitingPrepaid = !cod && !paid && !refunded && !closed && !expired;
	const failed =
		awaitingPrepaid &&
		(payment_state === "failed" || attempt?.status === "failed");
	const canPrepare =
		awaitingPrepaid &&
		!unknown &&
		!attemptUnavailable &&
		order.status === "pending" &&
		(!attempt || attempt.status === "failed" || attempt.status === "expired");
	const hasRefusedCod =
		cod &&
		(payment_state === "failed" ||
			order.shipments.some(
				(s) => s.status === "failed" || s.status === "returned",
			));
	const originalParcels = order.shipments.filter((s) => s.kind === "original");
	const title = refunded
		? "Pengembalian dana selesai"
		: paid
			? cod
				? "Pembayaran COD selesai"
				: "Pembayaran terkonfirmasi"
			: partialCod
				? "Sebagian paket COD tertagih"
				: unknown
					? cod
						? "Status penagihan COD sedang diperiksa"
						: "Status pembayaran sedang diperiksa"
					: expired || closed
						? "Pesanan tidak lagi aktif"
						: failed
							? "Percobaan pembayaran gagal"
							: hasRefusedCod
								? "Pengantaran COD memerlukan pemeriksaan"
								: cod
									? "Pesanan COD dikonfirmasi"
									: "Menunggu pembayaran";
	const bannerPhase =
		paid || refunded
			? "success"
			: expired || closed
				? "closed"
				: unknown || hasRefusedCod
					? "unknown"
					: failed
						? "error"
						: "pending";
	const bannerMessage = refunded
		? "Pengembalian dana untuk pesanan ini telah dikonfirmasi."
		: paid
			? cod
				? `Seluruh pembayaran COD untuk ${originalParcels.length} paket telah diterima kurir.`
				: "Status pengiriman mengikuti perkembangan setiap paket di bawah."
			: partialCod
				? "Sebagian paket COD telah dibayar; sisanya ditagihkan kurir saat paket diserahkan."
				: unknown
					? cod
						? "Hasil penagihan kurir sedang direkonsiliasi. Perbarui status pada halaman ini tanpa membuat pesanan baru."
						: "Status pembayaran sedang kami pastikan agar tidak terjadi tagihan ganda. Gunakan Perbarui status pada pesanan yang sama; jangan membuat pesanan baru."
					: expired || closed
						? expired
							? "Batas waktu pembayaran telah berakhir dan reservasi pesanan telah dilepas."
							: "Pesanan ini telah ditutup dan tidak lagi diproses."
						: failed
							? "Selama batas waktu pesanan masih berlaku, Anda dapat menyiapkan instruksi pembayaran baru di bawah tanpa membuat pesanan ganda."
							: hasRefusedCod
								? "Salah satu paket COD tercatat ditolak saat pengantaran. Periksa rincian per paket di bawah."
								: cod
									? `Belum dibayar. Anda memilih COD untuk ${originalParcels.length} paket.`
									: "Pesanan dan stok sudah dicadangkan. Selesaikan pembayaran sebelum batas waktu berakhir.";
	const showStatusBanner =
		!cod || unknown || hasRefusedCod || closed || expired;
	const totalUnits = order.items.reduce((sum, i) => sum + i.quantity, 0);
	const verifiedCollections = collections.filter(
		(c) => c.status === "verified",
	);
	const verifiedCollected = verifiedCollections.reduce(
		(sum, c) => sum + c.merchandise_amount + c.shipping_and_fees_amount,
		0,
	);
	const uncollectedCodParcels = collections.filter(
		(c) =>
			c.status !== "verified" &&
			c.status !== "refunded" &&
			c.merchandise_amount + c.shipping_and_fees_amount > 0 &&
			!closed &&
			!expired,
	).length;
	const remainingCod = Math.max(0, order.amount_due - verifiedCollected);
	const itemMap = new Map(order.items.map((i) => [i.id, i]));
	const displayItems = [...order.items].sort(
		(a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name, "id"),
	);
	const inlineItems = displayItems.slice(0, 2),
		extraItems = displayItems.slice(2),
		extraUnits = extraItems.reduce((sum, i) => sum + i.quantity, 0);
	const deliveredParcelCount = order.shipments.filter(
		(s) =>
			s.status === "delivered" ||
			(cod &&
				collections.some(
					(c) => c.shipment_id === s.id && c.status === "verified",
				)),
	).length;
	const showReturnsSection =
		refunds.length > 0 ||
		order.refund_total > 0 ||
		order.pending_refund_total > 0 ||
		deliveredParcelCount > 0 ||
		order.items.some(
			(i) =>
				i.returned_quantity > 0 ||
				i.return_pending_quantity > 0 ||
				i.received_quantity > 0,
		);
	const summarySubtitle = `${totalUnits} pilihan · ${originalParcels.length} paket · ${cod ? "COD" : paid ? "Lunas" : "Prabayar"}`;
	const helpContext =
		closed || expired
			? "receipt-expired"
			: cod
				? "receipt-cod"
				: paid || refunded
					? "receipt-paid"
					: "receipt-prepaid";
	return (
		<CheckoutFrame back="catalog">
			{shouldObserve && <OrderReceiptObserver orderId={order.id} />}
			<div className="receipt-shell">
				<header className="receipt-header">
					<p className="checkout-order-reference">
						<span>
							Pesanan <strong>{order.number}</strong>
						</span>
						<span>Diperiksa {formatWibNode(receipt.last_checked_at)}</span>
					</p>
					<h1>{title}</h1>
					{!showStatusBanner && <p className="receipt-lead">{bannerMessage}</p>}
				</header>
				<div className="receipt-layout">
					<div className="receipt-primary">
						<section
							className="receipt-status-card"
							aria-label="Status pembayaran dan langkah berikutnya"
						>
							{showStatusBanner && (
								<div
									className="checkout-payment-status"
									data-phase={bannerPhase}
									role={failed || unknown || hasRefusedCod ? "alert" : "status"}
								>
									{bannerPhase === "success" ? (
										<Icon name="check" />
									) : bannerPhase === "pending" ? (
										<svg
											aria-hidden="true"
											focusable="false"
											width="20"
											height="20"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<circle cx="12" cy="12" r="10" />
											<path d="M12 6v6l4 2" />
										</svg>
									) : bannerPhase === "unknown" ? (
										<svg
											aria-hidden="true"
											focusable="false"
											width="20"
											height="20"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<circle cx="12" cy="12" r="10" />
											<path d="M12 16v-4m0-4h.01" />
										</svg>
									) : bannerPhase === "closed" ? (
										<svg
											aria-hidden="true"
											focusable="false"
											width="20"
											height="20"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<circle cx="12" cy="12" r="10" />
											<path d="M8 12h8" />
										</svg>
									) : (
										<Icon name="alert" />
									)}
									<p>{bannerMessage}</p>
								</div>
							)}
							{cod ? (
								<div
									className="receipt-cod-panel"
									data-settled={remainingCod === 0}
								>
									<div className="receipt-cod-hero">
										<span>
											{uncollectedCodParcels > 0
												? "Total yang perlu disiapkan"
												: "Total COD sudah dibayar"}
										</span>
										<strong className="receipt-cod-figure">
											{rupiah(
												uncollectedCodParcels > 0
													? remainingCod
													: verifiedCollected,
											)}
										</strong>
										<small>
											{uncollectedCodParcels > 0 ? (
												verifiedCollected > 0 ? (
													<>
														<span>
															Sisa tagihan kurir ({uncollectedCodParcels} paket)
														</span>
														<span className="receipt-nowrap">
															Sudah dibayar ke kurir {rupiah(verifiedCollected)}
														</span>
													</>
												) : (
													<span>
														Sisa tagihan kurir ({uncollectedCodParcels} paket) ·
														Bayar tunai saat paket diterima
													</span>
												)
											) : (
												<span className="receipt-nowrap">
													Sisa tagihan kurir · {rupiah(remainingCod)}
												</span>
											)}
										</small>
									</div>
									<dl className="checkout-charges receipt-cod-summary">
										{originalParcels.map((p, i) => {
											const c = collections.find((x) => x.shipment_id === p.id);
											const collected = c?.status === "verified";
											const hideCollectedAmount =
												collected && uncollectedCodParcels > 0;
											return (
												<div key={p.id} data-collected={collected}>
													<dt>
														<span>
															Paket {i + 1}{" "}
															<span className="receipt-nowrap">
																· {p.origin_city}
															</span>
														</span>
														{collected && (
															<small>
																Sudah dibayar ke kurir
																{c?.occurred_at ? (
																	<> · {formatWibNode(c.occurred_at)}</>
																) : null}
															</small>
														)}
													</dt>
													{!hideCollectedAmount && (
														<dd>{rupiah(p.cod_collect_amount ?? 0)}</dd>
													)}
												</div>
											);
										})}
									</dl>
								</div>
							) : (
								<div className="receipt-prepaid-panel">
									<dl className="checkout-charges receipt-cod-summary">
										<div>
											<dt>Metode pembayaran</dt>
											<dd>{order.payment_channel_label}</dd>
										</div>
										<div
											className={`checkout-total${!closed && !expired ? " receipt-desktop-total" : ""}`}
										>
											<dt>
												{paid
													? "Total dibayar"
													: expired || closed
														? "Total pesanan (tidak ditagihkan)"
														: "Total pesanan"}
											</dt>
											<dd>{rupiah(order.amount_due)}</dd>
										</div>
									</dl>
									{!paid && !refunded && !closed && !expired && (
										<p className="checkout-hint">
											Batas pembayaran: {formatWib(order.expires_at)} WIB.
										</p>
									)}
									{attemptUnavailable ? (
										<p role="alert" className="checkout-field-error">
											<Icon name="alert" />
											<span>
												Instruksi pembayaran belum dapat diperiksa. Perbarui
												status sebelum mencoba lagi.
											</span>
										</p>
									) : !paid &&
										!refunded &&
										!closed &&
										!expired &&
										attempt?.status !== "unknown" &&
										attempt?.action.kind === "instructions" ? (
										<section className="checkout-payment-instructions">
											<h2>Instruksi pembayaran</h2>
											<dl className="checkout-charges receipt-instruction-meta">
												<div>
													<dt>Nominal pembayaran</dt>
													<dd>
														<strong>{rupiah(order.amount_due)}</strong>
													</dd>
												</div>
												<div className="receipt-instruction-code-block">
													<dt>Kode referensi</dt>
													<dd>
														<OrderReceiptCopyCode
															label="kode referensi"
															code={attempt.id.slice(0, 8).toUpperCase()}
														/>
													</dd>
												</div>
												{attempt.expires_at !== order.expires_at && (
													<div>
														<dt>Batas instruksi</dt>
														<dd>{formatWib(attempt.expires_at)} WIB</dd>
													</div>
												)}
											</dl>
											<p>{attempt.action.display_text}</p>
											<p className="checkout-hint">
												Gunakan kode referensi di atas untuk menyelesaikan
												pembayaran sebelum batas waktu, lalu pilih Perbarui
												status untuk memuat konfirmasi.
											</p>
										</section>
									) : !paid &&
										!refunded &&
										!closed &&
										!expired &&
										attempt?.status === "pending" &&
										attempt.action.kind === "bank_transfer" ? (
										<section className="checkout-payment-instructions" data-testid="bank-transfer-instructions">
											<h2>Transfer bank</h2>
											<dl className="checkout-charges receipt-instruction-meta">
												<div>
													<dt>Nominal transfer (tepat)</dt>
													<dd>
														<OrderReceiptCopyCode code={String(attempt.action.amount)} label="nominal" />
													</dd>
												</div>
												<div>
													<dt>Kode unik</dt>
													<dd>{attempt.action.transfer_code} rupiah, sudah termasuk dalam nominal</dd>
												</div>
												{attempt.action.accounts.map((account) => (
													<div key={account.account_number} className="receipt-instruction-code-block">
														<dt>
															{account.bank_name} a.n. {account.account_holder}
														</dt>
														<dd>
															<OrderReceiptCopyCode code={account.account_number} label="nomor rekening" />
														</dd>
													</div>
												))}
												<div>
													<dt>Batas transfer</dt>
													<dd>{formatWib(attempt.expires_at)} WIB</dd>
												</div>
											</dl>
											<p>{attempt.action.display_text}</p>
											<p className="checkout-hint">
												Transfer tepat sesuai nominal agar mudah dicocokkan. Status
												berubah setelah tim keuangan memeriksa mutasi rekening.
											</p>
										</section>
									) : null}
									{canPrepare && (
										<OrderReceiptPaymentForm
											initial={initialCheckoutPayment(order.id)}
										/>
									)}
								</div>
							)}
							{!cod && !paid && !refunded && (closed || expired) && (
								<div className="checkout-next-step">
									<p className="checkout-hint">
										Pilih produk dari katalog untuk memulai pesanan baru.
									</p>
									<Link className="button" href="/cari">
										Lihat produk
									</Link>
								</div>
							)}
							{!(
								closed ||
								expired ||
								refunded ||
								(paid && deliveredParcelCount >= originalParcels.length)
							) && (
								<div className="receipt-refresh-row">
									<a
										className={`${canPrepare ? "detail-help" : "button secondary"} checkout-status-refresh`}
										href={path}
									>
										Perbarui status
									</a>
									<span className="checkout-hint">
										Membaca status terbaru tanpa mengirim pesanan ulang.
									</span>
								</div>
							)}
						</section>

						<section
							className="receipt-parcels"
							aria-labelledby="receipt-parcels-heading"
						>
							<h2 id="receipt-parcels-heading">
								Pengiriman per paket ({order.shipments.length} paket)
							</h2>
							{order.fulfillment_notices &&
								order.fulfillment_notices.length > 0 && (
									<div className="checkout-caution" role="status">
										<Icon name="alert" />
										<p>
											Penjadwalan gudang dilanjutkan pada jam operasional (
											{formatWib(order.fulfillment_notices[0].available_at)}{" "}
											WIB).
										</p>
									</div>
								)}
							<div className="checkout-parcels">
								{order.shipments.map((parcel, index) => {
									const parcelCancelled =
										parcel.status === "cancelled" ||
										parcel.status === "booking_cancelled" ||
										closed ||
										expired;
									const col = collections.find(
										(c) => c.shipment_id === parcel.id,
									);
									const codVerified =
										cod && col?.status === "verified" && !parcelCancelled;
									const effectiveStatus = codVerified
										? "delivered"
										: parcel.status;
									const badgeLabel =
										awaitingPrepaid && !parcelCancelled
											? "Belum dibayar"
											: parcelStatusLabel(effectiveStatus);
									const badgeTone =
										awaitingPrepaid && !parcelCancelled
											? "neutral"
											: parcelTone(effectiveStatus, closed || expired);
									// Never invent a tracking number or carrier timestamps: show only
									// what the shipment actually has, and an honest pending state otherwise.
									const displayTracking = parcel.tracking_number ?? null;
									const displayIssuedAt = parcel.waybill_issued_at ?? null;
									const displayHandedOverAt = displayIssuedAt;
									const displayDeliveredAt =
										("delivered_at" in parcel &&
										typeof parcel.delivered_at === "string"
											? parcel.delivered_at
											: null) ??
										(codVerified ? (col?.occurred_at ?? null) : null);
									const steps = parcelTimeline(
										parcel,
										closed || expired,
										codVerified,
										awaitingPrepaid,
										order.created_at,
										displayIssuedAt,
										displayHandedOverAt,
										displayDeliveredAt,
									);
									const grouped = new Map<
										string,
										{
											name: string;
											variant: string;
											quantity: number;
											cancelled: number;
										}
									>();
									for (const unit of parcel.items) {
										const info = itemMap.get(unit.order_item_id);
										const current = grouped.get(unit.order_item_id) ?? {
											name: info?.name ?? "Produk pesanan",
											variant: info?.variant_label ?? "Pilihan",
											quantity: 0,
											cancelled: 0,
										};
										current.quantity += unit.quantity;
										if (unit.cancelled) current.cancelled += unit.quantity;
										grouped.set(unit.order_item_id, current);
									}
									return (
										<article
											className="checkout-parcel receipt-parcel"
											key={parcel.id}
										>
											<div className="receipt-parcel-head">
												<h3>
													Paket {index + 1}
													<span className="receipt-parcel-sep"> · </span>
													<span className="receipt-parcel-origin">
														dari {parcel.origin_city}
														{parcel.kind === "replacement"
															? " · Pengganti"
															: ""}
													</span>
												</h3>
												<span className="receipt-badge" data-tone={badgeTone}>
													{badgeLabel}
												</span>
											</div>
											<ul className="receipt-parcel-items">
												{[...grouped.entries()]
													.sort((a, b) =>
														a[1].name.localeCompare(b[1].name, "id"),
													)
													.map(([itemId, line]) => (
														<li key={itemId}>
															<span>
																{line.name} ({line.variant}){" "}
																<span className="receipt-nowrap">
																	× {line.quantity}
																</span>
															</span>
															{line.cancelled > 0 && (
																<small>
																	{" "}
																	· {line.cancelled} unit dibatalkan
																</small>
															)}
														</li>
													))}
											</ul>
											<p className="receipt-carrier">
												Kurir:{" "}
												<strong>
													{parcel.courier_name ?? "Kurir simulasi"}
												</strong>{" "}
												· Layanan {parcel.service_name ?? "Layanan pengiriman"}
											</p>
											{!displayTracking &&
												(codVerified || parcel.status === "handed_over") && (
													<p className="receipt-tracking">
														<span>Nomor resi belum tersedia.</span>
													</p>
												)}
											{displayTracking && (
												<p className="receipt-tracking">
													<span>
														Nomor resi: <strong>{displayTracking}</strong>
													</span>
													{displayIssuedAt && (
														<small>
															Diterbitkan {formatWibNode(displayIssuedAt)}
														</small>
													)}
													{"tracking_status" in parcel &&
														typeof parcel.tracking_status === "string" && (
															<small data-testid="parcel-tracking-status">
																Status kurir:{" "}
																{TRACKING_STATUS_LABELS[parcel.tracking_status] ??
																	"Diperbarui"}
															</small>
														)}
												</p>
											)}
											<ol
												className="receipt-timeline"
												aria-label={`Tahapan Paket ${index + 1}`}
											>
												{steps.map((step) => (
													<li key={step.label} data-state={step.state}>
														<div className="receipt-step-head">
															<strong>{step.label}</strong>
															{step.tag && (
																<span className="receipt-step-tag">
																	{step.tag}
																</span>
															)}
														</div>
														<span>{step.detail}</span>
													</li>
												))}
											</ol>
											<dl className="checkout-charges">
												<div>
													<dt>
														{parcelCancelled
															? "Tarif pengiriman (tidak ditagihkan)"
															: "Ongkir yang dibayar"}
													</dt>
													<dd>{rupiah(parcel.buyer_shipping_amount)}</dd>
												</div>
												{parcel.cod_collect_amount !== undefined && (
													<div className="checkout-total receipt-cod-parcel-total">
														<dt>
															<span>COD paket {index + 1}</span>
															{(col?.status === "verified" ||
																col?.status === "unknown" ||
																col?.status === "refunded" ||
																effectiveStatus === "failed" ||
																effectiveStatus === "returned") && (
																<small>
																	{col?.status === "verified" &&
																	col.occurred_at ? (
																		<>
																			Sudah dibayar ke kurir ·{" "}
																			{formatWibNode(col.occurred_at)}
																		</>
																	) : (
																		collectionStatusLabel(
																			col?.status ?? "pending",
																			effectiveStatus,
																		)
																	)}
																</small>
															)}
														</dt>
														<dd>{rupiah(parcel.cod_collect_amount)}</dd>
													</div>
												)}
											</dl>
										</article>
									);
								})}
							</div>
						</section>

						{extras.exception_proposals.length > 0 && (
							<section
								className="receipt-card receipt-exceptions"
								aria-labelledby="receipt-exceptions-heading"
							>
								<h2 id="receipt-exceptions-heading">
									Konfirmasi penanganan kendala
								</h2>
								<dl className="receipt-returns-list">
									{extras.exception_proposals.map((p) => (
										<div key={p.proposal_id}>
											<dt>
												Proposal resolusi ({p.proposal_kind}) ·{" "}
												{p.requires_buyer_choice
													? "Menunggu pilihan Anda"
													: p.proposal_status}
											</dt>
											<dd>{p.summary}</dd>
										</div>
									))}
								</dl>
							</section>
						)}

						{(showReturnsSection || extras.return_cases.length > 0) && (
							<section
								className="receipt-card receipt-returns"
								aria-labelledby="receipt-returns-heading"
							>
								<h2 id="receipt-returns-heading">
									Retur dan pengembalian dana
								</h2>
								<dl className="receipt-returns-list">
									{refunds.length > 0 ? (
										refunds.map((r) => (
											<div key={r.id}>
												<dt>
													Pengembalian dana · {refundStatusLabel(r.status)}
												</dt>
												<dd>{rupiah(r.amount)}</dd>
											</div>
										))
									) : (
										<div>
											<dt>Status retur & dana kembali</dt>
											<dd>
												Belum ada pengajuan ({deliveredParcelCount} dari{" "}
												{originalParcels.length} paket diterima)
											</dd>
										</div>
									)}
									{extras.return_cases.map((rc) => (
										<div key={rc.id}>
											<dt>
												Kasus retur · {rc.status} (
												{rc.requested_resolution === "replacement"
													? "Penggantian"
													: "Pengembalian dana"}
												)
											</dt>
											<dd>
												{rc.replacement_shipment_ids.length > 0
													? `${rc.replacement_shipment_ids.length} paket pengganti`
													: rc.evidence_count > 0
														? `${rc.evidence_count} bukti terlampir`
														: `Versi v${rc.version}`}
											</dd>
										</div>
									))}
								</dl>
								<p className="checkout-hint">
									{refunds.some((r) => r.status !== "succeeded") ? (
										"Pengembalian dana yang masih diproses atau menunggu verifikasi tujuan belum merupakan dana yang selesai dikirim."
									) : deliveredParcelCount > 0 ||
										order.items.some((i) => i.received_quantity > 0) ? (
										<>
											Untuk barang yang sudah diterima, ajukan pemeriksaan
											retur lewat{" "}
											<Link
												className="receipt-inline-link"
												href="/bantuan#percakapan"
											>
												percakapan bantuan
											</Link>{" "}
											dengan nomor pesanan ini. Lihat juga{" "}
											<Link
												className="receipt-inline-link"
												href="/bantuan#returns"
											>
												ketentuan pengembalian
											</Link>
											.
										</>
									) : (
										"Catatan retur dan pengembalian dana mengikuti hasil pemeriksaan fisik dan keuangan."
									)}
								</p>
							</section>
						)}
						{extras.support_conversation_id && (
							<p className="checkout-hint">
								<Link
									className="receipt-inline-link"
									href="/bantuan#percakapan"
								>
									Buka percakapan bantuan pesanan ini (
									{extras.support_conversation_id.slice(0, 8)})
								</Link>
							</p>
						)}
					</div>

					<div className="receipt-secondary">
						<OrderReceiptSummary
							subtitle={summarySubtitle}
							total={rupiah(order.amount_due)}
						>
							<ul className="checkout-summary-lines">
								{inlineItems.map(renderSummaryItem)}
							</ul>
							{extraItems.length > 0 && (
								<details className="receipt-more-items">
									<summary>
										<span className="receipt-more-show">
											Lihat {extraItems.length} produk lainnya{" "}
											<span className="receipt-nowrap">
												({extraUnits} pilihan)
												<Icon name="chevron" />
											</span>
										</span>
										<span className="receipt-more-hide">
											Tutup {extraItems.length} produk lainnya{" "}
											<span className="receipt-nowrap">
												({extraUnits} pilihan)
												<Icon name="chevron" />
											</span>
										</span>
									</summary>
									<ul className="checkout-summary-lines">
										{extraItems.map(renderSummaryItem)}
									</ul>
								</details>
							)}
							<dl className="checkout-charges">
								<div>
									<dt>Produk</dt>
									<dd>{rupiah(order.merchandise_total)}</dd>
								</div>
								{order.subsidy_total > 0 && (
									<>
										<div>
											<dt>Tarif pengiriman {originalParcels.length} paket</dt>
											<dd>{rupiah(order.shipping_total)}</dd>
										</div>
										<div>
											<dt>Subsidi ongkir</dt>
											<dd>−{rupiah(order.subsidy_total)}</dd>
										</div>
									</>
								)}
								<div>
									<dt>
										{closed || expired
											? "Tarif pengiriman (tidak ditagihkan)"
											: `Ongkir yang dibayar${originalParcels.length > 1 ? ` (${originalParcels.length} paket)` : ""}`}
									</dt>
									<dd>{rupiah(order.shipping_total - order.subsidy_total)}</dd>
								</div>
								{order.payment_charge_total > 0 && (
									<div>
										<dt>
											{cod
												? `Biaya COD (${(((order as { cod_fee_bps?: number }).cod_fee_bps ?? 0) / 100).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%)`
												: "Kode unik transfer"}
										</dt>
										<dd>{rupiah(order.payment_charge_total)}</dd>
									</div>
								)}
								<div className="checkout-total">
									<dt>
										{cod
											? `Total COD (${originalParcels.length} paket)`
											: closed || expired
												? "Total pesanan (tidak ditagihkan)"
												: "Total pesanan"}
									</dt>
									<dd>{rupiah(order.amount_due)}</dd>
								</div>
								{cod && verifiedCollected > 0 && remainingCod > 0 && (
									<>
										<div>
											<dt>Sudah dibayar ke kurir</dt>
											<dd>−{rupiah(verifiedCollected)}</dd>
										</div>
										<div className="checkout-total">
											<dt>
												Sisa tagihan kurir ({uncollectedCodParcels} paket)
											</dt>
											<dd>{rupiah(remainingCod)}</dd>
										</div>
									</>
								)}
								{order.refund_total > 0 && (
									<div>
										<dt>Dana telah dikembalikan</dt>
										<dd>{rupiah(order.refund_total)}</dd>
									</div>
								)}
								{order.pending_refund_total > 0 && (
									<div>
										<dt>Pengembalian dana diproses</dt>
										<dd>{rupiah(order.pending_refund_total)}</dd>
									</div>
								)}
							</dl>
							<p className="checkout-hint">
								Harga Rp99.000 per pilihan dan komposisi isi dibekukan dari
								publikasi saat pesanan dibuat.
							</p>
						</OrderReceiptSummary>

						<section
							className="receipt-card receipt-shipto"
							aria-labelledby="receipt-shipto-heading"
						>
							<h2 id="receipt-shipto-heading">Tujuan pengiriman tersimpan</h2>
							<dl className="receipt-address-list">
								<div>
									<dt>Penerima</dt>
									<dd>{ship_to.recipient_name}</dd>
								</div>
								<div>
									<dt>Nomor HP</dt>
									<dd>{ship_to.phone_masked}</dd>
								</div>
								<div>
									<dt>Alamat</dt>
									<dd>{ship_to.address_line}</dd>
								</div>
								<div>
									<dt>Wilayah</dt>
									<dd>
										{ship_to.subdistrict}, {ship_to.district}, {ship_to.city},{" "}
										<span className="receipt-province-zip">
											{ship_to.province} {ship_to.postal_code}
										</span>
									</dd>
								</div>
							</dl>
							<p className="checkout-hint">
								Nomor telepon disamarkan. Perubahan alamat akun tidak mengubah
								tujuan yang dibekukan pada pesanan ini.
							</p>
						</section>
					</div>
				</div>
				<CheckoutHelp context={helpContext} />
			</div>
		</CheckoutFrame>
	);
}
