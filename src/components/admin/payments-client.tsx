"use client";

import { CircleCheck, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { rupiah, wibDateTime, wibInputToIso } from "@/modules/storefront/format";
import { describeFailure, failureText, getJson, readFailure } from "./admin-errors";
import { bpsToPercent, percentToBps } from "./format";
import { DataTable } from "./data-table";
import { FormDialog, FormField, nativeSelectClass, SegmentedControl } from "./form";
import { isOverdue, OrderNumberLink, OverdueBadge, StatusBadge, useNow } from "./status";
import { useKeysetList } from "./use-keyset-list";

// DEC-008 manual bank transfers (finance queue) and DEC-008/009 payment terms (owner).
type Transfer = {
	id: string;
	order_id: string;
	order_number: string;
	transfer_code: number;
	expected_amount: number;
	expires_at: string;
	accounts: Account[];
	confirmation: {
		amount: number;
		bank_reference: string;
		outcome: string;
		mismatch: boolean;
	} | null;
};
type Account = { bank_name: string; account_number: string; account_holder: string };
type Terms = { cod_fee_bps: number; manual_bank_accounts: Account[] } | null;
const CODE_MESSAGES: Record<string, string> = {
	TRANSFER_ALREADY_CONFIRMED: "Transfer ini sudah dikonfirmasi.",
	TRANSFER_NOT_AWAITING: "Pesanan ini tidak lagi menunggu transfer.",
	INVALID_TRANSFER_TIME: "Waktu transfer harus setelah pesanan dibuat dan tidak di masa depan.",
	INVALID_BANK_REFERENCE: "Referensi bank hanya huruf, angka dan . _ / : -",
	REAUTHENTICATION_REQUIRED: "Konfirmasi kata sandi gagal atau kedaluwarsa.",
	BANK_REFERENCE_ALREADY_USED: "Referensi mutasi ini sudah dipakai untuk pesanan lain di rekening yang sama.",
	LATE_TRANSFER_ACKNOWLEDGEMENT_REQUIRED: "Tandai transfer terlambat sesuai waktu transfer terhadap batas waktu.",
	INVALID_RECEIVING_ACCOUNT: "Pilih rekening penerima dari daftar pesanan ini.",
	FRESH_MFA_REQUIRED: "Verifikasi dua langkah ulang diperlukan.",
	PAYMENT_ALREADY_FINAL: "Pembayaran ini sudah final.",
	AUTOLARIS_TRANSACTION_UNAVAILABLE: "Transaksi AutoLaris belum tercatat atau ditolak.",
	INVALID_PAYMENT_TIME: "Waktu bayar harus setelah instruksi dibuat dan tidak di masa depan.",
};
const text = (status: number, code: string | null) =>
	code && CODE_MESSAGES[code]
		? `${CODE_MESSAGES[code]} (kode: ${code})`
		: failureText(describeFailure(status, code));
async function post(url: string, body: unknown) {
	try {
		const res = await fetch(url, {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
			body: JSON.stringify(body),
		});
		if (res.ok) return { ok: true as const, data: await res.json() };
		const failure = await readFailure(res);
		return { ok: false as const, text: text(res.status, failure.code) };
	} catch {
		return { ok: false as const, text: text(0, null) };
	}
}
async function proof(password: string, action: string, subject: string) {
	return post("/api/v1/me/reauthentication-proofs", { password, action, subject_id: subject });
}

const READ_ONLY_ID = "payments-read-only-reason";
/** AutoLaris channel codes as staff read them: VABCA → VA BCA. */
const channelLabel = (code: string) => (code.startsWith("VA") ? `VA ${code.slice(2)}` : code);

export function PaymentsClient({
	canManageTerms,
	canWrite,
	canOrders,
}: {
	canManageTerms: boolean;
	canWrite: boolean;
	/** orders.history.read: order numbers link to the order detail. */
	canOrders: boolean;
}) {
	const now = useNow();
	const [state, setState] = useState<"open" | "resolved">("open");
	const list = useKeysetList<Transfer>(`/api/v1/admin/manual-transfers?state=${state}`, (row) => row.id);
	const [notice, setNotice] = useState<string | null>(null);
	const [selected, setSelected] = useState<Transfer | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
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
			{!canWrite && (
				<p id={READ_ONLY_ID} data-testid="payments-read-only" className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
					Hanya lihat: konfirmasi pembayaran memerlukan izin tulis rekonsiliasi keuangan. Minta Super Admin menambahkan izin ini.
				</p>
			)}
			<section aria-labelledby="transfers-heading" className="flex flex-col gap-4">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<h2 id="transfers-heading" className="text-lg font-semibold">
						Transfer bank manual
					</h2>
					<Button variant="outline" onClick={() => void list.reload()}>
						<RefreshCw aria-hidden="true" />
						Muat ulang
					</Button>
				</div>
				<SegmentedControl
					legend="Status transfer"
					value={state}
					onChange={setState}
					options={[
						["open", "Menunggu konfirmasi"],
						["resolved", "Sudah dicatat"],
					]}
				/>
				<DataTable
					rows={list.rows}
					rowKey={(row) => row.id}
					status={list.status}
					paging={{ ...list.paging, testId: "manual-transfers-more" }}
					loadingLabel="Memuat transfer…"
					empty={state === "open" ? "Tidak ada transfer yang menunggu konfirmasi." : "Belum ada transfer yang dicatat."}
					testId="manual-transfers"
					caption={state === "open" ? "Transfer yang menunggu konfirmasi" : "Transfer yang sudah dicatat"}
					stack
					columns={[
						{
							id: "order",
							header: "Pesanan",
							stack: "title",
							cell: (row) => <OrderNumberLink number={row.order_number} orderId={row.order_id} enabled={canOrders} />,
						},
						// md–xl: the unique code moves under the amount so the pinned action never covers the deadline.
						{
							id: "amount",
							header: "Nominal tepat",
							stack: "aside",
							className: "text-right tabular-nums",
							cell: (row) => (
								<>
									{rupiah(row.expected_amount)}
									<span className="hidden text-xs text-muted-foreground md:max-xl:block">Kode unik {row.transfer_code}</span>
								</>
							),
						},
						{ id: "code", header: "Kode unik", className: "md:max-xl:hidden", cell: (row) => row.transfer_code },
						{
							id: "deadline",
							header: state === "open" ? "Batas transfer" : "Hasil",
							stack: state === "open" ? "label" : "status",
							cell: (row) =>
								row.confirmation ? (
									<div className="flex flex-wrap justify-end gap-1 md:justify-start">
										<StatusBadge
											tone={row.confirmation.outcome === "confirmed" ? "success" : row.confirmation.outcome === "recovery" ? "problem" : "open"}
										>
											{row.confirmation.outcome === "confirmed" ? "Lunas" : row.confirmation.outcome === "recovery" ? "Perlu tinjauan" : "Diproses"}
										</StatusBadge>
										{row.confirmation.mismatch && <StatusBadge tone="danger">Nominal berbeda</StatusBadge>}
									</div>
								) : (
									<div className="flex flex-wrap items-center justify-end gap-1.5 tabular-nums md:justify-start">
										{wibDateTime(row.expires_at)}
										{isOverdue(row.expires_at, now) && <OverdueBadge />}
									</div>
								),
						},
						{
							id: "actions",
							header: "Tindakan",
							className: "text-right",
							cell: (row) =>
								!row.confirmation && (
									<Button size="sm" disabled={!canWrite} aria-describedby={canWrite ? undefined : READ_ONLY_ID} onClick={() => setSelected(row)}>
										Konfirmasi transfer
									</Button>
								),
						},
					]}
				/>
			</section>
			{selected && (
				<ConfirmDialog
					transfer={selected}
					onClose={() => setSelected(null)}
					onDone={(message) => {
						setSelected(null);
						setNotice(message);
						void list.reload();
					}}
				/>
			)}
			<AutolarisPayments onNotice={setNotice} canWrite={canWrite} canOrders={canOrders} />
			{canManageTerms && <PaymentTerms />}
		</div>
	);
}

