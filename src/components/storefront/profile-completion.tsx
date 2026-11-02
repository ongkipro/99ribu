"use client";

import { useEffect, useRef, useState } from "react";
import type {
	ConsentChannel,
	Gender,
	MarketingConsentResponse,
	ProfileDetailsResponse,
} from "@/modules/accounts/profile-completion";
import { maskedEmail } from "@/modules/accounts/masking";
import type { BuyerProfileResponse } from "@/modules/accounts/service";
import { maskedPhone } from "@/modules/storefront/contact";

// Optional buyer details and channel-specific promo consent on /akun.
// Every field can be changed or deleted; promo consent is never prefilled.

export type Destination = {
	id: string;
	province: string;
	city: string;
	district: string;
	postal_code: string;
};
export type CompletionData = {
	details: ProfileDetailsResponse;
	consents: MarketingConsentResponse;
	categories: { id: string; name: string }[];
	destinations: Destination[];
};
type Props = Pick<CompletionData, "details" | "categories"> & {
	onStatus: (message: string) => void;
};

const MONTHS = [
	"Januari",
	"Februari",
	"Maret",
	"April",
	"Mei",
	"Juni",
	"Juli",
	"Agustus",
	"September",
	"Oktober",
	"November",
	"Desember",
];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const GENDER_LABEL: Record<Gender, string> = {
	male: "Pria",
	female: "Wanita",
	undisclosed: "Tidak ingin menyebutkan",
};
const date = (value: string) =>
	new Intl.DateTimeFormat("id-ID", {
		dateStyle: "medium",
		timeZone: "Asia/Jakarta",
	}).format(new Date(value));
const send = (path: string, body: unknown) =>
	fetch(path, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": crypto.randomUUID(),
		},
		body: JSON.stringify(body),
	});
const problemCode = async (res: Response) =>
	((await res.json().catch(() => null)) as { code?: string } | null)?.code;

function useBusy(onStatus: (message: string) => void) {
	const [busy, setBusy] = useState(false);
	const ref = useRef(false);
	const run = (task: () => Promise<void>) => {
		if (ref.current) return;
		ref.current = true;
		setBusy(true);
		void task()
			.catch(() =>
				onStatus("Tidak bisa terhubung. Periksa koneksi lalu coba lagi."),
			)
			.finally(() => {
				ref.current = false;
				setBusy(false);
			});
	};
	return { busy, run };
}

