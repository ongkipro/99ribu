"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authHref, signInHref } from "./sign-in-copy";
import { handOffSignUpEmail } from "./sign-up-form";
import { Icon } from "./ui/icon";

// S123 receipt account cards (pesanan/[orderId]/page.tsx, from orders/receipt.ts:readOrderAccountOffer).

// A guest viewing their own receipt: "Daftar" opens the sign-up modal with `next` back to this receipt and
// the order's contact email pre-filled (handed over in memory; the server only passes it to a viewer
// holding this order's access).
export function OrderSaveCard({ path, email }: { path: string; email: string | null }) {
	return (
		<section className="receipt-card receipt-account" aria-labelledby="receipt-account-heading" data-testid="order-save-card">
			<h2 id="receipt-account-heading">Simpan pesanan ini ke akun</h2>
			<p>Lacak pesanan dari halaman Akun, simpan alamat untuk belanja berikutnya, dan lihat riwayat belanja.</p>
			<p className="checkout-hint">
				Daftar{email ? " dengan email pesanan ini" : ""}, buka tautan verifikasi di email, lalu masuk. Setelah masuk, pesanan dihubungkan ke akun dengan kode 6 digit yang dikirim ke email atau nomor HP pesanan.
			</p>
			<div className="receipt-account-actions">
				<Link className="button" href={authHref(path, "daftar")} data-testid="order-save-signup" onClick={() => { if (email) handOffSignUpEmail(path, email); }}>Daftar</Link>
				<Link className="button button-secondary" href={signInHref(path)}>Sudah punya akun? Masuk</Link>
			</div>
		</section>
	);
}

type Result = { status: number; code: unknown; challenge: unknown; retry: number | null };
async function send(path: string, body: Record<string, string>): Promise<Result> {
	try {
		const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
		const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
		const retry = Number(response.headers.get("retry-after"));
		return { status: response.status, code: payload?.code, challenge: payload?.challenge_id, retry: retry > 0 ? Math.ceil(retry) : null };
	} catch {
		return { status: 0, code: null, challenge: null, retry: null };
	}
}
const waitText = (retry: number | null) => `Terlalu banyak percobaan. Coba lagi dalam ${retry ? Math.ceil(retry / 60) : "beberapa"} menit.`;

// A signed-in buyer on a receipt they do not own (after signing in, the guest access ends): one tap sends
// the existing guest-order-link challenge to the account email; another contact can be typed. The card
// reads the same for every failure to send, so it adds nothing to what the API reveals (TASKS S120).
export function OrderLinkCard({ orderId, email }: { orderId: string; email: string }) {
	const [contact, setContact] = useState(email);
	const [other, setOther] = useState(false);
	const [challenge, setChallenge] = useState<string | null>(null);
	const [code, setCode] = useState("");
	const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
	const [pending, setPending] = useState(false);
	const field = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (challenge || other) field.current?.focus();
	}, [challenge, other]);

	async function request(event: React.FormEvent) {
		event.preventDefault();
		const value = contact.trim();
		if (!value) return setMessage({ text: "Isi email atau nomor HP yang dipakai saat memesan.", error: true });
		setPending(true);
		setMessage(null);
		const result = await send("/api/v1/me/guest-order-link-challenges", { order_id: orderId, contact: value });
		setPending(false);
		if (result.status === 201 && typeof result.challenge === "string") {
			setChallenge(result.challenge);
			setCode("");
			return setMessage({ text: `Kode dikirim ke ${value}. Berlaku 15 menit.`, error: false });
		}
		if (result.status === 429) return setMessage({ text: waitText(result.retry), error: true });
		if (result.status === 0 || result.status >= 500) return setMessage({ text: "Tidak bisa terhubung. Coba lagi.", error: true });
		setOther(true);
		setMessage({ text: "Kode tidak bisa dikirim ke kontak ini. Masukkan email atau nomor HP yang dipakai saat memesan.", error: true });
	}

	async function verify(event: React.FormEvent) {
		event.preventDefault();
		if (!challenge) return;
		const value = code.replace(/\s+/g, "");
		if (!/^\d{6}$/.test(value)) return setMessage({ text: "Masukkan 6 digit kode.", error: true });
		setPending(true);
		setMessage(null);
		const result = await send(`/api/v1/me/guest-order-link-challenges/${encodeURIComponent(challenge)}/verifications`, { code: value });
		if (result.status === 201) {
			setMessage({ text: "Pesanan terhubung ke akun. Memuat tanda terima…", error: false });
			return window.location.reload();
		}
		setPending(false);
		if (result.status === 403) return setMessage({ text: "Kode tidak cocok. Periksa lalu coba lagi.", error: true });
		if (result.status === 409 || result.status === 404) {
			setChallenge(null);
			return setMessage({ text: "Kode sudah tidak berlaku. Kirim kode baru.", error: true });
		}
		if (result.status === 429) return setMessage({ text: waitText(result.retry), error: true });
		setMessage({ text: "Tidak bisa terhubung. Coba lagi.", error: true });
	}

	return (
		<section className="receipt-card receipt-account" aria-labelledby="receipt-link-heading" data-testid="order-link-card">
			<h2 id="receipt-link-heading">Hubungkan pesanan ini ke akun</h2>
			<p>Pesanan yang dibuat tanpa akun bisa disimpan ke akun ini. Untuk itu kami mengirim kode 6 digit ke email atau nomor HP yang dipakai saat memesan.</p>
			{challenge ? (
				<form className="receipt-account-form" onSubmit={verify} noValidate>
					<div className="checkout-field">
						<label htmlFor="order-link-code">Kode verifikasi</label>
						<input ref={field} id="order-link-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
							onChange={(event) => setCode(event.currentTarget.value)} aria-invalid={message?.error || undefined} aria-describedby={message ? "order-link-message" : undefined} />
					</div>
					<div className="receipt-account-actions">
						<button className="button" type="submit" disabled={pending} data-testid="order-link-verify">{pending ? "Memeriksa…" : "Hubungkan pesanan"}</button>
						<button className="button button-secondary" type="button" disabled={pending} onClick={() => { setChallenge(null); setMessage(null); }}>Kirim kode baru</button>
					</div>
				</form>
			) : (
				<form className="receipt-account-form" onSubmit={request} noValidate>
					{other ? (
						<div className="checkout-field">
							<label htmlFor="order-link-contact">Email atau nomor HP pesanan</label>
							<input ref={field} id="order-link-contact" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={254} value={contact}
								onChange={(event) => setContact(event.currentTarget.value)} aria-invalid={message?.error || undefined} aria-describedby={message ? "order-link-message" : undefined} />
						</div>
					) : (
						<p className="checkout-hint">Kode dikirim ke <strong>{email}</strong> jika email ini dipakai saat memesan.</p>
					)}
					<div className="receipt-account-actions">
						<button className="button" type="submit" disabled={pending} data-testid="order-link-send">{pending ? "Mengirim…" : "Kirim kode"}</button>
						{!other && <button className="button button-secondary" type="button" onClick={() => { setOther(true); setContact(""); }}>Pakai kontak lain</button>}
					</div>
				</form>
			)}
			{message && (
				<p id="order-link-message" className={`receipt-account-message ${message.error ? "checkout-field-error" : "checkout-hint"}`} role={message.error ? "alert" : "status"} data-testid="order-link-message">
					{message.error ? <Icon name="alert" size={20} /> : <Icon name="check" size={20} />}
					<span>{message.text}</span>
				</p>
			)}
		</section>
	);
}