function ConfirmDialog({ transfer, onClose, onDone }: { transfer: Transfer; onClose: () => void; onDone: (message: string) => void }) {
	const [form, setForm] = useState({ amount: String(transfer.expected_amount), reference: "", account: transfer.accounts[0]?.account_number ?? "", time: "", late: false, evidence: "", reason: "", password: "" });
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [field]: e.target.value });
	async function submit() {
		if (!form.amount || !form.reference || !form.account || !form.time || !form.evidence || !form.reason || !form.password) return setError("Lengkapi semua isian.");
		// Bank statements show WIB: the entered time is WIB whatever the device timezone.
		const transferredAt = wibInputToIso(form.time);
		if (!transferredAt) return setError("Waktu transfer tidak valid.");
		// The transfer time decides timeliness; a late transfer must be acknowledged explicitly (spec 11).
		if (form.late !== Date.parse(transferredAt) >= Date.parse(transfer.expires_at))
			return setError(form.late ? "Waktu transfer masih sebelum batas; hapus tanda terlambat." : "Waktu transfer setelah batas: centang transfer terlambat dan jelaskan di alasan.");
		setPending(true);
		setError(null);
		const issued = await proof(form.password, "finance.reconcile", transfer.id);
		if (!issued.ok) {
			setPending(false);
			return setError(issued.text);
		}
		const result = await post(`/api/v1/admin/manual-transfers/${transfer.id}/confirmations`, {
			amount: Number(form.amount),
			bank_reference: form.reference.trim(),
			account_number: form.account,
			transferred_at: transferredAt,
			late_transfer: form.late,
			evidence: form.evidence.trim(),
			reason: form.reason.trim(),
			reauthentication_proof: issued.data.proof,
		});
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone(
			result.data.confirmation?.mismatch
				? `Transfer ${transfer.order_number} dicatat dengan nominal berbeda dan masuk tinjauan.`
				: `Transfer ${transfer.order_number} dicatat; status pesanan diperbarui setelah diproses.`,
		);
	}
	// Echo what will be saved: the typed digits as Rupiah, the typed time read as WIB.
	const amount = /^\d+$/.test(form.amount.trim()) ? Number(form.amount.trim()) : null;
	const amountHint =
		amount === null
			? "Isi angka saja, tanpa titik atau koma."
			: `${rupiah(amount)}${amount === transfer.expected_amount ? " · sesuai tagihan" : ` · berbeda dari tagihan ${rupiah(transfer.expected_amount)}`}`;
	const typedTime = form.time ? wibInputToIso(form.time) : null;
	const timeHint = typedTime ? `Tercatat ${wibDateTime(typedTime)}` : "Tanggal dan jam sesuai mutasi bank, dibaca sebagai WIB.";
	return (
		<FormDialog
			title={`Konfirmasi transfer ${transfer.order_number}`}
			description={`Cocokkan dengan mutasi rekening. Nominal tepat ${rupiah(transfer.expected_amount)} (kode unik ${transfer.transfer_code}). Nominal berbeda tetap dicatat dan masuk tinjauan, bukan dianggap lunas.`}
			pending={pending}
			error={error}
			submitLabel="Simpan konfirmasi"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id="transfer-amount" label="Nominal diterima" hint={amountHint}>
				<Input id="transfer-amount" inputMode="numeric" aria-describedby="transfer-amount-hint" value={form.amount} onChange={set("amount")} />
			</FormField>
			<FormField id="transfer-reference" label="Referensi mutasi bank">
				<Input id="transfer-reference" value={form.reference} maxLength={80} onChange={set("reference")} />
			</FormField>
			<FormField id="transfer-account" label="Rekening penerima">
				<select id="transfer-account" className={nativeSelectClass} value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })}>
					{transfer.accounts.map((a) => (
						<option key={a.account_number} value={a.account_number}>
							{a.bank_name} {a.account_number}
						</option>
					))}
				</select>
			</FormField>
			<FormField id="transfer-time" label={`Waktu transfer (WIB; batas ${wibDateTime(transfer.expires_at)})`} hint={timeHint}>
				<Input id="transfer-time" type="datetime-local" aria-describedby="transfer-time-hint" value={form.time} onChange={set("time")} />
			</FormField>
			<label className="flex min-h-9 items-center gap-2 text-sm">
				<input type="checkbox" className="size-4 accent-primary" checked={form.late} onChange={(e) => setForm({ ...form, late: e.target.checked })} />
				Transfer dilakukan setelah batas waktu (masuk tinjauan, bukan lunas)
			</label>
			<FormField id="transfer-evidence" label="Bukti">
				<Textarea id="transfer-evidence" value={form.evidence} maxLength={500} onChange={set("evidence")} />
			</FormField>
			<FormField id="transfer-reason" label="Alasan">
				<Input id="transfer-reason" value={form.reason} maxLength={200} onChange={set("reason")} />
			</FormField>
			<FormField id="transfer-password" label="Konfirmasi kata sandi">
				<Input id="transfer-password" type="password" autoComplete="current-password" value={form.password} onChange={set("password")} />
			</FormField>
		</FormDialog>
	);
}

