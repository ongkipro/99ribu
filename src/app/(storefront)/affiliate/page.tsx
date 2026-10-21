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
				<main id="main" className="wrap empty-state">
					<h1>Ruang Mitra Afiliasi 99ribu</h1>
					<p>
						Masuk sebagai mitra afiliasi terverifikasi untuk melihat tautan
						rujukan, rincian komisi per unit, dan status pencairan otomatis.
					</p>
					<Link className="button" href="/search">
						Lihat katalog produk
					</Link>
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
				<main id="main" className="wrap empty-state">
					<h1>Aktivasi Profil Afiliasi</h1>
					<p>
						Akun Anda memiliki akses mitra afiliasi, tetapi profil rujukan belum
						diaktifkan. Komisi dihitung dari harga tetap Rp99.000 per pilihan
						dan dicairkan otomatis saat saldo siap cair mencapai minimal
						Rp99.000.
					</p>
					<Link className="button" href="/search">
						Jelajahi produk 99ribu
					</Link>
				</main>
			</Shell>
		);
	}

	const { profile, balance, commissions, payouts } = workspace;
	const unitCommissionIdr = offerCommissionIdr(profile.rate_basis_points);

	return (
		<Shell active="account">
			<main
				id="main"
				className="wrap"
				style={{
					paddingBlock: "1.5rem 3rem",
					display: "grid",
					gap: "1.5rem",
					maxWidth: "72rem",
				}}
			>
				<header style={{ display: "grid", gap: "0.5rem" }}>
					<p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.8 }}>
						Mitra Afiliasi · {profile.display_name}
					</p>
					<h1 style={{ margin: 0, fontSize: "1.5rem", lineHeight: 1.25 }}>
						Ruang Mitra Afiliasi 99ribu
					</h1>
					<p style={{ margin: 0, fontSize: "0.9375rem", opacity: 0.85 }}>
						Semua produk tetap seharga Rp99.000 bagi pembeli. Komisi dihitung
						transparan per unit dan masuk antrean transfer manual otomatis saat
						saldo siap cair mencapai minimal {rupiah(balance.minimum_payout)}.
					</p>
				</header>

				<section
					id="affiliate-profile-section"
					aria-labelledby="heading-affiliate-profile"
					style={{
						display: "grid",
						gap: "1rem",
						gridTemplateColumns:
							"repeat(auto-fit, minmax(min(100%, 18rem), 1fr))",
					}}
				>
					<article
						style={{
							border: "1px solid var(--border, #d6d3cd)",
							borderRadius: "0.75rem",
							padding: "1rem",
							background: "var(--surface, #fff)",
							display: "grid",
							gap: "0.625rem",
						}}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								gap: "0.5rem",
								flexWrap: "wrap",
							}}
						>
							<h2
								id="heading-affiliate-profile"
								style={{ margin: 0, fontSize: "1.0625rem" }}
							>
								Tautan & Tarif Rujukan
							</h2>
							<span
								data-testid="affiliate-status-badge"
								style={{
									fontSize: "0.8125rem",
									fontWeight: 600,
									padding: "0.125rem 0.5rem",
									borderRadius: "999px",
									background: "#eef6ee",
								}}
							>
								{profile.status === "active" ? "Aktif" : "Ditangguhkan"}
							</span>
						</div>
						<dl
							style={{
								margin: 0,
								display: "grid",
								gap: "0.5rem",
								fontSize: "0.9375rem",
							}}
						>
							<div>
								<dt style={{ fontSize: "0.8125rem", opacity: 0.75 }}>
									Kode rujukan
								</dt>
								<dd
									data-testid="affiliate-referral-code"
									style={{ margin: 0, fontWeight: 700, wordBreak: "break-all" }}
								>
									{profile.referral_code}
								</dd>
							</div>
							<div>
								<dt style={{ fontSize: "0.8125rem", opacity: 0.75 }}>
									Tautan bagikan
								</dt>
								<dd
									data-testid="affiliate-referral-url"
									style={{
										margin: 0,
										fontFamily: "monospace",
										fontSize: "0.8125rem",
										wordBreak: "break-all",
									}}
								>
									{profile.referral_url}
								</dd>
							</div>
							<div>
								<dt style={{ fontSize: "0.8125rem", opacity: 0.75 }}>
									Tarif komisi efektif
								</dt>
								<dd
									data-testid="affiliate-rate-bps"
									style={{ margin: 0, fontWeight: 600 }}
								>
									{formatBpsPercent(profile.rate_basis_points)} (
									{profile.rate_basis_points} bps) · {rupiah(unitCommissionIdr)}{" "}
									per unit
								</dd>
							</div>
						</dl>
					</article>

					<article
						style={{
							border: "1px solid var(--border, #d6d3cd)",
							borderRadius: "0.75rem",
							padding: "1rem",
							background: "var(--surface, #fff)",
							display: "grid",
							gap: "0.625rem",
						}}
					>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								gap: "0.5rem",
								flexWrap: "wrap",
							}}
						>
							<h2 style={{ margin: 0, fontSize: "1.0625rem" }}>
								Rekening Tujuan Pencairan
							</h2>
							<span
								data-testid="beneficiary-status-badge"
								style={{
									fontSize: "0.8125rem",
									fontWeight: 600,
									padding: "0.125rem 0.5rem",
									borderRadius: "999px",
									background: "#f3f2ee",
								}}
							>
								{beneficiaryStatusLabel(profile.beneficiary_status)}
							</span>
						</div>
						{profile.beneficiary ? (
							<dl
								style={{
									margin: 0,
									display: "grid",
									gap: "0.5rem",
									fontSize: "0.9375rem",
								}}
							>
								<div>
									<dt style={{ fontSize: "0.8125rem", opacity: 0.75 }}>
										Bank tujuan
									</dt>
									<dd
										data-testid="beneficiary-bank-name"
										style={{ margin: 0, fontWeight: 600 }}
									>
										{profile.beneficiary.bank_name}
									</dd>
								</div>
								<div>
									<dt style={{ fontSize: "0.8125rem", opacity: 0.75 }}>
										Nomor rekening
									</dt>
									<dd
										data-testid="beneficiary-masked-account"
										style={{ margin: 0, fontFamily: "monospace" }}
									>
										{profile.beneficiary.masked_account}
									</dd>
								</div>
								<div>
									<dt style={{ fontSize: "0.8125rem", opacity: 0.75 }}>
										Nama pemilik rekening
									</dt>
									<dd style={{ margin: 0 }}>
										{profile.beneficiary.account_holder_name}
									</dd>
								</div>
							</dl>
						) : (
							<p style={{ margin: 0, fontSize: "0.875rem" }}>
								Rekening tujuan belum diatur. Verifikasi rekening diperlukan
								sebelum saldo siap cair dapat masuk antrean transfer.
							</p>
						)}
						<p style={{ margin: 0, fontSize: "0.8125rem", opacity: 0.75 }}>
							Perubahan rekening memerlukan verifikasi ulang kata sandi dan
							hanya berlaku untuk pencairan berikutnya; antrean yang sudah
							diklaim tetap menggunakan rekening terbeku.
						</p>
					</article>
				</section>

				<section
					id="affiliate-commissions-section"
					aria-labelledby="heading-affiliate-balance"
					style={{ display: "grid", gap: "1rem" }}
				>
					<div style={{ display: "grid", gap: "0.25rem" }}>
						<h2
							id="heading-affiliate-balance"
							style={{ margin: 0, fontSize: "1.25rem" }}
						>
							Ringkasan Saldo Komisi
						</h2>
						<p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.8 }}>
							Komisi matang 10 hari setelah paket diterima pembeli (H+10) atau
							setelah paket pengganti diterima. Pengajuan retur menahan komisi
							dan refund membatalkan komisi unit terkait.
						</p>
					</div>

					<div
						style={{
							display: "grid",
							gap: "0.75rem",
							gridTemplateColumns:
								"repeat(auto-fit, minmax(min(100%, 11rem), 1fr))",
						}}
					>
						<div
							data-testid="balance-card-pending"
							style={{
								border: "1px solid var(--border, #d6d3cd)",
								borderRadius: "0.75rem",
								padding: "0.875rem",
								background: "var(--surface, #fff)",
							}}
						>
							<div style={{ fontSize: "0.8125rem", opacity: 0.75 }}>
								Menunggu (H+10)
							</div>
							<strong style={{ fontSize: "1.125rem" }}>
								{rupiah(balance.pending)}
							</strong>
						</div>
						<div
							data-testid="balance-card-held"
							style={{
								border: "1px solid var(--border, #d6d3cd)",
								borderRadius: "0.75rem",
								padding: "0.875rem",
								background: "var(--surface, #fff)",
							}}
						>
							<div style={{ fontSize: "0.8125rem", opacity: 0.75 }}>
								Ditahan (Retur/Klaim)
							</div>
							<strong style={{ fontSize: "1.125rem" }}>
								{rupiah(balance.held)}
							</strong>
						</div>
						<div
							data-testid="balance-card-eligible"
							style={{
								border: "1px solid var(--border, #d6d3cd)",
								borderRadius: "0.75rem",
								padding: "0.875rem",
								background: "var(--surface, #fff)",
							}}
						>
							<div style={{ fontSize: "0.8125rem", opacity: 0.75 }}>
								Siap Cair
							</div>
							<strong style={{ fontSize: "1.125rem" }}>
								{rupiah(balance.eligible)}
							</strong>
						</div>
						<div
							data-testid="balance-card-allocated"
							style={{
								border: "1px solid var(--border, #d6d3cd)",
								borderRadius: "0.75rem",
								padding: "0.875rem",
								background: "var(--surface, #fff)",
							}}
						>
							<div style={{ fontSize: "0.8125rem", opacity: 0.75 }}>
								Dalam Antrean Transfer
							</div>
							<strong style={{ fontSize: "1.125rem" }}>
								{rupiah(balance.allocated)}
							</strong>
						</div>
						<div
							data-testid="balance-card-paid"
							style={{
								border: "1px solid var(--border, #d6d3cd)",
								borderRadius: "0.75rem",
								padding: "0.875rem",
								background: "var(--surface, #fff)",
							}}
						>
							<div style={{ fontSize: "0.8125rem", opacity: 0.75 }}>
								Telah Dibayar
							</div>
							<strong style={{ fontSize: "1.125rem" }}>
								{rupiah(balance.paid)}
							</strong>
						</div>
					</div>

					<div
						style={{
							border: "1px solid var(--border, #d6d3cd)",
							borderRadius: "0.75rem",
							padding: "1rem",
							background: "var(--surface, #fff)",
							display: "grid",
							gap: "0.75rem",
						}}
					>
						<h3 style={{ margin: 0, fontSize: "1.0625rem" }}>
							Riwayat Komisi per Unit
						</h3>
						{commissions.length === 0 ? (
							<p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.8 }}>
								Belum ada transaksi teratribusi. Bagikan tautan rujukan Anda
								untuk mulai mengumpulkan komisi.
							</p>
						) : (
							<ul
								data-testid="commission-history-list"
								style={{
									listStyle: "none",
									margin: 0,
									padding: 0,
									display: "grid",
									gap: "0.75rem",
								}}
							>
								{commissions.map((item) => (
									<li
										key={item.id}
										data-testid={`commission-row-${item.status}`}
										style={{
											borderTop: "1px solid var(--border, #e5e2dc)",
											paddingTop: "0.75rem",
											display: "grid",
											gap: "0.25rem",
										}}
									>
										<div
											style={{
												display: "flex",
												justifyContent: "space-between",
												alignItems: "baseline",
												gap: "0.5rem",
												flexWrap: "wrap",
											}}
										>
											<strong>
												{item.product_name} ({item.quantity} unit)
											</strong>
											<strong>{rupiah(item.amount)}</strong>
										</div>
										<div
											style={{
												display: "flex",
												justifyContent: "space-between",
												alignItems: "center",
												gap: "0.5rem",
												flexWrap: "wrap",
												fontSize: "0.8125rem",
												opacity: 0.85,
											}}
										>
											<span>
												Ref {item.sale_reference} · Tarif{" "}
												{formatBpsPercent(item.rate_basis_points)}
											</span>
											<span style={{ fontWeight: 600 }}>
												{commissionStatusLabel(item.status)}
											</span>
										</div>
										{item.received_at && (
											<p
												style={{
													margin: 0,
													fontSize: "0.8125rem",
													opacity: 0.75,
												}}
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
													margin: 0,
													fontSize: "0.8125rem",
													color: "#7c2d12",
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
					style={{
						border: "1px solid var(--border, #d6d3cd)",
						borderRadius: "0.75rem",
						padding: "1rem",
						background: "var(--surface, #fff)",
						display: "grid",
						gap: "0.75rem",
					}}
				>
					<div style={{ display: "grid", gap: "0.25rem" }}>
						<h2
							id="heading-affiliate-payouts"
							style={{ margin: 0, fontSize: "1.125rem" }}
						>
							Antrean Pencairan Otomatis & Transfer Manual
						</h2>
						<p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.8 }}>
							Batas minimum pencairan otomatis:{" "}
							<strong>{rupiah(balance.minimum_payout)}</strong> (inklusif).
							Tidak ada penarikan manual oleh mitra; saat saldo siap cair
							mencapai batas minimum dan rekening terverifikasi, dana otomatis
							dicadangkan untuk ditransfer manual oleh tim keuangan.
						</p>
					</div>

					{payouts.length === 0 ? (
						<p style={{ margin: 0, fontSize: "0.875rem", opacity: 0.8 }}>
							Belum ada antrean pencairan. Komisi siap cair akan masuk antrean
							secara otomatis saat mencapai minimal{" "}
							{rupiah(balance.minimum_payout)}.
						</p>
					) : (
						<ul
							data-testid="payout-history-list"
							style={{
								listStyle: "none",
								margin: 0,
								padding: 0,
								display: "grid",
								gap: "0.75rem",
							}}
						>
							{payouts.map((payout) => (
								<li
									key={payout.id}
									data-testid={`payout-row-${payout.status}`}
									style={{
										borderTop: "1px solid var(--border, #e5e2dc)",
										paddingTop: "0.75rem",
										display: "grid",
										gap: "0.25rem",
									}}
								>
									<div
										style={{
											display: "flex",
											justifyContent: "space-between",
											alignItems: "baseline",
											gap: "0.5rem",
											flexWrap: "wrap",
										}}
									>
										<strong>Pencairan {rupiah(payout.amount)}</strong>
										<span style={{ fontSize: "0.8125rem", fontWeight: 600 }}>
											{payoutStatusLabel(payout.status)}
										</span>
									</div>
									<p
										style={{ margin: 0, fontSize: "0.8125rem", opacity: 0.85 }}
									>
										{payout.explanation}
									</p>
									<p style={{ margin: 0, fontSize: "0.75rem", opacity: 0.7 }}>
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
