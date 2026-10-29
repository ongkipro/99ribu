"use client";

import { CircleCheck, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormDialog } from "./form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { rupiah, wibDate, wibInput, wibInputToIso } from "@/modules/storefront/format";
import { describeFailure, failureText, getJson, readFailure } from "./admin-errors";
import { DataTable } from "./data-table";
import { StatusBadge, type StatusTone } from "./status";

// DEC-007: Mengantar collects COD on 99ribu's own account and remits through its
// balance/settlement. Finance records each dashboard statement; money posts only
// through the existing COD receipt and settlement journals.
type Statement = {
	id: string;
	reference: string;
	statement_at: string;
	gross_amount: number;
	shipping_deduction: number;
	cod_fee_deduction: number;
	other_deduction: number;
	net_amount: number;
	expected_net_amount: number;
	flags: string[];
	settlement: { status: string; problem_code: string | null } | null;
	lines: {
		shipment_id: string;
		order_number: string;
		amount: number;
		expected_amount: number;
		collection_status: string;
	}[];
};
type Parcel = {
	shipment_id: string;
	order_number: string;
	cod_due: number;
	courier: string | null;
	tracking_number: string | null;
};
const FLAG_LABELS: Record<string, string> = {
	PARCEL_AMOUNT_MISMATCH: "Nominal paket berbeda",
	STATEMENT_TOTAL_MISMATCH: "Total tidak seimbang",
	OTHER_DEDUCTION_REVIEW: "Potongan lain perlu ditinjau",
	NET_BELOW_EXPECTED: "Dana bersih di bawah perkiraan",
	COLLECTION_CALLBACK_FAILED: "Pencatatan COD gagal",
	COLLECTION_MATCH_FAILED: "Pencocokan saldo gagal",
};
const SETTLEMENT_LABELS: Record<string, string> = {
	pending: "Menunggu pencocokan",
	partial: "Cocok sebagian",
	matched: "Cocok",
	mismatched: "Tidak cocok",
	exception: "Perlu tinjauan",
};
const SETTLEMENT_TONE: Record<string, StatusTone> = {
	matched: "success",
	mismatched: "problem",
	exception: "problem",
};
const CODE_MESSAGES: Record<string, string> = {
	STATEMENT_ALREADY_RECORDED: "Referensi laporan ini sudah pernah dicatat.",
	STATEMENT_PARCEL_NOT_SHIPPED: "Ada paket yang belum dikirim.",
	STATEMENT_PARCEL_NOT_COD: "Ada paket yang bukan COD.",
	STATEMENT_CLOCK_CONTEXT_MIXED: "Paket berasal dari konteks waktu berbeda.",
	INVALID_STATEMENT_REFERENCE:
		"Referensi hanya huruf, angka dan . _ : - (3–80 karakter).",
	PARCEL_ALREADY_REMITTED: "Ada paket yang sudah tercatat di setoran lain.",
	STATEMENT_PARCEL_NOT_MANUAL: "Hanya paket dengan resi manual Mengantar yang bisa dicatat.",
	STATEMENT_TOTAL_MISMATCH: "Tertagih harus sama dengan dana bersih ditambah semua potongan.",
	STATEMENT_DATE_IN_FUTURE: "Tanggal laporan tidak boleh di masa depan.",
	REAUTHENTICATION_REQUIRED: "Konfirmasi kata sandi gagal atau kedaluwarsa.",
	FRESH_MFA_REQUIRED: "Verifikasi dua langkah ulang diperlukan.",
};
const text = (status: number, code: string | null) =>
	code && CODE_MESSAGES[code]
		? `${CODE_MESSAGES[code]} (kode: ${code})`
		: failureText(describeFailure(status, code));

async function post(url: string, body: unknown, key: string) {
	try {
		const res = await fetch(url, {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json", "idempotency-key": key },
			body: JSON.stringify(body),
		});
		if (res.ok) return { ok: true as const, data: await res.json() };
		const failure = await readFailure(res);
		return { ok: false as const, text: text(res.status, failure.code) };
	} catch {
		return { ok: false as const, text: text(0, null) };
	}
}

