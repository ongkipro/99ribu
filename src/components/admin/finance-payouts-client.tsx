"use client";

import { CircleAlert, CircleCheck, RefreshCw, Upload } from "lucide-react";
import { cn } from "cn";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { wibInput, wibInputToIso } from "@/modules/storefront/format";
import { type ApiFailure, failureText, getJson } from "./admin-errors";
import { DataTable } from "./data-table";
import { useFinanceIntent } from "./finance-intent";
import { FinanceIntent, putBytes } from "./finance-intent-core";
import {
	type BeneficiarySnapshot,
	cursorBefore,
	type EvidenceUploadGrant,
	type ManualTransferClaim,
	type Payout,
	PAYOUT_STATUS,
	PAYOUT_STATUSES,
	type PayoutStatus,
	type UploadedEvidence,
} from "./finance-model";
import { formatWib, rupiah } from "./format";
import { FormDialog, FormField, SegmentedControl } from "./form";
import { AdminPage, DetailSection, PageHeader, StickyActions } from "./page-blocks";
import { StatusBadge } from "./status";
import { useKeysetList } from "./use-keyset-list";
import { adminPath } from "@/modules/access/admin-paths";

const API = "/api/v1/admin/payouts";

const FILTER_OPTIONS: readonly (readonly [PayoutStatus | "all", string])[] = [
	["all", "Semua"],
	...PAYOUT_STATUSES.map(
		(status) => [status, PAYOUT_STATUS[status][0]] as const,
	),
];

export function PayoutsListClient({
	initialStatus,
}: {
	initialStatus: PayoutStatus | null;
}) {
	const [filter, setFilter] = useState<PayoutStatus | "all">(
		initialStatus ?? "all",
	);
	const list = useKeysetList<Payout>(`${API}?limit=20`, (row) => row.id);
	const shown =
		filter === "all"
			? list.rows
			: list.rows.filter((row) => row.status === filter);

	return (
		<div className="flex flex-col gap-4" data-testid="payouts-page">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<SegmentedControl
					legend="Filter status pencairan komisi"
					value={filter}
					onChange={setFilter}
					options={FILTER_OPTIONS}
					testId={(key) => `payout-filter-${key}`}
				/>
				<Button
					type="button"
					variant="outline"
					onClick={() => void list.reload()}
				>
					<RefreshCw data-icon="inline-start" aria-hidden="true" />
					Muat ulang
				</Button>
			</div>

			<DataTable
				testId="payouts-table"
				caption="Antrean pembayaran komisi afiliasi manual"
				rows={shown}
				rowKey={(row) => row.id}
				rowTestId={(row) => `payout-row-${row.id}`}
				status={list.status}
				loadingLabel="Memuat antrean pembayaran komisi…"
				empty={
					filter === "all"
						? "Belum ada pembayaran komisi afiliasi dalam antrean."
						: "Tidak ada pembayaran komisi dengan status ini pada halaman yang dimuat."
				}
				emptyTestId="payouts-empty"
				stack
				paging={{
					...list.paging,
					testId: "payouts-more",
					summary: `${shown.length} pencairan ditampilkan`,
				}}
				columns={[
					{
						id: "payout",
						header: "Pencairan",
						stack: "title",
						cell: (row) => (
							<span className="flex flex-col">
								<Link
									href={adminPath("payout", row.admin_no)}
									className="font-medium text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
								>
									Pencairan <span className="font-mono">#{row.admin_no}</span>
								</Link>
								{row.explanation && (
									<span className="text-xs text-muted-foreground">
										{row.explanation}
									</span>
								)}
							</span>
						),
					},
					{
						id: "amount",
						header: "Nominal",
						stack: "aside",
						className: "text-right tabular-nums",
						cell: (row) => (
							<span className="font-medium tabular-nums">
								{rupiah(row.amount)}
							</span>
						),
					},
					{
						id: "status",
						header: "Status",
						stack: "status",
						cell: (row) => {
							const [label, tone] = PAYOUT_STATUS[row.status] ?? [
								row.status,
								"open",
							];
							return (
								<StatusBadge tone={tone} data-status={row.status}>
									{label}
								</StatusBadge>
							);
						},
					},
					{
						id: "claim",
						header: "Klaim aktif",
						className: "font-mono text-xs",
						hideBelow: "5xl",
						cell: (row) =>
							row.transfer_claim_id ? row.transfer_claim_id.slice(0, 8) : "—",
					},
					{
						id: "created",
						header: "Dibuat",
						stack: "meta",
						className: "whitespace-nowrap tabular-nums",
						cell: (row) => formatWib(row.created_at),
					},
					{
						id: "actions",
						header: <span className="sr-only">Tindakan</span>,
						className: "text-right",
						cell: (row) => (
							<Button asChild size="sm" variant="outline">
								<Link href={adminPath("payout", row.admin_no)}>
									Buka pencairan
								</Link>
							</Button>
						),
					},
				]}
			/>
		</div>
	);
}

