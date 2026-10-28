"use client";

import { CircleCheck, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { wibDateTime, wibInputToIso } from "@/modules/storefront/format";
import { failureText, getJson } from "./admin-errors";
import { DataTable, type DataTableStatus } from "./data-table";
import { bpsToPercent, formatWib, percentToBps, rupiah } from "./format";
import { FormDialog, FormField } from "./form";
import { DetailSection } from "./page-blocks";
import { useSettingsIntent } from "./settings-intent";
import { StatusBadge } from "./status";

// S130 / spec 17 B22 (DEC-018 Q3): company commercial policy (default affiliate commission bps, minimum
// payout IDR, minimum contribution margin floor IDR). Owner writes new versions with company_policy.version
// reauth proof; finance reads current version and history. Fixed IDR 99,000 offer price stays invariant.

export type CommercialPolicyValues = {
	default_commission_bps: number;
	minimum_payout_idr: number;
	minimum_contribution_idr?: number;
};

export type CommercialPolicyVersion = {
	id: string;
	kind: "commercial";
	warehouse_id: null;
	version: number;
	effective_at: string;
	values: CommercialPolicyValues;
	actor_id: string;
	reason: string;
	created_at: string;
};

type CommercialPolicyHistory = {
	data: CommercialPolicyVersion[];
	pagination: { next_cursor: string | null };
	latest_version: number;
	current: CommercialPolicyVersion | null;
};

const PAGE = 20;

function parseWholeRupiah(raw: string): number | null {
	const clean = raw.replace(/[.\s]/g, "").trim();
	if (!/^\d{1,12}$/.test(clean)) return null;
	const value = Number(clean);
	return Number.isSafeInteger(value) ? value : null;
}

export function SettingsCommercialClient({ canWrite }: { canWrite: boolean }) {
	const [history, setHistory] = useState<CommercialPolicyHistory | null>(null);
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
		const res = await getJson<CommercialPolicyHistory>(
			`/api/v1/admin/policy-versions?kind=commercial&limit=${PAGE}`,
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
		const res = await getJson<CommercialPolicyHistory>(
			`/api/v1/admin/policy-versions?kind=commercial&limit=${PAGE}&cursor=${encodeURIComponent(cursor)}`,
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
		<div className="flex flex-col gap-6" data-testid="settings-commercial-root">
			{notice && (
				<Alert
					ref={noticeRef}
					tabIndex={-1}
					role="status"
					className="outline-none"
					data-testid="commercial-policy-notice"
				>
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">
						{notice}
					</AlertDescription>
				</Alert>
			)}

			{!canWrite && (
				<p
					data-testid="commercial-policy-readonly"
					className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
				>
					Hanya baca: staf keuangan dapat melihat kebijakan komersial saat ini
					dan riwayat versinya. Perubahan kebijakan hanya dilakukan oleh Super
					Admin dengan autentikasi ulang.
				</p>
			)}

			<DetailSection
				id="commercial-current-heading"
				title="Kebijakan komersial yang berlaku sekarang"
				description="Harga penawaran lengkap tetap Rp99.000. Perubahan kebijakan berlaku ke depan; pesanan dan akrual komisi yang sudah tercatat mempertahankan snapshot kebijakan saat transaksi terjadi."
				testId="commercial-policy-current"
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
										data-testid="commercial-policy-new"
										onClick={() => setDialogOpen(true)}
									>
										<Plus aria-hidden="true" />
										Versi kebijakan baru
									</Button>
								)}
							</div>
						</div>

						{current ? (
							<dl
								className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm"
								data-testid="commercial-policy-values"
							>
								<dt className="text-muted-foreground">Harga penawaran tetap</dt>
								<dd className="font-medium tabular-nums">{rupiah(99000)}</dd>
								<dt className="text-muted-foreground">
									Komisi afiliasi bawaan
								</dt>
								<dd className="font-medium tabular-nums">
									{bpsToPercent(current.values.default_commission_bps)}% (
									{current.values.default_commission_bps} bps)
								</dd>
								<dt className="text-muted-foreground">
									Minimum pencairan komisi
								</dt>
								<dd className="font-medium tabular-nums">
									{rupiah(current.values.minimum_payout_idr)}
								</dd>
								<dt className="text-muted-foreground">
									Batas minimum kontribusi margin
								</dt>
								<dd className="font-medium tabular-nums">
									{rupiah(current.values.minimum_contribution_idr ?? 0)}
								</dd>
								<dt className="text-muted-foreground">Alasan versi ini</dt>
								<dd className="break-words">{current.reason}</dd>
							</dl>
						) : (
							<p className="text-sm text-muted-foreground">
								Belum ada kebijakan komersial yang aktif. Publikasi produk
								memerlukan kebijakan komersial yang berlaku.
							</p>
						)}
					</div>
				) : null}
			</DetailSection>

			<section
				aria-labelledby="commercial-history-heading"
				className="flex flex-col gap-3"
				data-testid="commercial-policy-history"
			>
				<div className="flex flex-col gap-1">
					<h2 id="commercial-history-heading" className="text-base font-semibold">
						Riwayat versi kebijakan komersial
					</h2>
					<p className="text-sm text-muted-foreground">
						Setiap versi bersifat tetap (append-only) dan tercatat di log audit.
					</p>
				</div>
				<DataTable
					rows={history?.data ?? []}
					rowKey={(row) => row.id}
					status={status}
					loadingLabel="Memuat riwayat kebijakan komersial…"
					empty="Belum ada versi kebijakan komersial yang tercatat."
					caption="Riwayat versi kebijakan komersial"
					testId="commercial-policy-table"
					rowTestId={(row) => `commercial-policy-row-${row.version}`}
					stack
					paging={{
						hasMore: Boolean(history?.pagination.next_cursor),
						loading: more.loading,
						onMore: () => void loadMore(),
						error: more.error,
						testId: "commercial-policy-more",
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
							id: "commission",
							header: "Komisi bawaan",
							stack: "aside",
							className: "text-right tabular-nums",
							cell: (row) =>
								`${bpsToPercent(row.values.default_commission_bps)}%`,
						},
						{
							id: "payout",
							header: "Min. pencairan",
							className: "text-right tabular-nums",
							cell: (row) => rupiah(row.values.minimum_payout_idr),
						},
						{
							id: "contribution",
							header: "Batas kontribusi",
							className: "text-right tabular-nums",
							cell: (row) => rupiah(row.values.minimum_contribution_idr ?? 0),
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
				<CommercialPolicyDialog
					expectedVersion={history.latest_version}
					current={current?.values ?? null}
					onClose={() => setDialogOpen(false)}
					onStale={() => void load()}
					onDone={(saved) => {
						setDialogOpen(false);
						setNotice(
							`Kebijakan komersial versi ${saved.version} tersimpan (berlaku ${wibDateTime(saved.effective_at)}).`,
						);
						void load();
					}}
				/>
			)}
		</div>
	);
}