// DEC-008 (2) AutoLaris (local simulated contract): advice polling pays automatically only on an
// explicit settlement status; finance confirms manually after checking the AutoLaris dashboard.
type Autolaris = {
	id: string;
	order_id: string;
	order_number: string;
	channel_code: string;
	trx_id: string | null;
	expected_amount: number;
	admin_fee: number | null;
	refusal_code: string | null;
	status: string;
	expires_at: string;
	latest_observation: { source: string; classification: string; ket: string | null } | null;
};
const OBSERVED: Record<string, string> = { pending: "Menunggu pembayaran", settled: "Lunas", unknown: "Status belum pasti", failed: "Gagal" };
const OBSERVED_TONE: Record<string, "success" | "problem" | "danger"> = { settled: "success", unknown: "problem", failed: "danger" };
const autolarisStatus = (row: Autolaris) =>
	row.refusal_code ? (
		<StatusBadge tone="danger">Ditolak: total tidak sama</StatusBadge>
	) : (
		<StatusBadge tone={OBSERVED_TONE[row.latest_observation?.classification ?? ""] ?? "open"}>
			{row.latest_observation ? OBSERVED[row.latest_observation.classification] ?? row.latest_observation.classification : row.trx_id ? "Menunggu pembayaran" : "Instruksi dibuat"}
		</StatusBadge>
	);
