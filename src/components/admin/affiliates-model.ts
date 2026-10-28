import type {
	AdminAffiliateCommissionSummary,
	AdminAffiliateDetail,
	AdminAffiliateRateVersion,
	AdminAffiliateSummary,
	AffiliateAccountStatus,
	BeneficiaryStatus,
} from "../../modules/affiliates/admin.ts";
import { describeFailure, failureText, readFailure } from "./admin-errors.ts";
import type { StatusTone } from "./status.tsx";

export type {
	AdminAffiliateCommissionSummary,
	AdminAffiliateDetail,
	AdminAffiliateRateVersion,
	AdminAffiliateSummary,
	AffiliateAccountStatus,
	BeneficiaryStatus,
};

export const ACCOUNT_STATUS: Record<
	AffiliateAccountStatus,
	readonly [string, StatusTone]
> = {
	active: ["Aktif", "success"],
	suspended: ["Ditangguhkan", "danger"],
};

export const BENEFICIARY_STATUS: Record<
	BeneficiaryStatus,
	readonly [string, StatusTone]
> = {
	verified: ["Rekening terverifikasi", "done"],
	missing: ["Rekening belum diisi", "closed"],
	pending_verification: ["Menunggu verifikasi", "open"],
	change_hold: ["Perubahan ditahan", "problem"],
	rejected: ["Rekening ditolak", "danger"],
};

export const RATE_STATE: Record<
	AdminAffiliateRateVersion["state"],
	readonly [string, StatusTone]
> = {
	effective: ["Berlaku", "success"],
	scheduled: ["Terjadwal", "open"],
	superseded: ["Digantikan", "closed"],
};

export const RATE_MESSAGES: Record<string, string> = {
	RETROACTIVE_RATE_FORBIDDEN:
		"Waktu berlaku tidak boleh di masa lalu. Tarif khusus hanya berlaku ke depan: pilih Sekarang atau waktu di masa depan.",
	RATE_SCHEDULE_TOO_DISTANT:
		"Waktu berlaku paling jauh 366 hari dari sekarang.",
	SCHEDULE_CONFLICT:
		"Sudah ada versi tarif terjadwal yang mulai lebih lambat. Versi baru tidak boleh mendahului jadwal terakhir.",
	VERSION_CONFLICT:
		"Versi tarif sudah berubah di tempat lain sejak dialog dibuka. Riwayat dimuat ulang di latar belakang; tutup dialog ini, periksa versi terbaru, lalu buka kembali bila masih ingin mengubah.",
	AFFILIATE_RATE_UNAVAILABLE:
		"Mitra ini belum memenuhi syarat perubahan tarif (harus berstatus aktif, email terverifikasi, dan memegang peran afiliasi).",
	AFFILIATE_RATE_CONFLICT:
		"Bukti reautentikasi sudah terpakai atau terjadi konflik penyimpanan. Konfirmasi ulang untuk mencoba lagi.",
	REAUTHENTICATION_REQUIRED:
		"Kata sandi salah atau bukti konfirmasi sudah kedaluwarsa. Periksa kata sandi Anda lalu coba lagi.",
	FRESH_MFA_REQUIRED:
		"Verifikasi dua langkah (MFA) harus berumur kurang dari 5 menit untuk mengubah tarif. Keluar lalu masuk kembali dengan kode MFA baru.",
	FORBIDDEN:
		"Hanya Super Admin dengan verifikasi dua langkah aktif yang dapat mengubah tarif komisi mitra.",
	RATE_LIMITED:
		"Terlalu banyak percobaan konfirmasi kata sandi. Tunggu sebentar sebelum mencoba lagi.",
};

export const UNCERTAIN_RATE_NOTE =
	"Hasil belum pasti: jawaban server tidak sampai, sehingga versi tarif mungkin sudah tersimpan. Halaman dimuat ulang. Kirim ulang memakai kunci yang sama; bila sudah tercatat, hasil lama yang dikembalikan tanpa duplikasi.";

export function rateFailureMessage(status: number, code: string | null) {
	if (code && RATE_MESSAGES[code]) {
		return `${RATE_MESSAGES[code]} (kode: ${code})`;
	}
	return failureText(describeFailure(status, code));
}

export function offerCommissionPreviewIdr(basisPoints: number) {
	return Number((99000n * BigInt(basisPoints) + 5000n) / 10000n);
}

