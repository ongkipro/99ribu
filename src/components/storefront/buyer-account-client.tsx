"use client";

import { useState } from "react";
import type {
	BuyerAddressListResponse,
	BuyerProfileResponse,
	NotificationPreferenceResponse,
	PrivateNotificationResponse,
} from "@/modules/accounts/service";
import type { ProjectedOrder } from "@/modules/orders/receipt";
import { rupiah } from "@/modules/storefront/format";

type Props = {
	initialAuthenticated: boolean;
	initialProfile: BuyerProfileResponse | null;
	initialAddresses: BuyerAddressListResponse | null;
	initialPreferences: NotificationPreferenceResponse | null;
	initialNotifications: PrivateNotificationResponse[];
	initialOrders: ProjectedOrder[];
};

export function BuyerAccountClient({
	initialAuthenticated,
	initialProfile,
	initialAddresses,
	initialPreferences,
	initialNotifications,
	initialOrders,
}: Props) {
	const [profile, setProfile] = useState(initialProfile);
	const [addresses, setAddresses] = useState(initialAddresses);
	const [preferences, setPreferences] = useState(initialPreferences);
	const [notifications, setNotifications] = useState(initialNotifications);
	const [orders] = useState(initialOrders);
	const [displayName, setDisplayName] = useState(
		initialProfile?.display_name ?? "",
	);
	const [statusMsg, setStatusMsg] = useState<string | null>(null);

	// Guest order recovery form state (available even when unauthenticated)
	const [guestOrderId, setGuestOrderId] = useState("");
	const [guestContact, setGuestContact] = useState("");
	const [guestChallengeId, setGuestChallengeId] = useState<string | null>(null);
	const [guestOtp, setGuestOtp] = useState("");
	const [recoveredOrderId, setRecoveredOrderId] = useState<string | null>(null);

	async function handleProfileSave(e: React.FormEvent) {
		e.preventDefault();
		if (!profile) return;
		const res = await fetch("/api/v1/me/profile", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": crypto.randomUUID(),
			},
			body: JSON.stringify({
				expected_version: profile.version,
				display_name: displayName,
			}),
		});
		if (res.ok) {
			const updated = (await res.json()) as BuyerProfileResponse;
			setProfile(updated);
			setStatusMsg("Profil berhasil diperbarui.");
		} else {
			setStatusMsg("Gagal memperbarui profil.");
		}
	}

	async function handleSetDefaultAddress(addressId: string) {
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

	async function handleTogglePreference(
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

	async function handleNotificationState(
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

	async function handleTerminateSessions(scope: "others" | "all") {
		const res = await fetch("/api/v1/me/session-terminations", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": crypto.randomUUID(),
			},
			body: JSON.stringify({ scope }),
		});
		if (res.ok && scope === "all") {
			// The current session row is gone; sign-out clears its Better Auth cookies and guest context.
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

	async function handleRequestGuestRecovery(e: React.FormEvent) {
		e.preventDefault();
		const res = await fetch("/api/v1/guest-order-access/challenges", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"idempotency-key": crypto.randomUUID(),
			},
			body: JSON.stringify({
				order_id: guestOrderId.trim(),
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

	async function handleVerifyGuestRecovery(e: React.FormEvent) {
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

	return (
		<div className="buyer-account-workspace" data-testid="buyer-account-root">
			{statusMsg && (
				<output className="checkout-hint" data-testid="account-status-banner">
					{statusMsg}
				</output>
			)}

			{initialAuthenticated && profile ? (
				<div className="receipt-layout">
					<div className="receipt-primary">
						<section
							className="receipt-card"
							aria-labelledby="account-profile-heading"
							data-testid="account-profile-section"
						>
							<h2 id="account-profile-heading">Profil & Identitas Pembeli</h2>
							<form onSubmit={handleProfileSave}>
								<label htmlFor="buyer-display-name">
									Nama tampilan (mendukung nama satu kata / mononim)
								</label>
								<input
									id="buyer-display-name"
									data-testid="profile-display-name-input"
									type="text"
									value={displayName}
									onChange={(e) => setDisplayName(e.target.value)}
									maxLength={120}
									required
								/>
								<p className="checkout-hint">
									Email:{" "}
									<strong data-testid="profile-email">
										{profile.email ?? "Belum diatur (opsional)"}
									</strong>{" "}
									· Telepon:{" "}
									<strong data-testid="profile-phone">
										{profile.phone ?? "Belum diverifikasi"}
									</strong>{" "}
									· Versi:{" "}
									<span data-testid="profile-version">v{profile.version}</span>
								</p>
								<button
									type="submit"
									className="button"
									data-testid="profile-save-button"
								>
									Simpan profil
								</button>
							</form>
						</section>

						<section
							className="receipt-card"
							aria-labelledby="account-addresses-heading"
							data-testid="account-addresses-section"
						>
							<h2 id="account-addresses-heading">
								Buku Alamat Pengiriman (Revisi v{addresses?.book_version ?? 0})
							</h2>
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
								<p className="checkout-hint">
									Belum ada alamat tersimpan. Alamat pertama otomatis menjadi
									alamat utama.
								</p>
							)}
						</section>

						<section
							className="receipt-card"
							aria-labelledby="account-orders-heading"
							data-testid="account-orders-section"
						>
							<h2 id="account-orders-heading">
								Riwayat Pesanan & Kontinuitas Pesanan Tamu
							</h2>
							{orders.length > 0 ? (
								<ul
									className="receipt-parcel-items"
									data-testid="buyer-orders-list"
								>
									{orders.map((ord) => (
										<li key={ord.id} data-testid={`buyer-order-row-${ord.id}`}>
											<a href={`/pesanan/${ord.id}`}>
												<strong>{ord.number}</strong> · {ord.status} ·{" "}
												{rupiah(ord.buyer_total)}
											</a>
										</li>
									))}
								</ul>
							) : (
								<p className="checkout-hint">
									Belum ada riwayat pesanan pada akun ini.
								</p>
							)}
						</section>
					</div>

					<div className="receipt-secondary">
						<section
							className="receipt-card"
							aria-labelledby="account-notifications-heading"
							data-testid="account-notifications-section"
						>
							<h2 id="account-notifications-heading">
								Preferensi & Kotak Masuk Notifikasi
							</h2>
							{preferences && (
								<div className="checkout-charges">
									<label>
										<input
											type="checkbox"
											data-testid="pref-in-app-order"
											checked={preferences.in_app_order_updates}
											onChange={() =>
												handleTogglePreference("in_app_order_updates")
											}
										/>{" "}
										Update pesanan di aplikasi
									</label>
									<label>
										<input
											type="checkbox"
											data-testid="pref-in-app-support"
											checked={preferences.in_app_support_updates}
											onChange={() =>
												handleTogglePreference("in_app_support_updates")
											}
										/>{" "}
										Balasan bantuan di aplikasi
									</label>
									<label>
										<input
											type="checkbox"
											data-testid="pref-email-order"
											checked={preferences.email_order_updates}
											onChange={() =>
												handleTogglePreference("email_order_updates")
											}
										/>{" "}
										Update pesanan via email
									</label>
								</div>
							)}
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
										<strong>{n.title}</strong> ({n.state})
										<p className="checkout-hint">{n.body}</p>
										<button
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
						</section>

						<section
							className="receipt-card"
							aria-labelledby="account-security-heading"
							data-testid="account-security-section"
						>
							<h2 id="account-security-heading">Keamanan & Sesi Perangkat</h2>
							<div className="notice-actions">
								<button
									type="button"
									className="button button-secondary"
									data-testid="terminate-other-sessions-button"
									onClick={() => handleTerminateSessions("others")}
								>
									Keluar dari perangkat lain
								</button>
								<button
									type="button"
									className="button button-secondary"
									data-testid="terminate-all-sessions-button"
									onClick={() => handleTerminateSessions("all")}
								>
									Keluar dari semua sesi
								</button>
							</div>
						</section>
					</div>
				</div>
			) : null}

			<section
				className="receipt-card"
				aria-labelledby="guest-recovery-heading"
				data-testid="guest-order-recovery-section"
			>
				<h2 id="guest-recovery-heading">
					Pulihkan Akses Pesanan Tamu Tanpa Akun
				</h2>
				<form onSubmit={handleRequestGuestRecovery}>
					<label htmlFor="guest-order-id">ID Pesanan</label>
					<input
						id="guest-order-id"
						data-testid="guest-recovery-order-id"
						type="text"
						value={guestOrderId}
						onChange={(e) => setGuestOrderId(e.target.value)}
						placeholder="UUID pesanan"
					/>
					<label htmlFor="guest-order-contact">Nomor HP / Email Pesanan</label>
					<input
						id="guest-order-contact"
						data-testid="guest-recovery-contact"
						type="text"
						value={guestContact}
						onChange={(e) => setGuestContact(e.target.value)}
						placeholder="+62812..."
					/>
					<button
						type="submit"
						className="button button-secondary"
						data-testid="guest-recovery-request-button"
					>
						Kirim kode akses tamu
					</button>
				</form>
				{guestChallengeId && (
					<form onSubmit={handleVerifyGuestRecovery}>
						<label htmlFor="guest-order-otp">Kode Verifikasi</label>
						<input
							id="guest-order-otp"
							data-testid="guest-recovery-otp"
							type="text"
							value={guestOtp}
							onChange={(e) => setGuestOtp(e.target.value)}
						/>
						<button
							type="submit"
							className="button"
							data-testid="guest-recovery-verify-button"
						>
							Verifikasi & buka tanda terima
						</button>
					</form>
				)}
				{recoveredOrderId && (
					<p className="checkout-hint">
						<a
							data-testid="guest-recovered-receipt-link"
							href={`/pesanan/${encodeURIComponent(recoveredOrderId)}`}
						>
							Buka tanda terima pesanan tamu sekarang
						</a>
					</p>
				)}
			</section>
		</div>
	);
}
