"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { maskedEmail } from "@/modules/accounts/masking";
import type { AccountOrder } from "@/modules/accounts/order-summary";
import type {
	BuyerAddressListResponse,
	BuyerProfileResponse,
	NotificationPreferenceResponse,
	PrivateNotificationResponse,
} from "@/modules/accounts/service";
import { AccountNavigation, type AccountView } from "./account/navigation";
import { AccountOrders } from "./account/orders";
import {
	displayPhone,
	looksLikeWhatsApp,
	maskedPhone,
	WHATSAPP_HINT,
	WHATSAPP_PATTERN,
} from "@/modules/storefront/contact";
import { SignOutButton } from "./sign-out-button";
import {
	type CompletionData,
	ProfileAddress,
	ProfileCompletion,
	PromoConsents,
} from "./profile-completion";
import { EmailSuggestion, filterContact } from "./ui/contact-fields";
import { Icon } from "./ui/icon";

type Props = {
	/** Which account page renders: the three signed-in tabs, or the signed-out sign-in and guest lookup. */
	view: AccountView | "signed-out";
	initialAuthenticated: boolean;
	initialProfile: BuyerProfileResponse | null;
	initialAddresses: BuyerAddressListResponse | null;
	initialPreferences: NotificationPreferenceResponse | null;
	initialNotifications: PrivateNotificationResponse[];
	initialOrders: AccountOrder[];
	// S126: null when signed out or when the completion read failed (the rest of the account still works).
	initialCompletion?: CompletionData | null;
};

