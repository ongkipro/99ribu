"use client";

import { ChevronRight, CircleCheck, Plus } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { rupiah, wibDateTime, wibInputToIso } from "@/modules/storefront/format";
import { failureText, getJson } from "./admin-errors";
import { DataTable, type DataTableStatus } from "./data-table";
import { FormDialog, FormField } from "./form";
import { send, useOperationKey } from "./ops-api";
import { LoadingState } from "./states";
import { StatusBadge } from "./status";

// S134 / spec 17 B9 and A9: HPP (component) and offer cost-assumption version history with the append form.
// Versions are immutable and prospective only (the domain refuses a past effective time and a stale
// expected_version); this screen only sends the request and shows the domain's refusal. Hiding the form
// is a convenience: the API requires finance.costs.write (owner implicitly) on every POST, and
// finance.costs.read on every GET, and each history read is audited, so history loads only when opened.

export type CostKind = "component" | "assumption";
export type AssumptionField = "packaging_idr" | "provider_fee_idr" | "subsidy_idr" | "returns_reserve_idr";
export const ASSUMPTION_LABELS: Record<AssumptionField, string> = {
	packaging_idr: "Kemasan",
	provider_fee_idr: "Biaya penyedia pembayaran",
	subsidy_idr: "Subsidi ongkir",
	returns_reserve_idr: "Cadangan retur",
};
const ASSUMPTION_FIELDS = Object.keys(ASSUMPTION_LABELS) as AssumptionField[];

type Version = {
	id: string;
	version: number;
	effective_from: string;
	source: string;
	reason: string;
	recorded_at: string;
	unit_cost?: number | null;
} & Partial<Record<AssumptionField, number | null>>;
type History = {
	data: Version[];
	pagination: { next_cursor: string | null };
	latest_version: number;
	current: Version | null;
};

const CODE_MESSAGES: Record<string, string> = {
	RETROACTIVE_COST_FORBIDDEN:
		"Waktu berlaku tidak boleh di masa lalu. Versi biaya hanya berlaku ke depan: pilih Berlaku sekarang atau waktu di masa depan.",
	COST_SCHEDULE_TOO_DISTANT: "Waktu berlaku paling jauh 366 hari dari sekarang.",
	SCHEDULE_CONFLICT: "Sudah ada versi terjadwal yang mulai lebih lambat. Versi baru tidak boleh mendahuluinya.",
	INVALID_COST_TIME: "Waktu berlaku tidak valid.",
	VERSION_CONFLICT:
		"Versi biaya sudah berubah sejak dialog dibuka. Riwayat dimuat ulang; tutup dialog, periksa versi terbaru, lalu buat versi baru.",
	NOT_FOUND: "SKU atau varian ini tidak ditemukan.",
	FORBIDDEN: "Peran Anda tidak boleh menulis biaya. Minta Super Admin memberi izin tulis biaya.",
};
const money = (value: number | null | undefined) => (value === null || value === undefined ? "Belum diisi" : rupiah(value));

/** "50.000" or "50000" → 50000; "" → null (unknown); undefined for anything else. */
function parseMoney(raw: string): number | null | undefined {
	const clean = raw.replace(/[.\s]/g, "");
	if (clean === "") return null;
	if (!/^\d{1,10}$/.test(clean)) return undefined;
	const value = Number(clean);
	return value <= 2_147_483_647 ? value : undefined;
}

/** A closed section that loads the (audited) history only when opened. */
export function CostDisclosure(props: HistoryProps & { title: string }) {
	const [opened, setOpened] = useState(false);
	return (
		<details
			className="group text-xs"
			onToggle={(event) => {
				if (event.currentTarget.open) setOpened(true);
			}}
		>
			<summary
				data-testid={`${props.testId ?? "cost"}-toggle`}
				className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 text-muted-foreground pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden"
			>
				<ChevronRight
					aria-hidden="true"
					className="size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
				/>
				{props.title}
			</summary>
			{opened && (
				<div className="mt-2">
					<CostHistory {...props} />
				</div>
			)}
		</details>
	);
}