type Outcome<T> =
	| { ok: true; data: T }
	| {
			ok: false;
			kind: "refused" | "uncertain";
			status: number;
			code: string | null;
			text: string;
	  };

async function postRateJson<T>(
	url: string,
	body: unknown,
	key: string,
	send: typeof fetch = fetch,
): Promise<Outcome<T>> {
	try {
		const res = await send(url, {
			method: "POST",
			credentials: "include",
			headers: {
				"content-type": "application/json",
				"idempotency-key": key,
			},
			body: JSON.stringify(body),
		});
		if (res.ok) return { ok: true, data: (await res.json()) as T };
		const failure = await readFailure(res);
		const code = failure.code.startsWith("HTTP_") ? null : failure.code;
		return {
			ok: false,
			kind: res.status >= 500 ? "uncertain" : "refused",
			status: res.status,
			code,
			text: rateFailureMessage(res.status, code),
		};
	} catch {
		return {
			ok: false,
			kind: "uncertain",
			status: 0,
			code: null,
			text: rateFailureMessage(0, null),
		};
	}
}

export type RateSent<T> = {
	data: T | null;
	code: string | null;
	error: string | null;
	uncertain: boolean;
};

/**
 * Reuses the `exception-intent-core.ts` money/proof safety pattern:
 * - On an uncertain (network/5xx) response, keeps the same idempotency key, proof and frozen body so a second
 *   click replays the original request instead of creating a duplicate version.
 * - On a definitive 4xx refusal, rotates `key` and `frozen` so corrected input submits a fresh request; rotates
 *   `proof`/`proofKey` when proof issuance failed or when the server rejected the proof/authority.
 */
export class RateIntent {
	key: string | null = null;
	proofKey: string | null = null;
	proof: string | null = null;
	frozen: { url: string; body: Record<string, unknown> } | null = null;

	resetDraft() {
		this.key = null;
		this.frozen = null;
	}

	resetProof() {
		this.proof = null;
		this.proofKey = null;
	}

	async send<T>(
		url: string,
		build: () => Record<string, unknown>,
		options: {
			password: string;
			affiliateId: string;
			onUncertain?: () => void;
			fetch?: typeof fetch;
			uuid?: () => string;
		},
	): Promise<RateSent<T>> {
		const uuid = options.uuid ?? (() => crypto.randomUUID());
		this.key ??= uuid();
		if (!this.frozen || this.frozen.url !== url) {
			this.frozen = { url, body: build() };
		}
		if (!this.proof) {
			this.proofKey ??= uuid();
			const issued = await postRateJson<{ proof: string }>(
				"/api/v1/me/reauthentication-proofs",
				{
					password: options.password,
					action: "affiliate_rate.version",
					subject_id: options.affiliateId,
				},
				this.proofKey,
				options.fetch,
			);
			if (!issued.ok) {
				if (issued.kind === "refused") {
					this.proofKey = null;
					this.key = null;
					this.frozen = null;
				} else {
					options.onUncertain?.();
				}
				return {
					data: null,
					code: issued.code,
					error:
						issued.kind === "uncertain"
							? `${UNCERTAIN_RATE_NOTE} ${issued.text}`
							: issued.text,
					uncertain: issued.kind === "uncertain",
				};
			}
			this.proof = issued.data.proof;
		}
		const body = {
			...this.frozen.body,
			reauthentication_proof: this.proof,
		};
		const sent = await postRateJson<T>(url, body, this.key, options.fetch);
		if (sent.ok) {
			this.key = null;
			this.frozen = null;
			this.proof = null;
			this.proofKey = null;
			return { data: sent.data, code: null, error: null, uncertain: false };
		}
		if (sent.kind === "uncertain") {
			options.onUncertain?.();
			return {
				data: null,
				code: sent.code,
				error: `${UNCERTAIN_RATE_NOTE} ${sent.text}`,
				uncertain: true,
			};
		}
		// Definitive 4xx refusal: transaction rolled back on the server, so corrected input is a new request.
		this.key = null;
		this.frozen = null;
		if (
			sent.code === "REAUTHENTICATION_REQUIRED" ||
			sent.code === "FRESH_MFA_REQUIRED" ||
			sent.code === "AFFILIATE_RATE_CONFLICT" ||
			sent.status === 403
		) {
			this.proof = null;
			this.proofKey = null;
		}
		return {
			data: null,
			code: sent.code,
			error: sent.text,
			uncertain: false,
		};
	}
}
