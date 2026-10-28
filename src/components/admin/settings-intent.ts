"use client";

import { useRef, useState } from "react";
import { describeFailure, failureText, readFailure } from "./admin-errors";

// S130: one operator intent = one open settings dialog.
// Every versioned edit dialog freezes `const [capturedVersion] = useState(expectedVersion)` on mount and
// sends `capturedVersion`. A definitive refusal (4xx) frees the Idempotency-Key so corrected input is a new
// request while keeping the draft open on 409 conflicts. An uncertain answer (network failure or 5xx) keeps
// the Idempotency-Key, frozen request body and reauthentication proof so retrying replays the saved outcome.

export type ProofRequest = { password: string } & (
	| { action: "payment_policy.version"; subject: "company-payment" }
	| { action: "company_policy.version"; subject: "company-commercial" }
	| { action: "shipping_label_template.version"; subject: "shipping-label-templates" }
);

export type Outcome<T> =
	| { ok: true; data: T }
	| {
			ok: false;
			kind: "refused" | "uncertain";
			status: number;
			code: string | null;
			text: string;
	  };

export const SETTINGS_MESSAGES: Record<string, string> = {
	VERSION_CONFLICT:
		"Versi sudah berubah sejak dialog dibuka. Riwayat telah dimuat ulang; draf Anda tetap tersimpan di formulir ini. Tutup dialog untuk meninjau versi terbaru sebelum menyimpan.",
	TEMPLATE_VERSION_CONFLICT:
		"Versi template sudah berubah sejak dialog dibuka. Riwayat telah dimuat ulang; draf Anda tetap tersimpan di formulir ini. Tutup dialog untuk meninjau versi terbaru sebelum menyimpan.",
	TEMPLATE_NAME_CONFLICT:
		"Nama atau kode template ini sudah digunakan. Gunakan nama lain.",
	PARTNER_BRAND_GOVERNANCE_REQUIRED:
		"Mode merek mitra netral wajib menyertakan nama merek mitra dan teks keterbukaan pengiriman.",
	RETROACTIVE_POLICY_FORBIDDEN:
		"Waktu berlaku tidak boleh di masa lalu. Pilih Berlaku sekarang atau waktu di masa depan.",
	POLICY_SCHEDULE_TOO_DISTANT:
		"Waktu berlaku paling jauh 366 hari dari sekarang.",
	SCHEDULE_CONFLICT:
		"Sudah ada versi terjadwal yang mulai lebih lambat. Versi baru tidak boleh mendahuluinya.",
	REAUTHENTICATION_REQUIRED:
		"Konfirmasi kata sandi gagal atau bukti autentikasi sudah kedaluwarsa.",
	FRESH_MFA_REQUIRED:
		"Verifikasi dua langkah harus berumur kurang dari 5 menit. Keluar lalu masuk lagi bila perlu.",
	DESTINATION_PAUSED:
		"Tujuan iklan sedang dijeda. Lanjutkan pengiriman sinyal terlebih dahulu sebelum mengirim ulang kejadian.",
	CONSENT_SUPPRESSED:
		"Kejadian ini tidak memiliki izin pengukuran yang berlaku dan tidak dapat dikirim ulang.",
	SECRET_WRITE_FORBIDDEN:
		"Kredensial rahasia tidak boleh ditulis melalui API atau layar ini.",
	BROWSER_PURCHASE_FORBIDDEN:
		"Sinyal Purchase dari peramban tidak diizinkan; hanya sinyal server dari pembayaran terverifikasi yang dikirim.",
	CALLER_OVERRIDE_FORBIDDEN:
		"Nilai uang, waktu kejadian, atau nama kejadian asli tidak boleh diubah saat pengiriman ulang.",
};

export const UNCERTAIN_NOTE =
	"Hasil belum pasti: jawaban server tidak sampai, jadi perubahan ini mungkin sudah tersimpan. Halaman dimuat ulang. Kirim ulang memakai kunci yang sama; bila sudah tercatat, hasil lama yang ditampilkan tanpa penulisan ganda.";

export function settingsFailureText(status: number, code: string | null) {
	if (code && SETTINGS_MESSAGES[code]) {
		return `${SETTINGS_MESSAGES[code]} (kode: ${code})`;
	}
	return failureText(describeFailure(status, code));
}