type HistoryProps = {
	kind: CostKind;
	/** stock_item_id for `component`, offer_id for `assumption`. */
	scopeId: string;
	/** Name shown in the dialog title (SKU name or offer label). */
	subject: string;
	/** From the caller's grants: finance.costs.write (owner implicitly). The API refuses everyone else. */
	canWrite: boolean;
	/** Called after a version was saved (the caller refreshes derived numbers). */
	onWritten?: () => void;
	testId?: string;
};

const PAGE = 10;

/** Loads on mount. The caller mounts it only for roles that hold finance.costs.read. */
export function CostHistory({ kind, scopeId, subject, canWrite, onWritten, testId = "cost" }: HistoryProps) {
	const base = `/api/v1/admin/${kind === "component" ? "stock-items" : "offers"}/${scopeId}/${kind === "component" ? "cost-versions" : "cost-assumption-versions"}`;
	const [history, setHistory] = useState<History | null>(null);
	const [status, setStatus] = useState<DataTableStatus>({ kind: "loading" });
	const [more, setMore] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
	const [dialog, setDialog] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	const request = useRef(0);

	const load = useCallback(async () => {
		const n = ++request.current;
		setStatus({ kind: "loading" });
		const result = await getJson<History>(`${base}?limit=${PAGE}`);
		if (n !== request.current) return;
		if (result.ok) {
			setHistory(result.data);
			setStatus({ kind: "ready" });
		} else {
			setHistory(null);
			setStatus(
				result.failure.status === 403
					? { kind: "denied", message: result.failure.message }
					: { kind: "error", message: failureText(result.failure), onRetry: () => void load() },
			);
		}
	}, [base]);
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	async function loadMore() {
		const cursor = history?.pagination.next_cursor;
		if (!cursor || more.loading) return;
		setMore({ loading: true, error: null });
		const result = await getJson<History>(`${base}?limit=${PAGE}&cursor=${encodeURIComponent(cursor)}`);
		if (!result.ok) return setMore({ loading: false, error: `Riwayat berikutnya gagal dimuat. ${failureText(result.failure)}` });
		setMore({ loading: false, error: null });
		setHistory((prev) =>
			prev
				? {
						...prev,
						data: [...prev.data, ...result.data.data.filter((row) => !prev.data.some((seen) => seen.id === row.id))],
						pagination: result.data.pagination,
					}
				: prev,
		);
	}

	const now = Date.now();
	const columns = [
		{
			id: "version",
			header: "Versi",
			stack: "title" as const,
			className: "tabular-nums",
			cell: (row: Version) => (
				<span className="flex flex-wrap items-center gap-2 tabular-nums">
					{row.version}
					{row.id === history?.current?.id ? (
						<StatusBadge tone="success">Berlaku</StatusBadge>
					) : Date.parse(row.effective_from) > now ? (
						<StatusBadge tone="open">Terjadwal</StatusBadge>
					) : null}
				</span>
			),
		},
		{
			id: "from",
			header: "Berlaku sejak",
			stack: "meta" as const,
			kind: "datetime" as const,
			cell: (row: Version) => wibDateTime(row.effective_from),
		},
		...(kind === "component"
			? [{ id: "unit_cost", header: "HPP satuan", className: "text-right tabular-nums", cell: (row: Version) => money(row.unit_cost) }]
			: ASSUMPTION_FIELDS.map((field) => ({
					id: field,
					header: ASSUMPTION_LABELS[field],
					className: "text-right tabular-nums",
					cell: (row: Version) => money(row[field]),
				}))),
		{
			// One wrapping column: two narrow text columns were clipped inside the dialog ("Versi tersela").
			id: "note",
			header: "Sumber dan alasan",
			cellClassName: "min-w-40 max-w-64 whitespace-normal",
			cell: (row: Version) => (
				<span className="flex min-w-0 flex-col gap-0.5 break-words">
					<span>{row.source}</span>
					<span className="text-xs text-muted-foreground">{row.reason}</span>
				</span>
			),
		},
	];

	return (
		<div className="flex min-w-0 flex-col gap-3" data-testid={`${testId}-history`}>
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="border-success/30 bg-success-surface outline-none" data-testid={`${testId}-notice`}>
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			{status.kind === "loading" && !history ? (
				<LoadingState label="Memuat riwayat biaya…" lines={2} columns={4} />
			) : (
				<>
					{history && (
						<div className="flex flex-wrap items-start justify-between gap-3">
							<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-sm" data-testid={`${testId}-current`}>
								<dt className="text-muted-foreground">Berlaku sekarang</dt>
								<dd>
									{history.current
										? kind === "component"
											? `${money(history.current.unit_cost)} · versi ${history.current.version}`
											: `versi ${history.current.version}`
										: "Belum ada versi biaya. Nilai kosong tidak dihitung sebagai Rp0."}
								</dd>
								{history.current && kind === "assumption" &&
									ASSUMPTION_FIELDS.map((field) => (
										<div key={field} className="contents">
											<dt className="text-muted-foreground">{ASSUMPTION_LABELS[field]}</dt>
											<dd className="tabular-nums">{money(history.current?.[field])}</dd>
										</div>
									))}
							</dl>
							{canWrite && (
								<Button type="button" size="sm" data-testid={`${testId}-new`} className="max-md:w-full"
									onClick={() => {
										// The last save's notice would outlive a conflict or cancel and name a superseded version.
										setNotice(null);
										setDialog(true);
									}}
								>
									<Plus aria-hidden="true" />
									Versi biaya baru
								</Button>
							)}
						</div>
					)}
					{!canWrite && history && (
						<p className="text-xs text-muted-foreground" data-testid={`${testId}-readonly`}>
							Hanya baca. Menambah versi biaya memerlukan izin tulis biaya dari Super Admin.
						</p>
					)}
					<DataTable
						rows={history?.data ?? []}
						rowKey={(row) => row.id}
						status={status}
						loadingLabel="Memuat riwayat…"
						empty={canWrite ? "Belum ada versi biaya. Tambah versi pertama dengan Versi biaya baru." : "Belum ada versi biaya. Staf keuangan dengan izin tulis biaya mengisinya."}
						caption={`Riwayat biaya ${subject}`}
						testId={`${testId}-table`}
						rowTestId={(row) => `${testId}-row-${row.version}`}
						stack
						columns={columns}
						paging={{
							hasMore: Boolean(history?.pagination.next_cursor),
							loading: more.loading,
							onMore: () => void loadMore(),
							error: more.error,
							testId: `${testId}-more`,
						}}
					/>
				</>
			)}
			{dialog && history && (
				<CostVersionDialog
					kind={kind}
					base={base}
					subject={subject}
					expectedVersion={history.latest_version}
					testId={testId}
					onClose={() => setDialog(false)}
					onStale={() => void load()}
					onDone={(message) => {
						setDialog(false);
						setNotice(message);
						void load();
						onWritten?.();
					}}
				/>
			)}
		</div>
	);
}

