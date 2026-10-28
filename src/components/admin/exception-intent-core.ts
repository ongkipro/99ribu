import { describeFailure, failureText, readFailure } from "./admin-errors.ts";
import { ERROR_MESSAGES } from "./exception-model.ts";

// S133: the money-safety rules of every exception write, free of React so a test can drive them.
// One operator intent carries one Idempotency-Key. A definitive refusal (4xx: the server rolled
// the transaction back) frees the key so corrected input is a new request. A lost or unknown
// answer (network error or 5xx) keeps the key, the frozen request body and the reauthentication
// proof: the only way to send again is the same request, which the server replays from its saved
// outcome instead of applying it a second time. The body is frozen because the server compares
// the request hash of a replay.

export type Outcome<T> =
	| { ok: true; data: T }
	| { ok: false; kind: "refused" | "uncertain"; status: number; code: string | null; text: string };
export type MoneyProof = { password: string; action: "finance.recovery_refund"; subject: string };
export type Fetch = typeof fetch;

export function messageFor(status: number, code: string | null, money = false) {
	if (code && ERROR_MESSAGES[code]) return `${ERROR_MESSAGES[code]} (kode: ${code})`;
	if (money && status === 403 && code === "FORBIDDEN")
		return "Hanya Super Admin atau keuangan dengan izin refund yang bisa mengajukan refund, dan verifikasi dua langkah harus berumur kurang dari 5 menit. Keluar lalu masuk lagi bila perlu. (kode: FORBIDDEN)";
	return failureText(describeFailure(status, code));
}

export async function postJson<T>(url: string, body: unknown, key: string, money = false, send: Fetch = fetch): Promise<Outcome<T>> {
	try {
		const res = await send(url, {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json", "idempotency-key": key },
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
			text: messageFor(res.status, code, money),
		};
	} catch {
		return { ok: false, kind: "uncertain", status: 0, code: null, text: messageFor(0, null) };
	}
}

export const UNCERTAIN_NOTE =
	"Hasil belum pasti: jawaban server tidak sampai, jadi tindakan ini mungkin sudah tersimpan. Halaman dimuat ulang. Kirim ulang memakai kunci yang sama; bila sudah tercatat, hasil lama yang ditampilkan dan tidak ada pencatatan kedua.";

export type Sent<T> = { data: T | null; error: string | null; uncertain: boolean };

export class Intent {
	key: string | null = null;
	proofKey: string | null = null;
	proof: string | null = null;
	frozen: { url: string; body: Record<string, unknown> } | null = null;

	/**
	 * Sends the intent. `build` runs only for the first send of an intent; a resend after an
	 * unknown answer repeats the frozen request. `data` is the saved result, or null with the
	 * reason in `error`.
	 */
	async send<T>(
		url: string,
		build: () => Record<string, unknown>,
		options: { money?: MoneyProof; onUncertain?: () => void; fetch?: Fetch; uuid?: () => string } = {},
	): Promise<Sent<T>> {
		const uuid = options.uuid ?? (() => crypto.randomUUID());
		this.key ??= uuid();
		if (!this.frozen || this.frozen.url !== url) this.frozen = { url, body: build() };
		let body: Record<string, unknown> = this.frozen.body;
		if (options.money) {
			if (!this.proof) {
				this.proofKey ??= uuid();
				const issued = await postJson<{ proof: string }>(
					"/api/v1/me/reauthentication-proofs",
					{ password: options.money.password, action: options.money.action, subject_id: options.money.subject },
					this.proofKey,
					true,
					options.fetch,
				);
				if (!issued.ok) {
					// Nothing was sent to the money endpoint; a definitive answer frees the proof key.
					if (issued.kind === "refused") this.proofKey = null;
					return { data: null, error: issued.text, uncertain: false };
				}
				this.proof = issued.data.proof;
			}
			body = { ...body, reauthentication_proof: this.proof };
		}
		const sent = await postJson<T>(url, body, this.key, Boolean(options.money), options.fetch);
		if (sent.ok) {
			this.key = null;
			this.frozen = null;
			this.proof = null;
			this.proofKey = null;
			return { data: sent.data, error: null, uncertain: false };
		}
		if (sent.kind === "uncertain") {
			options.onUncertain?.();
			return { data: null, error: `${UNCERTAIN_NOTE} ${sent.text}`, uncertain: true };
		}
		// Refused before any effect: the saved request is dead; corrected input is a new intent.
		this.key = null;
		this.frozen = null;
		if (sent.code === "REAUTHENTICATION_REQUIRED" || sent.code === "FRESH_MFA_REQUIRED" || sent.status === 403) {
			this.proof = null;
			this.proofKey = null;
		}
		return { data: null, error: sent.text, uncertain: false };
	}
}
