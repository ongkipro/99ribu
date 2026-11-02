"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const json = (body: unknown) => ({
	method: "POST",
	headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
	body: JSON.stringify(body),
});

function wait(response: Response) {
	const seconds = Number(response.headers.get("retry-after") ?? response.headers.get("x-retry-after"));
	return Number.isFinite(seconds) && seconds > 0 ? ` Coba lagi dalam ${Math.ceil(seconds)} detik.` : " Tunggu sebentar lalu coba lagi.";
}

// Step 1 (password proof): each status has its own cause, so the message never blames the password for a
// rate limit or a server problem.
function proofFailure(response: Response) {
	if (response.status === 429) return `Terlalu banyak percobaan.${wait(response)} Rekening belum diubah.`;
	if (response.status >= 500) return "Layanan verifikasi sedang bermasalah. Rekening belum diubah; coba lagi sebentar lagi.";
	if (response.status === 401) return "Sesi Anda sudah berakhir. Masuk lagi, lalu ulangi perubahan rekening.";
	if (response.status === 403) return "Kata sandi tidak sesuai atau sesi sudah kedaluwarsa. Rekening belum diubah.";
	return "Permintaan verifikasi ditolak. Muat ulang halaman lalu coba lagi. Rekening belum diubah.";
}

// Step 2 (saving the account): the proof already passed, so the causes are the data, the proof's
// single-use window, rate limits or the service.
function saveFailure(response: Response) {
	if (response.status === 429) return `Terlalu banyak perubahan rekening.${wait(response)}`;
	if (response.status >= 500) return "Layanan penyimpanan sedang bermasalah. Rekening belum tersimpan; coba lagi sebentar lagi.";
	if (response.status === 401) return "Sesi Anda sudah berakhir. Masuk lagi, lalu ulangi perubahan rekening.";
	if (response.status === 403) return "Verifikasi kata sandi sudah kedaluwarsa atau terpakai. Kirim ulang formulir dengan kata sandi Anda.";
	if (response.status === 409) return "Ada perubahan rekening lain yang sedang diproses. Tunggu hingga selesai, lalu coba lagi.";
	return "Rekening belum tersimpan. Periksa kode bank, nomor rekening, dan nama pemilik, lalu coba lagi.";
}

// Changing the payout account needs the password again: it buys a single-use proof bound to this
// affiliate account and the action, which the beneficiary API then consumes.
export function BeneficiaryForm({ affiliateId }: { affiliateId: string }) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [failed, setFailed] = useState(false);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const data = new FormData(form);
		const password = String(data.get("password") ?? "");
		const passwordField = form.elements.namedItem("password") as HTMLInputElement;
		setBusy(true);
		setFailed(false);
		setMessage("");
		try {
			const proofResponse = await fetch(
				"/api/v1/me/reauthentication-proofs",
				json({ password, action: "affiliate.beneficiary_change", subject_id: affiliateId }),
			);
			passwordField.value = "";
			if (!proofResponse.ok) {
				setFailed(true);
				setMessage(proofFailure(proofResponse));
				return;
			}
			const { proof } = (await proofResponse.json()) as { proof: string };
			const response = await fetch(
				"/api/v1/me/affiliate/beneficiary-changes",
				json({
					bank_code: String(data.get("bank_code") ?? ""),
					account_number: String(data.get("account_number") ?? "").replace(/\s+/g, ""),
					account_holder_name: String(data.get("account_holder_name") ?? "").trim(),
					reauthentication_proof: proof,
				}),
			);
			if (!response.ok) {
				setFailed(true);
				setMessage(saveFailure(response));
				return;
			}
			setMessage("Rekening tujuan diperbarui. Berlaku untuk pencairan berikutnya.");
			form.reset();
			router.refresh();
		} catch {
			setFailed(true);
			setMessage("Koneksi terputus. Rekening belum diubah.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<form className="aff-form" onSubmit={submit}>
			<div className="aff-field">
				<label htmlFor="aff-bank">Kode bank</label>
				<input id="aff-bank" name="bank_code" required minLength={2} maxLength={30} pattern="[A-Za-z0-9_\-]{2,30}" autoCapitalize="characters" autoComplete="off" aria-describedby="aff-bank-hint" />
				<p className="aff-hint" id="aff-bank-hint">Singkatan bank, misalnya BCA, BRI, MANDIRI.</p>
			</div>
			<div className="aff-field">
				<label htmlFor="aff-number">Nomor rekening</label>
				<input id="aff-number" name="account_number" required inputMode="numeric" pattern="[0-9 ]{5,60}" maxLength={60} autoComplete="off" />
			</div>
			<div className="aff-field">
				<label htmlFor="aff-holder">Nama pemilik rekening</label>
				<input id="aff-holder" name="account_holder_name" required maxLength={200} autoComplete="off" aria-describedby="aff-holder-hint" />
				<p className="aff-hint" id="aff-holder-hint">Rekening harus atas nama Anda sendiri.</p>
			</div>
			<div className="aff-field">
				<label htmlFor="aff-password">Kata sandi akun</label>
				<input id="aff-password" name="password" type="password" required maxLength={128} autoComplete="current-password" />
			</div>
			<button type="submit" className="button" disabled={busy}>
				{busy ? "Menyimpan" : "Simpan rekening"}
			</button>
			<p className="aff-live" role={failed ? "alert" : "status"} aria-live="polite" data-failed={failed || undefined}>{message}</p>
		</form>
	);
}