// ---- Detail & Claim -> Evidence -> Verify -> Reconcile ------------------------------------------

type PayoutDialog = "claim" | "verify" | "reconcile";

export function PayoutDetailClient({ payoutId }: { payoutId: string }) {
	const [payout, setPayout] = useState<Payout | null>(null);
	const [beneficiary, setBeneficiary] = useState<BeneficiarySnapshot | null>(
		null,
	);
	const [uploaded, setUploaded] = useState<UploadedEvidence | null>(null);
	const [failure, setFailure] = useState<ApiFailure | null>(null);
	const [notFound, setNotFound] = useState(false);
	const [dialog, setDialog] = useState<PayoutDialog | null>(null);
	const [notice, setNotice] = useState<{ text: string; warn?: boolean } | null>(null);
	const noticeRef = useRef<HTMLDivElement>(null);

	const load = useCallback(async () => {
		const before = cursorBefore(payoutId);
		const url = before
			? `${API}?limit=20&cursor=${encodeURIComponent(before)}`
			: `${API}?limit=20`;
		const res = await getJson<{
			data: Payout[];
			pagination: { next_cursor: string | null };
		}>(url);
		if (!res.ok) {
			setFailure(res.failure);
			return;
		}
		let match = res.data.data.find((row) => row.id === payoutId) ?? null;
		if (!match && before) {
			const fallback = await getJson<{
				data: Payout[];
				pagination: { next_cursor: string | null };
			}>(`${API}?limit=50`);
			if (fallback.ok) {
				match = fallback.data.data.find((row) => row.id === payoutId) ?? null;
			}
		}
		if (!match) {
			setNotFound(true);
			return;
		}
		setFailure(null);
		setNotFound(false);
		setPayout(match);
	}, [payoutId]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	const back = {
		href: "/admin/keuangan/komisi",
		label: "Kembali ke antrean komisi",
	};

	if (notFound) {
		return (
			<AdminPage testId="payout-missing">
				<PageHeader back={back} title="Pencairan tidak ditemukan" />
				<p className="text-sm text-muted-foreground">
					Pencairan komisi ini tidak ditemukan dalam antrean keuangan.
				</p>
			</AdminPage>
		);
	}

	if (failure && !payout) {
		return (
			<AdminPage>
				<PageHeader back={back} title="Detail pencairan komisi" />
				<Alert role="alert" data-testid="payout-detail-error">
					<CircleAlert aria-hidden="true" />
					<AlertDescription className="flex flex-wrap items-center gap-3 text-foreground">
						{failureText(failure)}
						{failure.status !== 403 && failure.status !== 404 && (
							<Button size="sm" variant="outline" onClick={() => void load()}>
								Coba lagi
							</Button>
						)}
					</AlertDescription>
				</Alert>
			</AdminPage>
		);
	}

	if (!payout) {
		return (
			<AdminPage>
				<PageHeader back={back} title="Detail pencairan komisi" />
				<div
					className="flex flex-col gap-3"
					aria-live="polite"
					aria-busy="true"
				>
					<p className="text-sm text-muted-foreground">
						Memuat detail pencairan komisi…
					</p>
					<Skeleton className="h-8 w-64 bg-border/70" />
					<Skeleton className="h-40 w-full bg-border/70" />
				</div>
			</AdminPage>
		);
	}

	const [statusLabel, statusTone] = PAYOUT_STATUS[payout.status] ?? [
		payout.status,
		"open",
	];

	const actions: ReactNode[] = [];
	// Money safety: unknown or succeeded payouts never offer claim or verify buttons.
	if (payout.status === "queued") {
		actions.push(
			<Button
				key="claim"
				data-testid="payout-claim-open"
				onClick={() => setDialog("claim")}
			>
				Klaim transfer manual
			</Button>,
		);
	}
	if (payout.status === "processing" && payout.transfer_claim_id) {
		actions.push(
			<Button
				key="verify"
				data-testid="payout-verify-open"
				onClick={() => setDialog("verify")}
			>
				Verifikasi transfer selesai
			</Button>,
		);
	}
	// Reconciliation is for an existing manual transfer outcome. A queued or funding-hold payout has no transfer to
	// reconcile, and `unknown` has no other exit, so offering it there could strand a payout that was never paid.
	if (payout.status === "processing" || payout.status === "unknown") {
		actions.push(
			<Button
				key="reconcile"
				variant={payout.status === "unknown" ? "default" : "outline"}
				data-testid="payout-reconcile-open"
				onClick={() => setDialog("reconcile")}
			>
				Rekonsiliasi status
			</Button>,
		);
	}

	return (
		<AdminPage testId="payout-detail">
			<PageHeader
				back={back}
				title={
					<>
						Pencairan komisi{" "}
						<span className="font-mono">#{payout.admin_no}</span>
					</>
				}
				titleTestId="payout-title"
				badge={
					<StatusBadge
						tone={statusTone}
						testId="payout-status"
						data-status={payout.status}
					>
						{statusLabel}
					</StatusBadge>
				}
				description={`Nominal tetap ${rupiah(payout.amount)} · versi ${payout.version}`}
				meta={
					<>
						<span>Dibuat {formatWib(payout.created_at)}</span>
						{payout.completed_at && (
							<>
								<span aria-hidden="true">·</span>
								<span>Diverifikasi {formatWib(payout.completed_at)}</span>
							</>
						)}
					</>
				}
			/>

			{notice && (
				<Alert
					ref={noticeRef}
					tabIndex={-1}
					role="status"
					className={cn("outline-none", notice.warn && "border-warning/40 bg-warning-surface")}
					data-testid="payout-notice"
					data-tone={notice.warn ? "warning" : "success"}
				>
					{notice.warn ? (
						<CircleAlert aria-hidden="true" className="text-warning" />
					) : (
						<CircleCheck aria-hidden="true" />
					)}
					<AlertDescription className="text-foreground">{notice.text}</AlertDescription>
				</Alert>
			)}

			{payout.status === "unknown" && (
				<Alert
					role="alert"
					data-testid="payout-unknown"
					className="border-warning/40 bg-warning-surface"
				>
					<CircleAlert aria-hidden="true" className="text-warning" />
					<AlertDescription className="text-foreground">
						Hasil pengiriman dana belum pasti; dana tetap dicadangkan tanpa pengiriman ulang.
						Jangan melakukan transfer bank kedua ke rekening mitra sebelum mutasi bank diperiksa.
					</AlertDescription>
				</Alert>
			)}

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
				<div className="flex min-w-0 flex-col gap-4">
					<DetailSection
						id="payout-summary-heading"
						title="Rincian pencairan komisi"
						testId="payout-summary"
					>
						<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
							<dt className="text-muted-foreground">ID pencairan</dt>
							<dd className="font-mono text-xs break-all">{payout.id}</dd>
							<dt className="text-muted-foreground">Nominal pencairan</dt>
							<dd className="font-semibold tabular-nums" data-testid="payout-amount">
								{rupiah(payout.amount)}
							</dd>
							<dt className="text-muted-foreground">Metode eksekusi</dt>
							<dd>Transfer bank manual</dd>
							{payout.transfer_claim_id && (
								<>
									<dt className="text-muted-foreground">ID klaim aktif</dt>
									<dd
										className="font-mono text-xs break-all"
										data-testid="payout-claim-id"
									>
										{payout.transfer_claim_id}
									</dd>
								</>
							)}
							{payout.explanation && (
								<>
									<dt className="text-muted-foreground">Keterangan</dt>
									<dd>{payout.explanation}</dd>
								</>
							)}
						</dl>
					</DetailSection>

					{beneficiary && (
						<DetailSection
							id="payout-beneficiary-heading"
							title="Rekening tujuan mitra (dibekukan saat klaim)"
							description="Transfer tepat sesuai nominal ke rekening yang telah diverifikasi ini."
							testId="payout-beneficiary"
						>
							<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
								<dt className="text-muted-foreground">Bank</dt>
								<dd className="font-medium">{beneficiary.bank_code}</dd>
								<dt className="text-muted-foreground">Nomor rekening</dt>
								<dd className="font-mono font-medium">
									{beneficiary.account_number}
								</dd>
								<dt className="text-muted-foreground">Nama pemilik</dt>
								<dd className="font-medium">
									{beneficiary.account_holder_name}
								</dd>
							</dl>
						</DetailSection>
					)}

					{payout.status === "processing" && (
						<EvidenceUploadPanel
							payoutId={payout.id}
							uploaded={uploaded}
							onUploaded={(ev) => {
								setUploaded(ev);
								setNotice({
									text: `Bukti transfer ${ev.file_name} (${ev.size_bytes} byte) tersimpan. Lanjutkan dengan Verifikasi transfer selesai.`,
								});
							}}
						/>
					)}
				</div>

				<div className="flex min-w-0 flex-col gap-4">
					<DetailSection
						id="payout-actions-heading"
						title="Alur kerja transfer manual"
						testId="payout-actions"
					>
						<p className="text-sm text-muted-foreground">
							{payout.status === "queued"
								? "Langkah 1: Klaim pencairan ini secara eksklusif (berlaku 30 menit) untuk membuka rekening tujuan mitra."
								: payout.status === "processing"
									? "Langkah 2 & 3: Unggah bukti transfer bank (PNG/JPEG/PDF), lalu verifikasi nomor referensi mutasi bank."
									: payout.status === "unknown"
										? "Pencairan sedang dalam status belum pasti. Dana komisi tetap dicadangkan tanpa pengiriman ulang."
										: payout.status === "succeeded"
											? "Transfer manual telah selesai diverifikasi dan dijurnal."
											: "Periksa kendala pencairan ini bersama tim keuangan."}
						</p>
						{actions.length > 0 && (
							<StickyActions className="md:flex-col md:items-stretch">
								{actions}
							</StickyActions>
						)}
					</DetailSection>
				</div>
			</div>

			{dialog === "claim" && (
				<ClaimPayoutDialog
					payout={payout}
					onClose={() => setDialog(null)}
					onUncertain={() => void load()}
					onConflict={() => void load()}
					onDone={(claimed) => {
						setDialog(null);
						setPayout(claimed.payout);
						setBeneficiary(claimed.beneficiary_snapshot);
						setNotice({
							text: `Klaim eksklusif berhasil dicatat. Rekening tujuan: ${claimed.beneficiary_snapshot.bank_code} ${claimed.beneficiary_snapshot.account_number} a.n. ${claimed.beneficiary_snapshot.account_holder_name}.`,
						});
					}}
				/>
			)}

			{dialog === "verify" && (
				<VerifyPayoutDialog
					payout={payout}
					defaultEvidenceId={uploaded?.id ?? ""}
					onClose={() => setDialog(null)}
					onUncertain={() => void load()}
					onConflict={() => void load()}
					onDone={(verified) => {
						setDialog(null);
						setPayout(verified);
						setNotice({
							text: `Transfer komisi ${rupiah(verified.amount)} berhasil diverifikasi dan dijurnal.`,
						});
					}}
				/>
			)}

			{dialog === "reconcile" && (
				<ReconcilePayoutDialog
					payout={payout}
					onClose={() => setDialog(null)}
					onUncertain={() => void load()}
					onConflict={() => void load()}
					onDone={(updated) => {
						setDialog(null);
						setPayout(updated);
						setNotice({
							text: "Status pencairan dicatat sebagai hasil belum pasti; dana tetap dicadangkan tanpa pengiriman ulang.",
							warn: true,
						});
					}}
				/>
			)}
		</AdminPage>
	);
}

function EvidenceUploadPanel({
	payoutId,
	uploaded,
	onUploaded,
}: {
	payoutId: string;
	uploaded: UploadedEvidence | null;
	onUploaded: (ev: UploadedEvidence) => void;
}) {
	const [file, setFile] = useState<File | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const slotIntent = useRef<FinanceIntent | null>(null);

	async function handleUpload() {
		if (!file) {
			setError("Pilih berkas bukti transfer (PNG, JPEG, atau PDF, maks. 10 MB).");
			return;
		}
		if (
			!["image/png", "image/jpeg", "application/pdf"].includes(file.type) ||
			file.size < 1 ||
			file.size > 10_485_760
		) {
			setError(
				"Berkas harus berformat PNG, JPEG, atau PDF dengan ukuran antara 1 byte hingga 10 MB.",
			);
			return;
		}
		setPending(true);
		setError(null);
		try {
			slotIntent.current ??= new FinanceIntent();
			const slot = await slotIntent.current.send<EvidenceUploadGrant>(
				`${API}/${encodeURIComponent(payoutId)}/evidence-uploads`,
				() => ({
					file_name: file.name,
					media_type: file.type,
					size_bytes: file.size,
				}),
			);
			if (!slot.data) {
				setError(slot.error);
				return;
			}
			const bytes = new Uint8Array(await file.arrayBuffer());
			const putUrl = new URL(slot.data.upload_url, window.location.origin).pathname;
			const stored = await putBytes<{
				id: string;
				size_bytes: number;
				sha256: string;
			}>(putUrl, bytes, {
				"content-type": file.type,
				"x-payout-id": payoutId,
			});
			if (!stored.ok) {
				setError(stored.text);
				return;
			}
			slotIntent.current = null;
			onUploaded({
				id: stored.data.id,
				file_name: file.name,
				media_type: file.type,
				size_bytes: stored.data.size_bytes,
				sha256: stored.data.sha256,
			});
		} finally {
			setPending(false);
		}
	}

	return (
		<DetailSection
			id="payout-evidence-heading"
			title="Bukti transfer bank"
			description="Unggah tangkapan layar atau PDF mutasi bank (PNG, JPEG, atau PDF, maks. 10 MB) sebelum memverifikasi transfer."
			testId="payout-evidence-section"
		>
			<div className="flex flex-col gap-3">
				{uploaded && (
					<div
						className="rounded-md border bg-muted/40 p-3 text-xs"
						data-testid="payout-evidence-ready"
					>
						<p className="font-medium text-foreground">
							Bukti siap diverifikasi: {uploaded.file_name} ({uploaded.size_bytes} byte)
						</p>
						<p className="font-mono text-muted-foreground break-all">
							ID bukti: {uploaded.id} · SHA-256: {uploaded.sha256.slice(0, 16)}…
						</p>
					</div>
				)}
				<FormField
					id="payout-evidence-input"
					label="Berkas bukti transfer (PNG, JPEG, PDF)"
				>
					<Input
						id="payout-evidence-input"
						data-testid="payout-evidence-file"
						type="file"
						accept="image/png,image/jpeg,application/pdf"
						disabled={pending}
						onChange={(e) => {
							setFile(e.target.files?.[0] ?? null);
							slotIntent.current = null;
							setError(null);
						}}
					/>
				</FormField>
				{error && (
					<p role="alert" className="text-sm text-destructive">
						{error}
					</p>
				)}
				<Button
					type="button"
					variant="outline"
					className="self-start"
					disabled={pending}
					data-testid="payout-evidence-upload"
					onClick={() => void handleUpload()}
				>
					<Upload data-icon="inline-start" aria-hidden="true" />
					{pending ? "Mengunggah bukti…" : "Unggah bukti transfer"}
				</Button>
			</div>
		</DetailSection>
	);
}

function ClaimPayoutDialog({
	payout,
	onClose,
	onUncertain,
	onConflict,
	onDone,
}: {
	payout: Payout;
	onClose: () => void;
	onUncertain: () => void;
	onConflict: () => void;
	onDone: (claimed: ManualTransferClaim) => void;
}) {
	// Frozen on mount so background reload after 409 VERSION_CONFLICT cannot silently advance the dialog's target version.
	const [capturedVersion] = useState(payout.version);
	const [password, setPassword] = useState("");
	const intent = useFinanceIntent();

	async function submit() {
		if (!password) {
			return intent.setError("Konfirmasi kata sandi wajib diisi.");
		}
		const saved = await intent.run<ManualTransferClaim>(
			`${API}/${encodeURIComponent(payout.id)}/manual-transfer-claims`,
			() => ({ expected_version: capturedVersion }),
			{
				money: {
					password,
					action: "payout.claim",
					subject: payout.id,
				},
				onUncertain,
				onConflict,
			},
		);
		if (saved) onDone(saved);
	}

	return (
		<FormDialog
			title="Klaim transfer komisi manual"
			description={`Mengunci pencairan ${rupiah(payout.amount)} secara eksklusif selama 30 menit atas akun Anda dan menampilkan rekening tujuan mitra.`}
			pending={intent.pending}
			pendingLabel="Mengklaim…"
			error={intent.error}
			submitLabel={
				intent.uncertain ? "Kirim ulang (kunci sama)" : "Klaim transfer"
			}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField
				id="payout-claim-password"
				label="Konfirmasi kata sandi"
				hint="Berlaku satu kali untuk klaim pencairan ini (payout.claim)."
			>
				<Input
					id="payout-claim-password"
					data-testid="payout-claim-password"
					type="password"
					autoComplete="current-password"
					aria-describedby="payout-claim-password-hint"
					disabled={intent.uncertain}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}

function VerifyPayoutDialog({
	payout,
	defaultEvidenceId,
	onClose,
	onUncertain,
	onConflict,
	onDone,
}: {
	payout: Payout;
	defaultEvidenceId: string;
	onClose: () => void;
	onUncertain: () => void;
	onConflict: () => void;
	onDone: (verified: Payout) => void;
}) {
	// Frozen on mount so background reload after 409 VERSION_CONFLICT cannot silently advance the dialog's target version.
	const [capturedVersion] = useState(payout.version);
	const [capturedClaimId] = useState(payout.transfer_claim_id ?? "");
	const [reference, setReference] = useState("");
	const [evidenceId, setEvidenceId] = useState(defaultEvidenceId);
	const [transferredAt, setTransferredAt] = useState(() =>
		wibInput(new Date()),
	);
	const [reason, setReason] = useState("");
	const [password, setPassword] = useState("");
	const intent = useFinanceIntent();

	async function submit() {
		if (
			!reference.trim() ||
			!evidenceId.trim() ||
			!transferredAt ||
			!reason.trim() ||
			!password
		) {
			return intent.setError(
				"Isi referensi transfer bank, ID bukti, waktu transfer, alasan, dan kata sandi.",
			);
		}
		const iso = wibInputToIso(transferredAt);
		if (!iso) {
			return intent.setError("Waktu transfer (WIB) tidak valid.");
		}
		const saved = await intent.run<Payout>(
			`${API}/${encodeURIComponent(payout.id)}/manual-transfer-verifications`,
			() => ({
				expected_version: capturedVersion,
				transfer_claim_id: capturedClaimId,
				bank_transfer_reference: reference.trim(),
				evidence_id: evidenceId.trim(),
				transferred_at: iso,
				reason: reason.trim(),
			}),
			{
				money: {
					password,
					action: "payout.verify",
					subject: payout.id,
				},
				onUncertain,
				onConflict,
			},
		);
		if (saved) onDone(saved);
	}

	return (
		<FormDialog
			title="Verifikasi transfer komisi manual"
			description={`Mencatat penyelesaian transfer ${rupiah(payout.amount)} dengan bukti bank yang sudah diunggah dan memposting jurnal kas secara atomik.`}
			pending={intent.pending}
			pendingLabel="Memverifikasi…"
			error={intent.error}
			submitLabel={
				intent.uncertain ? "Kirim ulang (kunci sama)" : "Verifikasi transfer"
			}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField
				id="payout-verify-reference"
				label="Referensi mutasi transfer bank (wajib)"
			>
				<Input
					id="payout-verify-reference"
					data-testid="payout-verify-reference"
					maxLength={200}
					disabled={intent.uncertain}
					value={reference}
					onChange={(e) => setReference(e.target.value)}
				/>
			</FormField>
			<FormField
				id="payout-verify-evidence"
				label="ID bukti transfer (UUID)"
			>
				<Input
					id="payout-verify-evidence"
					data-testid="payout-verify-evidence"
					className="font-mono text-xs"
					disabled={intent.uncertain}
					value={evidenceId}
					onChange={(e) => setEvidenceId(e.target.value)}
				/>
			</FormField>
			<FormField
				id="payout-verify-time"
				label="Waktu transfer (WIB)"
			>
				<Input
					id="payout-verify-time"
					data-testid="payout-verify-time"
					type="datetime-local"
					disabled={intent.uncertain}
					value={transferredAt}
					onChange={(e) => setTransferredAt(e.target.value)}
				/>
			</FormField>
			<FormField
				id="payout-verify-reason"
				label="Alasan / catatan audit (wajib)"
			>
				<Input
					id="payout-verify-reason"
					data-testid="payout-verify-reason"
					maxLength={1000}
					disabled={intent.uncertain}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>
			<FormField
				id="payout-verify-password"
				label="Konfirmasi kata sandi"
				hint="Berlaku satu kali untuk verifikasi pencairan ini (payout.verify)."
			>
				<Input
					id="payout-verify-password"
					data-testid="payout-verify-password"
					type="password"
					autoComplete="current-password"
					aria-describedby="payout-verify-password-hint"
					disabled={intent.uncertain}
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}

function ReconcilePayoutDialog({
	payout,
	onClose,
	onUncertain,
	onConflict,
	onDone,
}: {
	payout: Payout;
	onClose: () => void;
	onUncertain: () => void;
	onConflict: () => void;
	onDone: (updated: Payout) => void;
}) {
	const [reason, setReason] = useState("");
	const intent = useFinanceIntent();

	async function submit() {
		if (!reason.trim()) {
			return intent.setError("Alasan rekonsiliasi wajib diisi.");
		}
		const saved = await intent.run<Payout>(
			`${API}/${encodeURIComponent(payout.id)}/reconciliations`,
			() => ({ reason: reason.trim() }),
			{ onUncertain, onConflict },
		);
		if (saved) onDone(saved);
	}

	return (
		<FormDialog
			title="Rekonsiliasi status pencairan komisi"
			description="Menandai pencairan sebagai hasil belum pasti sambil mempertahankan cadangan dana komisi tanpa melakukan pengiriman ulang."
			pending={intent.pending}
			pendingLabel="Memproses…"
			error={intent.error}
			submitLabel={
				intent.uncertain ? "Kirim ulang (kunci sama)" : "Simpan rekonsiliasi"
			}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField
				id="payout-reconcile-reason"
				label="Alasan pemeriksaan / rekonsiliasi (wajib)"
			>
				<Input
					id="payout-reconcile-reason"
					data-testid="payout-reconcile-reason"
					maxLength={1000}
					disabled={intent.uncertain}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</FormField>
		</FormDialog>
	);
}