export async function postSettingsJson<T>(
	url: string,
	body: unknown,
	key: string,
): Promise<Outcome<T>> {
	try {
		const res = await fetch(url, {
			method: "POST",
			credentials: "include",
			headers: {
				"content-type": "application/json",
				"idempotency-key": key,
			},
			body: JSON.stringify(body),
		});
		if (res.ok) {
			return { ok: true, data: (await res.json()) as T };
		}
		const failure = await readFailure(res);
		const code = failure.code.startsWith("HTTP_") ? null : failure.code;
		return {
			ok: false,
			kind: res.status >= 500 ? "uncertain" : "refused",
			status: res.status,
			code,
			text: settingsFailureText(res.status, code),
		};
	} catch {
		return {
			ok: false,
			kind: "uncertain",
			status: 0,
			code: null,
			text: settingsFailureText(0, null),
		};
	}
}

export type SettingsSent<T> = {
	data: T | null;
	error: string | null;
	code: string | null;
	status: number;
	uncertain: boolean;
};

export class SettingsIntent {
	key: string | null = null;
	proofKey: string | null = null;
	proof: string | null = null;
	frozen: { url: string; body: Record<string, unknown> } | null = null;

	async send<T>(
		url: string,
		build: () => Record<string, unknown>,
		options: {
			proof?: ProofRequest;
			onStale?: () => void;
			onUncertain?: () => void;
		} = {},
	): Promise<SettingsSent<T>> {
		this.key ??= crypto.randomUUID();
		if (!this.frozen || this.frozen.url !== url) {
			this.frozen = { url, body: build() };
		}
		let body: Record<string, unknown> = this.frozen.body;
		if (options.proof) {
			if (!this.proof) {
				this.proofKey ??= crypto.randomUUID();
				const issued = await postSettingsJson<{ proof: string }>(
					"/api/v1/me/reauthentication-proofs",
					{
						password: options.proof.password,
						action: options.proof.action,
						subject_id: options.proof.subject,
					},
					this.proofKey,
				);
				if (!issued.ok) {
					this.key = null;
					this.frozen = null;
					if (issued.kind === "refused") {
						this.proofKey = null;
					}
					return {
						data: null,
						error: issued.text,
						code: issued.code,
						status: issued.status,
						uncertain: false,
					};
				}
				this.proof = issued.data.proof;
			}
			body = { ...body, reauthentication_proof: this.proof };
		}
		const sent = await postSettingsJson<T>(url, body, this.key);
		if (sent.ok) {
			this.key = null;
			this.frozen = null;
			this.proof = null;
			this.proofKey = null;
			return {
				data: sent.data,
				error: null,
				code: null,
				status: 201,
				uncertain: false,
			};
		}
		if (sent.kind === "uncertain") {
			options.onUncertain?.();
			return {
				data: null,
				error: `${UNCERTAIN_NOTE} ${sent.text}`,
				code: sent.code,
				status: sent.status,
				uncertain: true,
			};
		}
		if (
			sent.status === 409 &&
			(sent.code === "VERSION_CONFLICT" ||
				sent.code === "TEMPLATE_VERSION_CONFLICT" ||
				sent.code === "SCHEDULE_CONFLICT")
		) {
			options.onStale?.();
		}
		this.key = null;
		this.frozen = null;
		if (
			sent.status === 403 ||
			sent.code === "REAUTHENTICATION_REQUIRED" ||
			sent.code === "FRESH_MFA_REQUIRED"
		) {
			this.proof = null;
			this.proofKey = null;
		}
		return {
			data: null,
			error: sent.text,
			code: sent.code,
			status: sent.status,
			uncertain: false,
		};
	}
}

export function useSettingsIntent() {
	const intent = useRef<SettingsIntent | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [uncertain, setUncertain] = useState(false);

	async function run<T>(
		url: string,
		build: () => Record<string, unknown>,
		options: {
			proof?: ProofRequest;
			onStale?: () => void;
			onUncertain?: () => void;
		} = {},
	): Promise<T | null> {
		intent.current ??= new SettingsIntent();
		setPending(true);
		setError(null);
		try {
			const sent = await intent.current.send<T>(url, build, options);
			setUncertain(sent.uncertain);
			setError(sent.error);
			return sent.data;
		} finally {
			setPending(false);
		}
	}

	return { pending, error, setError, uncertain, run };
}
