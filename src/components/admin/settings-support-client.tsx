"use client";

import { CircleCheck, History, Pencil, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { failureText, getJson } from "./admin-errors";
import { DataTable, type DataTableStatus } from "./data-table";
import { formatWib } from "./format";
import { FormDialog, FormField } from "./form";
import { useSettingsIntent } from "./settings-intent";
import { StatusBadge } from "./status";

// S130 / spec 17 B25: CS saved replies and conversation tags governance. Owner (or CS supervisor
// with support.tools.manage) creates and appends new versions; ordinary CS reads definitions and
// their version history.

const PLACEHOLDERS = [
	{ key: "customer_name", label: "Nama pembeli ({{customer_name}})" },
	{ key: "product_title", label: "Nama produk ({{product_title}})" },
	{ key: "order_reference", label: "Nomor pesanan ({{order_reference}})" },
] as const;

export type SavedReplyHistoryItem = {
	version: number;
	title: string;
	text: string;
	placeholders: string[];
	enabled: boolean;
	actor_id: string | null;
	reason: string;
	created_at: string;
};

export type SavedReplyItem = {
	id: string;
	version: number;
	title: string;
	text: string;
	placeholders: string[];
	enabled: boolean;
	history?: SavedReplyHistoryItem[];
};

export type SupportTagHistoryItem = {
	version: number;
	label: string;
	enabled: boolean;
	actor_id: string | null;
	reason: string;
	created_at: string;
};

export type SupportTagItem = {
	id: string;
	version: number;
	label: string;
	enabled: boolean;
	history?: SupportTagHistoryItem[];
};

type ListPage<T> = {
	data: T[];
	pagination: { next_cursor: string | null };
};

const PAGE = 20;

export function SettingsSupportClient({
	canWrite,
}: {
	canWrite: boolean;
}) {
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	return (
		<div className="flex flex-col gap-8" data-testid="settings-support-root">
			{notice && (
				<Alert
					ref={noticeRef}
					tabIndex={-1}
					role="status"
					className="outline-none"
					data-testid="support-settings-notice"
				>
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">
						{notice}
					</AlertDescription>
				</Alert>
			)}

			{!canWrite && (
				<p
					data-testid="support-settings-readonly"
					className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
				>
					Hanya baca: staf layanan pelanggan dapat meninjau balasan tersimpan,
					tag percakapan, dan riwayat versinya. Penambahan atau perubahan versi
					memerlukan Super Admin atau izin pengelola perangkat CS.
				</p>
			)}

			<SavedRepliesSection
				canWrite={canWrite}
				onNotice={setNotice}
			/>

			<SupportTagsSection
				canWrite={canWrite}
				onNotice={setNotice}
			/>
		</div>
	);
}

function SavedRepliesSection({
	canWrite,
	onNotice,
}: {
	canWrite: boolean;
	onNotice: (message: string) => void;
}) {
	const [rows, setRows] = useState<SavedReplyItem[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [status, setStatus] = useState<DataTableStatus>({ kind: "loading" });
	const [more, setMore] = useState<{ loading: boolean; error: string | null }>({
		loading: false,
		error: null,
	});
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [dialogTarget, setDialogTarget] = useState<
		{ mode: "create" } | { mode: "version"; item: SavedReplyItem } | null
	>(null);
	const requestRef = useRef(0);

	const load = useCallback(async () => {
		const runId = ++requestRef.current;
		setStatus({ kind: "loading" });
		const res = await getJson<ListPage<SavedReplyItem>>(
			`/api/v1/admin/support/saved-replies?limit=${PAGE}`,
		);
		if (runId !== requestRef.current) return;
		if (res.ok) {
			setRows(res.data.data);
			setNextCursor(res.data.pagination.next_cursor);
			setStatus({ kind: "ready" });
		} else {
			setRows([]);
			setNextCursor(null);
			setStatus(
				res.failure.status === 403
					? { kind: "denied", message: res.failure.message }
					: {
							kind: "error",
							message: failureText(res.failure),
							onRetry: () => void load(),
						},
			);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function loadMore() {
		if (!nextCursor || more.loading) return;
		setMore({ loading: true, error: null });
		const res = await getJson<ListPage<SavedReplyItem>>(
			`/api/v1/admin/support/saved-replies?limit=${PAGE}&cursor=${encodeURIComponent(nextCursor)}`,
		);
		if (!res.ok) {
			setMore({
				loading: false,
				error: `Balasan berikutnya gagal dimuat. ${failureText(res.failure)}`,
			});
			return;
		}
		setMore({ loading: false, error: null });
		setRows((prev) => [
			...prev,
			...res.data.data.filter(
				(row) => !prev.some((seen) => seen.id === row.id),
			),
		]);
		setNextCursor(res.data.pagination.next_cursor);
	}

	return (
		<section
			aria-labelledby="saved-replies-heading"
			data-testid="saved-replies-section"
			className="flex flex-col gap-4"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h2 id="saved-replies-heading" className="text-base font-semibold">
						Balasan tersimpan CS
					</h2>
					<p className="text-sm text-muted-foreground">
						Template teks bersama untuk kotak masuk pelanggan. Hanya placeholder
						yang diizinkan (nama pembeli, nama produk, nomor pesanan) yang dapat
						disisipkan.
					</p>
				</div>
				<div className="flex flex-wrap gap-2 max-md:w-full">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void load()}
					>
						<RefreshCw aria-hidden="true" />
						Muat ulang
					</Button>
					{canWrite && (
						<Button
							type="button"
							size="sm"
							data-testid="saved-reply-new"
							onClick={() => setDialogTarget({ mode: "create" })}
						>
							<Plus aria-hidden="true" />
							Tambah balasan
						</Button>
					)}
				</div>
			</div>

			<DataTable
				rows={rows}
				rowKey={(row) => row.id}
				status={status}
				loadingLabel="Memuat balasan tersimpan…"
				empty="Belum ada balasan tersimpan."
				caption="Daftar balasan tersimpan CS"
				testId="saved-replies-table"
				rowTestId={(row) => `saved-reply-row-${row.id}`}
				activeKey={expandedId}
				stack
				paging={{
					hasMore: Boolean(nextCursor),
					loading: more.loading,
					onMore: () => void loadMore(),
					error: more.error,
					testId: "saved-replies-more",
				}}
				expanded={(row) =>
					expandedId === row.id ? (
						<div
							className="flex flex-col gap-2 py-2 text-sm"
							data-testid={`saved-reply-history-${row.id}`}
						>
							<p className="text-xs font-semibold text-muted-foreground">
								Riwayat versi {row.title} ({row.history?.length ?? 1} versi)
							</p>
							<ol className="flex flex-col gap-2">
								{(
									row.history ?? [
										{
											version: row.version,
											title: row.title,
											text: row.text,
											placeholders: row.placeholders,
											enabled: row.enabled,
											actor_id: null,
											reason: "Versi aktif",
											created_at: "",
										},
									]
								).map((ver) => (
									<li
										key={ver.version}
										data-testid={`saved-reply-version-${row.id}-${ver.version}`}
										className="flex flex-col gap-0.5 border-l-2 pl-3"
									>
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-medium tabular-nums">
												Versi v{ver.version}
											</span>
											<StatusBadge tone={ver.enabled ? "success" : "open"}>
												{ver.enabled ? "Aktif" : "Nonaktif"}
											</StatusBadge>
											{ver.created_at && (
												<span className="text-xs text-muted-foreground">
													{formatWib(ver.created_at)}
												</span>
											)}
										</div>
										<span className="text-xs font-medium">{ver.title}</span>
										<span className="text-xs text-muted-foreground break-words">
											{ver.text}
										</span>
										{ver.reason && (
											<span className="text-xs break-words">
												Alasan: {ver.reason}
											</span>
										)}
									</li>
								))}
							</ol>
						</div>
					) : null
				}
				columns={[
					{
						id: "title",
						header: "Judul",
						stack: "title",
						cell: (row) => <span className="font-medium">{row.title}</span>,
					},
					{
						id: "text",
						header: "Isi template",
						cellClassName: "max-w-96 whitespace-normal",
						cell: (row) => (
							<div className="flex flex-col gap-1">
								<span className="text-sm break-words">{row.text}</span>
								{row.placeholders.length > 0 && (
									<div className="flex flex-wrap gap-1">
										{row.placeholders.map((ph) => (
											<Badge key={ph} variant="outline" className="font-mono text-xs">
												{`{{${ph}}}`}
											</Badge>
										))}
									</div>
								)}
							</div>
						),
					},
					{
						id: "status",
						header: "Status",
						stack: "status",
						cell: (row) => (
							<StatusBadge tone={row.enabled ? "success" : "open"}>
								{row.enabled ? "Aktif" : "Nonaktif"}
							</StatusBadge>
						),
					},
					{
						id: "version",
						header: "Versi",
						stack: "aside",
						className: "text-right tabular-nums",
						cell: (row) => `v${row.version}`,
					},
					{
						id: "actions",
						header: "Tindakan",
						className: "text-right",
						cell: (row) => (
							<div className="flex flex-wrap justify-end gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									aria-expanded={expandedId === row.id}
									data-testid={`saved-reply-history-toggle-${row.id}`}
									onClick={() =>
										setExpandedId((prev) => (prev === row.id ? null : row.id))
									}
								>
									<History aria-hidden="true" />
									Riwayat versi
								</Button>
								{canWrite && (
									<Button
										type="button"
										size="sm"
										data-testid={`saved-reply-edit-${row.id}`}
										onClick={() =>
											setDialogTarget({ mode: "version", item: row })
										}
									>
										<Pencil aria-hidden="true" />
										Versi baru
									</Button>
								)}
							</div>
						),
					},
				]}
			/>

			{dialogTarget && (
				<SavedReplyDialog
					item={dialogTarget.mode === "version" ? dialogTarget.item : null}
					onClose={() => setDialogTarget(null)}
					onStale={() => void load()}
					onDone={(saved, created) => {
						setDialogTarget(null);
						onNotice(
							created
								? `Balasan tersimpan "${saved.title}" dibuat (versi v${saved.version}).`
								: `Balasan tersimpan "${saved.title}" diperbarui ke versi v${saved.version}.`,
						);
						void load();
					}}
				/>
			)}
		</section>
	);
}

function SavedReplyDialog({
	item,
	onClose,
	onStale,
	onDone,
}: {
	item: SavedReplyItem | null;
	onClose: () => void;
	onStale: () => void;
	onDone: (saved: SavedReplyItem, created: boolean) => void;
}) {
	const id = useId();
	// Frozen on mount: a background reload after 409 VERSION_CONFLICT must not silently advance the version an open dialog submits.
	const [capturedVersion] = useState(item ? item.version : 0);
	const [title, setTitle] = useState(item?.title ?? "");
	const [text, setText] = useState(item?.text ?? "");
	const [placeholders, setPlaceholders] = useState<string[]>(
		item?.placeholders ?? [],
	);
	const [enabled, setEnabled] = useState(item?.enabled ?? true);
	const [reason, setReason] = useState("");
	const intent = useSettingsIntent();

	function togglePlaceholder(key: string, checked: boolean) {
		setPlaceholders((prev) =>
			checked ? [...new Set([...prev, key])] : prev.filter((k) => k !== key),
		);
	}

	async function submit() {
		if (!title.trim()) {
			intent.setError("Judul balasan wajib diisi.");
			return;
		}
		if (!text.trim()) {
			intent.setError("Isi template balasan wajib diisi.");
			return;
		}
		const tokenMatches = [...text.matchAll(/\{\{([a-z0-9_]+)\}\}/gi)].map(
			(m) => m[1],
		);
		const allowedKeys = new Set<string>(PLACEHOLDERS.map((p) => p.key));
		for (const token of tokenMatches) {
			if (!allowedKeys.has(token)) {
				intent.setError(
					`Placeholder {{${token}}} tidak diizinkan. Gunakan hanya customer_name, product_title, atau order_reference.`,
				);
				return;
			}
		}
		const mergedPlaceholders = [
			...new Set([...placeholders, ...tokenMatches]),
		];
		if (!reason.trim()) {
			intent.setError("Alasan perubahan wajib diisi.");
			return;
		}

		const url = item
			? `/api/v1/admin/support/saved-replies/${item.id}/versions`
			: "/api/v1/admin/support/saved-replies";

		const saved = await intent.run<SavedReplyItem>(
			url,
			() => ({
				expected_version: capturedVersion,
				title: title.trim(),
				text: text.trim(),
				placeholders: mergedPlaceholders,
				enabled,
				reason: reason.trim(),
			}),
			{
				onStale,
				onUncertain: onStale,
			},
		);
		if (saved) {
			onDone(saved, item === null);
		}
	}

	return (
		<FormDialog
			title={item ? `Versi baru: ${item.title}` : "Tambah balasan tersimpan"}
			description={
				item
					? `Menambah versi v${capturedVersion + 1} (didasarkan pada versi v${capturedVersion}).`
					: "Membuat template balasan tersimpan baru (versi v1)."
			}
			pending={intent.pending}
			error={intent.error}
			submitLabel={item ? "Simpan versi balasan" : "Buat balasan"}
			pendingLabel="Menyimpan…"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id={`${id}-title`} label="Judul balasan">
				<Input
					id={`${id}-title`}
					data-testid="saved-reply-title"
					maxLength={120}
					autoComplete="off"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
				/>
			</FormField>

			<FormField
				id={`${id}-text`}
				label="Isi template"
				hint="Teks biasa; placeholder yang diizinkan: {{customer_name}}, {{product_title}}, {{order_reference}}."
			>
				<Textarea
					id={`${id}-text`}
					data-testid="saved-reply-text"
					rows={4}
					maxLength={4000}
					aria-describedby={`${id}-text-hint`}
					value={text}
					onChange={(e) => setText(e.target.value)}
				/>
			</FormField>

			<fieldset className="flex flex-col gap-1">
				<legend className="mb-1 text-sm font-medium">
					Placeholder yang dipakai
				</legend>
				{PLACEHOLDERS.map((ph) => (
					<label
						key={ph.key}
						className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11"
					>
						<input
							type="checkbox"
							data-testid={`saved-reply-ph-${ph.key}`}
							className="size-4 accent-primary"
							checked={placeholders.includes(ph.key)}
							onChange={(e) => togglePlaceholder(ph.key, e.target.checked)}
						/>
						{ph.label}
					</label>
				))}
			</fieldset>

			<label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
				<input
					type="checkbox"
					data-testid="saved-reply-enabled"
					className="size-4 accent-primary"
					checked={enabled}
					onChange={(e) => setEnabled(e.target.checked)}
				/>
				Aktifkan balasan ini di kotak masuk CS
			</label>

			<FormField id={`${id}-reason`} label="Alasan perubahan">
				<Input
					id={`${id}-reason`}
					data-testid="saved-reply-reason"
					maxLength={500}
					autoComplete="off"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>

		</FormDialog>
	);
}

function SupportTagsSection({
	canWrite,
	onNotice,
}: {
	canWrite: boolean;
	onNotice: (message: string) => void;
}) {
	const [rows, setRows] = useState<SupportTagItem[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [status, setStatus] = useState<DataTableStatus>({ kind: "loading" });
	const [more, setMore] = useState<{ loading: boolean; error: string | null }>({
		loading: false,
		error: null,
	});
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [dialogTarget, setDialogTarget] = useState<
		{ mode: "create" } | { mode: "version"; item: SupportTagItem } | null
	>(null);
	const requestRef = useRef(0);

	const load = useCallback(async () => {
		const runId = ++requestRef.current;
		setStatus({ kind: "loading" });
		const res = await getJson<ListPage<SupportTagItem>>(
			`/api/v1/admin/support/tags?limit=${PAGE}`,
		);
		if (runId !== requestRef.current) return;
		if (res.ok) {
			setRows(res.data.data);
			setNextCursor(res.data.pagination.next_cursor);
			setStatus({ kind: "ready" });
		} else {
			setRows([]);
			setNextCursor(null);
			setStatus(
				res.failure.status === 403
					? { kind: "denied", message: res.failure.message }
					: {
							kind: "error",
							message: failureText(res.failure),
							onRetry: () => void load(),
						},
			);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function loadMore() {
		if (!nextCursor || more.loading) return;
		setMore({ loading: true, error: null });
		const res = await getJson<ListPage<SupportTagItem>>(
			`/api/v1/admin/support/tags?limit=${PAGE}&cursor=${encodeURIComponent(nextCursor)}`,
		);
		if (!res.ok) {
			setMore({
				loading: false,
				error: `Tag berikutnya gagal dimuat. ${failureText(res.failure)}`,
			});
			return;
		}
		setMore({ loading: false, error: null });
		setRows((prev) => [
			...prev,
			...res.data.data.filter(
				(row) => !prev.some((seen) => seen.id === row.id),
			),
		]);
		setNextCursor(res.data.pagination.next_cursor);
	}

	return (
		<section
			aria-labelledby="support-tags-heading"
			data-testid="support-tags-section"
			className="flex flex-col gap-4 border-t pt-6"
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h2 id="support-tags-heading" className="text-base font-semibold">
						Tag percakapan CS
					</h2>
					<p className="text-sm text-muted-foreground">
						Tag klasifikasi internal untuk mengelompokkan percakapan pelanggan
						(tidak terlihat oleh pembeli).
					</p>
				</div>
				<div className="flex flex-wrap gap-2 max-md:w-full">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void load()}
					>
						<RefreshCw aria-hidden="true" />
						Muat ulang
					</Button>
					{canWrite && (
						<Button
							type="button"
							size="sm"
							data-testid="support-tag-new"
							onClick={() => setDialogTarget({ mode: "create" })}
						>
							<Plus aria-hidden="true" />
							Tambah tag
						</Button>
					)}
				</div>
			</div>

			<DataTable
				rows={rows}
				rowKey={(row) => row.id}
				status={status}
				loadingLabel="Memuat tag percakapan…"
				empty="Belum ada tag percakapan."
				caption="Daftar tag percakapan CS"
				testId="support-tags-table"
				rowTestId={(row) => `support-tag-row-${row.id}`}
				activeKey={expandedId}
				stack
				paging={{
					hasMore: Boolean(nextCursor),
					loading: more.loading,
					onMore: () => void loadMore(),
					error: more.error,
					testId: "support-tags-more",
				}}
				expanded={(row) =>
					expandedId === row.id ? (
						<div
							className="flex flex-col gap-2 py-2 text-sm"
							data-testid={`support-tag-history-${row.id}`}
						>
							<p className="text-xs font-semibold text-muted-foreground">
								Riwayat versi {row.label} ({row.history?.length ?? 1} versi)
							</p>
							<ol className="flex flex-col gap-2">
								{(
									row.history ?? [
										{
											version: row.version,
											label: row.label,
											enabled: row.enabled,
											actor_id: null,
											reason: "Versi aktif",
											created_at: "",
										},
									]
								).map((ver) => (
									<li
										key={ver.version}
										data-testid={`support-tag-version-${row.id}-${ver.version}`}
										className="flex flex-col gap-0.5 border-l-2 pl-3"
									>
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-medium tabular-nums">
												Versi v{ver.version}
											</span>
											<StatusBadge tone={ver.enabled ? "success" : "open"}>
												{ver.enabled ? "Aktif" : "Nonaktif"}
											</StatusBadge>
											{ver.created_at && (
												<span className="text-xs text-muted-foreground">
													{formatWib(ver.created_at)}
												</span>
											)}
										</div>
										<span className="text-xs font-medium">{ver.label}</span>
										{ver.reason && (
											<span className="text-xs break-words">
												Alasan: {ver.reason}
											</span>
										)}
									</li>
								))}
							</ol>
						</div>
					) : null
				}
				columns={[
					{
						id: "label",
						header: "Label tag",
						stack: "title",
						cell: (row) => <span className="font-medium">{row.label}</span>,
					},
					{
						id: "status",
						header: "Status",
						stack: "status",
						cell: (row) => (
							<StatusBadge tone={row.enabled ? "success" : "open"}>
								{row.enabled ? "Aktif" : "Nonaktif"}
							</StatusBadge>
						),
					},
					{
						id: "version",
						header: "Versi",
						stack: "aside",
						className: "text-right tabular-nums",
						cell: (row) => `v${row.version}`,
					},
					{
						id: "actions",
						header: "Tindakan",
						className: "text-right",
						cell: (row) => (
							<div className="flex flex-wrap justify-end gap-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									aria-expanded={expandedId === row.id}
									data-testid={`support-tag-history-toggle-${row.id}`}
									onClick={() =>
										setExpandedId((prev) => (prev === row.id ? null : row.id))
									}
								>
									<History aria-hidden="true" />
									Riwayat versi
								</Button>
								{canWrite && (
									<Button
										type="button"
										size="sm"
										data-testid={`support-tag-edit-${row.id}`}
										onClick={() =>
											setDialogTarget({ mode: "version", item: row })
										}
									>
										<Pencil aria-hidden="true" />
										Versi baru
									</Button>
								)}
							</div>
						),
					},
				]}
			/>

			{dialogTarget && (
				<SupportTagDialog
					item={dialogTarget.mode === "version" ? dialogTarget.item : null}
					onClose={() => setDialogTarget(null)}
					onStale={() => void load()}
					onDone={(saved, created) => {
						setDialogTarget(null);
						onNotice(
							created
								? `Tag percakapan "${saved.label}" dibuat (versi v${saved.version}).`
								: `Tag percakapan "${saved.label}" diperbarui ke versi v${saved.version}.`,
						);
						void load();
					}}
				/>
			)}
		</section>
	);
}

function SupportTagDialog({
	item,
	onClose,
	onStale,
	onDone,
}: {
	item: SupportTagItem | null;
	onClose: () => void;
	onStale: () => void;
	onDone: (saved: SupportTagItem, created: boolean) => void;
}) {
	const id = useId();
	// Frozen on mount: a background reload after 409 VERSION_CONFLICT must not silently advance the version an open dialog submits.
	const [capturedVersion] = useState(item ? item.version : 0);
	const [label, setLabel] = useState(item?.label ?? "");
	const [enabled, setEnabled] = useState(item?.enabled ?? true);
	const [reason, setReason] = useState("");
	const intent = useSettingsIntent();

	async function submit() {
		if (!label.trim()) {
			intent.setError("Label tag wajib diisi.");
			return;
		}
		if (!reason.trim()) {
			intent.setError("Alasan perubahan wajib diisi.");
			return;
		}

		const url = item
			? `/api/v1/admin/support/tags/${item.id}/versions`
			: "/api/v1/admin/support/tags";

		const saved = await intent.run<SupportTagItem>(
			url,
			() => ({
				expected_version: capturedVersion,
				label: label.trim(),
				enabled,
				reason: reason.trim(),
			}),
			{
				onStale,
				onUncertain: onStale,
			},
		);
		if (saved) {
			onDone(saved, item === null);
		}
	}

	return (
		<FormDialog
			title={item ? `Versi baru tag: ${item.label}` : "Tambah tag percakapan"}
			description={
				item
					? `Menambah versi v${capturedVersion + 1} (didasarkan pada versi v${capturedVersion}).`
					: "Membuat tag percakapan baru (versi v1)."
			}
			pending={intent.pending}
			error={intent.error}
			submitLabel={item ? "Simpan versi tag" : "Buat tag"}
			pendingLabel="Menyimpan…"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id={`${id}-label`} label="Label tag">
				<Input
					id={`${id}-label`}
					data-testid="support-tag-label"
					maxLength={80}
					autoComplete="off"
					value={label}
					onChange={(e) => setLabel(e.target.value)}
				/>
			</FormField>

			<label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
				<input
					type="checkbox"
					data-testid="support-tag-enabled"
					className="size-4 accent-primary"
					checked={enabled}
					onChange={(e) => setEnabled(e.target.checked)}
				/>
				Aktifkan tag ini untuk klasifikasi percakapan
			</label>

			<FormField id={`${id}-reason`} label="Alasan perubahan">
				<Input
					id={`${id}-reason`}
					data-testid="support-tag-reason"
					maxLength={500}
					autoComplete="off"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>

		</FormDialog>
	);
}
