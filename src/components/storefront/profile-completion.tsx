"use client";

import { useEffect, useRef, useState } from "react";
import type {
	ConsentChannel,
	Gender,
	MarketingConsentResponse,
	ProfileDetailsResponse,
} from "@/modules/accounts/profile-completion";
import type {
	BuyerAddressListResponse,
	BuyerProfileResponse,
} from "@/modules/accounts/service";
import {
	displayPhone,
	looksLikeWhatsApp,
	maskedPhone,
	WHATSAPP_HINT,
} from "@/modules/storefront/contact";
import { filterContact } from "./ui/contact-fields";

// S126 / DEC-017 "Lengkapi profil" and the promo opt-ins on /akun. Every field is optional, says why it is asked,
// and can be changed or deleted. Promo consent is per channel, never prefilled, and saved only when the buyer ticks it.

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
type Props = CompletionData & {
	profile: BuyerProfileResponse;
	addresses: BuyerAddressListResponse | null;
	onAddresses: (list: BuyerAddressListResponse) => void;
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
	profile,
	addresses,
	onAddresses,
	onStatus,
	details: initial,
	categories,
	destinations,
}: Props) {
	const [details, setDetails] = useState(initial);
	const { busy, run } = useBusy(onStatus);
	const main = addresses?.data.find((item) => item.is_default) ?? null;
	// Address and WhatsApp live in their own resources; the progress reflects what this page shows now.
	const fields = {
		...details.completion.fields,
		main_address: Boolean(main),
		whatsapp: Boolean(profile.phone),
	};
	const completed = Object.values(fields).filter(Boolean).length;
	const total = Object.keys(fields).length;

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
		<span
			className="receipt-badge"
			data-tone={fields[key] ? "active" : undefined}
			data-testid={`completion-state-${key}`}
		>
			{fields[key] ? "Terisi" : "Belum diisi"}
		</span>
	);

	return (
		<section
			className="receipt-card"
			aria-labelledby="profile-completion-heading"
			data-testid="profile-completion"
		>
			<h2 id="profile-completion-heading">Lengkapi profil</h2>
			<p className="checkout-hint">
				Semua isian opsional dan bisa diubah atau dihapus kapan saja. Belanja
				tetap bisa tanpa mengisinya.
			</p>
			<div>
				<label
					htmlFor="profile-completion-progress"
					style={{ fontWeight: 600 }}
				>
					<span data-testid="completion-count">
						{completed} dari {total} terisi
					</span>
				</label>
				<progress
					id="profile-completion-progress"
					value={completed}
					max={total}
					style={{ width: "100%", height: "8px", accentColor: "var(--purple)" }}
				/>
			</div>

			<details data-testid="completion-main-address">
				<summary>
					<strong>Alamat utama</strong> {rowsDone("main_address")}
				</summary>
				<p className="checkout-hint">
					Checkout langsung terisi dan ongkir bisa dihitung tanpa mengetik
					ulang.
				</p>
				<AddressForm
					key={main ? `${main.id}-${main.version}` : "new"}
					main={main}
					addresses={addresses}
					destinations={destinations}
					profile={profile}
					onAddresses={onAddresses}
					onStatus={onStatus}
				/>
			</details>

			<details data-testid="completion-whatsapp">
				<summary>
					<strong>Nomor WhatsApp</strong> {rowsDone("whatsapp")}
				</summary>
				<p className="checkout-hint">
					Untuk kabar pesanan, dan promo WhatsApp hanya bila Anda menyetujuinya
					di bagian Promo.{" "}
					<a href="#account-profile-heading">Ubah di bagian Profil</a>.
				</p>
			</details>

			<details data-testid="completion-birthday">
				<summary>
					<strong>Tanggal lahir</strong> {rowsDone("birthday")}
				</summary>
				<p className="checkout-hint">
					Untuk voucher ulang tahun. Tahun lahir boleh dikosongkan.
				</p>
				<form onSubmit={submitBirthday} noValidate>
					<div
						style={{
							display: "grid",
							gap: "12px",
							gridTemplateColumns:
								"repeat(auto-fit, minmax(min(100%, 9rem), 1fr))",
						}}
					>
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
					<fieldset
						style={{
							border: 0,
							margin: 0,
							padding: 0,
							display: "grid",
							gap: "4px",
						}}
					>
						<legend className="checkout-hint">Jenis kelamin</legend>
						{(Object.keys(GENDER_LABEL) as Gender[]).map((value) => (
							<label
								key={value}
								style={{
									display: "flex",
									gap: "10px",
									alignItems: "center",
									minHeight: "44px",
									fontWeight: 500,
								}}
							>
								<input
									type="radio"
									name="gender"
									value={value}
									checked={gender === value}
									onChange={() => setGender(value)}
									style={{
										width: "20px",
										height: "20px",
										accentColor: "var(--purple)",
									}}
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
						<fieldset
							style={{
								border: 0,
								margin: 0,
								padding: 0,
								display: "grid",
								gap: "2px",
							}}
						>
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

			<div className="checkout-hint" data-testid="profile-programs">
				<p>
					<strong>Voucher ulang tahun dan promo kategori:</strong> ketentuannya
					sedang disiapkan dan akan diumumkan di sini.
				</p>
				<p>
					<strong>Doorprize:</strong> segera.
				</p>
			</div>
			{(details.birth_day !== null ||
				details.gender !== null ||
				details.favourite_category_ids.length > 0) && (
				<button
					type="button"
					className="button button-secondary"
					disabled={busy}
					data-testid="profile-details-delete-all"
					style={{ justifySelf: "start" }}
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

function AddressForm({
	main,
	addresses,
	destinations,
	profile,
	onAddresses,
	onStatus,
}: {
	main: BuyerAddressListResponse["data"][number] | null;
	addresses: BuyerAddressListResponse | null;
	destinations: Destination[];
	profile: BuyerProfileResponse;
	onAddresses: (list: BuyerAddressListResponse) => void;
	onStatus: (message: string) => void;
}) {
	const { busy, run } = useBusy(onStatus);
	const [recipient, setRecipient] = useState(
		main?.address.recipient_name ?? profile.display_name,
	);
	const [phone, setPhone] = useState(
		displayPhone(main?.address.phone ?? profile.phone),
	);
	const [destination, setDestination] = useState(
		destinations.find((d) => d.id === main?.address.destination_code)?.id ?? "",
	);
	const [street, setStreet] = useState(main?.address.street ?? "");
	const reload = async () => {
		const res = await fetch("/api/v1/me/addresses?limit=50");
		if (res.ok) onAddresses((await res.json()) as BuyerAddressListResponse);
	};

	function submit(event: React.FormEvent) {
		event.preventDefault();
		const picked = destinations.find((d) => d.id === destination);
		if (!recipient.trim() || !street.trim() || !picked)
			return onStatus("Isi nama penerima, wilayah, dan alamat lengkap.");
		if (!looksLikeWhatsApp(phone))
			return onStatus("Nomor HP penerima diawali 08 (nomor seluler).");
		const address = {
			label: main?.address.label ?? "Alamat utama",
			recipient_name: recipient.trim(),
			phone,
			street: street.trim(),
			district: picked.district,
			city: picked.city,
			province: picked.province,
			postcode: picked.postal_code,
			destination_code: picked.id,
		};
		run(async () => {
			const res = main
				? await send(`/api/v1/me/addresses/${main.id}`, {
						expected_version: main.version,
						address,
					})
				: await send("/api/v1/me/addresses", {
						address,
						make_default: true,
						expected_book_version: addresses?.book_version ?? 0,
					});
			if (!res.ok) {
				const code = await problemCode(res);
				onStatus(
					code === "INVALID_INDONESIAN_PHONE"
						? WHATSAPP_HINT
						: code?.endsWith("VERSION_CONFLICT")
							? "Alamat berubah di tab lain. Muat ulang halaman lalu coba lagi."
							: "Gagal menyimpan alamat.",
				);
				return;
			}
			await reload();
			onStatus("Alamat utama disimpan.");
		});
	}

	function remove() {
		if (!main || !addresses) return;
		// Another saved address becomes the main one; the deleted address keeps no personal data.
		const replacement =
			addresses.data.find((item) => item.id !== main.id) ?? null;
		run(async () => {
			const res = await send(`/api/v1/me/addresses/${main.id}/deletions`, {
				expected_version: main.version,
				expected_book_version: addresses.book_version,
				replacement_default_id: replacement?.id ?? null,
			});
			if (!res.ok)
				return onStatus(
					"Gagal menghapus alamat. Muat ulang halaman lalu coba lagi.",
				);
			await reload();
			onStatus(
				replacement
					? "Alamat dihapus. Alamat lain menjadi alamat utama."
					: "Alamat utama dihapus.",
			);
		});
	}

	return (
		<form onSubmit={submit} noValidate data-testid="main-address-form">
			<label>
				Nama penerima
				<input
					value={recipient}
					onChange={(e) => setRecipient(e.target.value)}
					maxLength={120}
					autoComplete="shipping name"
				/>
			</label>
			<label>
				Nomor HP penerima
				<input
					type="tel"
					inputMode="numeric"
					maxLength={24}
					autoComplete="shipping tel"
					placeholder="08…"
					value={phone}
					onChange={(e) => setPhone(filterContact(e))}
				/>
			</label>
			<label>
				Wilayah pengiriman
				<select
					value={destination}
					onChange={(e) => setDestination(e.target.value)}
					data-testid="main-address-destination"
				>
					<option value="">Pilih wilayah</option>
					{destinations.map((d) => (
						<option key={d.id} value={d.id}>
							{d.district}, {d.city}, {d.province} {d.postal_code}
						</option>
					))}
				</select>
			</label>
			<label>
				Alamat lengkap
				<textarea
					rows={3}
					maxLength={240}
					autoComplete="shipping street-address"
					value={street}
					onChange={(e) => setStreet(e.target.value)}
					data-testid="main-address-street"
				/>
			</label>
			<div className="notice-actions">
				<button
					type="submit"
					className="button"
					disabled={busy}
					data-testid="main-address-save"
				>
					{main ? "Simpan alamat utama" : "Tambah alamat utama"}
				</button>
				{main && (
					<button
						type="button"
						className="button button-secondary"
						disabled={busy}
						onClick={remove}
						data-testid="main-address-delete"
					>
						Hapus alamat
					</button>
				)}
			</div>
		</form>
	);
}

/** Promo opt-ins: one unticked checkbox per channel; ticking grants under the shown policy version, unticking withdraws. */
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
		whatsapp: profile.phone
			? `Promo lewat WhatsApp ke ${maskedPhone(profile.phone)}`
			: "Promo lewat WhatsApp",
		email: profile.email
			? `Promo lewat email ke ${profile.email}`
			: "Promo lewat email",
	};
	return (
		<section
			className="receipt-card"
			aria-labelledby="promo-consent-heading"
			data-testid="promo-consents"
		>
			<h2 id="promo-consent-heading">Promo</h2>
			<p className="checkout-hint">
				Kami mengirim promo hanya lewat saluran yang Anda centang. Kabar pesanan
				tetap terkirim tanpa persetujuan ini. Bisa dibatalkan kapan saja.{" "}
				<a href="/privasi">Kebijakan privasi</a> ({consents.policy_version}).
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
						{item.granted && item.granted_at
							? `Disetujui ${date(item.granted_at)} (kebijakan ${item.policy_version}).`
							: item.contact_available
								? "Belum disetujui."
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
