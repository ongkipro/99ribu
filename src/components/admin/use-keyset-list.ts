"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { failureText, getJson } from "./admin-errors";
import type { DataTablePaging, DataTableStatus } from "./data-table";

type Page<T> = { data: T[]; pagination?: { next_cursor: string | null } };

/**
 * S113: one keyset list for the DataTable screens. GETs `url`, appends the `next_cursor` pages
 * ("Muat baris berikutnya") without repeating a row, and maps 403 to the shared denied state.
 * A changed `url` (filters) or `reload()` starts again from page one; late responses of an
 * older request are dropped. `url` null keeps the list idle (e.g. before a session exists).
 */
export function useKeysetList<T>(
	url: string | null,
	rowKey: (row: T) => string,
) {
	const [rows, setRows] = useState<T[] | null>(null);
	const [cursor, setCursor] = useState<string | null>(null);
	const [failure, setFailure] = useState<{ status: number; text: string; message: string } | null>(null);
	const [more, setMore] = useState(false);
	const [moreError, setMoreError] = useState<string | null>(null);
	const request = useRef(0);
	const keyRef = useRef(rowKey);
	keyRef.current = rowKey;

	const reload = useCallback(async () => {
		const n = ++request.current;
		setRows(null);
		setCursor(null);
		setFailure(null);
		setMoreError(null);
		if (!url) return;
		const result = await getJson<Page<T>>(url);
		if (n !== request.current) return;
		if (result.ok) {
			setRows(result.data.data);
			setCursor(result.data.pagination?.next_cursor ?? null);
		} else
			setFailure({
				status: result.failure.status,
				text: failureText(result.failure),
				message: result.failure.message,
			});
	}, [url]);
	useEffect(() => {
		void reload();
	}, [reload]);

	const loadMore = async () => {
		if (!url || !cursor || more) return;
		const n = request.current;
		setMore(true);
		setMoreError(null);
		const result = await getJson<Page<T>>(
			`${url}${url.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`,
		);
		setMore(false);
		if (n !== request.current) return;
		if (!result.ok) {
			setMoreError(`Baris berikutnya gagal dimuat. ${failureText(result.failure)}`);
			return;
		}
		setRows((prev) => {
			const seen = new Set((prev ?? []).map(keyRef.current));
			return [...(prev ?? []), ...result.data.data.filter((r) => !seen.has(keyRef.current(r)))];
		});
		setCursor(result.data.pagination?.next_cursor ?? null);
	};

	const status: DataTableStatus = failure
		? failure.status === 403
			? { kind: "denied", message: failure.message }
			: { kind: "error", message: failure.text, onRetry: () => void reload() }
		: rows === null
			? { kind: "loading" }
			: { kind: "ready" };
	const paging: DataTablePaging = {
		hasMore: cursor !== null,
		loading: more,
		onMore: () => void loadMore(),
		error: moreError,
	};
	return { rows: rows ?? [], setRows, status, paging, reload };
}
