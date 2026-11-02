import Link from "next/link";
import { AffiliateLinkTools } from "../../../components/storefront/affiliate/link-tools";
import { BeneficiaryForm } from "../../../components/storefront/affiliate/beneficiary-form";
import { Shell } from "../../../components/storefront/shell";
import { getLocalAuth } from "../../../modules/access/auth";
import { getPrincipal, type Principal } from "../../../modules/access/policy";
import {
	readBalanceDetail,
	readCommissionPage,
	readPeriodSummary,
} from "../../../modules/affiliates/dashboard";
import {
	buildDashboardView,
	COMMISSION_STATES,
	PERIODS,
	parsePeriod,
	parseState,
	periodRange,
	STATE_LABEL,
	WIB_ZONE_LABEL,
} from "../../../modules/affiliates/dashboard-view";
import { readAffiliateProfileDetail } from "../../../modules/affiliates/profile";
import { offerCommissionIdr, PRICE_CEILING_IDR } from "../../../modules/affiliates/rates";
import { readCommissionBalanceForAffiliate } from "../../../modules/commissions/service";
import {
	type PayoutStatus,
	readPayoutsForAffiliate,
} from "../../../modules/payouts/service";
import { storefrontRequest } from "../../../modules/storefront/browser";
import { rupiah } from "../../../modules/storefront/format";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Ruang mitra afiliasi",
	robots: { index: false, follow: false },
	referrer: "same-origin" as const,
};

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

function payoutStatusLabel(status: PayoutStatus) {
	if (status === "succeeded") return "Selesai ditransfer";
	if (status === "processing") return "Sedang diproses";
	if (status === "unknown") return "Sedang direkonsiliasi";
	if (status === "funding_hold") return "Menunggu rekening";
	if (status === "failed") return "Perlu pemeriksaan";
	return "Dalam antrean";
}

function first(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value;
}

function href(params: Record<string, string | null>, hash: string) {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
	const text = query.toString();
	return `/afiliasi${text ? `?${text}` : ""}#${hash}`;
}

const SECTIONS = [
	["ringkasan", "Ringkasan"],
	["komisi", "Komisi"],
	["tautan", "Tautan dan kode"],
	["penarikan", "Penarikan"],
	["bantuan", "Bantuan"],
] as const;

