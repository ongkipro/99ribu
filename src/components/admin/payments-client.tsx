"use client";

import { CircleCheck, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { rupiah, wibDateTime, wibInputToIso } from "@/modules/storefront/format";
import { describeFailure, failureText, readFailure } from "./admin-errors";
import { DataTable } from "./data-table";
import { FormDialog, FormField, nativeSelectClass, SegmentedControl } from "./form";
import { Deadline, OrderNumberLink, StatusBadge } from "./status";
import { useKeysetList } from "./use-keyset-list";

// DEC-008 manual bank transfers (finance queue) and DEC-008/009 payment terms (owner).
type Transfer = {
	id: string;
	order_id: string;
	order_admin_no: number;
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
	canWrite,
	canOrders,
}: {
	canWrite: boolean;
	/** orders.history.read: order numbers link to the order detail. */
	canOrders: boolean;
}) {
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
				<div className="flex items-start justify-between gap-3">
					<h2 id="transfers-heading" className="text-base font-semibold">
						Transfer bank manual
					</h2>
					<Button variant="outline" className="shrink-0" onClick={() => void list.reload()}>
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
					empty={
						state === "open"
							? "Tidak ada transfer yang menunggu konfirmasi. Pesanan transfer bank baru muncul di sini sampai batas waktunya."
							: "Belum ada transfer yang dicatat. Transfer yang dikonfirmasi pindah ke tab ini."
					}
					testId="manual-transfers"
					caption={state === "open" ? "Transfer yang menunggu konfirmasi" : "Transfer yang sudah dicatat"}
					stack
					columns={[
						{
							id: "order",
							header: "Pesanan",
							stack: "title",
							cell: (row) => <OrderNumberLink number={row.order_number} adminNo={row.order_admin_no} enabled={canOrders} />,
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
									<Deadline iso={row.expires_at} className="justify-end md:justify-start" />
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
			dirty={!!(form.reference || form.time || form.late || form.evidence || form.reason || form.password) || form.amount !== String(transfer.expected_amount)}
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
			<label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
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
	order_admin_no: number;
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
			{/* Same section header as the transfers: title left, "Muat ulang" top right at every width. */}
			<div className="flex items-start justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h2 id="autolaris-heading" className="text-base font-semibold">
						Virtual Account / QRIS (AutoLaris, simulasi lokal)
					</h2>
					<p className="max-w-prose text-sm text-muted-foreground">
						Status dicek otomatis dari laporan AutoLaris; hanya status lunas yang tegas dianggap lunas. Biaya admin ditanggung toko dan dicatat sebagai biaya pembayaran saat dana diselesaikan.
					</p>
				</div>
				<Button variant="outline" className="shrink-0" onClick={() => void list.reload()}>
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
				empty={
					state === "open"
						? "Tidak ada pembayaran Virtual Account atau QRIS yang belum final."
						: "Belum ada pembayaran Virtual Account atau QRIS yang final."
				}
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
								<OrderNumberLink number={row.order_number} adminNo={row.order_admin_no} enabled={canOrders} />
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
			description={`Gunakan hanya setelah memeriksa dasbor AutoLaris (transaksi ${payment.trx_id}). Nominal berbeda dari ${rupiah(payment.expected_amount)} dicatat dan masuk tinjauan.`}
			pending={pending}
			error={error}
			submitLabel="Simpan konfirmasi"
			dirty={!!(form.time || form.evidence || form.reason || form.password) || form.amount !== String(payment.expected_amount)}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField id="autolaris-amount" label="Nominal dibayar pembeli">
				<Input id="autolaris-amount" inputMode="numeric" value={form.amount} onChange={set("amount")} />
			</FormField>
			<FormField id="autolaris-time" label="Waktu bayar (WIB)">
				<Input id="autolaris-time" type="datetime-local" value={form.time} onChange={set("time")} />
			</FormField>
			<FormField id="autolaris-evidence" label="Bukti dari dasbor AutoLaris">
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