function CostVersionDialog({
	kind,
	base,
	subject,
	expectedVersion,
	testId,
	onClose,
	onStale,
	onDone,
}: {
	kind: CostKind;
	base: string;
	subject: string;
	/** Captured when the dialog opened: the append is refused if the history moved since. */
	expectedVersion: number;
	testId: string;
	onClose: () => void;
	onStale: () => void;
	onDone: (message: string) => void;
}) {
	const id = useId();
	const key = useOperationKey();
	// Frozen on mount: a background reload after VERSION_CONFLICT must not silently advance the version an open dialog submits.
	const [capturedVersion] = useState(expectedVersion);
	const [amounts, setAmounts] = useState<Record<string, string>>({});
	const [when, setWhen] = useState<"now" | "later">("now");
	const [at, setAt] = useState("");
	const [source, setSource] = useState("");
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const dirty = Object.values(amounts).some((v) => v.trim()) || when !== "now" || Boolean(at || source.trim() || reason.trim());
	const fields = kind === "component" ? (["unit_cost"] as const) : ASSUMPTION_FIELDS;
	const label = (field: string) => (field === "unit_cost" ? "HPP satuan (Rp)" : `${ASSUMPTION_LABELS[field as AssumptionField]} (Rp)`);

	async function submit() {
		const values: Record<string, number | null> = {};
		for (const field of fields) {
			const parsed = parseMoney(amounts[field] ?? "");
			if (parsed === undefined) return setError(`${label(field)}: isi rupiah utuh (tanpa desimal), atau kosongkan bila belum diketahui.`);
			values[field] = parsed;
		}
		if (!source.trim()) return setError("Sumber wajib diisi, misalnya nama pemasok atau nomor faktur.");
		if (!reason.trim()) return setError("Alasan wajib diisi.");
		let effective: string | null = null;
		if (when === "later") {
			effective = at ? wibInputToIso(at) : null;
			if (!effective) return setError("Isi waktu berlaku (WIB) yang valid.");
		}
		setPending(true);
		setError(null);
		const result = await send<{ version: number; effective_from: string }>(
			"POST",
			base,
			{ ...values, expected_version: capturedVersion, effective_from: effective, source: source.trim(), reason: reason.trim() },
			key,
		);
		setPending(false);
		if (!result.ok) {
			if (result.code === "VERSION_CONFLICT") onStale();
			return setError(result.code && CODE_MESSAGES[result.code] ? `${CODE_MESSAGES[result.code]} (kode: ${result.code})` : result.text);
		}
		onDone(`Versi biaya ${result.data.version} untuk ${subject} tersimpan, berlaku ${wibDateTime(result.data.effective_from)}. Tercatat di log audit.`);
	}

	return (
		<FormDialog
			title={`Versi biaya baru: ${subject}`}
			description={`Menambah versi ${capturedVersion + 1}. Versi lama tidak diubah dan hanya waktu berlaku ke depan yang diterima. Kosongkan kolom yang belum diketahui; kosong tidak dihitung sebagai Rp0.`}
			pending={pending}
			error={error}
			submitLabel="Simpan versi"
			dirty={dirty}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			{fields.map((field) => (
				<FormField key={field} id={`${id}-${field}`} label={label(field)} hint="Rupiah utuh. 0 berarti benar-benar Rp0.">
					<Input
						id={`${id}-${field}`}
						data-testid={`${testId}-${field}`}
						inputMode="numeric"
						autoComplete="off"
						aria-describedby={`${id}-${field}-hint`}
						value={amounts[field] ?? ""}
						onChange={(event) => setAmounts((current) => ({ ...current, [field]: event.target.value }))}
					/>
				</FormField>
			))}
			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 text-sm font-medium">Berlaku</legend>
				<label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
					<input type="radio" name={`${id}-when`} className="size-4 accent-primary" checked={when === "now"} onChange={() => setWhen("now")} />
					Sekarang
				</label>
				<label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
					<input
						type="radio"
						name={`${id}-when`}
						data-testid={`${testId}-later`}
						className="size-4 accent-primary"
						checked={when === "later"}
						onChange={() => setWhen("later")}
					/>
					Jadwalkan
				</label>
				{when === "later" && (
					<FormField id={`${id}-at`} label="Waktu berlaku (WIB)" hint="Paling jauh 366 hari ke depan; waktu yang sudah lewat ditolak.">
						<Input
							id={`${id}-at`}
							data-testid={`${testId}-at`}
							type="datetime-local" lang="id"
							aria-describedby={`${id}-at-hint`}
							value={at}
							onChange={(event) => setAt(event.target.value)}
						/>
					</FormField>
				)}
			</fieldset>
			<FormField id={`${id}-source`} label="Sumber (wajib)">
				<Input id={`${id}-source`} data-testid={`${testId}-source`} maxLength={500} value={source} onChange={(event) => setSource(event.target.value)} />
			</FormField>
			<FormField id={`${id}-reason`} label="Alasan (wajib)">
				<Textarea id={`${id}-reason`} data-testid={`${testId}-reason`} rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
			</FormField>
		</FormDialog>
	);
}