export default async function AffiliateWorkspacePage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const raw = await searchParams;
	const identity = getLocalAuth();
	let principal: Principal | null = null;
	try {
		const req = await storefrontRequest("GET", "/afiliasi");
		principal = await getPrincipal(req, identity);
	} catch {
		principal = null;
	}

	if (!principal?.roles.includes("affiliate")) {
		return (
			<Shell active="account">
				<main id="main" className="wrap aff-page">
					<header className="aff-head">
						<p className="aff-eyebrow">Program mitra afiliasi</p>
						<h1>Ruang mitra afiliasi</h1>
						<p className="aff-lead">
							Setiap produk 99ribu berharga maksimal Rp99.000, sama untuk semua pembeli. Komisi
							dihitung dari harga tiap unit yang dibeli lewat tautan Anda.
						</p>
					</header>
					<section className="aff-block" aria-labelledby="aff-how">
						<h2 id="aff-how">Cara kerjanya</h2>
						<dl className="aff-facts">
							<div>
								<dt>Tarif dasar</dt>
								<dd>{formatBpsPercent(1000)} per unit, paling banyak {rupiah(offerCommissionIdr(1000, PRICE_CEILING_IDR))} per unit</dd>
							</div>
							<div>
								<dt>Atribusi</dt>
								<dd>Pembeli yang pertama kali membuka tautan Anda dalam 7 hari terakhir</dd>
							</div>
							<div>
								<dt>Matang</dt>
								<dd>10 hari setelah paket diterima pembeli</dd>
							</div>
							<div>
								<dt>Pencairan</dt>
								<dd>Minimal {rupiah(99000)}, ditransfer oleh keuangan secara manual</dd>
							</div>
						</dl>
					</section>
					<section className="aff-block" aria-labelledby="aff-login">
						<h2 id="aff-login">Masuk sebagai mitra</h2>
						<p>Masuk dengan akun mitra afiliasi untuk melihat tautan, komisi per unit, dan riwayat pencairan.</p>
						<div className="aff-actions">
							<Link className="button" href="/masuk?next=%2Fafiliasi">
								Masuk
							</Link>
							<Link className="button button-secondary" href="/cari">
								Lihat katalog
							</Link>
						</div>
					</section>
				</main>
			</Shell>
		);
	}

	const period = parsePeriod(first(raw.periode));
	const status = parseState(first(raw.status));
	const cursor = first(raw.setelah) ?? null;
	const range = periodRange(period, new Date());

	const workspace = await identity.sql.begin(async (tx) => {
		const profile = await readAffiliateProfileDetail(tx, principal.id);
		if (!profile) return null;
		const [balance, detail, summary, page, payouts] = await Promise.all([
			readCommissionBalanceForAffiliate(tx, profile.id),
			readBalanceDetail(tx, profile.id),
			readPeriodSummary(tx, profile.id, range),
			readCommissionPage(tx, profile.id, { status, range, cursor }),
			readPayoutsForAffiliate(tx, profile.id, { limit: 20, cursor: null }),
		]);
		return { profile, balance, detail, summary, page, payouts: payouts.data };
	});

	if (!workspace) {
		return (
			<Shell active="account">
				<main id="main" className="wrap aff-page">
					<header className="aff-head">
						<h1>Profil afiliasi belum aktif</h1>
						<p className="aff-lead">
							Akun Anda punya akses mitra, tetapi profil rujukan belum diaktifkan. Hubungi kami untuk
							mengaktifkannya.
						</p>
						<div className="aff-actions">
							<Link className="button" href="/bantuan#percakapan">
								Hubungi kami
							</Link>
							<Link className="button button-secondary" href="/cari">
								Lihat katalog
							</Link>
						</div>
					</header>
				</main>
			</Shell>
		);
	}

	const { profile, balance, detail, summary, page, payouts } = workspace;
	const view = buildDashboardView({
		balance,
		detail,
		beneficiaryVerified: profile.beneficiary_status === "verified",
		summary,
		commissions: page.data,
		payouts: payouts.map((p) => ({
			id: p.id,
			amount: p.amount,
			status: p.status,
			explanation: p.explanation,
			created_at: p.created_at,
			completed_at: p.completed_at,
		})),
	});
	const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "";
	const unitCommissionIdr = offerCommissionIdr(profile.rate_basis_points, PRICE_CEILING_IDR);

	return (
		<Shell active="account">
			<main id="main" className="wrap aff-page">
				<header className="aff-head">
					<p className="aff-eyebrow">
						{profile.display_name} · kode {profile.referral_code}
					</p>
					<h1>Ruang mitra afiliasi</h1>
					<span
						data-testid="affiliate-status-badge"
						className="aff-badge"
						data-tone={profile.status === "active" ? "ok" : "warn"}
					>
						{profile.status === "active" ? "Aktif" : "Ditangguhkan"}
					</span>
				</header>

				<nav className="aff-tabs" aria-label="Bagian halaman">
					{SECTIONS.map(([id, label]) => (
						<a key={id} href={`#${id}`}>
							{label}
						</a>
					))}
				</nav>

				<section id="ringkasan" className="aff-section" aria-labelledby="aff-h-ringkasan">
					<h2 id="aff-h-ringkasan">Ringkasan</h2>
					<ul className="aff-chips" aria-label="Periode">
						{PERIODS.map((p) => (
							<li key={p.key}>
								<Link
									href={href({ periode: p.key, status }, "ringkasan")}
									aria-current={p.key === period ? "true" : undefined}
									scroll={false}
								>
									{p.label}
								</Link>
							</li>
						))}
					</ul>
					<p className="aff-hint">Waktu mengikuti {WIB_ZONE_LABEL}.</p>

					<div className="aff-estimate">
						<p className="aff-estimate-label">Total komisi belum dibatalkan, bisa berubah · {periodLabel.toLowerCase()}</p>
						<p className="aff-estimate-value" data-testid="summary-total">{view.summary.estimate}</p>
						<p className="aff-estimate-paid">
							Sudah dibayar dari total ini: <strong data-testid="summary-paid">{view.summary.paid}</strong>
						</p>
						<p className="aff-hint">
							Ini bukan saldo dan bukan jumlah yang pasti cair. Angka ini mencakup komisi dari {view.summary.units} unit
							dalam semua status selain dibatalkan; yang masih menunggu atau ditahan bisa dibatalkan bila pesanan batal,
							diretur, atau direfund. Saldo per status ada di bawah.
						</p>
					</div>
					<dl className="aff-facts aff-facts-row">
						<div>
							<dt>Kunjungan pertama lewat tautan</dt>
							<dd data-testid="summary-clicks">{view.summary.clicks}</dd>
						</div>
						<div>
							<dt>Pesanan teratribusi</dt>
							<dd data-testid="summary-orders">{view.summary.orders}</dd>
						</div>
						<div>
							<dt>Unit dibatalkan</dt>
							<dd>{view.summary.reversedUnits}</dd>
						</div>
					</dl>
					<p className="aff-hint">
						Kunjungan dihitung sekali per pengunjung selama masa atribusi 7 hari; kunjungan berulang dari
						pengunjung yang sama tidak dihitung lagi.
					</p>

					<h3>Saldo menurut status</h3>
					<ul className="aff-states" aria-label="Saldo komisi menurut status">
						{view.states.map((state) => (
							<li key={state.key} data-testid={`balance-card-${state.key}`} data-state={state.key}>
								<span className="aff-state-name">{state.label}</span>
								<strong className="aff-state-amount">{state.amount}</strong>
								<span className="aff-state-note">{state.note}</span>
							</li>
						))}
					</ul>
					<p className="aff-hint">
						Lima status ini tidak dijumlahkan. Hanya yang siap cair yang bisa masuk antrean transfer.
					</p>
				</section>

				<section id="komisi" className="aff-section" aria-labelledby="aff-h-komisi">
					<h2 id="aff-h-komisi">Komisi per unit</h2>
					<form className="aff-filter" method="get" action="/afiliasi#komisi">
						<input type="hidden" name="periode" value={period} />
						<label htmlFor="aff-status">Status</label>
						<select id="aff-status" name="status" defaultValue={status ?? ""}>
							<option value="">Semua status</option>
							{COMMISSION_STATES.map((key) => (
								<option key={key} value={key}>
									{STATE_LABEL[key]}
								</option>
							))}
						</select>
						<button type="submit" className="button button-secondary">
							Terapkan
						</button>
					</form>
					<p className="aff-hint">
						Periode {periodLabel.toLowerCase()} menurut tanggal penjualan. Ubah periode di bagian Ringkasan.
					</p>
					{view.commissions.length === 0 ? (
						<p className="aff-empty">
							{status || period !== "semua"
								? "Tidak ada komisi untuk filter ini."
								: "Belum ada pesanan lewat tautan Anda. Bagikan tautan dari bagian Tautan dan kode."}
						</p>
					) : (
						<ul className="aff-rows" data-testid="commission-history-list">
							{view.commissions.map((row) => (
								<li key={row.id} data-testid={`commission-row-${row.status}`} data-status={row.status}>
									<div className="aff-row-head">
										<strong>{row.product}</strong>
										<strong>{row.amount}</strong>
									</div>
									<div className="aff-row-meta">
										<span className="aff-badge" data-tone={row.status === "void" ? "warn" : row.status === "held" ? "hold" : "ok"}>
											{row.statusLabel}
										</span>
										<span>Ref {row.reference} · tarif {row.rate}</span>
									</div>
									<p className="aff-row-note">{row.note}</p>
									<p className="aff-hint">
										Terjual {row.soldAt}
										{row.receivedAt ? ` · diterima ${row.receivedAt}` : ""}
									</p>
								</li>
							))}
						</ul>
					)}
					{page.nextCursor ? (
						<p>
							<Link
								className="button button-secondary"
								href={href({ periode: period, status, setelah: page.nextCursor }, "komisi")}
								scroll={false}
							>
								Komisi lebih lama
							</Link>
						</p>
					) : null}
					{cursor ? (
						<p>
							<Link className="aff-link" href={href({ periode: period, status }, "komisi")} scroll={false}>
								Kembali ke komisi terbaru
							</Link>
						</p>
					) : null}
				</section>

				<section id="tautan" className="aff-section" aria-labelledby="aff-h-tautan">
					<h2 id="aff-h-tautan">Tautan dan kode</h2>
					<AffiliateLinkTools url={profile.referral_url} code={profile.referral_code} />
					<dl className="aff-facts">
						<div>
							<dt>Tarif komisi saat ini</dt>
							<dd data-testid="affiliate-rate-bps">
								{formatBpsPercent(profile.rate_basis_points)}, paling banyak {rupiah(unitCommissionIdr)} per unit
							</dd>
						</div>
						<div>
							<dt>Atribusi</dt>
							<dd>Pesanan dikaitkan ke pembeli yang pertama kali membuka tautan dalam 7 hari terakhir</dd>
						</div>
					</dl>
				</section>

				<section id="penarikan" className="aff-section" aria-labelledby="aff-h-penarikan">
					<h2 id="aff-h-penarikan">Penarikan</h2>
					<ul className="aff-rules">
						<li>Komisi matang 10 hari setelah paket diterima pembeli. Bila ada penukaran, hitungan 10 hari mulai lagi untuk unit itu.</li>
						<li>Retur atau klaim yang sedang diproses menahan komisi. Refund membatalkannya.</li>
						<li>Saldo siap cair minimal {rupiah(balance.minimum_payout)} masuk antrean otomatis.</li>
						<li>Keuangan mentransfer secara manual sesuai jadwal. Tidak ada tombol tarik, dan waktu transfer tidak dijanjikan.</li>
					</ul>

					<h3>Rekening tujuan</h3>
					{profile.beneficiary ? (
						<dl className="aff-facts">
							<div>
								<dt>Status</dt>
								<dd data-testid="beneficiary-status-badge">{beneficiaryStatusLabel(profile.beneficiary_status)}</dd>
							</div>
							<div>
								<dt>Bank</dt>
								<dd data-testid="beneficiary-bank-name">{profile.beneficiary.bank_name}</dd>
							</div>
							<div>
								<dt>Nomor rekening</dt>
								<dd className="aff-mono" data-testid="beneficiary-masked-account">
									{profile.beneficiary.masked_account}
								</dd>
							</div>
							<div>
								<dt>Nama pemilik</dt>
								<dd>{profile.beneficiary.account_holder_name}</dd>
							</div>
						</dl>
					) : (
						<p data-testid="beneficiary-status-badge">
							Rekening tujuan belum diatur. Tanpa rekening terverifikasi, saldo siap cair tidak masuk antrean.
						</p>
					)}
					<details className="aff-details">
						<summary>Ubah rekening tujuan</summary>
						<p className="aff-hint">
							Perubahan meminta kata sandi lagi dan hanya berlaku untuk pencairan berikutnya. Antrean yang
							sudah diklaim tetap memakai rekening sebelumnya.
						</p>
						<BeneficiaryForm affiliateId={profile.id} />
					</details>

					<h3>Riwayat pencairan</h3>
					{view.payouts.length === 0 ? (
						<p className="aff-empty">Belum ada pencairan.</p>
					) : (
						<ul className="aff-rows" data-testid="payout-history-list">
							{payouts.map((payout, index) => (
								<li key={payout.id} data-testid={`payout-row-${payout.status}`}>
									<div className="aff-row-head">
										<strong>{view.payouts[index].amount}</strong>
										<span className="aff-badge" data-tone="ok">
											{payoutStatusLabel(payout.status)}
										</span>
									</div>
									<p className="aff-row-note">{view.payouts[index].explanation}</p>
									<p className="aff-hint">
										Dijadwalkan {view.payouts[index].createdAt}
										{view.payouts[index].completedAt ? ` · selesai ${view.payouts[index].completedAt}` : ""}
									</p>
								</li>
							))}
						</ul>
					)}
				</section>

				<section id="bantuan" className="aff-section" aria-labelledby="aff-h-bantuan">
					<h2 id="aff-h-bantuan">Bantuan</h2>
					<dl className="aff-faq">
						<dt>Mengapa komisi dibatalkan?</dt>
						<dd>Komisi dibatalkan bila pesanan batal, barang diretur dan direfund, COD tidak diterima, atau pesanan tidak terkirim. Alasannya tertulis di tiap baris.</dd>
						<dt>Mengapa komisi tidak muncul?</dt>
						<dd>Pesanan hanya dikaitkan ke pembeli yang pertama kali membuka tautan dalam 7 hari terakhir. Bila pembeli sudah membawa tautan mitra lain, atau lebih dari 7 hari, pesanan tidak masuk ke Anda.</dd>
						<dt>Kapan transfer masuk?</dt>
						<dd>Setelah komisi matang dan saldo siap cair mencapai batas minimum, keuangan mentransfer secara manual. Status tiap transfer ada di Riwayat pencairan.</dd>
					</dl>
					<p>
						<Link className="button button-secondary" href="/bantuan#percakapan">
							Hubungi kami
						</Link>
					</p>
				</section>
			</main>
		</Shell>
	);
}
