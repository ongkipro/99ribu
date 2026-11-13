"use client";

import { CircleCheck, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { wibDateTime, wibInputToIso } from "@/modules/storefront/format";
import { failureText, getJson } from "./admin-errors";
import { DataTable, type DataTableStatus } from "./data-table";
import { bpsToPercent, formatWib, percentToBps } from "./format";
import { FormDialog, FormField } from "./form";
import { DetailSection } from "./page-blocks";
import { useSettingsIntent } from "./settings-intent";
import { StatusBadge } from "./status";

// S130 / spec 17 B21 (DEC-018 Q3): payment terms (COD fee bps and manual bank accounts) moved out of
// /admin/keuangan/pembayaran into Pengaturan. Owner writes new versions with payment_policy.version reauth proof;
// finance reads current terms and version history. Existing quotes and orders keep their frozen
// payment_policy_version_id and cod_fee_bps.

export type BankAccount = {
	bank_name: string;
	account_number: string;
	account_holder: string;
};

type Channel = "manual-bank" | "autolaris" | "cod";
// Buyer-facing channels the owner switches (policy field enabled_channels; absent in older versions = all on).
const CHANNELS: readonly (readonly [Channel, string])[] = [
	["manual-bank", "Transfer bank"],
	["autolaris", "Virtual Account / QRIS (AutoLaris)"],
	["cod", "Bayar di tempat (COD)"],
];
const ALL_CHANNELS = CHANNELS.map(([c]) => c);
const channelsOf = (values: PaymentPolicyValues) =>
	values.enabled_channels ?? ALL_CHANNELS;
const channelText = (values: PaymentPolicyValues) =>
	CHANNELS.filter(([c]) => channelsOf(values).includes(c))
		.map(([, label]) => label)
		.join(", ");

// DEC-029: who bears the AutoLaris VA/QRIS admin fee and the COD service fee (absent in older versions = store and
// buyer), and the store's own per-channel AutoLaris fee table that prices a buyer-borne fee.
type Bearer = "buyer" | "store";
type FeeRule = { kind: "fixed"; amount: number } | { kind: "bps"; bps: number };
const FEE_CHANNELS: readonly (readonly [string, string])[] = [
	["VABCA", "VA BCA"],
	["VAMANDIRI", "VA Mandiri"],
	["VABNI", "VA BNI"],
	["VABRI", "VA BRI"],
	["VAPERMATA", "VA Permata"],
	["QRIS", "QRIS"],
];
// Owner 2026-11-04: the AutoLaris rates are QRIS 0,7%, VA BCA Rp6.500 and every other VA Rp3.000 (starting values).
const DEFAULT_FEES: Record<string, FeeRule> = {
	VABCA: { kind: "fixed", amount: 6500 },
	VAMANDIRI: { kind: "fixed", amount: 3000 },
	VABNI: { kind: "fixed", amount: 3000 },
	VABRI: { kind: "fixed", amount: 3000 },
	VAPERMATA: { kind: "fixed", amount: 3000 },
	QRIS: { kind: "bps", bps: 70 },
};
const feeText = (rule: FeeRule | undefined) =>
	!rule
		? "–"
		: rule.kind === "fixed"
			? `Rp${rule.amount.toLocaleString("id-ID")}`
			: `${bpsToPercent(rule.bps)}%`;
const bearerText = (bearer: Bearer | undefined, fallback: Bearer) =>
	(bearer ?? fallback) === "buyer" ? "Pembeli" : "Penjual";

export type PaymentPolicyValues = {
	cod_fee_bps: number;
	manual_bank_accounts: BankAccount[];
	enabled_channels?: Channel[];
	payment_fee_bearer?: Bearer;
	cod_fee_bearer?: Bearer;
	autolaris_fees?: Record<string, FeeRule>;
	autolaris_turnover_bps?: number;
};

export type PaymentPolicyVersion = {
	id: string;
	kind: "payment";
	warehouse_id: null;
	version: number;
	effective_at: string;
	values: PaymentPolicyValues;
	actor_id: string;
	reason: string;
	created_at: string;
};

type PaymentPolicyHistory = {
	data: PaymentPolicyVersion[];
	pagination: { next_cursor: string | null };
	latest_version: number;
	current: PaymentPolicyVersion | null;
};

const PAGE = 20;

function formatAccountsLines(accounts: BankAccount[]) {
	return accounts
		.map((a) => `${a.bank_name} | ${a.account_number} | ${a.account_holder}`)
		.join("\n");
}

function parseAccountsLines(raw: string): BankAccount[] | string {
	const lines = raw
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length > 5) {
		return "Maksimal 5 rekening transfer manual.";
	}
	const out: BankAccount[] = [];
	for (const line of lines) {
		const parts = line.split("|").map((part) => part.trim());
		if (parts.length !== 3) {
			return "Format setiap baris rekening harus: Nama Bank | Nomor Rekening | Nama Pemilik.";
		}
		const [bank_name, account_number, account_holder] = parts;
		if (bank_name.length < 2 || bank_name.length > 60) {
			return "Nama bank harus 2–60 karakter.";
		}
		if (!/^[0-9]{6,20}$/.test(account_number)) {
			return "Nomor rekening harus 6–20 digit angka tanpa spasi atau tanda hubung.";
		}
		if (account_holder.length < 2 || account_holder.length > 100) {
			return "Nama pemilik rekening harus 2–100 karakter.";
		}
		out.push({ bank_name, account_number, account_holder });
	}
	return out;
}