function AutolarisPayments({
	onNotice,
	canWrite,
	canOrders,
}: {
	onNotice: (message: string) => void;
	canWrite: boolean;
	canOrders: boolean;
}) {
	const [state, setState] = useState<"open" | "resolved">("open");
	const list = useKeysetList<Autolaris>(`/api/v1/admin/autolaris-payments?state=${state}`, (row) => row.id);
	const [selected, setSelected] = useState<Autolaris | null>(null);
	return (
		<section aria-labelledby="autolaris-heading" className="flex flex-col gap-4 border-t pt-6">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h2 id="autolaris-heading" className="text-lg font-semibold">
						Virtual Account / QRIS (AutoLaris, simulasi lokal)
					</h2>
					<p className="max-w-prose text-sm text-muted-foreground">
						Status dicek otomatis dari laporan AutoLaris; hanya status lunas yang tegas dianggap lunas. Biaya admin ditanggung toko dan dicatat sebagai biaya pembayaran saat dana diselesaikan.
					</p>
				</div>
				<Button variant="outline" onClick={() => void list.reload()}>
					<RefreshCw aria-hidden="true" />
					Muat ulang
				</Button>
			</div>
			<SegmentedControl
				legend="Status AutoLaris"
				value={state}
				onChange={setState}
				options={[
					["open", "Belum final"],
					["resolved", "Final"],
				]}
			/>
			<DataTable
				rows={list.rows}
				rowKey={(row) => row.id}
				status={list.status}
				paging={{ ...list.paging, testId: "autolaris-payments-more" }}
				loadingLabel="Memuat pembayaran…"
				empty="Tidak ada pembayaran AutoLaris."
				testId="autolaris-payments"
				caption={state === "open" ? "Pembayaran AutoLaris yang belum final" : "Pembayaran AutoLaris yang sudah final"}
				stack
				columns={[
					{
						id: "order",
						header: "Pesanan",
						stack: "title",
						// md–xl: the status and channel sit under the order number so the pinned action never covers them.
						cell: (row) => (
							<div className="flex flex-col items-start gap-1">
								<OrderNumberLink number={row.order_number} orderId={row.order_id} enabled={canOrders} />
								<span className="hidden flex-wrap items-center gap-1.5 md:max-xl:flex">
									{autolarisStatus(row)}
									<span className="text-xs text-muted-foreground">{channelLabel(row.channel_code)}</span>
								</span>
							</div>
						),
					},
					// Kanal and Status give way md–xl (shown in the stacked card and from xl).
					{ id: "channel", header: "Kanal", className: "md:max-xl:hidden", cell: (row) => channelLabel(row.channel_code) },
					{ id: "amount", header: "Tagihan pembeli", stack: "aside", className: "text-right tabular-nums", cell: (row) => rupiah(row.expected_amount) },
					{ id: "fee", header: "Biaya admin (toko)", className: "text-right tabular-nums", cell: (row) => (row.admin_fee === null ? "—" : rupiah(row.admin_fee)) },
					{ id: "status", header: "Status", stack: "status", className: "md:max-xl:hidden", cell: autolarisStatus },
					{
						id: "actions",
						header: "Tindakan",
						className: "text-right",
						cell: (row) =>
							state === "open" &&
							row.trx_id &&
							!row.refusal_code && (
								<Button size="sm" variant="outline" disabled={!canWrite} aria-describedby={canWrite ? undefined : READ_ONLY_ID} onClick={() => setSelected(row)}>
									Konfirmasi manual
								</Button>
							),
					},
				]}
			/>
			{selected && (
				<AutolarisConfirmDialog
					payment={selected}
					onClose={() => setSelected(null)}
					onDone={(message) => {
						setSelected(null);
						onNotice(message);
						void list.reload();
					}}
				/>
			)}
		</section>
	);
}
function AutolarisConfirmDialog({ payment, onClose, onDone }: { payment: Autolaris; onClose: () => void; onDone: (message: string) => void }) {
	const [form, setForm] = useState({ amount: String(payment.expected_amount), time: "", evidence: "", reason: "", password: "" });
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [field]: e.target.value });
	async function submit() {
		if (!form.amount || !form.time || !form.evidence || !form.reason || !form.password) return setError("Lengkapi semua isian.");
		const paidAt = wibInputToIso(form.time);
		if (!paidAt) return setError("Waktu bayar tidak valid.");
		setPending(true);
		setError(null);
		const issued = await proof(form.password, "finance.reconcile", payment.id);
		if (!issued.ok) {
			setPending(false);
			return setError(issued.text);
		}
		const result = await post(`/api/v1/admin/autolaris-payments/${payment.id}/confirmations`, {
			amount: Number(form.amount),
			paid_at: paidAt,
			evidence: form.evidence.trim(),
			reason: form.reason.trim(),
			reauthentication_proof: issued.data.proof,
		});
		setPending(false);
		if (!result.ok) return setError(result.text);
		onDone(`Pembayaran ${payment.order_number} dicatat; status pesanan diperbarui setelah diproses.`);
	}
	return (
		<FormDialog
			title={`Konfirmasi manual ${payment.order_number}`}
			description={`Gunakan hanya setelah memeriksa dashboard AutoLaris (transaksi ${payment.trx_id}). Nominal berbeda dari ${rupiah(payment.expected_amount)} dicatat dan masuk tinjauan.`}
			pending={pending}
			error={error}
			submitLabel="Simpan konfirmasi"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id="autolaris-amount" label="Nominal dibayar pembeli">
				<Input id="autolaris-amount" inputMode="numeric" value={form.amount} onChange={set("amount")} />
			</FormField>
			<FormField id="autolaris-time" label="Waktu bayar (WIB)">
				<Input id="autolaris-time" type="datetime-local" value={form.time} onChange={set("time")} />
			</FormField>
			<FormField id="autolaris-evidence" label="Bukti dari dashboard">
				<Textarea id="autolaris-evidence" value={form.evidence} maxLength={500} onChange={set("evidence")} />
			</FormField>
			<FormField id="autolaris-reason" label="Alasan">
				<Input id="autolaris-reason" value={form.reason} maxLength={200} onChange={set("reason")} />
			</FormField>
			<FormField id="autolaris-password" label="Konfirmasi kata sandi">
				<Input id="autolaris-password" type="password" autoComplete="current-password" value={form.password} onChange={set("password")} />
			</FormField>
		</FormDialog>
	);
}

