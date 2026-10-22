import Link from "next/link";
import { Shell } from "../../../components/storefront/shell";
import { getLocalAuth } from "../../../modules/access/auth";
import { getPrincipal, type Principal } from "../../../modules/access/policy";
import { readAffiliateProfileDetail } from "../../../modules/affiliates/profile";
import { offerCommissionIdr } from "../../../modules/affiliates/rates";
import {
	type CommissionStatus,
	readCommissionBalanceForAffiliate,
	readCommissionsForAffiliate,
} from "../../../modules/commissions/service";
import {
	type PayoutStatus,
	readPayoutsForAffiliate,
} from "../../../modules/payouts/service";
import { storefrontRequest } from "../../../modules/storefront/browser";
import { rupiah } from "../../../modules/storefront/format";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Ruang Mitra Afiliasi · 99ribu",
	robots: { index: false, follow: false },
	referrer: "same-origin" as const,
};

const wibDate = new Intl.DateTimeFormat("id-ID", {
	timeZone: "Asia/Jakarta",
	dateStyle: "medium",
	timeStyle: "short",
});

function formatWib(iso: string) {
	return `${wibDate.format(new Date(iso))} WIB`;
}

function formatBpsPercent(bps: number) {
	return `${(bps / 100).toLocaleString("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
}

function beneficiaryStatusLabel(status: string) {
	if (status === "verified") return "Terverifikasi";
	if (status === "pending_verification") return "Menunggu verifikasi";
	if (status === "change_hold") return "Ditahan sementara";
	if (status === "rejected") return "Perlu perbaikan";
	return "Belum diatur";
}

function commissionStatusLabel(status: CommissionStatus) {
	if (status === "pending") return "Menunggu H+10";
	if (status === "held") return "Ditahan";
	if (status === "eligible") return "Siap cair";
	if (status === "allocated") return "Dalam antrean";
	if (status === "paid") return "Telah dibayar";
	return "Dibatalkan";
}

function payoutStatusLabel(status: PayoutStatus) {
	if (status === "succeeded") return "Selesai ditransfer";
	if (status === "processing") return "Sedang diproses";
	if (status === "unknown") return "Sedang direkonsiliasi";
	if (status === "funding_hold") return "Menunggu rekening";
	if (status === "failed") return "Perlu pemeriksaan";
	return "Dalam antrean";
}

export default async function AffiliateWorkspacePage() {
	const identity = getLocalAuth();
	let principal: Principal | null = null;
	try {
		const req = await storefrontRequest("GET", "/affiliate");
		principal = await getPrincipal(req, identity);
	} catch {
		principal = null;
	}

	if (!principal?.roles.includes("affiliate")) {
		return (
			<Shell active="account">
				<main id="main" className="wrap affiliate-workspace">
					<header className="receipt-header">
						<p className="checkout-order-reference">
							<span>Program Mitra Afiliasi · 99ribu</span>
							<span>Harga Tetap Rp99.000</span>
						</p>
						<h1>Ruang Mitra Afiliasi 99ribu</h1>
						<p className="receipt-lead">
							Harga produk tetap Rp99.000 untuk semua pembeli. Komisi dihitung
							per unit dan masuk antrean transfer manual otomatis saat saldo
							siap cair mencapai minimal Rp99.000.
						</p>
					</header>

					<section
						className="affiliate-head"
						aria-label="Ringkasan program afiliasi"
					>
						<article className="affiliate-eligible-card">
							<span className="receipt-badge" data-tone="active">
								Skema Komisi Transparan
							</span>
							<div className="affiliate-eligible-amount">Rp9.900 / unit</div>
							<p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
								Tarif dasar 10% (1.000 bps) dari harga tetap Rp99.000 per
								pilihan. Tanpa diskon kode dan tanpa mengubah harga pembeli.
							</p>
							<dl className="receipt-returns-list" style={{ marginTop: "4px" }}>
								<div>
									<dt>Masa tunggu komisi</dt>
									<dd>Matang H+10 setelah paket diterima pembeli</dd>
								</div>
								<div>
									<dt>Batas minimum pencairan otomatis</dt>
									<dd>Rp99.000 (masuk antrean transfer keuangan otomatis)</dd>
								</div>
							</dl>
						</article>

						<article className="notice-panel" style={{ maxWidth: "none" }}>
							<h2
								style={{
									fontSize: "var(--section-size)",
									lineHeight: "var(--section-leading)",
									margin: 0,
								}}
							>
								Masuk sebagai Mitra Afiliasi
							</h2>
							<p>
								Masuk menggunakan akun mitra afiliasi terverifikasi untuk
								melihat tautan rujukan pribadi, saldo komisi per status, dan
								riwayat pencairan otomatis.
							</p>
							<div className="notice-actions">
								<Link className="button" href="/masuk?next=%2Faffiliate">
									Masuk ke Akun
								</Link>
								<Link className="button button-secondary" href="/search">
									Lihat katalog produk
								</Link>
							</div>
						</article>
					</section>
				</main>
			</Shell>
		);
	}

	const workspace = await identity.sql.begin(async (tx) => {
		const profile = await readAffiliateProfileDetail(tx, principal.id);
		if (!profile) return null;
		const balance = await readCommissionBalanceForAffiliate(tx, profile.id);
		const commissions = await readCommissionsForAffiliate(tx, profile.id, {
			limit: 50,
			cursor: null,
		});
		const payouts = await readPayoutsForAffiliate(tx, profile.id, {
			limit: 20,
			cursor: null,
		});
		return {
			profile,
			balance,
			commissions: commissions.data,
			payouts: payouts.data,
		};
	});

	if (!workspace) {
		return (
			<Shell active="account">
				<main id="main" className="wrap affiliate-workspace">
					<section className="notice-panel">
						<h1>Aktivasi Profil Afiliasi</h1>
						<p>
							Akun Anda memiliki akses mitra afiliasi, tetapi profil rujukan
							belum diaktifkan. Komisi dihitung dari harga tetap Rp99.000 per
							pilihan dan dicairkan otomatis saat saldo siap cair mencapai
							minimal Rp99.000.
						</p>
						<div className="notice-actions">
							<Link className="button" href="/search">
								Jelajahi produk 99ribu
							</Link>
						</div>
					</section>
				</main>
			</Shell>
		);
	}

	const { profile, balance, commissions, payouts } = workspace;
	const unitCommissionIdr = offerCommissionIdr(profile.rate_basis_points);

	return (
		<Shell active="account">
			<main id="main" className="wrap affiliate-workspace">
				<header className="receipt-header">
					<p className="checkout-order-reference">
						<span>Mitra Afiliasi · {profile.display_name}</span>
						<span>Kode: {profile.referral_code}</span>
					</p>
					<h1>Ruang Mitra Afiliasi 99ribu</h1>
					<p className="receipt-lead">
						Semua produk tetap seharga Rp99.000 bagi pembeli. Komisi dihitung
						transparan per unit dan masuk antrean transfer manual otomatis saat
						saldo siap cair mencapai minimal {rupiah(balance.minimum_payout)}.
					</p>
				</header>

				<section
					id="affiliate-profile-section"
					aria-labelledby="heading-affiliate-profile"
					className="affiliate-head"
				>
					<article className="affiliate-card">
						<div className="receipt-parcel-head">
							<h2
								id="heading-affiliate-profile"
								style={{
									margin: 0,
									fontSize: "var(--section-size)",
									lineHeight: "var(--section-leading)",
								}}
							>
								Tautan & Tarif Rujukan
							</h2>
							<span
								data-testid="affiliate-status-badge"
								className="receipt-badge"
								data-tone={profile.status === "active" ? "active" : "warning"}
							>
								{profile.status === "active" ? "Aktif" : "Ditangguhkan"}
							</span>
						</div>
						<dl className="receipt-returns-list">
							<div>
								<dt>Kode rujukan</dt>
								<dd data-testid="affiliate-referral-code">
									{profile.referral_code}
								</dd>
							</div>
							<div>
								<dt>Tautan bagikan</dt>
								<dd
									data-testid="affiliate-referral-url"
									className="affiliate-copy-box"
								>
									{profile.referral_url}
								</dd>
							</div>
							<div>
								<dt>Tarif komisi efektif</dt>
								<dd data-testid="affiliate-rate-bps">
									{formatBpsPercent(profile.rate_basis_points)} (
									{profile.rate_basis_points} bps) · {rupiah(unitCommissionIdr)}{" "}
									per unit
								</dd>
							</div>
						</dl>
					</article>

					<article className="affiliate-card">
						<div className="receipt-parcel-head">
							<h2
								style={{
									margin: 0,
									fontSize: "var(--section-size)",
									lineHeight: "var(--section-leading)",
								}}
							>
								Rekening Tujuan Pencairan
							</h2>
							<span
								data-testid="beneficiary-status-badge"
								className="receipt-badge"
								data-tone={
									profile.beneficiary_status === "verified"
										? "active"
										: "warning"
								}
							>
								{beneficiaryStatusLabel(profile.beneficiary_status)}
							</span>
						</div>
						{profile.beneficiary ? (
							<dl className="receipt-returns-list">
								<div>
									<dt>Bank tujuan</dt>
									<dd data-testid="beneficiary-bank-name">
										{profile.beneficiary.bank_name}
									</dd>
								</div>
								<div>
									<dt>Nomor rekening</dt>
									<dd
										data-testid="beneficiary-masked-account"
										style={{ fontFamily: "ui-monospace, monospace" }}
									>
										{profile.beneficiary.masked_account}
									</dd>
								</div>
								<div>
									<dt>Nama pemilik rekening</dt>
									<dd>{profile.beneficiary.account_holder_name}</dd>
								</div>
							</dl>
						) : (
							<p style={{ margin: 0, color: "var(--muted)" }}>
								Rekening tujuan belum diatur. Verifikasi rekening diperlukan
								sebelum saldo siap cair dapat masuk antrean transfer.
							</p>
						)}
						<p className="checkout-hint" style={{ margin: 0 }}>
							Perubahan rekening memerlukan verifikasi ulang kata sandi dan
							hanya berlaku untuk pencairan berikutnya; antrean yang sudah
							diklaim tetap menggunakan rekening terbeku.
						</p>
					</article>
				</section>

				<section
					id="affiliate-commissions-section"
					aria-labelledby="heading-affiliate-balance"
					style={{ display: "grid", gap: "16px" }}
				>
					<div style={{ display: "grid", gap: "4px" }}>
						<h2
							id="heading-affiliate-balance"
							style={{
								margin: 0,
								fontSize: "var(--section-size)",
								lineHeight: "var(--section-leading)",
							}}
						>
							Ringkasan Saldo Komisi
						</h2>
						<p className="checkout-hint" style={{ margin: 0 }}>
							Komisi matang 10 hari setelah paket diterima pembeli (H+10) atau
							setelah paket pengganti diterima. Pengajuan retur menahan komisi
							dan refund membatalkan komisi unit terkait.
						</p>
					</div>

					<div className="affiliate-balance-grid">
						<div
							data-testid="balance-card-pending"
							className="affiliate-balance-item"
						>
							<span>Menunggu (H+10)</span>
							<strong>{rupiah(balance.pending)}</strong>
						</div>
						<div
							data-testid="balance-card-held"
							className="affiliate-balance-item"
						>
							<span>Ditahan (Retur/Klaim)</span>
							<strong>{rupiah(balance.held)}</strong>
						</div>
						<div
							data-testid="balance-card-eligible"
							className="affiliate-balance-item"
							data-highlight="true"
						>
							<span>Siap Cair</span>
							<strong>{rupiah(balance.eligible)}</strong>
						</div>
						<div
							data-testid="balance-card-allocated"
							className="affiliate-balance-item"
						>
							<span>Dalam Antrean Transfer</span>
							<strong>{rupiah(balance.allocated)}</strong>
						</div>
						<div
							data-testid="balance-card-paid"
							className="affiliate-balance-item"
						>
							<span>Telah Dibayar</span>
							<strong>{rupiah(balance.paid)}</strong>
						</div>
					</div>

					<div className="affiliate-card">
						<h3
							style={{
								margin: 0,
								fontSize: "var(--card-size)",
								lineHeight: "var(--card-leading)",
							}}
						>
							Riwayat Komisi per Unit
						</h3>
						{commissions.length === 0 ? (
							<p style={{ margin: 0, color: "var(--muted)" }}>
								Belum ada transaksi teratribusi. Bagikan tautan rujukan Anda
								untuk mulai mengumpulkan komisi.
							</p>
						) : (
							<ul
								data-testid="commission-history-list"
								className="checkout-summary-lines"
								style={{ margin: 0 }}
							>
								{commissions.map((item) => (
									<li
										key={item.id}
										data-testid={`commission-row-${item.status}`}
									>
										<div className="checkout-summary-parent">
											<strong>
												{item.product_name} ({item.quantity} unit)
											</strong>
											<strong>{rupiah(item.amount)}</strong>
										</div>
										<div
											className="receipt-parcel-head"
											style={{ marginTop: "4px", fontSize: "0.875rem" }}
										>
											<span style={{ color: "var(--muted)" }}>
												Ref {item.sale_reference} · Tarif{" "}
												{formatBpsPercent(item.rate_basis_points)}
											</span>
											<span className="receipt-badge" data-tone="active">
												{commissionStatusLabel(item.status)}
											</span>
										</div>
										{item.received_at && (
											<p
												className="checkout-hint"
												style={{ margin: "4px 0 0" }}
											>
												Penerimaan{" "}
												{item.receipt_kind === "replacement"
													? "unit pengganti"
													: "paket awal"}
												: {formatWib(item.received_at)}
												{item.eligible_at
													? ` · Jatuh tempo H+10: ${formatWib(item.eligible_at)}`
													: ""}
											</p>
										)}
										{item.hold_reason && (
											<p
												style={{
													margin: "4px 0 0",
													fontSize: "0.8125rem",
													color: "var(--warning)",
												}}
											>
												Catatan status: {item.hold_reason}
											</p>
										)}
									</li>
								))}
							</ul>
						)}
					</div>
				</section>

				<section
					id="affiliate-payouts-section"
					aria-labelledby="heading-affiliate-payouts"
					className="affiliate-card"
				>
					<div style={{ display: "grid", gap: "4px" }}>
						<h2
							id="heading-affiliate-payouts"
							style={{
								margin: 0,
								fontSize: "var(--section-size)",
								lineHeight: "var(--section-leading)",
							}}
						>
							Antrean Pencairan Otomatis & Transfer Manual
						</h2>
						<p className="checkout-hint" style={{ margin: 0 }}>
							Batas minimum pencairan otomatis:{" "}
							<strong>{rupiah(balance.minimum_payout)}</strong> (inklusif).
							Tidak ada penarikan manual oleh mitra; saat saldo siap cair
							mencapai batas minimum dan rekening terverifikasi, dana otomatis
							dicadangkan untuk ditransfer manual oleh tim keuangan.
						</p>
					</div>

					{payouts.length === 0 ? (
						<p style={{ margin: 0, color: "var(--muted)" }}>
							Belum ada antrean pencairan. Komisi siap cair akan masuk antrean
							secara otomatis saat mencapai minimal{" "}
							{rupiah(balance.minimum_payout)}.
						</p>
					) : (
						<ul
							data-testid="payout-history-list"
							className="checkout-summary-lines"
							style={{ margin: 0 }}
						>
							{payouts.map((payout) => (
								<li key={payout.id} data-testid={`payout-row-${payout.status}`}>
									<div className="checkout-summary-parent">
										<strong>Pencairan {rupiah(payout.amount)}</strong>
										<span className="receipt-badge" data-tone="active">
											{payoutStatusLabel(payout.status)}
										</span>
									</div>
									<p style={{ margin: "4px 0 0", color: "var(--ink)" }}>
										{payout.explanation}
									</p>
									<p className="checkout-hint" style={{ margin: "4px 0 0" }}>
										Dijadwalkan: {formatWib(payout.created_at)}
										{payout.completed_at
											? ` · Diselesaikan: ${formatWib(payout.completed_at)}`
											: ""}
									</p>
								</li>
							))}
						</ul>
					)}
				</section>
			</main>
		</Shell>
	);
}
