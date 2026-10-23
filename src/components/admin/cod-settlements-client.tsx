"use client";

import { CircleAlert, CircleCheck, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { rupiah } from "@/modules/storefront/format";
import { describeFailure, failureText, getJson, readFailure } from "./admin-errors";

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
const date = new Intl.DateTimeFormat("id-ID", {
	dateStyle: "medium",
	timeZone: "Asia/Jakarta",
});

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

export function CodSettlementsClient() {
	const [rows, setRows] = useState<Statement[]>([]);
	const [state, setState] = useState<"loading" | "ready" | "error">("loading");
	const [loadError, setLoadError] = useState("");
	const [open, setOpen] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);

	const load = useCallback(async () => {
		setState("loading");
		const result = await getJson<{ data: Statement[] }>(
			"/api/v1/admin/cod-remittances?limit=50",
		);
		if (result.ok) {
			setRows(result.data.data);
			setState("ready");
		} else {
			setLoadError(failureText(result.failure));
			setState("error");
		}
	}, []);
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
			<div className="flex flex-wrap gap-2">
				<Button onClick={() => setOpen(true)} data-testid="cod-record-open">
					<Plus aria-hidden="true" />
					Catat setoran COD
				</Button>
				<Button variant="outline" onClick={() => void load()}>
					<RefreshCw aria-hidden="true" />
					Muat ulang
				</Button>
			</div>
			{state === "loading" && (
				<p className="text-sm text-muted-foreground" aria-live="polite">
					Memuat setoran…
				</p>
			)}
			{state === "error" && (
				<Alert role="alert">
					<CircleAlert aria-hidden="true" />
					<AlertDescription className="text-foreground">{loadError}</AlertDescription>
				</Alert>
			)}
			{state === "ready" && rows.length === 0 && (
				<p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
					Belum ada setoran COD Mengantar yang dicatat.
				</p>
			)}
			{state === "ready" && rows.length > 0 && (
				<div className="overflow-x-auto rounded-lg border">
					<Table data-testid="cod-statements">
						<TableHeader>
							<TableRow>
								<TableHead>Referensi</TableHead>
								<TableHead>Tanggal laporan</TableHead>
								<TableHead className="text-right">Tertagih</TableHead>
								<TableHead className="text-right">Diterima</TableHead>
								<TableHead className="text-right">Perkiraan bersih</TableHead>
								<TableHead>Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow key={row.id}>
									<TableCell className="font-medium">
										{row.reference}
										<span className="block text-xs text-muted-foreground">
											{row.lines.length} paket
										</span>
									</TableCell>
									<TableCell>{date.format(new Date(row.statement_at))}</TableCell>
									<TableCell className="text-right">{rupiah(row.gross_amount)}</TableCell>
									<TableCell className="text-right">{rupiah(row.net_amount)}</TableCell>
									<TableCell className="text-right">
										{rupiah(row.expected_net_amount)}
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap gap-1">
											<Badge variant={row.settlement?.status === "matched" ? "default" : "outline"}>
												{SETTLEMENT_LABELS[row.settlement?.status ?? "pending"] ??
													row.settlement?.status}
											</Badge>
											{row.flags.map((flag) => (
												<Badge key={flag} variant="destructive">
													{FLAG_LABELS[flag] ?? flag}
												</Badge>
											))}
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
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
				statement_at: new Date(form.statementAt).toISOString(),
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

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next && !pending) onClose();
			}}
		>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<form
					noValidate
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						void submit();
					}}
				>
					<DialogHeader>
						<DialogTitle>Catat setoran COD Mengantar</DialogTitle>
						<DialogDescription>
							Salin dari laporan saldo COD di dashboard Mengantar. Selisih
							nominal atau total ditandai untuk ditinjau, tidak diterima diam-diam.
						</DialogDescription>
					</DialogHeader>
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
									className="size-4"
									checked={p.shipment_id in amounts}
									onChange={(e) => {
										const next = { ...amounts };
										if (e.target.checked) next[p.shipment_id] = String(p.cod_due);
										else delete next[p.shipment_id];
										setAmounts(next);
									}}
								/>
								<label htmlFor={`cod-${p.shipment_id}`} className="min-w-40 text-sm">
									{p.order_number}
									<span className="block font-mono text-xs text-muted-foreground">
										{p.tracking_number ?? "—"} · tagihan {rupiah(p.cod_due)}
									</span>
								</label>
								{p.shipment_id in amounts && (
									<Input
										aria-label={`Nominal tertagih ${p.order_number}`}
										inputMode="numeric"
										className="w-36"
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
								Tanggal laporan
							</label>
							<Input id="cod-field-2" type="date" value={form.statementAt} onChange={set("statementAt")} />
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
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="outline" disabled={pending} onClick={onClose}>
							Batal
						</Button>
						<Button type="submit" disabled={pending}>
							{pending ? "Menyimpan…" : "Simpan setoran"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