export function BuyerAccountClient({
	view,
	initialAuthenticated,
	initialProfile,
	initialAddresses,
	initialPreferences,
	initialNotifications,
	initialOrders,
	initialCompletion = null,
}: Props) {
	const [profile, setProfile] = useState(initialProfile);
	const [addresses, setAddresses] = useState(initialAddresses);
	const [preferences, setPreferences] = useState(initialPreferences);
	const [notifications, setNotifications] = useState(initialNotifications);
	const [displayName, setDisplayName] = useState(
		initialProfile?.display_name ?? "",
	);
	const [statusMsg, setStatusMsg] = useState<string | null>(null);
	const [editingPhone, setEditingPhone] = useState(false);
	// The profile shows as a summary; its form opens on "Ubah" and closes after a save.
	const [editingProfile, setEditingProfile] = useState(false);
	const [phone, setPhone] = useState("");
	// One action at a time: every account action shares one busy state, so a double click or a
	// second control cannot send a duplicate request (fresh idempotency keys would not dedupe it,
	// and preference toggles would reuse a stale version). A network failure shows a message.
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const guard =
		<A extends unknown[]>(task: (...args: A) => Promise<void>) =>
		(...args: A) => {
			const first = args[0] as { preventDefault?: () => void } | undefined;
			if (
				first &&
				typeof first === "object" &&
				typeof first.preventDefault === "function"
			)
				first.preventDefault();
			if (busyRef.current) return;
			busyRef.current = true;
			setBusy(true);
			void task(...args)
				.catch(() =>
					setStatusMsg("Tidak bisa terhubung. Periksa koneksi lalu coba lagi."),
				)
				.finally(() => {
					busyRef.current = false;
					setBusy(false);
				});
		};

	const [sessionPassword, setSessionPassword] = useState("");

	// Guest order recovery form state (available even when unauthenticated)
	const [guestOrderId, setGuestOrderId] = useState("");
	const [guestContact, setGuestContact] = useState("");
	const [guestChallengeId, setGuestChallengeId] = useState<string | null>(null);
	const [guestOtp, setGuestOtp] = useState("");
	const [recoveredOrderId, setRecoveredOrderId] = useState<string | null>(null);
	const guestPanel = useRef<HTMLDetailsElement>(null);
	useEffect(() => {
		if (initialAuthenticated) return;
		const desktop = window.matchMedia("(min-width: 701px)");
		const syncDisclosure = () => {
			if (guestPanel.current) guestPanel.current.open = desktop.matches;
		};
		syncDisclosure();
		desktop.addEventListener("change", syncDisclosure);
		return () => desktop.removeEventListener("change", syncDisclosure);
	}, [initialAuthenticated]);

	async function handleProfileSaveRun(e: React.FormEvent) {
		e.preventDefault();
		if (!profile) return;
		if (editingPhone && phone && !looksLikeWhatsApp(phone)) {
			setStatusMsg(WHATSAPP_HINT);
			return;
		}
		const res = await fetch("/api/v1/me/profile", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": crypto.randomUUID(),
			},
			body: JSON.stringify({
				expected_version: profile.version,
				display_name: displayName,
				...(editingPhone ? { phone: phone || null } : {}),
			}),
		});
		if (res.ok) {
			const updated = (await res.json()) as BuyerProfileResponse;
			setProfile(updated);
			setEditingPhone(false);
			setEditingProfile(false);
			setStatusMsg("Profil berhasil diperbarui.");
		} else {
			const problem = (await res.json().catch(() => null)) as {
				code?: string;
			} | null;
			setStatusMsg(
				problem?.code === "INVALID_WHATSAPP" ||
					problem?.code === "INVALID_INDONESIAN_PHONE"
					? WHATSAPP_HINT
					: "Gagal memperbarui profil.",
			);
		}
	}

	async function handleSetDefaultAddressRun(addressId: string) {
		if (!addresses) return;
		const res = await fetch("/api/v1/me/address-default", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": crypto.randomUUID(),
			},
			body: JSON.stringify({
				expected_book_version: addresses.book_version,
				address_id: addressId,
			}),
		});
		if (res.ok) {
			const updated = (await res.json()) as BuyerAddressListResponse;
			setAddresses(updated);
			setStatusMsg("Alamat utama berhasil diperbarui.");
		} else {
			setStatusMsg(
				"Gagal memperbarui alamat utama. Muat ulang halaman lalu coba lagi.",
			);
		}
	}

	async function handleTogglePreferenceRun(
		field:
			| "in_app_order_updates"
			| "in_app_support_updates"
			| "email_order_updates",
	) {
		if (!preferences) return;
		const next = {
			expected_version: preferences.version,
			in_app_order_updates:
				field === "in_app_order_updates"
					? !preferences.in_app_order_updates
					: preferences.in_app_order_updates,
			in_app_support_updates:
				field === "in_app_support_updates"
					? !preferences.in_app_support_updates
					: preferences.in_app_support_updates,
			email_order_updates:
				field === "email_order_updates"
					? !preferences.email_order_updates
					: preferences.email_order_updates,
		};
		const res = await fetch("/api/v1/me/notification-preferences", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": crypto.randomUUID(),
			},
			body: JSON.stringify(next),
		});
		if (res.ok) {
			setPreferences((await res.json()) as NotificationPreferenceResponse);
			setStatusMsg("Preferensi notifikasi disimpan.");
		} else {
			setStatusMsg(
				"Gagal menyimpan preferensi notifikasi. Muat ulang halaman lalu coba lagi.",
			);
		}
	}

	async function handleNotificationStateRun(
		notificationId: string,
		state: "read" | "unread",
	) {
		const res = await fetch(
			`/api/v1/me/notifications/${notificationId}/state`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"idempotency-key": crypto.randomUUID(),
				},
				body: JSON.stringify({ state }),
			},
		);
		if (res.ok) {
			const updated = (await res.json()) as PrivateNotificationResponse;
			setNotifications((prev) =>
				prev.map((n) => (n.id === updated.id ? updated : n)),
			);
		} else {
			setStatusMsg("Gagal memperbarui status notifikasi.");
		}
	}

	async function handleTerminateSessionsRun(scope: "others" | "all") {
		if (!profile) return;
		if (!sessionPassword) {
			setStatusMsg("Masukkan kata sandi akun untuk mengakhiri sesi.");
			return;
		}
		// OpenAPI contract: all_other needs a single-use proof from the password (session.terminate_others, own user id).
		const proofResponse = await fetch("/api/v1/me/reauthentication-proofs", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": crypto.randomUUID(),
			},
			body: JSON.stringify({
				password: sessionPassword,
				action: "session.terminate_others",
				subject_id: profile.id,
			}),
		});
		setSessionPassword("");
		if (!proofResponse.ok) {
			setStatusMsg(
				proofResponse.status === 429
					? "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi."
					: "Kata sandi tidak sesuai.",
			);
			return;
		}
		const { proof } = (await proofResponse.json()) as { proof: string };
		const res = await fetch("/api/v1/me/session-terminations", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": crypto.randomUUID(),
			},
			body: JSON.stringify({
				scope: "all_other",
				reauthentication_proof: proof,
			}),
		});
		if (res.ok && scope === "all") {
			// Every other session is gone; sign-out ends this one, clears its Better Auth cookies and guest context.
			await fetch("/api/auth/sign-out", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			}).catch(() => null);
			window.location.assign("/akun");
			return;
		}
		if (res.ok) {
			setStatusMsg("Sesi perangkat lain telah dihentikan.");
		} else {
			setStatusMsg("Gagal menghentikan sesi.");
		}
	}

	async function handleRequestGuestRecoveryRun(e: React.FormEvent) {
		e.preventDefault();
		const res = await fetch("/api/v1/guest-order-access/challenges", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": crypto.randomUUID(),
			},
			// S118: buyers hold the printed number (99-…); an order id still works for old links.
			body: JSON.stringify({
				...(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
					guestOrderId.trim(),
				)
					? { order_id: guestOrderId.trim() }
					: { order_number: guestOrderId.trim() }),
				contact: guestContact.trim(),
			}),
		});
		if (res.status === 202) {
			const data = (await res.json()) as { challenge_id: string };
			setGuestChallengeId(data.challenge_id);
			setStatusMsg("Kode verifikasi akses pesanan tamu telah dikirim.");
		} else {
			setStatusMsg("Gagal memverifikasi nomor pesanan dan kontak tamu.");
		}
	}

	async function handleVerifyGuestRecoveryRun(e: React.FormEvent) {
		e.preventDefault();
		if (!guestChallengeId) return;
		const res = await fetch("/api/v1/guest-order-access/verifications", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": crypto.randomUUID(),
			},
			body: JSON.stringify({
				challenge_id: guestChallengeId,
				code: guestOtp.trim(),
			}),
		});
		if (res.ok) {
			const data = (await res.json()) as { order_id: string };
			setRecoveredOrderId(data.order_id);
			setStatusMsg("Akses pesanan tamu berhasil dipulihkan.");
		} else {
			setStatusMsg("Kode verifikasi tidak sesuai.");
		}
	}

	const handleProfileSave = guard(handleProfileSaveRun);
	const handleSetDefaultAddress = guard(handleSetDefaultAddressRun);
	const handleTogglePreference = guard(handleTogglePreferenceRun);
	const handleNotificationState = guard(handleNotificationStateRun);
	const handleTerminateSessions = guard(handleTerminateSessionsRun);
	const handleRequestGuestRecovery = guard(handleRequestGuestRecoveryRun);
	const handleVerifyGuestRecovery = guard(handleVerifyGuestRecoveryRun);

	const maskedContact = profile?.phone
		? maskedPhone(profile.phone)
		: (maskedEmail(profile?.email) ?? "Belum ada kontak");

	return (
		<div className="buyer-account-workspace" data-testid="buyer-account-root">
			{view !== "signed-out" && initialAuthenticated && profile ? (
				<>
					<header className="account-header">
						<span className="account-avatar" aria-hidden="true">
							{profile.display_name.trim().slice(0, 1).toUpperCase()}
						</span>
						<div className="account-identity">
							<h1>{profile.display_name}</h1>
							<p className="account-meta">{maskedContact}</p>
						</div>
						<div className="account-actions">
							<Link className="button button-secondary" href="/">
								Belanja
							</Link>
							<SignOutButton to="/" />
						</div>
					</header>
					<AccountNavigation current={view} />
					{/* Feedback sits under the tabs, next to the card that changed, not above the identity header. */}
					{statusMsg && (
						<output
							className="account-status"
							data-testid="account-status-banner"
						>
							{statusMsg}
						</output>
					)}
					<div className="account-content">
						{view === "orders" && <AccountOrders orders={initialOrders} />}
						{view === "profile" && (
							<>
								<section
									className="account-section"
									aria-labelledby="account-profile-title"
									data-testid="account-profile-section"
								>
									<div className="account-section-head">
										<h2 id="account-profile-title">Data diri</h2>
										{!editingProfile && (
											<button
												type="button"
												className="button button-secondary"
												data-testid="profile-edit-button"
												onClick={() => {
													setDisplayName(profile.display_name);
													setEditingProfile(true);
												}}
											>
												Ubah
											</button>
										)}
									</div>
									{editingProfile ? (
										<form onSubmit={handleProfileSave} noValidate>
											<div className="account-field">
												<label htmlFor="buyer-display-name">Nama</label>
												<input
													id="buyer-display-name"
													data-testid="profile-display-name-input"
													type="text"
													autoComplete="name"
													value={displayName}
													onChange={(e) => setDisplayName(e.target.value)}
													maxLength={120}
													required
												/>
											</div>
											<div className="account-field">
												{editingPhone ? (
													<>
														<label htmlFor="buyer-phone">Nomor WhatsApp</label>
														<input
															id="buyer-phone"
															data-testid="profile-phone-input"
															type="tel"
															inputMode="numeric"
															autoComplete="tel"
															maxLength={24}
															pattern={WHATSAPP_PATTERN}
															placeholder="08…"
															value={phone}
															onChange={(e) => setPhone(filterContact(e))}
															aria-describedby="buyer-phone-hint"
														/>
														<p id="buyer-phone-hint" className="checkout-hint">
															Diawali 08. Kosongkan untuk menghapus.
														</p>
													</>
												) : (
													<>
														<span className="account-field-label">
															Nomor WhatsApp
														</span>
														<p className="account-field-value">
															<span data-testid="profile-phone">
																{profile.phone
																	? maskedPhone(profile.phone)
																	: "Belum diatur"}
															</span>
															{profile.phone_verified ? (
																<span className="account-verified">
																	<Icon name="check" size={16} />
																	Terverifikasi
																</span>
															) : (
																<button
																	type="button"
																	className="contact-suggest-fix"
																	data-testid="profile-phone-edit"
																	onClick={() => {
																		setPhone(displayPhone(profile.phone));
																		setEditingPhone(true);
																	}}
																>
																	Ubah
																</button>
															)}
														</p>
													</>
												)}
											</div>
											<div className="account-actions">
												<button
													disabled={busy}
													type="submit"
													className="button"
													data-testid="profile-save-button"
												>
													{busy ? "Menyimpan…" : "Simpan"}
												</button>
												<button
													type="button"
													className="button button-secondary"
													onClick={() => {
														setEditingProfile(false);
														setEditingPhone(false);
													}}
												>
													Batal
												</button>
											</div>
										</form>
									) : (
										<dl className="account-facts">
											<div>
												<dt>Nama</dt>
												<dd data-testid="profile-name">
													{profile.display_name}
												</dd>
											</div>
											<div>
												<dt>WhatsApp</dt>
												<dd>
													<span data-testid="profile-phone">
														{profile.phone
															? maskedPhone(profile.phone)
															: "Belum diatur"}
													</span>
													{profile.phone && profile.phone_verified && (
														<span className="account-verified">
															<Icon name="check" size={16} />
															Terverifikasi
														</span>
													)}
												</dd>
											</div>
											<div>
												<dt>Email</dt>
												<dd data-testid="profile-email">
													{maskedEmail(profile.email) ?? "Belum diatur"}
												</dd>
											</div>
										</dl>
									)}
								</section>
								<section
									className="account-section"
									aria-labelledby="account-addresses-title"
									data-testid="account-addresses-section"
								>
									<h2 id="account-addresses-title">Alamat</h2>
									{addresses && addresses.data.length > 0 ? (
										<ul
											className="receipt-parcel-items"
											data-testid="address-book-list"
										>
											{addresses.data.map((item) => (
												<li
													key={item.id}
													data-testid={`address-card-${item.id}`}
													data-default={item.is_default}
												>
													<div>
														<strong>
															{item.address.label ?? "Alamat"} ·{" "}
															{item.address.recipient_name}
														</strong>{" "}
														{item.is_default && (
															<span
																className="receipt-badge"
																data-testid="default-address-badge"
															>
																Utama
															</span>
														)}
													</div>
													<p className="checkout-hint">
														{item.address.phone} · {item.address.street},{" "}
														{item.address.district}, {item.address.city},{" "}
														{item.address.province} {item.address.postcode}
													</p>
													{!item.is_default && (
														<button
															disabled={busy}
															type="button"
															className="button button-secondary"
															data-testid={`make-default-${item.id}`}
															onClick={() => handleSetDefaultAddress(item.id)}
														>
															Jadikan utama
														</button>
													)}
												</li>
											))}
										</ul>
									) : (
										<p className="checkout-hint">Belum ada alamat tersimpan.</p>
									)}
									{initialCompletion ? (
										<ProfileAddress
											profile={profile}
											addresses={addresses}
											destinations={initialCompletion.destinations}
											onAddresses={setAddresses}
											onStatus={setStatusMsg}
										/>
									) : (
										<p className="checkout-hint">
											Formulir alamat gagal dimuat. Muat ulang halaman untuk
											mencoba lagi.
										</p>
									)}
								</section>
								{initialCompletion ? (
									<ProfileCompletion
										{...initialCompletion}
										onStatus={setStatusMsg}
									/>
								) : (
									<section
										className="account-section"
										aria-labelledby="profile-completion-heading"
									>
										<h2 id="profile-completion-heading">Data tambahan</h2>
										<p className="checkout-hint">
											Data tambahan gagal dimuat. Muat ulang halaman untuk
											mencoba lagi.
										</p>
									</section>
								)}
							</>
						)}
						{view === "settings" && (
							<>
								<section
									className="account-section"
									aria-labelledby="account-notifications-title"
									data-testid="account-notifications-section"
								>
									<h2 id="account-notifications-title">
										Promo &amp; notifikasi
									</h2>
									{initialCompletion ? (
										<PromoConsents
											initial={initialCompletion.consents}
											profile={profile}
											onStatus={setStatusMsg}
										/>
									) : (
										<p className="checkout-hint account-promo">
											Pilihan promo gagal dimuat. Muat ulang halaman untuk
											mencoba lagi.
										</p>
									)}
									<h3>Kabar pesanan &amp; bantuan</h3>
									{!preferences && (
										<p className="checkout-hint">
											Pilihan kabar pesanan gagal dimuat. Muat ulang halaman
											untuk mencoba lagi.
										</p>
									)}
									{preferences && (
										<div className="checkout-charges">
											<label>
												<input
													type="checkbox"
													disabled={busy}
													data-testid="pref-in-app-order"
													checked={preferences.in_app_order_updates}
													onChange={() =>
														handleTogglePreference("in_app_order_updates")
													}
												/>{" "}
												Kabar pesanan di situs
											</label>
											<label>
												<input
													type="checkbox"
													disabled={busy}
													data-testid="pref-in-app-support"
													checked={preferences.in_app_support_updates}
													onChange={() =>
														handleTogglePreference("in_app_support_updates")
													}
												/>{" "}
												Balasan bantuan di situs
											</label>
											<label>
												<input
													type="checkbox"
													disabled={busy}
													data-testid="pref-email-order"
													checked={preferences.email_order_updates}
													onChange={() =>
														handleTogglePreference("email_order_updates")
													}
												/>{" "}
												Kabar pesanan lewat email
											</label>
										</div>
									)}
									{notifications.length > 0 && (
										<>
											<h3>Notifikasi terbaru</h3>
											<ul
												className="receipt-parcel-items"
												data-testid="notifications-list"
											>
												{notifications.map((n) => (
													<li
														key={n.id}
														data-testid={`notification-item-${n.id}`}
														data-state={n.state}
													>
														<strong>{n.title}</strong> ·{" "}
														{n.state === "unread"
															? "Belum dibaca"
															: "Sudah dibaca"}
														<p className="checkout-hint">{n.body}</p>
														<button
															disabled={busy}
															type="button"
															className="button button-secondary"
															data-testid={`toggle-notification-${n.id}`}
															onClick={() =>
																handleNotificationState(
																	n.id,
																	n.state === "unread" ? "read" : "unread",
																)
															}
														>
															{n.state === "unread"
																? "Tandai sudah dibaca"
																: "Tandai belum dibaca"}
														</button>
													</li>
												))}
											</ul>
										</>
									)}
								</section>
								<section
									className="account-section"
									aria-labelledby="account-security-title"
									data-testid="account-security-section"
								>
									<h2 id="account-security-title">Keamanan</h2>
									<div className="account-field">
										<label htmlFor="session-password">Kata sandi akun</label>
										<input
											id="session-password"
											data-testid="session-password"
											type="password"
											autoComplete="current-password"
											maxLength={128}
											value={sessionPassword}
											onChange={(e) => setSessionPassword(e.target.value)}
											aria-describedby="session-password-hint"
										/>
										<p id="session-password-hint" className="checkout-hint">
											Masukkan kata sandi untuk keluar dari perangkat lain.
										</p>
									</div>
									<div className="account-actions">
										<button
											disabled={busy}
											type="button"
											className="button button-secondary"
											data-testid="terminate-other-sessions-button"
											onClick={() => handleTerminateSessions("others")}
										>
											Keluar dari perangkat lain
										</button>
										<button
											disabled={busy}
											type="button"
											className="button button-secondary"
											data-testid="terminate-all-sessions-button"
											onClick={() => handleTerminateSessions("all")}
										>
											Keluar dari semua perangkat
										</button>
									</div>
								</section>
							</>
						)}
					</div>
				</>
			) : (
				<>
					{statusMsg && (
						<output
							className="account-status"
							data-testid="account-status-banner"
						>
							{statusMsg}
						</output>
					)}
					<div className="account-signed-out">
						<section
							className="account-intro"
							aria-labelledby="account-heading"
						>
							<h1 id="account-heading">Akun</h1>
							<p>Simpan alamat dan cek pesanan di satu tempat.</p>
							<ul
								className="account-benefits"
								data-testid="account-signup-value"
							>
								<li>
									<Icon name="truck" size={22} />
									<span>Pantau pengiriman</span>
								</li>
								<li>
									<Icon name="home" size={22} />
									<span>Pakai alamat tersimpan saat checkout</span>
								</li>
								<li>
									<Icon name="cart" size={22} />
									<span>Beli lagi dari riwayat pesanan</span>
								</li>
							</ul>
							<div className="account-actions">
								<Link
									className="button"
									href="/masuk?langkah=daftar&next=%2Fakun"
								>
									Daftar
								</Link>
								<Link
									className="button button-secondary"
									href="/masuk?next=%2Fakun"
								>
									Masuk
								</Link>
							</div>
						</section>
						<details
							ref={guestPanel}
							className="account-guest-details"
							data-testid="guest-order-recovery-section"
						>
							{/* biome-ignore lint/a11y/noStaticElementInteractions: Native summary handles keyboard activation; only desktop collapsing is prevented. */}
							<summary
								className="account-guest-summary"
								onClick={(event) => {
									if (window.matchMedia("(min-width: 701px)").matches)
										event.preventDefault();
								}}
							>
								<h2 id="guest-recovery-heading">Cek pesanan tanpa akun</h2>
								<Icon name="down" size={20} />
							</summary>
							<div className="account-guest-content">
								<p id="guest-recovery-help" className="checkout-hint">
									Masukkan nomor pesanan dari tanda terima dan kontak yang
									dipakai saat memesan. Kami kirim kode untuk membuka pesanan.
								</p>
								<form
									onSubmit={handleRequestGuestRecovery}
									aria-describedby="guest-recovery-help"
								>
									<label htmlFor="guest-order-id">Nomor pesanan</label>
									<input
										id="guest-order-id"
										data-testid="guest-recovery-order-id"
										type="text"
										value={guestOrderId}
										onChange={(e) => setGuestOrderId(e.target.value)}
										placeholder="99-XXXXXXXXXXXXXXXX"
										autoComplete="off"
										required
									/>
									<label htmlFor="guest-order-contact">
										Email atau nomor HP pesanan
									</label>
									<input
										id="guest-order-contact"
										data-testid="guest-recovery-contact"
										type="text"
										autoComplete="off"
										autoCapitalize="none"
										spellCheck={false}
										maxLength={254}
										value={guestContact}
										onChange={(e) => setGuestContact(filterContact(e, true))}
										placeholder="08… atau nama@email.com"
										required
									/>
									<EmailSuggestion
										value={guestContact}
										onPick={setGuestContact}
									/>
									<button
										disabled={busy}
										type="submit"
										className="button button-secondary"
										data-testid="guest-recovery-request-button"
									>
										{busy ? "Mengirim…" : "Kirim kode akses"}
									</button>
								</form>
								{guestChallengeId && (
									<form onSubmit={handleVerifyGuestRecovery}>
										<label htmlFor="guest-order-otp">Kode verifikasi</label>
										<input
											id="guest-order-otp"
											data-testid="guest-recovery-otp"
											type="text"
											inputMode="numeric"
											autoComplete="one-time-code"
											pattern="[0-9]{6}"
											maxLength={6}
											value={guestOtp}
											onChange={(e) =>
												setGuestOtp(e.target.value.replace(/\D/g, ""))
											}
											required
										/>
										<button
											disabled={busy}
											type="submit"
											className="button"
											data-testid="guest-recovery-verify-button"
										>
											{busy ? "Memeriksa…" : "Buka pesanan"}
										</button>
									</form>
								)}
								{recoveredOrderId && (
									<p className="checkout-hint">
										<a
											data-testid="guest-recovered-receipt-link"
											href={`/pesanan/${encodeURIComponent(recoveredOrderId)}`}
										>
											Lihat pesanan
										</a>
									</p>
								)}
							</div>
						</details>
					</div>
				</>
			)}
		</div>
	);
}
