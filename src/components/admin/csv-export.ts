import { useEffect, useRef, useState } from "react";
import { OFFER_KIND_LABELS, type ProductSummary, STATUS_LABELS } from "./catalog-model.ts";

// S160 / spec 17 W4-8: filtered CSV export of an admin list. The builder is pure; the hook only wires the
// browser download. Callers pass only the columns their role may see (never HPP or any cost).

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined };

/** Same rule as sanitizeCsvCell in src/modules/reporting/exports.ts: formula guard first, then quoting. */
export function csvCell(value: unknown): string {
	if (value === null || value === undefined) return "";
	let text = String(value);
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 BOM (Excel reads Indonesian text correctly), header row, CRLF between and after rows. */
export function buildCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
	const line = (cells: string[]) => `${cells.join(",")}\r\n`;
	return `﻿${line(columns.map((c) => csvCell(c.header)))}${rows.map((r) => line(columns.map((c) => csvCell(c.value(r))))).join("")}`;
}

/** Date in Asia/Jakarta as YYYY-MM-DD (the device timezone must not move the file name across midnight). */
export function jakartaDate(at: Date = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
export const csvFileName = (base: string, at: Date = new Date()) => `${base}-${jakartaDate(at)}.csv`;

/**
 * Columns of the product list export. Only what the list API returns to this role: never HPP or any cost, and
 * stock as readiness counts (the same as the table). `stockAccess` only changes the wording.
 */
export const productExportColumns = (stockAccess: boolean): CsvColumn<ProductSummary>[] => [
	{ header: "Kode katalog", value: (r) => r.catalog_id },
	{ header: "Nama", value: (r) => r.name },
	{ header: "Kategori", value: (r) => r.category_path ?? "" },
	{ header: "Jenis varian", value: (r) => r.offer_kinds.map((k) => OFFER_KIND_LABELS[k] ?? k).join("; ") },
	{ header: "Jumlah varian", value: (r) => r.offer_count },
	{ header: "Harga terendah (IDR)", value: (r) => r.price_min_idr },
	{ header: "Harga tertinggi (IDR)", value: (r) => r.price_max_idr },
	{ header: stockAccess ? "Varian dengan stok lengkap" : "Varian dengan stok siap", value: (r) => r.stock_ready_offers },
	{ header: "Status", value: (r) => STATUS_LABELS[r.state] },
	{ header: "Perlu tinjauan klaim", value: (r) => (r.claim_review ? "Ya" : "Tidak") },
];
/** SKU dictionary export: code and name only; the list carries no cost and the export never adds one. */
export const stockItemExportColumns: CsvColumn<{ sku: string; name: string }>[] = [
	{ header: "SKU", value: (r) => r.sku },
	{ header: "Nama", value: (r) => r.name },
];

export const EXPORT_MAX_ROWS = 5000;
export const truncationNotice = (rows: number) => `Dipotong di ${rows.toLocaleString("id-ID")} baris. Persempit filter agar semua baris ikut.`;

export type PageResult<T> = { ok: true; rows: T[]; next: string | null } | { ok: false; text: string };
export type Collected<T> = { ok: true; rows: T[]; truncated: boolean } | { ok: false; text: string };

export const ABORTED_TEXT = "Ekspor dibatalkan.";

/**
 * Walks the keyset cursor to the end (or to `max` rows), skipping a row seen twice. A repeated cursor is an error, not a
 * loop. `truncated` is true when the cap is reached and the server still reported a next page. An aborted `signal`
 * stops before the next page is requested (the page getter receives it too, to cancel the request in flight).
 */
export async function collectPages<T>(
	getPage: (cursor: string | null, signal?: AbortSignal) => Promise<PageResult<T>>,
	rowKey: (row: T) => string,
	max: number = EXPORT_MAX_ROWS,
	signal?: AbortSignal,
): Promise<Collected<T>> {
	const rows: T[] = [];
	const seen = new Set<string>();
	const cursors = new Set<string>();
	let cursor: string | null = null;
	for (;;) {
		if (signal?.aborted) return { ok: false, text: ABORTED_TEXT };
		const page = await getPage(cursor, signal);
		if (signal?.aborted) return { ok: false, text: ABORTED_TEXT };
		if (!page.ok) return page;
		for (const row of page.rows) {
			const key = rowKey(row);
			if (!seen.has(key)) {
				seen.add(key);
				rows.push(row);
			}
		}
		if (rows.length >= max) return { ok: true, rows: rows.slice(0, max), truncated: rows.length > max || page.next !== null };
		if (!page.next) return { ok: true, rows, truncated: false };
		if (cursors.has(page.next)) return { ok: false, text: "Daftar tidak bisa dibaca sampai habis (kursor berulang)." };
		cursors.add(page.next);
		cursor = page.next;
	}
}

function download(text: string, name: string) {
	const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * State for an export button: `run` collects rows, builds the file and downloads it; a failure becomes `message`.
 * A second click while one export runs is ignored (a ref, so two clicks in one frame cannot both pass); leaving the
 * page aborts the export and nothing is downloaded or set afterwards.
 */
export function useCsvExport() {
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
	const running = useRef<AbortController | null>(null);
	useEffect(() => () => running.current?.abort(), []);
	async function run<T>(
		collect: (signal: AbortSignal) => Promise<Collected<T>>,
		columns: readonly CsvColumn<T>[],
		fileBase: string,
	) {
		if (running.current) return;
		const controller = new AbortController();
		running.current = controller;
		setBusy(true);
		setMessage(null);
		try {
			const result = await collect(controller.signal);
			if (controller.signal.aborted) return;
			if (!result.ok) return setMessage({ kind: "error", text: `Ekspor gagal. ${result.text}` });
			if (result.rows.length === 0) return setMessage({ kind: "info", text: "Tidak ada baris untuk diekspor." });
			download(buildCsv(columns, result.rows), csvFileName(fileBase));
			setMessage({
				kind: "info",
				text: result.truncated ? truncationNotice(result.rows.length) : `${result.rows.length.toLocaleString("id-ID")} baris diekspor.`,
			});
		} catch {
			if (!controller.signal.aborted) setMessage({ kind: "error", text: "Ekspor gagal. Berkas tidak bisa dibuat di perangkat ini." });
		} finally {
			running.current = null;
			if (!controller.signal.aborted) setBusy(false);
		}
	}
	return { busy, message, run };
}
