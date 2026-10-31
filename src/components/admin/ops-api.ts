"use client";

import { useRef } from "react";
import { describeFailure, failureText, readFailure } from "./admin-errors";

// S102: one mutation call for the inventory, transfer, promotion and product-content screens.
// The idempotency key lives as long as the dialog: a retry after a lost response (network error or
// 5xx) reuses it, so the server replays the saved result instead of applying the change twice; a
// definitive refusal (4xx) rotates it so corrected input is not an IDEMPOTENCY_CONFLICT.

export type Sent<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; text: string };

const CODE_MESSAGES: Record<string, string> = {
	INSUFFICIENT_STOCK: "Stok tidak cukup untuk perubahan ini (tersedia setelah dipesan dan karantina).",
	INVENTORY_LIMIT_EXCEEDED: "Jumlah melebihi batas stok yang bisa dicatat.",
	INVENTORY_IDENTITY_CONFLICT: "Lot dengan kode ini sudah ada untuk barang ini.",
	TRANSFER_NOT_REQUESTED: "Transfer ini sudah dikirim atau dibatalkan.",
	TRANSFER_NOT_DISPATCHED: "Transfer ini belum dikirim atau sudah diterima penuh.",
	RECEIPT_EXCEEDS_DISPATCHED_LOT: "Jumlah diterima melebihi sisa kiriman lot ini.",
	TRANSFER_LOT_LIMIT: "Transfer melibatkan lebih dari 100 lot; pecah menjadi beberapa transfer.",
	INVALID_WAREHOUSE_SCOPE: "Gudang tidak aktif atau di luar cakupan Anda.",
	BUDGET_ENCUMBERED: "Anggaran tidak boleh lebih kecil dari yang sudah terpakai atau dipesan.",
	PROMOTION_ALREADY_ENDED: "Promo aktif harus berakhir di masa depan.",
	CATALOG_IDENTITY_CONFLICT: "Data katalog bentrok dengan data yang sudah ada.",
	COMPONENT_NAME_MISMATCH: "Nama isi paket tidak sama dengan nama SKU-nya.",
	PRODUCT_PHOTO_TOO_SMALL: "Foto terlalu kecil; sisi terpendek minimal 300 px.",
	PRODUCT_PHOTO_REJECTED: "Foto ditolak pemeriksaan file. Simpan ulang sebagai JPG atau PNG lalu coba lagi.",
};

export function sentText(status: number, code: string | null) {
	return code && CODE_MESSAGES[code] ? `${CODE_MESSAGES[code]} (kode: ${code})` : failureText(describeFailure(status, code));
}

/** A stable idempotency key per dialog; `rotate` after a definitive refusal. */
export function useOperationKey() {
	const key = useRef<string | null>(null);
	return {
		get: () => {
			key.current ??= crypto.randomUUID();
			return key.current;
		},
		rotate: () => {
			key.current = null;
		},
	};
}

export async function send<T>(
	method: "POST" | "PATCH",
	url: string,
	body: unknown,
	key: ReturnType<typeof useOperationKey>,
): Promise<Sent<T>> {
	try {
		const res = await fetch(url, {
			method,
			credentials: "include",
			headers: { "content-type": "application/json", "idempotency-key": key.get() },
			body: JSON.stringify(body),
		});
		if (res.ok) {
			key.rotate();
			return { ok: true, data: (await res.json()) as T };
		}
		const failure = await readFailure(res);
		if (res.status < 500) key.rotate();
		const code = failure.code.startsWith("HTTP_") ? null : failure.code;
		return { ok: false, status: res.status, code, text: sentText(res.status, code) };
	} catch {
		return { ok: false, status: 0, code: null, text: sentText(0, null) };
	}
}