export function ProfileCompletion({
	onStatus,
	details: initial,
	categories,
}: Props) {
	const [details, setDetails] = useState(initial);
	const { busy, run } = useBusy(onStatus);
	const fields = details.completion.fields;

	const [day, setDay] = useState(String(initial.birth_day ?? ""));
	const [month, setMonth] = useState(String(initial.birth_month ?? ""));
	const [year, setYear] = useState(String(initial.birth_year ?? ""));
	const [gender, setGender] = useState<Gender | "">(initial.gender ?? "");
	const [favourites, setFavourites] = useState(initial.favourite_category_ids);
	const offered = new Set(categories.map((c) => c.id));

	function saveDetails(
		patch: Partial<Omit<ProfileDetailsResponse, "version" | "completion">>,
		done: string,
	) {
		run(async () => {
			const body = {
				expected_version: details.version,
				birth_day: details.birth_day,
				birth_month: details.birth_month,
				birth_year: details.birth_year,
				gender: details.gender,
				// A favourite that left the catalog is dropped on the next save.
				favourite_category_ids: details.favourite_category_ids.filter((id) =>
					offered.has(id),
				),
				...patch,
			};
			const res = await send("/api/v1/me/profile-details", body);
			if (res.ok) {
				const next = (await res.json()) as ProfileDetailsResponse;
				setDetails(next);
				setDay(String(next.birth_day ?? ""));
				setMonth(String(next.birth_month ?? ""));
				setYear(String(next.birth_year ?? ""));
				setGender(next.gender ?? "");
				setFavourites(next.favourite_category_ids);
				onStatus(done);
				return;
			}
			const code = await problemCode(res);
			onStatus(
				code === "INVALID_BIRTHDAY"
					? "Tanggal lahir tidak valid. Periksa tanggal dan bulan."
					: code === "UNDER_MINIMUM_AGE"
						? "Maaf, akun 99ribu hanya untuk usia 18 tahun ke atas. Tanggal lahir tidak disimpan."
						: code === "PROFILE_VERSION_CONFLICT"
							? "Profil berubah di tab lain. Muat ulang halaman lalu coba lagi."
							: code === "CATEGORY_UNAVAILABLE"
								? "Salah satu kategori sudah tidak tersedia. Muat ulang halaman."
								: "Gagal menyimpan profil.",
			);
		});
	}

	function submitBirthday(event: React.FormEvent) {
		event.preventDefault();
		if (!day || !month) {
			onStatus("Pilih tanggal dan bulan lahir.");
			return;
		}
		const birthYear = year.trim() ? Number(year) : null;
		if (
			birthYear !== null &&
			(!Number.isInteger(birthYear) ||
				birthYear < 1900 ||
				birthYear > new Date().getFullYear())
		) {
			onStatus("Tahun lahir tidak valid. Kosongkan bila tidak ingin mengisi.");
			return;
		}
		saveDetails(
			{
				birth_day: Number(day),
				birth_month: Number(month),
				birth_year: birthYear,
			},
			"Tanggal lahir disimpan.",
		);
	}

	const rowsDone = (key: keyof typeof fields) => (
		// A badge only for a filled field; an empty one is quiet text, so four empty rows do not shout.
		<span
			className={fields[key] ? "receipt-badge" : "account-empty-state"}
			data-tone={fields[key] ? "active" : undefined}
			data-testid={`completion-state-${key}`}
		>
			{fields[key] ? "Terisi" : "Belum diisi"}
		</span>
	);

	return (
		<section
			className="account-section account-profile-details"
			aria-labelledby="profile-completion-heading"
			data-testid="profile-completion"
		>
			<h2 id="profile-completion-heading">Data tambahan</h2>
			<p className="checkout-hint">Opsional. Bisa diubah atau dihapus kapan saja.</p>

			<details data-testid="completion-birthday">
				<summary>
					<strong>Tanggal lahir</strong> {rowsDone("birthday")}
				</summary>
				<p className="checkout-hint">
					Untuk voucher ulang tahun. Tahun lahir boleh dikosongkan.
				</p>
				<form onSubmit={submitBirthday} noValidate>
					<div className="profile-field-grid">
						<label>
							Tanggal
							<select
								value={day}
								onChange={(e) => setDay(e.target.value)}
								data-testid="birth-day"
							>
								<option value="">Pilih</option>
								{DAYS.map((d) => (
									<option key={d} value={d}>
										{d}
									</option>
								))}
							</select>
						</label>
						<label>
							Bulan
							<select
								value={month}
								onChange={(e) => setMonth(e.target.value)}
								data-testid="birth-month"
							>
								<option value="">Pilih</option>
								{MONTHS.map((name, i) => (
									<option key={name} value={i + 1}>
										{name}
									</option>
								))}
							</select>
						</label>
						<label>
							Tahun (opsional)
							<input
								inputMode="numeric"
								maxLength={4}
								autoComplete="bday-year"
								value={year}
								onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
								data-testid="birth-year"
							/>
						</label>
					</div>
					<div className="notice-actions">
						<button
							type="submit"
							className="button"
							disabled={busy}
							data-testid="birthday-save"
						>
							Simpan tanggal lahir
						</button>
						{details.birth_day !== null && (
							<button
								type="button"
								className="button button-secondary"
								disabled={busy}
								data-testid="birthday-delete"
								onClick={() =>
									saveDetails(
										{ birth_day: null, birth_month: null, birth_year: null },
										"Tanggal lahir dihapus.",
									)
								}
							>
								Hapus
							</button>
						)}
					</div>
				</form>
			</details>

			<details data-testid="completion-gender">
				<summary>
					<strong>Jenis kelamin</strong> {rowsDone("gender")}
				</summary>
				<p className="checkout-hint">
					Untuk rekomendasi produk yang lebih sesuai.
				</p>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (!gender) return onStatus("Pilih salah satu jawaban.");
						saveDetails({ gender }, "Jenis kelamin disimpan.");
					}}
				>
					<fieldset className="profile-fieldset">
						<legend className="checkout-hint">Jenis kelamin</legend>
						{(Object.keys(GENDER_LABEL) as Gender[]).map((value) => (
							<label key={value} className="profile-radio">
								<input
									type="radio"
									name="gender"
									value={value}
									checked={gender === value}
									onChange={() => setGender(value)}
								/>
								{GENDER_LABEL[value]}
							</label>
						))}
					</fieldset>
					<div className="notice-actions">
						<button
							type="submit"
							className="button"
							disabled={busy}
							data-testid="gender-save"
						>
							Simpan jenis kelamin
						</button>
						{details.gender !== null && (
							<button
								type="button"
								className="button button-secondary"
								disabled={busy}
								data-testid="gender-delete"
								onClick={() =>
									saveDetails({ gender: null }, "Jenis kelamin dihapus.")
								}
							>
								Hapus
							</button>
						)}
					</div>
				</form>
			</details>

			<details data-testid="completion-categories">
				<summary>
					<strong>Kategori favorit</strong> {rowsDone("favourite_categories")}
				</summary>
				<p className="checkout-hint">
					Untuk promo kategori yang Anda minati. Pilih hingga 5.
				</p>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						saveDetails(
							{
								favourite_category_ids: favourites.filter((id) =>
									offered.has(id),
								),
							},
							"Kategori favorit disimpan.",
						);
					}}
				>
					{categories.length === 0 ? (
						<p className="checkout-hint">
							Belum ada kategori yang bisa dipilih.
						</p>
					) : (
						<fieldset className="profile-fieldset profile-fieldset-tight">
							<legend className="checkout-hint">
								Kategori favorit (
								{favourites.filter((id) => offered.has(id)).length}/5)
							</legend>
							{categories.map((category) => {
								const checked = favourites.includes(category.id);
								return (
									<label key={category.id}>
										<input
											type="checkbox"
											checked={checked}
											disabled={
												!checked &&
												favourites.filter((id) => offered.has(id)).length >= 5
											}
											onChange={() =>
												setFavourites((prev) =>
													checked
														? prev.filter((id) => id !== category.id)
														: [...prev, category.id],
												)
											}
										/>
										{category.name}
									</label>
								);
							})}
						</fieldset>
					)}
					<div className="notice-actions">
						<button
							type="submit"
							className="button"
							disabled={busy || categories.length === 0}
							data-testid="categories-save"
						>
							Simpan kategori
						</button>
						{details.favourite_category_ids.length > 0 && (
							<button
								type="button"
								className="button button-secondary"
								disabled={busy}
								data-testid="categories-delete"
								onClick={() =>
									saveDetails(
										{ favourite_category_ids: [] },
										"Kategori favorit dihapus.",
									)
								}
							>
								Hapus
							</button>
						)}
					</div>
				</form>
			</details>

			<p className="checkout-hint" data-testid="profile-programs">
				<strong>Doorprize:</strong> segera.
			</p>
			{(details.birth_day !== null ||
				details.gender !== null ||
				details.favourite_category_ids.length > 0) && (
				<button
					type="button"
					className="button button-secondary profile-delete-all"
					disabled={busy}
					data-testid="profile-details-delete-all"
					onClick={() =>
						saveDetails(
							{
								birth_day: null,
								birth_month: null,
								birth_year: null,
								gender: null,
								favourite_category_ids: [],
							},
							"Tanggal lahir, jenis kelamin, dan kategori favorit dihapus.",
						)
					}
				>
					Hapus tanggal lahir, jenis kelamin, dan kategori
				</button>
			)}
		</section>
	);
}