const page = (cursor: string | null) =>
	getJson<{ data: Statement[]; pagination: { next_cursor: string | null } }>(
		`/api/v1/admin/cod-remittances?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
	);

export function CodSettlementsClient({ canWrite }: { canWrite: boolean }) {
	const [rows, setRows] = useState<Statement[]>([]);
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [loadError, setLoadError] = useState("");
	const [open, setOpen] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);

	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [more, setMore] = useState<"idle" | "loading" | "error">("idle");
	const load = useCallback(async () => {
		setState("loading");
		setMore("idle");
		const result = await page(null);
		if (result.ok) {
			setRows(result.data.data);
			setNextCursor(result.data.pagination.next_cursor);
			setState("ready");
		} else {
			setLoadError(failureText(result.failure));
			setState("error");
		}
	}, []);
	const loadMore = async () => {
		if (!nextCursor) return;
		setMore("loading");
		const result = await page(nextCursor);
		if (!result.ok) return setMore("error");
		setRows((current) => {
			const seen = new Set(current.map((r) => r.id));
			return [...current, ...result.data.data.filter((r) => !seen.has(r.id))];
		});
		setNextCursor(result.data.pagination.next_cursor);
		setMore("idle");
	};
	useEffect(() => {
		void load();
	}, [load]);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	return (
		<div className="flex flex-col gap-6">
			{notice && (
				<Alert ref={noticeRef} tabIndex={-1} role="status" className="outline-none">
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">{notice}</AlertDescription>
				</Alert>
			)}
			<div className="flex flex-wrap items-center gap-2 max-md:*:flex-1">
				<Button
					onClick={() => setOpen(true)}
					data-testid="cod-record-open"
					disabled={!canWrite}
					aria-describedby={canWrite ? undefined : "cod-read-only-reason"}
				>
					<Plus aria-hidden="true" />
					Catat setoran COD
				</Button>
				<Button variant="outline" onClick={() => void load()}>
					<RefreshCw aria-hidden="true" />
					Muat ulang
				</Button>
				{!canWrite && (
					<p id="cod-read-only-reason" data-testid="cod-read-only" className="text-sm text-muted-foreground">
						Hanya lihat: mencatat setoran memerlukan izin tulis rekonsiliasi keuangan.
					</p>
				)}
			</div>
			<DataTable
				rows={rows}
				rowKey={(row) => row.id}
				status={
					state === "loading"
						? { kind: "loading" }
						: state === "error"
							? { kind: "error", message: loadError, onRetry: () => void load() }
							: { kind: "ready" }
				}
				loadingLabel="Memuat setoran…"
				empty={
					canWrite
						? "Belum ada setoran COD Mengantar yang dicatat. Catat laporan saldo COD pertama lewat tombol Catat setoran COD."
						: "Belum ada setoran COD Mengantar yang dicatat."
				}
				testId="cod-statements"
				caption="Setoran COD Mengantar yang dicatat, terbaru di atas"
				stack
				columns={[
					{
						id: "reference",
						header: "Referensi",
						stack: "title",
						cellClassName: "font-medium max-md:block",
						cell: (row) => (
							<>
								{row.reference}
								<span className="block text-xs text-muted-foreground">{row.lines.length} paket</span>
							</>
						),
					},
					{ id: "date", header: "Tanggal laporan", stack: "meta", className: "whitespace-nowrap tabular-nums", cell: (row) => wibDate(row.statement_at) },
					{ id: "gross", header: "Tertagih", className: "text-right tabular-nums", cell: (row) => rupiah(row.gross_amount) },
					{ id: "net", header: "Diterima", stack: "aside", className: "text-right tabular-nums", cell: (row) => rupiah(row.net_amount) },
					// The flags already name a gap to the estimate; the estimate itself gives way first at 768.
					{ id: "expected", header: "Perkiraan bersih", hideBelow: "6xl", className: "text-right tabular-nums", cell: (row) => rupiah(row.expected_net_amount) },
					{
						id: "status",
						header: "Status",
						stack: "status",
						cell: (row) => (
							<div className="flex flex-wrap gap-1">
								<StatusBadge tone={SETTLEMENT_TONE[row.settlement?.status ?? "pending"] ?? "open"}>
									{SETTLEMENT_LABELS[row.settlement?.status ?? "pending"] ?? row.settlement?.status}
								</StatusBadge>
								{row.flags.map((flag) => (
									// A gap to review is uncertain (problem); a failed recording step is danger.
									<StatusBadge key={flag} tone={flag.endsWith("_FAILED") ? "danger" : "problem"}>
										{FLAG_LABELS[flag] ?? flag}
									</StatusBadge>
								))}
							</div>
						),
					},
				]}
				paging={{
					hasMore: nextCursor !== null,
					loading: more === "loading",
					onMore: () => void loadMore(),
					error: more === "error" ? "Halaman berikutnya gagal dimuat. Coba lagi." : null,
				}}
			/>
			{open && (
				<RecordDialog
					onClose={() => setOpen(false)}
					onDone={(message) => {
						setOpen(false);
						setNotice(message);
						void load();
					}}
				/>
			)}
		</div>
	);
}

function RecordDialog({
	onClose,
	onDone,
}: {
	onClose: () => void;
	onDone: (message: string) => void;
}) {
	// Statement id is fixed per dialog session; the reauthentication proof binds to it.
	const statementId = useRef(crypto.randomUUID());
	const key = useRef(crypto.randomUUID());
	const [parcels, setParcels] = useState<Parcel[] | null>(null);
	const [amounts, setAmounts] = useState<Record<string, string>>({});
	const [form, setForm] = useState({
		reference: "",
		statementAt: "",
		shipping: "0",
		codFee: "0",
		other: "0",
		net: "",
		evidence: "",
		reason: "",
		password: "",
	});
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	useEffect(() => {
		void getJson<{ data: Parcel[] }>("/api/v1/admin/cod-collectible-parcels").then(
			(result) => {
				if (result.ok) setParcels(result.data.data);
				else setError(failureText(result.failure));
			},
		);
	}, []);
	const chosen = Object.entries(amounts).filter(([, v]) => v !== "");
	const gross = chosen.reduce((n, [, v]) => n + (Number(v) || 0), 0);
	const deductions =
		(Number(form.shipping) || 0) + (Number(form.codFee) || 0) + (Number(form.other) || 0);

	async function submit() {
		if (!chosen.length) return setError("Pilih minimal satu paket.");
		if (!form.reference || !form.statementAt || form.net === "" || !form.evidence || !form.reason || !form.password)
			return setError("Lengkapi semua isian wajib.");
		// The statement date is a WIB calendar day (00.00 WIB), not the device's midnight.
		const statementAt = wibInputToIso(form.statementAt);
		if (!statementAt) return setError("Tanggal laporan tidak valid.");
		setPending(true);
		setError(null);
		const proof = await post(
			"/api/v1/me/reauthentication-proofs",
			{ password: form.password, action: "finance.reconcile", subject_id: statementId.current },
			crypto.randomUUID(),
		);
		if (!proof.ok) {
			setPending(false);
			return setError(proof.text);
		}
		const result = await post(
			"/api/v1/admin/cod-remittances",
			{
				id: statementId.current,
				reference: form.reference.trim(),
				statement_at: statementAt,
				lines: chosen.map(([shipment_id, v]) => ({ shipment_id, amount: Number(v) })),
				shipping_deduction: Number(form.shipping) || 0,
				cod_fee_deduction: Number(form.codFee) || 0,
				other_deduction: Number(form.other) || 0,
				net_amount: Number(form.net),
				evidence: form.evidence.trim(),
				reason: form.reason.trim(),
				reauthentication_proof: proof.data.proof,
			},
			key.current,
		);
		setPending(false);
		if (result.ok) {
			onDone(
				result.data.flags.length
					? `Setoran ${result.data.reference} tercatat dengan selisih yang perlu ditinjau.`
					: `Setoran ${result.data.reference} tercatat dan sedang dicocokkan.`,
			);
			return;
		}
		setError(result.text);
		key.current = crypto.randomUUID();
		statementId.current = crypto.randomUUID();
	}
	const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
		setForm({ ...form, [field]: e.target.value });

	const dirty =
		chosen.length > 0 ||
		!!(form.reference || form.statementAt || form.net || form.evidence || form.reason || form.password) ||
		form.shipping !== "0" ||
		form.codFee !== "0" ||
		form.other !== "0";
	return (
		<FormDialog
			title="Catat setoran COD Mengantar"
			description="Salin dari laporan saldo COD di dasbor Mengantar. Selisih nominal atau total ditandai untuk ditinjau, tidak diterima diam-diam."
			className="sm:max-w-2xl"
			pending={pending}
			error={error}
			submitLabel="Simpan setoran"
			dirty={dirty}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
					<fieldset className="flex flex-col gap-2">
						<legend className="text-sm font-medium">Paket COD dalam laporan</legend>
						{parcels === null && !error && (
							<p className="text-sm text-muted-foreground">Memuat paket…</p>
						)}
						{parcels?.length === 0 && (
							<p className="text-sm text-muted-foreground">
								Tidak ada paket COD terkirim yang belum tertagih.
							</p>
						)}
						{parcels?.map((p) => (
							<div key={p.shipment_id} className="flex flex-wrap items-center gap-2">
								<input
									type="checkbox"
									id={`cod-${p.shipment_id}`}
									className="size-4 accent-primary"
									checked={p.shipment_id in amounts}
									onChange={(e) => {
										const next = { ...amounts };
										if (e.target.checked) next[p.shipment_id] = String(p.cod_due);
										else delete next[p.shipment_id];
										setAmounts(next);
									}}
								/>
								<label htmlFor={`cod-${p.shipment_id}`} className="min-w-40 flex-1 text-sm pointer-coarse:min-h-11">
									{p.order_number}
									<span className="block font-mono text-xs text-muted-foreground tabular-nums">
										{p.tracking_number ?? "—"} · tagihan saat ini {rupiah(p.cod_due)}
									</span>
								</label>
								{p.shipment_id in amounts && (
									<Input
										aria-label={`Nominal tertagih ${p.order_number}`}
										inputMode="numeric"
										className="w-36 text-right tabular-nums"
										value={amounts[p.shipment_id]}
										onChange={(e) =>
											setAmounts({ ...amounts, [p.shipment_id]: e.target.value.replace(/\D/g, "") })
										}
									/>
								)}
							</div>
						))}
					</fieldset>
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="flex flex-col gap-1">
							<label htmlFor="cod-field-1" className="text-sm font-medium">
								Referensi laporan
							</label>
							<Input id="cod-field-1" value={form.reference} onChange={set("reference")} maxLength={80} />
						</div>
						<div className="flex flex-col gap-1">
							<label htmlFor="cod-field-2" className="text-sm font-medium">
								Tanggal laporan (WIB)
							</label>
							<Input id="cod-field-2" type="date" max={wibInput(Date.now()).slice(0, 10)} value={form.statementAt} onChange={set("statementAt")} />
						</div>
						<div className="flex flex-col gap-1">
							<label htmlFor="cod-field-3" className="text-sm font-medium">
								Potongan ongkir Mengantar
							</label>
							<Input id="cod-field-3" inputMode="numeric" value={form.shipping} onChange={set("shipping")} />
						</div>
						<div className="flex flex-col gap-1">
							<label htmlFor="cod-field-4" className="text-sm font-medium">
								Potongan biaya COD Mengantar
							</label>
							<Input id="cod-field-4" inputMode="numeric" value={form.codFee} onChange={set("codFee")} />
						</div>
						<div className="flex flex-col gap-1">
							<label htmlFor="cod-field-5" className="text-sm font-medium">
								Potongan lain (perlu ditinjau)
							</label>
							<Input id="cod-field-5" inputMode="numeric" value={form.other} onChange={set("other")} />
						</div>
						<div className="flex flex-col gap-1">
							<label htmlFor="cod-field-6" className="text-sm font-medium">
								Dana bersih diterima
							</label>
							<Input id="cod-field-6" inputMode="numeric" value={form.net} onChange={set("net")} />
						</div>
					</div>
					<p className="text-sm text-muted-foreground" aria-live="polite">
						Total tertagih {rupiah(gross)} · perkiraan bersih {rupiah(gross - deductions)}
						{form.net !== "" && Number(form.net) !== gross - deductions
							? " · tidak seimbang, akan ditandai"
							: ""}
					</p>
					<div className="flex flex-col gap-1">
						<label htmlFor="cod-field-7" className="text-sm font-medium">
							Bukti (nomor penarikan, tangkapan layar yang disimpan)
						</label>
						<Textarea id="cod-field-7" value={form.evidence} onChange={set("evidence")} maxLength={500} />
					</div>
					<div className="flex flex-col gap-1">
						<label htmlFor="cod-field-8" className="text-sm font-medium">
							Alasan
						</label>
						<Input id="cod-field-8" value={form.reason} onChange={set("reason")} maxLength={200} />
					</div>
					<div className="flex flex-col gap-1">
						<label htmlFor="cod-field-9" className="text-sm font-medium">
							Konfirmasi kata sandi
						</label>
						<Input id="cod-field-9"
							type="password"
							autoComplete="current-password"
							value={form.password}
							onChange={set("password")}
						/>
					</div>
		</FormDialog>
	);
}
