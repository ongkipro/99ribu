import { describeFailure, failureText, readFailure } from "./admin-errors.ts";
import { FINANCE_ERROR_MESSAGES } from "./finance-model.ts";

// S131: money-safety rules for every finance workbench mutation (reconciliation decisions,
// payout claim/evidence/verify/reconcile, refund reconcile/retry), free of React so integration
// tests can exercise them directly.
// - One operator intent carries one Idempotency-Key.
// - A definitive refusal (4xx: the server rolled the transaction back) frees the key so
//   corrected input is a new request.
// - A lost or unknown answer (network error or 5xx) keeps the key, the frozen request body and
//   the reauthentication proof: repeating the action sends the exact same request so the server
//   replays its saved outcome instead of applying a second financial effect.

export type Outcome<T> =
	| { ok: true; data: T }
	| {
			ok: false;
			kind: "refused" | "uncertain";
			status: number;
			code: string | null;
			text: string;
	  };

export type FinanceProofAction =
	| "finance.reconcile"
	| "payout.claim"
	| "payout.verify"
	| "finance.refund";

export type MoneyProof = {
	password: string;
	action: FinanceProofAction;
	subject: string;
};

export type Fetch = typeof fetch;

export function messageFor(
	status: number,
	code: string | null,
	money = false,
): string {
	if (code && FINANCE_ERROR_MESSAGES[code]) {
		return `${FINANCE_ERROR_MESSAGES[code]} (kode: ${code})`;
	}
	if (money && status === 403 && code === "FORBIDDEN") {
		return "Tindakan ini memerlukan izin keuangan yang sesuai dan verifikasi dua langkah berumur kurang dari 5 menit. Keluar lalu masuk kembali bila perlu. (kode: FORBIDDEN)";
	}
	return failureText(describeFailure(status, code));
}

export async function postJson<T>(
	url: string,
	body: unknown,
	key: string,
	money = false,
	send: Fetch = fetch,
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
			text: messageFor(res.status, code, money),
		};
	} catch {
		return {
			ok: false,
			kind: "uncertain",
			status: 0,
			code: null,
			text: messageFor(0, null),
		};
	}
}

export async function putBytes<T>(
	url: string,
	bytes: Uint8Array,
	headers: Record<string, string>,
	send: Fetch = fetch,
): Promise<Outcome<T>> {
	try {
		const body = new Uint8Array(bytes.byteLength);
		body.set(bytes);
		const res = await send(url, {
			method: "PUT",
			credentials: "include",
			headers,
			body,
		});
		if (res.ok) return { ok: true, data: (await res.json()) as T };
		const failure = await readFailure(res);
		const code = failure.code.startsWith("HTTP_") ? null : failure.code;
		return {
			ok: false,
			kind: res.status >= 500 ? "uncertain" : "refused",
			status: res.status,
			code,
			text: messageFor(res.status, code, false),
		};
	} catch {
		return {
			ok: false,
			kind: "uncertain",
			status: 0,
			code: null,
			text: messageFor(0, null),
		};
	}
}

export const UNCERTAIN_NOTE =
	"Hasil belum pasti: jawaban server tidak sampai, jadi tindakan ini mungkin sudah tersimpan. Halaman dimuat ulang. Kirim ulang memakai kunci yang sama; bila sudah tercatat, hasil lama yang ditampilkan dan tidak ada pencatatan kedua.";

export type Sent<T> = {
	data: T | null;
	error: string | null;
	uncertain: boolean;
	code: string | null;
};

export class FinanceIntent {
	key: string | null = null;
	proofKey: string | null = null;
	proof: string | null = null;
	frozen: { url: string; body: Record<string, unknown> } | null = null;

	/**
	 * Sends the intent. `build` runs only for the first send of an intent; a resend after an
	 * unknown answer repeats the frozen request with the same Idempotency-Key and proof.
	 */
	async send<T>(
		url: string,
		build: () => Record<string, unknown>,
		options: {
			money?: MoneyProof;
			onUncertain?: () => void;
			onConflict?: () => void;
			fetch?: Fetch;
			uuid?: () => string;
		} = {},
	): Promise<Sent<T>> {
		const uuid = options.uuid ?? (() => crypto.randomUUID());
		this.key ??= uuid();
		if (!this.frozen || this.frozen.url !== url) {
			this.frozen = { url, body: build() };
		}
		let body: Record<string, unknown> = this.frozen.body;
		if (options.money) {
			if (!this.proof) {
				this.proofKey ??= uuid();
				const issued = await postJson<{ proof: string }>(
					"/api/v1/me/reauthentication-proofs",
					{
						password: options.money.password,
						action: options.money.action,
						subject_id: options.money.subject,
					},
					this.proofKey,
					true,
					options.fetch,
				);
				if (!issued.ok) {
					// The mutation was never sent with this key: the form stays editable, so the next submit must rebuild
					// the body from the current fields instead of posting the stale frozen one. (After an uncertain send the
					// proof is already held, so this branch is never reached for a body that may have been committed.)
					this.frozen = null;
					if (issued.kind === "refused") this.proofKey = null;
					return {
						data: null,
						error: issued.text,
						uncertain: false,
						code: issued.code,
					};
				}
				this.proof = issued.data.proof;
			}
			body = { ...body, reauthentication_proof: this.proof };
		}
		const sent = await postJson<T>(
			url,
			body,
			this.key,
			Boolean(options.money),
			options.fetch,
		);
		if (sent.ok) {
			this.key = null;
			this.frozen = null;
			this.proof = null;
			this.proofKey = null;
			return {
				data: sent.data,
				error: null,
				uncertain: false,
				code: null,
			};
		}
		if (sent.kind === "uncertain") {
			options.onUncertain?.();
			return {
				data: null,
				error: `${UNCERTAIN_NOTE} ${sent.text}`,
				uncertain: true,
				code: sent.code,
			};
		}
		// Definitive 4xx refusal: the server rolled back the transaction, so corrected input is a new intent.
		this.key = null;
		this.frozen = null;
		if (
			sent.code === "VERSION_CONFLICT" ||
			sent.code === "SETTLEMENT_SOURCE_CHANGED"
		) {
			options.onConflict?.();
		}
		if (
			sent.code === "REAUTHENTICATION_REQUIRED" ||
			sent.code === "FRESH_MFA_REQUIRED" ||
			sent.status === 403
		) {
			this.proof = null;
			this.proofKey = null;
		}
		return {
			data: null,
			error: sent.text,
			uncertain: false,
			code: sent.code,
		};
	}
}