export function PromoConsents({
	initial,
	profile,
	onStatus,
}: {
	initial: MarketingConsentResponse;
	profile: BuyerProfileResponse;
	onStatus: (message: string) => void;
}) {
	const [consents, setConsents] = useState(initial);
	const { busy, run } = useBusy(onStatus);
	// A changed or cleared contact withdraws its consent on the server; reread after the profile changes.
	const contactKey = `${profile.phone ?? ""}|${profile.email ?? ""}|${profile.version}`;
	const firstKey = useRef(contactKey);
	useEffect(() => {
		if (contactKey === firstKey.current) return;
		firstKey.current = contactKey;
		void fetch("/api/v1/me/marketing-consents")
			.then(async (res) =>
				res.ok
					? setConsents((await res.json()) as MarketingConsentResponse)
					: undefined,
			)
			.catch(() => undefined);
	}, [contactKey]);

	function toggle(channel: ConsentChannel, granted: boolean) {
		run(async () => {
			const res = await send("/api/v1/me/marketing-consents", {
				channel,
				granted,
				policy_version: consents.policy_version,
			});
			if (res.ok) {
				setConsents((await res.json()) as MarketingConsentResponse);
				onStatus(
					granted
						? "Persetujuan promo disimpan."
						: "Persetujuan promo dibatalkan.",
				);
				return;
			}
			const code = await problemCode(res);
			onStatus(
				code === "CONTACT_REQUIRED"
					? "Tambahkan kontaknya dulu di bagian Profil."
					: code === "CONSENT_POLICY_CHANGED"
						? "Kebijakan privasi diperbarui. Muat ulang halaman untuk membaca versi terbaru."
						: "Gagal menyimpan persetujuan promo.",
			);
		});
	}

	const label: Record<ConsentChannel, string> = {
		whatsapp: "Promo lewat WhatsApp",
		email: "Promo lewat email",
	};
	// The contact a channel would use, shown under its checkbox (short label, masked phone).
	const destination: Record<ConsentChannel, string | null> = {
		whatsapp: profile.phone ? maskedPhone(profile.phone) : null,
		email: maskedEmail(profile.email),
	};
	return (
		<section
			className="account-promo"
			aria-labelledby="promo-consent-heading"
			data-testid="promo-consents"
		>
			<h3 id="promo-consent-heading">Promo</h3>
			<p className="checkout-hint">
				Kami mengirim promo hanya lewat saluran yang Anda centang. Kabar pesanan
				tetap terkirim tanpa persetujuan ini. Bisa dibatalkan kapan saja.{" "}
				<a href="/privasi">Kebijakan privasi</a>.
			</p>
			{consents.channels.map((item) => (
				<div key={item.channel}>
					<label>
						<input
							type="checkbox"
							checked={item.granted}
							disabled={busy || (!item.granted && !item.contact_available)}
							data-testid={`consent-${item.channel}`}
							aria-describedby={`consent-${item.channel}-state`}
							onChange={(e) => toggle(item.channel, e.currentTarget.checked)}
						/>
						{label[item.channel]}
					</label>
					<p
						id={`consent-${item.channel}-state`}
						className="checkout-hint"
						data-testid={`consent-${item.channel}-state`}
					>
						{/* The policy version is kept on the consent record and in the history, not in this line. */}
						{item.granted && item.granted_at
							? `Disetujui ${date(item.granted_at)}${destination[item.channel] ? ` · ${destination[item.channel]}` : ""}.`
							: item.contact_available
								? `Belum disetujui${destination[item.channel] ? ` · ${destination[item.channel]}` : ""}.`
								: item.channel === "whatsapp"
									? "Tambahkan nomor WhatsApp di bagian Profil untuk memilih ini."
									: "Promo email hanya dikirim ke email akun yang sudah terverifikasi."}
					</p>
				</div>
			))}
			{consents.history.length > 0 && (
				<details data-testid="consent-history">
					<summary>Riwayat persetujuan</summary>
					<ul className="receipt-parcel-items">
						{consents.history.map((item) => (
							<li key={`${item.channel}-${item.granted_at}`}>
								{item.channel === "whatsapp" ? "WhatsApp" : "Email"}: disetujui{" "}
								{date(item.granted_at)}
								{item.withdrawn_at
									? `, dibatalkan ${date(item.withdrawn_at)}`
									: ""}{" "}
								· kebijakan {item.policy_version}
							</li>
						))}
					</ul>
				</details>
			)}
		</section>
	);
}
