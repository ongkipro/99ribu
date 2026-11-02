"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { BuyerAddressListResponse, BuyerProfileResponse } from "@/modules/accounts/service";
import type { CompletionData } from "../profile-completion";

const CHANNEL_LABEL: Record<string, string> = { email: "email", whatsapp: "WhatsApp" };

// What the account stores, where to correct it, and the deletion request. The request opens one support
// case and deletes nothing: staff confirm the next step with the buyer.
export function DataPrivacy({
	profile,
	addresses,
	completion,
	onStatus,
}: {
	profile: BuyerProfileResponse;
	addresses: BuyerAddressListResponse | null;
	completion: CompletionData | null;
	onStatus: (message: string) => void;
}) {
	const [asking, setAsking] = useState(false);
	const [sent, setSent] = useState(false);
	const [pending, setPending] = useState(false);
	const lock = useRef(false);
	const granted = completion?.consents.channels.filter((c) => c.granted).map((c) => CHANNEL_LABEL[c.channel] ?? c.channel) ?? [];
	const fields = completion?.details.completion.fields;
	const extra = fields ? [fields.birthday && "tanggal lahir", fields.gender && "jenis kelamin", fields.favourite_categories && "kategori favorit"].filter(Boolean) : [];

	async function request() {
		if (lock.current) return;
		lock.current = true;
		setPending(true);
		try {
			const res = await fetch("/api/v1/me/data-requests", {
				method: "POST",
				headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
				body: "{}",
			});
			if (res.ok) {
				setSent(true);
				setAsking(false);
				onStatus("Permintaan penghapusan akun sudah kami terima.");
			} else {
				onStatus(res.status === 429 ? "Terlalu banyak percobaan. Coba lagi beberapa menit lagi." : "Permintaan belum terkirim. Coba lagi.");
			}
		} catch {
			onStatus("Tidak bisa terhubung. Periksa koneksi lalu coba lagi.");
		} finally {
			lock.current = false;
			setPending(false);
		}
	}

	return (
		<section className="account-section" aria-labelledby="account-data-title" data-testid="account-data-section">
			<h2 id="account-data-title">Data dan privasi</h2>
			<p className="checkout-hint">Data yang tersimpan di akun ini:</p>
			<ul className="account-data-list">
				<li>
					<strong>Profil</strong>: nama{profile.email ? ", email" : ""}{profile.phone ? ", nomor HP" : ""}.
				</li>
				<li>
					<strong>Alamat</strong>: {addresses?.data.length ?? 0} alamat pengiriman.
				</li>
				{extra.length > 0 && (
					<li>
						<strong>Data tambahan</strong>: {extra.join(", ")}.
					</li>
				)}
				<li>
					<strong>Persetujuan promo</strong>: {granted.length ? `aktif untuk ${granted.join(" dan ")}` : "tidak ada yang aktif"}.
				</li>
			</ul>
			<p className="checkout-hint">
				Koreksi nama, kontak, alamat, dan data tambahan di <Link href="/akun/profil">Profil</Link>. Persetujuan promo bisa dicabut kapan saja di bagian Promo &amp; notifikasi di atas.
			</p>
			<h3>Hapus akun</h3>
			{sent ? (
				<p role="status" data-testid="data-request-sent">Permintaan penghapusan akun sudah kami terima. Tidak ada data yang dihapus saat ini. Percakapannya ada di <Link href="/bantuan">Bantuan</Link>.</p>
			) : asking ? (
				<div className="account-address-confirm" role="alert">
					<p>Kami akan membuat satu permintaan ke tim bantuan. Akun dan data Anda tidak dihapus saat ini.</p>
					<div className="account-actions">
						<button className="button" type="button" disabled={pending} onClick={request} data-testid="data-request-confirm">{pending ? "Mengirim…" : "Kirim permintaan"}</button>
						<button className="button button-secondary" type="button" disabled={pending} onClick={() => setAsking(false)}>Batal</button>
					</div>
				</div>
			) : (
				<button className="button button-secondary" type="button" onClick={() => setAsking(true)} data-testid="data-request-open">Minta penghapusan akun</button>
			)}
		</section>
	);
}