function CommercialPolicyDialog({
	expectedVersion,
	current,
	onClose,
	onStale,
	onDone,
}: {
	expectedVersion: number;
	current: CommercialPolicyValues | null;
	onClose: () => void;
	onStale: () => void;
	onDone: (saved: CommercialPolicyVersion) => void;
}) {
	const id = useId();
	// Frozen on mount: a background reload after 409 VERSION_CONFLICT must not silently advance the version an open dialog submits.
	const [capturedVersion] = useState(expectedVersion);
	const [commissionPercent, setCommissionPercent] = useState(
		current ? bpsToPercent(current.default_commission_bps) : "10",
	);
	const [minPayout, setMinPayout] = useState(
		current ? String(current.minimum_payout_idr) : "99000",
	);
	const [minContribution, setMinContribution] = useState(
		current && current.minimum_contribution_idr !== undefined
			? String(current.minimum_contribution_idr)
			: "0",
	);
	const [when, setWhen] = useState<"now" | "later">("now");
	const [at, setAt] = useState("");
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const intent = useSettingsIntent();

	async function submit() {
		const commissionBps = percentToBps(commissionPercent);
		if (commissionBps === null || commissionBps > 10000) {
			intent.setError(
				"Komisi afiliasi bawaan diisi persen 0–100 dengan paling banyak dua angka desimal, contoh 10.",
			);
			return;
		}
		const payoutIdr = parseWholeRupiah(minPayout);
		if (payoutIdr === null || payoutIdr < 1) {
			intent.setError(
				"Minimum pencairan komisi harus berupa rupiah utuh minimal Rp1.",
			);
			return;
		}
		const contributionTrimmed = minContribution.trim();
		let contributionIdr: number | undefined;
		if (contributionTrimmed !== "") {
			const parsed = parseWholeRupiah(contributionTrimmed);
			if (parsed === null || parsed < 0 || parsed > 99000) {
				intent.setError(
					"Batas minimum kontribusi margin harus berupa rupiah utuh antara Rp0 dan Rp99.000.",
				);
				return;
			}
			contributionIdr = parsed;
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

		const saved = await intent.run<CommercialPolicyVersion>(
			"/api/v1/admin/policy-versions",
			() => ({
				kind: "commercial",
				warehouse_id: null,
				expected_version: capturedVersion,
				effective_at: effectiveAt,
				values: {
					default_commission_bps: commissionBps,
					minimum_payout_idr: payoutIdr,
					...(contributionIdr !== undefined
						? { minimum_contribution_idr: contributionIdr }
						: {}),
				},
				reason: reason.trim(),
			}),
			{
				proof: {
					password,
					action: "company_policy.version",
					subject: "company-commercial",
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
			title="Versi kebijakan komersial baru"
			description={`Menambah versi ${capturedVersion + 1} (didasarkan pada versi v${capturedVersion}). Harga penawaran lengkap tetap Rp99.000 dan pesanan lama tidak berubah.`}
			pending={intent.pending}
			error={intent.error}
			submitLabel="Simpan kebijakan"
			pendingLabel="Menyimpan…"
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField
				id={`${id}-commission`}
				label="Komisi afiliasi bawaan (%)"
				hint="Persen dari nilai barang (0–100%), contoh 10 untuk 10% (1.000 bps)."
			>
				<div className="flex items-center gap-2">
					<Input
						id={`${id}-commission`}
						data-testid="commercial-commission"
						inputMode="decimal"
						className="max-w-32"
						value={commissionPercent}
						aria-describedby={`${id}-commission-hint`}
						onChange={(e) => setCommissionPercent(e.target.value)}
					/>
					<span aria-hidden="true" className="text-sm text-muted-foreground">
						%
					</span>
				</div>
			</FormField>

			<FormField
				id={`${id}-payout`}
				label="Minimum pencairan komisi (Rp)"
				hint="Rupiah utuh tanpa desimal, contoh 99000."
			>
				<Input
					id={`${id}-payout`}
					data-testid="commercial-min-payout"
					inputMode="numeric"
					aria-describedby={`${id}-payout-hint`}
					value={minPayout}
					onChange={(e) => setMinPayout(e.target.value)}
				/>
			</FormField>

			<FormField
				id={`${id}-contribution`}
				label="Batas minimum kontribusi margin (Rp)"
				hint="Batas bawah margin per penawaran (0–99.000) untuk persetujuan publikasi otomatis."
			>
				<Input
					id={`${id}-contribution`}
					data-testid="commercial-min-contribution"
					inputMode="numeric"
					aria-describedby={`${id}-contribution-hint`}
					value={minContribution}
					onChange={(e) => setMinContribution(e.target.value)}
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
						data-testid="commercial-later"
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
							data-testid="commercial-effective-at"
							type="datetime-local"
							aria-describedby={`${id}-at-hint`}
							value={at}
							onChange={(e) => setAt(e.target.value)}
						/>
					</FormField>
				)}
			</fieldset>

			<FormField id={`${id}-reason`} label="Alasan perubahan">
				<Input
					id={`${id}-reason`}
					data-testid="commercial-reason"
					maxLength={500}
					autoComplete="off"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>

			<FormField
				id={`${id}-password`}
				label="Konfirmasi kata sandi"
				hint="Dipakai satu kali untuk menerbitkan bukti autentikasi Super Admin."
			>
				<Input
					id={`${id}-password`}
					data-testid="commercial-password"
					type="password"
					autoComplete="current-password"
					maxLength={128}
					aria-describedby={`${id}-password-hint`}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}