export function SettingsPaymentClient({ canWrite }: { canWrite: boolean }) {
	const [history, setHistory] = useState<PaymentPolicyHistory | null>(null);
	const [status, setStatus] = useState<DataTableStatus>({ kind: "loading" });
	const [more, setMore] = useState<{ loading: boolean; error: string | null }>({
		loading: false,
		error: null,
	});
	const [dialogOpen, setDialogOpen] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	const requestRef = useRef(0);

	const load = useCallback(async () => {
		const runId = ++requestRef.current;
		setStatus({ kind: "loading" });
		const res = await getJson<PaymentPolicyHistory>(
			`/api/v1/admin/policy-versions?kind=payment&limit=${PAGE}`,
		);
		if (runId !== requestRef.current) return;
		if (res.ok) {
			setHistory(res.data);
			setStatus({ kind: "ready" });
		} else {
			// Keep the mounted dialog and its frozen retry intent if this reload fails.
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

	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	async function loadMore() {
		const cursor = history?.pagination.next_cursor;
		if (!cursor || more.loading) return;
		setMore({ loading: true, error: null });
		const res = await getJson<PaymentPolicyHistory>(
			`/api/v1/admin/policy-versions?kind=payment&limit=${PAGE}&cursor=${encodeURIComponent(cursor)}`,
		);
		if (!res.ok) {
			setMore({
				loading: false,
				error: `Riwayat berikutnya gagal dimuat. ${failureText(res.failure)}`,
			});
			return;
		}
		setMore({ loading: false, error: null });
		setHistory((prev) =>
			prev
				? {
						...prev,
						data: [
							...prev.data,
							...res.data.data.filter(
								(row) => !prev.data.some((seen) => seen.id === row.id),
							),
						],
						pagination: res.data.pagination,
					}
				: prev,
		);
	}

	const current = history?.current ?? null;
	const now = Date.now();

	return (
		<div className="flex flex-col gap-6" data-testid="settings-payment-root">
			{notice && (
				<Alert
					ref={noticeRef}
					tabIndex={-1}
					role="status"
					className="outline-none"
					data-testid="payment-policy-notice"
				>
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">
						{notice}
					</AlertDescription>
				</Alert>
			)}

			{!canWrite && (
				<p
					data-testid="payment-policy-readonly"
					className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
				>
					Hanya baca: staf keuangan dapat melihat ketentuan pembayaran yang
					berlaku dan riwayat versinya. Perubahan ketentuan hanya dilakukan oleh
					Super Admin dengan autentikasi ulang.
				</p>
			)}

			<DetailSection
				id="payment-current-heading"
				title="Ketentuan yang berlaku sekarang"
				description="Siapa yang menanggung biaya COD dan biaya admin VA/QRIS dibekukan pada setiap penawaran dan instruksi pembayaran; perubahan hanya berlaku untuk yang baru dan tidak mengubah pesanan yang sudah dibuat."
				testId="payment-policy-current"
			>
				{status.kind === "loading" && !history ? (
					<Skeleton className="h-24 w-full" />
				) : history ? (
					<div className="flex flex-col gap-4">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="flex flex-wrap items-center gap-2">
								{current ? (
									<>
										<StatusBadge tone="success">Berlaku</StatusBadge>
										<span className="text-sm font-medium tabular-nums">
											Versi {current.version}
										</span>
										<span className="text-xs text-muted-foreground">
											Sejak {formatWib(current.effective_at)}
										</span>
									</>
								) : (
									<StatusBadge tone="problem">Belum diatur</StatusBadge>
								)}
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
										data-testid="payment-policy-new"
										onClick={() => setDialogOpen(true)}
									>
										<Plus aria-hidden="true" />
										Versi ketentuan baru
									</Button>
								)}
							</div>
						</div>

						{current ? (
							<dl
								className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm"
								data-testid="payment-policy-values"
							>
								<dt className="text-muted-foreground">Metode di checkout</dt>
								<dd data-testid="payment-channels">
									{channelText(current.values)}
								</dd>
								<dt className="text-muted-foreground">Biaya layanan COD</dt>
								<dd className="tabular-nums" data-testid="payment-cod-bearer">
									<span className="font-medium">
										{bpsToPercent(current.values.cod_fee_bps)}%
									</span>{" "}
									({current.values.cod_fee_bps} bps), ditanggung{" "}
									{bearerText(
										current.values.cod_fee_bearer,
										"buyer",
									).toLowerCase()}
								</dd>
								<dt className="text-muted-foreground">Biaya admin VA/QRIS</dt>
								<dd data-testid="payment-fee-bearer">
									Ditanggung{" "}
									{bearerText(
										current.values.payment_fee_bearer,
										"store",
									).toLowerCase()}
									{current.values.autolaris_fees && (
										<span className="block text-xs text-muted-foreground tabular-nums">
											{FEE_CHANNELS.map(
												([code, label]) =>
													`${label} ${feeText(current.values.autolaris_fees?.[code])}`,
											).join(" · ")}
											{` · potongan omset ${bpsToPercent(current.values.autolaris_turnover_bps ?? 0)}%`}
										</span>
									)}
								</dd>
								<dt className="text-muted-foreground">
									Rekening transfer manual
								</dt>
								<dd>
									{current.values.manual_bank_accounts.length === 0 ? (
										<span className="text-muted-foreground">
											Tidak ada rekening (kanal transfer manual nonaktif)
										</span>
									) : (
										<ul className="flex flex-col gap-1">
											{current.values.manual_bank_accounts.map((acc) => (
												<li
													key={`${acc.bank_name}-${acc.account_number}`}
													className="tabular-nums"
												>
													<span className="font-medium">{acc.bank_name}</span> ·{" "}
													<code className="font-mono text-xs">
														{acc.account_number}
													</code>{" "}
													a.n. {acc.account_holder}
												</li>
											))}
										</ul>
									)}
								</dd>
								<dt className="text-muted-foreground">Alasan versi ini</dt>
								<dd className="break-words">{current.reason}</dd>
							</dl>
						) : (
							<p className="text-sm text-muted-foreground">
								Belum ada ketentuan pembayaran yang aktif: tanpa biaya COD (0%)
								dan kanal transfer bank manual belum ditawarkan saat checkout.
							</p>
						)}
					</div>
				) : null}
			</DetailSection>

			<section
				aria-labelledby="payment-history-heading"
				className="flex flex-col gap-3"
				data-testid="payment-policy-history"
			>
				<div className="flex flex-col gap-1">
					<h2 id="payment-history-heading" className="text-base font-semibold">
						Riwayat versi ketentuan pembayaran
					</h2>
					<p className="text-sm text-muted-foreground">
						Setiap versi tidak dapat diubah dan dirujuk oleh pesanan yang dibuat
						saat versi tersebut berlaku.
					</p>
				</div>
				<DataTable
					rows={history?.data ?? []}
					rowKey={(row) => row.id}
					status={status}
					loadingLabel="Memuat riwayat ketentuan pembayaran…"
					empty="Belum ada versi ketentuan pembayaran yang tercatat."
					caption="Riwayat versi ketentuan pembayaran"
					testId="payment-policy-table"
					rowTestId={(row) => `payment-policy-row-${row.version}`}
					stack
					paging={{
						hasMore: Boolean(history?.pagination.next_cursor),
						loading: more.loading,
						onMore: () => void loadMore(),
						error: more.error,
						testId: "payment-policy-more",
					}}
					columns={[
						{
							id: "version",
							header: "Versi",
							stack: "title",
							className: "tabular-nums",
							cell: (row) => (
								<span className="flex flex-wrap items-center gap-2">
									<span>v{row.version}</span>
									{row.id === current?.id ? (
										<StatusBadge tone="success">Berlaku</StatusBadge>
									) : Date.parse(row.effective_at) > now ? (
										<StatusBadge tone="open">Terjadwal</StatusBadge>
									) : null}
								</span>
							),
						},
						{
							id: "effective",
							header: "Berlaku sejak (WIB)",
							stack: "meta",
							className: "tabular-nums",
							cell: (row) => formatWib(row.effective_at),
						},
						{
							id: "channels",
							header: "Metode",
							cellClassName: "max-w-56 whitespace-normal",
							cell: (row) => channelText(row.values),
						},
						{
							id: "cod_fee",
							header: "Biaya COD",
							stack: "aside",
							className: "text-right tabular-nums",
							cell: (row) => `${bpsToPercent(row.values.cod_fee_bps)}%`,
						},
						{
							id: "accounts",
							header: "Rekening transfer",
							cellClassName: "max-w-72 whitespace-normal",
							cell: (row) =>
								row.values.manual_bank_accounts.length === 0
									? "Tidak ada"
									: row.values.manual_bank_accounts
											.map(
												(a) =>
													`${a.bank_name} ${a.account_number} (${a.account_holder})`,
											)
											.join(", "),
						},
						{
							id: "reason",
							header: "Alasan",
							cellClassName: "max-w-64 whitespace-normal",
							cell: (row) => row.reason,
						},
					]}
				/>
			</section>

			{dialogOpen && history && (
				<PaymentPolicyDialog
					expectedVersion={history.latest_version}
					current={current?.values ?? null}
					onClose={() => setDialogOpen(false)}
					onStale={() => void load()}
					onDone={(saved) => {
						setDialogOpen(false);
						setNotice(
							`Ketentuan pembayaran versi ${saved.version} tersimpan (berlaku ${wibDateTime(saved.effective_at)}). Pesanan lama tetap memakai ketentuan saat pesanan dibuat.`,
						);
						void load();
					}}
				/>
			)}
		</div>
	);
}

function PaymentPolicyDialog({
	expectedVersion,
	current,
	onClose,
	onStale,
	onDone,
}: {
	expectedVersion: number;
	current: PaymentPolicyValues | null;
	onClose: () => void;
	onStale: () => void;
	onDone: (saved: PaymentPolicyVersion) => void;
}) {
	const id = useId();
	// Frozen on mount: a background reload after 409 VERSION_CONFLICT must not silently advance the version an open dialog submits.
	const [capturedVersion] = useState(expectedVersion);
	const [percent, setPercent] = useState(
		current ? bpsToPercent(current.cod_fee_bps) : "3,33",
	);
	const [accounts, setAccounts] = useState(
		current ? formatAccountsLines(current.manual_bank_accounts) : "",
	);
	const [channels, setChannels] = useState<Channel[]>(
		current ? channelsOf(current) : ALL_CHANNELS,
	);
	const [paymentBearer, setPaymentBearer] = useState<Bearer>(
		current?.payment_fee_bearer ?? "store",
	);
	const [codBearer, setCodBearer] = useState<Bearer>(
		current?.cod_fee_bearer ?? "buyer",
	);
	// DEC-032: AutoLaris's cut of the paid amount on every channel; a new table starts at the owner's 1%.
	const [turnover, setTurnover] = useState(() =>
		bpsToPercent(current?.autolaris_turnover_bps ?? (current?.autolaris_fees ? 0 : 100)),
	);
	const [fees, setFees] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			FEE_CHANNELS.map(([code]) => {
				const rule = current?.autolaris_fees?.[code] ?? DEFAULT_FEES[code];
				return [
					code,
					rule.kind === "fixed" ? String(rule.amount) : bpsToPercent(rule.bps),
				];
			}),
		),
	);
	const [when, setWhen] = useState<"now" | "later">("now");
	const [at, setAt] = useState("");
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const intent = useSettingsIntent();

	async function submit() {
		const bps = percentToBps(percent);
		if (bps === null || bps > 2000) {
			intent.setError(
				"Biaya COD diisi persen 0–20 dengan paling banyak dua angka desimal, contoh 3,33.",
			);
			return;
		}
		const parsedAccounts = parseAccountsLines(accounts);
		if (typeof parsedAccounts === "string") {
			intent.setError(parsedAccounts);
			return;
		}
		if (channels.length === 0) {
			intent.setError("Nyalakan minimal satu metode pembayaran.");
			return;
		}
		// DEC-029: VA fees in whole rupiah (0–100.000), the QRIS fee as a percent (0–20).
		// The table is saved whoever bears the fee, so a later switch to the buyer keeps the owner's rates.
		const feeTable: Record<string, FeeRule> = {};
		for (const [code, label] of FEE_CHANNELS) {
			const raw = (fees[code] ?? "").trim();
			if (code === "QRIS") {
				const qrisBps = percentToBps(raw);
				if (qrisBps === null || qrisBps > 2000) {
					intent.setError(`Biaya ${label} diisi persen 0–20, contoh 0,7.`);
					return;
				}
				feeTable[code] = { kind: "bps", bps: qrisBps };
			} else {
				if (
					!/^[0-9]{1,6}$/.test(raw.replaceAll(".", "")) ||
					Number(raw.replaceAll(".", "")) > 100000
				) {
					intent.setError(
						`Biaya ${label} diisi rupiah 0–100.000, contoh 3000.`,
					);
					return;
				}
				feeTable[code] = {
					kind: "fixed",
					amount: Number(raw.replaceAll(".", "")),
				};
			}
		}

		const turnoverBps = percentToBps(turnover.trim());
		if (turnoverBps === null || turnoverBps > 2000) {
			intent.setError("Potongan omset AutoLaris diisi persen 0–20, contoh 1.");
			return;
		}

		let effectiveAt: string | null = null;
		if (when === "later") {
			effectiveAt = at ? wibInputToIso(at) : null;
			if (!effectiveAt) {
				intent.setError("Isi waktu berlaku (WIB) yang valid.");
				return;
			}
		}
		if (!reason.trim() || !password) {
			intent.setError("Alasan perubahan dan kata sandi wajib diisi.");
			return;
		}

		const saved = await intent.run<PaymentPolicyVersion>(
			"/api/v1/admin/policy-versions",
			() => ({
				kind: "payment",
				warehouse_id: null,
				expected_version: capturedVersion,
				effective_at: effectiveAt,
				values: {
					cod_fee_bps: bps,
					manual_bank_accounts: parsedAccounts,
					enabled_channels: ALL_CHANNELS.filter((c) => channels.includes(c)),
					payment_fee_bearer: paymentBearer,
					cod_fee_bearer: codBearer,
					autolaris_fees: feeTable,
					autolaris_turnover_bps: turnoverBps,
				},
				reason: reason.trim(),
			}),
			{
				proof: {
					password,
					action: "payment_policy.version",
					subject: "company-payment",
				},
				onStale,
				onUncertain: onStale,
			},
		);
		if (saved) {
			onDone(saved);
		}
	}

	return (
		<FormDialog
			title="Versi ketentuan pembayaran baru"
			description={`Menambah versi ${capturedVersion + 1} (didasarkan pada versi v${capturedVersion}). Perubahan hanya berlaku untuk penawaran baru; pesanan yang sudah ada tidak berubah.`}
			pending={intent.pending}
			error={intent.error}
			submitLabel="Simpan ketentuan"
			pendingLabel="Menyimpan…"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<fieldset
				className="flex flex-col gap-1"
				data-testid="payment-channel-switches"
			>
				<legend className="mb-1 text-sm font-medium">
					Metode pembayaran di checkout
				</legend>
				{CHANNELS.map(([channel, label]) => (
					<label
						key={channel}
						className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11"
					>
						<input
							type="checkbox"
							className="size-4 accent-primary"
							checked={channels.includes(channel)}
							onChange={(e) =>
								setChannels((all) =>
									e.target.checked
										? [...all, channel]
										: all.filter((c) => c !== channel),
								)
							}
						/>
						{label}
					</label>
				))}
				<p className="text-xs text-muted-foreground">
					Hanya metode yang menyala yang tampil untuk pembeli. Transfer bank
					tampil bila ada minimal satu rekening. Virtual Account / QRIS baru
					tampil di situs produksi setelah koneksi AutoLaris asli disetujui.
				</p>
			</fieldset>

			<fieldset
				className="flex flex-col gap-1"
				data-testid="payment-fee-bearer-switch"
			>
				<legend className="mb-1 text-sm font-medium">
					Biaya admin Virtual Account / QRIS dibayar oleh
				</legend>
				{(
					[
						[
							"buyer",
							"Pembeli",
							"Biaya admin (tarif per transaksi + potongan omset AutoLaris) ditambahkan ke tagihan; penjual menerima total pesanan utuh.",
						],
						[
							"store",
							"Penjual",
							"Pembeli membayar total pesanan saja; biaya admin dipotong dari dana yang diterima penjual.",
						],
					] as const
				).map(([value, label, detail]) => (
					<label
						key={value}
						className="flex min-h-9 items-start gap-2 text-sm pointer-coarse:min-h-11"
					>
						<input
							type="radio"
							name="payment-fee-bearer"
							className="mt-0.5 size-4 accent-primary"
							checked={paymentBearer === value}
							onChange={() => setPaymentBearer(value)}
						/>
						<span>
							<span className="font-medium">{label}</span>
							<span className="block text-xs text-muted-foreground">
								{detail}
							</span>
						</span>
					</label>
				))}
				<div
					className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3"
					data-testid="payment-fee-table"
				>
					{FEE_CHANNELS.map(([code, label]) => (
						<FormField
							key={code}
							id={`terms-fee-${code}`}
							label={code === "QRIS" ? `${label} (%)` : `${label} (Rp)`}
						>
							<Input
								id={`terms-fee-${code}`}
								inputMode={code === "QRIS" ? "decimal" : "numeric"}
								value={fees[code] ?? ""}
								onChange={(e) => {
									const value = e.target.value;
									setFees((all) => ({ ...all, [code]: value }));
								}}
							/>
						</FormField>
					))}
					<p className="col-span-full text-xs text-muted-foreground">
						Tarif akun AutoLaris per transaksi. Bila ditanggung pembeli, tagihan dihitung
						agar platform tetap menerima total pesanan setelah tarif ini dan potongan omset;
						pesanan yang sudah ada tidak berubah.
					</p>
				</div>
				<FormField
					id="terms-fee-turnover"
					label="Potongan omset AutoLaris (%)"
					hint="Dipotong AutoLaris dari total yang dibayar pembeli, di semua metode. Contoh 1."
				>
					<Input
						id="terms-fee-turnover"
						className="max-w-32"
						inputMode="decimal"
						value={turnover}
						onChange={(e) => setTurnover(e.target.value)}
					/>
				</FormField>
			</fieldset>

			<fieldset
				className="flex flex-col gap-1"
				data-testid="cod-fee-bearer-switch"
			>
				<legend className="mb-1 text-sm font-medium">
					Biaya layanan COD ditanggung
				</legend>
				{(
					[
						[
							"buyer",
							"Pembeli",
							"Biaya COD ditambahkan ke tagihan yang dibayar ke kurir.",
						],
						[
							"store",
							"Penjual",
							"Pembeli tidak membayar biaya COD; potongan kurir dibayar penjual dan tercatat saat setoran COD.",
						],
					] as const
				).map(([value, label, detail]) => (
					<label
						key={value}
						className="flex min-h-9 items-start gap-2 text-sm pointer-coarse:min-h-11"
					>
						<input
							type="radio"
							name="cod-fee-bearer"
							className="mt-0.5 size-4 accent-primary"
							checked={codBearer === value}
							onChange={() => setCodBearer(value)}
						/>
						<span>
							<span className="font-medium">{label}</span>
							<span className="block text-xs text-muted-foreground">
								{detail}
							</span>
						</span>
					</label>
				))}
			</fieldset>

			<FormField
				id="terms-cod-fee"
				label="Tarif biaya COD (%)"
				hint="Persen dari tagihan COD (0–20%), contoh 3,33. Dibayar pembeli hanya bila biaya COD ditanggung pembeli."
			>
				<div className="flex items-center gap-2">
					<Input
						id="terms-cod-fee"
						data-testid="payment-cod-fee"
						inputMode="decimal"
						className="max-w-32"
						value={percent}
						aria-describedby="terms-cod-fee-hint"
						onChange={(e) => setPercent(e.target.value)}
					/>
					<span aria-hidden="true" className="text-sm text-muted-foreground">
						%
					</span>
				</div>
			</FormField>

			<FormField
				id="terms-accounts"
				label="Rekening transfer (satu per baris: Bank | Nomor | Nama pemilik)"
				hint="Maksimal 5 rekening. Kosongkan bila transfer bank manual dinonaktifkan."
			>
				<Textarea
					id="terms-accounts"
					data-testid="payment-accounts"
					rows={3}
					aria-describedby="terms-accounts-hint"
					value={accounts}
					onChange={(e) => setAccounts(e.target.value)}
				/>
			</FormField>

			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 text-sm font-medium">Waktu berlaku</legend>
				<label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
					<input
						type="radio"
						name={`${id}-when`}
						className="size-4 accent-primary"
						checked={when === "now"}
						onChange={() => setWhen("now")}
					/>
					Berlaku sekarang
				</label>
				<label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
					<input
						type="radio"
						name={`${id}-when`}
						data-testid="payment-later"
						className="size-4 accent-primary"
						checked={when === "later"}
						onChange={() => setWhen("later")}
					/>
					Jadwalkan (WIB)
				</label>
				{when === "later" && (
					<FormField
						id={`${id}-at`}
						label="Waktu mulai berlaku (WIB)"
						hint="Paling jauh 366 hari ke depan; waktu yang sudah lewat ditolak."
					>
						<Input
							id={`${id}-at`}
							data-testid="payment-effective-at"
							type="datetime-local"
							lang="id"
							aria-describedby={`${id}-at-hint`}
							value={at}
							onChange={(e) => setAt(e.target.value)}
						/>
					</FormField>
				)}
			</fieldset>

			<FormField id="terms-reason" label="Alasan perubahan">
				<Input
					id="terms-reason"
					data-testid="payment-reason"
					maxLength={500}
					autoComplete="off"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>

			<FormField
				id="terms-password"
				label="Konfirmasi kata sandi"
				hint="Dipakai satu kali untuk menerbitkan bukti autentikasi Super Admin."
			>
				<Input
					id="terms-password"
					data-testid="payment-password"
					type="password"
					autoComplete="current-password"
					maxLength={128}
					aria-describedby="terms-password-hint"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}
