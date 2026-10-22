// Human-readable Indonesian messages for API error codes shown to operators.
const MESSAGES: Record<string, string> = {
	UNAUTHENTICATED: "Sesi Anda berakhir. Masuk kembali untuk melanjutkan.",
	MFA_REQUIRED: "Verifikasi dua langkah (MFA) diperlukan untuk tindakan ini.",
	FORBIDDEN: "Peran Anda tidak memiliki akses untuk tindakan ini.",
	INVALID_INPUT: "Isian belum valid. Periksa kembali lalu coba lagi.",
	INVALID_ORIGIN: "Permintaan ditolak karena asal halaman tidak valid.",
	CONFLICT: "Data sudah berubah. Muat ulang lalu coba lagi.",
	VERSION_CONFLICT: "Data sudah berubah. Muat ulang lalu coba lagi.",
	STALE_VERSION: "Data sudah berubah. Muat ulang lalu coba lagi.",
	FILTER_TOKEN_EXPIRED: "Filter ringkasan kedaluwarsa. Muat ulang halaman.",
	DRILLDOWN_SCOPE_MISMATCH: "Cakupan filter berubah. Muat ulang halaman.",
	REPRINT_REASON_REQUIRED: "Alasan cetak ulang wajib diisi.",
	PUBLICATION_VERSION_CONFLICT:
		"Status penerbitan sudah berubah. Muat ulang halaman lalu coba lagi.",
	PUBLICATION_ALREADY_WITHDRAWN: "Produk ini sudah ditarik dari toko.",
	IDEMPOTENCY_CONFLICT:
		"Permintaan yang sama sudah dikirim dengan isi berbeda. Tutup lalu coba lagi.",
	NOT_FOUND: "Data tidak ditemukan atau sudah tidak tersedia.",
	SERVICE_UNAVAILABLE:
		"Layanan sedang tidak tersedia. Coba lagi sebentar lagi.",
};

export type ApiFailure = { status: number; code: string; message: string };

export function describeFailure(
	status: number,
	code?: string | null,
): ApiFailure {
	const resolved = code || (status === 0 ? "NETWORK_ERROR" : `HTTP_${status}`);
	const message =
		(code ? MESSAGES[code] : undefined) ??
		(status === 0
			? "Tidak dapat terhubung ke server lokal. Periksa koneksi lalu coba lagi."
			: status === 401
				? MESSAGES.UNAUTHENTICATED
				: status === 403
					? MESSAGES.FORBIDDEN
					: status === 409
						? MESSAGES.CONFLICT
						: status >= 500
							? MESSAGES.SERVICE_UNAVAILABLE
							: "Permintaan tidak dapat diproses.");
	return { status, code: resolved, message };
}

/** Reads `{ code }` from an error response without throwing on non-JSON bodies. */
export async function readFailure(res: Response): Promise<ApiFailure> {
	const body = (await res.json().catch(() => null)) as {
		code?: unknown;
	} | null;
	return describeFailure(
		res.status,
		typeof body?.code === "string" ? body.code : null,
	);
}

export function failureText(failure: ApiFailure): string {
	return `${failure.message} (kode: ${failure.code})`;
}

/** GET a private JSON resource; never throws. */
export async function getJson<T>(
	url: string,
	signal?: AbortSignal,
): Promise<{ ok: true; data: T } | { ok: false; failure: ApiFailure }> {
	try {
		const res = await fetch(url, {
			credentials: "include",
			cache: "no-store",
			signal,
		});
		if (!res.ok) return { ok: false, failure: await readFailure(res) };
		return { ok: true, data: (await res.json()) as T };
	} catch {
		return { ok: false, failure: describeFailure(0) };
	}
}
