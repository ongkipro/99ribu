"use client";

import { ChevronRight, CircleCheck, Plus, RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { wibInputToIso } from "@/modules/storefront/format";
import { failureText, getJson } from "./admin-errors";
import {
	ACCOUNT_STATUS,
	type AdminAffiliateDetail,
	type AdminAffiliateRateVersion,
	type AdminAffiliateSummary,
	type AffiliateAccountStatus,
	BENEFICIARY_STATUS,
	offerCommissionPreviewIdr,
	RATE_STATE,
	RateIntent,
} from "./affiliates-model";
import { DataTable } from "./data-table";
import { bpsToPercent, formatWib, rupiah } from "./format";
import { FormDialog, FormField, SegmentedControl } from "./form";
import { AdminPage, DetailSection, PageHeader } from "./page-blocks";
import { ErrorState } from "./states";
import { StatusBadge } from "./status";
import { useKeysetList } from "./use-keyset-list";
import { adminPath } from "@/modules/access/admin-paths";

const PAGE_SIZE = 25;
const CODE_INPUT = /^[A-Za-z0-9_-]{1,64}$/;
type StatusFilter = "" | AffiliateAccountStatus;
const STATUS_OPTIONS: readonly (readonly [StatusFilter, string])[] = [
	["", "Semua status"],
	["active", "Aktif"],
	["suspended", "Ditangguhkan"],
];

export function AffiliatesListClient({ owner }: { owner: boolean }) {
	const [status, setStatus] = useState<StatusFilter>("");
	const [codeDraft, setCodeDraft] = useState("");
	const [appliedCode, setAppliedCode] = useState("");
	const [codeProblem, setCodeProblem] = useState<string | null>(null);

	const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
	if (status) params.set("status", status);
	if (appliedCode) params.set("code", appliedCode);
	const list = useKeysetList<AdminAffiliateSummary>(
		`/api/v1/admin/affiliates?${params}`,
		(row) => row.id,
	);
	const filtered = Boolean(status || appliedCode);

	function submitCode(next: string) {
		const trimmed = next.trim();
		if (trimmed && !CODE_INPUT.test(trimmed)) {
			setCodeProblem(
				"Kode rujukan hanya berisi huruf, angka, tanda hubung, atau garis bawah (maks. 64).",
			);
			return;
		}
		setCodeProblem(null);
		setAppliedCode(trimmed.toUpperCase());
	}

	function resetFilters() {
		setStatus("");
		setCodeDraft("");
		setAppliedCode("");
		setCodeProblem(null);
	}

	return (
		<AdminPage testId="affiliates-page">
			<PageHeader
				title="Afiliasi"
				description={
					owner
						? "Daftar mitra afiliasi, tarif komisi yang sedang berlaku, dan ringkasan saldo komisi per status. Buka satu mitra untuk melihat riwayat versi tarif dan mengatur tarif baru ke depan."
						: "Daftar mitra afiliasi, tarif komisi yang sedang berlaku, dan ringkasan saldo komisi per status (hanya baca untuk Keuangan; perubahan tarif khusus dilakukan oleh Super Admin)."
				}
				meta={<span>Waktu dalam WIB · tanpa data pribadi pembeli atau nomor rekening</span>}
			/>
			<search aria-label="Filter afiliasi" className="flex flex-col gap-3">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<SegmentedControl
						legend="Filter status mitra"
						value={status}
						options={STATUS_OPTIONS}
						onChange={setStatus}
						testId={(key) => `affiliates-status-${key || "all"}`}
					/>
					<form
						noValidate
						data-testid="affiliates-filter-form"
						className="flex flex-wrap items-start gap-2 max-md:w-full"
						onSubmit={(event) => {
							event.preventDefault();
							submitCode(codeDraft);
						}}
					>
						<FormField
							id="affiliates-code"
							label="Kode rujukan"
							hint={codeProblem ?? undefined}
							className="min-w-52 max-md:w-full"
						>
							<Input
								id="affiliates-code"
								data-testid="affiliates-code"
								value={codeDraft}
								maxLength={64}
								autoComplete="off"
								placeholder="SERBA99-..."
								aria-invalid={codeProblem ? true : undefined}
								aria-describedby={codeProblem ? "affiliates-code-hint" : undefined}
								onChange={(event) => setCodeDraft(event.target.value)}
							/>
						</FormField>
						<div className="flex gap-2 pt-6 max-md:w-full max-md:pt-0 max-md:*:flex-1">
							<Button type="submit" variant="outline" data-testid="affiliates-filter-submit">
								<Search aria-hidden="true" data-icon="inline-start" />
								Cari kode
							</Button>
							{filtered && (
								<Button
									type="button"
									variant="ghost"
									data-testid="affiliates-filter-reset"
									onClick={resetFilters}
								>
									<RotateCcw aria-hidden="true" data-icon="inline-start" />
									Atur ulang
								</Button>
							)}
						</div>
					</form>
				</div>
			</search>
			<DataTable
				testId="affiliates-table"
				caption="Daftar mitra afiliasi"
				rows={list.rows}
				rowKey={(row) => row.id}
				rowTestId={(row) => `affiliate-row-${row.id}`}
				status={list.status}
				loadingLabel="Memuat daftar afiliasi…"
				empty={
					filtered
						? "Tidak ada mitra afiliasi yang cocok dengan filter ini."
						: "Belum ada mitra afiliasi yang terdaftar."
				}
				emptyTestId="affiliates-empty"
				stack
				paging={{
					...list.paging,
					testId: "affiliates-more",
					summary: `${list.rows.length} afiliasi ditampilkan`,
				}}
				columns={[
					{
						id: "affiliate",
						header: "Mitra & Kode",
						stack: "title",
						cellClassName: "whitespace-normal",
						cell: (row) => (
							<span className="flex flex-col gap-0.5">
								<Link
									href={adminPath("affiliate", row.admin_no)}
									data-testid={`affiliate-link-${row.id}`}
									className="font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
								>
									{row.display_name}
								</Link>
								<span className="font-mono text-xs text-muted-foreground break-all">
									{row.referral_code ?? "Kode belum dibuat"}
								</span>
							</span>
						),
					},
					{
						id: "rate",
						header: "Tarif berlaku",
						stack: "aside",
						className: "text-right tabular-nums",
						cell: (row) => (
							<span className="flex flex-col items-end gap-0.5">
								<span className="font-medium">
									{bpsToPercent(row.effective_rate_bps)}% ({rupiah(row.effective_commission_idr)})
								</span>
								<span className="text-xs font-normal text-muted-foreground">
									{row.rate_source === "override"
										? "Tarif khusus mitra"
										: "Kebijakan standar"}
								</span>
							</span>
						),
					},
					{
						id: "enrolled",
						header: "Terdaftar",
						stack: "meta",
						className: "whitespace-nowrap tabular-nums",
						cell: (row) => formatWib(row.enrolled_at),
					},
					{
						id: "status",
						header: "Status",
						stack: "status",
						cell: (row) => {
							const [accLabel, accTone] = ACCOUNT_STATUS[row.status];
							const [benLabel, benTone] = BENEFICIARY_STATUS[row.beneficiary_status];
							return (
								<span className="flex flex-wrap items-center gap-1">
									<StatusBadge tone={accTone} data-status={row.status}>
										{accLabel}
									</StatusBadge>
									<StatusBadge tone={benTone} data-status={row.beneficiary_status}>
										{benLabel}
									</StatusBadge>
								</span>
							);
						},
					},
					{
						id: "matured",
						header: "Jatuh tempo (siap/antre)",
						className: "text-right tabular-nums",
						cell: (row) =>
							`${rupiah(row.commissions.matured_idr)} (${row.commissions.matured_count} unit)`,
					},
					{
						id: "pending",
						header: "Menunggu H+10",
						className: "text-right tabular-nums md:max-lg:hidden",
						cell: (row) =>
							`${rupiah(row.commissions.pending_idr)} (${row.commissions.pending_count} unit)`,
					},
					{
						id: "paid",
						header: "Sudah dibayar",
						className: "text-right tabular-nums md:max-xl:hidden",
						cell: (row) =>
							`${rupiah(row.commissions.paid_idr)} (${row.commissions.paid_count} unit)`,
					},
					{
						id: "held_void",
						header: "Ditahan / Batal",
						className: "text-right tabular-nums md:max-xl:hidden",
						cell: (row) =>
							`Ditahan ${rupiah(row.commissions.held_idr)} (${row.commissions.held_count}) · Batal ${row.commissions.void_count}`,
					},
					{
						id: "actions",
						header: <span className="sr-only">Tindakan</span>,
						className: "text-right",
						cell: (row) => (
							<Button asChild variant="outline" size="sm">
								<Link
									href={adminPath("affiliate", row.admin_no)}
									data-testid={`affiliate-open-${row.id}`}
								>
									Buka<span className="sr-only"> {row.display_name}</span>
									<ChevronRight aria-hidden="true" data-icon="inline-end" />
								</Link>
							</Button>
						),
					},
				]}
			/>
		</AdminPage>
	);
}

export function AffiliateDetailClient({
	affiliateId,
	owner,
}: {
	affiliateId: string;
	owner: boolean;
}) {
	const [state, setState] = useState<
		| { kind: "loading" }
		| { kind: "missing" }
		| { kind: "error"; text: string }
		| { kind: "ready"; affiliate: AdminAffiliateDetail }
	>({ kind: "loading" });
	const [dialogOpen, setDialogOpen] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	const openButtonRef = useRef<HTMLButtonElement>(null);
	const requestSeq = useRef(0);

	const load = useCallback(
		async (silent = false) => {
			const seq = ++requestSeq.current;
			if (!silent) setState({ kind: "loading" });
			const result = await getJson<AdminAffiliateDetail>(
				`/api/v1/admin/affiliates/${affiliateId}`,
			);
			if (seq !== requestSeq.current) return;
			if (result.ok) {
				setState({ kind: "ready", affiliate: result.data });
			} else if (
				result.failure.status === 404 ||
				result.failure.status === 400
			) {
				setState({ kind: "missing" });
			} else if (!silent) {
				setState({ kind: "error", text: failureText(result.failure) });
			}
		},
		[affiliateId],
	);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	const back = { href: "/admin/affiliates", label: "Afiliasi" };

	if (state.kind === "loading") {
		return (
			<AdminPage>
				<PageHeader title="Memuat afiliasi…" back={back} />
				<Skeleton className="h-32 w-full" />
			</AdminPage>
		);
	}
	if (state.kind === "missing") {
		return (
			<AdminPage testId="affiliate-missing">
				<PageHeader title="Mitra afiliasi tidak ditemukan" back={back} />
				<p className="text-sm">
					Mitra afiliasi dengan ID ini tidak terdaftar di sistem.
				</p>
			</AdminPage>
		);
	}
	if (state.kind === "error") {
		return (
			<AdminPage>
				<PageHeader title="Detail Afiliasi" back={back} />
				<ErrorState message={state.text} onRetry={() => void load()} />
			</AdminPage>
		);
	}

	const { affiliate } = state;
	const [accLabel, accTone] = ACCOUNT_STATUS[affiliate.status];
	const [benLabel, benTone] = BENEFICIARY_STATUS[affiliate.beneficiary_status];
	const c = affiliate.commissions;

	return (
		<AdminPage testId="affiliate-detail-page">
			<PageHeader
				title={affiliate.display_name}
				titleTestId="affiliate-title"
				back={back}
				badge={
					<div className="flex flex-wrap items-center gap-1.5">
						<StatusBadge tone={accTone} data-status={affiliate.status}>
							{accLabel}
						</StatusBadge>
						<StatusBadge
							tone={benTone}
							data-status={affiliate.beneficiary_status}
						>
							{benLabel}
						</StatusBadge>
					</div>
				}
				description={`Kode rujukan: ${affiliate.referral_code ?? "Belum dibuat"} · Terdaftar ${formatWib(affiliate.enrolled_at)} · ${affiliate.attributed_orders_count} pesanan teratribusi`}
				meta={
					<span>
						ID mitra: <span className="font-mono">{affiliate.id}</span>
					</span>
				}
				actions={
					owner ? (
						<Button
							ref={openButtonRef}
							type="button"
							data-testid="affiliate-rate-open"
							disabled={!affiliate.rate_eligible}
							onClick={() => setDialogOpen(true)}
						>
							<Plus aria-hidden="true" data-icon="inline-start" />
							Atur tarif
						</Button>
					) : undefined
				}
			/>

			{notice && (
				<Alert
					ref={noticeRef}
					tabIndex={-1}
					role="status"
					className="border-success/30 bg-success-surface outline-none"
					data-testid="affiliate-rate-notice"
				>
					<CircleCheck aria-hidden="true" />
					<AlertDescription className="text-foreground">
						{notice}
					</AlertDescription>
				</Alert>
			)}

			<DetailSection
				id="affiliate-commissions-heading"
				title="Ringkasan komisi dan saldo"
				description="Setiap unit penawaran lengkap Rp99.000 dihitung terpisah. Data pribadi pembeli dan nomor rekening tujuan tidak ditampilkan di halaman ini."
				testId="affiliate-commissions"
			>
				<dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					<div
						className="flex flex-col gap-0.5 rounded-md border p-3"
						data-testid="commission-matured"
					>
						<dt className="text-xs text-muted-foreground">
							Jatuh tempo (belum dibayar)
						</dt>
						<dd className="text-base font-semibold tabular-nums">
							{rupiah(c.matured_idr)}{" "}
							<span className="text-xs font-normal text-muted-foreground">
								({c.matured_count} unit)
							</span>
						</dd>
						<dd className="text-xs text-muted-foreground tabular-nums">
							Siap antre: {rupiah(c.eligible_idr)} ({c.eligible_count} unit) ·
							Antrean transfer: {rupiah(c.allocated_idr)} ({c.allocated_count}{" "}
							unit)
						</dd>
					</div>
					<div
						className="flex flex-col gap-0.5 rounded-md border p-3"
						data-testid="commission-pending"
					>
						<dt className="text-xs text-muted-foreground">
							Menunggu jatuh tempo (H+10)
						</dt>
						<dd className="text-base font-semibold tabular-nums">
							{rupiah(c.pending_idr)}{" "}
							<span className="text-xs font-normal text-muted-foreground">
								({c.pending_count} unit)
							</span>
						</dd>
						<dd className="text-xs text-muted-foreground">
							Menunggu penerimaan barang atau jendela 10 hari selesai.
						</dd>
					</div>
					<div
						className="flex flex-col gap-0.5 rounded-md border p-3"
						data-testid="commission-paid"
					>
						<dt className="text-xs text-muted-foreground">Sudah dibayar</dt>
						<dd className="text-base font-semibold tabular-nums">
							{rupiah(c.paid_idr)}{" "}
							<span className="text-xs font-normal text-muted-foreground">
								({c.paid_count} unit)
							</span>
						</dd>
						<dd className="text-xs text-muted-foreground tabular-nums">
							Minimum antrean pencairan otomatis:{" "}
							{rupiah(affiliate.minimum_payout_idr)}
						</dd>
					</div>
					<div
						className="flex flex-col gap-0.5 rounded-md border p-3"
						data-testid="commission-held"
					>
						<dt className="text-xs text-muted-foreground">
							Ditahan (klaim retur/penggantian)
						</dt>
						<dd className="text-base font-semibold tabular-nums">
							{rupiah(c.held_idr)}{" "}
							<span className="text-xs font-normal text-muted-foreground">
								({c.held_count} unit)
							</span>
						</dd>
					</div>
					<div
						className="flex flex-col gap-0.5 rounded-md border p-3"
						data-testid="commission-void"
					>
						<dt className="text-xs text-muted-foreground">
							Dibatalkan (refund)
						</dt>
						<dd className="text-base font-semibold tabular-nums">
							{rupiah(c.void_idr)}{" "}
							<span className="text-xs font-normal text-muted-foreground">
								({c.void_count} unit)
							</span>
						</dd>
					</div>
					<div
						className="flex flex-col gap-0.5 rounded-md border p-3"
						data-testid="commission-orders"
					>
						<dt className="text-xs text-muted-foreground">
							Pesanan teratribusi
						</dt>
						<dd className="text-base font-semibold tabular-nums">
							{affiliate.attributed_orders_count} pesanan
						</dd>
					</div>
				</dl>
			</DetailSection>

			<DetailSection
				id="affiliate-rates-heading"
				title="Tarif komisi dan riwayat versi"
				description="Tarif khusus hanya berlaku ke depan untuk kutipan dan pesanan baru. Pesanan yang sudah dibuat tetap memakai tarif saat transaksi terjadi."
				testId="affiliate-rates"
			>
				<dl
					className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm"
					data-testid="affiliate-rate-current"
				>
					<dt className="text-muted-foreground">Tarif berlaku sekarang</dt>
					<dd className="font-semibold tabular-nums">
						{bpsToPercent(affiliate.effective_rate_bps)}% (
						{affiliate.effective_rate_bps} bps ·{" "}
						{rupiah(affiliate.effective_commission_idr)} / unit)
					</dd>
					<dt className="text-muted-foreground">Sumber tarif</dt>
					<dd className="tabular-nums">
						{affiliate.rate_source === "override"
							? `Tarif khusus mitra (versi kepala: v${affiliate.rate_version})`
							: `Kebijakan komersial standar (${bpsToPercent(affiliate.default_policy_rate_bps)}% · ${affiliate.default_policy_rate_bps} bps)`}
					</dd>
				</dl>
				{!owner && (
					<p
						className="text-xs text-muted-foreground"
						data-testid="affiliate-rate-readonly"
					>
						Hanya baca untuk peran Keuangan. Perubahan tarif komisi memerlukan
						otorisasi Super Admin.
					</p>
				)}
				{owner && !affiliate.rate_eligible && (
					<p
						className="text-xs text-muted-foreground"
						data-testid="affiliate-rate-ineligible"
					>
						Mitra ini sedang tidak memenuhi syarat perubahan tarif (harus
						berstatus aktif, email terverifikasi, dan memegang peran afiliasi).
					</p>
				)}
				<DataTable
					testId="affiliate-rate-history"
					caption={`Riwayat versi tarif ${affiliate.display_name}`}
					rows={affiliate.rate_versions}
					rowKey={(row) => row.id}
					rowTestId={(row) => `affiliate-rate-row-${row.version}`}
					status={{ kind: "ready" }}
					loadingLabel="Memuat riwayat tarif…"
					empty="Belum ada versi tarif khusus. Mitra ini menggunakan tarif komisi standar dari kebijakan komersial."
					emptyTestId="affiliate-rate-empty"
					stack
					columns={[
						{
							id: "version",
							header: "Versi",
							stack: "title",
							className: "tabular-nums",
							cell: (row: AdminAffiliateRateVersion) => {
								const [stateLabel, stateTone] = RATE_STATE[row.state];
								return (
									<span className="flex flex-wrap items-center gap-2">
										<span>v{row.version}</span>
										<StatusBadge tone={stateTone} data-status={row.state}>
											{stateLabel}
										</StatusBadge>
									</span>
								);
							},
						},
						{
							id: "rate",
							header: "Tarif",
							stack: "aside",
							className: "text-right tabular-nums",
							cell: (row: AdminAffiliateRateVersion) =>
								`${bpsToPercent(row.basis_points)}% (${row.basis_points} bps · ${rupiah(row.commission_idr)})`,
						},
						{
							id: "effective_at",
							header: "Berlaku sejak",
							stack: "meta",
							className: "whitespace-nowrap tabular-nums",
							cell: (row: AdminAffiliateRateVersion) =>
								formatWib(row.effective_at),
						},
						{
							id: "actor",
							header: "Pelaku",
							cell: (row: AdminAffiliateRateVersion) =>
								row.actor_name ?? row.actor_id,
						},
						{
							id: "reason",
							header: "Alasan",
							cellClassName: "max-w-md whitespace-normal",
							cell: (row: AdminAffiliateRateVersion) => row.reason,
						},
						{
							id: "created_at",
							header: "Dicatat",
							className: "whitespace-nowrap tabular-nums md:max-lg:hidden",
							cell: (row: AdminAffiliateRateVersion) =>
								formatWib(row.created_at),
						},
					]}
				/>
			</DetailSection>

			{dialogOpen && owner && (
				<RateVersionDialog
					affiliateId={affiliate.id}
					displayName={affiliate.display_name}
					expectedVersion={affiliate.rate_version}
					initialBps={affiliate.effective_rate_bps}
					onClose={() => {
						setDialogOpen(false);
						openButtonRef.current?.focus();
					}}
					onStale={() => void load(true)}
					onUncertain={() => void load(true)}
					onDone={(saved) => {
						setDialogOpen(false);
						setNotice(
							`Tarif versi ${saved.version} (${bpsToPercent(saved.basis_points)}% · ${saved.basis_points} bps) untuk ${affiliate.display_name} tersimpan, berlaku ${formatWib(saved.effective_at)}.`,
						);
						void load(true);
					}}
				/>
			)}
		</AdminPage>
	);
}

function RateVersionDialog({
	affiliateId,
	displayName,
	expectedVersion,
	initialBps,
	onClose,
	onStale,
	onUncertain,
	onDone,
}: {
	affiliateId: string;
	displayName: string;
	expectedVersion: number;
	initialBps: number;
	onClose: () => void;
	onStale: () => void;
	onUncertain: () => void;
	onDone: (saved: {
		id: string;
		version: number;
		basis_points: number;
		effective_at: string;
	}) => void;
}) {
	const ids = useId();
	// Frozen on mount (wave 2 lesson): a background reload after 409 VERSION_CONFLICT must not silently advance
	// the expected_version that a second submit inside the still-open dialog sends.
	const [capturedVersion] = useState(expectedVersion);
	const [intent] = useState(() => new RateIntent());

	const [bpsInput, setBpsInput] = useState(String(initialBps));
	const [when, setWhen] = useState<"now" | "later">("now");
	const [at, setAt] = useState("");
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const [pending, setPending] = useState(false);
	const [uncertain, setUncertain] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const trimmedBps = bpsInput.trim();
	const parsedBps = /^\d{1,5}$/.test(trimmedBps) ? Number(trimmedBps) : null;
	const validBps =
		parsedBps !== null && parsedBps >= 0 && parsedBps <= 10_000
			? parsedBps
			: null;

	async function submit() {
		if (validBps === null) {
			return setError(
				"Tarif komisi harus berupa bilangan bulat 0 sampai 10000 basis poin (100 bps = 1%).",
			);
		}
		let effectiveAt: string | null = null;
		if (when === "later") {
			effectiveAt = at ? wibInputToIso(at) : null;
			if (!effectiveAt) {
				return setError("Isi waktu berlaku (WIB) yang valid.");
			}
		}
		if (!reason.trim()) {
			return setError("Alasan perubahan tarif wajib diisi.");
		}
		if (!password) {
			return setError("Isi kata sandi Anda untuk konfirmasi.");
		}
		setPending(true);
		setError(null);
		const sent = await intent.send<{
			id: string;
			version: number;
			basis_points: number;
			effective_at: string;
		}>(
			`/api/v1/admin/affiliates/${affiliateId}/rates`,
			() => ({
				basis_points: validBps,
				effective_at: effectiveAt,
				expected_version: capturedVersion,
				reason: reason.trim(),
			}),
			{
				password,
				affiliateId,
				onUncertain,
			},
		);
		setPending(false);
		setUncertain(sent.uncertain);
		if (!sent.data) {
			if (sent.code === "VERSION_CONFLICT") {
				onStale();
			}
			return setError(sent.error);
		}
		setPassword("");
		onDone(sent.data);
	}

	return (
		<FormDialog
			title={`Atur tarif ${displayName}`}
			description={`Menambah versi ${capturedVersion + 1} (versi saat dialog dibuka: v${capturedVersion}). Perubahan hanya berlaku ke depan dan tercatat di log audit.`}
			pending={pending}
			error={error}
			submitLabel={uncertain ? "Kirim ulang permintaan yang sama" : "Simpan tarif"}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField
				id={`${ids}-bps`}
				label="Tarif komisi (basis poin, 0–10000)"
				hint={
					validBps !== null
						? `Setara ${bpsToPercent(validBps)}% (${rupiah(offerCommissionPreviewIdr(validBps))} per unit penawaran Rp99.000).`
						: "Bilangan bulat 0–10000 (contoh: 1000 = 10% = Rp9.900 per unit)."
				}
			>
				<Input
					id={`${ids}-bps`}
					data-testid="affiliate-rate-bps"
					inputMode="numeric"
					autoComplete="off"
					disabled={uncertain}
					aria-describedby={`${ids}-bps-hint`}
					value={bpsInput}
					onChange={(event) => {
						intent.resetDraft();
						setBpsInput(event.target.value);
					}}
				/>
			</FormField>
			<fieldset className="flex flex-col gap-2" disabled={uncertain}>
				<legend className="mb-1 text-sm font-medium">Waktu berlaku</legend>
				<label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
					<input
						type="radio"
						name={`${ids}-when`}
						data-testid="affiliate-rate-now"
						className="size-4 accent-primary"
						checked={when === "now"}
						onChange={() => {
							intent.resetDraft();
							setWhen("now");
						}}
					/>
					Sekarang
				</label>
				<label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
					<input
						type="radio"
						name={`${ids}-when`}
						data-testid="affiliate-rate-later"
						className="size-4 accent-primary"
						checked={when === "later"}
						onChange={() => {
							intent.resetDraft();
							setWhen("later");
						}}
					/>
					Jadwalkan
				</label>
				{when === "later" && (
					<FormField
						id={`${ids}-at`}
						label="Waktu berlaku (WIB)"
						hint="Paling jauh 366 hari ke depan dan tidak boleh mendahului jadwal versi sebelumnya."
					>
						<Input
							id={`${ids}-at`}
							data-testid="affiliate-rate-at"
							type="datetime-local"
							aria-describedby={`${ids}-at-hint`}
							value={at}
							onChange={(event) => {
								intent.resetDraft();
								setAt(event.target.value);
							}}
						/>
					</FormField>
				)}
			</fieldset>
			<FormField id={`${ids}-reason`} label="Alasan perubahan (wajib)">
				<Textarea
					id={`${ids}-reason`}
					data-testid="affiliate-rate-reason"
					rows={2}
					maxLength={500}
					disabled={uncertain}
					value={reason}
					onChange={(event) => {
						intent.resetDraft();
						setReason(event.target.value);
					}}
				/>
			</FormField>
			<FormField
				id={`${ids}-password`}
				label="Kata sandi Anda"
				hint="Dipakai satu kali untuk bukti reautentikasi (affiliate_rate.version). Verifikasi dua langkah Anda harus berumur maksimal 5 menit."
			>
				<Input
					id={`${ids}-password`}
					data-testid="affiliate-rate-password"
					type="password"
					autoComplete="current-password"
					maxLength={128}
					disabled={uncertain}
					aria-describedby={`${ids}-password-hint`}
					value={password}
					onChange={(event) => {
						intent.resetProof();
						setPassword(event.target.value);
					}}
				/>
			</FormField>
		</FormDialog>
	);
}