function PaymentTerms() {
	const [current, setCurrent] = useState<{ version: number; terms: Terms } | null>(null);
	// The API keeps basis points; staff edit a percent (333 bps = 3,33%), converted at this boundary.
	const [form, setForm] = useState({ percent: "3,33", accounts: "", reason: "", password: "" });
	const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
	const [pending, setPending] = useState(false);
	const load = useCallback(async () => {
		const result = await getJson<{ latest_version: number; current: { values: Terms } | null }>("/api/v1/admin/policy-versions?kind=payment");
		if (!result.ok) return setMessage({ kind: "error", text: failureText(result.failure) });
		const terms = result.data.current?.values ?? null;
		setCurrent({ version: result.data.latest_version, terms });
		if (terms)
			setForm((f) => ({
				...f,
				percent: bpsToPercent(terms.cod_fee_bps),
				accounts: terms.manual_bank_accounts.map((a) => `${a.bank_name} | ${a.account_number} | ${a.account_holder}`).join("\n"),
			}));
	}, []);
	useEffect(() => {
		void load();
	}, [load]);
	async function save() {
		const accounts = form.accounts
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [bank_name, account_number, account_holder] = line.split("|").map((part) => part.trim());
				return { bank_name, account_number, account_holder };
			});
		const bps = percentToBps(form.percent);
		if (bps === null) return setMessage({ kind: "error", text: "Biaya COD diisi persen 0–100 dengan paling banyak dua angka desimal, contoh 3,33." });
		if (!form.reason.trim() || !form.password) return setMessage({ kind: "error", text: "Alasan dan kata sandi wajib diisi." });
		if (pending) return;
		setPending(true);
		setMessage(null);
		// post() never throws: network failures come back as { ok: false } with a visible message.
		const result = await (async () => {
			const issued = await proof(form.password, "payment_policy.version", "company-payment");
			if (!issued.ok) return issued;
			return post("/api/v1/admin/policy-versions", {
				kind: "payment",
				warehouse_id: null,
				expected_version: current?.version ?? 0,
				effective_at: null,
				values: { cod_fee_bps: bps, manual_bank_accounts: accounts },
				reason: form.reason.trim(),
				reauthentication_proof: issued.data.proof,
			});
		})().finally(() => setPending(false));
		if (!result.ok) return setMessage({ kind: "error", text: result.text });
		setForm((f) => ({ ...f, reason: "", password: "" }));
		setMessage({ kind: "ok", text: `Ketentuan pembayaran versi ${result.data.version} berlaku untuk penawaran baru.` });
		void load();
	}
	return (
		<section aria-labelledby="terms-heading" className="flex max-w-2xl flex-col gap-4 border-t pt-6">
			<div className="flex flex-col gap-1">
				<h2 id="terms-heading" className="text-lg font-semibold">
					Ketentuan pembayaran
				</h2>
				<p className="text-sm text-muted-foreground">
					Biaya COD dibayar pembeli dan dibekukan di setiap penawaran; perubahan hanya berlaku untuk penawaran baru. Rekening dipakai untuk transfer bank manual.
					{current?.terms ? ` Berlaku sekarang: ${bpsToPercent(current.terms.cod_fee_bps)}% dan ${current.terms.manual_bank_accounts.length} rekening.` : " Belum diatur: tanpa biaya COD dan transfer manual tidak tersedia."}
				</p>
			</div>
			<form noValidate className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
				<FormField id="terms-cod-fee" label="Biaya COD (%)" hint="Persen dari tagihan COD, contoh 3,33.">
					<div className="flex items-center gap-2">
						<Input
							id="terms-cod-fee"
							inputMode="decimal"
							className="max-w-32"
							value={form.percent}
							aria-describedby="terms-cod-fee-hint"
							onChange={(e) => setForm({ ...form, percent: e.target.value })}
						/>
						<span aria-hidden="true" className="text-sm text-muted-foreground">%</span>
					</div>
				</FormField>
				<FormField id="terms-accounts" label="Rekening transfer (satu per baris: Bank | Nomor | Nama pemilik)">
					<Textarea id="terms-accounts" value={form.accounts} onChange={(e) => setForm({ ...form, accounts: e.target.value })} />
				</FormField>
				<FormField id="terms-reason" label="Alasan perubahan">
					<Input id="terms-reason" value={form.reason} maxLength={200} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
				</FormField>
				<FormField id="terms-password" label="Konfirmasi kata sandi">
					<Input id="terms-password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
				</FormField>
				{message && (
					<p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
						{message.text}
					</p>
				)}
				<Button type="submit" className="self-start" disabled={pending}>
					{pending ? "Menyimpan…" : "Simpan ketentuan"}
				</Button>
			</form>
		</section>
	);
}
